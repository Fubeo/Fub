// La palette dei comandi: il primo cliente del registro (decisione 0009) nella shell.
//
// Non cabla nessun comando. Legge le spec dal kernel, disegna un campo per ogni
// parametro dichiarato e — quando il raggio dichiarato lo merita — chiede prima
// il **piano** e lo mostra, invece di eseguire e sperare. È la stessa sequenza
// che dovranno fare una CLI (27.1) o un centro di comando (22.4): scegliere fra
// ciò che il registro dichiara, compilare gli argomenti, simulare, approvare.
//
// # Dove sta il consenso
//
// Non c'è una capacità «chiedi conferma» nell'host, e non è una dimenticanza
// (vedi `crates/fub-abi/src/command.rs`): il consenso è il giro
// dry-run → piano → approvazione → apply, e a decidere QUANDO chiederlo è chi
// invoca — qui, con `needsPlan`, sulla base del raggio che il comando ha
// dichiarato. Un «sei sicuro?» mostra ciò che il comando sceglie di dire; un
// piano mostra le note e le modifiche.

import { api } from "../host/ipc";
import type {
  CommandEffect,
  CommandOutcome,
  CommandPlan,
  CommandSpec,
  ParamKind,
  ParamSpec,
} from "../host/contract";
import { pageName } from "../rules/organizer";
import { errorText } from "../host/errors";
import { intrappolaFuoco } from "./a11y";
import type { Tono } from "./notify";
import { type Chiave, t } from "../i18n/strings";
import { allCommands, loadKeyOverrides, type CommandEntry } from "./commands";
import { state } from "../state/store";

/// Ciò che la palette chiede alla shell: eseguire gli intenti, dire qualcosa
/// all'utente, e mettere in salvo i buffer prima di un comando che scrive. Il
/// resto (invocare, disegnare, chiedere) è suo.
export interface PaletteHost {
  onEffect(effect: CommandEffect): Promise<void> | void;
  // Il tono è **facoltativo e vuole essere passato**: un esito a metà non deve
  // avere lo stesso colore di uno riuscito, o l'unica differenza fra «dodici
  // note archiviate» e «undici su dodici, la dodicesima no» è una frase più
  // lunga che nessuno rilegge (§23.14).
  notify(message: string, tono?: Tono): void;
  listDocuments(): Promise<string[]>;
  // **Flush-before-patch** (M3): salva i documenti ancora sporchi e dice
  // quali non ce l'hanno fatta. È la stessa porta che l'esploratore usa per
  // `nonInSalvo` — la palette la chiede alla shell invece di importare il
  // pannello, perché il pannello trascina il DOM e la palette deve restare
  // testabile come funzioni pure.
  flushPendingSave(): Promise<string[]>;
}

// --- le decisioni, separate dal DOM ----------------------------------------
//
// Sono funzioni pure apposta: la regola del consenso e la costruzione degli
// argomenti sono le due cose che devono restare vere anche quando la palette
// verrà ridisegnata, e si provano senza un browser (`palette.test.ts`).

/// La query è una **sottosequenza** di questo testo? E quanto bene?
///
/// `null` se non lo è. Altrimenti un punteggio in cui **più basso è meglio**,
/// come il rango di `filterCommands`, perché i due si sommano: conta quanti
/// buchi ci sono fra un carattere trovato e il successivo, e da dove comincia il
/// primo. È ciò che fa vincere «nuova nota» su «rinomina» per la query `nn`
/// senza una tabella di casi speciali.
export function fuzzyScore(testo: string, query: string): number | null {
  const t = testo.toLowerCase();
  let i = 0;
  let punti = 0;
  let precedente = -1;
  for (const c of query) {
    const trovato = t.indexOf(c, i);
    if (trovato < 0) return null;
    // Un carattere attaccato al precedente non costa niente; uno lontano costa
    // la distanza. Il primo costa da dove comincia.
    punti += precedente < 0 ? trovato : trovato - precedente - 1;
    precedente = trovato;
    i = trovato + 1;
  }
  return punti;
}

/// I comandi che corrispondono a ciò che l'utente sta scrivendo, dai più
/// pertinenti ai meno.
///
/// Cerca anche nella **descrizione**: è il campo che la decisione 0010 ha aggiunto per i
/// chiamanti non umani, e si è rivelato utile anche qui — chi cerca «sostituisci
/// in blocco» non conosce il titolo esatto.
///
/// Il filtro è a **sottosequenza** (§18.2): `nn` trova «Nuova nota» e `csd`
/// trova «Cerca e sostituisci nel documento», che è ciò che chiunque abbia usato
/// una palette si aspetta e che il prefisso non sa fare. Il rango di prima non è
/// stato buttato — è diventato lo **spareggio**: prima i titoli che cominciano
/// con la query, poi quelli che la contengono, poi l'id, poi la prosa, e dentro
/// ciascuno di questi scaglioni vince chi ha la sottosequenza più compatta. Un
/// punteggio fuzzy solo avrebbe messo una corrispondenza sparsa nel titolo
/// davanti a una esatta nella descrizione, cioè avrebbe peggiorato il caso
/// comune per far funzionare quello raro.
export function filterCommands(entries: CommandEntry[], query: string): CommandEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  const rank = (entry: CommandEntry): [number, number] | null => {
    const title = entry.title.toLowerCase();
    if (title.startsWith(q)) return [0, 0];
    if (title.includes(q)) return [1, title.indexOf(q)];
    if (entry.id.toLowerCase().includes(q)) return [2, 0];
    if (entry.description.toLowerCase().includes(q)) return [3, 0];
    const sparso = fuzzyScore(entry.title, q);
    if (sparso !== null) return [4, sparso];
    const nell_id = fuzzyScore(entry.id, q);
    if (nell_id !== null) return [5, nell_id];
    return null;
  };
  return entries
    .map((entry) => ({ entry, r: rank(entry) }))
    .filter((x): x is { entry: CommandEntry; r: [number, number] } => x.r !== null)
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1])
    .map((x) => x.entry);
}

/// Questo comando va **mostrato prima di essere fatto**?
///
/// La regola sta qui e non nel kernel perché è una politica di chi invoca, e
/// una shell diversa (o una CLI in uno script) può averne un'altra. Il dato su
/// cui si decide invece è del contratto: il raggio dichiarato.
export function needsPlan(spec: CommandSpec): boolean {
  if (!spec.scope.writes) return false;
  // Ciò da cui non si torna indietro si guarda sempre prima, anche su una nota
  // sola.
  if (!spec.scope.reversible) return true;
  return spec.scope.reach !== "document";
}

/// Il raggio dichiarato, come **chiave** e non come parola.
///
/// Una tabella di stringhe a livello di modulo si sarebbe risolta all'import,
/// cioè una volta sola e nella lingua di quel momento: cambiare lingua avrebbe
/// lasciato la palette a parlare quella di prima, e non lo avrebbe detto
/// nessuno. Le chiavi non invecchiano; le parole sì.
const REACH_KEYS: Record<CommandSpec["scope"]["reach"], Chiave> = {
  session: "palette.reach.session",
  document: "palette.reach.document",
  documents: "palette.reach.documents",
  vault: "palette.reach.vault",
  settings: "palette.reach.settings",
};

/// Il raggio in una riga, per la palette: cosa tocca, e se si torna indietro.
export function scopeLabel(spec: CommandSpec): string {
  const dove = t(REACH_KEYS[spec.scope.reach]);
  const cosa = t(spec.scope.writes ? "palette.writes" : "palette.reads", { dove });
  return spec.scope.reversible ? cosa : t("palette.irreversible", { cosa });
}

/// Gli argomenti JSON a partire da ciò che l'utente ha compilato.
///
/// **Un parametro non obbligatorio lasciato com'era non si manda**, di
/// qualunque specie sia: assente e vuoto sono cose diverse (per `docs`, assente
/// = tutto il vault, elenco vuoto = nessuna nota), e la palette non ha modo di
/// esprimere la seconda — quindi dice la prima invece di inventare.
///
/// La regola è **questa riga**, e sta qui e non in un ramo per specie perché
/// era il ramo per specie a farla saltare: il booleano scriveva `false` anche
/// per una casella mai spuntata, cioè decideva al posto del comando. E a
/// decidere cosa succede quando un parametro facoltativo manca è il comando,
/// che è l'unico a saperlo — il contratto lo scrive accanto a
/// [`ParamSpec::required`], dove rifiuta esplicitamente di avere un default
/// («un default qui sarebbe una seconda verità accanto alla sua»).
///
/// [`ParamSpec::required`]: ../../../crates/fub-abi/src/command.rs
export function argsFromForm(
  spec: CommandSpec,
  raw: Record<string, string | boolean>,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const param of spec.params) {
    const letto = leggiParametro(param.kind, raw[param.name]);
    if (letto === null) continue;
    if (letto.vuoto && !param.required) continue;
    args[param.name] = letto.value;
  }
  return args;
}

/// Cosa c'è nel campo di questa specie, e se è **il suo vuoto**.
///
/// Le due cose insieme, e nessuna terza: chi aggiunge una specie di parametro
/// dice come si legge e cos'è il vuoto, e la regola di quando si manda la
/// eredita senza toccarla.
///
/// `null` = non si è letto niente di sensato — un numero che non è un numero —
/// e quello non si manda **mai**, nemmeno obbligatorio: un `NaN` al posto di un
/// argomento mancante toglie al comando l'unico errore che dice cosa manca.
function leggiParametro(
  kind: ParamKind,
  raw: string | boolean | undefined,
): { value: unknown; vuoto: boolean } | null {
  switch (kind.kind) {
    case "bool": {
      // Una casella non spuntata **è** il vuoto di un booleano: nella palette
      // non c'è modo di dire «falso per scelta» diverso da «lasciata com'era»,
      // e inventarne uno vorrebbe dire scrivere un default che non è nostro.
      const spuntata = raw === true || raw === "true";
      return { value: spuntata, vuoto: !spuntata };
    }
    case "number": {
      const testo = String(raw ?? "").trim();
      if (testo === "") return { value: 0, vuoto: true };
      const n = Number(testo);
      return Number.isNaN(n) ? null : { value: n, vuoto: false };
    }
    case "documents": {
      const ids = String(raw ?? "")
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return { value: ids, vuoto: ids.length === 0 };
    }
    case "numbers": {
      const pezzi = String(raw ?? "")
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      // Un pezzo che non è un numero bocca tutto, come il numero solo di prima:
      // un elenco quasi giusto al posto di uno mancante toglie al comando
      // l'errore che dice cosa manca (§23.4).
      if (pezzi.some((s) => Number.isNaN(Number(s)))) return null;
      return { value: pezzi.map(Number), vuoto: pezzi.length === 0 };
    }
    default: {
      // Un testo obbligatorio si manda com'è, anche vuoto: `replace: ""`
      // cancella le occorrenze, ed è una richiesta legittima. È il comando a
      // sapere se il vuoto ha senso per lui.
      const s = String(raw ?? "");
      return { value: s, vuoto: s === "" };
    }
  }
}

// Il riconoscimento di un accordo — `matchesBinding`, `findByChord` — sta in
// `ui/commands.ts` da quando la tastiera guarda l'unione dei due registri: era
// qui perché la palette era l'unico posto che sapesse cos'è una scorciatoia, e
// non lo è più.

/// Il piano in righe leggibili: il riassunto, poi una riga per nota.
export function planLines(plan: CommandPlan): string[] {
  const modifiche = new Map<string, number>();
  for (const p of plan.edits) {
    modifiche.set(p.doc, (modifiche.get(p.doc) ?? 0) + p.edit.edits.length);
  }
  return plan.docs.map((doc) => {
    const n = modifiche.get(doc);
    const nome = pageName(doc);
    if (n === undefined) return nome;
    return t("palette.plan_edits", { doc: nome, count: n });
  });
}

// --- la palette vera e propria ---------------------------------------------

const OVERLAY_ID = "command-palette";

/// Come si scioglie la trappola del fuoco della palette aperta.
let sciogliPalette: (() => void) | null = null;

export function closeCommandPalette() {
  document.getElementById(OVERLAY_ID)?.remove();
  sciogliPalette?.();
  sciogliPalette = null;
}

/// Apre la palette. Tre passi al più: scegli, compila, approva.
///
/// Le spec del kernel si rileggono **qui**: è il momento in cui costa nulla ed
/// è l'unico in cui devono essere fresche — un componente acceso mezzo minuto fa
/// ha comandi che nessuno ha ancora chiesto. Con loro si rileggono gli accordi
/// riconfigurati, perché sono la stessa domanda fatta all'altro canale.
export async function openCommandPalette(host: PaletteHost) {
  try {
    state.commandSpecs = await api.listCommands();
    await loadKeyOverrides();
  } catch (e) {
    host.notify(t("palette.unavailable", { reason: errorText(e) }));
    return;
  }
  scegli(allCommands(), apriOverlay(), host);
}

/// Fa partire **un** comando, saltando la scelta: è la via della scorciatoia.
///
/// Per un comando di shell è tutto qui — `run()` e basta, che è la ragione per
/// cui non si apre nessun overlay prima di sapere di chi è. Per uno del kernel i
/// passi dopo sono gli stessi della palette — parametri se ce ne sono, piano se
/// il raggio lo merita: una scorciatoia non è un permesso di saltare il
/// consenso.
export function startCommand(entry: CommandEntry, host: PaletteHost) {
  if (entry.run) {
    void entry.run();
    return;
  }
  avvia(entry, apriOverlay(), host);
}

function apriOverlay(): HTMLElement {
  closeCommandPalette();
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  // La forma sta in `.modale` e non più sull'id: da quando le modali sono due
  // (§21.4) l'aspetto di una modale è un fatto della shell, non una proprietà
  // della palette.
  overlay.className = "modale";
  // La palette è una modale a tutti gli effetti: copre lo schermo, chiede
  // qualcosa e se ne va. Dirlo è ciò che fa annunciare «finestra di dialogo» a
  // chi entra, invece di lasciarlo dentro un `div` sopra la pagina di prima —
  // che continua a leggere e a essere raggiungibile col tab.
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", t("palette.title"));
  overlay.tabIndex = -1;
  const box = document.createElement("div");
  box.className = "palette-box";
  overlay.appendChild(box);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeCommandPalette();
  });
  document.body.appendChild(overlay);
  // Dopo l'inserimento nel documento: `intrappolaFuoco` mette a fuoco il primo
  // elemento, e un elemento fuori dal documento non lo può prendere.
  sciogliPalette = intrappolaFuoco(overlay, closeCommandPalette);
  return box;
}

/// Passo 1: l'elenco filtrabile.
function scegli(specs: CommandEntry[], box: HTMLElement, host: PaletteHost) {
  box.innerHTML = "";
  const input = document.createElement("input");
  input.className = "palette-input";
  input.placeholder = t("palette.placeholder");
  const list = document.createElement("ul");
  list.className = "palette-list";
  box.append(input, list);

  let visibili = specs;
  let scelto = 0;

  const disegna = () => {
    visibili = filterCommands(specs, input.value);
    scelto = Math.min(scelto, Math.max(visibili.length - 1, 0));
    list.innerHTML = "";
    for (const [i, spec] of visibili.entries()) {
      const li = document.createElement("li");
      li.classList.toggle("selected", i === scelto);

      const riga = document.createElement("div");
      riga.className = "palette-row";
      const titolo = document.createElement("span");
      titolo.className = "palette-title";
      titolo.textContent = spec.title;
      riga.append(titolo);
      // Il raggio lo dichiara chi sta dall'altra parte del confine: un comando
      // di shell non tocca il vault, e una riga «legge la sessione» sotto
      // «Mostra il grafo» sarebbe una promessa fatta a nome di nessuno.
      if (spec.spec) {
        const raggio = document.createElement("span");
        raggio.className = "palette-scope";
        raggio.textContent = scopeLabel(spec.spec);
        riga.append(raggio);
      }
      // L'accordo **efficace**, non quello dichiarato: se l'utente l'ha
      // cambiato, la palette è il posto in cui lo scopre.
      if (spec.binding) {
        const kb = document.createElement("kbd");
        kb.textContent = spec.binding;
        riga.appendChild(kb);
      }

      const desc = document.createElement("div");
      desc.className = "palette-desc";
      desc.textContent = spec.description;

      li.append(riga, desc);
      li.addEventListener("click", () => avvia(spec, box, host));
      list.appendChild(li);
    }
    if (visibili.length === 0) {
      const vuoto = document.createElement("li");
      vuoto.className = "palette-empty";
      vuoto.textContent = t("palette.empty");
      list.appendChild(vuoto);
    }
  };

  input.addEventListener("input", () => {
    scelto = 0;
    disegna();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const passo = e.key === "ArrowDown" ? 1 : -1;
      scelto = (scelto + passo + visibili.length) % Math.max(visibili.length, 1);
      disegna();
      list.children[scelto]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      const spec = visibili[scelto];
      if (spec) avvia(spec, box, host);
    } else if (e.key === "Escape") {
      closeCommandPalette();
    }
  });

  disegna();
  input.focus();
}

/// Passo 2: i parametri, se il comando ne dichiara. Se non ne dichiara, si va
/// dritti all'esecuzione — la palette non inventa domande che nessuno ha fatto.
function avvia(entry: CommandEntry, box: HTMLElement, host: PaletteHost) {
  // Un comando di shell si fa e basta: non ha parametri da chiedere né un piano
  // da mostrare, perché non tocca il vault.
  if (entry.run) {
    closeCommandPalette();
    void entry.run();
    return;
  }
  const spec = entry.spec!;
  if (spec.params.length === 0) {
    void esegui(spec, {}, box, host);
    return;
  }
  compila(spec, box, host);
}

function compila(spec: CommandSpec, box: HTMLElement, host: PaletteHost) {
  box.innerHTML = "";
  const titolo = document.createElement("div");
  titolo.className = "palette-heading";
  titolo.textContent = spec.title;
  const desc = document.createElement("div");
  desc.className = "palette-desc";
  desc.textContent = spec.description;
  const form = document.createElement("form");
  form.className = "palette-form";
  box.append(titolo, desc, form);

  // I documenti del vault come suggerimenti dei campi che ne chiedono: la lista
  // ce l'ha già la shell, e un campo `document` senza di essa costringerebbe a
  // ricordarsi un path a memoria.
  const datalist = document.createElement("datalist");
  datalist.id = "palette-docs";
  if (spec.params.some((p) => p.kind.kind === "document" || p.kind.kind === "documents")) {
    void host.listDocuments().then((docs) => {
      for (const doc of docs) {
        const opt = document.createElement("option");
        opt.value = doc;
        datalist.appendChild(opt);
      }
    });
    form.appendChild(datalist);
  }

  const campi = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
  for (const param of spec.params) {
    const label = document.createElement("label");
    const nome = document.createElement("span");
    nome.className = "palette-label";
    nome.textContent = param.required ? t("palette.required", { title: param.title }) : param.title;
    label.appendChild(nome);
    const campo = campoPer(param, datalist.id);
    campi.set(param.name, campo);
    label.appendChild(campo);
    if (param.description) {
      const aiuto = document.createElement("span");
      aiuto.className = "palette-help";
      aiuto.textContent = param.description;
      label.appendChild(aiuto);
    }
    form.appendChild(label);
  }

  const azioni = document.createElement("div");
  azioni.className = "palette-actions";
  const conferma = document.createElement("button");
  conferma.type = "submit";
  conferma.className = "primary";
  conferma.textContent = t(needsPlan(spec) ? "palette.preview" : "app.run");
  const annulla = document.createElement("button");
  annulla.type = "button";
  annulla.textContent = t("app.cancel");
  annulla.addEventListener("click", closeCommandPalette);
  azioni.append(conferma, annulla);
  form.appendChild(azioni);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw: Record<string, string | boolean> = {};
    for (const [name, campo] of campi) {
      raw[name] =
        campo instanceof HTMLInputElement && campo.type === "checkbox"
          ? campo.checked
          : campo.value;
    }
    void esegui(spec, argsFromForm(spec, raw), box, host);
  });
  form.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCommandPalette();
  });

  (form.querySelector("input, select, textarea") as HTMLElement | null)?.focus();
}

function campoPer(
  param: ParamSpec,
  datalistId: string,
): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  switch (param.kind.kind) {
    case "bool": {
      const input = document.createElement("input");
      input.type = "checkbox";
      return input;
    }
    case "number": {
      const input = document.createElement("input");
      input.type = "number";
      return input;
    }
    case "choice": {
      const select = document.createElement("select");
      if (!param.required) select.appendChild(new Option("—", ""));
      for (const c of param.kind.value) select.appendChild(new Option(c.title, c.value));
      return select;
    }
    case "document": {
      const input = document.createElement("input");
      input.type = "text";
      input.setAttribute("list", datalistId);
      return input;
    }
    case "documents": {
      const area = document.createElement("textarea");
      area.rows = 3;
      area.placeholder = t("palette.docs_placeholder");
      return area;
    }
    case "numbers": {
      // Come i documenti, un elenco: la specie che chiede *queste* posizioni
      // (§23.4) non è un numero solo, e un campo solo lo scriverebbe male.
      const area = document.createElement("textarea");
      area.rows = 3;
      area.placeholder = t("palette.numbers_placeholder");
      return area;
    }
    default: {
      const input = document.createElement("input");
      input.type = "text";
      return input;
    }
  }
}

/// Passo 3: simula se serve, mostra il piano, e applica solo dopo un sì.
async function esegui(
  spec: CommandSpec,
  args: Record<string, unknown>,
  box: HTMLElement,
  host: PaletteHost,
) {
  // **Flush-before-patch** (M3): un comando che scrive documenti riscrive
  // file — il kernel muove i wikilink entranti, la rinomina sposta la nota — e
  // un buffer rimasto sporco li ricoprirebbe col testo di prima al salvataggio
  // successivo. È la stessa guardia di `nonInSalvo` dell'esploratore: si salva
  // prima di calcolare le patch, e se qualcosa non ce l'ha fatta l'operazione
  // si ferma qui, con la palette ancora aperta. I comandi di sola lettura non
  // toccano il disco e non devono pagare il giro.
  if (spec.scope.writes) {
    const appesi = await host.flushPendingSave();
    if (appesi.length > 0) {
      host.notify(t("document.unsaved_blocks", { doc: appesi.join(", ") }), "guasto");
      return;
    }
  }
  if (needsPlan(spec)) {
    try {
      const outcome = await api.invokeCommand(spec.id, args, "dry_run");
      if (outcome.effect.kind === "plan") {
        mostraPiano(spec, args, outcome.effect, box, host);
        return;
      }
      // Un comando che avrebbe dovuto dire cosa farebbe e ha fatto altro: si
      // consegna il suo esito e non si applica niente di nascosto.
      await consegna(outcome, host);
      closeCommandPalette();
      return;
    } catch (e) {
      fallito(e, box, host);
      return;
    }
  }
  try {
    const outcome = await api.invokeCommand(spec.id, args, "apply");
    closeCommandPalette();
    await consegna(outcome, host);
  } catch (e) {
    fallito(e, box, host);
  }
}

function mostraPiano(
  spec: CommandSpec,
  args: Record<string, unknown>,
  plan: CommandPlan,
  box: HTMLElement,
  host: PaletteHost,
) {
  box.innerHTML = "";
  const titolo = document.createElement("div");
  titolo.className = "palette-heading";
  titolo.textContent = spec.title;
  const riassunto = document.createElement("div");
  riassunto.className = "palette-summary";
  riassunto.textContent = plan.summary;
  box.append(titolo, riassunto);

  const lista = document.createElement("ul");
  lista.className = "palette-plan";
  for (const riga of planLines(plan)) {
    const li = document.createElement("li");
    li.textContent = riga;
    lista.appendChild(li);
  }
  box.appendChild(lista);

  const azioni = document.createElement("div");
  azioni.className = "palette-actions";
  const applica = document.createElement("button");
  applica.className = spec.scope.reversible ? "primary" : "danger";
  applica.textContent = t("palette.apply");
  applica.disabled = plan.docs.length === 0;
  applica.addEventListener("click", async () => {
    applica.disabled = true;
    try {
      const outcome = await api.invokeCommand(spec.id, args, "apply");
      closeCommandPalette();
      await consegna(outcome, host);
    } catch (e) {
      fallito(e, box, host);
    }
  });
  const annulla = document.createElement("button");
  annulla.textContent = t("app.cancel");
  annulla.addEventListener("click", closeCommandPalette);
  azioni.append(applica, annulla);
  box.appendChild(azioni);
  applica.focus();
}

async function consegna(outcome: CommandOutcome, host: PaletteHost) {
  // Un'operazione a metà si **vede** a metà (§23.14). Il `notify` lo dice già a
  // parole — «Note archiviate: 11 · Non spostate: …» — ma con lo stesso colore
  // di un successo pieno, e il colore è la cosa che si legge per prima: chi
  // scorre via un avviso verde non torna indietro a contare.
  //
  // Il tono lo decide il campo e non la frase, ed è tutta la differenza: prima
  // della §23.14 questa riga avrebbe dovuto cercare una parola dentro un
  // messaggio già tradotto per sapere com'era andata.
  if (outcome.notify) host.notify(outcome.notify, outcome.partial ? "guasto" : "info");
  await host.onEffect(outcome.effect);
}

/// Un comando che fallisce lo dice **dentro la palette**, che è dove l'utente
/// sta guardando: un errore in console sarebbe un comando che non ha fatto
/// niente in silenzio.
function fallito(e: unknown, box: HTMLElement, host: PaletteHost) {
  const messaggio = errorText(e);
  const errore = box.querySelector(".palette-error") ?? document.createElement("div");
  errore.className = "palette-error";
  errore.textContent = messaggio;
  box.appendChild(errore);
  host.notify(messaggio);
}

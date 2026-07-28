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
// (vedi `crates/fubmd-abi/src/command.rs`): il consenso è il giro
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
  ParamSpec,
} from "../host/contract";
import { pageName } from "../rules/organizer";
import { errorText } from "../host/errors";
import { intrappolaFuoco } from "./a11y";
import { type Chiave, t } from "../i18n/strings";

/// Ciò che la palette chiede alla shell: eseguire gli intenti e dire qualcosa
/// all'utente. Il resto (invocare, disegnare, chiedere) è suo.
export interface PaletteHost {
  onEffect(effect: CommandEffect): Promise<void> | void;
  notify(message: string): void;
  listDocuments(): Promise<string[]>;
}

// --- le decisioni, separate dal DOM ----------------------------------------
//
// Sono funzioni pure apposta: la regola del consenso e la costruzione degli
// argomenti sono le due cose che devono restare vere anche quando la palette
// verrà ridisegnata, e si provano senza un browser (`palette.test.ts`).

/// I comandi che corrispondono a ciò che l'utente sta scrivendo, dai più
/// pertinenti ai meno.
///
/// Cerca anche nella **descrizione**: è il campo che la decisione 0010 ha aggiunto per i
/// chiamanti non umani, e si è rivelato utile anche qui — chi cerca «sostituisci
/// in blocco» non conosce il titolo esatto.
export function filterCommands(specs: CommandSpec[], query: string): CommandSpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return specs;
  const rank = (spec: CommandSpec): number => {
    const title = spec.title.toLowerCase();
    if (title.startsWith(q)) return 0;
    if (title.includes(q)) return 1;
    if (spec.id.toLowerCase().includes(q)) return 2;
    if (spec.description.toLowerCase().includes(q)) return 3;
    return -1;
  };
  return specs
    .map((spec) => ({ spec, r: rank(spec) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r)
    .map((x) => x.spec);
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
/// Un campo lasciato vuoto di un parametro **non obbligatorio** non viene
/// mandato: assente e vuoto sono cose diverse (per `docs`, assente = tutto il
/// vault, elenco vuoto = nessuna nota), e la palette non ha modo di esprimere
/// la seconda — quindi dice la prima invece di inventare.
export function argsFromForm(
  spec: CommandSpec,
  raw: Record<string, string | boolean>,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const param of spec.params) {
    const value = raw[param.name];
    switch (param.kind.kind) {
      case "bool":
        args[param.name] = value === true || value === "true";
        break;
      case "number": {
        const n = Number(String(value ?? "").trim());
        if (String(value ?? "").trim() !== "" && !Number.isNaN(n)) args[param.name] = n;
        break;
      }
      case "documents": {
        const ids = String(value ?? "")
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (ids.length > 0) args[param.name] = ids;
        break;
      }
      default: {
        const s = String(value ?? "");
        // Un testo obbligatorio si manda com'è, anche vuoto: `replace: ""`
        // cancella le occorrenze, ed è una richiesta legittima. È il comando a
        // sapere se il vuoto ha senso per lui.
        if (s !== "" || param.required) args[param.name] = s;
        break;
      }
    }
  }
  return args;
}

/// I tasti premuti, come li descrive un evento della tastiera.
export interface KeyChord {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/// Questa combinazione è la scorciatoia dichiarata da un comando?
///
/// La sintassi è quella dei suggerimenti delle spec (`Mod-Shift-f`), dove `Mod`
/// è Ctrl o Cmd. Una scorciatoia **senza modificatori viene ignorata**: le spec
/// sono suggerimenti di chi scrive il comando, e un comando che dichiarasse `f`
/// ruberebbe una lettera a chi sta scrivendo una nota. Finché la tastiera non è
/// configurabile (§18.2) la shell onora ciò che può onorare senza fare danni.
export function matchesBinding(e: KeyChord, binding: string | null): boolean {
  if (!binding) return false;
  const parti = binding.split("-");
  const tasto = parti.pop();
  if (!tasto) return false;
  const mods = parti.map((p) => p.toLowerCase());
  if (mods.length === 0) return false;
  const mod = e.ctrlKey || e.metaKey;
  const vuole = (nome: string) => mods.includes(nome);
  return (
    e.key.toLowerCase() === tasto.toLowerCase() &&
    vuole("mod") === mod &&
    vuole("shift") === e.shiftKey &&
    vuole("alt") === e.altKey
  );
}

/// Il comando la cui scorciatoia dichiarata corrisponde, se ce n'è uno.
export function findByBinding(specs: CommandSpec[], e: KeyChord): CommandSpec | undefined {
  return specs.find((spec) => matchesBinding(e, spec.keybinding));
}

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
export async function openCommandPalette(host: PaletteHost) {
  let specs: CommandSpec[];
  try {
    specs = await api.listCommands();
  } catch (e) {
    host.notify(t("palette.unavailable", { reason: errorText(e) }));
    return;
  }
  scegli(specs, apriOverlay(), host);
}

/// Fa partire **un** comando, saltando la scelta: è la via della scorciatoia
/// dichiarata. I passi dopo sono gli stessi — parametri se ce ne sono, piano se
/// il raggio lo merita: una scorciatoia non è un permesso di saltare il
/// consenso.
export function startCommand(spec: CommandSpec, host: PaletteHost) {
  avvia(spec, apriOverlay(), host);
}

function apriOverlay(): HTMLElement {
  closeCommandPalette();
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
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
function scegli(specs: CommandSpec[], box: HTMLElement, host: PaletteHost) {
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
      const raggio = document.createElement("span");
      raggio.className = "palette-scope";
      raggio.textContent = scopeLabel(spec);
      riga.append(titolo, raggio);
      if (spec.keybinding) {
        const kb = document.createElement("kbd");
        kb.textContent = spec.keybinding;
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
function avvia(spec: CommandSpec, box: HTMLElement, host: PaletteHost) {
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
  if (outcome.notify) host.notify(outcome.notify);
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

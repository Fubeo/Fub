// La palette dei comandi: il primo cliente del registro (decisione 0009) nella shell.
//
// Non cabla nessun comando. Legge le spec dal kernel, disegna un campo per ogni
// parametro dichiarato e — quando il raggio dichiarato lo merita — chiede prima
// il **piano** e lo mostra, invece di executere e sperare. È la stessa sequenza
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
import { stableIdentifier, trapFocus } from "./a11y";
import type { Tone } from "./notify";
import { type Key, t } from "../i18n/strings";
import { allCommands, displayBinding, loadKeyOverrides, type CommandEntry } from "./commands";
import { enterSurface, exitSurface } from "./motion";
import { readState, state, writeState } from "../state/store";
import { invokeSlash, slashArgs, slashCandidates, slashContextDoc } from "../state/slash";
import { openLifetime, type Lifetime } from "./lifetime";

/// Ciò che la palette chiede alla shell: executere gli intenti, dire qualcosa
/// all'utente, e mettere in salvo i buffer prima di un comando che scrive. Il
/// resto (invocare, disegnare, chiedere) è suo.
export interface PaletteHost {
  onEffect(effect: CommandEffect): Promise<void> | void;
  // Il tono è **facoltativo e vuole essere passato**: un esito a metà non deve
  // avere lo stesso colore di uno riuscito, o l'unica differenza fra «dodici
  // note archiviate» e «undici su dodici, la dodicesima no» è una frase più
  // lunga che nessuno rilegge (§23.14).
  notify(message: string, tone?: Tone): void;
  listDocuments(): Promise<string[]>;
  // **Flush-before-patch** (M3): salva i documenti ancora sporchi e dice
  // quali non ce l'hanno fatta. È la stessa porta che l'esploratore usa per
  // `ensureSaved` — la palette la chiede alla shell invece di importare il
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
export function fuzzyScore(text: string, query: string): number | null {
  const t = text.toLowerCase();
  let i = 0;
  let points = 0;
  let previous = -1;
  for (const c of query) {
    const found = t.indexOf(c, i);
    if (found < 0) return null;
    // Un carattere attaccato al precedente non costa niente; uno lontano costa
    // la distanza. Il primo costa da dove comincia.
    points += previous < 0 ? found : found - previous - 1;
    previous = found;
    i = found + 1;
  }
  return points;
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
    const sparseTitle = fuzzyScore(entry.title, q);
    if (sparseTitle !== null) return [4, sparseTitle];
    const idScore = fuzzyScore(entry.id, q);
    if (idScore !== null) return [5, idScore];
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

/// Il piano si può applicare?
///
/// Per un comando che tocca note, un piano senza note è «niente da fare»: una
/// sostituzione senza occorrenze non merita un pulsante. Per chi agisce sul
/// vault, sulle impostazioni o sulla sessione — una cartella nuova, un
/// collegamento esterno, un valore di configurazione — l'elenco delle note è
/// vuoto per natura, e ciò che si approva è il sommario.
export function planApplies(spec: CommandSpec, plan: CommandPlan): boolean {
  if (plan.docs.length > 0) return true;
  return spec.scope.reach !== "document" && spec.scope.reach !== "documents";
}

/// Il raggio dichiarato, come **chiave** e non come parola.
///
/// Una tabella di stringhe a livello di modulo si sarebbe risolta all'import,
/// cioè una volta sola e nella lingua di quel momento: cambiare lingua avrebbe
/// lasciato la palette a parlare quella di prima, e non lo avrebbe detto
/// nessuno. Le chiavi non invecchiano; le parole sì.
const REACH_KEYS: Record<CommandSpec["scope"]["reach"], Key> = {
  session: "palette.reach.session",
  document: "palette.reach.document",
  documents: "palette.reach.documents",
  vault: "palette.reach.vault",
  settings: "palette.reach.settings",
};

/// Il raggio in una riga, per la palette: cosa tocca, e se si torna indietro.
export function scopeLabel(spec: CommandSpec): string {
  const where = t(REACH_KEYS[spec.scope.reach]);
  const thing = t(spec.scope.writes ? "palette.writes" : "palette.reads", { "dove": where });
  return spec.scope.reversible ? thing : t("palette.irreversible", { "cosa": thing });
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
    const read = readParameter(param.kind, raw[param.name]);
    if (read === null) continue;
    if (read.empty && !param.required) continue;
    args[param.name] = read.value;
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
function readParameter(
  kind: ParamKind,
  raw: string | boolean | undefined,
): { value: unknown; empty: boolean } | null {
  switch (kind.kind) {
    case "bool": {
      // Una casella non spuntata **è** il vuoto di un booleano: nella palette
      // non c'è modo di dire «falso per scelta» diverso da «lasciata com'era»,
      // e inventarne uno vorrebbe dire scrivere un default che non è nostro.
      const checked = raw === true || raw === "true";
      return { value: checked, empty: !checked };
    }
    case "number": {
      const text = String(raw ?? "").trim();
      if (text === "") return { value: 0, empty: true };
      const n = Number(text);
      return Number.isNaN(n) ? null : { value: n, empty: false };
    }
    case "documents": {
      const ids = String(raw ?? "")
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return { value: ids, empty: ids.length === 0 };
    }
    case "numbers": {
      const parts = String(raw ?? "")
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      // Un pezzo che non è un numero bocca tutto, come il numero solo di prima:
      // un elenco quasi giusto al posto di uno mancante toglie al comando
      // l'errore che dice cosa manca (§23.4).
      if (parts.some((s) => Number.isNaN(Number(s)))) return null;
      return { value: parts.map(Number), empty: parts.length === 0 };
    }
    default: {
      // Un testo obbligatorio si manda com'è, anche vuoto: `replace: ""`
      // cancella le occorrenze, ed è una richiesta legittima. È il comando a
      // sapere se il vuoto ha senso per lui.
      const s = String(raw ?? "");
      return { value: s, empty: s === "" };
    }
  }
}

// Il riconoscimento di un accordo — `matchesBinding`, `findByChord` — sta in
// `ui/commands.ts` da quando la tastiera guarda l'unione dei due registri: era
// qui perché la palette era l'unico posto che sapesse cos'è una scorciatoia, e
// non lo è più.

/// Il piano in righe leggibili: il riassunto, poi una riga per nota.
export function planLines(plan: CommandPlan): string[] {
  const changes = new Map<string, number>();
  for (const p of plan.edits) {
    changes.set(p.doc, (changes.get(p.doc) ?? 0) + p.edit.edits.length);
  }
  return plan.docs.map((doc) => {
    const n = changes.get(doc);
    const name = pageName(doc);
    if (n === undefined) return name;
    return t("palette.plan_edits", { doc: name, count: n });
  });
}
// --- recenti e preferiti (P06/F16), puri e senza DOM -------------------------
//
// La palette ricorda ciò che si è lanciato — non ciò che si è digitato — e
// propone in cima i recenti, poi i preferiti che esistono ancora. Le due
// liste vivono nello stato di vista della shell (chiave `palette`), con lo
// stesso tetto di lettura della cronologia note/ricerche: dieci voci che si
// guardano in un colpo d'occhio. I preferiti li sceglie la persona, i recenti
// li sceglie l'uso: mescolarli darebbe una lista che non si sa leggere.

/// Quanti comandi si ricordano, per elenco. Dieci come le recenti note/ricerche.
export const PALETTE_HISTORY_LIMIT = 10;

/// La forma persistita: due elenchi di id di comando, dalla più recente.
export interface PaletteHistory {
  recent: string[];
  favorites: string[];
}

/// Da JSON alle due liste, scartando ciò che non regge la forma. Severa come
/// `parseLayout` e `readLists`: il file lo si apre con un editor di testo, e
/// una voce non-stringa non deve arrivare fino al registro come se fosse un id.
export function parsePaletteHistory(v: unknown): PaletteHistory {
  const empty: PaletteHistory = { recent: [], favorites: [] };
  if (!v || typeof v !== "object") return empty;
  const o = v as Record<string, unknown>;
  const list = (x: unknown): string[] =>
    Array.isArray(x)
      ? x.filter((e): e is string => typeof e === "string" && e !== "").slice(0, PALETTE_HISTORY_LIMIT)
      : [];
  return { recent: list(o.recent), favorites: list(o.favorites) };
}

/// I comandi in ordine di proposta: prima i preferiti che esistono ancora
/// (nell'ordine scelto dalla persona), poi i recenti che esistono ancora e
/// non sono già preferiti, poi tutto il resto nell'ordine del registro.
/// Pura, per il banco: l'ordine del registro non si tocca, lo si attraversa.
export function orderCommands(entries: CommandEntry[], history: PaletteHistory): CommandEntry[] {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const out: CommandEntry[] = [];
  for (const id of history.favorites) {
    const entry = byId.get(id);
    if (entry && !seen.has(id)) {
      seen.add(id);
      out.push(entry);
    }
  }
  for (const id of history.recent) {
    const entry = byId.get(id);
    if (entry && !seen.has(id)) {
      seen.add(id);
      out.push(entry);
    }
  }
  for (const entry of entries) {
    if (!seen.has(entry.id)) out.push(entry);
  }
  return out;
}

// --- la palette vera e propria ---------------------------------------------

const OVERLAY_ID = "command-palette";
const LIST_ID = `${OVERLAY_ID}-list`;
const OPTION_ID_PREFIX = `${OVERLAY_ID}-option`;

/// Come si scioglie la trappola del fuoco della palette aperta.
let releasePalette: (() => void) | null = null;
let slashOwner: HTMLElement | null = null;
let slashLife: Lifetime | null = null;
let paletteGeneration = 0;
/// I recenti e i preferiti di questa macchina, come letti l'ultima volta.
/// Partono vuoti: `loadPaletteHistory` li rilegge all'apertura del vault.
let paletteHistory: PaletteHistory = { recent: [], favorites: [] };

/// Rilegge recenti e preferiti dal disco. Assente non è un errore: è il primo
/// avvio. Un valore che non regge la forma vale come nessun valore.
export async function loadPaletteHistory(): Promise<void> {
  paletteHistory = parsePaletteHistory(await readState<unknown>(PALETTE_KEY));
}

/// La memoria com'era all'ultimo lancio riuscito, per i banchi.
export function paletteHistoryForTest(): PaletteHistory {
  return paletteHistory;
}

/// Ricorda un lancio riuscito: la cosa in cima, senza doppioni, al tetto.
/// Pura la regola, impura la scrittura — come `rememberSearch`.
export function rememberCommand(id: string): void {
  paletteHistory = {
    recent: [id, ...paletteHistory.recent.filter((c) => c !== id)].slice(0, PALETTE_HISTORY_LIMIT),
    favorites: paletteHistory.favorites,
  };
  persistPaletteHistory();
}

/// Preferito o non più: la scelta della persona, non dell'uso. Torna il nuovo stato.
export function toggleFavorite(id: string): boolean {
  const favored = !paletteHistory.favorites.includes(id);
  paletteHistory = {
    recent: paletteHistory.recent,
    favorites: favored
      ? [...paletteHistory.favorites, id].slice(-PALETTE_HISTORY_LIMIT)
      : paletteHistory.favorites.filter((c) => c !== id),
  };
  persistPaletteHistory();
  return favored;
}

/// Solo per i banchi: rilegge la memoria senza toccare il disco.
export function setPaletteHistoryForTest(history: PaletteHistory): void {
  paletteHistory = parsePaletteHistory(history);
}

/// Mette via le due liste. Best effort come `writeState`: una memoria di
/// comandi non deve fermare un lancio.
function persistPaletteHistory(): void {
  writeState(
    PALETTE_KEY,
    paletteHistory.recent.length === 0 && paletteHistory.favorites.length === 0
      ? null
      : paletteHistory,
  );
}

/// La chiave dello stato di vista in cui la palette ricorda recenti e
/// preferiti. Il vault non entra nella chiave: lo mette lo store da sé.
/// Macchina e non vault: i comandi di shell esistono prima di ogni vault, e
/// la memoria è di chi guarda, non di ciò che si guarda.
export const PALETTE_KEY = "palette";

export function closeCommandPalette() {
  slashLife?.close();
  slashLife = null;
  slashOwner = null;
  paletteGeneration += 1;
  const overlay = document.getElementById(OVERLAY_ID);
  releasePalette?.();
  releasePalette = null;
  if (overlay) exitSurface(overlay, () => overlay.remove());
}

/// Apre la palette. Tre passi al più: scegli, compila, approva.
///
/// Le spec del kernel si rileggono **qui**: è il momento in cui costa nulla ed
/// è l'unico in cui devono essere fresche — un componente acceso mezzo minuto fa
/// ha comandi che nessuno ha ancora chiesto. Con loro si rileggono gli accordi
/// riconfigurati, perché sono la stessa domanda fatta all'altro canale.
export async function openCommandPalette(host: PaletteHost) {
  const generation = ++paletteGeneration;
  try {
    state.commandSpecs = await api.listCommands();
    await loadKeyOverrides();
  } catch (e) {
    if (generation !== paletteGeneration) return;
    host.notify(t("palette.unavailable", { reason: errorText(e) }));
    return;
  }
  if (generation !== paletteGeneration) return;
  chooseSpecs(orderCommands(allCommands(), paletteHistory), openOverlay(), host);
}

/// Slash shares the command registry, ordering, save queue and outcome delivery
/// with the palette. The editor supplies only its current buffer context; the
/// popup never stores a DOM offset or edits the buffer itself.
export async function openSlashPalette(
  owner: HTMLElement,
  selection: string,
  isCurrent: () => boolean,
  host: Pick<PaletteHost, "onEffect" | "notify" | "flushPendingSave"> & {
    publishContext(): Promise<void>;
  },
): Promise<void> {
  closeCommandPalette();
  slashOwner = owner;
  const generation = paletteGeneration;
  const life = openLifetime();
  slashLife = life;
  life.listen(document, "focusin", (event) => {
    const target = event.target;
    const overlay = document.getElementById(OVERLAY_ID);
    if (target instanceof Node && (owner.contains(target) || overlay?.contains(target))) return;
    closeSlashPalette(owner);
  });
  let specs: CommandSpec[];
  try {
    specs = await api.listCommands();
    await loadKeyOverrides();
  } catch (error) {
    if (generation === paletteGeneration) {
      host.notify(t("palette.unavailable", { reason: errorText(error) }), "guasto");
      closeSlashPalette(owner);
    }
    return;
  }
  if (generation !== paletteGeneration || !isCurrent()) {
    closeSlashPalette(owner);
    return;
  }
  state.commandSpecs = specs;
  const doc = slashContextDoc();
  const allowed = new Set(
    slashCandidates(specs)
      .filter((spec) => slashArgs(spec, selection, doc) !== null)
      .map((spec) => spec.id),
  );
  const entries = orderCommands(allCommands(), paletteHistory).filter((entry) => allowed.has(entry.id));
  const box = openOverlay(false);
  box.innerHTML = "";
  const input = document.createElement("input");
  input.className = "palette-input";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", t("palette.title"));
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-haspopup", "listbox");
  const list = document.createElement("ul");
  list.id = LIST_ID;
  list.className = "plain-list palette-list";
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t("palette.title"));
  input.setAttribute("aria-controls", LIST_ID);
  box.append(input, list);
  let visible = entries;
  let selected = 0;
  let busy = false;
  const render = () => {
    visible = filterCommands(entries, input.value);
    selected = Math.min(selected, Math.max(visible.length - 1, 0));
    list.replaceChildren();
    for (const [index, entry] of visible.entries()) {
      const item = document.createElement("li");
      item.id = stableIdentifier(OPTION_ID_PREFIX, entry.id);
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === selected));
      item.textContent = entry.title;
      item.dataset.commandId = entry.id;
      list.append(item);
    }
    if (visible.length) {
      input.setAttribute("aria-activedescendant", stableIdentifier(OPTION_ID_PREFIX, visible[selected]!.id));
    } else {
      input.removeAttribute("aria-activedescendant");
      const empty = document.createElement("li");
      empty.id = `${OPTION_ID_PREFIX}-empty`;
      empty.setAttribute("role", "option");
      empty.setAttribute("aria-disabled", "true");
      empty.setAttribute("aria-selected", "false");
      empty.className = "palette-empty";
      empty.textContent = t("palette.empty");
      list.append(empty);
    }
  };
  const current = () => isCurrent() && generation === paletteGeneration && slashOwner === owner;
  const returnToList = () => {
    if (!current()) return;
    box.replaceChildren(input, list);
    render();
    input.focus();
  };
  const run = async (entry: CommandEntry, args: Record<string, unknown>, approved = false) => {
    const spec = entry.spec;
    if (busy || !current() || !spec) return;
    busy = true;
    try {
      const result = await invokeSlash(
        spec, args, host.flushPendingSave, current, host.publishContext,
        needsPlan(spec) && !approved ? "dry_run" : "apply",
      );
      if (!current() || "cancelled" in result) return;
      if ("blocked" in result) {
        host.notify(t("document.unsaved_blocks", { doc: result.blocked.join(", ") }), "guasto");
        return;
      }
      if (!approved && needsPlan(spec) && result.outcome.effect.kind === "plan") {
        const plan = result.outcome.effect;
        const heading = document.createElement("div");
        heading.className = "palette-heading";
        heading.textContent = entry.title;
        const summary = document.createElement("div");
        summary.className = "palette-summary";
        summary.textContent = plan.summary;
        const details = document.createElement("ul");
        details.className = "plain-list palette-plan";
        for (const line of planLines(plan)) {
          const row = document.createElement("li");
          row.textContent = line;
          details.append(row);
        }
        const actions = document.createElement("div");
        actions.className = "palette-actions";
        const apply = document.createElement("button");
        apply.className = spec.scope.reversible ? "primary" : "danger";
        apply.textContent = t("palette.apply");
        apply.disabled = !planApplies(spec, plan);
        const cancel = document.createElement("button");
        cancel.textContent = t("app.cancel");
        cancel.addEventListener("click", returnToList);
        apply.addEventListener("click", () => void run(entry, args, true));
        actions.append(apply, cancel);
        box.replaceChildren(heading, summary, details, actions);
        apply.focus();
        return;
      }
      closeSlashPalette(owner);
      await deliverOutcome(result.outcome, host, entry.id);
    } catch (error) {
      if (current()) host.notify(errorText(error), "guasto");
    } finally {
      busy = false;
    }
  };
  const launch = (entry: CommandEntry) => {
    const spec = entry.spec;
    if (busy || !current() || !spec) return;
    const seed = slashArgs(spec, selection, doc);
    if (seed === null) return;
    // Offer every unfilled parameter, including optional format/date/template.
    // An editor selection never implies a UTF-8 byte offset.
    const missing = spec.params.filter((param) => !(param.name in seed));
    if (missing.length === 0) {
      void run(entry, seed);
      return;
    }
    const heading = document.createElement("div");
    heading.className = "palette-heading";
    heading.textContent = entry.title;
    const form = document.createElement("form");
    form.className = "palette-form";
    const fields = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
    for (const param of missing) {
      const label = document.createElement("label");
      const name = document.createElement("span");
      name.className = "palette-label";
      name.textContent = param.required ? t("palette.required", { title: param.title }) : param.title;
      const field = fieldFor(param, "palette-docs");
      if (param.required) field.required = true;
      fields.set(param.name, field);
      label.append(name, field);
      form.append(label);
    }
    const actions = document.createElement("div");
    actions.className = "palette-actions";
    const submit = document.createElement("button");
    submit.type = "submit";
    submit.className = "primary";
    submit.textContent = t(needsPlan(spec) ? "palette.preview" : "app.run");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = t("app.cancel");
    cancel.addEventListener("click", returnToList);
    actions.append(submit, cancel);
    form.append(actions);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!current()) return;
      const raw: Record<string, string | boolean> = {};
      for (const [name, field] of fields) {
        raw[name] = field instanceof HTMLInputElement && field.type === "checkbox"
          ? field.checked : field.value;
      }
      void run(entry, { ...seed, ...argsFromForm({ ...spec, params: missing }, raw) });
    });
    box.replaceChildren(heading, form);
    fields.values().next().value?.focus();
  };
  life.listen(list, "click", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-command-id]") : null;
    const entry = visible.find((candidate) => candidate.id === target?.dataset.commandId);
    if (entry) void launch(entry);
  });
  life.listen(input, "input", render);
  life.listen(input, "keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSlashPalette(owner);
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!visible.length) return;
      selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length;
      render();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = visible[selected];
      if (entry) void launch(entry);
    }
  });
  render();
  input.focus();
}

export function closeSlashPalette(owner: HTMLElement): void {
  if (slashOwner === owner) closeCommandPalette();
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
  start(entry, openOverlay(), host);
}

function openOverlay(closePrevious = true): HTMLElement {
  if (closePrevious) closeCommandPalette();
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    // La forma sta in `.modale` e non più sull'id: da quando le modali sono due
    // (§21.4) l'aspetto di una modale è un fatto della shell, non una proprietà
    // della palette.
    overlay.className = "modale";
    // La palette è una modale a tutti gli effetti: copre lo schermo, chiede
    // qualcosa e se ne va. Dirlo è ciò che fa annunciare «finestra di dialogo» a
    // chi entra, invece di lasciarlo dentro un `div` sopra la pagina di prima.
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.tabIndex = -1;
    const box = document.createElement("div");
    box.className = "palette-box";
    overlay.appendChild(box);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) closeCommandPalette();
    });
    document.body.appendChild(overlay);
  }
  overlay.setAttribute("aria-label", t("palette.title"));
  enterSurface(overlay);
  // Dopo l'inserimento nel documento: `intrappolaFuoco` mette a fuoco il primo
  // elemento, e un elemento fuori dal documento non lo può prendere.
  releasePalette = trapFocus(overlay, closeCommandPalette);
  return overlay.querySelector<HTMLElement>(".palette-box")!;
}

/// Passo 1: l'elenco filtrabile.
function chooseSpecs(specs: CommandEntry[], box: HTMLElement, host: PaletteHost) {
  box.innerHTML = "";
  // Etichetta di scope esplicita (U13): "Comandi" — non un generico "Cerca…":
  // qui si eseguono azioni, con disponibilità e consenso del comando (U19).
  const scope = document.createElement("p");
  scope.className = "palette-desc";
  scope.textContent = t("palette.title");
  const input = document.createElement("input");
  input.className = "palette-input";
  input.placeholder = t("palette.placeholder");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", t("palette.title"));
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-haspopup", "listbox");
  const list = document.createElement("ul");
  list.id = LIST_ID;
  list.className = "plain-list palette-list";
  // Una lista in cui una riga è «quella scelta» e le frecce la spostano è una
  // **listbox**, e finché non lo diceva la scelta esisteva solo come colore di
  // sfondo: chi non lo vede premeva Invio senza sapere su cosa.
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t("palette.title"));
  // La selezione resta sull'input; il popup non è una fermata del tab.
  list.tabIndex = -1;
  input.setAttribute("aria-controls", list.id);
  box.append(scope, input, list);

  let visibleItems = specs;
  let selected = 0;

  const render = () => {
    visibleItems = filterCommands(specs, input.value);
    selected = Math.min(selected, Math.max(visibleItems.length - 1, 0));
    list.replaceChildren();
    for (const [i, spec] of visibleItems.entries()) {
      const li = document.createElement("li");
      li.id = stableIdentifier(OPTION_ID_PREFIX, spec.id);
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === selected));

      const row = document.createElement("div");
      row.className = "palette-row";
      const title = document.createElement("span");
      title.className = "palette-title";
      title.textContent = spec.title;
      row.append(title);
      // Il raggio lo dichiara chi sta dall'altra parte del confine: un comando
      // di shell non tocca il vault, e una riga «legge la sessione» sotto
      // «Mostra il grafo» sarebbe una promessa fatta a nome di nessuno.
      if (spec.spec) {
        const radius = document.createElement("span");
        radius.className = "palette-scope";
        radius.textContent = scopeLabel(spec.spec);
        row.append(radius);
      }
      // L'accordo **efficace**, non quello dichiarato: se l'utente l'ha
      // cambiato, la palette è il posto in cui lo scopre.
      if (spec.binding) {
        const kb = document.createElement("kbd");
        kb.textContent = displayBinding(spec.binding);
        row.appendChild(kb);
      }
      // Il preferito si vede e si toglie da qui: una stella che resta
      // dov'è, senza una seconda superficie che deve restare d'accordo.
      const favored = paletteHistory.favorites.includes(spec.id);
      if (favored) {
        const star = document.createElement("span");
        star.className = "palette-favorite";
        star.textContent = "★";
        row.appendChild(star);
      }

      const desc = document.createElement("div");
      desc.className = "palette-desc";
      desc.textContent = spec.description;

      li.append(row, desc);
      li.addEventListener("click", (click) => {
        // Alt+click = preferito, click = lanciare: due gesti su due oggetti
        // diversi — la memoria e il comando — e il modificatore li separa senza
        // una seconda riga che diverge alla prima voce aggiunta.
        if (click.altKey) {
          click.preventDefault();
          click.stopPropagation();
          toggleFavorite(spec.id);
          render();
          return;
        }
        start(spec, box, host);
      });
      list.appendChild(li);
    }
    if (visibleItems.length === 0) {
      const empty = document.createElement("li");
      empty.id = `${OPTION_ID_PREFIX}-empty`;
      empty.className = "palette-empty";
      empty.setAttribute("role", "option");
      empty.setAttribute("aria-disabled", "true");
      empty.setAttribute("aria-selected", "false");
      empty.textContent = t("palette.empty");
      list.appendChild(empty);
      input.removeAttribute("aria-activedescendant");
    } else {
      input.setAttribute(
        "aria-activedescendant",
        stableIdentifier(OPTION_ID_PREFIX, visibleItems[selected]!.id),
      );
    }
  };

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (visibleItems.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      selected = (selected + step + visibleItems.length) % visibleItems.length;
      render();
      list.children[selected]?.scrollIntoView?.({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const spec = visibleItems[selected];
      // Alt+Invio = preferito, Invio = lanciare: stesso gesto del click,
      // stessa separazione — la memoria non passa dal piano né dai parametri.
      if (spec && e.altKey) {
        toggleFavorite(spec.id);
        render();
        return;
      }
      if (spec) start(spec, box, host);
    } else if (e.key === "Escape") {
      closeCommandPalette();
    }
  };
  input.addEventListener("keydown", handleKey);
  input.addEventListener("input", render);
  list.addEventListener("keydown", handleKey);

  render();
  input.focus();
}

/// Passo 2: i parametri, se il comando ne dichiara. Se non ne dichiara, si va
/// dritti all'esecuzione — la palette non inventa domande che nessuno ha fatto.
function start(entry: CommandEntry, box: HTMLElement, host: PaletteHost) {
  // Un comando di shell si fa e basta: non ha parametri da chiedere né un piano
  // da mostrare, perché non tocca il vault.
  if (entry.run) {
    closeCommandPalette();
    rememberCommand(entry.id);
    void entry.run();
    return;
  }
  const spec = entry.spec!;
  if (spec.params.length === 0) {
    void execute(spec, {}, box, host);
    return;
  }
  renderForm(spec, box, host);
}

function renderForm(spec: CommandSpec, box: HTMLElement, host: PaletteHost) {
  box.innerHTML = "";
  const title = document.createElement("div");
  title.className = "palette-heading";
  title.textContent = spec.title;
  const desc = document.createElement("div");
  desc.className = "palette-desc";
  desc.textContent = spec.description;
  const form = document.createElement("form");
  form.className = "palette-form";
  box.append(title, desc, form);

  // I documenti del vault come suggerimenti dei campi che ne chiedono: la lista
  // ce l'ha già la shell, e un campo `document` senza di essa costringerebbe a
  // ricordarsi un path a memoria.
  //
  // R06: la finestra da 200 non si allarga — resta un suggerimento, e il limite
  // è esplicito. Chi cerca un documento fuori finestra lo scrive per intero o
  // lo trova con "Vai alla nota" (query per nome esistente, nessuna anagrafe
  // intera in memoria).
  const datalist = document.createElement("datalist");
  datalist.id = "palette-docs";
  if (spec.params.some((p) => p.kind.kind === "document" || p.kind.kind === "documents")) {
    void host.listDocuments().then((docs) => {
      for (const doc of docs) {
        const opt = document.createElement("option");
        opt.value = doc;
        datalist.appendChild(opt);
      }
      const hint = document.createElement("p");
      hint.className = "palette-desc";
      hint.textContent = t("palette.docs_limited", { count: docs.length });
      form.appendChild(hint);
    });
    form.appendChild(datalist);
  }

  const fields = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
  for (const param of spec.params) {
    const label = document.createElement("label");
    const name = document.createElement("span");
    name.className = "palette-label";
    name.textContent = param.required ? t("palette.required", { title: param.title }) : param.title;
    label.appendChild(name);
    const field = fieldFor(param, datalist.id);
    fields.set(param.name, field);
    label.appendChild(field);
    if (param.description) {
      const help = document.createElement("span");
      help.className = "palette-help";
      help.textContent = param.description;
      label.appendChild(help);
    }
    form.appendChild(label);
  }

  const actions = document.createElement("div");
  actions.className = "palette-actions";
  const confirm = document.createElement("button");
  confirm.type = "submit";
  confirm.className = "primary";
  confirm.textContent = t(needsPlan(spec) ? "palette.preview" : "app.run");
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = t("app.cancel");
  cancel.addEventListener("click", closeCommandPalette);
  actions.append(confirm, cancel);
  form.appendChild(actions);

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw: Record<string, string | boolean> = {};
    for (const [name, field] of fields) {
      raw[name] =
        field instanceof HTMLInputElement && field.type === "checkbox"
          ? field.checked
          : field.value;
    }
    void execute(spec, argsFromForm(spec, raw), box, host);
  });
  form.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCommandPalette();
  });

  (form.querySelector("input, select, textarea") as HTMLElement | null)?.focus();
}

function fieldFor(
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
async function execute(
  spec: CommandSpec,
  args: Record<string, unknown>,
  box: HTMLElement,
  host: PaletteHost,
) {
  // **Flush-before-patch** (M3): un comando che scrive documenti riscrive
  // file — il kernel muove i wikilink entranti, la rinomina sposta la nota — e
  // un buffer rimasto sporco li ricoprirebbe col testo di prima al salvataggio
  // successivo. È la stessa guardia di `ensureSaved` dell'esploratore: si salva
  // prima di calcolare le patch, e se qualcosa non ce l'ha fatta l'operazione
  // si ferma qui, con la palette ancora aperta. I comandi di sola lettura non
  // toccano il disco e non devono pagare il giro.
  if (spec.scope.writes) {
    const pending = await host.flushPendingSave();
    if (pending.length > 0) {
      host.notify(t("document.unsaved_blocks", { doc: pending.join(", ") }), "guasto");
      return;
    }
  }
  if (needsPlan(spec)) {
    try {
      const outcome = await api.invokeCommand(spec.id, args, "dry_run");
      if (outcome.effect.kind === "plan") {
        showLayer(spec, args, outcome.effect, box, host);
        return;
      }
      // Un comando che avrebbe dovuto dire cosa farebbe e ha fatto altro: si
      // consegna il suo esito e non si applica niente di nascosto.
      await deliverOutcome(outcome, host, spec.id);
      closeCommandPalette();
      return;
    } catch (e) {
      failed(e, box, host);
      return;
    }
  }
  try {
    const outcome = await api.invokeCommand(spec.id, args, "apply");
    closeCommandPalette();
    await deliverOutcome(outcome, host, spec.id);
  } catch (e) {
    failed(e, box, host);
  }
}

function showLayer(
  spec: CommandSpec,
  args: Record<string, unknown>,
  plan: CommandPlan,
  box: HTMLElement,
  host: PaletteHost,
) {
  box.innerHTML = "";
  const title = document.createElement("div");
  title.className = "palette-heading";
  title.textContent = spec.title;
  const summary = document.createElement("div");
  summary.className = "palette-summary";
  summary.textContent = plan.summary;
  box.append(title, summary);

  const list = document.createElement("ul");
  list.className = "plain-list palette-plan";
  for (const row of planLines(plan)) {
    const li = document.createElement("li");
    li.textContent = row;
    list.appendChild(li);
  }
  box.appendChild(list);

  const actions = document.createElement("div");
  actions.className = "palette-actions";
  const apply = document.createElement("button");
  apply.className = spec.scope.reversible ? "primary" : "danger";
  apply.textContent = t("palette.apply");
  apply.disabled = !planApplies(spec, plan);
  apply.addEventListener("click", async () => {
    apply.disabled = true;
    try {
      const outcome = await api.invokeCommand(spec.id, args, "apply");
      closeCommandPalette();
      await deliverOutcome(outcome, host, spec.id);
    } catch (e) {
      failed(e, box, host);
    }
  });
  const cancel = document.createElement("button");
  cancel.textContent = t("app.cancel");
  cancel.addEventListener("click", closeCommandPalette);
  actions.append(apply, cancel);
  box.appendChild(actions);
  apply.focus();
}

async function deliverOutcome(
  outcome: CommandOutcome,
  host: Pick<PaletteHost, "onEffect" | "notify">,
  id?: string,
) {
  // Un'operazione a metà si **vede** a metà (§23.14). Il `notify` lo dice già a
  // parole — «Note archiviate: 11 · Non spostate: …» — ma con lo stesso colore
  // di un successo pieno, e il colore è la cosa che si legge per prima: chi
  // scorre via un avviso verde non torna indietro a contare.
  //
  // Il tono lo decide il campo e non la frase, ed è tutta la differenza: prima
  // della §23.14 questa riga avrebbe dovuto cercare una parola dentro un
  // messaggio già tradotto per sapere com'era andata.
  if (outcome.notify) host.notify(outcome.notify, outcome.partial ? "guasto" : "info");
  if (id) rememberCommand(id);
  await host.onEffect(outcome.effect);
}

/// Un comando che fallisce lo dice **dentro la palette**, che è dove l'utente
/// sta guardando: un errore in console sarebbe un comando che non ha fatto
/// niente in silenzio.
function failed(e: unknown, box: HTMLElement, host: PaletteHost) {
  const message = errorText(e);
  const error = box.querySelector(".palette-error") ?? document.createElement("div");
  error.className = "palette-error";
  error.textContent = message;
  box.appendChild(error);
  host.notify(message);
}

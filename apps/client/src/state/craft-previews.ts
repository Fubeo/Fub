// Le anteprime dei file Craft (N7): ciò che il bundle `fub.craft` risponde a
// `craft.preview` per un documento e una misura. La scheda chiede `large`, la
// figura nella nota e l'anteprima al passaggio `small`.
//
// Si tiene una risposta per documento e misura, con la revisione che dice; una
// domanda sola in volo per documento e misura. `craft.preview` non avvia mai
// niente: l'anteprima che fa l'app arriva col `job_done` del job
// `craft.render`, che si tiene come una risposta e si annuncia a chi guarda.
// Una risposta senza revisione (Fub ha letto solo dei pezzi del file) vale
// come appena letta. Un documento che cambia, si sposta o sparisce perde le
// sue risposte, e chi guarda lo sa e richiede; il vault che si chiude o
// cambia le fa dimenticare tutte, e così il consenso (`craft.cli-previews`)
// che cambia, perché ogni risposta lo porta con sé (`render.consent`).
//
// L'anteprima fatta dall'app si chiede soltanto con `renderPreview`, cioè
// con `craft_render` (T12), e soltanto dopo un gesto: la scheda nata da un
// gesto col consenso acceso, il pulsante, il «Sì» della domanda (T23). La
// risposta (`queued`) si tiene come quella di `previewOf`; due richieste per
// lo stesso documento e la stessa misura ne fanno partire una.
//
// Il modello è `state/link-cards.ts`: il montaggio ascolta il kernel per la
// finestra, chi mostra un'anteprima si iscrive con la sua `Lifetime`.

import { api } from "../host/ipc";
import type { CommandOutcome, KernelNotice } from "../host/contract";
import {
  CRAFT_BUNDLE_NS,
  CRAFT_PREVIEW_COMMAND,
  CRAFT_RENDER_JOB,
  readCraftPreview,
  type CraftPreview,
  type CraftPreviewSize,
} from "../host/craft";
import { isErrorKind } from "../host/errors";
import { mediaKindOfId } from "../editors/media/media-types";
import type { Lifetime } from "../ui/lifetime";
import { onAnyEvent } from "./kernel";
import { on, openVaultRoot, state, vaultArg } from "./store";

/// Ciò che si sa dell'anteprima di un documento a una misura.
export interface CraftPreviewAnswer {
  readonly preview: CraftPreview;
  /// L'errore del job `craft.render` che questa anteprima aspettava, se è
  /// finito male: la scheda lo dice.
  readonly renderError: unknown;
}

/// Chi guarda: riceve il documento le cui risposte sono cambiate.
type Watcher = (doc: string) => void;

let known = new Map<string, CraftPreviewAnswer>();
let inFlight = new Map<string, Promise<CraftPreviewAnswer | null>>();
/// Le richieste a `craft_render` in volo, per documento e misura.
let rendering = new Map<string, Promise<CraftPreviewAnswer | null>>();
const watchers = new Set<Watcher>();
/// Le domande partite con il vault di adesso: una risposta di un altro vault
/// non entra.
let generation = 0;
/// Quante volte ogni documento ha perso le sue risposte: una domanda partita
/// prima che il documento cambiasse non porta la revisione vecchia dopo.
let epochs = new Map<string, number>();
/// Quante volte il consenso è cambiato: una risposta chiesta prima porta il
/// consenso vecchio, e non si tiene.
let consents = 0;

/// L'impostazione del consenso, di T19.
export const CRAFT_CONSENT_SETTING = "craft.cli-previews";

function keyOf(doc: string, size: CraftPreviewSize): string {
  return `${doc}\u0000${size}`;
}

/// Il `CraftPreview` che l'effetto del comando porta, o `null` se l'effetto
/// non è del bundle o la forma non è quella del contratto.
export function readPreviewOutcome(outcome: CommandOutcome): CraftPreview | null {
  const effect = outcome.effect;
  if (effect.kind !== "custom" || effect.ns !== CRAFT_BUNDLE_NS) return null;
  return readCraftPreview(effect.payload);
}

/// Ciò che dice un `job_done` di `craft.render`: l'anteprima nuova, l'errore
/// (che non nomina il documento), o niente se il risultato non ha nessuna
/// delle due forme.
export function readRenderDone(result: unknown): { preview: CraftPreview } | { error: unknown } | null {
  if (!result || typeof result !== "object") return null;
  if ("Ok" in result) {
    const preview = readCraftPreview((result as { Ok: unknown }).Ok);
    return preview ? { preview } : null;
  }
  if ("Err" in result) return { error: (result as { Err: unknown }).Err };
  return null;
}

function announce(doc: string): void {
  for (const watcher of [...watchers]) {
    try {
      watcher(doc);
    } catch {
      // Chi guarda e sbaglia non toglie l'avviso agli altri.
    }
  }
}

/// Tiene una risposta, se non toglie ciò che si sa già di meglio: una
/// risposta «in coda» della stessa revisione non copre l'immagine che il job
/// ha già portato.
function keep(preview: CraftPreview, renderError: unknown = null): CraftPreviewAnswer {
  const key = keyOf(preview.doc, preview.size);
  const before = known.get(key);
  if (before && before.preview.revision === preview.revision && !preview.image) {
    if (before.preview.image) return before;
    // Una richiesta a `craft_render` è in coda: la risposta di
    // `craft.preview` della stessa revisione non lo sa, e non la copre. Il
    // `job_done` porta l'immagine o l'errore.
    if (before.preview.queued && !preview.queued && renderError === null) return before;
  }
  const answer: CraftPreviewAnswer = { preview, renderError };
  known.set(key, answer);
  return answer;
}

/// Una risposta che basta a chi chiede: della revisione che vuole, se ne
/// vuole una. Una risposta senza revisione è stata letta adesso, e vale per
/// ogni revisione.
function satisfies(answer: CraftPreviewAnswer, revision: string | undefined): boolean {
  return revision === undefined || answer.preview.revision === null || answer.preview.revision === revision;
}

async function ask(doc: string, size: CraftPreviewSize): Promise<CraftPreviewAnswer | null> {
  const vault = openVaultRoot();
  const asked = generation;
  const epoch = epochs.get(doc) ?? 0;
  const consent = consents;
  if (!vault) return null;
  const outcome = await api.invokeCommand(CRAFT_PREVIEW_COMMAND, { doc, size }, "apply", ...vaultArg(vault));
  if (asked !== generation) return null;
  if (epoch !== (epochs.get(doc) ?? 0) || consent !== consents) return previewOf(doc, size);
  const preview = readPreviewOutcome(outcome);
  // Una risposta che non è un'anteprima di questo documento è un host che
  // parla un'altra lingua: non si tiene.
  if (!preview || preview.doc !== doc || preview.size !== size) throw new Error(`craft.preview: risposta senza anteprima per ${doc}`);
  return keep(preview);
}

/// L'anteprima di `doc` alla misura `size`: quella tenuta, se basta, o una
/// domanda a `craft.preview`, che non avvia mai l'app. Con `revision` non si
/// accontenta di una risposta di un'altra revisione. `null` se nel frattempo
/// il vault è cambiato: la risposta non è più di nessuno. Un guasto del
/// comando rifiuta la promessa, e non si tiene.
export function previewOf(
  doc: string,
  size: CraftPreviewSize,
  options: { revision?: string } = {},
): Promise<CraftPreviewAnswer | null> {
  const flight = keyOf(doc, size);
  const seen = known.get(flight);
  if (seen && satisfies(seen, options.revision)) return Promise.resolve(seen);
  const pending = inFlight.get(flight);
  if (pending) return pending;
  const asking = ask(doc, size).finally(() => {
    if (inFlight.get(flight) === asking) inFlight.delete(flight);
  });
  inFlight.set(flight, asking);
  return asking;
}

async function render(doc: string, size: CraftPreviewSize): Promise<CraftPreviewAnswer | null> {
  const vault = openVaultRoot();
  const asked = generation;
  const epoch = epochs.get(doc) ?? 0;
  if (!vault) return null;
  let preview: CraftPreview;
  try {
    preview = await api.craftRender(doc, size, ...vaultArg(vault));
  } catch (error) {
    // `no_consent`: il consenso è cambiato da quando la scheda l'ha letto.
    // Le risposte tenute lo dicono vecchio; si dimenticano, e chi guarda
    // richiede e trova la domanda o la riga «spente».
    if (asked === generation && isErrorKind(error, "permission_denied")) reconsent();
    throw error;
  }
  if (asked !== generation) return null;
  // Il documento è cambiato nel frattempo: la risposta è di byte che non ci
  // sono più, e vale ciò che `craft.preview` dice adesso.
  if (epoch !== (epochs.get(doc) ?? 0)) return previewOf(doc, size);
  if (preview.doc !== doc || preview.size !== size) throw new Error(`craft.render: risposta senza anteprima per ${doc}`);
  const answer = keep(preview);
  announce(doc);
  return answer;
}

/// Chiede l'anteprima di `doc` alla misura `size` all'app, con
/// `craft_render`: soltanto dopo un gesto. La risposta si tiene come quella
/// di `previewOf` (di solito `queued`, e l'immagine arriva col `job_done`) e
/// si annuncia a chi guarda. Una richiesta già in volo, o una risposta già in
/// coda senza immagine, non ne fa partire un'altra. `null` se nel frattempo
/// il vault è cambiato. Un rifiuto (`no_consent`, nessuna CLI, il componente
/// spento) rifiuta la promessa; `no_consent` fa dimenticare le risposte.
export function renderPreview(doc: string, size: CraftPreviewSize): Promise<CraftPreviewAnswer | null> {
  const flight = keyOf(doc, size);
  const pending = rendering.get(flight);
  if (pending) return pending;
  const seen = known.get(flight);
  if (seen && seen.preview.queued && !seen.preview.image) return Promise.resolve(seen);
  const asking = render(doc, size).finally(() => {
    if (rendering.get(flight) === asking) rendering.delete(flight);
  });
  rendering.set(flight, asking);
  return asking;
}

/// Le estensioni dei documenti di cui un'app (WordCraft) fa l'anteprima:
/// `DOCUMENT_EXTENSIONS` in `crates/fub-format-craft/src/contract.rs`, che un
/// test tiene allineate.
export const DOCUMENT_EXTENSIONS: readonly string[] = ["docx", "odt", "rtf", "doc"];

/// Un PDF o un documento di Word, di cui l'anteprima la fa un'app (PdfCraft,
/// WordCraft); `null` per ogni altro file. Dall'estensione, in qualunque
/// maiuscola.
export function appPreviewSubject(doc: string): "pdf" | "document" | null {
  const path = doc.split("#")[0]!;
  if (mediaKindOfId(path) === "pdf") return "pdf";
  const base = path.split("/").pop() ?? "";
  const point = base.lastIndexOf(".");
  if (point <= 0) return null;
  return DOCUMENT_EXTENSIONS.includes(base.slice(point + 1).toLowerCase()) ? "document" : null;
}

/// Il componente «File delle app Craft» serve il vault: il kernel elenca
/// `craft.preview`. Spento, la scheda di un PDF o di un documento non chiede
/// anteprime a nessuno.
export function craftServed(): boolean {
  return state.commandSpecs.some((spec) => spec.id === CRAFT_PREVIEW_COMMAND);
}

/// Un PDF o un documento appena aperto con un gesto: se non ha l'anteprima
/// `small` e il consenso è acceso, la chiede all'app in sottofondo, così la
/// nota che lo incorpora e l'anteprima al passaggio la trovano. La scheda non
/// aspetta e non mostra niente; un guasto resta qui. Con il componente
/// `fub.craft` spento non chiede niente.
export async function renderOnOpen(doc: string): Promise<void> {
  if (appPreviewSubject(doc) === null || !craftServed()) return;
  const answer = await previewOf(doc, "small").catch(() => null);
  if (!answer) return;
  const { preview } = answer;
  if (preview.image || preview.queued || preview.render?.consent !== "on") return;
  await renderPreview(doc, "small").catch(() => null);
}

/// La risposta tenuta per `doc` e `size`, senza chiedere niente.
export function peekPreview(doc: string, size: CraftPreviewSize): CraftPreviewAnswer | null {
  return known.get(keyOf(doc, size)) ?? null;
}

/// Ascolta i cambi delle risposte finché `lifetime` è vivo: un'anteprima
/// arrivata da un job, un job finito male, un documento cambiato, il vault
/// che cambia (allora il documento è `""`, cioè tutti).
export function watchCraftPreviews(lifetime: Lifetime, watcher: Watcher): void {
  if (lifetime.closed) return;
  watchers.add(watcher);
  lifetime.add(() => watchers.delete(watcher));
}

/// Dimentica le risposte di `doc`, e lo dice.
function forget(doc: string): void {
  epochs.set(doc, (epochs.get(doc) ?? 0) + 1);
  let dropped = false;
  for (const key of [...known.keys()]) {
    if (key.slice(0, key.indexOf("\u0000")) !== doc) continue;
    known.delete(key);
    dropped = true;
  }
  for (const key of [...inFlight.keys()]) {
    if (key.slice(0, key.indexOf("\u0000")) === doc) inFlight.delete(key);
  }
  for (const key of [...rendering.keys()]) {
    if (key.slice(0, key.indexOf("\u0000")) === doc) rendering.delete(key);
  }
  if (dropped) announce(doc);
}

/// Il consenso è cambiato: ogni risposta tenuta porta quello vecchio. Si
/// dimenticano e chi guarda richiede. Restano quelle in coda: il job è
/// partito, e il suo esito arriva col `job_done` qualunque sia il consenso
/// adesso; così restano le richieste a `craft_render` in volo.
/// Il consenso è stato appena scritto da questa shell («No» della domanda):
/// le risposte tenute non lo dicono ancora. Lo stesso giro del
/// `setting_changed` che arriverà, e che allora non trova più niente.
export function forgetConsent(): void {
  reconsent();
}

function reconsent(): void {
  consents++;
  inFlight = new Map();
  let dropped = false;
  for (const [key, answer] of [...known]) {
    if (answer.preview.queued && !answer.preview.image) continue;
    known.delete(key);
    dropped = true;
  }
  if (dropped) announce("");
}

function clear(): void {
  generation++;
  inFlight = new Map();
  rendering = new Map();
  epochs = new Map();
  if (known.size === 0) return;
  known = new Map();
  announce("");
}

function heard(notice: KernelNotice): void {
  const event = notice.event;
  switch (event.type) {
    case "vault_opened":
    case "vault_closed":
      clear();
      return;
    case "document_changed":
    case "document_removed":
      forget(event.id);
      return;
    case "document_renamed":
      forget(event.from);
      forget(event.to);
      return;
    case "setting_changed":
      if (event.key === CRAFT_CONSENT_SETTING) reconsent();
      return;
    case "job_done":
      break;
    default:
      return;
  }
  if (event.job !== CRAFT_RENDER_JOB) return;
  const done = readRenderDone(event.result);
  if (!done) return;
  if ("preview" in done) {
    // Entra soltanto un'anteprima che qualcuno aspetta adesso: una richiesta
    // a `craft_render` in volo per la sua chiave, o una risposta tenuta della
    // stessa revisione. `forget` toglie le due cose: il `job_done` di un
    // render partito prima che il documento cambiasse è di byte che non ci
    // sono più, e non si prende come attuale.
    const key = keyOf(done.preview.doc, done.preview.size);
    const before = known.get(key);
    const current =
      rendering.has(key) ||
      (before !== undefined && (before.preview.revision === null || before.preview.revision === done.preview.revision));
    if (!current) return;
    keep(done.preview);
    announce(done.preview.doc);
    return;
  }
  // Un errore non dice il documento: vale per ogni anteprima che aspettava.
  const waiting = new Set<string>();
  for (const [key, answer] of known) {
    if (!answer.preview.queued || answer.preview.image) continue;
    known.set(key, { preview: { ...answer.preview, queued: false }, renderError: done.error });
    waiting.add(answer.preview.doc);
  }
  for (const doc of waiting) announce(doc);
}

/// Ascolta il kernel per le anteprime finché `lifetime` è vivo: gli esiti di
/// `craft.render`, i documenti che cambiano, il vault che cambia.
export function mountCraftPreviews(lifetime: Lifetime): void {
  lifetime.add(onAnyEvent(heard));
  lifetime.add(on("vault", clear));
  lifetime.add(clear);
}

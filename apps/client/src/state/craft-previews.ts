// Le anteprime dei file Craft (N7): ciò che il bundle `fub.craft` risponde a
// `craft.preview` per un documento e una misura. La scheda chiede `large`, la
// figura nella nota e l'anteprima al passaggio `small`.
//
// Si tiene una risposta per documento e misura, con la revisione che dice; una
// domanda sola in volo per documento, misura e `render`. Con `render: true` il
// bundle può mettere in coda il job `craft.render`: la risposta dice `queued`,
// e l'anteprima nuova arriva col `job_done` del job, che si tiene come una
// risposta e si annuncia a chi guarda. Un documento che cambia, si sposta o
// sparisce perde le sue risposte, e chi guarda lo sa e richiede; il vault che
// si chiude o cambia le fa dimenticare tutte.
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
import type { Lifetime } from "../ui/lifetime";
import { onAnyEvent } from "./kernel";
import { on, openVaultRoot, vaultArg } from "./store";

/// Ciò che si sa dell'anteprima di un documento a una misura.
export interface CraftPreviewAnswer {
  readonly preview: CraftPreview;
  /// L'errore del job `craft.render` che questa anteprima aspettava, se è
  /// finito male: la scheda lo dice e rimette il pulsante.
  readonly renderError: unknown;
}

/// Chi guarda: riceve il documento le cui risposte sono cambiate.
type Watcher = (doc: string) => void;

let known = new Map<string, CraftPreviewAnswer>();
let inFlight = new Map<string, Promise<CraftPreviewAnswer | null>>();
const watchers = new Set<Watcher>();
/// Le domande partite con il vault di adesso: una risposta di un altro vault
/// non entra.
let generation = 0;
/// Quante volte ogni documento ha perso le sue risposte: una domanda partita
/// prima che il documento cambiasse non porta la revisione vecchia dopo.
let epochs = new Map<string, number>();
/// Le domande con `render: true` in volo, con l'errore di un job finito male
/// prima che la loro risposta arrivasse: il job può finire prima, e il suo
/// errore non nomina il documento.
let renderAsks = new Map<string, { error: unknown } | null>();

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
  if (before && before.preview.revision === preview.revision && before.preview.image && !preview.image) return before;
  const answer: CraftPreviewAnswer = { preview, renderError };
  known.set(key, answer);
  return answer;
}

/// Una risposta che basta a chi chiede: della revisione che vuole (se ne
/// vuole una) e, se chiede di fare l'anteprima, già con l'immagine o già in
/// coda.
function satisfies(answer: CraftPreviewAnswer, render: boolean, revision: string | undefined): boolean {
  if (revision !== undefined && answer.preview.revision !== revision) return false;
  if (!render) return true;
  const preview = answer.preview;
  return preview.image !== null || preview.queued || preview.render === null;
}

async function ask(doc: string, size: CraftPreviewSize, render: boolean): Promise<CraftPreviewAnswer | null> {
  const vault = openVaultRoot();
  const asked = generation;
  const epoch = epochs.get(doc) ?? 0;
  if (!vault) return null;
  const key = keyOf(doc, size);
  if (render) renderAsks.set(key, null);
  let outcome: CommandOutcome;
  let early: { error: unknown } | null = null;
  try {
    outcome = await api.invokeCommand(CRAFT_PREVIEW_COMMAND, { doc, size, render }, "apply", ...vaultArg(vault));
  } finally {
    if (render) {
      early = renderAsks.get(key) ?? null;
      renderAsks.delete(key);
    }
  }
  if (asked !== generation) return null;
  if (epoch !== (epochs.get(doc) ?? 0)) return previewOf(doc, size, { render });
  const preview = readPreviewOutcome(outcome);
  // Una risposta che non è un'anteprima di questo documento è un host che
  // parla un'altra lingua: non si tiene.
  if (!preview || preview.doc !== doc || preview.size !== size) throw new Error(`craft.preview: risposta senza anteprima per ${doc}`);
  if (early && preview.queued && !preview.image) return keep({ ...preview, queued: false }, early.error);
  return keep(preview);
}

/// L'anteprima di `doc` alla misura `size`: quella tenuta, se basta, o una
/// domanda a `craft.preview`. Con `render` chiede di farla all'app quando il
/// file non ne ha una; con `revision` non si accontenta di una risposta di
/// un'altra revisione. `null` se nel frattempo il vault è cambiato: la
/// risposta non è più di nessuno. Un guasto del comando rifiuta la promessa,
/// e non si tiene.
export function previewOf(
  doc: string,
  size: CraftPreviewSize,
  options: { render?: boolean; revision?: string } = {},
): Promise<CraftPreviewAnswer | null> {
  const render = options.render === true;
  const seen = known.get(keyOf(doc, size));
  if (seen && satisfies(seen, render, options.revision)) return Promise.resolve(seen);
  const flight = `${keyOf(doc, size)}\u0000${render ? "render" : "read"}`;
  const pending = inFlight.get(flight);
  if (pending) return pending;
  const asking = ask(doc, size, render).finally(() => {
    if (inFlight.get(flight) === asking) inFlight.delete(flight);
  });
  inFlight.set(flight, asking);
  return asking;
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
  if (dropped) announce(doc);
}

function clear(): void {
  generation++;
  inFlight = new Map();
  epochs = new Map();
  renderAsks = new Map();
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
    case "job_done":
      break;
    default:
      return;
  }
  if (event.job !== CRAFT_RENDER_JOB) return;
  const done = readRenderDone(event.result);
  if (!done) return;
  if ("preview" in done) {
    // Un'anteprima di un documento che nessuno ha chiesto entra lo stesso: è
    // del vault di adesso, e la prossima domanda la trova.
    keep(done.preview);
    announce(done.preview.doc);
    return;
  }
  // Un errore non dice il documento: vale per ogni anteprima che aspettava.
  const waiting = new Set<string>();
  for (const key of renderAsks.keys()) renderAsks.set(key, { error: done.error });
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

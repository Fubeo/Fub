// I dati di LightCraft sulle foto (N7): ciò che il bundle `fub.craft`
// risponde a `craft.photo` per una foto, cioè l'XMP accanto a lei e ciò che
// dice. La riga sotto la foto (`editors/craft/photo-data.ts`) li mostra.
//
// Si tiene una risposta per foto, e una domanda sola in volo per foto. La
// risposta si dimentica quando cambia, si sposta o sparisce la foto o uno dei
// suoi due candidati XMP (`IMG.jpg.xmp`, `IMG.xmp`: la regola di
// `xmp::sidecar_candidates`, coi nomi così come sono scritti), così un XMP
// salvato da LightCraft, o creato dopo, arriva alla riga che guarda. Il vault
// che si chiude o cambia, e il componente che si accende o si spegne, fanno
// dimenticare tutto. Una domanda partita prima che la foto cambiasse non
// porta la risposta vecchia dopo.
//
// Fub legge soltanto: `craft.photo` non scrive mai l'XMP. Il modello è
// `state/craft-previews.ts`: il montaggio ascolta il kernel per la finestra,
// chi mostra i dati si iscrive con la sua `Lifetime`.

import { api } from "../host/ipc";
import type { CommandOutcome, KernelNotice } from "../host/contract";
import { asPluginError } from "../host/errors";
import { CRAFT_BUNDLE_NS, CRAFT_PHOTO_COMMAND, readPhotoSidecar, type CraftPhotoSidecar } from "../host/craft";
import { mediaKindOfId } from "../editors/media/media-types";
import { isRawPhoto } from "../ui/format-kind";
import type { Lifetime } from "../ui/lifetime";
import { onAnyEvent } from "./kernel";
import { on, openVaultRoot, state, vaultArg } from "./store";

/// Chi guarda una foto: lo si chiama quando la sua risposta non vale più.
type Watcher = () => void;

let known = new Map<string, CraftPhotoSidecar>();
let inFlight = new Map<string, Promise<CraftPhotoSidecar | null>>();
/// Le foto guardate, ognuna con chi la guarda.
const watching = new Map<string, Set<Watcher>>();
/// Le domande partite con il vault di adesso: una risposta di un altro vault
/// non entra.
let generation = 0;
/// Quante volte ogni foto ha perso la sua risposta.
let epochs = new Map<string, number>();
/// Se il kernel serviva `craft.photo` l'ultima volta che si è guardato.
let served = false;

/// Il kernel serve `craft.photo`: il componente «File delle app Craft» è
/// acceso. Spento, nessuna foto chiede niente.
export function craftPhotosServed(): boolean {
  return state.commandSpecs.some((spec) => spec.id === CRAFT_PHOTO_COMMAND);
}

/// Un documento che può avere l'XMP di LightCraft accanto: una foto che la
/// shell mostra, o una foto RAW. Un PDF, un audio, una nota o un XMP non lo
/// è.
export function isPhotoDoc(doc: string): boolean {
  return mediaKindOfId(doc) === "image" || isRawPhoto(doc);
}

/// I due nomi possibili dell'XMP di `doc`, come `xmp::sidecar_candidates`:
/// il nome intero più `.xmp`, poi il nome senza l'ultima estensione più
/// `.xmp`. Un nome senza estensione ha solo il primo.
export function sidecarCandidates(doc: string): string[] {
  const slash = doc.lastIndexOf("/");
  const point = doc.lastIndexOf(".");
  const candidates = [`${doc}.xmp`];
  if (point > slash + 1) candidates.push(`${doc.slice(0, point)}.xmp`);
  return candidates;
}

/// Il `CraftPhotoSidecar` che l'effetto del comando porta, o `null` se
/// l'effetto non è del bundle o la forma non è quella del contratto.
export function readPhotoOutcome(outcome: CommandOutcome): CraftPhotoSidecar | null {
  const effect = outcome.effect;
  if (effect.kind !== "custom" || effect.ns !== CRAFT_BUNDLE_NS) return null;
  return readPhotoSidecar(effect.payload);
}

async function ask(doc: string): Promise<CraftPhotoSidecar | null> {
  const vault = openVaultRoot();
  const asked = generation;
  const epoch = epochs.get(doc) ?? 0;
  if (!vault) return null;
  let outcome: CommandOutcome;
  try {
    outcome = await api.invokeCommand(CRAFT_PHOTO_COMMAND, { doc }, "apply", ...vaultArg(vault));
  } catch (error) {
    // La foto che il vault non ha più, o il componente spento nel
    // frattempo: non ci sono dati da mostrare. Ogni altro guasto rifiuta.
    const kind = asPluginError(error)?.kind;
    if (kind === "not_found" || kind === "unknown_command") return null;
    throw error;
  }
  if (asked !== generation) return null;
  if (epoch !== (epochs.get(doc) ?? 0)) return photoOf(doc);
  const sidecar = readPhotoOutcome(outcome);
  // Una risposta che non è di questa foto è un host che parla un'altra
  // lingua: non si tiene.
  if (!sidecar || sidecar.doc !== doc) throw new Error(`craft.photo: risposta senza dati per ${doc}`);
  known.set(doc, sidecar);
  return sidecar;
}

/// I dati dell'XMP accanto a `doc`: quelli tenuti, o una domanda a
/// `craft.photo`, che legge soltanto. `null` senza domanda se `doc` non è
/// una foto o il componente è spento; `null` anche se la foto non c'è più o
/// il vault è cambiato nel frattempo. Un guasto del comando rifiuta la
/// promessa, e non si tiene.
export function photoOf(doc: string): Promise<CraftPhotoSidecar | null> {
  if (!isPhotoDoc(doc) || !craftPhotosServed()) return Promise.resolve(null);
  const seen = known.get(doc);
  if (seen) return Promise.resolve(seen);
  const pending = inFlight.get(doc);
  if (pending) return pending;
  const asking = ask(doc).finally(() => {
    if (inFlight.get(doc) === asking) inFlight.delete(doc);
  });
  inFlight.set(doc, asking);
  return asking;
}

/// La risposta tenuta per `doc`, senza chiedere niente.
export function peekPhoto(doc: string): CraftPhotoSidecar | null {
  return known.get(doc) ?? null;
}

/// Guarda `doc` finché `lifetime` è vivo: `watcher` si chiama quando la sua
/// risposta non vale più (la foto o un suo XMP è cambiato, il vault o il
/// componente pure), e chi guarda richiede.
export function watchPhoto(doc: string, lifetime: Lifetime, watcher: Watcher): void {
  if (lifetime.closed) return;
  let set = watching.get(doc);
  if (!set) watching.set(doc, (set = new Set()));
  set.add(watcher);
  lifetime.add(() => {
    const current = watching.get(doc);
    if (!current) return;
    current.delete(watcher);
    if (current.size === 0) watching.delete(doc);
  });
}

function announce(doc: string): void {
  for (const watcher of [...(watching.get(doc) ?? [])]) {
    try {
      watcher();
    } catch {
      // Chi guarda e sbaglia non toglie l'avviso agli altri.
    }
  }
}

/// Dimentica la risposta di `doc`, e lo dice a chi la guarda.
function forget(doc: string): void {
  epochs.set(doc, (epochs.get(doc) ?? 0) + 1);
  known.delete(doc);
  inFlight.delete(doc);
  announce(doc);
}

/// Il documento `id` è cambiato: le foto che sono `id`, o che hanno `id` fra
/// i loro candidati, perdono la risposta. Si guardano le foto che si
/// conoscono, che si chiedono o che qualcuno guarda.
function touched(id: string): void {
  const photos = new Set([...known.keys(), ...inFlight.keys(), ...watching.keys()]);
  for (const photo of photos) {
    if (photo === id || sidecarCandidates(photo).includes(id)) forget(photo);
  }
}

/// Dimentica tutto, senza dirlo: le domande in volo non entrano più.
function reset(): void {
  generation++;
  inFlight = new Map();
  epochs = new Map();
  known = new Map();
}

/// Dimentica tutto, e lo dice a ogni foto guardata.
function clear(): void {
  reset();
  for (const doc of [...watching.keys()]) announce(doc);
}

function heard(notice: KernelNotice): void {
  const event = notice.event;
  switch (event.type) {
    case "vault_opened":
    case "vault_closed":
      clear();
      return;
    // Una foto è di solito una risorsa, non un documento: i suoi eventi sono
    // `entry_*`. L'XMP, col componente acceso, è un documento.
    case "document_changed":
    case "document_removed":
    case "entry_changed":
    case "entry_removed":
      touched(event.id);
      return;
    case "document_renamed":
    case "entry_renamed":
      touched(event.from);
      touched(event.to);
      return;
    default:
      return;
  }
}

/// I comandi del kernel sono cambiati: se `craft.photo` è comparso o sparito,
/// ogni risposta si dimentica e chi guarda richiede.
function commandsChanged(): void {
  const now = craftPhotosServed();
  if (now === served) return;
  served = now;
  clear();
}

/// Ascolta il kernel per i dati delle foto finché `lifetime` è vivo: i
/// documenti che cambiano, il vault che cambia, i comandi che cambiano.
export function mountCraftPhotos(lifetime: Lifetime): void {
  served = craftPhotosServed();
  lifetime.add(onAnyEvent(heard));
  lifetime.add(on("vault", clear));
  lifetime.add(on("commands", commandsChanged));
  lifetime.add(reset);
}

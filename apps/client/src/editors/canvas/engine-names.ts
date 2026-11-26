// Il motore della lavagna: gli aiuti dopo la classe (le toppe, i nomi delle
// schede e delle note nuove, i link delle schede). Tolti da `engine.ts`.

import { t } from "../../i18n/strings";
import { lineFeeds, operationFromText, type TextOperation } from "../core/text-operation";
import { searchedName } from "../../rules/searched-name";
import { textCardName } from "./card-name";
import { cardTitle } from "./a11y";
import { type CanvasParts } from "./parts";
import { cardTarget } from "./sources";
import { noteHeadingOf } from "../core/cards/kinds/note";
import { noteExcerptOf } from "./excerpt";
import { type CanvasPatch, type InkPatch } from "./operation";
import { type CanvasNode } from "./model";
import { CanvasCoreError, type CanvasIntentOp, type CanvasSourceEdit } from "./wasm/core";
import { composingKey } from "../../kit/ime";
import { CardLinkRef } from "./engine-options";
import { CanvasStep, PendingText } from "./engine-parts";
import { externalUrl } from "./engine-geometry";

/**
 * La `set` che porta la scheda o il filo `before` a `after` (lo stesso id):
 * i campi cambiati col valore nuovo, quelli tolti a `null`. `null` se non
 * cambia niente. Un valore uguale scritto con le chiavi in un altro ordine
 * entra lo stesso: il nucleo lo trova uguale, e non ne fa una toppa.
 */
export function setOp<T extends { readonly id: string }>(before: T, after: T): CanvasIntentOp | null {
  const was = before as unknown as Record<string, unknown>;
  const now = after as unknown as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(now)) {
    if (key !== "id" && JSON.stringify(was[key]) !== JSON.stringify(value)) fields[key] = value === undefined ? null : value;
  }
  for (const key of Object.keys(was)) {
    if (!(key in now) && key !== "id") fields[key] = null;
  }
  return Object.keys(fields).length > 0 ? { op: "set", id: before.id, fields } : null;
}

/**
 * La scheda `card` col testo in sospeso dentro, e la misura a cui è cresciuta
 * scrivendo (T44): mai più piccola di com'è adesso.
 */
export function withPending(card: CanvasNode, pending: PendingText): CanvasNode {
  const next = { ...card };
  next[pending.field] = pending.text;
  if (pending.size) {
    next.width = Math.max(next.width, pending.size.width);
    next.height = Math.max(next.height, pending.size.height);
  }
  return next;
}

/** Le toppe dei tratti fra quelle compilate: le operazioni d'inchiostro danno solo quelle. */
export function inkPatches(patches: readonly CanvasPatch[]): InkPatch[] {
  return patches.filter((patch): patch is InkPatch => patch.kind === "ink");
}

/** Una copia delle toppe, che chi le ha date può ancora cambiare. */
export function copyPatches(patches: readonly CanvasPatch[]): CanvasPatch[] {
  return JSON.parse(JSON.stringify(patches)) as CanvasPatch[];
}

/**
 * Due passi di fila in uno: `first` ha portato il testo da `before` a un
 * testo di mezzo, `second` da quello ad `after`. Le toppe si fanno in fila
 * (le inverse al contrario); il tratto del testo è la parte che cambia fra
 * `before` e `after`, senza spezzare una coppia surrogata.
 */
export function mergeSteps(before: string, first: CanvasStep, second: CanvasStep, after: string): CanvasStep {
  const shorter = Math.min(before.length, after.length);
  let start = 0;
  while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore--;
    endAfter--;
  }
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--;
  // Il tratto finale si allarga di un'unità in tutti e due i testi, che lì sono uguali.
  if (endBefore < before.length && isLowSurrogate(before.charCodeAt(endBefore))) {
    endBefore++;
    endAfter++;
  }
  return {
    patches: [...second.patches, ...first.patches],
    back: [...first.back, ...second.back],
    start,
    inserted: after.slice(start, endAfter),
    removed: before.slice(start, endBefore),
    version: second.version,
    restores: first.restores,
  };
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

/** I tasti con Ctrl (Cmd) che scrivono in un campo: restano sempre al campo. */
const FIELD_CHORDS: ReadonlySet<string> = new Set(["a", "c", "v", "x", "y", "z"]);

/**
 * Un tasto premuto nel campo di una scheda che sale alla shell: ha Ctrl (o
 * Cmd), il campo non l'ha usato (`defaultPrevented`), non è Invio (la scheda
 * dopo, T44) né un tasto che scrive (scegli tutto, copia, incolla, taglia,
 * annulla, ripeti). Ctrl+W chiude la linguetta anche mentre si scrive.
 */
export function passesToShell(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.defaultPrevented || composingKey(event)) return false;
  if (event.key === "Enter" || event.key === "Escape") return false;
  return !FIELD_CHORDS.has(event.key.toLowerCase());
}

/** Una trappola o un'istanza persa: il nucleo va riaperto. */
export function lostCore(error: unknown): boolean {
  return error instanceof CanvasCoreError && (error.code === "trap" || error.code === "handle");
}

/**
 * La modifica al testo che il nucleo ha fatto, come `TextOperation`: il tratto
 * cambiato così com'è, o, con dei CR nel testo, la differenza contata sui `\n`.
 */
export function sourceOperation(before: string, after: string, edit: CanvasSourceEdit): Pick<TextOperation, "beforeLength" | "afterLength" | "edits"> {
  if (before.includes("\r") || after.includes("\r")) {
    return operationFromText(lineFeeds(before), lineFeeds(after));
  }
  const deleted = before.slice(edit.start, edit.end);
  if (deleted === edit.text) return { beforeLength: before.length, afterLength: after.length, edits: [] };
  return {
    beforeLength: before.length,
    afterLength: after.length,
    edits: [{ from: edit.start, to: edit.end, deleted, inserted: edit.text }],
  };
}

/**
 * La chiave del corpo di una scheda: ciò che il corpo mostra (`type`, `file`,
 * `subpath`, `url`, `text`, `label`, lo sfondo di un gruppo) più `extra`, ciò
 * che il corpo legge da fuori. Posto, misura, colore e scelta non ci sono:
 * cambiarli non rifà il corpo.
 */
export function cardBodyKey(node: CanvasNode, extra: string): string {
  return JSON.stringify([
    node.type, node.file ?? null, node.subpath ?? null, node.url ?? null,
    node.text ?? null, node.label ?? null, node.background ?? null, extra,
  ]);
}

/** Che cosa dice l'etichetta della penna (T69): la scheda col suo nome, o il tratto libero. */
export function inkHolderText(holder: CanvasNode | null): string {
  if (!holder) return t("canvas.ink.free");
  const name = cardMenuName(holder);
  return name ? t("canvas.ink.attach", { name }) : t("canvas.ink.attach_card");
}

/**
 * Scrive la proprietà `name` di `element` a `value` pixel solo se è cambiata:
 * leggere lo stile in linea non chiede il layout, e non tutti i motori
 * riconoscono uguale una scrittura col valore di prima (rifarebbero lo stile).
 */
export function setPixels(element: HTMLElement, name: string, value: number): void {
  const text = `${value}px`;
  if (element.style.getPropertyValue(name) !== text) element.style.setProperty(name, text);
}

/** Il nome di un file senza le cartelle: `Corsi/foto.png` → `foto.png`. */
export function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Quanto è lungo, al più, il nome di una scheda nella testata del menu. */
const MENU_NAME_MAX = 40;

/**
 * Il nome di una scheda nella testata del menu (T17): il file senza le
 * cartelle, l'host di una pagina web, la prima riga di un testo senza i segni
 * del Markdown (`textCardName`), l'etichetta di un gruppo; accorciato con «…».
 * `""` se non ne ha.
 */
export function cardMenuName(node: CanvasNode): string {
  let name = "";
  if (node.type === "file") name = fileName(cardTarget(node).path);
  else if (node.type === "link") {
    const address = externalUrl(node.url ?? "");
    name = address === null ? node.url ?? "" : new URL(address).host;
  } else if (node.type === "text") name = textCardName(typeof node.text === "string" ? node.text : "");
  else name = node.label ?? "";
  name = name.trim();
  return name.length > MENU_NAME_MAX ? `${name.slice(0, MENU_NAME_MAX - 1).trimEnd()}…` : name;
}

/**
 * Il `file` di una scheda dopo «Ritrova…»: il percorso scelto, col `#…` che la
 * scheda aveva in linea (il titolo o la pagina). Il `subpath` separato resta com'è.
 */
export function relinkedFile(node: CanvasNode, chosen: string): string {
  const file = typeof node.file === "string" ? node.file : "";
  const hash = file.indexOf("#");
  return hash < 0 ? chosen : `${chosen}${file.slice(hash)}`;
}

/**
 * Il nome che «Estrai in una nota» propone per il testo `text` (T70): la
 * prima riga senza i `#` di un titolo, pulita come il nome di una nota nuova
 * (`searchedName`: niente caratteri vietati, al più 80 caratteri). Una prima
 * riga vuota, o fatta solo di caratteri vietati, dà il nome di serie.
 */
export function proposedNoteName(text: string): string {
  const first = (text.split(/\r?\n/, 1)[0] ?? "").replace(/^\s*#{1,6}(?=\s|$)/, "");
  return searchedName(first) ?? t("canvas.extract.untitled");
}

/** Il nome di una nota come lo si legge: il file senza cartella e senza `.md`. */
export function noteDisplayName(path: string): string {
  return fileName(path).replace(/\.(md|markdown)$/i, "");
}

/** Il nome di una scheda che scrive, per la banda (T41): il file senza cartella né `.md`. */
export function writingName(node: CanvasNode): string {
  if (node.type !== "file" || !node.file) return nodeTitle(node);
  const base = node.file.split("/").pop() || node.file;
  return base.replace(/\.(md|markdown)$/i, "");
}

/** Quanto è lungo, al più, il nome di un testo nella testata della scheda. */
const TITLE_TEXT_MAX = 48;

/**
 * Il titolo nella testata di una scheda e nell'elenco del filo: il file, l'indirizzo,
 * il nome di un testo (`textCardName`: la prima riga non vuota senza i segni del
 * Markdown), l'etichetta di un gruppo. Una scheda che non ha ancora niente da dire
 * (un testo appena nato, mentre si scrive) dice la sua specie a parole, «Scheda di
 * testo»: mai l'id interno, che una persona non deve vedere né sentire.
 */
export function nodeTitle(node: CanvasNode): string {
  let title = "";
  switch (node.type) {
    case "text":
      title = textCardName(typeof node.text === "string" ? node.text : "").slice(0, TITLE_TEXT_MAX);
      break;
    case "file":
      title = node.file ?? "";
      break;
    case "link":
      title = node.url ?? "";
      break;
    case "group":
      title = (node.label ?? "").trim();
      break;
  }
  return title || cardTitle(node, "");
}

export function nodeText(node: CanvasNode): string {
  switch (node.type) {
    case "text": return node.text ?? "";
    case "file": return node.subpath ? `${node.file ?? ""}${node.subpath}` : node.file ?? "";
    case "link": return node.url ?? "";
    default: return node.label ?? "";
  }
}

/// Una specie `sections` qualunque: dice se un file è una nota per `fub:parts`.
export const SECTIONS_PROBE: CanvasParts = { kind: "sections", sections: ["_"], extra: {} };

/**
 * Le sezioni che la scheda mostra adesso, come chiavi del selettore (T74):
 * quelle di un `fub:parts` di sezioni valido, sennò quella del `subpath`
 * (`#Titolo`, anche `#Capitolo#Titolo`); nessuna per la nota intera o un
 * blocco `#^id`.
 */
export function partsChosen(node: CanvasNode): string[] {
  return [...(noteExcerptOf(node)?.sections ?? [])];
}

/**
 * Il link di un'ancora della resa di una scheda, se porta a un file del vault
 * (T57). Le stesse classi che la montatura riconosce: `a.internal-path` col
 * percorso, `a.wikilink` con i dati del wikilink. Il resto (un indirizzo web)
 * `null`: lo segue la montatura.
 */
export function cardLinkOf(anchor: HTMLAnchorElement): CardLinkRef | null {
  if (anchor.classList.contains("internal-path")) {
    const path = anchor.dataset.path ?? "";
    return path === "" ? null : { kind: "path", path };
  }
  const page = anchor.dataset.wikilinkPage;
  if (anchor.classList.contains("wikilink") && page !== undefined) {
    return {
      kind: "wiki",
      page,
      heading: anchor.dataset.wikilinkHeading ?? null,
      block: anchor.dataset.wikilinkBlock ?? null,
    };
  }
  return null;
}

/**
 * Il percorso di un file del vault senza la barra in testa e senza il frammento
 * (`#page=3`, o la query), come `pdfIdWithoutFragment`: così un `doc` risolto e
 * il `file` di una scheda si confrontano.
 */
function vaultPathOf(id: string): string {
  const cut = [id.indexOf("#"), id.indexOf("?")].filter((at) => at >= 0);
  const bare = cut.length ? id.slice(0, Math.min(...cut)) : id;
  return bare.replace(/^\/+/, "");
}

/**
 * La scheda di `nodes` che un link porta a vedere (T57): una scheda del file
 * `doc`, quella che ha la sezione del link nel suo `subpath` se ce n'è una, poi
 * la più vicina al centro della vista `center`. `undefined` se il file non ha
 * schede sulla lavagna.
 */
export function linkedCardOf(
  nodes: readonly CanvasNode[],
  doc: string,
  link: CardLinkRef,
  center: { readonly x: number; readonly y: number },
): CanvasNode | undefined {
  const target = vaultPathOf(doc);
  const cards = nodes.filter((node) => node.type === "file" && vaultPathOf(node.file ?? "") === target);
  if (cards.length === 0) return undefined;
  const heading = link.kind === "wiki" ? link.heading?.trim() : undefined;
  const sectioned = heading ? cards.filter((node) => noteHeadingOf(node.subpath ?? null) === heading) : [];
  const pool = sectioned.length > 0 ? sectioned : cards;
  let best: CanvasNode | undefined;
  let bestDistance = Infinity;
  for (const node of pool) {
    const dx = node.x + node.width / 2 - center.x;
    const dy = node.y + node.height / 2 - center.y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = node;
      bestDistance = distance;
    }
  }
  return best;
}

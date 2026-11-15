// Gli estratti della lavagna: il campo `fub:parts` di una scheda di file,
// letto e scritto con le regole di `docs/reference/canvas-parts.md`.
//
// Un estratto è una finestra sul file vero, non una copia: una scheda `file`
// col `subpath` sulla prima parte (`#page=3`, `#Varianza`), così Obsidian ne
// mostra almeno quella, e tutte le parti scelte sotto `fub:parts`. Le stesse
// regole stanno nel nucleo (`crates/fub-canvas-core/src/parts.rs`): i vettori
// di `src/__fixtures__/canvas-parts/` passano uguali, byte per byte, qui
// (`parts.test.ts`) e là (`tests/parts_vectors.rs`).
//
// Leggere non tocca il file: il campo resta nei campi sconosciuti della
// scheda. Uno che non si capisce, o che il `subpath` smentisce, si conserva
// così com'è (`kept`, con la ragione) e la scheda mostra il suo `subpath`,
// come Obsidian. Scrivere dà il `subpath` della prima parte e il valore del
// campo, `null` quando il `subpath` dice già tutto; `JSON.stringify` del
// valore dà gli stessi byte di `js::encode` nel nucleo.
import { cardKindOf } from "./cards";
import type { CanvasNode } from "./model";

/// La chiave degli estratti, su una scheda `file`.
export const PARTS_KEY = "fub:parts";
/// Le pagine al più che Fub scrive in un estratto `pages`; ne legge di più.
export const PARTS_MAX_WRITTEN_PAGES = 1000;
/// Di quanto un `rect` può uscire da 0…1 per gli errori d'arrotondamento.
export const RECT_TOLERANCE = 1e-6;

/// Come si mettono le pagine di un estratto `pages`.
export type PagesLayout = "one" | "row" | "column";

/// `[x, y, larghezza, altezza]` in frazioni della pagina o dell'immagine come
/// si vede, dall'angolo in alto a sinistra.
export type PartRect = readonly [x: number, y: number, width: number, height: number];

/// I campi che Fub non conosce, nel loro ordine.
export type PartsExtra = Readonly<Record<string, unknown>>;

/// Un campo `fub:parts` valido: una delle quattro specie della versione 1.
export type CanvasParts =
  | {
      readonly kind: "pages";
      /// Da 1, nell'ordine di scelta, senza doppioni.
      readonly pages: readonly number[];
      /// `null`: il file non lo dice, vale `defaultPagesLayout`.
      readonly layout: PagesLayout | null;
      readonly extra: PartsExtra;
    }
  | {
      readonly kind: "region";
      readonly page: number;
      readonly rect: PartRect;
      /// L'impronta della pagina, o `null`.
      readonly key: string | null;
      readonly extra: PartsExtra;
    }
  | {
      readonly kind: "sections";
      /// Ognuna come Obsidian la scrive dopo il `#` (`Capitolo#Varianza`).
      readonly sections: readonly string[];
      readonly extra: PartsExtra;
    }
  | {
      readonly kind: "image";
      readonly rect: PartRect;
      /// Gradi in senso orario; `null`: 0.
      readonly rotate: number | null;
      readonly extra: PartsExtra;
    };

/// Perché un campo si conserva senza mostrarlo, nell'ordine dei controlli.
export type PartsKeptReason = "node" | "object" | "kind" | "file" | "field" | "subpath";

export type PartsState =
  | { readonly state: "ok"; readonly parts: CanvasParts }
  | { readonly state: "kept"; readonly reason: PartsKeptReason };

/// Perché Fub non scrive un estratto.
export type PartsRefusedReason = "file" | "field" | "pages" | "rotate";

export type PartsWrite =
  | { readonly outcome: "written"; readonly subpath: string | null; readonly parts: Record<string, unknown> | null }
  | { readonly outcome: "refused"; readonly reason: PartsRefusedReason };

/// I campi noti di ogni specie, nell'ordine in cui si scrivono dopo `kind`.
const FIELDS: Readonly<Record<CanvasParts["kind"], readonly string[]>> = {
  pages: ["pages", "layout"],
  region: ["page", "rect", "key"],
  sections: ["sections"],
  image: ["rect", "rotate"],
};

/// La regola di serie quando `layout` manca: una pagina sola, grande; fino a
/// tre in fila; da quattro in su una alla volta.
export function defaultPagesLayout(pages: number): PagesLayout {
  return pages === 2 || pages === 3 ? "row" : "one";
}

/// Come si mettono le pagine: `layout` se c'è, sennò la regola di serie;
/// `null` per le altre specie.
export function partsLayout(parts: CanvasParts): PagesLayout | null {
  if (parts.kind !== "pages") return null;
  return parts.layout ?? defaultPagesLayout(parts.pages.length);
}

/// Il `subpath` che la prima parte dà: `#page=3` per `pages`, `#page=7` per
/// `region`, `#Varianza` per `sections`, nessuno per `image`.
export function partsSubpath(parts: CanvasParts): string | null {
  switch (parts.kind) {
    case "pages":
      return parts.pages.length > 0 ? `#page=${parts.pages[0]}` : null;
    case "region":
      return `#page=${parts.page}`;
    case "sections":
      return parts.sections.length > 0 ? `#${parts.sections[0]}` : null;
    case "image":
      return null;
  }
}

/// La specie va bene per il file: `pages` e `region` su un PDF, `sections`
/// su una nota, `image` su un'immagine (le specie di `cardKindOf`).
export function partsFit(parts: CanvasParts, file: string): boolean {
  const kind = cardKindOf({ id: "", type: "file", x: 0, y: 0, width: 1, height: 1, file });
  switch (parts.kind) {
    case "pages":
    case "region":
      return kind === "pdf";
    case "sections":
      return kind === "note";
    case "image":
      return kind === "image";
  }
}

/// Legge il valore di `fub:parts`; il motivo dice perché si conserva senza
/// mostrarlo. Non guarda il file né il `subpath`: lo fa `nodeParts`.
export function partsFromValue(value: unknown): CanvasParts | PartsKeptReason {
  if (!isObject(value)) return "object";
  const kind = value.kind;
  if (typeof kind !== "string" || !Object.prototype.hasOwnProperty.call(FIELDS, kind)) return "kind";
  const extra = extraOf(value, FIELDS[kind as CanvasParts["kind"]]);
  switch (kind as CanvasParts["kind"]) {
    case "pages":
      return readPages(value, extra);
    case "region":
      return readRegion(value, extra);
    case "sections":
      return readSections(value, extra);
    case "image":
      return readImage(value, extra);
  }
}

/// Il campo come valore JSON: `kind`, i campi noti nell'ordine della specie
/// (gli assenti non ci sono), poi quelli sconosciuti nel loro ordine.
export function partsValue(parts: CanvasParts): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, "kind", parts.kind);
  switch (parts.kind) {
    case "pages":
      put(out, "pages", [...parts.pages]);
      if (parts.layout !== null) put(out, "layout", parts.layout);
      break;
    case "region":
      put(out, "page", parts.page);
      put(out, "rect", [...parts.rect]);
      if (parts.key !== null) put(out, "key", parts.key);
      break;
    case "sections":
      put(out, "sections", [...parts.sections]);
      break;
    case "image":
      put(out, "rect", [...parts.rect]);
      if (parts.rotate !== null) put(out, "rotate", parts.rotate);
      break;
  }
  const known = FIELDS[parts.kind];
  for (const [key, value] of Object.entries(parts.extra)) {
    if (key !== "kind" && !known.includes(key)) put(out, key, value);
  }
  return out;
}

/// Il campo `fub:parts` della scheda, letto; `null` se la scheda non l'ha.
/// Le regole nell'ordine dei vettori: il tipo della scheda, la forma, il
/// file, il `subpath`.
export function nodeParts(node: CanvasNode): PartsState | null {
  if (!Object.prototype.hasOwnProperty.call(node, PARTS_KEY)) return null;
  if (node.type !== "file") return kept("node");
  const parts = partsFromValue(node[PARTS_KEY]);
  if (typeof parts === "string") return kept(parts);
  if (!partsFit(parts, typeof node.file === "string" ? node.file : "")) return kept("file");
  const subpath = typeof node.subpath === "string" ? node.subpath : null;
  if (subpath !== partsSubpath(parts)) return kept("subpath");
  return { state: "ok", parts };
}

/// Le parti che la scheda mostra (per `CardContext.parts`): quelle valide del
/// campo, `null` se non ci sono o si conservano senza mostrarle.
export function cardParts(node: CanvasNode): CanvasParts | null {
  const read = nodeParts(node);
  return read?.state === "ok" ? read.parts : null;
}

/// I campi delle schede che li hanno, nell'ordine di `nodes`.
export function readParts(nodes: readonly CanvasNode[]): { readonly node: string; readonly read: PartsState }[] {
  const out: { node: string; read: PartsState }[] = [];
  for (const node of nodes) {
    const read = nodeParts(node);
    if (read !== null) out.push({ node: node.id, read });
  }
  return out;
}

/// Il `subpath` e il campo che Fub scrive per mostrare `parts` del file
/// `file`. Le regole della lettura, più due: al più `PARTS_MAX_WRITTEN_PAGES`
/// pagine, e una rotazione multipla di 90 gradi riportata fra 0 e 270 (0 non
/// si scrive). Un estratto che il `subpath` dice già tutto (una pagina, una
/// sezione, l'immagine intera e dritta) non scrive il campo.
export function writeParts(file: string, parts: CanvasParts): PartsWrite {
  // Lo stesso controllo della lettura, sul valore che si scriverebbe; un
  // campo sconosciuto col nome di uno noto andrebbe perso, e non vale.
  const known = FIELDS[parts.kind];
  if (Object.keys(parts.extra).some((key) => key === "kind" || known.includes(key))) {
    return { outcome: "refused", reason: "field" };
  }
  const value = partsValue(parts);
  const checked = partsFromValue(value);
  if (typeof checked === "string" || JSON.stringify(partsValue(checked)) !== JSON.stringify(value)) {
    return { outcome: "refused", reason: "field" };
  }
  if (!partsFit(checked, file)) return { outcome: "refused", reason: "file" };
  let final: CanvasParts = checked;
  if (checked.kind === "pages" && checked.pages.length > PARTS_MAX_WRITTEN_PAGES) {
    return { outcome: "refused", reason: "pages" };
  }
  if (checked.kind === "image" && checked.rotate !== null) {
    if (checked.rotate % 90 !== 0) return { outcome: "refused", reason: "rotate" };
    const turned = ((checked.rotate % 360) + 360) % 360;
    final = { ...checked, rotate: turned !== 0 ? turned : null };
  }
  return { outcome: "written", subpath: partsSubpath(final), parts: isRedundant(final) ? null : partsValue(final) };
}

/// Il campo dice soltanto ciò che il `subpath` dice già.
function isRedundant(parts: CanvasParts): boolean {
  if (Object.keys(parts.extra).length > 0) return false;
  switch (parts.kind) {
    case "pages":
      return parts.pages.length === 1;
    case "sections":
      return parts.sections.length === 1;
    case "image": {
      const [x, y, width, height] = parts.rect;
      return x === 0 && y === 0 && width === 1 && height === 1 && (parts.rotate === null || parts.rotate === 0);
    }
    case "region":
      return false;
  }
}

function readPages(value: Record<string, unknown>, extra: PartsExtra): CanvasParts | PartsKeptReason {
  const items = value.pages;
  if (!Array.isArray(items) || items.length === 0) return "field";
  const seen = new Set<number>();
  const pages: number[] = [];
  for (const item of items) {
    if (!isPage(item) || seen.has(item)) return "field";
    seen.add(item);
    pages.push(item);
  }
  let layout: PagesLayout | null = null;
  if (has(value, "layout")) {
    const named = value.layout;
    if (named !== "one" && named !== "row" && named !== "column") return "field";
    layout = named;
  }
  return { kind: "pages", pages, layout, extra };
}

function readRegion(value: Record<string, unknown>, extra: PartsExtra): CanvasParts | PartsKeptReason {
  const page = value.page;
  if (!isPage(page)) return "field";
  const rect = readRect(value.rect);
  if (rect === null) return "field";
  let key: string | null = null;
  if (has(value, "key")) {
    if (typeof value.key !== "string") return "field";
    key = value.key;
  }
  return { kind: "region", page, rect, key, extra };
}

function readSections(value: Record<string, unknown>, extra: PartsExtra): CanvasParts | PartsKeptReason {
  const items = value.sections;
  if (!Array.isArray(items) || items.length === 0) return "field";
  const seen = new Set<string>();
  const sections: string[] = [];
  for (const item of items) {
    if (typeof item !== "string" || item === "" || seen.has(item)) return "field";
    seen.add(item);
    sections.push(item);
  }
  return { kind: "sections", sections, extra };
}

function readImage(value: Record<string, unknown>, extra: PartsExtra): CanvasParts | PartsKeptReason {
  const rect = readRect(value.rect);
  if (rect === null) return "field";
  let rotate: number | null = null;
  if (has(value, "rotate")) {
    if (!isFiniteNumber(value.rotate)) return "field";
    rotate = value.rotate;
  }
  return { kind: "image", rect, rotate, extra };
}

/// Quattro numeri, i lati positivi, dentro 0…1 a meno di `RECT_TOLERANCE`.
function readRect(value: unknown): PartRect | null {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(isFiniteNumber)) return null;
  const [x, y, width, height] = value as [number, number, number, number];
  const valid =
    width > 0 &&
    height > 0 &&
    x >= -RECT_TOLERANCE &&
    y >= -RECT_TOLERANCE &&
    x + width <= 1 + RECT_TOLERANCE &&
    y + height <= 1 + RECT_TOLERANCE;
  return valid ? [x, y, width, height] : null;
}

/// Un numero di pagina: un intero da 1 a 2^53−1.
function isPage(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function has(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/// I campi che la specie non conosce, nel loro ordine.
function extraOf(value: Record<string, unknown>, known: readonly string[]): PartsExtra {
  const extra: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (key !== "kind" && !known.includes(key)) put(extra, key, field);
  }
  return extra;
}

/// Assegna una chiave propria anche quando è `__proto__`, come `JSON.parse`.
function put(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

function kept(reason: PartsKeptReason): PartsState {
  return { state: "kept", reason };
}

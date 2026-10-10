// Il disegno come immagine che si vede da sola. Dentro un `<img>`, da un blob
// o da un file, il browser non carica niente da fuori: né i caratteri
// dell'app, né quelli e le immagini del vault. Qui i caratteri entrano nella
// copia del documento che va nell'immagine, in un foglio di stile coi loro
// file come data URI: per ogni testo la prima famiglia di Fub che usa, in
// tondo o in corsivo come lui, e le facce del vault che il disegno ha già
// caricato. Lo stesso foglio dà a ogni `font-family` la famiglia che userebbe
// l'export, come sulla superficie: quelle di Fub al posto delle generiche,
// Literata dove nessuno la dice, mai un carattere del sistema. La Lettura,
// gli strati immagine del foglio, l'anteprima dell'export, gli embed delle
// note e il PNG copiato scrivono così con gli stessi caratteri del foglio. Il
// file non cambia.
//
// - **Una lettura per sessione.** Ogni file dell'app si legge una volta, e
//   chi disegna subito trova pronti quelli già letti; uno che non si legge si
//   riprova la volta dopo.
// - **Un tetto.** I caratteri dell'app pesano al più
//   [`MAX_FONT_SHEET_BYTES`], tanto in più tiene in memoria ogni immagine che
//   li porta tutti; quelli del vault, al più il tetto del disegno.
//
// Una nota può incorporare una sezione sola del disegno, `![[disegno#nome]]`:
// il titolo è il disegno intero, e una tavola è il disegno ritagliato su di
// lei, nella copia che va nell'immagine.

import { imageDataUri, imageRefs, withImages, type ImageRef } from "./read-images";
import { boardBox } from "./scene/classify";
import { openSource, ReadError, readScene, type Scene } from "./scene/read";
import { SourceText } from "./scene/text";
import { attrOf, isSvg, NS_NONE, parseXml, type ElementNode } from "./scene/xml";
import { cssString, fubLiveFamily, shownFamily } from "./fonts/faces";
import { markupFonts, type TextFont } from "./fonts/vault";
import { FONT_FILES } from "./tools/text";

/// I caratteri dell'app nel foglio più grande, i tre in tondo e in corsivo:
/// misurato sui loro file, 379 KB, con un margine.
export const MAX_FONT_SHEET_BYTES = 384 * 1024;

/// Chi dà i caratteri a un'immagine: subito, se sono già letti, o quando
/// arrivano.
export interface FontSheets {
  /// Il foglio dei caratteri dei testi di `svg`, se sono tutti già letti:
  /// `""` se non ha testi; `null` se qualcuno manca ancora.
  now(svg: string): string | null;
  /// Legge i caratteri dei testi di `svg` e dà il loro foglio, senza quelli
  /// che non si leggono.
  load(svg: string): Promise<string>;
}

/// Le famiglie di un disegno per le sue immagini: quella che si scrive per
/// ogni `font-family`, e le facce del vault che i testi chiedono
/// (`DrawingFonts`).
export interface PictureFamilies {
  /// La `font-family` che l'immagine scrive per `value`: nessuna del sistema.
  picture(value: string): string;
  /// Le regole `@font-face` delle facce del vault che `fonts` chiedono; con
  /// `strict`, `null` se qualcuna sta ancora arrivando.
  faces(fonts: readonly TextFont[], strict: boolean): string | null;
  /// Si risolve quando le facce di `fonts` sono pronte, o si sa che non ci
  /// saranno.
  ready(fonts: readonly TextFont[]): Promise<void>;
}

/// Senza caratteri del vault: le sole famiglie di Fub.
export const FUB_PICTURE_FAMILIES: PictureFamilies = {
  picture: fubLiveFamily,
  faces: () => "",
  ready: () => Promise.resolve(),
};

/// I file dei caratteri in lettura o letti, per indirizzo.
const fontUris = new Map<string, Promise<string | null>>();
/// I file dei caratteri già letti, per indirizzo.
const fontData = new Map<string, string>();

type FontFile = (typeof FONT_FILES)[number];

/// I file dei caratteri dell'app che servono ai testi `fonts`: per ciascuno,
/// la prima famiglia di Fub della sua famiglia viva, quella che il testo
/// trova senza le famiglie del vault, in tondo o in corsivo.
function fubFiles(fonts: readonly TextFont[]): FontFile[] {
  const out = new Set<FontFile>();
  for (const font of fonts) {
    const family = shownFamily(font.family);
    const style = font.style === "normal" ? "normal" : "italic";
    for (const file of FONT_FILES) if (file[0] === family && file[3] === style) out.add(file);
  }
  return FONT_FILES.filter((file) => out.has(file));
}

const fontRule = ([family, url, weight, style]: FontFile): string =>
  `@font-face{font-family:"${family}";src:url(${fontData.get(url)}) format("woff2");font-weight:${weight};${style === "normal" ? "" : `font-style:${style};`}}`;

/// Il data URI dei byte `blob`, col tipo `type`.
function blobUri(blob: Blob, type: string): Promise<string | null> {
  return blob.arrayBuffer().then(
    (buffer) => {
      const bytes = new Uint8Array(buffer);
      const parts: string[] = [];
      for (let i = 0; i < bytes.length; i += 0x8000) parts.push(String.fromCharCode(...bytes.subarray(i, i + 0x8000)));
      return `data:${type};base64,${btoa(parts.join(""))}`;
    },
    () => null,
  );
}

/// Un file dell'app; `null` se non si legge.
export const appFile = (url: string): Promise<Blob | null> =>
  fetch(url)
    .then((response) => (response.ok ? response.blob() : null))
    .catch(() => null);

/// Legge i file dell'app di `files` che non sono ancora letti.
async function readFiles(files: readonly FontFile[], read: (url: string) => Promise<Blob | null>): Promise<void> {
  for (const [, url] of files) {
    let uri = fontUris.get(url);
    if (uri === undefined) {
      uri = read(url).then((blob) => (blob === null ? null : blobUri(blob, "font/woff2")), () => null);
      fontUris.set(url, uri);
    }
    const data = await uri;
    if (data === null) {
      // Riprova la prossima volta.
      if (fontUris.get(url) === uri) fontUris.delete(url);
      continue;
    }
    fontData.set(url, data);
  }
}

/// Il foglio dei caratteri dei testi di `svg`. Le regole sulle `font-family`
/// danno a ogni testo la famiglia che l'export userebbe, con quelle di Fub al
/// posto delle generiche e Literata dove nessuno la dice, come sulla
/// superficie; poi i file dell'app e le facce del vault che servono. Nessun
/// grassetto o corsivo si inventa. Con `strict`, `null` se un file o una
/// faccia non è ancora pronta; altrimenti senza.
function sheet(svg: string, families: PictureFamilies, strict: boolean): string | null {
  const { fonts, families: written } = markupFonts(svg);
  if (fonts.length === 0) return "";
  const rules = [`:root{font-synthesis:none}:root:not([font-family]){font-family:${families.picture("")}}`];
  for (const value of written) rules.push(`[font-family=${cssString(value)}]{font-family:${families.picture(value)}}`);
  for (const file of fubFiles(fonts)) {
    if (fontData.has(file[1])) rules.push(fontRule(file));
    else if (strict) return null;
  }
  const faces = families.faces(fonts, strict);
  if (faces === null) return null;
  rules.push(faces);
  // I nomi fra virgolette possono avere ciò che il markup legge: dentro lo
  // stile diventano sequenze di escape dei CSS.
  return rules.join("").replace(/[<>&]/g, (char) => `\\${char.charCodeAt(0).toString(16)} `);
}

/// I fogli dei caratteri per le immagini di un disegno con le famiglie
/// `families`; `read` legge un file dell'app.
export function fontSheets(families: PictureFamilies = FUB_PICTURE_FAMILIES, read: (url: string) => Promise<Blob | null> = appFile): FontSheets {
  return {
    now: (svg) => sheet(svg, families, true),
    load: async (svg) => {
      const { fonts } = markupFonts(svg);
      await Promise.all([readFiles(fubFiles(fonts), read), families.ready(fonts).catch(() => undefined)]);
      return sheet(svg, families, false) ?? "";
    },
  };
}

/// Il foglio dei caratteri dell'app per i testi di `svg`, i file come data
/// URI; `""` se non ha testi. `read` legge un file dell'app.
export function fontFaces(svg: string, read: (url: string) => Promise<Blob | null> = appFile): Promise<string> {
  return fontSheets(FUB_PICTURE_FAMILIES, read).load(svg);
}

/// Il foglio di [`fontFaces`], se i file che servono sono già letti; `null`
/// se qualcuno manca.
export function fontFacesNow(svg: string): string | null {
  return sheet(svg, FUB_PICTURE_FAMILIES, true);
}

/// I caratteri dell'app, letti coi file dell'app.
export const appFonts: FontSheets = fontSheets();

/// `svg` con il foglio di stile `css`, che non ha marcatura, come primo
/// figlio della radice; com'è se `css` è vuoto o se non si legge.
export function withStyle(svg: string, css: string): string {
  if (css === "") return svg;
  let at: number;
  let name: string;
  try {
    const doc = parseXml(new SourceText(svg), false);
    const root = doc.element(doc.root)!;
    if (!isSvg(root, "svg") || root.closeStart === null) return svg;
    at = root.openEnd;
    name = styleName(root.name);
  } catch {
    return svg;
  }
  return `${svg.slice(0, at)}<${name}>${css}</${name}>${svg.slice(at)}`;
}

/// `svg` col foglio `css` e con le immagini di `refs`, i suoi `href` che un
/// `img` non vedrebbe, al loro posto: il data URI che `sources` dà per il
/// percorso, o il segnaposto. Lo stile va subito dopo l'apertura della
/// radice, prima di ogni immagine: gli indici di `refs` si spostano di quanto
/// è lungo.
export function picture(svg: string, css: string, refs: readonly ImageRef[], sources: ReadonlyMap<string, string>): string {
  const styled = withStyle(svg, css);
  const shift = styled.length - svg.length;
  const moved = shift === 0 ? refs : refs.map((ref) => ({ ...ref, start: ref.start + shift, end: ref.end + shift }));
  return withImages(styled, moved, sources);
}

/// `svg`, un disegno, come immagine che si vede da sola, in un colpo: le
/// immagini del vault coi loro byte, una alla volta finché stanno in
/// `budget` byte, e i caratteri dell'app. `read` legge un'immagine del vault
/// per il suo `href`, senza leggerla se pesa più del tetto che riceve.
export async function selfContained(
  svg: string,
  read: (path: string, limit: number) => Promise<Blob | null>,
  budget: number,
  fonts: FontSheets = appFonts,
): Promise<string> {
  const refs = imageRefs(svg);
  const sources = new Map<string, string>();
  let spent = 0;
  for (const path of new Set(refs.flatMap((ref) => (ref.path === null ? [] : [ref.path])))) {
    const room = budget - spent;
    if (room <= 0) break;
    const blob = await read(path, room).catch(() => null);
    const uri = blob === null || blob.size > room ? null : await imageDataUri(blob);
    if (uri === null) continue;
    sources.set(path, uri);
    spent += blob!.size;
  }
  return picture(svg, fonts.now(svg) ?? (await fonts.load(svg)), refs, sources);
}

/// La sezione `name` di `svg`, come la sceglie `![[disegno#name]]`: il
/// titolo è il disegno intero; una tavola, la prima che si chiama così, è il
/// disegno con la radice sul rettangolo della tavola, il suo `viewBox` e la
/// sua larghezza e altezza. I nomi sono quelli dell'indice della scena, e si
/// confrontano esatti; il titolo viene prima delle tavole. `null` se `name`
/// non è una sezione, o se `svg` non è una scena e quindi non ne ha.
export function section(svg: string, name: string): string | null {
  let scene: Scene;
  try {
    scene = readScene(svg);
  } catch (error) {
    if (error instanceof ReadError) return null;
    throw error;
  }
  if (scene.index.title?.text === name) return svg;
  const board = scene.index.boards.find((excerpt) => excerpt.text === name);
  if (board === undefined) return null;
  // L'indice dà il nome e lo span del `view`; il rettangolo si legge dal
  // `view`, un figlio della radice, che comincia a quel byte.
  const { doc } = openSource(svg);
  const root = doc.element(doc.root)!;
  for (const child of root.children) {
    const view = doc.element(child);
    if (view === null || doc.source.byteOf(view.start) !== board.bytes[0]) continue;
    const box = boardBox(view);
    return box === null ? null : onBox(svg, root, box);
  }
  return null;
}

/// `svg` con la radice `root` sul rettangolo `box`: il suo `viewBox`, e una
/// larghezza e un'altezza uguali alle sue. Gli attributi che ci sono cambiano
/// valore sul posto, quelli che mancano si aggiungono in fondo al tag
/// d'apertura; una radice con una tavola ha dei figli, e il tag non è
/// autochiuso.
function onBox(svg: string, root: ElementNode, box: readonly [number, number, number, number]): string {
  const edits: { start: number; end: number; text: string }[] = [];
  let added = "";
  for (const [local, value] of [["viewBox", box.join(" ")], ["width", String(box[2])], ["height", String(box[3])]] as const) {
    const attr = attrOf(root, NS_NONE, local);
    if (attr === undefined) added += ` ${local}="${value}"`;
    else edits.push({ start: attr.raw[0], end: attr.raw[1], text: value });
  }
  if (added !== "") edits.push({ start: root.openEnd - 1, end: root.openEnd - 1, text: added });
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let at = 0;
  for (const edit of edits) {
    out += svg.slice(at, edit.start) + edit.text;
    at = edit.end;
  }
  return out + svg.slice(at);
}

/// Il nome di un `<style>` SVG figlio di una radice che si chiama `root`:
/// col suo prefisso, se ne ha uno.
export function styleName(root: string): string {
  const colon = root.indexOf(":");
  return colon < 0 ? "style" : `${root.slice(0, colon)}:style`;
}

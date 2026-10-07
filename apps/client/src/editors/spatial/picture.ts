// Il disegno come immagine che si vede da sola. Dentro un `<img>`, da un blob
// o da un file, il browser non carica niente da fuori: né i caratteri
// dell'app, né le immagini del vault. Qui i caratteri entrano nella copia del
// documento che va nell'immagine, in un foglio di stile coi loro file come
// data URI, solo quelli che un testo nomina, e il corsivo soltanto se un
// testo è in corsivo: la Lettura, gli strati immagine
// del foglio, gli embed delle note e il PNG copiato scrivono così con gli
// stessi caratteri del foglio. Il file non cambia.
//
// - **Una lettura per sessione.** Ogni file si legge una volta, e chi disegna
//   subito trova pronti quelli già letti; uno che non si legge si riprova la
//   volta dopo.
// - **Un tetto.** I caratteri insieme pesano al più [`MAX_FONT_SHEET_BYTES`]:
//   tanto in più tiene in memoria ogni immagine che li porta tutti.
//
// Una nota può incorporare una sezione sola del disegno, `![[disegno#nome]]`:
// il titolo è il disegno intero, e una tavola è il disegno ritagliato su di
// lei, nella copia che va nell'immagine.

import { imageDataUri, imageRefs, withImages, type ImageRef } from "./read-images";
import { boardBox } from "./scene/classify";
import { openSource, ReadError, readScene, type Scene } from "./scene/read";
import { SourceText } from "./scene/text";
import { attrOf, isSvg, NS_NONE, parseXml, type ElementNode } from "./scene/xml";
import { FONT_FILES, FONT_RANGE } from "./tools/text";

/// Il foglio dei caratteri più grande, coi tre caratteri dell'app in tondo e
/// in corsivo: misurato sui loro file, 379 KB, con un margine.
export const MAX_FONT_SHEET_BYTES = 384 * 1024;

/// Chi dà i caratteri a un'immagine: subito, se sono già letti, o quando
/// arrivano.
export interface FontSheets {
  /// Il foglio dei caratteri che `svg` nomina, se sono tutti già letti: `""`
  /// se non ne nomina; `null` se qualcuno manca ancora.
  now(svg: string): string | null;
  /// Legge i caratteri che `svg` nomina e dà il loro foglio, senza quelli
  /// che non si leggono.
  load(svg: string): Promise<string>;
}

/// I file dei caratteri in lettura o letti, per indirizzo.
const fontUris = new Map<string, Promise<string | null>>();
/// I file dei caratteri già letti, per indirizzo.
const fontData = new Map<string, string>();

/// I caratteri dell'app che `svg` nomina in un `font-family`; i corsivi, se
/// un `font-style` chiede il corsivo o l'obliquo.
function namedFonts(svg: string): typeof FONT_FILES {
  if (!/font-family/i.test(svg)) return [];
  const slanted = /font-style\s*[:=]\s*["']?\s*(?:italic|oblique)/i.test(svg);
  return FONT_FILES.filter(([family, , , style]) =>
    (style === "normal" || slanted) && new RegExp(`font-family\\s*[:=]\\s*(?:"[^"]*|'[^']*|[^;"'>]*)${family.replace(/ /g, "\\s+")}`, "i").test(svg));
}

const fontRule = (family: string, data: string, weight: string, style: string): string =>
  `@font-face{font-family:"${family}";src:url(${data}) format("woff2");font-weight:${weight};${style === "normal" ? "" : `font-style:${style};`}unicode-range:${FONT_RANGE}}`;

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

/// Il foglio di stile coi caratteri dell'app che `svg` nomina in un
/// `font-family`, i file come data URI; `""` se non ne nomina. `read`
/// legge un file dell'app.
export async function fontFaces(svg: string, read: (url: string) => Promise<Blob | null> = appFile): Promise<string> {
  const rules: string[] = [];
  for (const [family, url, weight, style] of namedFonts(svg)) {
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
    rules.push(fontRule(family, data, weight, style));
  }
  return rules.join("\n");
}

/// Il foglio di [`fontFaces`], se i caratteri che `svg` nomina sono tutti già
/// letti; `null` se qualcuno manca.
export function fontFacesNow(svg: string): string | null {
  const rules: string[] = [];
  for (const [family, url, weight, style] of namedFonts(svg)) {
    const data = fontData.get(url);
    if (data === undefined) return null;
    rules.push(fontRule(family, data, weight, style));
  }
  return rules.join("\n");
}

/// I caratteri dell'app, letti coi file dell'app.
export const appFonts: FontSheets = {
  now: fontFacesNow,
  load: (svg) => fontFaces(svg, appFile),
};

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

// Il disegno come immagine che si vede da sola. Dentro un `<img>`, da un blob
// o da un file, il browser non carica niente da fuori: né i caratteri
// dell'app, né le immagini del vault. Qui i caratteri entrano nella copia del
// documento che va nell'immagine, in un foglio di stile coi loro file come
// data URI, solo quelli che un testo nomina: la Lettura, gli strati immagine
// del foglio, gli embed delle note e il PNG copiato scrivono così con gli
// stessi caratteri del foglio. Il file non cambia.
//
// - **Una lettura per sessione.** Ogni file si legge una volta, e chi disegna
//   subito trova pronti quelli già letti; uno che non si legge si riprova la
//   volta dopo.
// - **Un tetto.** I caratteri insieme pesano al più [`MAX_FONT_SHEET_BYTES`]:
//   tanto in più tiene in memoria ogni immagine che li porta tutti.

import { imageDataUri, imageRefs, withImages, type ImageRef } from "./read-images";
import { SourceText } from "./scene/text";
import { isSvg, parseXml } from "./scene/xml";
import { FONT_FILES, FONT_RANGE } from "./tools/text";

/// Il foglio dei caratteri più grande, coi tre caratteri dell'app: misurato
/// sui loro file, 189 KB, con un margine.
export const MAX_FONT_SHEET_BYTES = 192 * 1024;

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

/// I caratteri dell'app che `svg` nomina in un `font-family`.
function namedFonts(svg: string): typeof FONT_FILES {
  if (!/font-family/i.test(svg)) return [];
  return FONT_FILES.filter(([family]) =>
    new RegExp(`font-family\\s*[:=]\\s*(?:"[^"]*|'[^']*|[^;"'>]*)${family.replace(/ /g, "\\s+")}`, "i").test(svg));
}

const fontRule = (family: string, data: string, weight: string): string =>
  `@font-face{font-family:"${family}";src:url(${data}) format("woff2");font-weight:${weight};unicode-range:${FONT_RANGE}}`;

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
  for (const [family, url, weight] of namedFonts(svg)) {
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
    rules.push(fontRule(family, data, weight));
  }
  return rules.join("\n");
}

/// Il foglio di [`fontFaces`], se i caratteri che `svg` nomina sono tutti già
/// letti; `null` se qualcuno manca.
export function fontFacesNow(svg: string): string | null {
  const rules: string[] = [];
  for (const [family, url, weight] of namedFonts(svg)) {
    const data = fontData.get(url);
    if (data === undefined) return null;
    rules.push(fontRule(family, data, weight));
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

/// Il nome di un `<style>` SVG figlio di una radice che si chiama `root`:
/// col suo prefisso, se ne ha uno.
export function styleName(root: string): string {
  const colon = root.indexOf(":");
  return colon < 0 ? "style" : `${root.slice(0, colon)}:style`;
}

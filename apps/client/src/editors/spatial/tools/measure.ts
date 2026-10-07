// La larghezza del testo, come la disegna l'export (formato della scena,
// testo): serve agli a capo di un testo in area.
//
// - **Coi caratteri dell'app.** Il browser misura con `measureText` di un
//   canvas, col carattere, il corpo, il peso e il corsivo di ogni pezzo: gli
//   stessi file che il foglio e l'export usano (`text.ts`). Un carattere che
//   non c'è, o che non è ancora arrivato, si misura col suo ripiego, come lo
//   disegnerebbe il browser in quel momento.
// - **La spaziatura delle lettere** si aggiunge dopo ogni carattere, un
//   grafema alla volta, come la applica SVG. Con la spaziatura SVG spegne le
//   legature, e la «Th» di Literata torna due lettere: dove il canvas sa
//   mettere la spaziatura la mette lui, e le spegne allo stesso modo; dove
//   non la sa mettere, come in WebKit, misura il testo con uno ZWNJ fra due
//   grafemi, che spegne le legature e lascia la crenatura.
// - **Dove il browser non misura**, come nelle prove, ogni carattere è largo
//   0,6 volte il corpo: la stima del campo e del colpo.

/// Il carattere di un pezzo di testo, come lo vede chi lo disegna.
export interface Font {
  /// `font-family`, com'è scritto.
  readonly family: string;
  /// Il corpo, in unità della scena.
  readonly size: number;
  /// `font-weight`, com'è scritto.
  readonly weight: string;
  /// `font-style`, com'è scritto.
  readonly style: string;
  /// La spaziatura delle lettere, in unità della scena.
  readonly spacing: number;
}

/// La larghezza di `text` scritto con `font`, in unità della scena.
export type Measure = (text: string, font: Font) => number;

/// La larghezza di un carattere, in volte il corpo, dove il browser non
/// misura.
export const CHAR_EM = 0.6;

/// `Intl.Segmenter` per grafemi, che le librerie ES2021 del progetto non
/// descrivono.
interface GraphemeSegmenter {
  segment(text: string): Iterable<{ readonly segment: string }>;
}

const Segmenter = (Intl as unknown as { Segmenter?: new (locale: undefined, options: { granularity: "grapheme" }) => GraphemeSegmenter }).Segmenter;
const segmenter = Segmenter === undefined ? null : new Segmenter(undefined, { granularity: "grapheme" });

/// I grafemi di `text`: una lettera coi suoi accenti, un'emoji intera. Dove
/// il browser non li sa dividere, i punti di codice.
export function graphemes(text: string): string[] {
  if (segmenter === null) return Array.from(text);
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/// La stima: [`CHAR_EM`] volte il corpo per carattere, più la spaziatura.
export const estimate: Measure = (text, font) => graphemes(text).length * (CHAR_EM * font.size + font.spacing);

/// Il carattere di `font` come lo scrive la proprietà `font` di CSS, a
/// `size` pixel.
export function cssFont(font: Font, size: number = font.size): string {
  return `${font.style} ${font.weight} ${size}px ${font.family}`;
}

/// Il corpo a cui il canvas misura: le larghezze crescono col corpo, e un
/// corpo fisso tiene le misure in una cache sola per carattere.
const PROBE_SIZE = 100;

/// Quante larghezze la cache tiene per carattere prima di ricominciare.
const CACHE = 4096;

/// Il non-congiuntore di larghezza zero: fra due lettere, le tiene separate.
const ZWNJ = "\u200c";

/// La misura del browser, `null` dove non c'è un canvas: allora vale
/// [`estimate`]. Con `canvasSpacing` falso la spaziatura non la mette mai il
/// canvas, come dove non la sa mettere: il banco prova così anche l'altra
/// strada.
export function browserMeasure(canvasSpacing = true): Measure | null {
  if (typeof OffscreenCanvas === "undefined") return null;
  let context: OffscreenCanvasRenderingContext2D | null = null;
  try {
    context = new OffscreenCanvas(1, 1).getContext("2d");
  } catch {
    return null;
  }
  if (context === null) return null;
  const ctx = context;
  const spaces = canvasSpacing && "letterSpacing" in ctx;
  const caches = new Map<string, Map<string, number>>();
  /// La spaziatura che il canvas mette a [`PROBE_SIZE`] pixel: zero dove non
  /// la sa mettere.
  const spacedBy = (font: Font): number => (spaces && font.spacing !== 0 ? (font.spacing * PROBE_SIZE) / font.size : 0);
  /// La larghezza a [`PROBE_SIZE`] pixel, con la spaziatura se il canvas la
  /// mette; `null` se il browser non legge il carattere.
  const probe = (text: string, font: Font): number | null => {
    const css = cssFont(font, PROBE_SIZE);
    const spaced = spacedBy(font);
    const key = spaced === 0 ? css : `${css}|${spaced}`;
    let cache = caches.get(key);
    if (cache === undefined) {
      cache = new Map();
      caches.set(key, cache);
    }
    // Senza la spaziatura del canvas, le legature le spegne lo ZWNJ.
    const probed = spaced === 0 && font.spacing !== 0 ? graphemes(text).join(ZWNJ) : text;
    const known = cache.get(probed);
    if (known !== undefined) return known;
    // Un valore che CSS non legge lascia quello di prima: si parte da uno
    // di un altro corpo, che nessun valore buono lascia.
    ctx.font = "1px serif";
    const before = ctx.font;
    ctx.font = css;
    if (ctx.font === before) return null;
    if (spaced !== 0) ctx.letterSpacing = `${spaced}px`;
    const width = ctx.measureText(probed).width;
    if (spaced !== 0) ctx.letterSpacing = "0px";
    // Un carattere che sta ancora arrivando si misura col ripiego, e la
    // misura non si ricorda: quella dopo sarà col carattere vero.
    if (!arrived(css)) return width;
    if (cache.size >= CACHE) cache.clear();
    cache.set(probed, width);
    return width;
  };
  return (text, font) => {
    if (text === "" || font.size <= 0) return 0;
    const width = probe(text, font);
    if (width === null) return estimate(text, font);
    const after = spacedBy(font) === 0 ? graphemes(text).length * font.spacing : 0;
    return (width * font.size) / PROBE_SIZE + after;
  };
}

/// Vero se il browser ha i caratteri di `css`, o se non sa dirlo.
function arrived(css: string): boolean {
  if (typeof document === "undefined" || document.fonts === undefined) return true;
  try {
    return document.fonts.check(css);
  } catch {
    return true;
  }
}

/// Chiede al browser i caratteri di `fonts`, se servono: la misura di dopo
/// li usa. Si risolve quando sono arrivati, o quando non c'è niente da
/// chiedere.
export function loadFonts(fonts: readonly Font[]): Promise<void> {
  if (typeof document === "undefined" || document.fonts === undefined) return Promise.resolve();
  const wanted = new Set(fonts.filter((font) => font.size > 0).map((font) => cssFont(font, PROBE_SIZE)));
  const loads: Promise<unknown>[] = [];
  for (const css of wanted) {
    try {
      if (!document.fonts.check(css)) loads.push(document.fonts.load(css).catch(() => []));
    } catch {
      // Un carattere che il browser non legge si misura col ripiego.
    }
  }
  return Promise.all(loads).then(() => undefined);
}

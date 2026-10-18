// La prova degli a capo del banco di fedeltà: gli a capo che FubDraw scrive
// in un testo in area, misurati coi caratteri dell'app (`measure.ts`), sono
// quelli che il browser farebbe con le larghezze che disegna. Per ogni
// paragrafo, in italiano e in inglese, in ogni carattere dell'app, a più
// corpi e larghezze, con un pezzo in grassetto o in corsivo e con la
// spaziatura delle lettere:
//
// - ogni riga, come la disegna il browser, sta nel riquadro, tranne un
//   grafema da solo che non ci sta;
// - ogni riga è la più lunga che ci sta: con ciò che viene dopo fino al
//   prossimo a capo possibile, il browser la disegna più larga del riquadro;
// - la larghezza che FubDraw misura per una riga è quella che il browser
//   disegna, entro `TOLERANCE`.

import { browserMeasure, graphemes, type Measure } from "../src/editors/spatial/tools/measure";
import type { Rich, Span } from "../src/editors/spatial/tools/rich";
import { lineWidth, reflow } from "../src/editors/spatial/tools/wrap";

/// Quanto, in unità della scena, la misura e il browser possono scostarsi:
/// meno di un pixel su cinque a corpo 20.
const TOLERANCE = 0.25;

const SVG = "http://www.w3.org/2000/svg";

/// I paragrafi della prova: gli spazi, gli apostrofi, le lettere accentate,
/// un trattino in una parola e una parola più lunga di un riquadro stretto.
const PARAGRAPHS: Readonly<Record<"it" | "en", readonly Span[]>> = {
  it: [
    { text: "Nel mezzo del cammin di ", attrs: null },
    { text: "nostra vita", attrs: { "font-weight": "bold" } },
    { text: " mi ritrovai per una selva oscura, ché la diritta via era smarrita. L’acqua sale in cielo e torna giù, precipitevolissimevolmente, sull’altopiano tosco-emiliano.", attrs: null },
  ],
  en: [
    { text: "The quick brown fox jumps over the ", attrs: null },
    { text: "lazy dog", attrs: { "font-style": "italic" } },
    { text: ", while well-known typesetters measure every line twice before breaking it: incomprehensibilities are rare, they say.", attrs: null },
  ],
};

const FAMILIES = ["Inter, sans-serif", "Literata, serif", "JetBrains Mono, monospace"];
/// Il corpo, con la spaziatura delle lettere.
const SIZES: ReadonlyArray<readonly [size: number, spacing: string | null]> = [[14, null], [20, "1"]];
const WIDTHS = [80, 150, 230];

export interface WrapCase {
  readonly name: string;
  readonly lines: number;
  /// Di quanto la riga più larga, come la disegna il browser, esce dal
  /// riquadro; negativo se ci stanno tutte.
  readonly over: number;
  /// Di quanto la riga che si allunga meno, col pezzo dopo, resta dentro il
  /// riquadro; negativo se escono tutte.
  readonly under: number;
  /// Lo scarto più grande fra la misura e il browser, e la sua riga.
  readonly drift: number;
  readonly worst: string;
  /// Vero se il caso passa: tutti e tre entro `TOLERANCE`.
  readonly ok: boolean;
}

/// La larghezza dei tratti `spans` con gli attributi `attrs`, come la
/// disegna il browser.
function rendered(host: SVGSVGElement, attrs: Readonly<Record<string, string>>, spans: readonly Span[]): number {
  const text = document.createElementNS(SVG, "text");
  for (const [name, value] of Object.entries(attrs)) if (!name.includes(":")) text.setAttribute(name, value);
  for (const span of spans) {
    if (span.attrs === null) {
      text.append(document.createTextNode(span.text));
      continue;
    }
    const piece = document.createElementNS(SVG, "tspan");
    for (const [name, value] of Object.entries(span.attrs)) piece.setAttribute(name, value);
    piece.textContent = span.text;
    text.append(piece);
  }
  host.append(text);
  const width = (text as SVGTextElement).getComputedTextLength();
  text.remove();
  return width;
}

/// I tratti dei primi `count` caratteri UTF-16 di `spans`.
function head(spans: readonly Span[], count: number): Span[] {
  const out: Span[] = [];
  let left = count;
  for (const span of spans) {
    if (left <= 0) break;
    out.push({ text: span.text.slice(0, left), attrs: span.attrs });
    left -= span.text.length;
  }
  return out;
}

/// Quanti caratteri UTF-16 di `text`, l'inizio di una riga, vanno fino al
/// prossimo a capo possibile: la prima parola, o fino al trattino che la
/// spezza; per una parola spezzata fra due grafemi, il primo grafema.
function nextUnit(text: string, forced: boolean): number {
  if (forced) return graphemes(text)[0]?.length ?? 0;
  const space = text.indexOf(" ");
  const word = space < 0 ? text : text.slice(0, space);
  const hyphen = /[^\s][-‐–—]/.exec(word);
  return hyphen === null ? word.length : hyphen.index + 2;
}

/// Ogni caso della prova, col suo esito, con gli a capo misurati da
/// `measure`: di solito quella del browser.
export function wrapCases(measure: Measure | null = browserMeasure()): WrapCase[] {
  if (measure === null) throw new Error("il browser non misura il testo");
  const host = document.createElementNS(SVG, "svg");
  host.setAttribute("width", "0");
  host.setAttribute("height", "0");
  host.style.position = "absolute";
  document.body.append(host);
  const out: WrapCase[] = [];
  try {
    for (const [language, spans] of Object.entries(PARAGRAPHS)) {
      for (const family of FAMILIES) {
        for (const [size, spacing] of SIZES) {
          for (const width of WIDTHS) {
            const attrs: Record<string, string> = { x: "0", "font-family": family, "font-size": String(size) };
            if (spacing !== null) attrs["letter-spacing"] = spacing;
            const rich: Rich = { attrs, inherited: {}, lines: [{ attrs: { x: "0", dy: "0" }, spans }] };
            const lines = reflow(rich, width, measure).rich.lines;
            let over = -Infinity;
            let under = Infinity;
            let drift = 0;
            let worst = "";
            lines.forEach((line, i) => {
              const shown = rendered(host, attrs, line.spans);
              const text = line.spans.map((span) => span.text).join("");
              const gap = Math.abs(shown - lineWidth({ ...rich, lines }, line, measure));
              if (gap > drift) [drift, worst] = [gap, text];
              if (graphemes(text.trim()).length > 1) over = Math.max(over, shown - width);
              const after = lines[i + 1];
              if (after === undefined) return;
              const join = after.attrs["fub:join"];
              const forced = join === "word" && !/[-‐–—]$/.test(text);
              const following = after.spans.map((span) => span.text).join("");
              const longer = [...line.spans, ...(join === "space" ? [{ text: " ", attrs: line.spans[line.spans.length - 1]?.attrs ?? null }] : []), ...head(after.spans, nextUnit(following, forced))];
              under = Math.min(under, width - rendered(host, attrs, longer));
            });
            const name = `${language} ${family.split(",")[0]} ${size}${spacing === null ? "" : `+${spacing}`} in ${width}`;
            const ok = over <= TOLERANCE && under < TOLERANCE && drift <= TOLERANCE;
            out.push({ name, lines: lines.length, over, under, drift, worst, ok });
          }
        }
      }
    }
  } finally {
    host.remove();
  }
  return out;
}

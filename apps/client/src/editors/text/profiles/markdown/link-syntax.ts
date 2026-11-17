// La grammatica dei link Markdown in un posto solo: come si scrive
// un'etichetta o una destinazione perché il parser legga il testo scelto, come
// si rilegge una destinazione scritta, come si confrontano due etichette e dove
// porta un `href`. La usano l'incolla, i comandi Link (editor e griglia), la
// resa e `Alt-Invio`: prima ognuno aveva la propria regola, e lo stesso link
// usciva diverso secondo il gesto che l'aveva scritto (D02, D14, D16, D25).

import { external, hasScheme } from "../../../../ui/sanitize";
import { HTML_NAMED_ENTITIES } from "./html-entities.generated";

const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;

/// Il testo di un'etichetta `[…]` che si legge come `text`: le parentesi
/// quadre diventano testo, gli escape già scritti restano com'erano e il codice
/// inline non si tocca, perché lì un `\` si vedrebbe.
export function escapeLinkLabel(text: string): string {
  let out = "";
  for (let index = 0; index < text.length; ) {
    const char = text[index]!;
    if (char === "`") {
      let run = 1;
      while (text[index + run] === "`") run++;
      const close = closingBackticks(text, index + run, run);
      const end = close === -1 ? index + run : close + run;
      out += text.slice(index, end);
      index = end;
      continue;
    }
    if (char === "\\") {
      const next = text[index + 1];
      if (next === undefined) {
        // Un `\` in coda proteggerebbe la `]` che chiude l'etichetta.
        out += "\\\\";
        index++;
      } else if (ASCII_PUNCTUATION.test(next)) {
        out += char + next;
        index += 2;
      } else {
        out += char;
        index++;
      }
      continue;
    }
    out += char === "[" || char === "]" ? `\\${char}` : char;
    index++;
  }
  return out;
}

function closingBackticks(text: string, from: number, run: number): number {
  for (let index = from; index < text.length; index++) {
    if (text[index] !== "`") continue;
    let length = 1;
    while (text[index + length] === "`") length++;
    if (length === run) return index;
    index += length - 1;
  }
  return -1;
}

/// La destinazione `(…)` di un link verso `url`: le parentesi, gli spazi e le
/// parentesi angolari si codificano, così il primo `)` non chiude il link a
/// metà dell'indirizzo. Un indirizzo già codificato resta com'è.
export function linkDestination(url: string): string {
  return url.replace(/[()<>\s]/gu, (char) => `%${char.codePointAt(0)!.toString(16).toUpperCase().padStart(2, "0")}`);
}

/// L'indirizzo che una destinazione scritta nomina: senza le parentesi
/// angolari, con gli escape e le entità risolti, come lo legge CommonMark.
export function decodeDestination(written: string): string {
  const raw = written.length >= 2 && written.startsWith("<") && written.endsWith(">")
    ? written.slice(1, -1)
    : written;
  return decodeEntities(raw.replace(/\\([!-/:-@[-`{-~])/g, "$1"));
}

/// Un riferimento nominato solo, `&nome;` e nient'altro. Il nome più lungo
/// della tabella (`CounterClockwiseContourIntegral`) ha 31 caratteri.
const NAMED_REFERENCE = /^&[A-Za-z][A-Za-z0-9]{1,31};$/;

/// Le entità HTML di un testo come le legge CommonMark: i riferimenti
/// numerici (`&#…;` con 1–7 cifre, `&#x…;` con 1–6 cifre esadecimali) e i
/// nominati della tabella di HTML, sempre con il `;` finale. Le forme senza
/// `;` (`&amp`, `&copy`) e i nomi che HTML non conosce restano testo. Un
/// numero che non è un carattere Unicode, e lo zero, diventano U+FFFD.
export function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[A-Za-z][A-Za-z0-9]{1,31});/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? "\uFFFD" : String.fromCodePoint(code);
    }
    return decodeNamedEntity(whole);
  });
}

/// Il carattere di un riferimento nominato come `&rarr;`, dalla tabella
/// completa di HTML (`html-entities.generated.ts`, generata dalla copia della
/// specifica in `vendor/whatwg-entities/`). Senza DOM: un testo che non è un
/// riferimento solo, o un nome che la tabella non ha, torna com'è.
export function decodeNamedEntity(reference: string): string {
  if (!NAMED_REFERENCE.test(reference)) return reference;
  const name = reference.slice(1, -1);
  return Object.prototype.hasOwnProperty.call(HTML_NAMED_ENTITIES, name) ? HTML_NAMED_ENTITIES[name]! : reference;
}

/// La chiave di un'etichetta di riferimento o di nota: spazi compressi e il
/// case folding di CommonMark, così `[ẞ]` trova `[SS]` e `Straße` `STRASSE`.
/// Passare per il maiuscolo dopo il minuscolo è il folding completo di
/// markdown-it: `ß` diventa `SS`, che `toLowerCase` da solo non fa.
export function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").normalize("NFC").toLowerCase().toUpperCase();
}

/// Dove porta un `href`: un punto di questo documento, una pagina web, un
/// altro schema che apre il sistema, o un percorso del vault relativo al
/// documento.
export type HrefRoute =
  | { readonly kind: "fragment"; readonly id: string }
  | { readonly kind: "web" }
  | { readonly kind: "system" }
  | { readonly kind: "path"; readonly path: string };

export function routeHref(href: string): HrefRoute {
  if (href.startsWith("#")) return { kind: "fragment", id: href.slice(1) };
  if (/^https?:/i.test(href)) return { kind: "web" };
  if (hasScheme(href) || external(href)) return { kind: "system" };
  return { kind: "path", path: safeDecode(href) };
}

/// Un `href` relativo arriva codificato (`Nota%20uno.md`), un path del vault no.
function safeDecode(href: string): string {
  try {
    return decodeURI(href);
  } catch {
    return href;
  }
}

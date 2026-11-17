// Il tratto di una nota Markdown che un'àncora nomina: la sezione di un
// titolo (`#Titolo`) o il blocco di un id (`#^id`), letti sul testo di adesso.
//
// È la lettura del client, senza IPC: serve alla superficie su un tratto
// (`range-surface.ts`), che deve ritrovare il suo pezzo a ogni battuta di
// un'altra superficie. Le regole sono quelle del kernel (`section_of` e
// `block_of` in `fub-kernel/src/workspace.rs`, `heading_matches` e
// `canonical_anchor` in `fub-abi/src/model.rs`): la sezione va dal titolo
// fino al prossimo titolo di livello pari o superiore; il blocco è quello che
// porta l'id, in coda alla sua ultima riga o su una riga sua dopo una vuota.
// Il testo è in `\n` (`lineFeeds`): gli offset sono quelli delle operazioni.

/// Un'àncora dentro una nota: il titolo di una sezione o l'id di un blocco.
export type SectionAnchor =
  | { readonly kind: "heading"; readonly heading: string }
  | { readonly kind: "block"; readonly id: string };

/// Un intervallo `[from, to)` di unità UTF-16 del testo in `\n`.
export interface TextSpan {
  readonly from: number;
  readonly to: number;
}

const BLOCK_ID = /^[\p{L}\p{N}_-]+$/u;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
const TRAILING_ID = /[ \t]\^([\p{L}\p{N}_-]+)[ \t]*$/u;
const LONE_ID = /^[ \t]*\^([\p{L}\p{N}_-]+)[ \t]*$/u;

/// Legge un'àncora come la scrive un link: `#Titolo`, `#^id`, o le stesse
/// senza il `#`. `null` per un'àncora vuota o un id che non è un id (lettere,
/// cifre, `-` e `_`, come `valid_anchor`).
export function parseSectionAnchor(fragment: string): SectionAnchor | null {
  const bare = fragment.trim().replace(/^#/, "").trim();
  if (bare.startsWith("^")) {
    const id = bare.slice(1).trim();
    return BLOCK_ID.test(id) ? { kind: "block", id } : null;
  }
  return bare === "" ? null : { kind: "heading", heading: bare };
}

/// L'àncora scritta come in un link, con il `#`.
export function formatSectionAnchor(anchor: SectionAnchor): string {
  return anchor.kind === "block" ? `#^${anchor.id}` : `#${anchor.heading}`;
}

interface Line {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  /// Dentro un blocco di codice recintato o nel frontmatter.
  readonly code: boolean;
}

interface Heading {
  /// La prima riga del titolo (per un setext, la prima del suo paragrafo).
  readonly line: number;
  readonly level: number;
  readonly text: string;
}

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  let from = 0;
  for (;;) {
    const end = text.indexOf("\n", from);
    const to = end < 0 ? text.length : end;
    out.push({ from, to, text: text.slice(from, to), code: false });
    if (end < 0) break;
    from = end + 1;
  }
  // Il terminatore finale del file non apre una riga: resta fuori da ogni
  // tratto, e scrivere in fondo alla nota non lo tocca.
  if (out.length > 1 && out[out.length - 1]!.from === text.length) out.pop();
  return markCode(out);
}

function markCode(lines: Line[]): Line[] {
  const out = [...lines];
  let start = 0;
  if (out[0]?.text.trimEnd() === "---") {
    for (let n = 1; n < out.length; n++) {
      const closing = out[n]!.text.trimEnd();
      if (closing === "---" || closing === "...") {
        for (let k = 0; k <= n; k++) out[k] = { ...out[k]!, code: true };
        start = n + 1;
        break;
      }
    }
  }
  let fence: string | null = null;
  for (let n = start; n < out.length; n++) {
    const line = out[n]!;
    const opening = FENCE.exec(line.text);
    if (fence !== null) {
      out[n] = { ...line, code: true };
      if (opening && opening[1]![0] === fence[0] && opening[1]!.length >= fence.length && line.text.trim() === opening[1]) {
        fence = null;
      }
    } else if (opening) {
      out[n] = { ...line, code: true };
      fence = opening[1]!;
    }
  }
  return out;
}

function blank(line: Line | undefined): boolean {
  return line === undefined || line.text.trim() === "";
}

function atx(line: Line): { level: number; text: string } | null {
  if (line.code) return null;
  const match = ATX.exec(line.text);
  return match ? { level: match[1]!.length, text: match[2] ?? "" } : null;
}

/// Una riga che può stare in un paragrafo, quindi sopra una sottolineatura
/// setext: non vuota, non un titolo, non codice, non una citazione o una voce.
function paragraphLine(line: Line | undefined): boolean {
  return line !== undefined && !line.code && !blank(line) && atx(line) === null
    && !/^ {0,3}>/.test(line.text) && !LIST_ITEM.test(line.text);
}

function headingsOf(lines: readonly Line[]): Heading[] {
  const out: Heading[] = [];
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!;
    const hash = atx(line);
    if (hash) {
      out.push({ line: n, level: hash.level, text: hash.text });
      continue;
    }
    if (line.code || n === 0 || !SETEXT.test(line.text) || !paragraphLine(lines[n - 1])) continue;
    let first = n - 1;
    while (first > 0 && paragraphLine(lines[first - 1]) && !out.some((h) => h.line === first - 1)) first--;
    const text = lines.slice(first, n).map((l) => l.text.trim()).join(" ");
    out.push({ line: first, level: line.text.trim().startsWith("=") ? 1 : 2, text });
  }
  return out;
}

/// Il testo di un titolo senza i segni più comuni: enfasi, codice, link.
function plainHeading(text: string): string {
  return text
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~=]+/g, "")
    .trim();
}

/// `heading_slug` del contratto: minuscolo, lettere e cifre, uno spazio o un
/// trattino diventano un trattino solo, il resto della punteggiatura sparisce.
function headingSlug(text: string): string {
  let slug = "";
  let lastDash = false;
  for (const char of text.normalize("NFC")) {
    if (/[\p{Alphabetic}\p{N}]/u.test(char)) {
      slug += char.toLowerCase();
      lastDash = false;
    } else if ((/\s/u.test(char) || char === "-" || char === "_") && !lastDash && slug !== "") {
      slug += "-";
      lastDash = true;
    }
  }
  return slug.replace(/-+$/, "");
}

/// `resolution_key` del contratto: trim, NFC, minuscolo.
function resolutionKey(text: string): string {
  return text.trim().normalize("NFC").toLowerCase();
}

/// Gli slug di tutti i titoli, coi doppioni numerati come `HeadingSlugs`.
function slugsOf(headings: readonly Heading[]): string[] {
  const taken = new Set<string>();
  return headings.map((heading) => {
    const base = headingSlug(plainHeading(heading.text));
    if (!taken.has(base)) {
      taken.add(base);
      return base;
    }
    for (let n = 1; ; n++) {
      const candidate = base === "" ? String(n) : `${base}-${n}`;
      if (!taken.has(candidate)) {
        taken.add(candidate);
        return candidate;
      }
    }
  });
}

function sections(lines: readonly Line[], wanted: string): TextSpan[] {
  const headings = headingsOf(lines);
  const slugs = slugsOf(headings);
  const slug = headingSlug(wanted);
  const key = resolutionKey(wanted);
  const out: TextSpan[] = [];
  headings.forEach((heading, index) => {
    if (slugs[index] !== slug && resolutionKey(plainHeading(heading.text)) !== key && resolutionKey(heading.text) !== key) return;
    const next = headings.slice(index + 1).find((h) => h.level <= heading.level);
    let last = next === undefined ? lines.length - 1 : next.line - 1;
    // Le righe vuote prima del titolo dopo separano le sezioni: restano fuori,
    // e ciò che si scrive in fondo al tratto non si attacca al titolo dopo.
    while (last > heading.line && blank(lines[last])) last--;
    out.push({ from: lines[heading.line]!.from, to: lines[Math.max(last, heading.line)]!.to });
  });
  return out;
}

/// La prima riga del blocco che finisce alla riga `last`: si risale finché le
/// righe sono piene, senza passare un titolo e fermandosi all'inizio di una
/// voce d'elenco.
function blockStart(lines: readonly Line[], last: number): number {
  const end = lines[last]!;
  if (atx(end)) return last;
  if (end.code) {
    // La chiusura di un recinto: il blocco è il recinto intero.
    let first = last;
    while (first > 0 && lines[first - 1]!.code) first--;
    return first;
  }
  let first = last;
  while (
    first > 0 &&
    !LIST_ITEM.test(lines[first]!.text) &&
    !blank(lines[first - 1]) &&
    !lines[first - 1]!.code &&
    atx(lines[first - 1]!) === null
  ) {
    first--;
  }
  return first;
}

/// Il blocco che chiude un elenco, una citazione o una tabella sopra un id su
/// una riga sua: tutte le righe piene fino alla vuota precedente.
function wholeBlockStart(lines: readonly Line[], last: number): number {
  const end = lines[last]!;
  if (end.code || atx(end)) return blockStart(lines, last);
  let first = last;
  while (first > 0 && !blank(lines[first - 1]) && !lines[first - 1]!.code && atx(lines[first - 1]!) === null) first--;
  return first;
}

function blocks(lines: readonly Line[], wanted: string): TextSpan[] {
  const key = resolutionKey(wanted);
  const out: TextSpan[] = [];
  lines.forEach((line, n) => {
    if (line.code) return;
    const lone = LONE_ID.exec(line.text);
    if (lone) {
      if (resolutionKey(lone[1]!) !== key) return;
      if (n > 1 && blank(lines[n - 1]) && !blank(lines[n - 2])) {
        out.push({ from: lines[wholeBlockStart(lines, n - 2)]!.from, to: line.to });
      } else if (n > 0 && !blank(lines[n - 1]) && !lines[n - 1]!.code) {
        out.push({ from: lines[blockStart(lines, n - 1)]!.from, to: line.to });
      }
      return;
    }
    const tail = TRAILING_ID.exec(line.text);
    if (tail && resolutionKey(tail[1]!) === key) out.push({ from: lines[blockStart(lines, n)]!.from, to: line.to });
  });
  return out;
}

/// Il tratto che l'àncora nomina nel testo `text` (in `\n`), o `null` se non
/// c'è più. Fra più tratti con la stessa àncora vince quello che comincia più
/// vicino a `near`; senza `near`, il primo, come il kernel.
export function resolveSectionAnchor(text: string, anchor: SectionAnchor, near?: number): TextSpan | null {
  const lines = linesOf(text);
  const found = anchor.kind === "heading" ? sections(lines, anchor.heading) : blocks(lines, anchor.id);
  if (found.length === 0) return null;
  if (near === undefined) return found[0]!;
  let best = found[0]!;
  for (const span of found) {
    if (Math.abs(span.from - near) < Math.abs(best.from - near)) best = span;
  }
  return best;
}

// I fogli di stile di un SVG incollato. Il CSS non si interpreta: si
// riscrivono soltanto i riferimenti agli id, che l'incolla cambia, e i
// selettori, perché un foglio di un altro programma valga solo dentro il
// gruppo che lo porta e non cambi il resto del disegno.
//
// - **Riferimenti:** un `#id` nei selettori e un `url(#id)` ovunque prendono
//   l'id nuovo; un `#` nei valori è un colore, e resta.
// - **Ambito:** ogni selettore comincia dal gruppo, `#gruppo …`; uno che
//   comincia dalla radice, con `svg`, `:root` o il suo id, comincia invece
//   col gruppo stesso. Le regole dentro `@media`, `@supports`, `@container`,
//   `@layer` e `@scope` seguono la stessa regola; le altre at-rule, come
//   `@font-face` e `@keyframes`, non hanno selettori e restano come sono.
// - Il testo fra le regole, i commenti e gli spazi restano byte per byte.

/// Le at-rule che contengono altre regole.
const GROUPING: ReadonlySet<string> = new Set(["media", "supports", "container", "layer", "scope", "document", "-moz-document"]);

/// Come cambia un foglio: l'id nuovo di un id, `null` se resta; e, se il
/// foglio va chiuso in un gruppo, l'id del gruppo.
export interface Restyle {
  readonly rename: (id: string) => string | null;
  readonly scope: string | null;
}

/// Vero per un carattere che continua un nome CSS.
function isNameChar(c: string): boolean {
  return /[A-Za-z0-9_-]/.test(c) || c.charCodeAt(0) >= 0x80;
}

/// La fine di una stringa CSS che comincia in `at`, con le virgolette.
function stringEnd(css: string, at: number): number {
  const quote = css[at]!;
  let i = at + 1;
  while (i < css.length && css[i] !== quote && css[i] !== "\n") i += css[i] === "\\" ? 2 : 1;
  return Math.min(i + 1, css.length);
}

/// La fine di un commento che comincia in `at`.
function commentEnd(css: string, at: number): number {
  const end = css.indexOf("*/", at + 2);
  return end < 0 ? css.length : end + 2;
}

/// La fine di un escape CSS che comincia in `at`, sul `\`.
function escapeEnd(css: string, at: number): number {
  let i = at + 1;
  if (i >= css.length) return i;
  if (/[0-9A-Fa-f]/.test(css[i]!)) {
    const start = i;
    while (i < css.length && i - start < 6 && /[0-9A-Fa-f]/.test(css[i]!)) i++;
    if (css[i] === " " || css[i] === "\t" || css[i] === "\n") i++;
    return i;
  }
  return i + 1;
}

/// Il nome che comincia in `at`, con i suoi escape: la fine e il nome letto.
function readName(css: string, at: number): [end: number, name: string] {
  let i = at;
  let name = "";
  while (i < css.length) {
    const c = css[i]!;
    if (c === "\\") {
      const end = escapeEnd(css, i);
      const body = css.slice(i + 1, end).trim();
      name += /^[0-9A-Fa-f]+$/.test(body) ? String.fromCodePoint(Math.min(parseInt(body, 16), 0x10ffff) || 0xfffd) : body;
      i = end;
    } else if (isNameChar(c)) {
      name += c;
      i++;
    } else {
      break;
    }
  }
  return [i, name];
}

/// Un nome scritto in CSS: i caratteri che non continuano un nome passano
/// per un escape.
function writeName(name: string): string {
  let out = "";
  for (const c of name) out += isNameChar(c) && !(out === "" && /[0-9]/.test(c)) ? c : `\\${c.codePointAt(0)!.toString(16)} `;
  return out;
}

/// `text` con ogni `url(#id)` riscritto: vale per i valori e per l'attributo
/// `style`.
export function renameUrls(text: string, rename: (id: string) => string | null): string {
  return text.replace(/url\(\s*(["']?)#([^"')\s]+)\1\s*\)/gi, (whole, quote: string, id: string) => {
    const next = rename(id);
    return next === null ? whole : `url(${quote}#${next}${quote})`;
  });
}

/// Il foglio di stile `css` riscritto come chiede `restyle`.
export function restyle(css: string, change: Restyle): string {
  return new Rewriter(css, change).rules(0, css.length);
}

class Rewriter {
  constructor(
    private readonly css: string,
    private readonly change: Restyle,
  ) {}

  /// Le regole fra `from` e `to`.
  rules(from: number, to: number): string {
    const css = this.css;
    let out = "";
    let i = from;
    while (i < to) {
      const c = css[i]!;
      if (/\s/.test(c) || c === ";" || c === "}") {
        out += c;
        i++;
        continue;
      }
      if (c === "/" && css[i + 1] === "*") {
        const end = Math.min(commentEnd(css, i), to);
        out += css.slice(i, end);
        i = end;
        continue;
      }
      if (c === "<" && css.startsWith("<!--", i)) {
        out += "<!--";
        i += 4;
        continue;
      }
      if (c === "-" && css.startsWith("-->", i)) {
        out += "-->";
        i += 3;
        continue;
      }
      const [end, text] = c === "@" ? this.atRule(i, to) : this.rule(i, to);
      out += text;
      i = end;
    }
    return out;
  }

  /// La fine del preludio che comincia in `at`: il `{` o il `;` fuori da
  /// stringhe, commenti e parentesi, o `to`.
  private preludeEnd(at: number, to: number): number {
    const css = this.css;
    let depth = 0;
    let i = at;
    while (i < to) {
      const c = css[i]!;
      if (c === '"' || c === "'") i = stringEnd(css, i);
      else if (c === "/" && css[i + 1] === "*") i = commentEnd(css, i);
      else if (c === "\\") i = escapeEnd(css, i);
      else if (c === "(" || c === "[") (depth++, i++);
      else if (c === ")" || c === "]") (depth = Math.max(0, depth - 1), i++);
      else if (depth === 0 && (c === "{" || c === ";" || c === "}")) return i;
      else i++;
    }
    return Math.min(i, to);
  }

  /// La fine del blocco che si apre col `{` in `at`, dopo il `}` che lo
  /// chiude, o `to`.
  private blockEnd(at: number, to: number): number {
    const css = this.css;
    let depth = 0;
    let i = at;
    while (i < to) {
      const c = css[i]!;
      if (c === '"' || c === "'") i = stringEnd(css, i);
      else if (c === "/" && css[i + 1] === "*") i = commentEnd(css, i);
      else if (c === "\\") i = escapeEnd(css, i);
      else if (c === "{") (depth++, i++);
      else if (c === "}") {
        depth--;
        i++;
        if (depth === 0) return i;
      } else i++;
    }
    return Math.min(i, to);
  }

  /// Una regola coi selettori: il preludio riscritto, il blocco coi soli
  /// `url(#id)` riscritti.
  private rule(at: number, to: number): [number, string] {
    const css = this.css;
    const end = this.preludeEnd(at, to);
    const prelude = this.selectors(css.slice(at, end));
    if (end >= to || css[end] !== "{") return [end, prelude];
    const close = this.blockEnd(end, to);
    return [close, prelude + renameUrls(css.slice(end, close), this.change.rename)];
  }

  /// Un'at-rule: dentro quelle che raggruppano regole si riscrivono le
  /// regole, nelle altre solo gli `url(#id)`.
  private atRule(at: number, to: number): [number, string] {
    const css = this.css;
    const [nameEnd, name] = readName(css, at + 1);
    const end = this.preludeEnd(nameEnd, to);
    const prelude = renameUrls(css.slice(at, end), this.change.rename);
    if (end >= to || css[end] !== "{") return [end, prelude];
    const close = this.blockEnd(end, to);
    if (!GROUPING.has(name.toLowerCase())) return [close, prelude + renameUrls(css.slice(end, close), this.change.rename)];
    const inner = css[close - 1] === "}" ? close - 1 : close;
    return [close, `${prelude}{${this.rules(end + 1, inner)}${css.slice(inner, close)}`];
  }

  /// Una lista di selettori, ognuno riscritto.
  private selectors(prelude: string): string {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    let i = 0;
    while (i < prelude.length) {
      const c = prelude[i]!;
      if (c === '"' || c === "'") i = stringEnd(prelude, i);
      else if (c === "/" && prelude[i + 1] === "*") i = commentEnd(prelude, i);
      else if (c === "\\") i = escapeEnd(prelude, i);
      else if (c === "(" || c === "[") (depth++, i++);
      else if (c === ")" || c === "]") (depth = Math.max(0, depth - 1), i++);
      else if (c === "," && depth === 0) {
        out.push(this.selector(prelude.slice(start, i)));
        start = ++i;
      } else i++;
    }
    out.push(this.selector(prelude.slice(start)));
    return out.join(",");
  }

  /// Un selettore: gli `#id` rinominati e, se il foglio va chiuso in un
  /// gruppo, l'inizio dal gruppo.
  private selector(text: string): string {
    let renamed = "";
    let depth = 0;
    let i = 0;
    while (i < text.length) {
      const c = text[i]!;
      if (c === '"' || c === "'" || (c === "/" && text[i + 1] === "*")) {
        const end = c === "/" ? commentEnd(text, i) : stringEnd(text, i);
        renamed += text.slice(i, end);
        i = end;
      } else if (c === "\\") {
        const end = escapeEnd(text, i);
        renamed += text.slice(i, end);
        i = end;
      } else if (c === "#" && depth === 0) {
        const [end, name] = readName(text, i + 1);
        const next = name === "" ? null : this.change.rename(name);
        renamed += next === null ? text.slice(i, end) : `#${writeName(next)}`;
        i = Math.max(end, i + 1);
      } else {
        if (c === "[") depth++;
        else if (c === "]") depth = Math.max(0, depth - 1);
        renamed += c;
        i++;
      }
    }
    const scope = this.change.scope;
    if (scope === null) return renamed;
    const lead = /^(?:\s|\/\*[\s\S]*?\*\/)*/.exec(renamed)![0];
    const trail = /(?:\s|\/\*[\s\S]*?\*\/)*$/.exec(renamed.slice(lead.length))![0];
    const body = renamed.slice(lead.length, renamed.length - trail.length);
    if (body === "") return renamed;
    const self = `#${writeName(scope)}`;
    // La radice dell'SVG incollato è il gruppo che lo porta.
    const root = /^(?:svg(?![A-Za-z0-9_\\-])|:root(?![A-Za-z0-9_-]))/i.exec(body);
    if (root !== null) return `${lead}${self}${body.slice(root[0].length)}${trail}`;
    if (body === self || (body.startsWith(self) && !isNameChar(body[self.length] ?? " "))) return renamed;
    return `${lead}${self} ${body}${trail}`;
  }
}

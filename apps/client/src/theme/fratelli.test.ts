// **Nessun fratello senza nome** a sinistra di `+` o `~`.
//
// # Perché
//
// Un selettore come `.settings-card > :not([hidden]) ~ *` ha a destra un
// soggetto universale: Chromium (e WebKit) lo prova su **ogni** elemento della
// pagina, e solo dopo il `~` guarda se il padre è `.settings-card`. Provandolo,
// segna ogni padre come «toccato da una regola di fratelli», e la parte a
// sinistra del `~`, senza classe né attributo, vale per qualsiasi fratello.
// Da lì ogni riga che CodeMirror toglie o aggiunge nella Scrittura fa
// ricalcolare i fratelli che seguono, e con loro le schede vive che ci stanno
// dentro. Misurato (novembre 2026, nota `schede-40` del banco della battuta):
// spostare il cursore accanto a quaranta schede vive costava 14 ms, e ognuna
// delle cinque regole di questa forma bastava da sola a farlo costare così
// (`docs/product/live-cards-measures.md`).
//
// La forma buona dice chi è il fratello: `.x:not(.x + :where(.x))` invece di
// `:not(.x) + .x`, `:nth-child(n + 2 of :not([hidden]))` invece di
// `:not([hidden]) ~ *`.
//
// # Che cosa guarda
//
// Ogni foglio CSS sotto `src/` (la pelle nei suoi pezzi, non `skin.css` che è
// il loro derivato). Per ogni combinatore `+` e `~` di primo livello, e dentro
// `:is()`, `:where()`, `:not()` e `:nth-child(… of …)`, il composto a sinistra
// deve avere una classe, un id o un attributo fuori da ogni parentesi. Un
// tipo (`li + li`, `th + th`) non basta: Chromium non usa i nomi dei tag per
// scegliere chi ricalcolare, e la regola finisce nello stesso insieme
// universale. L'argomento di `:has()` è relativo all'elemento che lo porta, e
// non si guarda.
import postcss, { type Rule } from "postcss";
import { describe, expect, it } from "vitest";

const SHEETS: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob("/src/**/*.css", { query: "?raw", import: "default", eager: true }))
    .filter(([path]) => path !== "/src/theme/scrittoio/skin.css")
    .map(([path, text]) => [path, text as string]),
);

/// Le parti di `text` fra i separatori di primo livello, fuori da parentesi,
/// attributi e stringhe.
function topLevel(text: string, visit: (ch: string, at: number) => void): void {
  let depth = 0;
  let quote: string | null = null;
  for (let at = 0; at < text.length; at += 1) {
    const ch = text[at]!;
    if (quote) {
      if (ch === "\\") at += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "]") depth -= 1;
    else if (depth === 0) visit(ch, at);
  }
}

function splitList(text: string): string[] {
  const parts: string[] = [];
  let from = 0;
  topLevel(text, (ch, at) => {
    if (ch === ",") {
      parts.push(text.slice(from, at));
      from = at + 1;
    }
  });
  parts.push(text.slice(from));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/// Un composto ha un nome se, fuori dalle parentesi, ha una classe, un id, un
/// attributo o un tipo (non `*`).
function named(compound: string): boolean {
  let found = false;
  let depth = 0;
  for (let at = 0; at < compound.length; at += 1) {
    const ch = compound[at]!;
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (depth > 0) continue;
    else if (ch === "." || ch === "#" || ch === "[") found = true;
  }
  return found;
}

/// `selector` senza gli argomenti di `:has()`, che restano `:has()`.
function withoutHas(selector: string): string {
  let out = "";
  let at = 0;
  for (let found = selector.indexOf(":has(", at); found >= 0; found = selector.indexOf(":has(", at)) {
    out += selector.slice(at, found) + ":has()";
    let depth = 1;
    at = found + ":has(".length;
    while (at < selector.length && depth > 0) {
      if (selector[at] === "(") depth += 1;
      else if (selector[at] === ")") depth -= 1;
      at += 1;
    }
  }
  return out + selector.slice(at);
}

/// Gli argomenti delle pseudo-classi che contengono selettori completi.
function nestedLists(selector: string): string[] {
  const out: string[] = [];
  const re = /:(is|where|not|nth-child|nth-last-child)\(/g;
  for (let match = re.exec(selector); match; match = re.exec(selector)) {
    let depth = 1;
    let at = match.index + match[0].length;
    const start = at;
    while (at < selector.length && depth > 0) {
      if (selector[at] === "(") depth += 1;
      else if (selector[at] === ")") depth -= 1;
      at += 1;
    }
    let inner = selector.slice(start, at - 1);
    if (match[1]!.startsWith("nth")) {
      const of = /\sof\s/.exec(inner);
      if (!of) continue;
      inner = inner.slice(of.index + of[0].length);
    }
    out.push(...splitList(inner));
  }
  return out;
}

/// I fratelli senza nome di `selector`: il composto a sinistra di ogni `+` e
/// `~`, quando non ha un nome.
function unnamedSiblings(selector: string): string[] {
  const out: string[] = [];
  // L'argomento di `:has()` non conta: si toglie prima di leggere.
  const plain = withoutHas(selector);
  const compounds: { text: string; combinator: string | null }[] = [];
  let from = 0;
  let combinator: string | null = null;
  const close = (to: number) => {
    const text = plain.slice(from, to).trim();
    if (text) compounds.push({ text, combinator: compounds.length === 0 ? null : (combinator ?? " ") });
    if (text) combinator = null;
  };
  topLevel(plain, (ch, at) => {
    const space = /\s/.test(ch);
    if (!space && ch !== ">" && ch !== "+" && ch !== "~") return;
    close(at);
    if (!space) combinator = ch;
    from = at + 1;
  });
  close(plain.length);
  for (let at = 1; at < compounds.length; at += 1) {
    const sign = compounds[at]!.combinator;
    const left = compounds[at - 1]!.text;
    if ((sign === "+" || sign === "~") && !named(left)) out.push(`${left} ${sign} ${compounds[at]!.text}`);
  }
  for (const inner of nestedLists(plain)) out.push(...unnamedSiblings(inner));
  return out;
}

/// Le eccezioni, una per selettore, ognuna col suo perché.
const EXCEPTIONS: Record<string, string> = {
  // Il rientro dei paragrafi che si seguono, nella stampa: un paragrafo non ha
  // classe, e `p + p` non ha una forma con un nome. Misurato: tenerla non
  // cambia il costo del cursore accanto alle schede vive (5,6–5,9 ms contro
  // 5,3–5,5 ms senza, nota `schede-40`).
  ":is(.export-measure, .export-page) .print-page .markdown-rendered > p + p": "rientro della stampa",
};

describe("i selettori di fratelli dicono chi è il fratello", () => {
  it("la prova riconosce le forme costose e lascia passare quelle buone", () => {
    expect(unnamedSiblings(".settings-card > :not([hidden]) ~ *")).toHaveLength(1);
    expect(unnamedSiblings(".settings-catalog-results > * + *")).toHaveLength(1);
    expect(unnamedSiblings(".cm-editor .cm-content :not(.cm-fub-callout-line) + .cm-fub-callout-line")).toHaveLength(1);
    expect(unnamedSiblings(".a :is(:not(.b) ~ .c)")).toHaveLength(1);
    expect(unnamedSiblings(".a > :nth-child(n + 2 of :not([hidden]))")).toEqual([]);
    expect(unnamedSiblings(".x:not(.x + :where(.x))")).toEqual([]);
    expect(unnamedSiblings(".rich-list + :not(.rich-list)")).toEqual([]);
    expect(unnamedSiblings("li:hover + li")).toHaveLength(1);
    expect(unnamedSiblings(".base-table th + th")).toHaveLength(1);
    expect(unnamedSiblings(".modale .draw-export-option input:disabled + span")).toHaveLength(1);
    expect(unnamedSiblings(".x:not(:has(+ .x))")).toEqual([]);
    expect(unnamedSiblings(".x:has(+ :not(.x))")).toEqual([]);
    expect(unnamedSiblings(".a > [role=\"tablist\"] + .tab-entry")).toEqual([]);
  });

  it("nessun foglio sotto src/ ha un fratello senza nome", () => {
    expect(Object.keys(SHEETS).length).toBeGreaterThan(20);
    const found: string[] = [];
    for (const [path, text] of Object.entries(SHEETS)) {
      postcss.parse(text, { from: path }).walkRules((rule: Rule) => {
        if (rule.parent?.type === "atrule" && /keyframes$/i.test((rule.parent as { name: string }).name)) return;
        for (const selector of rule.selectors) {
          if (selector in EXCEPTIONS) continue;
          for (const bad of unnamedSiblings(selector)) found.push(`${path}:${rule.source?.start?.line ?? "?"} ${bad}`);
        }
      });
    }
    expect(found).toEqual([]);
  });

  it("ogni eccezione esiste ancora", () => {
    const all = new Set(Object.values(SHEETS).flatMap((text) => {
      const out: string[] = [];
      postcss.parse(text).walkRules((rule: Rule) => out.push(...rule.selectors));
      return out;
    }));
    expect(Object.keys(EXCEPTIONS).filter((selector) => !all.has(selector))).toEqual([]);
  });
});

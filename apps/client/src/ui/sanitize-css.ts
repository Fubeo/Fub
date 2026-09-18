import postcss, { type AtRule, type ChildNode, type Declaration, type Root, type Rule } from "postcss";

export type ThemeCssViolationCode =
  | "syntax-error"
  | "at-import"
  | "at-namespace"
  | "remote-url"
  | "asset-namespace"
  | "selector-hook"
  | "selector-id"
  | "selector-token"
  | "structural-property"
  | "disallowed-value"
  | "missing-role";

export interface ThemeCssViolation {
  readonly code: ThemeCssViolationCode;
  readonly detail: string;
  readonly line: number;
  readonly column: number;
}

export interface ThemeCssPolicy {
  readonly assetNamespace: string;
  readonly allowedHooks: readonly string[];
  readonly requiredRoles?: readonly string[];
  readonly kind?: "sheet" | "skin";
}

const STRUCTURAL_PROPERTIES = new Set([
  "all",
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "inset",
  "margin",
  "padding",
  "aspect-ratio",
  "width",
  "height",
  "box-sizing",
  "float",
  "clear",
  "resize",
  "overflow",
  "z-index",
  "order",
  "flex",
  "flex-flow",
  "grid",
  "gap",
  "columns",
  "border",
  "border-width",
  "border-style",
]);

const STRUCTURAL_PREFIXES = [
  "margin-",
  "padding-",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "inset-",
  "overflow-",
  "flex-",
  "grid-",
  "align-",
  "justify-",
  "place-",
  "column-",
] as const;

interface IndexedViolation extends ThemeCssViolation {
  readonly index: number;
}

interface Token {
  readonly text: string;
  readonly index: number;
}

interface IndexedUrl {
  readonly value: string;
  /** Function/candidate start, used for diagnostics and stable ordering. */
  readonly index: number;
  /** Exact range of the URL payload, excluding quotes and surrounding trivia. */
  readonly start: number;
  readonly end: number;
}
interface ImageSetAnalysis {
  readonly candidates: IndexedUrl[];
  readonly invalid: string | null;
}

interface QuotedRange {
  readonly value: string;
  readonly next: number;
  readonly start: number;
  readonly end: number;
}

interface ImageSetIssue {
  readonly detail: string;
  readonly index: number;
}

export class ThemeCssError extends Error {
  readonly violations: readonly ThemeCssViolation[];

  constructor(violations: readonly ThemeCssViolation[]) {
    super(
      [
        "Foglio del tema rifiutato:",
        ...violations.map(
          ({ code, detail, line, column }) => `- ${code} (${line}:${column}): ${detail}`,
        ),
      ].join("\n"),
    );
    this.name = "ThemeCssError";
    this.violations = violations;
  }
}

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function indexAt(source: string, line: number, column: number): number {
  let index = 0;
  let current = 1;
  while (current < line && index < source.length) {
    const next = source.indexOf("\n", index);
    if (next < 0) return source.length;
    index = next + 1;
    current += 1;
  }
  return Math.min(source.length, index + Math.max(0, column - 1));
}

function nodeIndex(source: string, node: ChildNode | Root): number {
  const start = node.source?.start;
  return start ? indexAt(source, start.line, start.column) : 0;
}

function location(source: string, index: number): Pick<ThemeCssViolation, "line" | "column"> {
  const before = source.slice(0, Math.max(0, Math.min(index, source.length)));
  const lines = before.split("\n");
  return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
}

function violation(
  source: string,
  index: number,
  code: ThemeCssViolationCode,
  detail: string,
): IndexedViolation {
  return { code, detail, index, ...location(source, index) };
}

function parse(source: string): Root {
  return postcss.parse(source, { from: undefined });
}

function syntaxViolation(source: string, error: unknown): IndexedViolation {
  const value = error as { line?: number; column?: number; reason?: string; message?: string };
  const line = Math.max(1, value.line ?? 1);
  const column = Math.max(1, value.column ?? 1);
  const index = indexAt(source, line, column);
  return violation(source, index, "syntax-error", value.reason ?? value.message ?? "CSS non valido");
}

function decodeEscape(input: string, start: number): { value: string; next: number } {
  let i = start + 1;
  if (i >= input.length) return { value: "", next: i };
  const hexStart = i;
  while (i < input.length && i - hexStart < 6 && /[0-9a-fA-F]/.test(input[i]!)) i += 1;
  if (i > hexStart) {
    const code = Number.parseInt(input.slice(hexStart, i), 16);
    if (i < input.length && /\s/.test(input[i]!)) i += 1;
    const safe = code === 0 || code > 0x10ffff ? 0xfffd : code;
    return { value: String.fromCodePoint(safe), next: i };
  }
  if (input[i] === "\n" || input[i] === "\r" || input[i] === "\f") {
    return { value: "", next: i + 1 };
  }
  return { value: input[i]!, next: i + 1 };
}

export function decodeCssEscapes(input: string): string {
  let out = "";
  for (let i = 0; i < input.length; ) {
    if (input[i] !== "\\") {
      out += input[i]!;
      i += 1;
      continue;
    }
    const escaped = decodeEscape(input, i);
    out += escaped.value;
    i = escaped.next;
  }
  return out;
}

function identifier(input: string, start: number): { value: string; next: number } | null {
  let i = start;
  let value = "";
  while (i < input.length) {
    const ch = input[i]!;
    if (/[-_a-zA-Z0-9]/.test(ch) || ch.codePointAt(0)! >= 0x80) {
      value += ch;
      i += 1;
      continue;
    }
    if (ch === "\\") {
      const escaped = decodeEscape(input, i);
      value += escaped.value;
      i = escaped.next;
      continue;
    }
    break;
  }
  return value === "" ? null : { value, next: i };
}

function skipQuoted(input: string, start: number): number {
  const quote = input[start]!;
  let i = start + 1;
  while (i < input.length) {
    if (input[i] === "\\") {
      i = decodeEscape(input, i).next;
      continue;
    }
    if (input[i] === quote) return i + 1;
    i += 1;
  }
  return i;
}

function skipComment(input: string, start: number): number {
  const close = input.indexOf("*/", start + 2);
  return close < 0 ? input.length : close + 2;
}
function imageSetName(name: string): boolean {
  return name === "image-set" || name === "-webkit-image-set";
}

function functionClose(input: string, open: number): number | null {
  let depth = 1;
  for (let i = open + 1; i < input.length; ) {
    if (input.startsWith("/*", i)) {
      i = skipComment(input, i);
      continue;
    }
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i]!;
      let closed = false;
      i += 1;
      while (i < input.length) {
        if (input[i] === "\\") i = decodeEscape(input, i).next;
        else if (input[i] === quote) {
          i += 1;
          closed = true;
          break;
        } else i += 1;
      }
      if (!closed) return null;
      continue;
    }
    if (input[i] === "\\") i = decodeEscape(input, i).next;
    else if (input[i] === "(") {
      depth += 1;
      i += 1;
    } else if (input[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
      i += 1;
    } else i += 1;
  }
  return null;
}

function skipTrivia(input: string, start: number, end: number): number {
  let i = start;
  while (i < end) {
    if (/\s/.test(input[i]!)) i += 1;
    else if (input.startsWith("/*", i)) i = Math.min(end, skipComment(input, i));
    else break;
  }
  return i;
}

function quotedRange(input: string, start: number, end: number): QuotedRange | null {
  const quote = input[start];
  if (quote !== '"' && quote !== "'") return null;
  let i = start + 1;
  while (i < end) {
    if (input[i] === "\\") i = decodeEscape(input, i).next;
    else if (input[i] === quote) {
      const [valueStart, valueEnd] = trimRange(input, start + 1, i);
      return {
        value: decodeCssEscapes(input.slice(valueStart, valueEnd)).trim(),
        next: i + 1,
        start: valueStart,
        end: valueEnd,
      };
    } else i += 1;
  }
  return null;
}

function trimRange(input: string, start: number, end: number): [number, number] {
  let valueStart = start;
  let valueEnd = end;
  while (valueStart < valueEnd && /\s/.test(input[valueStart]!)) valueStart += 1;
  while (valueEnd > valueStart && /\s/.test(input[valueEnd - 1]!)) valueEnd -= 1;
  return [valueStart, valueEnd];
}

function topLevelCommaRanges(input: string, start: number, end: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let depth = 0;
  let piece = start;
  for (let i = start; i < end; ) {
    if (input.startsWith("/*", i)) i = skipComment(input, i);
    else if (input[i] === '"' || input[i] === "'") i = Math.min(end, skipQuoted(input, i));
    else if (input[i] === "\\") i = decodeEscape(input, i).next;
    else if (input[i] === "(") {
      depth += 1;
      i += 1;
    } else if (input[i] === ")") {
      depth = Math.max(0, depth - 1);
      i += 1;
    } else if (input[i] === "," && depth === 0) {
      ranges.push([piece, i]);
      piece = i + 1;
      i += 1;
    } else i += 1;
  }
  ranges.push([piece, end]);
  return ranges;
}

function analyzeImageSet(input: string, open: number): ImageSetAnalysis {
  const candidates: IndexedUrl[] = [];
  const close = functionClose(input, open);
  if (close === null) return { candidates, invalid: "parentesi non bilanciate" };

  for (const [start, end] of topLevelCommaRanges(input, open + 1, close)) {
    let cursor = skipTrivia(input, start, end);
    if (cursor >= end) return { candidates, invalid: "candidate vuoto" };
    if (input[cursor] === '"' || input[cursor] === "'") {
      const quoted = quotedRange(input, cursor, end);
      if (!quoted) return { candidates, invalid: "candidate stringa non valido" };
      candidates.push({
        value: quoted.value,
        index: cursor,
        start: quoted.start,
        end: quoted.end,
      });
      cursor = quoted.next;
    } else {
      const imageIndex = cursor;
      const image = identifier(input, cursor);
      if (!image || decodeCssEscapes(image.value).toLowerCase() !== "url") {
        return { candidates, invalid: "candidate non classificabile" };
      }
      cursor = skipTrivia(input, image.next, end);
      if (input[cursor] !== "(") return { candidates, invalid: "url() non valido" };
      const imageClose = functionClose(input, cursor);
      if (imageClose === null || imageClose >= end) return { candidates, invalid: "url() non valido" };
      const urlStart = skipTrivia(input, cursor + 1, imageClose);
      if (urlStart < imageClose && (input[urlStart] === '"' || input[urlStart] === "'")) {
        const quoted = quotedRange(input, urlStart, imageClose);
        if (!quoted || skipTrivia(input, quoted.next, imageClose) !== imageClose) {
          return { candidates, invalid: "url() non valido" };
        }
        candidates.push({
          value: quoted.value,
          index: imageIndex,
          start: quoted.start,
          end: quoted.end,
        });
      } else {
        const [valueStart, valueEnd] = trimRange(input, urlStart, imageClose);
        candidates.push({
          value: decodeCssEscapes(input.slice(valueStart, valueEnd)).trim(),
          index: imageIndex,
          start: valueStart,
          end: valueEnd,
        });
      }
      cursor = imageClose + 1;
    }

    let resolution = false;
    let type = false;
    while ((cursor = skipTrivia(input, cursor, end)) < end) {
      const descriptor = identifier(input, cursor);
      const descriptorName = descriptor && decodeCssEscapes(descriptor.value).toLowerCase();
      if (descriptorName === "type") {
        if (type) return { candidates, invalid: "descriptor type() duplicato" };
        const typeOpen = skipTrivia(input, descriptor!.next, end);
        if (input[typeOpen] !== "(") return { candidates, invalid: "type() non valido" };
        const typeClose = functionClose(input, typeOpen);
        if (typeClose === null || typeClose >= end) return { candidates, invalid: "type() non valido" };
        const typeArg = skipTrivia(input, typeOpen + 1, typeClose);
        const mime = quotedRange(input, typeArg, typeClose);
        if (!mime || skipTrivia(input, mime.next, typeClose) !== typeClose) {
          return { candidates, invalid: "type() non valido" };
        }
        type = true;
        cursor = typeClose + 1;
        continue;
      }
      const resolutionText = input.slice(cursor, end).match(/^(?:\d+(?:\.\d+)?|\.\d+)(?:x|dppx|dpi|dpcm)\b/i);
      if (!resolutionText || resolution) return { candidates, invalid: "descriptor non classificabile" };
      resolution = true;
      cursor += resolutionText[0].length;
    }
  }
  return { candidates, invalid: null };
}

function imageSetIssuesIn(input: string): ImageSetIssue[] {
  const issues: ImageSetIssue[] = [];
  for (let i = 0; i < input.length; ) {
    if (input.startsWith("/*", i)) {
      i = skipComment(input, i);
      continue;
    }
    if (input[i] === '"' || input[i] === "'") {
      i = skipQuoted(input, i);
      continue;
    }
    const token = identifier(input, i);
    if (!token) {
      i += 1;
      continue;
    }
    const open = skipTrivia(input, token.next, input.length);
    if (input[open] === "(" && imageSetName(decodeCssEscapes(token.value).toLowerCase())) {
      const analysis = analyzeImageSet(input, open);
      if (analysis.invalid) issues.push({ detail: `${decodeCssEscapes(token.value)} non sicura: ${analysis.invalid}`, index: i });
    }
    i = token.next;
  }
  return issues;
}

function imageSetUrlsIn(input: string): IndexedUrl[] {
  const urls: IndexedUrl[] = [];
  for (let i = 0; i < input.length; ) {
    if (input.startsWith("/*", i)) {
      i = skipComment(input, i);
      continue;
    }
    if (input[i] === '"' || input[i] === "'") {
      i = skipQuoted(input, i);
      continue;
    }
    const token = identifier(input, i);
    if (!token) {
      i += 1;
      continue;
    }
    const open = skipTrivia(input, token.next, input.length);
    if (input[open] === "(" && imageSetName(decodeCssEscapes(token.value).toLowerCase())) {
      urls.push(...analyzeImageSet(input, open).candidates);
    }
    i = token.next;
  }
  return urls;
}


function skipAttribute(input: string, start: number): number {
  let depth = 1;
  let i = start + 1;
  while (i < input.length && depth > 0) {
    if (input.startsWith("/*", i)) {
      i = skipComment(input, i);
      continue;
    }
    if (input[i] === '"' || input[i] === "'") {
      i = skipQuoted(input, i);
      continue;
    }
    if (input[i] === "[") depth += 1;
    else if (input[i] === "]") depth -= 1;
    i += 1;
  }
  return i;
}

function selectorTokens(selector: string): {
  hooks: Token[];
  ids: Token[];
  types: Token[];
} {
  const hooks: Token[] = [];
  const ids: Token[] = [];
  const types: Token[] = [];
  let i = 0;
  while (i < selector.length) {
    if (selector.startsWith("/*", i)) {
      i = skipComment(selector, i);
      continue;
    }
    const ch = selector[i]!;
    if (ch === '"' || ch === "'") {
      i = skipQuoted(selector, i);
      continue;
    }
    if (ch === "[") {
      i = skipAttribute(selector, i);
      continue;
    }
    if (ch === "." || ch === "#") {
      const token = identifier(selector, i + 1);
      if (token) {
        (ch === "." ? hooks : ids).push({ text: token.value, index: i });
        i = token.next;
        continue;
      }
    }
    if (ch === ":") {
      i += selector[i + 1] === ":" ? 2 : 1;
      const pseudo = identifier(selector, i);
      if (pseudo) i = pseudo.next;
      continue;
    }
    const token = identifier(selector, i);
    if (token) {
      // `of` è grammatica di :nth-child(), non un selettore di tipo. Tutti gli
      // altri identificatori nudi sono type selector e il tema non li possiede.
      if (token.value.toLowerCase() !== "of") {
        types.push({ text: token.value, index: i });
      }
      i = token.next;
      continue;
    }
    i += 1;
  }
  return { hooks, ids, types };
}

function selectorViolations(
  source: string,
  root: Root,
  allowedHooks: readonly string[],
  hooksOnly: boolean,
): IndexedViolation[] {
  const allowed = new Set(allowedHooks);
  const out: IndexedViolation[] = [];
  root.walkRules((rule: Rule) => {
    const start = nodeIndex(source, rule);
    const tokens = selectorTokens(rule.selector);
    for (const hook of tokens.hooks) {
      if (!allowed.has(hook.text)) {
        out.push(violation(source, start + hook.index, "selector-hook", `hook .${hook.text} non dichiarato`));
      }
    }
    if (hooksOnly) return;
    for (const id of tokens.ids) {
      out.push(violation(source, start + id.index, "selector-id", `selettore #${id.text} fuori dal vocabolario`));
    }
    for (const token of tokens.types) {
      out.push(violation(source, start + token.index, "selector-token", `selettore ${token.text} fuori dal vocabolario`));
    }
  });
  return out;
}

function isStructuralProperty(property: string): boolean {
  return STRUCTURAL_PROPERTIES.has(property) || STRUCTURAL_PREFIXES.some((prefix) => property.startsWith(prefix));
}

function structuralViolations(source: string, root: Root): IndexedViolation[] {
  const out: IndexedViolation[] = [];
  root.walkDecls((decl: Declaration) => {
    const property = decodeCssEscapes(decl.prop).toLowerCase();
    if (property.startsWith("--") || !isStructuralProperty(property)) return;
    out.push(violation(source, nodeIndex(source, decl), "structural-property", `proprietà ${property} vietata`));
  });
  return out;
}

function atRuleViolations(source: string, root: Root): IndexedViolation[] {
  const out: IndexedViolation[] = [];
  root.walkAtRules((rule: AtRule) => {
    const name = decodeCssEscapes(rule.name).toLowerCase();
    if (name === "import") out.push(violation(source, nodeIndex(source, rule), "at-import", "@import vietato"));
    if (name === "namespace") out.push(violation(source, nodeIndex(source, rule), "at-namespace", "@namespace vietato"));
  });
  return out;
}
function imageSetViolations(source: string, root: Root): IndexedViolation[] {
  const out: IndexedViolation[] = [];
  const check = (node: Declaration | AtRule, value: string) => {
    const start = valueStart(source, node, value);
    for (const issue of imageSetIssuesIn(value)) {
      out.push(violation(source, start + issue.index, "disallowed-value", issue.detail));
    }
  };
  root.walkDecls((decl: Declaration) => check(decl, decl.value));
  root.walkAtRules((rule: AtRule) => check(rule, rule.params));
  return out;
}


function urlsIn(input: string): IndexedUrl[] {
  const out: IndexedUrl[] = [];
  let i = 0;
  while (i < input.length) {
    if (input.startsWith("/*", i)) {
      i = skipComment(input, i);
      continue;
    }
    if (input[i] === '"' || input[i] === "'") {
      i = skipQuoted(input, i);
      continue;
    }
    const name = identifier(input, i);
    if (!name || decodeCssEscapes(name.value).toLowerCase() !== "url") {
      i = name?.next ?? i + 1;
      continue;
    }
    const open = skipTrivia(input, name.next, input.length);
    if (input[open] !== "(") {
      i = name.next;
      continue;
    }
    let cursor = skipTrivia(input, open + 1, input.length);
    if (input[cursor] === '"' || input[cursor] === "'") {
      const quote = input[cursor]!;
      const quoteEnd = skipQuoted(input, cursor);
      if (quoteEnd <= cursor || input[quoteEnd - 1] !== quote) {
        i = name.next;
        continue;
      }
      const [start, end] = trimRange(input, cursor + 1, quoteEnd - 1);
      out.push({
        value: decodeCssEscapes(input.slice(start, end)).trim(),
        index: i,
        start,
        end,
      });
      cursor = skipTrivia(input, quoteEnd, input.length);
      if (input[cursor] === ")") cursor += 1;
    } else {
      const start = cursor;
      while (cursor < input.length && input[cursor] !== ")") {
        if (input[cursor] === "\\") cursor = decodeEscape(input, cursor).next;
        else cursor += 1;
      }
      const [valueStart, valueEnd] = trimRange(input, start, cursor);
      out.push({
        value: decodeCssEscapes(input.slice(valueStart, valueEnd)).trim(),
        index: i,
        start: valueStart,
        end: valueEnd,
      });
      if (input[cursor] === ")") cursor += 1;
    }
    i = cursor;
  }
  return out;
}

function valueStart(source: string, node: Declaration | AtRule, value: string): number {
  const start = nodeIndex(source, node);
  const rendered = node.toString();
  const relative = rendered.indexOf(value);
  return relative < 0 ? start : start + relative;
}

function allUrls(source: string, root: Root): IndexedUrl[] {
  const out: IndexedUrl[] = [];
  root.walkDecls((decl: Declaration) => {
    const start = valueStart(source, decl, decl.value);
    for (const url of urlsIn(decl.value)) {
      out.push({
        value: url.value,
        index: start + url.index,
        start: start + url.start,
        end: start + url.end,
      });
    }
    for (const url of imageSetUrlsIn(decl.value)) {
      out.push({
        value: url.value,
        index: start + url.index,
        start: start + url.start,
        end: start + url.end,
      });
    }
  });
  root.walkAtRules((rule: AtRule) => {
    const start = valueStart(source, rule, rule.params);
    for (const url of urlsIn(rule.params)) {
      out.push({
        value: url.value,
        index: start + url.index,
        start: start + url.start,
        end: start + url.end,
      });
    }
    for (const url of imageSetUrlsIn(rule.params)) {
      out.push({
        value: url.value,
        index: start + url.index,
        start: start + url.start,
        end: start + url.end,
      });
    }
  });
  const sorted = out.sort((a, b) => a.index - b.index);
  return sorted.filter((item, index) => {
    const previous = sorted[index - 1];

    return !previous || previous.index !== item.index || previous.value !== item.value;
  });
}
/** An asset reference with source offsets for exact, syntax-preserving replacement. */
export interface ThemeAssetReference {
  readonly value: string;
  readonly start: number;
  readonly end: number;
}

export function themeAssetReferences(css: string): ThemeAssetReference[] {
  try {
    return allUrls(css, parse(css))
      .filter(({ value }) => !value.startsWith("#"))
      .map(({ value, start, end }) => ({ value, start, end }));
  } catch {
    return [];
  }
}

function urlViolations(source: string, root: Root, assetNamespace: string): IndexedViolation[] {
  const out: IndexedViolation[] = [];
  for (const { index, value } of allUrls(source, root)) {
    if (value.startsWith("#")) continue;
    if (/^(?:https?:|data:|blob:|file:|javascript:|\/\/)/i.test(value)) {
      out.push(violation(source, index, "remote-url", `URL remoto ${value} vietato`));
    } else if (!assetNamespace || !value.startsWith(assetNamespace)) {
      out.push(
        violation(source, index, "asset-namespace", `asset ${value || "<vuoto>"} fuori da ${assetNamespace || "<namespace vuoto>"}`),
      );
    }
  }
  return out;
}

function declaredRoles(root: Root): Set<string> {
  const declared = new Set<string>();
  root.walkDecls((decl: Declaration) => {
    const property = decodeCssEscapes(decl.prop);
    if (property.startsWith("--") && property.length > 2) declared.add(property.slice(2));
  });
  return declared;
}

/** Asset non-frammento nominati dal CSS, nell'ordine in cui compaiono. */
export function themeAssetUrls(css: string): string[] {
  try {
    return uniqueInOrder(allUrls(css, parse(css)).map(({ value }) => value).filter((value) => !value.startsWith("#")));
  } catch {
    return [];
  }
}

export function missingThemeRoles(css: string, requiredRoles: readonly string[]): string[] {
  const required = uniqueInOrder(requiredRoles);
  try {
    const declared = declaredRoles(parse(css));
    return required.filter((role) => !declared.has(role));
  } catch {
    return required;
  }
}

export function unknownThemeHooks(css: string, allowedHooks: readonly string[]): string[] {
  try {
    return uniqueInOrder(
      selectorViolations(css, parse(css), allowedHooks, true)
        .filter(({ code }) => code === "selector-hook")
        .map(({ detail }) => detail.match(/\.([^ ]+)/)?.[1] ?? detail),
    );
  } catch {
    return [];
  }
}

export function themeCssViolations(css: string, policy: ThemeCssPolicy): ThemeCssViolation[] {
  let root: Root;
  try {
    root = parse(css);
  } catch (error) {
    const { index: _index, ...item } = syntaxViolation(css, error);
    return [item];
  }

  const skin = policy.kind === "skin";
  const violations: IndexedViolation[] = [
    ...atRuleViolations(css, root),
    ...imageSetViolations(css, root),
    ...urlViolations(css, root, policy.assetNamespace),
    ...selectorViolations(css, root, policy.allowedHooks, skin),
    ...(skin ? [] : structuralViolations(css, root)),
  ];
  if (!skin) {
    const declared = declaredRoles(root);
    for (const role of uniqueInOrder(policy.requiredRoles ?? []).filter((role) => !declared.has(role))) {
      violations.push(violation(css, css.length, "missing-role", `ruolo --${role} mancante`));
    }
  }
  return violations
    .sort((left, right) => left.index - right.index || left.code.localeCompare(right.code) || left.detail.localeCompare(right.detail))
    .map(({ index: _index, ...item }) => item);
}

/// Il sanitizer non prova a riparare un foglio ostile: lo restituisce intatto o
/// lo rifiuta nominando tutte le violazioni, così una regola non cambia senso.
export function sanitizeThemeCss(css: string, policy: ThemeCssPolicy): string {
  const violations = themeCssViolations(css, policy);
  if (violations.length > 0) throw new ThemeCssError(violations);
  return css;
}

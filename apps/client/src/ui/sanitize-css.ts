import postcss, { type AtRule, type ChildNode, type Declaration, type Root, type Rule } from "postcss";

export type ThemeCssViolationCode =
  | "syntax-error"
  | "at-import"
  | "at-namespace"
  | "at-rule"
  | "remote-url"
  | "asset-namespace"
  | "selector-hook"
  | "selector-id"
  | "selector-token"
  | "structural-property"
  | "disallowed-property"
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

// The allowlist is intentionally finite.  A theme may paint an existing surface,
// but it may not invent layout, loading, or browser behaviour.  `skin` keeps the
// structural declarations that the legacy shell skin already owns; sheets do not.
const ALLOWED_PROPERTIES = new Set([
  "accent-color",
  "animation",
  "animation-delay",
  "animation-direction",
  "animation-duration",
  "animation-fill-mode",
  "animation-iteration-count",
  "animation-name",
  "animation-play-state",
  "animation-timing-function",
  "appearance",
  "background",
  "background-attachment",
  "background-clip",
  "background-color",
  "background-image",
  "background-origin",
  "background-position",
  "background-repeat",
  "background-size",
  "border",
  "border-block",
  "border-block-color",
  "border-block-style",
  "border-block-width",
  "border-bottom",
  "border-bottom-color",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-bottom-style",
  "border-bottom-width",
  "border-color",
  "border-left",
  "border-left-color",
  "border-left-style",
  "border-left-width",
  "border-radius",
  "border-right",
  "border-right-color",
  "border-right-style",
  "border-right-width",
  "border-style",
  "border-top",
  "border-top-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-top-style",
  "border-top-width",
  "border-width",
  "border-collapse",
  "box-shadow",
  "caret-color",
  "color",
  "color-scheme",
  "content",
  "cursor",
  "fill",
  "filter",
  "font",
  "font-family",
  "font-feature-settings",
  "font-kerning",
  "font-size",
  "font-size-adjust",
  "font-stretch",
  "font-style",
  "font-variant",
  "font-variant-numeric",
  "font-weight",
  "hyphens",
  "letter-spacing",
  "line-height",
  "list-style",
  "opacity",
  "outline",
  "outline-color",
  "outline-offset",
  "outline-style",
  "outline-width",
  "pointer-events",
  "stroke",
  "stroke-width",
  "text-align",
  "text-decoration",
  "text-decoration-color",
  "text-decoration-line",
  "text-decoration-style",
  "text-indent",
  "text-overflow",
  "text-rendering",
  "text-shadow",
  "text-transform",
  "text-underline-offset",
  "transform",
  "transform-origin",
  "transition",
  "transition-behavior",
  "transition-delay",
  "transition-duration",
  "transition-property",
  "transition-timing-function",
  "user-select",
  "visibility",
  "white-space",
  "-webkit-appearance",
  "-webkit-app-region",
]);

const STRUCTURAL_PROPERTIES: Record<string, true> = {
  all: true,
  display: true,
  position: true,
  top: true,
  right: true,
  bottom: true,
  left: true,
  inset: true,
  margin: true,
  padding: true,
  "aspect-ratio": true,
  width: true,
  height: true,
  "box-sizing": true,
  float: true,
  clear: true,
  resize: true,
  overflow: true,
  "z-index": true,
  order: true,
  flex: true,
  "flex-flow": true,
  grid: true,
  gap: true,
  columns: true,
  border: true,
  "border-width": true,
  "border-style": true,
};
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

const ALLOWED_FUNCTIONS: Record<string, true> = {
  attr: true,
  blur: true,
  calc: true,
  circle: true,
  clamp: true,
  "cubic-bezier": true,
  ellipse: true,
  hsl: true,
  hsla: true,
  "linear-gradient": true,
  max: true,
  repeat: true,
  min: true,
  "radial-gradient": true,
  rgb: true,
  rgba: true,
  rotate: true,
  rotatex: true,
  rotatey: true,
  rotatez: true,
  scale: true,
  scalex: true,
  scaley: true,
  scalez: true,
  steps: true,
  translate: true,
  translate3d: true,
  translatex: true,
  translatey: true,
  translatez: true,
  url: true,
  var: true,
};

const ALLOWED_AT_RULES: Record<"sheet" | "skin", Record<string, true>> = {
  sheet: { media: true },
  skin: { keyframes: true, media: true, "-webkit-keyframes": true },
};




interface IndexedViolation extends ThemeCssViolation {
  readonly index: number;
}

interface Token {
  readonly text: string;
  readonly index: number;
}

export interface ThemeAssetReference {
  /** Decoded URL accepted by the sanitizer. */
  readonly value: string;
  /** Absolute source range for the URL payload, excluding quote delimiters. */
  readonly start: number;
  readonly end: number;
  /** Absolute source position of the `url`/`image-set` candidate token. */
  readonly index: number;
}

interface IndexedUrl extends ThemeAssetReference {}

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

function decodeCssEscapes(input: string): string {
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
    let parent: ChildNode | Root | undefined = rule.parent as ChildNode | Root | undefined;
    while (parent) {
      if (parent.type === "atrule" && /keyframes$/i.test(decodeCssEscapes(parent.name))) return;
      parent = parent.parent as ChildNode | Root | undefined;
    }
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
  return Object.prototype.hasOwnProperty.call(STRUCTURAL_PROPERTIES, property) ||
    STRUCTURAL_PREFIXES.some((prefix) => property.startsWith(prefix));
}

function customPropertyName(property: string): boolean {
  return /^--[a-z][a-z0-9-]*$/.test(property);
}
function isImageSetName(name: string): boolean {
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
        if (input[i] === "\\") {
          i = decodeEscape(input, i).next;
        } else if (input[i] === quote) {
          i += 1;
          closed = true;
          break;
        } else {
          i += 1;
        }
      }
      if (!closed) return null;
      continue;
    }
    if (input[i] === "\\") {
      i = decodeEscape(input, i).next;
    } else if (input[i] === "(") {
      depth += 1;
      i += 1;
    } else if (input[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
      i += 1;
    } else {
      i += 1;
    }
  }
  return null;
}

function skipTrivia(input: string, start: number, end: number): number {
  let i = start;
  while (i < end) {
    if (/\s/.test(input[i]!)) {
      i += 1;
    } else if (input.startsWith("/*", i)) {
      i = Math.min(end, skipComment(input, i));
    } else {
      break;
    }
  }
  return i;
}

function quotedRange(input: string, start: number, end: number): QuotedRange | null {
  const quote = input[start];
  if (quote !== '"' && quote !== "'") return null;
  let i = start + 1;
  while (i < end) {
    if (input[i] === "\\") {
      i = decodeEscape(input, i).next;
    } else if (input[i] === quote) {
      let valueStart = start + 1;
      let valueEnd = i;
      while (valueStart < valueEnd && /\s/.test(input[valueStart]!)) valueStart += 1;
      while (valueEnd > valueStart && /\s/.test(input[valueEnd - 1]!)) valueEnd -= 1;
      return {
        value: decodeCssEscapes(input.slice(start + 1, i)).trim(),
        next: i + 1,
        start: valueStart,
        end: valueEnd,
      };
    } else {
      i += 1;
    }
  }
  return null;
}

interface ScannedUrl extends IndexedUrl {
  readonly next: number;
}

function urlToken(input: string, index: number, nameNext: number, end = input.length): ScannedUrl | null {
  let open = skipTrivia(input, nameNext, end);
  if (input[open] !== "(") return null;
  let cursor = skipTrivia(input, open + 1, end);
  if (input[cursor] === '"' || input[cursor] === "'") {
    const quoted = quotedRange(input, cursor, end);
    if (!quoted) return null;
    cursor = skipTrivia(input, quoted.next, end);
    if (input[cursor] === ")") cursor += 1;
    return { value: quoted.value, index, start: quoted.start, end: quoted.end, next: cursor };
  }

  const begin = cursor;
  while (cursor < end && input[cursor] !== ")") {
    if (input[cursor] === "\\") cursor = decodeEscape(input, cursor).next;
    else cursor += 1;
  }
  const close = cursor < end && input[cursor] === ")";
  const rawEnd = cursor;
  let valueStart = begin;
  let valueEnd = rawEnd;
  while (valueStart < valueEnd && /\s/.test(input[valueStart]!)) valueStart += 1;
  while (valueEnd > valueStart && /\s/.test(input[valueEnd - 1]!)) valueEnd -= 1;
  if (close) cursor += 1;
  return {
    value: decodeCssEscapes(input.slice(begin, rawEnd)).trim(),
    index,
    start: valueStart,
    end: valueEnd,
    next: cursor,
  };
}
function topLevelCommaRanges(input: string, start: number, end: number): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let depth = 0;
  let piece = start;
  for (let i = start; i < end; ) {
    if (input.startsWith("/*", i)) {
      i = skipComment(input, i);
      continue;
    }
    if (input[i] === '"' || input[i] === "'") {
      i = Math.min(end, skipQuoted(input, i));
      continue;
    }
    if (input[i] === "\\") {
      i = decodeEscape(input, i).next;
    } else if (input[i] === "(") {
      depth += 1;
      i += 1;
    } else if (input[i] === ")") {
      depth = Math.max(0, depth - 1);
      i += 1;
    } else if (input[i] === "," && depth === 0) {
      ranges.push([piece, i]);
      piece = i + 1;
      i += 1;
    } else {
      i += 1;
    }
  }
  ranges.push([piece, end]);
  return ranges;
}

function analyzeImageSet(input: string, open: number): ImageSetAnalysis {
  const candidates: IndexedUrl[] = [];
  const close = functionClose(input, open);
  if (close === null) return { candidates, invalid: "parentesi non bilanciate" };
  const ranges = topLevelCommaRanges(input, open + 1, close);
  for (const [start, end] of ranges) {
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
      const image = identifier(input, cursor);
      if (!image || decodeCssEscapes(image.value).toLowerCase() !== "url") {
        return { candidates, invalid: "candidate non classificabile" };
      }
      const scanned = urlToken(input, cursor, image.next, end);
      if (!scanned || scanned.next > end || input[scanned.next - 1] !== ")") {
        return { candidates, invalid: "url() non valido" };
      }
      candidates.push(scanned);
      cursor = scanned.next;
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
    if (!resolution && !type) return { candidates, invalid: "candidate senza descriptor" };
  }
  return { candidates, invalid: null };
}

/** Finds every function, including nested ones, without treating strings/comments as CSS. */
function valueViolation(value: string): string | null {
  for (let i = 0; i < value.length; ) {
    if (value.startsWith("/*", i)) {
      i = skipComment(value, i);
      continue;
    }
    if (value[i] === '"' || value[i] === "'") {
      i = skipQuoted(value, i);
      continue;
    }
    const token = identifier(value, i);
    if (!token) {
      i += 1;
      continue;
    }
    let open = token.next;
    while (open < value.length && /\s/.test(value[open]!)) open += 1;
    if (value[open] !== "(") {
      i = token.next;
      continue;
    }
    const name = decodeCssEscapes(token.value).toLowerCase();
    if (isImageSetName(name)) {
      const analysis = analyzeImageSet(value, open);
      if (analysis.invalid) return `${name} non sicura: ${analysis.invalid}`;
    } else if (!Object.prototype.hasOwnProperty.call(ALLOWED_FUNCTIONS, name)) {
      return `funzione ${name} non ammessa`;
    } else if (name === "var") {
      let cursor = open + 1;
      while (cursor < value.length && /\s/.test(value[cursor]!)) cursor += 1;
      const argument = identifier(value, cursor);
      if (!argument || !customPropertyName(decodeCssEscapes(argument.value))) {
        return "custom property non canonica in var()";
      }
    }
    i = open + 1;
  }
  return null;
}

function declarationViolations(source: string, root: Root, skin: boolean): IndexedViolation[] {
  const out: IndexedViolation[] = [];
  root.walkDecls((decl: Declaration) => {
    const decodedProperty = decodeCssEscapes(decl.prop);
    const property = decodedProperty.toLowerCase();
    const index = nodeIndex(source, decl);
    if (decl.prop !== decodedProperty && !decl.prop.toLowerCase().startsWith("--")) {
      out.push(violation(source, index, "disallowed-property", `proprietà ${decl.prop} usa escape CSS`));
      return;
    }
    if (decodedProperty.startsWith("--")) {
      if (!customPropertyName(decodedProperty) || decl.prop !== decodedProperty) {
        out.push(violation(source, index, "disallowed-property", `custom property ${decl.prop} non canonica`));
      } else {
        const invalid = valueViolation(decl.value);
        if (invalid) out.push(violation(source, index, "disallowed-value", `${property}: ${invalid}`));
      }
      return;
    }
    if (!property || (!skin && isStructuralProperty(property))) {
      if (isStructuralProperty(property)) {
        out.push(violation(source, index, "structural-property", `proprietà ${property} vietata`));
      } else {
        out.push(violation(source, index, "disallowed-property", `proprietà ${property} non ammessa`));
      }
      return;
    }
    if (skin && isStructuralProperty(property)) {
      const invalid = valueViolation(decl.value);
      if (invalid) out.push(violation(source, index, "disallowed-value", `${property}: ${invalid}`));
      return;
    }
    if (!ALLOWED_PROPERTIES.has(property)) {
      out.push(violation(source, index, "disallowed-property", `proprietà ${property} non ammessa`));
      return;
    }
    const invalid = valueViolation(decl.value);
    if (invalid) out.push(violation(source, index, "disallowed-value", `${property}: ${invalid}`));
  });
  return out;
}

function atRuleViolations(source: string, root: Root, kind: "sheet" | "skin"): IndexedViolation[] {
  const out: IndexedViolation[] = [];
  const allowed = ALLOWED_AT_RULES[kind];
  root.walkAtRules((rule: AtRule) => {
    const name = decodeCssEscapes(rule.name).toLowerCase();
    const index = nodeIndex(source, rule);
    if (name === "import") {
      out.push(violation(source, index, "at-import", "@import vietato"));
    } else if (name === "namespace") {
      out.push(violation(source, index, "at-namespace", "@namespace vietato"));
    } else if (!Object.prototype.hasOwnProperty.call(allowed, name)) {
      out.push(violation(source, index, "at-rule", `@${name} non ammesso`));
    } else {
      const invalid = valueViolation(rule.params);
      if (invalid) out.push(violation(source, index, "disallowed-value", `@${name}: ${invalid}`));
    }
  });
  return out;
}
function scanUrls(input: string): IndexedUrl[] {
  const out: IndexedUrl[] = [];
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
    const name = decodeCssEscapes(token.value).toLowerCase();
    if (name === "url") {
      const scanned = urlToken(input, i, token.next);
      if (scanned) {
        out.push(scanned);
        i = Math.max(token.next, scanned.next);
      } else {
        i = token.next;
      }
      continue;
    }
    if (isImageSetName(name)) {
      const open = skipTrivia(input, token.next, input.length);
      if (input[open] === "(") {
        out.push(...analyzeImageSet(input, open).candidates);
        const close = functionClose(input, open);
        i = close === null ? token.next : close + 1;
        continue;
      }
    }
    i = token.next;
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
  const add = (value: string, start: number): void => {
    for (const url of scanUrls(value)) {
      out.push({
        value: url.value,
        index: start + url.index,
        start: start + url.start,
        end: start + url.end,
      });
    }
  };
  root.walkDecls((decl: Declaration) => add(decl.value, valueStart(source, decl, decl.value)));
  root.walkAtRules((rule: AtRule) => add(rule.params, valueStart(source, rule, rule.params)));
  return out.sort((a, b) => a.index - b.index);
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

/** The exact source ranges used by both sanitization and theme materialization. */
export function themeAssetReferences(css: string): ThemeAssetReference[] {
  try {
    return allUrls(css, parse(css));
  } catch {
    return [];
  }
}

/** Asset non-frammento nominati dal CSS, nell'ordine in cui compaiono. */
export function themeAssetUrls(css: string): string[] {
  return uniqueInOrder(
    themeAssetReferences(css)
      .map(({ value }) => value)
      .filter((value) => !value.startsWith("#")),
  );
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
    ...atRuleViolations(css, root, skin ? "skin" : "sheet"),
    ...urlViolations(css, root, policy.assetNamespace),
    ...selectorViolations(css, root, policy.allowedHooks, skin),
    ...declarationViolations(css, root, skin),
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

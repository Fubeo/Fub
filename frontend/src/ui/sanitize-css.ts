export type ThemeCssViolationCode =
  | "at-import"
  | "at-namespace"
  | "remote-url"
  | "asset-namespace"
  | "selector-hook"
  | "selector-id"
  | "selector-token"
  | "structural-property"
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

interface IndexedViolation extends ThemeCssViolation {
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

function maskComments(source: string): string {
  const chars = source.split("");
  for (let i = 0; i < chars.length - 1; i += 1) {
    if (chars[i] !== "/" || chars[i + 1] !== "*") continue;
    chars[i] = " ";
    chars[i + 1] = " ";
    i += 2;
    while (i < chars.length) {
      if (chars[i] === "*" && chars[i + 1] === "/") {
        chars[i] = " ";
        chars[i + 1] = " ";
        i += 1;
        break;
      }
      if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " ";
      i += 1;
    }
  }
  return chars.join("");
}

function maskStrings(source: string): string {
  const chars = source.split("");
  let quote = "";
  let escaped = false;
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    if (!quote) {
      if (char === '"' || char === "'") {
        quote = char;
        chars[i] = " ";
      }
      continue;
    }
    if (char !== "\n" && char !== "\r") chars[i] = " ";
    if (escaped) {
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (char === quote) {
      quote = "";
    }
  }
  return chars.join("");
}

function location(source: string, index: number): Pick<ThemeCssViolation, "line" | "column"> {
  const before = source.slice(0, index);
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

function uniqueInOrder(values: readonly string[]): string[] {
  const seen: Record<string, true> = {};
  return values.filter((value) => {
    if (seen[value]) return false;
    seen[value] = true;
    return true;
  });
}

function selectors(source: string): readonly { text: string; index: number }[] {
  const masked = maskStrings(maskComments(source));
  const found: { text: string; index: number }[] = [];
  let boundary = 0;
  let depth = 0;
  for (let i = 0; i < masked.length; i += 1) {
    if (masked[i] === ";" && depth === 0) {
      boundary = i + 1;
      continue;
    }
    if (masked[i] === "}") {
      depth = Math.max(0, depth - 1);
      boundary = i + 1;
      continue;
    }
    if (masked[i] !== "{") continue;
    const raw = masked.slice(boundary, i);
    const leading = raw.search(/\S/);
    if (leading >= 0) found.push({ text: raw.trim(), index: boundary + leading });
    depth += 1;
    boundary = i + 1;
  }
  return found.filter(({ text }) => {
    if (text.startsWith("@")) return false;
    return !text.split(",").every((part) => /^(?:from|to|\d+(?:\.\d+)?%)$/.test(part.trim()));
  });
}

function selectorViolations(
  source: string,
  allowedHooks: readonly string[],
  hooksOnly = false,
): IndexedViolation[] {
  const allowed: Record<string, true> = {};
  for (const hook of allowedHooks) allowed[hook] = true;
  const violations: IndexedViolation[] = [];

  for (const selector of selectors(source)) {
    const hooks = [...selector.text.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)];
    for (const match of hooks) {
      const hook = match[1];
      if (!allowed[hook]) {
        violations.push(
          violation(source, selector.index + (match.index ?? 0), "selector-hook", `hook .${hook} non dichiarato`),
        );
      }
    }

    if (hooksOnly) continue;

    for (const match of selector.text.matchAll(/#(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)) {
      violations.push(
        violation(source, selector.index + (match.index ?? 0), "selector-id", `selettore #${match[1]} fuori dal vocabolario`),
      );
    }

    for (const part of selector.text.split(",")) {
      const remainder = part
                // Spazi lunghi quanto ciò che nascondono: l'indice di un token nel
        // resto coincide con il suo posto nel selettore originale.
        .replace(/\[[^\]]*\]/g, (m) => " ".repeat(m.length))
        .replace(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g, (m) => " ".repeat(m.length))
        .replace(/#(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g, (m) => " ".repeat(m.length))
        .replace(/:{1,2}[-_a-zA-Z][-_a-zA-Z0-9]*(?:\([^)]*\))?/g, (m) => " ".repeat(m.length))
        .replace(/[>+~*|]/g, " ");
      for (const token of remainder.matchAll(/-?[_a-zA-Z][_a-zA-Z0-9-]*/g)) {
        violations.push(
          violation(
            source,
            selector.index + selector.text.indexOf(part) + (token.index ?? 0),
            "selector-token",
            `selettore ${token[0]} fuori dal vocabolario`,
          ),
        );
      }
    }
  }
  return violations;
}

function isStructuralProperty(property: string): boolean {
  if (STRUCTURAL_PROPERTIES[property]) return true;
  return STRUCTURAL_PREFIXES.some((prefix) => property.startsWith(prefix));
}

function structuralViolations(source: string): IndexedViolation[] {
  const masked = maskStrings(maskComments(source));
  const violations: IndexedViolation[] = [];
  const declarations = /(?:^|[;{])\s*([_a-zA-Z-][_a-zA-Z0-9-]*)\s*:/g;
  for (const match of masked.matchAll(declarations)) {
    const property = match[1].toLowerCase();
    if (!property.startsWith("--") && isStructuralProperty(property)) {
      const offset = match[0].lastIndexOf(match[1]);
      violations.push(
        violation(source, (match.index ?? 0) + offset, "structural-property", `proprietà ${property} vietata`),
      );
    }
  }
  return violations;
}

function atRuleViolations(source: string): IndexedViolation[] {
  const masked = maskStrings(maskComments(source));
  const violations: IndexedViolation[] = [];
  for (const [pattern, code, label] of [
    [/@import\b/gi, "at-import", "@import vietato"],
    [/@namespace\b/gi, "at-namespace", "@namespace vietato"],
  ] as const) {
    for (const match of masked.matchAll(pattern)) {
      violations.push(violation(source, match.index ?? 0, code, label));
    }
  }
  return violations;
}

interface IndexedUrl {
  readonly index: number;
  readonly value: string;
}

function cssUrls(source: string): IndexedUrl[] {
  const commentsOnly = maskComments(source);
  const masked = maskStrings(commentsOnly);
  const urls: IndexedUrl[] = [];
  for (const match of masked.matchAll(/\burl\s*\(/gi)) {
    const index = match.index ?? 0;
    const open = index + match[0].lastIndexOf("(");
    const close = commentsOnly.indexOf(")", open + 1);
    const raw = commentsOnly.slice(open + 1, close < 0 ? commentsOnly.length : close).trim();
    urls.push({ index, value: raw.replace(/^(['"])([\s\S]*)\1$/, "$2").trim() });
  }
  return urls;
}

function urlViolations(source: string, assetNamespace: string): IndexedViolation[] {
  const violations: IndexedViolation[] = [];
  for (const { index, value } of cssUrls(source)) {
    if (value.startsWith("#")) continue;
    if (/^(?:https?:|data:|blob:|file:|javascript:|\/\/)/i.test(value)) {
      violations.push(violation(source, index, "remote-url", `URL remoto ${value} vietato`));
    } else if (!assetNamespace || !value.startsWith(assetNamespace)) {
      violations.push(
        violation(source, index, "asset-namespace", `asset ${value || "<vuoto>"} fuori da ${assetNamespace || "<namespace vuoto>"}`),
      );
    }
  }
  return violations;
}

/** Asset non-frammento nominati dal CSS, nell'ordine in cui compaiono. */
export function themeAssetUrls(css: string): string[] {
  return uniqueInOrder(
    cssUrls(css)
      .map(({ value }) => value)
      .filter((value) => !value.startsWith("#")),
  );
}

export function missingThemeRoles(css: string, requiredRoles: readonly string[]): string[] {
  const declared: Record<string, true> = {};
  const masked = maskStrings(maskComments(css));
  for (const match of masked.matchAll(/(?:^|[;{])\s*--([_a-zA-Z][_a-zA-Z0-9-]*)\s*:/g)) {
    declared[match[1]] = true;
  }
  return uniqueInOrder(requiredRoles).filter((role) => !declared[role]);
}

export function unknownThemeHooks(css: string, allowedHooks: readonly string[]): string[] {
  return uniqueInOrder(
    selectorViolations(css, allowedHooks)
      .filter(({ code }) => code === "selector-hook")
      .map(({ detail }) => detail.match(/\.([^ ]+)/)?.[1] ?? detail),
  );
}

export function themeCssViolations(css: string, policy: ThemeCssPolicy): ThemeCssViolation[] {
  const skin = policy.kind === "skin";
  const violations: IndexedViolation[] = [
    ...atRuleViolations(css),
    ...urlViolations(css, policy.assetNamespace),
    ...selectorViolations(css, policy.allowedHooks, skin),
    ...(skin ? [] : structuralViolations(css)),
  ];
  for (const role of missingThemeRoles(css, skin ? [] : (policy.requiredRoles ?? []))) {
    violations.push(violation(css, css.length, "missing-role", `ruolo --${role} mancante`));
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

// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import previewSource from "../panels/preview.ts?raw";
import { arbitrate, type ArbitrationContext } from "./arbitration";
import type { CommandEntry, ResultKeys } from "./commands";

const coreSources = import.meta.glob("../editors/core/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const textSources = import.meta.glob("../editors/text/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const GLOBAL_KEYDOWN_REGISTRATIONS = [
  /\b(?:window|document)\s*\.\s*addEventListener\s*\(\s*["']keydown["']/,
  /\b(?:window|document)\s*\.\s*onkeydown\b/,
  /\blifetime\s*\.\s*listen\(\s*(?:window|document)\s*,\s*["']keydown["']/,
];

function productionSources(sources: Record<string, string>): [string, string][] {
  return Object.entries(sources).filter(
    ([path]) =>
      !path.endsWith(".test.ts") &&
      !path.endsWith("test-support.ts") &&
      !path.includes("/__fixtures__/") &&
      !path.endsWith("/__fixtures__.ts"),
  );
}

function registersGlobalKeydown(source: string): boolean {
  return GLOBAL_KEYDOWN_REGISTRATIONS.some((pattern) => pattern.test(source));
}

function command(id = "shell.mode.reading"): CommandEntry {
  return {
    id,
    title: id,
    description: id,
    binding: "Mod-e",
    declared: "Mod-e",
    spec: null,
    run: () => {},
  };
}

function context(overrides: Partial<ArbitrationContext> = {}): ArbitrationContext {
  return {
    overlayOpen: false,
    localEditorConsumed: false,
    ...overrides,
  };
}

describe("ordine di arbitrato della tastiera", () => {
  it("un overlay aperto passa il tasto senza eseguire un comando shell", () => {
    const result: ResultKeys = { type: "esegue", entry: command() };

    expect(arbitrate(result, context({ overlayOpen: true }))).toEqual({ type: "passa" });
  });

  it("un evento davvero consumato dall'editor passa prima del matcher shell", () => {
    const result: ResultKeys = { type: "esegue", entry: command("shell.doc.search") };

    expect(arbitrate(result, context({ localEditorConsumed: true }))).toEqual({ type: "passa" });
  });

  it("un evento locale non consumato conserva il risultato del matcher", () => {
    const result: ResultKeys = { type: "attende", waiting: { pressed: [], label: "Mod-K" } };

    expect(arbitrate(result, context())).toBe(result);
  });
});

describe("i renderer non registrano keydown globali", () => {
  it("non aggiungono ascoltatori su window o document", () => {
    const production = [
      ...productionSources(coreSources),
      ...productionSources(textSources),
    ];
    expect(production.length, "i glob non hanno letto i renderer").toBeGreaterThan(0);
    expect(previewSource.length, "il raw dell'anteprima è vuoto").toBeGreaterThan(0);

    const violations = [
      ...production.filter(([, source]) => registersGlobalKeydown(source)).map(([path]) => path),
      ...(registersGlobalKeydown(previewSource) ? ["../panels/preview.ts"] : []),
    ];
    expect(violations).toEqual([]);
  });
});

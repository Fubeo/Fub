// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import previewSource from "../panels/preview.ts?raw";
import {
  ARBITRATION_LAYERS,
  arbitrate,
  profileConsumes,
  shellCommandLayer,
  surfaceConsumes,
  type ArbitrationContext,
} from "./arbitration";
import type { CommandEntry, KeyChord, ResultKeys } from "./commands";

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

const gesture: KeyChord = {
  key: "e",
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
};

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
    editorFocused: false,
    waiting: null,
    passedToEditor: new Set<string>(),
    ...overrides,
  };
}

describe("ordine di arbitrato della tastiera", () => {
  it("mantiene i sette livelli in ordine stabile", () => {
    expect([...ARBITRATION_LAYERS]).toEqual([
      "popup / transitory overlay",
      "local editor in edit",
      "active surface commands",
      "active profile",
      "document commands",
      "pane commands",
      "global commands",
    ]);
  });

  it.each([
    [1, "popup / transitory overlay"],
    [2, "local editor in edit"],
    [3, "active surface commands"],
    [4, "active profile"],
    [5, "document commands"],
    [6, "pane commands"],
    [7, "global commands"],
  ] as const)("il livello %i è %s", (position, name) => {
    expect(ARBITRATION_LAYERS[position - 1]).toBe(name);
  });

  it("un overlay aperto passa il tasto senza eseguire un comando shell", () => {
    const result: ResultKeys = { type: "esegue", entry: command() };

    expect(arbitrate(result, gesture, context({ overlayOpen: true }))).toEqual({ type: "passa" });
  });

  it("la superficie e il profilo attivi sono hook no-op", () => {
    expect(surfaceConsumes(gesture)).toBe(false);
    expect(profileConsumes(gesture)).toBe(false);

    const result: ResultKeys = { type: "esegue", entry: command() };
    expect(arbitrate(result, gesture, context())).toBe(result);
  });

  it("lascia già pronto il consumo futuro di superficie e profilo", () => {
    const result: ResultKeys = { type: "esegue", entry: command() };

    expect(
      arbitrate(result, gesture, context({ surfaceConsumes: () => true })),
    ).toEqual({ type: "passa" });
    expect(
      arbitrate(result, gesture, context({ profileConsumes: () => true })),
    ).toEqual({ type: "passa" });
  });

  it.each([
    ["shell.doc.search", "document"],
    ["shell.pane.split.down", "pane"],
    ["shell.mode.reading", "pane"],
    ["shell.palette", "global"],
    ["shell.unknown", "global"],
  ] as const)("classifica %s nel livello %s", (id, layer) => {
    expect(shellCommandLayer(id)).toBe(layer);
  });

  it("nel fuoco dell'editor lascia all'editor soltanto gli accordi nominati", () => {
    const result: ResultKeys = { type: "esegue", entry: command("shell.doc.search") };
    const passedToEditor = new Set(["shell.doc.search"]);

    expect(
      arbitrate(result, gesture, context({ editorFocused: true, passedToEditor })),
    ).toEqual({ type: "passa" });
    const paletteResult: ResultKeys = { type: "esegue", entry: command("shell.palette") };
    expect(
      arbitrate(
        paletteResult,
        gesture,
        context({ editorFocused: true, passedToEditor }),
      ),
    ).toBe(paletteResult);
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

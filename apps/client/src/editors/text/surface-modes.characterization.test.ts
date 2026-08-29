// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import html from "../../../index.html?raw";
import previewSource from "../../panels/preview.ts?raw";
import keyboardSource from "../../ui/keyboard.ts?raw";
import arbitrationSource from "../../ui/arbitration.ts?raw";

const textSources = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const productionTextSources = Object.entries(textSources).filter(
  ([path]) =>
    !path.endsWith(".test.ts") &&
    !path.endsWith("test-support.ts") &&
    !path.includes("/__fixtures__/") &&
    !path.endsWith("/__fixtures__.ts"),
);

const GLOBAL_KEYDOWN_REGISTRATIONS = [
  /\b(?:window|document)\s*\.\s*addEventListener\s*\(\s*["']keydown["']/,
  /\b(?:window|document)\s*\.\s*onkeydown\b/,
  /\blifetime\s*\.\s*listen\(\s*(?:window|document)\s*,\s*["']keydown["']/,
];

function registersGlobalKeydown(source: string): boolean {
  return GLOBAL_KEYDOWN_REGISTRATIONS.some((pattern) => pattern.test(source));
}

function modeButtons(source: string): string[] {
  return [...source.matchAll(/<button\b[^>]*\bdata-mode\s*=\s*["']([^"']+)["'][^>]*>/g)].map(
    (match) => match[1]!,
  );
}

describe("caratterizzazione delle modalità e della tastiera della shell", () => {
  it("il commutatore lascia il catalogo alla superficie attiva", () => {
    expect(modeButtons(html)).toEqual([]);
    const group = html.match(/<span\b[^>]*\bid=["']mode-switch["'][^>]*>/)?.[0] ?? "";
    expect(group).not.toBe("");
    expect(group).toContain('class="segmented segmented--titlebar"');
    expect(group).toContain('role="group"');
  });

  it("gli editor testuali e l'anteprima non registrano keydown globali", () => {
    expect(productionTextSources.length, "il glob non ha letto gli editor testuali").toBeGreaterThan(0);
    expect(previewSource.length, "il raw dell'anteprima è vuoto").toBeGreaterThan(0);
    const violations = [
      ...productionTextSources
        .filter(([, source]) => registersGlobalKeydown(source))
        .map(([path]) => path),
      ...(registersGlobalKeydown(previewSource) ? ["../../panels/preview.ts"] : []),
    ];
    expect(violations).toEqual([]);
  });

  it("l'ascolto globale della tastiera passa dalla Lifetime", () => {
    expect(keyboardSource).toMatch(/\blifetime\s*\.\s*listen\(\s*document\s*,\s*["']keydown["']/);
  });

  it("passa all'arbitrato il consumo causale, senza una lista statica", () => {
    expect(keyboardSource).not.toMatch(/\bPASSED_TO_EDITOR\b/);
    expect(keyboardSource).not.toMatch(/\b(?:passedToEditor|editorBindings|editorKeybindings)\b/);
    expect(keyboardSource).not.toMatch(/["']shell\./);
    expect(keyboardSource).toMatch(
      /const\s+localEditorConsumed\s*=\s*editorFocused\s*&&\s*e\.defaultPrevented/,
    );
    expect(arbitrationSource).not.toMatch(
      /\b(?:ARBITRATION_LAYERS|GestureConsumer|localEditorConsumes|profileConsumes|shellCommandLayer|surfaceConsumes)\b/,
    );
    expect(arbitrationSource).not.toMatch(/["']shell\./);
  });

  it("il guard riconosce sia l'ascolto DOM sia quello Lifetime", () => {
    expect(registersGlobalKeydown('document.addEventListener("keydown", handler)')).toBe(true);
    expect(registersGlobalKeydown('lifetime.listen(document, "keydown", handler)')).toBe(true);
    expect(registersGlobalKeydown('document.addEventListener("click", handler)')).toBe(false);
  });
});

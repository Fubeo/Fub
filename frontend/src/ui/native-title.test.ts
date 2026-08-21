// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import html from "../../index.html?raw";

const panels = import.meta.glob("../panels/**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const ui = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function nativeTitleCount(): number {
  const entries = [...Object.entries(panels), ...Object.entries(ui)]
    .filter(([path]) => !path.endsWith(".test.ts"));
  const production = entries.map(([, source]) => source).concat(html);
  const native = /(?:\.title\s*=(?!=)|setAttribute\(\s*["']title["'])/g;
  const htmlNative = /<[^>]+(?:^|\s)title\s*=/g;
  const sourceCount = production.reduce((count, source) => count + (source.match(native)?.length ?? 0), 0);
  return sourceCount + (html.match(htmlNative)?.length ?? 0);
}

describe("i suggerimenti della shell", () => {
  it("non lascia title nativi nei pannelli, nella UI o nell'HTML", () => {
    // Misurato con: `node -e '...'` (2026-08-22): 0 title nativi.
    expect(nativeTitleCount()).toBe(0);
  });
});

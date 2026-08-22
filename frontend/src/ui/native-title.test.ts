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
  it("non lascia title nativi salvo il nome obbligatorio dell'iframe", () => {
    // Il presidio a11y monta ogni UiNode e pretende esplicitamente un `title`
    // sul web_view: quella è l'unica eccezione semantica al divieto dei tooltip
    // nativi. Tenere il conteggio esatto a uno fa fallire sia un secondo title
    // usato come tooltip sia la sparizione del nome richiesto dal frame.
    expect(nativeTitleCount()).toBe(1);
  });
});

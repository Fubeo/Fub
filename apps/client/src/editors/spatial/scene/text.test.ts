// Le coordinate della sorgente: gli stessi casi dei test di unità di
// `text.rs` in `fub-scene`. In Rust la mappa va da byte a unità UTF-16 sul
// testo a LF; qui `SourceText` parte dall'indice UTF-16 grezzo della stringa e
// dà le due coordinate, byte (`byteOf`) e unità a LF (`lfOffset`): i casi si
// controllano su entrambe.

import { describe, expect, it } from "vitest";
import { bomUnits, lineBreakOf, lineEndingOf, SourceText, utf8Length } from "./text";

/// Il testo che vede la shell: `\r\n` e `\r` diventano `\n`.
function normalized(source: string): string {
  return source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

describe("le coordinate della sorgente (text.rs)", () => {
  it("gli offset UTF-16 seguono il testo a LF della shell", () => {
    const source = "﻿a\r\nb\rc\n😀é\r\n<g/>";
    const map = new SourceText(source);
    // Ogni confine di carattere, e la fine.
    const boundaries: number[] = [];
    for (let i = 0; i < source.length; i += source.codePointAt(i)! > 0xffff ? 2 : 1) boundaries.push(i);
    boundaries.push(source.length);
    for (const index of boundaries) {
      const prefix = source.slice(0, index);
      // Un offset fra `\r` e `\n` vale quello prima del `\r`.
      const insideCrlf = prefix.endsWith("\r") && source.startsWith("\n", index);
      const expected = normalized(insideCrlf ? prefix.slice(0, -1) : prefix).length;
      expect(map.lfOffset(index), `indice ${index}`).toBe(expected);
      expect(map.byteOf(index), `indice ${index}`).toBe(utf8Length(prefix));
    }
    expect(map.lfOffset(source.length)).toBe(normalized(source).length);
    expect(map.byteLength).toBe(new TextEncoder().encode(source).length);
  });

  it("gli offset UTF-16 attraversano i segni", () => {
    const line = "é\r\n".repeat(400);
    const map = new SourceText(line);
    expect(map.byteOf(line.length)).toBe(line.length + 400);
    expect(map.lfOffset(line.length)).toBe(800);
    // Il byte 4 × 150 è l'indice grezzo 3 × 150.
    expect(map.byteOf(3 * 150)).toBe(4 * 150);
    expect(map.lfOffset(3 * 150)).toBe(300);
  });

  it("i terminatori di riga si osservano, non si convertono", () => {
    expect(lineEndingOf("a")).toBe("lf");
    expect(lineEndingOf("a\nb")).toBe("lf");
    expect(lineEndingOf("a\r\nb")).toBe("crlf");
    expect(lineEndingOf("a\rb")).toBe("cr");
    expect(lineEndingOf("a\r\nb\n")).toBe("mixed");
    expect(lineBreakOf("a")).toBe("lf");
    expect(lineBreakOf("a\r\nb\n")).toBe("crlf");
    expect(lineBreakOf("a\r\nb\nc\n")).toBe("lf");
    expect(lineBreakOf("a\rb\rc\n")).toBe("cr");
  });

  it("il rientro è la testa della riga", () => {
    const source = "﻿<svg>\r\n  \t<g/>\n<a/>\r  <b/> <c/>";
    const lines = new SourceText(source);
    expect(lines.indent(source.indexOf("<g"))).toBe("  \t");
    expect(lines.indent(source.indexOf("<a"))).toBe("");
    expect(lines.indent(source.indexOf("<b"))).toBe("  ");
    expect(lines.indent(source.indexOf("<c"))).toBe("  ");
    // Subito dopo il BOM: in Rust il byte 3, qui l'indice 1.
    expect(lines.indent(1)).toBe("");
    expect(lines.indent(0)).toBe("");
    // `bom_len` di Rust conta i byte; `bomUnits` le unità UTF-16.
    expect(bomUnits(source)).toBe(1);
    expect(lines.byteOf(bomUnits(source))).toBe(3);
    expect(bomUnits("<svg/>")).toBe(0);
  });
});

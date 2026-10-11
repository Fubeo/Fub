// Le coordinate della sorgente: gli stessi casi dei test di unità di
// `text.rs` in `fub-scene`. In Rust la mappa va da byte a unità UTF-16 sul
// testo a LF; qui `SourceText` parte dall'indice UTF-16 grezzo della stringa e
// dà le due coordinate, byte (`byteOf`) e unità a LF (`lfOffset`): i casi si
// controllano su entrambe.

import { describe, expect, it } from "vitest";
import { bomUnits, lineBreakOf, lineEndingOf, SourceText, utf8Length, utf8LengthFrom } from "./text";

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

  it("le coordinate e i rientri valgono in un testo lungo con segni e terminatori sparsi", () => {
    let seed = 0x2545f491;
    const next = (bound: number): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % bound;
    };
    const pieces = ["a", "<g/>", " ", "\t", "é", "€", "😀", "\ud83d", "\ude00", "\n", "\r", "\r\n", "  "];
    let source = "﻿";
    for (let i = 0; i < 6000; i++) source += pieces[next(pieces.length)]!;
    const map = new SourceText(source);
    const bom = bomUnits(source);
    // L'inizio della riga di `index`: dopo un `\n`, o dopo un `\r` che non
    // sta attaccato a un `\n`; mai prima del BOM.
    const lineStart = (index: number): number => {
      let start = index;
      while (start > bom) {
        const before = source[start - 1];
        if (before === "\n" || (before === "\r" && source[start] !== "\n")) break;
        start--;
      }
      return Math.min(Math.max(start, bom), index);
    };
    for (let index = 0; index <= source.length; index += source.codePointAt(index)! > 0xffff ? 2 : 1) {
      const prefix = source.slice(0, index);
      const insideCrlf = prefix.endsWith("\r") && source.startsWith("\n", index);
      expect(map.byteOf(index), `indice ${index}`).toBe(utf8Length(prefix));
      expect(map.lfOffset(index), `indice ${index}`).toBe(normalized(insideCrlf ? prefix.slice(0, -1) : prefix).length);
      const start = lineStart(index);
      const head = /^[ \t]*/.exec(source.slice(start, index))![0];
      expect(map.indent(index), `indice ${index}`).toBe(head);
      if (index === source.length) break;
    }
    expect(map.byteLength).toBe(utf8Length(source));
  });
});

describe("i byte di un testo dopo una modifica", () => {
  it("contano come il testo intero, anche quando la modifica taglia una coppia surrogata", () => {
    let seed = 0x9e3779b9;
    const next = (bound: number): number => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % bound;
    };
    // Mezze coppie comprese: un testo può contenerne, e valgono tre byte.
    const pieces = ["a", "é", "€", "🙂", "😀", "\ud83d", "\ude00", "\n"];
    const piece = (): string => pieces[next(pieces.length)]!;
    let text = "";
    for (let i = 0; i < 3000; i++) text += piece();
    let known = { text, bytes: utf8Length(text) };
    for (let round = 0; round < 400; round++) {
      // Ogni bordo può cadere in mezzo a una coppia.
      const from = next(known.text.length + 1);
      const to = Math.min(known.text.length, from + next(6));
      let inserted = "";
      for (let k = next(4); k > 0; k--) inserted += piece();
      const changed = known.text.slice(0, from) + inserted + known.text.slice(to);
      const bytes = utf8LengthFrom(known, changed);
      expect(bytes, `giro ${round}`).toBe(utf8Length(changed));
      known = { text: changed, bytes };
    }
    // Il motore parte dai byte che l'apertura conta: sono gli stessi.
    expect(new SourceText(known.text).byteLength).toBe(known.bytes);
    expect(utf8LengthFrom({ text: "😀", bytes: 4 }, "\ud83dx")).toBe(4);
    expect(utf8LengthFrom({ text: "x😀", bytes: 5 }, "😀")).toBe(4);
  });
});

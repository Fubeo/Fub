import { describe, expect, it } from "vitest";
import { byteToCharIndex, charToByteIndex } from "./offsets";

// Il ponte byte UTF-8 → code unit UTF-16 è codice load-bearing: uno scroll
// dell'outline (o, a M3, una decorazione di live-preview) calcolato su un
// offset mappato male cade righe più in là, e lo fa **in silenzio** su testo
// accentato — cioè su ogni nota in italiano. Questi test sono la verifica che
// prima era a mano (§4 del piano dice: il ponte va testato su multibyte).

const enc = new TextEncoder();

/// Il byte offset dell'inizio di `sub` dentro `text` (come lo darebbe uno
/// `Span` del kernel): lunghezza UTF-8 di ciò che precede.
function byteStartOf(text: string, sub: string): number {
  return enc.encode(text.slice(0, text.indexOf(sub))).length;
}

describe("byteToCharIndex", () => {
  it("è l'identità su ASCII puro", () => {
    const t = "# Titolo\n\ntesto\n";
    for (let i = 0; i <= t.length; i++) {
      // ogni carattere ASCII è 1 byte = 1 code unit
      expect(byteToCharIndex(t, i)).toBe(i);
    }
  });

  it("mappa ogni confine di code point su testo accentato + emoji", () => {
    const doc = "# Però\n\ntesto èàì\n\n## Sezione 🎯 fine\n\ncoda\n";
    let bytes = 0;
    let units = 0;
    for (const ch of doc) {
      // all'inizio di ogni carattere, il byte offset corrente mappa all'indice
      // in code unit corrente
      expect(byteToCharIndex(doc, bytes)).toBe(units);
      bytes += enc.encode(ch).length;
      units += ch.codePointAt(0)! > 0xffff ? 2 : 1;
    }
  });

  it("porta a un heading dopo accenti ed emoji esattamente dove sta", () => {
    const doc = "# Però àèì\n\n## Sezione 🎯\n\ncoda\n";
    const heading = "## Sezione 🎯";
    const byte = byteStartOf(doc, heading);
    expect(byteToCharIndex(doc, byte)).toBe(doc.indexOf(heading));
  });

  it("conta l'emoji come due code unit (surrogate pair)", () => {
    const doc = "🎯x"; // 🎯 = 4 byte / 2 code unit, poi 'x'
    expect(byteToCharIndex(doc, 4)).toBe(2); // la 'x' è al code unit 2
  });

  it("non spezza: offset 0 e oltre la fine sono i due estremi", () => {
    const doc = "àbc";
    expect(byteToCharIndex(doc, 0)).toBe(0);
    // 'à' = 2 byte, quindi 4 byte totali; oltre → fine (3 code unit)
    expect(byteToCharIndex(doc, 999)).toBe(doc.length);
    expect(byteToCharIndex(doc, 0)).toBe(0);
  });

  it("arrotonda al confine successivo un offset che cade dentro un carattere", () => {
    const doc = "à"; // byte 0..2 sono lo stesso carattere (code unit 0)
    // un offset a metà carattere (byte 1) non esiste in uno Span vero, ma non
    // deve lanciare: arrotonda in avanti al confine (fine → 1 code unit)
    expect(byteToCharIndex(doc, 1)).toBe(1);
  });
});

// Il ponte inverso (code unit UTF-16 → byte UTF-8) è ciò che permette a una
// azione dell'editor di parlare di `Span` al kernel: senza, la selezione non
// attraversa il confine e nessuna delle feature che la vogliono (slash command
// sul testo selezionato, commenti inline, annotazioni) può essere un provider.
// Sbagliarlo non lancia: taglia i byte sbagliati, in silenzio, su testo
// accentato — cioè su ogni nota in italiano.
describe("charToByteIndex", () => {
  it("è l'identità su ASCII puro", () => {
    const t = "# Titolo\n\ntesto\n";
    for (let i = 0; i <= t.length; i++) {
      expect(charToByteIndex(t, i)).toBe(i);
    }
  });

  it("è l'inversa di byteToCharIndex su ogni confine di carattere", () => {
    const doc = "# Però\n\ntesto èàì\n\n## Sezione 🎯 fine\n\ncoda\n";
    let bytes = 0;
    let units = 0;
    for (const ch of doc) {
      expect(charToByteIndex(doc, units)).toBe(bytes);
      expect(byteToCharIndex(doc, bytes)).toBe(units);
      bytes += enc.encode(ch).length;
      units += ch.codePointAt(0)! > 0xffff ? 2 : 1;
    }
    // E anche sull'estremo finale, che il ciclo non tocca.
    expect(charToByteIndex(doc, units)).toBe(bytes);
  });

  it("dà il byte esatto di una selezione dopo accenti ed emoji", () => {
    const doc = "Però àèì 🎯 selezione qui";
    const sub = "selezione";
    const start = doc.indexOf(sub);
    expect(charToByteIndex(doc, start)).toBe(byteStartOf(doc, sub));
    // e lo span intero ritaglia esattamente la parola, lato Rust (byte).
    const bytes = enc.encode(doc);
    const span = [charToByteIndex(doc, start), charToByteIndex(doc, start + sub.length)];
    expect(new TextDecoder().decode(bytes.subarray(span[0], span[1]))).toBe(sub);
  });

  it("non spezza: 0, oltre la fine, e dentro una coppia surrogata", () => {
    const doc = "🎯x"; // 4 byte / 2 code unit, poi 'x'
    expect(charToByteIndex(doc, 0)).toBe(0);
    expect(charToByteIndex(doc, 2)).toBe(4);
    expect(charToByteIndex(doc, 999)).toBe(5);
    // Indice a metà della coppia surrogata: arrotonda al confine successivo,
    // come fa l'andata. Non esiste in una selezione vera, non deve lanciare.
    expect(charToByteIndex(doc, 1)).toBe(4);
  });
});

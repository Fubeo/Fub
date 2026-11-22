// @vitest-environment happy-dom
//
// Gli indici e gli a capo fra la casella del Testo e il motore (K6 T16):
// l'IME conta in UTF-16, il motore in caratteri e in byte UTF-8.

import { describe, expect, it } from "vitest";

import { daUtf16, daUtf8, righeUnix, tastoDelTesto } from "./scrittura";

describe("gli indici fra JavaScript e il motore", () => {
  it("un'emoji è un carattere solo, anche se in JavaScript vale due", () => {
    const testo = "a🌧b";
    expect(daUtf16(testo, 0)).toBe(0);
    expect(daUtf16(testo, 1)).toBe(1);
    expect(daUtf16(testo, 3)).toBe(2);
    expect(daUtf16(testo, 4)).toBe(3);
    // Oltre la fine conta la fine.
    expect(daUtf16(testo, 99)).toBe(3);
  });

  it("un accento composto resta due caratteri, come per il motore", () => {
    expect(daUtf16("éx", 2)).toBe(2);
    expect(daUtf16("é", 1)).toBe(1);
  });

  it("i byte UTF-8 del motore diventano indici di JavaScript", () => {
    const testo = "Città 🌧!";
    // C i t t = 4 byte, à = 2, spazio = 1, 🌧 = 4.
    expect(daUtf8(testo, 4)).toBe(4);
    expect(daUtf8(testo, 6)).toBe(5);
    expect(daUtf8(testo, 7)).toBe(6);
    expect(daUtf8(testo, 11)).toBe(8);
    expect(daUtf8(testo, 12)).toBe(9);
    // A metà di un carattere: il suo inizio; oltre la fine: la fine.
    expect(daUtf8(testo, 5)).toBe(4);
    expect(daUtf8(testo, 9)).toBe(6);
    expect(daUtf8(testo, 99)).toBe(testo.length);
  });
});

describe("gli a capo", () => {
  it("quelli di Windows e del vecchio Mac diventano uno solo", () => {
    expect(righeUnix("uno\r\ndue\rtre\nquattro")).toBe("uno\ndue\ntre\nquattro");
    expect(righeUnix("\r\n\r\n")).toBe("\n\n");
  });
});

describe("i tasti del testo", () => {
  it("i tasti che modificano o muovono vanno al motore, con Ctrl come cmd; le lettere no", () => {
    const invio = tastoDelTesto(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", shiftKey: true }));
    expect(invio).toEqual({ kind: "key", key: "Enter", code: "Enter", mods: { shift: true, alt: false, cmd: false }, pressed: true });
    const parola = tastoDelTesto(new KeyboardEvent("keydown", { key: "ArrowLeft", code: "ArrowLeft", ctrlKey: true }));
    expect(parola).toMatchObject({ key: "ArrowLeft", mods: { cmd: true } });
    expect(tastoDelTesto(new KeyboardEvent("keydown", { key: "a", code: "KeyA" }))).toBeNull();
    expect(tastoDelTesto(new KeyboardEvent("keydown", { key: " ", code: "Space" }))).toBeNull();
  });
});

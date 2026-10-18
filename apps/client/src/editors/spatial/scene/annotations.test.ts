// Il lettore delle annotazioni contro quello di `fub-scene`: le fixture di
// `__fixtures__/annotations/` le scrive Rust (`tests/annotation_mirror.rs`),
// e qui lo stesso file deve dare le stesse pagine, le stesse note e gli
// stessi span.

import { describe, expect, it } from "vitest";
import { digest, isNoteBody, noteBody, pageSize, positive, readAnnotations } from "./annotations";

const sources = import.meta.glob("../../../__fixtures__/annotations/*.fubann", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const expected = import.meta.glob("../../../__fixtures__/annotations/*.json", {
  import: "default",
  eager: true,
}) as Record<string, unknown>;

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.(fubann|json)$/, "");
}

describe("le annotazioni di fub-scene", () => {
  it("ci sono le tre coppie che Rust scrive", () => {
    expect(Object.keys(sources).map(nameOf).sort()).toEqual(["bando", "bordi", "crlf-bom"]);
    expect(Object.keys(expected).map(nameOf).sort()).toEqual(["bando", "bordi", "crlf-bom"]);
  });

  for (const [path, source] of Object.entries(sources)) {
    const name = nameOf(path);
    it(`${name}: le stesse pagine e le stesse note`, () => {
      const json = Object.entries(expected).find(([other]) => nameOf(other) === name)![1];
      expect(JSON.parse(JSON.stringify(readAnnotations(source)))).toEqual(json);
    });
  }
});

describe("le grammatiche", () => {
  it("un numero di pagine è un intero positivo in cifre decimali a 32 bit", () => {
    expect(positive("12")).toBe(12);
    expect(positive("007")).toBe(7);
    expect(positive("4294967295")).toBe(0xffff_ffff);
    for (const wrong of ["", "0", "-1", "+1", "1.0", " 1", "1 ", "4294967296", "uno", undefined]) expect(positive(wrong)).toBeNull();
  });

  it("un'impronta è sha256: e 64 cifre, in minuscolo", () => {
    const hex = "0123456789abcdef".repeat(4);
    expect(digest(`sha256:${hex}`)).toBe(`sha256:${hex}`);
    expect(digest(`sha256:${hex.toUpperCase()}`)).toBe(`sha256:${hex}`);
    for (const wrong of [`SHA256:${hex}`, `sha1:${hex}`, `sha256:${hex.slice(1)}`, `sha256:${hex}0`, ` sha256:${hex}`, "sha256:"]) {
      expect(digest(wrong)).toBeNull();
    }
  });

  it("una dimensione di pagina è due numeri positivi", () => {
    expect(pageSize("595.28 841.89")).toEqual([595.28, 841.89]);
    expect(pageSize(" 612,792 ")).toEqual([612, 792]);
    for (const wrong of ["", "595", "595 842 1", "0 842", "595 -842", "a b"]) expect(pageSize(wrong)).toBeNull();
  });

  it("un corpo ha i terminatori a LF e non è fatto di soli spazi", () => {
    expect(noteBody("a\r\nb\rc\nd")).toBe("a\nb\nc\nd");
    expect(isNoteBody(" \t\n")).toBe(false);
    expect(isNoteBody("　")).toBe(false);
    expect(isNoteBody("﻿")).toBe(true);
    expect(isNoteBody("nota")).toBe(true);
  });
});

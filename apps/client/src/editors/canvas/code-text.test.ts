// Le parole di «Incolla codice» (LIC T25): la lettura del testo degli appunti,
// i problemi del nucleo che il catalogo sa dire e gli avvisi contati per specie.
import { describe, expect, it } from "vitest";

import CHECK_RS from "../../../../../crates/fub-canvas-core/src/check.rs?raw";
import { t } from "../../i18n/strings";
import { MAX_CODE_DEPTH, PROBLEMS, readCodeList, warningsText } from "./code-text";
import type { CanvasCheckWarning } from "./wasm/core";

/** Le varianti di `pub enum Code` in `check.rs`, in snake_case come le scrive serde. */
function rustCodes(source: string): string[] {
  const body = /pub enum Code \{([\s\S]*?)\n\}/.exec(source)?.[1];
  if (!body) throw new Error("`pub enum Code` non trovato in check.rs");
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z][A-Za-z]*,$/.test(line))
    .map((line) => line.slice(0, -1).replace(/(?<!^)([A-Z])/g, "_$1").toLowerCase());
}

describe("i problemi del nucleo", () => {
  it("il catalogo sa dire ogni codice di `Code` (check.rs), e solo quelli", () => {
    const codes = rustCodes(CHECK_RS);
    expect(codes).toContain("invalid");
    expect(codes).toContain("foreign_layer");
    expect([...PROBLEMS].sort()).toEqual([...codes].sort());
    for (const code of codes) expect(t(`canvas.code.problem.${code}` as Parameters<typeof t>[0])).not.toBe(`canvas.code.problem.${code}`);
  });
});

describe("readCodeList", () => {
  it("legge una lista, anche col BOM e gli spazi attorno", () => {
    expect(readCodeList('﻿  [{"op":"remove","ids":["a"]}]\n')).toEqual({ ok: true, ops: [{ op: "remove", ids: ["a"] }] });
  });

  it("dà un codice per ogni testo che non è una lista da controllare", () => {
    const problem = (text: string) => {
      const read = readCodeList(text);
      return read.ok ? null : read.problem;
    };
    expect(problem("")).toBe("empty");
    expect(problem("﻿ \n\t")).toBe("empty");
    expect(problem("graph TD; A-->B")).toBe("not_json");
    expect(problem('{"op":"remove"}')).toBe("not_list");
    expect(problem("null")).toBe("not_list");
    expect(problem('"[]"')).toBe("not_list");
    expect(problem("[]")).toBe("nothing");
    expect(problem("[1e999]")).toBe("bad_number");
    expect(problem('[{"x":-1e400}]')).toBe("bad_number");
    expect(problem('["\\ud800"]')).toBe("bad_text");
    expect(problem('[{"\\udc00":1}]')).toBe("bad_text");
    expect(problem('["\\ud83d\\ude00"]')).toBeNull();
  });

  it("si ferma oltre `MAX_CODE_DEPTH` livelli, ben prima del tetto del nucleo", () => {
    const nested = (depth: number) => `${"[".repeat(depth)}${"]".repeat(depth)}`;
    expect(readCodeList(nested(MAX_CODE_DEPTH)).ok).toBe(true);
    expect(readCodeList(nested(MAX_CODE_DEPTH + 1))).toEqual({ ok: false, problem: "too_deep" });
    expect(readCodeList(nested(129))).toEqual({ ok: false, problem: "too_deep" });
    // Gli oggetti contano come le liste.
    const objects = `[${'{"a":'.repeat(MAX_CODE_DEPTH)}1${"}".repeat(MAX_CODE_DEPTH)}]`;
    expect(readCodeList(objects)).toEqual({ ok: false, problem: "too_deep" });
  });
});

describe("warningsText", () => {
  const warning = (code: string): CanvasCheckWarning => ({ code, index: 0 } as unknown as CanvasCheckWarning);

  it("conta gli avvisi da guardare per specie e dice le note una volta per specie", () => {
    const text = warningsText([
      warning("overlap"), warning("overlap"), warning("text_overflow"), warning("ink_kept"), warning("ink_kept"), warning("pages_cut"),
    ], 3);
    expect(text).toBe([
      t("canvas.paste_code.warnings", {
        list: [
          t("canvas.paste_code.warn.overlap", { n: 2 }),
          t("canvas.paste_code.warn.text_overflow.one"),
          t("canvas.paste_code.warn.omitted", { n: 3 }),
        ].join(", "),
      }),
      t("canvas.paste_code.notes", {
        list: [t("canvas.paste_code.note.ink"), t("canvas.paste_code.note.pages_cut")].join("; "),
      }),
    ].join(" "));
  });

  it("senza avvisi niente; una nota sconosciuta ha la frase di riserva", () => {
    expect(warningsText([], 0)).toBe("");
    expect(warningsText([warning("half_in_group")], 0))
      .toBe(t("canvas.paste_code.warnings", { list: t("canvas.paste_code.warn.half_in_group.one") }));
    expect(warningsText([warning("nuova")], 0)).toBe(t("canvas.paste_code.notes", { list: t("canvas.paste_code.note.other") }));
  });
});

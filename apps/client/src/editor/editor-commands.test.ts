import { describe, expect, it } from "vitest";
import { editingExtensions, obsidianKeymap } from "./editor-commands";
import { textKeymap } from "../editors/text/commands";
import {
  markdownEditingExtensions,
  markdownKeymap,
} from "../editors/text/profiles/markdown/commands";

describe("compatibilità del vecchio entry point", () => {
  it("mantiene l'ordine e gli accordi montati dall'editor", () => {
    expect(obsidianKeymap.map(({ key }) => key)).toEqual([
      "Mod-b",
      "Mod-i",
      "Mod-Shift-x",
      "Mod-`",
      "Mod-k",
      "Enter",
      "Mod-Enter",
      "Tab",
      "Shift-Tab",
      "Mod-d",
      "Alt-ArrowUp",
      "Alt-ArrowDown",
      "Mod-Shift-8",
      "Mod-Shift-7",
    ]);
  });

  it("compone il keymap Markdown con quello condiviso senza duplicati", () => {
    const expected = [
      ...markdownKeymap.slice(0, 9),
      ...textKeymap,
      ...markdownKeymap.slice(9),
    ];
    expect(obsidianKeymap).toEqual(expected);
  });

  it("mantiene l'entry point della factory come re-export", () => {
    expect(editingExtensions).toBe(markdownEditingExtensions);
  });
});

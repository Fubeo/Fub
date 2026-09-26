// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { textProfileExtensions } from "./by-id";

const hooks = { documentId: "note.md", openWikilink: vi.fn(), openPath: vi.fn(), searchTag: vi.fn() };

describe("i profili di testo per id", () => {
  it("markdown porta la sua lingua, plain-text nessuna, un id non di testo niente", () => {
    const markdown = textProfileExtensions("markdown", hooks)!;
    const note = EditorState.create({ doc: "# Titolo\n", extensions: markdown() });
    expect(syntaxTree(note).topNode.firstChild?.name).toBe("ATXHeading1");

    const plain = textProfileExtensions("plain-text", hooks)!;
    const bare = EditorState.create({ doc: "# Titolo\n", extensions: plain() });
    expect(syntaxTree(bare).topNode.firstChild).toBeNull();

    expect(textProfileExtensions("canvas", hooks)).toBeNull();
  });
});

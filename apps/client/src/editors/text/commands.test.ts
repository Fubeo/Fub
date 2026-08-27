import { describe, expect, it } from "vitest";
import { EditorSelection, EditorState, type StateCommand } from "@codemirror/state";
import { duplicateLines } from "./commands";

function mk(spec: string): EditorState {
  const open = spec.indexOf("‹");
  if (open !== -1) {
    const stripped = spec.replace("‹", "");
    const close = stripped.indexOf("›");
    return EditorState.create({
      doc: stripped.replace("›", ""),
      selection: EditorSelection.single(open, close),
    });
  }
  const bar = spec.indexOf("|");
  return EditorState.create({
    doc: spec.replace("|", ""),
    selection: EditorSelection.single(bar === -1 ? 0 : bar),
  });
}

function show(state: EditorState): string {
  const doc = state.doc.toString();
  const { from, to } = state.selection.main;
  if (from === to) return `${doc.slice(0, from)}|${doc.slice(from)}`;
  return `${doc.slice(0, from)}‹${doc.slice(from, to)}›${doc.slice(to)}`;
}

function run(cmd: StateCommand, spec: string): { handled: boolean; out: string } {
  const state = mk(spec);
  let out = show(state);
  const handled = cmd({
    state,
    dispatch: (tr) => {
      out = show(tr.state);
    },
  });
  return { handled, out };
}

describe("duplicateLines", () => {
  it("duplica la riga corrente sotto, col cursore sulla copia", () => {
    expect(run(duplicateLines, "ab|c\nx").out).toBe("abc\nab|c\nx");
  });

  it("duplica il blocco della selezione", () => {
    expect(run(duplicateLines, "‹a\nb›\nc").out).toBe("a\nb\n‹a\nb›\nc");
  });

  it("regge emoji e accenti (l'ultima riga, senza newline finale)", () => {
    expect(run(duplicateLines, "🎯à|").out).toBe("🎯à\n🎯à|");
  });
});

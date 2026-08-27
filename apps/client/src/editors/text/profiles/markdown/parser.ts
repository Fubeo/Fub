import { syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

const CODE_NODE_NAMES: Record<string, true> = {
  CodeBlock: true,
  FencedCode: true,
  InlineCode: true,
};

/// Returns true for a position inside Markdown code syntax.
///
/// `resolve(pos, -1)` intentionally resolves the node to the left at a
/// boundary. Closed inline/fenced code therefore requires a strict upper
/// bound, while delimiter-free indented code (and an unclosed fence) includes
/// its end-of-content insertion point.
export function isStrictlyInsideCode(state: EditorState, pos: number): boolean {
  let node = syntaxTree(state).resolve(pos, -1);
  while (true) {
    if (CODE_NODE_NAMES[node.name] === true) {
      if (node.from < pos && pos < node.to) return true;
      if (pos === node.to && node.name === "CodeBlock") return true;
      if (
        pos === node.to &&
        node.name === "FencedCode" &&
        node.node.getChildren("CodeMark").length < 2
      ) {
        return true;
      }
      return false;
    }
    const parent = node.parent;
    if (!parent) return false;
    node = parent;
  }
}

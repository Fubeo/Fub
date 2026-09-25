// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createTextEngine } from "../../engine";
import { createMarkdownProfile } from "./profile";
import { markdownFromClipboard } from "./paste";

function paste(
  html: string,
  plain: string,
  markdown = "",
  selection?: EditorSelection,
  dispatch = true,
) {
  const host = document.createElement("div");
  document.body.append(host);
  const profile = createMarkdownProfile({
    callbacks: { openWikilink: () => {}, searchTag: () => {} },
    completions: { searchNotes: async () => [], listTags: async () => [] },
  });
  const changes: string[] = [];
  const engine = createTextEngine(host, {
    onChange: (change) => changes.push(change.text),
    onSelectionChange: () => {},
    extensions: () => profile.extensions(),
  });
  const view = EditorView.findFromDOM(host)!;
  engine.setDoc("prima\r\nqui\r\nfine");
  view.dispatch({ selection: selection ?? EditorSelection.range(6, 9) });
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData(type: string) {
        return type === "text/html" ? html : type === "text/markdown" ? markdown : plain;
      },
    },
  });
  if (dispatch) view.contentDOM.dispatchEvent(event);
  return { engine, view, event, changes, host };
}

describe("Markdown clipboard paste", () => {
  it("converts lists, links, and fenced code without changing unrelated CRLF bytes", () => {
    const { engine, event, changes, host } = paste(
      '<ul><li><a href="https://example.org/a">Link</a></li><li><pre><code>let x = 1;</code></pre></li></ul>',
      "Link\nlet x = 1;",
    );
    expect(event.defaultPrevented).toBe(true);
    expect(engine.getDoc()).toContain("[Link](https://example.org/a)");
    expect(engine.getDoc()).toContain("let x = 1;");
    expect(engine.getDoc()).toMatch(/```/u);
    expect(engine.getDoc().startsWith("prima\r\n")).toBe(true);
    expect(engine.getDoc().endsWith("\r\nfine")).toBe(true);
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe("prima\r\nqui\r\nfine");
    engine.destroy();
    host.remove();
  });

  it("replaces every selected range in one undoable paste", () => {
    const selection = EditorSelection.create([
      EditorSelection.range(0, 5), EditorSelection.range(6, 9),
    ], 1);
    const { engine, changes, host } = paste("<strong>ricevuto</strong>", "ricevuto", "", selection);
    expect(engine.getDoc()).toBe("**ricevuto**\r\n**ricevuto**\r\nfine");
    expect(changes).toHaveLength(1);
    expect(engine.undo()).toBe(true);
    expect(engine.getDoc()).toBe("prima\r\nqui\r\nfine");
    engine.destroy();
    host.remove();
  });

  it("drops hostile elements, event handlers, and unsafe link destinations", () => {
    const { engine, event, host } = paste(
      '<script>attack()</script><p onclick="attack()"><a href="java&#115;cript:attack()">Safe</a> <a href="#section">Jump</a> <strong onmouseover="attack()">bold</strong></p><iframe></iframe>',
      "Safe bold",
    );
    expect(event.defaultPrevented).toBe(true);
    expect(engine.getDoc()).toContain("Safe");
    expect(engine.getDoc()).toContain("**bold**");
    expect(engine.getDoc()).toContain("[Jump](#section)");
    expect(engine.getDoc()).not.toMatch(/attack|javascript:|iframe|onclick|onmouseover/u);
    engine.destroy();
    host.remove();
  });

  it("leaves authoritative Markdown and plain-text pastes to CodeMirror", () => {
    for (const [html, plain, markdown] of [
      ["<b>plain</b>", "**already Markdown**", ""],
      ["<b>plain</b>", "plain", "# heading"],
      ["", "plain", ""],
    ]) {
      const data = {
        getData: (type: string) =>
          type === "text/html" ? html : type === "text/markdown" ? markdown : plain,
      } as DataTransfer;
      expect(markdownFromClipboard(data)).toBeNull();
    }
  });

  it("keeps a pasted vault image as Markdown without fetching it", () => {
    const data = {
      getData: (type: string) =>
        type === "text/html"
          ? '<p>vedi <img src="Risorse/logo [1].png" alt="logo [x]"> e <img src="https://remoto/x.png" alt="r"></p>'
          : type === "text/plain" ? "vedi e" : "",
    } as DataTransfer;
    expect(markdownFromClipboard(data)).toBe("vedi ![logo \\[x\\]](<Risorse/logo [1].png>) e");
  });

  it("pastes GFM tables, strikethrough and tasks as GFM", () => {
    const clipboard = (html: string) => ({
      getData: (type: string) => (type === "text/html" ? html : ""),
    }) as unknown as DataTransfer;
    const table = markdownFromClipboard(clipboard(
      '<table><thead><tr><th>Nome</th><th align="right">Voto</th></tr></thead>' +
      "<tbody><tr><td>Anna <b>B.</b></td><td>9</td></tr><tr><td>a|b</td><td>7</td></tr></tbody></table>",
    ))!;
    expect(table.trim().split("\n")).toEqual([
      "| Nome | Voto |",
      "| --- | ---: |",
      "| Anna **B.** | 9 |",
      "| a\\|b | 7 |",
    ]);
    expect(markdownFromClipboard(clipboard("<p>era <del>vecchio</del> nuovo</p>"))).toBe("era ~~vecchio~~ nuovo");
    const tasks = markdownFromClipboard(clipboard(
      '<ul><li><input type="checkbox" checked> fatto</li><li><input type="checkbox"> da fare</li></ul>',
    ))!;
    expect(tasks).toContain("[x] fatto");
    expect(tasks).toContain("[ ] da fare");
    // L'involucro di Google Docs non è un grassetto.
    expect(markdownFromClipboard(clipboard(
      '<b style="font-weight:normal;" id="docs-internal-guid-1"><p>testo <b>forte</b></p></b>',
    ))).toBe("testo **forte**");
  });

  it("does not intercept HTML paste during composition", () => {
    const { engine, view, host } = paste("<b>bold</b>", "bold", "", undefined, false);
    view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (type: string) => type === "text/html" ? "<b>bold</b>" : "bold" },
    });
    view.contentDOM.dispatchEvent(event);
    expect(engine.getDoc()).toBe("prima\r\nbold\r\nfine");
    engine.destroy();
    host.remove();
  });
});

// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
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
  // Turndown arriva in un chunk suo: lo si aspetta una volta, e gli incolla
  // qui sotto trovano il convertitore già pronto, come in un editor montato
  // da qualche istante.
  beforeAll(async () => {
    await markdownFromClipboard({ getData: (type: string) => (type === "text/html" ? "<b>x</b>" : "") } as DataTransfer);
  });

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

  it("leaves authoritative Markdown and plain-text pastes to CodeMirror", async () => {
    for (const [html, plain, markdown] of [
      ["<b>plain</b>", "**already Markdown**", ""],
      ["<b>plain</b>", "plain", "# heading"],
      ["", "plain", ""],
    ]) {
      const data = {
        getData: (type: string) =>
          type === "text/html" ? html : type === "text/markdown" ? markdown : plain,
      } as DataTransfer;
      expect(await markdownFromClipboard(data)).toBeNull();
    }
  });

  it("keeps a pasted vault image as Markdown without fetching it", async () => {
    const data = {
      getData: (type: string) =>
        type === "text/html"
          ? '<p>vedi <img src="Risorse/logo [1].png" alt="logo [x]"> e <img src="https://remoto/x.png" alt="r"></p>'
          : type === "text/plain" ? "vedi e" : "",
    } as DataTransfer;
    expect(await markdownFromClipboard(data)).toBe("vedi ![logo \\[x\\]](<Risorse/logo [1].png>) e");
  });

  it("pastes GFM tables, strikethrough and tasks as GFM", async () => {
    const clipboard = (html: string) => ({
      getData: (type: string) => (type === "text/html" ? html : ""),
    }) as unknown as DataTransfer;
    const table = (await markdownFromClipboard(clipboard(
      '<table><thead><tr><th>Nome</th><th align="right">Voto</th></tr></thead>' +
      "<tbody><tr><td>Anna <b>B.</b></td><td>9</td></tr><tr><td>a|b</td><td>7</td></tr></tbody></table>",
    )))!;
    expect(table.trim().split("\n")).toEqual([
      "| Nome | Voto |",
      "| --- | ---: |",
      "| Anna **B.** | 9 |",
      "| a\\|b | 7 |",
    ]);
    expect(await markdownFromClipboard(clipboard("<p>era <del>vecchio</del> nuovo</p>"))).toBe("era ~~vecchio~~ nuovo");
    const tasks = (await markdownFromClipboard(clipboard(
      '<ul><li><input type="checkbox" checked> fatto</li><li><input type="checkbox"> da fare</li></ul>',
    )))!;
    expect(tasks).toContain("[x] fatto");
    expect(tasks).toContain("[ ] da fare");
    // L'involucro di Google Docs non è un grassetto.
    expect(await markdownFromClipboard(clipboard(
      '<b style="font-weight:normal;" id="docs-internal-guid-1"><p>testo <b>forte</b></p></b>',
    ))).toBe("testo **forte**");
  });

  it("converts each table cell once, whatever the nesting and the raggedness", async () => {
    const clipboard = (html: string) => ({
      getData: (type: string) => (type === "text/html" ? html : ""),
    }) as unknown as DataTransfer;
    // Una tabella dentro una cella resta nella sua cella: le righe della
    // tabella esterna sono le sue, non anche quelle annidate.
    expect((await markdownFromClipboard(clipboard(
      "<table><tr><th>esterna</th></tr><tr><td><table><tr><th>a</th><th>b</th></tr></table></td></tr></table>",
    )))!.trim().split("\n")).toEqual([
      "| esterna |",
      "| --- |",
      "| \\| a \\| b \\| \\| --- \\| --- \\| |",
    ]);
    // Ogni livello riconvertiva le sue celle, e il lavoro raddoppiava: trenta
    // livelli erano un miliardo di conversioni.
    const depth = 30;
    const nested = (await markdownFromClipboard(clipboard(
      "<table><tr><td>".repeat(depth) + "fondo" + "</td></tr></table>".repeat(depth),
    )))!;
    expect(nested).toContain("fondo");
    // Una riga larga sopra molte righe corte: GFM completa da sé le righe
    // corte, e completarle costava righe × colonne.
    const cells = 2000;
    const ragged = (await markdownFromClipboard(clipboard(
      "<table><tr>" + "<th>h</th>".repeat(cells) + "</tr>" + "<tr><td>b</td></tr>".repeat(cells) + "</table>",
    )))!.trim().split("\n");
    expect(ragged[0]!.split("| h").length - 1).toBe(cells);
    expect(ragged[2]).toBe("| b |");
    expect(ragged).toHaveLength(cells + 2);
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

  it("pastes before Turndown arrives, once, on the selection of that moment", async () => {
    // Un modulo nuovo, con Turndown ancora da caricare: l'incolla non può
    // aspettarlo dentro l'evento, e non deve cadere su CodeMirror.
    vi.resetModules();
    const { EditorView: View } = await import("@codemirror/view");
    const { markdownPaste } = await import("./paste");
    const view = new View({ doc: "prima qui", extensions: markdownPaste, parent: document.body });
    view.dispatch({ selection: { anchor: 6, head: 9 } });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (type: string) => type === "text/html" ? "<b>forte</b>" : type === "text/plain" ? "forte" : "" },
    });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("prima qui");
    await vi.waitFor(() => expect(view.state.doc.toString()).toBe("prima **forte**"));
    view.destroy();
  });
});

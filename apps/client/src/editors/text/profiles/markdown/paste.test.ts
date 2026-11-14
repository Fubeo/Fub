// @vitest-environment happy-dom
import { beforeAll, describe, expect, it, vi } from "vitest";
import { EditorSelection, Prec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createTextEngine } from "../../engine";
import { createMarkdownProfile } from "./profile";
import { markdownFromClipboard, markdownPaste, pastePlainText } from "./paste";
import { declareClipboard } from "../../../../platform/clipboard";
import { pasteHtml } from "../../paste-html";

const DOC = "prima\r\nqui\r\nfine";
/// Come `DOC`, con una riga vuota al posto di «qui»: il cursore sta a 6.
const BLANK = "prima\r\n\r\nfine";

/// Un clic sul pulsante, come lo manda il puntatore.
function press(element: Element | null | undefined): void {
  element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function paste(
  html: string,
  plain: string,
  markdown = "",
  selection?: EditorSelection,
  dispatch = true,
  doc = DOC,
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
  engine.setDoc(doc);
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

  it("un indirizzo incollato sul testo selezionato diventa un link", () => {
    const link = paste("", "https://example.org/a(b)");
    expect(link.event.defaultPrevented).toBe(true);
    expect(link.engine.getDoc()).toBe("prima\r\n[qui](https://example.org/a%28b%29)\r\nfine");
    link.engine.destroy();
    link.host.remove();
    // Senza selezione, o con del testo che non è un indirizzo, l'incolla resta il solito.
    const plain = paste("", "non è un link");
    expect(plain.engine.getDoc()).not.toContain("](");
    plain.engine.destroy();
    plain.host.remove();
    const empty = paste("", "https://example.org", "", EditorSelection.single(6));
    expect(empty.engine.getDoc()).not.toContain("](");
    empty.engine.destroy();
    empty.host.remove();
  });

  it("su una riga vuota un indirizzo diventa link, e la scelta Link o Scheda sta sotto", () => {
    const { engine, event, view, host } = paste("", "https://example.org/a", "", EditorSelection.single(6), true, BLANK);
    expect(event.defaultPrevented).toBe(true);
    expect(engine.getDoc()).toBe("prima\r\n[https://example.org/a](https://example.org/a)\r\nfine");
    // La scelta è un gruppo di due pulsanti: Link premuto, Scheda no.
    const choice = host.querySelector(".cm-fub-address-choice");
    expect(choice?.getAttribute("role")).toBe("group");
    const buttons = [...(choice?.querySelectorAll("button") ?? [])];
    expect(buttons.map((button) => button.textContent)).toEqual(["Link", "Scheda"]);
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    // Il pulsante non prende il fuoco: il mousedown non esce dall'editor.
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    buttons[1]!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    // Scheda scrive l'indirizzo da solo sulla riga: è la scheda del segnalibro.
    press(buttons[1]!);
    expect(engine.getDoc()).toBe("prima\r\nhttps://example.org/a\r\nfine");
    expect(host.querySelector(".cm-fub-address-choice")).toBeNull();
    expect(view.state.selection.main.head).toBe(6 + "https://example.org/a".length);
    engine.destroy();
    host.remove();
  });

  it("la scelta Link, Invio o un'altra battuta tengono il link, e il cursore che esce chiude la scelta", () => {
    const link = "[https://example.org/a](https://example.org/a)";
    // Link: il link resta, la scelta si chiude.
    const kept = paste("", "https://example.org/a", "", EditorSelection.single(6), true, BLANK);
    press(kept.host.querySelector('[data-choice="link"]'));
    expect(kept.engine.getDoc()).toBe(`prima\r\n${link}\r\nfine`);
    expect(kept.host.querySelector(".cm-fub-address-choice")).toBeNull();
    kept.engine.destroy();
    kept.host.remove();
    // Una battuta (Invio qui): il link resta, la scelta non torna.
    const typed = paste("", "https://example.org/a", "", EditorSelection.single(6), true, BLANK);
    const end = typed.view.state.selection.main.head;
    typed.view.dispatch({ changes: { from: end, insert: "\n" }, selection: { anchor: end + 1 }, userEvent: "input.type" });
    expect(typed.engine.getDoc()).toContain(link);
    expect(typed.host.querySelector(".cm-fub-address-choice")).toBeNull();
    typed.engine.destroy();
    typed.host.remove();
    // Il cursore che lascia la riga: la scelta si chiude, il testo resta.
    const left = paste("", "https://example.org/a", "", EditorSelection.single(6), true, BLANK);
    left.view.dispatch({ selection: { anchor: 0 } });
    expect(left.host.querySelector(".cm-fub-address-choice")).toBeNull();
    expect(left.engine.getDoc()).toContain(link);
    left.engine.destroy();
    left.host.remove();
  });

  it("l'indirizzo incollato dentro un testo entra com'è, senza link né scelta", () => {
    const { engine, host } = paste("", "https://example.org/a", "", EditorSelection.single(7));
    expect(engine.getDoc()).toBe("prima\r\nqhttps://example.org/aui\r\nfine");
    expect(host.querySelector(".cm-fub-address-choice")).toBeNull();
    engine.destroy();
    host.remove();
  });

  it("su una riga vuota la scelta non parte per un indirizzo scritto a mano", () => {
    const { engine, view, host } = paste("", "", "", EditorSelection.single(6), false, BLANK);
    for (const char of "https://example.org") {
      const at = view.state.selection.main.head;
      view.dispatch({ changes: { from: at, insert: char }, selection: { anchor: at + 1 }, userEvent: "input.type" });
    }
    expect(engine.getDoc()).toBe("prima\r\nhttps://example.org\r\nfine");
    expect(host.querySelector(".cm-fub-address-choice")).toBeNull();
    engine.destroy();
    host.remove();
  });

  it("i casi dell'incolla: mailto, spazi, più righe, codice, IME, tabella e HTML", () => {
    // mailto: un link, senza Scheda, perché la scheda è per le pagine web.
    const mail = paste("", "mailto:a@example.org", "", EditorSelection.single(6), true, BLANK);
    expect(mail.engine.getDoc()).toBe("prima\r\n[mailto:a@example.org](mailto:a@example.org)\r\nfine");
    expect(mail.host.querySelector(".cm-fub-address-choice")).toBeNull();
    mail.engine.destroy();
    mail.host.remove();
    // Con spazi non è un indirizzo: entra com'è.
    const spaced = paste("", "https://example.org/a b", "", EditorSelection.single(6), true, BLANK);
    expect(spaced.engine.getDoc()).toBe("prima\r\nhttps://example.org/a b\r\nfine");
    spaced.engine.destroy();
    spaced.host.remove();
    // Più righe: non è un indirizzo solo, e nessun link.
    const lines = paste("", "https://example.org/a\nhttps://example.org/b", "", EditorSelection.single(6), true, BLANK);
    expect(lines.engine.getDoc()).not.toContain("](");
    expect(lines.host.querySelector(".cm-fub-address-choice")).toBeNull();
    lines.engine.destroy();
    lines.host.remove();
    // Dentro un blocco di codice l'indirizzo resta testo.
    const code = paste("", "https://example.org/a", "", EditorSelection.single(10), true, "prima\r\n```\r\n\r\n```\r\nfine");
    expect(code.engine.getDoc()).toBe("prima\r\n```\r\nhttps://example.org/a\r\n```\r\nfine");
    expect(code.host.querySelector(".cm-fub-address-choice")).toBeNull();
    code.engine.destroy();
    code.host.remove();
    // Dagli appunti con HTML il titolo del link vince, e nessuna scelta.
    const titled = paste('<a href="https://example.org/a">Titolo</a>', "https://example.org/a", "", EditorSelection.single(6), true, BLANK);
    expect(titled.engine.getDoc()).toBe("prima\r\n[Titolo](https://example.org/a)\r\nfine");
    expect(titled.host.querySelector(".cm-fub-address-choice")).toBeNull();
    titled.engine.destroy();
    titled.host.remove();
    // Durante una composizione (IME) l'incolla non diventa link: entra com'è.
    const ime = paste("", "", "", EditorSelection.single(6), false, BLANK);
    ime.view.contentDOM.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const composed = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(composed, "clipboardData", {
      value: { getData: (type: string) => (type === "text/plain" ? "https://example.org/a" : "") },
    });
    ime.view.contentDOM.dispatchEvent(composed);
    expect(ime.engine.getDoc()).toBe("prima\r\nhttps://example.org/a\r\nfine");
    ime.engine.destroy();
    ime.host.remove();
  });

  it("in una cella di tabella il link non chiude la colonna", () => {
    // Il `|` dell'indirizzo si codifica, e il testo selezionato resta nella sua cella.
    const cell = paste("", "https://x.it/a|b", "", EditorSelection.single(6, 9), true, "| a | qui | b |");
    expect(cell.engine.getDoc()).toBe("| a | [qui](https://x.it/a%7Cb) | b |");
    cell.engine.destroy();
    cell.host.remove();
    // Una selezione che attraversa un `|` lo scrive escapato nel testo del link.
    const across = paste("", "https://x.it", "", EditorSelection.single(6, 13), true, "| a | qui | b |");
    expect(across.engine.getDoc()).toBe("| a | [qui \\| b](https://x.it) |");
    across.engine.destroy();
    across.host.remove();
  });

  it("Mod-Shift-v incolla il testo semplice, senza link e senza conversione", async () => {
    const entries = [{
      types: ["text/html", "text/plain"],
      getType: async (type: string) => new Blob([type === "text/html" ? "<b>https://example.org</b>" : "https://example.org"]),
    }];
    let read = async () => entries;
    const withdraw = declareClipboard(async () => {}, { write: async () => {}, read: () => read(), supports: () => true });
    try {
      const plain = paste("", "", "", undefined, false);
      expect(pastePlainText(plain.view)).toBe(true);
      await vi.waitFor(() => expect(plain.engine.getDoc()).toBe("prima\r\nhttps://example.org\r\nfine"));
      // Su una riga vuota è lo stesso: il testo com'è, senza link e senza scelta.
      const blankPlain = paste("", "", "", EditorSelection.single(6), false, BLANK);
      expect(pastePlainText(blankPlain.view)).toBe(true);
      await vi.waitFor(() => expect(blankPlain.engine.getDoc()).toBe("prima\r\nhttps://example.org\r\nfine"));
      expect(blankPlain.host.querySelector(".cm-fub-address-choice")).toBeNull();
      blankPlain.engine.destroy();
      blankPlain.host.remove();
      plain.engine.destroy();
      plain.host.remove();
      // Appunti negati: non entra niente, e niente salta.
      read = () => Promise.reject(new Error("negato"));
      const denied = paste("", "", "", undefined, false);
      pastePlainText(denied.view);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(denied.engine.getDoc()).toBe("prima\r\nqui\r\nfine");
      denied.engine.destroy();
      denied.host.remove();
    } finally {
      withdraw();
    }
  });

  it("con la conversione spenta lascia l'incolla a CodeMirror", () => {
    const incolla = (convert: boolean) => {
      const host = document.createElement("div");
      document.body.append(host);
      const view = new EditorView({ parent: host, doc: "", extensions: [Prec.highest(markdownPaste), pasteHtml.of(convert)] });
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { getData: (type: string) => (type === "text/html" ? '<a href="https://example.org/a">Link</a>' : type === "text/plain" ? "Link" : "") },
      });
      view.contentDOM.dispatchEvent(event);
      const doc = view.state.doc.toString();
      view.destroy();
      host.remove();
      return doc;
    };
    expect(incolla(true)).toContain("[Link](https://example.org/a)");
    expect(incolla(false)).toBe("Link");
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

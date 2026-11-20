// @vitest-environment happy-dom
//
// Una nota CRLF sotto le dita di Vim e dei comandi che scrivono righe con
// "\n" (#397). Il motore dichiara allo stato il separatore della nota, e
// CodeMirror divide il testo inserito solo su quello: prima della correzione
// `O` lasciava un "\n" nudo in testa alla nota e `yyp` scriveva
// "uno\nuno\r\r\n", cioè un file con a capo misti e un "\r" dentro la riga.
import { describe, expect, it } from "vitest";
import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { getCM, Vim } from "@replit/codemirror-vim";
import { createTextEngine } from "./engine";

function vimEditor(text: string, vim = true) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const saved: string[] = [];
  const ed = createTextEngine(parent, { onChange: (change) => saved.push(change.text), onSelectionChange: () => {} });
  ed.setDoc(text);
  if (vim) ed.setVim(true);
  const view = EditorView.findFromDOM(parent);
  if (!view) throw new Error("l'editor non è montato");
  const keys = (...sequence: string[]) => {
    const cm = getCM(view);
    if (!cm) throw new Error("Vim non è acceso");
    for (const key of sequence) Vim.handleKey(cm, key, "user");
  };
  const done = () => {
    ed.destroy();
    parent.remove();
  };
  return { ed, view, keys, saved, done };
}

/// Ciò che si batte in modalità inserimento arriva come un inserimento del
/// browser, non come un tasto di Vim.
function types(view: EditorView, text: string): void {
  view.dispatch(view.state.replaceSelection(text), { userEvent: "input.type" });
}

const SEQUENCES: ReadonlyArray<readonly [string, readonly string[], string?]> = [
  ["o", ["o"], "X"],
  ["O", ["O"], "X"],
  ["yyp", ["y", "y", "p"]],
  ["yyP", ["y", "y", "P"]],
  ["ddP", ["j", "d", "d", "P"]],
  ["ddp", ["d", "d", "p"]],
  ["J", ["J"]],
  ["yjP (incolla per righe)", ["y", "j", "P"]],
  ["Vjyp (selezione per righe)", ["V", "j", "y", "G", "p"]],
  ["cc", ["j", "c", "c"], "Y"],
];

/// Ogni sequenza su una nota LF e sulla stessa nota CRLF: il risultato CRLF
/// è quello LF con gli a capo della nota.
function both(sequence: readonly string[], typed?: string) {
  const results = (["\n", "\r\n"] as const).map((nl) => {
    const editor = vimEditor(["uno", "due", "tre", ""].join(nl));
    editor.keys(...sequence);
    if (typed !== undefined) {
      types(editor.view, typed);
      editor.keys("<Esc>");
    }
    const result = {
      doc: editor.ed.getDoc(),
      slice: editor.view.state.sliceDoc(),
      saved: editor.saved[editor.saved.length - 1] ?? "",
      lines: editor.view.state.doc.lines,
    };
    editor.done();
    return result;
  });
  return { lf: results[0], crlf: results[1] };
}

describe("Vim in una nota CRLF (#397)", () => {
  for (const [name, sequence, typed] of SEQUENCES) {
    it(`${name}: righe vere e a capo della nota`, () => {
      const { lf, crlf } = both(sequence, typed);
      expect(lf.doc, "la sequenza non ha cambiato niente").not.toBe("uno\ndue\ntre\n");
      expect(crlf.doc).toBe(lf.doc.replace(/\n/g, "\r\n"));
      expect(crlf.slice).toBe(crlf.doc);
      // I byte che arriverebbero al salvataggio: nessun a capo nudo.
      expect(crlf.saved).toBe(crlf.doc);
      expect(crlf.saved.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
      expect(crlf.lines).toBe(lf.lines);
    });
  }

  it("un passo di annullamento toglie la riga nuova e lascia la nota com'era", () => {
    const editor = vimEditor("uno\r\ndue\r\n");
    editor.keys("y", "y", "p");
    expect(editor.ed.getDoc()).toBe("uno\r\nuno\r\ndue\r\n");
    editor.keys("u");
    expect(editor.ed.getDoc()).toBe("uno\r\ndue\r\n");
    editor.done();
  });

  it("il registro di Vim tiene le righe unite da \\n anche in una nota CRLF", () => {
    const editor = vimEditor("uno\r\ndue\r\n");
    editor.keys("y", "j");
    expect(Vim.getRegisterController().getRegister('"').toString()).toBe("uno\ndue\n");
    editor.done();
  });
});

/// Dove finisce il cursore dopo `keys`, partendo dalla prima riga di
/// "uno\ndue\n" e della stessa nota
/// CRLF: le posizioni contano un a capo una posizione in entrambe.
function headAfter(...sequence: string[]) {
  return (["\n", "\r\n"] as const).map((nl) => {
    const editor = vimEditor(["uno", "due", ""].join(nl));
    editor.view.dispatch({ selection: { anchor: 0 } });
    editor.keys(...sequence);
    const head = editor.view.state.selection.main.head;
    const anchor = editor.view.state.selection.main.anchor;
    editor.done();
    return { head, anchor };
  });
}

describe("la fine della riga in una nota CRLF", () => {
  // `g$` passa da `goLineRight`, che dopo la fine della riga guarda il
  // carattere sotto il cursore: in una nota CRLF era "\r\n", non "\n", e il
  // cursore tornava indietro di un carattere.
  it("goLineRight si ferma dopo l'ultimo carattere, non sopra", () => {
    const [lf, crlf] = (["\n", "\r\n"] as const).map((nl) => {
      const editor = vimEditor(["uno", "due", ""].join(nl));
      const cm = getCM(editor.view);
      if (!cm) throw new Error("Vim non è acceso");
      editor.view.dispatch({ selection: { anchor: 0 } });
      cm.execCommand("goLineRight");
      const { head, assoc } = editor.view.state.selection.main;
      editor.done();
      return { head, assoc };
    });
    expect(lf.head, "la fine della riga «uno»").toBe(3);
    expect(crlf).toEqual(lf);
  });

  // Il cursore a blocco di Vim prende la sua larghezza dal carattere che
  // copre. Su una riga vuota il carattere è l'a capo, e Vim lo disegna come
  // uno spazio: in una nota CRLF leggeva "\r\n", non lo riconosceva, e il
  // blocco andava a capo dentro sé stesso, largo zero.
  it("il cursore a blocco su una riga vuota copre uno spazio", async () => {
    const letters = [];
    for (const nl of ["\n", "\r\n"]) {
      const editor = vimEditor(["uno", "", "due", ""].join(nl));
      editor.view.dispatch({ selection: { anchor: editor.view.state.doc.line(2).from } });
      editor.view.requestMeasure();
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      letters.push(editor.view.dom.querySelector(".cm-fat-cursor")?.textContent);
      editor.done();
    }
    expect(letters[0], "il cursore si disegna").toBe("\xa0");
    expect(letters[1]).toBe(letters[0]);
  });

  it("g$ arriva dove arriva in una nota LF", () => {
    const [lf, crlf] = headAfter("g", "$");
    expect(crlf).toEqual(lf);
  });

  it("g$ in modo visuale sceglie fin dove sceglie in una nota LF", () => {
    const [lf, crlf] = headAfter("v", "g", "$");
    expect(crlf).toEqual(lf);
  });

  it("$ e i suoi conti non cambiano con gli a capo della nota", () => {
    expect(headAfter("$")[1]).toEqual(headAfter("$")[0]);
    expect(headAfter("v", "$")[1]).toEqual(headAfter("v", "$")[0]);
    expect(headAfter("j", "$")[1]).toEqual(headAfter("j", "$")[0]);
  });
});

describe("inserimenti con a capo nudi in una nota CRLF, fuori da Vim", () => {
  it("un comando che compone righe con \\n o \\r scrive righe vere, in un passo solo", () => {
    const editor = vimEditor("a\r\nb\r\n", false);
    editor.view.dispatch({ changes: { from: 1, insert: "\n1\r2\r\n3" }, selection: { anchor: 9 }, userEvent: "input" });
    expect(editor.ed.getDoc()).toBe("a\r\n1\r\n2\r\n3\r\nb\r\n");
    expect(editor.saved[editor.saved.length - 1]).toBe("a\r\n1\r\n2\r\n3\r\nb\r\n");
    expect(editor.view.state.doc.lines).toBe(6);
    // La selezione della transazione resta dove il comando l'ha messa.
    expect(editor.view.state.selection.main.head).toBe(9);
    expect(undo(editor.view)).toBe(true);
    expect(editor.ed.getDoc()).toBe("a\r\nb\r\n");
    editor.done();
  });

  it("in una nota LF non c'è niente da correggere", () => {
    const editor = vimEditor("a\nb\n", false);
    editor.view.dispatch({ changes: { from: 1, insert: "\n1\r\n2" } });
    expect(editor.ed.getDoc()).toBe("a\n1\n2\nb\n");
    editor.done();
  });
});

/// Ciò che un evento "copy" mette negli appunti della vista.
function copies(view: EditorView, from: number, to: number): string[] {
  const copied: string[] = [];
  view.focus();
  view.dispatch({ selection: { anchor: from, head: to } });
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { clearData() {}, setData: (_: string, text: string) => copied.push(text) },
  });
  view.contentDOM.dispatchEvent(event);
  return copied;
}

describe("l'a capo di una posizione vale \"\\n\" solo dove c'è Vim", () => {
  // Il carattere sotto il cursore di Vim si legge dallo stato: la regola che
  // fa dell'a capo un "\n" vale negli stati con Vim acceso, non per ogni
  // editor della finestra.
  it("in una nota CRLF senza Vim, con Vim acceso altrove, l'a capo si copia col separatore della nota", () => {
    const withVim = vimEditor("uno\r\ndue\r\n");
    expect(withVim.view.state.sliceDoc(3, 4), "con Vim l'a capo è un carattere").toBe("\n");

    const plain = vimEditor("uno\r\ndue\r\n", false);
    expect(copies(plain.view, 3, 4)).toEqual(["\r\n"]);
    expect(plain.view.state.sliceDoc(3, 4)).toBe("\r\n");
    plain.done();
    withVim.done();
  });

  it("spento Vim, la stessa nota torna a copiare l'a capo intero", () => {
    const editor = vimEditor("uno\r\ndue\r\n");
    expect(editor.view.state.sliceDoc(3, 4)).toBe("\n");
    editor.ed.setVim(false);
    expect(copies(editor.view, 3, 4)).toEqual(["\r\n"]);
    editor.done();
  });
});

// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { createEditor, type Editor, type EditorChange } from "./editor";

// Il difetto che questo file presidia è **una perdita di dati a portata di
// scorciatoia** (§13.3): finché `setDoc` era un `dispatch` di `changes`
// normali, le modifiche fatte su una nota restavano nella cronologia di
// annullamento quando se ne apriva un'altra — e un Ctrl-Z dopo il cambio nota
// scriveva nel documento aperto il testo del **precedente**, che il
// salvataggio automatico poi persisteva.
//
// Si prova da qui e non a mano perché è il tipo di difetto che si vede solo
// facendo due gesti in fila, e che chi ha appena scritto il codice non fa mai
// in quell'ordine.
//
// La view si ripesca con `EditorView.findFromDOM`, che è come la trova la
// tastiera: il tipo `Editor` non la espone, e allargarlo per un banco di prova
// vorrebbe dire che il resto della shell può prenderla.

interface TestEditor {
  ed: Editor;
  view: () => EditorView;
  parent: HTMLElement;
}

function editor(onChange: (change: EditorChange) => void = () => {}): TestEditor {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const ed = createEditor(parent, {
    onChange,
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onSearchTag: () => {},
    completions: { searchNotes: async () => [], listTags: async () => [] },
  });
  return {
    ed,
    parent,
    view: () => {
      const v = EditorView.findFromDOM(parent);
      if (!v) throw new Error("l'editor non è montato");
      return v;
    },
  };
}

/// Una modifica come la fa l'utente: una transazione normale, che è ciò che la
/// cronologia registra.
function writes(view: EditorView, text: string): void {
  view.dispatch({ changes: { from: 0, to: 0, insert: text } });
}

describe("setDoc", () => {
  it("non lascia annullare dentro una nota le modifiche fatte in un'altra", () => {
    const { ed, view } = editor();

    ed.setDoc("prima nota");
    writes(view(), "X ");
    expect(ed.getDoc()).toBe("X prima nota");

    // Cambio nota: da qui in poi la cronologia dell'altra non deve esistere
    // più. Con un `dispatch` al posto dello stato nuovo, qui sotto si
    // leggerebbe «prima nota» — cioè il testo di un altro documento scritto
    // dentro questo, e persistito subito dopo dal debounce del salvataggio.
    ed.setDoc("seconda nota");
    expect(ed.undo()).toBe(false);
    expect(ed.getDoc()).toBe("seconda nota");
  });

  it("il testo che mette non è annullabile nemmeno da solo", () => {
    const { ed } = editor();
    ed.setDoc("contenuto");
    expect(ed.undo()).toBe(false);
    expect(ed.getDoc()).toBe("contenuto");
  });

  it("una modifica dell'utente resta annullabile", () => {
    const { ed, view } = editor();
    ed.setDoc("base");
    writes(view(), "X");
    expect(ed.getDoc()).toBe("Xbase");
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("base");
  });

  it("cambiare nota non riporta la resa inline né la luce a com'erano al montaggio", () => {
    // Lo stato nuovo si costruisce da capo, quindi i due compartment devono
    // ripartire da ciò che vale **adesso** e non dal default: senza, aprire una
    // nota rimetterebbe la modalità Sorgente in Live Preview.
    const { ed, view } = editor();
    ed.setLivePreview(false);
    const withoutPreview = view().state.facet(EditorView.decorations).length;
    ed.setDoc("altra nota");
    expect(view().state.facet(EditorView.decorations).length).toBe(withoutPreview);
  });
});

describe("syncDoc", () => {
  it("non crea una voce di undo per la modifica remota", () => {
    const changes: EditorChange[] = [];
    const { ed } = editor((change) => changes.push(change));

    ed.setDoc("prima nota");
    ed.syncDoc("seconda nota");

    expect(ed.undo()).toBe(false);
    expect(ed.getDoc()).toBe("seconda nota");
    expect(changes).toEqual([]);
  });

  it("ripiega sul testo autoritativo se la patch sorgente è stantia", () => {
    const changes: EditorChange[] = [];
    const { ed } = editor((change) => changes.push(change));

    ed.setDoc("base");
    ed.syncDoc({
      text: "server",
      operation: {
        beforeLength: 4,
        afterLength: 6,
        edits: [{ from: 0, to: 4, deleted: "xxxx", inserted: "server" }],
      },
    });

    expect(ed.getDoc()).toBe("server");
    expect(ed.undo()).toBe(false);
    expect(changes).toEqual([]);
  });

  it("conserva l'undo locale mentre applica la modifica remota", () => {
    const { ed, view } = editor();

    ed.setDoc("base");
    writes(view(), "X");
    ed.syncDoc("Xbase?");

    expect(ed.getDoc()).toBe("Xbase?");
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("base?");
  });

  it("rimappa il cursore senza riportarlo all'inizio", () => {
    const { ed, view } = editor();

    ed.setDoc("uno due");
    view().dispatch({ selection: EditorSelection.single(6) });
    ed.syncDoc("uno nuovo due");

    expect(ed.selections().primary).toEqual({ start: 12, end: 12, text: "" });
  });
});

describe("raggruppamento degli eventi utente", () => {
  it("raggruppa l'auto-pair con il carattere digitato al suo interno", () => {
    const { ed, view } = editor();
    ed.setDoc("");
    // closeBrackets emits this transaction for `[` and leaves the cursor
    // between the delimiters; the following real input transaction inserts A.
    view().dispatch({
      changes: { from: 0, insert: "[]" },
      selection: EditorSelection.single(1),
      userEvent: "input.type",
    });
    view().dispatch({
      changes: { from: 1, insert: "A" },
      selection: EditorSelection.single(2),
      userEvent: "input.type",
    });

    expect(ed.getDoc()).toBe("[A]");
    view().contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(ed.getDoc()).toBe("");
    view().contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true, cancelable: true }),
    );
    expect(ed.getDoc()).toBe("[A]");
  });

  it("mantiene separate le transazioni di composizione", () => {
    const { ed, view } = editor();
    ed.setDoc("");
    view().dispatch({ changes: { from: 0, insert: "あ" }, userEvent: "input.type.compose" });
    view().dispatch({ changes: { from: 1, insert: "い" }, userEvent: "input.type.compose" });

    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("あ");
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("");
  });

  it("mantiene separate le transazioni di incolla", () => {
    const { ed, view } = editor();
    ed.setDoc("");
    view().dispatch({ changes: { from: 0, insert: "uno" }, userEvent: "input.paste" });
    view().dispatch({ changes: { from: 3, insert: "due" }, userEvent: "input.paste" });

    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("uno");
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("");
  });

  it("ripristina la selezione dopo undo e redo", () => {
    const { ed, view } = editor();
    ed.setDoc("abc");
    view().dispatch({ selection: EditorSelection.single(1) });
    view().dispatch({
      changes: { from: 1, insert: "X" },
      selection: EditorSelection.single(2),
      userEvent: "input.type",
    });

    expect(ed.selections().primary.start).toBe(2);
    expect(ed.undo()).toBe(true);
    expect(ed.selections().primary.start).toBe(1);
    expect(ed.redo()).toBe(true);
    expect(ed.selections().primary.start).toBe(2);
  });
});

describe("due superfici dello stesso documento", () => {
  it("mantiene buffer condiviso, undo locali e redo senza echi", () => {
    let buffer = "base";
    let changesA = 0;
    let changesB = 0;
    let second: TestEditor | undefined;
    const first = editor((change) => {
      changesA += 1;
      buffer = change.text;
      second?.ed.syncDoc({ text: buffer, operation: change.operation });
    });
    second = editor((change) => {
      changesB += 1;
      buffer = change.text;
      first.ed.syncDoc({ text: buffer, operation: change.operation });
    });

    first.ed.setDoc(buffer);
    second.ed.setDoc(buffer);
    first.view().dispatch({
      changes: { from: first.view().state.doc.length, insert: " [A]" },
    });
    second.view().dispatch({
      changes: { from: second.view().state.doc.length, insert: " [B]" },
    });
    expect(first.ed.getDoc()).toBe("base [A] [B]");
    expect(second.ed.getDoc()).toBe("base [A] [B]");
    expect(changesA).toBe(1);
    expect(changesB).toBe(1);

    expect(first.ed.undo()).toBe(true);
    expect(first.ed.getDoc()).toBe("base [B]");
    expect(second.ed.getDoc()).toBe("base [B]");
    expect(changesA).toBe(2);
    expect(changesB).toBe(1);

    expect(second.ed.undo()).toBe(true);
    expect(first.ed.getDoc()).toBe("base");
    expect(second.ed.getDoc()).toBe("base");

    expect(second.ed.redo()).toBe(true);
    expect(first.ed.getDoc()).toBe("base [B]");
    expect(second.ed.getDoc()).toBe("base [B]");

    first.ed.destroy();
    second.ed.destroy();
  });
});

describe("revealByteOffset", () => {
  it("porta un offset UTF-8 alla posizione giusta tra caratteri multibyte", () => {
    const { ed, view } = editor();
    const text = "prima 🎯 seconda";
    const before = "prima 🎯 ";

    ed.setDoc(text);
    ed.revealByteOffset(new TextEncoder().encode(before).length);

    expect(view().state.selection.main.anchor).toBe(before.length);
  });

  it("combina UTF-8 e CRLF nel ponte verso la posizione dell'editor", () => {
    const { ed, view } = editor();
    const text = "inizio\r\n🙂 café\r\nfine";
    const before = "inizio\r\n🙂 café\r\n";

    ed.setDoc(text);
    ed.revealByteOffset(new TextEncoder().encode(before).length);

    expect(view().state.selection.main.anchor).toBe("inizio\n🙂 café\n".length);
  });
});

describe("cambio di tema", () => {
  it("non distrugge la history locale", () => {
    const { ed, view } = editor();

    ed.setDoc("base");
    writes(view(), "X");
    ed.setTheme("light");

    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe("base");
  });
});


// Un vault non è fatto solo di note nate qui: ci si sincronizza una cartella
// scritto su Windows, ci si clona un repo, ci si copia dentro l'esportazione di
// un altro programma. CodeMirror spezza su `\r\n` e ricompone su `\n`, quindi
// aprire una di quelle note e battere **un carattere** la riscriveva tutta: un
// diff che tocca ogni riga, cioè una cronologia che non si legge più e un
// conflitto di sync che non ha niente da conflittare (difetto 0207).
describe("un file che va a capo come Windows", () => {
  it("resta com'era anche dopo che lo si è toccato", () => {
    const { ed, view } = editor();
    ed.setDoc("uno\r\ndue\r\ntre\r\n");
    writes(view(), "X");
    expect(
      ed.getDoc(),
      "il file è tornato indietro tutto LF: chi ha cambiato una lettera si \
ritrova un diff che tocca ogni riga",
    ).toBe("Xuno\r\ndue\r\ntre\r\n");
  });

  it("va a capo come lui anche sotto le dita di adesso", () => {
    // La metà che un `replace` all'uscita non avrebbe: dichiarare la forma
    // allo stato vuol dire che il documento **è** fatto di quelle righe, e
    // quindi anche l'a capo che si batte adesso è quello.
    const { ed, view } = editor();
    ed.setDoc("uno\r\ndue\r\n");
    view().dispatch({ selection: EditorSelection.single(3) });
    insertNewlineAndIndent(view());
    expect(
      ed.getDoc(),
      "la riga nuova è nata LF in mezzo a un file CRLF: il file torna misto \
per mano nostra",
    ).toBe("uno\r\n\r\ndue\r\n");
  });

  it("un file già misto non ne ha una da conservare", () => {
    // E prenderne una lo peggiorerebbe: sotto un separatore CRLF i suoi `\n`
    // solitari smettono di essere righe, cioè cambia come il documento **si
    // legge**, non solo come si riscrive. Meglio la normalizzazione di prima.
    const { ed, view } = editor();
    ed.setDoc("uno\r\ndue\ntre\r\n");
    writes(view(), "X");
    expect(
      ed.getDoc(),
      "un file senza una forma sola se n'è vista imporre una: le sue righe \
non sono più quelle che erano",
    ).toBe("Xuno\ndue\ntre\n");
  });
  it("annulla e rifà testo UTF-8 mantenendo CRLF", () => {
    const { ed, view } = editor();
    const initial = "inizio\r\n🙂 café\r\nfine";
    ed.setDoc(initial);
    const at = "inizio\n🙂".length;
    view().dispatch({
      changes: { from: at, insert: " ✓" },
      userEvent: "input.type",
    });

    expect(ed.getDoc()).toBe("inizio\r\n🙂 ✓ café\r\nfine");
    expect(ed.undo()).toBe(true);
    expect(ed.getDoc()).toBe(initial);
    expect(ed.redo()).toBe(true);
    expect(ed.getDoc()).toBe("inizio\r\n🙂 ✓ café\r\nfine");
  });
});

// Il multi-cursore non è una funzione nuova dell'editor: `basicSetup` porta
// `allowMultipleSelections`, il click con Alt e `Mod-d`, quindi l'utente tre
// cursori li ha sempre potuti fare. Ciò che mancava era la facoltà di **dirlo**
// al di là del confine: `selection()` leggeva `state.selection.main` e le altre
// due morivano lì (decisione 0093).
describe("selections", () => {
  it("porta tutte le selezioni, e la primaria non è la prima della lista", () => {
    const { ed, view } = editor();
    ed.setDoc("Kant, Hegel e Fichte");
    // Tre intervalli; la primaria è la terza — come quando la si aggiunge per
    // ultima con Alt-click, che è il caso normale in CodeMirror.
    view().dispatch({
      selection: EditorSelection.create(
        [
          EditorSelection.range(0, 4),
          EditorSelection.range(6, 11),
          EditorSelection.range(14, 20),
        ],
        2,
      ),
    });

    const sel = ed.selections();
    expect(sel.primary.text).toBe("Fichte");
    expect(sel.secondary.map((s) => s.text)).toEqual(["Kant", "Hegel"]);
    expect(sel.primary.start).toBe(14);
    expect(sel.secondary[0].start).toBe(0);
  });

  it("converte in byte UTF-8 ogni estremità, anche quando il testo non è ASCII", () => {
    const { ed, view } = editor();
    // «però» sta in cinque caratteri e sei byte: una conversione fatta a
    // occhio sposterebbe di uno tutte le selezioni dopo la prima.
    ed.setDoc("però e così");
    view().dispatch({
      selection: EditorSelection.create(
        [EditorSelection.range(0, 4), EditorSelection.range(7, 11)],
        0,
      ),
    });

    const sel = ed.selections();
    expect(sel.primary).toEqual({ start: 0, end: 5, text: "però" });
    expect(sel.secondary[0]).toEqual({ start: 8, end: 13, text: "così" });
  });

  it("un cursore solo resta un insieme senza secondarie", () => {
    const { ed, view } = editor();
    ed.setDoc("una nota");
    view().dispatch({ selection: { anchor: 4 } });
    const sel = ed.selections();
    expect(sel.primary).toEqual({ start: 4, end: 4, text: "" });
    expect(sel.secondary).toEqual([]);
  });
});

describe("smontare un editor", () => {
  // Un riquadro si chiude (§1.2), e `costruisciStruttura` in
  // `panels/document.ts` gli stacca la radice dal documento. Staccare un nodo
  // non smonta un `EditorView`: i suoi osservatori guardano il **proprio** DOM
  // e la finestra, e non sanno niente di chi sta sopra. Finché il wrapper non
  // esponeva `destroy`, ogni divisione chiusa ne lasciava indietro uno vivo — e
  // la mappa dei riquadri era l'unico riferimento che lo teneva, quindi spariva
  // anche il modo di accorgersene.
  it("porta via la vista dal contenitore", () => {
    const { ed, parent } = editor();
    expect(EditorView.findFromDOM(parent)).not.toBeNull();
    expect(parent.children.length).toBeGreaterThan(0);

    ed.destroy();

    expect(EditorView.findFromDOM(parent)).toBeNull();
    expect(parent.children.length).toBe(0);
  });

  it("e la vista è smontata, non solo staccata", () => {
    // La riga sopra da sola non distingue le due cose, ed è stato **misurato**:
    // un `destroy` scritto come `view.dom.remove()` la fa passare identica. È la
    // differenza che conta — un nodo staccato porta con sé osservatori e
    // ascoltatori ancora vivi — quindi la si guarda per il verso in cui si vede.
    //
    // Una vista smontata non aggiorna più il suo DOM: `update` esce prima di
    // toccarlo. Quindi la si riattacca a mano e le si manda una modifica; se
    // fosse stata solo staccata, il testo comparirebbe.
    const { ed, parent, view } = editor();
    const v = view();
    ed.destroy();

    parent.appendChild(v.dom);
    v.dispatch({ changes: { from: 0, insert: "questo non deve comparire" } });
    expect(v.dom.textContent).not.toContain("questo non deve comparire");
  });

  it("e chi resta non se ne accorge", () => {
    // Due editor come due riquadri sulla stessa nota: chiuderne uno non deve
    // toccare l'altro. È la metà che un `destroy` scritto sul contenitore
    // sbagliato romperebbe, e che nessun'altra prova qui guarda.
    const firstEditor = editor();
    const secondEditor = editor();
    secondEditor.ed.setDoc("resto io");

    firstEditor.ed.destroy();

    expect(secondEditor.ed.getDoc()).toBe("resto io");
    expect(EditorView.findFromDOM(secondEditor.parent)).not.toBeNull();
  });
  it("non emette modifiche dopo la distruzione", () => {
    let emitted = 0;
    const surface = editor(() => {
      emitted += 1;
    });
    surface.ed.setDoc("resto");
    surface.ed.destroy();
    surface.ed.syncDoc("cambiato");
    expect(surface.ed.undo()).toBe(false);
    expect(surface.ed.redo()).toBe(false);
    expect(emitted).toBe(0);
    surface.ed.destroy();
  });
});

// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { insertNewlineAndIndent, undo } from "@codemirror/commands";
import { EditorSelection } from "@codemirror/state";
import { createEditor, type Editor } from "./editor";

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

function editor(): { ed: Editor; view: () => EditorView; parent: HTMLElement } {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const ed = createEditor(parent, {
    onChange: () => {},
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onSearchTag: () => {},
    completions: { cercaNote: async () => [], listTags: async () => [] },
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
function scrive(view: EditorView, testo: string): void {
  view.dispatch({ changes: { from: 0, to: 0, insert: testo } });
}

describe("setDoc", () => {
  it("non lascia annullare dentro una nota le modifiche fatte in un'altra", () => {
    const { ed, view } = editor();

    ed.setDoc("prima nota");
    scrive(view(), "X ");
    expect(ed.getDoc()).toBe("X prima nota");

    // Cambio nota: da qui in poi la cronologia dell'altra non deve esistere
    // più. Con un `dispatch` al posto dello stato nuovo, qui sotto si
    // leggerebbe «prima nota» — cioè il testo di un altro documento scritto
    // dentro questo, e persistito subito dopo dal debounce del salvataggio.
    ed.setDoc("seconda nota");
    expect(undo(view())).toBe(false);
    expect(ed.getDoc()).toBe("seconda nota");
  });

  it("il testo che mette non è annullabile nemmeno da solo", () => {
    const { ed, view } = editor();
    ed.setDoc("contenuto");
    expect(undo(view())).toBe(false);
    expect(ed.getDoc()).toBe("contenuto");
  });

  it("una modifica dell'utente resta annullabile", () => {
    const { ed, view } = editor();
    ed.setDoc("base");
    scrive(view(), "X");
    expect(ed.getDoc()).toBe("Xbase");
    expect(undo(view())).toBe(true);
    expect(ed.getDoc()).toBe("base");
  });

  it("cambiare nota non riporta la resa inline né la luce a com'erano al montaggio", () => {
    // Lo stato nuovo si costruisce da capo, quindi i due compartment devono
    // ripartire da ciò che vale **adesso** e non dal default: senza, aprire una
    // nota rimetterebbe la modalità Sorgente in Live Preview.
    const { ed, view } = editor();
    ed.setLivePreview(false);
    const senzaPreview = view().state.facet(EditorView.decorations).length;
    ed.setDoc("altra nota");
    expect(view().state.facet(EditorView.decorations).length).toBe(senzaPreview);
  });
});

// Un vault non è fatto solo di note nate qui: ci si sincronizza una cartella
// scritta su Windows, ci si clona un repo, ci si copia dentro l'esportazione di
// un altro programma. CodeMirror spezza su `\r\n` e ricompone su `\n`, quindi
// aprire una di quelle note e battere **un carattere** la riscriveva tutta: un
// diff che tocca ogni riga, cioè una cronologia che non si legge più e un
// conflitto di sync che non ha niente da conflittare (difetto 0207).
describe("un file che va a capo come Windows", () => {
  it("resta com'era anche dopo che lo si è toccato", () => {
    const { ed, view } = editor();
    ed.setDoc("uno\r\ndue\r\ntre\r\n");
    scrive(view(), "X");
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
    scrive(view(), "X");
    expect(
      ed.getDoc(),
      "un file senza una forma sola se n'è vista imporre una: le sue righe \
non sono più quelle che erano",
    ).toBe("Xuno\ndue\ntre\n");
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
    const uno = editor();
    const due = editor();
    due.ed.setDoc("resto io");

    uno.ed.destroy();

    expect(due.ed.getDoc()).toBe("resto io");
    expect(EditorView.findFromDOM(due.parent)).not.toBeNull();
  });
});

// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
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

function editor(): { ed: Editor; view: () => EditorView } {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const ed = createEditor(parent, {
    onChange: () => {},
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onSearchTag: () => {},
    completions: { listNotes: async () => [], listTags: async () => [] },
  });
  return {
    ed,
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

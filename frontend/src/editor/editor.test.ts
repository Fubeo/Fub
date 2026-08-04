// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
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

function editor(): { ed: Editor; view: () => EditorView } {
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

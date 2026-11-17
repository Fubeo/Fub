import { Text } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";
import { firstHeading, foldedHeading, headingText, keepTitle, retitled, retitleIn, retitleWaiting, sameTitle, titleKey } from "./title";

const doc = (text: string) => Text.of(text.split("\n"));
/// Dove comincia il testo: dopo il frontmatter, se c'è (come `bodyStart`).
const body = (text: string): number => {
  const match = /^---\n[\s\S]*?\n---\n/.exec(text);
  return match ? match[0].length : 0;
};
const fold = (text: string, name: string) => foldedHeading(doc(text), body(text), name);

describe("il confronto fra il primo H1 e il nome", () => {
  it("non guarda maiuscole, spazi e punteggiatura", () => {
    expect(sameTitle("Mostra di primavera", "mostra di primavera")).toBe(true);
    expect(sameTitle("Che cosa?", "Che cosa")).toBe(true);
    expect(sameTitle("Che: cosa", "Che cosa")).toBe(true);
    expect(sameTitle("Mostra  di   primavera!", "Mostra-di-primavera")).toBe(true);
    expect(sameTitle("2026 – Piano", "2026 piano")).toBe(true);
  });

  it("legge il testo e non la formattazione", () => {
    expect(sameTitle("**Mostra** di primavera", "Mostra di primavera")).toBe(true);
    expect(sameTitle("_Mostra_ di `primavera`", "Mostra di primavera")).toBe(true);
    expect(sameTitle("[[Mostra di primavera]]", "Mostra di primavera")).toBe(true);
    expect(sameTitle("[[Altro|Mostra di primavera]]", "Mostra di primavera")).toBe(true);
    expect(sameTitle("[Mostra](https://example.org) di primavera", "Mostra di primavera")).toBe(true);
    expect(sameTitle("Mostra <kbd>di</kbd> primavera", "Mostra di primavera")).toBe(true);
  });

  it("un titolo diverso resta diverso", () => {
    expect(sameTitle("Mostra d'autunno", "Mostra di primavera")).toBe(false);
    // Le lettere accentate contano: «è» non è «e».
    expect(sameTitle("Perché", "Perche")).toBe(false);
    // Un'emoji si vede, e conta.
    expect(sameTitle("🌱 Mostra", "Mostra")).toBe(false);
  });

  it("commenti in riga e id di blocco non contano; i simboli matematici sì (revisione #421)", () => {
    expect(sameTitle("Mostra ^titolo", "Mostra")).toBe(true);
    expect(sameTitle("Mostra %%bozza%%", "Mostra")).toBe(true);
    expect(sameTitle("Mostra <!-- bozza -->", "Mostra")).toBe(true);
    expect(sameTitle("~~Vecchia~~ Mostra", "Vecchia Mostra")).toBe(true);
    expect(sameTitle("==Mostra==", "Mostra")).toBe(true);
    expect(sameTitle("C++", "C")).toBe(false);
    expect(sameTitle("C++", "C++")).toBe(true);
    expect(sameTitle("a = b", "ab")).toBe(false);
    expect(sameTitle("2^10", "210")).toBe(true);
  });

  it("un nome di sola punteggiatura non è uguale a niente", () => {
    expect(titleKey("—!?")).toBe("");
    expect(sameTitle("…", "...")).toBe(false);
    expect(sameTitle("", "")).toBe(false);
  });
});

describe("il primo H1", () => {
  it("è la prima riga che si legge, senza frontmatter", () => {
    const heading = firstHeading(doc("# Mostra\n\nTesto"), 0);
    expect(heading).toMatchObject({ from: 0, to: 8, text: "Mostra", textFrom: 2, textTo: 8 });
    // Nasconde anche la riga vuota che lo segue, non il testo.
    expect(heading?.hideTo).toBe(9);
  });

  it("dopo il frontmatter", () => {
    const text = "---\ntipo: nota\n---\n# Mostra\nTesto";
    expect(firstHeading(doc(text), body(text))).toMatchObject({ text: "Mostra", from: body(text) });
  });

  it("dopo un frontmatter che non si legge: il testo comincia dopo la chiusura", () => {
    const text = "---\n: rotto\n---\n# Mostra\n";
    expect(fold(text, "Mostra")).not.toBeNull();
  });

  it("dopo un commento %% su una riga o su più righe", () => {
    expect(firstHeading(doc("%% nota per me %%\n# Mostra"), 0)?.text).toBe("Mostra");
    expect(firstHeading(doc("%%\nuna nota\nlunga\n%%\n\n# Mostra"), 0)?.text).toBe("Mostra");
    expect(firstHeading(doc("<!-- nascosto -->\n# Mostra"), 0)?.text).toBe("Mostra");
    // Un commento che non si chiude non lascia leggere niente sotto.
    expect(firstHeading(doc("%%\n# Mostra"), 0)).toBeNull();
    // Testo dopo la chiusura: la riga si legge, e non è un H1.
    expect(firstHeading(doc("%% nota %% testo\n# Mostra"), 0)).toBeNull();
  });

  it("un H1 non in cima non è il primo H1", () => {
    expect(firstHeading(doc("Un paragrafo.\n\n# Mostra"), 0)).toBeNull();
    expect(firstHeading(doc("## Sezione\n# Mostra"), 0)).toBeNull();
  });

  it("riconosce la chiusura e non prende un #etichetta per un titolo", () => {
    expect(firstHeading(doc("# Mostra ##"), 0)).toMatchObject({ text: "Mostra", textTo: 8 });
    expect(firstHeading(doc("#etichetta"), 0)).toBeNull();
    expect(firstHeading(doc("   # Mostra"), 0)?.text).toBe("Mostra");
    expect(firstHeading(doc("    # Codice"), 0)).toBeNull();
  });

  it("si ripiega solo se dice il nome", () => {
    expect(fold("# **Mostra** di primavera\n", "Mostra di primavera")).not.toBeNull();
    expect(fold("# Un altro titolo\n", "Mostra di primavera")).toBeNull();
    expect(fold("# Mostra\n", "")).toBeNull();
    expect(fold("", "Mostra")).toBeNull();
  });
});

describe("la rinomina riscrive l'H1 ripiegato", () => {
  it("cambia soltanto il testo del titolo", () => {
    const text = "---\na: 1\n---\n# Mostra ##\n\nTesto";
    const change = retitled(doc(text), body(text), "Mostra", "Mostra d'estate");
    expect(change).not.toBeNull();
    const after = text.slice(0, change!.from) + change!.insert + text.slice(change!.to);
    expect(after).toBe("---\na: 1\n---\n# Mostra d'estate ##\n\nTesto");
  });

  it("un H1 con la formattazione diventa il nome", () => {
    const text = "# **Mostra** di primavera\n";
    const change = retitled(doc(text), 0, "Mostra di primavera", "Mostra");
    expect(change).toEqual({ from: 2, to: 25, insert: "Mostra" });
  });

  it("non scrive niente se l'H1 non si ripiega col nome di prima", () => {
    expect(retitled(doc("# Altro\n"), 0, "Mostra", "Nuovo")).toBeNull();
    expect(retitled(doc("Testo\n# Mostra"), 0, "Mostra", "Nuovo")).toBeNull();
  });

  it("i segni della formattazione nel nome vanno sotto barra, e il titolo resta ripiegato", () => {
    expect(headingText("a*b_c")).toBe("a\\*b\\_c");
    const text = "# Mostra\n";
    const change = retitled(doc(text), 0, "Mostra", "Note_[bozza]");
    const after = text.slice(0, change!.from) + change!.insert + text.slice(change!.to);
    expect(after).toBe("# Note\\_\\[bozza\\]\n");
    expect(fold(after, "Note_[bozza]")).not.toBeNull();
  });
});

describe("chi tiene l'H1 allineato al titolo", () => {
  it("riscrive solo la superficie del riquadro che mostra la nota rinominata, e lo smontaggio la toglie", () => {
    // Il riquadro contiene soltanto la sua superficie.
    const inside = {} as Element;
    const outside = {} as Element;
    const pane = { contains: (node: unknown) => node === inside } as unknown as Element;
    const mine = vi.fn();
    const other = vi.fn();
    const stopMine = keepTitle({ root: inside, documentId: () => "Prima.md", retitle: mine });
    const stopOther = keepTitle({ root: outside, documentId: () => "Prima.md", retitle: other });
    retitleIn(pane, { from: "Prima.md", to: "Dopo.md" }, "Prima", "Dopo");
    expect(mine).toHaveBeenCalledWith("Prima", "Dopo");
    expect(other).not.toHaveBeenCalled();
    stopMine();
    retitleIn(pane, { from: "Dopo.md", to: "Ancora.md" }, "Dopo", "Ancora");
    expect(mine).toHaveBeenCalledTimes(1);
    stopOther();
  });

  it("la superficie rifatta dalla rinomina non c'è ancora: la riscrittura la aspetta, nel riquadro e per poco (revisione #421)", () => {
    vi.useFakeTimers();
    try {
      const inside = {} as Element;
      const elsewhere = {} as Element;
      const pane = { contains: (node: unknown) => node === inside, isConnected: true } as unknown as Element;
      retitleIn(pane, { from: "Bozza.md", to: "Piano.md" }, "Bozza", "Piano");
      // Un'altra superficie dello stesso documento, fuori dal riquadro: non è lei.
      const other = vi.fn();
      const away = { root: elsewhere, documentId: () => "Piano.md", retitle: other };
      retitleWaiting(away);
      expect(other).not.toHaveBeenCalled();
      const mine = vi.fn();
      const fresh = { root: inside, documentId: () => "Piano.md", retitle: mine };
      retitleWaiting(fresh);
      expect(mine).toHaveBeenCalledWith("Bozza", "Piano");
      // Una volta sola.
      retitleWaiting(fresh);
      expect(mine).toHaveBeenCalledTimes(1);
      // Scaduta, non riscrive più.
      retitleIn(pane, { from: "Piano.md", to: "Tardi.md" }, "Piano", "Tardi");
      vi.advanceTimersByTime(6_000);
      const late = vi.fn();
      retitleWaiting({ root: inside, documentId: () => "Tardi.md", retitle: late });
      expect(late).not.toHaveBeenCalled();
      // Un file che non è una nota non aspetta niente.
      retitleIn(pane, { from: "Lavagna.canvas", to: "Tela.canvas" }, "Lavagna", "Tela");
      const canvas = vi.fn();
      retitleWaiting({ root: inside, documentId: () => "Tela.canvas", retitle: canvas });
      expect(canvas).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// L'indice dei comandi del Completo (piano K6, T5): una sola `import()` per
// tutte le chiamate, «Riprova» dopo un fallimento, e le ricerche.
import { describe, expect, it, vi } from "vitest";
import { creaIndice, indice, indiceDi, type FileIndice, type VoceIndice } from "./indice";
import GENERATO from "./indice.generated.json";

function voce(id: string, posto: string, famiglia: string, it: string, en: string, tasto: string | null = null): VoceIndice {
  return { fonte: "motore", id, chiamata: { comando: `disegno.${id}` }, etichetta: { it, en }, posto, famiglia, tasto, effetto: "cambia", finestra: false };
}

const FILE: FileIndice = {
  voci: [
    voce("edit.duplicate", "menu/modifica", "nucleo", "Duplica", "Duplicate", "Ctrl+D"),
    voce("edit.colors.invert", "ispettore/design", "colore", "Inverti i colori", "Invert Colors"),
    voce("object.path.simplify", "menu/oggetto", "tracciati", "Semplifica il tracciato", "Simplify Path"),
  ],
};

describe("indice()", () => {
  it("importa il file una volta sola per più chiamate", async () => {
    const carica = vi.fn(() => Promise.resolve(FILE));
    const leggi = creaIndice(carica);
    const [a, b] = await Promise.all([leggi(), leggi()]);
    const c = await leggi();
    expect(carica).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
  });

  it("dopo un fallimento la chiamata dopo («Riprova») lo chiede di nuovo", async () => {
    const carica = vi.fn<() => Promise<FileIndice>>()
      .mockRejectedValueOnce(new Error("chunk non arrivato"))
      .mockResolvedValue(FILE);
    const leggi = creaIndice(carica);
    await expect(leggi()).rejects.toThrow("chunk non arrivato");
    const pronto = await leggi();
    expect(pronto.voci).toHaveLength(3);
    await leggi();
    expect(carica).toHaveBeenCalledTimes(2);
  });

  it("quello vero porta il file generato", async () => {
    const vero = await indice();
    expect(vero.voci).toEqual((GENERATO as unknown as FileIndice).voci);
    expect(await indice()).toBe(vero);
  });
});

describe("le ricerche", () => {
  const trova = indiceDi(FILE);

  it("per posto, anche per la sola scheda, e per famiglia", () => {
    expect(trova.perPosto("menu/modifica").map((v) => v.id)).toEqual(["edit.duplicate"]);
    expect(trova.perPosto("menu").map((v) => v.id)).toEqual(["edit.duplicate", "object.path.simplify"]);
    expect(trova.perPosto("da-nessuna-parte")).toEqual([]);
    expect(trova.perFamiglia("colore").map((v) => v.id)).toEqual(["edit.colors.invert"]);
    // Una famiglia senza righe fatte: nessuna voce la chiama.
    expect(trova.perFamiglia("tre-d")).toEqual([]);
  });

  it("per testo, in italiano o in inglese, senza maiuscole né accenti, con ogni parola", () => {
    expect(trova.cerca("dupl").map((v) => v.id)).toEqual(["edit.duplicate"]);
    expect(trova.cerca("INVERT").map((v) => v.id)).toEqual(["edit.colors.invert"]);
    expect(trova.cerca("semplìfica tracc").map((v) => v.id)).toEqual(["object.path.simplify"]);
    expect(trova.cerca("ctrl+d").map((v) => v.id)).toEqual(["edit.duplicate"]);
    expect(trova.cerca("inverti tracciato")).toEqual([]);
    expect(trova.cerca("   ")).toEqual([]);
  });
});

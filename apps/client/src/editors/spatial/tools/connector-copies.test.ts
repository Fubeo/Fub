// Le copie dei connettori: il valore di un riferimento per una copia, e gli
// elementi di un'operazione con i riferimenti rivolti alle copie.

import { describe, expect, it } from "vitest";
import type { Elem } from "../scene/serialize";
import { isLinkName, relinkCopies, relinked } from "./connector-copies";

const COPIES = new Map([
  ["rrrrrrrr1", "rnuovo001"],
  ["rrrrrrrr2", "rnuovo002"],
  ["cccccccc1", "cnuovo001"],
]);

/// Le copie di `COPIES`: l'id della copia, `null` per gli altri.
const copy = (id: string): string | null => COPIES.get(id) ?? null;

describe("isLinkName", () => {
  it("riconosce i tre attributi che nominano un altro oggetto", () => {
    expect(["from", "to", "along"].map(isLinkName)).toEqual([true, true, true]);
  });

  it("non riconosce gli altri attributi di FubDraw", () => {
    expect(["geom", "shape", "id", "role", ""].map(isLinkName)).toEqual([false, false, false, false, false]);
  });
});

describe("relinked", () => {
  it("dà alla copia l'id della copia e tiene il punto d'aggancio", () => {
    expect(relinked("from", "rrrrrrrr1 right", copy)).toBe("rnuovo001 right");
    expect(relinked("to", "rrrrrrrr2 auto", copy)).toBe("rnuovo002 auto");
  });

  it("tiene t e la distanza di un'etichetta come sono scritti", () => {
    expect(relinked("along", "cccccccc1 0.5 -12", copy)).toBe("cnuovo001 0.5 -12");
    expect(relinked("along", "cccccccc1 0.3333 8.25", copy)).toBe("cnuovo001 0.3333 8.25");
  });

  it("cambia soltanto la prima parola, e lascia gli spazi dove sono", () => {
    expect(relinked("from", "  rrrrrrrr1\t\ttop\n", copy)).toBe("  rnuovo001\t\ttop\n");
    expect(relinked("along", "\ncccccccc1   1  0", copy)).toBe("\ncnuovo001   1  0");
  });

  it("dà null se ciò che nomina non è copiato: l'attributo va tolto", () => {
    expect(relinked("from", "altro0001 left", copy)).toBeNull();
    expect(relinked("to", "altro0001 center", copy)).toBeNull();
    expect(relinked("along", "altro0001 0.5 0", copy)).toBeNull();
  });

  it("non confonde l'id di un oggetto con quello di un connettore", () => {
    expect(relinked("along", "rrrrrrrr1 0.5 0", copy)).toBe("rnuovo001 0.5 0");
    expect(relinked("from", "cccccccc1 left", copy)).toBe("cnuovo001 left");
  });

  it("lascia com'è un valore che la grammatica non legge", () => {
    for (const value of ["", "rrrrrrrr1", "rrrrrrrr1 sopra", "rrrrrrrr1 left extra", "a b c d"]) {
      expect(relinked("from", value, copy), value).toBe(value);
      expect(relinked("to", value, copy), value).toBe(value);
    }
    for (const value of ["", "cccccccc1", "cccccccc1 0.5", "cccccccc1 due 0", "cccccccc1 1.5 0", "cccccccc1 -0.1 0", "cccccccc1 0.5 0 0"]) {
      expect(relinked("along", value, copy), value).toBe(value);
    }
  });

  it("non chiede la copia di ciò che non legge", () => {
    const asked: string[] = [];
    const ask = (id: string): string | null => {
      asked.push(id);
      return null;
    };
    relinked("from", "rrrrrrrr1", ask);
    relinked("along", "cccccccc1 sì 0", ask);
    expect(asked).toEqual([]);
  });
});

const rect = (id: string): Elem => ({ tag: "rect", attrs: { id, x: "0", y: "0", width: "10", height: "10" } });

const connector = (id: string, attrs: Record<string, string>): Elem => ({
  tag: "path",
  attrs: { id, "fub:shape": "connector", "fub:geom": "straight", d: "M 10 5 L 40 5", ...attrs },
});

describe("relinkCopies", () => {
  it("rivolge i due capi di un connettore alle copie", () => {
    const [made] = relinkCopies([connector("cnuovo001", { "fub:from": "rrrrrrrr1 right", "fub:to": "rrrrrrrr2 left" })], COPIES);
    expect(made!.attrs["fub:from"]).toBe("rnuovo001 right");
    expect(made!.attrs["fub:to"]).toBe("rnuovo002 left");
  });

  it("toglie un capo agganciato a ciò che non è copiato, e tiene l'altro", () => {
    const [made] = relinkCopies([connector("cnuovo001", { "fub:from": "rrrrrrrr1 right", "fub:to": "altro0001 left" })], COPIES);
    expect(made!.attrs["fub:from"]).toBe("rnuovo001 right");
    expect("fub:to" in made!.attrs).toBe(false);
  });

  it("lascia stare la geometria, e ogni altro attributo", () => {
    const original = connector("cnuovo001", { "fub:from": "altro0001 left", stroke: "#123456" });
    const [made] = relinkCopies([original], COPIES);
    expect(made!.attrs).toEqual({ id: "cnuovo001", "fub:shape": "connector", "fub:geom": "straight", d: "M 10 5 L 40 5", stroke: "#123456" });
  });

  it("rivolge l'etichetta al connettore copiato, o la lascia testo qualunque", () => {
    const label = (along: string): Elem => ({ tag: "text", attrs: { id: "onuovo001", transform: "matrix(1 0 0 1 20 30)", "fub:along": along }, text: "ciao" });
    const [with_] = relinkCopies([label("cccccccc1 0.5 -12")], COPIES);
    expect(with_!.attrs["fub:along"]).toBe("cnuovo001 0.5 -12");
    const [without] = relinkCopies([label("altro0001 0.5 -12")], COPIES);
    expect(without!.attrs).toEqual({ id: "onuovo001", transform: "matrix(1 0 0 1 20 30)" });
    expect(without!.text).toBe("ciao");
  });

  it("scende nei gruppi, a ogni profondità", () => {
    const tree: Elem = {
      tag: "g",
      attrs: { id: "gnuovo001" },
      children: [rect("rnuovo001"), { tag: "g", attrs: { id: "gnuovo002" }, children: [connector("cnuovo001", { "fub:from": "rrrrrrrr1 auto", "fub:to": "altro0001 auto" })] }],
    };
    const [made] = relinkCopies([tree], COPIES);
    const inner = made!.children![1]!.children![0]!;
    expect(inner.attrs["fub:from"]).toBe("rnuovo001 auto");
    expect("fub:to" in inner.attrs).toBe(false);
  });

  it("lascia gli stessi oggetti dove non cambia nulla", () => {
    const plain = rect("rnuovo001");
    const free = connector("cnuovo002", {});
    const nested: Elem = { tag: "g", attrs: { id: "gnuovo001" }, children: [plain, free] };
    const copies = relinkCopies([plain, free, nested], COPIES);
    expect(copies[0]).toBe(plain);
    expect(copies[1]).toBe(free);
    expect(copies[2]).toBe(nested);
  });

  it("tiene l'oggetto del gruppo che non cambia, e cambia soltanto il gruppo che cambia", () => {
    const plain = rect("rnuovo001");
    const tied = connector("cnuovo001", { "fub:from": "rrrrrrrr1 left" });
    const nested: Elem = { tag: "g", attrs: { id: "gnuovo001" }, children: [plain, tied] };
    const [made] = relinkCopies([nested], COPIES);
    expect(made).not.toBe(nested);
    expect(made!.children![0]).toBe(plain);
    expect(made!.children![1]).not.toBe(tied);
  });

  it("non cambia gli elementi che gli sono dati", () => {
    const original = connector("cnuovo001", { "fub:from": "rrrrrrrr1 right", "fub:to": "altro0001 left" });
    relinkCopies([original], COPIES);
    expect(original.attrs["fub:from"]).toBe("rrrrrrrr1 right");
    expect(original.attrs["fub:to"]).toBe("altro0001 left");
  });

  it("lascia com'è un valore fuori dalla grammatica", () => {
    const odd = connector("cnuovo001", { "fub:from": "rrrrrrrr1 sopra", "fub:to": "" });
    const [made] = relinkCopies([odd], COPIES);
    expect(made).toBe(odd);
  });

  it("non cerca nei nomi di altri namespace né negli attributi senza prefisso", () => {
    const other = connector("cnuovo001", { from: "altro0001 left", "xlink:to": "altro0001 left", "fub:other": "altro0001 left" });
    const [made] = relinkCopies([other], COPIES);
    expect(made).toBe(other);
  });
});

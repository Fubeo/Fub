// La cache delle immagini ferme delle schede: ordine di uscita, tetto in
// byte, `forget` per file (anche col prefisso) e chiusura di chi esce, con
// bitmap e canvas finti che contano le chiusure.
import { describe, expect, it } from "vitest";
import { CARD_CACHE_DEFAULT_LIMIT, CardCache, type CardCacheSnapshot } from "./card-cache";

interface FakeBitmap {
  closed: number;
  close(): void;
}

function bitmap(options: { throws?: boolean } = {}): FakeBitmap {
  const fake: FakeBitmap = {
    closed: 0,
    close() {
      fake.closed += 1;
      if (options.throws) throw new Error("chiusura fallita");
    },
  };
  return fake;
}

function snapshot(bytes: number, fake: object = bitmap()): CardCacheSnapshot {
  return { bitmap: fake as unknown as ImageBitmap, bytes };
}

function closes(entry: CardCacheSnapshot): number {
  return (entry.bitmap as unknown as FakeBitmap).closed;
}

describe("CardCache", () => {
  it("parte da 64 MiB e da vuota", () => {
    expect(CARD_CACHE_DEFAULT_LIMIT).toBe(64 * 1024 * 1024);
    const cache = new CardCache();
    expect(cache.size()).toBe(0);
    const big = snapshot(64 * 1024 * 1024);
    cache.put("a.pdf", "w640", big);
    expect(cache.get("a.pdf", "w640")).toBe(big);
    expect(closes(big)).toBe(0);
  });

  it("restituisce la voce messa e niente per chiavi assenti", () => {
    const cache = new CardCache(100);
    const one = snapshot(10);
    cache.put("a.pdf", "page-1@640", one);
    expect(cache.get("a.pdf", "page-1@640")).toBe(one);
    expect(cache.get("a.pdf", "page-2@640")).toBeUndefined();
    expect(cache.get("b.pdf", "page-1@640")).toBeUndefined();
    expect(cache.size()).toBe(10);
  });

  it("fa uscire per primo il più vecchio usato, fra tutti i file, e lo chiude", () => {
    const cache = new CardCache(30);
    const a = snapshot(10);
    const b = snapshot(10);
    const c = snapshot(10);
    cache.put("a.pdf", "w640", a);
    cache.put("b.png", "w640", b);
    cache.put("a.pdf", "page-2@640", c);
    // `get` rinfresca l'età: ora il più vecchio è b.
    expect(cache.get("a.pdf", "w640")).toBe(a);
    const d = snapshot(10);
    cache.put("c.jpg", "w320", d);
    expect(cache.get("b.png", "w640")).toBeUndefined();
    expect(closes(b)).toBe(1);
    expect(cache.size()).toBe(30);
    // Poi esce c (il più vecchio rimasto), poi a.
    const e = snapshot(20);
    cache.put("d.webp", "w640", e);
    expect(cache.get("a.pdf", "page-2@640")).toBeUndefined();
    expect(cache.get("a.pdf", "w640")).toBeUndefined();
    expect(closes(c)).toBe(1);
    expect(closes(a)).toBe(1);
    expect(cache.get("c.jpg", "w320")).toBe(d);
    expect(cache.get("d.webp", "w640")).toBe(e);
    expect(closes(d)).toBe(0);
    expect(closes(e)).toBe(0);
    expect(cache.size()).toBe(30);
  });

  it("fa uscire quante voci servono per stare nel tetto", () => {
    const cache = new CardCache(100);
    const small = [snapshot(30), snapshot(30), snapshot(30)];
    small.forEach((entry, index) => cache.put("a.pdf", `page-${index + 1}@640`, entry));
    const large = snapshot(80);
    cache.put("b.pdf", "w640", large);
    expect(small.map(closes)).toEqual([1, 1, 1]);
    expect(cache.get("b.pdf", "w640")).toBe(large);
    expect(cache.size()).toBe(80);
  });

  it("tiene una voce grande quanto il tetto e rifiuta, chiudendola, una più grande", () => {
    const cache = new CardCache(50);
    const kept = snapshot(10);
    cache.put("a.pdf", "w640", kept);
    const tooBig = snapshot(51);
    cache.put("b.pdf", "w640", tooBig);
    expect(cache.get("b.pdf", "w640")).toBeUndefined();
    expect(closes(tooBig)).toBe(1);
    // La voce rifiutata non fa uscire nessuno.
    expect(cache.get("a.pdf", "w640")).toBe(kept);
    expect(closes(kept)).toBe(0);
    const exact = snapshot(50);
    cache.put("c.pdf", "w640", exact);
    expect(cache.get("c.pdf", "w640")).toBe(exact);
    expect(closes(kept)).toBe(1);
    expect(cache.size()).toBe(50);
  });

  it("con tetto 0 non tiene niente e chiude subito", () => {
    const cache = new CardCache(0);
    const entry = snapshot(1);
    cache.put("a.pdf", "w640", entry);
    expect(cache.get("a.pdf", "w640")).toBeUndefined();
    expect(closes(entry)).toBe(1);
    expect(cache.size()).toBe(0);
  });

  it("un tetto negativo o non numerico vale 0", () => {
    for (const limit of [-10, Number.NaN]) {
      const cache = new CardCache(limit);
      const entry = snapshot(1);
      cache.put("a.pdf", "w640", entry);
      expect(cache.get("a.pdf", "w640")).toBeUndefined();
      expect(closes(entry)).toBe(1);
    }
  });

  it("sostituisce una chiave che c'è e chiude la vecchia", () => {
    const cache = new CardCache(100);
    const old = snapshot(40);
    const fresh = snapshot(25);
    cache.put("a.pdf", "w640", old);
    cache.put("a.pdf", "w640", fresh);
    expect(cache.get("a.pdf", "w640")).toBe(fresh);
    expect(closes(old)).toBe(1);
    expect(closes(fresh)).toBe(0);
    expect(cache.size()).toBe(25);
  });

  it("la stessa voce messa due volte non si chiude e non conta due volte", () => {
    const cache = new CardCache(100);
    const entry = snapshot(40);
    cache.put("a.pdf", "w640", entry);
    cache.put("a.pdf", "w640", entry);
    expect(cache.get("a.pdf", "w640")).toBe(entry);
    expect(closes(entry)).toBe(0);
    expect(cache.size()).toBe(40);
    // Rimessa diventa la più nuova.
    const other = snapshot(40);
    cache.put("b.pdf", "w640", other);
    cache.put("a.pdf", "w640", entry);
    cache.put("c.pdf", "w640", snapshot(40));
    expect(cache.get("b.pdf", "w640")).toBeUndefined();
    expect(cache.get("a.pdf", "w640")).toBe(entry);
    expect(closes(entry)).toBe(0);
  });

  it("sostituire con una voce troppo grande toglie anche la vecchia", () => {
    const cache = new CardCache(50);
    const old = snapshot(10);
    const tooBig = snapshot(60);
    cache.put("a.pdf", "w640", old);
    cache.put("a.pdf", "w640", tooBig);
    expect(cache.get("a.pdf", "w640")).toBeUndefined();
    expect(closes(old)).toBe(1);
    expect(closes(tooBig)).toBe(1);
    expect(cache.size()).toBe(0);
  });

  it("forget toglie e chiude tutte le parti di quel file, non di un file col suo prefisso", () => {
    const cache = new CardCache(1000);
    const pages = [snapshot(10), snapshot(10)];
    cache.put("a.pdf", "page-1@640", pages[0]!);
    cache.put("a.pdf", "page-2@640", pages[1]!);
    const backup = snapshot(10);
    const sibling = snapshot(10);
    cache.put("a.pdf.bak", "page-1@640", backup);
    cache.put("a.pd", "w640", sibling);
    cache.forget("a.pdf");
    expect(cache.get("a.pdf", "page-1@640")).toBeUndefined();
    expect(cache.get("a.pdf", "page-2@640")).toBeUndefined();
    expect(pages.map(closes)).toEqual([1, 1]);
    expect(cache.get("a.pdf.bak", "page-1@640")).toBe(backup);
    expect(cache.get("a.pd", "w640")).toBe(sibling);
    expect(closes(backup)).toBe(0);
    expect(cache.size()).toBe(20);
    // Un file che non c'è: niente da fare.
    cache.forget("assente.pdf");
    expect(cache.size()).toBe(20);
  });

  it("dopo forget le voci tolte non escono più dall'ordine d'uso", () => {
    const cache = new CardCache(30);
    const gone = snapshot(10);
    cache.put("a.pdf", "w640", gone);
    const b = snapshot(10);
    cache.put("b.pdf", "w640", b);
    cache.forget("a.pdf");
    cache.put("c.pdf", "w640", snapshot(10));
    cache.put("d.pdf", "w640", snapshot(10));
    expect(closes(gone)).toBe(1);
    expect(cache.get("b.pdf", "w640")).toBe(b);
    expect(cache.size()).toBe(30);
  });

  it("clear chiude tutto e azzera i byte", () => {
    const cache = new CardCache(100);
    const all = [snapshot(10), snapshot(20), snapshot(30)];
    cache.put("a.pdf", "w640", all[0]!);
    cache.put("a.pdf", "page-2@640", all[1]!);
    cache.put("b.png", "w640", all[2]!);
    cache.clear();
    expect(all.map(closes)).toEqual([1, 1, 1]);
    expect(cache.size()).toBe(0);
    expect(cache.get("a.pdf", "w640")).toBeUndefined();
    const again = snapshot(100);
    cache.put("a.pdf", "w640", again);
    expect(cache.get("a.pdf", "w640")).toBe(again);
  });

  it("bytes 0, negativi o non numerici contano come 1", () => {
    const cache = new CardCache(2);
    const zero = snapshot(0);
    const negative = snapshot(-5);
    cache.put("a.png", "w640", zero);
    cache.put("b.png", "w640", negative);
    expect(cache.size()).toBe(2);
    const nan = snapshot(Number.NaN);
    cache.put("c.png", "w640", nan);
    expect(cache.size()).toBe(2);
    expect(closes(zero)).toBe(1);
    expect(cache.get("b.png", "w640")).toBe(negative);
    expect(cache.get("c.png", "w640")).toBe(nan);
  });

  it("bytes con la virgola si arrotondano in su", () => {
    const cache = new CardCache(10);
    cache.put("a.png", "w640", snapshot(2.2));
    expect(cache.size()).toBe(3);
  });

  it("un close che lancia si ignora e la voce esce lo stesso", () => {
    const cache = new CardCache(10);
    const failing = snapshot(10, bitmap({ throws: true }));
    cache.put("a.pdf", "w640", failing);
    const next = snapshot(10);
    expect(() => cache.put("b.pdf", "w640", next)).not.toThrow();
    expect(closes(failing)).toBe(1);
    expect(cache.get("a.pdf", "w640")).toBeUndefined();
    expect(cache.get("b.pdf", "w640")).toBe(next);
    expect(cache.size()).toBe(10);
    const failingAgain = snapshot(5, bitmap({ throws: true }));
    cache.put("c.pdf", "w640", failingAgain);
    expect(() => cache.forget("c.pdf")).not.toThrow();
    expect(() => cache.clear()).not.toThrow();
    expect(cache.size()).toBe(0);
  });

  it("un canvas che esce si rimpicciolisce a 0×0", () => {
    const cache = new CardCache(10);
    const canvas = { width: 640, height: 480 };
    const entry: CardCacheSnapshot = { bitmap: canvas as unknown as HTMLCanvasElement, bytes: 10 };
    cache.put("a.png", "w640", entry);
    cache.put("b.png", "w640", snapshot(10));
    expect(canvas).toEqual({ width: 0, height: 0 });
  });

  it("un canvas che rifiuta la misura si ignora", () => {
    const cache = new CardCache(10);
    const canvas = {
      get width() {
        return 640;
      },
      set width(_value: number) {
        throw new Error("misura rifiutata");
      },
      height: 480,
    };
    cache.put("a.png", "w640", { bitmap: canvas as unknown as HTMLCanvasElement, bytes: 10 });
    expect(() => cache.put("b.png", "w640", snapshot(10))).not.toThrow();
    expect(cache.get("a.png", "w640")).toBeUndefined();
  });

  it("i percorsi e le parti sono chiavi opache", () => {
    const cache = new CardCache(1000);
    const strange = ["", "#page=3", "a\u0000b", "../su/../giù.pdf", "__proto__", "constructor", "😀 nota.md", "a|b"];
    const entries = strange.map(() => snapshot(1));
    strange.forEach((path, index) => cache.put(path, path, entries[index]!));
    strange.forEach((path, index) => expect(cache.get(path, path)).toBe(entries[index]));
    // Nessuna confusione fra percorso e parte che, uniti, darebbero la stessa stringa.
    const left = snapshot(1);
    const right = snapshot(1);
    cache.put("a|b", "c", left);
    cache.put("a", "b|c", right);
    expect(cache.get("a|b", "c")).toBe(left);
    expect(cache.get("a", "b|c")).toBe(right);
    cache.forget("__proto__");
    expect(cache.get("__proto__", "__proto__")).toBeUndefined();
    expect(cache.get("constructor", "constructor")).toBe(entries[5]);
  });
});

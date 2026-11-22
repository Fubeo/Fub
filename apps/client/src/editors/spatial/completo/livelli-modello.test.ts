// I livelli come li legge il motore (K6 T15, giro 4): dalla lettura di `document.inspect` ai livelli,
// e al numero del motore di ogni livello per il suo id della scena. Passano solo i livelli; gli
// oggetti dentro un livello si scartano; un nome doppio non si usa.
import { describe, expect, it } from "vitest";
import { livelliDi, numeriDeiLivelli } from "./livelli-modello";

// L'ordine della lettura è quello del motore: i livelli di primo piano dal più alto; i figli di un
// livello dal primo disegnato. Il nome di un livello di Fub è il suo id della scena; «Layer 1» è il
// livello implicito del motore, quello degli elementi fuori dai livelli.
const LETTURA = {
  layers: [
    { id: 1, name: "l1", kind: "Layer", visible: true, locked: false, children: [{ id: 11, name: "r1", kind: "Rectangle" }] },
    {
      id: 2,
      name: "l2",
      kind: "Layer",
      visible: false,
      locked: true,
      children: [
        { id: 21, name: "s1", kind: "Layer", visible: true, locked: false, children: [] },
        { id: 22, name: "s2", kind: "Layer", visible: true, locked: false, children: [] },
        { id: 23, name: "t1", kind: "Text" },
      ],
    },
    { id: "3", name: "Layer 1", kind: "Layer", visible: true, locked: false },
  ],
};

describe("livelliDi", () => {
  it("tiene i livelli nell'ordine della lettura e scarta gli oggetti", () => {
    const livelli = livelliDi(LETTURA);
    expect(livelli.map((l) => l.nome)).toEqual(["l1", "l2", "Layer 1"]);
    expect(livelli[0]?.figli).toEqual([]);
  });

  it("gira i sottolivelli: quello disegnato per ultimo sta in alto", () => {
    expect(livelliDi(LETTURA)[1]?.figli.map((f) => f.nome)).toEqual(["s2", "s1"]);
  });

  it("legge occhio e lucchetto, e il numero anche scritto come testo", () => {
    expect(livelliDi(LETTURA)[1]).toMatchObject({ id: 2, visibile: false, bloccato: true });
    expect(livelliDi(LETTURA)[2]).toMatchObject({ id: 3, visibile: true, bloccato: false, figli: [] });
  });

  it("una lettura senza livelli, o un livello senza numero valido, non ha livelli", () => {
    expect(livelliDi(null)).toEqual([]);
    expect(livelliDi({})).toEqual([]);
    expect(livelliDi({ layers: [{ kind: "Layer", name: "senza" }] })).toEqual([]);
    expect(livelliDi({ layers: [{ id: -1, kind: "Layer", name: "negativo" }, { id: 1.5, kind: "Layer", name: "mezzo" }] })).toEqual([]);
  });
});

describe("numeriDeiLivelli", () => {
  it("dà il numero del motore per l'id della scena, sottolivelli compresi", () => {
    const numeri = numeriDeiLivelli(livelliDi(LETTURA));
    expect(numeri.get("l1")).toBe(1);
    expect(numeri.get("l2")).toBe(2);
    expect(numeri.get("s1")).toBe(21);
    expect(numeri.has("r1")).toBe(false);
  });

  it("un nome che due livelli hanno non entra: il comando non saprebbe quale cambiare", () => {
    const numeri = numeriDeiLivelli(
      livelliDi({ layers: [{ id: 1, name: "x", kind: "Layer" }, { id: 2, name: "x", kind: "Layer" }, { id: 3, name: "y", kind: "Layer" }] }),
    );
    expect(numeri.has("x")).toBe(false);
    expect(numeri.get("y")).toBe(3);
  });

  it("5 000 livelli si leggono in un tempo che non si sente", () => {
    const lettura = { layers: Array.from({ length: 5_000 }, (_, i) => ({ id: i + 1, name: `l${i}`, kind: "Layer", visible: true, locked: false, children: [] })) };
    const inizio = performance.now();
    const numeri = numeriDeiLivelli(livelliDi(lettura));
    const durata = performance.now() - inizio;
    expect(numeri.size).toBe(5_000);
    expect(numeri.get("l4999")).toBe(5_000);
    // Lettura e mappa sono lineari: millisecondi anche su una macchina carica, contro i 100 ms
    // oltre i quali un clic si sente in ritardo.
    expect(durata).toBeLessThan(100);
  });
});

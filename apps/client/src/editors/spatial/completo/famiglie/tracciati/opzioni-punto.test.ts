// @vitest-environment happy-dom
//
// La fila dei punti scelti (piano K6, T12): che cosa vale coi punti dello
// stato, perché un pulsante spento non vale, e i comandi che manda al motore
// coi punti nel `value`.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingAnchor, DrawingToolState } from "../../../../../host/contract";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { COMANDI_PUNTI, comandoDelMotore, filaPunti, regolePunti } from "./opzioni-punto";
import { TESTI } from "./testi";
import famiglia, { STRUMENTI_CON_I_PUNTI } from "./index";

const punto = (anchor: number, end: boolean, at: [number, number] = [10, 20]): DrawingAnchor => ({ element: "p1", subpath: 0, anchor, at, end });

const stato = (anchors: DrawingAnchor[]): DrawingToolState => ({
  busy: false,
  transforming: false,
  wants_text: false,
  composing: false,
  cursor: "arrow",
  options: null,
  anchors,
});

let vita: Lifetime;
afterEach(() => vita?.close());

function monta(anchors: DrawingAnchor[]) {
  vita = openLifetime();
  const esegui = vi.fn();
  const annuncia = vi.fn();
  const leggi = vi.fn(() => Promise.resolve(null));
  const fila = filaPunti(TESTI, stato(anchors), { esegui, leggi, annuncia }, vita)!;
  const host = document.createElement("div");
  for (const voce of fila.voci!) host.append(voce.element);
  const pulsante = (nome: string): HTMLButtonElement => [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.getAttribute("aria-label") === nome)!;
  return { fila, host, esegui, annuncia, pulsante };
}

describe("le regole della fila dei punti", () => {
  it("senza punti nulla vale; per unire servono due punti finali; la posizione è di un punto solo", () => {
    expect(regolePunti([])).toEqual({ converti: "serve_punto", taglia: "serve_punto", unisci: "serve_punto", elimina: "serve_punto", posizione: null });
    expect(regolePunti([punto(1, false, [3, 4])])).toEqual({ converti: null, taglia: null, unisci: "serve_estremi", elimina: null, posizione: [3, 4] });
    expect(regolePunti([punto(0, true), punto(3, false)]).unisci).toBe("serve_estremi");
    expect(regolePunti([punto(0, true), punto(3, true)])).toEqual(expect.objectContaining({ unisci: null, posizione: null }));
  });
});

describe("la fila dei punti scelti", () => {
  it("ha i tre pezzi del prototipo, con le priorità 3, 2, 1 e i nomi", () => {
    const { fila, host } = monta([]);
    expect(fila.voci!.map((voce) => voce.priorita)).toEqual([3, 2, 1]);
    expect(fila.voci!.map((voce) => voce.element.getAttribute("aria-label"))).toEqual(["Converti", "Punto", "Posizione del punto"]);
    expect(host.querySelectorAll(".draw-point-place .draw-point-coord")).toHaveLength(2);
    expect([...host.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"))).toEqual(["Angolo", "Morbido", "Taglia il tracciato nel punto", "Unisci i due punti", "Elimina il punto"]);
  });

  it("senza punti i pulsanti restano raggiungibili ma spenti: dicono perché e non mandano niente", () => {
    const { esegui, annuncia, pulsante } = monta([]);
    const taglia = pulsante("Taglia il tracciato nel punto");
    expect(taglia.getAttribute("aria-disabled")).toBe("true");
    expect(taglia.title).toBe(`Taglia il tracciato nel punto — ${TESTI["punto.serve_punto"]!.it}`);
    taglia.click();
    expect(esegui).not.toHaveBeenCalled();
    expect(annuncia).toHaveBeenCalledWith(`Taglia il tracciato nel punto: ${TESTI["punto.serve_punto"]!.it}`);
  });

  it("coi punti scelti manda i comandi del motore coi punti nel valore", () => {
    const scelti = [punto(0, true), punto(3, true)];
    const { esegui, pulsante } = monta(scelti);
    pulsante("Angolo").click();
    pulsante("Morbido").click();
    pulsante("Taglia il tracciato nel punto").click();
    pulsante("Unisci i due punti").click();
    pulsante("Elimina il punto").click();
    expect(esegui.mock.calls.map(([id, valore]) => [id, valore])).toEqual([
      [comandoDelMotore(COMANDI_PUNTI.converti), { to: "corner", anchors: scelti }],
      [comandoDelMotore(COMANDI_PUNTI.converti), { to: "smooth", anchors: scelti }],
      [comandoDelMotore(COMANDI_PUNTI.taglia), { anchors: scelti }],
      [comandoDelMotore(COMANDI_PUNTI.unisci), { anchors: scelti }],
      [comandoDelMotore(COMANDI_PUNTI.elimina), { anchors: scelti }],
    ]);
  });

  it("uno stato nuovo rifà la fila: un punto solo mostra la sua posizione, in sola lettura", () => {
    const { fila, host, pulsante } = monta([]);
    const campi = host.querySelectorAll<HTMLInputElement>(".draw-point-coord input");
    expect([...campi].map((campo) => campo.value)).toEqual(["", ""]);
    fila.aggiorna(null, stato([punto(2, false, [12.5, 40])]));
    expect([...campi].map((campo) => campo.value)).toEqual(["12.5", "40"]);
    expect([...campi].every((campo) => campo.readOnly && campo.title === TESTI["punto.sola_lettura"]!.it)).toBe(true);
    expect(pulsante("Elimina il punto").hasAttribute("aria-disabled")).toBe(false);
    expect(pulsante("Unisci i due punti").title).toContain(TESTI["punto.serve_estremi"]!.it);
  });

  it("la famiglia la registra per la Selezione diretta e il Punto di ancoraggio", () => {
    const registraFila = vi.fn();
    famiglia.registra!({ registraFila, sezioni: { registra: vi.fn() }, esegui: vi.fn() } as never);
    expect(registraFila.mock.calls.map(([strumento]) => strumento)).toEqual([...STRUMENTI_CON_I_PUNTI]);
    expect(STRUMENTI_CON_I_PUNTI).toEqual(["directSelection", "anchorPoint"]);
  });
});

it("la fila manda i comandi dei punti al motore col prefisso disegno.", () => {
  expect(comandoDelMotore(COMANDI_PUNTI.converti)).toBe("disegno.path.convertAnchors");
  expect(comandoDelMotore(COMANDI_PUNTI.unisci)).toBe("disegno.path.join");
});

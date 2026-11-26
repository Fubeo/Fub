// @vitest-environment happy-dom
// «Zoom sulla selezione» (`addon.arrange.zoomSelection`, K6 T11): la vista dell'editor
// (`fitSelection`, `view.ts`) chiamata dalla voce del Disegno completo. È una vista: il
// documento non cambia, la cronologia di Annulla non ne ha niente, e senza scelta la voce
// è spenta con la frase di sempre. Le prove: il menu del Disegno (stessa funzione della
// voce del Completo) sull'editor vero, e le regole della voce con un editor finto.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../strings";
import { openLifetime, type Lifetime } from "../../../../ui/lifetime";
import { SceneEngine } from "../../scene/engine";
import { doc } from "../../scene/test-support";
import { DEFAULT_GRID } from "../grid";
import { LAYER } from "../test-support";
import { createDrawEditor, type DrawEditor } from "../editor";
import type { EditorContext } from "./context";
import { isComandoBanda } from "./chrome/status";
import { COMANDI_VISUALIZZA, COMANDO_ZOOM_SCELTA, voceVisualizza } from "./chrome/visualizza";

const UNO = "o1a2b3c4d";
const DUE = "o5e6f7a8b";
const NASCOSTO = "o9c8d7e6f";
const BLOCCATO = "o3d4e5f6a";

const RETTANGOLO = (id: string, x: number, y: number) =>
  `<rect id="${id}" x="${x}" y="${y}" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/>`;

const DUE_OGGETTI = doc(`<title>Prova</title>${LAYER}${RETTANGOLO(UNO, 60, 60)}${RETTANGOLO(DUE, 160, 120)}</g>`);
const CON_LIVELLI = doc(
  `<title>Prova</title>${LAYER}${RETTANGOLO(UNO, 60, 60)}</g>` +
    `<g id="l2" fub:layer="Nascosto" display="none">${RETTANGOLO(NASCOSTO, 120, 60)}</g>` +
    `<g id="l3" fub:layer="Bloccato" fub:locked="true">${RETTANGOLO(BLOCCATO, 20, 120)}</g>`,
);

let host: HTMLElement;
let owner: Lifetime;

beforeEach(() => {
  // Il foglio ha una misura vera: senza, happy-dom dà zero e lo zoom cade al minimo.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
});

afterEach(() => {
  owner.close();
  host.remove();
  vi.restoreAllMocks();
});

function mount(source: string): DrawEditor {
  const e = createDrawEditor(host, SceneEngine.open(source), owner, { grid: DEFAULT_GRID });
  e.setTool("select");
  return e;
}

/// Lo zoom che la banda mostra adesso, in percento (la voce «zoom» della banda).
function zoomDi(e: DrawEditor): number {
  const voce = e.status.items().find((item) => item.id === "zoom");
  const cifre = /\d+/.exec(voce?.text ?? "");
  if (cifre === null) throw new Error("la banda non mostra lo zoom");
  return Number(cifre[0]);
}

/// La voce «Mostra la selezione» del menu Disegno: la stessa `fitSelection` della voce del Completo.
function voceMostra(e: DrawEditor) {
  const voce = e.commands().find((c) => c.label === t("draw.fit.selection"));
  if (voce === undefined) throw new Error("manca la voce Mostra la selezione");
  return voce;
}

describe("Zoom sulla selezione: la voce del Completo (K6 T11)", () => {
  it("è una voce del client della banda, non un comando del file", () => {
    expect(isComandoBanda(COMANDO_ZOOM_SCELTA)).toBe(true);
    expect(COMANDI_VISUALIZZA).not.toContain(COMANDO_ZOOM_SCELTA);
  });

  it("senza scelta è spenta con la frase di sempre, e con una scelta è accesa", () => {
    const vuoto = { selection: [] } as unknown as EditorContext;
    expect(voceVisualizza(vuoto, COMANDO_ZOOM_SCELTA)).toBe(t("draw.selection.empty"));
    const scelto = { selection: [UNO] } as unknown as EditorContext;
    expect(voceVisualizza(scelto, COMANDO_ZOOM_SCELTA)).toBeNull();
  });
});

describe("Zoom sulla selezione: la vista dell'editor", () => {
  it("(1) un oggetto scelto: la vista lo inquadra, più da vicino di tutto il disegno", () => {
    const e = mount(DUE_OGGETTI);
    const tutto = zoomDi(e);
    e.select([UNO]);
    voceMostra(e).run();
    expect(zoomDi(e)).toBeGreaterThan(tutto);
  });

  it("(2) più oggetti: la vista inquadra il riquadro di tutti, quindi meno da vicino di uno solo", () => {
    const e = mount(DUE_OGGETTI);
    e.select([UNO]);
    voceMostra(e).run();
    const solo = zoomDi(e);
    e.select([UNO, DUE]);
    voceMostra(e).run();
    expect(zoomDi(e)).toBeLessThan(solo);
  });

  it("(3) niente di scelto: la voce è spenta, con la frase in italiano", () => {
    const e = mount(DUE_OGGETTI);
    e.select([]);
    const voce = voceMostra(e);
    expect(voce.disabled).toBe(true);
    expect(voce.description).toBe(t("draw.selection.empty"));
  });

  it("(4) dopo lo zoom il documento è quello di prima e Annulla non torna indietro di uno zoom", () => {
    const e = mount(DUE_OGGETTI);
    const prima = e.engine.text;
    e.select([UNO]);
    voceMostra(e).run();
    expect(e.engine.text).toBe(prima);
    expect(e.canUndo).toBe(false);
    const zoom = zoomDi(e);
    e.undo();
    expect(zoomDi(e)).toBe(zoom);
    expect(e.engine.text).toBe(prima);
  });

  it("(5a) un oggetto in un livello nascosto non si sceglie: niente zoom su di lui", () => {
    const e = mount(CON_LIVELLI);
    const tutto = zoomDi(e);
    e.select([NASCOSTO]);
    expect(e.selection).toEqual([]);
    expect(voceMostra(e).disabled).toBe(true);
    expect(zoomDi(e)).toBe(tutto);
  });

  it("(5b) un oggetto in un livello bloccato non si sceglie: niente zoom su di lui, il documento non cambia", () => {
    const e = mount(CON_LIVELLI);
    const prima = e.engine.text;
    const tutto = zoomDi(e);
    e.select([BLOCCATO]);
    expect(e.selection).toEqual([]);
    expect(voceMostra(e).disabled).toBe(true);
    expect(zoomDi(e)).toBe(tutto);
    expect(e.engine.text).toBe(prima);
    expect(e.canUndo).toBe(false);
  });

  it("(6) un doppio clic dà un solo zoom: la seconda volta non cambia niente e non dà errori", () => {
    const e = mount(DUE_OGGETTI);
    e.select([UNO]);
    const errori = vi.spyOn(console, "error").mockImplementation(() => undefined);
    voceMostra(e).run();
    const primo = zoomDi(e);
    voceMostra(e).run();
    expect(zoomDi(e)).toBe(primo);
    expect(errori).not.toHaveBeenCalled();
    errori.mockRestore();
  });
});

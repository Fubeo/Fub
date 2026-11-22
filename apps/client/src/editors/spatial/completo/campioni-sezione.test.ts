// @vitest-environment happy-dom
// Risorse › Campioni del Completo (K6 T14, giro 2; righe `swatches`, `ui.newSwatch` e
// `ui.swatchOptions` della mappa) in una sessione del Completo vera: la griglia dai campioni del
// modello, la scelta e il campione dato al lato attivo che la sezione Colore condivide, le finestre
// del kit «Nuovo campione» e «Opzioni del campione», le azioni, la griglia che resta con 2 000
// campioni, e le frecce.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { t } from "../strings";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";
import type { CampioneDocumento, CampioniDocumento } from "./sezioni";

vi.mock("../motore/finestre", () => ({ apriFinestra: vi.fn(() => Promise.resolve(true)) }));

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["oa1a1a1a1"], losses: [], refused: null, frame: null };

const BLU: CampioneDocumento = { id: "r1a1a1a1a", name: "Blu", color: "#0072b2" };
const ARANCIO: CampioneDocumento = { id: "r2b2b2b2b", name: "Arancio", color: "#e69f00" };

function motoreFinto() {
  const comando = vi.fn((_passo: unknown) => Promise.resolve(ESITO));
  const comandi = vi.fn(() => Promise.resolve([]));
  const sessione = { comandi, comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

/// Il Completo con l'indice vero; Campioni (e Colore, per il lato attivo) disegnate una volta.
function completo(scelti: number, elenco: readonly CampioneDocumento[] = [BLU, ARANCIO], nonUsati: readonly string[] = [ARANCIO.id]) {
  const { motore, comando } = motoreFinto();
  const c = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: { "./famiglie/colore/index.ts": () => import("./famiglie/colore/index") },
      tasti: { selezione: () => (scelti === 0 ? [] : ["oa1a1a1a1"]), annuncia: vi.fn() } as never,
    } as never,
  );
  const sezione = c.sezioni.di("risorse").find((una) => una.id === "swatches")!;
  const colore = c.sezioni.di("design").find((una) => una.id === "color")!;
  const corpo = document.createElement("div");
  const corpoColore = document.createElement("div");
  document.body.append(corpo, corpoColore);
  let fine: (() => void) | void = undefined;
  const disegna = (numero: number, lista: readonly CampioneDocumento[], liberi: readonly string[] = nonUsati): void => {
    if (typeof fine === "function") fine();
    const campioni: CampioniDocumento = { elenco: lista, nonUsati: () => liberi };
    fine = sezione.disegna({ corpo, sel: { numero, punti: [] }, motore, misure: {}, colori: {}, campioni, aggiorna: () => undefined, rileggi: () => undefined, vita: openLifetime() });
  };
  disegna(scelti, elenco);
  colore.disegna({ corpo: corpoColore, sel: { numero: scelti, punti: [] }, motore, misure: {}, colori: { riempimento: { valore: "#ff0000" }, contorno: { valore: "#0000ff" } }, aggiorna: () => undefined, rileggi: () => undefined, vita: openLifetime() });
  return { c, corpo, corpoColore, comando, sezione, disegna };
}

const voci = (corpo: HTMLElement) => [...corpo.querySelectorAll<HTMLButtonElement>(".kit-color-swatch")];
const azione = (corpo: HTMLElement, id: string) => corpo.querySelector<HTMLButtonElement>(`.draw-resources-swatches-actions [data-action="${id}"]`)!;
const finestra = () => document.querySelector<HTMLElement>(".draw-resources-swatches-dialog");

/// I comandi arrivati al motore, per id e valore.
async function arrivati(comando: ReturnType<typeof motoreFinto>["comando"], quanti: number) {
  await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(quanti));
  return comando.mock.calls.map(([passo]) => {
    const { id, value } = passo as { id: string; value: unknown };
    return [id, value];
  });
}

/// Scrive `testo` nel campo del nome della finestra aperta.
function scriviNome(testo: string): void {
  const campo = finestra()!.querySelector<HTMLInputElement>("input[type='text'], input:not([type])")!;
  campo.value = testo;
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

const premi = (id: string): void => finestra()!.querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!.click();

afterEach(() => {
  document.body.replaceChildren();
});

describe("Risorse › Campioni (swatches)", () => {
  it("c'è nella scheda Risorse, prima delle altre, con la griglia del prototipo e il conto", () => {
    const { c, corpo } = completo(0);
    expect(c.sezioni.di("risorse")[0]?.id).toBe("swatches");
    expect(corpo.querySelector(".kit-color.draw-resources-swatches")).not.toBeNull();
    expect(corpo.querySelector(".draw-properties-note")?.textContent).toBe(t("draw.resources.count", { count: 2 }));
    expect(corpo.querySelector(".kit-color-group-title")?.textContent).toBe(t("draw.resources.swatches.document"));
    const [blu, arancio] = voci(corpo);
    expect(blu!.getAttribute("aria-label")).toBe("Blu");
    expect(blu!.getAttribute("aria-pressed")).toBe("false");
    expect(blu!.querySelector(".kit-color-check")?.textContent).toBe("✓");
    expect(arancio!.dataset.color).toBe("#e69f00");
    // Una sola fermata del Tab nella griglia.
    expect(voci(corpo).map((voce) => voce.tabIndex)).toEqual([0, -1]);
    c.chiudi();
  });

  it("senza campioni dice che il disegno non ne ha; Opzioni ed Elimina aspettano un campione scelto", () => {
    const { c, corpo } = completo(0, [], []);
    expect(corpo.querySelector(".draw-properties-note")?.textContent).toBe(t("draw.resources.swatches.none"));
    expect(corpo.querySelector<HTMLElement>(".kit-color-group")!.hidden).toBe(true);
    expect(azione(corpo, "opzioni").disabled).toBe(true);
    expect(azione(corpo, "elimina").disabled).toBe(true);
    expect(azione(corpo, "opzioni").title).toBe(t("draw.resources.swatches.sceglino"));
    expect(azione(corpo, "togli").disabled).toBe(true);
    expect(azione(corpo, "nuovo").disabled).toBe(false);
    c.chiudi();
  });

  it("un clic sceglie il campione; senza selezione non manda niente", async () => {
    const { c, corpo, comando } = completo(0);
    voci(corpo)[0]!.click();
    expect(voci(corpo)[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(voci(corpo)[0]!.classList.contains("selected")).toBe(true);
    expect(azione(corpo, "opzioni").disabled).toBe(false);
    await new Promise((risolto) => setTimeout(risolto, 0));
    expect(comando).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("con una selezione il campione va al lato attivo, quello che la sezione Colore mostra", async () => {
    const { c, corpo, corpoColore, comando } = completo(1);
    voci(corpo)[1]!.click();
    expect(await arrivati(comando, 1)).toEqual([["disegno.paint.setFill", { swatch: "Arancio" }]]);
    // Il pozzo del contorno lo fa attivo: il campione dopo va al contorno.
    corpoColore.querySelectorAll<HTMLButtonElement>(".kit-color-well-button")[1]!.click();
    document.querySelector<HTMLElement>(".kit-color-popover")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    voci(corpo)[0]!.click();
    const tutti = await arrivati(comando, 3);
    expect(tutti.slice(1)).toEqual([
      ["disegno.paint.toggleActive", { fill: false }],
      ["disegno.paint.setStroke", { swatch: "Blu" }],
    ]);
    c.chiudi();
  });

  it("ui.newSwatch: «Nuovo…» apre «Nuovo campione»; un nome vuoto o già usato la tiene aperta, poi manda swatch.new", async () => {
    const { c, corpo, comando } = completo(0);
    azione(corpo, "nuovo").click();
    expect(finestra()).not.toBeNull();
    expect(finestra()!.textContent).toContain(t("draw.resources.swatches.nuovoTitolo"));
    expect(finestra()!.querySelector(".kit-color.draw-resources-swatches-picker")).not.toBeNull();
    expect(finestra()!.textContent).toContain(t("draw.resources.swatches.globale"));
    premi("ok");
    await vi.waitFor(() => expect(finestra()!.textContent).toContain(t("draw.resources.swatches.nome.vuoto")));
    scriviNome("Blu");
    premi("ok");
    await vi.waitFor(() => expect(finestra()!.textContent).toContain(t("draw.resources.swatches.nome.doppio")));
    scriviNome("  Verde ");
    premi("ok");
    expect(await arrivati(comando, 1)).toEqual([["disegno.swatch.new", { name: "Verde", color: "#000000" }]]);
    await vi.waitFor(() => expect(finestra()).toBeNull());
    c.chiudi();
  });

  it("il menu: «Nuovo campione…» apre la stessa finestra; «Opzioni campione…» è spenta finché non c'è un campione scelto", async () => {
    const { c, corpo } = completo(0);
    const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
    const cerca = async (etichetta: string) => (await c.ricerca(() => [], azioni))!.find((una) => una.label === etichetta)!;
    const opzioniSpente = await cerca("Opzioni campione…");
    expect(opzioniSpente.disabled).toBe(true);
    const nuovo = await cerca("Nuovo campione…");
    expect(nuovo.disabled).toBe(false);
    nuovo.run();
    expect(finestra()!.textContent).toContain(t("draw.resources.swatches.nuovoTitolo"));
    premi("cancel");
    await vi.waitFor(() => expect(finestra()).toBeNull());
    voci(corpo)[0]!.click();
    const opzioniAccese = await cerca("Opzioni campione…");
    expect(opzioniAccese.disabled).toBe(false);
    opzioniAccese.run();
    expect(finestra()!.querySelector<HTMLInputElement>("input")!.value).toBe("Blu");
    expect(azioni.client).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("«Nuovo…» e Annulla: niente parte", async () => {
    const { c, corpo, comando } = completo(0);
    azione(corpo, "nuovo").click();
    premi("cancel");
    await vi.waitFor(() => expect(finestra()).toBeNull());
    expect(comando).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("ui.swatchOptions: «Opzioni…» del campione scelto mostra il suo nome e manda swatch.edit col nome nuovo", async () => {
    const { c, corpo, comando } = completo(0);
    voci(corpo)[0]!.click();
    azione(corpo, "opzioni").click();
    expect(finestra()!.textContent).toContain(t("draw.resources.swatches.opzioniTitolo"));
    const campo = finestra()!.querySelector<HTMLInputElement>("input")!;
    expect(campo.value).toBe("Blu");
    // Il suo nome non è «già usato»; quello di un altro sì.
    scriviNome("Arancio");
    premi("ok");
    await vi.waitFor(() => expect(finestra()!.textContent).toContain(t("draw.resources.swatches.nome.doppio")));
    scriviNome("Blu mare");
    premi("ok");
    expect(await arrivati(comando, 1)).toEqual([["disegno.swatch.edit", { name: "Blu", newName: "Blu mare" }]]);
    c.chiudi();
  });

  it("«Opzioni…» senza cambi non manda niente; il doppio clic sul campione le apre", async () => {
    const { c, corpo, comando } = completo(0);
    voci(corpo)[1]!.click();
    voci(corpo)[1]!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(finestra()!.querySelector<HTMLInputElement>("input")!.value).toBe("Arancio");
    premi("ok");
    await vi.waitFor(() => expect(finestra()).toBeNull());
    expect(comando).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("Elimina, Aggiungi i colori usati e Togli i non usati mandano un comando ciascuno", async () => {
    const { c, corpo, comando } = completo(1);
    voci(corpo)[0]!.click();
    azione(corpo, "elimina").click();
    azione(corpo, "usati").click();
    azione(corpo, "togli").click();
    expect((await arrivati(comando, 4)).slice(1)).toEqual([
      ["disegno.swatch.delete", { name: "Blu" }],
      ["disegno.swatch.addUsedColors", { selection: true }],
      ["disegno.swatch.delete", { names: ["Arancio"] }],
    ]);
    c.chiudi();
  });

  it("senza selezione «Aggiungi i colori usati» prende tutto il disegno; ogni campione usato spegne «Togli i non usati»", async () => {
    const { c, corpo, comando, disegna } = completo(0);
    azione(corpo, "usati").click();
    expect(await arrivati(comando, 1)).toEqual([["disegno.swatch.addUsedColors", {}]]);
    disegna(0, [BLU, ARANCIO], []);
    expect(azione(corpo, "togli").disabled).toBe(true);
    expect(azione(corpo, "togli").title).toBe(t("draw.resources.swatches.togli.nessuno"));
    c.chiudi();
  });

  it("con 2 000 campioni la griglia resta la stessa da un giro all'altro, finché l'elenco non cambia; il campione sparito non resta scelto", () => {
    const molti = Array.from({ length: 2000 }, (_, i) => ({ id: `r${i}`, name: `C${i}`, color: `#${(i * 97).toString(16).padStart(6, "0").slice(-6)}` }));
    const { c, corpo, disegna } = completo(0, molti, []);
    expect(voci(corpo)).toHaveLength(2000);
    const primo = voci(corpo)[0];
    voci(corpo)[5]!.click();
    disegna(1, molti, []);
    expect(voci(corpo)[0]).toBe(primo);
    expect(voci(corpo)[5]!.getAttribute("aria-pressed")).toBe("true");
    disegna(1, molti.filter((_, i) => i !== 5), []);
    expect(voci(corpo)).toHaveLength(1999);
    expect(corpo.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0);
    expect(azione(corpo, "elimina").disabled).toBe(true);
    c.chiudi();
  });

  it("le frecce, Inizio e Fine muovono il fuoco fra i campioni", () => {
    const { c, corpo } = completo(0, [BLU, ARANCIO, { id: "r3", name: "Viola", color: "#cc79a7" }]);
    const [blu, arancio, viola] = voci(corpo);
    blu!.focus();
    blu!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(arancio);
    expect(arancio!.tabIndex).toBe(0);
    arancio!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(viola);
    viola!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(blu);
    c.chiudi();
  });
});

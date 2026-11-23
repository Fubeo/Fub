// @vitest-environment happy-dom
// La sezione «Colore» del Design (K6 T14, giro 1) in una sessione del Completo vera: c'è nella
// scheda Design senza caricare la famiglia; mostra i colori che il pannello ha già, con il lato
// attivo segnato; ogni clic manda un comando solo al motore, dal percorso unico; senza selezione
// è spenta; da un giro all'altro i pozzi restano gli stessi.
import { describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { t } from "../strings";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";
import type { ColoriSelezione } from "./sezioni";

vi.mock("../motore/finestre", () => ({ apriFinestra: vi.fn(() => Promise.resolve(true)) }));

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["oa1a1a1a1"], losses: [], refused: null, frame: null };

function motoreFinto() {
  const comando = vi.fn((_passo: unknown) => Promise.resolve(ESITO));
  const comandi = vi.fn(() => Promise.resolve([]));
  const sessione = { comandi, comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

const ROSSO_E_BLU: ColoriSelezione = { riempimento: { valore: "#ff0000" }, contorno: { valore: "#0000ff" } };

/// Il Completo con l'indice vero e la famiglia `colore` spiata; la sezione disegnata una volta.
function completo(scelti: number, colori: ColoriSelezione = ROSSO_E_BLU) {
  const caricati: string[] = [];
  const { motore, comando } = motoreFinto();
  const c = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: {
        "./famiglie/colore/index.ts": () => {
          caricati.push("colore");
          return import("./famiglie/colore/index");
        },
      },
      tasti: { selezione: () => (scelti === 0 ? [] : ["oa1a1a1a1"]), annuncia: vi.fn() } as never,
    } as never,
  );
  const sezione = c.sezioni.di("design").find((una) => una.id === "color")!;
  const disegna = (numero: number, valori: ColoriSelezione): HTMLElement => {
    const corpo = document.createElement("div");
    document.body.append(corpo);
    sezione.disegna!({ corpo, sel: { numero }, motore, colori: valori, aggiorna: () => undefined, vita: openLifetime() } as never);
    return corpo;
  };
  const corpo = disegna(scelti, colori);
  return { c, corpo, caricati, comando, sezione, disegna };
}

const pozzi = (corpo: HTMLElement) => [...corpo.querySelectorAll<HTMLElement>(".kit-color-well")];
const pulsanti = (corpo: HTMLElement) => [...corpo.querySelectorAll<HTMLButtonElement>(".draw-color-actions .kit-button")];

/// I comandi arrivati al motore, per id e valore.
async function arrivati(comando: ReturnType<typeof motoreFinto>["comando"], quanti: number) {
  await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(quanti));
  return comando.mock.calls.map(([passo]) => {
    const { id, value } = passo as { id: string; value: unknown };
    return [id, value];
  });
}

describe("la sezione Colore del Design", () => {
  it("c'è nella scheda Design, con riempimento e contorno della selezione, il riempimento attivo, senza caricare la famiglia", async () => {
    const { c, corpo, caricati } = completo(1);
    await new Promise((risolto) => setTimeout(risolto, 0));
    expect(caricati).toEqual([]);
    expect(c.sezioni.di("design").find((una) => una.id === "color")?.titolo).toBe(t("draw.colore.titolo"));
    const [riempimento, contorno] = pozzi(corpo);
    expect(riempimento!.querySelector(".kit-color-well-name")?.textContent).toBe("#ff0000");
    expect(contorno!.querySelector(".kit-color-well-name")?.textContent).toBe("#0000ff");
    expect(riempimento!.classList.contains("draw-color-active")).toBe(true);
    expect(contorno!.classList.contains("draw-color-active")).toBe(false);
    expect(riempimento!.querySelector("button")!.getAttribute("aria-label")).toBe(
      `${t("draw.colore.attivo", { lato: t("draw.properties.fill") })}: #ff0000`,
    );
    expect(pulsanti(corpo).map((b) => b.textContent)).toEqual([
      t("draw.colore.scambia"),
      t("draw.colore.nessuno"),
      t("draw.colore.diSerie"),
      t("draw.colore.sfumatura.applica"),
    ]);
    c.chiudi();
  });

  it("senza selezione pozzi e pulsanti sono spenti; un lato che la selezione non ha si spegne da solo", () => {
    const vuota = completo(0);
    expect(vuota.corpo.querySelectorAll("button:not([disabled])")).toHaveLength(0);
    vuota.c.chiudi();
    const immagine = completo(1, { riempimento: { valore: "#ff0000" } });
    const [riempimento, contorno] = pozzi(immagine.corpo).map((p) => p.querySelector("button")!);
    expect(riempimento!.disabled).toBe(false);
    expect(contorno!.disabled).toBe(true);
    // Un testo scelto non ha contorno: il pozzo dice «Nessuno», non «Misto», e il perché.
    expect(contorno!.querySelector(".kit-color-well-name")?.textContent).not.toBe(t("draw.properties.mixed"));
    expect(contorno!.querySelector(".kit-color-chip")!.classList.contains("mixed")).toBe(false);
    expect(contorno!.getAttribute("aria-label")).toBe(t("draw.colore.manca", { lato: t("draw.properties.stroke") }));
    immagine.c.chiudi();
  });

  it("Scambia, Nessuno e Di serie mandano un comando ciascuno; Nessuno va sul lato attivo", async () => {
    const { c, corpo, comando } = completo(1);
    const [scambia, nessuno, diSerie] = pulsanti(corpo);
    scambia!.click();
    expect(await arrivati(comando, 1)).toEqual([["disegno.paint.swap", {}]]);
    nessuno!.click();
    diSerie!.click();
    expect((await arrivati(comando, 3)).slice(1)).toEqual([
      ["disegno.paint.setFill", { none: true }],
      ["disegno.paint.default", {}],
    ]);
    c.chiudi();
  });

  it("Sfumatura dà l'ultima sfumatura al lato attivo; con soli testi o un oggetto bloccato è spenta col perché", async () => {
    const { c, corpo, comando, sezione } = completo(1);
    pulsanti(corpo)[3]!.click();
    expect(await arrivati(comando, 1)).toEqual([["disegno.paint.lastGradient", { stroke: false }]]);
    pozzi(corpo)[1]!.querySelector("button")!.click();
    await arrivati(comando, 2);
    pulsanti(corpo)[3]!.click();
    expect((await arrivati(comando, 3))[2]).toEqual(["disegno.paint.lastGradient", { stroke: true }]);
    for (const [sfumature, perche] of [
      [{ bloccato: false, soloTesto: true }, t("draw.sfumatura.testo")],
      [{ bloccato: true, soloTesto: false }, t("draw.sfumatura.bloccato")],
    ] as const) {
      const altro = document.createElement("div");
      sezione.disegna!({ corpo: altro, sel: { numero: 1 }, colori: ROSSO_E_BLU, misure: { sfumature }, aggiorna: () => undefined, vita: openLifetime() } as never);
      const sfumatura = pulsanti(altro)[3]!;
      expect(sfumatura.disabled).toBe(true);
      expect(sfumatura.getAttribute("aria-label")).toBe(perche);
    }
    c.chiudi();
  });

  it("più colori diversi mostrano «Misto» sul pozzo; un riempimento «nessuno» dice «Nessuno»", () => {
    const misto = completo(2, { riempimento: { valore: null }, contorno: { valore: "#0000ff" } });
    const [riempimento] = pozzi(misto.corpo);
    expect(riempimento!.querySelector(".kit-color-well-name")?.textContent).toBe(t("draw.properties.mixed"));
    expect(riempimento!.querySelector(".kit-color-chip")!.classList.contains("mixed")).toBe(true);
    misto.c.chiudi();
    const nessuno = completo(1, { riempimento: { valore: "none" } });
    const [riempimentoNessuno] = pozzi(nessuno.corpo);
    expect(riempimentoNessuno!.querySelector(".kit-color-chip")!.classList.contains("none")).toBe(true);
    nessuno.c.chiudi();
  });

  it("aprire il pozzo del contorno lo fa attivo con un comando solo; un colore scelto va sul suo lato", async () => {
    const { c, corpo, comando } = completo(1);
    const [, contorno] = pozzi(corpo);
    contorno!.querySelector("button")!.click();
    expect(await arrivati(comando, 1)).toEqual([["disegno.paint.toggleActive", { fill: false }]]);
    expect(contorno!.classList.contains("draw-color-active")).toBe(true);
    // Il selettore aperto: il campione «nessuno» toglie il colore del contorno.
    document.querySelector<HTMLButtonElement>(".kit-color-swatch.none")!.click();
    expect((await arrivati(comando, 2))[1]).toEqual(["disegno.paint.setStroke", { none: true }]);
    // Ora Nessuno va sul contorno, e riaprire lo stesso pozzo non manda niente.
    pulsanti(corpo)[1]!.click();
    expect((await arrivati(comando, 3))[2]).toEqual(["disegno.paint.setStroke", { none: true }]);
    c.chiudi();
  });

  it("da un giro all'altro i pozzi restano gli stessi elementi, con i valori nuovi; sfumature e motivi hanno un nome", () => {
    const { c, corpo, disegna } = completo(1);
    const prima = pozzi(corpo)[0];
    const dopo = disegna(1, {
      riempimento: { valore: "url(#g1)", campione: { kind: "gradient" } as never },
      contorno: { valore: "url(#m1)" },
    });
    expect(pozzi(dopo)[0]).toBe(prima);
    expect(pozzi(dopo).map((p) => p.querySelector(".kit-color-well-name")?.textContent)).toEqual([
      t("draw.colore.sfumatura"),
      t("draw.colore.motivo"),
    ]);
    c.chiudi();
  });
});

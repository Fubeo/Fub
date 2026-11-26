// @vitest-environment happy-dom
// «Trova carattere…» del menu Testo (VectorCraft `type.findFont`): la voce nel menu Testo, l'elenco
// dei caratteri del disegno (anche quelli che mancano), Trova, Cambia sui soli testi scelti, Cambia
// tutto con l'elenco riletto, l'avviso del motore, la famiglia non pronta, la risposta vecchia che non
// vince, Chiudi ed Esc senza comandi. Col motore finto e con la porta vera, per gli id `disegno.` e
// gli argomenti.
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DrawingCommandRequest,
  DrawingOutcome,
} from "../../../host/contract";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { DipendenzeComando } from "./esegui";
import indiceGenerato from "./indice.generated.json";
import {
  apriTrovaCarattere,
  caratteriDi,
  creaPortaTrovaCarattere,
  type CarattereDelDisegno,
  type CarattereNuovo,
  type EsitoAzione,
  type PortaTrovaCarattere,
} from "./trova-carattere";
import { t } from "../strings";

const CARATTERI: CarattereDelDisegno[] = [
  { family: "Inter", style: "Regular", objects: 2, missing: false },
  { family: "Futura", style: "Bold", objects: 1, missing: true },
];

const lifetimes: Lifetime[] = [];
afterEach(() => {
  for (const life of lifetimes.splice(0)) life.close();
  document.body.replaceChildren();
});
function vita(): Lifetime {
  const life = openLifetime();
  lifetimes.push(life);
  return life;
}

function portaFinta(over: Partial<PortaTrovaCarattere> = {}) {
  const base = {
    pronta: vi.fn(() => Promise.resolve(true)),
    caratteri: vi.fn(() =>
      Promise.resolve<readonly CarattereDelDisegno[] | null>(CARATTERI),
    ),
    famiglie: vi.fn(() =>
      Promise.resolve<readonly string[] | null>(["Inter", "Noto Serif"]),
    ),
    stili: vi.fn((famiglia: string) =>
      Promise.resolve<readonly string[] | null>(
        famiglia === "Inter" ? ["Regular", "Bold", "Italic"] : ["Regular"],
      ),
    ),
    ciSonoScelti: vi.fn(() => true),
    trova: vi.fn((_da: CarattereDelDisegno) =>
      Promise.resolve<EsitoAzione>({ fatto: true, avviso: null }),
    ),
    sostituisci: vi.fn(
      (_da: CarattereDelDisegno, _a: CarattereNuovo, _solo: boolean) =>
        Promise.resolve<EsitoAzione>({ fatto: true, avviso: null }),
    ),
  };
  return Object.assign(base, over) as typeof base;
}

const attesa = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const finestra = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[role="dialog"]');
const elenco = (): HTMLSelectElement =>
  document.querySelector<HTMLSelectElement>(".draw-findfont-list")!;
const famiglia = (): HTMLSelectElement =>
  document.querySelector<HTMLSelectElement>(".draw-findfont-family")!;
const stile = (): HTMLSelectElement =>
  document.querySelector<HTMLSelectElement>(".draw-findfont-style")!;
const tasto = (azione: string): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(`[data-action="${azione}"]`)!;
const testo = (): string => finestra()?.textContent ?? "";
const cambia = (sel: HTMLSelectElement, valore: string): void => {
  sel.value = valore;
  sel.dispatchEvent(new Event("change"));
};

describe("Trova carattere", () => {
  it("sta nel menu Testo come voce del client", () => {
    const voci = (
      indiceGenerato as unknown as {
        readonly voci: readonly {
          id: string;
          posto: string;
          chiamata: unknown;
        }[];
      }
    ).voci;
    const voce = voci.find((una) => una.id === "type.findFont")!;
    expect(voce.posto).toBe("menu/testo");
    expect(voce.chiamata).toEqual({ client: "type.findFont" });
  });

  it("elenca i caratteri del disegno, coi mancanti, e propone la famiglia del primo", async () => {
    apriTrovaCarattere(portaFinta(), vita());
    await attesa();
    expect(testo()).toContain(
      t("draw.trovaCarattere.nelDisegno", { count: 2 }),
    );
    expect([...elenco().options].map((o) => o.textContent)).toEqual([
      "Inter Regular",
      t("draw.trovaCarattere.manca", { nome: "Futura Bold" }),
    ]);
    expect(elenco().selectedIndex).toBe(0);
    expect(famiglia().value).toBe("Inter");
    expect([...stile().options].map((o) => o.value)).toEqual([
      "",
      "Regular",
      "Bold",
      "Italic",
    ]);
    expect(tasto("find").disabled).toBe(false);
    expect(tasto("changeAll").disabled).toBe(false);
  });

  it("Trova manda il carattere scelto e la finestra resta aperta", async () => {
    const porta = portaFinta();
    apriTrovaCarattere(porta, vita());
    await attesa();
    cambia(elenco(), "1");
    tasto("find").click();
    await attesa();
    expect(porta.trova).toHaveBeenCalledWith(CARATTERI[1]);
    expect(finestra()).not.toBeNull();
  });

  it("Cambia vale sui testi scelti; senza testi scelti dice perché e non manda niente", async () => {
    const porta = portaFinta({ ciSonoScelti: vi.fn(() => false) });
    apriTrovaCarattere(porta, vita());
    await attesa();
    tasto("change").click();
    await attesa();
    expect(testo()).toContain(t("draw.trovaCarattere.cambiaSenzaScelti"));
    expect(porta.sostituisci).not.toHaveBeenCalled();
    porta.ciSonoScelti.mockReturnValue(true);
    cambia(stile(), "Bold");
    tasto("change").click();
    await attesa();
    expect(porta.sostituisci).toHaveBeenCalledWith(
      CARATTERI[0],
      { family: "Inter", style: "Bold" },
      true,
    );
  });

  it("Cambia tutto col nuovo stile più vicino, rilegge l'elenco e mostra l'avviso del motore", async () => {
    const porta = portaFinta({
      sostituisci: vi.fn(() =>
        Promise.resolve<EsitoAzione>({
          fatto: true,
          avviso: "un testo bloccato resta com'era",
        }),
      ),
    });
    apriTrovaCarattere(porta, vita());
    await attesa();
    cambia(famiglia(), "Noto Serif");
    await attesa();
    expect([...stile().options].map((o) => o.value)).toEqual(["", "Regular"]);
    porta.caratteri.mockResolvedValue([
      { family: "Noto Serif", style: "Regular", objects: 2, missing: false },
      CARATTERI[1]!,
    ]);
    tasto("changeAll").click();
    await attesa();
    expect(porta.sostituisci).toHaveBeenCalledWith(
      CARATTERI[0],
      { family: "Noto Serif", style: null },
      false,
    );
    expect(porta.caratteri).toHaveBeenCalledTimes(2);
    expect(elenco().options[0]!.textContent).toBe("Noto Serif Regular");
    expect(testo()).toContain("un testo bloccato resta com'era");
    expect(finestra()).not.toBeNull();
  });

  it("con la famiglia del testo non pronta lo dice e le azioni restano spente", async () => {
    const porta = portaFinta({ pronta: vi.fn(() => Promise.resolve(false)) });
    apriTrovaCarattere(porta, vita());
    await attesa();
    expect(testo()).toContain(t("draw.trovaCarattere.nonPronta"));
    expect(porta.caratteri).not.toHaveBeenCalled();
    expect(tasto("find").disabled).toBe(true);
    expect(tasto("changeAll").disabled).toBe(true);
  });

  it("un disegno senza testi lo dice; un elenco che non arriva pure", async () => {
    apriTrovaCarattere(
      portaFinta({ caratteri: vi.fn(() => Promise.resolve([])) }),
      vita(),
    );
    await attesa();
    expect(testo()).toContain(t("draw.trovaCarattere.nessuno"));
    expect(tasto("find").disabled).toBe(true);
    document.body.replaceChildren();
    apriTrovaCarattere(
      portaFinta({ caratteri: vi.fn(() => Promise.resolve(null)) }),
      vita(),
    );
    await attesa();
    expect(testo()).toContain(t("draw.trovaCarattere.elencoFallito"));
  });

  it("gli stili di una famiglia scelta prima non entrano dopo quelli di una scelta dopo", async () => {
    let lento: (s: readonly string[]) => void = () => undefined;
    const porta = portaFinta();
    apriTrovaCarattere(porta, vita());
    await attesa();
    porta.stili.mockImplementationOnce(() => new Promise((r) => (lento = r)));
    cambia(famiglia(), "Noto Serif");
    cambia(famiglia(), "Inter");
    await attesa();
    lento(["Vecchio"]);
    await attesa();
    expect([...stile().options].map((o) => o.value)).toEqual([
      "",
      "Regular",
      "Bold",
      "Italic",
    ]);
  });

  it("Chiudi ed Esc non mandano niente; la vita del Completo chiude la finestra", async () => {
    const porta = portaFinta();
    apriTrovaCarattere(porta, vita());
    await attesa();
    tasto("close").click();
    await attesa();
    expect(finestra()).toBeNull();
    const completo = vita();
    apriTrovaCarattere(porta, completo);
    await attesa();
    finestra()!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await attesa();
    expect(finestra()).toBeNull();
    apriTrovaCarattere(porta, completo);
    await attesa();
    completo.close();
    await attesa();
    expect(finestra()).toBeNull();
    expect(porta.trova).not.toHaveBeenCalled();
    expect(porta.sostituisci).not.toHaveBeenCalled();
  });

  it("legge text.fonts saltando le voci che non si leggono", () => {
    expect(
      caratteriDi([
        { family: "Inter", style: "Regular", objects: 3, missing: false },
        { family: 1 },
      ]),
    ).toEqual([
      { family: "Inter", style: "Regular", objects: 3, missing: false },
    ]);
    expect(caratteriDi({})).toBeNull();
  });

  it("la porta vera prepara le famiglie e manda i comandi col prefisso disegno. e gli argomenti giusti", async () => {
    const comandi: DrawingCommandRequest[] = [];
    const risposta = (reading: unknown): DrawingOutcome =>
      ({
        revision: "1",
        preview: null,
        ops: "[]",
        selection: [],
        losses: [],
        refused: null,
        frame: null,
        reading,
      }) as unknown as DrawingOutcome;
    const sessione = {
      comando: vi.fn((richiesta: Omit<DrawingCommandRequest, "revision">) => {
        comandi.push(richiesta as DrawingCommandRequest);
        if (richiesta.id === "disegno.text.fonts")
          return Promise.resolve(risposta(CARATTERI));
        if (richiesta.id === "disegno.text.fontList")
          return Promise.resolve(
            risposta(
              (richiesta.value as { family?: string }).family === undefined
                ? { families: ["Inter"] }
                : { styles: ["Regular", "Bold"] },
            ),
          );
        if (richiesta.id === "disegno.text.replaceFont")
          return Promise.resolve(
            risposta({ runs: 2, warning: "stile vicino" }),
          );
        return Promise.resolve(risposta({ count: 1 }));
      }),
    };
    const famiglie: string[] = [];
    const dipendenze = {
      motore: { pronta: () => Promise.resolve(sessione), assente: () => null },
      carica: {
        famiglia: (id: string) => {
          famiglie.push(id);
          return Promise.resolve({ kind: "pronta" });
        },
      },
      selezione: () => ["ot1"],
      vita: vita(),
      leggi: () => [],
      commit: () => true,
      seleziona: () => undefined,
      annuncia: () => undefined,
    } as unknown as DipendenzeComando;
    const porta = creaPortaTrovaCarattere(dipendenze);
    expect(await porta.pronta()).toBe(true);
    expect(famiglie.sort()).toEqual(["livelli", "testo"]);
    expect(await porta.caratteri()).toEqual(CARATTERI);
    expect(await porta.famiglie()).toEqual(["Inter"]);
    expect(await porta.stili("Inter")).toEqual(["Regular", "Bold"]);
    expect(porta.ciSonoScelti()).toBe(true);
    expect(await porta.trova(CARATTERI[0]!)).toEqual({
      fatto: true,
      avviso: null,
    });
    expect(
      await porta.sostituisci(
        CARATTERI[0]!,
        { family: "Inter", style: "Bold" },
        true,
      ),
    ).toEqual({ fatto: true, avviso: "stile vicino" });
    await porta.sostituisci(
      CARATTERI[0]!,
      { family: "Inter", style: null },
      false,
    );
    expect(comandi.map((c) => c.id)).toEqual([
      "disegno.text.fonts",
      "disegno.text.fontList",
      "disegno.text.fontList",
      "disegno.select.font",
      "disegno.text.replaceFont",
      "disegno.text.replaceFont",
    ]);
    expect(comandi[3]!.value).toEqual({ family: "Inter", style: "Regular" });
    expect(comandi[4]!.value).toEqual({
      from: { family: "Inter", style: "Regular" },
      to: { family: "Inter", style: "Bold" },
      selectionOnly: true,
    });
    expect(comandi[5]!.value).toEqual({
      from: { family: "Inter", style: "Regular" },
      to: { family: "Inter" },
    });
    expect(comandi[4]!.selection).toEqual(["ot1"]);
  });
});

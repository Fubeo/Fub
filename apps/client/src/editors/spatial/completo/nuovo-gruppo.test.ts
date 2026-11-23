// @vitest-environment happy-dom
// La finestra «Nuovo gruppo colori…» del Disegno completo (K6 T14, gruppi; riga `ui.newColorGroup`): il nome, i
// campioni di colore pieno con le caselle, OK che manda `swatch.newGroup` in un solo passo, il gruppo vuoto che
// non va al motore, Annulla ed Esc, una finestra per volta, il Completo che si chiude, e il motore assente.
// Le prove vanno sul Completo vero, con l'indice generato e il motore finto, come `selettore-colore.test.ts`.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingOutcome } from "../../../host/contract";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { t } from "../strings";
import type { VoceRicerca } from "./comandi";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

vi.mock("../motore/finestre", () => ({ apriFinestra: vi.fn(() => Promise.resolve(true)) }));

const ETICHETTA = "Nuovo gruppo colori…";
/// I campioni del disegno come li dà `swatch.list`: due colori pieni (uno già in un gruppo), una sfumatura e «Nessuno».
const CAMPIONI = [
  { name: "Arancio", kind: "color", hex: "#e69f00", group: null },
  { name: "Blu", kind: "color", hex: "#0072b2", group: "Freddi" },
  { name: "Giallo", kind: "color", hex: "#f0e442", group: null },
  { name: "Sfumata", kind: "gradient", hex: null, group: null },
  { name: "[None]", kind: "none", hex: null, group: null },
];

type Passo = { readonly id: string; readonly selection: readonly string[]; readonly value: unknown; readonly preview: boolean };

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

const attesa = (ms = 30) => new Promise<void>((risolto) => setTimeout(risolto, ms));

/// Un esito del motore; `over` aggiunge la lettura o il rifiuto.
const esito = (over: Partial<Record<string, unknown>> = {}): DrawingOutcome =>
  ({ revision: "1", preview: null, ops: "[]", selection: [], losses: [], refused: null, frame: null, ...over }) as unknown as DrawingOutcome;

/// Il motore finto: la lista dei campioni per `swatch.list`, e il successo per il resto (salvo `risposta`).
function motoreFinto(risposta: (passo: Passo) => DrawingOutcome = (passo) =>
  passo.id === "disegno.swatch.list" ? esito({ reading: { swatches: CAMPIONI } }) : esito()) {
  const comando = vi.fn((passo: Passo) => Promise.resolve(risposta(passo)));
  const sessione = { comandi: vi.fn(() => Promise.resolve([])), comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

/// Il Completo con l'indice vero e il motore finto (o nessuno).
function completo(opzioni: { readonly risposta?: (passo: Passo) => DrawingOutcome; readonly senzaMotore?: boolean; readonly life?: Lifetime } = {}) {
  const life = opzioni.life ?? vita();
  const { motore, comando } = motoreFinto(opzioni.risposta);
  const motoreUsato = opzioni.senzaMotore === true ? null : motore;
  const commit = vi.fn((_ops: unknown, _nome: string) => true);
  const annuncia = vi.fn();
  // Un esito con operazioni: il comando del gruppo ne ha almeno una, e la cronologia riceve un passo.
  const leggi = vi.fn((ops: string | null) => (ops === null ? null : [{ op: "set", id: "r1a1a1a1a", attrs: { "fub:group": "Caldi" } }]));
  const c = apri({ motore: motoreUsato, life } as never, {
    indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
    prepara: () => Promise.resolve("pronta"),
    moduli: { "./famiglie/colore/index.ts": () => import("./famiglie/colore/index") },
    tasti: { selezione: () => [], annuncia, commit, leggi, seleziona: vi.fn() } as never,
  } as never);
  return { c, life, comando, commit, annuncia };
}

/// La voce di ricerca «Nuovo gruppo colori…», come la vede chi cerca con Ctrl+/.
async function voceNuovoGruppo(c: ReturnType<typeof completo>["c"]): Promise<VoceRicerca> {
  const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
  return (await c.ricerca(() => [], azioni))!.find((una) => una.label === ETICHETTA)!;
}

const dialogo = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]');
const campoNome = (): HTMLInputElement => dialogo()!.querySelector<HTMLInputElement>('input:not([type="checkbox"])')!;
const caselle = (): HTMLInputElement[] => (dialogo() === null ? [] : [...dialogo()!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]);
const azione = (id: string): HTMLButtonElement => dialogo()!.querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!;
const testoErrore = (): string => dialogo()?.querySelector<HTMLElement>(".draw-colorgroup-error")?.textContent ?? "";

/// I comandi di creazione del gruppo arrivati al motore: l'id, il valore e la selezione.
function inviati(comando: ReturnType<typeof motoreFinto>["comando"]) {
  return comando.mock.calls.map(([passo]) => passo).filter((passo) => passo.id === "disegno.swatch.newGroup");
}

describe("la finestra «Nuovo gruppo colori…» del Completo", () => {
  it("1. «Caldi» con due campioni: il motore riceve nome e campioni, un solo comando e un solo passo di cronologia", async () => {
    const { c, comando, commit } = completo();
    (await voceNuovoGruppo(c)).run();
    await vi.waitFor(() => expect(caselle()).toHaveLength(3));
    campoNome().value = "Caldi";
    caselle()[0]!.click();
    caselle()[2]!.click();
    azione("ok").click();
    await vi.waitFor(() => expect(inviati(comando)).toHaveLength(1));
    expect(inviati(comando)[0]).toEqual({ id: "disegno.swatch.newGroup", selection: [], value: { name: "Caldi", swatches: ["Arancio", "Giallo"] }, preview: false });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]![1]).toBe(t("draw.colorGroup.undo"));
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    c.chiudi();
  });

  it("2. nome vuoto: il motore riceve il nome vuoto, che lui chiama «Gruppo colori»; il campo lo dice", async () => {
    const { c, comando } = completo();
    (await voceNuovoGruppo(c)).run();
    await vi.waitFor(() => expect(caselle()).toHaveLength(3));
    expect(campoNome().placeholder).toBe(t("draw.colorGroup.nomeDiSerie"));
    caselle()[1]!.click();
    azione("ok").click();
    await vi.waitFor(() => expect(inviati(comando)).toHaveLength(1));
    expect(inviati(comando)[0]!.value).toEqual({ name: "", swatches: ["Blu"] });
    c.chiudi();
  });

  it("3. nessun campione: OK dice la frase del motore, la finestra resta aperta, e il motore non riceve niente", async () => {
    const { c, comando, commit } = completo();
    (await voceNuovoGruppo(c)).run();
    await vi.waitFor(() => expect(caselle()).toHaveLength(3));
    campoNome().value = "Vuoto";
    azione("ok").click();
    await vi.waitFor(() => expect(testoErrore()).toBe(t("draw.colorGroup.vuoto")));
    await attesa();
    expect(dialogo()).not.toBeNull();
    expect(inviati(comando)).toHaveLength(0);
    expect(commit).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("4. nome di soli spazi o molto lungo: il motore riceve il nome com'è, e lo tratta lui (la prova è in campioni_gruppi.rs)", async () => {
    const { c, comando } = completo();
    const lungo = "Caldi e freddi della stagione lunga da tenere sul tavolo di lavoro per il progetto";
    for (const nome of ["   ", lungo]) {
      (await voceNuovoGruppo(c)).run();
      await vi.waitFor(() => expect(caselle()).toHaveLength(3));
      campoNome().value = nome;
      caselle()[0]!.click();
      azione("ok").click();
      await vi.waitFor(() => expect(dialogo()).toBeNull());
    }
    expect(inviati(comando).map((passo) => (passo.value as { name: string }).name)).toEqual(["   ", lungo]);
    c.chiudi();
  });

  it("5. Annulla ed Esc: il motore non riceve niente", async () => {
    const { c, comando, commit } = completo();
    (await voceNuovoGruppo(c)).run();
    await vi.waitFor(() => expect(caselle()).toHaveLength(3));
    caselle()[0]!.click();
    azione("cancel").click();
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    (await voceNuovoGruppo(c)).run();
    await vi.waitFor(() => expect(caselle()).toHaveLength(3));
    caselle()[0]!.click();
    dialogo()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    await attesa();
    expect(inviati(comando)).toHaveLength(0);
    expect(commit).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("6. OK due volte: un solo comando e un solo passo, così Annulla riporta il file al byte di prima (il byte è in campioni_gruppi.rs)", async () => {
    const { c, comando, commit } = completo();
    (await voceNuovoGruppo(c)).run();
    await vi.waitFor(() => expect(caselle()).toHaveLength(3));
    campoNome().value = "Caldi";
    caselle()[0]!.click();
    azione("ok").click();
    azione("ok").click();
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    await attesa();
    expect(inviati(comando)).toHaveLength(1);
    expect(commit).toHaveBeenCalledTimes(1);
    c.chiudi();
  });

  it("7. doppio clic sulla voce: una sola finestra", async () => {
    const { c } = completo();
    const voce = await voceNuovoGruppo(c);
    voce.run();
    voce.run();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    c.chiudi();
  });

  it("8. chiudere il Completo con la finestra aperta: nessun ascoltatore della finestra resta", async () => {
    const vivi: { readonly bersaglio: EventTarget; readonly tipo: string; readonly ascoltatore: unknown; readonly cattura: boolean }[] = [];
    const cattura = (opzioni?: boolean | AddEventListenerOptions | EventListenerOptions): boolean =>
      typeof opzioni === "boolean" ? opzioni : opzioni?.capture === true;
    const prototipi = [document.body, document, window].map((oggetto) => {
      let p: object | null = oggetto;
      while (p !== null && !Object.prototype.hasOwnProperty.call(p, "addEventListener")) p = Object.getPrototypeOf(p);
      return p ?? EventTarget.prototype;
    });
    const originali = [...new Set(prototipi)].map((p) => {
      const aggiungi = (p as EventTarget).addEventListener;
      const togli = (p as EventTarget).removeEventListener;
      Object.assign(p, {
        addEventListener(this: EventTarget, tipo: string, ascoltatore: unknown, opzioni?: boolean | AddEventListenerOptions) {
          if (ascoltatore !== null) vivi.push({ bersaglio: this, tipo, ascoltatore, cattura: cattura(opzioni) });
          Reflect.apply(aggiungi, this, [tipo, ascoltatore, opzioni]);
        },
        removeEventListener(this: EventTarget, tipo: string, ascoltatore: unknown, opzioni?: boolean | EventListenerOptions) {
          const posto = vivi.findIndex((a) => a.bersaglio === this && a.tipo === tipo && a.ascoltatore === ascoltatore && a.cattura === cattura(opzioni));
          if (posto >= 0) vivi.splice(posto, 1);
          Reflect.apply(togli, this, [tipo, ascoltatore, opzioni]);
        },
      });
      return { p, aggiungi, togli };
    });
    try {
      const { c } = completo();
      const voce = await voceNuovoGruppo(c);
      const prima = vivi.length;
      voce.run();
      await vi.waitFor(() => expect(caselle()).toHaveLength(3));
      const della = vivi.slice(prima);
      expect(della.length).toBeGreaterThan(0);
      c.chiudi();
      await vi.waitFor(() => expect(dialogo()).toBeNull());
      expect(vivi.filter((ascolto) => della.includes(ascolto))).toEqual([]);
    } finally {
      for (const { p, aggiungi, togli } of originali) Object.assign(p, { addEventListener: aggiungi, removeEventListener: togli });
    }
  });

  it("9. motore assente: la finestra dice che il disegno non ha risposto, OK resta spento, e niente parte", async () => {
    const { c, comando } = completo({ senzaMotore: true });
    (await voceNuovoGruppo(c)).run();
    await vi.waitFor(() => expect(testoErrore()).toBe(t("draw.window.unanswered")));
    expect(azione("ok").disabled).toBe(true);
    expect(dialogo()).not.toBeNull();
    expect(inviati(comando)).toHaveLength(0);
    c.chiudi();
  });

  it("la lista ha solo i campioni di colore pieno, col codice e il gruppo che lasciano", async () => {
    const { c } = completo();
    (await voceNuovoGruppo(c)).run();
    await vi.waitFor(() => expect(caselle()).toHaveLength(3));
    const etichette = [...dialogo()!.querySelectorAll(".draw-colorgroup-list label")].map((riga) => riga.textContent);
    expect(etichette).toEqual([
      "Arancio #e69f00",
      `Blu #0072b2 · ${t("draw.colorGroup.nelGruppo", { gruppo: "Freddi" })}`,
      "Giallo #f0e442",
    ]);
    c.chiudi();
  });
});

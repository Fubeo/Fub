// @vitest-environment happy-dom
// Il «Selettore colore…» del Disegno completo (K6 T14, selettore; riga `ui.colorPicker`): la voce di
// Modifica › Modifica colori apre il selettore del kit con il colore del lato attivo, e OK manda il
// comando del pozzo in un passo di Annulla. Le prove vanno sul Completo vero, con l'indice generato e il
// motore finto, come `colore-sezione.test.ts`: Annulla ed Esc non cambiano niente, un rifiuto del motore
// resta nella finestra col suo perché, una finestra per volta, il Completo che si chiude non lascia
// ascoltatori, e il motore assente non dà rifiuti non gestiti.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrawingOutcome } from "../../../host/contract";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import type { MenuItem } from "../../../ui/menu";
import { t } from "../strings";
import type { VoceRicerca } from "./comandi";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";
import { partenzaDel } from "./selettore-colore";
import type { ColoriSelezione } from "./sezioni";

vi.mock("../motore/finestre", () => ({ apriFinestra: vi.fn(() => Promise.resolve(true)) }));

const ROSSO_E_BLU: ColoriSelezione = { riempimento: { valore: "#ff0000" }, contorno: { valore: "#0000ff" } };
const ETICHETTA = "Selettore colore…";
const OPERAZIONE = { op: "set", id: "oa1a1a1a1", attrs: { fill: "#00ff00" } };

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

/// Un esito del motore; `over` cambia ciò che serve (un rifiuto, nessuna operazione).
const esito = (over: Partial<Record<string, unknown>> = {}): DrawingOutcome =>
  ({ revision: "1", preview: null, ops: "[]", selection: ["oa1a1a1a1"], losses: [], refused: null, frame: null, ...over }) as unknown as DrawingOutcome;

/// Il motore finto: registra i comandi, e risponde con `risposta` (il successo, se non c'è).
function motoreFinto(risposta: (passo: Passo) => DrawingOutcome = () => esito()) {
  const comando = vi.fn((passo: Passo) => Promise.resolve(risposta(passo)));
  const sessione = { comandi: vi.fn(() => Promise.resolve([])), comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

/// Il Completo con l'indice vero e la sezione Colore disegnata coi colori del pannello, sulla selezione
/// `ids`. Senza `motore`, il Completo non ne ha uno.
function completo(
  ids: readonly string[],
  colori: ColoriSelezione,
  opzioni: { readonly risposta?: (passo: Passo) => DrawingOutcome; readonly senzaMotore?: boolean; readonly life?: Lifetime } = {},
) {
  const life = opzioni.life ?? vita();
  const { motore, comando } = motoreFinto(opzioni.risposta);
  const motoreUsato = opzioni.senzaMotore === true ? null : motore;
  const commit = vi.fn((_ops: unknown, _nome: string) => true);
  const annuncia = vi.fn();
  const leggi = vi.fn((ops: string | null) => (ops === null ? null : [OPERAZIONE]));
  const c = apri({ motore: motoreUsato, life } as never, {
    indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
    prepara: () => Promise.resolve("pronta"),
    moduli: { "./famiglie/colore/index.ts": () => import("./famiglie/colore/index") },
    tasti: { selezione: () => [...ids], annuncia, commit, leggi, seleziona: vi.fn() } as never,
  } as never);
  const sezione = c.sezioni.di("design").find((una) => una.id === "color")!;
  const corpo = document.createElement("div");
  document.body.append(corpo);
  sezione.disegna!({ corpo, sel: { numero: ids.length }, motore: motoreUsato, colori, aggiorna: () => undefined, vita: openLifetime() } as never);
  return { c, life, corpo, comando, commit, annuncia };
}

/// La voce di ricerca «Selettore colore…», come la vede chi cerca con Ctrl+/.
async function voceSelettore(c: ReturnType<typeof completo>["c"]): Promise<VoceRicerca> {
  const azioni = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };
  return (await c.ricerca(() => [], azioni))!.find((una) => una.label === ETICHETTA)!;
}

const dialogo = (): HTMLElement | null => document.querySelector<HTMLElement>('[role="dialog"]');
const campoCodice = (): HTMLInputElement => dialogo()!.querySelector<HTMLInputElement>(".kit-color-input")!;
const azione = (id: string): HTMLButtonElement => dialogo()!.querySelector<HTMLButtonElement>(`[data-action="${id}"]`)!;
/// Scrive un colore nel campo del codice del selettore, come chi lo digita e lascia il campo.
function scegli(codice: string): void {
  campoCodice().value = codice;
  campoCodice().dispatchEvent(new Event("change"));
}

/// I comandi arrivati al motore, per id, valore e selezione.
async function arrivati(comando: ReturnType<typeof motoreFinto>["comando"], quanti: number) {
  await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(quanti));
  return comando.mock.calls.map(([passo]) => [passo.id, passo.value, passo.selection]);
}

/// Tutti i nodi del menu con quell'etichetta, anche dentro i sottomenu.
function nodi(voci: readonly MenuItem[], etichetta: string): MenuItem[] {
  return voci.flatMap((voce) => [
    ...(voce.label === etichetta ? [voce] : []),
    ...(Array.isArray(voce.items) ? nodi(voce.items as readonly MenuItem[], etichetta) : []),
  ]);
}

/// Un ascolto registrato: il bersaglio, il tipo, la funzione e la fase.
interface Ascolto {
  readonly bersaglio: EventTarget;
  readonly tipo: string;
  readonly ascoltatore: EventListenerOrEventListenerObject;
  readonly cattura: boolean;
}

/// Il prototipo che definisce `addEventListener` per un oggetto del DOM: in happy-dom è il suo, non quello
/// globale di `EventTarget`.
function proprietarioDegliAscolti(oggetto: object): object {
  let prototipo: object | null = oggetto;
  while (prototipo !== null && !Object.prototype.hasOwnProperty.call(prototipo, "addEventListener")) prototipo = Object.getPrototypeOf(prototipo);
  return prototipo ?? EventTarget.prototype;
}

/// Tiene la lista degli ascolti vivi: ciò che si aggiunge e non si toglie. Va installata prima e tolta dopo.
function tracciaAscoltatori() {
  const vivi: Ascolto[] = [];
  const cattura = (opzioni?: boolean | AddEventListenerOptions | EventListenerOptions): boolean =>
    typeof opzioni === "boolean" ? opzioni : opzioni?.capture === true;
  const prototipi = new Set<object>([proprietarioDegliAscolti(document.body), proprietarioDegliAscolti(document), proprietarioDegliAscolti(window)]);
  const originali = [...prototipi].map((prototipo) => {
    const aggiungi = (prototipo as EventTarget).addEventListener;
    const togli = (prototipo as EventTarget).removeEventListener;
    Object.assign(prototipo, {
      addEventListener(this: EventTarget, tipo: string, ascoltatore: EventListenerOrEventListenerObject | null, opzioni?: boolean | AddEventListenerOptions) {
        if (ascoltatore !== null) vivi.push({ bersaglio: this, tipo, ascoltatore, cattura: cattura(opzioni) });
        Reflect.apply(aggiungi, this, [tipo, ascoltatore, opzioni]);
      },
      removeEventListener(this: EventTarget, tipo: string, ascoltatore: EventListenerOrEventListenerObject | null, opzioni?: boolean | EventListenerOptions) {
        const posto = vivi.findIndex((a) => a.bersaglio === this && a.tipo === tipo && a.ascoltatore === ascoltatore && a.cattura === cattura(opzioni));
        if (posto >= 0) vivi.splice(posto, 1);
        Reflect.apply(togli, this, [tipo, ascoltatore, opzioni]);
      },
    });
    return { prototipo, aggiungi, togli };
  });
  return {
    vivi,
    ferma: () => {
      for (const { prototipo, aggiungi, togli } of originali) Object.assign(prototipo, { addEventListener: aggiungi, removeEventListener: togli });
    },
  };
}

describe("la voce «Selettore colore…» del Completo", () => {
  it("1. un oggetto scelto: OK con un colore nuovo cambia il riempimento, in un solo passo di cronologia", async () => {
    const { c, comando, commit } = completo(["oa1a1a1a1"], ROSSO_E_BLU);
    (await voceSelettore(c)).run();
    expect(dialogo()!.textContent).toContain(t("draw.colorPicker.title"));
    // Parte dal riempimento, che qui è rosso, e non dal contorno.
    expect(campoCodice().value).toBe("#ff0000");
    scegli("#00ff00");
    azione("ok").click();
    expect(await arrivati(comando, 1)).toEqual([["disegno.paint.setFill", { color: "#00ff00" }, ["oa1a1a1a1"]]]);
    // Un solo passo, col nome che il pozzo dà al riempimento.
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]![1]).toBe(t("draw.properties.fill"));
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    c.chiudi();
  });

  it("1b. la voce sta nel menu ≡ in Modifica › Colori, e nella ricerca", async () => {
    const { c } = completo(["oa1a1a1a1"], ROSSO_E_BLU);
    const menu = await c.menu(() => ["oa1a1a1a1"], { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() });
    const sottomenu = nodi(menu, t("draw.completo.sotto.colori"));
    const trovate = sottomenu.flatMap((nodo) => (Array.isArray(nodo.items) ? (nodo.items as readonly MenuItem[]) : []));
    const voce = trovate.find((una) => una.label === ETICHETTA);
    expect(voce, "la voce nel sottomenu Colori").toBeDefined();
    expect(voce!.disabled).not.toBe(true);
    expect((await voceSelettore(c)).path).toContain(t("draw.completo.sotto.colori"));
    c.chiudi();
  });

  it("2. più oggetti con colori diversi: parte senza colore, come il pozzo, e OK li colora tutti", async () => {
    const { c, comando, commit } = completo(["oa1a1a1a1", "oa2a2a2a2"], { riempimento: { valore: null } });
    (await voceSelettore(c)).run();
    expect(campoCodice().value).toBe("");
    // La nota dice perché non c'è un colore di partenza.
    expect(dialogo()!.textContent).toContain(t("draw.colorPicker.misto"));
    // OK senza aver scelto niente non manda nulla.
    azione("ok").click();
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    await attesa();
    expect(comando).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    // Scelto un colore, OK lo manda a tutti gli oggetti della selezione.
    (await voceSelettore(c)).run();
    scegli("#0000ff");
    azione("ok").click();
    expect(await arrivati(comando, 1)).toEqual([["disegno.paint.setFill", { color: "#0000ff" }, ["oa1a1a1a1", "oa2a2a2a2"]]]);
    expect(commit).toHaveBeenCalledTimes(1);
    c.chiudi();
  });

  it("3. Annulla e Esc: niente cambia, nessun comando e nessun passo", async () => {
    const { c, comando, commit } = completo(["oa1a1a1a1"], ROSSO_E_BLU);
    (await voceSelettore(c)).run();
    scegli("#00ff00");
    azione("cancel").click();
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    (await voceSelettore(c)).run();
    scegli("#00ff00");
    dialogo()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    await attesa();
    expect(comando).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("4. niente di scelto: la voce è spenta, con la frase del pozzo, e non apre niente", async () => {
    const { c, comando } = completo([], ROSSO_E_BLU);
    const voce = await voceSelettore(c);
    // Il pozzo del riempimento è spento senza selezione: la voce segue, spenta, con la sua frase.
    expect(voce.disabled).toBe(true);
    expect(voce.description).toBe(t("draw.colore.vuota", { lato: t("draw.properties.fill") }));
    voce.run();
    expect(dialogo()).toBeNull();
    expect(comando).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("4b. il lato attivo che la selezione non ha: la voce è spenta, con la frase del pozzo", async () => {
    // Un oggetto senza riempimento: il pozzo del riempimento dice «la selezione non ne ha».
    const { c } = completo(["oa1a1a1a1"], { contorno: { valore: "#0000ff" } });
    const voce = await voceSelettore(c);
    expect(voce.disabled).toBe(true);
    expect(voce.description).toBe(t("draw.colore.manca", { lato: t("draw.properties.fill") }));
    c.chiudi();
  });

  it("5. contorno attivo: il selettore parte dal contorno e cambia solo il contorno", async () => {
    const { c, corpo, comando } = completo(["oa1a1a1a1"], ROSSO_E_BLU);
    // Il pozzo del contorno lo fa attivo: un comando solo. Un secondo clic chiude il suo selettore.
    const pozzoContorno = corpo.querySelectorAll<HTMLButtonElement>(".kit-color-well-button")[1]!;
    pozzoContorno.click();
    pozzoContorno.click();
    expect(await arrivati(comando, 1)).toEqual([["disegno.paint.toggleActive", { fill: false }, ["oa1a1a1a1"]]]);
    (await voceSelettore(c)).run();
    expect(dialogo()!.textContent).toContain(t("draw.properties.stroke"));
    expect(campoCodice().value).toBe("#0000ff");
    scegli("#00ff00");
    azione("ok").click();
    const mandati = await arrivati(comando, 2);
    expect(mandati[1]).toEqual(["disegno.paint.setStroke", { color: "#00ff00" }, ["oa1a1a1a1"]]);
    expect(mandati.some(([id]) => id === "disegno.paint.setFill")).toBe(false);
    c.chiudi();
  });

  it("6. un livello bloccato: il rifiuto dice il perché in italiano, il colore non cambia, e la finestra resta aperta", async () => {
    const { c, comando, commit } = completo(["oa1a1a1a1"], ROSSO_E_BLU, {
      risposta: (passo) => (passo.id === "disegno.paint.setFill" ? esito({ refused: "locked", ops: null }) : esito()),
    });
    (await voceSelettore(c)).run();
    scegli("#00ff00");
    azione("ok").click();
    await arrivati(comando, 1);
    await vi.waitFor(() => expect(dialogo()!.textContent).toContain(t("draw.reason.lockedSelection")));
    expect(dialogo()).not.toBeNull();
    expect(commit).not.toHaveBeenCalled();
    c.chiudi();
  });

  it("7. doppio clic sulla voce: una sola finestra, e dopo la chiusura se ne apre una", async () => {
    const { c } = completo(["oa1a1a1a1"], ROSSO_E_BLU);
    const voce = await voceSelettore(c);
    voce.run();
    voce.run();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    azione("cancel").click();
    await vi.waitFor(() => expect(dialogo()).toBeNull());
    voce.run();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    c.chiudi();
  });

  it("8. chiudere il Completo con il selettore aperto: nessun ascoltatore della finestra resta", async () => {
    const tracciati = tracciaAscoltatori();
    try {
      const { c } = completo(["oa1a1a1a1"], ROSSO_E_BLU);
      const voce = await voceSelettore(c);
      const prima = tracciati.vivi.length;
      voce.run();
      const della = tracciati.vivi.slice(prima);
      expect(della.length).toBeGreaterThan(0);
      c.chiudi();
      await vi.waitFor(() => expect(dialogo()).toBeNull());
      expect(tracciati.vivi.filter((ascolto) => della.includes(ascolto))).toEqual([]);
    } finally {
      tracciati.ferma();
    }
  });

  it("8b. chiudere il disegno con il selettore aperto: la finestra si chiude con i suoi ascolti", async () => {
    const tracciati = tracciaAscoltatori();
    try {
      const life = vita();
      const { c } = completo(["oa1a1a1a1"], ROSSO_E_BLU, { life });
      const voce = await voceSelettore(c);
      const prima = tracciati.vivi.length;
      voce.run();
      const della = tracciati.vivi.slice(prima);
      expect(della.length).toBeGreaterThan(0);
      life.close();
      await vi.waitFor(() => expect(dialogo()).toBeNull());
      expect(tracciati.vivi.filter((ascolto) => della.includes(ascolto))).toEqual([]);
    } finally {
      tracciati.ferma();
    }
  });

  it("9. motore assente: nessun rifiuto non gestito, e la finestra dice che il disegno non ha risposto", async () => {
    const { c, comando } = completo(["oa1a1a1a1"], ROSSO_E_BLU, { senzaMotore: true });
    (await voceSelettore(c)).run();
    scegli("#00ff00");
    azione("ok").click();
    await vi.waitFor(() => expect(dialogo()!.textContent).toContain(t("draw.window.unanswered")));
    expect(dialogo()).not.toBeNull();
    expect(comando).not.toHaveBeenCalled();
    c.chiudi();
  });
});

describe("il colore di partenza del selettore", () => {
  it("è il colore pieno in minuscolo, `none`, o niente se è misto, una sfumatura o un motivo", () => {
    expect(partenzaDel({ valore: "#FF00AA" })).toBe("#ff00aa");
    expect(partenzaDel({ valore: "none" })).toBe("none");
    expect(partenzaDel({ valore: null })).toBeNull();
    expect(partenzaDel({ valore: "url(#g1)", campione: { kind: "gradient", image: null } })).toBeNull();
    expect(partenzaDel({ valore: "url(#m1)", campione: { kind: "motif", image: null, name: "Righe" } })).toBeNull();
    expect(partenzaDel({ valore: "url(#r1)", campione: { kind: "swatch", image: null, name: "Blu", color: "#0072B2" } })).toBe("#0072b2");
    expect(partenzaDel(undefined)).toBeNull();
  });
});

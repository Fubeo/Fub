// @vitest-environment happy-dom
// Elaborazione tracciati (K6 T12, giro 5): la prova del pannello `pathfinder` di
// `crates/fub-disegno/tests/famiglie/forme.json`. Le dieci voci `object.pathfinder.*`
// stanno in ≡ › Oggetto › Elaborazione tracciati, in due file (i metodi forma, poi le
// operazioni), e nella sezione «Elaborazione tracciati» del Design (`completo/elaborazione.ts`),
// che il Completo mette da sé, dall'indice, senza la famiglia: due barre di pulsanti con le
// figure `draw-pf-*`, spenti col perché sotto i due oggetti, il clic che manda la voce.
//
// Le forme composte (K6 T13): un metodo forma con Alt fa una forma composta, con una forma
// composta scelta ne cambia il metodo (e vale anche con lei sola); le quattro voci stanno nel
// sottomenu «Forma composta» di Elaborazione tracciati. È anche la prova di
// `pathfinder.repeat` (Ripeti Elaborazione tracciati), una voce del client: spenta col perché
// finché non c'è un'elaborazione andata, poi rifà l'ultima, in una sessione del Completo vera.

import { describe, expect, it, vi } from "vitest";
import { t } from "../../../strings";
import { openLifetime } from "../../../../../ui/lifetime";
import type { MenuItem } from "../../../../../ui/menu";
import type { MotoreDelDisegno } from "../../../motore/gesti";
import type { SessioneMotore } from "../../../motore/sessione";
import { creaSezioni } from "../../sezioni";
import { menuComando, nomeVoce, FORME_COMPOSTE, METODI_FORMA, OPERAZIONI_ELABORAZIONE } from "../../comandi";
import { registraElaborazione, sezioneElaborazione, voceDelMetodo, SEZIONE_ELABORAZIONE } from "../../elaborazione";
import { apri } from "../../index";
import { indiceDi, type VoceIndice } from "../../indice";
import indiceGenerato from "../../indice.generated.json";

const VOCI = (indiceGenerato as unknown as { readonly voci: readonly VoceIndice[] }).voci;
const ELABORAZIONE = VOCI.filter((voce) => voce.id.startsWith("object.pathfinder."));
const TUTTE = [...METODI_FORMA, ...OPERAZIONI_ELABORAZIONE];
const RIPETI = "pathfinder.repeat";

/// Un motore finto qualsiasi: la sezione chiede la forma composta solo se ce n'è uno.
const UN_MOTORE = {} as MotoreDelDisegno;

/// La sezione disegnata in un contenitore, con `numero` oggetti scelti e, se `composta`, una
/// forma composta fra loro (la risposta del motore).
function disegna(numero: number, composta = false) {
  const esegui = vi.fn();
  const corpo = document.createElement("div");
  document.body.append(corpo);
  const vita = openLifetime();
  const azioni = { esegui, composta: vi.fn(() => Promise.resolve(composta)) };
  sezioneElaborazione(azioni).disegna({ corpo, sel: { numero, punti: [] }, motore: UN_MOTORE, aggiorna: vi.fn(), rileggi: vi.fn(), vita } as never);
  const pulsante = (id: string): HTMLButtonElement => corpo.querySelector<HTMLButtonElement>(`button[data-id="${id}"]`)!;
  const barre = [...corpo.querySelectorAll<HTMLElement>("[role=toolbar]")];
  return { corpo, esegui, pulsante, barre, vita, azioni };
}

/// Lascia rispondere il motore finto (le promesse già risolte).
const giro = (): Promise<void> => new Promise((risolto) => setTimeout(risolto, 0));

function sottovoci(item: MenuItem | undefined): readonly MenuItem[] {
  if (item?.items === undefined || typeof item.items === "function") return [];
  return item.items;
}

describe("le voci dell'indice", () => {
  it("le dieci operazioni sono nell'indice, senza finestra, in ≡ › Oggetto › Elaborazione tracciati", () => {
    expect(ELABORAZIONE.map((voce) => voce.id).sort()).toEqual([...TUTTE].sort());
    for (const voce of ELABORAZIONE) {
      expect(voce.posto, voce.id).toBe("menu/oggetto/elaborazione");
      expect(voce.finestra, voce.id).toBe(false);
      expect(voce.famiglia, voce.id).toBe("tracciati");
      expect(voce.chiamata, voce.id).toEqual({ comando: `disegno.${voce.id}` });
    }
  });

  it("il pannello pathfinder è la sezione del Design, con il nome dell'indice", () => {
    const pannello = VOCI.find((voce) => voce.id === "pathfinder");
    expect(pannello?.posto).toBe(`ispettore/design/${SEZIONE_ELABORAZIONE}`);
    expect(t("draw.elaborazione.titolo")).toBe(nomeVoce(pannello!));
  });

  it("le parole dei pulsanti sono quelle delle voci dell'indice", () => {
    const { pulsante } = disegna(2);
    for (const voce of ELABORAZIONE) expect(pulsante(voce.id).getAttribute("aria-label"), voce.id).toBe(nomeVoce(voce));
  });
});

describe("il menu", () => {
  it("Oggetto › Elaborazione tracciati ha due file: i metodi forma, poi le operazioni", () => {
    const menu = menuComando(indiceDi({ voci: [...ELABORAZIONE] }), { per: null, assente: null }, vi.fn());
    const oggetto = menu.find((item) => item.label === t("draw.completo.gruppo.oggetto"));
    const sotto = sottovoci(oggetto).find((item) => item.label === t("draw.completo.sotto.elaborazione"));
    expect(sotto, "il sottomenu").toBeDefined();
    const nome = (id: string) => nomeVoce(ELABORAZIONE.find((voce) => voce.id === id)!);
    expect(sottovoci(sotto).map((r) => [r.label, r.separator === true])).toEqual(
      TUTTE.map((id) => [nome(id), id === OPERAZIONI_ELABORAZIONE[0]]),
    );
  });
});

describe("la sezione Elaborazione tracciati", () => {
  it("c'è nella scheda Design con l'id pathfinder, con un oggetto scelto o più, e nessun comando parte prima del clic", () => {
    const sezioni = creaSezioni();
    const esegui = vi.fn();
    expect(registraElaborazione(sezioni, { esegui, composta: () => Promise.resolve(false) })).toBe(true);
    const [sezione] = sezioni.di("design");
    expect(sezione?.id).toBe("pathfinder");
    expect(sezione?.titolo).toBe(t("draw.elaborazione.titolo"));
    expect(sezione?.quando?.({ numero: 0, punti: [] })).toBe(false);
    expect(sezione?.quando?.({ numero: 1, punti: [] })).toBe(true);
    expect(esegui).not.toHaveBeenCalled();
  });

  it("due barre: i quattro metodi forma e le sei operazioni, con le figure di Fub", () => {
    const { barre } = disegna(2);
    expect(barre).toHaveLength(2);
    const ids = barre.map((barra) => [...barra.querySelectorAll<HTMLButtonElement>("button")].map((el) => el.dataset.id));
    expect(ids).toEqual([METODI_FORMA, OPERAZIONI_ELABORAZIONE]);
    for (const barra of barre) {
      const nome = document.getElementById(barra.getAttribute("aria-labelledby")!);
      expect(nome?.textContent).not.toBe("");
      for (const el of barra.querySelectorAll("button")) expect(el.querySelector("svg"), el.dataset.id).not.toBeNull();
    }
    expect(barre.map((barra) => document.getElementById(barra.getAttribute("aria-labelledby")!)?.textContent)).toEqual([
      t("draw.elaborazione.metodi"),
      t("draw.elaborazione.operazioni"),
    ]);
  });

  it("con un oggetto solo i pulsanti sono spenti, raggiungibili, e dicono perché", () => {
    const { corpo, pulsante, esegui } = disegna(1);
    const nota = corpo.querySelector<HTMLElement>(".draw-properties-note")!;
    expect(nota.hidden).toBe(false);
    expect(nota.textContent).toBe(t("draw.disabled.needs_two"));
    for (const id of TUTTE) {
      const el = pulsante(id);
      expect(el.getAttribute("aria-disabled"), id).toBe("true");
      expect(el.disabled, id).toBe(false);
      expect(el.title, id).toContain(t("draw.disabled.needs_two"));
      expect(el.getAttribute("aria-describedby"), id).toBe(nota.id);
      el.click();
    }
    expect(esegui).not.toHaveBeenCalled();
  });

  it("con due oggetti i pulsanti sono accesi e il clic manda la voce", async () => {
    const { corpo, pulsante, esegui } = disegna(2);
    expect(corpo.querySelector<HTMLElement>(".draw-properties-note")!.hidden).toBe(true);
    expect(corpo.querySelectorAll("[aria-disabled]")).toHaveLength(0);
    pulsante("object.pathfinder.unite").click();
    pulsante("object.pathfinder.minusBack").click();
    await giro();
    expect(esegui.mock.calls).toEqual([
      ["object.pathfinder.unite", {}],
      ["object.pathfinder.minusBack", {}],
    ]);
  });

  it("chiusa la vita della sezione, il clic non manda niente", async () => {
    const { pulsante, esegui, vita } = disegna(2);
    vita.close();
    pulsante("object.pathfinder.unite").click();
    await giro();
    expect(esegui).not.toHaveBeenCalled();
  });

  it("senza motore la sezione non chiede la forma composta", () => {
    const azioni = { esegui: vi.fn(), composta: vi.fn(() => Promise.resolve(true)) };
    const corpo = document.createElement("div");
    sezioneElaborazione(azioni).disegna({ corpo, sel: { numero: 2, punti: [] }, motore: null, vita: openLifetime() } as never);
    expect(azioni.composta).not.toHaveBeenCalled();
  });

  it("Tab prende un pulsante per barra, le frecce si muovono dentro la barra", () => {
    const { barre, pulsante } = disegna(2);
    const primo = pulsante("object.pathfinder.unite");
    expect(barre.map((barra) => [...barra.querySelectorAll<HTMLButtonElement>("button")].filter((el) => el.tabIndex === 0).length)).toEqual([1, 1]);
    primo.focus();
    primo.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(document.activeElement).toBe(pulsante("object.pathfinder.exclude"));
    pulsante("object.pathfinder.exclude").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(primo);
    expect(primo.tabIndex).toBe(0);
  });
});

describe("le forme composte", () => {
  it("un metodo forma con Alt fa una forma composta nel suo metodo, con una composta scelta ne cambia il metodo", () => {
    expect(voceDelMetodo("object.pathfinder.minusFront", true, false)).toEqual({ id: "object.compoundShape.make", valori: { mode: "subtract" } });
    expect(voceDelMetodo("object.pathfinder.minusFront", true, true)).toEqual({ id: "object.compoundShape.make", valori: { mode: "subtract" } });
    expect(voceDelMetodo("object.pathfinder.intersect", false, true)).toEqual({ id: "object.compoundShape.setMode", valori: { mode: "intersect" } });
    expect(voceDelMetodo("object.pathfinder.unite", false, false)).toEqual({ id: "object.pathfinder.unite", valori: {} });
    // Le operazioni non fanno forme composte, con Alt o senza.
    expect(voceDelMetodo("object.pathfinder.divide", true, true)).toEqual({ id: "object.pathfinder.divide", valori: {} });
    const metodi = METODI_FORMA.map((id) => voceDelMetodo(id, true, false).valori["mode"]);
    expect(metodi).toEqual(["add", "subtract", "intersect", "exclude"]);
  });

  it("Alt+clic su Meno davanti manda Crea forma composta; il titolo lo dice", async () => {
    const { pulsante, esegui } = disegna(2);
    await giro();
    const meno = pulsante("object.pathfinder.minusFront");
    expect(meno.title).toBe(t("draw.elaborazione.conAlt", { nome: t("draw.elaborazione.minusFront") }));
    meno.dispatchEvent(new MouseEvent("click", { altKey: true, bubbles: true }));
    meno.click();
    await giro();
    expect(esegui.mock.calls).toEqual([
      ["object.compoundShape.make", { mode: "subtract" }],
      ["object.pathfinder.minusFront", {}],
    ]);
  });

  it("con una forma composta sola i metodi forma sono accesi e ne cambiano il metodo; le operazioni restano spente", async () => {
    const { pulsante, esegui, corpo, azioni } = disegna(1, true);
    expect(azioni.composta).toHaveBeenCalledTimes(1);
    await giro();
    for (const id of METODI_FORMA) {
      expect(pulsante(id).hasAttribute("aria-disabled"), id).toBe(false);
      expect(pulsante(id).title, id).toContain(t("draw.elaborazione.metodoComposta", { nome: "" }).trim());
    }
    for (const id of OPERAZIONI_ELABORAZIONE) expect(pulsante(id).getAttribute("aria-disabled"), id).toBe("true");
    expect(corpo.querySelector<HTMLElement>(".draw-properties-note")!.hidden).toBe(false);
    pulsante("object.pathfinder.intersect").click();
    pulsante("object.pathfinder.divide").click();
    await giro();
    expect(esegui.mock.calls).toEqual([["object.compoundShape.setMode", { mode: "intersect" }]]);
  });

  it("con un oggetto solo che non è una forma composta i metodi forma restano spenti", async () => {
    const { pulsante, esegui } = disegna(1, false);
    await giro();
    for (const id of TUTTE) expect(pulsante(id).getAttribute("aria-disabled"), id).toBe("true");
    pulsante("object.pathfinder.unite").click();
    await giro();
    expect(esegui).not.toHaveBeenCalled();
  });

  it("le quattro voci sono in ≡ › Oggetto › Elaborazione tracciati › Forma composta; Ripeti viene dopo", () => {
    const ids = [...TUTTE, ...FORME_COMPOSTE, RIPETI];
    const voci = VOCI.filter((voce) => ids.includes(voce.id));
    expect(voci.map((voce) => voce.id).sort()).toEqual([...ids].sort());
    for (const voce of voci) expect(voce.posto, voce.id).toBe("menu/oggetto/elaborazione");
    const menu = menuComando(indiceDi({ voci }), { per: null, assente: null, clientVoce: () => null }, vi.fn());
    const oggetto = menu.find((item) => item.label === t("draw.completo.gruppo.oggetto"));
    const sotto = sottovoci(sottovoci(oggetto).find((item) => item.label === t("draw.completo.sotto.elaborazione")));
    const nome = (id: string) => nomeVoce(voci.find((voce) => voce.id === id)!);
    expect(sotto.map((r) => r.label)).toEqual([...TUTTE.map(nome), t("draw.completo.sotto.formaComposta"), nome(RIPETI)]);
    expect(sotto.map((r) => r.separator === true)).toEqual([...TUTTE.map((id) => id === OPERAZIONI_ELABORAZIONE[0]), true, true]);
    const composta = sotto.find((r) => r.label === t("draw.completo.sotto.formaComposta"));
    expect(sottovoci(composta).map((r) => r.label)).toEqual(FORME_COMPOSTE.map(nome));
  });

  it("Metodo forma dal menu chiede il metodo nella sua finestra; le altre tre partono senza", () => {
    const per = (id: string) => VOCI.find((voce) => voce.id === id)!;
    expect(per("object.compoundShape.setMode").finestra).toBe(true);
    for (const id of ["object.compoundShape.make", "object.compoundShape.release", "object.compoundShape.expand", "object.expandShape"]) {
      expect(per(id).finestra, id).toBe(false);
    }
    expect(per("object.expandShape").posto).toBe("menu/oggetto");
  });
});

/// Il Completo vero, col motore finto che dice sì a ogni comando (nessuna operazione) e la
/// famiglia `tracciati` pronta.
function completoVero() {
  const esito = { revision: "1", preview: null, ops: "[]", selection: ["k1", "k2"], losses: [], refused: null, frame: null };
  const comando = vi.fn((_passo: { readonly id: string }) => Promise.resolve(esito));
  const sessione = { comandi: vi.fn(() => Promise.resolve([])), comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  const annuncia = vi.fn();
  const completo = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: () => Promise.resolve("pronta"),
      moduli: {
        "./famiglie/tracciati/index.ts": () => Promise.resolve({ default: { registra: () => undefined } }),
        "./famiglie/forme/index.ts": () => Promise.resolve({ default: { registra: () => undefined } }),
      },
      tasti: { selezione: () => ["k1", "k2"], annuncia, leggi: () => [], commit: () => true, seleziona: () => undefined } as never,
    } as never,
  );
  const ripeti = async () => (await completo.ricerca(() => ["k1", "k2"], { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() } as never))!.find((v) => v.key === RIPETI)!;
  const sezione = completo.sezioni.di("design").find((una) => una.id === SEZIONE_ELABORAZIONE)!;
  return { completo, comando, ripeti, sezione, motore, annuncia };
}

describe("Ripeti Elaborazione tracciati", () => {
  it("è spenta col perché finché non c'è un'elaborazione andata, poi rifà l'ultima", async () => {
    const { completo, comando, ripeti, sezione, motore } = completoVero();
    const prima = await ripeti();
    expect(prima.disabled).toBe(true);
    expect(prima.description).toBe(t("draw.disabled.nothing_to_repeat"));
    prima.run();
    await giro();
    expect(comando).not.toHaveBeenCalled();

    // Meno davanti dalla sezione, senza forme composte: l'elaborazione va, e Ripeti la rifà.
    const corpo = document.createElement("div");
    sezione.disegna({ corpo, sel: { numero: 2, punti: [] }, motore, aggiorna: () => undefined, vita: openLifetime() } as never);
    corpo.querySelector<HTMLButtonElement>('button[data-id="object.pathfinder.minusFront"]')!.click();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    expect(comando.mock.calls[0]![0].id).toBe("disegno.object.pathfinder.minusFront");
    await vi.waitFor(async () => expect((await ripeti()).disabled).toBe(false));
    (await ripeti()).run();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(2));
    expect(comando.mock.calls[1]![0].id).toBe("disegno.object.pathfinder.minusFront");

    // Una forma composta (Alt) non è un'elaborazione da ripetere.
    corpo.querySelector<HTMLButtonElement>('button[data-id="object.pathfinder.intersect"]')!.dispatchEvent(
      new MouseEvent("click", { altKey: true, bubbles: true }),
    );
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(3));
    expect(comando.mock.calls[2]![0]).toMatchObject({ id: "disegno.object.compoundShape.make", value: { mode: "intersect" } });
    (await ripeti()).run();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(4));
    expect(comando.mock.calls[3]![0].id).toBe("disegno.object.pathfinder.minusFront");
    completo.chiudi();
  });

  it("un'elaborazione rifiutata non si ricorda", async () => {
    const { completo, comando, ripeti, sezione, motore } = completoVero();
    comando.mockImplementation(() =>
      Promise.resolve({ revision: "1", preview: null, ops: null, selection: ["k1", "k2"], losses: [], refused: "empty", frame: null } as never),
    );
    const corpo = document.createElement("div");
    sezione.disegna({ corpo, sel: { numero: 2, punti: [] }, motore, aggiorna: () => undefined, vita: openLifetime() } as never);
    corpo.querySelector<HTMLButtonElement>('button[data-id="object.pathfinder.unite"]')!.click();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    await giro();
    expect((await ripeti()).disabled).toBe(true);
    completo.chiudi();
  });
});

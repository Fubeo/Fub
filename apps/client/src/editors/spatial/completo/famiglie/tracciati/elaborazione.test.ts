// @vitest-environment happy-dom
// Elaborazione tracciati (K6 T12, giro 5): la prova del pannello `pathfinder` di
// `crates/fub-disegno/tests/famiglie/forme.json`. Le dieci voci `object.pathfinder.*`
// stanno in ≡ › Oggetto › Elaborazione tracciati, in due file (i metodi forma, poi le
// operazioni), e nella sezione «Elaborazione tracciati» del Design (`completo/elaborazione.ts`),
// che il Completo mette da sé, dall'indice, senza la famiglia: due barre di pulsanti con le
// figure `draw-pf-*`, spenti col perché sotto i due oggetti, il clic che manda la voce.

import { describe, expect, it, vi } from "vitest";
import { t } from "../../../strings";
import { openLifetime } from "../../../../../ui/lifetime";
import type { MenuItem } from "../../../../../ui/menu";
import { creaSezioni } from "../../sezioni";
import { menuComando, nomeVoce, METODI_FORMA, OPERAZIONI_ELABORAZIONE } from "../../comandi";
import { registraElaborazione, sezioneElaborazione, SEZIONE_ELABORAZIONE } from "../../elaborazione";
import { indiceDi, type VoceIndice } from "../../indice";
import indiceGenerato from "../../indice.generated.json";

const VOCI = (indiceGenerato as unknown as { readonly voci: readonly VoceIndice[] }).voci;
const ELABORAZIONE = VOCI.filter((voce) => voce.id.startsWith("object.pathfinder."));
const TUTTE = [...METODI_FORMA, ...OPERAZIONI_ELABORAZIONE];

/// La sezione disegnata in un contenitore, con `numero` oggetti scelti.
function disegna(numero: number) {
  const esegui = vi.fn();
  const corpo = document.createElement("div");
  document.body.append(corpo);
  const vita = openLifetime();
  sezioneElaborazione(esegui).disegna({ corpo, sel: { numero, punti: [] }, motore: null, aggiorna: vi.fn(), rileggi: vi.fn(), vita } as never);
  const pulsante = (id: string): HTMLButtonElement => corpo.querySelector<HTMLButtonElement>(`button[data-id="${id}"]`)!;
  const barre = [...corpo.querySelectorAll<HTMLElement>("[role=toolbar]")];
  return { corpo, esegui, pulsante, barre, vita };
}

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
    expect(registraElaborazione(sezioni, esegui)).toBe(true);
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

  it("con due oggetti i pulsanti sono accesi e il clic manda la voce", () => {
    const { corpo, pulsante, esegui } = disegna(2);
    expect(corpo.querySelector<HTMLElement>(".draw-properties-note")!.hidden).toBe(true);
    expect(corpo.querySelectorAll("[aria-disabled]")).toHaveLength(0);
    pulsante("object.pathfinder.unite").click();
    pulsante("object.pathfinder.minusBack").click();
    expect(esegui.mock.calls).toEqual([["object.pathfinder.unite"], ["object.pathfinder.minusBack"]]);
  });

  it("chiusa la vita della sezione, il clic non manda niente", () => {
    const { pulsante, esegui, vita } = disegna(2);
    vita.close();
    pulsante("object.pathfinder.unite").click();
    expect(esegui).not.toHaveBeenCalled();
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

// @vitest-environment happy-dom
// La sezione «Allinea» in una sessione del Completo vera (piano K6, T13, giro 2): `apri`
// registra la sezione dall'indice senza caricare né preparare la famiglia `trasforma`.
// Il primo clic di un suo pulsante porta la famiglia (chunk e preparazione) e poi manda
// il comando al motore col suo `to`. Come le altre prove del percorso, passa da `apri`.
// Il nucleo si prepara all'apertura, come sempre: la prova guarda solo `trasforma`.
import { describe, expect, it, vi } from "vitest";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { openLifetime } from "../../../ui/lifetime";
import { t } from "../strings";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

const ESITO = { revision: "1", preview: null, ops: "[]", selection: ["k1", "k2"], losses: [], refused: null, frame: null };

/// Il motore con la sessione che conta i comandi: `comando` riceve `{ id, selection, value }`.
function motoreFinto() {
  const comando = vi.fn((_passo: unknown) => Promise.resolve(ESITO));
  const sessione = { comandi: vi.fn(() => Promise.resolve([])), comando } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comando };
}

/// Il Completo con l'indice vero, la famiglia `trasforma` spia e la preparazione data.
function completoCon(motore: MotoreDelDisegno, preparazione: (famiglia: string) => Promise<unknown>, annuncia = vi.fn()) {
  const caricati: string[] = [];
  const preparati: string[] = [];
  const completo = apri(
    { motore, life: openLifetime() } as never,
    {
      indice: () => Promise.resolve(indiceDi(indiceGenerato as never)),
      prepara: (famiglia: string) => {
        preparati.push(famiglia);
        return preparazione(famiglia);
      },
      moduli: {
        "./famiglie/trasforma/index.ts": () => {
          caricati.push("trasforma");
          return Promise.resolve({ default: { registra: () => undefined } });
        },
      },
      tasti: { selezione: () => ["k1", "k2"], annuncia } as never,
    } as never,
  );
  const sezione = completo.sezioni.di("design").find((una) => una.id === "allinea")!;
  return { completo, sezione, caricati, preparati, annuncia };
}

/// La sezione disegnata in un corpo nuovo, con `numero` oggetti scelti.
function disegnaIn(sezione: ReturnType<typeof completoCon>["sezione"], motore: MotoreDelDisegno, numero: number): HTMLElement {
  const corpo = document.createElement("div");
  sezione.disegna!({ corpo, sel: { numero }, motore, aggiorna: () => undefined, vita: openLifetime() } as never);
  return corpo;
}

describe("la sezione Allinea in una sessione nuova", () => {
  it("trasforma non si carica né si prepara prima del clic; il clic la porta e manda il comando", async () => {
    const { motore, comando } = motoreFinto();
    const { sezione, caricati, preparati, completo } = completoCon(motore, () => Promise.resolve("pronta"));

    // La sezione c'è nella scheda Design, e disegnarla con due oggetti non porta la famiglia.
    expect(sezione).toBeDefined();
    const corpo = disegnaIn(sezione, motore, 2);
    expect(corpo.querySelectorAll("button[data-id]")).toHaveLength(15);
    await new Promise((risolto) => setTimeout(risolto, 0));
    expect(caricati).toEqual([]);
    expect(preparati).not.toContain("trasforma");

    // Il primo clic: la famiglia si porta, poi il comando parte col suo `to`.
    corpo.querySelector<HTMLButtonElement>('button[data-id="align.horizontalLeft"]')!.click();
    await vi.waitFor(() => expect(comando).toHaveBeenCalledTimes(1));
    expect(caricati).toEqual(["trasforma"]);
    expect(preparati).toContain("trasforma");
    expect(comando.mock.calls[0]?.[0]).toMatchObject({ id: "disegno.object.align", value: { to: "selection" } });
    completo.chiudi();
  });

  it("se trasforma non si prepara, il clic lo dice e non manda nessun comando", async () => {
    const { motore, comando } = motoreFinto();
    const { sezione, completo, annuncia } = completoCon(motore, (famiglia) =>
      Promise.resolve(famiglia === "trasforma" ? { errore: "motore" } : "pronta"),
    );
    const corpo = disegnaIn(sezione, motore, 2);
    corpo.querySelector<HTMLButtonElement>('button[data-id="align.horizontalLeft"]')!.click();
    await vi.waitFor(() => expect(annuncia).toHaveBeenCalledWith(t("draw.allinea.nonPronto")));
    expect(comando).not.toHaveBeenCalled();
    completo.chiudi();
  });

  it("la scelta «alla tavola» resta quando la sezione si rifà con un'altra selezione", () => {
    const { motore } = motoreFinto();
    const { sezione, completo } = completoCon(motore, () => Promise.resolve("pronta"));
    disegnaIn(sezione, motore, 2).querySelectorAll<HTMLButtonElement>(".draw-align-to button")[1]!.click();
    const rifatta = disegnaIn(sezione, motore, 1);
    const modi = rifatta.querySelectorAll<HTMLButtonElement>(".draw-align-to button");
    expect(modi[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(modi[1]!.getAttribute("aria-pressed")).toBe("true");
    // Con un oggetto solo, alla tavola, allineare è acceso; distribuire no.
    expect(rifatta.querySelector<HTMLButtonElement>('button[data-id="align.horizontalLeft"]')!.disabled).toBe(false);
    expect(rifatta.querySelector<HTMLButtonElement>('button[data-id="align.distributeHorizontalLeft"]')!.disabled).toBe(true);
    completo.chiudi();
  });
});

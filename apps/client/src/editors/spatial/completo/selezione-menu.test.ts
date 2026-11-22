// @vitest-environment happy-dom
// Il menu ≡ › Selezione del Disegno completo (K6 T15, giro 1): Uguale e Oggetto sono sottomenu con le
// loro voci dall'indice; una voce che non vale per ciò che è scelto è spenta col suo perché, e una che
// vale resta accesa. Il percorso è quello vero: `menu()` del Completo, con lo stato del motore.
import { describe, expect, it, vi } from "vitest";
import type { MenuItem } from "../../../ui/menu";
import { openLifetime } from "../../../ui/lifetime";
import type { MotoreDelDisegno } from "../motore/gesti";
import type { SessioneMotore } from "../motore/sessione";
import { t } from "../strings";
import { apri } from "./index";
import { indiceDi } from "./indice";
import indiceGenerato from "./indice.generated.json";

/// Il motore: i comandi della selezione stanno accesi solo con qualcosa di scelto.
function motoreFinto() {
  const comandi = vi.fn((selezione: readonly string[]) =>
    Promise.resolve(
      ["disegno.select.same.fillColor", "disegno.select.same.opacity", "disegno.select.object.allOnSameLayers"].map((id) =>
        selezione.length === 0 ? { id, enabled: false, disabled_reason: "no_selection" } : { id, enabled: true, disabled_reason: null },
      ),
    ),
  );
  const sessione = { comandi, comando: vi.fn() } as unknown as SessioneMotore;
  const motore = { adesso: () => sessione, pronta: () => Promise.resolve(sessione), assente: () => null } as unknown as MotoreDelDisegno;
  return { motore, comandi };
}

/// La voce del menu con questa etichetta, cercata anche dentro i sottomenu.
function trova(voci: readonly MenuItem[], etichetta: string): MenuItem | undefined {
  for (const voce of voci) {
    if (voce.label === etichetta) return voce;
    const dentro = Array.isArray(voce.items) ? trova(voce.items, etichetta) : undefined;
    if (dentro !== undefined) return dentro;
  }
  return undefined;
}

/// I figli di una voce di menu, se è un sottomenu (il tipo di `items` è quello di un menu a funzione).
function figli(voce: MenuItem | undefined): readonly MenuItem[] {
  return voce !== undefined && Array.isArray(voce.items) ? (voce.items as readonly MenuItem[]) : [];
}

const AZIONI = { strumento: vi.fn(), client: vi.fn(), riprova: vi.fn() };

describe("il menu ≡ › Selezione", () => {
  it("Uguale ha le sue voci, e Oggetto è un sottomenu di Selezione", async () => {
    const { motore } = motoreFinto();
    const c = apri({ motore, life: openLifetime() } as never, { indice: () => Promise.resolve(indiceDi(indiceGenerato as never)) } as never);
    const voci = await c.menu(() => [], AZIONI);
    const selezione = voci.find((voce) => Array.isArray(voce.items) && voce.items.some((dentro) => dentro.label === "Uguale"));
    expect(selezione, "il menu Selezione").toBeDefined();
    const uguale = trova(selezione!.items as MenuItem[], "Uguale");
    expect(figli(uguale).map((voce) => voce.label)).toEqual(expect.arrayContaining(["Colore riempimento", "Opacità", "Istanza di simbolo"]));
    expect((selezione!.items as MenuItem[]).some((voce) => voce.label === "Oggetto" && Array.isArray(voce.items))).toBe(true);
    c.chiudi();
  });

  it("con niente di scelto le voci Uguale sono spente; con un oggetto scelto restano accese", async () => {
    const { motore } = motoreFinto();
    const c = apri({ motore, life: openLifetime() } as never, { indice: () => Promise.resolve(indiceDi(indiceGenerato as never)) } as never);
    const spente = trova(await c.menu(() => [], AZIONI), "Colore riempimento");
    expect(spente?.disabled).toBe(true);
    expect(spente?.description).toBe(t("draw.disabled.no_selection"));
    const accese = trova(await c.menu(() => ["oa1a1a1a1"], AZIONI), "Colore riempimento");
    expect(accese?.disabled).toBeFalsy();
    c.chiudi();
  });
});

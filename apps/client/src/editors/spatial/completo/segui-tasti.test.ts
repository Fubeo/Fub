// Il Completo segue `draw.keys` (K6 T9c): un tasto cambiato in Impostazioni ›
// Scorciatoie vale subito nel disegno aperto, senza riaprirlo; una lettura
// vecchia non sovrascrive la nuova; chiuso il disegno, non ascolta più.

import { afterEach, describe, expect, it, vi } from "vitest";
import { openLifetime } from "../../../ui/lifetime";
import { seguiTastiUtente } from "./segui-tasti";

const stato = vi.hoisted(() => ({
  letture: [] as Array<(valore: unknown) => void>,
  ascolti: new Set<(event: { key: string }) => void>(),
}));

vi.mock("../../../host/query", () => ({
  settings: (plugin?: string) => {
    expect(plugin).toBe("fub.draw");
    return new Promise((risolvi) => {
      stato.letture.push((valore) => risolvi([{ spec: { key: "draw.keys" }, value: valore, source: "machine" }]));
    });
  },
}));

vi.mock("../../../state/kernel", () => ({
  onEvent: (_tipo: string, ascolto: (event: { key: string }) => void) => {
    stato.ascolti.add(ascolto);
    return () => stato.ascolti.delete(ascolto);
  },
}));

const emetti = (key: string) => {
  for (const ascolto of stato.ascolti) ascolto({ key });
};
const valore = (tasti: Record<string, string | null>) => JSON.stringify({ v: 1, insieme: null, tasti });

afterEach(() => {
  stato.letture.length = 0;
  stato.ascolti.clear();
});

describe("i tasti dell'utente nel Completo aperto", () => {
  it("si leggono all'apertura e a ogni cambio della chiave", async () => {
    const vita = openLifetime();
    const cambiate = vi.fn();
    const modifiche = seguiTastiUtente(vita, cambiate);
    expect(modifiche()).toEqual({});
    stato.letture.shift()!(valore({ "shape.round": "Mod-j" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(modifiche()).toEqual({ "shape.round": "Mod-j" });
    expect(cambiate).toHaveBeenCalledTimes(1);

    emetti("draw.toolbar");
    expect(stato.letture).toHaveLength(0);
    emetti("draw.keys");
    stato.letture.shift()!(valore({ "shape.round": "Mod-l" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(modifiche()).toEqual({ "shape.round": "Mod-l" });
    expect(cambiate).toHaveBeenCalledTimes(2);
    vita.close();
    expect(stato.ascolti.size).toBe(0);
  });

  it("una lettura vecchia non vince su una nuova, e un valore rotto vale vuoto", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const vita = openLifetime();
    const modifiche = seguiTastiUtente(vita, () => undefined);
    emetti("draw.keys");
    const [vecchia, nuova] = stato.letture;
    nuova!(valore({ a: "Mod-j" }));
    await Promise.resolve();
    await Promise.resolve();
    vecchia!(valore({ a: "Mod-x" }));
    await Promise.resolve();
    await Promise.resolve();
    expect(modifiche()).toEqual({ a: "Mod-j" });
    emetti("draw.keys");
    stato.letture[2]!("{rotto");
    await Promise.resolve();
    await Promise.resolve();
    expect(modifiche()).toEqual({});
    vita.close();
  });
});

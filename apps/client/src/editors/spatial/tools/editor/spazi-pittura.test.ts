import { describe, expect, it, vi } from "vitest";
import type { EditorContext } from "./context";
import { installSpaziPittura, spaziDellaLettura } from "./spazi-pittura";

const lettura = (color: string) => ({ gapOptions: { detect: true, size: "small", color }, gaps: [[[0, 0], [3, 0]], [[5, 5], [5, 8]]] });

/// Un editor finto con la griglia, la scelta e un motore che risponde a `livePaint.info`.
function fingi(risposta: (id: string) => unknown) {
  const comando = vi.fn(async (r: { id: string; selection: string[] }) => ({ reading: risposta(r.selection[0]!) }));
  const ctx = {
    grid: { shown: false, snap: false, livePaintGaps: true } as Record<string, unknown>,
    selection: ["g1"],
    engine: {},
    owner: { closed: false },
    showHandles: vi.fn(),
    options: { motore: { pronta: async () => ({ comando }) } },
  } as unknown as EditorContext & { spaziPitturaHandles: () => unknown[] };
  installSpaziPittura(ctx);
  return { ctx, comando };
}

const attendi = () => new Promise((r) => setTimeout(r, 0));

describe("view.livePaintGaps: Visualizza › Mostra spazi vuoti pittura dinamica", () => {
  it("una lettura diventa un segno per spazio, nel colore del gruppo; un colore strano torna rosso", () => {
    expect(spaziDellaLettura(lettura("#00ff00"))).toEqual([
      { kind: "gap", from: [0, 0], to: [3, 0], color: "#00ff00" },
      { kind: "gap", from: [5, 5], to: [5, 8], color: "#00ff00" },
    ]);
    expect(spaziDellaLettura(lettura("url(x)")).every((h) => h.kind === "gap" && h.color === "#ff4f4f")).toBe(true);
    expect(spaziDellaLettura({ gaps: [[[0, "a"], [1, 1]], "x"] })).toEqual([]);
    expect(spaziDellaLettura(null)).toEqual([]);
  });

  it("accesa, legge gli spazi dei gruppi scelti dal motore e rifà i segni; rilegge solo quando cambia la scelta", async () => {
    const { ctx, comando } = fingi(() => lettura("#0000ff"));
    expect(ctx.spaziPitturaHandles()).toEqual([]);
    await attendi();
    expect(comando).toHaveBeenCalledWith({ id: "livePaint.info", selection: ["g1"], value: {} });
    expect(ctx.showHandles).toHaveBeenCalledTimes(1);
    expect(ctx.spaziPitturaHandles()).toHaveLength(2);
    await attendi();
    expect(comando).toHaveBeenCalledTimes(1);
    (ctx as { selection: string[] }).selection = ["g2"];
    ctx.spaziPitturaHandles();
    await attendi();
    expect(comando).toHaveBeenCalledTimes(2);
  });

  it("spenta, o coi bordi nascosti, non mostra niente e non legge", async () => {
    const { ctx, comando } = fingi(() => lettura("#0000ff"));
    (ctx as { grid: object }).grid = { shown: false, snap: false };
    expect(ctx.spaziPitturaHandles()).toEqual([]);
    (ctx as { grid: object }).grid = { shown: false, snap: false, livePaintGaps: true, hideEdges: true };
    expect(ctx.spaziPitturaHandles()).toEqual([]);
    await attendi();
    expect(comando).not.toHaveBeenCalled();
  });

  it("una lettura vecchia non prende il posto di una nuova", async () => {
    let lascia: (() => void) | null = null;
    const { ctx } = fingi((id) => lettura(id === "g1" ? "#111111" : "#222222"));
    const motore = (ctx.options as unknown as { motore: { pronta: () => Promise<unknown> } }).motore;
    const pronta = motore.pronta;
    motore.pronta = () => new Promise((r) => { lascia = () => { void pronta().then(r); }; });
    ctx.spaziPitturaHandles();
    const prima = lascia!;
    motore.pronta = pronta;
    (ctx as { selection: string[] }).selection = ["g2"];
    ctx.spaziPitturaHandles();
    await attendi();
    prima();
    await attendi();
    await attendi();
    expect(ctx.spaziPitturaHandles().every((h) => (h as { color: string }).color === "#222222")).toBe(true);
    expect(ctx.spaziPitturaHandles()).toHaveLength(2);
  });
});

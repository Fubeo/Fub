// @vitest-environment happy-dom
//
// Il motore del disegno nella superficie (K5, T28): la sessione segue la
// riga del motore nella pagina Componenti (spenta, si chiude e lo dice;
// riaccesa, si riapre senza rimontare l'editor) e finisce in ogni modo in cui
// finisce il disegno: il riquadro chiuso, il file cancellato, il vault chiuso
// o cambiato. Con il file rinominato resta. Il chip della superficie dice le
// parti che restano come sono (T21) e il motore spento, fermo o assente da
// questa versione (T23), con «Accendi…» e «Riprova».

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeHost } from "../../host/fake";
import type { Components } from "../../state/components";
import type { EditorSurface } from "../core/registry";
import { doc } from "./scene/test-support";
import { LAYER } from "./tools/test-support";

const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  /// Chi ascolta `onComponents`: la superficie, finché vive.
  componenti: new Set<(next: Components, previous: Components | null) => void>(),
  /// Ciò che `components()` risponde: la mappa del vault aperto, o niente.
  mappa: null as Components | null,
}));

vi.mock("../../host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) =>
          (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) => now().onKernelEvent(handler as never),
  };
});

// La pagina Componenti la fa il banco: `onComponents` è quello di K2, qui
// con gli ascolti contati.
vi.mock("../../state/components", async (original) => ({
  ...(await original<typeof import("../../state/components")>()),
  components: () => box.mappa,
  onComponents: (listener: (next: Components, previous: Components | null) => void) => {
    box.componenti.add(listener);
    return () => box.componenti.delete(listener);
  },
}));

const { createFakeHost } = await import("../../host/fake");
const { documentSessions } = await import("../../state/document-session");
const { state: shell } = await import("../../state/store");
const { mountVectorSurface } = await import("./surface");
const { registerComponentRow } = await import("../../ui/commands");
const { Components: RealComponents } = await import("../../state/components");

const DOC = "disegni/casa.svg";
const SOURCE = doc(
  `<title>Casa</title>${LAYER}<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/></g>`,
);
const NO_FONTS = { now: () => "", load: async () => "" };

let host: FakeHost;
let spento = false;
let parent: HTMLElement;
let mounted: EditorSurface[] = [];

/// Le righe dei componenti come le pubblica K2: il motore acceso o spento.
function componenti(acceso: boolean, root = "/vault"): Components {
  return { root, on: (id: string) => (id === "fub.motore-vettoriale" ? acceso : true) } as unknown as Components;
}

/// La riga del motore cambia nella pagina Componenti.
function riga(acceso: boolean, root?: string): void {
  for (const listener of [...box.componenti]) listener(componenti(acceso, root), componenti(!acceso, root));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function mount(): EditorSurface {
  const surface = mountVectorSurface(
    { paneId: `p${mounted.length + 1}`, documentId: DOC, parent },
    { onChange: () => {}, onSelectionChange: () => {}, fonts: NO_FONTS },
  );
  surface.buffer!.setDoc(documentSessions.text(DOC)!);
  mounted.push(surface);
  return surface;
}

const aperte = (): number => host.atGate("openDrawing").length;
const chiuse = (): string[] => host.atGate("closeDrawing").map((call) => call.args[0] as string);
const istanze = (): string[] => host.atGate("openDrawing").map((_call, at) => `disegno-${at + 1}`);

beforeEach(async () => {
  spento = false;
  host = createFakeHost({ file: { [DOC]: SOURCE }, draw: true, drawing: { spento: () => spento } });
  box.host = host;
  box.componenti.clear();
  box.mappa = null;
  shell.vaultRoot = "/vault";
  parent = document.createElement("div");
  document.body.append(parent);
  mounted = [];
  await documentSessions.read(DOC);
});

afterEach(() => {
  for (const surface of mounted) surface.destroy();
  documentSessions.closeAll();
  shell.vaultRoot = "";
  parent.remove();
  vi.restoreAllMocks();
});

describe("il motore e la pagina Componenti", () => {
  it("spento, la sessione si chiude subito; riacceso, si riapre senza rimontare l'editor", async () => {
    mount();
    await settle();
    expect(aperte()).toBe(1);
    const editor = parent.querySelector(".draw-editor");
    expect(editor).not.toBeNull();
    spento = true;
    riga(false);
    await settle();
    expect(chiuse()).toEqual(["disegno-1"]);
    spento = false;
    riga(true);
    await settle();
    expect(aperte()).toBe(2);
    expect(host.drawingCopy("disegno-2")).toBeDefined();
    // Lo stesso editor: niente si è rimontato.
    expect(parent.querySelector(".draw-editor")).toBe(editor);
  });

  it("tanti cambi di fila: una riapertura alla volta, vince l'ultimo", async () => {
    mount();
    await settle();
    riga(false);
    riga(true);
    riga(true);
    riga(false);
    riga(true);
    await settle();
    // Una riapertura in volo alla volta: la seconda apertura, scartata dallo
    // spento che la segue, si chiude appena arriva; poi parte l'ultima.
    expect(aperte()).toBe(3);
    expect(istanze().filter((each) => host.drawingCopy(each) !== undefined)).toEqual(["disegno-3"]);
  });

  it("la mappa di un altro vault non tocca il motore", async () => {
    mount();
    await settle();
    riga(false, "/altro");
    await settle();
    expect(chiuse()).toEqual([]);
  });
});

describe("la sessione finisce con il disegno", () => {
  it("il riquadro chiuso chiude l'istanza", async () => {
    const surface = mount();
    await settle();
    surface.destroy();
    mounted.pop();
    await settle();
    expect(chiuse()).toEqual(["disegno-1"]);
  });

  it("il file cancellato chiude l'istanza", async () => {
    mount();
    await settle();
    documentSessions.handleExternalRemoval(DOC);
    await settle();
    expect(chiuse()).toEqual(["disegno-1"]);
    // Finito il documento, il motore riacceso non riapre niente.
    riga(false);
    riga(true);
    await settle();
    expect(aperte()).toBe(1);
  });

  it("il vault chiuso, o cambiato, chiude l'istanza", async () => {
    mount();
    await settle();
    documentSessions.closeAll();
    await settle();
    expect(chiuse()).toEqual(["disegno-1"]);
  });

  it("il file rinominato tiene la sessione, che segue la `DocumentSession`", async () => {
    mount();
    await settle();
    expect(documentSessions.rename(DOC, "disegni/villa.svg").kind).toBe("renamed");
    await settle();
    expect(chiuse()).toEqual([]);
    expect(host.drawingCopy("disegno-1")).toBeDefined();
    documentSessions.close("disegni/villa.svg");
    await settle();
    expect(chiuse()).toEqual(["disegno-1"]);
  });

  it("montare e smontare 20 volte non lascia ascolti né istanze", async () => {
    for (let i = 0; i < 20; i++) {
      const surface = mount();
      await settle();
      surface.destroy();
      mounted.pop();
    }
    await settle();
    expect(box.componenti.size).toBe(0);
    expect(aperte()).toBe(20);
    expect(chiuse()).toHaveLength(20);
    expect(istanze().filter((each) => host.drawingCopy(each) !== undefined)).toEqual([]);
  });
});

describe("il chip delle parti che restano come sono (T21)", () => {
  /// L'host col motore che dice una parte sul rettangolo.
  function conUnaParte(): void {
    let aperti = 0;
    host = createFakeHost({
      file: { [DOC]: SOURCE },
      draw: true,
      drawing: {
        spento: () => spento,
        open: () => ({
          instance: `disegno-${++aperti}`,
          revision: "0",
          mapped: 1,
          unmapped: 0,
          losses: [{ element: "o1a2b3c4d", kind: "approximated", detail: "il filtro «ombra» resta com’è" }],
        }),
      },
    });
    box.host = host;
  }

  it("col motore aperto il chip conta le parti; in Lettura, in sola lettura e col motore spento non c'è", async () => {
    conUnaParte();
    const surface = mount();
    const said: (string | null)[] = [];
    surface.standing!.subscribe(() => said.push(surface.standing!.current()?.text ?? null));
    await settle();
    expect(surface.standing!.current()).toMatchObject({ kind: "closed", text: "1 parte resta com’è", placesAsk: "Che cosa manca?" });
    expect(said).toContain("1 parte resta com’è");
    surface.setMode("read");
    expect(surface.standing!.current()).toBeNull();
    surface.setMode("draw");
    expect(surface.standing!.current()?.text).toBe("1 parte resta com’è");
    surface.setReadOnly!(true);
    expect(surface.standing!.current()).toBeNull();
    surface.setReadOnly!(false);
    // Spento: le parti non si sanno, il chip dice il motore spento, e chi
    // ascolta lo sa subito, senza riaprire il file.
    spento = true;
    riga(false);
    expect(surface.standing!.current()).toMatchObject({ kind: "reduced", text: "Motore spento: strumenti semplici" });
    expect(said[said.length - 1]).toBe("Motore spento: strumenti semplici");
    // Riacceso: torna il chip delle parti della sessione nuova.
    spento = false;
    riga(true);
    await settle();
    expect(aperte()).toBe(2);
    expect(surface.standing!.current()?.text).toBe("1 parte resta com’è");
  });

  it("«Vai» sceglie l'elemento", async () => {
    conUnaParte();
    const surface = mount();
    await settle();
    surface.standing!.current()!.places![0]!.run!();
    expect(surface.selections?.()?.primary.text).toContain('id="o1a2b3c4d"');
  });

  it("senza parti, niente chip", async () => {
    const surface = mount();
    await settle();
    expect(surface.standing!.current()).toBeNull();
  });
});

/// Una mappa dei componenti del vault di prova, con le righe `ids`, accese.
function mappaCon(ids: readonly string[]): Components {
  const righe = ids.map((id) => ({ id, acceso: true, ui: [], nome: id }));
  return new RealComponents("/vault", { righe } as unknown as ConstructorParameters<typeof RealComponents>[1]);
}

describe("il chip del motore che manca (T23)", () => {
  it("spento (`unserved`): «Motore spento», e «Accendi…» apre la riga del motore nelle Impostazioni", async () => {
    host = createFakeHost({ file: { [DOC]: SOURCE }, draw: true });
    box.host = host;
    const opened = vi.fn((_id: string) => {});
    const stop = registerComponentRow(opened);
    try {
      const surface = mount();
      await settle();
      const state = surface.standing!.current()!;
      expect(state).toMatchObject({ kind: "reduced", text: "Motore spento: strumenti semplici", title: "Motore del disegno spento" });
      expect(state.actions!.map((action) => action.label)).toEqual(["Accendi…"]);
      state.actions![0]!.run();
      expect(opened).toHaveBeenCalledWith("fub.motore-vettoriale");
      // Non accende niente: nessuna apertura in più.
      await settle();
      expect(aperte()).toBe(1);
      // Tutti gli strumenti restano, nello stesso ordine di col motore.
      const tools = [...parent.querySelectorAll<HTMLElement>(".draw-tool")].map((tool) => tool.dataset.tool);
      expect(tools).toContain("rect");
      expect(tools).toContain("text");
      expect(parent.textContent).not.toContain("Serve il Motore del disegno");
    } finally {
      stop();
    }
  });

  it("la versione senza il motore (la mappa senza la sua riga): «Senza motore», senza «Accendi…»", async () => {
    host = createFakeHost({ file: { [DOC]: SOURCE }, draw: true });
    box.host = host;
    box.mappa = mappaCon(["fub.draw"]);
    const surface = mount();
    await settle();
    expect(surface.standing!.current()).toMatchObject({ kind: "reduced", text: "Senza motore: strumenti semplici", actions: [] });
    // La mappa con la riga: il motore c'è, ed è spento.
    box.mappa = mappaCon(["fub.draw", "fub.motore-vettoriale"]);
    riga(false);
    expect(surface.standing!.current()?.text).toBe("Motore spento: strumenti semplici");
  });

  it("fermo: «Motore fermo», e «Riprova» riapre; se fallisce ancora il chip resta «fermo», senza tentativi da sé", async () => {
    let guasto = true;
    let aperti = 0;
    host = createFakeHost({
      file: { [DOC]: SOURCE },
      draw: true,
      drawing: {
        open: () => {
          if (guasto) throw { kind: "internal", message: "il motore si è fermato" };
          return { instance: `disegno-${++aperti}`, revision: "0", mapped: 1, unmapped: 0, losses: [] };
        },
      },
    });
    box.host = host;
    const surface = mount();
    await settle();
    const fermo = surface.standing!.current()!;
    expect(fermo).toMatchObject({ kind: "stopped", text: "Motore fermo: strumenti semplici", title: "Il motore del disegno si è fermato" });
    expect(fermo.actions!.map((action) => action.label)).toEqual(["Riprova"]);
    fermo.actions![0]!.run();
    // Mentre riapre, il chip resta «fermo».
    expect(surface.standing!.current()?.kind).toBe("stopped");
    await settle();
    expect(aperte()).toBe(2);
    expect(surface.standing!.current()?.kind).toBe("stopped");
    // Nessun giro di tentativi da sé.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(aperte()).toBe(2);
    // Riprova che riesce: il motore c'è, senza parti, e il chip se ne va.
    guasto = false;
    surface.standing!.current()!.actions![0]!.run();
    await settle();
    expect(aperte()).toBe(3);
    expect(surface.standing!.current()).toBeNull();
  });

  it("in sola lettura e in Lettura: nessun chip del motore, parla l'avviso", async () => {
    host = createFakeHost({ file: { [DOC]: SOURCE }, draw: true });
    box.host = host;
    const surface = mount();
    await settle();
    expect(surface.standing!.current()?.kind).toBe("reduced");
    surface.setReadOnly!(true);
    expect(surface.standing!.current()).toBeNull();
    surface.setReadOnly!(false);
    surface.setMode("read");
    expect(surface.standing!.current()).toBeNull();
  });
});

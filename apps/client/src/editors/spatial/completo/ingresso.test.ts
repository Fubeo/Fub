// @vitest-environment happy-dom
// Chi porta il Completo (piano K6, T5): `chrome/workspace.ts` chiama `apri`
// con un `import()` quando si entra nel Completo col componente acceso, una
// volta per disegno; col componente spento, nel Semplice o in una scheda,
// `apri` (e quindi `indice()`) non si chiama mai. Prima dell'`import()` si
// legge la scelta del vault: il primo disegno nasce nel Completo finché la
// superficie non ha letto l'impostazione, e un vault nel Semplice non lo apre.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { SceneEngine } from "../scene/engine";
import { doc } from "../scene/test-support";
import { createDrawEditor, type DrawEditor, type DrawEditorOptions } from "../tools/editor";
import { LAYER } from "../tools/test-support";

const stato = vi.hoisted(() => ({
  acceso: true as boolean | null,
  ascolti: new Set<() => void>(),
  /// Lo spazio scelto nel vault; `null` quello di serie, `"guasto"` una lettura che non riesce.
  vault: null as "simple" | "full" | "guasto" | null,
}));

vi.mock("../../../host/query", async (real) => ({
  ...(await real<typeof import("../../../host/query")>()),
  settings: (plugin?: string) => {
    if (stato.vault === "guasto") return Promise.reject(new Error("ipc"));
    if (plugin !== "fub.draw" || stato.vault === null) return Promise.resolve([]);
    return Promise.resolve([{ spec: { key: "draw.workspace" }, value: stato.vault, source: "vault" }]);
  },
}));

vi.mock("../../../state/components", async (real) => ({
  ...(await real<typeof import("../../../state/components")>()),
  components: () => (stato.acceso === null ? null : { on: (id: string) => id === "fub.disegno-completo" && stato.acceso === true }),
  onComponents: (listener: () => void) => {
    stato.ascolti.add(listener);
    return () => stato.ascolti.delete(listener);
  },
}));

const apri = vi.hoisted(() => vi.fn());
vi.mock("./index", () => ({ apri }));

const SOURCE = doc(`<title>Prova</title>${LAYER}<rect id="o1a2b3c4d" x="60" y="60" width="20" height="20" fill="none" stroke="#000000" stroke-width="2"/></g>`);

let host: HTMLElement;
let owner: Lifetime;
let editor: DrawEditor;

function mount(options: DrawEditorOptions = {}): DrawEditor {
  editor = createDrawEditor(host, SceneEngine.open(SOURCE), owner, options);
  return editor;
}

/// Gli `import()` e i loro `then` arrivati in fondo.
async function arrivati(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((ok) => setTimeout(ok, 0));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  owner = openLifetime();
  stato.acceso = true;
  stato.vault = null;
  stato.ascolti.clear();
  apri.mockReset();
});

afterEach(() => {
  owner.close();
  host.remove();
});

describe("l'ingresso del Completo", () => {
  it("entrare nel Completo col componente acceso lo apre, una volta sola", async () => {
    mount({ workspace: "simple" });
    await arrivati();
    expect(apri).not.toHaveBeenCalled();
    editor.setWorkspace("full");
    editor.setWorkspace("simple");
    editor.setWorkspace("full");
    await arrivati();
    expect(apri).toHaveBeenCalledTimes(1);
    const [ctx] = apri.mock.calls[0] as [{ motore: unknown; life: Lifetime }];
    expect(ctx.motore).toBeNull();
    expect(ctx.life.closed).toBe(false);
  });

  it("un disegno che si apre già nel Completo lo apre subito", async () => {
    mount({ workspace: "full" });
    await arrivati();
    expect(apri).toHaveBeenCalledTimes(1);
  });

  it("col componente spento non si apre mai, nemmeno nel Completo", async () => {
    stato.acceso = false;
    mount({ workspace: "full" });
    editor.setWorkspace("simple");
    editor.setWorkspace("full");
    await arrivati();
    expect(apri).not.toHaveBeenCalled();
  });

  it("la mappa dei componenti che arriva dopo, col componente acceso, lo apre", async () => {
    stato.acceso = null;
    mount({ workspace: "full" });
    await arrivati();
    expect(apri).not.toHaveBeenCalled();
    stato.acceso = true;
    for (const ascolto of stato.ascolti) ascolto();
    await arrivati();
    expect(apri).toHaveBeenCalledTimes(1);
  });

  it("un disegno nato nel Completo con il vault nel Semplice non lo apre; il Completo scelto dopo sì", async () => {
    stato.vault = "simple";
    mount({ workspace: "full" });
    await arrivati();
    expect(apri).not.toHaveBeenCalled();
    // La superficie ha letto lo spazio, e chi disegna sceglie il Completo.
    editor.setWorkspace("simple");
    stato.vault = "full";
    editor.setWorkspace("full");
    await arrivati();
    expect(apri).toHaveBeenCalledTimes(1);
  });

  it("una lettura dello spazio che non riesce non ferma il Completo", async () => {
    stato.vault = "guasto";
    mount({ workspace: "full" });
    await arrivati();
    expect(apri).toHaveBeenCalledTimes(1);
  });

  it("in una scheda non si apre", async () => {
    mount({ workspace: "full", compact: true });
    await arrivati();
    expect(apri).not.toHaveBeenCalled();
  });

  it("il disegno chiuso prima che arrivi il chunk: niente si apre", async () => {
    mount({ workspace: "full" });
    owner.close();
    await arrivati();
    expect(apri).not.toHaveBeenCalled();
    expect(stato.ascolti.size).toBe(0);
  });
});

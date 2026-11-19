// @vitest-environment happy-dom
// Lo spazio «Esporta in PDF» (T70): si apre sopra l'area di lavoro, cambia
// vista, apre e chiude le sezioni, segue la nota cambiata, manda le stesse
// pagine alla stampa, e con Esc torna alla nota col fuoco dov'era.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenderedDocument } from "../host/contract";
import type { ExportNote } from "./block-actions";
import { blockId, printBlocks } from "./paginate/measure";
import type { BlockSource, Scheduler } from "./paginate/slices";
import { defaultProfile } from "./profile";
import { FOLLOW_QUIET_MS, openExportSpace, type ExportSpaceOptions } from "./space";

/// Ogni fetta subito: lo spazio non aspetta i tempi morti.
const NOW: Scheduler = {
  now: () => 0,
  soon(task) {
    queueMicrotask(task);
    return () => {};
  },
  idle(task) {
    queueMicrotask(task);
    return () => {};
  },
};

/// Ogni blocco della resa è un paragrafo di dieci righe da 22 px: tre
/// paragrafi per pagina A4, più o meno.
function fakeMeasure(page: HTMLElement): BlockSource {
  const blocks = printBlocks(page);
  return {
    count: blocks.length,
    measure(index) {
      const top = index * 230;
      return { box: { kind: "paragraph", id: `blocco:${index}`, lines: Array.from({ length: 10 }, () => 22) }, top, bottom: top + 220, exact: true };
    },
  };
}

function note(paragraphs: number): RenderedDocument {
  return { html: Array.from({ length: paragraphs }, (_, i) => `<p data-md-from="${i * 10}">Paragrafo ${i + 1}</p>`).join(""), parts: [] } as unknown as RenderedDocument;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(): Promise<void> {
  for (let i = 0; i < 30; i++) await tick();
}

let app: HTMLElement;
let workspace: HTMLElement;
let opener: HTMLButtonElement;

beforeEach(() => {
  app = document.createElement("div");
  app.id = "app";
  workspace = document.createElement("main");
  workspace.id = "workspace";
  opener = document.createElement("button");
  opener.textContent = "…";
  workspace.append(opener);
  app.append(workspace);
  document.body.append(app);
  opener.focus();
});

afterEach(() => {
  app.remove();
  document.querySelectorAll(".print-host, .export-measure").forEach((node) => node.remove());
  vi.restoreAllMocks();
});

function open(extra: Partial<ExportSpaceOptions> = {}) {
  const render = vi.fn(async () => note(8));
  const space = openExportSpace({
    doc: "relazione.md",
    title: "Relazione",
    render,
    container: app,
    behind: [workspace],
    scheduler: NOW,
    measure: fakeMeasure,
    waitMs: 10,
    ...extra,
  });
  return { space, render };
}

describe("lo spazio «Esporta in PDF»", () => {
  it("si apre sopra l'area di lavoro, cambia vista e con Esc torna alla nota", async () => {
    const { space } = open();
    const root = space.element;
    expect(root.getAttribute("role")).toBe("dialog");
    expect(root.getAttribute("aria-label")).toBe("Esporta in PDF");
    expect(workspace.inert).toBe(true);
    expect(document.activeElement).toBe(root);
    await settle();

    const slots = root.querySelectorAll(".export-slot");
    expect(slots.length).toBeGreaterThan(1);
    expect(root.querySelector(".export-band-pages")?.textContent).toBe(`${slots.length} pagine`);
    expect(root.querySelector(".export-page")?.textContent).toContain("Paragrafo 1");

    root.querySelector<HTMLButtonElement>('.export-segment[data-view="tutte"]')!.click();
    expect(space.view).toBe("tutte");
    expect(root.querySelector(".export-doc")?.getAttribute("data-view")).toBe("tutte");
    expect(root.querySelector('.export-segment[data-view="tutte"]')?.getAttribute("aria-pressed")).toBe("true");
    // Nella vista «tutte» una miniatura porta alla sua pagina, a una pagina.
    const second = root.querySelector<HTMLElement>('.export-slot[data-page="1"]')!;
    expect(second.getAttribute("role")).toBe("button");
    second.click();
    expect(space.view).toBe("adatta");

    root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(root.isConnected).toBe(false);
    expect(workspace.inert).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(document.querySelector(".export-measure")).toBeNull();
  });

  it("lo zoom coi pulsanti esce dalle viste e va a passi di un decimo", async () => {
    const { space } = open();
    await settle();
    const root = space.element;
    const [out] = root.querySelectorAll<HTMLButtonElement>(".export-zoom-button");
    out!.click();
    expect(space.view).toBe("libera");
    expect([...root.querySelectorAll(".export-segment")].every((node) => node.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(root.querySelector(".export-zoom-value")?.textContent).toMatch(/^\d+%$/);
    space.close();
  });

  it("le sezioni si aprono e si chiudono; mentre si trascina il pannello non si ridisegna", async () => {
    const { space } = open();
    await settle();
    const root = space.element;
    const heads = [...root.querySelectorAll<HTMLButtonElement>(".export-section-head")];
    expect(heads).toHaveLength(10);
    const page = root.querySelector<HTMLButtonElement>('[data-section="pagina"] .export-section-head')!;
    expect(page.getAttribute("aria-expanded")).toBe("false");
    expect(page.querySelector(".export-section-summary")?.textContent).toBe("A4 verticale");
    page.click();
    const opened = root.querySelector<HTMLButtonElement>('[data-section="pagina"] .export-section-head')!;
    expect(opened.getAttribute("aria-expanded")).toBe("true");
    expect(root.querySelector('[data-section="pagina"] #export-page-format-A4')?.getAttribute("aria-checked")).toBe("true");

    const base = defaultProfile();
    const landscape = { ...base, pagina: { ...base.pagina, orizzontale: true } };
    space.setProfile(landscape, { live: true });
    // Lo stesso pannello, la stessa testa: le pagine cambiano, il pannello no.
    expect(root.querySelector('[data-section="pagina"] .export-section-head')).toBe(opened);
    expect(opened.querySelector(".export-section-summary")?.textContent).toBe("A4 verticale");
    opened.focus();
    space.setProfile(landscape);
    // A gesto finito il pannello si ridisegna, col fuoco sulla stessa testa.
    const again = root.querySelector<HTMLButtonElement>('[data-section="pagina"] .export-section-head')!;
    expect(again.querySelector(".export-section-summary")?.textContent).toBe("A4 orizzontale");
    expect(document.activeElement).toBe(again);
    expect(root.querySelector(".export-profile-name")?.textContent).toBe("Di serie · cambiato");
    space.close();
  });

  it("segue la nota cambiata in un altro riquadro: salva, poi rifà la resa", async () => {
    let tell: ((event: "changed" | "saved") => void) | null = null;
    const save = vi.fn(async () => {});
    const { space, render } = open({
      follow: (changed) => {
        tell = changed;
        return () => {
          tell = null;
        };
      },
      save,
    });
    await settle();
    expect(render).toHaveBeenCalledTimes(1);
    tell!("changed");
    tell!("changed");
    await new Promise((resolve) => setTimeout(resolve, FOLLOW_QUIET_MS + 50));
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(2);
    space.close();
    expect(tell).toBeNull();
  });

  it("lo stile dei diagrammi rimonta la resa che c'è, senza chiederla al core", async () => {
    const looks: (string | undefined)[][] = [];
    const mount = vi.fn((container: HTMLElement, rendered: RenderedDocument, look: { diagramLook(index: number | null): { style?: string } | null }) => {
      container.innerHTML = rendered.html;
      looks.push([look.diagramLook(0)?.style, look.diagramLook(1)?.style, look.diagramLook(null)?.style]);
      return { ready: Promise.resolve(), dispose: () => undefined };
    });
    const { space, render } = open({ mount });
    await settle();
    expect(render).toHaveBeenCalledTimes(1);
    expect(looks).toEqual([[undefined, undefined, undefined]]);
    space.setProfile({ ...space.profile, diagrammi: { stile: "aurora", fondo: true } });
    await settle();
    expect(render).toHaveBeenCalledTimes(1);
    expect(looks[looks.length - 1]).toEqual(["aurora", "aurora", "aurora"]);
    // Uno stile a un diagramma solo, poi via di nuovo; un cambio che non
    // tocca i diagrammi non rimonta niente.
    space.setDiagramStyle(1, "blueprint");
    await settle();
    expect(looks[looks.length - 1]).toEqual(["aurora", "blueprint", "aurora"]);
    expect(space.diagramStyles.get(1)).toBe("blueprint");
    const mounts = mount.mock.calls.length;
    space.setProfile({ ...space.profile, frontespizio: { ...space.profile.frontespizio, segnalibri: !space.profile.frontespizio.segnalibri } });
    await settle();
    expect(mount.mock.calls.length).toBe(mounts);
    space.openSection("diagrammi");
    const clear = app.querySelector<HTMLButtonElement>("#export-dg-clear-own");
    expect(clear?.textContent).toBe("Togli lo stile dato a 1");
    clear!.click();
    await settle();
    expect(space.diagramStyles.size).toBe(0);
    expect(looks[looks.length - 1]).toEqual(["aurora", "aurora", "aurora"]);
    expect(render).toHaveBeenCalledTimes(1);
    space.close();
  });

  it("«Stampa…» manda alla stampa del sistema le stesse pagine, senza zoom", async () => {
    const print = vi.fn();
    vi.stubGlobal("print", print);
    const { space } = open();
    await settle();
    const count = space.element.querySelectorAll(".export-slot").length;
    await space.print();
    expect(print).toHaveBeenCalledOnce();
    const host = document.querySelector(".print-host")!;
    expect(host.querySelectorAll(".print-sheet")).toHaveLength(count);
    expect(host.querySelector<HTMLElement>(".print-sheet")!.style.transform).toBe("scale(1)");
    window.dispatchEvent(new Event("afterprint"));
    expect(document.querySelector(".print-host")).toBeNull();
    space.close();
    vi.unstubAllGlobals();
  });

  it("una nota vuota fa una pagina, col solo titolo", async () => {
    const { space } = open({ render: vi.fn(async () => note(0)) });
    await settle();
    expect(space.element.querySelectorAll(".export-slot")).toHaveLength(1);
    expect(space.element.querySelector(".export-band-pages")?.textContent).toBe("1 pagina");
    space.close();
  });

  it("una resa che non arriva lo dice nella banda e in un avviso", async () => {
    const { space } = open({ render: vi.fn(async () => Promise.reject(new Error("niente"))) });
    await settle();
    expect(space.element.querySelector(".export-band-info")?.textContent).toBe("Le pagine non sono pronte");
    space.close();
  });
});

describe("il clic sulla pagina (T76)", () => {
  /// La resa per la stampa del core: ogni paragrafo con la sua posizione.
  const source = (paragraphs: number) =>
    ({ html: Array.from({ length: paragraphs }, (_, i) => `<p data-fub-source-start="${i * 20}" data-fub-source-end="${i * 20 + 12}">Paragrafo ${i + 1}</p>`).join(""), parts: [] }) as unknown as RenderedDocument;
  const measure = (page: HTMLElement): BlockSource => {
    const blocks = printBlocks(page);
    return {
      count: blocks.length,
      measure(index) {
        const top = index * 230;
        return { box: { kind: "paragraph", id: blockId(blocks[index]!, index), lines: Array.from({ length: 10 }, () => 22) }, top, bottom: top + 220, exact: true };
      },
    };
  };
  const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>("[role^=menuitem]")].find((entry) => entry.textContent?.includes(label));

  it("lascia fuori un blocco dalle pagine e la sezione Contenuto lo rimette", async () => {
    const note: ExportNote = { shown: () => "", current: () => "", readOnly: () => null, write: () => true, reveal: () => {} };
    const { space } = open({ render: vi.fn(async () => source(4)), measure, note });
    await settle();
    const band = [...space.element.querySelectorAll<HTMLElement>(".export-fascia")].find((entry) => entry.textContent?.includes("Paragrafo 2"))!;
    expect(band.dataset["block"]).toBe("src:20");
    band.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10, detail: 1 }));
    expect(band.classList.contains("is-selected")).toBe(true);
    menuItem("Lascia fuori dal PDF")!.click();
    await settle();
    expect(space.element.querySelector(".export-page")?.textContent).not.toContain("Paragrafo 2");
    expect(space.element.querySelector('[data-section="contenuto"] .export-section-summary')?.textContent).toBe("1 blocco lasciato fuori");
    space.openSection("contenuto");
    space.element.querySelector<HTMLButtonElement>("#export-block-restore-all")!.click();
    await settle();
    expect(space.element.querySelector(".export-page")?.textContent).toContain("Paragrafo 2");
    space.close();
  });
});

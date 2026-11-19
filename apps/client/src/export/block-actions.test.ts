// @vitest-environment happy-dom
// Il clic sulla pagina (T76): una prova per voce del menu del blocco, sulla
// resa per la stampa come la dà il core (le posizioni in byte nel sorgente),
// e le due funzioni che scrivono e tolgono `<!-- pagina -->` nella nota.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const notify = vi.fn();
vi.mock("../ui/notify", () => ({ notify: (...args: unknown[]) => notify(...args) }));
const showContextMenu = vi.fn();
vi.mock("../ui/menu", () => ({ showContextMenu: (...args: unknown[]) => showContextMenu(...args) }));

import { t } from "../i18n/strings";
import type { MenuItem } from "../ui/menu";
import {
  attachBlockActions,
  BlockExclusions,
  blockMenu,
  exclusionsRow,
  withoutPageBreak,
  withPageBreak,
  type BlockActionsHost,
  type ExportNote,
} from "./block-actions";
import { printBlocks } from "./paginate/measure";

// La nota e la sua resa: ogni blocco con la sua posizione in byte, come
// nella resa per la stampa del core (`è` vale due byte).
const SOURCE = "# Già\n\nPrima è qui.\n\n<!-- pagina -->\n## Dopo\n\n- uno\n- due\n\n```mermaid\ngraph TD\n```\n";
const bytes = (text: string) => new TextEncoder().encode(text).length;
const at = (needle: string) => bytes(SOURCE.slice(0, SOURCE.indexOf(needle)));

function render(source = SOURCE): HTMLElement {
  const page = document.createElement("article");
  page.className = "print-page";
  const s = (needle: string) => {
    const from = bytes(source.slice(0, source.indexOf(needle)));
    return `data-fub-source-start="${from}" data-fub-source-end="${from + bytes(needle)}"`;
  };
  page.innerHTML = `<h1>Nota</h1><div class="print-body markdown-rendered">
    <h1 ${s("# Già")}>Già</h1>
    <p ${s("Prima è qui.")}>${source.includes("Prima è qui.") ? "Prima è qui." : ""}</p>
    <div ${s("<!-- pagina -->")} class="page-break" data-page-break="mano"></div>
    <h2 ${s("## Dopo")}>Dopo</h2>
    <ul ${s("- uno\n- due")}><li><p ${s("uno")}>uno</p></li><li><p ${s("due")}>due</p></li></ul>
    <figure class="mermaid-diagram" data-export-diagram="0" ${s("```mermaid\ngraph TD\n```")}><img alt=""></figure>
  </div>`;
  document.body.append(page);
  return page;
}

const block = (page: HTMLElement, selector: string) => page.querySelector<HTMLElement>(`.print-body ${selector}`)!;

function fakeNote(text = SOURCE, readOnly: string | null = null) {
  const state = { text, shown: text as string | null, readOnly };
  const note: ExportNote & { writes: string[]; revealed: { start: number; end: number }[] } = {
    writes: [],
    revealed: [],
    shown: () => state.shown,
    current: () => state.text,
    readOnly: () => state.readOnly,
    write(before, after) {
      if (before !== state.text) return false;
      state.text = after;
      note.writes.push(after);
      return true;
    },
    reveal(where) {
      note.revealed.push(where);
    },
  };
  return { note, state };
}

function host(page: HTMLElement, note?: ExportNote): BlockActionsHost & { opened: string[]; styles: [number, string | null][]; changes: number } {
  const styles = new Map<number, string>();
  const out = {
    opened: [] as string[],
    styles: [] as [number, string | null][],
    changes: 0,
    page: () => page,
    exclusions: new BlockExclusions(),
    excludedChanged: () => {
      out.changes++;
    },
    openSection: (id: string) => out.opened.push(id),
    diagramStyle: (index: number) => styles.get(index),
    setDiagramStyle: (index: number, style: string | null) => {
      out.styles.push([index, style]);
      if (style === null) styles.delete(index);
      else styles.set(index, style);
    },
    ...(note ? { note } : {}),
  };
  return out;
}

const item = (items: readonly MenuItem[], label: string) => items.find((entry) => entry.label === label)!;
const BREAK = () => t("pdf_export.block.break");
const SKIP = () => t("pdf_export.block.skip");
const REVEAL = () => t("pdf_export.block.reveal");
/// L'azione dell'ultimo avviso («Annulla», «Rimetti»).
const lastAction = () => (notify.mock.calls[notify.mock.calls.length - 1]?.[2] as { run: () => void } | undefined)!;

beforeEach(() => {
  notify.mockClear();
  showContextMenu.mockClear();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("scrivere e togliere `<!-- pagina -->`", () => {
  it("la riga va prima di quella dove comincia il blocco, contata in byte", () => {
    expect(withPageBreak(SOURCE, at("## Dopo"))).toBe(SOURCE.replace("## Dopo", "<!-- pagina -->\n## Dopo"));
    expect(withPageBreak("a\r\n\r\nb è\r\n", 5)).toBe("a\r\n\r\n<!-- pagina -->\r\nb è\r\n");
    // Un blocco che non comincia la riga sta dentro un altro: non si scrive.
    expect(withPageBreak("> citazione\n", 2)).toBeNull();
  });

  it("si toglie con la sua riga, e soltanto se c'è ancora", () => {
    const marker = { start: at("<!-- pagina -->"), end: at("<!-- pagina -->") + 15 };
    expect(withoutPageBreak(SOURCE, marker)).toBe(SOURCE.replace("<!-- pagina -->\n", ""));
    expect(withoutPageBreak(SOURCE.replace("<!-- pagina -->", "<!-- altro!! -->"), marker)).toBeNull();
  });
});

describe("Comincia qui una pagina nuova", () => {
  it("scrive la riga nella nota, e l'avviso la annulla", () => {
    const page = render();
    const { note, state } = fakeNote();
    const menu = blockMenu({ element: block(page, "p"), firstOnPage: false }, host(page, note));
    const entry = item(menu.items, BREAK());
    expect(entry).toMatchObject({ choice: "checkbox", checked: false, disabled: false });
    entry.run!();
    expect(state.text).toBe(SOURCE.replace("Prima è qui.", "<!-- pagina -->\nPrima è qui."));
    expect(notify).toHaveBeenLastCalledWith(t("pdf_export.block.break_added"), "info", expect.objectContaining({ label: t("app.undo") }));
    lastAction().run();
    expect(state.text).toBe(SOURCE);
  });

  it("su un blocco che ce l'ha già è spuntata, e la toglie", () => {
    const page = render();
    const { note, state } = fakeNote();
    const entry = item(blockMenu({ element: block(page, "h2"), firstOnPage: true }, host(page, note)).items, BREAK());
    expect(entry).toMatchObject({ checked: true });
    expect(entry.description).toBeUndefined();
    entry.run!();
    expect(state.text).toBe(SOURCE.replace("<!-- pagina -->\n", ""));
  });

  it("un blocco già in cima a una pagina: si può, e la voce dice che cosa cambia", () => {
    const page = render();
    const { note } = fakeNote();
    const entry = item(blockMenu({ element: block(page, "p"), firstOnPage: true }, host(page, note)).items, BREAK());
    expect(entry).toMatchObject({ disabled: false, description: t("pdf_export.block.break_first") });
  });

  it("con la nota in sola lettura la voce è spenta e dice perché; niente si scrive", () => {
    const page = render();
    const reason = t("pdf_export.block.read_only", { doc: "Nota" });
    const { note, state } = fakeNote(SOURCE, reason);
    const entry = item(blockMenu({ element: block(page, "p"), firstOnPage: false }, host(page, note)).items, BREAK());
    expect(entry).toMatchObject({ disabled: true, description: reason });
    entry.run!();
    expect(state.text).toBe(SOURCE);
    expect(notify).toHaveBeenLastCalledWith(reason, "info");
  });

  it("dentro un elenco si può solo prima dell'elenco; la prima voce lo mette lì", () => {
    const page = render();
    const { note, state } = fakeNote();
    const [first, second] = [...page.querySelectorAll<HTMLElement>(".print-body li")];
    expect(item(blockMenu({ element: second!, firstOnPage: false }, host(page, note)).items, BREAK())).toMatchObject({ disabled: true, description: t("pdf_export.block.break_inside") });
    item(blockMenu({ element: first!, firstOnPage: false }, host(page, note)).items, BREAK()).run!();
    expect(state.text).toBe(SOURCE.replace("- uno", "<!-- pagina -->\n- uno"));
  });

  it("con la nota cambiata dopo la resa non scrive: le posizioni sarebbero di un altro testo", () => {
    const page = render();
    const { note, state } = fakeNote();
    state.text = `Nuovo.\n\n${SOURCE}`;
    item(blockMenu({ element: block(page, "p"), firstOnPage: false }, host(page, note)).items, BREAK()).run!();
    expect(note.writes).toEqual([]);
    expect(notify).toHaveBeenLastCalledWith(t("pdf_export.block.break_changing"), "info");
  });

  it("«Annulla» dopo un'altra modifica non copre ciò che è stato scritto", () => {
    const page = render();
    const { note, state } = fakeNote();
    item(blockMenu({ element: block(page, "p"), firstOnPage: false }, host(page, note)).items, BREAK()).run!();
    const undo = lastAction();
    state.text += "\nAltro.\n";
    const after = state.text;
    undo.run();
    expect(state.text).toBe(after);
    expect(notify).toHaveBeenLastCalledWith(t("pdf_export.block.undo_stale"), "info");
  });
});

describe("Lascia fuori dal PDF", () => {
  it("lascia fuori il blocco senza toccare la nota, e «Rimetti» lo rimette", () => {
    const page = render();
    const { note } = fakeNote();
    const space = host(page, note);
    item(blockMenu({ element: block(page, "p"), firstOnPage: false }, space).items, SKIP()).run!();
    expect(space.exclusions.ids).toEqual([`src:${at("Prima è qui.")}`]);
    expect(space.changes).toBe(1);
    expect(note.writes).toEqual([]);
    expect(notify).toHaveBeenLastCalledWith(t("pdf_export.block.skipped"), "info", expect.objectContaining({ label: t("pdf_export.block.restore") }));
    lastAction().run();
    expect(space.exclusions.ids).toEqual([]);
    expect(space.changes).toBe(2);
  });

  it("si ritrova nella resa nuova anche se si è spostato; cambiato, l'esclusione si perde", () => {
    const page = render();
    const space = host(page, fakeNote().note);
    item(blockMenu({ element: block(page, "p"), firstOnPage: false }, space).items, SKIP()).run!();
    // Il blocco nascosto dallo spazio resta riconoscibile.
    block(page, "p").hidden = true;
    expect(space.exclusions.resolve(page)).toEqual({ changed: false, lost: [] });
    // Un paragrafo nuovo in cima sposta le posizioni: lo stesso blocco.
    document.body.replaceChildren();
    const moved = render(`Nuovo.\n\n${SOURCE}`);
    expect(space.exclusions.resolve(moved)).toEqual({ changed: true, lost: [] });
    expect(space.exclusions.ids).toEqual([`src:${at("Prima è qui.") + bytes("Nuovo.\n\n")}`]);
    // Riscritto, non è più lui.
    document.body.replaceChildren();
    const changed = render(SOURCE.replace("Prima è qui.", "Prima è là."));
    const result = space.exclusions.resolve(changed);
    expect(result.changed).toBe(true);
    expect(result.lost.map((ref) => ref.preview)).toEqual(["Prima è qui."]);
    expect(space.exclusions.count).toBe(0);
  });

  it("la sezione Contenuto dice come si fa, o li rimette tutti", () => {
    expect(exclusionsRow(0, () => {}).textContent).toBe(t("pdf_export.block.skip_how"));
    const restore = vi.fn();
    const button = exclusionsRow(2, restore);
    expect(button.textContent).toBe(t("pdf_export.block.restore_all.other", { n: 2 }));
    button.click();
    expect(restore).toHaveBeenCalledOnce();
  });
});

describe("lo stile di quel diagramma", () => {
  it("dà uno stile al solo diagramma, o lo rimette come gli altri", () => {
    const page = render();
    const space = host(page, fakeNote().note);
    const items = () => blockMenu({ element: block(page, "figure"), firstOnPage: false }, space).items.filter((entry) => entry.group === t("pdf_export.block.diagram_style"));
    expect(items().map((entry) => entry.label)).toEqual([
      t("pdf_export.block.diagram_like_others"),
      t("pdf_export.block.diagram_theme"),
      t("mermaid.style.acquerello"),
      t("mermaid.style.aurora"),
      t("mermaid.style.blueprint"),
      t("mermaid.style.inchiostro"),
    ]);
    expect(items().filter((entry) => entry.checked).map((entry) => entry.label)).toEqual([t("pdf_export.block.diagram_like_others")]);
    item(items(), t("mermaid.style.aurora")).run!();
    expect(items().filter((entry) => entry.checked).map((entry) => entry.label)).toEqual([t("mermaid.style.aurora")]);
    item(items(), t("pdf_export.block.diagram_like_others")).run!();
    expect(space.styles).toEqual([[0, "aurora"], [0, null]]);
  });

  it("un paragrafo non ha stili da diagramma", () => {
    const page = render();
    const items = blockMenu({ element: block(page, "p"), firstOnPage: false }, host(page, fakeNote().note)).items;
    expect(items.some((entry) => entry.group !== undefined)).toBe(false);
  });
});

describe("Regola: …", () => {
  it("apre la sezione che regola quella specie di blocco", () => {
    const page = render();
    const space = host(page, fakeNote().note);
    const adjust = (selector: string) => blockMenu({ element: block(page, selector), firstOnPage: false }, space).items.find((entry) => entry.icon === "export-adjust");
    expect(adjust("p")?.label).toBe(t("pdf_export.block.adjust", { section: t("pdf_export.section.fonts") }));
    adjust("p")!.run!();
    adjust("figure")!.run!();
    expect(space.opened).toEqual(["caratteri", "diagrammi"]);
    // Il titolo della pagina non è un blocco della nota: resta solo «Regola».
    const title = blockMenu({ element: page.querySelector<HTMLElement>(":scope > h1")!, firstOnPage: true }, space);
    expect(title.header.kind).toBe(t("pdf_export.block.kind.title"));
    expect(title.items.map((entry) => entry.label)).toEqual([t("pdf_export.block.adjust", { section: t("pdf_export.section.fonts") })]);
  });
});

describe("Vai al blocco nella nota", () => {
  it("porta al punto del blocco, in byte", () => {
    const page = render();
    const { note } = fakeNote();
    item(blockMenu({ element: block(page, "h2"), firstOnPage: false }, host(page, note)).items, REVEAL()).run!();
    expect(note.revealed).toEqual([{ start: at("## Dopo"), end: at("## Dopo") + bytes("## Dopo") }]);
  });

  it("senza la nota (il libro) non ci sono le voci che la scrivono o ci portano", () => {
    const page = render();
    const labels = blockMenu({ element: block(page, "p"), firstOnPage: false }, host(page)).items.map((entry) => entry.label);
    expect(labels).not.toContain(BREAK());
    expect(labels).not.toContain(REVEAL());
  });
});

describe("il clic sulla pagina", () => {
  function pages(page: HTMLElement) {
    const root = document.createElement("div");
    const blocks = printBlocks(page);
    const index = blocks.indexOf(block(page, "p"));
    for (let i = 0; i < 2; i++) {
      const band = document.createElement("div");
      band.className = "export-fascia";
      band.dataset["block"] = `src:${at("Prima è qui.")}`;
      band.dataset["blockIndex"] = String(index);
      root.append(band);
    }
    document.body.append(root);
    return root;
  }

  it("apre il menu del blocco toccato, contornato finché il menu è aperto", () => {
    const page = render();
    const root = pages(page);
    let all = false;
    const dispose = attachBlockActions({ ...host(page, fakeNote().note), pages: root, allPages: () => all });
    const bands = [...root.querySelectorAll<HTMLElement>(".export-fascia")];
    bands[1]!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 30, clientY: 40, detail: 1 }));
    expect(showContextMenu).toHaveBeenCalledOnce();
    const [point, items, options] = showContextMenu.mock.calls[0]! as [unknown, MenuItem[], { header: { kind: string }; onClose: () => void }];
    // Il clic stesso: il menu si apre nel suo punto, e nel dialogo dello
    // spazio che lo contiene, non nell'area di lavoro inerte.
    expect(point).toBeInstanceOf(MouseEvent);
    expect((point as MouseEvent).target).toBe(bands[1]);
    expect([(point as MouseEvent).clientX, (point as MouseEvent).clientY]).toEqual([30, 40]);
    expect(options.header.kind).toBe(t("editor_menu.head.text"));
    expect(items.map((entry) => entry.label)).toContain(BREAK());
    expect(bands.every((band) => band.classList.contains("is-selected"))).toBe(true);
    options.onClose();
    expect(bands.some((band) => band.classList.contains("is-selected"))).toBe(false);
    // Fra le miniature il clic sceglie la pagina, non il blocco.
    all = true;
    bands[0]!.click();
    expect(showContextMenu).toHaveBeenCalledOnce();
    dispose();
    all = false;
    bands[0]!.click();
    expect(showContextMenu).toHaveBeenCalledOnce();
  });

  it("una fascia di un'impaginazione vecchia non apre il menu di un altro blocco", () => {
    const page = render();
    const root = pages(page);
    root.querySelector<HTMLElement>(".export-fascia")!.dataset["block"] = "src:9999";
    attachBlockActions({ ...host(page, fakeNote().note), pages: root, allPages: () => false });
    root.querySelector<HTMLElement>(".export-fascia")!.click();
    expect(showContextMenu).not.toHaveBeenCalled();
  });
});

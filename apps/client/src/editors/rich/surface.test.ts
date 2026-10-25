// @vitest-environment happy-dom
//
// La superficie statica: tiene il buffer finché il motore non arriva, dice
// perché un documento non si scrive, e smonta tutto anche a motore non ancora
// caricato.
import { afterEach, describe, expect, it, vi } from "vitest";
import { RICH_ACTIONS } from "./commands";
import * as engineModule from "./engine";
import { mountRichSurface, RICH_ACTION_IDS, RICH_CHORDS, RICH_PROFILE } from "./surface";
import { t } from "../../i18n/strings";
import { declareClipboard } from "../../platform/clipboard";
import { activeMotions, createManualDriver, setMotionDriver } from "../../moto";
import type { SurfaceMenuItem } from "../core/editor-menu";
import type { EditorSurface } from "../core/registry";

afterEach(() => document.body.replaceChildren());

const SOURCE = JSON.stringify({
  format: "fub-rich",
  version: 1,
  blocks: [{ t: "para", role: { kind: "body" }, k: "P", c: [{ t: "text", x: "ciao", k: "R" }] }],
});

function deferred() {
  let resolve!: (value: typeof engineModule) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<typeof engineModule>((ok, ko) => {
    resolve = ok;
    reject = ko;
  });
  return { promise, resolve, reject };
}

function mount(load: () => Promise<typeof engineModule>, requestMode?: (mode: string) => void) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const onChange = vi.fn();
  const surface = mountRichSurface(
    RICH_PROFILE,
    { paneId: "pane", documentId: "lettera.docx", parent, formatId: "docx" },
    { onChange, onSelectionChange: vi.fn(), loadEngine: load, requestMode },
  );
  return { parent, surface, onChange };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/// L'ispettore della shell, in piccolo: monta la scheda che la superficie
/// chiede di mostrare.
function inspector(surface: EditorSurface) {
  const host = document.createElement("div");
  document.body.append(host);
  const mounted = new Map<string, () => void>();
  const stop = surface.panels!.onShow((id) => {
    if (mounted.has(id)) return;
    const panel = surface.panels!.list().find((each) => each.id === id)!;
    mounted.set(id, panel.mount(host));
  });
  return {
    host,
    close() {
      stop();
      for (const unmount of mounted.values()) unmount();
      host.remove();
    },
  };
}

describe("la superficie ricca", () => {
  it("dichiara le stesse azioni e gli stessi accordi del motore", () => {
    expect([...RICH_ACTION_IDS].sort()).toEqual([...RICH_ACTIONS.keys()].sort());
    const chords = Object.fromEntries([...RICH_ACTIONS].filter(([, a]) => a.chord).map(([id, a]) => [id, a.chord]));
    expect(RICH_CHORDS).toEqual(chords);
  });

  it("tiene il buffer finché il motore non arriva, con le azioni note ma spente", async () => {
    const load = deferred();
    const { parent, surface, onChange } = mount(() => load.promise);
    surface.buffer!.setDoc(SOURCE);
    expect(surface.buffer!.getDoc()).toBe(SOURCE);
    expect(surface.editorActions!.has("markdown.bold")).toBe(true);
    expect(surface.editorActions!.has("markdown.code")).toBe(false);
    expect(surface.editorActions!.state("markdown.bold").enabled).toBe(false);
    expect(surface.editorActions!.run("markdown.bold")).toBe(false);
    const notified = vi.fn();
    surface.editorActions!.subscribe(notified);

    load.resolve(engineModule);
    await flush();
    expect(parent.querySelector(".rich-content")?.textContent).toBe("ciao");
    expect(surface.buffer!.getDoc()).toBe(SOURCE);
    expect(surface.editorActions!.editable()).toBe(true);
    expect(notified).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    surface.destroy();
    expect(parent.childElementCount).toBe(0);
  });

  it("ha Pagina, Scrittura e Lettura, ciascuna coi suoi aspetti, e Pagina per prima", () => {
    const { surface } = mount(() => new Promise(() => {}));
    expect(surface.modes.map((mode) => [mode.id, mode.contextMode, mode.looks])).toEqual([
      ["document", "live_preview", ["file", "adattato"]],
      ["writing", "live_preview", ["tema"]],
      ["reading", "reading", ["file", "adattato"]],
    ]);
    expect(surface.defaultMode ?? surface.modes[0].id).toBe("document");
    expect(() => surface.setMode("source")).toThrow();
    surface.destroy();
  });

  it("in Lettura la barra si ritira e il documento non si scrive; Esc chiede Pagina", async () => {
    const asked: string[] = [];
    const { parent, surface } = mount(() => Promise.resolve(engineModule), (mode) => asked.push(mode));
    await flush();
    surface.buffer!.setDoc(SOURCE);
    const host = parent.querySelector<HTMLElement>(".rich-ribbon-host")!;
    const content = parent.querySelector<HTMLElement>(".rich-content")!;
    surface.setMode("reading");
    expect(parent.dataset.surfaceMode).toBe("reading");
    expect(host.hidden).toBe(true);
    expect(surface.editorActions!.editable()).toBe(false);
    expect(content.getAttribute("contenteditable")).toBe("false");
    const esc = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    content.dispatchEvent(esc);
    expect(esc.defaultPrevented).toBe(true);
    expect(asked).toEqual(["document"]);
    surface.setMode("writing");
    expect(host.hidden).toBe(false);
    expect(surface.editorActions!.editable()).toBe(true);
    // Fuori dalla Lettura, Esc resta di chi lo aspetta.
    content.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(asked).toEqual(["document"]);
    surface.destroy();
  });

  it("un documento in sola lettura resta tale fuori dalla Lettura", async () => {
    const { surface } = mount(() => Promise.resolve(engineModule));
    await flush();
    surface.buffer!.setDoc(JSON.stringify({ ...JSON.parse(SOURCE), readonly: "protected" }));
    surface.setMode("reading");
    surface.setMode("document");
    expect(surface.editorActions!.editable()).toBe(false);
    surface.destroy();
  });

  it("smontata prima che il motore arrivi non monta niente dopo", async () => {
    const load = deferred();
    const { parent, surface } = mount(() => load.promise);
    surface.buffer!.setDoc(SOURCE);
    surface.destroy();
    load.resolve(engineModule);
    await flush();
    expect(parent.childElementCount).toBe(0);
    expect(document.querySelector(".rich-content")).toBeNull();
  });

  it("un motore che non si carica lo dice e lascia il documento com'era", async () => {
    const { parent, surface } = mount(() => Promise.reject(new Error("rete")));
    surface.buffer!.setDoc(SOURCE);
    await flush();
    const notice = parent.querySelector<HTMLElement>(".rich-notice")!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).not.toBe("");
    expect(surface.buffer!.getDoc()).toBe(SOURCE);
    expect(surface.editorActions!.editable()).toBe(false);
    surface.destroy();
  });

  it("dice perché un documento si apre in sola lettura", async () => {
    const { parent, surface } = mount(() => Promise.resolve(engineModule));
    await flush();
    surface.buffer!.setDoc(JSON.stringify({ ...JSON.parse(SOURCE), readonly: "protected" }));
    const notice = parent.querySelector<HTMLElement>(".rich-notice")!;
    expect(notice.hidden).toBe(false);
    expect(surface.editorActions!.editable()).toBe(false);
    expect(parent.querySelector(".rich-content")?.getAttribute("contenteditable")).toBe("false");
    surface.destroy();
  });

  it("in sola lettura la barra resta: si cerca e si leggono i commenti, il resto è spento col perché", async () => {
    const { parent, surface, onChange } = mount(() => Promise.resolve(engineModule));
    await flush();
    const comments = [{ id: 7, by: "Ada", at: "2026-10-18T14:00:00Z", text: "Da rivedere." }];
    surface.buffer!.setDoc(JSON.stringify({ ...JSON.parse(SOURCE), readonly: "protected", comments }));
    const ribbon = parent.querySelector<HTMLElement>(".rich-ribbon")!;
    expect(ribbon.hidden).toBe(false);
    const named = (label: string) => ribbon.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    // La sottolineatura è spenta, raggiungibile, e dice perché.
    const bold = ribbon.querySelector<HTMLButtonElement>('[data-command="rich.underline"] button')!;
    expect(bold.getAttribute("aria-disabled")).toBe("true");
    bold.focus();
    expect(document.getElementById(bold.getAttribute("aria-describedby")!)!.textContent).toBe(
      t("rich.ribbon.unavailable", { command: bold.getAttribute("aria-label")!, reason: t("rich.ribbon.readonly") }),
    );
    bold.click();
    expect(onChange).not.toHaveBeenCalled();
    // Invio e Spazio non lo premono.
    for (const key of ["Enter", " "]) {
      const down = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      bold.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
    }
    const font = ribbon.querySelector<HTMLSelectElement>('[data-command="rich.font"] select')!;
    expect(font.disabled).toBe(true);
    // La scelta spenta non tiene il Tab della barra.
    expect(font.tabIndex).toBe(-1);
    // Trova si apre, cerca, e non offre di sostituire.
    named(t("rich.find")).click();
    const bar = parent.querySelector<HTMLElement>(".rich-findbar")!;
    expect(bar.hidden).toBe(false);
    const what = bar.querySelector<HTMLInputElement>("input")!;
    what.value = "ciao";
    what.dispatchEvent(new Event("input"));
    expect(bar.querySelector("[role=status]")!.textContent).toBe(t("rich.find.count", { current: "1", total: "1" }));
    const visible = (el: Element | null): boolean => !el || (!(el as HTMLElement).hidden && visible(el.parentElement));
    expect([...bar.querySelectorAll<HTMLButtonElement>("button")].filter(visible).map((b) => b.textContent)).toEqual([
      t("rich.find.previous"),
      t("rich.find.next"),
      "",
    ]);
    what.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(bar.hidden).toBe(true);
    // Il commento si legge nella sua scheda; non se ne scrivono, non si
    // risolvono, non si tolgono.
    const side = inspector(surface);
    named(t("rich.comments")).click();
    expect(side.host.querySelector(".rich-side-text")!.textContent).toBe("Da rivedere.");
    expect(side.host.querySelector(".rich-side-compose")?.hasAttribute("hidden")).toBe(true);
    expect([...side.host.querySelectorAll<HTMLButtonElement>("button")].filter(visible)).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
    surface.destroy();
    // La superficie smontata non porta più schede.
    expect(surface.panels!.list()).toEqual([]);
    side.close();
  });

  it("un documento importato si legge e dice perché non si scrive", async () => {
    const { parent, surface } = mount(() => Promise.resolve(engineModule));
    await flush();
    surface.buffer!.setDoc(JSON.stringify({ ...JSON.parse(SOURCE), readonly: "import" }));
    expect(parent.querySelector<HTMLElement>(".rich-notice")!.textContent).toBe(t("rich.readonly.import"));
    expect(parent.querySelector(".rich-content")?.textContent).toContain("ciao");
    expect(surface.editorActions!.editable()).toBe(false);
    surface.destroy();
  });

  it("un'azione della barra arriva alla sessione col riquadro, e la sola lettura la ferma", async () => {
    const { surface, onChange } = mount(() => Promise.resolve(engineModule));
    await flush();
    surface.buffer!.setDoc(SOURCE);
    surface.setReadOnly!(true);
    expect(surface.editorActions!.run("markdown.heading.1")).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    surface.setReadOnly!(false);
    expect(surface.editorActions!.run("markdown.heading.1")).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    const [pane, change] = onChange.mock.calls[0];
    expect(pane).toBe("pane");
    expect(JSON.parse(change.text).blocks[0].role).toEqual({ kind: "heading", level: 1 });
    expect(surface.buffer!.getDoc()).toBe(change.text);
    expect(surface.editorActions!.state("markdown.heading.1")).toEqual({ enabled: true, active: true });
    surface.destroy();
  });

  it("il menu del tasto destro dice cosa c'è al cursore, e in sola lettura lascia soltanto copiare", async () => {
    const { surface } = mount(() => Promise.resolve(engineModule));
    await flush();
    surface.buffer!.setDoc(JSON.stringify({
      format: "fub-rich",
      version: 1,
      blocks: [{ t: "para", role: { kind: "body" }, k: "P", c: [{ t: "text", x: "il sito", k: "R", href: "https://esempio.it" }] }],
    }));
    const menu = surface.contextMenu!(null)!;
    expect(menu.target.kind).toBe("link");
    const ids = (menu.context ?? []).map((entry) => (typeof entry === "string" ? entry : entry.id));
    expect(ids).toEqual(["rich.link.copy", "rich.link", "rich.link.remove"]);
    expect(menu.clipboard!.offers).toMatchObject({ cut: false, copy: false, paste: true });
    const underline = menu.format!.find((entry) => typeof entry !== "string" && entry.id === "rich.underline") as SurfaceMenuItem;
    expect(underline).toMatchObject({ label: t("rich.underline"), chord: "Mod-u", enabled: true, checked: false });
    expect(menu.miniBar).toBe(true);

    surface.setReadOnly!(true);
    const reading = surface.contextMenu!(null)!;
    expect(reading.format).toEqual([]);
    expect(reading.insert).toEqual([]);
    expect(reading.clipboard!.offers.paste).toBe(false);
    expect(reading.miniBar).toBe(false);
    expect(surface.miniBar!()).toBeNull();
    surface.destroy();
  });

  it("«Taglia» scrive negli appunti e soltanto dopo toglie la selezione", async () => {
    const written: string[] = [];
    const stop = declareClipboard(async (text) => void written.push(text));
    const { surface, onChange } = mount(() => Promise.resolve(engineModule));
    await flush();
    surface.buffer!.setDoc(SOURCE);
    surface.contextMenu!(null)!.clipboard!.run("select-all");
    const menu = surface.contextMenu!(null)!;
    expect(menu.target.kind).toBe("selection");
    menu.clipboard!.run("cut");
    await flush();
    expect(written).toEqual(["ciao"]);
    expect(onChange).toHaveBeenCalled();
    expect(surface.selectedText!()).toBeNull();
    stop();
    surface.destroy();
  });

  it("ogni gruppo della barra ha un nome", async () => {
    const { parent, surface } = mount(() => Promise.resolve(engineModule));
    await flush();
    surface.buffer!.setDoc(SOURCE);
    const groups = [...parent.ownerDocument.querySelectorAll(".rich-ribbon-group")];
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.getAttribute("role")).toBe("group");
      expect(group.getAttribute("aria-label")).toMatch(/\S/);
    }
    expect(groups.map((group) => group.getAttribute("aria-label"))).toContain(t("rich.ribbon.group.paragraph"));
    surface.destroy();
  });

  it("Ctrl+F apre la barra di ricerca del documento, non quella della shell; Ctrl+H anche Sostituisci", async () => {
    const { parent, surface } = mount(() => Promise.resolve(engineModule));
    await flush();
    surface.buffer!.setDoc(SOURCE);
    const bar = parent.querySelector<HTMLElement>(".rich-findbar")!;
    expect(bar.hidden).toBe(true);
    // La shell chiama `find()` per Ctrl+F: `true` vuol dire che non apre la sua.
    expect(surface.find!()).toBe(true);
    expect(bar.hidden).toBe(false);
    expect(bar.getAttribute("role")).toBe("search");
    expect(bar.contains(document.activeElement)).toBe(true);
    const replaceRow = bar.querySelectorAll<HTMLElement>(".rich-findbar-row")[2]!;
    expect(replaceRow.hidden).toBe(true);
    // Ctrl+H, nel testo, la apre con Sostituisci.
    surface.focus!();
    parent.querySelector(".rich-content")!.dispatchEvent(new KeyboardEvent("keydown", { key: "h", ctrlKey: true, bubbles: true }));
    expect(replaceRow.hidden).toBe(false);
    surface.destroy();
    expect(parent.querySelector(".rich-findbar")).toBeNull();
  });

  it("ogni riquadro della barra ha un titolo, i campi del kit e un'azione principale", async () => {
    const { parent, surface } = mount(() => Promise.resolve(engineModule));
    await flush();
    surface.buffer!.setDoc(SOURCE);
    // I pulsanti che aprono un riquadro; non i gruppi raccolti, che aprono
    // i loro controlli.
    const openers = [
      ...parent.ownerDocument.querySelectorAll<HTMLButtonElement>('.rich-ribbon button[aria-haspopup="dialog"]:not(.rich-ribbon-group-toggle)'),
    ].filter((opener) => !opener.closest<HTMLElement>("[data-command]")!.hidden && opener.getAttribute("aria-disabled") !== "true");
    // Senza pagina non c'è Intestazione; la pagina e il conteggio stanno in
    // Proprietà, nel pannello di destra.
    expect(openers.length).toBeGreaterThan(5);
    let opened = 0;
    for (const opener of openers) {
      opener.click();
      const name = opener.getAttribute("aria-label");
      // Intestazione e piè di pagina chiedono una sezione, che qui non c'è.
      if (opener.getAttribute("aria-expanded") !== "true") continue;
      opened += 1;
      const popover = document.querySelector<HTMLElement>(".kit-popover")!;
      const title = document.getElementById(popover.getAttribute("aria-labelledby") ?? "");
      expect(title?.classList.contains("rich-strip-panel-title"), name!).toBe(true);
      // I campi hanno la loro `label[for]`, come quelli del kit.
      for (const control of popover.querySelectorAll<HTMLElement>("input:not([type=checkbox]):not([type=color]), select, textarea")) {
        expect(control.classList.contains("kit-field-input"), name!).toBe(true);
        expect(popover.querySelector(`label[for="${control.id}"]`), name!).not.toBeNull();
      }
      // Un'azione principale, o i campioni che agiscono da sé.
      const primary = popover.querySelectorAll('.rich-strip-panel-actions .kit-button[data-kind="primary"]').length;
      const swatches = popover.querySelectorAll(".rich-strip-swatches").length;
      expect(primary + swatches, name!).toBe(1);
      expect(popover.querySelector("[style]:not(.rich-strip-swatch)"), name!).toBeNull();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(opener.getAttribute("aria-expanded"), name!).toBe("false");
    }
    expect(opened).toBeGreaterThanOrEqual(openers.length - 1);
    surface.destroy();
  });

  it("la mini-barra è quella della barra, ristretta, e smontata non lascia niente", async () => {
    const { surface } = mount(() => Promise.resolve(engineModule));
    await flush();
    surface.buffer!.setDoc(SOURCE);
    const host = document.createElement("div");
    document.body.append(host);
    const unmount = surface.miniBar!()!.mount(host);
    const mini = host.querySelector(".rich-ribbon-mini")!;
    expect(mini).not.toBeNull();
    expect(mini.querySelector('[data-command="markdown.bold"] button')).not.toBeNull();
    expect(mini.querySelector('[data-command="rich.font"] select')).not.toBeNull();
    expect(mini.querySelector('[data-command="rich.link"]')).toBeNull();
    unmount();
    expect(host.childElementCount).toBe(0);
    surface.destroy();
  });

  it("nello stretto la carta è larga quanto la vista, e un pulsante col numero dei commenti apre il pannello", async () => {
    const fits: (string | null)[] = [];
    class Captured extends engineModule.RichEngine {
      override fitPaper(...args: Parameters<engineModule.RichEngine["fitPaper"]>): void {
        fits.push(args[0]);
        super.fitPaper(...args);
      }
    }
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(560);
    try {
      const { parent, surface } = mount(() => Promise.resolve({ ...engineModule, RichEngine: Captured }));
      const comments = [
        { id: 7, by: "Ada", at: "2026-10-18T14:00:00Z", text: "Da rivedere." },
        { id: 8, by: "Bea", at: "2026-10-18T15:00:00Z", text: "Fatto.", parent: 7 },
        { id: 9, by: "Ada", at: "2026-10-18T16:00:00Z", text: "E qui?" },
      ];
      surface.buffer!.setDoc(JSON.stringify({ ...JSON.parse(SOURCE), comments }));
      await flush();
      expect(fits[fits.length - 1]).toBe("width");
      // Due fili: la risposta sta nel suo.
      const open = parent.querySelector<HTMLButtonElement>(".rich-side-open")!;
      expect(open.textContent).toBe("2");
      expect(open.getAttribute("aria-label")).toBe(t("rich.side.open", { count: "2" }));
      const side = inspector(surface);
      open.click();
      expect(side.host.querySelector(".rich-side-comments")).not.toBeNull();
      side.close();
      surface.destroy();
    } finally {
      width.mockRestore();
    }
  });

  it("scrivere, incollare e annullare non fanno partire nessuna corsa", async () => {
    // Il motore vero, di cui si tiene l'istanza per battere come la tastiera.
    let engine: engineModule.RichEngine | null = null;
    class Captured extends engineModule.RichEngine {
      constructor(...args: ConstructorParameters<typeof engineModule.RichEngine>) {
        super(...args);
        engine = this;
      }
    }
    const driver = createManualDriver();
    setMotionDriver(driver);
    try {
      const { surface, onChange } = mount(() => Promise.resolve({ ...engineModule, RichEngine: Captured }));
      await flush();
      surface.buffer!.setDoc(SOURCE);
      const e = engine as engineModule.RichEngine | null;
      expect(e).not.toBeNull();
      for (let i = 0; i < 50; i++) e!.dispatch(e!.state.tr.insertText("x"));
      expect(e!.pasteContent("incollato", null)).toBe(true);
      expect(e!.run("text.undo")).toBe(true);
      expect(onChange).toHaveBeenCalled();
      expect(driver.plays).toHaveLength(0);
      expect(activeMotions()).toBe(0);
      surface.destroy();
    } finally {
      setMotionDriver(null);
    }
  });
});

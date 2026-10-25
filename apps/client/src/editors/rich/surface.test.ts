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

function mount(load: () => Promise<typeof engineModule>) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const onChange = vi.fn();
  const surface = mountRichSurface(
    RICH_PROFILE,
    { paneId: "pane", documentId: "lettera.docx", parent, formatId: "docx" },
    { onChange, onSelectionChange: vi.fn(), loadEngine: load },
  );
  return { parent, surface, onChange };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  it("in sola lettura la striscia resta: si cerca e si leggono i commenti, il resto è spento col perché", async () => {
    const { parent, surface, onChange } = mount(() => Promise.resolve(engineModule));
    await flush();
    const comments = [{ id: 7, by: "Ada", at: "2026-10-18T14:00:00Z", text: "Da rivedere." }];
    surface.buffer!.setDoc(JSON.stringify({ ...JSON.parse(SOURCE), readonly: "protected", comments }));
    const strip = parent.querySelector<HTMLElement>(".rich-strip")!;
    expect(strip.hidden).toBe(false);
    const named = (label: string) => strip.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    // La sottolineatura è spenta, raggiungibile, e dice perché.
    const bold = strip.querySelector<HTMLButtonElement>('[data-action="rich.underline"]')!;
    expect(bold.getAttribute("aria-disabled")).toBe("true");
    bold.focus();
    expect(document.getElementById(bold.getAttribute("aria-describedby")!)!.textContent).toBe(
      t("rich.strip.readonly", { command: bold.getAttribute("aria-label")! }),
    );
    bold.click();
    expect(onChange).not.toHaveBeenCalled();
    expect(strip.querySelector<HTMLSelectElement>(".rich-strip-font")!.disabled).toBe(true);
    // Trova si apre, cerca, e non offre di sostituire.
    named(t("rich.find")).click();
    let popover = document.querySelector<HTMLElement>(".kit-popover")!;
    const what = popover.querySelector<HTMLInputElement>("input")!;
    what.value = "ciao";
    what.dispatchEvent(new Event("input"));
    expect(popover.querySelector("[role=status]")!.textContent).toBe(t("rich.find.count", { current: "1", total: "1" }));
    expect(popover.querySelectorAll("input[type=text]").length).toBe(1);
    expect([...popover.querySelectorAll<HTMLButtonElement>("button")].filter((b) => !b.hidden).map((b) => b.textContent)).toEqual([
      t("rich.find.previous"),
      t("rich.find.next"),
    ]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    // Il commento si legge; non se ne scrivono, non si risolvono, non si tolgono.
    named(t("rich.comments")).click();
    popover = document.querySelector<HTMLElement>(".kit-popover")!;
    expect(popover.querySelector(".rich-strip-comment-text")!.textContent).toBe("Da rivedere.");
    expect(popover.querySelector("textarea")).toBeNull();
    expect([...popover.querySelectorAll<HTMLButtonElement>("button")].filter((b) => !b.hidden).map((b) => b.textContent)).toEqual([
      t("rich.comment.go"),
    ]);
    expect(onChange).not.toHaveBeenCalled();
    surface.destroy();
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

  it("ogni gruppo della striscia ha un nome", async () => {
    const { parent, surface } = mount(() => Promise.resolve(engineModule));
    await flush();
    surface.buffer!.setDoc(SOURCE);
    const groups = [...parent.ownerDocument.querySelectorAll(".rich-strip-group")];
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.getAttribute("role")).toBe("group");
      expect(group.getAttribute("aria-label")).toMatch(/\S/);
    }
    expect(groups.map((group) => group.getAttribute("aria-label"))).toContain(t("rich.strip.group.paragraph"));
    surface.destroy();
  });

  it("ogni riquadro della striscia ha un titolo, i campi del kit e un'azione principale", async () => {
    const { parent, surface } = mount(() => Promise.resolve(engineModule));
    await flush();
    surface.buffer!.setDoc(SOURCE);
    const openers = [...parent.ownerDocument.querySelectorAll<HTMLButtonElement>(".rich-strip button[aria-haspopup]")];
    expect(openers.length).toBeGreaterThan(8);
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

  it("la mini-barra è la striscia ristretta, e smontata non lascia niente", async () => {
    const { surface } = mount(() => Promise.resolve(engineModule));
    await flush();
    surface.buffer!.setDoc(SOURCE);
    const host = document.createElement("div");
    document.body.append(host);
    const unmount = surface.miniBar!()!.mount(host);
    const mini = host.querySelector(".rich-strip-mini")!;
    expect(mini).not.toBeNull();
    expect(mini.querySelector(".rich-strip-bold")).not.toBeNull();
    expect(mini.querySelector(".rich-strip-font")).not.toBeNull();
    expect(mini.querySelector("[data-action='rich.link']")).toBeNull();
    // La striscia intera non ha l'enfasi: sta nella barra di formattazione.
    expect(document.querySelectorAll(".rich-strip-bold")).toHaveLength(1);
    unmount();
    expect(host.childElementCount).toBe(0);
    surface.destroy();
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

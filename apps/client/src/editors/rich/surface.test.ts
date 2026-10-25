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
});

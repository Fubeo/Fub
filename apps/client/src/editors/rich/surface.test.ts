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
});

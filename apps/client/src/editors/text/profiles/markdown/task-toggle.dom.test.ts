// @vitest-environment happy-dom
//
// La spunta di un compito ricorrente dalla casella nella nota (IMP-1802,
// IMP-3801): la riga successiva nasce nel buffer, nella stessa transazione
// della spunta, con la regola chiesta al componente dei compiti.
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { mountMarkdownSurface, type MarkdownSurface } from "./surface";
import { api } from "../../../../host/ipc";
import type { IndexQuery, IndexResult } from "../../../../host/contract";
import { t } from "../../../../i18n/strings";
import { toggleCheckbox } from "./commands";

const F24 = "- [ ] F24 mensile 🔁 every month 📅 2026-11-16";
const F24_NEXT = "- [ ] F24 mensile 🔁 every month 📅 2026-12-16";

interface Asked { line: string; today: string }

/// Il canale dati finto: risponde alla domanda della ricorrenza come la
/// regola di Rust per le righe del test, e alle impostazioni con niente.
function answering(next: (line: string) => string | null | Promise<string | null> | Error): Asked[] {
  const asked: Asked[] = [];
  vi.spyOn(api, "queryIndex").mockImplementation(async (query: IndexQuery): Promise<IndexResult> => {
    if (query.kind === "custom" && query.ns === "fub.tasks") {
      const q = query.query as { kind: string; version: number; line: string; today: string };
      expect(q.kind).toBe("next_occurrence");
      expect(q.version).toBe(1);
      asked.push({ line: q.line, today: q.today });
      const answer = await next(q.line);
      if (answer instanceof Error) throw answer;
      return { kind: "custom", value: { line: answer } };
    }
    return { kind: "settings", value: [] };
  });
  return asked;
}

function mount(onChange: (text: string) => void = () => {}): { ed: MarkdownSurface; parent: HTMLElement; view: () => EditorView } {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const ed = mountMarkdownSurface({ paneId: "riquadro", documentId: "Scadenzario fiscale.md", parent }, {
    onChange: (change) => onChange(change.text),
    onSelectionChange: () => {},
    onOpenWikilink: () => {},
    onOpenPath: () => {},
    onSearchTag: () => {},
    completions: { searchNotes: async () => [], listTags: async () => [] },
  });
  return {
    ed,
    parent,
    view: () => {
      const view = EditorView.findFromDOM(parent);
      if (!view) throw new Error("l'editor non è montato");
      return view;
    },
  };
}

/// Le promesse in volo arrivano in fondo.
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function liveBox(parent: HTMLElement, index = 0): HTMLInputElement {
  const boxes = parent.querySelectorAll<HTMLInputElement>(".cm-fub-checkbox");
  const box = boxes[index];
  if (!box) throw new Error(`nessuna casella ${index} in Scrittura`);
  return box;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("la spunta di un compito ricorrente nella nota", () => {
  it("in Scrittura fa nascere il successivo sopra, e Mod-z toglie spunta e riga insieme", async () => {
    const asked = answering((line) => (line === F24 ? F24_NEXT : null));
    const changes: string[] = [];
    const { ed, parent } = mount((text) => changes.push(text));
    ed.buffer.setDoc(`# Scadenze\n\n${F24}\n`);

    liveBox(parent).click();
    await settle();

    expect(asked.map((a) => a.line)).toEqual([F24]);
    expect(asked[0]!.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const done = `# Scadenze\n\n${F24_NEXT}\n- [x] F24 mensile 🔁 every month 📅 2026-11-16\n`;
    expect(ed.buffer.getDoc()).toBe(done);
    expect(changes[changes.length - 1], "la sessione riceve spunta e riga come una battuta").toBe(done);

    expect(ed.undo()).toBe(true);
    expect(ed.buffer.getDoc(), "un solo passo della cronologia").toBe(`# Scadenze\n\n${F24}\n`);
    ed.destroy();
  });

  it("in Lettura fa lo stesso", async () => {
    answering((line) => (line === F24 ? F24_NEXT : null));
    const { ed, parent } = mount();
    ed.buffer.setDoc(`${F24}\n`);
    ed.setMode("reading");
    const box = parent.querySelector<HTMLInputElement>(":scope > .pane-preview.markdown-rendered input[type=\"checkbox\"]");
    expect(box).not.toBeNull();
    box!.click();
    await settle();
    expect(ed.buffer.getDoc()).toBe(`${F24_NEXT}\n- [x] F24 mensile 🔁 every month 📅 2026-11-16\n`);
    ed.destroy();
  });

  it("dal menu del compito fa lo stesso", async () => {
    answering((line) => (line === F24 ? F24_NEXT : null));
    const { ed, view } = mount();
    ed.buffer.setDoc(`${F24}\n`);
    view().dispatch({ selection: { anchor: 8 } });
    const menu = ed.contextMenu!(null);
    const entry = (menu?.context ?? []).find((item) => typeof item !== "string" && item.label === t("editor_menu.task.done")) as
      | { run?: () => void }
      | undefined;
    expect(entry?.run, "il menu ha «Fatto»").toBeTruthy();
    entry!.run!();
    await settle();
    expect(ed.buffer.getDoc()).toBe(`${F24_NEXT}\n- [x] F24 mensile 🔁 every month 📅 2026-11-16\n`);
    ed.destroy();
  });

  it("Mod-Enter su più righe spunta tutte e fa nascere il successivo solo di quella che ricorre", async () => {
    answering((line) => (line === F24 ? F24_NEXT : null));
    const { ed, view } = mount();
    ed.setMode("source");
    ed.buffer.setDoc(`- [ ] Bolletta\n${F24}\n- voce\n`);
    view().dispatch({ selection: { anchor: 0, head: view().state.doc.length - 1 } });
    expect(toggleCheckbox(view())).toBe(true);
    await settle();
    expect(ed.buffer.getDoc()).toBe(`- [x] Bolletta\n${F24_NEXT}\n- [x] F24 mensile 🔁 every month 📅 2026-11-16\n- [ ] voce\n`);
    expect(ed.undo()).toBe(true);
    expect(ed.buffer.getDoc()).toBe(`- [ ] Bolletta\n${F24}\n- voce\n`);
    ed.destroy();
  });

  it("un compito che non ricorre si spunta subito e non chiede niente", () => {
    const asked = answering(() => null);
    const { ed, parent } = mount();
    ed.buffer.setDoc("- [ ] Chiamare il commercialista 📅 2026-11-16\n");
    liveBox(parent).click();
    expect(ed.buffer.getDoc()).toBe("- [x] Chiamare il commercialista 📅 2026-11-16\n");
    expect(asked).toEqual([]);
    ed.destroy();
  });

  it("togliere la spunta a un ricorrente non fa nascere niente", () => {
    const asked = answering(() => F24_NEXT);
    const { ed, parent } = mount();
    ed.buffer.setDoc("- [x] F24 mensile 🔁 every month 📅 2026-11-16\n");
    liveBox(parent).click();
    expect(ed.buffer.getDoc()).toBe(`${F24}\n`);
    expect(asked).toEqual([]);
    ed.destroy();
  });

  it("se la regola non risponde la spunta vale lo stesso, senza riga nuova", async () => {
    answering(() => new Error("componente dei compiti spento"));
    const { ed, parent } = mount();
    ed.buffer.setDoc(`${F24}\n`);
    liveBox(parent).click();
    await settle();
    expect(ed.buffer.getDoc()).toBe("- [x] F24 mensile 🔁 every month 📅 2026-11-16\n");
    ed.destroy();
  });

  it("se la riga cambia mentre la regola risponde non scrive niente, e due clic fanno una riga sola", async () => {
    let release: (value: string | null) => void = () => {};
    const asked = answering(() => new Promise<string | null>((resolve) => { release = resolve; }));
    const { ed, parent, view } = mount();
    ed.buffer.setDoc(`${F24}\n`);
    liveBox(parent).click();
    liveBox(parent).click();
    await settle();
    expect(asked, "il secondo clic sulla stessa casella non chiede di nuovo").toHaveLength(1);
    view().dispatch({ changes: { from: 6, insert: "Nuovo " }, userEvent: "input" });
    release(F24_NEXT);
    await settle();
    expect(ed.buffer.getDoc(), "la spunta e la riga vanno insieme o per niente").toBe("- [ ] Nuovo F24 mensile 🔁 every month 📅 2026-11-16\n");
    ed.destroy();
  });
});

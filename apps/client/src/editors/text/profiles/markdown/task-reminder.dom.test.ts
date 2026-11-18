// @vitest-environment happy-dom
//
// Il promemoria nella nota, su un editor vero (T36): la pastiglia blu con
// l'ora, il suo passaggio che dice quando suona e se le notifiche sono
// spente, il clic che apre la scelta del giorno e dell'ora, e il «/» — dalla
// voce del menu, con le sue parole, fino al testo del file.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { markdownGrammar } from "./grammar";
import { livePreview } from "./livepreview";
import { mountMarkdownSurface, type EditorSlashHost } from "./surface";
import { setReminderNotifications } from "./task-reminder";
import { openReminderPicker } from "./reminder-picker";
import { REMINDER_ENTRY, slashMenuEntries } from "../../../../panels/slash/entries";
import type { SlashMenuEntry, SlashPanelEvents } from "../../../core/editor-menu";
import { state } from "../../../../state/store";

// Mercoledì 18 novembre 2026, alle dieci.
const NOW = new Date(2026, 10, 18, 10, 0);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  // La scelta aperta si chiude come la chiude chi la usa, con Esc.
  for (let i = 0; i < 3 && picker(); i++) {
    picker()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  }
  setReminderNotifications(true);
  vi.useRealTimers();
  document.body.replaceChildren();
});

function live(doc: string, cursor = 0) {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [markdown({ base: markdownGrammar }), livePreview({ openWikilink() {}, searchTag() {} })],
    }),
  });
  return { view, pill: () => parent.querySelector<HTMLElement>(".cm-fub-reminder") };
}

const picker = () => document.querySelector<HTMLElement>(".cm-fub-reminder-picker");
const enter = (input: HTMLInputElement) =>
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

describe("la pastiglia del promemoria", () => {
  it("è blu con la sveglia e l'ora, col giorno se non è oggi", () => {
    const { view, pill } = live("Titolo\n\n- [ ] Chiama Anna ⏰ 2026-11-13 09:00\n- [ ] Scrivi ⏰ 2026-11-18 15:30\n");
    try {
      const pills = [...view.dom.querySelectorAll<HTMLElement>(".cm-fub-reminder")];
      expect(pills.map((each) => each.textContent)).toEqual(["ven 13 nov, 09:00", "15:30"]);
      expect(pill()!.querySelector("svg.cm-fub-reminder-figure")).not.toBeNull();
      expect(pill()!.getAttribute("role")).toBe("button");
      // Il testo del file resta quello: la pastiglia è soltanto come si vede.
      expect(view.state.doc.toString()).toContain("⏰ 2026-11-13 09:00");
    } finally {
      view.destroy();
    }
  });

  it("il passaggio dice quando suona, e che non suona se le notifiche sono spente", () => {
    const { view, pill } = live("Titolo\n\n- [ ] Chiama ⏰ 2026-11-20 09:00\n");
    try {
      expect(pill()!.title).toMatch(/^Promemoria: venerdì 20 novembre 2026, 09:00/);
      expect(pill()!.title).not.toMatch(/spente/);
      setReminderNotifications(false);
      pill()!.dispatchEvent(new PointerEvent("pointerenter"));
      expect(pill()!.title).toMatch(/Le notifiche dei promemoria sono spente/);
      expect(pill()!.getAttribute("aria-label")).toBe(pill()!.title);
    } finally {
      view.destroy();
    }
  });

  it("un compito fatto ha la pastiglia grigia, e il passaggio dice che non suona", () => {
    const { view, pill } = live("Titolo\n\n- [x] Chiama ⏰ 2026-11-20 09:00\n");
    try {
      expect(pill()!.classList.contains("cm-fub-reminder-done")).toBe(true);
      setReminderNotifications(false);
      pill()!.dispatchEvent(new PointerEvent("pointerenter"));
      expect(pill()!.title).toMatch(/compito fatto.*Non suona$/);
    } finally {
      view.destroy();
    }
  });

  it("il clic apre la scelta, e le parole scritte cambiano il promemoria nel file", async () => {
    const { view, pill } = live("Titolo\n\n- [ ] Chiama ⏰ 2026-11-13 09:00\n");
    try {
      pill()!.dispatchEvent(new MouseEvent("mousedown", { button: 0, bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(picker()).not.toBeNull());
      const input = picker()!.querySelector<HTMLInputElement>(".cm-fub-prop-date-field input")!;
      // Il giorno di adesso è scelto, l'ora è nel suo campo.
      expect(picker()!.querySelector("[data-selected]")?.getAttribute("data-day")).toBe("2026-11-13");
      expect(picker()!.querySelector<HTMLInputElement>('input[type="time"]')!.value).toBe("09:00");
      input.value = "venerdì 18:30";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      expect(picker()!.querySelector("[data-selected]")?.getAttribute("data-day")).toBe("2026-11-20");
      enter(input);
      expect(view.state.doc.toString()).toBe("Titolo\n\n- [ ] Chiama ⏰ 2026-11-20 18:30\n");
      expect(picker()).toBeNull();
    } finally {
      view.destroy();
    }
  });

  it("ciò che non si capisce resta scritto e lo dice, senza toccare il promemoria", () => {
    const doc = "- [ ] Chiama ⏰ 2026-11-13 09:00\n";
    const { view } = live(doc, doc.length);
    try {
      expect(openReminderPicker(view, 0, view.contentDOM)).toBe(true);
      const input = picker()!.querySelector<HTMLInputElement>(".cm-fub-prop-date-field input")!;
      input.value = "quando capita";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      expect(input.hasAttribute("aria-invalid")).toBe(true);
      enter(input);
      expect(picker()!.querySelector('[role="alert"]')!.textContent).toMatch(/Non capisco «quando capita»/);
      expect(view.state.doc.toString()).toBe(doc);
    } finally {
      view.destroy();
    }
  });

  it("un giorno del mese sceglie quel giorno all'ora del campo; «Togli» toglie il promemoria", () => {
    const doc = "- [ ] Chiama ⏰ 2026-11-13 09:00\n";
    const { view } = live(doc, doc.length);
    try {
      openReminderPicker(view, 0, view.contentDOM);
      const time = picker()!.querySelector<HTMLInputElement>('input[type="time"]')!;
      time.value = "07:45";
      picker()!.querySelector<HTMLButtonElement>('[data-day="2026-11-25"]')!.click();
      expect(view.state.doc.toString()).toBe("- [ ] Chiama ⏰ 2026-11-25 07:45\n");
      openReminderPicker(view, 0, view.contentDOM);
      const clear = [...picker()!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Togli il promemoria")!;
      clear.click();
      expect(view.state.doc.toString()).toBe("- [ ] Chiama\n");
    } finally {
      view.destroy();
    }
  });

  it("senza promemoria la scelta non ha «Togli», e dice se le notifiche sono spente", () => {
    const { view } = live("- [ ] Chiama\n", 3);
    try {
      setReminderNotifications(false);
      openReminderPicker(view, 0, view.contentDOM);
      expect([...picker()!.querySelectorAll("button")].some((b) => b.textContent === "Togli il promemoria")).toBe(false);
      expect(picker()!.querySelector<HTMLElement>(".cm-fub-reminder-silent")!.hidden).toBe(false);
      picker()!.querySelector<HTMLButtonElement>('[data-quick="2026-11-19"]')!.click();
      expect(view.state.doc.toString()).toBe("- [ ] Chiama ⏰ 2026-11-19 09:00\n");
    } finally {
      view.destroy();
    }
  });

  it("in sola lettura non si apre", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({ doc: "- [ ] Chiama\n", extensions: [markdown({ base: markdownGrammar }), EditorState.readOnly.of(true)] }),
    });
    try {
      expect(openReminderPicker(view, 0, view.contentDOM)).toBe(false);
      expect(picker()).toBeNull();
    } finally {
      view.destroy();
    }
  });
});

describe("il promemoria dal «/», fino al file", () => {
  function surface() {
    const parent = document.createElement("div");
    document.body.append(parent);
    let events: SlashPanelEvents | null = null;
    let has: (id: string) => boolean = () => false;
    const slash: EditorSlashHost = {
      currentDoc: () => "notes/current.md",
      onEffect: vi.fn(),
      notify: vi.fn(),
      flushPendingSave: vi.fn(async () => []),
      publishContext: vi.fn(async () => {}),
      menu: {
        enabled: () => true,
        panel(panelEvents, surfaceHas) {
          events = panelEvents;
          has = surfaceHas;
          return { dom: document.createElement("div"), listId: "lista", update() {}, key: () => false, placed() {}, close() {} };
        },
        chosen() {},
        palette() {},
      },
    };
    const previous = state.currentDoc;
    state.currentDoc = "notes/current.md";
    const ed = mountMarkdownSurface({ paneId: "riquadro", documentId: "notes/current.md", parent }, {
      onChange: () => {},
      onSelectionChange: () => {},
      onOpenWikilink: () => {},
      onOpenPath: () => {},
      onSearchTag: () => {},
      completions: { searchNotes: async () => [], listTags: async () => [] },
      slash,
    });
    const view = EditorView.findFromDOM(parent)!;
    const type = (text: string) => {
      for (const char of text) {
        const at = view.state.selection.main.head;
        view.dispatch({ changes: { from: at, insert: char }, selection: EditorSelection.cursor(at + 1), userEvent: "input.type" });
      }
    };
    /// Le voci che il menu vero mostrerebbe per `query`, con ciò che la
    /// superficie sa fare: la prima è quella che Invio sceglie.
    const offered = (query: string): readonly SlashMenuEntry[] => slashMenuEntries([], query, has).entries;
    const choose = (entry: SlashMenuEntry) => events!.choose({ entry, params: entry.params, below: false });
    const destroy = () => {
      ed.destroy();
      parent.remove();
      state.currentDoc = previous;
    };
    return { ed, view, type, offered, choose, destroy };
  }

  it("«/promemoria venerdì 9» fa della riga un compito col promemoria, in un passo", () => {
    const { ed, view, type, offered, choose, destroy } = surface();
    try {
      ed.buffer.setDoc("Chiama Anna ");
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      type("/promemoria venerdì 9");
      const first = offered("promemoria venerdì 9")[0]!;
      expect(first).toMatchObject({ id: REMINDER_ENTRY, quick: true, params: { date: "2026-11-20", time: "09:00" } });
      expect(first.label).toBe("Promemoria: venerdì 20 novembre, 09:00");
      choose(first);
      expect(ed.buffer.getDoc()).toBe("- [ ] Chiama Anna ⏰ 2026-11-20 09:00");
    } finally {
      destroy();
    }
  });

  it("«Promemoria» senza parole apre la scelta sul compito, e la scelta scrive il file", async () => {
    const { ed, view, type, offered, choose, destroy } = surface();
    try {
      ed.buffer.setDoc("- [ ] Manda il preventivo ");
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      type("/prome");
      const entry = offered("prome").find((each) => each.id === REMINDER_ENTRY)!;
      expect(entry).toMatchObject({ label: "Promemoria", icon: "fmt-alarm", section: "people" });
      choose(entry);
      // Il «/prome» è sparito; la riga era già un compito e resta com'è.
      expect(ed.buffer.getDoc()).toBe("- [ ] Manda il preventivo ");
      await vi.waitFor(() => expect(picker()).not.toBeNull());
      const input = picker()!.querySelector<HTMLInputElement>(".cm-fub-prop-date-field input")!;
      input.value = "domani alle 18:30";
      enter(input);
      expect(ed.buffer.getDoc()).toBe("- [ ] Manda il preventivo ⏰ 2026-11-19 18:30");
    } finally {
      destroy();
    }
  });

  it("dal gruppo «Compito» della barra, al cursore, senza «/» da togliere", async () => {
    const { ed, view, destroy } = surface();
    try {
      ed.buffer.setDoc("- [ ] Chiama\n");
      view.dispatch({ selection: { anchor: 3 } });
      expect(ed.editorActions?.has("markdown.reminder")).toBe(true);
      expect(ed.editorActions?.state("markdown.reminder").enabled).toBe(true);
      expect(ed.editorActions?.run("markdown.reminder", { date: "2026-11-21", time: "08:00" })).toBe(true);
      expect(ed.buffer.getDoc()).toBe("- [ ] Chiama ⏰ 2026-11-21 08:00\n");
      // Gli argomenti storti non scrivono: si apre la scelta.
      expect(ed.editorActions?.run("markdown.reminder", { date: "domani" })).toBe(true);
      await vi.waitFor(() => expect(picker()).not.toBeNull());
      expect(ed.buffer.getDoc()).toBe("- [ ] Chiama ⏰ 2026-11-21 08:00\n");
    } finally {
      destroy();
    }
  });
});

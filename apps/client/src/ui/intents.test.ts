// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

const notified = vi.hoisted(() => [] as Array<[string, string | undefined]>);
vi.mock("./notify", () => ({
  notify: (message: string, tone?: string) => notified.push([message, tone]),
}));
const editorRuns = vi.hoisted(() => ({ calls: [] as string[], outcome: "done" as "done" | "nothing" | "unavailable" }));
vi.mock("../panels/document", () => ({
  openDocument: vi.fn(),
  openFromView: vi.fn(),
  reveal: vi.fn(),
  runEditorAction: (action: string) => {
    editorRuns.calls.push(action);
    return editorRuns.outcome;
  },
}));
vi.mock("../panels/search", () => ({ searchFor: vi.fn() }));
// Il layout ricorda se stesso a ogni cambio: qui non c'è un backend a cui dirlo.
vi.mock("../host/ipc", () => ({ api: { setViewState: async () => {} } }));

import type { ViewSpec } from "../host/contract";
import { t } from "../i18n/strings";
import { activeTab, defaultLayout, layout, setLayout } from "../state/layout";
import {
  applyIntent,
  CLIPBOARD_TEXT_NS,
  setReloaderForTests,
  takeNoticeAfterReload,
  VAULT_RESTORED_NS,
} from "./intents";
import { setPrimaryViews } from "./primary-views";
import { EDITOR_ACTION_NS } from "../editors/core/editor-actions";

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

beforeEach(() => {
  notified.length = 0;
  editorRuns.calls.length = 0;
  editorRuns.outcome = "done";
});

describe("l'intento delle azioni dell'editor", () => {
  it("esegue l'azione nel riquadro col fuoco, senza dire niente se riesce", async () => {
    await applyIntent({ kind: "custom", ns: EDITOR_ACTION_NS, payload: { action: "markdown.bold" } });
    expect(editorRuns.calls).toEqual(["markdown.bold"]);
    expect(notified).toHaveLength(0);
  });

  it("senza una superficie che la sappia fare lo dice", async () => {
    editorRuns.outcome = "unavailable";
    await applyIntent({ kind: "custom", ns: EDITOR_ACTION_NS, payload: { action: "markdown.bold" } });
    expect(notified).toEqual([[t("format_bar.unavailable"), undefined]]);
  });

  it("un'azione che lì non ha niente da cambiare si dice col suo nome", async () => {
    editorRuns.outcome = "nothing";
    await applyIntent({ kind: "custom", ns: EDITOR_ACTION_NS, payload: { action: "markdown.table.row.after" } });
    expect(notified).toEqual([[t("format_bar.not_done", { action: "markdown.table.row.after" }), undefined]]);
  });

  it("un payload senza id non esegue niente", async () => {
    await applyIntent({ kind: "custom", ns: EDITOR_ACTION_NS, payload: { action: 3 } });
    expect(editorRuns.calls).toEqual([]);
    expect(notified).toHaveLength(0);
  });
});

describe("l'intento degli appunti", () => {
  it("mette il testo negli appunti e lo dice", async () => {
    const writeText = vi.fn(async () => {});
    clipboard(writeText);
    await applyIntent({ kind: "custom", ns: CLIPBOARD_TEXT_NS, payload: { text: "com'era\n" } });
    expect(writeText).toHaveBeenCalledWith("com'era\n");
    expect(notified).toHaveLength(1);
    expect(notified[0]![1]).toBeUndefined();
  });

  it("un rifiuto del sistema è un guasto detto, non una copia creduta", async () => {
    clipboard(async () => {
      throw new Error("negato");
    });
    await applyIntent({ kind: "custom", ns: CLIPBOARD_TEXT_NS, payload: { text: "x" } });
    expect(notified).toEqual([[expect.any(String), "guasto"]]);
  });

  it("un payload senza testo non scrive niente", async () => {
    const writeText = vi.fn(async () => {});
    clipboard(writeText);
    await applyIntent({ kind: "custom", ns: CLIPBOARD_TEXT_NS, payload: { text: 3 } });
    expect(writeText).not.toHaveBeenCalled();
    expect(notified).toHaveLength(0);
  });
});

describe("il vault ripristinato", () => {
  it("ricarica la finestra e lascia un avviso che si legge una volta sola", async () => {
    const reload = vi.fn();
    setReloaderForTests(reload);
    await applyIntent({ kind: "custom", ns: VAULT_RESTORED_NS, payload: { entries: 3 } });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(takeNoticeAfterReload()).toContain("snapshot");
    expect(takeNoticeAfterReload()).toBeNull();
  });
});

function mainView(id: string): ViewSpec {
  return {
    id,
    title: id,
    surface: "main",
    refresh: { kinds: [], topics: [], subjects: [], changes: [] },
    follows: [],
    params: [{ name: "doc", title: "doc", description: "", kind: { kind: "document" }, required: true }],
    icon: null,
    order: 0,
    open_by_default: false,
    preferred_size: null,
    closable: true,
  };
}

describe("una view aperta da un comando (OpenView)", () => {
  beforeEach(() => {
    setLayout(defaultLayout());
    setPrimaryViews([mainView("links")]);
  });

  it("apre l'istanza nel riquadro col fuoco, con i suoi argomenti", async () => {
    await applyIntent({ kind: "open_view", view: "links", params: { doc: "a.md" } });
    expect(activeTab(layout.focus)).toEqual({ k: "view", view: "links", params: { doc: "a.md" } });
    expect(notified).toEqual([]);
  });

  // Prima di questo ramo l'effetto arrivava alla shell e finiva nel vuoto: il
  // comando diceva «fatto» e nessun riquadro cambiava.
  it("una view che nessun riquadro può ospitare si dice e non apre niente", async () => {
    await applyIntent({ kind: "open_view", view: "outline", params: null });
    expect(layout.panes[layout.focus]!.tabs).toEqual([]);
    expect(notified).toEqual([[t("views.open_unavailable", { view: "outline" }), "guasto"]]);
  });
});

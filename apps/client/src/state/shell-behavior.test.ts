// Regressioni difensive per le decisioni pure della shell (P06):
// ordinamento palette, parser segnalibri/workspace, modello tab/history/link.
// Solo invarianti plausibilmente fragili: identità che ignora pin/stack,
// un-annuncio-per-gesto, severità contro file scritti a mano, futuro mai
// riscritto, fallback che nomina invece di cancellare. Niente wiring/DOM,
// niente snapshot di testo, niente conteggi di chiamate oltre il single-write.
import { describe, expect, it, vi } from "vitest";
import { orderCommands, parsePaletteHistory, type PaletteHistory } from "../ui/palette";
import type { CommandEntry } from "../ui/commands";
import {
  activateTab,
  closeOthers,
  split,
  closeUnpinned,
  defaultLayout,
  goBack,
  goForward,
  moveTab,
  moveTabToPane,
  openIn,
  parseLayout,
  rename,
  removeEverywhere,
  setPaneLink,
  setPinnedTab,
  setTabStack,
  type Layout,
} from "./layout";
import { parseBookmarkStore, parseBookmarkTarget } from "./bookmarks";
import { parseShellGeometry } from "./shell-geometry";
import { applyWorkspace, parseWorkspaceStore, saveWorkspace } from "./workspaces";
vi.mock("../host/query", () => ({ existingDocuments: async () => new Set<string>() }));

function command(id: string): CommandEntry {
  return {
    id,
    title: id,
    description: "",
    layer: "global",
    binding: null,
    declared: null,
    spec: null,
    run: null,
  };
}

function layoutWith(...docs: string[]): Layout {
  const l = defaultLayout();
  for (const doc of docs) openIn("main", doc, l);
  return l;
}

describe("l’ordine della palette", () => {
  it("preferiti, poi recenti, poi resto — e gli id ignoti non rompono niente", () => {
    const entries = [command("a"), command("b"), command("c")];
    const history: PaletteHistory = { recent: ["c", "missing"], favorites: ["b"] };
    expect(orderCommands(entries, history).map((e) => e.id)).toEqual(["b", "c", "a"]);
  });

  it("un file di stato rotto vale come memoria vuota", () => {
    expect(parsePaletteHistory({ recent: [1, "a", ""], favorites: "b" })).toEqual({
      recent: ["a"],
      favorites: [],
    });
  });
});

describe("le tab appuntate e i gruppi", () => {
  it("il pin non cambia l’identità: aprire di nuovo ci si sposta sopra", () => {
    const l = layoutWith("a.md");
    setPinnedTab("main", 0, true, l);
    openIn("main", "a.md", l);
    expect(l.panes.main.tabs).toHaveLength(1);
    expect(l.panes.main.tabs[0]).toMatchObject({ k: "doc", doc: "a.md", pinned: true });
  });

  it("le appuntate non si spostano fra riquadri e non si chiudono con le altre", () => {
    const l = layoutWith("a.md", "b.md", "c.md");
    setPinnedTab("main", 0, true, l);
    expect(moveTabToPane("main", 0, "ghost", l)).toBe(false);
    expect(closeOthers("main", 1, l)).toBe(1);
    expect(l.panes.main.tabs.map((t) => t.k === "doc" ? t.doc : "")).toEqual(["a.md", "b.md"]);
    expect(closeUnpinned("main", l)).toBe(1);
    expect(l.panes.main.tabs).toHaveLength(1);
  });

  it("riordinare tiene l’attiva sulla stessa tab", () => {
    const l = layoutWith("a.md", "b.md", "c.md");
    activateTab("main", 2, l);
    expect(moveTab("main", 2, 0, l)).toBe(true);
    expect(l.panes.main.tabs[0]).toMatchObject({ k: "doc", doc: "c.md" });
    expect(l.panes.main.active).toBe(0);
    expect(moveTab("main", 0, 9, l)).toBe(false);
  });

  it("lo stack si mette e si toglie, e sopravvive al giro su disco", () => {
    const l = layoutWith("a.md");
    setTabStack("main", 0, "  review ", l);
    expect(l.panes.main.tabs[0]).toMatchObject({ stack: "review" });
    const reread = parseLayout(JSON.parse(JSON.stringify(l)));
    expect(reread?.panes.main.tabs[0]).toMatchObject({ stack: "review" });
    setTabStack("main", 0, "   ", l);
    expect(l.panes.main.tabs[0]).not.toHaveProperty("stack");
  });

  it("pin/stack rotti valgono come file rovinato, non come «non appuntata»", () => {
    const bad = (tab: unknown) =>
      parseLayout({ tree: { k: "leaf", pane: "main" }, panes: { main: { tabs: [tab], active: 0, mode: "x" } }, focus: "main" });
    expect(bad({ k: "doc", doc: "a.md", pinned: "sì" })).toBeNull();
    expect(bad({ k: "doc", doc: "a.md", stack: 3 })).toBeNull();
  });
});

describe("la cronologia del riquadro", () => {
  it("indietro e avanti si muovono senza duplicare tab", () => {
    const l = layoutWith("a.md", "b.md");
    expect(goBack("main", l)).toBe(true);
    expect(l.panes.main.tabs[l.panes.main.active]).toMatchObject({ k: "doc", doc: "a.md" });
    expect(goForward("main", l)).toBe(true);
    expect(l.panes.main.tabs[l.panes.main.active]).toMatchObject({ k: "doc", doc: "b.md" });
    expect(goForward("main", l)).toBe(false);
  });

  it("una strada nuova azzera il futuro", () => {
    const l = layoutWith("a.md", "b.md");
    goBack("main", l);
    openIn("main", "c.md", l);
    expect(goForward("main", l)).toBe(false);
  });

  it("rename segue anche nella history, remove purga", () => {
    const l = layoutWith("a.md", "b.md", "c.md");
    goBack("main", l);
    rename("c.md", "z.md", l);
    expect(JSON.stringify(l.panes.main.history)).toContain("z.md");
    removeEverywhere("z.md", l);
    expect(JSON.stringify(l.panes.main.history ?? {})).not.toContain("z.md");
  });

  it("una tappa rotta vale come file rovinato; assente = migrato", () => {
    const base = { tree: { k: "leaf", pane: "main" }, panes: { main: { tabs: ["a.md"], active: 0, mode: "x" } }, focus: "main" };
    expect(parseLayout({ ...base, panes: { main: { ...(base.panes.main as object), history: { past: [42], future: [] } } } })).toBeNull();
    expect(parseLayout(base)?.panes.main.history).toBeUndefined();
  });
});

describe("i riquadri collegati", () => {
  it("stesso nome = stesse aperture, senza fuoco rubato", () => {
    const l = defaultLayout();
    const second = split("main", "row", l)!;
    setPaneLink("main", "linked", l);
    setPaneLink(second, "linked", l);
    openIn("main", "a.md", l);
    expect(l.panes[second].tabs).toHaveLength(1);
    expect(l.focus).toBe("main");
  });

  it("nomi diversi non si seguono; link vuoto = scollegato e persiste", () => {
    const l = defaultLayout();
    const second = split("main", "row", l)!;
    setPaneLink("main", "x", l);
    setPaneLink(second, "y", l);
    openIn("main", "a.md", l);
    expect(l.panes[second].tabs).toHaveLength(0);
    setPaneLink("main", "   ", l);
    const reread = parseLayout(JSON.parse(JSON.stringify(l)));
    expect(reread?.panes.main.link).toBeUndefined();
  });
});

describe("i segnalibri eterogenei", () => {
  it("ogni specie valida passa, ogni specie rotta no", () => {
    expect(parseBookmarkTarget({ k: "doc", doc: "a.md", heading: "H" })?.k).toBe("doc");
    expect(parseBookmarkTarget({ k: "folder", path: "P" })?.k).toBe("folder");
    expect(parseBookmarkTarget({ k: "search", query: "q" })?.k).toBe("search");
    expect(parseBookmarkTarget({ k: "view", view: "graph" })?.k).toBe("view");
    expect(parseBookmarkTarget({ k: "web", url: "https://x.example" })?.k).toBe("web");
    expect(parseBookmarkTarget({ k: "tabs", tabs: ["a.md", { k: "view", view: "graph" }] })?.k).toBe("tabs");
    expect(parseBookmarkTarget({ k: "doc", doc: "" })).toBeNull();
    expect(parseBookmarkTarget({ k: "web", url: "javascript:1" })).toBeNull();
    expect(parseBookmarkTarget({ k: "tabs", tabs: [] })).toBeNull();
    expect(parseBookmarkTarget({ k: "nave" })).toBeNull();
  });

  it("l’ignoto si conserva per le versioni future, il futuro non si riscrive", () => {
    const store = parseBookmarkStore({ v: 1, bookmarks: [], groups: [], domani: { x: 1 } });
    expect(store).toMatchObject({ v: 1 });
    expect(store).toHaveProperty("domani");
    expect(parseBookmarkStore({ v: 2, bookmarks: [], groups: [] })).toBeNull();
  });
  it("preserves unsupported bookmark entries without hiding valid targets", () => {
    const stored = parseBookmarkStore({
      v: 1,
      bookmarks: [
        { id: "ok", title: "Desk", created: 1, target: { k: "workspace", workspace: "w" } },
        { id: "later", title: "Later", created: 2, target: { k: "future-kind", token: "opaque" } },
      ],
      groups: [],
    });
    expect(stored?.bookmarks[0]?.target).toEqual({ k: "workspace", workspace: "w" });
    expect(stored?.quarantine?.bookmarks).toEqual([
      { id: "later", title: "Later", created: 2, target: { k: "future-kind", token: "opaque" } },
    ]);
  });

});

describe("i workspace nominati", () => {
  it("salva l’assetto reale e lo rilegge identico", () => {
    const live = layoutWith("a.md", "b.md");
    const saved = saveWorkspace(" Sera ", live, ["P"], null, {
      sidebar: { visible: false, width: 280 }, inspector: { visible: true, width: 300 },
      panel: "search", railOrder: ["search", "files"], hiddenPanels: ["files"],
    });
    expect(saved?.name).toBe("Sera");
    const reread = parseWorkspaceStore({ v: 1, workspaces: [saved] });
    expect(reread?.workspaces[0]?.layout.panes.main.tabs).toHaveLength(2);
    expect(reread?.workspaces[0]?.layout.focus).toBe(live.focus);
    expect(reread?.workspaces[0]?.geometry).toEqual(saved?.geometry);
  });

  it("l’apply scarta i doc mancanti e nomina le view non dichiarate", async () => {
    const live = defaultLayout();
    const saved = saveWorkspace("W", layoutWith("a.md"), [], null)!;
    const computed = await applyWorkspace(saved.id, live, () => false);
    expect(computed?.report.missingDocs).toEqual(["a.md"]);
    expect(computed?.layout.panes.main.tabs).toHaveLength(0);
  });
  it("quarantines only corrupt workspace pieces while retaining geometry, focus and valid tabs", () => {
    const layout = layoutWith("a.md", "b.md");
    const raw = {
      v: 1,
      workspaces: [
        { id: "saved", name: "Desk", layout, expanded: ["Folder", 4], activeSpace: null, updated: 42,
          geometry: { sidebar: { visible: false, width: 280 }, inspector: { visible: true, width: "bad" }, panel: "files" } },
        { id: "bad", name: "Broken", layout: { tree: null }, expanded: [], activeSpace: null, updated: 42 },
      ],
    };
    const stored = parseWorkspaceStore(raw);
    expect(stored?.workspaces).toHaveLength(1);
    expect(stored?.workspaces[0]?.layout.focus).toBe("main");
    expect(stored?.workspaces[0]?.expanded).toEqual(["Folder"]);
    expect(stored?.workspaces[0]?.geometry).toEqual({
      sidebar: { visible: false, width: 280 }, inspector: { visible: true }, panel: "files",
    });
    expect(stored?.quarantine).toHaveLength(3);
    expect(parseWorkspaceStore(JSON.parse(JSON.stringify(stored)))?.quarantine).toEqual(stored?.quarantine);
    expect(parseShellGeometry({ sidebar: { width: Number.POSITIVE_INFINITY } }).geometry.sidebar).toBeUndefined();
  });

  it("salvages healthy panes, tabs and history when one tab is corrupt", () => {
    const layout = layoutWith("a.md", "b.md");
    const second = split("main", "row", layout)!;
    openIn(second, "other.md", layout);
    layout.focus = second;
    const raw = structuredClone(layout);
    raw.panes.main.tabs.splice(1, 0, { k: "doc", doc: "broken.md", pinned: "yes" } as never);
    raw.panes.main.history = { past: [{ k: "doc", doc: "old.md" }, 13 as never], future: [] };
    const stored = parseWorkspaceStore({ v: 1, workspaces: [
      { id: "one", name: "Desk", layout: raw, expanded: [], activeSpace: null, updated: 1 },
    ] });
    expect(stored?.workspaces[0]?.layout.focus).toBe(second);
    expect(stored?.workspaces[0]?.layout.panes.main.tabs).toEqual(layout.panes.main.tabs);
    expect(stored?.workspaces[0]?.layout.panes.main.history?.past).toEqual([{ k: "doc", doc: "old.md" }]);
    expect(stored?.workspaces[0]?.layout.panes[second].tabs).toEqual(layout.panes[second].tabs);
    expect(stored?.quarantine).toHaveLength(2);
  });

});


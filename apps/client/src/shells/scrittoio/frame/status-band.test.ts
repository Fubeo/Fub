// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emit, state } from "../../../state/store";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { activeMotions, createManualDriver, setMotionDriver } from "../../../moto";

type Status = { indexing: string; watching: boolean } | null;

const world = vi.hoisted(() => ({
  status: (): Promise<unknown> => Promise.resolve({ indexing: "idle", watching: true }),
  statusAsked: 0,
  settings: (): Promise<unknown> => Promise.resolve([]),
  settingsAsked: 0,
  dirty: [] as string[],
  sessionListeners: new Set<() => void>(),
  settingListeners: new Set<(event: { key: string }) => void>(),
  languageListeners: new Set<() => void>(),
  language: "it",
  tab: null as { k: string } | null,
  pane: undefined as unknown,
  /// I riquadri per id, quando il test ne apre più d'uno.
  panes: null as Map<string, unknown> | null,
  layout: { focus: "p1" },
  zoomed: [] as number[],
  tooltips: new Map<Element, string>(),
  /// Il menu che la banda ha aperto per ultimo, e le modalità scelte.
  menu: null as null | {
    anchor: HTMLElement;
    items: { label: string; icon?: string; checked?: boolean; run?: () => void }[];
    onClose?: () => void;
  },
  menusClosed: 0,
  focused: [] as string[],
  modesSet: [] as string[],
}));

vi.mock("../../../host/query", () => ({
  vaultStatus: () => {
    world.statusAsked += 1;
    return world.status();
  },
  settings: () => {
    world.settingsAsked += 1;
    return world.settings();
  },
}));
vi.mock("../../../i18n/strings", () => ({
  t: (key: string, args?: Record<string, unknown>) =>
    [key, args ? JSON.stringify(args) : "", world.language === "it" ? "" : `(${world.language})`].filter(Boolean).join(" "),
  onLanguage: (listener: () => void) => {
    world.languageListeners.add(listener);
    return () => world.languageListeners.delete(listener);
  },
}));
vi.mock("../../../state/document-controller", () => ({
  paneOf: (id: string) => (world.panes ? world.panes.get(id) : world.pane),
  selectedMode: (pane: { mode?: { label(): string } } | undefined) => pane?.mode,
  setMode: (id: string) => {
    world.modesSet.push(id);
    return Promise.resolve();
  },
}));
vi.mock("../../../ui/commands", () => ({
  allCommands: () => [],
  displayBinding: () => "",
}));
vi.mock("../../../ui/menu", () => ({
  showContextMenu: (anchor: HTMLElement, items: NonNullable<typeof world.menu>["items"], options: { onClose?: () => void } = {}) => {
    world.menu = { anchor, items, onClose: options.onClose };
  },
  closeContextMenu: () => {
    const open = world.menu;
    if (!open) return;
    world.menu = null;
    world.menusClosed += 1;
    open.onClose?.();
  },
}));
vi.mock("../../../state/document-session", () => ({
  documentSessions: {
    dirtyIds: () => world.dirty,
    subscribe: (listener: () => void) => {
      world.sessionListeners.add(listener);
      return () => world.sessionListeners.delete(listener);
    },
  },
}));
vi.mock("../../../state/kernel", () => ({
  onEvent: (_type: string, listener: (event: { key: string }) => void) => {
    world.settingListeners.add(listener);
    return () => world.settingListeners.delete(listener);
  },
}));
vi.mock("../../../state/layout", () => ({
  activeTab: () => world.tab,
  layout: world.layout,
  pane: (id: string) => (world.panes ? world.panes.get(id) : world.pane) ? { id } : undefined,
  focusPane: (id: string) => {
    world.focused.push(id);
    world.layout.focus = id;
  },
}));
vi.mock("../../../state/zoom", () => ({
  zoomBy: (delta: number) => {
    world.zoomed.push(delta);
    return Promise.resolve();
  },
}));
vi.mock("../../../ui/tooltip", () => ({
  setTooltip: (el: Element, text: string) => world.tooltips.set(el, text),
}));

import { mountStatusBand } from "./status-band";

let life: Lifetime;

const el = (id: string): HTMLElement => document.getElementById(id)!;
/// Lascia arrivare le letture e gli osservatori.
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 6; turn++) await Promise.resolve();
  await new Promise((done) => setTimeout(done, 0));
};

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/// Il ruolo di una modalità dal suo nome, come lo dichiarano le superfici vere.
const ROLE: Record<string, string> = { Lettura: "reading", Sorgente: "source" };

/// Un riquadro con `modes` modalità: la prima è quella accesa, col nome dato.
function surface(modes: number, label = "Live"): unknown {
  const active = { id: "m0", contextMode: ROLE[label] ?? "live_preview", label: () => label };
  const others = Array.from({ length: Math.max(0, modes - 1) }, (_, i) => ({
    id: `m${i + 1}`,
    contextMode: "live_preview",
    label: () => `Altra ${i + 1}`,
  }));
  return { surface: { modes: [active, ...others] }, mode: active };
}

beforeEach(() => {
  document.body.innerHTML = `
    <span id="vault-path">Vault del banco</span>
    <div id="panes"><div class="pane" id="p1"></div></div>
    <footer id="status-band">
      <span id="status-index" hidden></span>
      <span id="status-saving" hidden></span>
      <div id="status-end">
        <button type="button" id="status-mode" class="status-mode" aria-haspopup="menu" aria-expanded="false" hidden></button>
      </div>
      <button id="status-fit-width" hidden></button>
      <button id="status-fit-page" hidden></button>
      <button id="status-zoom" hidden></button>
    </footer>`;
  world.status = () => Promise.resolve({ indexing: "idle", watching: true } satisfies Status);
  world.settings = () => Promise.resolve([]);
  world.statusAsked = 0;
  world.settingsAsked = 0;
  world.dirty = [];
  world.sessionListeners.clear();
  world.settingListeners.clear();
  world.languageListeners.clear();
  world.language = "it";
  world.tab = null;
  world.pane = undefined;
  world.panes = null;
  world.layout.focus = "p1";
  world.zoomed = [];
  world.tooltips.clear();
  world.menu = null;
  world.menusClosed = 0;
  world.focused = [];
  world.modesSet = [];
  state.vaultRoot = "/casa/vault";
  life = openLifetime();
});

afterEach(() => {
  life.close();
  state.vaultRoot = "";
  document.body.replaceChildren();
});

describe("il vault", () => {
  it("non ripete il nome che il chip dice già", () => {
    mountStatusBand(life);
    expect(document.getElementById("status-band")!.textContent).not.toContain("Vault del banco");
  });

  it("senza un vault non dice niente", () => {
    state.vaultRoot = "";
    mountStatusBand(life);
    for (const id of ["status-index", "status-saving", "status-mode"]) {
      expect(el(id).hidden, id).toBe(true);
    }
    expect(world.statusAsked).toBe(0);
  });
});

describe("l'indice", () => {
  it("a posto non dice niente", async () => {
    mountStatusBand(life);
    await settle();
    expect(el("status-index").hidden).toBe(true);
  });

  it("dice che sta indicizzando", async () => {
    world.status = () => Promise.resolve({ indexing: "running", watching: true });
    mountStatusBand(life);
    await settle();
    expect(el("status-index").textContent).toBe("frame.status.indexing");
    expect(el("status-index").dataset.tone).toBe("busy");
  });

  it("dice che il disco non è sorvegliato", async () => {
    world.status = () => Promise.resolve({ indexing: "idle", watching: false });
    mountStatusBand(life);
    await settle();
    expect(el("status-index").textContent).toBe("frame.status.unwatched");
    expect(el("status-index").dataset.tone).toBe("warn");
  });

  it("una lettura fallita non lascia una frase vecchia", async () => {
    world.status = () => Promise.resolve({ indexing: "running", watching: true });
    mountStatusBand(life);
    await settle();
    world.status = () => Promise.reject(new Error("giù"));
    emit("documents");
    await settle();
    expect(el("status-index").hidden).toBe(true);
  });

  it("rilegge quando cambiano i documenti", async () => {
    mountStatusBand(life);
    await settle();
    const before = world.statusAsked;
    emit("documents");
    await settle();
    expect(world.statusAsked).toBe(before + 1);
  });

  it("la risposta di un vault già chiuso non scrive", async () => {
    const slow = deferred<Status>();
    world.status = () => slow.promise;
    mountStatusBand(life);
    state.vaultRoot = "";
    emit("vault", "");
    slow.resolve({ indexing: "running", watching: true });
    await settle();
    expect(el("status-index").hidden).toBe(true);
    expect(el("status-index").textContent).toBe("");
  });

  it("di due letture vale l'ultima partita", async () => {
    const first = deferred<Status>();
    world.status = () => first.promise;
    mountStatusBand(life);
    world.status = () => Promise.resolve({ indexing: "idle", watching: false });
    emit("documents");
    await settle();
    first.resolve({ indexing: "running", watching: true });
    await settle();
    expect(el("status-index").textContent).toBe("frame.status.unwatched");
  });
});

describe("il salvataggio", () => {
  it("dice che è tutto salvato", () => {
    mountStatusBand(life);
    expect(el("status-saving").textContent).toBe("frame.status.saved");
    expect(el("status-saving").dataset.tone).toBe("ok");
  });

  it("conta ciò che è aperto e non salvato, non solo il foglio a fuoco", () => {
    mountStatusBand(life);
    world.dirty = ["a", "b"];
    for (const listener of world.sessionListeners) listener();
    expect(el("status-saving").textContent).toBe('frame.status.unsaved {"count":2}');
    expect(el("status-saving").dataset.tone).toBe("busy");
    world.dirty = [];
    for (const listener of world.sessionListeners) listener();
    expect(el("status-saving").textContent).toBe("frame.status.saved");
  });
});

describe("la modalità", () => {
  it("si dice solo se la superficie ne ha più d'una", () => {
    world.tab = { k: "doc" };
    world.pane = surface(3, "Lettura");
    mountStatusBand(life);
    expect(el("status-mode").textContent).toBe("Lettura");
    world.pane = surface(1);
    emit("layout");
    expect(el("status-mode").hidden).toBe(true);
  });

  it("una linguetta che non è un documento non ha modalità", () => {
    world.tab = { k: "view" };
    world.pane = surface(3);
    mountStatusBand(life);
    expect(el("status-mode").hidden).toBe(true);
  });

  it("rilegge quando il controllore scrive la modalità sul riquadro", async () => {
    world.tab = { k: "doc" };
    world.pane = surface(3, "Live");
    mountStatusBand(life);
    world.pane = surface(3, "Sorgente");
    el("p1").dataset.mode = "source";
    await settle();
    expect(el("status-mode").textContent).toBe("Sorgente");
  });

  it("con due riquadri dice quella del riquadro a fuoco, e cambia quando il fuoco passa", () => {
    world.tab = { k: "doc" };
    world.panes = new Map([
      ["p1", surface(4, "Live")],
      ["p2", surface(3, "Sorgente")],
    ]);
    mountStatusBand(life);
    expect(el("status-mode").textContent).toBe("Live");
    world.layout.focus = "p2";
    emit("layout");
    expect(el("status-mode").textContent).toBe("Sorgente");
    world.layout.focus = "p1";
    emit("layout");
    expect(el("status-mode").textContent).toBe("Live");
  });

  it("una superficie con una modalità sola, come un'immagine, non la dice", () => {
    world.tab = { k: "doc" };
    world.panes = new Map([
      ["p1", surface(4, "Live")],
      ["p2", surface(1, "Immagine")],
    ]);
    mountStatusBand(life);
    expect(el("status-mode").hidden).toBe(false);
    world.layout.focus = "p2";
    emit("layout");
    expect(el("status-mode").hidden).toBe(true);
    expect(el("status-mode").textContent).toBe("");
  });

  it("è un bottone con la figura, il nome e la freccia della modalità del riquadro a fuoco (T3)", () => {
    world.tab = { k: "doc" };
    world.panes = new Map([
      ["p1", surface(4, "Live")],
      ["p2", surface(3, "Sorgente")],
    ]);
    mountStatusBand(life);
    const button = el("status-mode");
    const figure = () => button.querySelector(":scope > svg")?.getAttribute("data-icon");
    const name = () => button.querySelector(":scope > .status-mode-name")?.textContent;
    expect(button.tagName).toBe("BUTTON");
    expect(figure()).toBe("pen");
    expect(name()).toBe("Live");
    const arrow = button.querySelector<HTMLElement>(":scope > .status-mode-arrow")!;
    expect(arrow.getAttribute("aria-hidden")).toBe("true");
    expect(arrow.querySelector("svg")?.getAttribute("data-icon")).toBe("chevron-up");
    expect(button.lastElementChild).toBe(arrow);
    expect(button.getAttribute("aria-label")).toBe('document.toolbar.mode_current {"mode":"Live"}');
    // Lo stesso giro senza cambiare modalità non riscrive la figura.
    const svg = button.querySelector(":scope > svg");
    emit("layout");
    expect(button.querySelector(":scope > svg")).toBe(svg);
    world.layout.focus = "p2";
    emit("layout");
    expect(figure()).toBe("code");
    expect(name()).toBe("Sorgente");
    expect(button.getAttribute("aria-label")).toBe('document.toolbar.mode_current {"mode":"Sorgente"}');
  });

  it("la figura che l'editor registra col motore arriva quando la superficie si fa sentire", async () => {
    const { registerIcon } = await import("../../../ui/icons");
    const listeners = new Set<() => void>();
    const status = {
      items: () => [],
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
    const active = { id: "page", contextMode: "live_preview", icon: "t3-figura-tarda", label: () => "Pagina" };
    world.tab = { k: "doc" };
    world.pane = { surface: { modes: [active, { id: "read", contextMode: "reading", label: () => "Lettura" }], status }, mode: active };
    mountStatusBand(life);
    const figure = () => el("status-mode").querySelector(":scope > svg")?.getAttribute("data-icon");
    // Finché nessuno la disegna vale quella del ruolo.
    expect(figure()).toBe("pen");
    const release = registerIcon("t3-figura-tarda", ["M4 4h16"]);
    try {
      for (const listener of listeners) listener();
      expect(figure()).toBe("t3-figura-tarda");
    } finally {
      release();
    }
  });

  it("il clic apre il menu del riquadro a fuoco, e la voce cambia la modalità di quel riquadro", () => {
    world.tab = { k: "doc" };
    world.panes = new Map([
      ["p1", surface(4, "Live")],
      ["p2", surface(3, "Sorgente")],
    ]);
    world.layout.focus = "p2";
    mountStatusBand(life);
    const button = el("status-mode");
    button.click();
    expect(world.menu?.anchor).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(world.menu!.items.map((item) => item.label)).toEqual(["Altra 1", "Altra 2", "Sorgente"]);
    expect(world.menu!.items.filter((item) => item.checked).map((item) => item.label)).toEqual(["Sorgente"]);
    // Il menu, chiudendosi, renderebbe il fuoco all'editor dell'altro riquadro:
    // la voce sceglie lo stesso per il suo.
    world.layout.focus = "p1";
    world.menu!.items[0]!.run!();
    expect(world.focused.at(-1)).toBe("p2");
    expect(world.layout.focus).toBe("p2");
    expect(world.modesSet).toEqual(["m1"]);
  });

  it("↑ apre il menu, e alla chiusura il fuoco torna al bottone", () => {
    world.tab = { k: "doc" };
    world.pane = surface(3, "Live");
    mountStatusBand(life);
    const button = el("status-mode") as HTMLButtonElement;
    const other = document.createElement("button");
    document.body.append(other);
    other.focus();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(world.menu).toBeNull();
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    expect(world.menu?.anchor).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    // Esc o un clic fuori: il menu si chiude e il fuoco torna qui, anche se il
    // clic non gliel'aveva dato.
    world.menu!.onClose!();
    world.menu = null;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("una superficie con una modalità sola non apre niente", () => {
    world.tab = { k: "doc" };
    world.pane = surface(1, "Immagine");
    mountStatusBand(life);
    el("status-mode").click();
    expect(world.menu).toBeNull();
  });

  it("il riquadro si chiude col menu aperto: il menu si chiude", () => {
    world.tab = { k: "doc" };
    world.panes = new Map([
      ["p1", surface(4, "Live")],
      ["p2", surface(3, "Sorgente")],
    ]);
    world.layout.focus = "p2";
    mountStatusBand(life);
    el("status-mode").click();
    expect(world.menu).not.toBeNull();
    // Il fuoco che passa all'altro riquadro non chiude niente: il menu è del
    // riquadro per cui si è aperto.
    world.layout.focus = "p1";
    emit("layout");
    expect(world.menusClosed).toBe(0);
    world.panes.delete("p2");
    emit("layout");
    expect(world.menusClosed).toBe(1);
    expect(el("status-mode").getAttribute("aria-expanded")).toBe("false");
  });

  it("smontata col menu aperto lo chiude, e il bottone non apre più", () => {
    world.tab = { k: "doc" };
    world.pane = surface(3, "Live");
    mountStatusBand(life);
    el("status-mode").click();
    life.close();
    expect(world.menusClosed).toBe(1);
    el("status-mode").click();
    expect(world.menu).toBeNull();
  });

  it("il fuoco su un riquadro vuoto non dice niente, e tornato sulla nota la ridice", () => {
    world.tab = { k: "doc" };
    world.panes = new Map([["p1", surface(4, "Live")], ["p2", { surface: null }]]);
    mountStatusBand(life);
    expect(el("status-mode").textContent).toBe("Live");
    world.layout.focus = "p2";
    world.tab = null;
    emit("layout");
    expect(el("status-mode").hidden).toBe(true);
    world.layout.focus = "p1";
    world.tab = { k: "doc" };
    emit("layout");
    expect(el("status-mode").hidden).toBe(false);
    expect(el("status-mode").textContent).toBe("Live");
  });
});

describe("la carta adattata alla vista", () => {
  /// Una superficie che offre gli adattamenti finché è in Pagina; `changed`
  /// è ciò che dice quando le offerte cambiano.
  function paperPane(inPage: { value: boolean }) {
    let fit: "width" | "page" | null = null;
    const asked: ("width" | "page" | null)[] = [];
    const listeners = new Set<() => void>();
    const changed = () => {
      for (const listener of listeners) listener();
    };
    const pane = {
      surface: {
        modes: [{ id: "document" }, { id: "writing" }],
        paperFit: {
          offers: () => (inPage.value ? (["width", "page"] as const) : []),
          current: () => fit,
          set: (next: "width" | "page" | null) => {
            fit = next;
            asked.push(next);
          },
          subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      },
      mode: { label: () => "Pagina" },
    };
    return { pane, asked, changed, listeners };
  }

  it("si offre soltanto dove la superficie lo offre, e un altro clic torna alla carta vera", async () => {
    const inPage = { value: true };
    const { pane, asked, changed } = paperPane(inPage);
    world.tab = { k: "doc" };
    world.pane = pane;
    mountStatusBand(life);
    await settle();
    const width = el("status-fit-width");
    const whole = el("status-fit-page");
    expect([width.hidden, whole.hidden]).toEqual([false, false]);
    expect(width.textContent).toBe("frame.status.fit.width");
    expect(width.getAttribute("aria-pressed")).toBe("false");
    width.click();
    expect(width.getAttribute("aria-pressed")).toBe("true");
    whole.click();
    expect([width.getAttribute("aria-pressed"), whole.getAttribute("aria-pressed")]).toEqual(["false", "true"]);
    whole.click();
    expect(asked).toEqual(["width", "page", null]);
    // Fuori da Pagina, e senza la capacità, non si vede.
    inPage.value = false;
    changed();
    expect([width.hidden, whole.hidden]).toEqual([true, true]);
    world.pane = surface(3);
    for (const listener of world.languageListeners) listener();
    expect(width.hidden).toBe(true);
  });

  it("si accende quando la pagina arriva dopo il riquadro, e lascia la superficie che non è più a fuoco", async () => {
    const inPage = { value: false };
    const { pane, changed, listeners } = paperPane(inPage);
    world.tab = { k: "doc" };
    world.pane = pane;
    mountStatusBand(life);
    await settle();
    expect(el("status-fit-width").hidden).toBe(true);
    // Il motore è pronto: la superficie lo dice, senza un evento della shell.
    inPage.value = true;
    changed();
    expect(el("status-fit-width").hidden).toBe(false);
    world.pane = surface(3);
    for (const listener of world.languageListeners) listener();
    expect(listeners.size).toBe(0);
  });

  it("chiusa la banda, non ascolta più la superficie", async () => {
    const { pane, listeners } = paperPane({ value: true });
    world.tab = { k: "doc" };
    world.pane = pane;
    mountStatusBand(life);
    await settle();
    expect(listeners.size).toBe(1);
    life.close();
    expect(listeners.size).toBe(0);
  });
});

describe("le voci della superficie", () => {
  function statusPane() {
    const listeners = new Set<() => void>();
    const said = { items: [] as { id: string; text: string; hint?: string; open?: () => void }[] };
    const pane = {
      surface: {
        modes: [{ id: "a" }, { id: "b" }],
        status: {
          counts: true,
          items: () => said.items,
          subscribe(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
      },
      mode: { label: () => "Pagina" },
    };
    const changed = () => {
      for (const listener of [...listeners]) listener();
    };
    return { pane, said, changed, listeners };
  }
  const items = () => [...document.querySelectorAll<HTMLElement>("[data-surface-item]")];

  it("stanno prima della modalità, un clic apre, e il conteggio dichiarato si fa da parte", async () => {
    const { pane, said, changed } = statusPane();
    const opened: string[] = [];
    said.items = [
      { id: "page", text: "Pagina 1 di 2" },
      { id: "words", text: "418 parole", hint: "Apri il conteggio", open: () => opened.push("words") },
    ];
    world.tab = { k: "doc" };
    world.pane = pane;
    mountStatusBand(life);
    await settle();
    expect(items().map((each) => [each.tagName, each.textContent])).toEqual([
      ["SPAN", "Pagina 1 di 2"],
      ["BUTTON", "418 parole"],
    ]);
    expect(items()[1]!.nextElementSibling).toBe(el("status-mode"));
    expect(world.tooltips.get(items()[1]!)).toBe("Apri il conteggio");
    expect(el("status-band").hasAttribute("data-surface-counts")).toBe(true);
    items()[1]!.click();
    expect(opened).toEqual(["words"]);
    // Una selezione cambia il numero: lo stesso pulsante, che tiene il fuoco.
    const words = items()[1]!;
    words.focus();
    said.items = [said.items[0]!, { ...said.items[1]!, text: "12 di 418 parole" }, { id: "tracking", text: "Registra" }];
    changed();
    expect(items()[1]).toBe(words);
    expect(document.activeElement).toBe(words);
    expect(items().map((each) => each.textContent)).toEqual(["Pagina 1 di 2", "12 di 418 parole", "Registra"]);
    // Scrittura: niente fogli.
    said.items = said.items.slice(1);
    changed();
    expect(items().map((each) => each.dataset.surfaceItem)).toEqual(["words", "tracking"]);
  });

  it("una superficie senza voci, o fuori fuoco, non lascia niente e non è più ascoltata", async () => {
    const { pane, said, listeners } = statusPane();
    said.items = [{ id: "words", text: "3 parole" }];
    world.tab = { k: "doc" };
    world.pane = pane;
    mountStatusBand(life);
    await settle();
    expect(items()).toHaveLength(1);
    world.pane = surface(3);
    for (const listener of world.languageListeners) listener();
    expect(items()).toHaveLength(0);
    expect(listeners.size).toBe(0);
    expect(el("status-band").hasAttribute("data-surface-counts")).toBe(false);
    world.pane = pane;
    for (const listener of world.languageListeners) listener();
    expect(listeners.size).toBe(1);
    life.close();
    expect(listeners.size).toBe(0);
    expect(items()).toHaveLength(0);
  });
});

describe("il segno che si accende", () => {
  it("«Registra» batte una volta quando si accende, non quando si torna al documento", async () => {
    const driver = createManualDriver();
    setMotionDriver(driver);
    try {
      const listeners = new Set<() => void>();
      const said = { items: [{ id: "words", text: "3 parole" }] as { id: string; text: string; beat?: boolean }[] };
      const status = {
        counts: true,
        items: () => said.items,
        subscribe(listener: () => void) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      };
      const pane = { surface: { modes: [{ id: "a" }], status }, mode: { label: () => "Pagina" } };
      world.tab = { k: "doc" };
      world.pane = pane;
      mountStatusBand(life);
      await settle();
      expect(driver.plays).toHaveLength(0);
      // Si accende: un battito, sulla scala, con la molla.
      said.items = [...said.items, { id: "tracking", text: "Registra", beat: true }];
      for (const listener of [...listeners]) listener();
      const sign = document.querySelector<HTMLElement>('[data-surface-item="tracking"]')!;
      expect(driver.plays.map((play) => play.el)).toEqual([sign]);
      expect(driver.plays[0]!.keyframes.every((frame) => frame.opacity === undefined)).toBe(true);
      // Ridisegnare non batte di nuovo.
      for (const listener of [...listeners]) listener();
      expect(driver.plays).toHaveLength(1);
      driver.advance(2000);
      expect(activeMotions()).toBe(0);
      // Un altro foglio, poi di nuovo il documento che registra già: niente.
      world.pane = surface(3);
      for (const listener of world.languageListeners) listener();
      world.pane = pane;
      for (const listener of world.languageListeners) listener();
      expect(document.querySelector('[data-surface-item="tracking"]')).not.toBeNull();
      expect(driver.plays).toHaveLength(1);
    } finally {
      setMotionDriver(null);
    }
  });
});

describe("lo zoom", () => {
  const zoomAt = (value: unknown) => () => Promise.resolve([{ spec: { key: "appearance.zoom" }, value }]);

  it("al cento per cento non si vede", async () => {
    world.settings = zoomAt(1);
    mountStatusBand(life);
    await settle();
    expect(el("status-zoom").hidden).toBe(true);
  });

  it("fuori dal cento si vede, con la percentuale, e un clic lo riporta", async () => {
    world.settings = zoomAt(1.25);
    mountStatusBand(life);
    await settle();
    const zoom = el("status-zoom");
    expect(zoom.hidden).toBe(false);
    expect(zoom.textContent).toBe("125%");
    expect(zoom.getAttribute("aria-label")).toBe('frame.status.zoom {"percent":125}');
    zoom.click();
    expect(world.zoomed).toEqual([0]);
  });

  it("rilegge quando cambia lo zoom, non per un'altra impostazione", async () => {
    world.settings = zoomAt(1);
    mountStatusBand(life);
    await settle();
    const before = world.settingsAsked;
    for (const listener of world.settingListeners) listener({ key: "appearance.font" });
    await settle();
    expect(world.settingsAsked).toBe(before);
    world.settings = zoomAt(0.9);
    for (const listener of world.settingListeners) listener({ key: "appearance.zoom" });
    await settle();
    expect(el("status-zoom").textContent).toBe("90%");
  });

  it("una lettura fallita lascia ciò che c'era", async () => {
    world.settings = zoomAt(1.5);
    mountStatusBand(life);
    await settle();
    world.settings = () => Promise.reject(new Error("giù"));
    for (const listener of world.settingListeners) listener({ key: "appearance.zoom" });
    await settle();
    expect(el("status-zoom").textContent).toBe("150%");
  });
});

describe("la lingua e lo smontaggio", () => {
  it("al cambio di lingua riscrive le frasi", () => {
    mountStatusBand(life);
    world.language = "en";
    for (const listener of world.languageListeners) listener();
    expect(el("status-saving").textContent).toBe("frame.status.saved (en)");
  });

  it("smontata non ascolta più e non scrive più", async () => {
    mountStatusBand(life);
    await settle();
    life.close();
    expect(world.sessionListeners.size).toBe(0);
    expect(world.settingListeners.size).toBe(0);
    expect(world.languageListeners.size).toBe(0);
    world.dirty = ["a"];
    emit("layout");
    emit("vault", "/altro");
    el("vault-path").textContent = "Altro";
    await settle();
    expect(el("status-saving").textContent).toBe("frame.status.saved");
  });

  it("senza la banda nel markup non fa niente", () => {
    el("status-band").remove();
    mountStatusBand(life);
    expect(world.sessionListeners.size).toBe(0);
  });
});

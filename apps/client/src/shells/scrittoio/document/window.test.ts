// @vitest-environment happy-dom
//
// Ciò che la finestra documento di sempre garantisce, sulla finestra dello
// Scrittoio: non ha IPC, resta in sola lettura finché la finestra principale
// non risponde, le manda ogni battuta, mostra le due scelte quando qualcosa
// resta in sospeso, rispecchia il tema, e alla chiusura non butta un testo che
// il ponte non ha ancora consegnato.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Status {
  kind: "ready" | "frozen" | "error";
  reason?: string;
}

const world = vi.hoisted(() => ({
  /// Gli strati montati, in ordine: `strato:testo`.
  mounted: [] as string[],
  mirrored: [] as unknown[],
  engines: [] as {
    host: HTMLElement;
    options: { onChange: (change: { text: string; operation: unknown }) => void; theme: string };
    readOnly: boolean[];
    docs: string[];
    synced: unknown[];
    themes: string[];
    destroyed: number;
    text: string;
  }[],
  profiles: [] as { profile: string; hooks: Record<string, (...args: never[]) => void> }[],
  bridge: null as null | {
    request: unknown;
    apply: (text: string, operation: unknown) => void;
    current: () => string;
    onState: (status: Status) => void;
    onTheme: (theme: unknown) => void;
    sent: unknown[];
    navigated: unknown[];
    resolved: string[];
    disposed: number;
    /// Che cosa risponde `dispose`: vero se non resta niente da consegnare.
    drained: boolean;
    sendFails: string | null;
  },
}));

vi.mock("../../../editors/text/engine", () => ({
  TextEngine: class {
    private readonly record: (typeof world.engines)[number];
    constructor(host: HTMLElement, options: (typeof world.engines)[number]["options"]) {
      this.record = { host, options, readOnly: [], docs: [], synced: [], themes: [], destroyed: 0, text: "" };
      world.engines.push(this.record);
    }
    setReadOnly(value: boolean): void {
      this.record.readOnly.push(value);
    }
    setDoc(text: string): void {
      this.record.docs.push(text);
      this.record.text = text;
    }
    syncDoc(change: { text: string }): void {
      this.record.synced.push(change);
      this.record.text = change.text;
    }
    getDoc(): string {
      return this.record.text;
    }
    setTheme(theme: string): void {
      this.record.themes.push(theme);
    }
    destroy(): void {
      this.record.destroyed += 1;
    }
  },
}));
vi.mock("../../../editors/text/profiles/by-id", () => ({
  textProfileExtensions: (profile: string, hooks: Record<string, (...args: never[]) => void>) => {
    world.profiles.push({ profile, hooks });
    return profile === "markdown" || profile === "plain-text" ? () => [] : null;
  },
}));
vi.mock("../../../state/document-bridge", () => ({
  attachChildBridge: (
    request: unknown,
    apply: (text: string, operation: unknown) => void,
    current: () => string,
    onState: (status: Status) => void,
    onTheme: (theme: unknown) => void,
  ) => {
    const bridge = {
      request, apply, current, onState, onTheme,
      sent: [] as unknown[], navigated: [] as unknown[], resolved: [] as string[],
      disposed: 0, drained: true, sendFails: null as string | null,
    };
    world.bridge = bridge;
    return {
      sendEdit: (text: string, operation: unknown) => {
        if (bridge.sendFails) throw new Error(bridge.sendFails);
        bridge.sent.push([text, operation]);
      },
      navigate: (target: unknown) => bridge.navigated.push(target),
      resolveConflict: (choice: string) => bridge.resolved.push(choice),
      dispose: () => {
        bridge.disposed += 1;
        return bridge.drained;
      },
    };
  },
}));
vi.mock("../../../theme/loader", () => ({
  mount: (text: string, layer: string) => world.mounted.push(`${layer}:${text}`),
  mountMirroredTheme: (theme: unknown) => world.mirrored.push(theme),
}));
vi.mock("../../../i18n/strings", () => ({
  t: (key: string, params?: Record<string, string>) => (params ? `${key} ${JSON.stringify(params)}` : key),
}));

import { bootDocumentWindow, documentWindowRequest } from "./window";

const SERIES = { fonts: "F", sheetLight: "L", sheetDark: "D", skin: "S" };
const pageHtml = (await import("../../../../document.html?raw")).default;

const UUID = "0a1b2c3d-0000-4000-8000-0123456789ab";
const VALID: Record<string, string> = {
  surface: "document",
  channel: `docwin-${UUID}`,
  document: "Diario/Oggi.md",
  vault: "/vault",
  session: UUID,
  surfaceId: `remote:${UUID}`,
  profile: "markdown",
};

function query(overrides: Record<string, string | null> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...VALID, ...overrides })) if (value !== null) params.set(key, value);
  return `?${params.toString()}`;
}

/// La pagina com'è servita, con la richiesta nell'indirizzo.
function page(search: string, dark = false): void {
  const body = new DOMParser().parseFromString(pageHtml, "text/html").body;
  for (const script of [...body.querySelectorAll("script")]) script.remove();
  document.body.innerHTML = body.innerHTML;
  window.history.replaceState({}, "", `/document.html${search}`);
  window.matchMedia = ((media: string) => ({ matches: dark && media.includes("dark") })) as unknown as typeof window.matchMedia;
}

const el = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const engine = () => world.engines[0];
const bridge = () => world.bridge as NonNullable<typeof world.bridge>;

beforeEach(() => {
  world.mounted = [];
  world.mirrored = [];
  world.engines = [];
  world.profiles = [];
  world.bridge = null;
});

afterEach(() => {
  // Chiude la vita della pagina, se una finestra è stata montata.
  window.dispatchEvent(new Event("pagehide"));
  document.body.replaceChildren();
  delete document.documentElement.dataset.theme;
});

describe("la richiesta", () => {
  it("valida, è quella dell'indirizzo", () => {
    expect(documentWindowRequest(query())).toEqual(VALID);
  });

  it.each([
    ["senza canale", { channel: null }],
    ["senza documento", { document: null }],
    ["senza vault", { vault: null }],
    ["senza sessione", { session: null }],
    ["senza superficie", { surfaceId: null }],
    ["senza profilo", { profile: null }],
    ["un'altra superficie", { surface: "sheet" }],
    ["un canale che non è di una finestra documento", { channel: `altro-${UUID}` }],
    ["una sessione che non è un uuid", { session: "1234" }],
    ["una superficie che non è remota", { surfaceId: `local:${UUID}` }],
    ["un profilo che non è un id", { profile: "Mark Down" }],
  ])("%s non è valida", (_name, overrides) => {
    expect(documentWindowRequest(query(overrides))).toBeNull();
  });

  it("non valida, la finestra lo dice vestita e non monta né editor né ponte", () => {
    page(query({ channel: "docwin-x" }));
    bootDocumentWindow(SERIES);
    // Resta il titolo della pagina, per chi ascolta, e la frase: nient'altro.
    expect([...el("document-window").childNodes].map((node) => node.textContent)).toEqual([
      "Fub",
      "windows.invalid_request",
    ]);
    expect(el("document-window").firstElementChild).toBe(el("document-window-heading"));
    expect(el("document-window").classList.contains("document-window-invalid")).toBe(true);
    expect(world.engines).toHaveLength(0);
    expect(world.bridge).toBeNull();
    expect(world.mounted).toEqual(["caratteri:F", "foglio:L", "pelle:S"]);
  });

  it("un profilo che il testo non possiede è una richiesta non valida", () => {
    page(query({ profile: "sheet" }));
    bootDocumentWindow(SERIES);
    expect(el("document-window").lastChild?.textContent).toBe("windows.invalid_request");
    expect(el("document-window").children).toHaveLength(1);
    expect(world.engines).toHaveLength(0);
    expect(world.bridge).toBeNull();
  });
});

describe("il foglio", () => {
  it("monta la serie di ripiego con la luce del sistema, finché il tema vero non arriva", () => {
    page(query(), true);
    bootDocumentWindow(SERIES);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(world.mounted).toEqual(["caratteri:F", "foglio:D", "pelle:S"]);
    expect(engine().options.theme).toBe("dark");
  });

  it("di giorno il foglio di ripiego è quello chiaro", () => {
    page(query());
    bootDocumentWindow(SERIES);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(world.mounted).toEqual(["caratteri:F", "foglio:L", "pelle:S"]);
  });

  it("porta il nome sulla linguetta e nel titolo della finestra, il percorso nella testata", () => {
    page(query());
    bootDocumentWindow(SERIES);
    expect(document.title).toBe("Oggi");
    expect(el("document-window-heading").textContent).toBe("Oggi");
    expect(el("document-window-name").textContent).toBe("Oggi");
    expect(el("document-window-path").textContent).toBe("Diario/Oggi.md");
    expect(el("document-window-tabs").getAttribute("aria-label")).toBe("region.document");
    expect(el("document-window-keep").textContent).toBe("windows.keep_local");
    expect(el("document-window-discard").textContent).toBe("windows.discard_local");
  });

  it("l'editor sta sul foglio, è il pannello della linguetta, e scrive il sorgente", () => {
    page(query());
    bootDocumentWindow(SERIES);
    const host = engine().host;
    expect(host.parentElement).toBe(el("document-window-sheet"));
    expect(host.id).toBe(el("document-window-tab").getAttribute("aria-controls"));
    expect(host.getAttribute("role")).toBe("tabpanel");
    expect(host.getAttribute("aria-label")).toBe("Diario/Oggi.md");
    expect(host.classList.contains("pane-editor")).toBe(true);
    expect(host.dataset.markdownMode).toBe("source");
    expect(world.profiles[0].profile).toBe("markdown");
  });

  it("un testo semplice non prende la modalità del Markdown", () => {
    page(query({ profile: "plain-text" }));
    bootDocumentWindow(SERIES);
    expect(engine().host.dataset.markdownMode).toBeUndefined();
  });
});

describe("il ponte", () => {
  it("finché la finestra principale non risponde l'editor è in sola lettura e la testata dice che aspetta", () => {
    page(query());
    bootDocumentWindow(SERIES);
    expect(bridge().request).toEqual(VALID);
    expect(engine().readOnly).toEqual([true]);
    expect(el("document-window-link").dataset.state).toBe("in_corso");
    expect(el("document-window-link").textContent).toBe("windows.waiting");
    expect(el("document-window-state").textContent).toBe("");
    expect(el("document-window-conflict").hidden).toBe(true);
  });

  it("il primo testo fonda il documento, i successivi lo sincronizzano senza rifarlo", () => {
    page(query());
    bootDocumentWindow(SERIES);
    bridge().apply("uno", null);
    bridge().apply("due", { kind: "op" });
    expect(engine().docs).toEqual(["uno"]);
    expect(engine().synced).toEqual([{ text: "due", operation: { kind: "op" } }]);
    expect(bridge().current()).toBe("due");
  });

  it("pronta: si scrive, e la testata dice che è collegata", () => {
    page(query());
    bootDocumentWindow(SERIES);
    bridge().apply("testo", null);
    bridge().onState({ kind: "ready" });
    expect(engine().readOnly).toEqual([true, false]);
    expect(el("document-window-link").dataset.state).toBe("salvato");
    expect(el("document-window-link").textContent).toBe("windows.linked");
    expect(el("document-window-state").textContent).toBe("");
    expect(el("document-window-conflict").hidden).toBe(true);
  });

  it("ogni battuta va alla finestra principale", () => {
    page(query());
    bootDocumentWindow(SERIES);
    engine().options.onChange({ text: "ciao", operation: { kind: "insert" } });
    expect(bridge().sent).toEqual([["ciao", { kind: "insert" }]]);
  });

  it("mentre la principale salva: sola lettura, e lo dicono la testata e la regione viva", () => {
    page(query());
    bootDocumentWindow(SERIES);
    bridge().apply("testo", null);
    bridge().onState({ kind: "frozen" });
    expect(engine().readOnly).toEqual([true, true]);
    expect(el("document-window-link").dataset.state).toBe("in_corso");
    expect(el("document-window-link").textContent).toBe("windows.saving");
    expect(el("document-window-state").textContent).toBe("windows.saving");
    expect(el("document-window-state").dataset.kind).toBe("frozen");
    expect(el("document-window-conflict").hidden).toBe(true);
  });

  it("un errore dopo il primo testo: sola lettura, il motivo a parole e le due scelte", () => {
    page(query());
    bootDocumentWindow(SERIES);
    bridge().apply("testo", null);
    bridge().onState({ kind: "error", reason: "sessione chiusa" });
    expect(engine().readOnly).toEqual([true, true]);
    expect(el("document-window-state").textContent).toBe('windows.local_error {"reason":"sessione chiusa"}');
    expect(el("document-window-state").dataset.kind).toBe("error");
    expect(el("document-window-link").dataset.state).toBe("fallito");
    expect(el("document-window-link").textContent).toBe("windows.held");
    expect(el("document-window-conflict").hidden).toBe(false);
  });

  it("un errore prima del primo testo non offre scelte: non c'è niente di locale da conservare", () => {
    page(query());
    bootDocumentWindow(SERIES);
    bridge().onState({ kind: "error" });
    expect(el("document-window-conflict").hidden).toBe(true);
    expect(el("document-window-state").textContent).toBe('windows.local_error {"reason":""}');
  });

  it("tornata pronta dopo un errore, l'avviso e le scelte se ne vanno", () => {
    page(query());
    bootDocumentWindow(SERIES);
    bridge().apply("testo", null);
    bridge().onState({ kind: "error", reason: "x" });
    bridge().onState({ kind: "ready" });
    expect(el("document-window-state").textContent).toBe("");
    expect(el("document-window-state").dataset.kind).toBe("ready");
    expect(el("document-window-conflict").hidden).toBe(true);
    expect(el("document-window-link").dataset.state).toBe("salvato");
    expect(engine().readOnly.slice(-1)).toEqual([false]);
  });

  it("una battuta che il ponte rifiuta resta nella finestra: sola lettura, motivo e scelte", () => {
    page(query());
    bootDocumentWindow(SERIES);
    bridge().apply("testo", null);
    bridge().onState({ kind: "ready" });
    bridge().sendFails = "canale chiuso";
    engine().options.onChange({ text: "testo!", operation: null });
    expect(engine().readOnly.slice(-1)).toEqual([true]);
    expect(el("document-window-state").textContent).toBe('windows.local_error {"reason":"canale chiuso"}');
    expect(el("document-window-link").dataset.state).toBe("fallito");
    expect(el("document-window-conflict").hidden).toBe(false);
  });

  it("le due scelte passano dal ponte", () => {
    page(query());
    bootDocumentWindow(SERIES);
    el("document-window-keep").click();
    el("document-window-discard").click();
    expect(bridge().resolved).toEqual(["mine", "theirs"]);
  });

  it("i collegamenti del testo si aprono nella finestra principale", () => {
    page(query());
    bootDocumentWindow(SERIES);
    const hooks = world.profiles[0].hooks as unknown as {
      documentId: string;
      openWikilink: (page: string, heading: string | null, block: string | null) => void;
      openPath: (path: string) => void;
      searchTag: (tag: string) => void;
    };
    expect(hooks.documentId).toBe("Diario/Oggi.md");
    hooks.openWikilink("Pagina", "Titolo", null);
    hooks.openPath("Altro.md");
    hooks.searchTag("tema");
    expect(bridge().navigated).toEqual([
      { kind: "wikilink", page: "Pagina", heading: "Titolo", block: null },
      { kind: "path", path: "Altro.md" },
      { kind: "tag", tag: "tema" },
    ]);
  });

  it("il tema della finestra principale sostituisce il ripiego, e l'editor lo segue", () => {
    page(query());
    bootDocumentWindow(SERIES);
    const theme = { light: "dark", contrast: "", layers: [] };
    bridge().onTheme(theme);
    expect(world.mirrored).toEqual([theme]);
    expect(engine().themes).toEqual(["dark"]);
    bridge().onTheme({ ...theme, light: "light" });
    expect(engine().themes).toEqual(["dark", "light"]);
  });
});

describe("la chiusura", () => {
  it("se il ponte ha consegnato tutto, l'editor si distrugge", () => {
    page(query());
    bootDocumentWindow(SERIES);
    window.dispatchEvent(new Event("pagehide"));
    expect(bridge().disposed).toBe(1);
    expect(engine().destroyed).toBe(1);
  });

  it("se resta qualcosa da consegnare, l'editor resta col suo testo", () => {
    page(query());
    bootDocumentWindow(SERIES);
    bridge().drained = false;
    window.dispatchEvent(new Event("pagehide"));
    expect(bridge().disposed).toBe(1);
    expect(engine().destroyed).toBe(0);
  });

  it("chiusa la pagina non ascolta più: né le scelte né una seconda chiusura", () => {
    page(query());
    bootDocumentWindow(SERIES);
    window.dispatchEvent(new Event("pagehide"));
    el("document-window-keep").click();
    window.dispatchEvent(new Event("pagehide"));
    expect(bridge().resolved).toEqual([]);
    expect(bridge().disposed).toBe(1);
  });
});

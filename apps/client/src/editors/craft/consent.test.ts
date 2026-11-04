// @vitest-environment happy-dom
//
// La domanda e il gesto (N7, T23) sulla scheda di un file Craft, contro
// l'host finto: l'anteprima fatta dall'app parte soltanto dopo un gesto
// (la scheda nata da un clic col consenso acceso, il «Sì», il pulsante), mai
// da sola. Una scheda senza gesto (riaperta all'avvio, da `fub://open`, da una
// vista di un plugin, rimontata), la figura nella nota e l'anteprima al
// passaggio del puntatore non chiedono niente. Poi i bordi: Invio e Spazio,
// il doppio «Sì», il salvataggio che non riesce, `no_consent`, il consenso
// cambiato altrove, la scheda chiusa prima della risposta, il componente
// spento.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeCraft, FakeCraftDoc, FakeHost } from "../../host/fake";
import type { CraftPreview, CraftPreviewSize, CraftRenderConsent } from "../../host/craft";
import type { SettingEntry } from "../../host/contract";
import type { EditorSurface } from "../core/registry";

const box = vi.hoisted(() => ({ host: null as FakeHost | null }));

vi.mock("../../host/ipc", () => {
  const now = () => {
    if (!box.host) throw new Error("l'host finto non è stato montato");
    return box.host.module;
  };
  return {
    api: new Proxy(
      {},
      {
        get: (_t, name: string) => (...args: unknown[]) =>
          (now().api as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args),
      },
    ),
    onKernelEvent: (handler: (n: unknown) => void) => now().onKernelEvent(handler as never),
  };
});

const { createFakeHost } = await import("../../host/fake");

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function until(ready: () => boolean): Promise<void> {
  for (let round = 0; round < 100 && !ready(); round++) await settle();
  expect(ready()).toBe(true);
}

async function quiet(): Promise<void> {
  for (let round = 0; round < 10; round++) await settle();
}

const LOGO = "Disegni/logo.vectorcraft";
const BYTES = { bytes: new Uint8Array([0x7b, 0x7d, 0xff]), mime: "application/octet-stream" };
const CONSENT = "craft.cli-previews";

const consentSetting: SettingEntry = {
  spec: {
    key: CONSENT,
    label: "Anteprime fatte dalle app",
    description: "",
    group: "App esterne",
    scope: "machine",
    kind: {
      kind: "choice",
      default: "ask",
      options: [
        { value: "ask", label: "Chiedi" },
        { value: "on", label: "Accese" },
        { value: "off", label: "Spente" },
      ],
    },
    program_writable: false,
  },
  value: "ask",
  source: "default",
} as SettingEntry;

interface Booted {
  host: FakeHost;
  doc: FakeCraftDoc & { render: { app: string; consent: CraftRenderConsent } };
  previews: typeof import("../../state/craft-previews");
  index: typeof import("./index");
  figure: typeof import("./figure");
  openLifetime: typeof import("../../ui/lifetime").openLifetime;
  settingsOpened: string[];
  /// Il prossimo `setSetting` fallisce con questo errore.
  failNext: { error: unknown } | null;
  /// `craft_render` resta in volo finché non si chiama `release`.
  hold: () => () => void;
}

/// L'host finto con un file Craft che l'app saprebbe fare, col consenso
/// `consent`. `craft_render` risponde la risposta in coda, come il backend;
/// `setSetting` del consenso cambia anche ciò che `craft.preview` dice, come
/// l'host vero che legge l'impostazione a ogni chiamata.
async function boot(consent: CraftRenderConsent, extra: Partial<FakeCraft> = {}): Promise<Booted> {
  const doc = { render: { app: "VectorCraft", consent } };
  const craft: FakeCraft = { docs: { [LOGO]: doc }, ...extra };
  let gate: Promise<void> | null = null;
  const craftRender = async (id: string, size: CraftPreviewSize): Promise<CraftPreview> => {
    if (gate) await gate;
    const outcome = await host.module.api.invokeCommand("craft.preview", { doc: id, size });
    return { ...(outcome.effect as { payload: CraftPreview }).payload, queued: true };
  };
  const host = createFakeHost({
    resources: { [LOGO]: BYTES },
    craft,
    craftRender,
    settings: [{ ...consentSetting, value: consent, source: consent === "ask" ? "default" : "machine" }],
  });
  box.host = host;
  const booted = { failNext: null } as Booted;
  const api = host.module.api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
  const write = api.setSetting!;
  api.setSetting = (key: unknown, value: unknown) => {
    if (booted.failNext) {
      const { error } = booted.failNext;
      booted.failNext = null;
      return Promise.reject(error);
    }
    if (key === CONSENT) doc.render.consent = value as CraftRenderConsent;
    return write(key, value);
  };
  vi.resetModules();
  const store = await import("../../state/store");
  store.state.vaultRoot = "/vault";
  const kernel = await import("../../state/kernel");
  const { openLifetime } = await import("../../ui/lifetime");
  const previews = await import("../../state/craft-previews");
  const index = await import("./index");
  const figure = await import("./figure");
  // La scheda carica la sua parte con un `import()`: due schede insieme, al
  // primo caricamento dopo `vi.resetModules`, lo farebbero a metà nel
  // caricatore dei test. La si carica prima.
  await import("./surface");
  await kernel.startKernelRouter();
  previews.mountCraftPreviews(openLifetime());
  const settingsOpened: string[] = [];
  return Object.assign(booted, {
    host,
    doc,
    previews,
    index,
    figure,
    openLifetime,
    settingsOpened,
    hold: () => {
      let release: () => void = () => {};
      gate = new Promise<void>((resolve) => { release = resolve; });
      return () => {
        gate = null;
        release();
      };
    },
  });
}

/// Una scheda del file, nata dal gesto o no.
function tab(booted: Booted, gesture: boolean, pane = "p1"): { surface: EditorSurface; parent: HTMLElement } {
  const parent = document.createElement("div");
  document.body.append(parent);
  const surface = booted.index.mountCraftSurface(
    "craft",
    { paneId: pane, documentId: LOGO, parent, ...(gesture ? { gesture: true } : {}) },
    { onOpenDocument: () => {}, onSearchTag: () => {}, onOpenSettings: (key) => void booted.settingsOpened.push(key) },
  );
  return { surface, parent };
}

const renders = (host: FakeHost) => host.atGate("craftRender").map((call) => call.args);
const saves = (host: FakeHost) => host.atGate("setSetting").map((call) => call.args);
const text = (parent: HTMLElement, selector: string) => parent.querySelector(selector)?.textContent ?? null;
const yes = (parent: HTMLElement) => parent.querySelector<HTMLButtonElement>('.craft-ask-answer[data-answer="on"]');
const no = (parent: HTMLElement) => parent.querySelector<HTMLButtonElement>('.craft-ask-answer[data-answer="off"]');

beforeEach(() => {
  box.host = null;
  document.body.replaceChildren();
});

describe("il gesto", () => {
  it("una scheda aperta con il gesto e il consenso acceso chiede l'anteprima una volta, e dice che la prepara", async () => {
    const booted = await boot("on");
    const { parent } = tab(booted, true);
    await until(() => text(parent, ".craft-empty-state") === "Preparo l'anteprima…");
    await quiet();
    expect(renders(booted.host)).toEqual([[LOGO, "large"]]);
    expect(parent.querySelector(".craft-render, .craft-ask")).toBeNull();
  });

  it("senza gesto: zero chiamate, e il pulsante", async () => {
    const booted = await boot("on");
    const { parent } = tab(booted, false);
    await until(() => parent.querySelector(".craft-render") !== null);
    await quiet();
    expect(renders(booted.host)).toEqual([]);
    expect(text(parent, ".craft-render")).toBe("Crea l'anteprima con VectorCraft");
  });

  it("il gesto vale per la prima risposta: un ridisegno della stessa scheda non richiede", async () => {
    const booted = await boot("on");
    const { parent } = tab(booted, true);
    await until(() => text(parent, ".craft-empty-state") === "Preparo l'anteprima…");
    // Il documento cambia da fuori: la scheda richiede e ridisegna, senza gesto.
    booted.host.writeFromOutside(LOGO, "{\"x\":1}");
    await quiet();
    booted.host.emit({ type: "setting_changed", key: CONSENT, scope: "machine" });
    await quiet();
    expect(renders(booted.host)).toHaveLength(1);
  });

  it("una scheda rimontata, riaperta all'avvio, da fub://open o da una vista (tutte senza gesto): zero", async () => {
    const booted = await boot("on");
    const first = tab(booted, false);
    await until(() => first.parent.querySelector(".craft-render") !== null);
    first.surface.destroy();
    const again = tab(booted, false);
    await until(() => again.parent.querySelector(".craft-render") !== null);
    await quiet();
    expect(renders(booted.host)).toEqual([]);
  });

  it("due riquadri nati dallo stesso gesto: una chiamata", async () => {
    const booted = await boot("on");
    const left = tab(booted, true, "p1");
    const right = tab(booted, true, "p2");
    await until(() => text(left.parent, ".craft-empty-state") === "Preparo l'anteprima…"
      && text(right.parent, ".craft-empty-state") === "Preparo l'anteprima…");
    await quiet();
    expect(renders(booted.host)).toHaveLength(1);
  });

  it("la figura nella nota e l'anteprima al passaggio del puntatore: zero, anche col consenso acceso", async () => {
    const booted = await boot("on");
    const container = document.createElement("div");
    container.className = "markdown-rendered";
    document.body.append(container);
    const html = `<figure class="fub-craft" data-embed-kind="craft" data-embed-doc="${LOGO}" data-craft-app="vectorcraft"><figcaption>logo.vectorcraft</figcaption></figure>`;
    const placeholder = booted.figure.craftPlaceholder(html)!;
    // La figura in una nota, che si apre con un clic.
    const embed = document.createElement("span");
    container.append(embed);
    const opened: unknown[] = [];
    await booted.figure.showEmbeddedCraft(container, embed, placeholder, booted.openLifetime(), { open: (doc, options) => void opened.push([doc, options]) });
    // L'anteprima al passaggio del puntatore (`state/preview.ts`): la stessa
    // figura, senza `open`.
    const hover = document.createElement("span");
    container.append(hover);
    await booted.figure.showEmbeddedCraft(container, hover, placeholder, booted.openLifetime());
    await quiet();
    expect(renders(booted.host)).toEqual([]);
    expect(container.querySelector(".craft-ask, .craft-render")).toBeNull();
  });

  it("col componente spento la scheda dice che non c'è superficie, e niente parte", async () => {
    const booted = await boot("on", { component: false });
    const { parent } = tab(booted, true);
    await until(() => text(parent, ".craft-status") === "Nessuna superficie disponibile");
    await quiet();
    expect(renders(booted.host)).toEqual([]);
  });
});

describe("la domanda", () => {
  it("con ask la domanda, e niente parte da sola nemmeno col gesto", async () => {
    const booted = await boot("ask");
    const { parent } = tab(booted, true);
    await until(() => yes(parent) !== null);
    await quiet();
    const region = parent.querySelector<HTMLElement>("section.craft-ask")!;
    expect(region.getAttribute("aria-label")).toBe("Anteprime fatte dalle app");
    expect(text(parent, ".craft-ask-text")).toBe("Fub può far fare l'anteprima a VectorCraft, che lavora su una copia del file. Vuoi che lo faccia per i file che apri?");
    expect(yes(parent)!.textContent).toBe("Sì, accendi");
    expect(no(parent)!.textContent).toBe("No, lasciale spente");
    expect(text(parent, ".craft-ask-hint")).toBe("Puoi cambiare idea in Impostazioni › App esterne");
    expect(renders(booted.host)).toEqual([]);
  });

  it("«Sì» salva on e chiede l'anteprima una volta", async () => {
    const booted = await boot("ask");
    const { parent } = tab(booted, false);
    await until(() => yes(parent) !== null);
    yes(parent)!.click();
    await until(() => text(parent, ".craft-empty-state") === "Preparo l'anteprima…");
    await quiet();
    expect(saves(booted.host)).toEqual([[CONSENT, "on"]]);
    expect(renders(booted.host)).toEqual([[LOGO, "large"]]);
  });

  it("«No» salva off, zero chiamate, e torna la riga «spente» col link alle impostazioni", async () => {
    const booted = await boot("ask");
    const { parent } = tab(booted, false);
    await until(() => no(parent) !== null);
    no(parent)!.click();
    await until(() => parent.querySelector(".craft-off") !== null);
    await quiet();
    expect(saves(booted.host)).toEqual([[CONSENT, "off"]]);
    expect(renders(booted.host)).toEqual([]);
    expect(parent.querySelector(".craft-ask")).toBeNull();
    expect(text(parent, ".craft-off span")).toBe("Le anteprime fatte dalle app sono spente");
    parent.querySelector<HTMLButtonElement>(".craft-off .link-button")!.click();
    expect(booted.settingsOpened).toEqual([CONSENT]);
  });

  it("Invio e Spazio su «Sì»: una volta ciascuno", async () => {
    for (const key of ["Enter", " "]) {
      const booted = await boot("ask");
      const { parent } = tab(booted, false);
      await until(() => yes(parent) !== null);
      const button = yes(parent)!;
      button.focus();
      // Ciò che fa il browser: il tasto, e il clic che il `button` ne ricava.
      button.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
      button.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }));
      button.click();
      await until(() => text(parent, ".craft-empty-state") === "Preparo l'anteprima…");
      await quiet();
      expect(saves(booted.host), key).toEqual([[CONSENT, "on"]]);
      expect(renders(booted.host), key).toHaveLength(1);
    }
  });

  it("il doppio «Sì» salva e chiede una volta", async () => {
    const booted = await boot("ask");
    const { parent } = tab(booted, false);
    await until(() => yes(parent) !== null);
    const button = yes(parent)!;
    button.click();
    button.click();
    await until(() => text(parent, ".craft-empty-state") === "Preparo l'anteprima…");
    await quiet();
    expect(saves(booted.host)).toHaveLength(1);
    expect(renders(booted.host)).toHaveLength(1);
  });

  it("il salvataggio che non riesce lo dice, la domanda resta, e niente parte", async () => {
    const booted = await boot("ask");
    const { parent } = tab(booted, false);
    await until(() => yes(parent) !== null);
    booted.failNext = { error: { kind: "io", message: "disco pieno" } };
    yes(parent)!.click();
    await until(() => parent.querySelector<HTMLElement>(".craft-ask .setting-error")?.hidden === false);
    await quiet();
    expect(text(parent, ".craft-ask .setting-error")).toContain("disco pieno");
    expect(yes(parent)!.disabled).toBe(false);
    expect(no(parent)!.disabled).toBe(false);
    expect(renders(booted.host)).toEqual([]);
    expect(booted.doc.render.consent).toBe("ask");
  });

  it("il consenso cambiato altrove mentre la domanda è aperta: la scheda si ridisegna, senza chiedere", async () => {
    const booted = await boot("ask");
    const { parent } = tab(booted, true);
    await until(() => yes(parent) !== null);
    booted.doc.render.consent = "on";
    booted.host.emit({ type: "setting_changed", key: CONSENT, scope: "machine" });
    await until(() => parent.querySelector(".craft-render") !== null);
    expect(parent.querySelector(".craft-ask")).toBeNull();
    booted.doc.render.consent = "off";
    booted.host.emit({ type: "setting_changed", key: CONSENT, scope: "machine" });
    await until(() => parent.querySelector(".craft-off") !== null);
    await quiet();
    expect(renders(booted.host)).toEqual([]);
  });

  it("no_consent alla richiesta: torna la domanda", async () => {
    const booted = await boot("on");
    const { parent } = tab(booted, false);
    await until(() => parent.querySelector(".craft-render") !== null);
    // Il consenso è stato spento altrove, e la notizia non è ancora arrivata.
    booted.doc.render.consent = "ask";
    const api = booted.host.module.api as unknown as Record<string, unknown>;
    api.craftRender = () => Promise.reject({ kind: "permission_denied", message: "host.craft_render.no_consent" });
    parent.querySelector<HTMLButtonElement>(".craft-render")!.click();
    await until(() => yes(parent) !== null);
    expect(parent.querySelector(".craft-render")).toBeNull();
  });

  it("la scheda chiusa prima della risposta: niente si ridisegna", async () => {
    const booted = await boot("ask");
    const { surface, parent } = tab(booted, false);
    await until(() => yes(parent) !== null);
    const release = booted.hold();
    yes(parent)!.click();
    await until(() => renders(booted.host).length === 1);
    surface.destroy();
    release();
    await quiet();
    expect(parent.children).toHaveLength(0);
  });
});

describe("il fuoco nella domanda", () => {
  /// Ciò che fa Chromium: un pulsante col fuoco che si spegne lo perde, e il
  /// fuoco va a `<body>`. `happy-dom` lo lascerebbe dov'è.
  function blurOnDisable(): () => void {
    const proto = HTMLButtonElement.prototype;
    const own = Object.getOwnPropertyDescriptor(proto, "disabled")!;
    Object.defineProperty(proto, "disabled", {
      configurable: true,
      get(this: HTMLButtonElement) {
        return own.get!.call(this) as boolean;
      },
      set(this: HTMLButtonElement, value: boolean) {
        own.set!.call(this, value);
        if (value && document.activeElement === this) this.blur();
      },
    });
    return () => Object.defineProperty(proto, "disabled", own);
  }

  const inside = (parent: HTMLElement) => document.activeElement !== document.body && parent.contains(document.activeElement);

  it("Invio su «Sì, accendi» lascia il fuoco nella scheda; un salvataggio fallito lo rende al pulsante", async () => {
    const restore = blurOnDisable();
    try {
      const booted = await boot("ask");
      const { parent } = tab(booted, true);
      await until(() => yes(parent) !== null);
      yes(parent)!.focus();
      booted.failNext = { error: { kind: "io", message: "disco pieno" } };
      const release = booted.hold();
      yes(parent)!.click();
      expect(inside(parent)).toBe(true);
      await until(() => parent.querySelector<HTMLElement>(".craft-ask .setting-error")?.hidden === false);
      expect(document.activeElement).toBe(yes(parent));
      yes(parent)!.click();
      expect(inside(parent)).toBe(true);
      await until(() => renders(booted.host).length === 1);
      expect(inside(parent)).toBe(true);
      release();
      await until(() => text(parent, ".craft-empty-state") === "Preparo l'anteprima…");
      await quiet();
      expect(inside(parent)).toBe(true);
    } finally {
      restore();
    }
  });

  it("Invio su «Crea l'anteprima» lascia il fuoco nella scheda", async () => {
    const restore = blurOnDisable();
    try {
      const booted = await boot("on");
      const { parent } = tab(booted, false);
      await until(() => parent.querySelector(".craft-render") !== null);
      const button = parent.querySelector<HTMLButtonElement>(".craft-render")!;
      button.focus();
      const release = booted.hold();
      button.click();
      expect(inside(parent)).toBe(true);
      release();
      await until(() => text(parent, ".craft-empty-state") === "Preparo l'anteprima…");
      await quiet();
      expect(inside(parent)).toBe(true);
    } finally {
      restore();
    }
  });

  it("un render che fallisce mentre arriva un ricaricamento: il pulsante torna e l'errore si vede", async () => {
    const booted = await boot("on");
    const { parent } = tab(booted, false);
    await until(() => parent.querySelector(".craft-render") !== null);
    let fail: (error: unknown) => void = () => {};
    const api = booted.host.module.api as unknown as Record<string, unknown>;
    api.craftRender = () => new Promise((_resolve, reject) => { fail = reject; });
    parent.querySelector<HTMLButtonElement>(".craft-render")!.click();
    await quiet();
    expect(parent.querySelector<HTMLButtonElement>(".craft-render")!.disabled).toBe(true);
    // Un altro documento cambia: la scheda richiede la sua risposta, che è
    // la stessa, mentre il render vola ancora.
    booted.host.emit({ type: "vault_opened", root: "/vault" } as never);
    await quiet();
    fail({ kind: "not_found", message: "nessuna CLI" });
    await until(() => parent.querySelector<HTMLButtonElement>(".craft-render")?.disabled === false);
    await quiet();
    expect(text(parent, ".craft-empty-state")).toMatch(/^L'anteprima non è riuscita: .*nessuna CLI/);
    expect(parent.querySelector<HTMLButtonElement>(".craft-render")!.disabled).toBe(false);
  });
});

describe("le frasi di missing", () => {
  it("over_limit col link al peso massimo; failed col nome dell'app", async () => {
    const booted = await boot("on");
    booted.doc.missing = "over_limit";
    booted.doc.limit_bytes = 32 * 1024 * 1024;
    const big = tab(booted, true);
    await until(() => big.parent.querySelector(".craft-empty") !== null);
    await quiet();
    expect(text(big.parent, ".craft-empty-state")).toBe("Il file pesa più del massimo da leggere per un'anteprima (32 MiB)");
    big.parent.querySelector<HTMLButtonElement>(".craft-empty > .link-button")!.click();
    expect(booted.settingsOpened).toEqual(["craft.preview-max-mib"]);
    expect(renders(booted.host)).toEqual([]);
  });

  it("over_limit senza limite noto dice una lineetta", async () => {
    const { limitText } = await import("./surface");
    expect(limitText(null)).toBe("—");
    expect(limitText(64 * 1024 * 1024 + 5000)).toBe("64 MiB");
  });
});

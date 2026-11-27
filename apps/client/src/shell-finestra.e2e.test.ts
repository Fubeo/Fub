// @vitest-environment happy-dom
//
// **La shell intera** (§17.2): la barra dei menu, la finestra, i temi e l'avvio.
//
// Una parte delle prove che montano `main.ts` sulla scocca vera contro
// l'host finto; il perché, il montaggio e gli aiuti stanno in
// `shell-e2e-support.ts`.
import { describe, expect, it, vi } from "vitest";
import type { FakeHost } from "./host/fake";
import type { SettingEntry, KnownVault } from "./host/contract";
import { mount, start, settle, waitFor, textToVideo, VAULT, useShellHarness } from "./shell-e2e-support";

// Ogni gesto monta la shell vera: qui un giro sta fra 0,5 e 3 s, sul runner CI
// è circa tre volte più lento e i 5 s del default li superava ora un gesto ora
// un altro. Il tetto vale per il file intero; un blocco vero resta fermo ben
// oltre.
vi.setConfig({ testTimeout: 20_000 });

// L'host finto vive in una scatola che `vi.mock` possa vedere: i factory dei
// mock sono issati sopra gli import, quindi non possono chiudere su una
// variabile normale di questo modulo. La scatola sì, perché a leggerla è la
// factory quando il modulo viene chiesto — cioè dopo che il test l'ha riempita.
const box = vi.hoisted(() => ({
  host: null as FakeHost | null,
  /// Cosa si risponde a una conferma, che sia quella del sistema o quella che
  /// lo Scrittoio disegna dentro la finestra. Negli e2e è un `true`.
  confirm: true,
  /// Quante volte una conferma è stata chiesta.
  asked: 0,
  /// I vault che la macchina ricorda, per la schermata senza vault.
  known: [] as KnownVault[],
}));

// Il modulo mimato è **uno solo per tutto il file**, e delega all'host di
// adesso a ogni chiamata. Non è un vezzo: `vi.resetModules()` svuota il
// registro dei moduli ma **non** quello dei mock, quindi una factory che
// restituisse `scatola.host.module` verrebbe eseguita una volta sola e ogni
// prova dalla seconda in poi parlerebbe col vault della prima — con la shell
// rimontata a dovere, che è il modo migliore per non accorgersene. È costato
// due giri di misura, e sta scritto qui perché al terzo nessuno lo rifaccia.
vi.mock("./host/ipc", () => {
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
    onKernelEvent: (handler: (n: unknown) => void) =>
      now().onKernelEvent(handler as never),
    onClose: (first: () => Promise<boolean>, onFailure: (reason: unknown) => void) => now().onClose(first, onFailure),
    // `finestra` è il manico della titlebar custom (§Fase 1): in test non
    // tocchiamo finestre vere, e i metodi sono tutti no-op o ritornano
    // valori neutri.
    window: {
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      isMaximized: async () => false,
      setTitle: async () => {},
      onResize: async () => async () => {},
    },
  };
});

vi.mock("./host/dialog", () => ({
  confirm: () => {
    box.asked++;
    return Promise.resolve(box.confirm);
  },
  pickFolder: () => Promise.resolve("/vault"),
  pickFile: () => Promise.resolve(null),
}));

useShellHarness(box);

describe("la menubar applicativa", () => {
  it("apre File, seleziona una voce, si chiude e si rimonta senza errori", async () => {
    const first = await mount({});
    const stopFirst = await first.startup;
    await settle();
    const file = document.querySelector<HTMLButtonElement>("#app-menu > button");
    if (!file) throw new Error("il menu File non è stato montato");

    const errors: unknown[] = [];
    const rejections: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      event.preventDefault();
      errors.push(event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      event.preventDefault();
      rejections.push(event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    let stopSecond: (() => void) | undefined;
    try {
      file.click();
      const menu = document.getElementById("context-menu");
      if (!menu) throw new Error("il menu File non si è aperto");
      menu.querySelector<HTMLButtonElement>("[role=menuitem]")!.click();
      await settle();
      expect(first.host.atGate("openVault").length).toBeGreaterThan(0);

      file.click();
      expect(file.getAttribute("aria-expanded")).toBe("true");
      file.click();
      expect(file.getAttribute("aria-expanded")).toBe("false");
      file.click();
      const openMenu = document.getElementById("context-menu");
      expect(openMenu).not.toBeNull();

      stopFirst();
      openMenu?.dispatchEvent(new Event("animationend"));
      file.click();
      expect(document.getElementById("context-menu")).toBeNull();

      const second = await mount({});
      stopSecond = await second.startup;
      await settle();
      const secondFile = document.querySelector<HTMLButtonElement>("#app-menu > button");
      if (!secondFile) throw new Error("il menu File non è stato rimontato");
      secondFile.click();
      expect(document.getElementById("context-menu")).not.toBeNull();
    } finally {
      const secondMenu = document.getElementById("context-menu");
      stopSecond?.();
      secondMenu?.dispatchEvent(new Event("animationend"));
      stopFirst();
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    }

    expect(errors).toEqual([]);
    expect(rejections).toEqual([]);
  });
});

describe("il pannello delle impostazioni", () => {
  it("si apre e si chiude senza una View Transition nativa", async () => {
    const mounted = await mount({});
    const stop = await mounted.startup;
    await settle();
    const start = vi.fn(() => {
      throw new Error("View Transition non disponibile nel WebKit della shell");
    });
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: start,
    });

    try {
      const open = document.querySelector<HTMLButtonElement>("#open-settings");
      const close = document.querySelector<HTMLButtonElement>("#settings-close");
      const panel = document.querySelector<HTMLElement>("#settings-panel");
      if (!open || !close || !panel) throw new Error("il pannello impostazioni non è montato");

      open.click();
      await settle();
      expect(panel.hidden).toBe(false);
      expect(start).not.toHaveBeenCalled();

      // L'uscita è un'immagine che se ne va: il pannello è già nascosto.
      close.click();
      expect(panel.hidden).toBe(true);
      expect(start).not.toHaveBeenCalled();

      open.click();
      await settle();
      expect(panel.hidden).toBe(false);
      expect(start).not.toHaveBeenCalled();
    } finally {
      stop();
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: undefined,
      });
    }
  });
});

describe("la pagina «Componenti» con la sola tastiera", () => {
  /// Un tasto sul controllo che ha il fuoco, con l'attivazione che il browser
  /// farebbe da sé (happy-dom non la fa): Invio sui pulsanti, Spazio sui
  /// pulsanti e sulle caselle. Un `preventDefault` la ferma, come nel browser.
  function press(key: string): void {
    const target = document.activeElement as HTMLElement | null;
    if (!target || target === document.body) throw new Error(`nessun fuoco per «${key}»`);
    const proceed = target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    if (!proceed) return;
    const button = target instanceof HTMLButtonElement;
    const checkbox = target instanceof HTMLInputElement && target.type === "checkbox";
    if ((key === "Enter" && button) || (key === " " && (button || checkbox))) target.click();
  }
  function focus(selector: string): HTMLElement {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) throw new Error(`non c'è ${selector}`);
    el.focus();
    expect(document.activeElement).toBe(el);
    return el;
  }
  const sw = (id: string) => document.getElementById(`component-${id}`) as HTMLInputElement | null;
  const pressed = (name: string) =>
    document.querySelector(`[data-profile="${name}"]`)?.getAttribute("aria-pressed") === "true";
  const notice = () => document.querySelector(".components-notice")?.textContent ?? "";
  /// Il gesto è finito: niente di occupato, e la mappa riletta è a schermo.
  /// Con la suite intera in parallelo il ricaricamento dei bundle e la rilettura
  /// possono superare i due secondi soliti di `waitFor`.
  async function done(): Promise<void> {
    await waitFor("la fine del gesto", () => document.querySelector(".components-page [aria-busy]") === null, 8000);
    await new Promise((r) => setTimeout(r, 80));
    await settle();
  }

  it("profili, interruttori, la finestra delle dipendenze, Togli e Tienili, la ricerca", async () => {
    await start(VAULT);
    const panel = document.querySelector<HTMLElement>("#settings-panel")!;
    focus("#open-settings");
    press("Enter");
    await settle();
    focus('#settings-tabs button[data-tab="components"]');
    press("Enter");
    await waitFor("la pagina", () => document.querySelector('[data-profile="studio"]') !== null);
    expect(pressed("studio")).toBe(true);

    // Un profilo che non spegne niente: un tasto, nessuna domanda.
    box.asked = 0;
    focus('[data-profile="tutto"]');
    press("Enter");
    await done();
    expect(pressed("tutto")).toBe(true);
    expect(box.asked).toBe(0);
    expect((document.activeElement as HTMLElement).dataset.profile).toBe("tutto");
    focus('[data-profile="studio"]');
    press(" ");
    await done();
    expect(pressed("studio")).toBe(true);

    // Un interruttore: Spazio spegne, il fuoco resta lì, il profilo diventa
    // personalizzato.
    focus("#component-fub\\.graph");
    press(" ");
    await done();
    expect(sw("fub.graph")!.checked).toBe(false);
    expect(document.activeElement).toBe(sw("fub.graph"));
    expect(document.querySelector(".components-custom")?.textContent).toBe("personalizzato");
    focus('[data-profile="studio"]');
    press("Enter");
    await done();
    expect(sw("fub.graph")!.checked).toBe(true);

    // La finestra delle dipendenze: «Annulla» non spegne niente…
    focus('[data-group="supporto"] .components-group-toggle');
    press("Enter");
    expect(document.activeElement?.getAttribute("aria-expanded")).toBe("true");
    box.confirm = false;
    box.asked = 0;
    focus("#component-fub\\.penna");
    press("Enter");
    await done();
    expect(box.asked).toBe(1);
    expect(sw("fub.penna")!.checked).toBe(true);
    // …e confermare spegne anche chi ne ha bisogno. La scelta rimonta il vault
    // (`vault_closed` e subito `vault_opened`): il pannello resta aperto.
    box.confirm = true;
    focus("#component-fub\\.penna");
    press(" ");
    await done();
    expect(box.asked).toBe(2);
    expect(sw("fub.penna")!.checked).toBe(false);
    expect(sw("fub.lavagna")!.checked).toBe(false);
    await new Promise((r) => setTimeout(r, 2100));
    expect(panel.hidden).toBe(false);
    focus('[data-profile="studio"]');
    press("Enter");
    await done();
    expect(sw("fub.penna")!.checked).toBe(true);

    // «Solo note» spegne qualcosa: lo dice prima.
    box.asked = 0;
    focus('[data-profile="solo-note"]');
    press("Enter");
    await done();
    expect(box.asked).toBe(1);
    expect(pressed("solo-note")).toBe(true);
    // Accendere il PDF accende la penna, e lo dice.
    focus("#component-fub\\.pdf");
    press(" ");
    await done();
    expect(notice()).toContain("«Penna»");
    for (const id of ["lavagna", "pdf", "lavagna"]) {
      focus(`#component-fub\\.${id}`);
      press(" ");
      await done();
    }
    expect(notice()).toContain("Non serve più a nessun componente: «Penna».");
    focus('[data-focus-key="notice:drop"]');
    press("Enter");
    await done();
    expect(notice()).not.toContain("«Penna»");
    expect(sw("fub.penna")!.checked).toBe(false);
    focus("#component-fub\\.pdf");
    press(" ");
    await done();
    focus("#component-fub\\.pdf");
    press(" ");
    await done();
    expect(notice()).toContain("Non serve più a nessun componente: «Penna».");
    focus('[data-focus-key="notice:keep"]');
    press("Enter");
    await done();
    expect(notice()).toBe("");
    expect(sw("fub.penna")!.checked).toBe(true);

    // La ricerca: si scrive, e una ricerca senza esito lo dice.
    const find = focus("#components-find") as HTMLInputElement;
    find.value = "zzz";
    find.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector<HTMLElement>(".components-empty")!.hidden).toBe(false);
    find.value = "penna";
    find.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector<HTMLElement>(".components-empty")!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-component="fub.penna"]')!.hidden).toBe(false);
    expect(panel.hidden).toBe(false);
  }, 40000);
});

describe("vita della finestra", () => {
  it("un avvio lento lo dice, col tratto più lungo, e i tempi si copiano", async () => {
    // L'orologio fermo a venti secondi: la pagina sembra averli spesi tutti.
    // Fuori dal server di sviluppo, dove l'avviso vale.
    const now = vi.spyOn(performance, "now").mockReturnValue(20_000);
    vi.stubEnv("DEV", false);
    try {
      await start(VAULT);
    } finally {
      now.mockRestore();
      vi.unstubAllEnvs();
    }
    const toast = [...document.querySelectorAll(".toast")].find((each) => each.textContent?.includes("20,0 s"));
    expect(toast?.textContent).toContain("il caricamento della pagina");
    expect(toast?.querySelector("button")?.textContent).toContain("Copia i tempi");
  });

  it("sotto il server di sviluppo un avvio lento non si dice: è lento lui", async () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(20_000);
    try {
      await start(VAULT);
    } finally {
      now.mockRestore();
    }
    const toasts = [...document.querySelectorAll(".toast")].map((each) => each.textContent ?? "");
    expect(toasts.some((text) => text.includes("20,0 s"))).toBe(false);
  });

  it("smette i gesti quando si smonta e non duplica al rimontaggio", async () => {
    const first = await mount({});
    const stopFirst = await first.startup;

    const firstOpenVaults = first.host.atGate("openVault").length;
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "o", ctrlKey: true, shiftKey: true }),
    );
    await settle();
    expect(first.host.atGate("openVault")).toHaveLength(firstOpenVaults + 1);

    stopFirst();
    stopFirst();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "o", ctrlKey: true, shiftKey: true }),
    );
    await settle();
    expect(first.host.atGate("openVault")).toHaveLength(firstOpenVaults + 1);

    const second = await mount({});
    const stopSecond = await second.startup;
    const secondOpenVaults = second.host.atGate("openVault").length;
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "o", ctrlKey: true, shiftKey: true }),
    );
    await settle();
    expect(second.host.atGate("openVault")).toHaveLength(secondOpenVaults + 1);

    stopSecond();
  });

  it("ignora una risposta IPC arrivata dopo la chiusura", async () => {
    const mounted = await mount({}, [], "/vault", ["listViews"]);
    await settle();
    expect(mounted.host.atGate("listViews")).toHaveLength(1);

    await mounted.host.close();
    mounted.unlock.get("listViews")!();
    await mounted.startup;
    await settle();

    expect(document.querySelector("#views-left")?.childElementCount).toBe(0);
    expect(mounted.host.atGate("renderView")).toHaveLength(0);
  });
});

describe("aperture in gara: vince l'ultima chiesta", () => {
  /// Tiene in volo le sole chiamate di `port` che `match` riconosce, finché
  /// non si chiama `release`; `reached` si risolve alla prima tenuta. Le altre
  /// chiamate della stessa porta passano: `throttle` le fermerebbe tutte, e
  /// l'avvio non arriverebbe mai al punto che si vuole guardare.
  function hold(host: FakeHost, port: string, match: (...args: unknown[]) => boolean) {
    const api = host.module.api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
    const original = api[port]!.bind(api);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let reach!: () => void;
    const reached = new Promise<void>((resolve) => (reach = resolve));
    api[port] = (...args: unknown[]) => {
      if (!match(...args)) return original(...args);
      reach();
      return gate.then(() => original(...args));
    };
    return { reached, release };
  }

  /// Il riquadro col fuoco dice lo stesso documento dappertutto: la scheda
  /// scelta, il percorso in testa, il testo dell'editor.
  function expectShowing(title: string, text: string): void {
    expect(document.querySelector('.pane.focus .tab[aria-selected="true"]')?.textContent).toContain(title);
    expect(document.querySelector(".pane.focus .muted")?.textContent).toContain(title);
    expect(textToVideo()).toContain(text);
  }

  function tabNames(): string[] {
    return [...document.querySelectorAll(".pane.focus .tab")].map((tab) => tab.textContent ?? "");
  }

  it("la prima nota lenta all'avvio non vince sul documento aperto intanto", async () => {
    const { host, startup, unlock } = await mount(VAULT, [], undefined, ["openDocument"]);
    await waitFor("l'avvio apre la prima nota", () => host.atGate("openDocument").some((c) => c.args[0] === "Benvenuto.md"));
    const controller = await import("./state/document-controller");
    const opening = controller.openDocument("note/Spesa.md", { gesture: true });
    unlock.get("openDocument")!();
    await Promise.all([startup, opening]);
    await settle();
    expectShowing("Spesa", "pane, latte");
  });

  it("la prima nota decisa prima di un'apertura chiesta intanto non parte", async () => {
    // L'ordine inverso: l'avvio ha visto il riquadro vuoto e cerca la prima
    // nota; intanto si apre un documento. Arrivata la risposta, la decisione
    // è vecchia e non deve scavalcare il documento aperto.
    let first!: ReturnType<typeof hold>;
    const { host, startup } = await mount(VAULT, [], undefined, [], null, [], (fake) => {
      first = hold(fake, "queryIndex", (q) => {
        const query = q as { kind?: string; of_kind?: string | null; page?: { limit?: number } };
        return query.kind === "entries" && query.of_kind === "document" && query.page?.limit === 1;
      });
    });
    await first.reached;
    const controller = await import("./state/document-controller");
    await controller.openDocument("note/Spesa.md", { gesture: true });
    first.release();
    await startup;
    await settle();
    expectShowing("Spesa", "pane, latte");
    expect(tabNames().some((name) => name.includes("Benvenuto"))).toBe(false);
    expect(host.atGate("openDocument").some((c) => c.args[0] === "Benvenuto.md")).toBe(false);
  });

  it("la nota d'avvio non scavalca il documento aperto mentre la si controllava", async () => {
    const choice = (key: string, value: string) => ({ spec: { key }, value, source: "machine" }) as unknown as SettingEntry;
    let check!: ReturnType<typeof hold>;
    const settings = [choice("files.startup", "note"), choice("files.startup-note", "note/Riunione.md")];
    const { startup } = await mount(VAULT, settings, undefined, [], null, [], (fake) => {
      check = hold(fake, "readDocument", (id) => id === "note/Riunione.md");
    });
    await check.reached;
    const controller = await import("./state/document-controller");
    await controller.openDocument("note/Spesa.md", { gesture: true });
    check.release();
    await startup;
    await settle();
    expectShowing("Spesa", "pane, latte");
    expect(tabNames().some((name) => name.includes("Riunione"))).toBe(false);
  });

  it("durante un'apertura lenta il percorso in testa è già del documento chiesto", async () => {
    const host = await start(VAULT);
    await waitFor("Benvenuto è a schermo", () => textToVideo().includes("primo documento"));
    const controller = await import("./state/document-controller");
    const unlock = host.throttle("openDocument");
    const opening = controller.openDocument("note/Spesa.md", { gesture: true });
    await waitFor("la lettura di Spesa è partita", () => host.atGate("openDocument").some((c) => c.args[0] === "note/Spesa.md"));
    await settle();
    // La scheda è già di Spesa: il percorso dice lo stesso, non Benvenuto.
    expect(document.querySelector('.pane.focus .tab[aria-selected="true"]')?.textContent).toContain("Spesa");
    expect(document.querySelector(".pane.focus .muted")?.textContent).toContain("Spesa");
    expect(document.querySelector(".pane.focus .muted")?.textContent).not.toContain("Benvenuto");
    unlock();
    await opening;
    await settle();
    expectShowing("Spesa", "pane, latte");
  });

  it("due aperture rapide: resta l'ultima, e la prima resta una scheda", async () => {
    const host = await start(VAULT);
    const controller = await import("./state/document-controller");
    const unlock = host.throttle("openDocument");
    const first = controller.openDocument("note/Riunione.md", { gesture: true });
    const second = controller.openDocument("note/Spesa.md", { gesture: true });
    await settle();
    unlock();
    await Promise.all([first, second]);
    await settle();
    expectShowing("Spesa", "pane, latte");
    expect(tabNames().some((name) => name.includes("Riunione"))).toBe(true);
  });
});

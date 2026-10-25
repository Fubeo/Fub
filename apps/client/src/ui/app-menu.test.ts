// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountAppMenu, type MenuHost } from "./app-menu";
import { closeContextMenu } from "./menu";
import type { ShellCommandId } from "./shell-keys.generated";

function key(target: EventTarget, value: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe("menubar applicativa", () => {
  let teardown: (() => void) | undefined;
  let runCalls: ShellCommandId[];

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    const menubar = document.createElement("nav");
    menubar.id = "app-menu";
    menubar.setAttribute("role", "menubar");
    document.body.append(menubar);
    runCalls = [];
    const host: MenuHost = { run: (id) => runCalls.push(id) };
    teardown = mountAppMenu(host);
  });

  afterEach(() => {
    teardown?.();
    closeContextMenu();
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("lascia un solo top-level nel giro del Tab e sposta il fuoco con le frecce", () => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>("#app-menu > button")];
    expect(buttons).toHaveLength(6);
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1, -1, -1, -1]);

    buttons[0]!.focus();
    key(buttons[0]!, "ArrowRight");
    expect(document.activeElement).toBe(buttons[1]);
    key(buttons[1]!, "End");
    expect(document.activeElement).toBe(buttons[5]);
    key(buttons[5]!, "Home");
    expect(document.activeElement).toBe(buttons[0]);
    key(buttons[0]!, "ArrowLeft");
    expect(document.activeElement).toBe(buttons[5]);
  });

  it("Down apre il menu e mette il fuoco sulla prima voce", () => {
    const button = document.querySelector<HTMLButtonElement>("#app-menu > button")!;
    button.focus();
    const event = key(button, "ArrowDown");
    const item = document.querySelector<HTMLButtonElement>("#context-menu [role=menuitem]");

    expect(event.defaultPrevented).toBe(true);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(item);
  });

  it("chiude e ripristina il trigger dopo click, Escape e chiusura esterna", () => {
    const button = document.querySelector<HTMLButtonElement>("#app-menu > button")!;
    button.click();
    const item = document.querySelector<HTMLButtonElement>("#context-menu [role=menuitem]")!;
    item.click();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(runCalls).toHaveLength(1);
    expect(document.activeElement).toBe(button);

    button.click();
    key(document.activeElement!, "Escape");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);

    button.click();
    closeContextMenu();
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
    button.click();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
  });

  it("chiude il menu e stacca i bottoni quando la finestra si smonta", () => {
    const button = document.querySelector<HTMLButtonElement>("#app-menu > button")!;
    expect(button.textContent).toBe("File");
    button.click();
    expect(document.getElementById("context-menu")).not.toBeNull();

    teardown!();
    vi.runAllTimers();

    expect(document.getElementById("context-menu")).toBeNull();
    expect(document.querySelectorAll("#app-menu > button")).toHaveLength(0);
    button.click();
    expect(document.getElementById("context-menu")).toBeNull();
  });

  it("la ricerca trova una voce in qualunque menu e la esegue", () => {
    const search = document.querySelectorAll<HTMLButtonElement>("#app-menu > button")[5]!;
    search.click();
    const input = document.querySelector<HTMLInputElement>(".app-menu-search-input")!;
    expect(search.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(input);
    input.value = "impostaz";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const options = [...document.querySelectorAll(".app-menu-search-option")];
    // «Impostazioni» sta in due menu e si offre una volta sola.
    expect(options).toHaveLength(1);
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    key(input, "Enter");
    expect(runCalls).toEqual(["shell.settings"]);
    expect(document.querySelector(".app-menu-search-panel")).toBeNull();
    expect(search.getAttribute("aria-expanded")).toBe("false");
  });

  it("Esc chiude la ricerca e rida il fuoco al pulsante; senza risultati lo dice", () => {
    const search = document.querySelectorAll<HTMLButtonElement>("#app-menu > button")[5]!;
    search.click();
    const input = document.querySelector<HTMLInputElement>(".app-menu-search-input")!;
    input.value = "zzzz";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(document.querySelector(".app-menu-search-status")!.textContent).not.toBe("");
    key(input, "Escape");
    expect(document.querySelector(".app-menu-search-panel")).toBeNull();
    expect(document.activeElement).toBe(search);
  });

  it("le frecce spostano la voce evidenziata, e lo smontaggio toglie il pannello", () => {
    const search = document.querySelectorAll<HTMLButtonElement>("#app-menu > button")[5]!;
    search.click();
    const input = document.querySelector<HTMLInputElement>(".app-menu-search-input")!;
    const options = [...document.querySelectorAll(".app-menu-search-option")];
    expect(options.length).toBeGreaterThan(3);
    key(input, "ArrowDown");
    expect(options[1]!.getAttribute("aria-selected")).toBe("true");
    key(input, "ArrowUp");
    key(input, "ArrowUp");
    expect(options[options.length - 1]!.getAttribute("aria-selected")).toBe("true");
    teardown?.();
    expect(document.querySelector(".app-menu-search-panel")).toBeNull();
  });
});

describe("il menu Vista e le view principali", () => {
  afterEach(() => {
    closeContextMenu();
    document.body.replaceChildren();
  });

  function mountWith(views: MenuHost["views"]): () => void {
    document.body.replaceChildren();
    const menubar = document.createElement("nav");
    menubar.id = "app-menu";
    document.body.append(menubar);
    return mountAppMenu({ run: () => {}, views });
  }

  function viewMenuLabels(): string[] {
    document.querySelector<HTMLButtonElement>("#app-menu-2")!.click();
    return [...document.querySelectorAll<HTMLElement>("#context-menu [role=menuitem]")].map(
      (item) => item.textContent ?? "",
    );
  }

  it("elenca le view dichiarate, lette a ogni apertura, e le apre", () => {
    const opened: string[] = [];
    let declared = [{ label: "Apri la vista Grafo", run: () => opened.push("graph") }];
    const teardown = mountWith(() => declared);
    expect(viewMenuLabels()).toContain("Apri la vista Grafo");
    const item = [...document.querySelectorAll<HTMLButtonElement>("#context-menu [role=menuitem]")]
      .find((entry) => entry.textContent === "Apri la vista Grafo")!;
    item.click();
    expect(opened).toEqual(["graph"]);

    // Il componente si spegne: la voce se ne va con la view, non resta a
    // aprire qualcosa che non c'è.
    declared = [];
    expect(viewMenuLabels().some((label) => label.includes("Grafo"))).toBe(false);
    teardown();
  });

  it("una voce facoltativa c'è solo dove il suo comando è dichiarato", () => {
    const menubar = document.createElement("nav");
    menubar.id = "app-menu";
    document.body.append(menubar);
    const ran: ShellCommandId[] = [];
    const declared = new Set<ShellCommandId>();
    const teardown = mountAppMenu({ run: (id) => ran.push(id), has: (id) => declared.has(id) });

    // Nessuno lo dichiara: il menu non mostra una riga che non farebbe niente.
    const without = viewMenuLabels();
    expect(without).not.toContain("Più spazio al foglio");
    expect(without).toContain("Ingrandisci");
    closeContextMenu();

    // Letta a ogni apertura, come le scorciatoie.
    declared.add("shell.chrome.compact.more");
    const labels = viewMenuLabels();
    expect(labels).toContain("Più spazio al foglio");
    expect(labels).not.toContain("Meno spazio al foglio");
    [...document.querySelectorAll<HTMLButtonElement>("#context-menu [role=menuitem]")]
      .find((entry) => entry.textContent === "Più spazio al foglio")!
      .click();
    expect(ran).toEqual(["shell.chrome.compact.more"]);
    teardown();
  });

  it("senza chi sappia rispondere, le voci facoltative non compaiono", () => {
    const teardown = mountWith(() => []);
    expect(viewMenuLabels().some((label) => label.includes("spazio"))).toBe(false);
    teardown();
  });

  it("i modi del lanciatore hanno una voce dove una cornice li dichiara", () => {
    const menubar = document.createElement("nav");
    menubar.id = "app-menu";
    document.body.append(menubar);
    const ran: ShellCommandId[] = [];
    const declared = new Set<ShellCommandId>();
    const teardown = mountAppMenu({ run: (id) => ran.push(id), has: (id) => declared.has(id) });
    const labelsOf = (menu: number): string[] => {
      document.querySelector<HTMLButtonElement>(`#app-menu-${menu}`)!.click();
      return [...document.querySelectorAll<HTMLElement>("#context-menu [role=menuitem]")].map(
        (item) => item.textContent ?? "",
      );
    };

    expect(labelsOf(3)).not.toContain("Vai a un'intestazione");
    closeContextMenu();
    expect(labelsOf(0)).not.toContain("Nuova nota da un modello");
    closeContextMenu();

    for (const id of [
      "shell.launcher.search",
      "shell.launcher.headings",
      "shell.launcher.line",
      "shell.launcher.tags",
      "shell.launcher.templates",
    ] as const) declared.add(id);
    expect(labelsOf(0)).toContain("Nuova nota da un modello");
    closeContextMenu();
    const go = labelsOf(3);
    expect(go.slice(0, 5)).toEqual([
      "Vai alla nota",
      "Cerca nel vault dal lanciatore",
      "Vai a un'intestazione",
      "Vai a una riga",
      "Sfoglia le etichette",
    ]);
    [...document.querySelectorAll<HTMLButtonElement>("#context-menu [role=menuitem]")]
      .find((entry) => entry.textContent === "Vai a una riga")!
      .click();
    expect(ran).toEqual(["shell.launcher.line"]);
    teardown();
  });
});

describe("il menu File e le creazioni", () => {
  afterEach(() => {
    closeContextMenu();
    document.body.replaceChildren();
  });

  function mountWith(creations: MenuHost["creations"]): () => void {
    document.body.replaceChildren();
    const menubar = document.createElement("nav");
    menubar.id = "app-menu";
    document.body.append(menubar);
    return mountAppMenu({ run: () => {}, creations });
  }

  function fileMenuLabels(): string[] {
    document.querySelector<HTMLButtonElement>("#app-menu-0")!.click();
    return [...document.querySelectorAll<HTMLElement>("#context-menu [role=menuitem]")].map(
      (item) => item.textContent ?? "",
    );
  }

  it("mette «Nuovo disegno…» subito dopo «Nuova nota», e lo esegue", () => {
    const opened: string[] = [];
    const teardown = mountWith(() => [{ label: "Nuovo disegno…", run: () => opened.push("disegno") }]);
    const labels = fileMenuLabels();
    expect(labels.indexOf("Nuovo disegno…")).toBe(labels.indexOf("Nuova nota") + 1);
    const item = [...document.querySelectorAll<HTMLButtonElement>("#context-menu [role=menuitem]")]
      .find((entry) => entry.textContent === "Nuovo disegno…")!;
    item.click();
    expect(opened).toEqual(["disegno"]);
    // Il menu si è chiuso: la voce non lascia il menu aperto sotto la galleria.
    expect(document.querySelector("#app-menu-0")!.getAttribute("aria-expanded")).toBe("false");
    teardown();
  });

  it("senza creazioni la voce non c'è, e il resto del menu File è quello di prima", () => {
    const without = mountWith(undefined);
    const bare = fileMenuLabels();
    expect(bare).not.toContain("Nuovo disegno…");
    expect(bare.indexOf("Nuova nota")).toBe(0);
    expect(bare[1]).not.toBe("");
    without();

    const empty = mountWith(() => []);
    expect(fileMenuLabels()).toEqual(bare);
    empty();
  });

  it("legge l'elenco a ogni apertura: il comando che arriva dopo compare, quello che se ne va sparisce", () => {
    let declared = false;
    const teardown = mountWith(() => (declared ? [{ label: "Nuovo disegno…", run: () => {} }] : []));
    expect(fileMenuLabels()).not.toContain("Nuovo disegno…");
    closeContextMenu();
    declared = true;
    expect(fileMenuLabels()).toContain("Nuovo disegno…");
    closeContextMenu();
    declared = false;
    expect(fileMenuLabels()).not.toContain("Nuovo disegno…");
    teardown();
  });
});

describe("il menu File e il vault intero", () => {
  afterEach(() => {
    closeContextMenu();
    document.body.replaceChildren();
  });

  it("snapshot e ripristino stanno subito dopo «Apri vault…», e ci sono solo se la shell li offre", () => {
    const menubar = document.createElement("nav");
    menubar.id = "app-menu";
    document.body.replaceChildren(menubar);
    const ran: string[] = [];
    let offered = true;
    const teardown = mountAppMenu({
      run: () => {},
      vault: () => (offered ? [
        { label: "Snapshot completo del vault…", run: () => ran.push("crea") },
        { label: "Ripristina uno snapshot…", run: () => ran.push("ripristina") },
      ] : []),
    });
    const labels = (): string[] => {
      document.querySelector<HTMLButtonElement>("#app-menu-0")!.click();
      return [...document.querySelectorAll<HTMLElement>("#context-menu [role=menuitem]")].map((item) => item.textContent ?? "");
    };
    const shown = labels();
    const open = shown.indexOf("Apri vault…");
    expect(shown.slice(open + 1, open + 3)).toEqual(["Snapshot completo del vault…", "Ripristina uno snapshot…"]);
    [...document.querySelectorAll<HTMLButtonElement>("#context-menu [role=menuitem]")]
      .find((entry) => entry.textContent === "Ripristina uno snapshot…")!
      .click();
    expect(ran).toEqual(["ripristina"]);
    offered = false;
    expect(labels()).not.toContain("Snapshot completo del vault…");
    teardown();
  });
});

describe("il menu Vista e le scelte", () => {
  afterEach(() => {
    closeContextMenu();
    document.body.replaceChildren();
  });

  it("spunta la modalità del foglio a fuoco e dice dove porta la luce", () => {
    const menubar = document.createElement("nav");
    menubar.id = "app-menu";
    document.body.replaceChildren(menubar);
    let mode = "shell.mode.source";
    const teardown = mountAppMenu({
      run: () => {},
      has: () => true,
      choice: (id) => (id.startsWith("shell.mode.") ? { choice: "radio", checked: id === mode } : undefined),
      label: (id) => (id === "shell.light.toggle" ? "Passa alla luce giorno" : undefined),
    });
    const open = (): HTMLElement[] => {
      document.querySelector<HTMLButtonElement>("#app-menu-2")!.click();
      return [...document.querySelectorAll<HTMLElement>("#context-menu [role^=menuitem]")];
    };
    let items = open();
    const radios = items.filter((item) => item.getAttribute("role") === "menuitemradio");
    expect(radios.map((item) => item.querySelector(".menu-label")?.textContent)).toEqual(["Modalità Live", "Modalità Sorgente", "Modalità Lettura"]);
    expect(radios.map((item) => item.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(items.map((item) => item.querySelector(".menu-label")?.textContent)).toContain("Passa alla luce giorno");
    closeContextMenu();

    // Letta a ogni apertura: cambiata la modalità, la spunta la segue.
    mode = "shell.mode.reading";
    items = open();
    expect(items.filter((item) => item.getAttribute("aria-checked") === "true").map((item) => item.querySelector(".menu-label")?.textContent))
      .toEqual(["Modalità Lettura"]);
    teardown();
  });
});

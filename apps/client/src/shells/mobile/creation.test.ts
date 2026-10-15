// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommandSpec } from "../../host/contract";
import { mountStrings } from "../../i18n/strings";
import { setCommandSpecs, state } from "../../state/store";
import {
  registerCommandForm,
  registerCommandStarter,
  resetCommandForms,
} from "../../ui/commands";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { mountMobileCreations } from "./creation";

function spec(id: string): CommandSpec {
  return {
    id,
    title: id,
    description: "",
    keybinding: null,
    params: [],
    scope: { writes: true, reach: "document", reversible: true },
    surfaces: [],
  };
}

/// Il titolo dell'albero come lo ha `mobile.html`: il nome e «+ Nuova».
function mountTitle(): void {
  document.body.innerHTML = `
    <div id="files-title" role="heading" aria-level="2">
      <span id="space-title">Note</span>
      <button id="new-note" class="link-button" type="button">+ Nuova</button>
    </div>`;
}

const button = (): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>("#new-drawing");

describe("la porta di «Nuovo disegno» della shell mobile", () => {
  let lifetime: Lifetime;

  beforeEach(() => {
    mountTitle();
    state.activeSpace = null;
    setCommandSpecs([]);
    resetCommandForms();
    lifetime = openLifetime();
  });

  afterEach(() => {
    lifetime.close();
    resetCommandForms();
    setCommandSpecs([]);
    state.activeSpace = null;
  });

  it("sta accanto a «+ Nuova», nascosto finché il kernel non dichiara il comando", () => {
    mountMobileCreations(lifetime);
    const found = button();
    expect(found).not.toBeNull();
    expect(found!.previousElementSibling?.id).toBe("new-note");
    expect(found!.hidden).toBe(true);
    expect(found!.textContent).toBe("+ Disegno");

    // L'elenco dei comandi arriva dopo l'apertura del vault.
    setCommandSpecs([spec("note.create")]);
    expect(found!.hidden).toBe(true);
    setCommandSpecs([spec("note.create"), spec("drawing.create")]);
    expect(found!.hidden).toBe(false);
    // E se la feature si spegne, la porta si chiude.
    setCommandSpecs([spec("note.create")]);
    expect(found!.hidden).toBe(true);
  });

  it("è un bottone vero, col nome e il suggerimento della shell", () => {
    setCommandSpecs([spec("drawing.create")]);
    mountMobileCreations(lifetime);
    const found = button()!;
    expect(found.hidden).toBe(false);
    expect(found.tagName).toBe("BUTTON");
    expect(found.type).toBe("button");
    // Il suggerimento della shell si appoggia a un `aria-describedby` quando
    // l'elemento prende il fuoco.
    found.dispatchEvent(new FocusEvent("focus"));
    expect(found.getAttribute("aria-describedby")).toBe("fub-tooltip");
    expect(document.getElementById("fub-tooltip")?.textContent).toBe(
      "Crea un disegno, vuoto o da un modello",
    );
  });

  it("apre il modulo dei modelli dalla radice, o dallo spazio attivo", () => {
    setCommandSpecs([spec("drawing.create")]);
    const opened: Record<string, string>[] = [];
    registerCommandForm("drawing.create", (prefill) => opened.push({ ...prefill }));
    mountMobileCreations(lifetime);
    button()!.click();
    state.activeSpace = "Scienze";
    button()!.click();
    expect(opened).toEqual([{}, { folder: "Scienze" }]);
  });

  it("senza il modulo dei modelli ripiega sulla palette del comando", () => {
    setCommandSpecs([spec("drawing.create")]);
    const started: { id: string; prefill: Readonly<Record<string, string>> }[] = [];
    registerCommandStarter((entry, prefill) => started.push({ id: entry.id, prefill }));
    mountMobileCreations(lifetime);
    state.activeSpace = "Scienze";
    button()!.click();
    expect(started).toEqual([{ id: "drawing.create", prefill: { folder: "Scienze" } }]);
  });

  it("parla la lingua dell'interfaccia", () => {
    // La lingua scelta si ricorda in `localStorage`, e `mountStrings` la legge.
    localStorage.setItem("fub.locale.language", "en");
    const stop = mountStrings(() => {});
    try {
      setCommandSpecs([spec("drawing.create")]);
      mountMobileCreations(lifetime);
      expect(button()!.textContent).toBe("+ Drawing");
    } finally {
      stop();
      localStorage.removeItem("fub.locale.language");
      mountStrings(() => {})();
    }
  });

  it("si smonta senza lasciare il bottone né gli ascoltatori", () => {
    setCommandSpecs([spec("drawing.create")]);
    const opened: string[] = [];
    registerCommandForm("drawing.create", () => opened.push("aperto"));
    mountMobileCreations(lifetime);
    const found = button()!;
    lifetime.close();
    expect(button()).toBeNull();
    found.click();
    expect(opened).toEqual([]);
    // Un segnale dopo lo smontaggio non lo rimette in piedi.
    setCommandSpecs([spec("drawing.create"), spec("note.create")]);
    expect(button()).toBeNull();
  });

  it("senza il titolo dell'albero non fa niente", () => {
    document.body.innerHTML = "";
    expect(() => mountMobileCreations(lifetime)).not.toThrow();
    expect(button()).toBeNull();
  });
});

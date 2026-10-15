// @vitest-environment happy-dom
// I suggerimenti brevi da soli: nessuno prima che la memoria arrivi, uno alla
// volta e una volta sola, il gesto fatto che li chiude per sempre, la casella
// che li spegne, la croce ed Esc che chiudono e ridanno il fuoco, la regione
// che li legge, e quelli visti prima che la memoria arrivasse.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAccessibility, formatIssues } from "../../../ui/a11y-check";
import { openLifetime, type Lifetime } from "../../../ui/lifetime";
import { createSuggestions, type SuggestionId, type Suggestions } from "./suggestions";

let host: HTMLElement;
let life: Lifetime;
let calls: string[];
let words: Record<SuggestionId, string>;

/// I suggerimenti su una memoria finta, che registra ciò che chiedono.
function mount(): Suggestions {
  const tips = createSuggestions(life, {
    text: (id) => words[id],
    onSeen: (seen) => calls.push(`seen ${seen.join(" ")}`),
    onSwitch: (on) => calls.push(`switch ${on}`),
    onClose: () => {
      calls.push("close");
      outside.focus();
    },
  });
  host.append(tips.element);
  return tips;
}

let outside: HTMLButtonElement;
const row = (): HTMLElement => host.querySelector<HTMLElement>(".draw-suggestion")!;
const said = (): string => host.querySelector<HTMLElement>("[aria-live]")!.textContent ?? "";
const box = (): HTMLInputElement => host.querySelector<HTMLInputElement>('.draw-suggestion-off input[type="checkbox"]')!;
const closer = (): HTMLButtonElement => host.querySelector<HTMLButtonElement>(".draw-suggestion-close")!;

beforeEach(() => {
  host = document.createElement("div");
  outside = document.createElement("button");
  outside.textContent = "Foglio";
  document.body.append(outside, host);
  life = openLifetime();
  calls = [];
  words = { "two-fingers": "Due dita.", "hold-shape": "Tieni fermo.", "label-shape": "Scrivi dentro." };
});

afterEach(() => {
  life.close();
  host.remove();
  outside.remove();
});

describe("i suggerimenti", () => {
  it("non si mostrano prima che la memoria arrivi, né spenti", () => {
    const tips = mount();
    expect(tips.wants("two-fingers")).toBe(false);
    expect(tips.offer("two-fingers")).toBe(false);
    expect(row().hidden).toBe(true);
    tips.remember({ on: false, seen: [] });
    expect(tips.offer("two-fingers")).toBe(false);
    expect(box().checked, "la casella dice che sono spenti").toBe(true);
    tips.remember({ on: true, seen: [] });
    expect(tips.wants("two-fingers")).toBe(true);
    expect(calls).toEqual([]);
  });

  it("uno alla volta, una volta sola: mostrato è visto, e lo legge la regione", () => {
    const tips = mount();
    tips.remember({ on: true, seen: ["domani"] });
    expect(tips.offer("hold-shape")).toBe(true);
    expect(tips.showing).toBe("hold-shape");
    expect(row().hidden).toBe(false);
    expect(row().getAttribute("role")).toBe("group");
    expect(row().getAttribute("aria-label")).toBe("Suggerimento");
    expect(row().querySelector(".draw-suggestion-text")!.textContent).toBe("Tieni fermo.");
    expect(said()).toBe("Suggerimento: Tieni fermo.");
    // Un nome sconosciuto resta, per una versione più nuova.
    expect(calls).toEqual(["seen domani hold-shape"]);
    expect(tips.wants("label-shape"), "un altro aspetta").toBe(false);
    expect(tips.offer("label-shape")).toBe(false);
    expect(formatIssues(checkAccessibility(host))).toBe("");

    closer().click();
    expect(row().hidden).toBe(true);
    expect(tips.showing).toBeNull();
    expect(calls, "il fuoco non era dentro: resta dov'è").toEqual(["seen domani hold-shape"]);
    expect(tips.offer("hold-shape"), "non torna").toBe(false);
    expect(tips.offer("label-shape")).toBe(true);
  });

  it("chi fa il gesto non lo vede più, e se è a schermo si chiude", () => {
    const tips = mount();
    tips.remember({ on: true, seen: [] });
    tips.done("two-fingers");
    expect(calls).toEqual(["seen two-fingers"]);
    expect(tips.offer("two-fingers")).toBe(false);
    tips.done("two-fingers");
    expect(calls, "una volta sola").toHaveLength(1);

    tips.offer("label-shape");
    closer().focus();
    tips.done("label-shape");
    expect(row().hidden).toBe(true);
    expect(calls, "il fuoco era dentro: torna al foglio").toEqual(["seen two-fingers", "seen two-fingers label-shape", "close"]);
    expect(document.activeElement).toBe(outside);
  });

  it("quelli visti prima che la memoria arrivasse le arrivano con lei", () => {
    const tips = mount();
    tips.done("hold-shape");
    expect(calls).toEqual([]);
    tips.remember({ on: true, seen: ["two-fingers"] });
    expect(calls).toEqual(["seen two-fingers hold-shape"]);
    tips.remember({ on: true, seen: ["two-fingers", "hold-shape"] });
    expect(calls, "niente di nuovo").toHaveLength(1);
    expect(tips.wants("hold-shape")).toBe(false);
    expect(tips.wants("two-fingers")).toBe(false);
  });

  it("la casella li spegne e li riaccende; quello a schermo resta finché non lo si chiude", () => {
    const tips = mount();
    tips.remember({ on: true, seen: [] });
    tips.offer("two-fingers");
    expect(box().checked).toBe(false);
    expect(box().closest("label")!.textContent).toBe("Non mostrare più suggerimenti");
    box().click();
    expect(calls[calls.length - 1]).toBe("switch false");
    expect(tips.showing, "resta").toBe("two-fingers");
    closer().click();
    expect(tips.wants("hold-shape"), "spenti subito, prima che l'impostazione torni").toBe(false);

    // L'impostazione cambiata altrove li riaccende, e la casella lo dice.
    tips.remember({ on: true, seen: ["two-fingers"] });
    expect(tips.offer("hold-shape")).toBe(true);
    expect(box().checked).toBe(false);
    box().click();
    box().click();
    expect(calls.slice(-2)).toEqual(["switch false", "switch true"]);
    expect(tips.showing).toBe("hold-shape");
  });

  it("Esc e la croce chiudono, col fuoco al foglio; il pulsante ha un nome", () => {
    const tips = mount();
    tips.remember({ on: true, seen: [] });
    tips.offer("two-fingers");
    expect(closer().getAttribute("aria-label")).toBe("Chiudi il suggerimento");
    closer().focus();
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    let reached = false;
    host.addEventListener("keydown", () => (reached = true));
    closer().dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(reached, "l'editor non vede l'Esc").toBe(false);
    expect(row().hidden).toBe(true);
    expect(document.activeElement).toBe(outside);

    tips.offer("hold-shape");
    box().focus();
    closer().click();
    expect(calls.filter((call) => call === "close")).toHaveLength(2);
  });

  it("rilegge il testo di quello a schermo", () => {
    const tips = mount();
    tips.remember({ on: true, seen: [] });
    tips.offer("two-fingers");
    words["two-fingers"] = "Due dita, e i tocchi.";
    tips.relabel();
    expect(row().querySelector(".draw-suggestion-text")!.textContent).toBe("Due dita, e i tocchi.");
    tips.close();
    expect(row().hidden).toBe(true);
  });
});

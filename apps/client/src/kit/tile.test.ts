// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { motionLevel, setMotionPreference } from "../moto";
import { accessibleName, checkAccessibility, formatIssues } from "../ui/a11y-check";
import { openLifetime, type Lifetime } from "../ui/lifetime";
import { resetTooltips } from "../ui/tooltip";
import { markLit, markPressed } from "./row";
import { createTile } from "./tile";

let life: Lifetime;

beforeEach(() => {
  life = openLifetime();
});

afterEach(() => {
  life.close();
  resetTooltips();
  setMotionPreference("system");
  document.body.replaceChildren();
});

describe("createTile", () => {
  it("affiancata di serie: la figura e il nome in fila, e il nome è quello che si sente", () => {
    const tile = createTile({ label: "Copia", icon: "copy", keys: "Ctrl+C", role: "menuitem", className: "menu-quick" });
    document.body.append(tile);
    expect(tile.tagName).toBe("BUTTON");
    expect(tile.type).toBe("button");
    expect(tile.className).toBe("kit-tile menu-quick");
    expect(tile.dataset.shape).toBe("inline");
    expect([...tile.children].map((part) => part.className)).toEqual(["kit-tile-icon", "kit-tile-label"]);
    expect(tile.querySelector(".kit-tile-icon")!.getAttribute("aria-hidden")).toBe("true");
    expect(tile.querySelector("svg")!.getAttribute("aria-hidden")).toBe("true");
    expect(tile.getAttribute("aria-keyshortcuts")).toBe("Ctrl+C");
    expect(accessibleName(tile)).toBe("Copia");
  });

  it("in pila tiene il quadrato anche senza icona: il segno dato, o la prima lettera", () => {
    const glyph = createTile({ label: "Titolo", glyph: "H1", shape: "stack" });
    expect(glyph.dataset.shape).toBe("stack");
    expect(glyph.querySelector(".kit-tile-icon")!.textContent).toBe("H1");
    const bare = createTile({ label: "scheda", shape: "stack" });
    expect(bare.querySelector(".kit-tile-icon")!.textContent).toBe("S");
    // Il segno non parla: chi ascolta sente il nome, una volta.
    expect(bare.querySelector(".kit-tile-icon")!.getAttribute("aria-hidden")).toBe("true");
    expect(bare.querySelector(".kit-tile-label")!.textContent).toBe("scheda");
    // Un'icona che non esiste fa come nessuna icona.
    expect(createTile({ label: "Base", icon: "non-esiste", shape: "stack" }).querySelector(".kit-tile-icon")!.textContent).toBe("B");
  });

  it("affiancata senza icona né segno non disegna la figura", () => {
    const tile = createTile({ label: "Incolla" });
    expect(tile.querySelector(".kit-tile-icon")).toBeNull();
    expect([...tile.children].map((part) => part.className)).toEqual(["kit-tile-label"]);
  });

  it("un nome lunghissimo resta il nome intero, nella sua parte", () => {
    const long = "Diagramma di flusso con un nome che non ci sta";
    const tile = createTile({ label: long, icon: "graph", shape: "stack" });
    expect(tile.querySelector(".kit-tile-label")!.textContent).toBe(long);
  });

  it("spenta dice il perché a chi ascolta e, con una vita, nel suggerimento", () => {
    const tile = createTile({ label: "Base", icon: "collection", disabled: { reason: "Serve una nota salvata" }, lifetime: life });
    document.body.append(tile);
    expect(tile.getAttribute("aria-disabled")).toBe("true");
    expect(tile.getAttribute("aria-description")).toBe("Serve una nota salvata");
    tile.focus();
    expect(document.getElementById("fub-tooltip")?.textContent).toBe("Serve una nota salvata");
    expect(formatIssues(checkAccessibility(document.body))).toBe("");
  });

  it("premuta col moto ridotto ha lo stesso stato, subito: niente aspetta un'animazione", () => {
    setMotionPreference("reduced");
    expect(motionLevel()).toBe("reduced");
    const tile = createTile({ label: "Riquadro", icon: "blocks", shape: "stack" });
    markLit(tile, true);
    markPressed(tile, true);
    expect(tile.hasAttribute("data-pressed")).toBe(true);
    expect(tile.hasAttribute("data-lit")).toBe(true);
    expect(tile.style.getPropertyValue("scale")).toBe("");
    expect(tile.getAnimations?.() ?? []).toEqual([]);
  });
});

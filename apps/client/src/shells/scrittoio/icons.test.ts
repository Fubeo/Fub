// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { icon, registerIcon } from "../../ui/icons";
import { openLifetime } from "../../ui/lifetime";
import { mountFrameIcons } from "./icons";

/// Figure che solo la cornice disegna: il set di serie non le ha.
const OWN = ["arrow-left", "panel-right", "sun", "moon", "caret-down", "ring"];

describe("le icone della cornice", () => {
  it("ci sono finché la cornice è montata, e se ne vanno con lei", () => {
    const missing = OWN.filter((name) => icon(name) === "");
    const life = openLifetime();
    mountFrameIcons(life);
    for (const name of OWN) expect(icon(name), name).toContain("<path");
    life.close();
    // Ciò che non c'era prima non resta dopo.
    for (const name of missing) expect(icon(name), name).toBe("");
  });

  it("montate due volte non lanciano, e la seconda non toglie quelle della prima", () => {
    const first = openLifetime();
    const second = openLifetime();
    mountFrameIcons(first);
    expect(() => mountFrameIcons(second)).not.toThrow();
    second.close();
    for (const name of OWN) expect(icon(name), name).toContain("<path");
    first.close();
  });

  it("non ridefinisce una figura che qualcun altro ha già disegnato", () => {
    if (icon("ring") !== "") return;
    const theirs = registerIcon("ring", ["M1 1h2"]);
    const life = openLifetime();
    mountFrameIcons(life);
    expect(icon("ring")).toContain("M1 1h2");
    life.close();
    expect(icon("ring")).toContain("M1 1h2");
    theirs();
  });
});

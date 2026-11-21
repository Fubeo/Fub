// @vitest-environment happy-dom
// Il bottone dello spazio di lavoro nella banda (T7): com'è disegnato, e che
// cosa mette nel menu. Lo spazio arriva da una superficie finta: qui conta
// ciò che la banda ne fa.
import { describe, expect, it } from "vitest";
import type { SurfaceWorkspace, SurfaceWorkspaceAction, SurfaceWorkspaceChoice } from "../../../editors/core/registry";
import { drawWorkspaceButton, workspaceMenuItems } from "./workspace-button";

const base: SurfaceWorkspaceChoice[] = [
  { id: "simple", name: "Semplice", description: "Per dita e penna", group: "base", enabled: true },
  { id: "full", name: "Completo", description: "Tutti gli strumenti", group: "base", enabled: true },
];
const preset: SurfaceWorkspaceChoice[] = [
  { id: "automazione", name: "Automazione", group: "completo", enabled: false, reason: "Accendi «Disegno completo» in Componenti" },
  { id: "web", name: "Web", group: "completo", enabled: false, reason: "Accendi «Disegno completo» in Componenti" },
];
const salvato: SurfaceWorkspaceChoice[] = [{ id: "mio", name: "Mio", group: "salvato", enabled: true }];

function spazio(corrente: SurfaceWorkspaceChoice, elenco: SurfaceWorkspaceChoice[], azioni: SurfaceWorkspaceAction[] = []): SurfaceWorkspace {
  return {
    current: () => corrente,
    choices: () => elenco,
    actions: () => azioni,
    choose: () => undefined,
    subscribe: () => () => undefined,
  };
}

describe("il bottone dello spazio di lavoro", () => {
  it("senza una superficie che lo offre sparisce", () => {
    const button = document.createElement("button");
    button.hidden = false;
    drawWorkspaceButton(button, null);
    expect(button.hidden).toBe(true);
    expect(button.querySelector(".status-workspace-name")).toBeNull();
  });

  it("dice il nome dello spazio in uso, con la freccia che si apre", () => {
    const button = document.createElement("button");
    drawWorkspaceButton(button, spazio(base[1]!, [...base, ...preset]));
    expect(button.hidden).toBe(false);
    expect(button.querySelector(".status-workspace-name")?.textContent).toBe("Completo");
    expect(button.querySelector(".status-workspace-arrow")).not.toBeNull();
    expect(button.getAttribute("aria-label")).toContain("Completo");
    // Un giro dopo: lo stesso bottone, il nome riscritto, nessun pezzo in più.
    drawWorkspaceButton(button, spazio(preset[0]!, [...base, ...preset]));
    expect(button.querySelectorAll(".status-workspace-name")).toHaveLength(1);
    expect(button.querySelector(".status-workspace-name")?.textContent).toBe("Automazione");
  });
});

describe("il menu dello spazio di lavoro", () => {
  it("separa i gruppi, segna lo spazio in uso e dice perché uno spazio è spento", () => {
    const items = workspaceMenuItems(spazio(base[1]!, [...base, ...preset, ...salvato]));
    expect(items.map((item) => item.label)).toEqual(["Semplice", "Completo", "Automazione", "Web", "Mio"]);
    // Una riga fra i gruppi, e nessuna prima del primo.
    expect(items.map((item) => Boolean(item.separator))).toEqual([false, false, true, false, true]);
    expect(items[1]).toMatchObject({ choice: "radio", checked: true, disabled: false });
    // Lo spento è grigio, e la sua riga dice il perché.
    expect(items[2]).toMatchObject({ disabled: true, description: "Accendi «Disegno completo» in Componenti" });
    expect(items[2]?.group).toBeDefined();
  });

  it("le azioni vanno in fondo, dopo una riga, e con «enabled» falso sono grigie", () => {
    const azioni: SurfaceWorkspaceAction[] = [
      { id: "ripristina", label: "Ripristina «Completo»", enabled: true, run: () => undefined },
      { id: "spenti", label: "Gli altri spazi sono spenti", enabled: false, run: () => undefined },
    ];
    const items = workspaceMenuItems(spazio(base[1]!, base, azioni));
    expect(items.map((item) => item.label)).toEqual(["Semplice", "Completo", "Ripristina «Completo»", "Gli altri spazi sono spenti"]);
    expect(items[2]).toMatchObject({ separator: true, disabled: false });
    expect(items[3]).toMatchObject({ disabled: true });
  });
});

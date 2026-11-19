// @vitest-environment happy-dom
// Le sezioni Contenuto e Interruzioni del pannello (T74): una riga per specie
// di blocco con le sue scelte, un clic o una freccia cambia il profilo; gli
// interruttori delle Interruzioni.

import { afterEach, describe, expect, it } from "vitest";
import { defaultProfile, type ExportProfile } from "../profile";
import { breaksBody, contentBody } from "./content";
import type { SectionContext } from "./index";

function context(profile = defaultProfile()): SectionContext & { changes: ExportProfile[] } {
  const changes: ExportProfile[] = [];
  return {
    profile,
    changes,
    change(next: ExportProfile) {
      changes.push(next);
    },
    open() {},
    preview() {},
    highlight() {},
  } as unknown as SectionContext & { changes: ExportProfile[] };
}

function chosen(body: HTMLElement, row: string): string | undefined {
  return body.querySelector<HTMLElement>(`[data-row="${row}"] [aria-checked="true"]`)?.textContent ?? undefined;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("la sezione Contenuto", () => {
  it("una riga per specie di blocco, con la scelta del profilo di serie", () => {
    const body = contentBody(context());
    const rows = [...body.querySelectorAll(".export-row")].map((row) => row.querySelector(".export-row-label")!.textContent);
    expect(rows).toEqual(["Proprietà", "Commenti", "Link", "Compiti fatti", "Ripiegabili", "Schede vive", "Tabelle"]);
    expect(chosen(body, "export-content-properties")).toBe("No");
    expect(chosen(body, "export-content-comments")).toBe("No");
    expect(chosen(body, "export-content-links")).toBe("Colorati");
    expect(chosen(body, "export-content-done")).toBe("Mostra");
    expect(chosen(body, "export-content-cards")).toBe("L'anteprima");
    expect(chosen(body, "export-content-tables")).toBe("A linee");
    expect(body.querySelector("#export-content-code")!.getAttribute("aria-checked")).toBe("false");
    for (const group of body.querySelectorAll(".export-choices")) {
      expect(group.getAttribute("role")).toBe("radiogroup");
      expect(document.getElementById(group.getAttribute("aria-labelledby")!) ?? body.querySelector(`#${group.getAttribute("aria-labelledby")}`)).not.toBeNull();
    }
  });

  it("un clic sceglie; la scelta già presa non cambia niente", () => {
    const ctx = context();
    const body = contentBody(ctx);
    body.querySelector<HTMLButtonElement>("#export-content-comments-margine")!.click();
    body.querySelector<HTMLButtonElement>("#export-content-links-colorati")!.click();
    body.querySelector<HTMLButtonElement>("#export-content-done-togli")!.click();
    body.querySelector<HTMLButtonElement>("#export-content-code")!.click();
    expect(ctx.changes.map((profile) => profile.contenuto)).toEqual([
      expect.objectContaining({ commenti: "margine" }),
      expect.objectContaining({ compiti_fatti: false }),
      expect.objectContaining({ codice_numerato: true }),
    ]);
  });

  it("le frecce passano alla scelta dopo, e dall'ultima tornano alla prima", () => {
    const ctx = context();
    const body = contentBody(ctx);
    document.body.append(body);
    const group = body.querySelector<HTMLElement>('[data-row="export-content-tables"] .export-choices')!;
    group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    group.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(ctx.changes.map((profile) => profile.contenuto.tabelle)).toEqual(["griglia", "righe-alterne"]);
    expect(group.querySelector<HTMLElement>('[aria-checked="true"]')!.tabIndex).toBe(0);
  });
});

describe("la sezione Interruzioni", () => {
  it("tre interruttori e la nota su ciò che vale sempre", () => {
    const ctx = context();
    const body = breaksBody(ctx);
    const switches = [...body.querySelectorAll<HTMLButtonElement>(".export-toggle")];
    expect(switches.map((button) => button.getAttribute("aria-checked"))).toEqual(["false", "true", "true"]);
    expect(body.querySelector(".export-note")!.textContent).not.toBe("");
    switches[0]!.click();
    switches[2]!.click();
    expect(ctx.changes[0]!.interruzioni.ogni_titolo_2).toBe(true);
    expect(ctx.changes[1]!.interruzioni.ripeti_intestazione).toBe(false);
  });
});

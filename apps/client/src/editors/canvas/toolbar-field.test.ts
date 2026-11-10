// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { SettingEntry } from "../../host/contract";
import { canvasToolbarField, describeCanvasToolbar } from "./toolbar-field";

function entry(value: string[]): SettingEntry {
  return {
    spec: {
      key: "canvas.toolbar",
      label: "Strumenti della colonna",
      description: "",
      group: "Lavagna",
      scope: "vault",
      kind: { kind: "list", default: [] },
      program_writable: false,
    },
    value,
    source: value.length === 0 ? "default" : "vault",
  };
}

function boxes(root: HTMLElement): HTMLInputElement[] {
  return [...root.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
}

describe("il campo della colonna della lavagna", () => {
  it("dice gli strumenti nel loro ordine, e quelli di serie se la lista è vuota", () => {
    expect(describeCanvasToolbar([])).toBe("Quelli di serie");
    expect(describeCanvasToolbar(["pen", "select"])).toBe("Penna, Selezione");
  });

  it("un nome che la lavagna non conosce si dice com'è", () => {
    expect(describeCanvasToolbar(["domani"])).toBe("domani");
  });

  it("una casella per strumento, nell'ordine del piano", () => {
    const root = canvasToolbarField(entry(["pen"]), "x", vi.fn());
    expect(boxes(root).map((box) => box.id)).toEqual([
      "x-select",
      "x-hand",
      "x-pen",
      "x-highlighter",
      "x-eraser",
      "x-text",
      "x-connect",
    ]);
  });

  it("vuota, la colonna di serie è tutta accesa", () => {
    const root = canvasToolbarField(entry([]), "x", vi.fn());
    expect(boxes(root).every((box) => box.checked)).toBe(true);
  });

  it("tolta una casella, si scrive la lista senza quello strumento, e il nome sconosciuto resta in fondo", () => {
    const write = vi.fn();
    const root = canvasToolbarField(entry(["pen", "domani", "select"]), "x", write);
    const pen = boxes(root).find((box) => box.id === "x-pen")!;
    pen.checked = false;
    pen.dispatchEvent(new Event("change"));
    expect(write).toHaveBeenLastCalledWith(["select", "domani"], "Penna", false);
  });
});

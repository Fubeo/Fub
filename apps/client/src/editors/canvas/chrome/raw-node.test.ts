// Il nodo grezzo di «Avanzate» (T59): i campi nell'ordine del file, la modifica
// come JSON, il JSON che non si legge, `id` e `type` che non si cambiano, i
// campi `fub:` con una forma loro, le misure sotto il minimo, e il campo
// sconosciuto che resta com'era.
import { describe, expect, it } from "vitest";
import type { CanvasNode } from "../model";
import { DROP_MIN_SIZE } from "../drop-layout";
import { rawFields, rawLock, setRawField } from "./raw-node";

const card: CanvasNode = {
  id: "varianza",
  type: "file",
  x: 44,
  y: 92,
  width: 252,
  height: 170,
  color: "4",
  file: "Statistica/Varianza.md",
  "fub:ink": { strokes: [] },
  owner: { name: "altro programma", tags: ["a", 1] },
};

describe("rawFields", () => {
  it("elenca i campi nell'ordine del file, ognuno col suo JSON e con il suo blocco", () => {
    const fields = rawFields(card);
    expect(fields.map((field) => field.key)).toEqual(["id", "type", "x", "y", "width", "height", "color", "file", "fub:ink", "owner"]);
    expect(fields.find((field) => field.key === "file")).toEqual({ key: "file", text: "\"Statistica/Varianza.md\"", lock: null });
    expect(fields.find((field) => field.key === "x")!.text).toBe("44");
    expect(fields.find((field) => field.key === "owner")!.text).toBe("{\"name\":\"altro programma\",\"tags\":[\"a\",1]}");
    expect(fields.filter((field) => field.lock !== null).map((field) => [field.key, field.lock])).toEqual([
      ["id", "id"],
      ["type", "type"],
      ["fub:ink", "ink"],
    ]);
  });

  it("chiama i campi fub: con una forma loro bloccati, anche quelli che Fub non conosce", () => {
    expect(rawLock("fub:parts")).toBe("shape");
    expect(rawLock("fub:altro")).toBe("shape");
    expect(rawLock("width")).toBeNull();
  });
});

describe("setRawField", () => {
  it("prende un valore come JSON e lo mette nel suo posto, senza toccare il resto", () => {
    const edit = setRawField(card, "x", "120");
    expect("node" in edit && edit.node).toEqual({ ...card, x: 120 });
    const text = setRawField(card, "file", "\"Statistica/Nuova.md\"");
    expect("node" in text && text.node.file).toBe("Statistica/Nuova.md");
    expect("node" in text && Object.keys(text.node)).toEqual(Object.keys(card));
  });

  it("aggiunge un campo in fondo, e lascia le chiavi nell'ordine che avevano", () => {
    const edit = setRawField(card, "nota", "{\"a\":1}");
    expect("node" in edit && Object.keys(edit.node)).toEqual([...Object.keys(card), "nota"]);
  });

  it("dice che il JSON non si legge, e non prende niente", () => {
    expect(setRawField(card, "x", "12 ore")).toEqual({ problem: "json" });
    expect(setRawField(card, "file", "Statistica")).toEqual({ problem: "json" });
    expect(setRawField(card, "x", "")).toEqual({ problem: "json" });
  });

  it("vieta di cambiare id e type, e i campi fub: con una forma loro", () => {
    expect(setRawField(card, "id", "\"altro\"")).toEqual({ problem: "id" });
    expect(setRawField(card, "type", "\"text\"")).toEqual({ problem: "type" });
    expect(setRawField(card, "fub:ink", "{\"strokes\":[]}")).toEqual({ problem: "ink" });
    expect(setRawField(card, "fub:parts", "[]")).toEqual({ problem: "shape" });
  });

  it("vuole un numero finito per la posizione e per le misure, e non meno del minimo", () => {
    expect(setRawField(card, "x", "\"44\"")).toEqual({ problem: "number" });
    expect(setRawField(card, "y", "null")).toEqual({ problem: "number" });
    expect(setRawField(card, "x", "1e400")).toEqual({ problem: "number" });
    expect(setRawField(card, "width", "0")).toEqual({ problem: "small" });
    expect(setRawField(card, "height", "-20")).toEqual({ problem: "small" });
    expect(setRawField(card, "width", String(DROP_MIN_SIZE - 1))).toEqual({ problem: "small" });
    const minimum = setRawField(card, "width", String(DROP_MIN_SIZE));
    expect("node" in minimum && minimum.node.width).toBe(DROP_MIN_SIZE);
  });

  it("vuole un testo per i campi di testo noti, e lascia null come assente", () => {
    expect(setRawField(card, "color", "4")).toEqual({ problem: "text" });
    expect(setRawField(card, "text", "12")).toEqual({ problem: "text" });
    const cleared = setRawField(card, "color", "null");
    expect("node" in cleared && cleared.node.color).toBeNull();
  });

  it("un campo sconosciuto si cambia come testo, qualunque sia il JSON", () => {
    const edit = setRawField(card, "owner", "[1,{\"x\":null}]");
    expect("node" in edit && edit.node.owner).toEqual([1, { x: null }]);
  });
});

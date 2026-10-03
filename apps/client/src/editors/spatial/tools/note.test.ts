// @vitest-environment happy-dom
// Le note delle annotazioni: l'elemento che si scrive, la nota che si rilegge
// dal modello e il dialogo che chiede corpo ed etichetta.

import { afterEach, describe, expect, it } from "vitest";
import { SceneEngine } from "../scene/engine";
import { elementChildren, type LeafNode } from "../scene/model";
import { doc } from "../scene/test-support";
import { noteElem, noteLabel, promptNote, readNote } from "./note";

afterEach(() => {
  for (const dialog of document.querySelectorAll(".shell-dialog")) dialog.remove();
});

describe("l'etichetta", () => {
  it("è quella scritta, su una riga; vuota è l'inizio della prima riga del corpo", () => {
    expect(noteLabel("corpo", "  Importo\n da   rivedere ")).toBe("Importo da rivedere");
    expect(noteLabel("\n  Prima riga\nseconda", "")).toBe("Prima riga");
    const long = "Una nota che comincia con una frase lunga più di quaranta caratteri";
    expect(noteLabel(long, "")).toBe("Una nota che comincia con una frase lun…");
    expect([...noteLabel(long, "")]).toHaveLength(40);
  });
});

describe("l'elemento", () => {
  it("è il `text` dell'esempio del formato, col corpo in `fub:note`", () => {
    expect(noteElem("o5p6q7r8s", [330, 150.004], "#000000", { body: "Riga uno\nRiga due", label: "Importo da rivedere" })).toEqual({
      tag: "text",
      attrs: {
        id: "o5p6q7r8s",
        x: "330",
        y: "150",
        fill: "#000000",
        "font-family": "Inter, sans-serif",
        "font-size": "12",
        "fub:note": "Riga uno\nRiga due",
      },
      children: [{ tag: "tspan", attrs: { x: "330", dy: "0" }, text: "Importo da rivedere" }],
    });
  });

  it("scritto dal motore, si rilegge uguale, coi ritorni a capo scritti `&#10;`", () => {
    const engine = SceneEngine.open(doc('<g id="p0001" fub:page="1"></g>'));
    const elem = noteElem("o5p6q7r8s", [10, 20], "#000000", { body: "Riga uno\r\nRiga due", label: "Etichetta" });
    expect(engine.apply({ op: "add", parent: "p0001", pos: { last: true }, elem }).outcome).toBe("applied");
    expect(engine.text).toContain('fub:note="Riga uno&#10;Riga due"');
    const page = elementChildren(engine.model!.root)[0]!;
    const leaf = elementChildren(page)[0] as LeafNode;
    expect(readNote(leaf)).toEqual({ body: "Riga uno\nRiga due", label: "Etichetta" });
  });

  it("un testo senza `fub:note`, o col corpo di soli spazi, non è una nota", () => {
    const engine = SceneEngine.open(doc('<text x="1" y="1">testo</text><text x="1" y="1" fub:note=" &#10; "/><rect x="0" y="0" width="1" height="1"/>'));
    const [plain, blank, rect] = elementChildren(engine.model!.root) as LeafNode[];
    expect(readNote(plain!)).toBeNull();
    expect(readNote(blank!)).toBeNull();
    expect(readNote(rect!)).toBeNull();
  });
});

describe("il dialogo", () => {
  const dialog = (): HTMLElement => document.querySelector<HTMLElement>(".shell-dialog")!;
  const body = (): HTMLTextAreaElement => dialog().querySelector("textarea")!;
  const label = (): HTMLInputElement => dialog().querySelector('input[type="text"]')!;
  const submit = (): void => dialog().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();

  it("chiede corpo ed etichetta, col fuoco sul corpo, e mostra l'etichetta che verrà", async () => {
    const answer = promptNote();
    expect(dialog().getAttribute("role")).toBe("dialog");
    expect(dialog().querySelector("h2")!.textContent).toBe("Nuova nota");
    expect(document.activeElement).toBe(body());
    body().value = "Prima riga\nseconda";
    body().dispatchEvent(new Event("input"));
    expect(label().placeholder).toBe("Prima riga");
    submit();
    expect(await answer).toEqual({ body: "Prima riga\nseconda", label: "Prima riga" });
  });

  it("non accetta un corpo vuoto: lo dice e resta aperto", async () => {
    const answer = promptNote();
    body().value = "   ";
    submit();
    const error = dialog().querySelector<HTMLElement>('[role="alert"]')!;
    expect(error.hidden).toBe(false);
    expect(body().getAttribute("aria-invalid")).toBe("true");
    expect(body().getAttribute("aria-describedby")).toBe(error.id);
    body().value = "Adesso sì";
    body().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(await answer).toEqual({ body: "Adesso sì", label: "Adesso sì" });
  });

  it("cambia una nota che c'è, e Annulla non cambia niente", async () => {
    const answer = promptNote({ note: { body: "Corpo", label: "Etichetta" } });
    expect(dialog().querySelector("h2")!.textContent).toBe("Modifica la nota");
    expect(body().value).toBe("Corpo");
    expect(label().value).toBe("Etichetta");
    [...dialog().querySelectorAll<HTMLButtonElement>('button[type="button"]')].find((button) => button.textContent === "Annulla")!.click();
    expect(await answer).toBeNull();
  });
});

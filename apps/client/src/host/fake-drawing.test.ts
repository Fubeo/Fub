// «Nuovo disegno» nell'host finto: lo stesso contratto del comando della
// feature `draw`, perché la galleria e le sue porte si provano su di lui. Il
// nome libero, la cartella, i modelli distribuiti coi loro file, la copia di
// un disegno del vault, e i rifiuti.

import { describe, expect, it } from "vitest";
import { createFakeHost, drawingCreateSpec } from "./fake";

const COPY = [
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 100 100">',
  "  <title>Lavagna</title>",
  '  <g id="l1" fub:layer="Livello 1"><rect id="o1a2b3c4d" x="0" y="0" width="10" height="10"><title>Quadrato</title></rect></g>',
  "</svg>",
  "",
].join("\n");

/// L'host coi disegni, e il comando chiamato con `args`.
function creating(files: Record<string, string> = {}) {
  const fake = createFakeHost({ draw: true, file: files });
  const create = (args: Record<string, unknown>) => fake.module.api.invokeCommand("drawing.create", args, "apply");
  return { fake, create };
}

/// Il testo del `<title>` della radice.
const titleOf = (svg: string): string | undefined => /^<svg\b[^>]*>\s*<title>([^<]*)<\/title>/.exec(svg)?.[1];

describe("«Nuovo disegno» nell'host finto", () => {
  it("senza argomenti crea «Disegno.svg» vuoto, poi «Disegno 1.svg», e lo apre", async () => {
    const { fake, create } = creating();
    const first = await create({});
    expect(first).toMatchObject({ notify: "Creato il disegno «Disegno.svg»", effect: { kind: "navigate", doc: "Disegno.svg" } });
    const text = fake.files()["Disegno.svg"]!;
    expect(titleOf(text)).toBe("Disegno");
    expect(text).toContain('fub:layer="Livello 1"');
    expect(await create({})).toMatchObject({ effect: { kind: "navigate", doc: "Disegno 1.svg" } });
    expect(fake.atGate("invokeCommand")).toHaveLength(2);
  });

  it("un nome e una cartella danno il posto; un nome preso si rifiuta, e il file resta", async () => {
    const { fake, create } = creating({ "Lezioni/Atomo.svg": COPY });
    expect(await create({ name: "Cellula", folder: "/Lezioni/" })).toMatchObject({ effect: { doc: "Lezioni/Cellula.svg" } });
    expect(titleOf(fake.files()["Lezioni/Cellula.svg"]!)).toBe("Cellula");
    await expect(create({ name: "Atomo", folder: "Lezioni" })).rejects.toMatchObject({ kind: "already_exists" });
    expect(fake.files()["Lezioni/Atomo.svg"]).toBe(COPY);
  });

  it("ogni modello della spec, tranne il vuoto, ha il suo file, col nome del disegno per titolo", async () => {
    const spec = drawingCreateSpec();
    const template = spec.params.find((param) => param.name === "template")!;
    if (template.kind.kind !== "choice") throw new Error("il modello è una scelta");
    const ids = template.kind.value.map((choice) => choice.value);
    expect(ids).toEqual(["blank", "a4-portrait", "a4-landscape", "slide", "diagram", "lesson", "storyboard", "concept-map"]);
    const { fake, create } = creating();
    for (const id of ids.slice(1)) {
      await create({ name: `Da ${id}`, template: id });
      const text = fake.files()[`Da ${id}.svg`]!;
      expect(titleOf(text), id).toBe(`Da ${id}`);
      expect(text, id).toContain("fub:layer=");
    }
    expect(fake.files()["Da storyboard.svg"]!.match(/fub:role="board"/g)).toHaveLength(6);
    await expect(create({ template: "poster" })).rejects.toMatchObject({ kind: "bad_args" });
  });

  it("copia un disegno del vault col nome nuovo per titolo, e il titolo delle forme resta loro", async () => {
    const { fake, create } = creating({ "Modelli/Lavagna.svg": COPY });
    await create({ name: "Mia <lavagna> & co", from: "Modelli/Lavagna.svg" });
    const text = fake.files()["Mia <lavagna> & co.svg"]!;
    expect(titleOf(text)).toBe("Mia &lt;lavagna&gt; &amp; co");
    expect(text).toContain("<title>Quadrato</title>");
    expect(fake.files()["Modelli/Lavagna.svg"]).toBe(COPY);
    // Senza il titolo della radice, se ne mette uno in testa.
    const untitled = COPY.replace("  <title>Lavagna</title>\n", "");
    const other = creating({ "Senza.svg": untitled });
    await other.create({ name: "Con", from: "Senza.svg" });
    expect(titleOf(other.fake.files()["Con.svg"]!)).toBe("Con");
    expect(other.fake.files()["Con.svg"]).toContain("<title>Quadrato</title>");
  });

  it("un modello e un disegno del vault insieme non si chiedono; un disegno che non c'è non si copia", async () => {
    const { fake, create } = creating({ "Modelli/Lavagna.svg": COPY });
    await expect(create({ template: "slide", from: "Modelli/Lavagna.svg" })).rejects.toMatchObject({ kind: "bad_args" });
    await expect(create({ from: "Modelli/Manca.svg" })).rejects.toMatchObject({ kind: "not_found" });
    expect(Object.keys(fake.files())).toEqual(["Modelli/Lavagna.svg"]);
  });
});

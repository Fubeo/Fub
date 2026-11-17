// @vitest-environment happy-dom
// Le annotazioni nel visore dei PDF: di ogni pagina annotata un documento SVG
// a sé, largo quanto la pagina del PDF, con soltanto i gruppi di quella
// pagina; un file che non è di Fub, o che non si legge, non si disegna.
import { describe, expect, it } from "vitest";
import { annotationsChanged, needsPdfFacts, readPdfAnnotations } from "./pdf-annotations";
import bando from "../../__fixtures__/annotations/bando.fubann?raw";

const HEAD = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1"`;

function drawn(source: string, id = "Bando.pdf.fubann", pdf = "Bando.pdf") {
  const read = readPdfAnnotations(source, id, pdf);
  if (read.kind !== "drawn") throw new Error(`atteso drawn, letto ${read.kind}`);
  return read;
}

describe("i fogli delle pagine", () => {
  it("una pagina annotata ha il suo foglio, alla misura della pagina del PDF, con soltanto i suoi gruppi", () => {
    const read = drawn(bando, "doc/Bando di gara.pdf.fubann", "doc/Bando di gara.pdf");
    const first = read.layers.layer(1, [612, 792])!;
    expect(first).toContain(`viewBox="0 0 612 792"`);
    expect(first).toContain(`width="612" height="792"`);
    expect(first).toContain(`preserveAspectRatio="none"`);
    expect(first).toContain(`xmlns:fub="https://fubeo.github.io/ns/scene/1"`);
    expect(first).toContain("o7k2m9x4q");
    expect(first).not.toContain("o1a2b3c4d");
    // Il titolo della radice non è una pagina, e non si disegna.
    expect(first).not.toContain("Revisione del bando");
    expect(read.layers.layer(3, [612, 792])).toContain("o1a2b3c4d");
    // Una pagina senza gruppo non ha foglio.
    expect(read.layers.layer(2, [612, 792])).toBeNull();
    // Il foglio è un SVG ben formato.
    const parsed = new DOMParser().parseFromString(first, "image/svg+xml");
    expect(parsed.querySelector("parsererror")).toBeNull();
    expect(parsed.documentElement.getAttribute("viewBox")).toBe("0 0 612 792");
  });

  it("senza la misura del PDF vale quella scritta nel gruppo, poi quella del primo gruppo, poi A4", () => {
    const source = `${HEAD}>
  <g fub:page="1" fub:page-size="300 400"><path d="M0 0L10 10"/></g>
  <g fub:page="2"><path d="M0 0L20 20"/></g>
</svg>`;
    const read = drawn(source);
    expect(read.layers.layer(1, null)).toContain(`viewBox="0 0 300 400"`);
    expect(read.layers.layer(2, null)).toContain(`viewBox="0 0 300 400"`);
    const bare = drawn(`${HEAD}><g fub:page="1"><path d="M0 0L1 1"/></g></svg>`);
    expect(bare.layers.layer(1, null)).toContain(`viewBox="0 0 595.28 841.89"`);
  });

  it("una pagina del PDF più grande di quella scritta: le coordinate restano punti, il foglio prende la misura del PDF", () => {
    const source = `${HEAD}><g fub:page="1" fub:page-size="300 400"><rect x="10" y="10" width="5" height="5"/></g></svg>`;
    const sheet = drawn(source).layers.layer(1, [600, 800])!;
    expect(sheet).toContain(`viewBox="0 0 600 800"`);
    expect(sheet).toContain(`<rect x="10" y="10" width="5" height="5"/>`);
  });

  it("due gruppi con lo stesso numero sono la stessa pagina; le risorse della radice vengono con loro", () => {
    const source = `${HEAD}>
  <defs><marker id="m"><path d="M0 0L5 5"/></marker></defs>
  <g fub:page="1"><path id="a" d="M0 0L1 1" marker-end="url(#m)"/></g>
  <circle id="fuori" r="3"/>
  <g fub:page="1"><path id="b" d="M0 0L2 2"/></g>
</svg>`;
    const sheet = drawn(source).layers.layer(1, [100, 100])!;
    expect(sheet).toContain(`<marker id="m">`);
    expect(sheet).toContain(`id="a"`);
    expect(sheet).toContain(`id="b"`);
    // Ciò che sta fuori dalle pagine non si vede, come nella superficie.
    expect(sheet).not.toContain("fuori");
  });

  it("la vista della radice non passa: il foglio la riscrive con la pagina", () => {
    const source = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1" viewBox="0 0 10 10" width="10" transform="scale(4)" fill="red"><g fub:page="1"><path d="M0 0L1 1"/></g></svg>`;
    const sheet = drawn(source).layers.layer(1, [100, 200])!;
    const root = new DOMParser().parseFromString(sheet, "image/svg+xml").documentElement;
    expect(root.getAttribute("viewBox")).toBe("0 0 100 200");
    expect(root.getAttribute("width")).toBe("100");
    expect(root.getAttribute("transform")).toBeNull();
    // Gli altri attributi della radice si ereditano come nella superficie.
    expect(root.getAttribute("fill")).toBe("red");
  });
});

describe("i file che non si disegnano", () => {
  it("un file senza fub:version non è di Fub", () => {
    expect(readPdfAnnotations(`<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>`, "a.pdf.fubann", "a.pdf").kind).toBe("foreign");
  });

  it("un file malformato, non SVG o di una versione futura non si legge", () => {
    expect(readPdfAnnotations("<svg", "a.pdf.fubann", "a.pdf").kind).toBe("unreadable");
    expect(readPdfAnnotations("<html/>", "a.pdf.fubann", "a.pdf").kind).toBe("unreadable");
    expect(readPdfAnnotations(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="9"/>`, "a.pdf.fubann", "a.pdf").kind).toBe("unreadable");
  });

  it("un file che annota un altro PDF qui non c'entra", () => {
    const source = `${HEAD} fub:annotates="Altro.pdf"><g fub:page="1"/></svg>`;
    expect(readPdfAnnotations(source, "doc/Bando.pdf.fubann", "doc/Bando.pdf").kind).toBe("elsewhere");
    expect(readPdfAnnotations(source, "doc/Altro.pdf.fubann", "doc/Altro.pdf").kind).toBe("drawn");
  });
});

describe("il PDF cambiato", () => {
  const digest = `sha256:${"a".repeat(64)}`;

  it("l'impronta che non torna, o senza impronta le pagine, dicono un PDF cambiato", () => {
    const anchored = drawn(`${HEAD} fub:digest="${digest}" fub:pages="3"></svg>`);
    expect(needsPdfFacts(anchored.root)).toBe(true);
    expect(annotationsChanged(anchored.root, { digest, pages: 3 })).toBe(false);
    expect(annotationsChanged(anchored.root, { digest: `sha256:${"b".repeat(64)}`, pages: 3 })).toBe(true);
    const counted = drawn(`${HEAD} fub:pages="3"></svg>`);
    expect(annotationsChanged(counted.root, { digest, pages: 4 })).toBe(true);
    expect(annotationsChanged(counted.root, { digest, pages: 3 })).toBe(false);
    // Un file che non dice di quale versione è non chiede il PDF.
    expect(needsPdfFacts(drawn(`${HEAD}></svg>`).root)).toBe(false);
  });
});

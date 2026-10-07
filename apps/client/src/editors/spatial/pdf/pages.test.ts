// Le pagine delle annotazioni nel modello del motore: i gruppi, dove nasce un
// oggetto, il PDF che il file nomina, il legame con la versione che si apre e
// l'elenco per la lettura.

import { describe, expect, it } from "vitest";
import { PaintBuilder } from "../painter/paint";
import { SceneEngine } from "../scene/engine";
import type { Op } from "../scene/ops";
import { SceneIndexer } from "../tools/hit";
import {
  A4,
  groupsOf,
  listAnnotations,
  outside,
  pageDestination,
  pageGroups,
  pdfOf,
  rootFacts,
  sha256,
  verdict,
  writtenSize,
} from "./pages";

const bando = Object.values(
  import.meta.glob("../../../__fixtures__/annotations/bando.fubann", { query: "?raw", import: "default", eager: true }) as Record<string, string>,
)[0]!;

const ROOT = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:fub="https://fubeo.github.io/ns/scene/1" fub:version="1"';

function annotations(body: string, attrs = ""): string {
  return `${ROOT}${attrs}>\n  <title>Bando.pdf</title>\n${body}</svg>\n`;
}

function engineOf(source: string): SceneEngine {
  const engine = SceneEngine.open(source);
  expect(engine.model).not.toBeNull();
  return engine;
}

/// Dove nasce un oggetto sulla pagina `page`, con l'indice del foglio.
function destination(engine: SceneEngine, page: number, size: readonly [number, number] = A4) {
  const model = engine.model!;
  const builder = new PaintBuilder();
  builder.build(engine);
  const index = new SceneIndexer(builder, null, (scene) => groupsOf(scene, page)).index(model);
  return pageDestination(model, index, page, size, (id) => engine.holder(id) !== null);
}

/// Applica il preludio e un rettangolo nel gruppo scelto, e dà il testo.
function placed(engine: SceneEngine, page: number): string {
  const to = destination(engine, page)!;
  const ops: Op[] = [...to.prelude, { op: "add", parent: to.parent, pos: { last: true }, elem: { tag: "rect", attrs: { id: "onuovo001", x: "1", y: "2", width: "3", height: "4" } } }];
  expect(engine.apply({ op: "batch", ops })).toMatchObject({ outcome: "applied" });
  return engine.text;
}

describe("i gruppi di pagina", () => {
  it("sono i `g` figli della radice con un `fub:page` valido, nell'ordine del file", () => {
    const model = engineOf(bando).model!;
    expect(pageGroups(model).map((group) => [group.number, group.id, group.size])).toEqual([
      [1, "p0001", [595.28, 841.89]],
      [3, "p0003", [595.28, 841.89]],
    ]);
    expect(groupsOf(model, 3).map((node) => node.facts.id)).toEqual(["p0003"]);
    expect(groupsOf(model, 2)).toEqual([]);
    expect(writtenSize(model, 1)).toEqual([595.28, 841.89]);
    expect(writtenSize(model, 2)).toBeNull();
    expect(outside(model)).toBe(0);
  });

  it("un numero non valido non fa una pagina, e ciò che sta fuori dalle pagine si conta", () => {
    const model = engineOf(
      annotations(
        '  <g fub:page="0"><rect x="1" y="1" width="2" height="2"/></g>\n  <g fub:page="2" fub:page-size="612 792"/>\n  <rect x="0" y="0" width="1" height="1"/>\n  <defs/>\n',
      ),
    ).model!;
    expect(pageGroups(model).map((group) => [group.number, group.id, group.size])).toEqual([[2, null, [612, 792]]]);
    expect(outside(model)).toBe(2);
  });
});

describe("dove nasce un oggetto", () => {
  it("nell'ultimo gruppo della pagina, se ha un id", () => {
    const to = destination(engineOf(bando), 3)!;
    expect(to.parent).toBe("p0003");
    expect(to.prelude).toEqual([]);
  });

  it("un gruppo della pagina senza id riceve quello della pagina", () => {
    const engine = engineOf(annotations('  <g fub:page="2"/>\n'));
    expect(destination(engine, 2)!.prelude).toEqual([{ op: "ident", path: [1], tag: "g", id: "p0002" }]);
    expect(placed(engine, 2)).toContain('<g id="p0002" fub:page="2">\n    <rect id="onuovo001"');
  });

  it("senza gruppi, ne nasce uno dopo quello della pagina precedente, con la misura della pagina", () => {
    const engine = engineOf(bando);
    const to = destination(engine, 2, [612, 792.5])!;
    expect(to.parent).toBe("p0002");
    expect(to.prelude).toEqual([
      {
        op: "add",
        parent: "#root",
        pos: { after: "p0001" },
        elem: { tag: "g", attrs: { id: "p0002", "fub:page": "2", "fub:page-size": "612 792.5" }, children: [] },
      },
    ]);
    const text = placed(engine, 2);
    expect(text.indexOf('id="p0001"')).toBeLessThan(text.indexOf('id="p0002"'));
    expect(text.indexOf('id="p0002"')).toBeLessThan(text.indexOf('id="p0003"'));
  });

  it("la prima pagina nasce in testa, dopo il titolo", () => {
    const engine = engineOf(annotations(""));
    expect(destination(engine, 1)!.prelude[0]).toMatchObject({ op: "add", parent: "#root", pos: { first: true } });
    const text = placed(engine, 1);
    expect(text.indexOf("<title>")).toBeLessThan(text.indexOf('<g id="p0001"'));
  });

  it("la pagina precedente senza id lo riceve, così la nuova le va dietro", () => {
    const engine = engineOf(annotations('  <g fub:page="1"/>\n'));
    expect(destination(engine, 4)!.prelude.map((op) => op.op)).toEqual(["ident", "add"]);
    const text = placed(engine, 4);
    expect(text.indexOf('<g id="p0001"')).toBeLessThan(text.indexOf('<g id="p0004"'));
  });

  it("niente, se l'id della pagina è già di un altro elemento", () => {
    const engine = engineOf(annotations('  <rect id="p0002" x="0" y="0" width="1" height="1"/>\n'));
    expect(destination(engine, 2)).toBeNull();
  });
});

describe("il PDF che il file nomina", () => {
  it("`fub:annotates` relativo al file, assoluto dal vault, senza frammento, decodificato", () => {
    const vault = (url: string) => ({ kind: "vault" as const, url });
    expect(pdfOf("bandi/Bando.pdf.fubann", vault("Bando%20di%20gara.pdf"))).toBe("bandi/Bando di gara.pdf");
    expect(pdfOf("bandi/Bando.pdf.fubann", vault("../archivio/Bando.pdf#page=2"))).toBe("archivio/Bando.pdf");
    expect(pdfOf("bandi/Bando.pdf.fubann", vault("/altro/Bando.pdf"))).toBe("altro/Bando.pdf");
    expect(pdfOf("Bando.pdf.fubann", vault("../fuori.pdf"))).toBeNull();
    expect(pdfOf("Bando.pdf.fubann", vault("%E0%A4%A.pdf"))).toBeNull();
  });

  it("senza `fub:annotates` vale il nome, e un indirizzo esterno non nomina niente del vault", () => {
    expect(pdfOf("bandi/Bando.PDF.fubann", { kind: "absent" })).toBe("bandi/Bando.PDF");
    expect(pdfOf("bandi/note.fubann", { kind: "absent" })).toBeNull();
    expect(pdfOf("bandi/.pdf.fubann", { kind: "absent" })).toBeNull();
    expect(pdfOf(".PDF.fubann", { kind: "absent" })).toBeNull();
    expect(pdfOf("bandi/Bando.pdf.fubann", { kind: "other" })).toBeNull();
  });

  it("la radice dice PDF, impronta e pagine, nelle grammatiche del formato", () => {
    expect(rootFacts(engineOf(bando).model!)).toEqual({
      annotates: { kind: "vault", url: "Bando%20di%20gara.pdf" },
      digest: "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      pages: 12,
    });
    expect(rootFacts(engineOf(annotations("", ' fub:annotates="https://example.org/a.pdf" fub:pages="0"')).model!)).toEqual({
      annotates: { kind: "other" },
      digest: null,
      pages: null,
    });
    expect(rootFacts(engineOf(annotations("")).model!)).toEqual({ annotates: { kind: "absent" }, digest: null, pages: null });
  });
});

describe("il legame con il PDF", () => {
  const pdf = { digest: `sha256:${"a".repeat(64)}`, pages: 3 };
  const facts = (digest: string | null, pages: number | null) => ({ annotates: { kind: "absent" as const }, digest, pages });

  it("non scritto: il primo gesto scrive impronta e pagine", () => {
    expect(verdict(facts(null, null), pdf)).toEqual({ state: "unanchored", op: { op: "anchor", digest: pdf.digest, pages: 3 } });
    expect(verdict(facts(null, 3), pdf)).toEqual({ state: "unanchored", op: { op: "anchor", digest: pdf.digest } });
  });

  it("la stessa versione: niente da scrivere, o solo le pagine sbagliate", () => {
    expect(verdict(facts(pdf.digest, 3), pdf)).toEqual({ state: "anchored", op: null });
    expect(verdict(facts(pdf.digest, null), pdf)).toEqual({ state: "anchored", op: { op: "anchor", pages: 3 } });
    expect(verdict(facts(pdf.digest, 9), pdf)).toEqual({ state: "anchored", op: { op: "anchor", pages: 3 } });
  });

  it("un'altra versione, o altre pagine senza impronta: cambiato, e niente si scrive da sé", () => {
    expect(verdict(facts(`sha256:${"b".repeat(64)}`, 3), pdf)).toEqual({ state: "changed", op: null });
    expect(verdict(facts(null, 4), pdf)).toEqual({ state: "changed", op: null });
  });

  it("l'impronta è SHA-256 dei byte, in minuscolo", async () => {
    expect(await sha256(new TextEncoder().encode("test"))).toBe("sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
  });
});

describe("l'elenco per la lettura", () => {
  it("le note per pagina, in ordine di numero, e gli altri segni contati", () => {
    const listing = listAnnotations(engineOf(bando).model!);
    expect(listing).toEqual({
      pages: [
        {
          number: 1,
          notes: [{ label: "Importo da rivedere", body: "L'importo a base d'asta è cambiato.\n\nChiedere conferma all'ufficio gare." }],
          marks: 1,
        },
        { number: 3, notes: [{ label: "", body: "Manca la firma del RUP: vedi l'allegato B." }], marks: 1 },
      ],
      outside: [],
    });
  });

  it("due gruppi con lo stesso numero sono una pagina, e le note fuori dalle pagine stanno a parte", () => {
    const listing = listAnnotations(
      engineOf(
        annotations(
          '  <g fub:page="2"><text x="1" y="1" fub:note="B"><tspan x="1" dy="0">b</tspan></text></g>\n' +
            '  <g fub:page="1"><path d="M0 0 L1 1"/></g>\n' +
            '  <g fub:page="2"><g><text x="1" y="1" fub:note="C"/></g></g>\n' +
            '  <text x="1" y="1" fub:note="Fuori"/>\n' +
            '  <text x="1" y="1" fub:note="   "/>\n',
        ),
      ).model!,
    );
    expect(listing.pages.map((page) => [page.number, page.notes.map((note) => note.body), page.marks])).toEqual([
      [1, [], 1],
      [2, ["B", "C"], 0],
    ]);
    expect(listing.outside).toEqual([{ label: "", body: "Fuori" }]);
  });
});

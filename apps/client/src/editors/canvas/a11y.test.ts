// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { boardReading, cardLabel, cardTitle, changeAnnouncement, LABEL_LINKS_MAX, nearestCard, stepInOrder } from "./a11y";
import type { CanvasDocument, CanvasEdge, CanvasNode } from "./model";
import type { CanvasPatch } from "./operation";

function text(id: string, x: number, y: number, body = id, width = 100, height = 60): CanvasNode {
  return { id, type: "text", x, y, width, height, text: body };
}

function file(id: string, x: number, y: number, path: string): CanvasNode {
  return { id, type: "file", x, y, width: 200, height: 120, file: path };
}

function group(id: string, x: number, y: number, width: number, height: number, label?: string): CanvasNode {
  return { id, type: "group", x, y, width, height, ...(label === undefined ? {} : { label }) };
}

function edge(id: string, fromNode: string, toNode: string, label?: string): CanvasEdge {
  return { id, fromNode, toNode, ...(label === undefined ? {} : { label }) };
}

/** La lavagna dell'esempio del piano: Varianza nel gruppo, collegata a due schede. */
function statistics(): CanvasDocument {
  return {
    nodes: [
      group("g", 0, 0, 800, 400, "Media e varianza"),
      file("v", 40, 40, "Statistica/Varianza.md"),
      file("m", 1000, 40, "Statistica/Media aritmetica.md"),
      text("i", 1000, 300, "istogramma"),
    ],
    edges: [edge("e1", "v", "m", "vedi"), edge("e2", "i", "v", "si vede qui")],
  };
}

function byId(doc: CanvasDocument, id: string): CanvasNode {
  const node = doc.nodes.find((one) => one.id === id);
  if (!node) throw new Error(`nessuna scheda ${id}`);
  return node;
}

describe("il nome di una scheda per il lettore di schermo (T61)", () => {
  it("dice la specie, il nome, il gruppo e le schede collegate con l'etichetta del filo", () => {
    const doc = statistics();
    expect(cardLabel(byId(doc, "v"), doc)).toBe(
      "Scheda di nota Varianza, nel gruppo Media e varianza, collegata a 2 schede: Media aritmetica, vedi; istogramma, si vede qui.",
    );
  });

  it("un filo senza etichetta dice solo la scheda; un gruppo è «collegato»", () => {
    const doc: CanvasDocument = {
      nodes: [file("v", 0, 0, "Varianza.md"), file("m", 400, 0, "Media aritmetica.md"), group("g", 0, 400, 300, 200, "Idee")],
      edges: [edge("e1", "v", "m"), edge("e2", "g", "m", "riassume")],
    };
    expect(cardLabel(byId(doc, "v"), doc)).toBe("Scheda di nota Varianza, collegata a Media aritmetica.");
    expect(cardLabel(byId(doc, "g"), doc)).toBe("Gruppo Idee, collegato a Media aritmetica, riassume.");
  });

  it("più fili verso la stessa scheda la contano una volta, con le etichette diverse", () => {
    const doc: CanvasDocument = {
      nodes: [text("a", 0, 0, "A"), text("b", 400, 0, "B")],
      edges: [edge("e1", "a", "b", "uno"), edge("e2", "b", "a", "due"), edge("e3", "a", "b", "uno")],
    };
    expect(cardLabel(byId(doc, "a"), doc)).toBe("Scheda di testo A, collegata a B, uno, due.");
  });

  it(`oltre ${LABEL_LINKS_MAX} schede collegate dice solo quante: l'elenco sta nell'ispettore`, () => {
    const nodes = [text("hub", 0, 0, "Centro")];
    const edges: CanvasEdge[] = [];
    for (let i = 0; i < 200; i++) {
      nodes.push(text(`n${i}`, 200 + (i % 20) * 120, (i / 20 | 0) * 80, `Scheda ${i}`));
      edges.push(edge(`e${i}`, "hub", `n${i}`, "vedi"));
    }
    const doc: CanvasDocument = { nodes, edges };
    expect(cardLabel(byId(doc, "hub"), doc)).toBe("Scheda di testo Centro, collegata a 200 schede.");
  });

  it("senza nome dice la specie; una scheda collegata senza nome è «una scheda senza nome»", () => {
    const doc: CanvasDocument = {
      nodes: [text("a", 0, 0, ""), text("b", 400, 0, "B"), group("g", -50, -50, 300, 200)],
      edges: [edge("e1", "b", "a")],
    };
    expect(cardLabel(byId(doc, "a"), doc)).toBe("Scheda di testo, in un gruppo senza nome, collegata a B.");
    expect(cardLabel(byId(doc, "b"), doc)).toBe("Scheda di testo B, collegata a una scheda senza nome.");
  });

  it("il colore va in coda; un filo verso una scheda che non c'è non conta", () => {
    const doc: CanvasDocument = {
      nodes: [{ ...text("a", 0, 0, "A"), color: "1" }],
      edges: [edge("e1", "a", "fantasma", "vedi")],
    };
    expect(cardLabel(byId(doc, "a"), doc)).toBe("Scheda di testo A. Colore: Rosso.");
  });

  it("la specie di un file viene dalla sua estensione, come nella testata del menu", () => {
    expect(cardTitle(file("p", 0, 0, "Libri/Saggio.pdf"))).toBe("Scheda di PDF Saggio.pdf");
    expect(cardTitle({ id: "w", type: "link", x: 0, y: 0, width: 10, height: 10, url: "https://example.com/x" })).toBe("Scheda di pagina web example.com");
  });
});

describe("l'ordine di Tab e la scheda più vicina (T61)", () => {
  it("Tab va nell'ordine di lettura, coi gruppi prima del loro contenuto; oltre i bordi niente", () => {
    const doc = statistics();
    const reading = boardReading(doc);
    expect(reading.order.map((node) => node.id)).toEqual(["g", "v", "m", "i"]);
    expect(stepInOrder(reading, null, 1)?.id).toBe("g");
    expect(stepInOrder(reading, null, -1)?.id).toBe("i");
    expect(stepInOrder(reading, "v", 1)?.id).toBe("m");
    expect(stepInOrder(reading, "v", -1)?.id).toBe("g");
    expect(stepInOrder(reading, "i", 1)).toBeNull();
    expect(stepInOrder(reading, "g", -1)).toBeNull();
    expect(stepInOrder(reading, "sparita", 1)?.id).toBe("g");
  });

  it("Alt+frecce: il centro più vicino dentro un cono di 90°", () => {
    // Il centro di «o» è (50, 30).
    const doc: CanvasDocument = {
      nodes: [
        text("o", 0, 0),
        // Centro (650, 30): dritta a destra, lontana.
        text("lontana", 600, 0),
        // Centro (250, 180): 200 a destra e 150 sotto, dentro il cono di
        // destra e fuori da quello di sotto.
        text("storta", 200, 150),
        // Centro (200, 430): sotto.
        text("sotto", 150, 400),
        // Centro (200, -120): 150 a destra e 150 sopra, sul bordo dei coni di
        // destra e di sopra; conta per tutti e due, ma è più lontana.
        text("bordo", 150, -150),
      ],
      edges: [],
    };
    const reading = boardReading(doc);
    const o = byId(doc, "o");
    expect(nearestCard(o, reading, "right")?.id).toBe("bordo");
    expect(nearestCard(o, reading, "down")?.id).toBe("sotto");
    expect(nearestCard(o, reading, "up")?.id).toBe("bordo");
    expect(nearestCard(o, reading, "left")).toBeNull();
    // Senza «bordo» a destra vince «storta», più vicina di «lontana».
    const fewer = boardReading({ nodes: doc.nodes.filter((node) => node.id !== "bordo"), edges: [] });
    expect(nearestCard(o, fewer, "right")?.id).toBe("storta");
    expect(nearestCard(o, fewer, "up")).toBeNull();
  });

  it("a pari distanza vince quella prima nell'ordine di lettura", () => {
    const doc: CanvasDocument = {
      nodes: [text("o", 0, 0), text("giu", 200, 100), text("su", 200, -100)],
      edges: [],
    };
    const reading = boardReading(doc);
    expect(nearestCard(byId(doc, "o"), reading, "right")?.id).toBe("su");
  });
});

describe("che cosa si annuncia dopo un commit (T61)", () => {
  const doc = statistics();
  const v = byId(doc, "v");

  it("una scheda tolta, poi un filo nuovo, poi una scheda spostata", () => {
    const removed: CanvasPatch[] = [
      { kind: "remove-node", before: v, after: null },
      { kind: "remove-edge", before: doc.edges[0]!, after: null },
    ];
    expect(changeAnnouncement(removed, doc)).toBe("Hai tolto dalla lavagna: Scheda di nota Varianza.");
    expect(changeAnnouncement([
      { kind: "remove-node", before: v, after: null },
      { kind: "remove-node", before: byId(doc, "m"), after: null },
    ], doc)).toBe("Hai tolto 2 schede dalla lavagna.");
    expect(changeAnnouncement([{ kind: "upsert-edge", before: null, after: edge("e9", "m", "i") }], doc))
      .toBe("Hai collegato Scheda di nota Media aritmetica a Scheda di testo istogramma.");
    expect(changeAnnouncement([{ kind: "upsert-node", before: v, after: { ...v, x: v.x + 8 } }], doc))
      .toBe("Hai spostato: Scheda di nota Varianza.");
  });

  it("un testo, un colore o una misura non si annunciano", () => {
    expect(changeAnnouncement([{ kind: "upsert-node", before: v, after: { ...v, color: "2" } }], doc)).toBeNull();
    expect(changeAnnouncement([{ kind: "upsert-node", before: v, after: { ...v, x: v.x - 8, width: v.width + 8 } }], doc)).toBeNull();
    expect(changeAnnouncement([{ kind: "upsert-node", before: null, after: text("nuova", 0, 0) }], doc)).toBeNull();
  });
});

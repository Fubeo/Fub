// Il disegno a parole: l'albero degli oggetti dalle voci della scena, e il
// nome di ciascuno.

import { afterEach, describe as group, expect, it, vi } from "vitest";
import { countObjects, describe, keyOf, linkName, outline, polygonalKind, sceneTargets, type OutlineNode } from "./describe";
import { readScene } from "./scene/read";
import { doc, ink } from "./scene/test-support";

const SOURCE = doc(
  "<title>Casa</title><desc>La pianta</desc>" +
    '<g id="l1" fub:layer="Sfondo" fub:locked="true"><rect id="o1" x="0" y="0" width="10" height="10"/></g>' +
    '<g id="l2" fub:layer="Disegno">' +
    '<rect x="1" y="1" width="2" height="2"/>' +
    '<g id="g1"><title>Porta  d’ingresso</title><circle r="1"/><line x2="1"/></g>' +
    '<text id="t1" x="0" y="10"><tspan x="0" dy="0">Cucina</tspan><tspan x="0" dy="1.2">e sala</tspan></text>' +
    "</g>" +
    '<g id="l3" fub:layer="Note" display="none"/>' +
    '<ellipse id="e1" rx="2" ry="1"/>',
);

const tree = (): OutlineNode[] => outline(readScene(SOURCE).items);

function labels(nodes: readonly OutlineNode[], depth = 0): string[] {
  return nodes.flatMap((node) => [`${"  ".repeat(depth)}${describe(node, { parts: true })}`, ...labels(node.children, depth + 1)]);
}

group("l'albero degli oggetti", () => {
  it("segue il documento: livelli, i loro oggetti, i figli dei gruppi, gli oggetti alla radice", () => {
    expect(labels(tree())).toEqual([
      "Livello «Sfondo», bloccato",
      "  Rettangolo",
      "Livello «Disegno»",
      "  Rettangolo",
      "  Gruppo «Porta d’ingresso», 2 oggetti",
      "    Cerchio",
      "    Linea",
      "  Testo «Cucina e sala»",
      "Livello «Note», nascosto",
      "Ellisse",
    ]);
  });

  it("dà a ogni oggetto la chiave con cui l'editor lo sceglie", () => {
    const [locked, drawing, , ellipse] = tree();
    expect(locked!.key).toBe("l1");
    expect(drawing!.children.map((node) => node.key)).toEqual(["@3.0", "g1", "t1"]);
    expect(ellipse!.key).toBe("e1");
    expect(keyOf({ id: null, path: [1, 3] })).toBe("@1.3");
  });

  it("conta gli oggetti come li sceglie l'editor: un gruppo per uno", () => {
    expect(countObjects(tree())).toBe(5);
    expect(countObjects([])).toBe(0);
  });

  it("dice anche di un gruppo o di una forma se sono bloccati o nascosti", () => {
    const source = doc(
      '<g id="l1" fub:layer="Disegno">' +
        '<g id="g1" fub:locked="true"><rect id="o1" width="1" height="1" display="none"/></g>' +
        '<circle id="o2" r="1" fub:locked="true" display=" none "/>' +
        '<line id="o3" x2="1" fub:locked="false" display="inline"/>' +
        "</g>",
    );
    expect(labels(outline(readScene(source).items))).toEqual([
      "Livello «Disegno»",
      "  Gruppo, bloccato, 1 oggetto",
      "    Rettangolo, nascosto",
      "  Cerchio, bloccato, nascosto",
      "  Linea",
    ]);
  });

  it("aggiunge il colore quando chi descrive lo sa", () => {
    const rect = tree()[1]!.children[0]!;
    expect(describe(rect, { color: "Blu" })).toBe("Rettangolo, Blu");
  });

  it("nomina un oggetto col suo primo `title`, anche al posto delle parole di un testo", () => {
    const source = doc(
      '<g id="l1" fub:layer="Disegno"><title>Ignorato</title>' +
        '<rect id="o1" width="1" height="1"><title>Tetto</title><title>Secondo</title></rect>' +
        '<text id="t1"><title>Insegna</title><tspan>Bar</tspan></text>' +
        '<text id="t2"><title> </title><tspan>Bar</tspan></text>' +
        "</g>" +
        '<g id="l2" fub:layer=""><title>Appunti</title></g>',
    );
    expect(labels(outline(readScene(source).items))).toEqual([
      "Livello «Disegno»",
      "  Rettangolo «Tetto»",
      "  Testo «Insegna»",
      "  Testo «Bar»",
      "Livello «Appunti»",
    ]);
  });

  it("taglia un testo lungo con i puntini", () => {
    const long = "parola ".repeat(20);
    const node = outline(readScene(doc(`<text><tspan>${long}</tspan></text>`)).items)[0]!;
    expect(node.name!.endsWith("…")).toBe(true);
    expect(Array.from(node.name!)).toHaveLength(60);
  });

  it("dice dove porta un collegamento, col nome della nota", () => {
    const source = doc(
      '<g id="l1" fub:layer="Disegno">'
        + '<a id="a1" href="Note/Ciclo%20dell%E2%80%99acqua.md#Pioggia"><rect width="1" height="1"/></a>'
        + '<a id="a2" xlink:href="/Mappe/Nuvole.svg"><title>Vedi</title><rect width="1" height="1"/><circle r="1"/></a>'
        + '<a id="a3"><rect width="1" height="1"/></a>'
        + "</g>",
    );
    const scene = readScene(source);
    const [layer] = outline(scene.items, sceneTargets(scene));
    expect(layer!.children.map((node) => node.target)).toEqual(["Note/Ciclo%20dell%E2%80%99acqua.md#Pioggia", "/Mappe/Nuvole.svg", null]);
    expect(labels(layer!.children)).toEqual([
      "Collegamento a «Ciclo dell’acqua», 1 oggetto",
      "  Rettangolo",
      "Collegamento «Vedi» a «Nuvole», 2 oggetti",
      "  Rettangolo",
      "  Cerchio",
      "Collegamento, 1 oggetto",
      "  Rettangolo",
    ]);
    // Senza chi dice dove portano, un collegamento è un collegamento.
    expect(outline(scene.items)[0]!.children[0]!.target).toBeNull();
  });

  it("nomina la nota come il vault nomina una pagina", () => {
    expect(linkName("Ciclo.md")).toBe("Ciclo");
    expect(linkName("../a/b/Diario%202026.md")).toBe("Diario 2026");
    expect(linkName("Bando.pdf.fubann")).toBe("Bando.pdf");
    expect(linkName(".nascosta")).toBe(".nascosta");
    expect(linkName("rotto%E2.md")).toBe("rotto%E2");
    expect(linkName("cartella/")).toBe("cartella/");
  });

  it("chiama tratto ogni tratto a penna", () => {
    const [source] = ink(7);
    const strokes = outline(readScene(source).items).flatMap((node) => [node, ...node.children]).filter((node) => node.item.role === "stroke");
    expect(strokes.length).toBeGreaterThan(0);
    for (const node of strokes) expect(describe(node)).toMatch(/^(Tratto|Evidenziatura)$/);
  });

  it("chiama un poligono regolare col suo nome, e una stella con le sue punte", () => {
    const nodes = outline(
      readScene(
        doc(
          '<path fub:shape="polygon" fub:geom="0 0 10 6 0 0" d="M0 0 L1 0 L1 1 Z"/>' +
            '<path fub:shape="polygon" fub:geom="0 0 10 20 0 2" d="M0 0 L1 0 L1 1 Z"/>' +
            '<path fub:shape="star" fub:geom="0 0 10 5 0.382 0 0" d="M0 0 L1 0 L1 1 Z"/>' +
            '<path fub:shape="star" fub:geom="0 0 10 5 0.382 0 0" d="M0 0 L1 0 L1 1 Z"><title>Cometa</title></path>' +
            '<path fub:shape="polygon" fub:geom="0 0 10 2 0 0" d="M0 0 L1 0 L1 1 Z"/>',
        ),
      ).items,
    );
    expect(nodes.map((node) => describe(node))).toEqual([
      "Esagono",
      "Poligono di 20 lati",
      "Stella a 5 punte",
      "Stella a 5 punte «Cometa»",
      "Tracciato",
    ]);
    const names = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((count) => polygonalKind({ shape: "polygon", count }));
    expect(names).toEqual(["Triangolo", "Quadrato", "Pentagono", "Esagono", "Ettagono", "Ottagono", "Ennagono", "Decagono", "Endecagono", "Dodecagono"]);
    expect(polygonalKind({ shape: "polygon", count: 13 })).toBe("Poligono di 13 lati");
    expect(polygonalKind({ shape: "star", count: 4 })).toBe("Stella a 4 punte");
  });
});

group("i connettori", () => {
  afterEach(() => vi.unstubAllGlobals());

  const rect = (id: string, title?: string): string =>
    `<rect id="${id}" x="0" y="0" width="20" height="10">${title === undefined ? "" : `<title>${title}</title>`}</rect>`;
  /// Un connettore dritto fra `ends`; un capo che manca è libero.
  const connector = (id: string, ends: { readonly from?: string; readonly to?: string }, inside = ""): string =>
    `<path id="${id}" fub:shape="connector" fub:geom="straight 10 10 90 10"` +
    (ends.from === undefined ? "" : ` fub:from="${ends.from} auto"`) +
    (ends.to === undefined ? "" : ` fub:to="${ends.to} auto"`) +
    ` d="M10 10 L90 10" fill="none" stroke="#000000">${inside}</path>`;
  const label = (id: string, along: string, words: string): string =>
    `<text id="${id}" fub:along="${along} 0.5 6" x="50" y="4"><tspan x="50" dy="0">${words}</tspan></text>`;

  const nodesOf = (body: string): OutlineNode[] => outline(readScene(doc(body)).items);
  const spoken = (nodes: readonly OutlineNode[], options = {}): string[] => nodes.map((node) => describe(node, options));

  it("dice da che cosa a che cosa va: tutti e due i capi, solo l'inizio, solo la fine, nessuno", () => {
    const nodes = nodesOf(
      rect("o1", "Ingresso") + rect("o2", "Verifica") +
        connector("c1", { from: "o1", to: "o2" }) +
        connector("c2", { from: "o1" }) +
        connector("c3", { to: "o2" }) +
        connector("c4", {}),
    );
    expect(spoken(nodes.slice(2))).toEqual([
      "Connettore da «Ingresso» a «Verifica»",
      "Connettore da «Ingresso»",
      "Connettore verso «Verifica»",
      "Connettore",
    ]);
    expect(nodes.slice(2).map((node) => node.connection)).toEqual([
      { from: "«Ingresso»", to: "«Verifica»" },
      { from: "«Ingresso»", to: null },
      { from: null, to: "«Verifica»" },
      { from: null, to: null },
    ]);
  });

  it("dice un oggetto senza nome col suo tipo, e un gruppo col suo nome o «Gruppo»", () => {
    const nodes = nodesOf(
      rect("o1") + rect("o2", "Verifica") +
        '<g id="g1"><title>Cucina</title><circle id="o3" r="1"/></g>' +
        '<g id="g2"><circle id="o4" r="1"/></g>' +
        '<path id="p1" fub:shape="polygon" fub:geom="0 0 10 6 0 0" d="M0 0 L1 0 L1 1 Z"/>' +
        connector("c1", { from: "o1", to: "o2" }) +
        connector("c2", { from: "g1", to: "g2" }) +
        connector("c3", { from: "o3", to: "p1" }),
    );
    expect(spoken(nodes.slice(-3))).toEqual([
      "Connettore da Rettangolo a «Verifica»",
      "Connettore da «Cucina» a Gruppo",
      "Connettore da Cerchio a Esagono",
    ]);
  });

  it("nomina un oggetto agganciato come lo nomina l'albero: col `title`, o con le parole di un testo", () => {
    const nodes = nodesOf(
      '<text id="t1" x="0" y="10"><tspan x="0" dy="0">Cucina</tspan><tspan x="0" dy="1.2">e sala</tspan></text>' +
        rect("o1", "  Porta   d’ingresso ") +
        connector("c1", { from: "t1", to: "o1" }),
    );
    expect(describe(nodes[2]!)).toBe("Connettore da «Cucina e sala» a «Porta d’ingresso»");
  });

  it("nomina il connettore dal testo della sua prima etichetta, e il suo `title` vince", () => {
    const nodes = nodesOf(
      rect("o1", "Verifica") + rect("o2", "Fine") +
        connector("c1", { from: "o1", to: "o2" }) + label("t1", "c1", "sì") +
        connector("c2", { from: "o1", to: "o2" }, "<title>Esito positivo</title>") + label("t2", "c2", "sì") +
        connector("c3", { from: "o1" }) + label("t3", "c3", "no") + label("t4", "c3", "mai"),
    );
    const connectors = nodes.filter((node) => node.item.role === "connector");
    expect(connectors.map((node) => node.name)).toEqual(["sì", "Esito positivo", "no"]);
    expect(spoken(connectors)).toEqual([
      "Connettore «sì» da «Verifica» a «Fine»",
      "Connettore «Esito positivo» da «Verifica» a «Fine»",
      "Connettore «no» da «Verifica»",
    ]);
    // L'etichetta è un testo come gli altri.
    expect(describe(nodes.find((node) => node.key === "t1")!)).toBe("Testo «sì»");
  });

  it("conta la prima etichetta in ordine di documento, anche se sta prima del connettore", () => {
    const nodes = nodesOf(
      label("t1", "c1", "primo") + connector("c1", {}) + label("t2", "c1", "secondo") +
        // Un'etichetta senza parole non dice niente: conta la prima che ne ha.
        label("t3", "c2", " ") + connector("c2", {}) + label("t4", "c2", "quarto") +
        // Quella di un connettore che non c'è non nomina nessuno.
        label("t5", "c9", "sola") + connector("c3", {}),
    );
    expect(spoken(nodes.filter((node) => node.item.role === "connector"))).toEqual([
      "Connettore «primo»",
      "Connettore «quarto»",
      "Connettore",
    ]);
  });

  it("taglia il nome preso da un'etichetta lunga, e lo dà intero alla Lettura", () => {
    const long = "parola ".repeat(20).trim();
    const nodes = nodesOf(rect("o1") + rect("o2") + connector("c1", { from: "o1", to: "o2" }) + label("t1", "c1", long));
    const connected = nodes.find((node) => node.item.role === "connector")!;
    expect(Array.from(connected.name!)).toHaveLength(60);
    expect(connected.name!.endsWith("…")).toBe(true);
    expect(connected.joined!.label).toBe(long);
  });

  it("un capo verso ciò che non è un oggetto vale come libero", () => {
    const nodes = nodesOf(
      '<defs><linearGradient id="gr1"><stop offset="0" stop-color="#000000"/><stop offset="1" stop-color="#ffffff"/></linearGradient></defs>' +
        '<rect id="fub-paper" fub:role="paper" width="100" height="100" fill="#ffffff"/>' +
        '<g id="l1" fub:layer="Disegno">' + rect("o1", "Verifica") + "</g>" +
        "<foo:bar xmlns:foo=\"urn:foo\" id=\"x1\"/>" +
        connector("c1", { from: "o1", to: "nonesiste" }) +
        connector("c2", { from: "o1", to: "gr1" }) +
        connector("c3", { from: "o1", to: "c1" }) +
        connector("c4", { from: "l1", to: "o1" }) +
        connector("c5", { from: "fub-paper", to: "x1" }) +
        connector("c6", { from: "c6", to: "o1" }),
    );
    const connectors = nodes.filter((node) => node.item.role === "connector");
    expect(spoken(connectors)).toEqual([
      "Connettore da «Verifica»",
      "Connettore da «Verifica»",
      "Connettore da «Verifica»",
      "Connettore verso «Verifica»",
      "Connettore",
      "Connettore verso «Verifica»",
    ]);
    expect(connectors.map((node) => node.joined)).toEqual([null, null, null, null, null, null]);
  });

  /// Il testo che sta dentro `shape`, come lo scrive l'editor.
  const inside = (id: string, shape: string, words: string, extra = ""): string =>
    `<text id="${id}" fub:inside="${shape}" fub:wrap="20" x="0" y="0" text-anchor="middle"${extra}><tspan x="0" dy="0">${words}</tspan></text>`;
  /// Una forma delle raccolte: un tracciato col nome del tipo nel `title`.
  const shaped = (id: string, title: string): string => `<path id="${id}" d="M0 5 L10 0 L20 5 L10 10 Z" fill="none" stroke="#000000"><title>${title}</title></path>`;

  it("nomina una forma con le parole della sua etichetta, e come lei il gruppo che tiene soltanto loro due", () => {
    const nodes = nodesOf(
      '<g id="g1">' + rect("o1") + inside("t1", "o1", "Inizio") + "</g>" +
        '<g id="g2">' + rect("o2", "Verifica") + inside("t2", "o2", "Controllo") + "</g>" +
        '<g id="g3">' + rect("o3") + inside("t3", "o3", "Primo") + inside("t4", "o3", "Secondo") + rect("o4") + "</g>" +
        connector("c1", { from: "g1", to: "o2" }) +
        connector("c2", { from: "o3", to: "o4" }),
    );
    // Il `title` della seconda forma prende il posto del tipo: il nome sono le
    // parole che si vedono.
    expect(labels(nodes)).toEqual([
      "Gruppo «Inizio», 2 oggetti",
      "  Rettangolo «Inizio»",
      "  Testo «Inizio»",
      "Gruppo «Controllo», 2 oggetti",
      "  Verifica «Controllo»",
      "  Testo «Controllo»",
      "Gruppo, 4 oggetti",
      "  Rettangolo «Primo»",
      "  Testo «Primo»",
      "  Testo «Secondo»",
      "  Rettangolo",
      "Connettore da «Inizio» a «Controllo»",
      "Connettore da «Primo» a Rettangolo",
    ]);
  });

  it("una forma delle raccolte con l'etichetta si chiama col suo titolo al posto del tipo", () => {
    const nodes = nodesOf(
      '<g id="g1">' + shaped("o1", "Decisione") + inside("t1", "o1", "Controlla l’ordine") + "</g>" +
        '<g id="g2">' + rect("o2") + inside("t2", "o2", "Inizio") + "</g>" +
        // Senza l'etichetta il nome resta il titolo, e il tipo il suo.
        shaped("o3", "Decisione") +
        connector("c1", { from: "o2", to: "o1" }),
    );
    expect(labels(nodes)).toEqual([
      "Gruppo «Controlla l’ordine», 2 oggetti",
      "  Decisione «Controlla l’ordine»",
      "  Testo «Controlla l’ordine»",
      "Gruppo «Inizio», 2 oggetti",
      "  Rettangolo «Inizio»",
      "  Testo «Inizio»",
      "Tracciato «Decisione»",
      "Connettore da «Inizio» a «Controlla l’ordine»",
    ]);
    // I capi con le parole dell'etichetta, nell'albero e nella Lettura.
    const connector1 = nodes[3]!;
    expect(connector1.connection).toEqual({ from: "«Inizio»", to: "«Controlla l’ordine»" });
    expect(connector1.joined).toEqual({ from: "Inizio", to: "Controlla l’ordine", label: null });
    expect(nodes[0]!.children[0]!.kind).toBe("Decisione");
    expect(nodes[2]!.kind).toBeNull();
  });

  it("il gruppo con un titolo suo lo tiene, e una forma con l'etichetta vuota non cambia nome", () => {
    const nodes = nodesOf(
      '<g id="g1"><title>Passo uno</title>' + shaped("o1", "Decisione") + inside("t1", "o1", "Sì") + "</g>" +
        '<g id="g2">' + shaped("o2", "Decisione") + inside("t2", "o2", " ") + "</g>",
    );
    expect(labels(nodes)).toEqual([
      "Gruppo «Passo uno», 2 oggetti",
      "  Decisione «Sì»",
      "  Testo «Sì»",
      "Gruppo, 2 oggetti",
      "  Tracciato «Decisione»",
      "  Testo",
    ]);
  });

  it("parla inglese: il titolo al posto del tipo, le parole dell'etichetta fra virgolette", () => {
    const nodes = nodesOf(
      '<g id="g1">' + shaped("o1", "Decision") + inside("t1", "o1", "Check the order") + "</g>" +
        '<g id="g2">' + rect("o2") + inside("t2", "o2", "Start") + "</g>" +
        connector("c1", { from: "o2", to: "o1" }),
    );
    vi.stubGlobal("navigator", { language: "en-GB" });
    expect(labels(nodes)).toEqual([
      "Group “Check the order”, 2 objects",
      "  Decision “Check the order”",
      "  Text “Check the order”",
      "Group “Start”, 2 objects",
      "  Rectangle “Start”",
      "  Text “Start”",
      "Connector from “Start” to “Check the order”",
    ]);
  });

  it("nei nomi le righe di un'etichetta si uniscono come sono scritte: `word` senza spazio, il resto con uno", () => {
    const area = (id: string, place: string, lines: ReadonlyArray<readonly [string, string | null]>): string =>
      `<text id="${id}"${place === "" ? "" : ` ${place}`} fub:wrap="30" x="0" y="0">` +
      lines.map(([words, join]) => `<tspan${join === null ? "" : ` fub:join="${join}"`} x="0" dy="1">${words}</tspan>`).join("") +
      "</text>";
    const nodes = nodesOf(
      '<g id="g1">' + rect("o1") + area("t1", 'fub:inside="o1"', [["Pronto", null], ["?", "word"]]) + "</g>" +
        '<g id="g2">' + rect("o2") + area("t2", 'fub:inside="o2"', [["Una", null], ["parola", "space"], ["lun", "space"], ["ga", "word"], ["Nuovo", null]]) + "</g>" +
        // Un testo in area che non è un'etichetta, con una riga vuota in mezzo.
        area("t3", "", [["Come", null], ["", "word"], ["ora", "word"]]) +
        connector("c1", { from: "o1", to: "o2" }) + area("t4", 'fub:along="c1 0.5 6"', [["ok", null], ["!", "word"]]),
    );
    expect(labels(nodes)).toEqual([
      "Gruppo «Pronto?», 2 oggetti",
      "  Rettangolo «Pronto?»",
      "  Testo «Pronto?»",
      "Gruppo «Una parola lunga Nuovo», 2 oggetti",
      "  Rettangolo «Una parola lunga Nuovo»",
      "  Testo «Una parola lunga Nuovo»",
      "Testo «Comeora»",
      "Connettore «ok!» da «Pronto?» a «Una parola lunga Nuovo»",
      "Testo «ok!»",
    ]);
    // La Lettura legge il connettore con la stessa etichetta.
    expect(nodes[3]!.joined).toEqual({ from: "Pronto?", to: "Una parola lunga Nuovo", label: "ok!" });
  });

  it("trova un oggetto in un livello o in un gruppo, per id", () => {
    const nodes = nodesOf(
      '<g id="l1" fub:layer="Entrata"><g id="g1">' + rect("o1", "Ingresso") + "</g></g>" +
        '<g id="l2" fub:layer="Uscita">' + rect("o2", "Verifica") + connector("c1", { from: "o1", to: "o2" }) + "</g>",
    );
    expect(describe(nodes[1]!.children[1]!)).toBe("Connettore da «Ingresso» a «Verifica»");
  });

  it("dà alla Lettura i connettori con tutti e due i capi, coi nomi senza caporali e l'etichetta", () => {
    const nodes = nodesOf(
      rect("o1", "Ingresso") + rect("o2") +
        connector("c1", { from: "o1", to: "o2" }) + label("t1", "c1", "sì") +
        connector("c2", { from: "o2", to: "o1" }) +
        connector("c3", { from: "o1" }),
    );
    const connectors = nodes.filter((node) => node.item.role === "connector");
    expect(connectors.map((node) => node.joined)).toEqual([
      { from: "Ingresso", to: "Rettangolo", label: "sì" },
      { from: "Rettangolo", to: "Ingresso", label: null },
      null,
    ]);
    expect(nodes.filter((node) => node.item.role !== "connector").map((node) => node.joined)).toEqual([null, null, null]);
  });

  it("non dà niente agli altri oggetti", () => {
    for (const node of nodesOf(rect("o1") + label("t1", "o1", "no") + "<g id=\"g1\"><circle r=\"1\"/></g>")) {
      expect(node.connection).toBeNull();
      expect(node.joined).toBeNull();
    }
  });

  it("parla inglese, e segue la lingua anche in un albero già costruito", () => {
    const nodes = nodesOf(
      rect("o1", "Start") + rect("o2", "Check") + rect("o3") +
        connector("c1", { from: "o1", to: "o2" }) +
        connector("c2", { from: "o1" }) +
        connector("c3", { to: "o2" }) +
        connector("c4", {}) +
        connector("c5", { from: "o3", to: "o2" }) + label("t1", "c5", "yes"),
    );
    const connectors = nodes.filter((node) => node.item.role === "connector");
    expect(spoken(connectors)[4]).toBe("Connettore «yes» da Rettangolo a «Check»");
    vi.stubGlobal("navigator", { language: "en-GB" });
    expect(spoken(connectors)).toEqual([
      "Connector from “Start” to “Check”",
      "Connector from “Start”",
      "Connector to “Check”",
      "Connector",
      "Connector “yes” from Rectangle to “Check”",
    ]);
    expect(connectors[4]!.joined).toEqual({ from: "Rectangle", to: "Check", label: "yes" });
    expect(connectors[0]!.connection).toEqual({ from: "“Start”", to: "“Check”" });
  });
});

// La classificazione della scena, il testo in area e su tracciato, i simboli
// e le ripetizioni, nei due versi. Sono i casi di
// `crates/fub-scene/tests/classify.rs`, letti da questo lettore.

import { describe, expect, it } from "vitest";
import type { Role, Summary } from "./analysis";
import { at, doc, findings, first, load, role } from "./test-support";

describe("il testo in area e su tracciato", () => {
  const PATH = '<path id="r1" fub:role="private" d="M0 50 C30 0 70 0 100 50"/>';
  /// Il ruolo del primo figlio della radice dopo una `defs` con il tracciato.
  const onPath = (body: string, defs = PATH): Role | null => role(load(doc(`<defs>${defs}</defs>${body}`)), [1]);

  it("un path in una defs della radice è il tracciato di un testo, con id e d soltanto", () => {
    const scene = load(doc(`<defs>${PATH}<path id="r2" d="M0 0 L10 0"><title>Linea</title></path></defs>`));
    expect(role(scene, [0, 0])).toBe("resource");
    expect(at(scene, [0, 0])!.lifecycle).toBe("private");
    expect(at(scene, [0, 1])!.title).toBe("Linea");
    for (const defs of [
      '<path d="M0 0 L10 0"/>',
      '<path id="r1"/>',
      '<path id="r1" d="M0 0 L"/>',
      '<path id="r1" d="M0 0 L10 0" transform="scale(2)"/>',
      '<path id="r1" d="M0 0 L10 0" fill="#000000"/>',
      '<path id="r1" d="M0 0 L10 0" style="x"/>',
      '<path id="r1" d="M0 0 L10 0"><rect/></path>',
      '<path id="r1" d="M0 0 L10 0" xlink:title="x"/>',
    ]) {
      expect(role(load(doc(`<defs>${defs}</defs>`)), [0, 0]), defs).toBeNull();
    }
    // Gli attributi di altri namespace restano; fuori da una defs un path è
    // una forma.
    expect(role(load(doc('<defs><path id="r1" d="M0 0 L10 0" fub:nota="x"/></defs>')), [0, 0])).toBe("resource");
    expect(first('<path id="r1" d="M0 0 L10 0"/>')).toBe("path");
  });

  it("un testo segue un tracciato delle risorse con un textPath", () => {
    for (const body of [
      '<text><textPath href="#r1">a</textPath></text>',
      '<text><textPath xlink:href="#r1">a</textPath></text>',
      '<text text-anchor="middle" font-size="20"><textPath href="#r1" startOffset="50%">a</textPath></text>',
      '<text><textPath href="#r1" startOffset="-12.5">a</textPath></text>',
      '<text><textPath href="#r1" startOffset="1cm">a</textPath></text>',
      '<text>\n  <title>t</title>\n  <textPath href="#r1">a <tspan font-weight="bold" fill="#ff0000">b</tspan> c</textPath>\n</text>',
      '<text><textPath href="#r1"></textPath></text>',
      '<text><textPath href="#r1" fub:nota="x">a &#x2014; b</textPath></text>',
      // La defs può venire dopo.
    ]) {
      expect(onPath(body), body).toBe("text");
    }
    expect(role(load(doc(`<text><textPath href="#r1">a</textPath></text><defs>${PATH}</defs>`)), [0])).toBe("text");
    for (const body of [
      // Due riferimenti, nessuno, uno che non è un tracciato o che non c'è.
      '<text><textPath href="#r1" xlink:href="#r1">a</textPath></text>',
      "<text><textPath>a</textPath></text>",
      '<text><textPath href="#r2">a</textPath></text>',
      '<text><textPath href="#g1">a</textPath></text>',
      '<text><textPath href="r1">a</textPath></text>',
      '<text><textPath href="url(#r1)">a</textPath></text>',
      // Attributi fuori elenco.
      '<text><textPath href="#r1" id="t1">a</textPath></text>',
      '<text><textPath href="#r1" method="stretch">a</textPath></text>',
      '<text><textPath href="#r1" spacing="auto">a</textPath></text>',
      '<text><textPath href="#r1" side="right">a</textPath></text>',
      '<text><textPath path="M0 0 L10 0">a</textPath></text>',
      '<text><textPath href="#r1" fill="#000000">a</textPath></text>',
      '<text><textPath href="#r1" startOffset="auto">a</textPath></text>',
      '<text><textPath href="#r1" startOffset="1em">a</textPath></text>',
      // Il contenuto: dati di carattere e pezzi.
      '<text><textPath href="#r1">a<!-- b --></textPath></text>',
      '<text><textPath href="#r1"><tspan x="0">a</tspan></textPath></text>',
      '<text><textPath href="#r1"><tspan dy="1">a</tspan></textPath></text>',
      '<text><textPath href="#r1"><tspan>a<tspan>b</tspan></tspan></textPath></text>',
      '<text><textPath href="#r1"><title>t</title>a</textPath></text>',
      // Le righe o il tracciato, non tutti e due; un tracciato solo; niente
      // x e y.
      '<text><tspan>a</tspan><textPath href="#r1">b</textPath></text>',
      '<text><textPath href="#r1">a</textPath><textPath href="#r1">b</textPath></text>',
      '<text><textPath href="#r1">a</textPath>b</text>',
      '<text x="0"><textPath href="#r1">a</textPath></text>',
      '<text y="0"><textPath href="#r1">a</textPath></text>',
      // Un textPath fuori da un testo, o in una riga.
      '<textPath href="#r1">a</textPath>',
      '<text><tspan><textPath href="#r1">a</textPath></tspan></text>',
    ]) {
      expect(onPath(body), body).toBeNull();
    }
    expect(onPath('<text><textPath href="#g1">a</textPath></text>', '<linearGradient id="g1"/>')).toBeNull();
  });

  it("un testo su tracciato non sta nel contenuto di una risorsa", () => {
    const scene = load(doc(`<defs>${PATH}<pattern id="r2" width="10" height="10" patternUnits="userSpaceOnUse"><text><textPath href="#r1">a</textPath></text></pattern></defs>`));
    expect(role(scene, [0, 1])).toBeNull();
  });

  it("la scena dà la riga di un testo su tracciato e il suo tracciato", () => {
    const scene = load(doc(`<defs>${PATH}</defs><text><textPath xlink:href="#r1"> a <tspan font-weight="bold">b</tspan>&amp;</textPath></text>`));
    const item = at(scene, [1])!;
    expect(item.lines).toEqual([" a b&"]);
    expect(item.textPath).toBe("r1");
    expect(item.wrap).toBeUndefined();
    // Un testo su tracciato non va a capo.
    expect(at(load(doc(`<defs>${PATH}</defs><text fub:wrap="100"><textPath href="#r1">a</textPath></text>`)), [1])!.wrap).toBeUndefined();
  });

  it("un testo in area dà la larghezza del suo riquadro", () => {
    const area = (wrap: string): number | undefined =>
      at(load(doc(`<text fub:wrap="${wrap}" x="10" y="20"><tspan x="10" dy="0">a</tspan><tspan fub:join="space" x="10" dy="24">b</tspan></text>`)), [0])!.wrap;
    expect(area("320")).toBe(320);
    expect(area(" 12.5 ")).toBe(12.5);
    // Fuori grammatica è un testo da punto, sempre modificabile.
    for (const wrap of ["0", "-5", "10px", "", "x"]) expect(area(wrap), wrap).toBeUndefined();
    const scene = load(doc('<text fub:wrap="x"><tspan>a</tspan></text>'));
    expect(role(scene, [0])).toBe("text");
    expect(at(scene, [0])!.lines).toEqual(["a"]);
  });

  it("l'indice unisce senza spazio le righe che continuano una parola", () => {
    const index = (body: string): string[] => load(doc(body)).index.texts.map((excerpt) => excerpt.text);
    expect(
      index(
        '<text fub:wrap="100"><tspan>Una pa</tspan><tspan fub:join="word">rola</tspan><tspan fub:join="space">e un trat-</tspan>' +
          '<tspan fub:join="word">tino</tspan><tspan>Nuovo</tspan></text>',
      ),
    ).toEqual(["Una parola e un trat-tino Nuovo"]);
    // Fuori da un testo in area, o sulla prima riga, fub:join non vale.
    expect(index('<text><tspan>pa</tspan><tspan fub:join="word">rola</tspan></text>')).toEqual(["pa rola"]);
    expect(index('<text fub:wrap="100"><tspan fub:join="word">a</tspan><tspan>b</tspan></text>')).toEqual(["a b"]);
    expect(index('<text fub:wrap="100"><tspan>a</tspan><tspan fub:join="parola">b</tspan></text>')).toEqual(["a b"]);
    // Un testo su tracciato è una riga.
    expect(index(`<defs>${PATH}</defs><text><textPath href="#r1">a <tspan>b</tspan></textPath></text>`)).toEqual(["a b"]);
  });

  it("un testo in area dice quali righe continuano una parola", () => {
    const glued = (body: string): readonly boolean[] | undefined => at(load(doc(body)), [0])!.glued;
    // Dopo la prima riga, solo `word`; `space`, nessun valore e un valore
    // sconosciuto continuano con uno spazio.
    expect(
      glued(
        '<text fub:wrap="100"><tspan>Una pa</tspan><tspan fub:join="word">rola</tspan><tspan fub:join="space">e un trat-</tspan>' +
          '<tspan fub:join="word">tino</tspan><tspan fub:join="parola">Nuovo</tspan></text>',
      ),
    ).toEqual([false, true, false, true, false]);
    // Se nessuna riga lo fa, o fuori da un testo in area, o sulla prima riga,
    // non c'è.
    expect(glued('<text fub:wrap="100"><tspan>a</tspan><tspan fub:join="space">b</tspan></text>')).toBeUndefined();
    expect(glued('<text><tspan>pa</tspan><tspan fub:join="word">rola</tspan></text>')).toBeUndefined();
    expect(glued('<text fub:wrap="100"><tspan fub:join="word">a</tspan><tspan>b</tspan></text>')).toBeUndefined();
  });

  it("il riquadro di un testo su tracciato è quello del suo tracciato", () => {
    const scene = load(doc(`<defs><path id="r1" d="M10 20 L60 20 L60 70"/></defs><text transform="translate(5 5)"><textPath href="#r1">a</textPath></text>`));
    expect(scene.summary.bbox).toEqual({ x: 15, y: 25, width: 50, height: 50 });
  });
});

describe("i simboli", () => {
  /// Un simbolo `id` con `body` dentro.
  const symbol = (id: string, body = "", attrs = ""): string => `<symbol id="${id}" overflow="visible"${attrs}>${body}</symbol>`;
  const RECT = '<rect width="10" height="10" fill="#000000"/>';

  it("un simbolo è un symbol con id e overflow=visible in una defs della radice, coi figli giudicati uno per uno", () => {
    const scene = load(doc(`<defs>${symbol("s1", `<title>Lampadina</title>${RECT}<switch/>`, ' fub:source="Simboli/Casa.svg#s1 0123456789abcdef"')}</defs>`));
    expect(role(scene, [0, 0])).toBe("symbol");
    expect(role(scene, [0, 0, 0])).toBe("title");
    expect(role(scene, [0, 0, 1])).toBe("rect");
    expect(role(scene, [0, 0, 2])).toBeNull();
    expect(at(scene, [0, 0])!.title).toBe("Lampadina");
    expect(at(scene, [0, 0])!.source).toBe("Simboli/Casa.svg#s1 0123456789abcdef");
    expect(at(scene, [0, 0])!.tags).toBeDefined();
    const one = (body: string): Role | null => role(load(doc(`<defs>${body}</defs>`)), [0, 0]);
    expect(one('<symbol id="s1" overflow=" visible "/>')).toBe("symbol");
    expect(one('<symbol id="s1" overflow="visible" fub:nota="x"/>')).toBe("symbol");
    for (const body of [
      '<symbol id="s1"/>',
      '<symbol id="s1" overflow="hidden"/>',
      '<symbol id="" overflow="visible"/>',
      '<symbol overflow="visible"/>',
      '<symbol id="s1" overflow="visible" viewBox="0 0 10 10"/>',
      '<symbol id="s1" overflow="visible" x="0"/>',
      '<symbol id="s1" overflow="visible" transform="scale(2)"/>',
      '<symbol id="s1" overflow="visible" fill="#000000"/>',
      '<symbol id="s1" overflow="visible" xlink:href="#s1"/>',
    ]) {
      expect(one(body), body).toBeNull();
    }
    // Fuori da una defs della radice è estraneo.
    expect(first(symbol("s1", RECT))).toBeNull();
    expect(role(load(doc(`<g>${symbol("s1", RECT)}</g>`)), [0, 0])).toBeNull();
    expect(role(load(doc(`<g><defs>${symbol("s1", RECT)}</defs></g>`)), [0, 0])).toBeNull();
  });

  it("un simbolo che contiene sé stesso è estraneo, anche attraverso altri simboli", () => {
    const roles = (defs: string): Array<Role | null> => {
      const scene = load(doc(`<defs>${defs}</defs>`));
      return [0, 1, 2].map((k) => (at(scene, [0, k]) ?? null)?.role ?? null);
    };
    // Una catena senza cicli, scritta in qualunque ordine.
    expect(roles(symbol("s1", '<use href="#s2"/>') + symbol("s2", '<use href="#s3"/>') + symbol("s3", RECT))).toEqual(["symbol", "symbol", "symbol"]);
    // Sé stesso, e due a vicenda; chi usa uno di loro resta, la sua istanza
    // no.
    expect(roles(symbol("s1", '<use href="#s1"/>'))).toEqual([null, null, null]);
    const scene = load(doc(`<defs>${symbol("s1", '<use href="#s2"/>')}${symbol("s2", '<g><use xlink:href="#s1"/></g>')}${symbol("s3", `${RECT}<use href="#s1"/>`)}</defs>`));
    expect(role(scene, [0, 0])).toBeNull();
    expect(role(scene, [0, 1])).toBeNull();
    expect(role(scene, [0, 2])).toBe("symbol");
    expect(role(scene, [0, 2, 0])).toBe("rect");
    expect(role(scene, [0, 2, 1])).toBeNull();
    // Anche un riferimento che non è un'istanza fa il ciclo.
    expect(roles(symbol("s1", '<rect width="10" height="10" fill="url(#s2) #000000"/>') + symbol("s2", '<use href="#s1"/>'))).toEqual([null, null, null]);
  });

  it("una catena lunga di simboli si legge senza ricorsione", () => {
    const length = 3000;
    const defs = Array.from({ length }, (_, k) => symbol(`s${k}`, k + 1 < length ? `<use href="#s${k + 1}" transform="translate(1 0)"/>` : RECT)).join("");
    const scene = load(doc(`<defs>${defs}</defs><use href="#s0"/>`));
    expect(role(scene, [0, length - 1])).toBe("symbol");
    expect(role(scene, [1])).toBe("instance");
    expect(scene.summary.bbox).toEqual({ x: length - 1, y: 0, width: 10, height: 10 });
  });

  it("un id già preso da una risorsa resta della risorsa", () => {
    const scene = load(doc(`<defs><linearGradient id="s1"><stop offset="0" stop-color="#000000"/></linearGradient>${symbol("s1", RECT)}</defs><use href="#s1"/>`));
    expect(role(scene, [0, 0])).toBe("resource");
    expect(role(scene, [0, 1])).toBeNull();
    expect(role(scene, [1])).toBeNull();
    expect(findings(scene).map((d) => d.code)).toContain("S003");
  });

  it("un'istanza è un use verso un simbolo, coi suoi attributi e soltanto titoli e descrizioni", () => {
    const RESOURCES =
      '<clipPath id="c1"><rect width="5" height="5"/></clipPath><mask id="m1"><rect width="5" height="5" fill="#ffffff"/></mask><filter id="f1"><feGaussianBlur stdDeviation="1"/></filter>';
    const instance = (use: string): Role | null => role(load(doc(`<defs>${RESOURCES}${symbol("s1", RECT)}</defs>${use}`)), [1]);
    for (const use of [
      '<use href="#s1"/>',
      '<use xlink:href="#s1"/>',
      '<use id="o1" href="#s1" transform="translate(10 20) rotate(30)" opacity="0.5" display="none" style="mix-blend-mode: multiply"/>',
      '<use href="#s1" clip-path="url(#c1)" mask="url(#m1)" filter="url(#f1)"/>',
      '<use href="#s1" fub:nota="x">\n  <title>Lampada</title>\n  <desc>In cucina</desc>\n</use>',
    ]) {
      expect(instance(use), use).toBe("instance");
    }
    for (const use of [
      "<use/>",
      '<use x="10" href="#s1"/>',
      '<use width="10" href="#s1"/>',
      '<use fill="#ff0000" href="#s1"/>',
      '<use stroke="#ff0000" href="#s1"/>',
      '<use font-size="12" href="#s1"/>',
      '<use style="isolation: isolate" href="#s1"/>',
      '<use href="#s1" xlink:href="#s1"/>',
      '<use href="#c1"/>',
      '<use href="#s9"/>',
      '<use href="s1"/>',
      '<use href="Simboli.svg#s1"/>',
      '<use href="#s1" clip-path="url(#m1)"/>',
      `<use href="#s1">${RECT}</use>`,
      '<use href="#s1">testo</use>',
    ]) {
      expect(instance(use), use).toBeNull();
    }
    // Il simbolo dell'istanza, da `href` o da `xlink:href`.
    const scene = load(doc(`<defs>${symbol("s1", RECT)}</defs><use href="#s1"/><a href="note.md"><use xlink:href="#s1"/></a>`));
    expect(at(scene, [1])!.symbol).toBe("s1");
    expect(at(scene, [2, 0])!.symbol).toBe("s1");
    expect(at(scene, [2, 0])!.role).toBe("instance");
    // In una defs un'istanza è estranea.
    expect(role(load(doc(`<defs>${symbol("s1", RECT)}<use href="#s1"/></defs>`)), [0, 1])).toBeNull();
  });

  it("il riquadro di un'istanza è quello del suo simbolo, e il simbolo si conta una volta", () => {
    const summary = (body: string): Summary => load(doc(body)).summary;
    const scene = load(doc(`<use href="#s1" transform="translate(100 50) scale(2)"/><defs>${symbol("s1", RECT)}</defs>`));
    expect(scene.summary.bbox).toEqual({ x: 100, y: 50, width: 20, height: 20 });
    // Il contenuto del simbolo nelle sue coordinate non conta, e nemmeno
    // un'istanza nascosta o di un simbolo vuoto.
    expect(summary(`<defs>${symbol("s1", RECT)}${symbol("s2")}</defs>`).bbox).toBeNull();
    expect(summary(`<defs>${symbol("s1", RECT)}</defs><use href="#s1" display="none"/><g display="none"><use href="#s1"/></g>`).bbox).toBeNull();
    expect(summary(`<defs>${symbol("s2")}</defs><use href="#s2"/>`).bbox).toBeNull();
    // Un simbolo dentro un altro, ruotato.
    expect(summary(`<defs>${symbol("s1", RECT)}${symbol("s2", '<use href="#s1" transform="rotate(90)"/>')}</defs><use href="#s2" transform="translate(50 50)"/>`).bbox).toEqual({
      x: 40,
      y: 50,
      width: 10,
      height: 10,
    });
    const counts = summary(`<defs>${symbol("s1", `${RECT}<text x="0" y="0"><tspan x="0" dy="0">a</tspan></text>`)}</defs><use href="#s1"/><use href="#s1"/>`).counts;
    expect([counts.shapes, counts.texts]).toEqual([1, 1]);
  });

  it("il contenuto di un simbolo non si confronta col fondo, e un'istanza copre come un'immagine", () => {
    const codes = (body: string): string[] => findings(load(doc(body))).map((d) => d.code);
    const WHITE = (x: number, y: number, size = 16): string => `<text x="${x}" y="${y}" font-size="${size}" fill="#ffffff"><tspan x="${x}" dy="0">Luce</tspan></text>`;
    // Un testo bianco sul bianco della carta: S009.
    expect(codes(WHITE(10, 10))).toEqual(["S009"]);
    // Nel simbolo no, ma un testo troppo piccolo resta.
    expect(codes(`<defs>${symbol("s1", WHITE(10, 10))}</defs>`)).toEqual([]);
    expect(codes(`<defs>${symbol("s1", WHITE(10, 10, 6))}</defs>`)).toEqual(["S013"]);
    // Sopra un'istanza il fondo non si sa; accanto sì.
    const icon = `<defs>${symbol("s1", '<rect width="40" height="40" fill="#0072b2"/>')}</defs><use href="#s1" transform="translate(0 0)"/>`;
    expect(codes(`${icon}${WHITE(10, 20)}`)).toEqual([]);
    expect(codes(`${icon}${WHITE(60, 20)}`)).toEqual(["S009"]);
    // Un'istanza dopo il testo non gli sta sotto.
    expect(codes(`<defs>${symbol("s1", '<rect width="40" height="40" fill="#0072b2"/>')}</defs>${WHITE(10, 20)}<use href="#s1"/>`)).toEqual(["S009"]);
  });
});

describe("le ripetizioni", () => {
  const RECT = (id: string, more = ""): string => `<rect id="${id}" width="10" height="10" fill="#000000"${more}/>`;

  it("una ripetizione è un gruppo con fub:repeat, e le sue copie sono use verso un originale fratello", () => {
    const scene = load(doc(`<g fub:repeat="radial 4 50 50"><use href="#o1" transform="rotate(270 50 50)"/>${RECT("o1")}<use id="c1" xlink:href="#o1" transform="rotate(90 50 50)"><title>Copia</title></use></g>`));
    expect(role(scene, [0])).toBe("group");
    expect(at(scene, [0])!.repeat).toEqual({ kind: "radial", count: 4, center: [50, 50] });
    expect(role(scene, [0, 0])).toBe("copy");
    expect(role(scene, [0, 1])).toBe("rect");
    expect(role(scene, [0, 2])).toBe("copy");
    expect(at(scene, [0, 0])!.original).toBe("o1");
    expect(at(scene, [0, 2])!.original).toBe("o1");
    expect(at(scene, [0, 1])!.original).toBeUndefined();
    // Un'istanza di un simbolo può essere l'originale.
    const instance = load(doc(`<defs><symbol id="s1" overflow="visible">${RECT("r1")}</symbol></defs><g fub:repeat="grid 2 1 20 0"><use id="o1" href="#s1"/><use href="#o1" transform="translate(20 0)"/></g>`));
    expect(role(instance, [1, 0])).toBe("instance");
    expect(role(instance, [1, 1])).toBe("copy");
    expect(at(instance, [1])!.repeat).toEqual({ kind: "grid", columns: 2, rows: 1, step: [20, 0] });
  });

  it("una copia ha soltanto id, transform e un href, e per figli titoli e descrizioni", () => {
    const copy = (use: string): Role | null => role(load(doc(`<g fub:repeat="mirror 20 0 20 10">${RECT("o1")}${use}</g>`)), [0, 1]);
    for (const use of [
      '<use href="#o1"/>',
      '<use xlink:href="#o1"/>',
      '<use id="c1" href="#o1" transform="matrix(-1 0 0 1 40 0)"/>',
      '<use href="#o1" fub:nota="x">\n  <desc>Riflessa</desc>\n</use>',
    ]) {
      expect(copy(use), use).toBe("copy");
    }
    for (const use of [
      "<use/>",
      '<use href="#o1" opacity="0.5"/>',
      '<use href="#o1" display="none"/>',
      '<use href="#o1" fill="#ff0000"/>',
      '<use href="#o1" style="opacity: 0.5"/>',
      '<use href="#o1" x="10"/>',
      '<use href="#o1" xlink:href="#o1"/>',
      '<use href="#o1" transform="scale(2"/>',
      '<use href="#o9"/>',
      '<use href="o1"/>',
      `<use href="#o1">${RECT("r2")}</use>`,
    ]) {
      expect(copy(use), use).toBeNull();
    }
  });

  it("senza una ripetizione valida, o verso chi non è un originale fratello, un use resta estraneo", () => {
    const roles = (body: string, path: number[]): Role | null => role(load(doc(body)), path);
    const COPY = '<use href="#o1" transform="translate(20 0)"/>';
    expect(roles(`<g>${RECT("o1")}${COPY}</g>`, [0, 1])).toBeNull();
    expect(roles(`<g fub:repeat="radial 1 0 0">${RECT("o1")}${COPY}</g>`, [0, 1])).toBeNull();
    expect(at(load(doc(`<g fub:repeat="radial 1 0 0">${RECT("o1")}</g>`)), [0])!.repeat).toBeUndefined();
    expect(roles(`<g fub:layer="Sfondo" fub:repeat="grid 2 1 20 0">${RECT("o1")}${COPY}</g>`, [0])).toBe("layer");
    expect(roles(`<g fub:layer="Sfondo" fub:repeat="grid 2 1 20 0">${RECT("o1")}${COPY}</g>`, [0, 1])).toBeNull();
    expect(roles(`<a href="nota.md" fub:repeat="grid 2 1 20 0">${RECT("o1")}${COPY}</a>`, [0, 1])).toBeNull();
    // Un cugino non è un originale, né una copia, un titolo o un estraneo.
    expect(roles(`<g fub:repeat="grid 2 1 20 0"><g>${RECT("o1")}</g>${COPY}</g>`, [0, 1])).toBeNull();
    expect(roles(`${RECT("o1")}<g fub:repeat="grid 2 1 20 0">${COPY}</g>`, [1, 0])).toBeNull();
    expect(roles(`<g fub:repeat="grid 3 1 20 0">${RECT("o1")}<use id="c1" href="#o1"/><use href="#c1"/></g>`, [0, 2])).toBeNull();
    expect(roles(`<g fub:repeat="grid 2 1 20 0"><title id="o1">Fila</title>${COPY}</g>`, [0, 1])).toBeNull();
    expect(roles(`<g fub:repeat="grid 2 1 20 0"><switch id="o1"/>${COPY}</g>`, [0, 1])).toBeNull();
    expect(roles(`<g fub:repeat="grid 2 1 20 0"><use id="o1" href="#o1"/></g>`, [0, 0])).toBeNull();
    // Dentro un originale, una ripetizione ha i suoi originali e non vede
    // quelli di fuori.
    const nested = load(doc(`<g fub:repeat="radial 2 0 0"><g id="o1"><g fub:repeat="grid 2 1 10 0">${RECT("o2")}<use href="#o2" transform="translate(10 0)"/><use href="#o1"/></g></g><use href="#o1" transform="rotate(180)"/></g>`));
    expect(role(nested, [0, 0, 0, 1])).toBe("copy");
    expect(role(nested, [0, 0, 0, 2])).toBeNull();
    expect(role(nested, [0, 1])).toBe("copy");
  });

  it("una copia non si conta, e il riquadro del disegno comprende le copie", () => {
    const summary = (body: string): Summary => load(doc(body)).summary;
    const row = summary(`<g fub:repeat="grid 3 1 20 0">${RECT("o1")}<use href="#o1" transform="translate(20 0)"/><use href="#o1" transform="translate(40 0)"/></g>`);
    expect(row.bbox).toEqual({ x: 0, y: 0, width: 50, height: 10 });
    expect(row.counts.shapes).toBe(1);
    // Le copie stanno nelle coordinate del gruppo.
    expect(summary(`<g transform="translate(100 0)" fub:repeat="mirror 20 0 20 10">${RECT("o1")}<use href="#o1" transform="matrix(-1 0 0 1 40 0)"/></g>`).bbox).toEqual({ x: 100, y: 0, width: 40, height: 10 });
    expect(summary(`<g transform="rotate(90)" fub:repeat="grid 2 1 20 0">${RECT("o1")}<use href="#o1" transform="translate(20 0)"/></g>`).bbox).toEqual({ x: -10, y: 0, width: 10, height: 30 });
    // L'originale si sposta e le copie lo seguono; un originale nascosto
    // nasconde le copie.
    expect(summary(`<g fub:repeat="grid 2 1 20 0">${RECT("o1", ' x="5" transform="translate(0 5)"')}<use href="#o1" transform="translate(20 0)"/></g>`).bbox).toEqual({ x: 5, y: 5, width: 30, height: 10 });
    expect(summary(`<g fub:repeat="grid 2 1 20 0">${RECT("o1", ' display="none"')}<use href="#o1" transform="translate(20 0)"/></g>`).bbox).toBeNull();
    // Un'istanza come originale, e una ripetizione dentro un simbolo.
    expect(summary(`<defs><symbol id="s1" overflow="visible">${RECT("r1")}</symbol></defs><g fub:repeat="grid 2 1 20 0"><use id="o1" href="#s1" transform="translate(0 30)"/><use href="#o1" transform="translate(20 0)"/></g>`).bbox).toEqual({
      x: 0,
      y: 30,
      width: 30,
      height: 10,
    });
    expect(summary(`<defs><symbol id="s1" overflow="visible"><g fub:repeat="grid 1 2 0 20">${RECT("o1")}<use href="#o1" transform="translate(0 20)"/></g></symbol></defs><use href="#s1" transform="translate(50 0)"/>`).bbox).toEqual({
      x: 50,
      y: 0,
      width: 10,
      height: 30,
    });
    // Una ripetizione dentro un originale: le copie di fuori portano anche
    // quelle di dentro.
    expect(summary(`<g fub:repeat="grid 1 2 0 50"><g id="o1"><g fub:repeat="grid 2 1 20 0">${RECT("o2")}<use href="#o2" transform="translate(20 0)"/></g></g><use href="#o1" transform="translate(0 50)"/></g>`).bbox).toEqual({
      x: 0,
      y: 0,
      width: 30,
      height: 60,
    });
  });

  it("sopra una copia il fondo non si sa, come sopra un'istanza", () => {
    const codes = (body: string): string[] => findings(load(doc(body))).map((d) => d.code);
    const WHITE = (x: number, y: number): string => `<text x="${x}" y="${y}" font-size="16" fill="#ffffff"><tspan x="${x}" dy="0">Luce</tspan></text>`;
    const row = `<g fub:repeat="grid 2 1 100 0"><rect id="o1" width="40" height="40" fill="#0072b2"/><use href="#o1" transform="translate(100 0)"/></g>`;
    expect(codes(`${row}${WHITE(110, 20)}`)).toEqual([]);
    expect(codes(`${row}${WHITE(60, 20)}`)).toEqual(["S009"]);
  });
});

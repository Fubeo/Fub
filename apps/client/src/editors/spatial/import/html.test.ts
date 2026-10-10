import { describe, expect, it } from "vitest";
import { Notes, type Run, type Type } from "./diagram";
import { attributesOf, cssSize, declarationsOf, decodeEntities, htmlParagraphs } from "./html";

const BASE: Type = { family: "Inter", size: 12, color: "#000000", bold: false, italic: false, underline: false, strike: false };

/// I paragrafi e le righe di `html`, con le note che lascia.
function read(html: string): { paragraphs: Run[][]; rules: ReturnType<typeof htmlParagraphs>["rules"]; notes: ReturnType<Notes["list"]> } {
  const notes = new Notes();
  const { paragraphs, rules } = htmlParagraphs(html, BASE, (name) => `F:${name}`, notes);
  return { paragraphs, rules, notes: notes.list() };
}

/// Il testo di ogni paragrafo.
const texts = (paragraphs: readonly (readonly Run[])[]): string[] => paragraphs.map((runs) => runs.map((run) => run.text).join(""));

describe("htmlParagraphs", () => {
  it("va a capo dove il browser va a capo, e riduce gli spazi come HTML", () => {
    const { paragraphs } = read("Uno<br>due  e \n  tre<div>quattro</div><div><br></div><p>cinque&nbsp;&nbsp;sei </p>");
    expect(texts(paragraphs)).toEqual(["Uno", "due e tre", "quattro", "", "cinque\u00a0\u00a0sei"]);
  });

  it("tiene il grassetto, il corsivo, il sottolineato, il barrato e il carattere di font", () => {
    const { paragraphs } = read('<b>g</b><i>c</i><u>s</u><s>b</s><font color="#FF0000" size="5" face="Courier New">f</font>');
    expect(paragraphs).toEqual([
      [
        { text: "g", type: { bold: true } },
        { text: "c", type: { italic: true } },
        { text: "s", type: { underline: true } },
        { text: "b", type: { strike: true } },
        { text: "f", type: { color: "#ff0000", size: 24, family: "F:Courier New" } },
      ],
    ]);
  });

  it("legge lo stile in linea, e i pezzi uguali vicini diventano uno", () => {
    const { paragraphs } = read('<span style="font-weight:bold;font-style:italic;text-decoration:underline line-through;color:rgb(255, 0, 0);font-size:9pt;font-family:Georgia">ab</span><b style="color:#f00;font-size:12px;font-style:italic;text-decoration:underline line-through;font-family:Georgia">c</b>');
    expect(paragraphs).toEqual([[{ text: "abc", type: { bold: true, italic: true, underline: true, strike: true, color: "#ff0000", size: 12, family: "F:Georgia" } }]]);
  });

  it("fa i titoli in grassetto e più grandi del testo intorno", () => {
    const { paragraphs } = read('<h1>Titolo</h1><font size="1"><h2>Sotto</h2></font>');
    expect(paragraphs).toEqual([[{ text: "Titolo", type: { bold: true, size: 24 } }], [{ text: "Sotto", type: { size: 15, bold: true } }]]);
  });

  it("scrive i punti e i numeri degli elenchi, attaccati alla prima parola", () => {
    const { paragraphs } = read('<ul><li>a</li><li>b</li></ul><ol start="3"><li>c</li><li>d</li></ol>');
    expect(texts(paragraphs)).toEqual(["•\u00a0a", "•\u00a0b", "3.\u00a0c", "4.\u00a0d"]);
  });

  it("tiene un collegamento blu e sottolineato, e lo annota", () => {
    const { paragraphs, notes } = read('vedi <a href="https://example.com/a">qui</a>');
    expect(paragraphs).toEqual([[{ text: "vedi", type: null }, { text: " qui", type: { underline: true, color: "#0000ee" } }]]);
    expect(notes).toEqual([{ kind: "link", count: 1, sample: "https://example.com/a" }]);
  });

  it("lascia fuori il testo che non si vede, coi suoi a capo", () => {
    const { paragraphs } = read('a<span style="font-size:0px">segreto</span>b<span style="display:none">x<br><b>y</b></span>c<span style="visibility: hidden">z</span>');
    expect(paragraphs).toEqual([[{ text: "abc", type: null }]]);
  });

  it("fa di una riga orizzontale una riga vuota, col colore e lo spessore che dice", () => {
    const { paragraphs, rules } = read('uno<hr>due<hr size="3" style="border-top: 2px solid #FF0000">tre<hr size="20" color="blue">');
    expect(texts(paragraphs)).toEqual(["uno", "", "due", "", "tre", ""]);
    expect(rules).toEqual([
      { paragraph: 1, color: "#808080", width: 1 },
      { paragraph: 3, color: "#ff0000", width: 3 },
      { paragraph: 5, color: "#0000ff", width: 8 },
    ]);
  });

  it("annota ciò che non entra: le immagini, gli apici, gli sfondi", () => {
    const { paragraphs, notes } = read('<img src="a.png">x<sup>2</sup><span style="background-color: #ffff00">giallo</span><span style="background-color: rgba(0, 0, 0, 0)">trasparente</span>');
    expect(texts(paragraphs)).toEqual(["x2giallotrasparente"]);
    expect(notes).toEqual([
      { kind: "html", count: 3, sample: "img" },
    ]);
  });

  it("salta i commenti e tiene un < che non apre un tag", () => {
    expect(texts(read("a < b <!-- nascosto -->c").paragraphs)).toEqual(["a < b c"]);
  });

  it("dà sempre almeno un paragrafo", () => {
    expect(read("").paragraphs).toEqual([[]]);
    expect(read("<div></div>").paragraphs).toEqual([[]]);
  });
});

describe("i pezzi dell'HTML", () => {
  it("decodeEntities risolve le entità che conosce e i numeri validi, e lascia le altre", () => {
    expect(decodeEntities("&amp;&lt;&gt;&quot;&#x2192;&#8364;&nbsp;&rarr;&ignota;&#xD800;&#0;")).toBe('&<>"→€\u00a0→&ignota;&#xD800;&#0;');
  });

  it("attributesOf legge i valori fra virgolette, fra apici, nudi o assenti", () => {
    expect([...attributesOf(` a="1 &amp; 2" B='due' c=3 d`)]).toEqual([
      ["a", "1 & 2"],
      ["b", "due"],
      ["c", "3"],
      ["d", ""],
    ]);
  });

  it("declarationsOf legge le dichiarazioni coi nomi minuscoli e senza !important", () => {
    expect([...declarationsOf("Color: Red ; font-size:12px !important;rotto")]).toEqual([
      ["color", "Red"],
      ["font-size", "12px"],
    ]);
  });

  it("cssSize porta le unità in pixel", () => {
    expect(cssSize("12px", 10)).toBe(12);
    expect(cssSize("12", 10)).toBe(12);
    expect(cssSize("9pt", 10)).toBe(12);
    expect(cssSize("1.5em", 10)).toBe(15);
    expect(cssSize("2rem", 10)).toBe(20);
    expect(cssSize("50%", 20)).toBe(10);
    expect(cssSize("grande", 10)).toBeNull();
  });
});

// La tabella delle sessanta query: «/» più due lettere deve mettere la voce
// voluta al primo posto almeno nove volte su dieci (cancello di N12).
import { describe, expect, it } from "vitest";
import { slashMenuEntries } from "./entries";
import { ALL, SPECS } from "./fixture.test-data";

const QUERIES: readonly (readonly [string, string])[] = [
  ["ti", "markdown.heading.1"], ["h1", "markdown.heading.1"], ["h2", "markdown.heading.2"], ["h3", "markdown.heading.3"],
  ["h4", "markdown.heading.4"], ["h5", "markdown.heading.5"], ["h6", "markdown.heading.6"], ["te", "markdown.paragraph"],
  ["ci", "markdown.quote"], ["qu", "markdown.quote"], ["ri", "markdown.callout"], ["ca", "markdown.callout"],
  ["av", "markdown.callout"], ["de", "markdown.details"], ["ap", "markdown.details"], ["co", "markdown.columns"],
  ["af", "markdown.columns"], ["el", "markdown.list.bullet"], ["pu", "markdown.list.bullet"], ["bu", "markdown.list.bullet"],
  ["en", "markdown.list.ordered"], ["nu", "markdown.list.ordered"], ["ol", "markdown.list.ordered"], ["ea", "markdown.list.task"],
  ["at", "markdown.list.task"], ["to", "markdown.list.task"], ["sp", "markdown.list.task"], ["ta", "markdown.table"],
  ["gr", "markdown.table"], ["se", "markdown.rule"], ["hr", "markdown.rule"], ["in", "markdown.toc"],
  ["bo", "markdown.callout"], ["ou", "markdown.toc"], ["pe", "markdown.mention"], ["me", "markdown.mention"],
  ["da", "markdown.date"], ["og", "markdown.date"], ["gi", "markdown.date"], ["sc", "markdown.date"],
  ["pa", "markdown.linkcard"], ["we", "markdown.linkcard"], ["bl", "markdown.codeblock"], ["ma", "markdown.mathblock"],
  ["la", "markdown.mathblock"], ["eq", "markdown.mathblock"], ["di", "markdown.diagram"], ["im", "markdown.image"],
  ["ur", "markdown.link"], ["li", "markdown.link"], ["no", "markdown.wikilink"], ["em", "markdown.embed"],
  ["pr", "markdown.property.add"], ["fr", "markdown.property.add"], ["ag", "markdown.property.add"], ["so", "markdown.underline"],
  ["un", "markdown.underline"], ["ar", "markdown.color.orange"], ["ve", "markdown.color.green"], ["vi", "markdown.color.purple"],
];

describe("la tabella delle sessanta query", () => {
  it("ha sessanta query di due lettere, tutte diverse", () => {
    expect(QUERIES).toHaveLength(60);
    expect(new Set(QUERIES.map(([q]) => q)).size).toBe(60);
    expect(QUERIES.every(([q]) => q.length === 2)).toBe(true);
  });

  it("almeno nove volte su dieci la voce voluta è la prima", () => {
    const misses = QUERIES.filter(([query, id]) => slashMenuEntries(SPECS, query, ALL).entries[0]?.id !== id)
      .map(([query, id]) => `/${query} → ${slashMenuEntries(SPECS, query, ALL).entries[0]?.id ?? "niente"} (voluta ${id})`);
    console.log(`prime: ${60 - misses.length}/60${misses.length ? `\n${misses.join("\n")}` : ""}`);
    expect(60 - misses.length).toBeGreaterThanOrEqual(54);
  });

  it("«/ti» dà i sei titoli e l'Indice, non lettere sparse", () => {
    const ids = slashMenuEntries(SPECS, "ti", ALL).entries.map((entry) => entry.id);
    expect(ids).toEqual([1, 2, 3, 4, 5, 6].map((n) => `markdown.heading.${n}`).concat("markdown.toc"));
  });
});

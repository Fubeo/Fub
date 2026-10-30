// Le voci del «/» come le dà `fub.formatting`, coi titoli italiani: la base
// dei test delle voci e della tabella delle sessanta query.
import type { CommandSpec } from "../../host/contract";

export const FORMATTING: readonly (readonly [string, string])[] = [
  ["markdown.paragraph", "Testo normale"],
  ["markdown.heading.1", "Titolo 1"],
  ["markdown.heading.2", "Titolo 2"],
  ["markdown.heading.3", "Titolo 3"],
  ["markdown.heading.4", "Titolo 4"],
  ["markdown.heading.5", "Titolo 5"],
  ["markdown.heading.6", "Titolo 6"],
  ["markdown.quote", "Citazione"],
  ["markdown.callout", "Riquadro"],
  ["markdown.details", "Ripiegabile"],
  ["markdown.columns", "Colonne"],
  ["markdown.list.bullet", "Elenco puntato"],
  ["markdown.list.ordered", "Elenco numerato"],
  ["markdown.list.task", "Elenco di attività"],
  ["markdown.table", "Tabella"],
  ["markdown.rule", "Linea di separazione"],
  ["markdown.toc", "Indice"],
  ["markdown.mention", "Persona"],
  ["markdown.date", "Data"],
  ["markdown.linkcard", "Pagina web"],
  ["markdown.codeblock", "Blocco di codice"],
  ["markdown.mathblock", "Blocco di formula"],
  ["markdown.diagram", "Diagramma"],
  ["markdown.image", "Immagine"],
  ["markdown.link", "Link"],
  ["markdown.wikilink", "Link a una nota"],
  ["markdown.embed", "Incorpora una nota"],
  ["markdown.footnote", "Nota a piè di pagina"],
  ["markdown.property.add", "Aggiungi proprietà"],
  ["markdown.comment", "Commento"],
  ["markdown.underline", "Sottolineato"],
  ...["default:predefinito", "gray:grigio", "brown:marrone", "orange:arancione", "yellow:giallo", "green:verde", "blue:blu", "purple:viola", "pink:rosa", "red:rosso"]
    .flatMap((pair) => {
      const [color, name] = pair.split(":") as [string, string];
      return [[`markdown.color.${color}`, `Testo ${name}`], [`markdown.background.${color}`, `Fondo ${name}`]] as const;
    }),
];

export function spec(id: string, title: string, surfaces: CommandSpec["surfaces"] = ["toolbar", "slash"]): CommandSpec {
  return {
    id, title, description: "", keybinding: null, params: [],
    scope: { writes: false, reach: "session", reversible: true }, surfaces,
  };
}

/// I colori non sono più offerti al «/»: restano pulsanti della barra.
export const SPECS: readonly CommandSpec[] = FORMATTING.map(([id, title]) =>
  spec(id, title, id.startsWith("markdown.color.") || id.startsWith("markdown.background.") ? ["toolbar"] : ["toolbar", "slash"]));

export const ALL = (id: string) => id.startsWith("markdown.");

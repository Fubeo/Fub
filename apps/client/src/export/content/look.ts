// I link e le tabelle delle pagine (E28, T74; il prototipo
// `.px-doc[data-links]`, `.px-doc[data-tab]`, passo 29).
//
// Cambiano solo l'aspetto, come i colori: variabili CSS sulle pagine e sulla
// resa che si misura, nessuna nuova impaginazione (la seconda velocità di
// `paginate/slices.ts`). Le regole che le leggono stanno nella pelle
// (`skin/export.css`), coi valori della Lettura quando la variabile manca.
//
// - Link colorati: il colore dei link del tema di stampa, senza filo;
//   sottolineati: lo stesso colore col filo pieno; come il testo: il colore
//   del testo intorno, senza filo (il link resta cliccabile nel PDF).
// - Tabelle a linee: solo i fili fra le righe; a righe alterne: niente fili,
//   una riga sì e una no col fondo delle intestazioni schiarito; a griglia:
//   ogni cella col suo filo. I fili restano larghi uguali in tutti e tre
//   (cambia il colore, trasparente o no): le misure non cambiano.

import type { ContentChoices } from "./choices";

export function contentLookVariables(choices: Pick<ContentChoices, "links" | "tables">): Record<string, string> {
  const vars: Record<string, string> = {
    "--print-link-color": choices.links === "come-il-testo" ? "currentColor" : "var(--doc-link)",
    "--print-link-line": choices.links === "sottolineati" ? "underline" : "none",
  };
  const grid = choices.tables === "griglia";
  const stripes = choices.tables === "righe-alterne";
  vars["--print-table-vrule"] = grid ? "var(--doc-rule-soft)" : "transparent";
  vars["--print-table-frame"] = grid ? "var(--doc-rule)" : "transparent";
  vars["--print-table-hrule"] = stripes ? "transparent" : "var(--doc-rule-soft)";
  vars["--print-table-end"] = stripes ? "transparent" : "var(--doc-rule)";
  vars["--print-table-stripe"] = stripes ? "color-mix(in srgb, var(--print-table-head) 55%, var(--doc-bg))" : "transparent";
  return vars;
}

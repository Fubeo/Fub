/** L'anatomia del pezzo `skin/search.css`. La ricerca nel cassetto. */
import { INTERACTIVE, S, SELECTABLE, type PartAnatomy } from "./types";

export const SEARCH: PartAnatomy = {
  part: "search",
  components: [
    { name: "search-field", states: [S("rest"), S("focused")], hooks: ["search-input"] },
    {
      name: "search",
      states: SELECTABLE,
      hooks: [
        "search-results",
        "search-result",
        "hit-title",
        "hit-path",
        "hit-snippet",
        "hit-context",
        "hit-occurrence",
        "hit-create",
      ],
    },
    // Le linguette: strumenti in testa, «Escludi» sul risultato, esclusioni accese.
    {
      name: "search-actions",
      states: [...INTERACTIVE, S("selected")],
      hooks: ["search-action", "search-tools", "search-syntax", "search-exclusions", "search-chip"],
    },
    // Sotto il campo, dietro «Opzioni»: le quattro opzioni (interruttori),
    // «Sostituisci» e «Salva ricerca»; e, aperta, la sostituzione con il suo
    // piano. `sidebar` è del cassetto: qui dice soltanto che campo, opzioni e
    // sostituzione stanno nel pannello Cerca e non sopra l'albero.
    {
      name: "search-options",
      states: [...INTERACTIVE, S("selected")],
      hooks: ["search-options", "search-options-group", "search-option", "sidebar"],
    },
    {
      name: "search-replace",
      states: [S("rest")],
      hooks: [
        "search-replace",
        "search-replace-entry",
        "search-replace-plan",
        "search-replace-note",
        "search-replace-docs",
        "search-replace-actions",
        "search-replace-apply",
      ],
    },
  ],
};

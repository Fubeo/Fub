/** L'anatomia del pezzo `skin/launcher.css`. Il lanciatore e i dialoghi. */
import { INTERACTIVE, REST, S, SELECTABLE, type PartAnatomy } from "./types";

export const LAUNCHER: PartAnatomy = {
  part: "launcher",
  components: [
    // Il velo e la scatola: lanciatore se ha un campo in testa, dialogo se no.
    { name: "modal-surface", states: REST, hooks: ["modale", "palette-box", "palette-heading"] },
    { name: "launcher-field", states: [S("rest"), S("focused")], hooks: ["palette-input"] },
    // Gli esiti: la riga scelta la dice `aria-selected`, il puntatore ha la sua.
    { name: "launcher-rows", states: SELECTABLE, hooks: ["palette-list", "palette-row", "palette-title", "palette-desc", "palette-scope", "palette-favorite", "palette-empty", "hit-occurrence", "docsearch-summary"] },
    { name: "command-form", states: [S("rest"), S("hover"), S("focused"), S("disabled")], hooks: ["palette-form", "palette-label", "palette-help", "palette-path"] },
    // «Esporta…»: gli interruttori del formato e, a cose fatte, ciò che non è passato.
    { name: "export-form", states: [S("rest"), S("focused")], hooks: ["vault-export-options", "vault-export-option", "vault-export-result", "vault-export-summary", "vault-export-notes", "vault-export-note"] },
    // «Importa note…»: la sorgente, poi il piano e l'esito con ciò che non passa.
    { name: "import-form", states: [S("rest"), S("focused")], hooks: ["note-import-fields", "note-import-file", "note-import-file-name", "note-import-status", "note-import-plan", "note-import-plan-title", "note-import-tally", "note-import-docs", "note-import-doc", "note-import-more", "note-import-losses", "note-import-loss"] },
    { name: "command-plan", states: REST, hooks: ["palette-summary", "palette-plan", "palette-error"] },
    { name: "dialog-actions", states: INTERACTIVE, hooks: ["palette-actions", "primary", "danger"] },
    { name: "compare", states: REST, hooks: ["compare-box", "compare-lines", "compare-line"] },
    // Il lanciatore unificato (`shells/scrittoio/launcher/`): velo e superficie,
    // testa col campo, fila dei modi, esiti, frase del vuoto, anteprima della
    // nota attiva, piede col controllo che porta la domanda nel pannello Cerca.
    { name: "unified-surface", states: REST, hooks: ["launcher-veil", "launcher"] },
    { name: "unified-head", states: [S("rest"), S("focused")], hooks: ["launcher-head", "launcher-lens", "launcher-input", "launcher-wait"] },
    { name: "unified-modes", states: REST, hooks: ["launcher-modes", "launcher-mode-prefix"] },
    { name: "unified-rows", states: REST, hooks: ["launcher-list", "launcher-row", "launcher-row-title", "launcher-row-detail", "launcher-row-meta", "launcher-note"] },
    { name: "unified-preview", states: REST, hooks: ["launcher-preview", "launcher-preview-page", "launcher-preview-note"] },
    { name: "unified-foot", states: REST, hooks: ["launcher-foot", "launcher-status", "launcher-hints", "launcher-hint", "launcher-key"] },
    { name: "unified-panel", states: INTERACTIVE, hooks: ["launcher-panel"] },
  ],
};

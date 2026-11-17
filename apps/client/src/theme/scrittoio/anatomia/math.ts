/** L'anatomia del pezzo `skin/math.css`. La formula che si modifica toccandola (T60): il riquadro sotto la formula in riga, il blocco `$$` sul posto, il cursore e gli spazi vuoti dentro la formula, il LaTeX a vista di una formula con un errore; le proposte dei simboli dopo la barra rovesciata (T61); la tavolozza coi pezzi più usati, i gruppi e la ricerca a parole (T62). */
import { S, type PartAnatomy } from "./types";

export const MATH: PartAnatomy = {
  part: "math",
  layer: "cornice",
  components: [
    { name: "math-popover", states: [S("rest"), S("focused")], hooks: ["kit-popover", "cm-fub-mx-popover"] },
    { name: "math-editor", layers: { "cm-editor": "contenuto", "cm-content": "contenuto", "katex-display": "contenuto", "cm-fub-mx-caret": "segno", "cm-fub-math-on": "segno", "cm-fub-math": "segno" }, states: [S("rest"), S("focused")], hooks: ["cm-editor", "cm-content", "cm-fub-mx", "cm-fub-mx-surface", "cm-fub-mx-caret", "cm-fub-mx-placeholder", "cm-fub-mx-input", "cm-fub-mx-latex", "cm-fub-mx-note", "cm-fub-mx-block", "cm-fub-math-on", "cm-fub-math", "katex", "katex-display", "text", "mord"] },
    { name: "math-symbols", states: [S("rest"), S("selected")], hooks: ["cm-fub-mx-symbols", "cm-fub-mx-symbol", "cm-fub-mx-symbol-glyph", "cm-fub-mx-symbol-name"] },
    { name: "math-palette", states: [S("rest"), S("hover"), S("pressed"), S("selected"), S("focused")], hooks: ["cm-fub-mx-palette", "cm-fub-mx-quick", "cm-fub-mx-tile", "cm-fub-mx-all", "cm-fub-mx-all-icon", "cm-fub-mx-full", "cm-fub-mx-find", "cm-fub-mx-find-icon", "cm-fub-mx-find-input", "cm-fub-mx-groups", "cm-fub-mx-group", "cm-fub-mx-searching", "cm-fub-mx-grid", "cm-fub-mx-none", "cm-fub-mx-tip", "cm-fub-mx-tip-name"] },
  ],
};

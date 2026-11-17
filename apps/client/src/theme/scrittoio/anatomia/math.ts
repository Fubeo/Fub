/** L'anatomia del pezzo `skin/math.css`. La formula che si modifica toccandola (T60): il riquadro sotto la formula in riga, il blocco `$$` sul posto, il cursore e gli spazi vuoti dentro la formula, il LaTeX a vista di una formula con un errore; le proposte dei simboli dopo la barra rovesciata (T61). */
import { S, type PartAnatomy } from "./types";

export const MATH: PartAnatomy = {
  part: "math",
  layer: "cornice",
  components: [
    { name: "math-popover", states: [S("rest"), S("focused")], hooks: ["kit-popover", "cm-fub-mx-popover"] },
    { name: "math-editor", layers: { "cm-editor": "contenuto", "cm-content": "contenuto", "katex-display": "contenuto", "cm-fub-mx-caret": "segno", "cm-fub-math-on": "segno", "cm-fub-math": "segno" }, states: [S("rest"), S("focused")], hooks: ["cm-editor", "cm-content", "cm-fub-mx", "cm-fub-mx-surface", "cm-fub-mx-caret", "cm-fub-mx-placeholder", "cm-fub-mx-input", "cm-fub-mx-latex", "cm-fub-mx-note", "cm-fub-mx-block", "cm-fub-math-on", "cm-fub-math", "katex", "katex-display", "text", "mord"] },
    { name: "math-symbols", states: [S("rest"), S("selected")], hooks: ["cm-fub-mx-symbols", "cm-fub-mx-symbol", "cm-fub-mx-symbol-glyph", "cm-fub-mx-symbol-name"] },
  ],
};

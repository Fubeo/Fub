// I testi della famiglia «nucleo» del Disegno completo (piano K6): le chiavi
// delle sue finestre, sezioni e strumenti che l'indice generato non porta.
// `strumento:<id>` è il nome corto di uno strumento nella colonna e nel
// cassetto (l'indice porta il nome lungo, «Strumento Selezione»); le opzioni
// degli strumenti del nucleo sono solo forma (`meshPoints`) e non hanno testo.
// Selezione, Mano e Zoom stanno nella stessa casella di quelli di Fub, che si
// chiamano uguale: «(Completo)» li distingue nella tendina.

export const TESTI: Readonly<Record<string, { readonly it: string; readonly en: string }>> = {
  "strumento:selection": { it: "Selezione (Completo)", en: "Selection (Full)" },
  "strumento:directSelection": { it: "Selezione diretta", en: "Direct Selection" },
  "strumento:groupSelection": { it: "Selezione gruppo", en: "Group Selection" },
  "strumento:lasso": { it: "Lazo", en: "Lasso" },
  "strumento:hand": { it: "Mano (Completo)", en: "Hand (Full)" },
  "strumento:zoom": { it: "Zoom (Completo)", en: "Zoom (Full)" },
  "strumento:rotateView": { it: "Ruota vista", en: "Rotate View" },
};

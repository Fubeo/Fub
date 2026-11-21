// Le stringhe del Disegno completo che stanno fuori dal motore: la scheda
// Risorse dell'ispettore e le sue sezioni (piano K6, T10). I nomi delle
// funzioni del motore vengono dal catalogo della famiglia (`testi.ts`), mai
// da qui. La radice `../strings.ts` le ricompone nel catalogo del disegno.

/// L'italiano di quest'area, che è anche la forma dell'inglese.
export const COMPLETO_IT = {
  "draw.chrome.tab.resources": "Risorse",
  "draw.resources.aria": "Risorse",
  "draw.resources.swatches": "Campioni",
  "draw.resources.swatches.document": "Documento",
  "draw.resources.swatches.none": "Il disegno non ha campioni.",
  "draw.resources.count": "{count} campioni",
  "draw.resources.failed": "Questa parte non si è aperta. «Riprova» la carica di nuovo.",
  "draw.resources.retry": "Riprova",
} as const;

export const COMPLETO_EN: Record<keyof typeof COMPLETO_IT, string> = {
  "draw.chrome.tab.resources": "Resources",
  "draw.resources.aria": "Resources",
  "draw.resources.swatches": "Swatches",
  "draw.resources.swatches.document": "Document",
  "draw.resources.swatches.none": "The drawing has no swatches.",
  "draw.resources.count": "{count} swatches",
  "draw.resources.failed": "This part did not open. Try again to load it.",
  "draw.resources.retry": "Try again",
};

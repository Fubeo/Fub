// Le stringhe del disegno che le finestre dei comandi mostrano da sole: il
// caricamento di una funzione, l'errore che lo dice, la riga dell'anteprima e
// i pulsanti. Le finestre stanno in `motore/finestre.ts`; i nomi dei comandi e
// dei campi arrivano da chi le apre, col suo catalogo.
// La radice `../strings.ts` le ricompone nel catalogo del disegno.

/// L'italiano di quest'area, che è anche la forma dell'inglese.
export const COMPLETO_IT = {
  "draw.window.loading": "Sto preparando questa funzione: la prima volta ci vuole un momento.",
  "draw.window.failed": "Non riesco a preparare questa funzione. Riprova.",
  "draw.window.nomemory": "Non riesco a preparare questa funzione: la memoria dei motori è piena. Chiudi un disegno o un foglio che non usi e riprova.",
  "draw.window.refused": "Il disegno non accetta questo comando adesso.",
  "draw.window.unanswered": "Il disegno non ha risposto. Riprova.",
  "draw.window.retry": "Riprova",
  "draw.window.cancel": "Annulla",
  "draw.window.ok": "OK",
  "draw.window.preview": "Anteprima",
  "draw.window.blank": "Scrivi qualcosa: i soli spazi non bastano.",
  "draw.window.range": "Scrivi un numero fra {min} e {max}.",
  "draw.window.range.min": "Scrivi un numero di almeno {min}.",
  "draw.window.range.max": "Scrivi un numero fino a {max}.",
} as const;

/// L'inglese, completo come l'italiano.
export const COMPLETO_EN: Record<keyof typeof COMPLETO_IT, string> = {
  "draw.window.loading": "Preparing this function: the first time takes a moment.",
  "draw.window.failed": "I can’t prepare this function. Try again.",
  "draw.window.nomemory": "I can’t prepare this function: the engine memory is full. Close a drawing or a sheet you don’t use and try again.",
  "draw.window.refused": "The drawing doesn’t accept this command right now.",
  "draw.window.unanswered": "The drawing didn’t answer. Try again.",
  "draw.window.retry": "Try again",
  "draw.window.cancel": "Cancel",
  "draw.window.ok": "OK",
  "draw.window.preview": "Preview",
  "draw.window.blank": "Type something: spaces alone aren’t enough.",
  "draw.window.range": "Type a number between {min} and {max}.",
  "draw.window.range.min": "Type a number of at least {min}.",
  "draw.window.range.max": "Type a number up to {max}.",
};

/// La scheda Risorse dell'ispettore (K6 T10): il suo titolo, i campioni del
/// documento e le sue parole di errore. I testi delle sezioni che le famiglie
/// portano stanno nelle famiglie.
export const RISORSE_IT = {
  "draw.chrome.tab.resources": "Risorse",
  "draw.resources.aria": "Risorse",
  "draw.resources.swatches": "Campioni",
  "draw.resources.swatches.document": "Documento",
  "draw.resources.swatches.none": "Il disegno non ha campioni.",
  "draw.resources.count": "{count} campioni",
  "draw.resources.failed": "Questa parte non si è aperta. «Riprova» la carica di nuovo.",
  "draw.resources.retry": "Riprova",
} as const;

/// L'inglese della scheda Risorse.
export const RISORSE_EN: Record<keyof typeof RISORSE_IT, string> = {
  "draw.chrome.tab.resources": "Resources",
  "draw.resources.aria": "Resources",
  "draw.resources.swatches": "Swatches",
  "draw.resources.swatches.document": "Document",
  "draw.resources.swatches.none": "The drawing has no swatches.",
  "draw.resources.count": "{count} swatches",
  "draw.resources.failed": "This part did not open. Try again to load it.",
  "draw.resources.retry": "Try again",
};

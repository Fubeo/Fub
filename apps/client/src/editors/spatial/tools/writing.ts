// Scrittura per il testo dei disegni, come pezzo pigro: il campo a righe e
// ProseMirror non arrivano col disegno, ma subito dopo il montaggio, mentre
// chi disegna non scrive ancora. Se non arrivano, il campo lo dice e il testo
// resta com'è.

type Writing = typeof import("../../../scrittura/profiles/line-writer");

let loaded: Writing | null = null;
let loading: Promise<Writing> | null = null;

/// Il campo a righe, quando è arrivato.
export function writingLoaded(): Writing | null {
  return loaded;
}

/// Carica il campo a righe, una volta; dopo un errore si riprova.
export function loadWriting(): Promise<Writing> {
  loading ??= import("../../../scrittura/profiles/line-writer").then(
    (module) => (loaded = module),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

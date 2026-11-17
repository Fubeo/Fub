// I caratteri del tema caricati prima del primo uso, a riposo.
//
// Le `@font-face` della serie (`scrittoio/fonts.css`) e quelle dei temi
// (`loader.ts`) hanno `font-display: swap` e si caricano al primo testo che le
// usa. Molte le usa per primo un menu o il lanciatore (il Plex Mono degli
// accordi e dei prefissi): la faccia arriva nel fotogramma in cui la superficie
// si apre e la WebView ricalcola lo stile di tutta la pagina, 10–30 ms in più
// sulla prima apertura. Qui le facce ancora da caricare si caricano una alla
// volta, ciascuna nel suo passo di riscaldamento (`ui/warmup.ts`): il
// ricalcolo resta, ma cade dove nessuno sta aspettando.
//
// Il caricamento non cambia ciò che si vede: una faccia che nessun testo usa
// non ridisegna niente, e una che il testo usa sarebbe arrivata comunque.

/// Ciò che serve di un `FontFaceSet`: le facce e il loro stato.
export type FontFaces = Iterable<Pick<FontFace, "status" | "load">>;

/// Carica, un passo alla volta, le facce ancora da caricare. Un errore di una
/// faccia (un file che non c'è più) non ferma le altre.
export async function warmFonts(next: () => Promise<void>, faces: FontFaces = document.fonts): Promise<void> {
  for (const face of [...faces]) {
    if (face.status !== "unloaded") continue;
    await next();
    if (face.status !== "unloaded") continue;
    await face.load().catch(() => undefined);
  }
}

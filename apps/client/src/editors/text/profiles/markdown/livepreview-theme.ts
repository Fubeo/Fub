// La scrittura «Live»: il tema di base delle decorazioni.
import { EditorView } from "@codemirror/view";

// Il tema del modulo: solo classi cm-fub-*, dentro l'estensione, e solo la
// forma. I colori sono della pelle (`theme/scrittoio/skin/document.css` ed
// `editors.css`), con gli stessi ruoli della Lettura: una copia qui vorrebbe
// dire che passare da Live a Lettura cambia i colori della stessa nota, e che
// un tema non può vestire la Live (issue #242).
export const theme = EditorView.baseTheme({
  ".cm-markdown-gap": { height: "0", lineHeight: "0", fontSize: "0", padding: "0" },
  // La stessa scala della Lettura (`preview.css`): relativa al corpo, e
  // sempre in discesa, in misura e in peso. Le misure che leggono la scala
  // del tema (`--text-3xl`, `--text-2xl`, `--tracking-caps`,
  // `--leading-tight`) sono della pelle (`document.css`).
  ".cm-fub-h1": { fontWeight: "700", letterSpacing: "-0.01em" },
  ".cm-fub-h2": { fontWeight: "700", letterSpacing: "-0.005em" },
  ".cm-fub-h3": { fontSize: "1.22em", fontWeight: "650" },
  ".cm-fub-h4": { fontSize: "1.08em", fontWeight: "650" },
  ".cm-fub-h5": { fontSize: "0.85em", fontWeight: "700", textTransform: "uppercase" },
  ".cm-fub-h6": { fontSize: "0.85em", fontWeight: "500", textTransform: "uppercase" },
  ".cm-fub-heading-line": { paddingTop: "0.9em", paddingBottom: "0.2em" },
  ".cm-fub-h1-line": { paddingTop: "1.2em", paddingBottom: "0.3em", marginBottom: "0.4em" },
  ".cm-fub-h2-line": { paddingTop: "1.1em" },
  ".cm-line:first-child.cm-fub-heading-line": { paddingTop: "0" },
  ".cm-fub-h1 > span, .cm-fub-h2 > span, .cm-fub-h3 > span, .cm-fub-h4 > span, .cm-fub-h5 > span, .cm-fub-h6 > span": {
    color: "inherit",
  },
  ".cm-fub-strong": { fontWeight: "700" },
  ".cm-fub-em": { fontStyle: "italic" },
  ".cm-fub-strike": { textDecoration: "line-through" },
  ".cm-fub-sup": { verticalAlign: "super", fontSize: "0.75em", lineHeight: "0" },
  ".cm-fub-sub": { verticalAlign: "sub", fontSize: "0.75em", lineHeight: "0" },
  ".cm-fub-nobreak": { whiteSpace: "nowrap" },
  // I colori della nota e del segno rivelato sono della pelle (`document.css`).
  ".cm-fub-footnote-label": { fontWeight: "600" },
  ".cm-fub-footnote-back": { marginInline: "0.25em 0.5em", cursor: "pointer" },
  // Il segno resta nel testo, trasparente: il pallino gli sta sopra, largo
  // quanto lui.
  ".cm-fub-bullet, .cm-fub-bullet *": { color: "transparent" },
  ".cm-fub-bullet": { position: "relative" },
  ".cm-fub-bullet::before": {
    content: '"•"',
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
  },
  ".cm-fub-bullet-task::before": { content: "none" },
  // Il carattere del codice è della pelle (`document.css`).
  ".cm-fub-code": {
    borderRadius: "3px",
    padding: "0 0.15em",
  },
  ".cm-fub-quote": { paddingLeft: "0.6em" },
  ".cm-fub-quote-mark": { color: "rgba(135, 135, 135, 0.8)" },
  // La pastiglia di un collegamento: piccola, dopo il testo, non è testo.
  ".cm-fub-link-pill": {
    display: "inline-block",
    marginLeft: "0.3em",
    padding: "0 0.45em",
    borderRadius: "999px",
    fontSize: "0.75em",
    lineHeight: "1.5",
    verticalAlign: "0.1em",
    // Colore e fondo sono della pelle (`document.css`).
    cursor: "pointer",
    userSelect: "none",
    whiteSpace: "nowrap",
  },
  ".cm-fub-hr": {
    display: "inline-block",
    width: "100%",
    verticalAlign: "middle",
  },
  ".cm-fub-link, .cm-fub-wikilink": {
    cursor: "pointer",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  // L'icona della pagina nominata, fuori dal testo: il cursore non la vede.
  ".cm-fub-wikilink[data-page-icon]::before": {
    content: "attr(data-page-icon)",
    marginInlineEnd: "0.2em",
    display: "inline-block",
    textDecoration: "none",
  },
  ".cm-fub-tag": {
    borderRadius: "1em",
    padding: "0 0.45em",
    fontSize: "0.95em",
    cursor: "pointer",
  },
  ".cm-fub-done": { textDecoration: "line-through", opacity: "0.55" },
  ".cm-fub-checkbox": {
    cursor: "pointer",
    verticalAlign: "middle",
    margin: "0 0.4em 0 0",
  },
  // Un'immagine in mezzo al testo sta nella riga, con un tetto: una foto
  // grande si guarda in Lettura o a tutta finestra. Senza dimensioni scritte
  // (`alt|120`) i due tetti conservano le proporzioni.
  ".cm-fub-image": { position: "relative", display: "inline-block", maxWidth: "100%", verticalAlign: "bottom" },
  // La maniglia della larghezza, sul bordo destro dell'immagine selezionata;
  // i colori sono della pelle (`document.css`).
  ".cm-fub-image-handle": {
    display: "none",
    position: "absolute",
    right: "-5px",
    top: "50%",
    width: "10px",
    height: "28px",
    marginTop: "-14px",
    boxSizing: "border-box",
    cursor: "ew-resize",
    touchAction: "none",
  },
  ".cm-fub-image.cm-fub-image-selected .cm-fub-image-handle": { display: "block" },
  ".cm-fub-image-size": { position: "absolute", top: "4px", right: "4px", pointerEvents: "none" },
  ".cm-fub-image figure": { margin: "0" },
  // Da sola nel paragrafo l'immagine ha più spazio: è il contenuto, non una
  // parola del testo.
  ".cm-fub-image figure img": { maxHeight: "32em" },
  ".cm-fub-image figcaption": { textAlign: "center" },
  ".cm-fub-image img": {
    display: "block",
    maxWidth: "100%",
    maxHeight: "16em",
    height: "auto",
    objectFit: "contain",
  },
  ".cm-fub-image .embed": { display: "inline-block", margin: "0", padding: "0", border: "0", background: "none" },
});

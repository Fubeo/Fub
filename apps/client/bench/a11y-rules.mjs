// **Le regole pure del banco dell'accessibilità**: la parte di `a11y.mjs` che
// si può giudicare senza browser.
//
// Sta a parte per la ragione per cui `large-rules.mjs` sta a parte da
// `large.mjs`: qui non c'è né browser né server, e un test la legge
// (`a11y-rules.test.ts`). Il banco raccoglie i fatti nella pagina (stili
// calcolati, attributi, misure) e li passa qui come dati semplici.
//
// # Il combobox di una finestra modale
//
// Il lanciatore segue il modello «combobox» delle WAI-ARIA APG dentro una
// finestra modale: il fuoco del DOM resta nel campo per tutta la vita della
// superficie, e le frecce muovono la riga attiva con `aria-activedescendant`.
// Il fuoco che si vede è il cursore che lampeggia nel campo più la riga
// attiva, come nel prototipo (`PLAN-ui/editor.html` di
// `piano/editor-completo`: `.k-in input:focus-visible { outline: none }`, e
// nessun anello attorno al campo). Un anello attorno a un campo che ha
// sempre il fuoco non dice niente in più: dice soltanto «sei qui», e qui si è
// per forza finché la finestra è aperta.
//
// L'eccezione è stretta: vale solo se il modello è proprio quello e il
// fuoco si vede davvero. Un campo qualunque senza anello resta rosso; un
// combobox fuori da una finestra modale (dove il Tab lo lascia e ci torna)
// resta rosso; un cursore trasparente, un campo in sola lettura o
// disattivato, o una riga attiva che non si distingue dalle altre restano
// rossi. Ogni condizione ha un caso in `a11y-rules.test.ts`.

/// L'alfa di un colore CSS calcolato, da 0 a 1; `null` se la forma non si
/// riconosce. Il browser calcola i colori come `rgb()`/`rgba()`, o come
/// `color()`/`oklch()` con l'alfa dopo la barra; `transparent` è alfa 0.
export function alpha(color) {
  if (typeof color !== "string") return null;
  const value = color.trim().toLowerCase();
  if (value === "transparent") return 0;
  const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(value);
  if (slash) return Number(slash[1]) / (slash[2] ? 100 : 1);
  const rgba = /^rgba?\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*([\d.]+)(%?)\s*\)$/.exec(value);
  if (rgba) return Number(rgba[1]) / (rgba[2] ? 100 : 1);
  if (/^(rgb|hsl|hwb|lab|lch|oklab|oklch|color)\(/.test(value)) return 1;
  if (/^#[0-9a-f]{3,8}$/.test(value)) {
    const hex = value.slice(1);
    if (hex.length === 4) return parseInt(hex[3] + hex[3], 16) / 255;
    if (hex.length === 8) return parseInt(hex.slice(6), 16) / 255;
    return 1;
  }
  return null;
}

const visibleColor = (color) => {
  const a = alpha(color);
  return a !== null && a > 0;
};

/// Un aspetto calcolato (`{ background, backgroundImage, border, outline,
/// boxShadow }`) che da solo segna qualcosa: un fondo non trasparente, un
/// fondo a immagine, un contorno, un'ombra o un bordo.
function marks(look) {
  if (!look) return false;
  return (
    visibleColor(look.background) ||
    (look.backgroundImage ?? "none") !== "none" ||
    (look.outline ?? "none") !== "none" ||
    (look.boxShadow ?? "none") !== "none" ||
    (look.border ?? "none") !== "none"
  );
}

const sameLook = (a, b) =>
  a.background === b.background &&
  (a.backgroundImage ?? "none") === (b.backgroundImage ?? "none") &&
  (a.border ?? "none") === (b.border ?? "none") &&
  (a.outline ?? "none") === (b.outline ?? "none") &&
  (a.boxShadow ?? "none") === (b.boxShadow ?? "none");

/// Il motivo per cui il fuoco su questo combobox NON conta come visibile;
/// `null` se conta. I fatti li raccoglie `a11y.mjs` nella pagina:
///
/// - `tag`, `role`, `focusVisible`, `readOnly`, `disabled`: il campo;
/// - `caretColor`, `color`: il cursore (`auto` prende il colore del testo);
/// - `width`, `height`, `visibility`: che il campo si veda;
/// - `controls`: il ruolo dell'elemento di `aria-controls`, `null` se manca;
/// - `dialog`: `{ modal }` dell'antenato più vicino con `role="dialog"`,
///   `null` se non ce n'è;
/// - `descendant`: `null` senza `aria-activedescendant`; altrimenti
///   `{ exists, look, otherLook, highlight }`, dove `otherLook` è l'aspetto
///   di un'altra opzione della lista (`null` se è l'unica) e `highlight` il
///   rettangolo della riga attiva del kit (`.kit-list-highlight`, figlio
///   della lista: `{ hidden, look, sameSize }`), `null` se la lista non ne ha.
export function modalComboboxGap(facts) {
  if (!facts) return "nessun fatto";
  if (facts.tag !== "INPUT" || facts.role !== "combobox") return "non è un input combobox";
  if (!facts.focusVisible) return "senza :focus-visible";
  if (facts.controls !== "listbox") return "aria-controls non porta a un listbox";
  if (!facts.dialog) return "fuori da una finestra";
  if (facts.dialog.modal !== "true") return "la finestra non è modale";
  if (facts.readOnly) return "campo in sola lettura";
  if (facts.disabled) return "campo disattivato";
  if (!(facts.width > 0 && facts.height > 0)) return "campo senza dimensioni";
  if (facts.visibility !== "visible") return "campo nascosto";
  const caret = facts.caretColor === "auto" ? facts.color : facts.caretColor;
  if (!visibleColor(caret)) return "cursore trasparente";
  const d = facts.descendant;
  if (d === null || d === undefined) return null;
  if (!d.exists) return "la riga attiva non esiste";
  // La riga attiva si distingue da sola (fondo, bordo, contorno, ombra
  // diversi da un'altra opzione, o, se è l'unica, un segno suo)…
  const own = d.otherLook ? !sameLook(d.look, d.otherLook) : marks(d.look);
  // …o la segna il rettangolo del kit, che scivola da una riga all'altra:
  // visibile, con un segno suo, grande come la riga. La posizione non si
  // controlla perché mentre scivola è a metà strada.
  const highlight = d.highlight;
  const slid = highlight !== null && highlight !== undefined && !highlight.hidden && highlight.sameSize && marks(highlight.look);
  if (!own && !slid) return "la riga attiva non si distingue dalle altre";
  return null;
}

// # L'anello dell'editor di testo
//
// Lo scroller di CodeMirror (`.cm-scroller`) prende il fuoco, ma riempie
// l'editor: un anello suo rientrato finirebbe sotto i numeri di riga, che
// stanno fermi col loro fondo e lo coprirebbero. La pelle lo disegna allora
// sull'editor, suo padre, con un velo vuoto `::after` grande quanto lui
// (`structure.css`, `.cm-editor:has(> .cm-scroller:focus-visible)::after`).
//
// L'eccezione è stretta: vale solo per uno scroller di CodeMirror con
// `:focus-visible`, figlio diretto di un `.cm-editor`, il cui `::after` c'è
// davvero (un contenuto, non `display: none`), copre tutto l'editor (assoluto,
// a zero dai quattro lati) e dipinge un contorno o un'ombra. Un altro
// elemento che lasci l'anello a un antenato resta rosso: il banco raccoglie
// questi fatti solo per `.cm-scroller`.

/// Perché lo scroller **non** mostra il fuoco con l'anello del suo editor;
/// `null` se lo mostra. I fatti (`null` se l'elemento non è uno scroller):
///
/// - `focusVisible`: lo scroller ha `:focus-visible`;
/// - `frame`: il padre diretto è un `.cm-editor`;
/// - `after`: lo stile calcolato del `::after` del padre, `{ content,
///   display, position, top, right, bottom, left, outlineStyle,
///   outlineWidth, boxShadow }`.
export function editorFrameRingGap(facts) {
  if (!facts) return "non è uno scroller dell'editor";
  if (!facts.focusVisible) return "senza :focus-visible";
  if (!facts.frame) return "il padre non è un editor";
  const after = facts.after;
  if (!after) return "nessun velo";
  if (after.content === "none" || after.content === "normal" || after.display === "none") return "il velo non c'è";
  if (after.position !== "absolute") return "il velo non sta sull'editor";
  if ([after.top, after.right, after.bottom, after.left].some((side) => side !== "0px")) return "il velo non copre l'editor";
  const outlined = after.outlineStyle !== "none" && parseFloat(after.outlineWidth) > 0;
  const shadowed = after.boxShadow !== "none";
  if (!outlined && !shadowed) return "il velo non dipinge un anello";
  return null;
}

// I gesti del puntatore dalla misura vera della pagina, non da quella chiesta.
//
// L'app chiede una finestra di 1280 × 840 (`crates/fub-app/tauri.conf.json`),
// ma la misura la decide il gestore di finestre: sotto Xvfb, senza gestore, è
// quella; un gestore a tessere (niri, sway) la cambia, per esempio in
// 800 × 1896. Un gesto calcolato per 1280 px cade allora fuori dalla finestra
// e WebDriver lo rifiuta («move target out of bounds»). Qui il gesto si
// misura sulla pagina com'è, e quando la pagina lo costringe a rimpicciolire
// lo dice: un'ampiezza diversa sposta i numeri, e il referto non lo tace.

/// L'ampiezza dello spostamento di S3 e S9, in px CSS: il gesto va di tanto
/// da una parte e dall'altra del centro della vista.
export const PAN_DX = 400;

/// Quanto il gesto resta lontano dal bordo della vista, in px CSS.
export const PAN_MARGIN = 8;

/// Sotto quest'ampiezza lo spostamento non è più una misura dello scorrimento:
/// lo scenario fallisce e dice perché, invece di dare un numero che non vale.
export const PAN_MIN_DX = 100;

/// Il gesto di spostamento nella vista `view` (il rettangolo della lavagna,
/// `getBoundingClientRect`) di una pagina larga `page.width` e alta
/// `page.height` (`innerWidth`, `innerHeight`). Il punto è il centro della
/// parte visibile della vista; l'ampiezza è `want`, o meno se la vista non ha
/// posto: ogni punto del gesto, `x ± dx`, resta dentro la vista e dentro la
/// pagina, a `margin` px dai bordi. Torna `{ x, y, dx, want, reduced }`;
/// `reduced` dice che l'ampiezza è minore di quella chiesta. Lancia se la
/// vista non si vede o se l'ampiezza scende sotto `min`.
export function panGesture({ view, page, want = PAN_DX, margin = PAN_MARGIN, min = PAN_MIN_DX }) {
  const left = Math.max(view.left, 0);
  const right = Math.min(view.right, page.width);
  const top = Math.max(view.top, 0);
  const bottom = Math.min(view.bottom, page.height);
  if (!(right - left > 0 && bottom - top > 0)) {
    throw new Error(`la vista della lavagna non si vede nella pagina: vista ${JSON.stringify(view)}, pagina ${page.width} × ${page.height}`);
  }
  const x = Math.round((left + right) / 2);
  const y = Math.round((top + bottom) / 2);
  // L'ultimo pixel della pagina è `width - 1`: WebDriver rifiuta `width`.
  const room = Math.min(x - left, right - 1 - x) - margin;
  const dx = Math.max(0, Math.min(want, Math.floor(room)));
  if (dx < min) {
    throw new Error(`la vista della lavagna è troppo stretta per lo spostamento: ${Math.round(right - left)} px nella pagina di ${page.width} × ${page.height}, il gesto avrebbe ${dx} px invece di ${want} (al minimo ${min})`);
  }
  return { x, y, dx, want, reduced: dx < want };
}

/// La riga del referto per un gesto ridotto, o `null` se ha l'ampiezza piena.
export function panNote(gesture, page) {
  if (!gesture.reduced) return null;
  return `spostamento ridotto a ±${gesture.dx} px invece di ±${gesture.want}: la pagina è ${page.width} × ${page.height}; i fotogrammi non si confrontano uno a uno con quelli a ±${gesture.want}`;
}

/// La misura che l'app chiede alla sua finestra, da `tauri.conf.json` (la
/// prima finestra), o `null` se il file non la dice.
export function requestedWindow(conf) {
  const first = conf?.app?.windows?.[0];
  return Number.isFinite(first?.width) && Number.isFinite(first?.height) ? { width: first.width, height: first.height } : null;
}

/// La riga del referto quando la pagina non ha la misura chiesta (più di
/// `tolerance` px di scarto per lato), o `null`. `page` è in px CSS: con lo
/// zoom 1 dell'app sono i px logici della finestra.
export function windowNote(page, requested, tolerance = 2) {
  if (!requested) return null;
  if (Math.abs(page.width - requested.width) <= tolerance && Math.abs(page.height - requested.height) <= tolerance) return null;
  return `la pagina è ${page.width} × ${page.height} invece dei ${requested.width} × ${requested.height} chiesti: il gestore di finestre ha deciso un'altra misura, e i numeri che dipendono da quanto si vede (schede, righe) non si confrontano uno a uno con la CI`;
}

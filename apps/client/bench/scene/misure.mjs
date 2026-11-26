// Le misure delle finestre e le costanti che le scene condividono.
// Un pezzo di `bench/scene.mjs`, che le monta in `SCENE` e `GESTURE_SCENE`.

/// Il testo che il fotografo cerca per sapere che la ricerca ha risposto.
export const SEARCH = "nota";

/// Un guasto del kernel come lo manderebbe il kernel.
export function failure(severity, subject, message) {
  return { type: "trouble", severity, subject, error: { kind: "internal", message }, gate: null };
}

/// I due gradini di `Severity`, che nella shell diventano i due toni di un
/// avviso. Sono costanti perché due scene li mandano — il toast e il centro
/// notifiche — e due copie della stessa frase sono due frasi che divergono.
export const FAILURES = {
  minor: failure(
    "warning",
    "Guida/Nota lunga.md",
    "l'indice di ricerca è indietro di due minuti",
  ),
  severe: failure(
    "failure",
    null,
    "il watcher del vault si è fermato: le modifiche esterne non si vedono",
  ),
};

// ---------------------------------------------------------------------------
// **Le scene**: la shell (`index.html`), il telefono (`mobile.html`), la
// finestra documento (`document.html`) e i due cataloghi (`bench/kit.html`,
// `bench/catalog.html`).
// ---------------------------------------------------------------------------
//
// Una scena può dichiarare una `viewport`: la finestra stretta è uno stato della
// cornice (i cassetti diventano sovrapposti), e non si vede a 1280.

/// Un telefono in piedi: la finestra delle scene di `mobile.html`.
export const PHONE = { width: 390, height: 844 };
/// Il catalogo del kit intero, fino alla barra in una fila e alla colonna.
export const KIT_WINDOW = { width: 1280, height: 960 };
/// La finestra in cui, con l'albero aperto e l'ispettore chiuso, il foglio è
/// largo 700 px: la misura «700 px» del prototipo della barra dei fogli.
export const SHEET_700 = { width: 1016, height: 800 };
/// La finestra in cui, senza l'albero e l'ispettore, il foglio è largo
/// 1248 px: la misura «piena» del prototipo.
export const SHEET_FULL = { width: 1308, height: 800 };
/// La stessa larghezza per gli stati della griglia sulla cartella grande, un
/// po' più alta: a 1308×800 il riquadro della griglia finisce a mezzo pixel
/// sugli angoli tondi del foglio, e su questi angoli Chromium dava a ogni
/// scatto un antialiasing diverso di un livello (la scena non stava mai ferma).
export const SHEET_FULL_GRID = { width: 1308, height: 820 };
/// La nota nella finestra minima del computer (`minWidth` e un'altezza da
/// prototipo): la misura «700 px» del prototipo di Scrittoio 2, che sul
/// computer non si può avere.
export const NOTE_NARROW = { width: 800, height: 800 };
/// La finestra minima del desktop per lo spazio «Esporta in PDF» (il «700 px»
/// del prototipo è sotto la minima: il pannello sotto le pagine lo guarda la
/// scena del telefono).
export const EXPORT_NARROW = { width: 800, height: 800 };
/// La testata della trasclusione viva nel riquadro col fuoco.
export const TRANSCLUSION_HEAD = ".pane.focus .pane-editor .transclusion .transclusion-head";
/// Il blocco sincronizzato nel riquadro col fuoco.
export const SYNCED_BLOCK = ".pane.focus .pane-editor .transclusion-synced";
/// Una finestra documento appena aperta.
export const DOCUMENT_WINDOW = { width: 900, height: 700 };

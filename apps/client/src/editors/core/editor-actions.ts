// Le azioni dell'editor: i gesti di scrittura che una superficie sa eseguire
// sul proprio testo — mettere in grassetto, fare di una riga un titolo,
// aggiungere una riga a una tabella — nominati da un id stabile.
//
// È la capacità che la barra di formattazione interroga. Chi la dichiara è un
// plugin (`CommandSpec.toolbar.action`, e l'intento `fub.editor.action` di un
// comando); chi la esegue è la superficie, perché cursore, selezione e
// cronologia locale sono suoi (0190). Attraverso questo confine passano
// soltanto id e booleani: nessun oggetto CodeMirror, nessun DOM.
//
// Un id che la superficie non conosce non è un errore: la barra non ne
// disegna il pulsante, e l'intento dalla palette lo dice invece di fare nulla
// in silenzio.

/// Il `ns` dell'intento con cui un comando chiede alla shell di eseguire
/// un'azione dell'editor sulla superficie col fuoco (`fub_abi::ui::EDITOR_ACTION_NS`).
/// Il payload è `{ "action": "<id>" }`.
export const EDITOR_ACTION_NS = "fub.editor.action";

/// Lo stato di un'azione dove sta adesso il cursore principale.
export interface EditorActionState {
  /// Si può eseguire adesso: la superficie è scrivibile e l'azione ha dove
  /// agire (una riga di tabella fuori da una tabella non ce l'ha).
  readonly enabled: boolean;
  /// Per un'azione che commuta (grassetto, titolo 2, citazione): è già
  /// applicata dove sta il cursore. `null` per un'azione che inserisce e non
  /// commuta niente (una tabella, una nota): non ha un «premuto».
  readonly active: boolean | null;
}

export const ACTION_UNAVAILABLE: EditorActionState = { enabled: false, active: null };

export interface SurfaceEditorActions {
  /// La superficie conosce questa azione.
  has(id: string): boolean;
  /// Si scrive adesso: modalità di scrittura e non in sola lettura. Una
  /// superficie in lettura conosce ancora le sue azioni, ma non ne esegue.
  editable(): boolean;
  state(id: string): EditorActionState;
  /// Esegue l'azione come una battuta dell'utente: nella cronologia locale e
  /// nella sessione del documento. `false` se adesso non ha fatto niente.
  run(id: string): boolean;
  /// L'accordo con cui la stessa azione si esegue da tastiera nell'editor,
  /// nella sintassi delle scorciatoie (`Mod-b`); `null` se non ne ha.
  chord(id: string): string | null;
  /// Avvisa quando lo stato delle azioni può essere cambiato: selezione,
  /// testo, modalità, sola lettura. Restituisce il disposer.
  subscribe(listener: () => void): () => void;
}

/// Il payload di un intento `fub.editor.action`, o `null` se non lo è.
export function editorActionOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const action = (payload as { action?: unknown }).action;
  return typeof action === "string" && action !== "" ? action : null;
}

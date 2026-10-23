// Le scorciatoie di Excel che danno un comando del catalogo (ADR 0219).
//
// Si leggono dal tasto fisico (`KeyboardEvent.code`), come fa Excel: su una
// tastiera italiana Ctrl+Maiusc+5 è la percentuale anche se il tasto scrive
// «%» soltanto con Maiusc. Annulla, ripeti, gli appunti e lo spostamento
// restano della griglia; le scorciatoie che in Excel aprono una finestra di
// dialogo arrivano con le finestre.

export interface ShortcutCommand {
  readonly id: string;
  readonly params: string;
}

/// Che cosa la selezione prende per intero, le righe o le colonne del
/// foglio, e il formato della valuta nella lingua dell'interfaccia.
export interface ShortcutContext {
  readonly wholeRows: boolean;
  readonly wholeColumns: boolean;
  readonly currency: string;
}

/// Il formato di valuta di Ctrl+Maiusc+4 nella lingua `language`: l'euro
/// dopo la cifra in italiano, il dollaro prima altrove.
export function currencyFormat(language: string): string {
  return language.toLowerCase().startsWith("it") ? '#,##0.00 "€"' : '"$"#,##0.00';
}

const plain = (id: string): ShortcutCommand => ({ id, params: "{}" });
const format = (name: string): ShortcutCommand => ({ id: "home.numberFormat", params: JSON.stringify({ format: name }) });
const code = (text: string): ShortcutCommand => ({ id: "home.numberFormat", params: JSON.stringify({ code: text }) });
const borders = (preset: string): ShortcutCommand => ({ id: "home.borders", params: JSON.stringify({ preset }) });

/// Con Ctrl (o Cmd) e senza Maiusc.
const CONTROL: Readonly<Record<string, ShortcutCommand>> = {
  KeyB: plain("home.bold"),
  Digit2: plain("home.bold"),
  KeyI: plain("home.italic"),
  Digit3: plain("home.italic"),
  KeyU: plain("home.underline"),
  Digit4: plain("home.underline"),
  Digit5: plain("home.strikethrough"),
  Digit9: plain("home.hideRows"),
  Digit0: plain("home.hideColumns"),
  KeyD: plain("edit.fillDown"),
  KeyR: plain("edit.fillRight"),
};

/// Con Ctrl (o Cmd) e Maiusc, nei formati che Excel dà a queste scorciatoie.
const CONTROL_SHIFT: Readonly<Record<string, ShortcutCommand>> = {
  Backquote: format("General"),
  Digit1: code("#,##0.00"),
  Digit2: code("h:mm AM/PM"),
  Digit3: code("d-mmm-yy"),
  Digit5: plain("home.percent"),
  Digit6: code("0.00E+00"),
  Digit7: borders("outside"),
  Minus: borders("none"),
  Digit9: plain("home.unhideRows"),
  Digit0: plain("home.unhideColumns"),
  KeyL: plain("data.filter"),
};

/// Il comando della scorciatoia di `event`, o `null`.
export function shortcutCommand(event: KeyboardEvent, context: ShortcutContext): ShortcutCommand | null {
  const control = event.ctrlKey || event.metaKey;
  if (event.altKey && !control && event.code === "Equal" && !event.shiftKey) return plain("formulas.autoSum");
  if (!control || event.altKey) return null;
  // Ctrl+«+» e Ctrl+«-»: in Excel inseriscono e tolgono righe o colonne
  // intere senza chiedere niente; su un intervallo chiedono come.
  const plus = event.code === "NumpadAdd" || (event.shiftKey && event.code === "Equal");
  const minus = event.code === "NumpadSubtract" || (!event.shiftKey && event.code === "Minus");
  if (plus || minus) {
    if (context.wholeRows) return plain(plus ? "home.insertRows" : "home.deleteRows");
    if (context.wholeColumns) return plain(plus ? "home.insertColumns" : "home.deleteColumns");
    return null;
  }
  if (event.shiftKey && event.code === "Digit4") return code(context.currency);
  return (event.shiftKey ? CONTROL_SHIFT : CONTROL)[event.code] ?? null;
}

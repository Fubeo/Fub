// La composizione (IME): cinese, giapponese, coreano, accenti morti.
//
// Mentre si compone, Invio sceglie il candidato ed Esc lo scarta: sono tasti
// del metodo d'immissione, non del campo. Chi conferma o chiude con Invio o
// Esc li lascia passare.

/// Vero se `event` è un tasto della composizione e non del campo.
///
/// `isComposing` basta in Chromium e Firefox. WebKit (la WebView di Linux e di
/// macOS) chiude la composizione **prima** del keydown del tasto che la
/// conferma: quel keydown arriva con `isComposing` falso e il codice 229 del
/// tasto preso dal metodo d'immissione.
export function composingKey(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

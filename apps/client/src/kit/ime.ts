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
///
/// È la sola guardia dei tasti: un gestore di `keydown` o `keyup` non legge
/// `isComposing` da solo (lo verifica `ime.test.ts`). Su `input` e
/// `beforeinput` invece `InputEvent.isComposing` basta: lì il codice del tasto
/// non c'è.
export function composingKey(event: ComposingFields): boolean {
  return event.isComposing || event.keyCode === 229;
}

/// I campi di un tasto che `composingKey` legge: chi prende solo una parte di
/// `KeyboardEvent` (una regola pura, i suoi test) li chiede così.
export type ComposingFields = Pick<KeyboardEvent, "isComposing"> & Partial<Pick<KeyboardEvent, "keyCode">>;

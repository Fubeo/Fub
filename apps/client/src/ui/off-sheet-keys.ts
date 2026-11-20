// **Il tasto col fuoco fuori dal foglio**: una linguetta, un pulsante di un
// pannello, la barra di Trova e sostituisci, l'elenco delle Revisioni.
//
// Due regole, una volta sola per tutti i pannelli e per tutti gli editor
// (Markdown, ricco), e `ui/keyboard.ts` le applica dal suo unico `keydown`
// dopo che i gestori locali hanno parlato:
//
// 1. **Una lettera non entra nella nota.** Su WebKitGTK un tasto di testo
//    premuto su un controllo che non scrive va alla selezione della pagina, e
//    se quella è ancora nel testo della nota il motore ci scrive dentro e vi
//    porta il fuoco (IMP-106). Un controllo fa ciò che deve con le sue
//    frecce, Home e Fine; una lettera, un Backspace o un Canc che nessuno ha
//    preso non fanno niente. Chi apre un campo al primo tasto (la cella di una
//    griglia) vi sposta il fuoco mentre il tasto passa: il tasto resta suo.
// 2. **Annulla e ripeti sono del documento attivo.** Ctrl+Z, Ctrl+Maiusc+Z e
//    Ctrl+Y (⌘Z e ⇧⌘Z sul Mac) da un pulsante o una linguetta di un pannello
//    legato al documento annullano e ripetono nella superficie del riquadro
//    col fuoco, come se il fuoco fosse nel foglio (IMP-119, IMP-120). Un
//    campo di testo tiene la sua pila (`ui/field-history.ts`). Quali
//    contenitori siano legati al documento, e come la superficie annulli, lo
//    dice la shell (`OffSheetDocument`): qui non c'è nessun nome di pannello.
import type { KeyboardPlatform } from "./commands";
import { fieldHistoryStep, isWritingField, type FieldHistoryStep } from "./field-history";
import { composingKey, type ComposingFields } from "../kit/ime";

/// Che cosa fa il tasto fuori dal foglio: niente (`quiet`, il tasto si
/// ferma), un passo della storia del documento, o `null`, il tasto passa.
export type OffSheetKey = { readonly kind: "quiet" } | { readonly kind: "history"; readonly step: FieldHistoryStep } | null;

/// Ciò che la shell sa del documento attivo.
export interface OffSheetDocument {
  /// Il controllo sta in un contenitore legato al documento attivo: il suo
  /// riquadro o l'ispettore.
  owns(target: Element): boolean;
  /// Un passo della storia della superficie del riquadro col fuoco, senza
  /// spostare il fuoco. `null` se lì non c'è una storia da guidare: il tasto
  /// passa; `false` se non c'era niente da annullare: il tasto è preso lo
  /// stesso.
  history(step: FieldHistoryStep): boolean | null;
}

/// I tasti che, senza modificatori, cambierebbero il testo della selezione.
const EDITING_KEYS: ReadonlySet<string> = new Set(["Backspace", "Delete"]);

/// La regola, su un tasto che nessun comando dell'app ha preso. `active` è
/// l'elemento col fuoco adesso, dopo i gestori locali.
export function offSheetKey(
  e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "target"> &
    ComposingFields & Partial<Pick<KeyboardEvent, "getModifierState">>,
  platform: KeyboardPlatform,
  active: Element | null,
): OffSheetKey {
  if (composingKey(e)) return null;
  const target = e.target;
  // Un campo scrive da sé, e una tendina sceglie con le lettere.
  if (isWritingField(target) || target instanceof HTMLSelectElement) return null;
  const step = fieldHistoryStep(e, platform);
  if (step !== null) return { kind: "history", step };
  // AltGr (Ctrl+Alt su Windows) scrive un carattere; Ctrl o ⌘ fanno un gesto.
  const altGraph = e.getModifierState?.("AltGraph") ?? false;
  if ((e.ctrlKey || e.metaKey) && !altGraph) return null;
  // Lo spazio resta del controllo: preme un pulsante, spunta una casella.
  const text = e.key.length === 1 && e.key !== " ";
  if (!text && !EDITING_KEYS.has(e.key)) return null;
  // Un gestore ha aperto un campo per questo tasto: il tasto è del campo.
  if (isWritingField(active)) return null;
  return { kind: "quiet" };
}

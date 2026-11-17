// **Annulla e ripeti del documento dai suoi pannelli.**
//
// La barra Trova e sostituisci e le schede del pannello del documento
// (Commenti, Revisioni, Proprietà) cambiano il documento coi loro pulsanti,
// e dopo il gesto il fuoco resta sul pulsante, fuori dal testo: il tasto
// dell'annullamento, che il motore lega soltanto dentro il foglio, lì non
// arrivava a nessuno (IMP-119, IMP-120). Qui, sopra ognuno di quei
// contenitori, Ctrl+Z / ⌘Z annulla nel documento e Ctrl+Maiusc+Z, Ctrl+Y
// / ⇧⌘Z ripetono, come se il fuoco fosse nel foglio.
//
// Dentro un campo di testo il tasto resta del campo (`ui/field-history.ts`):
// la casella «Trova» annulla ciò che vi si è scritto. Non è una scorciatoia
// globale: vale soltanto nei contenitori a cui la si lega, e un pannello di
// un altro documento o della shell non la vede.
import { redo, undo } from "prosemirror-history";
import { keyboardPlatform } from "../../ui/commands";
import { TEXT_INPUT_TYPES, fieldHistoryStep, isPlainTextField } from "../../ui/field-history";
import type { Lifetime } from "../../ui/lifetime";
import type { RichEngine } from "./engine";

/// Dà a `root` annulla e ripeti del documento di `engine`, finché `life`
/// dura. `after` ridisegna ciò che il pannello mostra del documento, se non
/// lo ascolta già.
export function documentHistoryKeys(root: HTMLElement, engine: Pick<RichEngine, "apply">, life: Lifetime, after?: () => void): void {
  life.listen(root, "keydown", (event) => {
    if (event.defaultPrevented || event.isComposing) return;
    const step = fieldHistoryStep(event, keyboardPlatform(navigator.platform));
    if (step === null) return;
    const target = event.target;
    if (isPlainTextField(target, TEXT_INPUT_TYPES)) return;
    if (target instanceof HTMLElement && target.isContentEditable) return;
    // Il tasto è del documento anche quando non c'è niente da annullare:
    // non deve finire alla shell come un altro gesto.
    event.preventDefault();
    if (engine.apply(step === "undo" ? undo : redo, false)) after?.();
  });
}

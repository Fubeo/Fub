// **La tastiera dell'app** (§18.2): l'unico `keydown`, e lo stato di una
// sequenza in corso.
//
// Era quattro righe dentro `main.ts` — trova il comando, esegui — e ci poteva
// stare finché una scorciatoia era un gesto senza memoria. Una sequenza ne ha
// una: fra `Mod-k` e `d` c'è un momento in cui l'app sta aspettando, e quel
// momento ha un tempo che scade, una via d'uscita e una cosa da mostrare a chi
// guarda. Sono tre responsabilità che in `main.ts` sarebbero tre righe di
// monolite in più, ed è la §1.2 a dire dove vanno invece.
//
// Ciò che **non** sta qui è il riconoscimento: chi decide cosa fa un tasto è
// `avanza` in `ui/commands.ts`, che è pura e non sa cosa sia un `document`.
// Questo modulo è il pezzo che tocca il DOM — l'ascoltatore, il timer, la riga
// nella barra di stato — e non contiene nessuna regola. È la stessa divisione
// che `ui/notify.ts` fa fra un avviso e il suo disegno.
//
// Popup e keymap locali rispondono prima che l'evento raggiunga questo unico
// ascoltatore. `defaultPrevented` è il loro verdetto osservabile: nessun elenco
// di collisioni cablato nella shell e nessun listener globale nei renderer.
import { t } from "../i18n/strings";
import { TEXT_INPUT_TYPES, fieldHistoryStep, isPlainTextField, isWritingField, runFieldHistory } from "./field-history";
import type { Lifetime } from "./lifetime";
import { modalOpen } from "./a11y";
import { offSheetKey, type OffSheetDocument } from "./off-sheet-keys";
import {
  WAIT_MS,
  allCommands,
  advance,
  keyboardPlatform,
  type KeyboardPlatform,
  type Waiting,
  type CommandEntry,
} from "./commands";

/// Gli accordi già premuti, se una sequenza è cominciata.
///
/// Una variabile di modulo e non un registro: lo stato di una sequenza dura
/// due secondi e riguarda solo chi guida la tastiera. Di registri dei comandi ce
/// n'è **uno**, dalla 0077, e questo non è uno di quelli.
let waiting: Waiting | null = null;

/// Il timer della scadenza, per poterlo disdire quando il tasto arriva.
let deadline: ReturnType<typeof setTimeout> | undefined;


/// Monta l'ascoltatore. `execute` è cosa fare del comando trovato — l'avvio vero
/// sta in `main.ts`, che è l'unico a sapere dove chiedere i parametri.
/// `sheet` è il documento attivo, per i tasti premuti fuori dal foglio
/// (`ui/off-sheet-keys.ts`); senza, Ctrl+Z da un pannello non annulla niente.
export function mountKeyboard(
  lifetime: Lifetime,
  execute: (entry: CommandEntry) => void,
  sheet?: OffSheetDocument,
): void {
  lifetime.listen(document, "keydown", (e) => {
    if (e.defaultPrevented) {
      stopWaiting();
      return;
    }
    const platform = keyboardPlatform(navigator.platform);
    if (waiting === null && yieldsToField(e)) return;
    const result = advance(allCommands(), waiting, e, platform);
    // L'unico esito che lascia passare il tasto. Gli altri tre sono gesti
    // dell'app, e un gesto dell'app non finisce anche dentro la nota.
    if (result.type === "passa") {
      // Annulla e ripeti di un campo di testo, che il WebView di Linux non
      // lega da sé (`ui/field-history.ts`): solo se nessun comando lo ha preso.
      const step = waiting === null && isPlainTextField(e.target, TEXT_INPUTS) ? fieldHistoryStep(e, platform) : null;
      if (step !== null && runFieldHistory(step)) e.preventDefault();
      // Fuori dal foglio la lettera non entra nella nota, e l'annulla è del
      // documento attivo (`ui/off-sheet-keys.ts`).
      else if (waiting === null) offSheet(e, platform, sheet);
      return;
    }
    // Popup e editor locali sono già passati: da qui decide l'ordine dei layer
    // nel registro, e ogni esito diverso da `passa` appartiene alla shell.
    e.preventDefault();
    // Con una finestra modale aperta il fondo non si tocca: Ctrl+N non crea
    // una nota dietro le Impostazioni, Ctrl+W non chiude la scheda che non si
    // vede (IMP-152). Il tasto si ferma qui, senza cominciare una sequenza.
    // Escape e i tasti propri della finestra li ha già presi lei: la trappola
    // del fuoco in cattura, i suoi ascoltatori prima del documento.
    if (modalOpen()) {
      stopWaiting();
      return;
    }
    if (result.type === "attende") {
      waitFor(result.waiting);
      return;
    }
    stopWaiting();
    if (result.type === "esegue") execute(result.entry);
  });
}

/// I tipi di `input` in cui si scrive (`ui/field-history.ts`).
const TEXT_INPUTS = TEXT_INPUT_TYPES;

/// Applica la regola del tasto fuori dal foglio a un tasto che nessuno ha
/// preso: la lettera si ferma, l'annulla va alla superficie del riquadro col
/// fuoco se il controllo sta in un contenitore del documento.
function offSheet(e: KeyboardEvent, platform: KeyboardPlatform, sheet: OffSheetDocument | undefined): void {
  const verdict = offSheetKey(e, platform, document.activeElement);
  if (verdict === null) return;
  if (verdict.kind === "quiet") {
    e.preventDefault();
    return;
  }
  const target = e.target;
  if (!sheet || !(target instanceof Element) || !sheet.owns(target)) return;
  if (sheet.history(verdict.step) !== null) e.preventDefault();
}

/// Un tasto dell'app non ruba un tasto di testo. Dentro un campo, un accordo
/// senza Ctrl e senza ⌘ resta del campo: Opzione+← è la parola precedente su
/// Mac, Alt+← un salto in CodeMirror. Fuori dal campo lo stesso accordo torna
/// dell'app (Alt+← va indietro). Un accordo con Control sul Mac è dell'app solo
/// se l'app lo dichiara (`Ctrl-Tab`): Ctrl+A, l'inizio della riga, non lo
/// dichiara nessuno e arriva al campo.
///
/// I tasti funzione non scrivono e restano dell'app anche in un campo; il
/// secondo tasto di una sequenza già cominciata è dell'app per definizione, e
/// chi chiama lo lascia passare prima di arrivare qui.
function yieldsToField(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || /^F\d{1,2}$/.test(e.key)) return false;
  return isWritingField(e.target);
}

/// Solo per i banchi e per chi chiude un vault: una sequenza a metà che
/// sopravvive a ciò che l'ha iniziata è lo stato che questo modulo esiste per
/// non lasciare in giro.
export function cancelSequence(): void {
  stopWaiting();
}

function waitFor(newItem: Waiting): void {
  waiting = newItem;
  show(newItem.label);
  clearTimeout(deadline);
  // La scadenza non esegue niente e non dice niente: chiude l'attesa e basta.
  // Un timeout che al termine facesse partire il comando corto sarebbe la
  // regola del prefisso al contrario, e la sorpresa arriverebbe due secondi
  // dopo l'ultimo tasto premuto — cioè quando nessuno la sta più aspettando.
  deadline = setTimeout(stopWaiting, WAIT_MS);
}

function stopWaiting(): void {
  if (!waiting) return;
  waiting = null;
  clearTimeout(deadline);
  deadline = undefined;
  show(null);
}

/// La riga nella barra di stato che dice che l'app sta aspettando.
///
/// È la differenza fra una sequenza e una tastiera che ogni tanto non risponde:
/// senza, i due secondi dopo `Mod-k` sono indistinguibili da un guasto. Non è un
/// avviso del centro notifiche (`ui/notify.ts`) perché non è una cosa da
/// **rileggere**: vale mentre è vera e poi non vale più, ed è esattamente ciò
/// per cui la barra di stato c'è.
function show(label: string | null): void {
  const el = document.getElementById("key-pending");
  if (!el) return;
  el.textContent = label === null ? "" : t("keys.pending", { chord: label });
  el.hidden = label === null;
}

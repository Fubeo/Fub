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
// Ciò che **non** sta qui è il riconoscimento né l'ordine di consumo: chi
// decide cosa fa un tasto è `avanza` in `ui/commands.ts`, mentre chi arbitra
// l'esito è `ui/arbitration.ts`; entrambi sono puri e non sanno cosa sia un
// `document`.
//
// Questo modulo osserva il DOM — ascoltatore, fuoco, timer e riga nella barra
// di stato — e passa fatti all'arbitrato. La pila delle superfici che possiedono
// la tastiera vive in `ui/a11y.ts`; qui se ne legge soltanto il verdetto. Un
// accordo non dichiara un ambito — dove vale lo dice il fuoco — e l'unico posto
// in cui il fuoco si vede è l'evento che risale da chi lo tiene.
import { t } from "../i18n/strings";
import type { Lifetime } from "./lifetime";
import { focusTrapOwnsKeyboard } from "./a11y";
import { arbitrate } from "./arbitration";
import {
  WAIT_MS,
  allCommands,
  advance,
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

/// L'evento è nato dentro l'editor? Il fuoco si osserva qui, dove il DOM c'è, e
/// non in `avanza`, che resta pura e non riceve il bersaglio.
function inEditor(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".cm-editor") !== null;
}

/// Monta l'ascoltatore. `execute` è cosa fare del comando trovato — l'avvio vero
/// sta in `main.ts`, che è l'unico a sapere dove chiedere i parametri.
export function mountKeyboard(lifetime: Lifetime, execute: (entry: CommandEntry) => void): void {
  lifetime.listen(document, "keydown", (e) => {
    const overlayOpen = focusTrapOwnsKeyboard();
    // CodeMirror gestisce il keydown sul suo DOM prima che raggiunga questo
    // ascoltatore sul documento. Il suo `preventDefault` è il fatto causale:
    // nessun id della shell o lista di accordi può sostituirlo.
    const editorFocused = inEditor(e.target);
    const localEditorConsumed = editorFocused && e.defaultPrevented;
    const result = advance(allCommands(), waiting, e);
    const decision = arbitrate(result, { overlayOpen, localEditorConsumed });
    // L'unico esito che lascia passare il tasto. Gli altri tre sono gesti
    // dell'app, e un gesto dell'app non finisce anche dentro la nota.
    if (decision.type === "passa") {
      // Una trappola o un editor che ha consumato l'evento interrompono qualsiasi
      // sequenza della shell: l'attesa non può sopravvivere al suo primo gesto.
      if ((overlayOpen && result.type !== "passa") || localEditorConsumed) stopWaiting();
      return;
    }
    e.preventDefault();
    if (decision.type === "attende") {
      waitFor(decision.waiting);
      return;
    }
    stopWaiting();
    if (decision.type === "esegue") execute(decision.entry);
  });
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

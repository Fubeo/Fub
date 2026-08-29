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
// `document`. Questo modulo osserva il DOM — ascoltatore, fuoco, overlay, timer
// e riga nella barra di stato — e passa fatti all'arbitrato.
//
// Il fuoco e la presenza di un overlay si osservano qui, dove il DOM c'è, e non
// in `avanza`. Un accordo non dichiara un ambito — dove vale lo dice il fuoco —
// e l'unico posto in cui il fuoco si vede è l'evento che risale da chi lo tiene.
import { t } from "../i18n/strings";
import type { Lifetime } from "./lifetime";
import { arbitrate } from "./arbitration";
import {
  WAIT_MS,
  allCommands,
  advance,
  type Waiting,
  type CommandEntry,
} from "./commands";

/// Gli overlay che, quando sono montati e visibili, hanno precedenza sulla
/// tastiera della shell. Il menu dell'app usa lo stesso `context-menu`.
const TRANSITORY_OVERLAY_IDS = [
  "command-palette",
  "quick-switcher",
  "context-menu",
  "icon-picker",
] as const;

function transientOverlayOpen(): boolean {
  return TRANSITORY_OVERLAY_IDS.some((id) => {
    const element = document.getElementById(id);
    return element !== null && !element.hidden && element.getAttribute("aria-hidden") !== "true";
  });
}

/// Gli accordi già premuti, se una sequenza è cominciata.
///
/// Una variabile di modulo e non un registro: lo stato di una sequenza dura
/// due secondi e riguarda solo chi guida la tastiera. Di registri dei comandi ce
/// n'è **uno**, dalla 0077, e questo non è uno di quelli.
let waiting: Waiting | null = null;

/// Il timer della scadenza, per poterlo disdire quando il tasto arriva.
let deadline: ReturnType<typeof setTimeout> | undefined;

/// I tre accordi che l'editor monta anche lui, e che dentro l'editor vince
/// l'editor (0156). È la stessa lista di `SCONTRI_NOTI` in
/// `keybindings.test.ts`: là è un lucchetto sugli elenchi dichiarati — i due
/// registri continuano a dichiararli entrambi — qui è la regola che a runtime
/// decide chi li tiene, e lo decide il fuoco.
const PASSED_TO_EDITOR: ReadonlySet<string> = new Set([
  "shell.doc.search",
  "shell.pane.split.down",
  "shell.mode.live",
]);

/// L'evento è nato dentro l'editor? Il fuoco si osserva qui, dove il DOM c'è, e
/// non in `avanza`, che resta pura e non riceve il bersaglio.
function inEditor(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(".cm-editor") !== null;
}

/// Monta l'ascoltatore. `execute` è cosa fare del comando trovato — l'avvio vero
/// sta in `main.ts`, che è l'unico a sapere dove chiedere i parametri.
export function mountKeyboard(lifetime: Lifetime, execute: (entry: CommandEntry) => void): void {
  lifetime.listen(document, "keydown", (e) => {
    const overlayOpen = transientOverlayOpen();
    const result = advance(allCommands(), waiting, e);
    const decision = arbitrate(result, e, {
      overlayOpen,
      editorFocused: inEditor(e.target),
      waiting,
      passedToEditor: PASSED_TO_EDITOR,
    });
    // L'unico esito che lascia passare il tasto. Gli altri tre sono gesti
    // dell'app, e un gesto dell'app non finisce anche dentro la nota.
    if (decision.type === "passa") {
      // Se un overlay interrompe una sequenza, l'attesa della shell non deve
      // sopravvivere sotto la superficie che ora possiede il fuoco.
      if (overlayOpen && result.type !== "passa") stopWaiting();
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

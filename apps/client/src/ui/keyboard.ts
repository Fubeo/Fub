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
import type { Lifetime } from "./lifetime";
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


/// Monta l'ascoltatore. `execute` è cosa fare del comando trovato — l'avvio vero
/// sta in `main.ts`, che è l'unico a sapere dove chiedere i parametri.
export function mountKeyboard(lifetime: Lifetime, execute: (entry: CommandEntry) => void): void {
  lifetime.listen(document, "keydown", (e) => {
    if (e.defaultPrevented) {
      stopWaiting();
      return;
    }
    const result = advance(allCommands(), waiting, e);
    // L'unico esito che lascia passare il tasto. Gli altri tre sono gesti
    // dell'app, e un gesto dell'app non finisce anche dentro la nota.
    if (result.type === "passa") return;
    // Popup e editor locali sono già passati: da qui decide l'ordine dei layer
    // nel registro, e ogni esito diverso da `passa` appartiene alla shell.
    e.preventDefault();
    if (result.type === "attende") {
      waitFor(result.waiting);
      return;
    }
    stopWaiting();
    if (result.type === "esegue") execute(result.entry);
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

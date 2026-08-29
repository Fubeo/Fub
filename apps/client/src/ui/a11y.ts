// I pezzi che rendono usabile ciò che la shell disegna anche senza mouse e
// senza vedere lo schermo (§12.4).
//
// Stanno in un modulo loro e non sparsi nei pannelli per la ragione che rende
// questa voce fattibile *adesso* e cara dopo: le regole di accessibilità non
// sono decorazioni per elemento, sono **invarianti** — «ciò che si clicca si
// raggiunge col linguetta», «una modale non lascia uscire il fuoco», «un campo ha un
// nome». Scritte una volta e chiamate da chi disegna valgono anche per i
// pannelli che non esistono ancora; ricopiate a mano trenta volte valgono nei
// ventinove in cui qualcuno si è ricordato.
//
// Il presidio che le tiene ferme è `ui/a11y.test.ts`, ed è la metà che la 0014
// chiede: *una promessa senza presidio meccanico decade*, e questa decadrebbe
// alla prima view nuova.
import { openLifetime, type Teardown } from "./lifetime";

/// Un id unico nel documento, per legare due elementi (`for`, `aria-labelledby`,
/// `aria-controls`).
///
/// Il contatore basta e non serve nient'altro: gli id vivono quanto il
/// documento, e la shell non li serializza da nessuna parte. Il prefisso serve
/// solo a chi legge il DOM con l'ispettore.
let counter = 0;
export function identifier(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

/// Gli elementi che il browser rende già attivabili da tastiera per conto suo.
const NATIVE_INTERACTIVE = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY"]);

/// Rende attivabile da tastiera un elemento che risponde al click.
///
/// È la riga con la leva più lunga di questa voce. La shell disegna le cose
/// cliccabili come `div` — una voce di lista, l'etichetta di un albero, una
/// riga di tabella — e un `div` con un `addEventListener("click")` è, per chi
/// non usa il mouse, **niente**: non lo raggiunge il tab, non lo annuncia un
/// lettore di schermo, non lo attiva Invio. Non è un difetto di un pannello: è
/// un difetto del *renderer*, quindi si ripara nel renderer e vale per tutti i
/// pannelli, compresi quelli che scriverà un plugin.
///
/// Cosa fa, e cosa deliberatamente non fa:
///
/// - **Non tocca** ciò che è già interattivo. Mettere `tabindex` e
///   `role="button"` su un `<button>` non aggiunge niente e toglie qualcosa:
///   il ruolo implicito è già quello giusto, e un `role` esplicito ridondante è
///   la prima cosa che diverge quando l'elemento cambia.
/// - **Non impone `role="button"` a chi ha già un ruolo**. Una riga di tabella
///   è una riga, e chiamarla pulsante toglierebbe a un lettore di schermo la
///   struttura della tabella per dargli un'etichetta che ha già. Prende il
///   `tabindex` e il tasto, e resta ciò che è.
/// - Invio **e** barra spaziatrice, perché sono i due tasti che attivano un
///   pulsante nativo e chi li usa non sa di essere su un `div`. La barra si
///   ferma qui (`preventDefault`) o farebbe scorrere il pannello sotto.
export function activatable(el: HTMLElement): void {
  if (NATIVE_INTERACTIVE.has(el.tagName)) return;
  el.tabIndex = 0;
  if (!el.hasAttribute("role")) el.setAttribute("role", "button");
  if (el.dataset.activatable === "sì") return;
  el.dataset.activatable = "sì";
  el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    el.click();
  });
}

/// Toglie ciò che [`activatable`] aveva messo, quando un nodo smette di avere
/// un'azione.
///
/// Serve perché il riconciliatore (§2.8) **riusa** gli elementi: la stessa riga
/// che era cliccabile al giro scorso può non esserlo più a questo, e restare
/// raggiungibile col tab senza fare niente è peggio che non esserlo mai stata —
/// è un vicolo cieco in mezzo all'ordine di lettura.
export function notActivatable(el: HTMLElement): void {
  if (NATIVE_INTERACTIVE.has(el.tagName)) return;
  el.removeAttribute("tabindex");
  if (el.getAttribute("role") === "button") el.removeAttribute("role");
}

/// Gli elementi che possono prendere il fuoco dentro `root`, nell'ordine in cui
/// il tab li visiterebbe.
///
/// `tabindex="-1"` è escluso di proposito: vuol dire «raggiungibile da un
/// programma, non dal tab», ed è esattamente ciò che il contenitore di una
/// modale usa per potersi prendere il fuoco senza entrare nel giro.
/// Le trappole aperte, dalla più vecchia alla più recente.
///
/// È di modulo perché la regola che tiene è fra le trappole e non dentro una:
/// «comanda l'ultima» non si può scrivere in una superficie che le altre non le
/// vede. Si svuota da sé — ogni trappola si toglie quando la si scioglie — e a
/// shell ferma è vuota.
interface FocusTrap {
  readonly root: HTMLElement;
  previous: HTMLElement | null;
}

const trapStack: FocusTrap[] = [];

type KeyboardOwnershipListener = (epoch: number) => void;

const keyboardOwnershipListeners = new Set<KeyboardOwnershipListener>();
let keyboardOwnershipEpoch = 0;

/// Osserva i cambi di proprietario della tastiera. L'epoca rende ogni passaggio
/// della pila distinguibile senza far conoscere la pila a chi riceve l'avviso.
export function onKeyboardOwnershipChange(listener: KeyboardOwnershipListener): Teardown {
  keyboardOwnershipListeners.add(listener);
  return () => keyboardOwnershipListeners.delete(listener);
}

function notifyKeyboardOwnershipChange(): void {
  keyboardOwnershipEpoch += 1;
  for (const listener of keyboardOwnershipListeners) listener(keyboardOwnershipEpoch);
}
/// Vera quando almeno una trappola viva possiede l'input da tastiera dell'app.
///
/// La pila resta privata: chi arbitra le scorciatoie ha bisogno soltanto di
/// questa risposta, non di vedere o modificare le superfici che la compongono.
export function focusTrapOwnsKeyboard(): boolean {
  return trapStack.length > 0;
}

export function focusableElements(root: HTMLElement): HTMLElement[] {
  const selector =
    'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(
    (el) => !el.hasAttribute("disabled") && el.offsetParent !== null,
  );
}

/// Chiude il fuoco dentro una superficie modale finché resta aperta.
///
/// Le due cose che una modale deve fare e che nessuna di questa shell faceva:
///
/// 1. **Non lasciare uscire il tab.** Una modale da cui il fuoco scappa mette
///    chi non vede a interagire con la UI *sotto* — che è ancora lì, la legge
///    ancora, e non è più quella che sta guardando. Peggio: non c'è modo di
///    accorgersene, perché visivamente non succede niente.
/// 2. **Chiudersi con Escape.** È il gesto che tutti provano per primo, ed è
///    l'unico che funziona senza sapere dov'è il pulsante di chiusura.
///
/// Rende la funzione che scioglie la trappola: chi apre una modale la tiene, e
/// la chiama quando la chiude. Senza, il secondo `apri()` metterebbe un secondo
/// ascoltatore sopra il primo e a quel punto Escape chiuderebbe due volte.
///
/// Lo `Teardown` che torna è il tipo di `ui/lifetime.ts`, ed è pensato per finire
/// in una `Lifetime` (`lifetime.aggiungi(trapFocus(...))`) invece che in una
/// variabile che qualcuno deve ricordarsi di chiamare — è così che lo prendono
/// il menu contestuale e il selettore di icona.
///
/// **Quando ce ne sono due aperte, comanda l'ultima** (difetto 0149). Prima non
/// comandava nessuna: gli ascoltatori stanno tutti su `document` in cattura,
/// quindi partivano *tutti*, nell'ordine in cui erano stati attaccati — cioè il
/// **primo** ad aprirsi si riprendeva il tab, e Escape chiudeva due superfici
/// con un tasto solo. Chi prende il fuoco non era chi sta sopra: era chi era
/// arrivato prima, che è l'esatto contrario di ciò che vede chi guarda lo
/// schermo. La pila qui sotto è quella regola detta una volta: le superfici si
/// aprono e si chiudono a nido — un selettore di icona sopra un menu, la palette
/// sopra la modale delle view — e a nido l'ultima aperta è quella che si sta
/// guardando. Le altre non si sciolgono: **stanno ferme**, e tornano a comandare
/// quando quella sopra se ne va.
///
/// Che l'ultima aperta sia anche quella dipinta sopra non è un caso da sperare:
/// una superficie che intrappola il fuoco sta sul piano `--z-modal`, ed è scritto
/// in `theme/structure.css` accanto ai piani.
export function trapFocus(root: HTMLElement, close: () => void): Teardown {
  const lifetime = openLifetime();
  const previous = document.activeElement as HTMLElement | null;
  const entry: FocusTrap = { root, previous };
  trapStack.push(entry);
  notifyKeyboardOwnershipChange();
  lifetime.add(() => {
    // Chiudere una superficie sotto un'altra non deve spostare il fuoco fuori da
    // quella ancora viva. Il suo predecessore diventa però il predecessore di
    // ogni trappola superiore che puntava dentro la radice rimossa: quando queste
    // si chiuderanno, il ritorno salta la superficie che non esiste più.
    const where = trapStack.lastIndexOf(entry);
    if (where < 0) return;
    const wasTop = where === trapStack.length - 1;
    trapStack.splice(where, 1);
    notifyKeyboardOwnershipChange();
    const predecessor = entry.previous?.isConnected ? entry.previous : null;
    for (let i = where; i < trapStack.length; i += 1) {
      const higher = trapStack[i]!;
      if (entry.root.contains(higher.previous)) higher.previous = predecessor;
    }
    // Il fuoco torna da dove era partito soltanto dopo aver tolto listener e
    // ownership dalla pila, e mai attraverso una trappola ancora sopra.
    if (wasTop) predecessor?.focus();
  });

  const onKey = (e: KeyboardEvent) => {
    // Aperta ma non in cima: c'è una superficie sopra questa, e il tasto è suo.
    if (trapStack[trapStack.length - 1] !== entry) return;
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const inside = focusableElements(root);
    if (inside.length === 0) {
      // Una modale senza niente da mettere a fuoco esiste (un messaggio, un
      // pannello ancora vuoto): il tab non deve poterne uscire lo stesso.
      e.preventDefault();
      root.focus();
      return;
    }
    const first = inside[0]!;
    const last = inside[inside.length - 1]!;
    const current = document.activeElement;
    // Il giro si chiude a mano solo ai due estremi: in mezzo comanda il
    // browser, che conosce l'ordine di lettura meglio di questa lista.
    if (e.shiftKey && (current === first || !root.contains(current))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (current === last || !root.contains(current))) {
      e.preventDefault();
      first.focus();
    }
  };

  // In **cattura**: un pannello che gestisce le frecce o Escape per conto suo
  // (la palette dei comandi) non deve poter mangiare il tasto prima che la
  // trappola lo veda.
  lifetime.listen(document, "keydown", onKey, { capture: true });

  const inside = focusableElements(root);
  (inside[0] ?? root).focus();

  return () => lifetime.close();
}

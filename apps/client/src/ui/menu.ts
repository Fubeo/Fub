// Il menu contestuale, e il selettore di icona: le due finestrelle che si
// aprono accanto al punto in cui si è cliccato.
//
// Sono primitive di UI, non pezzi dell'explorer: non sanno cosa sia una nota né
// cosa sia un'icona: ricevono delle voci con dei `run`, o un valore e un
// callback. Stavano in `main.ts` insieme a tutto il resto, ed è la ragione per
// cui un pannello nuovo non poteva averle senza copiarle.

import { t } from "../i18n/strings";
import { trapFocus } from "./a11y";
import { openLifetime, type Lifetime } from "./lifetime";
import { enterSurface, exitSurface, finishSurface } from "./motion";

export interface MenuItem {
  label: string;
  /// Voce distruttiva: la si distingue perché sia difficile sbagliarla.
  danger?: boolean;
  /// Voce da cui far partire il fuoco quando il menu si apre.
  selected?: boolean;
  run: () => void;
}

/// Quanto vive il menu aperto, se ce n'è uno.
///
/// Una `Lifetime` e non più «la funzione che scioglie la trappola»: quella era una
/// delle tre cose da disfare, e le altre due — il nodo e l'ascoltatore sul
/// documento — erano scritte altrove, ognuna con la sua occasione di essere
/// dimenticata. Adesso il posto è uno, e chiudere il menu è chiuderlo.
let menuLifetime: Lifetime | null = null;

export function showContextMenu(at: MouseEvent, items: MenuItem[]): void {
  closeContextMenu();
  const previous = document.getElementById("context-menu");
  if (previous) finishSurface(previous);
  const lifetime = openLifetime();
  menuLifetime = lifetime;
  const menu = document.createElement("div");
  menu.id = "context-menu";
  menu.className = "context-menu";
  // Un menu è un menu: il ruolo è ciò che fa annunciare «menu, cinque voci» e
  // permette di uscirne sapendo di esserci entrati.
  menu.setAttribute("role", "menu");
  menu.tabIndex = -1;
  menu.style.left = `${at.clientX}px`;
  menu.style.top = `${at.clientY}px`;
  const buttons: HTMLButtonElement[] = [];
  for (const item of items) {
    const b = document.createElement("button");
    b.setAttribute("role", "menuitem");
    b.tabIndex = -1;
    b.textContent = item.label;
    if (item.danger) b.className = "danger";
    b.addEventListener("click", () => activate(b, item));
    b.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        // Il browser attiva già un button con questi tasti. Fermiamo quel
        // click implicito perché l'attivazione è gestita qui, una volta sola.
        e.preventDefault();
        activate(b, item);
      }
    });
    buttons.push(b);
    menu.appendChild(b);
  }
  const initial = Math.max(
    0,
    items.findIndex((item) => item.selected),
  );
  let active = items.length > 0 && items[initial]?.selected ? initial : 0;
  const focusItem = (index: number): void => {
    if (buttons.length === 0) {
      menu.focus();
      return;
    }
    active = (index + buttons.length) % buttons.length;
    buttons.forEach((button, i) => {
      button.tabIndex = i === active ? 0 : -1;
    });
    buttons[active]?.focus();
  };
  const move = (delta: number): void => {
    focusItem(active + delta);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(buttons.length - 1);
    }
  };
  menu.addEventListener("keydown", onKey);
  lifetime.add(() => menu.removeEventListener("keydown", onKey));
  function activate(button: HTMLButtonElement, item: MenuItem): void {
    // Space può produrre il click nativo al rilascio anche se il keydown è
    // stato annullato. Dopo la prima attivazione la vita non è più quella del
    // menu, quindi quel click tardivo non può eseguire la voce una seconda volta.
    if (menuLifetime !== lifetime) return;
    if (document.activeElement !== button) button.focus();
    closeContextMenu();
    item.run();
  }
  const workspace = document.getElementById("workspace");
  (workspace ?? document.body).appendChild(menu);
  lifetime.add(() => exitSurface(menu, () => menu.remove()));
  enterSurface(menu);
  // Il primo click fuori chiude, e il ritardo evita che sia questo stesso click
  // ad attivarlo. Il `once` **non** bastava: se il menu si chiudeva prima —
  // Escape, o una voce scelta da tastiera — l'ascoltatore non era ancora
  // registrato, e si registrava un istante dopo su un menu che non c'era più.
  // Restava lì fino al prossimo click qualunque, che chiudeva un menu inesistente
  // e, se nel frattempo se n'era aperto un altro, chiudeva quello. Su una vita
  // già chiusa `ascolta` non fa niente, e il caso non è da ricordarsi: non c'è.
  lifetime.add(trapFocus(menu, closeContextMenu));
  // `trapFocus` conserva e ripristina il fuoco precedente; il fuoco operativo
  // del menu, però, è una sola voce, secondo la regola del roving tabindex.
  focusItem(active);
  setTimeout(() => lifetime.listen(document, "click", closeContextMenu, { once: true }), 0);
}

export function closeContextMenu(): void {
  const lifetime = menuLifetime;
  menuLifetime = null;
  lifetime?.close();
}

const ICON_PRESETS = [
  "📝", "📁", "🗂️", "📌", "⭐", "🔥", "💡", "📚", "🎯", "✅",
  "🧠", "🛠️", "🎨", "🎵", "🏠", "💼", "🌱", "✈️", "❤️", "🧪",
];

/// Un piccolo selettore accanto al punto del click: qualche emoji pronta, un
/// campo per incollarne una qualsiasi, e il ritorno a "senza icona"
/// (`null` al callback).
export function pickIcon(at: MouseEvent, onPick: (icon: string | null) => void): void {
  // Chiudere il precedente, non togliergli il nodo da sotto. La riga di prima
  // era `document.getElementById("icon-picker")?.remove()`: il selettore
  // spariva dallo schermo e il suo ascoltatore su `document` restava — e con
  // lui la trappola del fuoco, che è la parte che si sentiva, perché Escape
  // continuava a rispondere per un selettore che nessuno vedeva più.
  closePickIcon();
  const previous = document.getElementById("icon-picker");
  if (previous) finishSurface(previous);
  const lifetime = openLifetime();
  iconLifetime = lifetime;
  const pop = document.createElement("div");
  pop.id = "icon-picker";
  pop.className = "icon-picker";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", t("icons.choose"));
  pop.tabIndex = -1;
  pop.style.left = `${Math.min(at.clientX, window.innerWidth - 240)}px`;
  pop.style.top = `${at.clientY}px`;

  const close = () => {
    if (iconLifetime === lifetime) iconLifetime = null;
    lifetime.close();
  };
  const outside = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) close();
  };
  const apply = (icon: string | null) => {
    close();
    onPick(icon);
  };

  const grid = document.createElement("div");
  grid.className = "icon-grid";
  for (const emoji of ICON_PRESETS) {
    const b = document.createElement("button");
    b.textContent = emoji;
    // Un pulsante il cui unico contenuto è un'emoji prende il nome dal nome
    // Unicode del carattere, letto in inglese in mezzo a un'interfaccia
    // italiana. Un nome migliore vorrebbe una tabella di traduzioni che questa
    // shell non ha e che non è di questa voce; dichiarare esplicitamente
    // l'emoji come nome accessibile almeno rende l'annuncio **uno** e
    // prevedibile, invece di lasciarlo a come ciascun motore descrive i simboli.
    b.setAttribute("aria-label", emoji);
    b.addEventListener("click", () => apply(emoji));
    grid.appendChild(b);
  }
  pop.appendChild(grid);

  const input = document.createElement("input");
  input.placeholder = t("icons.any");
  // Il segnaposto non è un'etichetta: sparisce appena si scrive, e per chi
  // ascolta non c'è mai stato.
  input.setAttribute("aria-label", t("icons.any"));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) apply(input.value.trim());
    else if (e.key === "Escape") close();
  });
  pop.appendChild(input);

  const remove = document.createElement("button");
  remove.className = "icon-none";
  remove.textContent = t("icons.none");
  remove.addEventListener("click", () => apply(null));
  pop.appendChild(remove);

  document.body.appendChild(pop);
  lifetime.add(() => exitSurface(pop, () => pop.remove()));
  enterSurface(pop);
  // La trappola prima del `focus()` esplicito: `trapFocus` metterebbe il
  // fuoco sul primo elemento — la prima emoji — mentre qui la cosa giusta è il
  // campo, che è ciò che permette di scriverne una qualsiasi senza attraversare
  // venti pulsanti. Le due righe non sono in conflitto: la seconda sposta il
  // fuoco dentro la stessa superficie, che è dove la trappola lo vuole.
  lifetime.add(trapFocus(pop, close));
  input.focus();
  lifetime.listen(document, "mousedown", outside, { capture: true });
}

/// Quanto vive il selettore di icona aperto, se ce n'è uno.
let iconLifetime: Lifetime | null = null;

/// Chiude il selettore di icona, se è aperto. Non è esportata perché nessuno
/// fuori di qui lo chiudeva prima; il posto che ne aveva bisogno era `pickIcon`
/// stessa, che è anche l'unico modo di aprirne un secondo.
function closePickIcon(): void {
  const lifetime = iconLifetime;
  iconLifetime = null;
  lifetime?.close();
}

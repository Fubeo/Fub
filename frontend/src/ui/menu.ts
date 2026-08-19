// Il menu contestuale, e il selettore di icona: le due finestrelle che si
// aprono accanto al punto in cui si è cliccato.
//
// Sono primitive di UI, non pezzi dell'explorer: non sanno cosa sia una nota né
// cosa sia un'icona: ricevono delle voci con dei `run`, o un valore e un
// callback. Stavano in `main.ts` insieme a tutto il resto, ed è la ragione per
// cui un pannello nuovo non poteva averle senza copiarle.

import { t } from "../i18n/strings";
import { intrappolaFuoco } from "./a11y";
import { apriVita, type Vita } from "./vita";

export interface MenuItem {
  label: string;
  /// Voce distruttiva: la si distingue perché sia difficile sbagliarla.
  danger?: boolean;
  run: () => void;
}

/// Quanto vive il menu aperto, se ce n'è uno.
///
/// Una `Vita` e non più «la funzione che scioglie la trappola»: quella era una
/// delle tre cose da disfare, e le altre due — il nodo e l'ascoltatore sul
/// documento — erano scritte altrove, ognuna con la sua occasione di essere
/// dimenticata. Adesso il posto è uno, e chiudere il menu è chiuderlo.
let vitaMenu: Vita | null = null;

export function showContextMenu(at: MouseEvent, items: MenuItem[]): void {
  closeContextMenu();
  const vita = apriVita();
  vitaMenu = vita;
  const menu = document.createElement("div");
  menu.id = "context-menu";
  menu.className = "context-menu";
  // Un menu è un menu: il ruolo è ciò che fa annunciare «menu, cinque voci» e
  // permette di uscirne sapendo di esserci entrati.
  menu.setAttribute("role", "menu");
  menu.tabIndex = -1;
  menu.style.left = `${at.clientX}px`;
  menu.style.top = `${at.clientY}px`;
  for (const item of items) {
    const b = document.createElement("button");
    b.setAttribute("role", "menuitem");
    b.textContent = item.label;
    if (item.danger) b.className = "danger";
    b.addEventListener("click", () => {
      closeContextMenu();
      item.run();
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  vita.aggiungi(() => menu.remove());
  // Il fuoco entra nel menu e non ne esce col tab, ed Escape lo chiude. Senza,
  // un menu contestuale era raggiungibile **solo** col tasto destro del mouse:
  // per chi naviga da tastiera, rinominare o eliminare una nota non esisteva.
  vita.aggiungi(intrappolaFuoco(menu, closeContextMenu));
  // Il primo click fuori chiude, e il ritardo evita che sia questo stesso click
  // ad attivarlo. Il `once` **non** bastava: se il menu si chiudeva prima —
  // Escape, o una voce scelta da tastiera — l'ascoltatore non era ancora
  // registrato, e si registrava un istante dopo su un menu che non c'era più.
  // Restava lì fino al prossimo click qualunque, che chiudeva un menu inesistente
  // e, se nel frattempo se n'era aperto un altro, chiudeva quello. Su una vita
  // già chiusa `ascolta` non fa niente, e il caso non è da ricordarsi: non c'è.
  setTimeout(() => vita.ascolta(document, "click", closeContextMenu, { once: true }), 0);
}

export function closeContextMenu(): void {
  const vita = vitaMenu;
  vitaMenu = null;
  vita?.chiudi();
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
  chiudiPickIcon();
  const vita = apriVita();
  vitaIcone = vita;
  const pop = document.createElement("div");
  pop.id = "icon-picker";
  pop.className = "icon-picker";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", t("icons.choose"));
  pop.tabIndex = -1;
  pop.style.left = `${Math.min(at.clientX, window.innerWidth - 240)}px`;
  pop.style.top = `${at.clientY}px`;

  const chiudi = () => {
    if (vitaIcone === vita) vitaIcone = null;
    vita.chiudi();
  };
  const fuori = (e: MouseEvent) => {
    if (!pop.contains(e.target as Node)) chiudi();
  };
  const applica = (icon: string | null) => {
    chiudi();
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
    b.addEventListener("click", () => applica(emoji));
    grid.appendChild(b);
  }
  pop.appendChild(grid);

  const input = document.createElement("input");
  input.placeholder = t("icons.any");
  // Il segnaposto non è un'etichetta: sparisce appena si scrive, e per chi
  // ascolta non c'è mai stato.
  input.setAttribute("aria-label", t("icons.any"));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) applica(input.value.trim());
    else if (e.key === "Escape") chiudi();
  });
  pop.appendChild(input);

  const rimuovi = document.createElement("button");
  rimuovi.className = "icon-none";
  rimuovi.textContent = t("icons.none");
  rimuovi.addEventListener("click", () => applica(null));
  pop.appendChild(rimuovi);

  document.body.appendChild(pop);
  vita.aggiungi(() => pop.remove());
  // La trappola prima del `focus()` esplicito: `intrappolaFuoco` metterebbe il
  // fuoco sul primo elemento — la prima emoji — mentre qui la cosa giusta è il
  // campo, che è ciò che permette di scriverne una qualsiasi senza attraversare
  // venti pulsanti. Le due righe non sono in conflitto: la seconda sposta il
  // fuoco dentro la stessa superficie, che è dove la trappola lo vuole.
  vita.aggiungi(intrappolaFuoco(pop, chiudi));
  input.focus();
  vita.ascolta(document, "mousedown", fuori, { capture: true });
}

/// Quanto vive il selettore di icona aperto, se ce n'è uno.
let vitaIcone: Vita | null = null;

/// Chiude il selettore di icona, se è aperto. Non è esportata perché nessuno
/// fuori di qui lo chiudeva prima; il posto che ne aveva bisogno era `pickIcon`
/// stessa, che è anche l'unico modo di aprirne un secondo.
function chiudiPickIcon(): void {
  const vita = vitaIcone;
  vitaIcone = null;
  vita?.chiudi();
}

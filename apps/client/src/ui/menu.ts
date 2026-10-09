// Il menu contestuale, e il selettore di icona: le due finestrelle che si
// aprono accanto al punto in cui si è cliccato.
//
// Sono primitive di UI, non pezzi dell'explorer: non sanno cosa sia una nota né
// cosa sia un'icona: ricevono delle voci con dei `run`, o un valore e un
// callback. Stavano in `main.ts` insieme a tutto il resto, ed è la ragione per
// cui un pannello nuovo non poteva averle senza copiarle.

import { t } from "../i18n/strings";
import { trapFocus } from "./a11y";
import { icon, iconEl } from "./icons";
import { openLifetime, type Lifetime } from "./lifetime";
import { enterSurface, exitSurface, finishSurface } from "./motion";

export interface MenuItem {
  label: string;
  /// Voce distruttiva: la si distingue perché sia difficile sbagliarla.
  danger?: boolean;
  /// Voce da cui far partire il fuoco quando il menu si apre.
  selected?: boolean;
  /// Una riga di separazione prima della voce: raggruppa i gesti affini.
  separator?: boolean;
  /// La voce c'è ma adesso non si può usare: si vede, non si attiva.
  disabled?: boolean;
  /// La scorciatoia del gesto, scritta come si preme.
  hint?: string;
  /// Una riga che spiega la voce, sotto il nome.
  description?: string;
  /// Una striscia di colori prima del nome: la voce è un aspetto da scegliere.
  swatches?: readonly string[];
  /// Il nome di un'icona (`icons.ts`), disegnata prima del nome: decorativa,
  /// perché il nome dice già tutto. Un nome che l'icona non conosce non
  /// disegna niente. Se anche una sola voce del menu ha la sua figura, le
  /// altre ne tengono il posto vuoto, perché i nomi stiano allineati.
  icon?: string;
  /// Un'anteprima al posto dell'icona: la voce è un aspetto con un nome,
  /// come uno stile del disegno. Decorativa come l'icona.
  sample?: MenuSample;
  /// La voce è una scelta: una fra alternative (`radio`) o un interruttore
  /// (`checkbox`), con il suo stato in `checked`.
  choice?: "radio" | "checkbox";
  checked?: boolean;
  run: () => void;
}

/// L'anteprima di una voce: un testo breve, come «Aa», o niente per un
/// quadratino; e le proprietà CSS che la disegnano, come i caratteri o il
/// riempimento e il contorno.
export interface MenuSample {
  readonly text: string;
  readonly css: Readonly<Record<string, string>>;
}

export interface ContextMenuOptions {
  /// Notifica chi ha aperto il menu anche quando lo chiude un gesto esterno
  /// (Escape, click fuori o una seconda superficie).
  onClose?: () => void;
  /// Lega il menu al suo trigger per i lettori di schermo.
  labelledBy?: string;
}

type MenuClose = () => void;

/// Quanto vive il menu aperto, se ce n'è uno.
///
/// Una `Lifetime` e non più «la funzione che scioglie la trappola»: quella era una
/// delle tre cose da disfare, e le altre due — il nodo e l'ascoltatore sul
/// documento — erano scritte altrove, ognuna con la sua occasione di essere
/// dimenticata. Adesso il posto è uno, e chiudere il menu è chiuderlo.
let menuLifetime: Lifetime | null = null;
let menuClose: MenuClose | null = null;

/// Apre il menu `items` nel punto del gesto `at`, o sotto il pulsante `at`
/// che lo apre: allora gli sta allineato, e dove sotto non c'è posto si apre
/// sopra, senza mai coprirlo.
export function showContextMenu(
  at: MouseEvent | HTMLElement,
  items: MenuItem[],
  options: ContextMenuOptions = {},
): void {
  closeContextMenu();
  const previous = document.getElementById("context-menu");
  if (previous) finishSurface(previous);
  const lifetime = openLifetime();
  menuLifetime = lifetime;
  menuClose = options.onClose ?? null;
  const menu = document.createElement("div");
  menu.id = "context-menu";
  menu.className = "context-menu";
  // Un menu è un menu: il ruolo è ciò che fa annunciare «menu, cinque voci» e
  // permette di uscirne sapendo di esserci entrati.
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-orientation", "vertical");
  if (options.labelledBy) menu.setAttribute("aria-labelledby", options.labelledBy);
  menu.tabIndex = -1;
  // Dove il menu comincia, perché si misuri largo quanto sarà.
  const anchor = at instanceof MouseEvent ? null : at.getBoundingClientRect();
  const [x, y] = at instanceof MouseEvent ? [at.clientX, at.clientY] : [anchor!.left, anchor!.bottom + ANCHOR_GAP];
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const buttons: HTMLButtonElement[] = [];
  const usable: MenuItem[] = [];
  const pictured = items.some((item) => item.sample !== undefined || (item.icon !== undefined && icon(item.icon) !== ""));
  for (const item of items) {
    if (item.separator && menu.childElementCount > 0) {
      const rule = document.createElement("div");
      rule.className = "menu-separator";
      rule.setAttribute("role", "separator");
      menu.appendChild(rule);
    }
    const b = document.createElement("button");
    b.setAttribute("role", item.choice ? `menuitem${item.choice}` : "menuitem");
    if (item.choice) b.setAttribute("aria-checked", String(item.checked === true));
    b.tabIndex = -1;
    if (item.swatches?.length) {
      const strip = document.createElement("span");
      strip.className = "menu-swatches";
      strip.setAttribute("aria-hidden", "true");
      for (const color of item.swatches) {
        const swatch = document.createElement("span");
        swatch.className = "menu-swatch";
        swatch.style.background = color;
        strip.append(swatch);
      }
      b.append(strip);
    }
    const glyph = item.sample !== undefined || item.icon === undefined ? null : iconEl(item.icon);
    if (glyph !== null || pictured) {
      const picture = document.createElement("span");
      picture.className = "menu-icon";
      picture.setAttribute("aria-hidden", "true");
      if (glyph !== null) picture.append(glyph);
      if (item.sample !== undefined) {
        const sample = document.createElement("span");
        sample.className = item.sample.text === "" ? "menu-sample menu-sample-box" : "menu-sample";
        sample.textContent = item.sample.text;
        for (const [name, value] of Object.entries(item.sample.css)) sample.style.setProperty(name, value);
        picture.append(sample);
      }
      b.append(picture);
    }
    const label = document.createElement("span");
    label.className = "menu-label";
    label.textContent = item.label;
    if (item.description) {
      const body = document.createElement("span");
      body.className = "menu-body";
      const description = document.createElement("span");
      description.className = "menu-description";
      description.textContent = item.description;
      body.append(label, description);
      b.append(body);
    } else {
      b.append(label);
    }
    if (item.choice) {
      const check = document.createElement("span");
      check.className = "menu-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = item.checked ? "✓" : "";
      b.append(check);
    }
    if (item.hint) {
      const hint = document.createElement("kbd");
      hint.className = "menu-hint";
      hint.textContent = item.hint;
      b.append(hint);
      b.setAttribute("aria-keyshortcuts", item.hint);
    }
    if (item.danger) b.className = "danger";
    if (item.disabled) {
      b.setAttribute("aria-disabled", "true");
      menu.appendChild(b);
      continue;
    }
    // L'attivazione da tastiera passa dal click nativo del button (Invio/Spazio):
    // nessun gestore keydown qui, così il browser osserva esattamente un click
    // e l'azione resta una sola grazie alla guardia in `activate`.
    b.addEventListener("click", () => activate(b, item));
    buttons.push(b);
    usable.push(item);
    menu.appendChild(b);
  }
  const initial = Math.max(
    0,
    usable.findIndex((item) => item.selected),
  );
  let active = usable.length > 0 && usable[initial]?.selected ? initial : 0;
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
    // Una voce già chiusa non deve rispondere a click tardivi.
    if (menuLifetime !== lifetime) return;
    if (document.activeElement !== button) button.focus();
    closeContextMenu();
    item.run();
  }
  const workspace = document.getElementById("workspace");
  (workspace ?? document.body).appendChild(menu);
  if (anchor === null) placeInViewport(menu, x, y);
  else placeBeside(menu, anchor);
  // WebKitGTK può terminare il processo web mentre fotografa in una View
  // Transition un menu fisso appena inserito. Conserviamo l'animazione CSS
  // canonica, senza portare questa superficie effimera nel percorso nativo.
  lifetime.add(() => exitSurface(menu, () => menu.remove(), { viewTransition: false }));
  enterSurface(menu, { viewTransition: false });
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
/// Un menu aperto vicino al bordo resta dentro la finestra: si ribalta a
/// sinistra o in alto invece di uscire, e un elenco lungo scorre.
function placeInViewport(menu: HTMLElement, x: number, y: number): void {
  const margin = 8;
  const box = menu.getBoundingClientRect();
  const width = box.width;
  const height = Math.min(box.height, window.innerHeight - 2 * margin);
  let left = x;
  let top = y;
  if (left + width > window.innerWidth - margin) left = Math.max(margin, x - width);
  if (top + height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - margin - height);
  menu.style.left = `${Math.max(margin, left)}px`;
  menu.style.top = `${Math.max(margin, top)}px`;
}

/// Quanto un menu sta staccato dal pulsante che lo apre.
const ANCHOR_GAP = 4;

/// Un menu aperto da un pulsante gli sta sotto, allineato a sinistra, o a
/// destra dove a sinistra uscirebbe dalla finestra. Se sotto non c'è posto e
/// sopra ce n'è di più, si apre sopra; dalla parte dove si apre, un elenco più
/// alto del posto scorre. Il pulsante resta sempre visibile, perché è lì che
/// si guarda e che torna il fuoco.
function placeBeside(menu: HTMLElement, anchor: DOMRectReadOnly): void {
  const margin = 8;
  const box = menu.getBoundingClientRect();
  const below = window.innerHeight - margin - (anchor.bottom + ANCHOR_GAP);
  const above = anchor.top - ANCHOR_GAP - margin;
  let top = anchor.bottom + ANCHOR_GAP;
  let room = below;
  if (box.height > below && above > below) {
    room = above;
    top = anchor.top - ANCHOR_GAP - Math.min(box.height, above);
  }
  if (box.height > room) menu.style.maxHeight = `${Math.max(0, room)}px`;
  let left = anchor.left;
  if (left + box.width > window.innerWidth - margin) left = anchor.right - box.width;
  menu.style.left = `${Math.max(margin, left)}px`;
  menu.style.top = `${top}px`;
}

export function closeContextMenu(): void {
  const lifetime = menuLifetime;
  const notify = menuClose;
  menuLifetime = null;
  menuClose = null;
  // La superficie può restare nel DOM durante l'uscita animata: togliere subito
  // il riferimento evita un `aria-labelledby` nel vuoto se il trigger viene
  // smontato nello stesso giro.
  document.getElementById("context-menu")?.removeAttribute("aria-labelledby");
  lifetime?.close();
  // Notifica dopo la chiusura della superficie: trapFocus ha così già rimesso
  // il fuoco sul trigger. La variabile globale è stata azzerata prima, quindi
  // il callback può chiamare closeContextMenu senza riaprire il ciclo.
  notify?.();
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
  // Il selettore di icona è la stessa specie di superficie fissa effimera.
  lifetime.add(() => exitSurface(pop, () => pop.remove(), { viewTransition: false }));
  enterSurface(pop, { viewTransition: false });
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

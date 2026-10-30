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
import { enterSurface, exitSurface } from "./motion";

export interface MenuItem {
  label: string;
  /// Voce distruttiva: la si distingue perché sia difficile sbagliarla.
  danger?: boolean;
  /// Voce da cui far partire il fuoco quando il menu si apre.
  selected?: boolean;
  /// Una riga di separazione prima della voce: raggruppa i gesti affini.
  separator?: boolean;
  /// Il nome del gruppo di voci che comincia qui, per chi ascolta: le voci
  /// consecutive con lo stesso nome stanno in un `role="group"` con quel nome,
  /// e un gruppo nuovo porta con sé la sua riga di separazione.
  group?: string;
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
  /// La voce apre un altro menu al posto di questo: la freccia lo dice a chi
  /// guarda, `aria-haspopup` a chi ascolta.
  submenu?: boolean;
  /// Le voci di un sottomenu a cascata, o chi le prepara quando serve. Col
  /// mouse si apre di lato (→ e il passaggio del puntatore lo aprono, ← lo
  /// chiude); con un puntatore grossolano, il dito, si apre al posto del menu,
  /// con una prima voce per tornare indietro. La voce non ha bisogno di `run`.
  items?: readonly MenuItem[] | (() => Promise<readonly MenuItem[]>);
  run?: () => void;
}

/// L'anteprima di una voce: un testo breve, come «Aa», o niente per un
/// quadratino; e le proprietà CSS che la disegnano, come i caratteri o il
/// riempimento e il contorno.
export interface MenuSample {
  readonly text: string;
  readonly css: Readonly<Record<string, string>>;
}

/// Un punto della finestra da cui aprire il menu, quando non c'è un gesto del
/// mouse: il tasto Menu, Maiusc+F10, un comando.
export interface MenuPoint {
  readonly x: number;
  readonly y: number;
}

export interface ContextMenuOptions {
  /// Notifica chi ha aperto il menu anche quando lo chiude un gesto esterno
  /// (Escape, click fuori o una seconda superficie).
  onClose?: () => void;
  /// Lega il menu al suo trigger per i lettori di schermo.
  labelledBy?: string;
  /// Una barra di controlli sopra il menu, nella stessa superficie: la
  /// mini-barra di formato. Chi la passa la monta nel contenitore e torna come
  /// smontarla; vive quanto il menu. Il fuoco parte dal menu, Tab passa dall'uno
  /// all'altra, Escape chiude tutti e due.
  strip?: (host: HTMLElement) => () => void;
  /// Il nome della barra per chi ascolta.
  stripLabel?: string;
  /// Il menu l'ha aperto il puntatore: il fuoco va al menu e non a una voce,
  /// che altrimenti avrebbe l'anello della tastiera e sembrerebbe già scelta;
  /// la prima freccia sceglie la prima voce. Senza, lo dice l'evento: il tasto
  /// destro del mouse sì, il tasto Menu, Maiusc+F10 e un clic sintetico no.
  pointer?: boolean;
  /// Che cosa si è toccato: la testata in cima, che non si sceglie e dà il
  /// nome al menu.
  header?: MenuHeader;
  /// Taglia, Copia, Incolla: con almeno due voci stanno in una riga di
  /// pulsanti in cima; con una sola, quella è la prima voce.
  clipboard?: readonly MenuItem[];
  /// Le voci che non stanno nel menu: si trovano scrivendo.
  searchable?: readonly MenuItem[];
  /// Scrivere filtra le voci, col piede che lo dice. Di serie sì nei menu
  /// aperti in un punto; un menu a tendina va invece all'iniziale.
  search?: boolean;
}

/// La testata: l'icona e il tipo dell'oggetto, poi il suo nome.
export interface MenuHeader {
  readonly icon?: string;
  readonly kind: string;
  readonly name?: string;
}

/// Chi cerca fra tutti i comandi quando le voci del menu non bastano, e il
/// tasto che lo fa da fuori.
export interface MenuSearch {
  run(query: string): void;
  hint(): string;
}

let menuSearch: MenuSearch | null = null;

/// Registra chi cerca fra tutti i comandi; torna come ritirarlo.
export function registerMenuSearch(search: MenuSearch): () => void {
  menuSearch = search;
  return () => {
    if (menuSearch === search) menuSearch = null;
  };
}

/// Le voci in più del menu principale: testata, appunti, ricerca.
interface Chrome {
  readonly header?: MenuHeader;
  readonly clipboard: readonly MenuItem[];
  readonly searchable: readonly MenuItem[];
  readonly search: boolean;
}

/// Quante voci trovate mostra la ricerca, come il tetto di un menu.
const SEARCH_LIMIT = 9;

/// Il confronto della ricerca: minuscole e senza accenti.
const fold = (text: string): string => text.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/// Una voce trovata scrivendo e il sottomenu da cui viene.
interface Row {
  readonly item: MenuItem;
  readonly path?: string;
}

/// Le voci che si possono scegliere, sottomenu compresi, col loro percorso.
/// Un sottomenu preparato quando serve conta se è già pronto.
function flatten(items: readonly MenuItem[], ready: ReadonlyMap<MenuItem, readonly MenuItem[]>, path = ""): Row[] {
  const out: Row[] = [];
  for (const item of items) {
    if (item.disabled) continue;
    const children = Array.isArray(item.items) ? item.items : ready.get(item);
    if (item.items !== undefined) {
      if (children) out.push(...flatten(children, ready, path ? `${path} › ${item.label}` : item.label));
      continue;
    }
    out.push(path ? { item, path } : { item });
  }
  return out;
}

/// Un `contextmenu` o un clic del puntatore, non della tastiera: il tasto Menu
/// e Maiusc+F10 non hanno il tasto destro, o non hanno un punto.
function byPointer(at: MouseEvent | HTMLElement | MenuPoint): boolean {
  if (!(at instanceof MouseEvent)) return false;
  if (at.clientX === 0 && at.clientY === 0) return false;
  return at.type === "contextmenu" ? at.button === 2 : at.detail > 0;
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

/// Quanto aspetta il puntatore su una voce prima che il suo sottomenu si apra,
/// o che quello aperto si chiuda: abbastanza per non aprire tutto ciò che si
/// attraversa, poco perché non sembri lento.
const HOVER_DELAY = 100;

/// Quanto si aspetta ancora quando il puntatore va verso il sottomenu aperto:
/// il tempo di attraversare in diagonale le voci che ci stanno in mezzo.
const AIM_DELAY = 300;

interface Point {
  readonly x: number;
  readonly y: number;
}

/// Il puntatore, andato da `from` a `to`, sta mirando al sottomenu `target`?
/// Sì se `to` cade nel triangolo fra `from` e i due angoli del lato del
/// sottomenu rivolto al menu: la mira di macOS, al posto di un ritardo uguale
/// per tutti.
export function aimsAt(from: Point, to: Point, target: DOMRectReadOnly): boolean {
  const edge = from.x <= target.left ? target.left : target.right;
  if (to.x === from.x && to.y === from.y) return false;
  const a = { x: edge, y: target.top };
  const b = { x: edge, y: target.bottom };
  const side = (p: Point, q: Point, r: Point): number => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(from, a, to);
  const d2 = side(a, b, to);
  const d3 = side(b, from, to);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/// Il punto da cui aprire un menu che non nasce da un click: sotto la
/// selezione o il cursore, allineato al suo inizio. Mai in 0,0.
export function menuPointFor(box: { readonly left: number; readonly bottom: number }): MenuPoint {
  return { x: Math.round(box.left), y: Math.round(box.bottom) + ANCHOR_GAP };
}

/// Apre il menu `items` nel punto del gesto `at`, o sotto il pulsante `at`
/// che lo apre: allora gli sta allineato, e dove sotto non c'è posto si apre
/// sopra, senza mai coprirlo.
export function showContextMenu(
  at: MouseEvent | HTMLElement | MenuPoint,
  items: readonly MenuItem[],
  options: ContextMenuOptions = {},
): void {
  closeContextMenu();
  const lifetime = openLifetime();
  menuLifetime = lifetime;
  menuClose = options.onClose ?? null;
  // Dove il menu comincia, perché si misuri largo quanto sarà.
  const anchor = at instanceof HTMLElement ? at.getBoundingClientRect() : null;
  const [x, y] = at instanceof MouseEvent ? [at.clientX, at.clientY] : anchor ? [anchor.left, anchor.bottom + ANCHOR_GAP] : [(at as MenuPoint).x, (at as MenuPoint).y];
  // Col dito un sottomenu prende il posto del menu, e il menu di prima è la
  // prima voce: si riapre nello stesso punto.
  const replaceWith = async (item: MenuItem): Promise<void> => {
    const children = await itemsOf(item);
    if (menuLifetime !== lifetime) return;
    const back: MenuItem = { label: `‹ ${item.label}`, run: () => showContextMenu({ x, y }, items, options) };
    showContextMenu({ x, y }, [back, ...children], { ...options, strip: undefined });
  };
  const pointer = options.pointer ?? byPointer(at);
  const clipboard = options.clipboard ?? [];
  const chrome: Chrome = {
    header: options.header,
    clipboard: clipboard.length >= 2 ? clipboard : [],
    searchable: options.searchable ?? [],
    search: options.search ?? anchor === null,
  };
  const root = renderMenu(clipboard.length === 1 ? [clipboard[0]!, ...items] : items, lifetime, replaceWith, chrome);
  const menu = root.menu;
  menu.id = "context-menu";
  if (options.labelledBy) menu.setAttribute("aria-labelledby", options.labelledBy);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const workspace = document.getElementById("workspace");
  (workspace ?? document.body).appendChild(menu);
  if (anchor === null) placeInViewport(menu, x, y);
  else placeBeside(menu, anchor);
  // WebKitGTK può terminare il processo web mentre fotografa in una View
  // Transition un menu fisso appena inserito. Conserviamo l'animazione CSS
  // canonica, senza portare questa superficie effimera nel percorso nativo.
  lifetime.add(() => exitSurface(menu, () => menu.remove()));
  // La barra si misura sul menu fermo: a entrata cominciata il suo riquadro è
  // già scalato, e la barra resterebbe dove il menu era al primo fotogramma.
  const strip = options.strip ? mountStrip(menu, options, lifetime) : null;
  enterSurface(menu);
  // Il primo click fuori chiude, e il ritardo evita che sia questo stesso click
  // ad attivarlo. Il `once` **non** bastava: se il menu si chiudeva prima —
  // Escape, o una voce scelta da tastiera — l'ascoltatore non era ancora
  // registrato, e si registrava un istante dopo su un menu che non c'era più.
  // Restava lì fino al prossimo click qualunque, che chiudeva un menu inesistente
  // e, se nel frattempo se n'era aperto un altro, chiudeva quello. Su una vita
  // già chiusa `ascolta` non fa niente, e il caso non è da ricordarsi: non c'è.
  if (strip !== null) stripTabs(menu, strip, () => root.focusActive(), lifetime);
  lifetime.add(trapFocus(menu, closeContextMenu));
  // `trapFocus` conserva e ripristina il fuoco precedente; il fuoco operativo
  // del menu, però, è una sola voce, secondo la regola del roving tabindex.
  // Aperto dal puntatore, il fuoco sta nel menu finché una freccia non sceglie.
  if (pointer) root.menu.focus({ preventScroll: true });
  else root.focusActive();
  // Un click nella barra o in un menu, invece, è un gesto dentro la superficie:
  // la barra lavora coi suoi controlli, una voce chiude da sé quando agisce, e
  // quella di un sottomenu lo apre.
  const outside = (e: MouseEvent): void => {
    const target = e.target as Element | null;
    if (target instanceof Element && target.closest(".context-menu, .context-strip, [data-menu-keep]")) return;
    closeContextMenu();
  };
  setTimeout(() => lifetime.listen(document, "click", outside), 0);
}

/// Le voci di un sottomenu, preparate se serve.
async function itemsOf(item: MenuItem): Promise<readonly MenuItem[]> {
  return typeof item.items === "function" ? await item.items() : (item.items ?? []);
}

interface RenderedMenu {
  readonly menu: HTMLElement;
  focusActive(): void;
}

/// Un elenco di voci con la sua navigazione da tastiera: il menu principale e
/// ciascun sottomenu a cascata sono la stessa cosa, cambia solo dove stanno.
function renderMenu(
  items: readonly MenuItem[],
  lifetime: Lifetime,
  replaceWith: (item: MenuItem) => Promise<void>,
  chrome: Chrome | null = null,
): RenderedMenu {
  const menu = document.createElement("div");
  menu.className = "context-menu";
  // Un menu è un menu: il ruolo è ciò che fa annunciare «menu, cinque voci» e
  // permette di uscirne sapendo di esserci entrati.
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-orientation", "vertical");
  menu.tabIndex = -1;
  const buttons: HTMLButtonElement[] = [];
  const usable: MenuItem[] = [];
  // Il sottomenu aperto, se ce n'è uno: la voce da cui parte e come chiuderlo.
  let open: { button: HTMLButtonElement; lifetime: Lifetime; focusFirst: () => void; sub: HTMLElement } | null = null;
  // Dove stava il puntatore al movimento prima e adesso: la mira si legge da qui.
  let pointer: { from: Point; to: Point } | null = null;
  lifetime.listen(menu, "pointermove", (e) => {
    const to = { x: e.clientX, y: e.clientY };
    pointer = { from: pointer?.to ?? to, to };
  });
  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelHover = (): void => {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    hoverTimer = null;
  };
  lifetime.add(cancelHover);
  const closeOpen = (): void => {
    const current = open;
    open = null;
    if (current === null) return;
    current.button.setAttribute("aria-expanded", "false");
    current.lifetime.close();
  };
  lifetime.add(closeOpen);
  const coarse = (): boolean => typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const cascade = async (button: HTMLButtonElement, item: MenuItem, focus: boolean): Promise<void> => {
    if (open?.button === button) {
      if (focus) open.focusFirst();
      return;
    }
    closeOpen();
    const children = await itemsOf(item);
    if (lifetime.closed || !button.isConnected) return;
    closeOpen();
    const childLifetime = openLifetime();
    lifetime.add(() => childLifetime.close());
    const child = renderMenu(children, childLifetime, replaceWith);
    const sub = child.menu;
    sub.classList.add("context-submenu");
    sub.setAttribute("aria-label", item.label);
    sub.style.left = "0px";
    sub.style.top = "0px";
    (menu.parentElement ?? document.body).appendChild(sub);
    placeCascade(sub, button.getBoundingClientRect(), menu.getBoundingClientRect());
    childLifetime.add(() => sub.remove());
    // Un sottomenu lasciato dal puntatore non si chiude finché il puntatore
    // ci sta sopra: la tolleranza diagonale è questa.
    childLifetime.listen(sub, "pointerenter", cancelHover);
    button.setAttribute("aria-expanded", "true");
    const state = { button, lifetime: childLifetime, focusFirst: () => child.focusActive(), sub };
    open = state;
    // ← o Escape tornano alla voce da cui si è entrati: la trappola del
    // sottomenu sta sopra quella del menu, ed Escape chiude solo lei.
    const back = (): void => {
      if (open === state) closeOpen();
      button.focus();
    };
    childLifetime.listen(sub, "keydown", (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    });
    childLifetime.add(trapFocus(sub, back));
    if (focus) child.focusActive();
    else button.focus();
  };
  // Le voci stanno in un elenco loro, fra la testata e gli appunti sopra e il
  // piede sotto: scrivere le sostituisce e il resto non si muove.
  const list = document.createElement("div");
  list.className = "menu-items";
  list.setAttribute("role", "none");
  // La riga degli appunti, se c'è: pulsanti che sono voci del menu, prima
  // delle altre nel giro delle frecce.
  const quick: HTMLButtonElement[] = [];
  const quickItems: MenuItem[] = [];
  if (chrome?.header) {
    const head = document.createElement("div");
    head.className = "menu-head";
    head.setAttribute("aria-hidden", "true");
    const glyph = chrome.header.icon === undefined ? null : iconEl(chrome.header.icon);
    if (glyph !== null) head.append(glyph);
    const kind = document.createElement("span");
    kind.className = "menu-head-kind";
    kind.textContent = chrome.header.kind;
    head.append(kind);
    if (chrome.header.name) {
      const name = document.createElement("span");
      name.className = "menu-head-name";
      name.textContent = chrome.header.name;
      head.append(name);
    }
    menu.append(head);
    menu.setAttribute("aria-label", chrome.header.name ? `${chrome.header.kind} · ${chrome.header.name}` : chrome.header.kind);
  }
  if (chrome && chrome.clipboard.length > 0) {
    const row = document.createElement("div");
    row.className = "menu-clipboard";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", t("context.clipboard"));
    for (const item of chrome.clipboard) {
      const b = document.createElement("button");
      b.className = "menu-quick";
      b.setAttribute("role", "menuitem");
      b.tabIndex = -1;
      const glyph = item.icon === undefined ? null : iconEl(item.icon);
      if (glyph !== null) {
        glyph.setAttribute("aria-hidden", "true");
        b.append(glyph);
      }
      const label = document.createElement("span");
      label.textContent = item.label;
      b.append(label);
      if (item.hint) b.setAttribute("aria-keyshortcuts", item.hint);
      b.addEventListener("click", () => activate(b, item));
      row.append(b);
      quick.push(b);
      quickItems.push(item);
    }
    menu.append(row);
  }
  menu.append(list);
  // Il piede: invita a scrivere, poi dice che cosa si è scritto e quanto si è
  // trovato. Per chi ascolta parlano le voci trovate, che prendono il fuoco.
  const foot = chrome?.search ? document.createElement("div") : null;
  if (foot !== null) {
    foot.className = "menu-foot";
    foot.setAttribute("aria-hidden", "true");
    menu.append(foot);
  }
  let query = "";
  const drawFoot = (found: number): void => {
    if (foot === null) return;
    const text = document.createElement("span");
    text.className = "menu-foot-text";
    if (query === "") {
      text.textContent = t("context.foot.search");
    } else {
      const typed = document.createElement("span");
      typed.className = "menu-foot-query";
      typed.textContent = query;
      text.append(typed, ` · ${found === 1 ? t("context.foot.one") : t("context.foot.many", { count: String(found) })}`);
    }
    foot.replaceChildren(text);
    const hint = menuSearch?.hint() ?? "";
    if (hint !== "") {
      const kbd = document.createElement("kbd");
      kbd.textContent = hint;
      foot.append(kbd);
    }
  };

  /// Mette nell'elenco le voci `rows`, al posto di quelle di prima.
  function fill(rows: readonly Row[]): void {
    list.replaceChildren();
    buttons.length = 0;
    usable.length = 0;
    buttons.push(...quick);
    usable.push(...quickItems);
    const pictured = rows.some(({ item }) => item.sample !== undefined || (item.icon !== undefined && icon(item.icon) !== ""));
    let group = null as { name: string; node: HTMLElement } | null;
    for (const { item, path } of rows) {
      // Un gruppo con un nome è un `role="group"` per chi ascolta e una riga per
      // chi guarda; una riga semplice chiude il gruppo aperto.
      const named = item.group ?? null;
      if (named !== (group?.name ?? null) || item.separator) {
        if (list.childElementCount > 0 && (item.separator || named !== null || group !== null)) {
          const rule = document.createElement("div");
          rule.className = "menu-separator";
          rule.setAttribute("role", "separator");
          list.appendChild(rule);
        }
        group = null;
        if (named !== null) {
          const node = document.createElement("div");
          node.className = "menu-group";
          node.setAttribute("role", "group");
          node.setAttribute("aria-label", named);
          list.appendChild(node);
          group = { name: named, node };
        }
      }
      const host = group?.node ?? list;
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
      if (path) {
        const trail = document.createElement("span");
        trail.className = "menu-path";
        trail.textContent = `${path} ›`;
        b.append(trail);
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
      const nested = item.items !== undefined;
      if (item.submenu || nested) {
        const more = document.createElement("span");
        more.className = "menu-hint menu-more";
        more.setAttribute("aria-hidden", "true");
        more.textContent = "›";
        b.append(more);
        b.setAttribute("aria-haspopup", "menu");
        if (nested) b.setAttribute("aria-expanded", "false");
      }
      if (item.danger) b.className = "danger";
      // Il passaggio del puntatore: su una voce con un sottomenu lo apre, su
      // un'altra chiude quello aperto. Sempre dopo una pausa breve, e più lunga
      // se il puntatore sta andando verso il sottomenu aperto: attraversa, non
      // sceglie.
      b.addEventListener("pointerenter", (e) => {
        if (e.pointerType === "touch") return;
        cancelHover();
        const aiming = open !== null && open.button !== b && pointer !== null &&
          aimsAt(pointer.from, { x: e.clientX, y: e.clientY }, open.sub.getBoundingClientRect());
        hoverTimer = setTimeout(() => {
          hoverTimer = null;
          if (nested && !item.disabled) void cascade(b, item, false);
          else if (open !== null && open.button !== b) closeOpen();
        }, aiming ? AIM_DELAY : HOVER_DELAY);
      });
      if (item.disabled) {
        b.setAttribute("aria-disabled", "true");
        host.appendChild(b);
        continue;
      }
      // L'attivazione da tastiera passa dal click nativo del button (Invio/Spazio):
      // nessun gestore keydown qui, così il browser osserva esattamente un click
      // e l'azione resta una sola grazie alla guardia in `activate`.
      b.addEventListener("click", () => activate(b, item));
      buttons.push(b);
      usable.push(item);
      host.appendChild(b);
    }
  }
  fill(items.map((item) => ({ item })));
  drawFoot(0);
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
  // La fermata del roving tabindex c'è da subito, anche quando il fuoco resta
  // al menu: Tab e il ritorno dal sottomenu trovano la voce attiva.
  if (buttons[active]) buttons[active].tabIndex = 0;
  const move = (delta: number): void => {
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    // Nessuna voce col fuoco (il menu aperto dal puntatore): giù va alla voce
    // attiva, su a quella prima, e dalla prima all'ultima.
    if (at < 0) focusItem(delta > 0 ? active : active - 1);
    else focusItem(at + delta);
  };
  // La ricerca per iniziale: una lettera porta alla prossima voce che comincia
  // così, e ripeterla scorre fra quelle che cominciano uguale.
  const initialOf = (text: string): string =>
    text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^[^\p{L}\p{N}]+/u, "").charAt(0).toLocaleLowerCase();
  const typeahead = (key: string): boolean => {
    const wanted = initialOf(key);
    if (wanted === "") return false;
    for (let step = 1; step <= buttons.length; step++) {
      const index = (active + step) % buttons.length;
      if (initialOf(usable[index]!.label) === wanted) {
        focusItem(index);
        return true;
      }
    }
    return false;
  };
  const onKey = (e: KeyboardEvent): void => {
    // Il tasto arriva anche dai sottomenu, che stanno fuori del menu nel DOM ma
    // non nell'albero degli eventi: risponde solo il menu in cui è nato.
    if (!(e.target instanceof Node) || !menu.contains(e.target)) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at >= 0) active = at;
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
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && at >= 0 && at < quick.length) {
      // Dentro la riga degli appunti le frecce di lato vanno da un pulsante
      // all'altro, e si fermano agli estremi.
      e.preventDefault();
      focusItem(Math.min(quick.length - 1, Math.max(0, at + (e.key === "ArrowRight" ? 1 : -1))));
    } else if (e.key === "ArrowRight") {
      const item = usable[active];
      if (item?.items !== undefined) {
        e.preventDefault();
        if (coarse()) void replaceWith(item);
        else void cascade(buttons[active]!, item, true);
      }
    } else if (chrome?.search && e.key === "Backspace" && query !== "") {
      e.preventDefault();
      search(query.slice(0, -1));
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Lo spazio sceglie la voce col fuoco, finché non si sta scrivendo.
      if (chrome?.search) {
        if (e.key === " " && query === "") return;
        e.preventDefault();
        search(query + e.key);
      } else if (e.key !== " " && typeahead(e.key)) {
        e.preventDefault();
      }
    }
  };
  menu.addEventListener("keydown", onKey);
  lifetime.add(() => menu.removeEventListener("keydown", onKey));
  // Esc svuota la ricerca prima di chiudere: la trappola del fuoco ascolta in
  // cattura sul documento, e questo ascolta prima di lei, sulla finestra.
  if (chrome?.search) {
    lifetime.listen(
      window,
      "keydown",
      (e) => {
        if (e.key !== "Escape" || query === "" || !(e.target instanceof Node) || !menu.contains(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        search("");
      },
      { capture: true },
    );
  }
  // I sottomenu preparati quando servono si preparano alla prima lettera, e la
  // ricerca li guarda appena sono pronti.
  const ready = new Map<MenuItem, readonly MenuItem[]>();
  let preparing = false;
  const prepare = (): void => {
    if (preparing) return;
    preparing = true;
    const pending = [...items, ...(chrome?.searchable ?? [])].filter((item) => typeof item.items === "function");
    for (const item of pending) {
      void itemsOf(item).then((children) => {
        if (lifetime.closed) return;
        ready.set(item, children);
        if (query !== "") search(query);
      });
    }
  };

  /// Filtra le voci con `text`: le trovate al posto del menu, col loro
  /// percorso, e la prima col fuoco; niente scritto, il menu com'era.
  function search(text: string): void {
    query = text;
    closeOpen();
    if (query === "") {
      fill(items.map((item) => ({ item })));
      drawFoot(0);
      focusItem(quick.length);
      return;
    }
    prepare();
    const wanted = fold(query);
    const hits = flatten([...items, ...(chrome?.searchable ?? [])], ready).filter(
      ({ item, path }) => fold(item.label).includes(wanted) || (path !== undefined && fold(path).includes(wanted)),
    );
    // Trovate, le voci perdono i gruppi: è un elenco solo.
    const rows: Row[] = hits.slice(0, SEARCH_LIMIT).map(({ item, path }) => ({ item: { ...item, group: undefined, separator: undefined, selected: false }, path }));
    const all = menuSearch;
    if (rows.length === 0 && all !== null) {
      const typed = query;
      rows.push({ item: { label: t("context.search.all", { query: typed }), run: () => all.run(typed) } });
    }
    fill(rows);
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "menu-empty";
      empty.setAttribute("aria-hidden", "true");
      empty.textContent = t("context.search.none");
      list.append(empty);
    }
    drawFoot(hits.length);
    if (buttons.length > quick.length) focusItem(quick.length);
    else menu.focus({ preventScroll: true });
  }
  function activate(button: HTMLButtonElement, item: MenuItem): void {
    // Una voce già chiusa non deve rispondere a click tardivi.
    if (lifetime.closed) return;
    if (item.items !== undefined) {
      cancelHover();
      if (coarse()) void replaceWith(item);
      else void cascade(button, item, true);
      return;
    }
    if (document.activeElement !== button) button.focus();
    closeContextMenu();
    item.run?.();
  }
  return { menu, focusActive: () => focusItem(active) };
}

/// La mini-barra sopra il menu: un contenitore che chi apre il menu riempie, e
/// che sta sopra il menu o, dove sopra non c'è posto, sotto.
function mountStrip(menu: HTMLElement, options: ContextMenuOptions, lifetime: Lifetime): HTMLElement {
  const strip = document.createElement("div");
  strip.className = "context-strip";
  strip.setAttribute("role", "toolbar");
  if (options.stripLabel) strip.setAttribute("aria-label", options.stripLabel);
  (menu.parentElement ?? document.body).appendChild(strip);
  const unmount = options.strip!(strip);
  lifetime.add(() => {
    unmount();
    exitSurface(strip, () => strip.remove());
  });
  placeStrip(strip, menu.getBoundingClientRect());
  enterSurface(strip);
  return strip;
}

/// Tab fra il menu e la sua barra: dal menu si entra nella barra, dagli estremi
/// della barra si torna al menu. La trappola del menu riporterebbe dentro il
/// menu ogni fuoco che ne esce, e per questo il tasto si ferma qui, prima di lei.
function stripTabs(menu: HTMLElement, strip: HTMLElement, focusMenu: () => void, lifetime: Lifetime): void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== "Tab") return;
    const current = document.activeElement;
    const controls = focusableElements(strip);
    if (controls.length === 0) return;
    if (menu.contains(current)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      (e.shiftKey ? controls[controls.length - 1] : controls[0])!.focus();
      return;
    }
    if (!strip.contains(current)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const at = controls.indexOf(current as HTMLElement);
    const next = at + (e.shiftKey ? -1 : 1);
    if (next < 0 || next >= controls.length) focusMenu();
    else controls[next]!.focus();
  };
  lifetime.listen(document, "keydown", onKey, { capture: true });
}

/// I controlli della barra raggiungibili col Tab.
function focusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, select, input, [tabindex]")].filter(
    (node) => !(node as HTMLButtonElement).disabled && node.tabIndex >= 0 && node.getAttribute("aria-hidden") !== "true",
  );
}

/// La barra sopra il menu, allineata al suo lato sinistro; sotto se sopra
/// esce dalla finestra.
function placeStrip(strip: HTMLElement, menu: DOMRectReadOnly): void {
  const margin = 8;
  const box = strip.getBoundingClientRect();
  let top = menu.top - ANCHOR_GAP - box.height;
  if (top < margin) top = menu.bottom + ANCHOR_GAP;
  let left = menu.left;
  if (left + box.width > window.innerWidth - margin) left = window.innerWidth - margin - box.width;
  strip.style.left = `${Math.max(margin, left)}px`;
  strip.style.top = `${Math.max(margin, top)}px`;
}

/// Un sottomenu sta accanto alla sua voce, a destra del menu o a sinistra
/// dove a destra esce, con la prima voce sulla riga della voce che lo apre.
function placeCascade(sub: HTMLElement, button: DOMRectReadOnly, parent: DOMRectReadOnly): void {
  const margin = 8;
  const box = sub.getBoundingClientRect();
  let left = parent.right - 2;
  if (left + box.width > window.innerWidth - margin) left = Math.max(margin, parent.left - box.width + 2);
  const height = Math.min(box.height, window.innerHeight - 2 * margin);
  let top = button.top - 4;
  if (top + height > window.innerHeight - margin) top = window.innerHeight - margin - height;
  sub.style.left = `${Math.max(margin, left)}px`;
  sub.style.top = `${Math.max(margin, top)}px`;
}

/// Il menu cresce dal punto `x`,`y` della finestra, anche quando il bordo l'ha
/// spinto sopra o a sinistra del puntatore: l'origine è quel punto, dentro il
/// menu.
function growFrom(menu: HTMLElement, left: number, top: number, x: number, y: number): void {
  const box = menu.getBoundingClientRect();
  const originX = Math.min(Math.max(x - left, 0), box.width);
  const originY = Math.min(Math.max(y - top, 0), box.height);
  menu.style.transformOrigin = `${Math.round(originX)}px ${Math.round(originY)}px`;
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
  growFrom(menu, Math.max(margin, left), Math.max(margin, top), x, y);
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
  // Dal lato del pulsante: sotto cresce dal bordo alto, sopra dal basso.
  growFrom(menu, Math.max(margin, left), top, anchor.left, top > anchor.top ? anchor.bottom : anchor.top);
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

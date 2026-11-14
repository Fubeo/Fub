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
import { figureLabel, figureValue, PAGE_FIGURES } from "./page-mark";
import { enterSurface, exitSurface } from "./motion";
import { DURATION, enter, flip, motionLevel, stagger } from "../moto";

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
  /// Il nome del menu per chi ascolta, quando il trigger dice meno («Comandi»
  /// apre «Tutti i comandi del foglio»): prende il posto di `labelledBy`.
  label?: string;
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
  /// La ricerca guarda tutto l'albero: nessun tetto alle voci trovate, i
  /// sottomenu preparati quando servono anche se annidati, e le voci spente
  /// dopo le accese, con la loro descrizione (il perché). Niente rimando alla
  /// ricerca fra tutti i comandi: chi non trova niente legge che non c'è
  /// niente. Una lettera scritta in un sottomenu cerca dal menu principale.
  fullSearch?: boolean;
  /// Le voci spente si raggiungono con le frecce, con `aria-disabled`, e
  /// non si attivano: chi ascolta sente il perché nella loro descrizione.
  reachDisabled?: boolean;
}

/// Il menu aperto, per chi l'ha aperto: le voci si cambiano senza chiuderlo,
/// tenendo il fuoco e il sottomenu aperto dove stavano.
export interface ContextMenuHandle {
  update(items: readonly MenuItem[]): void;
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
  /// Cerca `query` nel vault o fra i tag: «Cerca nel vault», «Cerca le note
  /// con questo tag», «Mostra nel pannello dei tag».
  find?(where: MenuFind, query: string): void;
}

/// Dove cerca una voce del menu che porta fuori di lui.
export type MenuFind = "vault" | "tags";

let menuSearch: MenuSearch | null = null;

/// Registra chi cerca fra tutti i comandi; torna come ritirarlo.
export function registerMenuSearch(search: MenuSearch): () => void {
  menuSearch = search;
  return () => {
    if (menuSearch === search) menuSearch = null;
  };
}

/// Si può cercare nel vault o fra i tag da un menu, adesso.
export function canMenuFind(): boolean {
  return menuSearch?.find !== undefined;
}

/// Cerca `query` dove dice `where`; `false` se nessuno sa cercare.
export function menuFind(where: MenuFind, query: string): boolean {
  if (menuSearch?.find === undefined) return false;
  menuSearch.find(where, query);
  return true;
}

/// Le voci in più del menu principale: testata, appunti, ricerca.
interface Chrome {
  readonly header?: MenuHeader;
  readonly clipboard: readonly MenuItem[];
  readonly searchable: readonly MenuItem[];
  readonly search: boolean;
  readonly full: boolean;
}

/// Ciò che il menu principale passa ai suoi sottomenu.
interface Reach {
  /// Le voci spente prendono il fuoco.
  readonly disabled: boolean;
  /// Una lettera scritta in un sottomenu va alla ricerca del menu principale.
  readonly typed: ((key: string) => void) | null;
}

/// Quante voci trovate mostra la ricerca, come il tetto di un menu.
const SEARCH_LIMIT = 9;

/// Il confronto della ricerca: minuscole e senza accenti.
const fold = (text: string): string => text.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/// Una voce trovata scrivendo e il sottomenu da cui viene.
interface Row {
  readonly item: MenuItem;
  readonly path?: string;
  /// Il gruppo che comincia qui si vede col suo nome, come «Altri comandi».
  readonly heading?: boolean;
}

/// Quanto si vede la spunta d'accento di una parte premuta prima che il menu
/// si chiuda e il gesto si faccia.
const PRESS_MS = 200;

/// L'entrata del menu aperto in un punto: nasce dal punto del clic, e come
/// ogni moto del menu sta sotto un quinto di secondo.
const POINT_ENTER_MS = 180;
const ENTER_EASING = "cubic-bezier(0.2, 0.85, 0.25, 1)";

/// Testata, appunti e voci arrivano una dopo l'altra, a questa distanza; oltre
/// le prime `PART_STAGGER_MAX` le altre arrivano insieme, perché l'entrata
/// intera resti sotto un quinto di secondo.
const PART_STAGGER_MS = 15;
const PART_STAGGER_MAX = 5;

/// Quanto ci mettono a scivolare la pastiglia della scelta da una voce
/// all'altra, e la linguetta da una parte all'altra della barra: a tempo, non
/// a molla, perché la coda di una molla supererebbe il quinto di secondo.
const GLIDE_MS = 150;
const TAB_GLIDE_MS = 200;

/// Di quanto scivola un sottomenu che entra, da destra, o torna, da sinistra.
const SUB_SHIFT = 12;

/// I segni dei formati che una scelta in riga sa disegnare (`icons.ts`).
const SIGNS: ReadonlySet<string> = new Set(["copy-markdown", "copy-html", "copy-text"]);

/// Il segno di una scelta: la sua icona, se è uno dei segni dei formati, o
/// quello del formato che il suo nome dice. Le superfici di oggi dichiarano
/// «Copia come ▸» senza icone (`SurfaceMenuItem`), e i nomi dei formati sono
/// quelli del catalogo.
function signOf(item: MenuItem): string | null {
  if (item.icon !== undefined && SIGNS.has(item.icon)) return item.icon;
  const named = new Map<string, string>([
    [t("editor_menu.copy_as.markdown"), "copy-markdown"],
    [t("editor_menu.copy_as.html"), "copy-html"],
    [t("editor_menu.copy_as.text"), "copy-text"],
  ]);
  return named.get(item.label) ?? null;
}

/// Le scelte di una voce che le tiene nella riga invece che in un sottomenu:
/// due o tre, ognuna un gesto semplice col suo segno riconoscibile. Altrimenti
/// `null`, e resta il sottomenu.
function optionsOf(item: MenuItem): readonly MenuItem[] | null {
  if (item.disabled || !Array.isArray(item.items)) return null;
  const options = item.items as readonly MenuItem[];
  if (options.length < 2 || options.length > 3) return null;
  const plain = options.every((option) =>
    option.items === undefined && !option.submenu && !option.choice && !option.disabled && option.run !== undefined && signOf(option) !== null);
  return plain ? options : null;
}

/// Come entra il prossimo menu aperto da qui: col dito un sottomenu prende il
/// posto del menu ed entra da destra, e il menu di prima torna da sinistra.
let nextEntry: "forward" | "back" | null = null;

/// Le voci che si possono scegliere, sottomenu compresi, col loro percorso.
/// Un sottomenu preparato quando serve conta se è già pronto. Con `disabled`
/// ci sono anche le voci spente, e i sottomenu spenti si attraversano.
function flatten(items: readonly MenuItem[], ready: ReadonlyMap<MenuItem, readonly MenuItem[]>, path = "", disabled = false): Row[] {
  const out: Row[] = [];
  for (const item of items) {
    if (item.disabled && !disabled) continue;
    const children = Array.isArray(item.items) ? item.items : ready.get(item);
    if (item.items !== undefined) {
      if (children) out.push(...flatten(children, ready, path ? `${path} › ${item.label}` : item.label, disabled));
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
): ContextMenuHandle {
  closeContextMenu();
  const entry = nextEntry;
  nextEntry = null;
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
    const back: MenuItem = {
      label: `‹ ${item.label}`,
      run: () => {
        nextEntry = "back";
        showContextMenu({ x, y }, items, options);
      },
    };
    nextEntry = "forward";
    showContextMenu({ x, y }, [back, ...children], { ...options, strip: undefined });
  };
  const pointer = options.pointer ?? byPointer(at);
  const clipboard = options.clipboard ?? [];
  const chrome: Chrome = {
    header: options.header,
    clipboard: clipboard.length >= 2 ? clipboard : [],
    searchable: options.searchable ?? [],
    search: options.search ?? anchor === null,
    full: options.fullSearch === true,
  };
  const withClipboard = (list: readonly MenuItem[]): readonly MenuItem[] => (clipboard.length === 1 ? [clipboard[0]!, ...list] : list);
  const root = renderMenu(withClipboard(items), lifetime, replaceWith, chrome, { disabled: options.reachDisabled === true, typed: null });
  const menu = root.menu;
  menu.id = "context-menu";
  // Aperto in un punto (il tasto destro, il tasto Menu): è il menu del posto,
  // che nasce dal punto e fa arrivare le sue parti una dopo l'altra.
  if (anchor === null) menu.classList.add("menu-at-point");
  if (options.label) menu.setAttribute("aria-label", options.label);
  else if (options.labelledBy) menu.setAttribute("aria-labelledby", options.labelledBy);
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const workspace = document.getElementById("workspace");
  (workspace ?? document.body).appendChild(menu);
  if (anchor === null) placeInViewport(menu, x, y);
  else placeBeside(menu, anchor, chrome.full);
  // WebKitGTK può terminare il processo web mentre fotografa in una View
  // Transition un menu fisso appena inserito. Conserviamo l'animazione CSS
  // canonica, senza portare questa superficie effimera nel percorso nativo.
  lifetime.add(() => exitSurface(menu, () => menu.remove()));
  // La barra si misura sul menu fermo: a entrata cominciata il suo riquadro è
  // già scalato, e la barra resterebbe dove il menu era al primo fotogramma.
  const strip = options.strip ? mountStrip(menu, options, lifetime) : null;
  if (anchor === null) enterAtPoint(menu, root.parts(), entry);
  else enterSurface(menu);
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
  return {
    update: (next) => {
      if (lifetime.closed) return;
      items = next;
      root.update(withClipboard(next));
    },
  };
}

/// L'entrata del menu aperto in un punto: cresce dal punto del clic (l'origine
/// la mette `growFrom`) mentre testata, appunti e voci arrivano una dopo
/// l'altra. Il sottomenu che col dito prende il posto del menu entra invece da
/// destra, e il menu di prima torna da sinistra. Col moto ridotto c'è e basta.
///
/// Le corse delle parti non sono legate alla vita del menu: chiuderlo a metà
/// entrata le fermerebbe prima che l'uscita ne fotografi la posa, e le parti
/// salterebbero al riposo nell'immagine che sfuma. Finiscono da sole.
function enterAtPoint(menu: HTMLElement, parts: readonly HTMLElement[], entry: "forward" | "back" | null): void {
  if (entry !== null) {
    enter(menu, { from: { x: entry === "forward" ? SUB_SHIFT : -SUB_SHIFT, opacity: 0 }, duration: DURATION.swap, easing: ENTER_EASING, whenReduced: "none" });
    return;
  }
  enter(menu, { from: { scale: 0.94, opacity: 0 }, duration: POINT_ENTER_MS, easing: ENTER_EASING, whenReduced: "none" });
  stagger(parts, (part) => enter(part, { from: { y: 5, opacity: 0 }, duration: DURATION.swap, easing: ENTER_EASING, whenReduced: "none" }), {
    each: PART_STAGGER_MS,
    max: PART_STAGGER_MAX,
  });
}

/// Le voci di un sottomenu, preparate se serve.
async function itemsOf(item: MenuItem): Promise<readonly MenuItem[]> {
  return typeof item.items === "function" ? await item.items() : (item.items ?? []);
}

interface RenderedMenu {
  readonly menu: HTMLElement;
  focusActive(): void;
  /// Le voci nuove al posto di quelle di prima, nello stesso menu.
  update(items: readonly MenuItem[]): void;
  /// Le parti che entrano una dopo l'altra: testata, appunti, voci, piede.
  parts(): HTMLElement[];
}

/// Una voce con le sue due o tre scelte nella riga: i tastini, quello scelto,
/// e il posto che occupa fra le fermate delle frecce.
interface Choices {
  readonly row: HTMLElement;
  /// Il nome della scelta, accanto a quello della voce, mentre la riga è accesa.
  readonly name: HTMLElement;
  readonly buttons: readonly HTMLButtonElement[];
  readonly items: readonly MenuItem[];
  /// L'indice della riga fra le fermate delle frecce.
  readonly slot: number;
  current: number;
}

/// Un elenco di voci con la sua navigazione da tastiera: il menu principale e
/// ciascun sottomenu a cascata sono la stessa cosa, cambia solo dove stanno.
///
/// **Una scelta sola.** Acceso è ciò che ha il fuoco: il passaggio del
/// puntatore lo sposta, le frecce ripartono da lì, Invio fa quello, e quando il
/// puntatore esce dal menu resta acceso. Barra degli appunti ed elenco seguono
/// la stessa regola: mai due cose accese insieme. Nell'elenco la scelta è una
/// pastiglia che scivola (`menu-glide`), nella barra una linguetta chiara
/// (`menu-clipboard-glide`).
function renderMenu(
  initialItems: readonly MenuItem[],
  lifetime: Lifetime,
  replaceWith: (item: MenuItem) => Promise<void>,
  chrome: Chrome | null = null,
  reach: Reach = { disabled: false, typed: null },
): RenderedMenu {
  let items = initialItems;
  const menu = document.createElement("div");
  menu.className = "context-menu";
  // Un menu è un menu: il ruolo è ciò che fa annunciare «menu, cinque voci» e
  // permette di uscirne sapendo di esserci entrati.
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-orientation", "vertical");
  menu.tabIndex = -1;
  /// Le fermate delle frecce, nell'ordine: gli appunti (finché non si cerca),
  /// poi le voci; di una voce con le scelte nella riga conta la scelta di
  /// adesso. `usable` è la voce di ciascuna, `names` il nome per l'iniziale.
  const buttons: HTMLButtonElement[] = [];
  const usable: MenuItem[] = [];
  const names: string[] = [];
  /// Il bottone di ogni voce dell'elenco, per ritrovarlo quando le voci cambiano.
  const buttonOf = new Map<MenuItem, HTMLButtonElement>();
  /// Le righe con le scelte, per ciascuno dei loro tastini.
  const choicesOf = new Map<HTMLButtonElement, Choices>();
  // Il sottomenu aperto, se ce n'è uno: la voce da cui parte e come chiuderlo.
  // Il bottone cambia quando le voci si ridisegnano, il sottomenu resta.
  let open: { button: HTMLButtonElement; item: MenuItem; lifetime: Lifetime; child: RenderedMenu; sub: HTMLElement } | null = null;
  // Dove stava il puntatore al movimento prima e adesso: la mira si legge da qui.
  let pointer: { from: Point; to: Point } | null = null;
  // Una parte premuta mostra la spunta prima che il menu si chiuda: intanto il
  // menu non risponde a un secondo gesto.
  let pressing = false;
  lifetime.listen(menu, "pointermove", (e) => {
    const to = { x: e.clientX, y: e.clientY };
    const first = pointer === null;
    pointer = { from: pointer?.to ?? to, to };
    // Il primo movimento può essere quello che il motore finge quando il menu
    // compare sotto il puntatore fermo: aperto col mouse, niente si accende
    // finché il puntatore non si muove davvero.
    if (first || e.pointerType === "touch" || pressing) return;
    hoverAt(e.target);
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
      if (focus) open.child.focusActive();
      return;
    }
    closeOpen();
    const children = await itemsOf(item);
    if (lifetime.closed || !button.isConnected) return;
    closeOpen();
    const childLifetime = openLifetime();
    lifetime.add(() => childLifetime.close());
    // Una lettera scritta nel sottomenu del menu che cerca dappertutto va alla
    // sua ricerca; quella di un sottomenu più in là, a quella del suo menu.
    const typed = chrome?.full ? (key: string) => {
      search(query + key);
    } : reach.typed;
    const child = renderMenu(children, childLifetime, replaceWith, null, { disabled: reach.disabled, typed });
    const sub = child.menu;
    sub.classList.add("context-submenu");
    sub.setAttribute("aria-label", item.label);
    sub.style.left = "0px";
    sub.style.top = "0px";
    (menu.parentElement ?? document.body).appendChild(sub);
    const parentBox = menu.getBoundingClientRect();
    placeCascade(sub, button.getBoundingClientRect(), parentBox);
    // Entra dal suo lato: da destra quando sta a destra del menu.
    const right = sub.getBoundingClientRect().left >= parentBox.left;
    enter(sub, { from: { x: right ? SUB_SHIFT : -SUB_SHIFT, opacity: 0 }, duration: DURATION.swap, easing: ENTER_EASING, whenReduced: "none", lifetime: childLifetime });
    childLifetime.add(() => sub.remove());
    // Un sottomenu lasciato dal puntatore non si chiude finché il puntatore
    // ci sta sopra: la tolleranza diagonale è questa.
    childLifetime.listen(sub, "pointerenter", cancelHover);
    button.setAttribute("aria-expanded", "true");
    const state = { button, item, lifetime: childLifetime, child, sub };
    open = state;
    // ← o Escape tornano alla voce da cui si è entrati: la trappola del
    // sottomenu sta sopra quella del menu, ed Escape chiude solo lei.
    const back = (): void => {
      if (open === state) closeOpen();
      state.button.focus();
    };
    childLifetime.listen(sub, "keydown", (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    });
    childLifetime.add(trapFocus(sub, back));
    if (focus) child.focusActive();
    else button.focus({ preventScroll: true });
  };
  /// Il passaggio del puntatore su una voce la chiude un sottomenu aperto da
  /// un'altra, o apre il suo, dopo una pausa breve; più lunga se il puntatore
  /// sta andando verso il sottomenu aperto: attraversa, non sceglie.
  const hoverCascade = (e: PointerEvent, owner: HTMLButtonElement | null, item: MenuItem | null): void => {
    if (e.pointerType === "touch") return;
    cancelHover();
    const nested = item !== null && item.items !== undefined && !item.disabled;
    const aiming = open !== null && open.button !== owner && pointer !== null &&
      aimsAt(pointer.from, { x: e.clientX, y: e.clientY }, open.sub.getBoundingClientRect());
    hoverTimer = setTimeout(() => {
      hoverTimer = null;
      if (nested && owner !== null) void cascade(owner, item, false);
      else if (open !== null && open.button !== owner) closeOpen();
    }, aiming ? AIM_DELAY : HOVER_DELAY);
  };
  // Le voci stanno in un elenco loro, fra la testata e gli appunti sopra e il
  // piede sotto: scrivere le sostituisce e il resto non si muove. La pastiglia
  // della scelta ci sta dentro, sotto le voci.
  const list = document.createElement("div");
  list.className = "menu-items";
  list.setAttribute("role", "none");
  const glide = document.createElement("div");
  glide.className = "menu-glide";
  glide.setAttribute("aria-hidden", "true");
  glide.hidden = true;
  // La riga degli appunti, se c'è: pulsanti che sono voci del menu, prima
  // delle altre nel giro delle frecce.
  const quick: HTMLButtonElement[] = [];
  const quickItems: MenuItem[] = [];
  let head: HTMLElement | null = null;
  if (chrome?.header) {
    head = document.createElement("div");
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
  let bar: HTMLElement | null = null;
  const tab = document.createElement("div");
  tab.className = "menu-clipboard-glide";
  tab.setAttribute("aria-hidden", "true");
  if (chrome && chrome.clipboard.length > 0) {
    bar = document.createElement("div");
    bar.className = "menu-clipboard";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", t("context.clipboard"));
    bar.append(tab);
    for (const item of chrome.clipboard) {
      const b = document.createElement("button");
      b.type = "button";
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
      b.addEventListener("click", () => press(b, item));
      b.addEventListener("pointerenter", (e) => hoverCascade(e, null, null));
      bar.append(b);
      quick.push(b);
      quickItems.push(item);
    }
    menu.append(bar);
  }
  menu.append(list);
  // Il piede: una fascia tenue che invita a scrivere, poi mostra che cosa si
  // è scritto. Per chi ascolta parlano le voci trovate, che prendono il fuoco.
  const foot = chrome?.search ? document.createElement("div") : null;
  if (foot !== null) {
    foot.className = "menu-foot";
    foot.setAttribute("aria-hidden", "true");
    menu.append(foot);
  }
  let query = "";
  /// Dove cominciano le voci fra le fermate: dopo gli appunti, che mentre si
  /// cerca non ci sono.
  const lead = (): number => (query === "" ? quick.length : 0);
  /// L'ultima parte della barra che è stata accesa: è lì che si torna con le
  /// frecce dalla prima voce o dall'ultima.
  let lastQuick = 0;
  const drawFoot = (found: number): void => {
    if (foot === null) return;
    foot.classList.toggle("menu-finding", query !== "");
    const glyph = iconEl("search");
    glyph?.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.className = "menu-foot-text";
    if (query === "") {
      text.textContent = t("context.foot.search");
    } else {
      const typed = document.createElement("span");
      typed.className = "menu-foot-query";
      typed.textContent = query;
      const caret = document.createElement("span");
      caret.className = "menu-foot-caret";
      text.append(typed, caret);
      // Senza tetto le trovate possono essere centinaia: il piede le conta.
      if (chrome?.full) text.append(` · ${found === 1 ? t("context.foot.one") : t("context.foot.many", { count: String(found) })}`);
    }
    foot.replaceChildren(...(glyph === null ? [] : [glyph]), text);
  };

  /// La riga di una voce con due o tre scelte che hanno il loro segno: i
  /// tastini accanto al nome, al posto del sottomenu.
  function drawChoices(item: MenuItem, options: readonly MenuItem[], host: HTMLElement, pictured: boolean): void {
    const row = document.createElement("div");
    row.className = "menu-choices";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", item.label);
    const glyph = item.icon === undefined ? null : iconEl(item.icon);
    if (glyph !== null || pictured) {
      const picture = document.createElement("span");
      picture.className = "menu-icon";
      picture.setAttribute("aria-hidden", "true");
      if (glyph !== null) picture.append(glyph);
      row.append(picture);
    }
    const label = document.createElement("span");
    label.className = "menu-label";
    label.setAttribute("aria-hidden", "true");
    label.textContent = item.label;
    const name = document.createElement("span");
    name.className = "menu-choice-name";
    label.append(name);
    row.append(label);
    const set = document.createElement("span");
    set.className = "menu-choice-set";
    const own: HTMLButtonElement[] = [];
    for (const option of options) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "menu-choice";
      b.setAttribute("role", "menuitem");
      // Le parole non stanno nel tastino: chi ascolta le sente dal suo nome.
      b.setAttribute("aria-label", `${item.label} ${option.label}`);
      b.tabIndex = -1;
      const sign = iconEl(signOf(option)!);
      if (sign !== null) {
        sign.setAttribute("aria-hidden", "true");
        b.append(sign);
      }
      b.addEventListener("click", () => press(b, option));
      set.append(b);
      own.push(b);
    }
    row.append(set);
    row.addEventListener("pointerenter", (e) => hoverCascade(e, null, null));
    host.appendChild(row);
    const choices: Choices = { row, name, buttons: own, items: options, slot: buttons.length, current: 0 };
    for (const b of own) choicesOf.set(b, choices);
    buttons.push(own[0]!);
    usable.push(options[0]!);
    names.push(item.label);
    buttonOf.set(item, own[0]!);
  }

  /// Mette nell'elenco le voci `rows`, al posto di quelle di prima.
  function fill(rows: readonly Row[]): void {
    list.replaceChildren(glide);
    glide.hidden = true;
    buttons.length = 0;
    usable.length = 0;
    names.length = 0;
    buttonOf.clear();
    choicesOf.clear();
    // Mentre si cerca la barra degli appunti non c'è: le frecce vanno solo
    // fra le voci trovate.
    if (bar !== null) bar.hidden = query !== "";
    if (query === "") {
      buttons.push(...quick);
      usable.push(...quickItems);
      names.push(...quickItems.map((item) => item.label));
    }
    const pictured = rows.some(({ item }) => item.sample !== undefined || (item.icon !== undefined && icon(item.icon) !== ""));
    let group = null as { name: string; node: HTMLElement } | null;
    for (const { item, path, heading } of rows) {
      // Un gruppo con un nome è un `role="group"` per chi ascolta e una riga per
      // chi guarda; una riga semplice chiude il gruppo aperto. Un gruppo con la
      // sua etichetta («Altri comandi») non ha bisogno anche della riga.
      const named = item.group ?? null;
      if (named !== (group?.name ?? null) || item.separator) {
        if (list.childElementCount > 1 && !heading && (item.separator || named !== null || group !== null)) {
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
          if (heading) {
            const title = document.createElement("div");
            title.className = "menu-group-label";
            title.setAttribute("aria-hidden", "true");
            title.textContent = named;
            node.append(title);
          }
          list.appendChild(node);
          group = { name: named, node };
        }
      }
      const host = group?.node ?? list;
      const options = path === undefined ? optionsOf(item) : null;
      if (options !== null) {
        drawChoices(item, options, host, pictured);
        continue;
      }
      const b = document.createElement("button");
      b.type = "button";
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
      b.append(label);
      // Una riga sola: la spiegazione sta a destra, in grigio, dove non c'è una
      // scorciatoia; con la scorciatoia la sente soltanto chi ascolta. Il
      // perché di una voce spenta si vede sempre.
      if (item.description) {
        const description = document.createElement("span");
        description.className = item.hint && !item.disabled ? "menu-description menu-quiet" : "menu-description";
        description.textContent = item.description;
        b.append(description);
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
      b.addEventListener("pointerenter", (e) => hoverCascade(e, b, item));
      buttonOf.set(item, b);
      if (item.disabled) {
        b.setAttribute("aria-disabled", "true");
        host.appendChild(b);
        if (reach.disabled) {
          buttons.push(b);
          usable.push(item);
          names.push(item.label);
        }
        continue;
      }
      // L'attivazione da tastiera passa dal click nativo del button (Invio/Spazio):
      // nessun gestore keydown qui, così il browser osserva esattamente un click
      // e l'azione resta una sola grazie alla guardia in `activate`.
      b.addEventListener("click", () => activate(b, item));
      buttons.push(b);
      usable.push(item);
      names.push(item.label);
      host.appendChild(b);
    }
  }
  fill(items.map((item) => ({ item })));
  drawFoot(0);
  // Si parte dalla voce scelta, se c'è, altrimenti dalla prima voce: gli
  // appunti si raggiungono con le frecce.
  const chosen = usable.findIndex((item) => item.selected);
  let active = chosen >= 0 ? chosen : buttons.length > lead() ? lead() : 0;
  const focusItem = (index: number, scroll = true): void => {
    if (buttons.length === 0) {
      menu.focus();
      return;
    }
    active = (index + buttons.length) % buttons.length;
    buttons.forEach((button, i) => {
      button.tabIndex = i === active ? 0 : -1;
    });
    for (const choices of new Set(choicesOf.values())) {
      choices.buttons.forEach((button) => {
        if (button !== buttons[choices.slot]) button.tabIndex = -1;
      });
    }
    buttons[active]?.focus(scroll ? undefined : { preventScroll: true });
  };
  // La fermata del roving tabindex c'è da subito, anche quando il fuoco resta
  // al menu: Tab e il ritorno dal sottomenu trovano la voce attiva.
  if (buttons[active]) buttons[active].tabIndex = 0;

  /// Cambia la scelta di una riga con le scelte, senza spostare il fuoco.
  const choose = (choices: Choices, index: number): void => {
    choices.current = Math.max(0, Math.min(choices.buttons.length - 1, index));
    if (buttons[choices.slot] === undefined || !choicesOf.has(buttons[choices.slot]!)) return;
    buttons[choices.slot] = choices.buttons[choices.current]!;
    usable[choices.slot] = choices.items[choices.current]!;
  };

  /// Le frecce su e giù. Con la barra degli appunti: ↑ dalla prima voce sale
  /// alla barra e ↓ dall'ultima ci torna, sulla parte accesa per ultima; dalla
  /// barra ↓ va alla prima voce e ↑ all'ultima. Senza, il giro si chiude.
  const step = (delta: number): void => {
    const count = buttons.length;
    if (count === 0) {
      menu.focus();
      return;
    }
    const first = lead();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    // Nessuna voce col fuoco (il menu aperto dal puntatore): giù va alla voce
    // attiva, su all'ultima voce, o a quella prima della voce scelta.
    if (at < 0) {
      focusItem(delta > 0 ? active : active === first ? count - 1 : active - 1);
      return;
    }
    const rows = count - first;
    if (rows <= 0) return;
    if (at < first) {
      focusItem(delta > 0 ? first : count - 1);
      return;
    }
    if (first > 0 && ((delta > 0 && at === count - 1) || (delta < 0 && at === first))) {
      focusItem(Math.min(lastQuick, first - 1));
      return;
    }
    focusItem(first + ((at - first + delta + rows) % rows));
  };
  // La ricerca per iniziale: una lettera porta alla prossima voce che comincia
  // così, e ripeterla scorre fra quelle che cominciano uguale.
  const initialOf = (text: string): string =>
    text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^[^\p{L}\p{N}]+/u, "").charAt(0).toLocaleLowerCase();
  const typeahead = (key: string): boolean => {
    const wanted = initialOf(key);
    if (wanted === "") return false;
    for (let offset = 1; offset <= buttons.length; offset++) {
      const index = (active + offset) % buttons.length;
      if (initialOf(names[index]!) === wanted) {
        focusItem(index);
        return true;
      }
    }
    return false;
  };

  /// Il puntatore su una voce, una parte della barra o una scelta la accende:
  /// prende il fuoco, e lo tiene anche quando il puntatore se ne va. Una voce
  /// spenta che non si raggiunge non cambia niente.
  function hoverAt(target: EventTarget | null): void {
    if (!(target instanceof Element)) return;
    const button = target.closest("button");
    const owned = button instanceof HTMLButtonElement && menu.contains(button) ? button : null;
    const choices = owned !== null ? choicesOf.get(owned) : choicesIn(target.closest(".menu-choices"));
    if (choices !== undefined && choices !== null) {
      const index = owned !== null ? choices.buttons.indexOf(owned) : choices.current;
      if (buttons[choices.slot] === choices.buttons[index] && document.activeElement === buttons[choices.slot]) return;
      choose(choices, index);
      focusItem(choices.slot, false);
      return;
    }
    if (owned === null || document.activeElement === owned) return;
    const index = buttons.indexOf(owned);
    if (index >= 0) focusItem(index, false);
  }
  const choicesIn = (row: Element | null): Choices | null => {
    if (row === null || !menu.contains(row)) return null;
    const first = row.querySelector<HTMLButtonElement>(".menu-choice");
    return first === null ? null : choicesOf.get(first) ?? null;
  };

  /// Accende ciò che ha il fuoco, e spegne il resto.
  let glideOn = false;
  let tabOn = false;
  const paint = (target: EventTarget | null): void => {
    for (const lit of menu.querySelectorAll(".menu-lit")) lit.classList.remove("menu-lit");
    for (const choices of new Set(choicesOf.values())) choices.name.textContent = "";
    const button = target instanceof HTMLButtonElement ? target : null;
    const inBar = button !== null && quick.includes(button) && query === "";
    const inList = button !== null && !inBar && buttons.includes(button);
    if (bar !== null) bar.classList.toggle("is-on", inBar);
    if (inBar) {
      lastQuick = quick.indexOf(button);
      button.classList.add("menu-lit");
      slide(tab, button, tabOn, (left, width) => {
        tab.style.left = `${left}px`;
        tab.style.width = `${width}px`;
      });
      tabOn = true;
    } else {
      tabOn = false;
    }
    if (!inList) {
      glide.hidden = true;
      glideOn = false;
      return;
    }
    const choices = choicesOf.get(button);
    const row = choices?.row ?? button;
    row.classList.add("menu-lit");
    if (choices) {
      button.classList.add("menu-lit");
      choices.name.textContent = choices.items[choices.current]!.label;
    }
    glide.classList.toggle("danger", row.classList.contains("danger"));
    glide.hidden = false;
    slide(glide, row, glideOn, (_left, _width, top, height) => {
      glide.style.top = `${top}px`;
      glide.style.height = `${height}px`;
    });
    glideOn = true;
  };
  /// Posa `mark` sotto `under`: se era già acceso scivola da dov'era. Come le
  /// parti all'entrata, la corsa non muore col menu: l'uscita la porta con sé.
  const slide = (mark: HTMLElement, under: HTMLElement, on: boolean, place: (left: number, width: number, top: number, height: number) => void): void => {
    const move = (): void => place(under.offsetLeft, under.offsetWidth, under.offsetTop, under.offsetHeight);
    if (on) flip([mark], move, { duration: mark === tab ? TAB_GLIDE_MS : GLIDE_MS, easing: ENTER_EASING, scale: false });
    else move();
  };
  lifetime.listen(menu, "focusin", (e) => paint(e.target));

  const onKey = (e: KeyboardEvent): void => {
    // Il tasto arriva anche dai sottomenu, che stanno fuori del menu nel DOM ma
    // non nell'albero degli eventi: risponde solo il menu in cui è nato.
    if (!(e.target instanceof Node) || !menu.contains(e.target)) return;
    // Durante la spunta di una parte premuta il menu non risponde: Invio due
    // volte non copia due volte.
    if (pressing) {
      if (e.key !== "Escape" && e.key !== "Tab") e.preventDefault();
      return;
    }
    const current = document.activeElement as HTMLButtonElement;
    const at = buttons.indexOf(current);
    if (at >= 0) active = at;
    const first = lead();
    const choices = choicesOf.get(current) ?? null;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusItem(buttons.length > first ? first : 0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusItem(buttons.length - 1);
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && at >= 0 && at < first) {
      // Dentro la riga degli appunti le frecce di lato vanno da un pulsante
      // all'altro, e si fermano agli estremi.
      e.preventDefault();
      focusItem(Math.min(first - 1, Math.max(0, at + (e.key === "ArrowRight" ? 1 : -1))));
    } else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && choices !== null) {
      // Nella riga con le scelte le frecce di lato cambiano scelta, e si
      // fermano agli estremi.
      e.preventDefault();
      choose(choices, choices.current + (e.key === "ArrowRight" ? 1 : -1));
      focusItem(choices.slot);
    } else if (e.key === "ArrowRight") {
      const item = usable[active];
      if (item?.items !== undefined && !item.disabled) {
        e.preventDefault();
        if (coarse()) void replaceWith(item);
        else void cascade(buttons[active]!, item, true);
      }
    } else if (chrome?.search && e.key === "Backspace" && query !== "") {
      e.preventDefault();
      search(query.slice(0, -1));
    } else if (at >= 0 && usable[at]?.disabled && (e.key === "Enter" || (e.key === " " && !(chrome?.search && query !== "")))) {
      // Una voce spenta raggiunta con le frecce non si attiva.
      e.preventDefault();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Lo spazio sceglie la voce col fuoco, finché non si sta scrivendo.
      if (reach.typed !== null && e.key !== " ") {
        e.preventDefault();
        reach.typed(e.key);
      } else if (chrome?.search) {
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
    const prepared = items;
    // Il menu che cerca dappertutto prepara anche i sottomenu annidati.
    const visit = (list: readonly MenuItem[], deep: boolean): void => {
      for (const item of list) {
        if (typeof item.items === "function") {
          void itemsOf(item).then((children) => {
            if (lifetime.closed || items !== prepared) return;
            ready.set(item, children);
            if (chrome?.full) visit(children, true);
            if (query !== "") search(query, true);
          });
        } else if (deep && Array.isArray(item.items)) {
          visit(item.items, true);
        }
      }
    };
    visit([...items, ...(chrome?.searchable ?? [])], chrome?.full === true);
  };

  /// Filtra le voci con `text`: le trovate al posto del menu, col loro
  /// percorso, prima quelle del menu e poi, sotto «Altri comandi», quelle che
  /// si trovano soltanto scrivendo; la prima col fuoco. Niente scritto, il
  /// menu com'era. Con `keep`, la voce col fuoco resta quella di prima: le
  /// voci sono cambiate sotto chi le stava guardando.
  function search(text: string, keep = false): void {
    query = text;
    closeOpen();
    const was = keep ? buttons.indexOf(document.activeElement as HTMLButtonElement) : -1;
    if (query === "") {
      fill(items.map((item) => ({ item })));
      drawFoot(0);
      focusItem(quick.length);
      return;
    }
    prepare();
    const wanted = fold(query);
    const full = chrome?.full === true;
    const hit = ({ item, path }: Row): boolean => fold(item.label).includes(wanted) || (path !== undefined && fold(path).includes(wanted));
    const own = flatten(items, ready, "", full).filter(hit);
    const more = flatten(chrome?.searchable ?? [], ready, "", full).filter(hit);
    // Trovate, le voci perdono i gruppi: è un elenco solo.
    const clean = ({ item, path }: Row): Row => ({ item: { ...item, group: undefined, separator: undefined, selected: false }, path });
    let rows: Row[];
    let found: number;
    if (full) {
      // Dappertutto, le spente vengono dopo le accese, e tutte si vedono.
      const all = [...own, ...more];
      rows = [...all.filter(({ item }) => !item.disabled), ...all.filter(({ item }) => item.disabled)].map(clean);
      found = rows.length;
    } else {
      const label = t("context.search.more");
      rows = [
        ...own.map(clean),
        ...more.map((row) => ({ ...clean(row), item: { ...clean(row).item, group: label }, heading: true })),
      ].slice(0, SEARCH_LIMIT);
      found = own.length + more.length;
    }
    const all = menuSearch;
    if (rows.length === 0 && all !== null && !full) {
      const typed = query;
      const hint = all.hint();
      rows.push({ item: { label: t("context.search.all", { query: typed }), ...(hint ? { hint } : {}), run: () => all.run(typed) } });
    }
    fill(rows);
    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "menu-empty";
      empty.setAttribute("aria-hidden", "true");
      empty.textContent = t("context.search.none");
      list.append(empty);
    }
    drawFoot(found);
    if (was >= 0 && buttons.length > 0) focusItem(Math.min(was, buttons.length - 1));
    else if (keep) return;
    else if (buttons.length > 0) focusItem(0);
    else menu.focus({ preventScroll: true });
  }
  function activate(button: HTMLButtonElement, item: MenuItem): void {
    // Una voce già chiusa non deve rispondere a click tardivi.
    if (lifetime.closed || item.disabled || pressing) return;
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
  /// Una parte degli appunti o una scelta nella riga: risponde con la spunta
  /// d'accento, poi il menu si chiude e il gesto si fa. Col moto ridotto si fa
  /// subito.
  function press(button: HTMLButtonElement, item: MenuItem): void {
    if (lifetime.closed || item.disabled || pressing) return;
    if (document.activeElement !== button) button.focus({ preventScroll: true });
    const done = (): void => {
      if (!lifetime.closed) closeContextMenu();
      item.run?.();
    };
    if (motionLevel() === "reduced") {
      done();
      return;
    }
    pressing = true;
    button.classList.add("menu-pressed");
    if (bar !== null && quick.includes(button)) bar.classList.add("menu-pressed");
    // Esc durante la spunta chiude il menu e annulla il gesto: il tempo muore
    // con il menu.
    const pressTimer = setTimeout(done, PRESS_MS);
    lifetime.add(() => clearTimeout(pressTimer));
  }
  /// Le voci nuove: la ricerca si rifà, altrimenti il fuoco resta alla voce
  /// che aveva, e il sottomenu aperto resta aperto se la sua voce c'è ancora,
  /// nella stessa riga e con lo stesso nome.
  function update(next: readonly MenuItem[]): void {
    const index = open === null ? -1 : items.indexOf(open.item);
    items = next;
    ready.clear();
    preparing = false;
    if (query !== "") {
      search(query, true);
      return;
    }
    const was = buttons.indexOf(document.activeElement as HTMLButtonElement);
    fill(items.map((item) => ({ item })));
    if (was >= 0) focusItem(Math.min(was, buttons.length - 1));
    else if (buttons[active]) buttons[active].tabIndex = 0;
    if (open === null) return;
    const item = items[index];
    if (item === undefined || item.label !== open.item.label || item.items === undefined || item.disabled) {
      closeOpen();
      return;
    }
    const button = buttonOf.get(item);
    if (button === undefined) {
      closeOpen();
      return;
    }
    button.setAttribute("aria-expanded", "true");
    const kept = open;
    kept.button = button;
    kept.item = item;
    if (Array.isArray(item.items)) kept.child.update(item.items);
  }
  const parts = (): HTMLElement[] => [
    ...(head === null ? [] : [head]),
    ...(bar === null ? [] : [bar]),
    ...[...list.children].filter((child): child is HTMLElement => child instanceof HTMLElement && child !== glide),
    ...(foot === null ? [] : [foot]),
  ];
  return { menu, focusActive: () => focusItem(active), update, parts };
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
  // Al pixel intero: un menu posato su una frazione di pixel, dopo l'entrata a
  // scalare, il motore lo dipingerebbe un pixel più in là.
  const at = { left: Math.round(Math.max(margin, left)), top: Math.round(Math.max(margin, top)) };
  menu.style.left = `${at.left}px`;
  menu.style.top = `${at.top}px`;
  growFrom(menu, at.left, at.top, x, y);
}

/// Quanto un menu sta staccato dal pulsante che lo apre.
const ANCHOR_GAP = 4;

/// Un menu aperto da un pulsante gli sta sotto, allineato a sinistra, o a
/// destra dove a sinistra uscirebbe dalla finestra. Se sotto non c'è posto e
/// sopra ce n'è di più, si apre sopra; dalla parte dove si apre, un elenco più
/// alto del posto scorre. Il pulsante resta sempre visibile, perché è lì che
/// si guarda e che torna il fuoco. Un menu che cerca dappertutto (`grows`)
/// tiene sotto l'altezza del posto anche quando ci sta: la ricerca senza tetto
/// può trovare più voci di quante ce ne fossero, e scorrono invece di uscire
/// dalla finestra.
function placeBeside(menu: HTMLElement, anchor: DOMRectReadOnly, grows = false): void {
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
  if (box.height > room || (grows && top > anchor.top)) menu.style.maxHeight = `${Math.max(0, room)}px`;
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

/// Un piccolo selettore accanto al punto del click: le figure monocrome del
/// set (`fub:<nome>`, vedi `page-mark.ts`) e qualche emoji pronta, ciascuna
/// sotto il suo titolo, un campo per incollarne una qualsiasi, e il ritorno a
/// "senza icona" (`null` al callback). `current` è il valore di oggi: il suo
/// bottone si dice premuto.
export function pickIcon(
  at: MouseEvent,
  onPick: (icon: string | null) => void,
  options: { readonly current?: string | null } = {},
): void {
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
  // Modale: la trappola qui sotto tiene il fuoco dentro, ed Esc lo chiude.
  // Senza dirlo, chi ascolta crederebbe di poter uscire col Tab nella pagina.
  pop.setAttribute("aria-modal", "true");
  pop.setAttribute("aria-label", t("icons.choose"));
  pop.tabIndex = -1;
  pop.style.left = `${Math.min(at.clientX, window.innerWidth - 256)}px`;
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
  const current = options.current?.trim() || null;

  /// Un gruppo col suo titolo: il titolo dà il nome alla griglia, per chi
  /// ascolta come per chi guarda.
  const group = (title: string, className: string): HTMLElement => {
    const heading = document.createElement("div");
    heading.className = "icon-picker-title";
    heading.id = `icon-picker-${className}`;
    heading.textContent = title;
    const grid = document.createElement("div");
    grid.className = `icon-grid ${className}`;
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-labelledby", heading.id);
    pop.append(heading, grid);
    return grid;
  };
  const choice = (grid: HTMLElement, value: string, label: string, content: Node): void => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.icon = value;
    b.append(content);
    b.setAttribute("aria-label", label);
    // Solo l'icona di oggi si dice premuta: le altre sono scelte, non
    // interruttori spenti.
    if (value === current) b.setAttribute("aria-pressed", "true");
    lifetime.listen(b, "click", () => apply(value));
    grid.appendChild(b);
  };

  const figures = group(t("icons.figures"), "icon-grid--figures");
  for (const name of PAGE_FIGURES) {
    const drawn = iconEl(name);
    if (drawn) choice(figures, figureValue(name), figureLabel(name), drawn);
  }
  const emoji = group(t("icons.emoji"), "icon-grid--emoji");
  for (const char of ICON_PRESETS) {
    // Un pulsante il cui unico contenuto è un'emoji prende il nome dal nome
    // Unicode del carattere, letto in inglese in mezzo a un'interfaccia
    // italiana. Un nome migliore vorrebbe una tabella di traduzioni che questa
    // shell non ha e che non è di questa voce; dichiarare esplicitamente
    // l'emoji come nome accessibile almeno rende l'annuncio **uno** e
    // prevedibile, invece di lasciarlo a come ciascun motore descrive i simboli.
    choice(emoji, char, char, document.createTextNode(char));
  }

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

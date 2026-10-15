// Il catalogo del kit: ogni primitiva di `src/kit/` col suo campione, negli
// stati in cui una pelle la deve distinguere.
//
// Non è la shell — qui non gira nessun `bootstrap` — ma ciò che conta è lo
// stesso: i tre strati montati dallo stesso caricatore, e le primitive vere.
// Un campione è un'istanza, non markup che le somiglia: il menu si apre, il
// divisore si trascina, le schede rispondono alle frecce. Per questo la pagina
// è anche il palco su cui il banco del movimento prova le coreografie del kit
// (`motion.mjs`), e i campioni che si muovono hanno un `id` che comincia per
// `sample-`.
//
// # Gli stati che non stanno fermi
//
// Passaggio, pressione e fuoco esistono solo sotto un puntatore o dopo un
// tasto, e una fotografia ne vuole venti insieme. La pagina li tiene fermi
// senza scrivere una riga di pelle sua: montati i fogli, dà a ogni regola che
// nomina `:hover`, `:active` o `:focus-visible` un selettore gemello che legge
// `data-force`, **nella stessa regola** — quindi con le stesse dichiarazioni,
// lo stesso posto nella cascata e la stessa specificità (un attributo pesa
// quanto una pseudo-classe). Un campione forzato mostra perciò ciò che la
// pelle dà davvero, e la scena `kit-focus` lo riprova col fuoco vero.
import "../src/theme/scrittoio/structure.css";
import {
  attachHoverCard,
  createList,
  createTabs,
  iconButton,
  mountSplitter,
  openDialog,
  openPopover,
  setPressed,
  textButton,
  textField,
  type ButtonKind,
  type PopoverHandle,
} from "../src/kit";
import { mount } from "../src/theme/loader";
import { SCRITTOIO_SERIES } from "../src/theme/scrittoio/series";
import { iconEl } from "../src/ui/icons";
import { openLifetime, type Lifetime } from "../src/ui/lifetime";

const params = new URLSearchParams(window.location.search);
const LIGHT = params.get("light") === "light" ? "light" : "dark";
const CONTRAST = params.get("contrast") === "high" ? "high" : "normal";

const lifetime = openLifetime();
lifetime.listen(window, "pagehide", () => lifetime.close(), { once: true });

// Gli strati, per sostituzione, come nell'app: la struttura arriva
// dall'`import` qui sopra, i caratteri, la pelle e il foglio dal caricatore.
mount(SCRITTOIO_SERIES.fonts, "caratteri");
mount(SCRITTOIO_SERIES.skin, "pelle");
mount(SCRITTOIO_SERIES.sheet(LIGHT, CONTRAST), "foglio");
document.documentElement.dataset.theme = LIGHT;

// ── Gli stati tenuti fermi ───────────────────────────────────────────────────

type Force = "hover" | "active" | "focus";

const FORCED: readonly (readonly [RegExp, string])[] = [
  [/:hover\b/g, '[data-force~="hover"]'],
  [/:active\b/g, '[data-force~="active"]'],
  [/:focus-visible\b/g, '[data-force~="focus"]'],
];
/// Un `:not(:hover)` non si gemella: il gemello varrebbe per chiunque non sia
/// forzato, cioè sempre.
const NEGATED = /:not\([^)]*:(?:hover|active|focus-visible)/;

/// Divide una lista di selettori alle virgole che non stanno fra parentesi.
function selectors(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const character = text[i];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts;
}

function twin(rules: CSSRuleList): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      const own = selectors(rule.selectorText);
      const twins: string[] = [];
      for (const selector of own) {
        if (NEGATED.test(selector)) continue;
        let forced = selector;
        for (const [pattern, attribute] of FORCED) forced = forced.replace(pattern, attribute);
        if (forced !== selector) twins.push(forced);
      }
      if (twins.length > 0) rule.selectorText = [...own, ...twins].join(", ");
    }
    const nested = (rule as Partial<CSSGroupingRule>).cssRules;
    if (nested) twin(nested);
  }
}

/// I fogli già gemellati. Uno rimontato — il caricatore che cambia tema, o
/// Vite che ricarica un CSS toccato a server acceso — è un foglio nuovo, e
/// senza i gemelli: va rifatto, o i campioni forzati tornano a riposo.
const twinned = new WeakSet<CSSStyleSheet>();

function twinSheets(): void {
  for (const sheet of Array.from(document.styleSheets)) {
    if (twinned.has(sheet)) continue;
    twinned.add(sheet);
    try {
      twin(sheet.cssRules);
    } catch {
      // Un foglio di un'altra origine non si legge: non è nostro.
    }
  }
}

// Prima dei campioni: nati già nel loro stato, non hanno una transizione da
// finire quando arriva il fotografo. Riscrivere un selettore non tocca il
// DOM: l'osservatore non si risveglia da solo.
twinSheets();
const remounted = new MutationObserver(twinSheets);
remounted.observe(document.head, { childList: true, subtree: true, characterData: true });
lifetime.add(() => remounted.disconnect());

function force<T extends HTMLElement>(node: T, ...states: Force[]): T {
  node.dataset.force = states.join(" ");
  return node;
}

// ── La cornice ───────────────────────────────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const caption = (text: string, className = "didascalia"): HTMLElement => el("span", className, text);

function cell(text: string, ...content: Node[]): HTMLElement {
  const node = el("div", "cella");
  node.append(caption(text), ...content);
  return node;
}

const root = document.getElementById("kit")!;
const header = el("header", "testata");
header.append(el("h1", undefined, "Kit"), el("span", "luce", CONTRAST === "high" ? `${LIGHT} · alto contrasto` : LIGHT));
const table = el("div", "tavola");
const COLUMNS = { left: el("div", "colonna"), right: el("div", "colonna") };
table.append(COLUMNS.left, COLUMNS.right);
root.append(header, table);

let sections = 0;
function section(title: string, column: keyof typeof COLUMNS, ...content: Node[]): void {
  const node = el("section", "sezione");
  const heading = el("h2", undefined, title);
  sections += 1;
  heading.id = `sezione-${sections}`;
  node.setAttribute("aria-labelledby", heading.id);
  node.append(heading, ...content);
  COLUMNS[column].append(node);
}

const nothing = (): void => {};

// ── Popover, dialogo, scheda al passaggio ────────────────────────────────────

/// Un pulsante che apre e chiude la sua superficie. Il gesto che la chiude «da
/// fuori» arriva prima del clic che la riaprirebbe: lo si riconosce qui, in
/// cattura e prima che un popover esista, quando la superficie c'è ancora.
function toggler(label: string, open: (anchor: HTMLButtonElement) => PopoverHandle): HTMLButtonElement {
  let surface: PopoverHandle | null = null;
  let closing = false;
  const trigger: HTMLButtonElement = textButton({
    label,
    lifetime,
    onPress() {
      if (closing) {
        closing = false;
        return;
      }
      if (surface && !surface.closed) surface.close();
      else surface = open(trigger);
    },
  });
  lifetime.listen(
    document,
    "pointerdown",
    (event) => {
      closing =
        surface !== null && !surface.closed && event.target instanceof Node && trigger.contains(event.target);
    },
    { capture: true },
  );
  return trigger;
}

interface Entry {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly disabled?: boolean;
}

function drawEntry(entry: Entry, row: HTMLElement): void {
  const figure = entry.icon ? iconEl(entry.icon) : null;
  if (figure) row.append(figure);
  row.append(entry.label);
}

const ACTIONS: readonly Entry[] = [
  { id: "open", label: "Apri in un nuovo foglio", icon: "notes" },
  { id: "pin", label: "Fissa la linguetta", icon: "pin" },
  { id: "tag", label: "Aggiungi un'etichetta", icon: "tag" },
  { id: "history", label: "Cronologia", icon: "history", disabled: true },
  { id: "trash", label: "Sposta nel cestino", icon: "trash" },
];

const menuTrigger = toggler("Apri il menu", (anchor) => {
  const life = openLifetime();
  const box = el("div");
  box.setAttribute("aria-label", "Azioni sulla nota");
  let popover: PopoverHandle | null = null;
  createList<Entry>({
    container: box,
    role: "menu",
    focus: "roving",
    items: ACTIONS,
    key: (entry) => entry.id,
    render: drawEntry,
    disabled: (entry) => entry.disabled === true,
    typeahead: (entry) => entry.label,
    onActivate: () => popover?.close(),
    lifetime: life,
  });
  // Col nome il popover è un dialogo, e un dialogo è una regione della pagina
  // anche fuori dal suo `main`: dentro c'è il menu, che porta lo stesso nome.
  popover = openPopover({
    anchor,
    content: box,
    label: "Azioni sulla nota",
    onClose: () => life.close(),
    lifetime,
  });
  return popover;
});
menuTrigger.id = "sample-menu";

const panelTrigger = toggler("Apri il riquadro", (anchor) => {
  const life = openLifetime();
  let popover: PopoverHandle | null = null;
  const close = (): void => popover?.close();
  const name = textField({
    label: "Nome della vista",
    value: "Da rileggere",
    clearable: { label: "Svuota il nome" },
    lifetime: life,
  });
  const answers = el("div", "fila");
  answers.append(
    textButton({ label: "Annulla", onPress: close, lifetime: life }),
    textButton({ label: "Salva", kind: "primary", onPress: close, lifetime: life }),
  );
  const box = el("div", "riquadro-libero");
  box.append(name.element, answers);
  popover = openPopover({
    anchor,
    content: box,
    label: "Salva la vista",
    onClose: () => life.close(),
    lifetime,
  });
  return popover;
});
panelTrigger.id = "sample-panel";

const answer = caption("nessuna risposta");
answer.id = "sample-answer";
answer.setAttribute("role", "status");

const dialogTrigger = textButton({
  label: "Apri il dialogo",
  lifetime,
  onPress() {
    const life = openLifetime();
    const name = textField({
      label: "Nome della nota",
      value: "Appunti di viaggio",
      clearable: { label: "Svuota il nome" },
      lifetime: life,
    });
    const dialog = openDialog<string>({
      title: "Salvare le modifiche?",
      description: "«Appunti di viaggio» ha modifiche che non sono ancora su disco.",
      body: name.element,
      actions: [
        { id: "cancel", label: "Annulla", value: "annulla" },
        { id: "discard", label: "Non salvare", kind: "danger", value: "non salvare" },
        { id: "save", label: "Salva", kind: "primary", value: "salva" },
      ],
      dismissValue: "annulla",
      lifetime,
    });
    void dialog.result.then((value) => {
      life.close();
      answer.textContent = `risposta: ${value}`;
    });
  },
});
dialogTrigger.id = "sample-dialog";

const link = el("a", "rimando", "Appunti di viaggio");
link.id = "sample-card";
link.href = "#sample-card";
lifetime.listen(link, "click", (event) => event.preventDefault());
attachHoverCard({
  target: link,
  label: "Anteprima di «Appunti di viaggio»",
  load: () => {
    const card = el("div", "scheda");
    card.append(
      el("strong", undefined, "Appunti di viaggio"),
      el("p", undefined, "Lisbona, tre giorni. Il tram 28 al mattino presto, prima della fila; il miradouro al tramonto."),
    );
    return Promise.resolve(card);
  },
  lifetime,
});

{
  const row = el("div", "fila");
  row.append(
    cell("popover · una lista", menuTrigger),
    cell("popover · un riquadro", panelTrigger),
    cell("dialogo", dialogTrigger),
    cell("la sua risposta", answer),
    cell("scheda al passaggio", link),
  );
  section("Popover, dialogo, scheda", "left", row);
}

// ── Pulsanti ─────────────────────────────────────────────────────────────────

const STATES = ["riposo", "passaggio", "premuto", "fuoco", "spento"] as const;
type State = (typeof STATES)[number];

/// Mette un pulsante in uno stato. La pressione vera arriva sempre sotto un
/// puntatore: è passaggio e pressione insieme.
function inState<T extends HTMLButtonElement>(button: T, state: State): T {
  if (state === "passaggio") force(button, "hover");
  else if (state === "premuto") force(button, "hover", "active");
  else if (state === "fuoco") force(button, "focus");
  else if (state === "spento") button.disabled = true;
  return button;
}

function head(grid: HTMLElement, last: string): void {
  grid.append(el("span"), ...[...STATES, last].map((state) => caption(state)));
}

{
  const KINDS: readonly (readonly [string, ButtonKind, string, string])[] = [
    ["normale", "normal", "Annulla", "notes"],
    ["primario", "primary", "Salva", "pin"],
    ["distruttivo", "danger", "Elimina", "trash"],
  ];
  const texts = el("div", "stati");
  head(texts, "con icona");
  for (const [name, kind, label, icon] of KINDS) {
    texts.append(caption(name));
    for (const state of STATES) {
      texts.append(inState(textButton({ label, kind, onPress: nothing, lifetime }), state));
    }
    texts.append(textButton({ label, kind, icon, onPress: nothing, lifetime }));
  }

  const icons = el("div", "stati");
  head(icons, "scelto");
  icons.append(caption("a icona"));
  for (const state of STATES) {
    icons.append(inState(iconButton({ icon: "search", label: "Cerca", onPress: nothing, lifetime }), state));
  }
  const toggle: HTMLButtonElement = iconButton({
    icon: "pin",
    label: "Fissa",
    chord: { display: "Ctrl+K", aria: "Control+K" },
    pressed: true,
    lifetime,
    onPress: () => setPressed(toggle, toggle.getAttribute("aria-pressed") !== "true"),
  });
  toggle.id = "sample-toggle";
  icons.append(toggle);

  section("Pulsanti", "left", texts, icons);
}

// ── Campo ────────────────────────────────────────────────────────────────────

{
  const grid = el("div", "campi");
  const field = (
    text: string,
    options: Omit<Parameters<typeof textField>[0], "lifetime">,
    dress?: (made: ReturnType<typeof textField>) => void,
  ): void => {
    const made = textField({ ...options, lifetime });
    dress?.(made);
    grid.append(cell(text, made.element));
  };
  const box = (made: ReturnType<typeof textField>): HTMLElement => made.input.parentElement!;
  const clear = (made: ReturnType<typeof textField>): HTMLElement =>
    made.element.querySelector<HTMLElement>(".kit-field-clear")!;

  field("riposo", { label: "Titolo", placeholder: "Senza titolo" });
  field("con l'icona", { label: "Cerca", placeholder: "Cerca nelle note", icon: "search" });
  field("con «svuota»", {
    label: "Filtro",
    value: "bozza",
    icon: "search",
    clearable: { label: "Svuota il filtro" },
  });
  field("passaggio", { label: "Titolo", value: "Lisbona" }, (made) => force(box(made), "hover"));
  field("fuoco", { label: "Titolo", value: "Lisbona" }, (made) => force(made.input, "focus"));
  field("spento", { label: "Titolo", value: "Lisbona" }, (made) => {
    made.input.disabled = true;
  });
  field("non valido", { label: "Titolo", value: "Lisbona/2" }, (made) => {
    made.input.setAttribute("aria-invalid", "true");
  });
  field("non valido · fuoco", { label: "Titolo", value: "Lisbona/2" }, (made) => {
    made.input.setAttribute("aria-invalid", "true");
    force(made.input, "focus");
  });
  field("«svuota» · passaggio", { label: "Filtro", value: "bozza", clearable: { label: "Svuota il filtro" } }, (made) =>
    force(clear(made), "hover"),
  );
  field("«svuota» · fuoco", { label: "Filtro", value: "bozza", clearable: { label: "Svuota il filtro" } }, (made) =>
    force(clear(made), "focus"),
  );

  section("Campo", "right", grid);
}

// ── Lista ────────────────────────────────────────────────────────────────────

{
  const FONTS: readonly Entry[] = [
    { id: "newsreader", label: "Newsreader" },
    { id: "hanken", label: "Hanken Grotesk" },
    { id: "literata", label: "Literata" },
    { id: "inter", label: "Inter" },
    { id: "system", label: "Del sistema", disabled: true },
  ];
  const choice = el("div");
  choice.id = "sample-listbox";
  choice.setAttribute("aria-label", "Carattere di lettura");
  const chosen = createList<Entry>({
    container: choice,
    role: "listbox",
    items: FONTS,
    key: (entry) => entry.id,
    render: drawEntry,
    disabled: (entry) => entry.disabled === true,
    selected: (entry) => entry.id === "literata",
    typeahead: (entry) => entry.label,
    onActivate: nothing,
    lifetime,
  });
  chosen.setActive("hanken");
  const tray = el("div", "vassoio");
  tray.append(choice);

  const menu = el("div");
  menu.id = "sample-menu-list";
  menu.setAttribute("aria-label", "Azioni sulla nota");
  const rows = createList<Entry>({
    container: menu,
    role: "menu",
    focus: "roving",
    items: ACTIONS,
    key: (entry) => entry.id,
    render: drawEntry,
    disabled: (entry) => entry.disabled === true,
    typeahead: (entry) => entry.label,
    onActivate: nothing,
    lifetime,
  });
  rows.setActive("pin");
  const focused = rows.element("pin");
  if (focused) force(focused, "focus");
  const second = el("div", "vassoio");
  second.append(menu);
  // Un campione fermo: è la fotografia di una riga a fuoco, non un menu da
  // usare. Un menu che si vede è, per chi naviga e per il banco
  // dell'accessibilità, il piano che tiene il fuoco: lasciato vivo in mezzo
  // alla pagina direbbe che tutto il resto gli sta sotto. Quello vero si apre
  // da «Apri il menu».
  second.inert = true;

  const row = el("div", "fila");
  row.append(
    cell("scelta: attiva, scelta, spenta", tray),
    cell("menu: l'attiva ha il fuoco", second),
  );
  section("Lista", "right", row);
}

// ── Schede ───────────────────────────────────────────────────────────────────

/// Schede coi loro pannelli: una scelta, una spenta, e due tenute ferme al
/// passaggio e col fuoco. Restano vere: le frecce e il clic scelgono.
function tabs(id: string, orientation: "horizontal" | "vertical", life: Lifetime): HTMLElement {
  const NAMES: readonly (readonly [string, string, string?])[] = [
    ["general", "Generale", "settings"],
    ["look", "Aspetto"],
    ["keys", "Tasti", "keyboard"],
    ["sync", "Sincronia"],
    ["advanced", "Avanzate"],
  ];
  const tablist = el("div");
  tablist.id = id;
  const panels = el("div");
  const specs = NAMES.map(([key, label, icon]) => {
    const panel = el("div", "pannello", `Il pannello «${label}».`);
    panels.append(panel);
    return { id: key, label, icon, panel, disabled: key === "advanced" };
  });
  const handle = createTabs({
    tablist,
    tabs: specs,
    selected: "look",
    orientation,
    label: orientation === "vertical" ? "Preferenze, in colonna" : "Preferenze",
    onSelect: nothing,
    lifetime: life,
  });
  const hovered = handle.tab("keys");
  if (hovered) force(hovered, "hover");
  const focused = handle.tab("sync");
  if (focused) force(focused, "focus");
  const node = el("div", orientation === "vertical" ? "affiancate" : undefined);
  node.append(tablist, panels);
  return node;
}

{
  const row = el("div", "fila");
  const wide = cell(
    "in riga: a riposo, scelta, al passaggio, a fuoco, spenta",
    tabs("sample-tabs", "horizontal", lifetime),
  );
  wide.classList.add("cella-larga");
  row.append(wide, cell("in colonna", tabs("sample-tabs-vertical", "vertical", lifetime)));
  section("Schede", "left", row);
}

// ── Divisore ─────────────────────────────────────────────────────────────────

/// Due riquadri e la maniglia fra loro. Il primo è quello governato.
function split(
  text: string,
  orientation: "vertical" | "horizontal",
  dress?: (handle: HTMLElement) => void,
): HTMLElement {
  const initial = orientation === "vertical" ? 56 : 28;
  const [min, max] = orientation === "vertical" ? [32, 96] : [18, 44];
  const box = el("div", orientation === "vertical" ? "riquadri" : "riquadri pila");
  const first = el("div", "riquadro", "uno");
  const handle = el("div", "maniglia");
  const rest = el("div", "riquadro resto", "due");
  let size = initial;
  const paint = (px: number): void => {
    first.style.setProperty(orientation === "vertical" ? "width" : "height", `${px}px`);
  };
  paint(size);
  box.append(first, handle, rest);
  mountSplitter({
    handle,
    orientation,
    value: () => size,
    min,
    max,
    onInput: paint,
    onCommit(px) {
      size = px;
      paint(px);
    },
    onReset() {
      size = initial;
      paint(size);
    },
    label: orientation === "vertical" ? "Larghezza del primo riquadro" : "Altezza del primo riquadro",
    lifetime,
  });
  dress?.(handle);
  return cell(text, box);
}

{
  const row = el("div", "fila");
  const live = split("riposo: si trascina", "vertical");
  live.querySelector<HTMLElement>(".maniglia")!.id = "sample-splitter";
  row.append(
    live,
    split("passaggio", "vertical", (handle) => force(handle, "hover")),
    split("fuoco", "vertical", (handle) => force(handle, "focus")),
    split("trascinamento", "vertical", (handle) => {
      handle.dataset.dragging = "";
    }),
    split("orizzontale · passaggio", "horizontal", (handle) => force(handle, "hover")),
  );
  section("Divisore", "left", row);
}

// Il contenitore scorre e i suoi campioni prendono il fuoco: non gli serve un
// posto suo nell'ordine di Tab.
document.documentElement.dataset.bench = "ready";

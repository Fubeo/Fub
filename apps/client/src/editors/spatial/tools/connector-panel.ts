// I connettori degli oggetti scelti, come sezione del pannello delle proprietà
// (livello Standard): il tipo, gli agganci dei due capi, l'etichetta e il
// verso. Che cosa mostrare, e ogni cambio, li decide l'editor, con
// [`connectorView`] e [`connectorOps`]; qui c'è come si vede, si sceglie e si
// raggiunge.
//
// - **Il tipo è un gruppo di tre scelte**: Dritto, A gomito, Curvo, ciascuno
//   col suo disegno, in un `radiogroup`. Le frecce spostano la scelta da uno
//   all'altro e la danno; con connettori di tipi diversi nessuno è scelto.
// - **Gli agganci sono due menu**, uno per capo: Automatico, Al centro e i
//   quattro lati. Un capo libero, o agganciato a ciò che non c'è più, non ha
//   niente da scegliere: il menu dice «Libero», spento, e una nota spiega
//   come si aggancia. Fra capi diversi il menu dice «Misto», e sceglierne
//   uno li porta tutti lì.
// - **L'etichetta è un testo di più righe.** Invio, o lasciare il campo, la
//   scrive; Maiusc e Invio va a capo; Esc la riporta com'era. Vuota, toglie
//   quelle del connettore. Fra etichette diverse il campo è vuoto e dice
//   «Misto», e finché non vi si scrive niente non cambia nulla.
// - **«Inverti»** scambia l'inizio e la fine: la punta passa all'altro capo.
// - **I connettori bloccati non cambiano**: la nota dice quanti sono, e se
//   lo sono tutti i comandi sono spenti. In sola lettura lo sono sempre; un
//   comando spento resta raggiungibile e dice perché.

import { identifier } from "../../../ui/a11y";
import { icon, iconEl, registerIcon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { ANCHORS, type Anchor, type ConnectorKind } from "../scene/connectors";
import { plural, t, type DrawKey } from "../strings";
import type { AnchorChoice, ConnectorChange, ConnectorView } from "./connector-ops";

/// I tre tipi, nell'ordine in cui si mostrano.
const KINDS: readonly ConnectorKind[] = ["straight", "elbow", "curved"];

const KIND_LABELS: Readonly<Record<ConnectorKind, DrawKey>> = {
  straight: "draw.connector.kind.straight",
  elbow: "draw.connector.kind.elbow",
  curved: "draw.connector.kind.curved",
};

const ANCHOR_LABELS: Readonly<Record<Anchor, DrawKey>> = {
  auto: "draw.connector.anchor.auto",
  center: "draw.connector.anchor.center",
  top: "draw.connector.anchor.top",
  right: "draw.connector.anchor.right",
  bottom: "draw.connector.anchor.bottom",
  left: "draw.connector.anchor.left",
};

/// Il riquadro di un oggetto agganciato, lo stesso in ogni figura: due
/// oggetti, e fra loro la linea di quel tipo.
const FROM = "M3 15h6v6H3z";
const TO = "M15 3h6v6h-6z";

/// Le icone della sezione, col costrutto di `ui/icons.ts`.
const ICONS: Readonly<Record<string, readonly string[]>> = {
  "draw-connector-straight": [FROM, TO, "M9 15 15 9"],
  "draw-connector-elbow": [FROM, TO, "M9 18h3V6h3"],
  "draw-connector-curved": [FROM, TO, "M9 18c3.5 0 2.5-12 6-12"],
};

/// Ciò che la sezione mostra.
export interface ConnectorPanelView extends ConnectorView {
  /// Che cosa si mostra: una chiave diversa lascia cadere il testo scritto a
  /// metà.
  readonly key: string;
}

export interface ConnectorPanelOptions {
  /// Dà `change` ai connettori scelti, col nome `label` nella cronologia.
  /// `null` se è fatto, altrimenti perché no.
  onChange(change: ConnectorChange, label: DrawKey): string | null;
  /// Dice `text` a chi usa uno screen reader.
  announce(text: string): void;
}

export interface ConnectorPanel {
  /// Il corpo della sezione: la nota, i campi e il comando.
  readonly element: HTMLElement;
  /// Mostra `view`; falso `editable` in sola lettura, dove i connettori si
  /// guardano soltanto.
  update(view: ConnectorPanelView, editable: boolean): void;
  /// Riscrive i testi nella lingua di adesso.
  relabel(): void;
}

/// Come un menu d'aggancio si presenta: con un punto scelto, con capi
/// diversi o con capi liberi.
type MenuState = "anchor" | "mixed" | "free";

/// Un menu d'aggancio, con le voci che ha adesso.
interface Menu {
  readonly end: "from" | "to";
  readonly root: HTMLElement;
  readonly label: HTMLLabelElement;
  readonly select: HTMLSelectElement;
  /// Lo stato per cui le voci sono scritte.
  built: MenuState | null;
}

/// Scrive `text` in `node`, se non c'è già.
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function createConnectorPanel(life: Lifetime, options: ConnectorPanelOptions): ConnectorPanel {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
  const element = document.createElement("div");
  element.className = "draw-connector";

  const EMPTY: ConnectorPanelView = { key: "", count: 0, kind: null, from: null, to: null, label: null, locked: 0 };
  let view: ConnectorPanelView = EMPTY;
  let editable = false;
  /// Vero mentre un cambio è in corso: la selezione può prendere un'altra
  /// chiave, ma è la stessa.
  let carry = false;
  /// Vero mentre i campi si ridisegnano: un campo che se ne va non scrive.
  let painting = false;
  let lastKey = "";

  const readOnly = (): string => t("draw.rejected", { reason: t("draw.reason.read_only") });

  /// Vero se i connettori scelti non si possono cambiare: in sola lettura, o
  /// tutti bloccati.
  const off = (): boolean => !editable || (view.count > 0 && view.locked === view.count);

  /// Perché non si può cambiare, a parole.
  const reason = (): string => (editable ? plural(view.locked, "draw.connector.locked.one", "draw.connector.locked.other") : readOnly());

  /// Segna `control` come un comando che adesso non si usa, che resta
  /// raggiungibile e dice perché.
  const offWhen = (control: HTMLElement, spent: boolean): void => {
    if (spent) control.setAttribute("aria-disabled", "true");
    else control.removeAttribute("aria-disabled");
  };

  // --- Le parti ---------------------------------------------------------------

  const note = document.createElement("p");
  note.className = "draw-properties-note";
  note.hidden = true;

  // Il tipo: tre scelte con la loro figura. Il nome sta nel gruppo, che lo
  // dice a chi ascolta; ogni scelta dice il suo.
  const kindRoot = document.createElement("div");
  kindRoot.className = "draw-properties-field";
  kindRoot.dataset.column = "all";
  kindRoot.dataset.field = "connector-kind";
  const kindLabel = document.createElement("span");
  kindLabel.className = "draw-properties-label";
  kindLabel.id = identifier("draw-connector-label");
  const kindBar = document.createElement("div");
  kindBar.className = "draw-properties-bar";
  kindBar.setAttribute("role", "radiogroup");
  kindBar.setAttribute("aria-labelledby", kindLabel.id);
  const radios = new Map<ConnectorKind, HTMLButtonElement>();
  for (const kind of KINDS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "draw-button draw-properties-segment";
    button.setAttribute("role", "radio");
    button.dataset.kind = kind;
    const glyph = iconEl(`draw-connector-${kind}`);
    if (glyph !== null) button.append(glyph);
    kindBar.append(button);
    radios.set(kind, button);
  }
  kindRoot.append(kindLabel, kindBar);

  const createMenu = (end: "from" | "to", column: "1" | "2"): Menu => {
    const root = document.createElement("div");
    root.className = "draw-properties-field";
    root.dataset.column = column;
    root.dataset.field = `connector-${end}`;
    const select = document.createElement("select");
    select.className = "draw-properties-input";
    select.id = identifier("draw-connector-anchor");
    const label = document.createElement("label");
    label.className = "draw-properties-label";
    label.htmlFor = select.id;
    root.append(label, select);
    return { end, root, label, select, built: null };
  };
  const fromMenu = createMenu("from", "1");
  const toMenu = createMenu("to", "2");
  const menus = [fromMenu, toMenu];

  const freeNote = document.createElement("p");
  freeNote.className = "draw-properties-note";
  freeNote.id = identifier("draw-connector-free");
  freeNote.hidden = true;

  // L'etichetta: più righe, scritte con Maiusc e Invio.
  const labelRoot = document.createElement("div");
  labelRoot.className = "draw-properties-field";
  labelRoot.dataset.column = "all";
  labelRoot.dataset.field = "connector-label";
  const area = document.createElement("textarea");
  area.className = "draw-properties-input";
  area.id = identifier("draw-connector-label-field");
  area.rows = 2;
  area.spellcheck = true;
  area.setAttribute("autocapitalize", "sentences");
  area.setAttribute("enterkeyhint", "done");
  const labelName = document.createElement("label");
  labelName.className = "draw-properties-label";
  labelName.htmlFor = area.id;
  const labelError = document.createElement("p");
  labelError.className = "draw-properties-error";
  labelError.id = identifier("draw-connector-error");
  labelError.hidden = true;
  labelRoot.append(labelName, area, labelError);
  /// Il testo scritto nel campo l'ultima volta: un campo che dice altro ha un
  /// testo scritto a metà.
  let shown = "";

  const invert = document.createElement("button");
  invert.type = "button";
  invert.className = "draw-button draw-properties-apply";
  invert.dataset.field = "connector-invert";

  element.append(note, kindRoot, fromMenu.root, toMenu.root, freeNote, labelRoot, invert);

  // --- Ciò che si mostra ----------------------------------------------------------

  /// Come un menu dice l'aggancio `choice`.
  const stateOf = (choice: AnchorChoice | null): MenuState => (choice === null ? "mixed" : choice === "free" ? "free" : "anchor");

  /// Scrive le voci di `menu` per lo stato `state`: le sei dell'aggancio, con
  /// «Misto» in testa fra capi diversi, o la sola «Libero».
  const buildMenu = (menu: Menu, state: MenuState): void => {
    const entries: HTMLOptionElement[] = [];
    const entry = (value: string, text: string, disabled = false): void => {
      const item = document.createElement("option");
      item.value = value;
      item.textContent = text;
      item.disabled = disabled;
      entries.push(item);
    };
    if (state === "free") {
      entry("free", t("draw.connector.anchor.free"));
    } else {
      if (state === "mixed") entry("mixed", t("draw.properties.mixed"), true);
      for (const anchor of ANCHORS) entry(anchor, t(ANCHOR_LABELS[anchor]));
    }
    menu.select.replaceChildren(...entries);
    menu.built = state;
  };

  const paintMenu = (menu: Menu, choice: AnchorChoice | null): void => {
    const state = stateOf(choice);
    setText(menu.label, t(menu.end === "from" ? "draw.connector.from" : "draw.connector.to"));
    // Le voci si riscrivono quando cambia lo stato o la lingua; `relabel` le
    // azzera.
    if (menu.built !== state) buildMenu(menu, state);
    menu.select.value = state === "free" ? "free" : state === "mixed" ? "mixed" : (choice as Anchor);
    menu.select.disabled = state === "free" || off();
    if (state === "free") menu.select.setAttribute("aria-describedby", freeNote.id);
    else menu.select.removeAttribute("aria-describedby");
  };

  function paint(fresh = false): void {
    painting = true;
    try {
      // La nota: quanti connettori non cambiano.
      const noteText = view.locked > 0 ? plural(view.locked, "draw.connector.locked.one", "draw.connector.locked.other") : "";
      note.hidden = noteText === "";
      setText(note, noteText);

      // Il tipo.
      setText(kindLabel, t("draw.connector.kind"));
      let rove: HTMLButtonElement | null = null;
      for (const kind of KINDS) {
        const radio = radios.get(kind)!;
        const name = t(KIND_LABELS[kind]);
        radio.setAttribute("aria-label", name);
        radio.title = name;
        radio.setAttribute("aria-checked", String(view.kind === kind));
        offWhen(radio, off());
        if (view.kind === kind) rove = radio;
      }
      // Un solo pulsante prende il Tab: la scelta di adesso, o il primo.
      rove ??= radios.get("straight")!;
      for (const radio of radios.values()) radio.tabIndex = radio === rove ? 0 : -1;

      // Gli agganci.
      paintMenu(fromMenu, view.from);
      paintMenu(toMenu, view.to);
      const free = view.from === "free" || view.to === "free";
      freeNote.hidden = !free;
      setText(freeNote, free ? t("draw.connector.free.note") : "");

      // L'etichetta.
      setText(labelName, t("draw.connector.label"));
      showLabel(view.label ?? "", fresh);
      area.readOnly = off();
      area.placeholder = view.label === null ? t("draw.properties.mixed") : "";

      // Il verso.
      setText(invert, t("draw.connector.invert"));
      invert.title = t("draw.connector.invert.hint");
      offWhen(invert, off());
    } finally {
      painting = false;
    }
  }

  /// Mostra `text` nel campo dell'etichetta, a meno che non vi si stia
  /// scrivendo; con `fresh` anche allora.
  function showLabel(text: string, fresh: boolean): void {
    const editing = document.activeElement === area && area.value !== shown;
    shown = text;
    if (editing && !fresh) return;
    area.value = text;
    if (area.getAttribute("aria-invalid") === "true") showError(null);
  }

  // --- Gli errori -----------------------------------------------------------------

  function showError(text: string | null): void {
    labelError.hidden = text === null;
    setText(labelError, text ?? "");
    if (text === null) {
      area.removeAttribute("aria-invalid");
      area.removeAttribute("aria-describedby");
    } else {
      area.setAttribute("aria-invalid", "true");
      area.setAttribute("aria-describedby", labelError.id);
    }
  }

  // --- Cambiare i connettori ----------------------------------------------------

  /// Manda `change` all'editor, col nome `label`. `null` se è fatto, altrimenti
  /// perché no, già detto a voce se `loud`.
  const send = (change: ConnectorChange, label: DrawKey, loud = true): string | null => {
    if (off()) {
      const why = reason();
      if (loud) options.announce(why);
      return why;
    }
    carry = true;
    let failure: string | null;
    try {
      failure = options.onChange(change, label);
    } finally {
      carry = false;
    }
    if (failure !== null && loud) options.announce(failure);
    return failure;
  };

  /// Sceglie il tipo `kind`, se non è già quello di tutti.
  const chooseKind = (kind: ConnectorKind): void => {
    if (view.kind === kind) return;
    send({ kind }, "draw.action.connector_kind");
  };

  for (const [kind, radio] of radios) life.listen(radio, "click", () => chooseKind(kind));

  // Come in ogni gruppo di scelte, le frecce passano alla scelta accanto e la
  // danno; Inizio e Fine vanno alla prima e all'ultima.
  life.listen(kindBar, "keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const current = KINDS.findIndex((kind) => radios.get(kind) === document.activeElement);
    if (current < 0) return;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (current + 1) % KINDS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (current - 1 + KINDS.length) % KINDS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = KINDS.length - 1;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    const kind = KINDS[next]!;
    const radio = radios.get(kind)!;
    for (const each of radios.values()) each.tabIndex = each === radio ? 0 : -1;
    radio.focus({ preventScroll: true });
    // In sola lettura, o con tutto bloccato, il fuoco si sposta e basta.
    if (!off()) chooseKind(kind);
  });

  // Un menu d'aggancio sceglie un punto per quel capo di tutti i connettori
  // scelti che ce l'hanno agganciato.
  for (const menu of menus) {
    life.listen(menu.select, "change", () => {
      if (painting) return;
      const value = menu.select.value;
      const anchor = ANCHORS.find((each) => each === value);
      if (anchor !== undefined && anchor !== (menu.end === "from" ? view.from : view.to)) send({ end: menu.end, anchor }, "draw.action.connector_anchor");
      // Se il disegno non l'ha accettato, o non ha cambiato niente, il menu
      // torna a dire com'è.
      paintMenu(menu, menu.end === "from" ? view.from : view.to);
    });
  }

  life.listen(invert, "click", () => {
    send({ invert: true }, "draw.action.connector_invert");
  });

  // --- L'etichetta ------------------------------------------------------------------

  /// Scrive il testo del campo; falso, e il campo resta com'era scritto, se il
  /// disegno non l'accetta.
  const commitLabel = (loud: boolean): boolean => {
    if (off() || area.value === shown) return true;
    const draft = area.value;
    const before = shown;
    // Il campo dice già il valore nuovo: l'aggiornamento che arriva mentre
    // l'editor lo scrive non lo prende per un testo scritto a metà.
    shown = draft;
    showError(null);
    const failure = send({ label: draft }, "draw.action.connector_label", false);
    if (failure === null) return true;
    shown = before;
    area.value = draft;
    showError(failure);
    if (loud) options.announce(failure);
    return false;
  };

  life.listen(area, "keydown", (event) => {
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    if (event.key === "Escape" && plain && !event.shiftKey) {
      // Senza niente da annullare, Esc torna al foglio, come negli altri
      // campi.
      if (area.value === shown) return;
      area.value = shown;
      showError(null);
    } else if (event.key === "Enter" && !event.altKey && !event.isComposing) {
      // Maiusc e Invio va a capo; Invio, e Ctrl o ⌘ e Invio, scrive.
      if (event.shiftKey) return;
      commitLabel(true);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  life.listen(area, "focusout", () => {
    // Un campo che se n'è andato non scrive: il testo a metà era per ciò che
    // mostrava prima.
    if (painting || labelRoot.closest("[hidden]") !== null) return;
    commitLabel(false);
  });

  const relabel = (): void => {
    for (const menu of menus) menu.built = null;
    paint(true);
  };
  relabel();

  return {
    element,
    update(next, nextEditable) {
      const fresh = next.key !== lastKey && !carry;
      lastKey = next.key;
      view = next;
      editable = nextEditable;
      paint(fresh);
    },
    relabel,
  };
}

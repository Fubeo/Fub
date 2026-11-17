// Il tipo della nota nella testata (E5): l'icona del tipo quando la nota non
// ne ha una sua, le proprietà in evidenza del tipo, e l'avviso quando il tipo
// che la nota nomina non c'è, non si legge o non è un nome, con «Scegli il
// tipo». Chi è il tipo lo dice il core (`note.type.get`); qui si tiene la
// risposta e si disegna.
//
// La risposta si chiede solo quando il valore di `tipo` cambia, e non a ogni
// battuta: chi scrive il nome del tipo a mano lo vede risolto dopo una pausa.
// Un tipo cambiato su disco (le sue proprietà in evidenza, il file rinominato)
// si richiede quando l'indice lo dice.
import { ChangeSet, type ChangeSpec, type EditorState } from "@codemirror/state";
import { createList, openPopover, type PopoverHandle } from "../../../../../kit";
import type { NoteType, NoteTypeList, NoteTypeState } from "../../../../../state/note-types";
import { iconEl } from "../../../../../ui/icons";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { drawTypeIcon, typeSummary } from "../../../../../ui/note-type-menu";
import { lastEntry, propertyBlock, setProperty, type PropertyWrite } from "../properties";
import { liveStrings } from "../strings";

/// La chiave con cui una nota dice il suo tipo.
export const TYPE_KEY = "tipo";
/// Quanto si aspetta dopo l'ultima battuta nel valore di `tipo`.
const SETTLE_MS = 300;

/// Il tipo come la testata lo confronta: due stati uguali non rifanno niente.
export function typeStamp(state: NoteTypeState | null): string {
  return state === null ? "" : JSON.stringify(state);
}

export interface NoteTypeSourceOptions {
  /// Chiede al core il tipo che `raw` nomina.
  readonly lookup: (raw: string) => Promise<NoteTypeState>;
  /// La risposta è arrivata ed è diversa: la testata si rifà.
  readonly changed: () => void;
  readonly lifetime: Lifetime;
}

export interface NoteTypeSource {
  /// Il tipo che `raw` nomina, se si sa già; altrimenti l'ultimo saputo
  /// (`null` se ancora niente) e la domanda parte.
  stateFor(raw: string): NoteTypeState | null;
  /// Richiede il tipo del valore di adesso (il tipo è cambiato su disco).
  refresh(): void;
}

export function noteTypeSource(options: NoteTypeSourceOptions): NoteTypeSource {
  let raw: string | null = null;
  let known: NoteTypeState | null = null;
  let asked = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  options.lifetime.add(() => {
    if (timer !== null) clearTimeout(timer);
    asked += 1;
  });
  const ask = (wanted: string): void => {
    const mine = ++asked;
    void options.lookup(wanted).then((next) => {
      if (mine !== asked || options.lifetime.closed) return;
      const before = typeStamp(known);
      known = next;
      if (typeStamp(next) !== before) options.changed();
    }, () => {
      // Un tipo che non si chiede non si dice: la testata resta com'era.
    });
  };
  return {
    stateFor(value) {
      if (value === raw) return known;
      const first = raw === null;
      raw = value;
      if (value.trim() === "") {
        if (timer !== null) clearTimeout(timer);
        asked += 1;
        known = { state: "untyped" };
        return known;
      }
      if (timer !== null) clearTimeout(timer);
      // La nota appena aperta chiede subito; una battuta aspetta la pausa.
      if (first || known === null || known.state === "untyped") ask(value);
      else timer = setTimeout(() => {
        timer = null;
        ask(value);
      }, SETTLE_MS);
      return known;
    },
    refresh() {
      if (raw !== null && raw.trim() !== "") ask(raw);
    },
  };
}

/// Il nome del tipo che l'avviso dice.
function wantedName(state: NoteTypeState): string {
  switch (state.state) {
    case "missing":
    case "ambiguous":
      return state.wanted;
    case "unreadable":
      return state.name;
    default:
      return "";
  }
}

/// L'avviso di un tipo guasto, o `null` se il tipo va (o non c'è).
export function typeNotice(state: NoteTypeState | null): string | null {
  if (state === null) return null;
  switch (state.state) {
    case "missing":
      return liveStrings.t("page.type.missing", { type: wantedName(state) });
    case "ambiguous":
      return liveStrings.t("page.type.ambiguous", { type: wantedName(state) });
    case "unreadable":
      return liveStrings.t("page.type.unreadable", { type: wantedName(state) });
    case "not_a_name":
      return liveStrings.t("page.type.not_a_name");
    default:
      return null;
  }
}

export interface TypeNoticeHost {
  /// «Scegli il tipo»: c'è soltanto dove si scrive.
  readonly choose?: (anchor: HTMLButtonElement) => void;
  /// «Apri il tipo» per un tipo che non si legge.
  readonly open?: (doc: string) => void;
}

/// L'avviso della testata per un tipo guasto: che cosa non va, e che cosa
/// fare. La nota non cambia finché chi la usa non sceglie.
export function typeNoticeElement(state: NoteTypeState | null, host: TypeNoticeHost, life: Lifetime): HTMLElement | null {
  const message = typeNotice(state);
  if (message === null || state === null) return null;
  const notice = document.createElement("div");
  notice.className = "cm-fub-page-type-notice";
  notice.setAttribute("role", "note");
  const figure = iconEl("warning");
  figure?.setAttribute("aria-hidden", "true");
  const text = document.createElement("span");
  text.className = "cm-fub-page-type-text";
  text.textContent = message;
  notice.append(...(figure ? [figure] : []), text);
  const action = (label: string, run: (button: HTMLButtonElement) => void): void => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cm-fub-page-type-action";
    button.dataset.pageNav = "";
    button.textContent = label;
    life.listen(button, "click", () => run(button));
    notice.append(button);
  };
  if (state.state === "unreadable" && host.open) {
    const doc = state.doc;
    action(liveStrings.t("page.type.open"), () => host.open!(doc));
  }
  if (host.choose) action(liveStrings.t("page.type.choose"), host.choose);
  return notice;
}

/// L'icona del tipo al posto di quella della nota, che non ne ha una sua.
/// Scrivendo è un pulsante: sceglie un'icona per questa nota.
export function typeIconElement(type: NoteType, writing: boolean, writable: boolean, change: (anchor: HTMLElement) => void, life: Lifetime): HTMLElement {
  const icon = document.createElement(writing ? "button" : "span");
  icon.className = "cm-fub-page-icon";
  icon.dataset.fromType = "";
  drawTypeIcon(icon, type.icon);
  const label = liveStrings.t("page.type.icon", { type: type.name });
  if (icon instanceof HTMLButtonElement) {
    icon.type = "button";
    icon.setAttribute("aria-label", label);
    icon.disabled = !writable;
    life.listen(icon, "click", () => change(icon));
  } else {
    icon.setAttribute("role", "img");
    icon.setAttribute("aria-label", type.name);
  }
  return icon;
}

/// «Scegli il tipo»: i tipi del vault in un menu sotto il pulsante. Un tipo
/// che non si legge si vede ma non si sceglie.
export function openTypeChooser(anchor: HTMLElement, list: NoteTypeList, choose: (type: NoteType) => void, life: Lifetime, closed: () => void): PopoverHandle {
  const own = openLifetime();
  const body = document.createElement("div");
  body.className = "note-type-menu";
  const rows = document.createElement("div");
  rows.className = "note-type-menu-list";
  rows.setAttribute("aria-label", liveStrings.t("page.type.chooser"));
  body.append(rows);
  if (list.types.length === 0) {
    const none = document.createElement("p");
    none.className = "note-type-menu-foot";
    none.textContent = liveStrings.t("page.type.none", { folder: list.folder ?? "Tipi" });
    body.append(none);
  }
  const handle = createList<NoteType>({
    container: rows,
    role: "menu",
    items: list.types,
    key: (type) => type.doc,
    render: (type, row) => {
      row.classList.add("note-type-menu-item");
      const tile = document.createElement("span");
      tile.className = "note-type-menu-tile";
      tile.setAttribute("aria-hidden", "true");
      drawTypeIcon(tile, type.icon);
      const label = document.createElement("span");
      label.className = "note-type-menu-label";
      const name = document.createElement("span");
      name.className = "note-type-menu-name";
      name.textContent = type.name;
      label.append(name);
      const summary = typeSummary(type);
      if (summary !== "") {
        const sub = document.createElement("small");
        sub.className = "note-type-menu-sub";
        sub.textContent = summary;
        label.append(sub);
      }
      row.replaceChildren(tile, label);
    },
    disabled: (type) => !type.readable,
    onActivate: (type) => {
      popover.close();
      choose(type);
    },
    typeahead: (type) => type.name,
    focus: "roving",
    lifetime: own,
  });
  const first = list.types.find((type) => type.readable);
  if (first) handle.setActive(first.doc);
  const popover = openPopover({
    anchor,
    content: body,
    label: liveStrings.t("page.type.chooser"),
    placement: "bottom",
    align: "start",
    className: "note-type-popover",
    lifetime: life,
    onClose: () => {
      own.close();
      closed();
    },
  });
  if (first) handle.element(first.doc)?.focus();
  return popover;
}

/// Il valore vuoto di una proprietà nuova, come lo scrive il core
/// (`frontmatter_line`): una casella è `false`, un elenco `[]`.
function blankOf(kind: string | null): PropertyWrite {
  if (kind === "checkbox") return false;
  if (kind === "list" || kind === "tags") return [];
  return "";
}

/// Dà alla nota il tipo `type` nel testo: `tipo` diventa il suo link, e le
/// proprietà del tipo che mancano arrivano vuote, in fondo; niente si toglie,
/// come `note.type.set`. Una modifica sola, da annullare in un passo. `null`
/// se il frontmatter non si legge (allora non si scrive niente).
export function typedChanges(state: EditorState, type: NoteType): ChangeSet | null {
  const block = propertyBlock(state);
  if (block?.unreadable) return null;
  let current = state;
  let changes = ChangeSet.empty(state.doc.length);
  const apply = (key: string, value: PropertyWrite): void => {
    const change: ChangeSpec | null = setProperty(current, key, value);
    if (!change) return;
    const set = ChangeSet.of(change, current.doc.length);
    changes = changes.compose(set);
    current = current.update({ changes: set }).state;
  };
  apply(TYPE_KEY, `[[${type.link}]]`);
  for (const property of type.properties) {
    if (property.key === TYPE_KEY) continue;
    const entries = propertyBlock(current)?.entries ?? [];
    if (lastEntry(entries, property.key)) continue;
    apply(property.key, blankOf(property.kind));
  }
  return changes.empty ? null : changes;
}

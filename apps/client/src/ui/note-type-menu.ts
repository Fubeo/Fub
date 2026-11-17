// «Nuova nota» chiede il tipo (E5, prototipo `newNote()`): un menu sotto il
// pulsante, con in cima «Nota», la nota semplice, e sotto i tipi del vault,
// ognuno nel suo tassello con l'icona, il nome e che cosa porta. Invio a menu
// appena aperto tiene la nota semplice; Esc o un clic fuori non creano niente.
//
// Il menu sceglie e basta: creare la nota è di chi lo apre
// (`state/new-note.ts`). Un tipo che non si legge si vede ma non si sceglie:
// creare da lui non riuscirebbe, e la riga dice perché.
import { t } from "../i18n/strings";
import { createList, openPopover, type PopoverAnchor } from "../kit";
import type { NoteType, NoteTypeList } from "../state/note-types";
import { iconEl } from "./icons";
import { openLifetime } from "./lifetime";
import { drawPageMark } from "./page-mark";

/// La figura di un tipo senza icona, e quella della nota semplice.
export const TYPE_FIGURE = "template";
const PLAIN_FIGURE = "notes";
/// Quante proprietà dice la riga di un tipo.
const SHOWN_KEYS = 3;

interface Choice {
  readonly key: string;
  readonly type: NoteType | null;
}

/// Disegna l'icona di un tipo dentro `host`: un'emoji o una figura (`book`,
/// `fub:book`) lette come l'icona di una pagina (`ui/page-mark.ts`), se no la
/// figura dei tipi.
export function drawTypeIcon(host: HTMLElement, icon: string | null): void {
  if (drawPageMark(host, icon)) return;
  const figure = iconEl(TYPE_FIGURE);
  host.replaceChildren(...(figure ? [figure] : []));
}

/// Che cosa porta un tipo, in una riga: le proprietà in evidenza (o le
/// prime), altrimenti la cartella delle sue note.
export function typeSummary(type: NoteType): string {
  if (!type.readable) return t("newnote.unreadable");
  const keys = type.featured.length > 0 ? type.featured : type.properties.map((property) => property.key);
  if (keys.length > 0) {
    const shown = keys.slice(0, SHOWN_KEYS).join(", ");
    return keys.length > SHOWN_KEYS ? `${shown}, …` : shown;
  }
  return type.folder ? t("newnote.in_folder", { folder: type.folder }) : "";
}

/// Apre il menu dei tipi sotto `anchor`. Torna il tipo scelto, `null` per la
/// nota semplice, `undefined` se il menu si è chiuso senza scelta.
export function chooseNoteType(list: NoteTypeList, anchor: PopoverAnchor): Promise<NoteType | null | undefined> {
  return new Promise((resolve) => {
    const own = openLifetime();
    let chosen: NoteType | null | undefined;
    const choices: Choice[] = [
      { key: "plain", type: null },
      ...list.types.map((type) => ({ key: `type:${type.doc}`, type })),
    ];
    const body = document.createElement("div");
    body.className = "note-type-menu";
    const head = document.createElement("div");
    head.className = "note-type-menu-head";
    head.id = `note-type-menu-head-${Math.random().toString(36).slice(2)}`;
    head.textContent = t("newnote.types.title");
    const rows = document.createElement("div");
    rows.className = "note-type-menu-list";
    rows.setAttribute("aria-labelledby", head.id);
    const handle = createList<Choice>({
      container: rows,
      role: "menu",
      items: choices,
      key: (choice) => choice.key,
      render: (choice, row) => {
        row.classList.add("note-type-menu-item");
        const tile = document.createElement("span");
        tile.className = "note-type-menu-tile";
        tile.setAttribute("aria-hidden", "true");
        if (choice.type) drawTypeIcon(tile, choice.type.icon);
        else tile.replaceChildren(...[iconEl(PLAIN_FIGURE)].filter((node): node is SVGElement => node !== null));
        const label = document.createElement("span");
        label.className = "note-type-menu-label";
        const name = document.createElement("span");
        name.className = "note-type-menu-name";
        name.textContent = choice.type ? choice.type.name : t("newnote.plain");
        label.append(name);
        const summary = choice.type ? typeSummary(choice.type) : t("newnote.plain.hint");
        if (summary !== "") {
          const sub = document.createElement("small");
          sub.className = "note-type-menu-sub";
          sub.textContent = summary;
          label.append(sub);
        }
        row.replaceChildren(tile, label);
      },
      disabled: (choice) => choice.type !== null && !choice.type.readable,
      onActivate: (choice) => {
        chosen = choice.type;
        popover.close();
      },
      typeahead: (choice) => (choice.type ? choice.type.name : t("newnote.plain")),
      focus: "roving",
      lifetime: own,
    });
    // A menu appena aperto è attiva la nota semplice: Invio la tiene.
    handle.setActive("plain");
    const parts: HTMLElement[] = [head, rows];
    if (list.folder) {
      const foot = document.createElement("p");
      foot.className = "note-type-menu-foot";
      foot.textContent = t("newnote.foot", { folder: list.folder });
      parts.push(foot);
    }
    body.append(...parts);
    const popover = openPopover({
      anchor,
      content: body,
      label: t("newnote.types.title"),
      placement: "bottom",
      align: "start",
      className: "note-type-popover",
      lifetime: own,
      onClose: () => {
        own.close();
        resolve(chosen);
      },
    });
    handle.element("plain")?.focus();
  });
}

// Il menu di una proprietà della testata (T8), dal suo nome: Rinomina, Tipo,
// In evidenza, Togli dalla nota. Rinomina e Togli scrivono nella nota, con un
// passo d'annullamento; Tipo dichiara il tipo nel registro del vault
// (`property.type.set`), per tutte le note; In evidenza sposta la voce fra
// le prime quattro del frontmatter (A-15), o in fondo.
import type { PropertyType } from "../../../../../../host/enums.generated";
import { createList, openPopover, textField, type PopoverHandle } from "../../../../../../kit";
import { iconEl } from "../../../../../../ui/icons";
import { openLifetime, type Lifetime } from "../../../../../../ui/lifetime";
import type { PropertyEntry } from "../../properties";
import { liveStrings } from "../../strings";
import { MENU_TYPES, rowIcon, typeIcon, type RowKind } from "./kind";
import { entryStamp, typeName, type PropertyRowHost } from "./values";

interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  /// Ciò che sta a destra, più piano: il tipo attuale accanto a «Tipo».
  readonly hint?: string;
  readonly role: "menuitem" | "menuitemradio" | "heading";
  readonly checked?: boolean;
  readonly danger?: boolean;
  readonly run?: () => void;
}

/// Apre il menu della proprietà sotto il suo nome. `featured` dice se la
/// riga sta fra quelle in evidenza; `null` se lo sono tutte.
export function openPropertyMenu(entry: PropertyEntry, kind: RowKind, anchor: HTMLElement, host: PropertyRowHost, life: Lifetime, featured: boolean | null = null): PopoverHandle {
  const own = openLifetime();
  const type = kind.declared ?? kind.kind;
  const close = () => popover.close();
  const main = (): MenuItem[] => [
    { id: "head", label: `${entry.key} · ${typeName(type)}`, role: "heading" },
    { id: "rename", label: liveStrings.t("page.properties.rename"), icon: "pen", role: "menuitem", run: () => {
      close();
      openRenameDialog(entry, anchor, host, life);
    } },
    ...(host.setType ? [{ id: "type", label: liveStrings.t("page.properties.type"), icon: rowIcon(kind), hint: typeName(type), role: "menuitem" as const, run: () => {
      handle.setItems(types());
      handle.setActive(`type-${type}`);
    } }] : []),
    // Con quattro voci o meno sono tutte in evidenza: niente da spostare.
    ...(featured === null ? [] : [{ id: "feature", label: liveStrings.t(featured ? "page.properties.unfeature" : "page.properties.feature"), icon: "fmt-star", role: "menuitem" as const, run: () => {
      close();
      host.feature(entry.key, !featured);
    } }]),
    { id: "remove", label: liveStrings.t("page.properties.remove"), icon: "trash", role: "menuitem", danger: true, run: () => {
      close();
      host.write(entry.key, null, entryStamp(host.current(entry.key)));
    } },
  ];
  const types = (): MenuItem[] => [
    { id: "back", label: `‹ ${liveStrings.t("page.properties.type.title", { key: entry.key })}`, role: "menuitem", run: () => {
      handle.setItems(main());
      handle.setActive("type");
    } },
    ...MENU_TYPES.map((name): MenuItem => ({
      id: `type-${name}`,
      label: typeName(name),
      icon: typeIcon(name),
      role: "menuitemradio",
      checked: kind.declared === name,
      run: () => {
        close();
        void chooseType(entry.key, name, host);
      },
    })),
  ];
  const list = document.createElement("div");
  list.className = "cm-fub-block-menu cm-fub-prop-menu";
  list.setAttribute("aria-label", liveStrings.t("page.properties.menu", { key: entry.key }));
  const handle = createList<MenuItem>({
    container: list,
    role: "menu",
    items: main(),
    key: (item) => item.id,
    render: (item, row) => {
      if (item.role === "heading") {
        // Un menu ammette solo voci, gruppi e separatori: la testata è una
        // voce spenta (`disabled` qui sotto), che il lettore di schermo dice
        // e le frecce saltano.
        row.className += " cm-fub-prop-menu-head";
        row.setAttribute("role", "menuitem");
        row.textContent = item.label;
        return;
      }
      const figure = item.icon ? iconEl(item.icon) : null;
      figure?.setAttribute("aria-hidden", "true");
      const text = document.createElement("span");
      text.className = "cm-fub-prop-menu-label";
      text.textContent = item.label;
      const parts: Node[] = [...(figure ? [figure] : []), text];
      if (item.hint) {
        const hint = document.createElement("span");
        hint.className = "cm-fub-prop-menu-hint";
        hint.textContent = item.hint;
        parts.push(hint);
      }
      if (item.role === "menuitemradio") {
        const check = document.createElement("span");
        check.className = "cm-fub-page-check";
        check.setAttribute("aria-hidden", "true");
        check.textContent = item.checked ? "✓" : "";
        parts.push(check);
        row.setAttribute("aria-checked", String(item.checked === true));
      } else row.removeAttribute("aria-checked");
      row.setAttribute("role", item.role);
      if (item.danger) row.dataset.danger = "true";
      else delete row.dataset.danger;
      row.replaceChildren(...parts);
    },
    disabled: (item) => item.role === "heading",
    onActivate: (item) => item.run?.(),
    focus: "roving",
    lifetime: own,
  });
  handle.setActive("rename");
  host.editing(true);
  const popover = openPopover({
    anchor,
    content: list,
    label: liveStrings.t("page.properties.menu", { key: entry.key }),
    placement: "bottom",
    align: "start",
    className: "cm-fub-block-popover",
    lifetime: life,
    onClose: () => {
      own.close();
      anchor.setAttribute("aria-expanded", "false");
      host.editing(false);
    },
  });
  anchor.setAttribute("aria-expanded", "true");
  return popover;
}

/// Dichiara il tipo nel registro del vault e dice com'è andata: il tipo vale
/// per tutte le note, e i valori che non tornano restano testo, segnati.
async function chooseType(key: string, type: PropertyType, host: PropertyRowHost): Promise<void> {
  if (!host.setType) return;
  const problem = await host.setType(key, type).catch((error: unknown) => error instanceof Error ? error.message : String(error));
  if (problem === null) host.notify?.(liveStrings.t("page.properties.type.done", { key, type: typeName(type).toLocaleLowerCase() }), "info");
  else host.notify?.(liveStrings.t("page.properties.type.failed", { key, reason: problem }), "guasto");
}

/// «Rinomina»: un campo col nome di adesso. Invio rinomina la chiave nella
/// nota; un nome già preso lo dice e il campo resta.
function openRenameDialog(entry: PropertyEntry, anchor: HTMLElement, host: PropertyRowHost, life: Lifetime): PopoverHandle {
  const own = openLifetime();
  const body = document.createElement("div");
  body.className = "cm-fub-page-picker cm-fub-prop-rename";
  const note = document.createElement("p");
  note.className = "cm-fub-prop-note";
  note.setAttribute("role", "alert");
  note.hidden = true;
  const field = textField({
    label: liveStrings.t("page.properties.rename.label", { key: entry.key }),
    labelHidden: true,
    value: entry.key,
    lifetime: own,
    onSubmit: (value) => {
      const problem = host.renameKey(entry.key, value);
      if (problem === null) {
        popover.close();
        return;
      }
      note.hidden = false;
      note.textContent = problem;
    },
  });
  body.append(field.element, note);
  host.editing(true);
  const popover = openPopover({
    anchor,
    content: body,
    label: liveStrings.t("page.properties.rename.label", { key: entry.key }),
    role: "dialog",
    placement: "bottom",
    align: "start",
    className: "cm-fub-page-popover",
    lifetime: life,
    onClose: () => {
      own.close();
      host.editing(false);
    },
  });
  field.focus();
  field.input.select();
  return popover;
}

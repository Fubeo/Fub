// Il bottone e il menu dello spazio di lavoro nella banda (piano K6, T7). Sono
// due funzioni pure sul DOM e sulla superficie: la banda (`status-band.ts`) le
// chiama, e il test le prova senza la pagina intera.
import type { SurfaceWorkspace } from "../../../editors/core/registry";
import { t } from "../../../i18n/strings";
import { iconEl } from "../../../ui/icons";
import type { MenuItem } from "../../../ui/menu";

/// Il bottone dello spazio di lavoro del disegno a fuoco (T7), prima della
/// modalità: la figura, il nome dello spazio in uso e la freccia, come la
/// modalità. Senza una superficie che lo offre, il bottone sparisce.
export function drawWorkspaceButton(button: HTMLElement, space: SurfaceWorkspace | null): void {
  if (!space) {
    button.hidden = true;
    if (button.firstChild) button.replaceChildren();
    button.removeAttribute("aria-label");
    return;
  }
  const current = space.current();
  if (!button.querySelector(":scope > .status-workspace-name")) {
    const glyph = iconEl("draw-workspace");
    const name = document.createElement("span");
    name.className = "status-workspace-name";
    const arrow = document.createElement("span");
    arrow.className = "status-workspace-arrow";
    arrow.setAttribute("aria-hidden", "true");
    const chevron = iconEl("chevron-up");
    if (chevron) arrow.append(chevron);
    button.replaceChildren(...(glyph ? [glyph] : []), name, arrow);
  }
  const name = button.querySelector<HTMLElement>(":scope > .status-workspace-name")!;
  if (name.textContent !== current.name) name.textContent = current.name;
  button.setAttribute("aria-label", t("frame.workspace.current", { name: current.name }));
  button.hidden = false;
}

/// Le voci del menu dello spazio: prima gli spazi (con una riga fra i gruppi),
/// poi le azioni, dopo una riga. Uno spazio spento dice il perché, al posto
/// della descrizione.
export function workspaceMenuItems(space: SurfaceWorkspace): MenuItem[] {
  const current = space.current();
  const groups: Record<string, string> = {
    completo: t("frame.workspace.group.completo"),
    salvato: t("frame.workspace.group.salvati"),
  };
  const items: MenuItem[] = [];
  let previous: string | null = null;
  for (const choice of space.choices()) {
    const group = choice.group === "base" ? undefined : groups[choice.group];
    const separator = previous !== null && choice.group !== previous;
    previous = choice.group;
    const description = choice.enabled ? choice.description : choice.reason;
    items.push({
      label: choice.name,
      ...(description ? { description } : {}),
      choice: "radio",
      checked: choice.id === current.id,
      selected: choice.id === current.id,
      disabled: !choice.enabled,
      ...(group !== undefined ? { group } : {}),
      ...(separator ? { separator: true } : {}),
      run: () => space.choose(choice.id),
    });
  }
  space.actions().forEach((action, index) => {
    items.push({
      label: action.label,
      ...(action.description ? { description: action.description } : {}),
      disabled: !action.enabled,
      ...(index === 0 && items.length > 0 ? { separator: true } : {}),
      run: action.run,
    });
  });
  return items;
}

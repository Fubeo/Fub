// La barra inferiore: il binario di un telefono.
//
// Le icone restano quelle del binario (`panels/rail.ts`, `frame/rail.ts`), e
// che su un telefono stiano in fila sotto il foglio lo dice `mobile.css`. Qui
// se ne aggiunge una: l'ispettore, che sul desktop si apre dalla barra del
// titolo e su un telefono sale dal basso come gli altri pannelli, quindi sta
// con loro. Preme lo stesso comando del bottone della barra del titolo.
import { t } from "../../../i18n/strings";
import { icon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { keepLabelled, labelCommandButton, run } from "../frame/commands";
import { byId, follow } from "../frame/dom";

const INSPECTOR = "shell.inspector.toggle";

export function mountBottomBar(lifetime: Lifetime): void {
  const foot = byId("rail-foot");
  const inspector = byId("right-pane");
  if (!foot || !inspector) return;
  const button = foot.ownerDocument.createElement("button");
  button.type = "button";
  button.className = "rail-btn rail-btn-inspector";
  button.setAttribute("aria-controls", inspector.id);
  button.innerHTML = icon("panel-right");
  keepLabelled(lifetime, () => labelCommandButton(button, t("menu.view.inspector"), INSPECTOR));
  // Lo stato è del cassetto. `aria-expanded` e non `aria-pressed`: la tacca
  // del binario segue l'icona premuta, e questa non sceglie un pannello.
  const sync = (): void => {
    const open = String(!inspector.hidden);
    if (button.getAttribute("aria-expanded") !== open) button.setAttribute("aria-expanded", open);
  };
  sync();
  follow(lifetime, inspector, sync, { attributes: ["hidden"] });
  lifetime.listen(button, "click", () => run(INSPECTOR));
  foot.prepend(button);
  lifetime.add(() => button.remove());
}

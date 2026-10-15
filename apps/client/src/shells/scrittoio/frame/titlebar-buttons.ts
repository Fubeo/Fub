// I bottoni della barra del titolo che premono un comando: indietro e avanti
// del foglio a fuoco, e l'ispettore.
import { t } from "../../../i18n/strings";
import { activePane } from "../../../state/layout";
import { on } from "../../../state/store";
import { icon } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { labelCommandButton, keepLabelled, run } from "./commands";
import { byId, follow } from "./dom";

const BACK = "shell.pane.back";
const FORWARD = "shell.pane.forward";
const INSPECTOR = "shell.inspector.toggle";

export function mountFrameNav(lifetime: Lifetime): void {
  const back = byId<HTMLButtonElement>("nav-back");
  const forward = byId<HTMLButtonElement>("nav-forward");
  if (!back || !forward) return;
  back.innerHTML = icon("arrow-left");
  forward.innerHTML = icon("arrow-right");
  keepLabelled(lifetime, () => {
    labelCommandButton(back, t("menu.go.back"), BACK);
    labelCommandButton(forward, t("menu.go.forward"), FORWARD);
  });
  // Una freccia che non porta da nessuna parte lo dice prima che la si prema.
  const sync = (): void => {
    const history = activePane().history;
    back.disabled = !history || history.past.length === 0;
    forward.disabled = !history || history.future.length === 0;
  };
  sync();
  lifetime.add(on("layout", sync));
  lifetime.add(on("active-doc", sync));
  lifetime.add(on("vault", sync));
  lifetime.listen(back, "click", () => run(BACK));
  lifetime.listen(forward, "click", () => run(FORWARD));
}

export function mountInspectorToggle(lifetime: Lifetime): void {
  const toggle = byId<HTMLButtonElement>("toggle-inspector");
  const inspector = byId("right-pane");
  if (!toggle || !inspector) return;
  toggle.innerHTML = icon("panel-right");
  keepLabelled(lifetime, () => labelCommandButton(toggle, t("menu.view.inspector"), INSPECTOR));
  // Lo stato è del cassetto, non del bottone: lo si legge da lì, così vale
  // anche quando lo apre un comando, una scorciatoia o l'adattamento.
  const sync = (): void => toggle.setAttribute("aria-pressed", String(!inspector.hidden));
  sync();
  follow(lifetime, inspector, sync, { attributes: ["hidden"] });
  lifetime.listen(toggle, "click", () => run(INSPECTOR));
}

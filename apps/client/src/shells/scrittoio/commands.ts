// I comandi che esistono solo nello Scrittoio.
//
// La shell comune dichiara i suoi; questi sono di questa cornice, e per questo
// si dichiarano qui e si ritirano con lei: lo spazio dell'interfaccia (che solo
// la serie dello Scrittoio sa tradurre in misure), il cambio di luce (che qui
// ha una scena), il fuoco da un foglio a quello accanto e quello fra le zone
// della finestra, che sono di questa cornice. Gli id stanno nella tabella
// dell'host come tutti gli altri
// (`crates/fub-host/src/shell.rs`): è ciò che dà loro una riga fra le
// scorciatoie.
import { errorText } from "../../host/errors";
import { registerShellCommand, unregisterShellCommand, type ShellCommand } from "../../ui/commands";
import type { Lifetime } from "../../ui/lifetime";
import { notify } from "../../ui/notify";
import { panes } from "../../state/layout";
import { byId } from "./frame/dom";
import { switchLight, turnLight } from "./frame/light";
import { focusNeighbour, type Direction } from "./pane-focus";
import { spaceBy } from "./space";
import { stepZone } from "./zones";

export function mountShellCommands(lifetime: Lifetime): void {
  const declare = (command: ShellCommand): void => {
    registerShellCommand(command);
    lifetime.add(() => unregisterShellCommand(command));
  };

  declare({
    id: "shell.chrome.compact.more",
    title: "commands.chrome.compact.more",
    description: "commands.chrome.compact.more.desc",
    layer: "global",
    run: () => void spaceBy(1),
  });
  declare({
    id: "shell.chrome.compact.less",
    title: "commands.chrome.compact.less",
    description: "commands.chrome.compact.less.desc",
    layer: "global",
    run: () => void spaceBy(-1),
  });
  declare({
    id: "shell.chrome.compact.reset",
    title: "commands.chrome.compact.reset",
    description: "commands.chrome.compact.reset.desc",
    layer: "global",
    run: () => void spaceBy(0),
  });

  // Il fuoco fra fogli, per direzione. Con un foglio solo non c'è dove andare:
  // i comandi restano in elenco ma non si offrono.
  const directions: readonly Direction[] = ["left", "right", "up", "down"];
  for (const direction of directions) {
    declare({
      id: `shell.pane.focus.${direction}`,
      title: `commands.pane.focus.${direction}`,
      description: `commands.pane.focus.${direction}.desc`,
      layer: "global",
      available: () => panes().length > 1,
      run: () => void focusNeighbour(direction),
    });
  }

  // F6 e Maiusc+F6 fra le zone della finestra: la barra del documento, il
  // foglio, l'ispettore, la banda.
  declare({
    id: "shell.zone.next",
    title: "commands.zone.next",
    description: "commands.zone.next.desc",
    layer: "global",
    run: () => stepZone(1),
  });
  declare({
    id: "shell.zone.prev",
    title: "commands.zone.prev",
    description: "commands.zone.prev.desc",
    layer: "global",
    run: () => stepZone(-1),
  });

  // Una luce alla volta, e nessun gesto perso. Mentre il cerchio cresce la
  // luce non è scritta: il gesto lo fa rientrare. Dopo, un cambio nuovo
  // scriverebbe la luce di prima sopra quella nuova: aspetta che la scena
  // finisca, e due gesti in attesa si annullano.
  let switching = false;
  let again = false;
  const toggleLight = (): void => {
    if (lifetime.closed) return;
    if (switching) {
      if (!turnLight()) again = !again;
      return;
    }
    switching = true;
    switchLight(byId("toggle-light"), lifetime)
      .catch((error: unknown) => notify(errorText(error), "guasto"))
      .finally(() => {
        switching = false;
        if (!again) return;
        again = false;
        toggleLight();
      });
  };
  declare({
    id: "shell.light.toggle",
    title: "commands.light.toggle",
    description: "commands.light.toggle.desc",
    layer: "global",
    run: toggleLight,
  });
}

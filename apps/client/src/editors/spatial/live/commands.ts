// I comandi della sessione live: avviarla sul disegno a fuoco, rivederne il
// pannello, terminarla.
//
// Stanno con la shell e pesano poco: il codice della sessione arriva con un
// `import()` solo quando si avvia. In un browser, dove le porte `live_*` non
// ci sono, e nella shell mobile, dove il dispositivo è semmai lo scrittore e
// non il PC, «Avvia» non compare; gli altri due servono solo a una sessione
// aperta, che lì non nasce.

import { api } from "../../../host/ipc";
import { platformSupports } from "../../../platform/capabilities";
import { registerShellCommand } from "../../../ui/commands";
import { liveFor, liveSessions, type LiveHandle } from "./registry";

export interface LiveCommandTargets {
  /// Il documento della scheda a fuoco, qualunque sia la vista.
  focusedDoc(): string | null;
  /// Lo stesso, se la scheda lo mostra come disegno.
  focusedDrawing(): string | null;
}

/// La sessione del documento a fuoco, o l'unica aperta.
function target(targets: LiveCommandTargets): LiveHandle | null {
  const doc = targets.focusedDoc();
  const own = doc === null ? null : liveFor(doc);
  if (own !== null) return own;
  const open = liveSessions();
  return open.length === 1 ? open[0]! : null;
}

export function registerLiveCommands(targets: LiveCommandTargets): void {
  registerShellCommand({
    id: "shell.live.start",
    title: "commands.live.start",
    description: "commands.live.start.desc",
    layer: "document",
    available: () => {
      const doc = targets.focusedDrawing();
      return doc !== null && liveFor(doc) === null && !platformSupports("touchFirst") && api.liveSupported();
    },
    run: async () => {
      const doc = targets.focusedDrawing();
      if (doc === null) return;
      const { startLive } = await import("./session");
      await startLive(doc);
    },
  });
  registerShellCommand({
    id: "shell.live.show",
    title: "commands.live.show",
    description: "commands.live.show.desc",
    layer: "document",
    available: () => target(targets) !== null,
    run: () => target(targets)?.show(),
  });
  registerShellCommand({
    id: "shell.live.stop",
    title: "commands.live.stop",
    description: "commands.live.stop.desc",
    layer: "document",
    available: () => target(targets) !== null,
    run: async () => {
      await target(targets)?.stop();
    },
  });
}

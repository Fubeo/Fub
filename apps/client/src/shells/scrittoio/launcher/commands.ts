// I comandi che aprono il lanciatore.
//
// Cinque sono solo dello Scrittoio e si dichiarano come gli altri. Due
// (`shell.switcher`, `shell.palette`) esistono già nella shell comune, che li
// usa per il selettore e la palette vecchi: lo Scrittoio li ridichiara, perché
// gli stessi accordi e la stessa pillola aprano la superficie nuova.
//
// Il registro sostituisce per id e, al ritiro, toglie: non ricorda chi c'era
// prima. Lo ricorda questo modulo, e allo smontaggio rimette al suo posto ciò
// che ha coperto. La dichiarazione che torna è una copia equivalente (gesto,
// livello, titoli), non l'oggetto di prima: di più il registro non dà.
import type { ShellCommandId } from "../../../ui/shell-keys.generated";
import {
  allCommands,
  registerShellCommand,
  unregisterShellCommand,
  type ShellCommand,
} from "../../../ui/commands";
import type { Lifetime } from "../../../ui/lifetime";
import type { Mode } from "./model";

/// Che cosa i comandi chiedono al lanciatore.
export interface LauncherOpener {
  open(mode: Mode): void;
}

type Declared = Pick<ShellCommand, "title" | "description"> & { id: ShellCommandId; mode: Mode };

/// I due della shell comune che il lanciatore copre, coi loro titoli.
export const REDECLARED: readonly Declared[] = [
  { id: "shell.switcher", title: "commands.switcher", description: "commands.switcher.desc", mode: "files" },
  { id: "shell.palette", title: "commands.palette", description: "commands.palette.desc", mode: "commands" },
];

/// Quelli che esistono solo qui: l'host li dichiara senza accordo.
export const OWN: readonly Declared[] = [
  { id: "shell.launcher.search", title: "launcher.command.search", description: "launcher.command.search.desc", mode: "search" },
  { id: "shell.launcher.headings", title: "launcher.command.headings", description: "launcher.command.headings.desc", mode: "headings" },
  { id: "shell.launcher.tags", title: "launcher.command.tags", description: "launcher.command.tags.desc", mode: "tags" },
  { id: "shell.launcher.line", title: "launcher.command.line", description: "launcher.command.line.desc", mode: "line" },
  { id: "shell.launcher.templates", title: "launcher.command.templates", description: "launcher.command.templates.desc", mode: "templates" },
];

export function declareLauncherCommands(lifetime: Lifetime, launcher: LauncherOpener): void {
  const command = (each: Declared): ShellCommand => ({
    id: each.id,
    title: each.title,
    description: each.description,
    layer: "global",
    run: () => launcher.open(each.mode),
  });

  for (const each of OWN) {
    const mine = command(each);
    registerShellCommand(mine);
    lifetime.add(() => unregisterShellCommand(mine));
  }

  for (const each of REDECLARED) {
    const covered = allCommands().find((entry) => entry.id === each.id);
    const mine = command(each);
    registerShellCommand(mine);
    lifetime.add(() => {
      // Se nel frattempo qualcuno ha ridichiarato l'id, la sua resta dov'è.
      const current = allCommands().find((entry) => entry.id === each.id);
      if (current && current.run !== mine.run) return;
      if (covered?.run) {
        registerShellCommand({ ...mine, layer: covered.layer, run: covered.run });
      } else {
        unregisterShellCommand(mine);
      }
    });
  }
}

// Le icone che la cornice Scrittoio aggiunge al set della shell.
//
// Passano da `registerIcon`, come quelle di ogni modulo: stessa griglia, stesso
// tratto, soltanto tracciati. Un nome già disegnato non si ridefinisce, quindi
// qui stanno solo figure che il set di serie non ha.
import { registerIcon } from "../../ui/icons";
import type { Lifetime } from "../../ui/lifetime";

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  "arrow-left": ["M19 12H5", "M11 6l-6 6 6 6"],
  "arrow-right": ["M5 12h14", "M13 6l6 6-6 6"],
  "panel-right": ["M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M15 4v16"],
  "panel-left": ["M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M9 4v16"],
  sun: [
    "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    "M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  ],
  moon: ["M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"],
  help: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M9.6 9.3a2.5 2.5 0 0 1 4.9.7c0 1.7-2.5 2.2-2.5 3.8", "M12 17h.01"],
  "caret-down": ["M7 10l5 5 5-5"],
  plus: ["M12 5v14M5 12h14"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  folder: ["M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"],
  star: ["M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9l-5.2 2.8 1-5.9L3.5 9.7l5.9-.8z"],
  command: ["M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zM9 9h6M9 9v6M15 9V6.5A2.5 2.5 0 1 1 17.5 9H15zM15 9v6M15 15h-6M15 15v2.5a2.5 2.5 0 1 0 2.5-2.5H15zM9 15v2.5A2.5 2.5 0 1 1 6.5 15H9z"],
  hash: ["M9 4L7 20M17 4l-2 16M4 9h17M3 15h17"],
  heading: ["M6 5v14M18 5v14M6 12h12"],
  "line-number": ["M5 7h2v10M4 17h4", "M12 8h8M12 12h8M12 16h5"],
  focus: ["M4 9V6a2 2 0 0 1 2-2h3M15 4h3a2 2 0 0 1 2 2v3M20 15v3a2 2 0 0 1-2 2h-3M9 20H6a2 2 0 0 1-2-2v-3"],
  cloud: ["M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 9.5a4.25 4.25 0 0 1-.5 8.5z"],
  split: ["M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M12 4v16"],
  ring: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z"],
  more: ["M6 12h.01M12 12h.01M18 12h.01"],
};

/** Registra le figure della cornice per la vita che riceve. */
export function mountFrameIcons(lifetime: Lifetime): void {
  for (const [name, paths] of Object.entries(GLYPHS)) {
    try {
      lifetime.add(registerIcon(name, paths));
    } catch {
      // Già disegnata da qualcun altro (un rimontaggio, o il set di serie che
      // nel frattempo l'ha aggiunta): quella vale, e non è un errore.
    }
  }
}

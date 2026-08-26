import { DESKTOP_SHELL } from "./index";

// Rende osservabile la shell attiva senza introdurre rami globali `isMobile`.
document.documentElement.dataset.clientShell = DESKTOP_SHELL.id;

import "../../desktop-shell";

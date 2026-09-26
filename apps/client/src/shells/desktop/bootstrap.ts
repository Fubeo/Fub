import { declareShell } from "../../platform/capabilities";
import { DESKTOP_SHELL } from "./index";

// Rende osservabile la shell attiva senza introdurre rami globali `isMobile`:
// la shell comune chiede le capacità, non l'id.
declareShell(DESKTOP_SHELL);

import "../../desktop-shell";

import {
  DESKTOP_CAPABILITIES,
  type ClientShell,
} from "../../platform/capabilities";

export const DESKTOP_SHELL: ClientShell = Object.freeze({
  id: "desktop",
  capabilities: DESKTOP_CAPABILITIES,
});

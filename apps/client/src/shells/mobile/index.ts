import {
  MOBILE_CAPABILITIES,
  type ClientShell,
} from "../../platform/capabilities";

export const MOBILE_SHELL: ClientShell = Object.freeze({
  id: "mobile",
  capabilities: MOBILE_CAPABILITIES,
});

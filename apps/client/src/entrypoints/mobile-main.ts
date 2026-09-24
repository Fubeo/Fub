import { nativeMobileBridge } from "../host/ipc";
import { startupMobile } from "./mobile";

// The mobile build chooses this entry; it never evaluates desktop main.ts.
export const startup = startupMobile(nativeMobileBridge());

import type { MobileBridge } from "../shells/mobile/bridge";
import { mountMobileShell, type MobileShellOptions } from "../shells/mobile/bootstrap";
import type { Teardown } from "../ui/lifetime";

/** Entry selected by main.ts/Vite for mobile, with the same Host and editor. */
export async function startupMobile(
  bridge: MobileBridge,
  native: MobileShellOptions = {},
): Promise<Teardown> {
  // The desktop shell initialization reads layout/window state immediately at
  // import time. Mark mobile first; do not import the desktop entrypoint.
  document.documentElement.dataset.clientShell = "mobile";
  const teardownMobile = mountMobileShell(bridge, native);
  try {
    const { startup } = await import("../desktop-shell");
    const teardownShell = await startup;
    return () => {
      teardownMobile();
      teardownShell();
    };
  } catch (error) {
    teardownMobile();
    throw error;
  }
}

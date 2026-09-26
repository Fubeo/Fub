import { declareShell } from "../platform/capabilities";
import type { MobileBridge } from "../shells/mobile/bridge";
import { MOBILE_SHELL } from "../shells/mobile/index";
import { mountMobileShell, type MobileShellOptions } from "../shells/mobile/bootstrap";
import { privateStoragePorts } from "../shells/mobile/storage-ui";
import type { Teardown } from "../ui/lifetime";

/** Entry selected by main.ts/Vite for mobile, with the same Host and editor. */
export async function startupMobile(
  bridge: MobileBridge,
  native: MobileShellOptions = {},
): Promise<Teardown> {
  // The desktop shell initialization reads layout/window state immediately at
  // import time. Mark mobile first; do not import the desktop entrypoint.
  declareShell(MOBILE_SHELL);
  const teardownMobile = mountMobileShell(bridge, {
    ...native,
    storage: native.storage ?? privateStoragePorts(bridge, openInShell),
  });
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

/** The vault chosen in the storage panel opens through the common shell, once its startup is over. */
async function openInShell(dir: string): Promise<void> {
  const shell = await import("../desktop-shell");
  await shell.startup;
  await shell.openVault(dir);
}

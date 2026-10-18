// L'ingresso mobile: la shell mobile (ponte, storage, viewport, tocco) con
// attorno la cornice dello Scrittoio.
//
// Monta `mountMobileShell` con lo stesso `MobileBridge` e le stesse porte di
// storage, dichiara la serie dello Scrittoio e ne monta la cornice.
import { declareShell } from "../platform/capabilities";
import type { MobileBridge } from "../shells/mobile/bridge";
import { MOBILE_SHELL } from "../shells/mobile/index";
import { mountMobileShell, type MobileShellOptions } from "../shells/mobile/bootstrap";
import { privateStoragePorts } from "../shells/mobile/storage-ui";
import { SCRITTOIO_SERIES } from "../theme/scrittoio/series";
import { declareThemeSeries } from "../theme/theme";
import type { Teardown } from "../ui/lifetime";

export async function startupMobile(
  bridge: MobileBridge,
  native: MobileShellOptions = {},
): Promise<Teardown> {
  // La shell comune legge capacità e tema appena la si importa: le due
  // dichiarazioni vengono prima, e tutto ciò che la importa (la composizione
  // qui sotto, e con lei la cornice) si carica dopo, con un import dinamico.
  // `shells/scrittoio/bootstrap.ts` non si può riusare: dichiara il desktop.
  declareShell(MOBILE_SHELL);
  const restoreSeries = declareThemeSeries(SCRITTOIO_SERIES);
  const teardownMobile = mountMobileShell(bridge, {
    ...native,
    storage: native.storage ?? privateStoragePorts(bridge, openInShell),
  });
  try {
    const { composeScrittoioMobile } = await import("../shells/scrittoio/mobile/compose");
    const teardownShell = await composeScrittoioMobile();
    return () => {
      teardownMobile();
      teardownShell();
      restoreSeries();
    };
  } catch (error) {
    teardownMobile();
    restoreSeries();
    throw error;
  }
}

/** Il vault scelto nel pannello dello storage si apre dalla shell comune, ad avvio finito. */
async function openInShell(dir: string): Promise<void> {
  const shell = await import("../desktop-shell");
  await shell.startup;
  await shell.openVault(dir);
}

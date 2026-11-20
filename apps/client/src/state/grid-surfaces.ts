// Le superfici grid che i provider del vault dichiarano (`list_grid_surfaces`),
// chieste una volta per vault invece che a ogni cartella di Excel aperta.
//
// L'elenco cambia soltanto quando l'host rimonta i provider: un vault aperto
// o chiuso, una scelta dei componenti o dei plugin spenti (che finisce col
// rimontaggio, cioè con un `vault_opened`). A ognuno di quei fatti l'elenco
// si dimentica, e la domanda dopo lo rilegge. Una risposta in volo quando
// l'elenco si dimentica arriva a chi l'aveva chiesta, ma non resta: la
// domanda dopo va all'host. Un rifiuto non resta mai.
import type { GridHost } from "../editors/grid/engine-host";
import type { GridSurfaceSpec } from "../host/contract";
import type { Lifetime } from "../ui/lifetime";
import { componentChoiceKey, onComponents } from "./components";
import { onEvent } from "./kernel";
import { openVaultRoot } from "./store";

export function cachedGridSurfaces(host: GridHost, lifetime: Lifetime): GridHost {
  let cached: { readonly root: string | undefined; readonly surfaces: Promise<readonly GridSurfaceSpec[]> } | null = null;
  const forget = (): void => {
    cached = null;
  };
  lifetime.add(onEvent("setting_changed", ({ key }) => {
    if (componentChoiceKey(key)) forget();
  }));
  lifetime.add(onEvent("vault_opened", forget));
  lifetime.add(onEvent("vault_closed", forget));
  lifetime.add(onComponents(forget));
  lifetime.add(forget);
  return {
    listGridSurfaces: () => {
      const root = openVaultRoot();
      if (cached && cached.root === root) return cached.surfaces;
      const surfaces = host.listGridSurfaces().catch((error: unknown) => {
        if (cached?.surfaces === surfaces) cached = null;
        throw error;
      });
      cached = { root, surfaces };
      return surfaces;
    },
    openGridBytes: (surface, doc, journal, base) => host.openGridBytes(surface, doc, journal, base),
    gridBytesWindow: (surface, instance, request) => host.gridBytesWindow(surface, instance, request),
    applyGridBytes: (surface, instance, request) => host.applyGridBytes(surface, instance, request),
    gridBytesCommands: (surface, instance, selection) => host.gridBytesCommands(surface, instance, selection),
    gridBytesCommand: (surface, instance, request) => host.gridBytesCommand(surface, instance, request),
    closeGridBytes: (surface, instance) => host.closeGridBytes(surface, instance),
  };
}

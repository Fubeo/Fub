// Come arriva la pagina «Tutti i componenti»: un `import()`, così il suo
// codice, le sue stringhe e il suo foglio non pesano sull'avvio.
//
// Sta in un modulo suo perché Aspetto (`panels/settings.ts`) lo importa senza
// tirarsi dietro la pagina, e perché le prove possano far arrivare la pagina
// tardi e vedere che cosa trova Aspetto quando arriva.
import type { CatalogPage } from "./pagina";
import type { Lifetime } from "../../ui/lifetime";

/// Il modulo della pagina, quando è arrivato.
export interface CatalogPageModule {
  openCatalogPage(parent: Lifetime): CatalogPage;
}

/// Carica la pagina.
export function loadCatalogPage(): Promise<CatalogPageModule> {
  return import("./pagina");
}

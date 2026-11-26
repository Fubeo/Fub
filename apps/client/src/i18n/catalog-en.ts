// L'inglese del catalogo delle stringhe della shell: **solo dati**, come
// `catalog.ts`, che lo riesporta. Sta in un file suo perché le due lingue
// insieme passavano il budget di un chunk (`shell-strings-en` in
// `vite.config.ts`). L'import della forma è di soli tipi: a runtime questo
// file non dipende da niente.

import type { Key } from "./catalog";
import { EN_CORNICE } from "./catalog-en-cornice";
import { EN_ESPLORA } from "./catalog-en-esplora";
import { EN_TELEFONO } from "./catalog-en-telefono";
import { EN_LAVAGNA } from "./catalog-en-lavagna";
import { EN_MENU } from "./catalog-en-menu";

/// L'inglese. Il tipo è ciò che lo tiene completo: togliere una riga qui è un
/// errore di compilazione, non una chiave nuda scoperta da qualcuno.
export const EN: Record<Key, string> = {
  ...EN_CORNICE,
  ...EN_ESPLORA,
  ...EN_TELEFONO,
  ...EN_LAVAGNA,
  ...EN_MENU,
};

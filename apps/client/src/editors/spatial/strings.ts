// Le stringhe dell'editor dei disegni.
//
// Arrivano con la superficie del disegno, che la shell carica con un
// `import()` quando si apre un disegno (`lazy.ts`): chi non ne apre uno non le
// scarica. La lingua, la scala di ripiego, i nomi fra graffe e i plurali sono
// quelli della shell (`catalog` in `i18n/strings.ts`). Le stringhe che la
// shell mostra prima che la superficie arrivi, come gli avvisi di un file che
// non si apre, restano nel catalogo della shell.

import { catalog } from "../../i18n/strings";
import { TOOLS_EN, TOOLS_IT } from "./strings/tools";
import { DESCRIBE_EN, DESCRIBE_IT } from "./strings/describe";
import { PROPERTIES_EN, PROPERTIES_IT } from "./strings/properties";
import { EXPORT_EN, EXPORT_IT } from "./strings/export";
import { ARRANGE_EN, ARRANGE_IT } from "./strings/arrange";
import { LAYERS_EN, LAYERS_IT } from "./strings/layers";
import { SELECTION_EN, SELECTION_IT } from "./strings/selection";
import { CHROME_EN, CHROME_IT } from "./strings/chrome";

/// Il catalogo italiano, che è anche la forma degli altri. Le voci stanno
/// per area in `strings/`, ciascuna con il suo inglese accanto; qui si
/// ricompongono nello stesso ordine.
const IT = {
  ...TOOLS_IT,
  ...DESCRIBE_IT,
  ...PROPERTIES_IT,
  ...EXPORT_IT,
  ...ARRANGE_IT,
  ...LAYERS_IT,
  ...SELECTION_IT,
  ...CHROME_IT
} as const;

/// Una chiave del catalogo del disegno.
export type DrawKey = keyof typeof IT;

/// L'inglese, completo per tipo come quello della shell.
const EN: Record<DrawKey, string> = {
  ...TOOLS_EN,
  ...DESCRIBE_EN,
  ...PROPERTIES_EN,
  ...EXPORT_EN,
  ...ARRANGE_EN,
  ...LAYERS_EN,
  ...SELECTION_EN,
  ...CHROME_EN
};

/// Il catalogo del disegno: `t` e `plural` come quelli della shell, sulle
/// chiavi del disegno.
export const drawStrings = catalog(IT, { en: EN });
export const { t, plural } = drawStrings;

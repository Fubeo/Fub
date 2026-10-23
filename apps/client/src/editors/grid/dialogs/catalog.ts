// Le finestre della barra dei fogli, per comando del catalogo di GridCraft.
// Una chiave è l'id della finestra che il provider chiede (`dialog`), quasi
// sempre l'id del comando che la finestra dà.
import { CELL_DIALOGS } from "./cells";
import { DATA_DIALOGS } from "./data";
import { FIND_DIALOGS } from "./find";
import { FORMAT_DIALOGS } from "./format-cells";
import { FUNCTION_DIALOGS } from "./function";
import type { DialogBuilder } from "./host";
import { NAME_DIALOGS } from "./names";
import { NOTE_DIALOGS } from "./notes";
import { PROTECT_DIALOGS } from "./protect";
import { RULE_DIALOGS } from "./rules";
import { SORT_DIALOGS } from "./sort";
import { VALIDATION_DIALOGS } from "./validation";

export const DIALOGS: Readonly<Record<string, DialogBuilder>> = {
  ...CELL_DIALOGS,
  ...PROTECT_DIALOGS,
  ...NOTE_DIALOGS,
  ...DATA_DIALOGS,
  ...SORT_DIALOGS,
  ...FIND_DIALOGS,
  ...NAME_DIALOGS,
  ...RULE_DIALOGS,
  ...VALIDATION_DIALOGS,
  ...FUNCTION_DIALOGS,
  ...FORMAT_DIALOGS,
};

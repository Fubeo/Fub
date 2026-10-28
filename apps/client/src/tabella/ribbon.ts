// La scheda contestuale «Tabella» della barra multifunzione del kit: le righe,
// le colonne e, dove il formato le ha, le celle unite. Gli id sono quelli del
// catalogo (`commands.ts`), così la scheda, il menu col tasto destro e la
// barra di formattazione danno lo stesso comando.

import type { Key } from "../i18n/strings";
import type { ButtonControl, RibbonGroup, RibbonTab } from "../kit/ribbon/types";

const action = <V>(id: string, label: Key, keytip: string, icon: string, size: "large" | "small" = "small", labelled = false): ButtonControl<V, Key> => ({
  kind: "button",
  id,
  label,
  keytip,
  icon,
  size,
  labelled,
});

/// La scheda, per chi la monta: `merge` aggiunge il gruppo delle celle. Le
/// icone sono quelle che chi monta la barra ha registrato coi nomi `rc-*`.
export function tableRibbonTab<V>(options: { readonly merge: boolean }): RibbonTab<ButtonControl<V, Key>, Key> {
  const groups: RibbonGroup<ButtonControl<V, Key>, Key>[] = [
    {
      id: "rows",
      label: "rich.ribbon.group.rows",
      icon: "rc-table",
      keytip: "ZW",
      columns: [
        {
          rows: [
            [
              action("markdown.table.row.before", "rich.ribbon.row.before", "RA", "rc-row-before", "small", true),
              action("markdown.table.row.after", "rich.ribbon.row.after", "RB", "rc-row-after", "small", true),
            ],
            [
              action("markdown.table.row.up", "rich.ribbon.row.up", "RU", "rc-row-up", "small", true),
              action("markdown.table.row.down", "rich.ribbon.row.down", "RD", "rc-row-down", "small", true),
            ],
            [action("markdown.table.row.delete", "rich.ribbon.row.delete", "RX", "rc-row-delete", "small", true)],
          ],
        },
        {
          rows: [
            [
              action("markdown.table.column.before", "rich.ribbon.column.before", "CL", "rc-column-before", "small", true),
              action("markdown.table.column.after", "rich.ribbon.column.after", "CR", "rc-column-after", "small", true),
            ],
            [
              action("markdown.table.column.left", "rich.ribbon.column.left", "ML", "rc-column-left", "small", true),
              action("markdown.table.column.right", "rich.ribbon.column.right", "MR", "rc-column-right", "small", true),
            ],
            [action("markdown.table.column.delete", "rich.ribbon.column.delete", "CX", "rc-column-delete", "small", true)],
          ],
        },
      ],
    },
  ];
  if (options.merge) {
    groups.push({
      id: "cells",
      label: "rich.ribbon.group.cells",
      icon: "rc-merge",
      keytip: "ZU",
      columns: [action("rich.table.merge", "rich.table.merge", "UM", "rc-merge", "large"), action("rich.table.split", "rich.table.split", "UD", "rc-split", "large")],
    });
  }
  return { id: "table", label: "rich.ribbon.tab.table", keytip: "JT", contextual: "table", groups };
}

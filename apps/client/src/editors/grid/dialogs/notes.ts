// Le finestre di una cella: la nota, il commento e il collegamento
// ipertestuale. Partono da ciò che la cella ha già (`cell.get`), così
// «Modifica» e «Nuovo» sono la stessa finestra.
import type { DialogBuilder, DialogContext } from "./host";
import { formDialog } from "./form";
import { t } from "./strings";

interface CellComment {
  readonly text?: unknown;
  readonly threaded?: unknown;
  readonly replies?: unknown;
}

interface CellLink {
  readonly target?: unknown;
  readonly tooltip?: unknown;
}

interface CellInfo {
  readonly text?: unknown;
  readonly comment?: CellComment | null;
  readonly hyperlink?: CellLink | null;
}

async function cellInfo(context: DialogContext): Promise<CellInfo> {
  const info = await context.read("cell.get");
  return info && typeof info === "object" ? (info as CellInfo) : {};
}

const string = (value: unknown): string => (typeof value === "string" ? value : "");

/// La nota (`threaded` falso) o il commento della cella attiva.
function annotation(threaded: boolean): DialogBuilder {
  return async (context) => {
    const existing = (await cellInfo(context)).comment ?? null;
    // Una nota e un commento sono due cose: chi apre la nota di una cella che
    // ha un commento ne scrive una nuova al suo posto, come in Excel.
    const same = existing !== null && (existing.threaded === true) === threaded;
    const replies = same && Array.isArray(existing.replies) ? existing.replies.length : 0;
    const title = threaded
      ? t(same ? "grid.dialog.comment.edit" : "grid.dialog.comment.new")
      : t(same ? "grid.dialog.note.edit" : "grid.dialog.note.new");
    return formDialog(context, {
      title,
      values: { text: same ? string(existing.text) : "" },
      command: threaded ? "review.newComment" : "review.newNote",
      fields: () => [
        { kind: "area", key: "text", label: t(threaded ? "grid.dialog.comment.label" : "grid.dialog.note.label"), rows: 5 },
        ...(replies ? [{ kind: "note" as const, text: t("grid.dialog.comment.replies", { count: replies }) }] : []),
      ],
      extra: existing
        ? [
            {
              id: "delete",
              label: t("grid.dialog.comment.delete"),
              kind: "danger",
              run: () => context.give("review.deleteComment", {}),
            },
          ]
        : [],
    });
  };
}

const insertLink: DialogBuilder = async (context) => {
  const info = await cellInfo(context);
  const link = info.hyperlink ?? null;
  return formDialog(context, {
    title: t(link ? "grid.dialog.link.edit" : "grid.dialog.link.title"),
    values: {
      text: string(info.text),
      target: link ? string(link.target) : "https://",
      tooltip: link ? string(link.tooltip) : "",
    },
    command: "insert.link",
    fields: () => [
      { kind: "text", key: "text", label: t("grid.dialog.link.text") },
      { kind: "text", key: "target", label: t("grid.dialog.link.target") },
      { kind: "text", key: "tooltip", label: t("grid.dialog.link.tooltip") },
    ],
    params: (values) => {
      const target = String(values.target ?? "").trim();
      if (!target || target === "https://") return t("grid.dialog.error.required", { label: t("grid.dialog.link.target").replace(/:$/, "") });
      const params: Record<string, unknown> = { target };
      if (values.text) params.text = values.text;
      if (values.tooltip) params.tooltip = values.tooltip;
      return params;
    },
    extra: link
      ? [{ id: "remove", label: t("grid.dialog.link.remove"), kind: "danger", run: () => context.give("insert.link", { remove: true }) }]
      : [],
  });
};

/// Il commento di GridCraft (`comment {threaded}`) e la nota di Excel.
const comment: DialogBuilder = (context) => annotation(context.params.threaded !== false)(context);

export const NOTE_DIALOGS: Readonly<Record<string, DialogBuilder>> = {
  note: annotation(false),
  comment,
  insertLink,
};

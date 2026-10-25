// Le finestre di una cella: la nota, il commento e il collegamento
// ipertestuale. Partono da ciò che la cella ha già (`cell.get`), così
// «Modifica» e «Nuovo» sono la stessa finestra, e danno i comandi sulla cella
// che hanno letto.
import type { DialogBuilder, DialogContext, SpecAction } from "./host";
import { formDialog, formHandle } from "./form";
import { t } from "./strings";

interface CellComment {
  readonly author?: unknown;
  readonly text?: unknown;
  readonly threaded?: unknown;
  readonly resolved?: unknown;
  /// Le risposte come le scrive GridCraft: `[autore, testo]`.
  readonly replies?: unknown;
}

interface CellLink {
  readonly target?: unknown;
  readonly tooltip?: unknown;
}

interface CellInfo {
  readonly cell?: unknown;
  readonly text?: unknown;
  readonly comment?: CellComment | null;
  readonly hyperlink?: CellLink | null;
}

async function cellInfo(context: DialogContext): Promise<CellInfo> {
  const info = await context.read("cell.get");
  return info && typeof info === "object" ? (info as CellInfo) : {};
}

const string = (value: unknown): string => (typeof value === "string" ? value : "");

/// Le risposte di un thread, `autore: testo`.
function replyLines(comment: CellComment): string[] {
  if (!Array.isArray(comment.replies)) return [];
  return comment.replies.map((reply: unknown) => {
    const [author, text] = Array.isArray(reply) ? reply : [];
    return string(author) ? `${string(author)}: ${string(text)}` : string(text);
  });
}

/// La nota (`threaded` falso) o il commento della cella attiva. Una cella che
/// ne ha già uno apre quello, del suo tipo: scriverne uno dell'altro tipo
/// sopra lo cancellerebbe, risposte comprese, e in Excel «Nuova nota» non si
/// dà su un commento. Del commento la finestra mostra il thread, e con lo
/// stesso OK cambia il testo, risponde e lo risolve o riapre: ciascuna è un
/// comando suo, nell'ordine, e soltanto se è cambiata.
function annotation(threaded: boolean): DialogBuilder {
  return async (context) => {
    const info = await cellInfo(context);
    const existing = info.comment ?? null;
    const thread = existing ? existing.threaded === true : threaded;
    const cell = string(info.cell) || context.engine.selectionRefs().active;
    const text = existing ? string(existing.text) : "";
    const resolved = existing?.resolved === true;
    const replies = existing ? replyLines(existing) : [];
    const canReply = thread && existing !== null && context.serves("review.replyComment");
    const canResolve = thread && existing !== null && context.serves("review.resolveComment");
    const title = thread
      ? t(existing ? "grid.dialog.comment.edit" : "grid.dialog.comment.new")
      : t(existing ? "grid.dialog.note.edit" : "grid.dialog.note.new");
    const handle = formHandle(context, {
      title,
      values: { text, reply: "", resolved },
      command: thread ? "review.newComment" : "review.newNote",
      fields: () => [
        ...(existing && string(existing.author)
          ? [{ kind: "note" as const, text: t("grid.dialog.comment.author", { author: string(existing.author) }) }]
          : []),
        { kind: "area", key: "text", label: t(thread ? "grid.dialog.comment.label" : "grid.dialog.note.label"), rows: 5 },
        ...(replies.length
          ? [{ kind: "section" as const, label: t("grid.dialog.comment.thread"), fields: replies.map((line) => ({ kind: "note" as const, text: line })) }]
          : []),
        ...(canReply ? [{ kind: "area" as const, key: "reply", label: t("grid.dialog.comment.reply"), rows: 2 }] : []),
        ...(canResolve ? [{ kind: "check" as const, key: "resolved", label: t("grid.dialog.comment.resolved") }] : []),
      ],
    });
    const values = handle.values;
    const ok: SpecAction = {
      id: "ok",
      label: t("grid.dialog.ok"),
      kind: "primary",
      run: async () => {
        const steps: [string, Record<string, unknown>][] = [];
        const written = String(values.text ?? "");
        if (!existing || written !== text) steps.push([thread ? "review.newComment" : "review.newNote", { cell, text: written }]);
        const reply = String(values.reply ?? "").trim();
        if (canReply && reply) steps.push(["review.replyComment", { cell, text: reply }]);
        if (canResolve && (values.resolved === true) !== resolved) steps.push(["review.resolveComment", { cell, resolved: values.resolved === true }]);
        for (const [id, params] of steps) {
          if (!(await context.give(id, params))) return false;
        }
        return true;
      },
    };
    const extra: SpecAction[] = existing
      ? [{ id: "delete", label: t("grid.dialog.comment.delete"), kind: "danger", run: () => context.give("review.deleteComment", { cell }) }]
      : [];
    return { ...handle.spec, actions: [...extra, { id: "cancel", label: t("grid.dialog.cancel") }, ok] };
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

// La scheda di una nota o di un commento: compare sulla cella che ne ha uno,
// come in Excel, al passaggio del puntatore.
//
// Mostra il thread (chi ha scritto, il testo, le risposte, se è risolto) e i
// gesti che lo cambiano: Rispondi, Risolvi o Riapri, Modifica, Mostra/Nascondi
// la nota, Elimina. Ogni gesto è un comando del catalogo con la cella scritta
// nei parametri, perché vale per la cella indicata e non per quella attiva; un
// gesto che il catalogo non serve non c'è, e in sola lettura c'è soltanto il
// thread. Chi usa la tastiera ha lo stesso thread nella descrizione della cella
// attiva (`commentDescription`) e gli stessi gesti nella finestra della nota
// (Maiusc+F2).
import type { GridComment } from "../../host/contract";
import { attachHoverCard, textButton, type HoverCardHandle } from "../../kit";
import { identifier } from "../../ui/a11y";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { t } from "../../i18n/strings";

/// Il selettore delle celle che hanno una scheda.
export const COMMENT_CELL = ".grid-cell[data-comment]";

export interface CommentCardHost {
  /// La griglia: le celle nascono e spariscono, la scheda resta delegata.
  readonly root: HTMLElement;
  readonly lifetime: Lifetime;
  /// La nota o il commento della cella, come la finestra letta lo porta.
  comment(cell: HTMLElement): GridComment | null;
  /// La cella in A1.
  address(cell: HTMLElement): string;
  /// Se il catalogo serve il comando `id` acceso, e la griglia accetta comandi.
  serves(id: string): boolean;
  /// Dà il comando e dice come è andato, come per le finestre.
  run(id: string, params: Record<string, unknown>): Promise<{ readonly ok: boolean; readonly error?: string | null }>;
  /// Seleziona la cella e apre la finestra della sua nota o del suo commento.
  edit(cell: HTMLElement): void;
}

/// Il thread come lo si legge: `autore: testo`, una riga per messaggio.
function lines(comment: GridComment): string[] {
  return [comment, ...comment.replies].map((post) => (post.author ? `${post.author}: ${post.text}` : post.text));
}

/// Ciò che la cella dice a chi non vede: il tipo, lo stato e il thread.
export function commentDescription(comment: GridComment): string {
  const kind = t(comment.threaded ? "grid.comment.kind.thread" : "grid.comment.kind.note");
  // Un messaggio che non finisce con un segno ne prende uno, perché la voce
  // faccia la pausa fra l'uno e l'altro.
  const thread = lines(comment).map((line, index, all) => (index < all.length - 1 && !/[.!?…:;]$/u.test(line) ? `${line}.` : line)).join(" ");
  return t(comment.threaded && comment.resolved ? "grid.comment.describe_resolved" : "grid.comment.describe", { kind, thread });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function post(author: string, text: string): HTMLElement {
  const item = el("li", "grid-comment-post");
  if (author) item.append(el("span", "grid-comment-author", author));
  item.append(el("p", "grid-comment-text", text));
  return item;
}

export function attachCommentCards(host: CommentCardHost): HoverCardHandle {
  /// I pulsanti della scheda aperta: vivono fino alla prossima, o allo
  /// smontaggio della griglia.
  let cardLife: Lifetime | null = null;
  host.lifetime.add(() => cardLife?.close());

  const card = (cell: HTMLElement, comment: GridComment, close: () => void): HTMLElement => {
    cardLife?.close();
    const life = openLifetime();
    cardLife = life;
    const at = host.address(cell);
    const root = el("div", comment.threaded ? "grid-comment-card threaded" : "grid-comment-card");
    const head = el("div", "grid-comment-head");
    head.append(el("span", "grid-comment-kind", t(comment.threaded ? "grid.comment.kind.thread" : "grid.comment.kind.note")));
    head.append(el("span", "grid-comment-where", at));
    if (comment.threaded && comment.resolved) head.append(el("span", "grid-comment-resolved", t("grid.comment.resolved")));
    const thread = el("ol", "grid-comment-thread");
    thread.append(post(comment.author, comment.text), ...comment.replies.map((reply) => post(reply.author, reply.text)));
    root.append(head, thread);

    const error = el("p", "grid-comment-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    /// Il comando, e la scheda si chiude se il provider lo prende: la finestra
    /// riletta porta il thread nuovo. Se no la ragione resta scritta qui.
    const give = async (id: string, params: Record<string, unknown>): Promise<boolean> => {
      const run = await host.run(id, { cell: at, ...params });
      if (life.closed) return run.ok;
      if (run.ok) {
        close();
        return true;
      }
      error.textContent = run.error ?? t("grid.comment.lost");
      error.hidden = false;
      return false;
    };
    const button = (label: string, run: () => void, kind: "normal" | "primary" | "danger" = "normal"): HTMLButtonElement => {
      const pressed = textButton({ label, kind, onPress: run, lifetime: life });
      pressed.classList.add("grid-comment-action");
      return pressed;
    };

    if (comment.threaded && host.serves("review.replyComment")) {
      const form = el("form", "grid-comment-reply");
      const field = el("textarea", "grid-comment-field");
      field.id = identifier("grid-comment-reply");
      field.rows = 2;
      const label = el("label", "sr-only", t("grid.comment.reply_field"));
      label.htmlFor = field.id;
      field.placeholder = t("grid.comment.reply_field");
      const send = button(t("grid.comment.reply"), () => form.requestSubmit(), "primary");
      send.type = "submit";
      form.append(label, field, send);
      life.listen(form, "submit", (event) => {
        event.preventDefault();
        const text = field.value.trim();
        if (text) void give("review.replyComment", { text });
      });
      // Invio manda, Maiusc+Invio va a capo, come nei commenti di Excel.
      life.listen(field, "keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
        event.preventDefault();
        form.requestSubmit();
      });
      root.append(form);
    }

    const actions = el("div", "grid-comment-actions");
    if (comment.threaded && host.serves("review.resolveComment")) {
      actions.append(button(t(comment.resolved ? "grid.comment.reopen" : "grid.comment.resolve"), () => {
        void give("review.resolveComment", { resolved: !comment.resolved });
      }));
    }
    if (host.serves(comment.threaded ? "review.newComment" : "review.newNote")) {
      actions.append(button(t("grid.comment.edit"), () => {
        close();
        host.edit(cell);
      }));
    }
    if (!comment.threaded && host.serves("review.showNote")) {
      actions.append(button(t("grid.comment.toggle_note"), () => void give("review.showNote", {})));
    }
    if (host.serves("review.deleteComment")) {
      actions.append(button(t("grid.comment.delete"), () => void give("review.deleteComment", {}), "danger"));
    }
    if (actions.childElementCount) root.append(actions);
    root.append(error);
    return root;
  };

  const handle = attachHoverCard({
    delegate: { root: host.root, selector: COMMENT_CELL },
    lifetime: host.lifetime,
    placement: "right",
    align: "start",
    label: (cell) => t("grid.comment.card", {
      kind: t(cell.dataset.comment === "thread" ? "grid.comment.kind.thread" : "grid.comment.kind.note"),
      cell: host.address(cell),
    }),
    load: async (cell) => {
      const comment = host.comment(cell);
      return comment ? card(cell, comment, () => handle.hide()) : null;
    },
  });
  return handle;
}

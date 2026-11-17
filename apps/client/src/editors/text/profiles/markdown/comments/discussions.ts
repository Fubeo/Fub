// I commenti di una nota Markdown come gesti (E16, D11 A, D12 C): scrivere il
// primo messaggio, aprire la discussione dal margine o dal pannello,
// rispondere, Risolvi, Elimina, «Svuota i risolti».
//
// Il buffer è l'unica autorità: ogni gesto rilegge il commento dal testo di
// adesso (la nota può essere cambiata da fuori mentre la discussione era
// aperta) e lo scrive con una transazione sola, isolata nella cronologia: un
// passo d'annullamento per gesto. Nessuna IPC: soltanto le impostazioni, per
// sapere chi firma, si leggono quando si apre un riquadro.
import { isolateHistory, undo } from "@codemirror/commands";
import { ChangeSet, Prec, StateEffect, StateField, type ChangeSpec, type Extension, type Text } from "@codemirror/state";
import { Decoration, EditorView, keymap, type DecorationSet } from "@codemirror/view";
import type { SyntaxForm } from "../../../../../host/contract";
import { errorText } from "../../../../../host/errors";
import { openPopover, type PopoverHandle, type VirtualAnchor } from "../../../../../kit/popover";
import { openLifetime, type Lifetime } from "../../../../../ui/lifetime";
import { notify } from "../../../../../ui/notify";
import type { SurfacePanels } from "../../../../core/registry";
import { commentsDeclared } from "../render-inline";
import { liveStrings } from "../strings";
import { lastSigner, readSigner, saveName } from "./author";
import { commentMargin, hiddenArchive, hideReadingArchive, mountReadingMargin } from "./margin";
import {
  allDiscussions,
  cleanName,
  discussionAnchor,
  discussionAt,
  messageSource,
  newCommentChanges,
  oneLine,
  placeComment,
  readsAsComment,
  signature,
  stamp,
  type CommentPlace,
  type Discussion,
} from "./model";
import { clearArchiveChanges, deleteChanges, readArchive, resolveChanges, type ArchivedDiscussion } from "./resolve";
import { commentIcons, composerView, discussionView, type DiscussionView } from "./thread";
import { commentsPanel } from "./inspector";

/// La scorciatoia di «Commenta» (la stessa del documento ricco).
export const COMMENT_CHORD = "Mod-Alt-m";
/// L'id dell'azione dell'editor.
export const COMMENT_ACTION = "markdown.comment.add";

/// Ciò che la superficie presta ai commenti.
export interface CommentsHost {
  forms(): readonly SyntaxForm[] | undefined;
  mode(): "source" | "live_preview" | "reading";
  readOnly(): boolean;
  /// Lavora sulla vista di scrittura; `null` se la superficie è chiusa.
  withView<T>(run: (view: EditorView) => T): T | null;
  /// La resa della Lettura.
  reading(): HTMLElement;
  /// Porta la superficie in vista: Lettura o Scrittura, com'è.
  focus(): void;
}

/// Che cosa vede il pannello: le discussioni aperte e quelle archiviate.
export interface CommentsSnapshot {
  readonly open: readonly Discussion[];
  readonly resolved: readonly ArchivedDiscussion[];
  readonly readOnly: boolean;
  readonly active: number | null;
}

export interface MarkdownComments {
  /// Le estensioni per la modalità di adesso.
  extension(): Extension;
  readonly panels: SurfacePanels;
  canComment(): boolean;
  /// «Commenta»: la discussione nuova sulla selezione, o quella che c'è già.
  comment(): boolean;
  /// Apre la discussione del commento che si guarda da `anchor`.
  open(anchor: number): void;
  /// Il pannello: lo stato di adesso e chi lo segue.
  snapshot(): CommentsSnapshot;
  watch(listener: () => void): () => void;
  /// «Svuota i risolti».
  clearResolved(): void;
  /// Dopo ogni resa della Lettura: il margine e l'archivio nascosto. Torna
  /// chi li toglie.
  readingRendered(): () => void;
  /// Le forme della nota sono cambiate.
  formsChanged(): void;
  destroy(): void;
}

/// Il passo acceso: quello che si sta commentando, o quello della discussione
/// aperta.
const setLit = StateEffect.define<{ from: number; to: number; fresh: boolean } | null>();
const lit = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setLit)) continue;
      const range = effect.value;
      next = range && range.from < range.to
        ? Decoration.set([Decoration.mark({
            class: range.fresh ? "cm-fub-comment-range cm-fub-comment-range-on" : "cm-fub-comment-range-on",
          }).range(range.from, range.to)])
        : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/// Le modifiche arrivate dopo un certo testo: per rimettere un gesto al posto
/// giusto, o per annullarlo quando il testo è andato avanti.
interface Tracker {
  since: ChangeSet;
}

/// Quanti «Annulla» aspettano insieme: oltre, i più vecchi non si seguono più.
const PENDING_UNDO = 6;
/// Il pannello si ridisegna dopo questa pausa nello scrivere (ms).
const PANEL_DELAY_MS = 160;

/// Riconosce una discussione fra una lettura e l'altra: il primo messaggio,
/// che le risposte non toccano.
const identity = (discussion: Discussion): string => {
  const first = discussion.messages[0];
  return first ? `${first.author ?? ""}\u0000${first.date ?? ""}\u0000${first.text}` : "";
};

interface OpenDiscussion {
  anchor: number;
  readonly key: string;
  readonly view: DiscussionView;
  readonly handle: PopoverHandle;
  readonly life: Lifetime;
}

export function markdownComments(host: CommentsHost): MarkdownComments {
  commentIcons();
  const t = liveStrings.t;
  const life = openLifetime();
  const trackers = new Set<Tracker>();
  const watchers = new Set<() => void>();
  const listChanged = new Set<() => void>();
  let current: OpenDiscussion | null = null;
  let composing: { handle: PopoverHandle; life: Lifetime } | null = null;
  let readingLife: Lifetime | null = null;
  let panelTimer: ReturnType<typeof setTimeout> | null = null;
  const undos: Tracker[] = [];

  const forms = () => host.forms();
  const writable = () => !host.readOnly() && !life.closed;

  const track = (view: EditorView): Tracker => {
    const tracker = { since: ChangeSet.empty(view.state.doc.length) };
    trackers.add(tracker);
    return tracker;
  };

  const changed = () => {
    for (const watcher of [...watchers]) watcher();
  };
  const changedSoon = () => {
    if (watchers.size === 0 || panelTimer !== null) return;
    panelTimer = setTimeout(() => {
      panelTimer = null;
      changed();
    }, PANEL_DELAY_MS);
  };

  const margin = commentMargin({
    forms,
    active: () => current?.anchor ?? null,
    open: (anchor) => open(anchor),
  });
  const refreshMargin = (view: EditorView, range: { from: number; to: number; fresh: boolean } | null | undefined) => {
    view.dispatch({ effects: range === undefined ? [margin.refreshActive] : [margin.refreshActive, setLit.of(range)] });
  };

  const follow = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    for (const tracker of trackers) tracker.since = tracker.since.compose(update.changes);
    changedSoon();
    const shown = current;
    if (!shown) return;
    shown.anchor = update.changes.mapPos(shown.anchor, -1);
    const found = discussionAt(update.state, shown.anchor, forms());
    if (!found || identity(found) !== shown.key) {
      // Il commento è uscito dal testo mentre si guardava: chi l'ha tolto
      // (un'altra superficie, il disco, una cancellazione) l'ha voluto, e il
      // riquadro lo dice invece di restare su un testo che non c'è più.
      shown.handle.close("manual");
      notify(t("comments.gone"), "info");
      return;
    }
    shown.anchor = discussionAnchor(found.thread);
    shown.view.update(found);
    shown.handle.reposition();
  });

  const keys = Prec.high(keymap.of([{ key: COMMENT_CHORD, run: () => comment() }]));
  const writing: Extension = [margin.extension, lit, follow, keys];
  const live: Extension = [writing, hiddenArchive];

  /// Scrive un gesto: una transazione sola, un passo d'annullamento.
  const write = (view: EditorView, changes: ChangeSpec, userEvent: string): ChangeSet | null => {
    if (!writable()) {
      notify(t("comments.read_only"), "info");
      return null;
    }
    const tr = view.state.update({ changes, userEvent, annotations: isolateHistory.of("full") });
    view.dispatch(tr);
    return tr.changes;
  };

  /// L'avviso dopo Risolvi, Elimina, «Svuota»: «Annulla» torna indietro di un
  /// passo se il testo non è cambiato, altrimenti toglie soltanto il gesto,
  /// portato sul testo di adesso.
  const offerUndo = (view: EditorView, message: string, before: Text, changes: ChangeSet) => {
    const after = view.state.doc;
    const inverse = changes.invert(before);
    const tracker = track(view);
    undos.push(tracker);
    while (undos.length > PENDING_UNDO) trackers.delete(undos.shift()!);
    notify(message, "info", {
      label: t("comments.undo"),
      run: () => {
        if (!trackers.has(tracker)) return;
        trackers.delete(tracker);
        if (!writable()) return;
        host.withView((each) => {
          if (each.state.doc === after) undo(each);
          else each.dispatch({ changes: inverse.map(tracker.since), userEvent: "comment.undo", annotations: isolateHistory.of("full") });
        });
      },
    });
  };

  const closeCurrent = () => {
    const shown = current;
    if (!shown) return;
    current = null;
    shown.handle.close("manual");
  };

  /// Dove si àncora il riquadro: il passo, il segno o il punto.
  const anchorOf = (view: EditorView | null, discussion: Discussion): Element | VirtualAnchor => {
    const at = discussionAnchor(discussion.thread);
    if (host.mode() === "reading") {
      const mark = host.reading().querySelector(`mark.comment-range[data-md-from="${at}"]`);
      const bubble = host.reading().querySelector(`[data-anchor="${at}"]`);
      return mark ?? bubble ?? host.reading();
    }
    return {
      getBoundingClientRect: () => {
        const v = view;
        const shown = current?.anchor ?? at;
        const sign = v?.dom.querySelector<HTMLElement>(`.cm-fub-comment-sign[data-anchor="${shown}"]`);
        const found = v ? discussionAt(v.state, shown, forms()) : null;
        if (!v || !found) return sign?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 };
        const end = found.thread.passage?.contentTo ?? found.thread.from;
        const a = v.coordsAtPos(shown, 1);
        const b = v.coordsAtPos(end, -1) ?? a;
        if (!a) return sign?.getBoundingClientRect() ?? v.dom.getBoundingClientRect();
        const left = Math.min(a.left, b?.left ?? a.left);
        const right = b && b.top === a.top ? b.right : a.left;
        return { left, top: a.top, width: Math.max(1, right - left), height: (b?.bottom ?? a.bottom) - a.top };
      },
    };
  };

  function open(anchor: number): void {
    if (life.closed) return;
    composing?.handle.close("manual");
    closeCurrent();
    host.withView((view) => {
      const found = discussionAt(view.state, anchor, forms());
      if (!found) return;
      const own = openLifetime();
      const me = lastSigner();
      const shown = discussionView(found, signature(me.name, me.mode), {
        readOnly: !writable(),
        reply: (text) => reply(text),
        resolve: () => finish("resolve"),
        remove: () => finish("delete"),
      }, own);
      const passage = found.thread.passage;
      const handle = openPopover({
        anchor: anchorOf(view, found),
        content: shown.element,
        placement: "bottom",
        align: "start",
        label: t("comments.discussion"),
        className: "cm-fub-comment-popover",
        lifetime: own,
        onClose: () => {
          own.close();
          if (current?.handle !== handle) return;
          current = null;
          host.withView((each) => refreshMargin(each, null));
          changed();
        },
      });
      current = { anchor: discussionAnchor(found.thread), key: identity(found), view: shown, handle, life: own };
      refreshMargin(view, passage && host.mode() !== "reading" ? { from: passage.contentFrom, to: passage.contentTo, fresh: false } : undefined);
      changed();
      void readSigner().then((signer) => {
        if (!own.closed) shown.signer(signature(signer.name, signer.mode));
      });
    });
  }

  /// La discussione aperta, riletta dal testo di adesso.
  const currentDiscussion = (view: EditorView): Discussion | null => {
    const shown = current;
    if (!shown) return null;
    const found = discussionAt(view.state, shown.anchor, forms());
    if (!found || identity(found) !== shown.key) {
      closeCurrent();
      notify(t("comments.gone"), "info");
      return null;
    }
    return found;
  };

  function reply(text: string): void {
    host.withView((view) => {
      const found = currentDiscussion(view);
      if (!found || text.trim() === "") return;
      const me = lastSigner();
      const message = messageSource(signature(me.name, me.mode), stamp(new Date()), text, found.inCell);
      write(view, { from: found.thread.to, insert: message }, "comment.reply");
    });
  }

  function finish(kind: "resolve" | "delete"): void {
    host.withView((view) => {
      const found = currentDiscussion(view);
      if (!found) return;
      if (!writable()) {
        notify(t("comments.read_only"), "info");
        return;
      }
      const before = view.state.doc;
      const changes = kind === "resolve" ? resolveChanges(before, found, stamp(new Date())) : deleteChanges(found);
      closeCurrent();
      const done = write(view, changes, kind === "resolve" ? "comment.resolve" : "comment.delete");
      if (done) offerUndo(view, t(kind === "resolve" ? "comments.resolved" : "comments.deleted"), before, done);
      host.focus();
    });
  }

  function clearResolved(): void {
    host.withView((view) => {
      const before = view.state.doc;
      const changes = clearArchiveChanges(before);
      if (!changes) return;
      const done = write(view, changes, "comment.clear");
      if (done) offerUndo(view, t("comments.panel.cleared"), before, done);
    });
  }

  /// Il riquadro del primo messaggio.
  async function compose(place: Extract<CommentPlace, { kind: "passage" | "after" }>): Promise<void> {
    const view0 = host.withView((view) => view);
    if (!view0) return;
    const tracker = track(view0);
    const signer = await readSigner();
    if (life.closed) {
      trackers.delete(tracker);
      return;
    }
    host.withView((view) => {
      const own = openLifetime();
      const doc = view.state.doc;
      const quote = place.kind === "passage" ? oneLine(doc.sliceString(place.from, place.to)) : "";
      const note = place.kind === "after"
        ? t(`comments.compose.after.${place.block}`)
        : place.clipped ? t("comments.compose.clipped") : null;
      const askName = signer.mode !== "niente" && signer.name === "";
      let sent = false;
      const content = composerView({
        quote,
        note,
        askName,
        me: signature(signer.name, signer.mode),
        send: (text, name) => {
          if (text.trim() === "") return;
          sent = true;
          send(view, place, tracker, text, name);
          handle.close("manual");
        },
      }, own);
      const range = place.kind === "passage"
        ? { from: tracker.since.mapPos(place.from, 1), to: tracker.since.mapPos(place.to, -1), fresh: true }
        : null;
      const handle = openPopover({
        anchor: {
          getBoundingClientRect: () => {
            const at = place.kind === "passage" ? tracker.since.mapPos(place.from, 1) : tracker.since.mapPos(place.at, -1);
            const coords = view.coordsAtPos(Math.min(at, view.state.doc.length), 1) ?? view.coordsAtPos(Math.min(at, view.state.doc.length), -1);
            if (!coords) return view.contentDOM.getBoundingClientRect();
            return { left: coords.left, top: coords.top, width: 1, height: coords.bottom - coords.top };
          },
        },
        content: content.element,
        placement: "bottom",
        align: "start",
        label: t("comments.compose.label"),
        className: "cm-fub-comment-popover",
        lifetime: own,
        autoFocus: false,
        onClose: (reason) => {
          own.close();
          trackers.delete(tracker);
          if (composing?.handle === handle) composing = null;
          if (!life.closed) host.withView((each) => each.dispatch({ effects: setLit.of(null) }));
          // Esc, il Tab oltre il bordo e la chiusura dal codice riportano il
          // fuoco nel testo. Se il fuoco è andato altrove (un clic, un altro
          // controllo, il fuoco tolto e dato al documento) resta dov'è:
          // riprenderlo strapperebbe il Tab a chi sta già navigando.
          if (!sent && reason !== "outside") host.focus();
        },
      });
      composing = { handle, life: own };
      view.dispatch({ effects: setLit.of(range) });
      content.focus();
    });
  }

  function send(
    view: EditorView,
    place: Extract<CommentPlace, { kind: "passage" | "after" }>,
    tracker: Tracker,
    text: string,
    name: string | null,
  ): void {
    const signer = lastSigner();
    let who = signer.name;
    if (name !== null && cleanName(name) !== "") {
      who = cleanName(name);
      saveName(name).catch((error: unknown) => {
        notify(t("comments.name.save_failed", { reason: errorText(error) }), "guasto");
      });
    }
    const since = tracker.since;
    const mapped: Extract<CommentPlace, { kind: "passage" | "after" }> = place.kind === "passage"
      ? { ...place, from: since.mapPos(place.from, 1), to: since.mapPos(place.to, -1) }
      : { ...place, at: since.mapPos(place.at, -1) };
    if (mapped.kind === "passage" && mapped.from >= mapped.to) {
      notify(t("comments.gone"), "info");
      return;
    }
    const inCell = mapped.kind === "passage" && mapped.inCell;
    const message = messageSource(signature(who, signer.mode), stamp(new Date()), text, inCell);
    const { changes, anchor } = newCommentChanges(view.state.doc, mapped, message);
    // La rete di sicurezza: un commento che il parser non leggerebbe come
    // commento non si scrive (il testo resterebbe con segni a vista).
    if (!readsAsComment(view.state.update({ changes }).state, anchor, forms())) {
      notify(t("comments.not_here"), "info");
      return;
    }
    write(view, changes, "comment.add");
  }

  function comment(): boolean {
    if (life.closed || host.mode() === "reading" || !commentsDeclared(forms())) return false;
    if (!writable()) {
      notify(t("comments.read_only"), "info");
      return true;
    }
    return host.withView((view) => {
      const place = placeComment(view.state, forms());
      if (place.kind === "none") notify(t("comments.not_here"), "info");
      else if (place.kind === "existing") open(discussionAnchor(place.discussion.thread));
      else {
        composing?.handle.close("manual");
        closeCurrent();
        void compose(place);
      }
      return true;
    }) ?? false;
  }

  const snapshot = (): CommentsSnapshot => host.withView((view) => ({
    open: allDiscussions(view.state, forms()),
    resolved: readArchive(view.state.doc),
    readOnly: !writable(),
    active: current?.anchor ?? null,
  })) ?? { open: [], resolved: [], readOnly: true, active: null };

  /// Porta il commento in vista e apre la discussione.
  const reveal = (anchor: number) => {
    if (host.mode() === "reading") {
      host.reading().querySelector(`mark.comment-range[data-md-from="${anchor}"]`)?.scrollIntoView({ block: "center" });
      open(anchor);
      return;
    }
    host.withView((view) => {
      view.dispatch({ effects: EditorView.scrollIntoView(Math.min(anchor, view.state.doc.length), { y: "center" }) });
      view.requestMeasure({ read: () => null, write: () => open(anchor) });
    });
  };

  const controller: MarkdownComments = {
    extension: () => (host.mode() === "live_preview" ? live : writing),
    panels: {
      list: () => (commentsDeclared(forms()) ? [panel] : []),
      subscribe(listener) {
        listChanged.add(listener);
        return () => listChanged.delete(listener);
      },
      onShow: () => () => {},
    },
    canComment: () => !life.closed && host.mode() !== "reading" && writable() && commentsDeclared(forms()),
    comment,
    open,
    snapshot,
    watch(listener) {
      watchers.add(listener);
      return () => watchers.delete(listener);
    },
    clearResolved,
    readingRendered() {
      readingLife?.close();
      readingLife = null;
      if (life.closed || !commentsDeclared(forms())) return () => {};
      const own = openLifetime();
      readingLife = own;
      host.withView((view) => {
        hideReadingArchive(host.reading(), view.state.doc);
        mountReadingMargin(host.reading(), allDiscussions(view.state, forms()), (anchor) => open(anchor), own);
      });
      changedSoon();
      return () => {
        own.close();
        if (readingLife === own) readingLife = null;
      };
    },
    formsChanged() {
      for (const listener of [...listChanged]) listener();
    },
    destroy() {
      if (panelTimer !== null) clearTimeout(panelTimer);
      panelTimer = null;
      composing?.handle.close("manual");
      closeCurrent();
      readingLife?.close();
      trackers.clear();
      watchers.clear();
      listChanged.clear();
      life.close();
    },
  };
  const panel = commentsPanel(controller, reveal);
  return controller;
}

// Il pannello del documento: le schede che la superficie porta nell'ispettore
// (`EditorSurface.panels`), accanto alla Struttura.
//
// Commenti: i fili nell'ordine in cui stanno nel testo, con chi, quando, il
// testo commentato e le risposte. Un clic sul testo commentato lo seleziona.
// Quando il documento si scrive, uno nuovo sulla selezione, e per ogni filo
// Rispondi, Risolvi ed Elimina; in sola lettura si leggono e basta.
//
// Revisioni: l'interruttore «Registra le modifiche» con chi le firma, e
// l'elenco delle modifiche con chi e quando, ognuna con Accetta e Rifiuta, e
// tutte insieme.
//
// Ogni gesto è una battuta del documento, coi comandi del motore. Una scheda
// montata ascolta il motore finché non la smonta la shell, e si ridisegna
// soltanto dove il documento è cambiato: una risposta che si sta scrivendo
// resta lì mentre si scrive altrove.
import type { SurfacePanel } from "../core/registry";
import { textButton, textField, type ButtonKind } from "../../kit";
import { resolvedLanguage, t } from "../../i18n/strings";
import { openLifetime, type Lifetime } from "../../ui/lifetime";
import { setTooltip } from "../../ui/tooltip";
import { addComment, canComment, commentThreads, deleteComment, goToComment, replyComment, resolveComment, type Thread } from "./comments";
import type { RichEngine } from "./engine";
import { check, labelled, remark } from "./form";
import type { RichMedia } from "./panels";
import { changeText, goToChange, resolveAll, resolveChange, revisions, type Change } from "./review";
import { reviewAuthor, setReviewAuthor, setTracking } from "./track";

/// Le schede, per il loro nome breve.
export type RichSideId = "comments" | "revisions";

/// L'id con cui l'ispettore conosce ogni scheda: non si scontra con quelli
/// delle view dichiarate.
export const RICH_SIDE_VIEWS: Readonly<Record<RichSideId, string>> = {
  comments: "rich.side.comments",
  revisions: "rich.side.revisions",
};

/// Dove va il fuoco quando la barra apre una scheda.
export type RichSideTarget = "compose" | "list" | "author";

export interface RichSide {
  /// Le schede, sempre le stesse: la shell le rifà soltanto quando cambiano.
  readonly panels: readonly SurfacePanel[];
  /// Porta in vista la scheda `id` e le dà il fuoco; `false` se la shell non
  /// l'ha mostrata.
  show(id: RichSideId, target?: RichSideTarget): boolean;
  destroy(): void;
}

/// Un'ora come la legge chi guarda, nella lingua della shell.
export function when(at: string | undefined): string {
  const date = at ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime())) return at ?? "";
  return new Intl.DateTimeFormat(resolvedLanguage(), { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/// Un'azione di una voce, coi pulsanti del kit.
function button(into: HTMLElement, life: Lifetime, label: string, onPress: () => void, kind: ButtonKind = "normal"): HTMLButtonElement {
  const control = textButton({ label, kind, onPress, lifetime: life });
  into.append(control);
  return control;
}

/// Una scheda montata: il suo disposer, e dove mettere il fuoco.
interface Mounted {
  readonly host: HTMLElement;
  focus(target: RichSideTarget | undefined): void;
  close(): void;
}

/// `reveal` chiede alla shell di mostrare la scheda con quell'id.
export function mountRichSide(engine: RichEngine, media: RichMedia, reveal: (viewId: string) => void): RichSide {
  const mounted = new Map<RichSideId, Mounted>();
  let destroyed = false;

  /// La scheda dei commenti, montata in `host`.
  function mountComments(host: HTMLElement): Mounted {
    const life = openLifetime();
    const root = document.createElement("div");
    root.className = "rich-side rich-side-comments";
    host.append(root);

    // L'autore è uno, per i commenti e per le revisioni (`track.ts`).
    const author = document.createElement("input");
    author.type = "text";
    author.required = true;
    author.maxLength = 200;
    life.listen(author, "input", () => setReviewAuthor(author.value));
    const authorField = (into: HTMLElement) => {
      const field = textField({ label: t("rich.comment.author"), lifetime: life });
      field.element.querySelector(".kit-field-box")!.replaceChildren(author);
      author.id = field.input.id;
      author.className = "kit-field-input";
      into.append(field.element);
    };
    const by = () => author.value.trim();
    const area = (into: HTMLElement, label: string, rows: number) => {
      const said = document.createElement("textarea");
      said.rows = rows;
      said.required = true;
      said.maxLength = 4000;
      return labelled(into, said, label);
    };

    // Il commento nuovo, sulla selezione: c'è quando il documento si scrive
    // e il formato scrive commenti.
    const compose = document.createElement("form");
    compose.className = "rich-side-compose";
    const said = area(compose, t("rich.comment.text"), 3);
    const hint = remark(compose);
    const send = document.createElement("div");
    send.className = "rich-strip-panel-actions";
    const apply = textButton({ label: t("rich.comment.apply"), kind: "primary", onPress: () => {}, lifetime: life });
    apply.type = "submit";
    life.listen(compose, "submit", (event) => {
      event.preventDefault();
      if (!by()) return author.focus();
      if (engine.apply(addComment(said.value, by()), false)) said.value = "";
    });

    const note = remark(root);
    const list = document.createElement("div");
    list.className = "rich-side-list";
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", t("rich.comments"));
    root.append(compose, list);

    let writable: boolean | null = null;
    let composing = false;
    let doc: unknown = null;
    /// Ogni filo disegnato, con la firma di ciò che mostra.
    const drawn = new Map<number, { readonly el: HTMLElement; readonly sign: string; readonly life: Lifetime }>();

    function head(into: HTMLElement, comment: Thread["comment"]): void {
      const line = document.createElement("p");
      line.className = "rich-side-head";
      const name = document.createElement("strong");
      name.textContent = comment.by || t("rich.rev.anonymous");
      line.append(name);
      const date = when(comment.at);
      if (date) {
        const time = document.createElement("time");
        if (comment.at) time.dateTime = comment.at;
        time.textContent = date;
        line.append(" · ", time);
      }
      if (comment.done) line.append(` · ${t("rich.comment.resolved")}`);
      into.append(line);
      const body = document.createElement("p");
      body.className = "rich-side-text";
      body.textContent = comment.text ?? "";
      into.append(body);
    }

    /// Un filo: il testo commentato, il commento, le risposte e le azioni.
    function thread(item: Thread, own: Lifetime): HTMLElement {
      const { comment } = item;
      const el = document.createElement("article");
      el.className = "rich-side-item rich-side-comment";
      el.setAttribute("role", "listitem");
      el.dataset.comment = String(comment.id);
      if (comment.done) el.dataset.done = "";
      if (item.quote) {
        const quote = document.createElement("button");
        quote.type = "button";
        quote.className = "rich-side-quote";
        quote.textContent = item.quote;
        quote.disabled = !item.placed;
        quote.setAttribute("aria-label", t("rich.comment.go.quote", { quote: item.quote }));
        setTooltip(quote, t("rich.comment.go"));
        own.listen(quote, "click", () => engine.browse(goToComment(comment.id)));
        el.append(quote);
      }
      head(el, comment);
      for (const reply of item.replies) {
        const answer = document.createElement("div");
        answer.className = "rich-side-reply";
        answer.dataset.depth = String(Math.min(reply.depth, 3));
        head(answer, reply.comment);
        el.append(answer);
      }
      if (!writable) return el;
      const actions = document.createElement("div");
      actions.className = "rich-side-actions";
      const reply = button(actions, own, t("rich.comment.reply"), () => {
        reply.disabled = true;
        // La risposta è un `form` suo, dentro il filo.
        const form = document.createElement("form");
        form.className = "rich-side-answer";
        const text = area(form, t("rich.comment.reply.text"), 2);
        if (!by()) authorField(form);
        const row = document.createElement("div");
        row.className = "rich-strip-panel-actions";
        const go = textButton({ label: t("rich.comment.reply"), kind: "primary", onPress: () => {}, lifetime: own });
        go.type = "submit";
        row.append(go);
        form.append(row);
        own.listen(form, "submit", (event) => {
          event.preventDefault();
          if (!by()) return author.focus();
          engine.apply(replyComment(comment.id, text.value, by()), false);
        });
        el.append(form);
        text.focus();
      });
      reply.hidden = !composing;
      button(actions, own, t(comment.done ? "rich.comment.reopen" : "rich.comment.resolve"), () => {
        engine.apply(resolveComment(comment.id, !comment.done), false);
      });
      button(actions, own, t("rich.comment.delete"), () => {
        engine.apply(deleteComment(comment.id), false);
      });
      el.append(actions);
      return el;
    }

    function draw(): void {
      const nowWritable = engine.editable();
      if (nowWritable !== writable) {
        writable = nowWritable;
        composing = media.review === true && writable;
        compose.hidden = !composing;
        if (composing) {
          author.value = reviewAuthor();
          compose.replaceChildren(said.closest(".kit-field")!, hint);
          authorField(compose);
          send.replaceChildren(apply);
          compose.append(send);
        }
        // Le azioni cambiano con la scrittura: i fili si rifanno tutti.
        for (const each of drawn.values()) each.life.close();
        drawn.clear();
        doc = null;
      }
      const can = composing && engine.read(canComment);
      said.disabled = !can;
      apply.disabled = !can;
      hint.textContent = composing && !can ? t("rich.comment.need_selection") : "";
      hint.hidden = hint.textContent === "";
      note.textContent = writable && media.review !== true ? t("rich.comment.unsupported") : "";
      note.hidden = note.textContent === "";

      const current = engine.state.doc;
      if (current === doc) return;
      doc = current;
      const threads = engine.read((state) => commentThreads(state.doc));
      const keep = new Set<number>();
      const order: HTMLElement[] = [];
      for (const item of threads) {
        const sign = JSON.stringify([item.comment, item.quote, item.placed, item.replies]);
        const had = drawn.get(item.comment.id);
        keep.add(item.comment.id);
        if (had && had.sign === sign) {
          order.push(had.el);
          continue;
        }
        had?.life.close();
        const own = openLifetime();
        const el = thread(item, own);
        drawn.set(item.comment.id, { el, sign, life: own });
        order.push(el);
      }
      for (const [id, each] of drawn) {
        if (keep.has(id)) continue;
        each.life.close();
        drawn.delete(id);
      }
      list.replaceChildren(...order);
      if (threads.length === 0) remark(list).textContent = t("rich.comment.none");
    }

    draw();
    life.add(engine.subscribe(draw));
    return {
      host,
      focus(target) {
        if (target === "compose" && composing && !said.disabled) return said.focus();
        if (target === "compose" && composing && !by()) return author.focus();
        (list.querySelector<HTMLElement>("button:not(:disabled)") ?? said).focus();
      },
      close() {
        for (const each of drawn.values()) each.life.close();
        drawn.clear();
        life.close();
        root.remove();
      },
    };
  }

  /// La scheda delle revisioni: l'interruttore, chi scrive, l'elenco.
  function mountRevisions(host: HTMLElement): Mounted {
    const life = openLifetime();
    const root = document.createElement("div");
    root.className = "rich-side rich-side-revisions";
    host.append(root);

    // L'interruttore è una casella col ruolo di `switch`: Invio la preme come
    // lo Spazio, perché è un comando.
    const head = document.createElement("div");
    head.className = "rich-side-compose";
    const toggle = check(head, t("rich.track.switch"));
    toggle.setAttribute("role", "switch");
    toggle.closest("label")!.classList.add("rich-side-switch");
    const author = textField({ label: t("rich.comment.author"), lifetime: life }).element;
    const name = author.querySelector<HTMLInputElement>("input")!;
    name.maxLength = 200;
    name.required = true;
    head.append(author);
    const need = remark(head, "status");
    const all = document.createElement("div");
    all.className = "rich-side-actions";
    const acceptAll = button(all, life, t("rich.rev.accept_all.short"), () => engine.apply(resolveAll(true), false));
    const rejectAll = button(all, life, t("rich.rev.reject_all.short"), () => engine.apply(resolveAll(false), false));
    head.append(all);
    const list = document.createElement("div");
    list.className = "rich-side-list";
    list.setAttribute("role", "list");
    list.setAttribute("aria-label", t("rich.side.revisions"));
    root.append(head, list);

    life.listen(name, "input", () => {
      setReviewAuthor(name.value);
      need.hidden = true;
    });
    const flip = () => {
      const on = engine.tracking();
      if (!on && name.value.trim() === "") {
        toggle.checked = false;
        need.textContent = t("rich.track.need_author");
        need.hidden = false;
        name.focus();
        return;
      }
      engine.apply(setTracking(!on), false);
    };
    life.listen(toggle, "change", flip);
    life.listen(toggle, "keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      toggle.click();
    });

    let doc: unknown = null;
    let writable: boolean | null = null;
    /// Ogni voce disegnata, con la modifica di adesso: il testo prima di lei
    /// la sposta, e i suoi pulsanti la cercano dov'è.
    const drawn = new Map<string, { readonly el: HTMLElement; readonly life: Lifetime; readonly at: { change: Change } }>();

    /// Una voce: che cosa, chi, quando, il testo, e le sue due azioni.
    function entry(at: { change: Change }, text: string, own: Lifetime): HTMLElement {
      const { change } = at;
      const el = document.createElement("article");
      el.className = "rich-side-item rich-side-change";
      el.setAttribute("role", "listitem");
      el.dataset.kind = change.kind;
      const shown = text || t("rich.rev.paragraph");
      const go = document.createElement("button");
      go.type = "button";
      go.className = "rich-side-quote";
      go.textContent = shown;
      go.setAttribute("aria-label", t("rich.comment.go.quote", { quote: shown }));
      setTooltip(go, t("rich.comment.go"));
      own.listen(go, "click", () => engine.browse(goToChange(at.change.kind, at.change.from)));
      const line = document.createElement("p");
      line.className = "rich-side-head";
      const who = document.createElement("strong");
      who.textContent = change.rev.by || t("rich.rev.anonymous");
      line.append(t(change.kind === "ins" ? "rich.rev.kind.ins" : "rich.rev.kind.del"), " · ", who);
      const date = when(change.rev.at);
      if (date) {
        const time = document.createElement("time");
        if (change.rev.at) time.dateTime = change.rev.at;
        time.textContent = date;
        line.append(" · ", time);
      }
      el.append(line, go);
      if (writable) {
        const actions = document.createElement("div");
        actions.className = "rich-side-actions";
        button(actions, own, t("rich.rev.accept.one"), () => engine.apply(resolveChange(at.change.kind, at.change.from, true), false));
        button(actions, own, t("rich.rev.reject.one"), () => engine.apply(resolveChange(at.change.kind, at.change.from, false), false));
        el.append(actions);
      }
      return el;
    }

    function draw(): void {
      const on = engine.tracking();
      const nowWritable = engine.editable();
      toggle.checked = on;
      toggle.setAttribute("aria-checked", String(on));
      toggle.disabled = !nowWritable || (media.review !== true && !on);
      if (document.activeElement !== name) name.value = reviewAuthor();
      author.hidden = !nowWritable;
      if (nowWritable !== writable) {
        writable = nowWritable;
        for (const each of drawn.values()) each.life.close();
        drawn.clear();
        doc = null;
      }
      const current = engine.state.doc;
      if (current === doc) return;
      doc = current;
      const changes = engine.read((state) => revisions(state.doc));
      acceptAll.hidden = rejectAll.hidden = !writable || changes.length === 0;
      // Una voce si riconosce da ciò che dice, non dal posto, che si sposta
      // con il testo prima di lei; due uguali si contano.
      const seen = new Map<string, number>();
      const keep = new Set<string>();
      const order: HTMLElement[] = [];
      for (const change of changes) {
        const text = engine.read((state) => changeText(state.doc, change));
        const base = JSON.stringify([change.kind, change.rev, text]);
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        const key = `${base}#${n}`;
        keep.add(key);
        const had = drawn.get(key);
        if (had) {
          had.at.change = change;
          order.push(had.el);
          continue;
        }
        const own = openLifetime();
        const at = { change };
        const el = entry(at, text, own);
        drawn.set(key, { el, life: own, at });
        order.push(el);
      }
      for (const [key, each] of drawn) {
        if (keep.has(key)) continue;
        each.life.close();
        drawn.delete(key);
      }
      list.replaceChildren(...order);
      if (changes.length === 0) remark(list).textContent = t("rich.rev.none");
    }

    draw();
    life.add(engine.subscribe(draw));
    return {
      host,
      focus(target) {
        if (target === "author" && !author.hidden) return name.focus();
        (toggle.disabled ? list.querySelector<HTMLElement>("button") : toggle)?.focus();
      },
      close() {
        for (const each of drawn.values()) each.life.close();
        drawn.clear();
        life.close();
        root.remove();
      },
    };
  }

  const MOUNTS: Record<RichSideId, (host: HTMLElement) => Mounted> = {
    comments: mountComments,
    revisions: mountRevisions,
  };

  const panel = (id: RichSideId, title: () => string, icon: string): SurfacePanel => ({
    id: RICH_SIDE_VIEWS[id],
    title,
    icon,
    mount(host) {
      mounted.get(id)?.close();
      const made = MOUNTS[id](host);
      mounted.set(id, made);
      return () => {
        made.close();
        if (mounted.get(id) === made) mounted.delete(id);
      };
    },
  });

  const all: readonly SurfacePanel[] = [
    panel("comments", () => t("rich.comments"), "rc-comments"),
    panel("revisions", () => t("rich.side.revisions"), "rc-track"),
  ];

  return {
    panels: all,
    show(id, target) {
      if (destroyed) return false;
      reveal(RICH_SIDE_VIEWS[id]);
      const shown = mounted.get(id);
      if (!shown?.host.isConnected) return false;
      shown.focus(target);
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const each of mounted.values()) each.close();
      mounted.clear();
    },
  };
}

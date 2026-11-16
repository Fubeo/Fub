// Il pannello «Commenti» dell'ispettore (prototipo, `.ith` e `.icard`): le
// discussioni aperte in ordine di testo, poi i «Risolti» dell'archivio in
// fondo alla nota, con «Svuota i risolti». Legge il buffer quando lo si
// guarda e dopo una pausa nello scrivere: nessuna IPC.
import type { SurfacePanel } from "../../../../core/registry";
import { displayBinding } from "../../../../../ui/commands";
import { openLifetime } from "../../../../../ui/lifetime";
import { liveStrings } from "../strings";
import { discussionAnchor, shortName } from "./model";
import type { ArchivedDiscussion } from "./resolve";
import { avatar, when } from "./thread";
import type { CommentsSnapshot } from "./discussions";

/// Ciò che il pannello chiede al controllore dei commenti.
export interface CommentsPanelSource {
  snapshot(): CommentsSnapshot;
  watch(listener: () => void): () => void;
  clearResolved(): void;
}

/// La scorciatoia di «Commenta», come la legge chi guarda.
const CHORD = "Mod-Alt-m";

function heading(label: string, count: number): HTMLElement {
  const head = document.createElement("h3");
  head.className = "cm-fub-comments-head";
  const name = document.createElement("span");
  name.textContent = label;
  const n = document.createElement("span");
  n.className = "cm-fub-comments-count";
  n.textContent = String(count);
  head.append(name, n);
  return head;
}

function quoteOf(text: string): HTMLElement {
  const quote = document.createElement("span");
  quote.className = "cm-fub-comments-quote";
  if (text) quote.textContent = text;
  else {
    quote.textContent = liveStrings.t("comments.panel.point");
    quote.dataset.point = "";
  }
  return quote;
}

function resolvedCard(each: ArchivedDiscussion): HTMLElement {
  const card = document.createElement("div");
  card.className = "cm-fub-comments-card";
  card.dataset.resolved = "";
  card.setAttribute("role", "listitem");
  const note = document.createElement("p");
  note.className = "cm-fub-comments-archived";
  note.textContent = liveStrings.plural(each.messages.length, "comments.panel.archived.one", "comments.panel.archived", { count: each.messages.length });
  card.append(quoteOf(each.quote), note);
  return card;
}

/// Il pannello. `reveal` porta il commento in vista e apre la discussione.
export function commentsPanel(source: CommentsPanelSource, reveal: (anchor: number) => void): SurfacePanel {
  return {
    id: "markdown.comments",
    title: () => liveStrings.t("comments.panel"),
    icon: "comment",
    mount(host) {
      const t = liveStrings.t;
      const life = openLifetime();
      const root = document.createElement("div");
      root.className = "cm-fub-comments-panel";
      host.append(root);
      const draw = () => {
        const shot = source.snapshot();
        const parts: HTMLElement[] = [];
        if (shot.open.length === 0) {
          const empty = document.createElement("p");
          empty.className = "cm-fub-comments-empty";
          const kbd = document.createElement("kbd");
          kbd.textContent = displayBinding(CHORD);
          const [before, after] = t("comments.panel.empty", { chord: "\u0000" }).split("\u0000");
          empty.append(before ?? "", kbd, after ?? "");
          parts.push(empty);
        } else {
          parts.push(heading(t("comments.panel.open"), shot.open.length));
          const list = document.createElement("div");
          list.setAttribute("role", "list");
          for (const each of shot.open) {
            const anchor = discussionAnchor(each.thread);
            const first = each.messages[0];
            const card = document.createElement("div");
            card.className = "cm-fub-comments-card";
            card.setAttribute("role", "listitem");
            card.tabIndex = 0;
            card.dataset.anchor = String(anchor);
            if (shot.active === anchor) card.dataset.active = "";
            const who = document.createElement("div");
            who.className = "cm-fub-comments-who";
            const name = document.createElement("span");
            name.textContent = shortName(first?.author ?? null, t("comments.unnamed"));
            who.append(avatar(first?.author ?? null), name);
            if (first?.date) {
              const time = document.createElement("time");
              time.dateTime = first.date.replace(" ", "T");
              time.textContent = when(first.date);
              who.append(time);
            }
            const text = document.createElement("p");
            text.textContent = first?.text ?? "";
            card.append(quoteOf(each.quote), who, text);
            const replies = each.messages.length - 1;
            if (replies > 0) {
              const more = document.createElement("small");
              more.className = "cm-fub-comments-replies";
              more.textContent = liveStrings.plural(replies, "comments.panel.replies.one", "comments.panel.replies", { count: replies });
              card.append(more);
            }
            list.append(card);
          }
          parts.push(list);
          const foot = document.createElement("p");
          foot.className = "cm-fub-comments-note";
          foot.textContent = t("comments.panel.note");
          parts.push(foot);
        }
        if (shot.resolved.length > 0) {
          parts.push(heading(t("comments.panel.resolved"), shot.resolved.length));
          const list = document.createElement("div");
          list.setAttribute("role", "list");
          list.append(...shot.resolved.map(resolvedCard));
          parts.push(list);
          if (!shot.readOnly) {
            const clear = document.createElement("button");
            clear.type = "button";
            clear.className = "cm-fub-comments-clear";
            clear.dataset.action = "clear";
            clear.textContent = t("comments.panel.clear");
            parts.push(clear);
          }
        }
        root.replaceChildren(...parts);
      };
      const go = (target: EventTarget | null) => {
        const card = (target as Element | null)?.closest<HTMLElement>(".cm-fub-comments-card[data-anchor]");
        if (card) reveal(Number(card.dataset.anchor));
      };
      life.listen(root, "click", (event) => {
        if ((event.target as Element | null)?.closest("[data-action=clear]")) {
          source.clearResolved();
          return;
        }
        go(event.target);
      });
      life.listen(root, "keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        if (!(event.target as Element | null)?.matches(".cm-fub-comments-card[data-anchor]")) return;
        event.preventDefault();
        go(event.target);
      });
      // La scheda resta montata anche quando l'ispettore ne mostra un'altra:
      // nascosta non rilegge la nota a ogni pausa nello scrivere, e si rifà
      // quando torna a vista.
      let shown = true;
      let stale = false;
      const redraw = () => {
        if (shown) draw();
        else stale = true;
      };
      if (typeof IntersectionObserver === "function") {
        const seen = new IntersectionObserver((entries) => {
          shown = entries.some((entry) => entry.isIntersecting);
          if (shown && stale) {
            stale = false;
            draw();
          }
        });
        seen.observe(root);
        life.add(() => seen.disconnect());
      }
      life.add(source.watch(redraw));
      draw();
      return () => {
        life.close();
        root.remove();
      };
    },
  };
}

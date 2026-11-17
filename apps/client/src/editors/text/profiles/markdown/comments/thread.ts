// La discussione di un commento e il primo messaggio, come si vedono nel
// riquadro che si apre dal margine: la citazione, i messaggi, la risposta,
// Risolvi ed Elimina (prototipo, `.th`). Qui soltanto il DOM e i gesti; chi
// scrive nel testo è `discussions.ts`, che passa le azioni.
import { resolvedLanguage } from "../../../../../i18n/strings";
import { displayBinding } from "../../../../../ui/commands";
import { icon, registerIcon } from "../../../../../ui/icons";
import type { Lifetime } from "../../../../../ui/lifetime";
import { textField, type TextField } from "../../../../../kit";
import { liveStrings } from "../strings";
import { authorSlot, initials, shortName, type Discussion, type MessageHeader } from "./model";

/// Le figure dei commenti, sulla griglia di 24 del set della shell (quelle
/// del prototipo, da 16, per una volta e mezza).
const ICONS: Readonly<Record<string, readonly string[]>> = {
  comment: ["M3.75 5.25h16.5v11.25H10.5L6 20.25V16.5H3.75z"],
  "comment-check": ["M4.5 12.75l4.5 4.5L19.5 6.75"],
  "comment-send": ["M4.5 12h14.25", "M12.75 6l6 6-6 6"],
};

/// Registra le figure che il set non ha ancora. Una volta per tutte: le
/// usano il margine, la discussione e il pannello, in ogni nota.
export function commentIcons(): void {
  for (const [name, paths] of Object.entries(ICONS)) if (icon(name) === "") registerIcon(name, paths);
}

/// La scorciatoia di invio, come la legge chi guarda.
export const SEND_CHORD = "Mod-Enter";

/// Il pallino con le iniziali di chi scrive, nel colore del suo posto.
export function avatar(author: string | null, className = "cm-fub-comment-avatar"): HTMLElement {
  const dot = document.createElement("span");
  dot.className = className;
  dot.dataset.slot = String(authorSlot(author));
  dot.textContent = initials(author);
  dot.setAttribute("aria-hidden", "true");
  return dot;
}

/// Quando, come si legge: «oggi 17:40», «ieri 9:12», «8 nov 17:40»; la data
/// scritta com'è se non si legge.
export function when(date: string | null, now: Date = new Date()): string {
  if (!date) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(date);
  if (!match) return date;
  const [, y, m, d, hh, mm] = match;
  const day = new Date(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(day.getTime())) return date;
  const time = hh !== undefined ? `${Number(hh)}:${mm}` : "";
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (time && days === 0) return liveStrings.t("comments.time.today", { time });
  if (time && days === 1) return liveStrings.t("comments.time.yesterday", { time });
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (day.getFullYear() !== now.getFullYear()) options.year = "numeric";
  const shown = new Intl.DateTimeFormat(resolvedLanguage(), options).format(day);
  return time ? `${shown} ${time}` : shown;
}

/// Un messaggio: il pallino, il nome breve con l'ora, il testo.
export function messageRow(message: MessageHeader): HTMLElement {
  const row = document.createElement("div");
  row.className = "cm-fub-comment-message";
  const who = document.createElement("b");
  who.textContent = shortName(message.author, liveStrings.t("comments.unnamed"));
  if (message.author) who.title = message.author;
  if (message.date) {
    const time = document.createElement("time");
    time.dateTime = message.date.replace(" ", "T");
    time.textContent = when(message.date);
    who.append(time);
  }
  const text = document.createElement("p");
  text.textContent = message.text;
  row.append(avatar(message.author), who, text);
  return row;
}

/// La citazione in testa: il testo commentato, o «Commento su un punto».
function quoteRow(quote: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "cm-fub-comment-quote";
  if (quote) row.textContent = quote;
  else {
    row.textContent = liveStrings.t("comments.panel.point");
    row.dataset.point = "";
  }
  return row;
}

interface Writer {
  readonly row: HTMLElement;
  readonly input: HTMLTextAreaElement;
  readonly send: HTMLButtonElement;
}

/// La riga in cui si scrive: il pallino di chi scrive, il campo che cresce
/// con il testo, il pulsante che invia. Mod-Invio invia.
function writer(me: string | null, placeholder: string, label: string, sendLabel: string, life: Lifetime, onSend: () => void): Writer {
  const row = document.createElement("div");
  row.className = "cm-fub-comment-write";
  const input = document.createElement("textarea");
  input.rows = 1;
  input.placeholder = placeholder;
  input.setAttribute("aria-label", label);
  input.className = "cm-fub-comment-input";
  const send = document.createElement("button");
  send.type = "button";
  send.className = "cm-fub-comment-send";
  send.setAttribute("aria-label", sendLabel);
  send.title = `${sendLabel} (${displayBinding(SEND_CHORD)})`;
  send.innerHTML = icon("comment-send");
  const grow = () => {
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight}px`;
    send.disabled = input.value.trim() === "";
  };
  send.disabled = true;
  life.listen(input, "input", grow);
  life.listen(input, "keydown", (event) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.isComposing) {
      event.preventDefault();
      if (input.value.trim() !== "") onSend();
    }
  });
  life.listen(send, "click", () => {
    if (input.value.trim() !== "") onSend();
  });
  row.append(avatar(me, "cm-fub-comment-avatar"), input, send);
  return { row, input, send };
}

/// Un pulsante della riga delle azioni.
function action(label: string, hint: string, figure: string, life: Lifetime, run: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cm-fub-comment-action";
  button.title = hint;
  button.innerHTML = icon(figure);
  button.append(label);
  life.listen(button, "click", run);
  return button;
}

/// La discussione aperta.
export interface DiscussionView {
  readonly element: HTMLElement;
  /// Rifà la citazione e i messaggi: la risposta che si sta scrivendo resta.
  update(discussion: Discussion): void;
  /// Le iniziali di chi risponde, quando le impostazioni arrivano.
  signer(name: string | null): void;
  focus(): void;
}

export interface DiscussionActions {
  readonly readOnly: boolean;
  reply(text: string): void;
  resolve(): void;
  remove(): void;
}

/// Il contenuto del riquadro di una discussione.
export function discussionView(discussion: Discussion, me: string | null, actions: DiscussionActions, life: Lifetime): DiscussionView {
  const t = liveStrings.t;
  const element = document.createElement("div");
  element.className = "cm-fub-comment-discussion";
  let quote = quoteRow(discussion.quote);
  const list = document.createElement("div");
  list.className = "cm-fub-comment-messages";
  list.setAttribute("role", "list");
  const fill = (each: Discussion) => {
    list.replaceChildren(...each.messages.map((message) => {
      const row = messageRow(message);
      row.setAttribute("role", "listitem");
      return row;
    }));
  };
  fill(discussion);
  element.append(quote, list);
  let reply: Writer | null = null;
  if (!actions.readOnly) {
    reply = writer(me, t("comments.reply.placeholder"), t("comments.reply.label"), t("comments.reply.send"), life, () => {
      const text = reply!.input.value;
      reply!.input.value = "";
      reply!.input.dispatchEvent(new Event("input"));
      actions.reply(text);
    });
    const bar = document.createElement("div");
    bar.className = "cm-fub-comment-actions";
    const end = document.createElement("span");
    end.className = "cm-fub-comment-actions-end";
    end.append(action(t("comments.delete"), t("comments.delete.hint"), "trash", life, actions.remove));
    bar.append(action(t("comments.resolve"), t("comments.resolve.hint"), "comment-check", life, actions.resolve), end);
    element.append(reply.row, bar);
  }
  return {
    element,
    update(next) {
      const fresh = quoteRow(next.quote);
      quote.replaceWith(fresh);
      quote = fresh;
      fill(next);
    },
    signer(name) {
      reply?.row.querySelector(".cm-fub-comment-avatar")?.replaceWith(avatar(name));
    },
    focus() {
      (reply?.input ?? list).focus?.();
    },
  };
}

/// Il primo messaggio di un commento nuovo.
export interface ComposerView {
  readonly element: HTMLElement;
  focus(): void;
}

export interface ComposerOptions {
  /// La citazione: il testo scelto, vuoto per un commento su un punto.
  readonly quote: string;
  /// Una frase sul posto: la selezione tagliata al primo blocco, il commento
  /// dopo il codice.
  readonly note: string | null;
  /// Chiedere il nome (il primo commento, senza `profile.name`).
  readonly askName: boolean;
  readonly me: string | null;
  send(text: string, name: string | null): void;
}

/// Il contenuto del riquadro che scrive il primo messaggio.
export function composerView(options: ComposerOptions, life: Lifetime): ComposerView {
  const t = liveStrings.t;
  const element = document.createElement("div");
  element.className = "cm-fub-comment-discussion cm-fub-comment-composer";
  element.append(quoteRow(options.quote));
  if (options.note) {
    const note = document.createElement("p");
    note.className = "cm-fub-comment-note";
    note.textContent = options.note;
    element.append(note);
  }
  let name: TextField | null = null;
  if (options.askName) {
    const ask = document.createElement("div");
    ask.className = "cm-fub-comment-name";
    name = textField({ label: t("comments.name.label"), lifetime: life });
    const hint = document.createElement("p");
    hint.className = "cm-fub-comment-name-hint";
    hint.textContent = t("comments.name.hint");
    hint.id = `${name.input.id}-hint`;
    name.input.setAttribute("aria-describedby", hint.id);
    ask.append(name.element, hint);
    element.append(ask);
  }
  const write = writer(options.me, t("comments.compose.placeholder"), t("comments.compose.label"), t("comments.compose.send"), life, () => {
    options.send(write.input.value, name ? name.value() : null);
  });
  const foot = document.createElement("div");
  foot.className = "cm-fub-comment-actions cm-fub-comment-foot";
  const file = document.createElement("span");
  const code = document.createElement("code");
  code.textContent = "{==…==}{>>…<<}";
  file.append(t("comments.compose.file"), " ", code);
  const keys = document.createElement("span");
  const kbd = document.createElement("kbd");
  kbd.textContent = displayBinding(SEND_CHORD);
  const [before, after] = t("comments.compose.keys", { chord: "\u0000" }).split("\u0000");
  keys.append(before ?? "", kbd, after ?? "");
  foot.append(file, keys);
  element.append(write.row, foot);
  return {
    element,
    focus() {
      (name && name.value().trim() === "" ? name : write.input).focus();
    },
  };
}

// **Il centro notifiche** (§10.3): un messaggio all'utente che non chiede una
// risposta — l'esito di un comando, un lavoro finito, un errore che non blocca.
//
// Era un toast solo, che il messaggio dopo cancellava. Bastava finché i
// chiamanti erano tre; con il §20.4 (che ha portato qui i quattordici avvisi
// che erano scritti in `console`) e con l'esito dei lavori lunghi, un messaggio che
// scompare in quattro secondi e sovrascrive il precedente è un canale che
// **perde**, e in silenzio: chi era in un'altra finestra non ha modo di sapere
// cosa gli è stato detto.
//
// Le tre cose che questa voce aggiunge, e le tre ragioni:
//
// 1. **Uno storico.** Un avviso che si può rileggere è la differenza fra
//    «segnalato» e «detto a nessuno». Costa cinquanta righe di memoria
//    ([`MEMORIA`]) e niente altro.
// 2. **Il raggruppamento.** Un salvataggio che fallisce a ogni battuta sono
//    dieci avvisi identici di fila: dieci righe raccontano che è successo dieci
//    volte, e nessuna aggiunge un fatto. Diventano una riga con un contatore.
// 3. **Il tono.** Un lavoro finito e una perdita di dati non chiedono la stessa
//    cosa a chi legge, e con un solo colore la seconda si legge come la prima.
//
// **La sorgente adesso c'è**, ed è quella che la [decisione 0013] aveva
// previsto: *ciò che si limita a informare è un evento*. Il §20.2
// ([decisione 0052]) ha portato il cliente e la variante — `trouble`, con la
// severità e il documento di cui parla — e qui sotto `ascoltaIGuasti` le
// attacca il router degli eventi, che è la riga che questo commento aspettava.
//
// **E il §20.4 è arrivato** ([decisione 0080]): i quattordici `console.warn` e
// `console.error` della shell — che non passavano da un evento del kernel,
// perché nascono di qua dal confine — chiamano tutti questa porta, e con loro il
// salvataggio, che un esito non ce l'aveva proprio. Da lì è uscita anche
// `esisteUnDom` qui sotto: aperta la porta a `state/store.ts` e
// `state/kernel.ts`, che un DOM non ce l'hanno, la promessa di funzionare senza
// disegno ha smesso di essere solo scritto.
//
// [decisione 0013]: ../../../docs/decisions/0013-elenco-delle-capacita.md
// [decisione 0052]: ../../../docs/decisions/0052-cio-che-va-storto-e-un-evento.md
// [decisione 0080]: ../../../docs/decisions/0080-un-guasto-si-dice-a-chi-sta-lavorando.md

import { onLanguage, t, type Key } from "../i18n/strings";
import type { Gate, KernelEvent } from "../host/contract";
import { onEvent } from "../state/kernel";

/// Quanto **tono** ha un avviso. Due e non cinque: chi disegna deve poterli
/// distinguere a colpo d'occhio, e una scala di severità che nessuno sa dove
/// tagliare finisce con tutto sullo stesso gradino.
export type Tone = "info" | "guasto";

/// Un avviso nello storico: il testo, il tono, quando, e **quante volte**.
export interface Notice {
  text: string;
  tone: Tone;
  /// L'ultima volta che è successo, in millisecondi (`Date.now`).
  when: number;
  /// Quante volte di fila. Uno è il caso normale; sopra uno la riga mostra
  /// «×N».
  times: number;
}

/// Quanti avvisi si ricordano. Uno storico illimitato è una perdita di memoria
/// travestita da funzionalità; cinquanta coprono una sessione di lavoro
/// difficile e stanno in una schermata di scorrimento.
export const HISTORY_LIMIT = 50;

/// La regola dello storico, e l'unica decisione di questo modulo: **due avvisi
/// identici di fila sono uno**.
///
/// «Di fila» e non «uguali»: raggruppare due messaggi identici lontani nel
/// tempo racconterebbe che è successo una volta sola, mentre raggrupparne dieci
/// consecutivi dice ciò che sta succedendo *adesso*. Un avviso diverso in mezzo
/// chiude il gruppo, e il successivo ricomincia da uno.
///
/// È una funzione pura, e non per gusto: è ciò che di questo modulo si può
/// provare senza un DOM.
export function collect(history: Notice[], newItem: Notice): Notice[] {
  const last = history[0];
  if (last && last.text === newItem.text && last.tone === newItem.tone) {
    const merged: Notice = {
      ...last,
      when: newItem.when,
      times: last.times + 1,
    };
    return [merged, ...history.slice(1)];
  }
  return [newItem, ...history].slice(0, HISTORY_LIMIT);
}

/// Come una riga si legge: il testo, e quante volte se è più di una.
export function lineOf(notice: Notice): string {
  return notice.times > 1 ? `${notice.text} ×${notice.times}` : notice.text;
}

// --- da qui in giù è disegno ------------------------------------------------

/// Per quanto resta a galla un avviso prima di scendere nello storico. Non è la
/// sua vita: è quanto interrompe.
const TOAST_DURATION_MS = 5000;

let history: Notice[] = [];
/// Quanti ne sono arrivati da quando lo storico è stato guardato l'ultima
/// volta. È il numero sul pulsante, ed è l'unica ragione per cui «aprire» il
/// centro è un fatto che vale la pena registrare.
let unreadCount = 0;
let open = false;

/// Dice un messaggio all'utente. È la porta di tutta la shell, e resta una
/// riga: chi chiama non sa che esistono uno storico e un raggruppamento.
export function notify(message: string, tone: Tone = "info"): void {
  history = collect(history, { text: message, tone, when: Date.now(), times: 1 });
  if (!open) unreadCount += 1;
  show(history[0]);
  redraw();
}

/// **Il kernel dice che qualcosa è andato storto, e lo si mostra** (§20.2).
///
/// L'unico ascoltatore di `trouble`, e la ragione per cui quella variante
/// esiste: prima di lei ciò che andava storto nel backend finiva su `stderr`,
/// che in un'app impacchettata non ha un lettore.
///
/// La severità sceglie il tono, ed è una traduzione uno a uno perché i due
/// gradini sono stati scelti guardando questi due toni: un derivato perduto
/// informa, ciò che non si ricostruisce è un guasto.
export function listenForFailures(): void {
  onEvent("trouble", (e) => {
    const notice = failureNotice(e);
    notify(notice.text, notice.tone);
  });
}

/// Come un guasto del kernel si legge: il testo e il tono.
///
/// È una funzione pura, per la stessa ragione di [`raccogli`]: è la sola parte
/// di questo collegamento che possa essere sbagliata in un modo che guardando
/// l'app non si vede — un `subject` assente che diventa la stringa `"null"`, o
/// una severità che finisce tutta sullo stesso tono.
///
/// **La porta del panico si dice** (§17.3, decisione 0161): quando il kernel
/// sa da dove è entrato il guasto, la frase lo racconta in coda — sapere da che
/// parte guardare quando un componente di terzi esplode è metà della diagnosi.
export function failureNotice(e: Extract<KernelEvent, { type: "trouble" }>): {
  text: string;
  tone: Tone;
} {
  const reason = e.error.message;
  const base = e.subject
    ? t("trouble.about", { doc: e.subject, reason })
    : t("trouble.vault", { reason });
  return {
    text:
      e.gate === null
        ? base
        : base + t("trouble.gate", { gate: t(GATE_LABELS[e.gate]) }),
    tone: e.severity === "failure" ? "guasto" : "info",
  };
}

/// La porta del panico, come **chiave** e non come parola.
///
/// Una tabella di stringhe a livello di modulo si sarebbe risolta all'import,
/// cioè una volta sola e nella lingua di quel momento: cambiare lingua avrebbe
/// lasciato l'avviso a parlare quella di prima, e non lo avrebbe detto nessuno.
/// Le chiavi non invecchiano; le parole sì.
///
/// È un `Record` **esaustivo** di proposito, sul modello di `REACH_KEYS` in
/// `palette.ts`: aggiungere un gate al contratto senza un'etichetta qui è un
/// errore di compilazione, non una porta che l'avviso tace.
const GATE_LABELS: Record<Gate, Key> = {
  command: "gate.command",
  view_render: "gate.view_render",
  view_action: "gate.view_action",
  service: "gate.service",
  event: "gate.event",
  index_feed: "gate.index_feed",
  index_forget: "gate.index_forget",
  index_up_to_date: "gate.index_up_to_date",
  index_reconcile: "gate.index_reconcile",
  format_parse: "gate.format_parse",
  syntax_rule: "gate.syntax_rule",
  custom_render: "gate.custom_render",
  job: "gate.job",
};

/// Ciò che è stato detto, dal più recente. Serve a chi disegna lo storico, e ai
/// test che guardano il canale invece del DOM.
export function recentNotices(): Notice[] {
  return history;
}

/// Il pannello dello storico si apre e si chiude da qui: è anche il momento in
/// cui il contatore dei non letti torna a zero.
export function openHistory(isOpen = !open): void {
  open = isOpen;
  if (open) unreadCount = 0;
  redraw();
}

export function clearHistory(): void {
  history = [];
  unreadCount = 0;
  redraw();
}

/// C'è un documento su cui disegnare?
///
/// La riga che questo modulo prometteva da sempre — *«se la shell non li ha (un
/// test, un host che monta solo un pezzo) non succede niente»* — e che era vera
/// per il pannello e falsa per tutto il resto: `show` e `redraw` toccavano
/// `document` senza chiederselo. Finché i chiamanti erano pannelli non si vedeva,
/// perché un pannello un DOM ce l'ha per definizione. Col §20.4 la porta è aperta
/// anche a `state/store.ts` e `state/kernel.ts`, che DOM non ne hanno e che nei
/// test girano in Node: il primo avviso da lì è diventato un rifiuto non gestito.
///
/// È il difetto di questa seduta preso dal lato di chi ascolta — un canale che
/// smette di funzionare in silenzio proprio mentre gli si racconta un guasto —
/// e l'ha trovato un test che non guardava questo file.
function hasDom(): boolean {
  return typeof document !== "undefined";
}

/// Il toast: l'avviso **mentre succede**. Sovrascrive il precedente di
/// proposito — chi guarda lo schermo legge l'ultimo, e ciò che ha perso sta
/// nello storico, che è la ragione per cui lo storico esiste.
///
/// **Non interrompe chi sta già guardando lo storico.** Il toast e la lista
/// occupano lo stesso angolo e dicono la stessa cosa: a pannello aperto la riga
/// nuova compare in cima da sé, e un rettangolo sopra la lista coprirebbe
/// proprio ciò che l'utente è andato a leggere.
function show(notice: Notice): void {
  if (open || !hasDom()) return;
  const old = document.getElementById("toast");
  if (old) old.remove();
  const toast = document.createElement("div");
  toast.id = "toast";
  toast.className = "toast";
  // Il toast è **l'unica** cosa che compare senza che l'utente l'abbia chiesta,
  // e sparisce da sola dopo qualche secondo: chi non guarda lo schermo non ha
  // nessun altro modo di saperlo. `status` e non `alert` per la stessa ragione
  // per cui non ruba il fuoco — informa senza interrompere (§10.3), e `alert`
  // taglierebbe la parola a metà frase.
  toast.setAttribute("role", "status");
  toast.dataset.tone = notice.tone;
  // Testo semplice: ciò che arriva da un provider non diventa mai markup
  // (stessa regola di `SearchHit.snippet` e `UiNode` non fidato).
  toast.textContent = lineOf(notice);
  document.body.appendChild(toast);
  window.setTimeout(() => {
    if (document.getElementById("toast") === toast) toast.remove();
  }, TOAST_DURATION_MS);
}

/// Il pulsante nella barra di stato e il pannello dello storico. Se la shell
/// non li ha (un test, un host che monta solo un pezzo) non succede niente:
/// `notify` continua a funzionare, perché il canale non dipende dal suo
/// disegno.
function redraw(): void {
  if (!hasDom()) return;
  const button = document.getElementById("notify-button");
  if (button) {
    button.textContent =
      unreadCount > 0 ? t("notices.count", { count: unreadCount }) : t("notices.title");
    button.classList.toggle("ha-novita", unreadCount > 0);
    button.setAttribute("aria-expanded", String(open));
  }

  const panel = document.getElementById("notify-panel");
  if (!panel) return;
  panel.hidden = !open;
  if (!open) return;

  const list = panel.querySelector("#notify-list");
  if (!(list instanceof HTMLElement)) return;
  list.replaceChildren();
  if (history.length === 0) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = t("notices.none");
    list.appendChild(empty);
    return;
  }
  for (const notice of history) {
    const row = document.createElement("li");
    row.dataset.tone = notice.tone;
    const text = document.createElement("span");
    text.className = "notify-testo";
    text.textContent = lineOf(notice);
    const time = document.createElement("span");
    time.className = "muted notify-ora";
    time.textContent = new Date(notice.when).toLocaleTimeString();
    row.append(text, time);
    list.appendChild(row);
  }
}

/// Accende il centro notifiche: il pulsante nella barra di stato e il pannello.
/// Da chiamare una volta sola, dal punto di montaggio.
export function mountNotifications(): void {
  document.getElementById("notify-button")?.addEventListener("click", () => openHistory());
  document.getElementById("notify-clear")?.addEventListener("click", () => clearHistory());
  document.getElementById("notify-close")?.addEventListener("click", () => openHistory(false));
  // Come per il centro attività: il pulsante porta un conteggio, quindi non lo
  // può scrivere `applicaStringhe` — e il testo **degli avvisi** resta com'era,
  // perché un avviso è già stato detto e ridirlo in un'altra lingua vorrebbe
  // dire riscrivere la storia di ciò che è successo.
  onLanguage(redraw);
  redraw();
}

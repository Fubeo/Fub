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
// [decisione 0013]: ../../../docs/decisions/0185-capability-un-solo-guard.md
// [decisione 0052]: ../../../docs/decisions/0184-eventi-accodati-e-job.md
// [decisione 0080]: ../../../docs/decisions/0184-eventi-accodati-e-job.md

import { onLanguage, t, type Key } from "../i18n/strings";
import type { Gate, KernelEvent } from "../host/contract";
import { onEvent } from "../state/kernel";
import type { Lifetime } from "./lifetime";
import { focusableElements } from "./a11y";
import { setTooltip } from "./tooltip";
import { exactTime, relativeTime } from "./when";
import { drawCountButton } from "./icons";
import { errorText } from "../host/errors";
import { DURATION, exitGhost, flip } from "../moto";
import { enterSurface, exitSurface } from "./motion";
/// Quanto **tono** ha un avviso. Due e non cinque: chi disegna deve poterli
/// distinguere a colpo d'occhio, e una scala di severità che nessuno sa dove
/// tagliare finisce con tutto sullo stesso gradino.
export type Tone = "info" | "guasto";

/** Rifiuto strutturato del cancello temi, prima della resa in una notifica. */
export interface ThemeTrouble {
  readonly type: "theme";
  readonly theme: string;
  readonly reasons: readonly string[];
}

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
/// `true` = l'host ha segnalato assenza di rilevamento modifiche esterne
/// (U66): indicazione persistente nel centro, mai un finto «sincronizzato».
/// Resta finché un segnale contrario non la abbassa — nessun timeout che la
/// faccia sparire da sola.
let watcherOff = false;
/// Il gesto che rimette il rilevamento: riaprire il vault. Lo dà chi alza il
/// segnale, e vale finché il segnale resta.
let reopenVault: (() => Promise<void>) | null = null;
/// Chi ha aperto per ultimo il centro, per riportargli il fuoco (C04).
let opener: HTMLElement | null = null;

/// Testi del centro con chiavi dedicate (U65-U66): `notices.open_problems`
/// {count} per i non letti, `notices.watcher_off` per il rilevamento assente.
type P8Key = "notices.open_problems" | "notices.watcher_off";
function notifyText(key: P8Key, args: Record<string, string | number> = {}): string {
  switch (key) {
    case "notices.open_problems":
      return t("notices.open_problems", { count: typeof args["count"] === "number" ? args["count"] : 0 });
    case "notices.watcher_off":
      return t("notices.watcher_off", args);
  }
}

/// Dice un messaggio all'utente. È la porta di tutta la shell, e resta una
/// riga: chi chiama non sa che esistono uno storico e un raggruppamento.
export function notify(
  message: string,
  tone: Tone = "info",
  action?: NoticeAction | readonly NoticeAction[],
): void {
  history = collect(history, { text: message, tone, when: Date.now(), times: 1 });
  if (!open) unreadCount += 1;
  announce(history[0]!);
  show(history[0]!, action === undefined ? [] : "label" in action ? [action] : action);
  redraw();
}

/// Un gesto che l'avviso offre accanto al testo: «Annulla», «Apri», «Riprova».
/// Vive quanto il toast; lo storico conserva il testo, non il gesto.
export interface NoticeAction {
  readonly label: string;
  /// Che cosa farebbe il gesto, in una frase: il suggerimento del pulsante.
  /// «Annulla» da solo non dice che cosa annulla.
  readonly hint?: string;
  readonly run: () => void | Promise<void>;
}

/** Porta i rifiuti locali dei temi nello stesso centro dei guasti del kernel. */
export function reportThemeTrouble(trouble: ThemeTrouble): void {
  notify(
    [
      t("theme.rejected", { theme: trouble.theme }),
      ...trouble.reasons.map((reason) => `- ${reason}`),
    ].join("\n"),
    "guasto",
  );
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
export function listenForFailures(lifetime: Lifetime): void {
  lifetime.add(
    onEvent("trouble", (e) => {
      const notice = failureNotice(e);
      notify(notice.text, notice.tone);
    }),
  );
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
  index_query: "gate.index_query",
};

/// Ciò che è stato detto, dal più recente. Serve a chi disegna lo storico, e ai
/// test che guardano il canale invece del DOM.
export function recentNotices(): Notice[] {
  return history;
}

/// Il pannello dello storico si apre e si chiude da qui: è anche il momento in
/// cui il contatore dei non letti torna a zero.
export function openHistory(isOpen = !open): void {
  if (isOpen && !open && typeof document !== "undefined") {
    const active = document.activeElement;
    if (active instanceof HTMLElement) opener = active;
  }
  open = isOpen;
  if (open) {
    unreadCount = 0;
    redraw();
    panelFirstFocusable()?.focus();
  } else {
    redraw();
    if (opener?.isConnected) opener.focus();
    opener = null;
  }
}

/// Segnala che il vault non ha il rilevamento delle modifiche esterne (U66).
///
/// Indicazione **persistente** nel centro finché il segnale resta: nessun
/// timeout che la cancelli, mai un finto «sincronizzato». Resta un'indicazione
/// di contesto — non un avviso raggruppato — così rileggerla non la duplica.
/// Cambio vault la azzera: è del vault di prima, e il nuovo la ridice col suo
/// segnale (I04/R07-R08). Nota: nessun iscritto automatico qui — il segnale
/// `watching` arriva da `vaultStatus()` in desktop-shell, che resta l'unico a
/// chiamarla (ownership sua, nessun secondo writer).
export function setWatcherOff(off: boolean, reopen?: () => Promise<void>): void {
  watcherOff = off;
  reopenVault = off ? reopen ?? null : null;
  redraw();
}

export function isWatcherOff(): boolean {
  return watcherOff;
}

export function clearHistory(): void {
  history = [];
  unreadCount = 0;
  redraw();
}

function panelFirstFocusable(): HTMLElement | null {
  if (!hasDom()) return null;
  const panel = document.getElementById("notify-panel");
  if (!(panel instanceof HTMLElement)) return null;
  return focusableElements(panel)[0] ?? panel;
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

/// Quanti toast stanno insieme a schermo. Tre si leggono con un'occhiata; il
/// quarto fa uscire il più vecchio, che resta nello storico e nel conto di
/// «+N altri».
export const TOAST_STACK_LIMIT = 3;

/// Il toast: l'avviso **mentre succede**. Gli avvisi arrivati insieme stanno in
/// **pila**, il più recente in basso, vicino all'angolo: ciascuno ha le sue
/// azioni e il suo tempo, e nessuno cancella un altro che qualcuno sta ancora
/// leggendo o che ha un «Annulla» da premere. Un avviso identico a quello in
/// fondo non ne apre un altro: ne rinnova il contatore e il tempo.
///
/// **Non interrompe chi sta già guardando lo storico.** Il toast e la lista
/// occupano lo stesso angolo e dicono la stessa cosa: a pannello aperto la riga
/// nuova compare in cima da sé, e un rettangolo sopra la lista coprirebbe
/// proprio ciò che l'utente è andato a leggere.
function show(notice: Notice, actions: readonly NoticeAction[]): void {
  if (open || !hasDom()) return;
  const stack = toastStack();
  const newest = stack.querySelector<HTMLElement>(".toast:last-of-type");
  if (newest && actions.length === 0 && newest.dataset["text"] === notice.text && newest.dataset.tone === notice.tone) {
    const text = newest.querySelector(".toast-text");
    if (text) text.textContent = lineOf(notice);
    armToast(newest, notice);
    return;
  }
  const toast = document.createElement("div");
  toast.className = "toast";
  // Gli annunci passano dalla regione viva persistente (`announce`): una
  // regione inserita nel DOM insieme al suo testo molti lettori non la
  // leggono. Qui c'è ciò che si vede e i gesti.
  toast.dataset.tone = notice.tone;
  toast.dataset["text"] = notice.text;
  // Una regione con un nome e non una regione viva: chi usa un lettore di
  // schermo ci arriva dai punti di riferimento per usarne i gesti (Annulla,
  // Riprova), senza che il testo venga letto due volte.
  toast.setAttribute("role", "region");
  toast.setAttribute("aria-label", t("notices.toast"));
  const text = document.createElement("span");
  text.className = "toast-text";
  // Testo semplice: ciò che arriva da un provider non diventa mai markup
  // (stessa regola di `SearchHit.snippet` e `UiNode` non fidato).
  text.textContent = lineOf(notice);
  toast.append(text);
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = action.label;
    if (action.hint) {
      setTooltip(button, action.hint);
      button.setAttribute("aria-label", `${action.label}: ${action.hint}`);
    }
    button.addEventListener("click", () => {
      dismissToast(toast);
      void Promise.resolve(action.run()).catch((error: unknown) => notify(errorText(error), "guasto"));
    });
    toast.append(button);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.textContent = "×";
  close.setAttribute("aria-label", t("notices.dismiss"));
  setTooltip(close, t("notices.dismiss"));
  close.addEventListener("click", () => dismissToast(toast));
  toast.append(close);
  stack.appendChild(toast);
  enterSurface(toast);
  // Oltre il limite esce il più vecchio, senza gesto: ciò che diceva sta nello
  // storico, e il conto lo ricorda.
  const toasts = stack.querySelectorAll<HTMLElement>(".toast");
  for (let i = 0; i < toasts.length - TOAST_STACK_LIMIT; i += 1) {
    dismissToast(toasts[i]!);
    evicted += 1;
  }
  armToast(toast, notice);
  drawMore(stack);
}

/// Il contenitore della pila, creato alla prima necessità e tolto quando si
/// svuota. Una regione senza nome: la pila è solo geometria, il nome sta sui
/// toast.
function toastStack(): HTMLElement {
  const existing = document.getElementById("toasts");
  if (existing) return existing;
  const stack = document.createElement("div");
  stack.id = "toasts";
  stack.className = "toast-stack";
  document.body.appendChild(stack);
  return stack;
}

/// «+N altri»: i toast usciti dalla pila per fare posto, con un clic sullo
/// storico. Sta in fondo alla pila solo finché serve.
function drawMore(stack: HTMLElement): void {
  stack.querySelector(".toast-more")?.remove();
  if (evicted === 0) return;
  const more = document.createElement("button");
  more.type = "button";
  more.className = "toast-more";
  more.textContent = t("notices.more", { count: evicted });
  more.addEventListener("click", () => {
    evicted = 0;
    for (const toast of stack.querySelectorAll<HTMLElement>(".toast")) dismissToast(toast);
    openHistory(true);
  });
  stack.prepend(more);
}

/// Un'informazione se ne va dopo cinque secondi, ma non mentre la si sta
/// leggendo (puntatore o fuoco sopra); un guasto resta finché non lo si chiude:
/// sparire da solo è il modo in cui un errore non viene letto. Ogni toast ha il
/// suo tempo.
function armToast(toast: HTMLElement, notice: Notice): void {
  disarm(toast);
  if (notice.tone === "guasto") return;
  const arm = () => {
    disarm(toast);
    toastTimers.set(toast, window.setTimeout(() => dismissToast(toast), TOAST_DURATION_MS));
  };
  if (!toast.dataset["armed"]) {
    toast.dataset["armed"] = "1";
    toast.addEventListener("mouseenter", () => disarm(toast));
    toast.addEventListener("focusin", () => disarm(toast));
    toast.addEventListener("mouseleave", arm);
    toast.addEventListener("focusout", arm);
  }
  arm();
}

const toastTimers = new WeakMap<HTMLElement, number>();
/// Quanti toast sono usciti dalla pila per il limite, dall'ultima volta che era
/// vuota o che si è aperto lo storico.
let evicted = 0;

function disarm(toast: HTMLElement): void {
  const timer = toastTimers.get(toast);
  if (timer !== undefined) window.clearTimeout(timer);
  toastTimers.delete(toast);
}

/// Il toast se ne va subito; ne esce un'immagine ferma, in meno di un
/// battito, e gli altri scorrono al posto lasciato invece di saltarci.
function dismissToast(toast: HTMLElement): void {
  if (!toast.isConnected) return;
  disarm(toast);
  const stack = toast.parentElement;
  const others = stack ? [...stack.querySelectorAll<HTMLElement>(".toast")].filter((other) => other !== toast) : [];
  // L'immagine sta nel `body`, fuori dalla pila: resta sopra i fogli come la
  // pila da cui viene.
  toast.style.zIndex = "var(--z-toast)";
  exitGhost(toast, { duration: DURATION.swap, easing: "ease-in" });
  flip(others, () => {
    toast.remove();
    if (stack && stack.id === "toasts" && stack.querySelector(".toast") === null) {
      evicted = 0;
      stack.remove();
    }
  }, { scale: false });
}

/// La regione viva: una sola, creata una volta e mai sostituita, a cui cambia
/// soltanto il testo. È la forma che ogni lettore di schermo annuncia.
function announce(notice: Notice): void {
  if (!hasDom()) return;
  let live = document.getElementById("notify-live");
  if (!live) {
    live = document.createElement("div");
    live.id = "notify-live";
    live.className = "sr-only";
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    document.body.appendChild(live);
  }
  const region = live;
  // Svuotare e riscrivere al giro dopo: lo stesso testo due volte di fila è
  // un secondo avviso, e va annunciato di nuovo.
  region.textContent = "";
  window.setTimeout(() => {
    region.textContent = notice.tone === "guasto" ? `${t("notices.problem")}: ${lineOf(notice)}` : lineOf(notice);
  }, 30);
}
function redraw(): void {
  if (!hasDom()) return;
  const button = document.getElementById("notify-button");
  if (button) {
    // U65: il pulsante resta conteggio reale dei non letti — lo «stato
    // pertinente per problemi aperti» è il centro stesso, che resta finché i
    // problemi restano (storia + watcher), non un badge inventato. C05: il nome
    // resta nel controllo — `aria-label` ridice il conteggio, mai meno. A zero
    // resta il titolo nudo: «Avvisi 0» inventerebbe un conteggio che non c'è.
    const label =
      unreadCount > 0
        ? notifyText("notices.open_problems", { count: unreadCount })
        : t("notices.title");
    drawCountButton(button, "bell", label, unreadCount);
    setTooltip(button, label);
    button.classList.toggle("ha-novita", unreadCount > 0);
    button.setAttribute("aria-expanded", String(open));
  }

  const panel = document.getElementById("notify-panel");
  if (!panel) return;
  showPanel(panel, open);
  if (!open) return;

  const list = panel.querySelector("#notify-list");
  if (!(list instanceof HTMLElement)) return;
  list.replaceChildren();
  // U66: watcher assente = indicazione persistente in testa al centro, finché
  // il segnale resta. Non è un avviso raggruppato: rileggerla non la duplica,
  // chiuderla non si può — sparisce solo quando il rilevamento torna.
  if (watcherOff) list.appendChild(watcherNote());
  if (history.length === 0 && !watcherOff) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = t("notices.none");
    list.appendChild(empty);
    return;
  }
  for (const notice of history) {
    list.appendChild(noticeRow(notice));
  }
}

/// La riga watcher: testo esistente, tooltip sullo stesso fatto (C05: il nome
/// resta nel controllo). Solo hook esistenti (`muted`): nessuna nuova classe.
function watcherNote(): HTMLLIElement {
  const note = document.createElement("li");
  note.className = "muted";
  const text = document.createElement("span");
  text.textContent = notifyText("notices.watcher_off");
  note.appendChild(text);
  const reopen = reopenVault;
  if (reopen) {
    // Il gesto che il testo nomina, accanto al testo.
    const button = document.createElement("button");
    button.type = "button";
    button.className = "toast-action";
    button.textContent = t("notices.reopen");
    setTooltip(button, t("notices.reopen.hint"));
    button.addEventListener("click", () => {
      void reopen().catch((error: unknown) => notify(errorText(error), "guasto"));
    });
    note.appendChild(button);
  }
  return note;
}
/// Una riga dello storico con dettagli senza console (U65): testo, ora, e i
/// dettagli già nella riga — `title` ridice il testo integrale quando è
/// ellissato, mai la console. Solo hook esistenti.
function noticeRow(notice: Notice): HTMLLIElement {
  const row = document.createElement("li");
  row.dataset.tone = notice.tone;
  const text = document.createElement("span");
  text.className = "notify-testo";
  text.textContent = lineOf(notice);
  setTooltip(text, lineOf(notice));
  const time = document.createElement("span");
  time.className = "muted notify-ora";
  // Nella lingua che la shell parla, non in quella del sistema; i secondi
  // nel suggerimento.
  time.textContent = relativeTime(notice.when);
  setTooltip(time, exactTime(notice.when));
  row.append(text, time);
  return row;
}

/// Accende il centro notifiche: il pulsante nella barra di stato e il pannello.
/// Da chiamare una volta sola, dal punto di montaggio.
export function mountNotifications(lifetime: Lifetime): void {
  const button = document.getElementById("notify-button");
  if (button) lifetime.listen(button, "click", () => openHistory());
  const clear = document.getElementById("notify-clear");
  if (clear) lifetime.listen(clear, "click", () => clearHistory());
  const close = document.getElementById("notify-close");
  if (close) lifetime.listen(close, "click", () => openHistory(false));
  const panel = document.getElementById("notify-panel");
  if (panel)
    lifetime.listen(panel, "keydown", (e: KeyboardEvent) => {
      // C03/C04 come il centro attività: Escape chiude e riporta al trigger,
      // nessun trap parallelo — il centro è un drawer non modale.
      if (e.key === "Escape") {
        e.preventDefault();
        openHistory(false);
      }
    });
  // Come per il centro attività: il pulsante porta un conteggio, quindi non lo
  // può scrivere `applicaStringhe` — e il testo **degli avvisi** resta com'era,
  // perché un avviso è già stato detto e ridirlo in un'altra lingua vorrebbe
  // dire riscrivere la storia di ciò che è successo.
  lifetime.add(onLanguage(redraw));
  redraw();
}

/// Apre o chiude un centro, con il suo moto se cambia: `redraw` passa di qui
/// a ogni avviso, e un centro già aperto non rientra.
export function showPanel(panel: HTMLElement, open: boolean): void {
  if (open === !panel.hidden) return;
  if (open) {
    panel.hidden = false;
    enterSurface(panel);
  } else {
    exitSurface(panel, () => {
      panel.hidden = true;
    });
  }
}

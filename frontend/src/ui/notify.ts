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
// disegno ha smesso di essere solo scritta.
//
// [decisione 0013]: ../../../docs/decisions/0013-elenco-delle-capacita.md
// [decisione 0052]: ../../../docs/decisions/0052-cio-che-va-storto-e-un-evento.md
// [decisione 0080]: ../../../docs/decisions/0080-un-guasto-si-dice-a-chi-sta-lavorando.md

import { onLingua, t } from "../i18n/strings";
import type { KernelEvent } from "../host/contract";
import { onEvent } from "../state/kernel";

/// Quanto **tono** ha un avviso. Due e non cinque: chi disegna deve poterli
/// distinguere a colpo d'occhio, e una scala di severità che nessuno sa dove
/// tagliare finisce con tutto sullo stesso gradino.
export type Tono = "info" | "guasto";

/// Un avviso nello storico: il testo, il tono, quando, e **quante volte**.
export interface Avviso {
  testo: string;
  tono: Tono;
  /// L'ultima volta che è successo, in millisecondi (`Date.now`).
  quando: number;
  /// Quante volte di fila. Uno è il caso normale; sopra uno la riga mostra
  /// «×N».
  volte: number;
}

/// Quanti avvisi si ricordano. Uno storico illimitato è una perdita di memoria
/// travestita da funzionalità; cinquanta coprono una sessione di lavoro
/// difficile e stanno in una schermata di scorrimento.
export const MEMORIA = 50;

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
export function raccogli(storico: Avviso[], nuovo: Avviso): Avviso[] {
  const ultimo = storico[0];
  if (ultimo && ultimo.testo === nuovo.testo && ultimo.tono === nuovo.tono) {
    const unito: Avviso = {
      ...ultimo,
      quando: nuovo.quando,
      volte: ultimo.volte + 1,
    };
    return [unito, ...storico.slice(1)];
  }
  return [nuovo, ...storico].slice(0, MEMORIA);
}

/// Come una riga si legge: il testo, e quante volte se è più di una.
export function rigaDi(avviso: Avviso): string {
  return avviso.volte > 1 ? `${avviso.testo} ×${avviso.volte}` : avviso.testo;
}

// --- da qui in giù è disegno ------------------------------------------------

/// Per quanto resta a galla un avviso prima di scendere nello storico. Non è la
/// sua vita: è quanto interrompe.
const IN_VISTA_MS = 5000;

let storico: Avviso[] = [];
/// Quanti ne sono arrivati da quando lo storico è stato guardato l'ultima
/// volta. È il numero sul pulsante, ed è l'unica ragione per cui «aprire» il
/// centro è un fatto che vale la pena registrare.
let daLeggere = 0;
let aperto = false;

/// Dice un messaggio all'utente. È la porta di tutta la shell, e resta una
/// riga: chi chiama non sa che esistono uno storico e un raggruppamento.
export function notify(message: string, tono: Tono = "info"): void {
  storico = raccogli(storico, { testo: message, tono, quando: Date.now(), volte: 1 });
  if (!aperto) daLeggere += 1;
  mostra(storico[0]);
  ridisegna();
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
export function ascoltaIGuasti(): void {
  onEvent("trouble", (e) => {
    const avviso = avvisoDiGuasto(e);
    notify(avviso.testo, avviso.tono);
  });
}

/// Come un guasto del kernel si legge: il testo e il tono.
///
/// È una funzione pura, per la stessa ragione di [`raccogli`]: è la sola parte
/// di questo collegamento che possa essere sbagliata in un modo che guardando
/// l'app non si vede — un `subject` assente che diventa la stringa `"null"`, o
/// una severità che finisce tutta sullo stesso tono.
export function avvisoDiGuasto(e: Extract<KernelEvent, { type: "trouble" }>): {
  testo: string;
  tono: Tono;
} {
  const reason = e.error.message;
  return {
    testo: e.subject
      ? t("trouble.about", { doc: e.subject, reason })
      : t("trouble.vault", { reason }),
    tono: e.severity === "failure" ? "guasto" : "info",
  };
}

/// Ciò che è stato detto, dal più recente. Serve a chi disegna lo storico, e ai
/// test che guardano il canale invece del DOM.
export function avvisiRecenti(): Avviso[] {
  return storico;
}

/// Il pannello dello storico si apre e si chiude da qui: è anche il momento in
/// cui il contatore dei non letti torna a zero.
export function apriStorico(apri = !aperto): void {
  aperto = apri;
  if (aperto) daLeggere = 0;
  ridisegna();
}

export function svuotaStorico(): void {
  storico = [];
  daLeggere = 0;
  ridisegna();
}

/// C'è un documento su cui disegnare?
///
/// La riga che questo modulo prometteva da sempre — *«se la shell non li ha (un
/// test, un host che monta solo un pezzo) non succede niente»* — e che era vera
/// per il pannello e falsa per tutto il resto: `mostra` e `ridisegna` toccavano
/// `document` senza chiederselo. Finché i chiamanti erano pannelli non si vedeva,
/// perché un pannello un DOM ce l'ha per definizione. Col §20.4 la porta è aperta
/// anche a `state/store.ts` e `state/kernel.ts`, che DOM non ne hanno e che nei
/// test girano in Node: il primo avviso da lì è diventato un rifiuto non gestito.
///
/// È il difetto di questa seduta preso dal lato di chi ascolta — un canale che
/// smette di funzionare in silenzio proprio mentre gli si racconta un guasto —
/// e l'ha trovato un test che non guardava questo file.
function esisteUnDom(): boolean {
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
function mostra(avviso: Avviso): void {
  if (aperto || !esisteUnDom()) return;
  const vecchio = document.getElementById("toast");
  if (vecchio) vecchio.remove();
  const toast = document.createElement("div");
  toast.id = "toast";
  // Il toast è **l'unica** cosa che compare senza che l'utente l'abbia chiesta,
  // e sparisce da sola dopo qualche secondo: chi non guarda lo schermo non ha
  // nessun altro modo di saperlo. `status` e non `alert` per la stessa ragione
  // per cui non ruba il fuoco — informa senza interrompere (§10.3), e `alert`
  // taglierebbe la parola a metà frase.
  toast.setAttribute("role", "status");
  toast.dataset.tono = avviso.tono;
  // Testo semplice: ciò che arriva da un provider non diventa mai markup
  // (stessa regola di `SearchHit.snippet` e `UiNode` non fidato).
  toast.textContent = rigaDi(avviso);
  document.body.appendChild(toast);
  window.setTimeout(() => {
    if (document.getElementById("toast") === toast) toast.remove();
  }, IN_VISTA_MS);
}

/// Il pulsante nella barra di stato e il pannello dello storico. Se la shell
/// non li ha (un test, un host che monta solo un pezzo) non succede niente:
/// `notify` continua a funzionare, perché il canale non dipende dal suo
/// disegno.
function ridisegna(): void {
  if (!esisteUnDom()) return;
  const pulsante = document.getElementById("notify-button");
  if (pulsante) {
    pulsante.textContent =
      daLeggere > 0 ? t("notices.count", { count: daLeggere }) : t("notices.title");
    pulsante.classList.toggle("ha-novita", daLeggere > 0);
    pulsante.setAttribute("aria-expanded", String(aperto));
  }

  const pannello = document.getElementById("notify-panel");
  if (!pannello) return;
  pannello.hidden = !aperto;
  if (!aperto) return;

  const lista = pannello.querySelector("#notify-list");
  if (!(lista instanceof HTMLElement)) return;
  lista.replaceChildren();
  if (storico.length === 0) {
    const vuoto = document.createElement("li");
    vuoto.className = "muted";
    vuoto.textContent = t("notices.none");
    lista.appendChild(vuoto);
    return;
  }
  for (const avviso of storico) {
    const riga = document.createElement("li");
    riga.dataset.tono = avviso.tono;
    const testo = document.createElement("span");
    testo.className = "notify-testo";
    testo.textContent = rigaDi(avviso);
    const ora = document.createElement("span");
    ora.className = "muted notify-ora";
    ora.textContent = new Date(avviso.quando).toLocaleTimeString();
    riga.append(testo, ora);
    lista.appendChild(riga);
  }
}

/// Accende il centro notifiche: il pulsante nella barra di stato e il pannello.
/// Da chiamare una volta sola, dal punto di montaggio.
export function mountNotifications(): void {
  document.getElementById("notify-button")?.addEventListener("click", () => apriStorico());
  document.getElementById("notify-clear")?.addEventListener("click", () => svuotaStorico());
  document.getElementById("notify-close")?.addEventListener("click", () => apriStorico(false));
  // Come per il centro attività: il pulsante porta un conteggio, quindi non lo
  // può scrivere `applicaStringhe` — e il testo **degli avvisi** resta com'era,
  // perché un avviso è già stato detto e ridirlo in un'altra lingua vorrebbe
  // dire riscrivere la storia di ciò che è successo.
  onLingua(ridisegna);
  ridisegna();
}

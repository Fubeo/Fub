// **Il centro notifiche** (§10.3): un messaggio all'utente che non chiede una
// risposta — l'esito di un comando, un lavoro finito, un errore che non blocca.
//
// Era un toast solo, che il messaggio dopo cancellava. Bastava finché i
// chiamanti erano tre; con il §20.4 (che porta qui i quattordici avvisi oggi
// scritti in `console`) e con l'esito dei lavori lunghi, un messaggio che
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
// Ciò che **non** è ancora qui, ed è di un'altra voce: la sorgente non è un
// evento del contratto. La [decisione 0013] ha stabilito che `notify` sarà una
// variante di `Event` — *ciò che si limita a informare è un evento* — e il
// cliente lo porta il §20.2, insieme al tipo dell'errore (§12.2). Da questa
// parte il canale c'è già: `avvisa` è una funzione sola, e il giorno che quella
// variante arriva le si attacca il router degli eventi invece di venti
// chiamanti.
//
// [decisione 0013]: ../../../docs/decisions/0013-elenco-delle-capacita.md

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

/// Il toast: l'avviso **mentre succede**. Sovrascrive il precedente di
/// proposito — chi guarda lo schermo legge l'ultimo, e ciò che ha perso sta
/// nello storico, che è la ragione per cui lo storico esiste.
///
/// **Non interrompe chi sta già guardando lo storico.** Il toast e la lista
/// occupano lo stesso angolo e dicono la stessa cosa: a pannello aperto la riga
/// nuova compare in cima da sé, e un rettangolo sopra la lista coprirebbe
/// proprio ciò che l'utente è andato a leggere.
function mostra(avviso: Avviso): void {
  if (aperto) return;
  const vecchio = document.getElementById("toast");
  if (vecchio) vecchio.remove();
  const toast = document.createElement("div");
  toast.id = "toast";
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
  const pulsante = document.getElementById("notify-button");
  if (pulsante) {
    pulsante.textContent = daLeggere > 0 ? `Avvisi ${daLeggere}` : "Avvisi";
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
    vuoto.textContent = "Nessun avviso.";
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
  ridisegna();
}

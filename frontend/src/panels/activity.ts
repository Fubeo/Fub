// **Il centro attività** (§10.3): cosa sta girando, a che punto è, e come si
// ferma.
//
// Il lavoro lungo aveva tutto tranne il posto in cui si vede. Un job si chiede
// (`spawn_job`), qualcuno lo esegue (il pool della [decisione 0032]), si può
// annullare (`Host::cancel_job`, che finora usavano solo i presidi) e adesso
// racconta a che punto è (la [decisione 0035]) — ma per l'utente un export di
// duemila note era indistinguibile da un'app ferma, e il pulsante per fermarlo
// non esisteva da nessuna parte.
//
// # Due strade per la stessa verità, e non è un doppione
//
// Le righe le muovono gli **eventi** — `job_started` le fa comparire,
// `job_progress` le sposta, `job_done` le toglie — e questa è la strada normale:
// costa niente e arriva subito. La **query** (`lavoriInCorso`) è l'altra, e
// serve quando il filo si è interrotto: all'apertura del vault (i job possono
// essere partiti prima che questa finestra esistesse) e dopo un `overflow`, che
// nel contratto vuol dire esattamente *richiedi*.
//
// Senza la seconda, la prima non potrebbe esistere così com'è: `job_started` e
// `job_progress` sono **recuperabili** per contratto, cioè i freni del canale
// (decisione 0034) li possono buttare — ed è quello che rende frenabile il
// canale più fitto che il contratto abbia. Un centro attività che non sapesse
// riconciliare trasformerebbe quel freno in una riga che resta lì per sempre.
//
// [decisione 0032]: ../../../docs/decisions/0032-il-runner-dei-job.md
// [decisione 0035]: ../../../docs/decisions/0035-il-lavoro-lungo-si-racconta.md
import { api } from "../host/ipc";
import { lavoriInCorso } from "../host/query";
import type { JobProgress, JobStatus, KernelNotice } from "../host/contract";
import { onAnyEvent } from "../state/kernel";
import { $ } from "../ui/dom";
import { notify } from "../ui/notify";
import type { Tono } from "../ui/notify";
import { errorText } from "../host/errors";

/// Una riga del centro attività. È `JobStatus` senza i campi che una riga non
/// disegna: chi arriva da un evento non conosce né il plugin né l'istante, e
/// inventarli per far tornare un tipo vorrebbe dire mostrarli.
export interface Lavoro {
  id: string;
  job: string;
  progress: JobProgress | null;
}

/// Cosa un evento fa all'elenco: come è rimasto, e se **va richiesto da capo**.
///
/// Il secondo campo è la metà che non si può dedurre guardando il primo: un
/// progresso per un job che non conosciamo e un `overflow` lasciano l'elenco in
/// uno stato che sembra buono e non lo è.
export interface Esito {
  lavori: Lavoro[];
  riconcilia: boolean;
}

/// La regola del centro attività, e l'unica cosa che qui vale la pena provare:
/// **come un evento cambia l'elenco**. Pura, perché il resto di questo modulo è
/// DOM e perché una regola che si prova solo aprendo l'app non la prova nessuno.
export function applica(lavori: Lavoro[], notice: KernelNotice): Esito {
  const fermo = { lavori, riconcilia: false };
  switch (notice.event.type) {
    case "job_started": {
      const { id, job } = notice.event;
      if (lavori.some((l) => l.id === id)) return fermo;
      return { lavori: [...lavori, { id, job, progress: null }], riconcilia: false };
    }
    case "job_progress": {
      const { id, progress } = notice.event;
      const dentro = lavori.some((l) => l.id === id);
      // Un progresso per un lavoro che non abbiamo: l'avvio è stato buttato da
      // uno dei due freni, oppure questa finestra è arrivata dopo. Il nome del
      // job questo evento non lo porta — e inventarne uno («lavoro 7») sarebbe
      // una riga che mente — quindi la si chiede.
      if (!dentro) return { lavori, riconcilia: true };
      return {
        lavori: lavori.map((l) => (l.id === id ? { ...l, progress } : l)),
        riconcilia: false,
      };
    }
    case "job_done": {
      const { id } = notice.event;
      return { lavori: lavori.filter((l) => l.id !== id), riconcilia: false };
    }
    // «Riconcilia da zero», che per questo elenco vuol dire richiederlo: è la
    // ragione per cui la query esiste.
    case "overflow":
      return { lavori, riconcilia: true };
    // Un vault che si apre o si chiude porta via i suoi lavori: sono di quel
    // vault, e questa shell ne guarda uno alla volta.
    case "vault_opened":
    case "vault_closed":
      return { lavori: [], riconcilia: notice.event.type === "vault_opened" };
    default:
      return fermo;
  }
}

/// Cosa mostra la riga di un lavoro: ciò che il job racconta di sé, o il nome
/// del suo entry point finché non racconta niente.
export function etichettaDi(lavoro: Lavoro): string {
  return lavoro.progress?.label ?? lavoro.job;
}

/// Cosa dire all'utente quando un lavoro finisce, o `null` se non c'è niente da
/// dire.
///
/// **L'esito si annuncia sempre**, riuscito o no, e la ragione è che la riga
/// che sparisce non è un messaggio: chi ha chiesto un export e ha guardato
/// altrove non avrebbe modo di sapere che è finito, né tantomeno che non è
/// finito. Un lavoro lungo nasce sempre da qualcosa che l'utente ha chiesto —
/// un comando, un'automazione — quindi non c'è la famiglia di job silenziosi
/// per cui questa regola sarebbe rumore. Il giorno che ci fosse, è qui che si
/// mette la differenza.
export function avvisoDi(notice: KernelNotice): { testo: string; tono: Tono } | null {
  if (notice.event.type !== "job_done") return null;
  const { job, result } = notice.event;
  // `result` attraversa l'IPC come un `Result` serializzato da serde: `Ok` è
  // ciò che il job ha reso, `Err` è un `PluginError`, che è (ancora) prosa
  // composta — §12.2 gli darà una forma, e a quel punto questa riga la userà.
  const errore = (result as { Err?: unknown } | null)?.Err;
  return errore === undefined
    ? { testo: `«${job}» è finito.`, tono: "info" }
    : { testo: `«${job}» non è riuscito: ${descrivi(errore)}`, tono: "guasto" };
}

/// Un `PluginError` in una riga. Finché il §12.2 non gli dà una forma, ciò che
/// arriva è una variante con dentro una stringa: si prende la stringa, e se non
/// c'è si mostra il nome della variante — che è comunque più di «errore».
function descrivi(errore: unknown): string {
  if (typeof errore === "string") return errore;
  if (errore && typeof errore === "object") {
    const voci = Object.entries(errore as Record<string, unknown>);
    const [nome, dettaglio] = voci[0] ?? ["errore sconosciuto", undefined];
    return typeof dettaglio === "string" && dettaglio.length > 0 ? dettaglio : nome;
  }
  return String(errore);
}

// --- da qui in giù è disegno ------------------------------------------------

let lavori: Lavoro[] = [];
let aperto = false;

export function mountActivity(): void {
  $("#activity-button").addEventListener("click", () => {
    aperto = !aperto;
    // Aprire è il secondo momento in cui conviene riconciliare: costa una query
    // e toglie di mezzo ogni deriva accumulata mentre nessuno guardava.
    if (aperto) void richiedi();
    else ridisegna();
  });
  document.getElementById("activity-close")?.addEventListener("click", () => {
    aperto = false;
    ridisegna();
  });

  // Si ascolta **tutto** e si sceglie dentro `applica`: la regola sta in una
  // funzione sola, e questo pannello non si iscrive a cinque tipi che poi
  // qualcuno dimentica di allineare al contratto.
  onAnyEvent((notice) => {
    const esito = applica(lavori, notice);
    lavori = esito.lavori;
    ridisegna();
    if (esito.riconcilia) void richiedi();
    // L'esito di un lavoro lungo è l'unico dei tre eventi del ciclo che l'utente
    // deve **leggere**: gli altri due li racconta la riga.
    const avviso = avvisoDi(notice);
    if (avviso) notify(avviso.testo, avviso.tono);
  });

  ridisegna();
}

/// Richiede l'elenco al kernel. Un vault che non c'è o che non risponde lascia
/// l'elenco com'era: un centro attività vuoto per un errore direbbe «non sta
/// girando niente», che è la bugia peggiore che questo pannello possa dire.
async function richiedi(): Promise<void> {
  try {
    lavori = (await lavoriInCorso()).map(daStatus);
  } catch {
    // Non è un caso da mostrare: la riconciliazione riparte al prossimo evento.
  }
  ridisegna();
}

function daStatus(status: JobStatus): Lavoro {
  return { id: status.id, job: status.job, progress: status.progress };
}

function ridisegna(): void {
  const pulsante = document.getElementById("activity-button");
  if (pulsante) {
    pulsante.textContent = lavori.length > 0 ? `Attività ${lavori.length}` : "Attività";
    pulsante.classList.toggle("in-corso", lavori.length > 0);
    pulsante.setAttribute("aria-expanded", String(aperto));
  }

  const pannello = document.getElementById("activity-panel");
  if (!pannello) return;
  pannello.hidden = !aperto;
  if (!aperto) return;

  const lista = pannello.querySelector("#activity-list");
  if (!(lista instanceof HTMLElement)) return;
  lista.replaceChildren();
  if (lavori.length === 0) {
    const vuoto = document.createElement("li");
    vuoto.className = "muted";
    vuoto.textContent = "Nessun lavoro in corso.";
    lista.appendChild(vuoto);
    return;
  }
  for (const lavoro of lavori) {
    lista.appendChild(riga(lavoro));
  }
}

function riga(lavoro: Lavoro): HTMLLIElement {
  const el = document.createElement("li");
  el.className = "activity-row";

  const testo = document.createElement("span");
  testo.className = "activity-label";
  testo.textContent = etichettaDi(lavoro);
  testo.title = `${lavoro.job} · ${lavoro.id}`;

  // Una barra **indeterminata** quando il totale non c'è: un `progress` senza
  // valore è l'attesa che non sa quanto dura, ed è ciò che il contratto dice
  // con `total: null` — disegnarne una piena a metà sarebbe inventare un dato.
  const barra = document.createElement("progress");
  if (lavoro.progress && lavoro.progress.total !== null) {
    barra.max = lavoro.progress.total;
    barra.value = lavoro.progress.done;
  }

  const ferma = document.createElement("button");
  ferma.className = "link-button";
  ferma.textContent = "Annulla";
  ferma.title = "Ferma questo lavoro";
  ferma.addEventListener("click", () => void annulla(lavoro));

  el.append(testo, barra, ferma);
  return el;
}

/// Fermare è alzare una bandiera, e da lì in poi l'host del job gli dice di no
/// (decisione 0032). La riga **non** si toglie qui: la toglie il `job_done` che
/// arriva, perché un lavoro annullato ha comunque un esito — e toglierla prima
/// racconterebbe che si è fermato, quando invece si sta fermando.
async function annulla(lavoro: Lavoro): Promise<void> {
  try {
    await api.cancelJob(lavoro.id);
  } catch (e) {
    notify(`Non sono riuscito a fermare «${etichettaDi(lavoro)}»: ${errorText(e)}`, "guasto");
  }
}

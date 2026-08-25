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
// [decisione 0032]: ../../../docs/decisions/0183-composizione-host-kernel.md
// [decisione 0035]: ../../../docs/decisions/0184-eventi-accodati-e-job.md
import { api } from "../host/ipc";
import { activeJobs } from "../host/query";
import type { JobProgress, JobStatus, KernelNotice } from "../host/contract";
import { onAnyEvent } from "../state/kernel";
import { $ } from "../ui/dom";
import { notify } from "../ui/notify";
import type { Tone } from "../ui/notify";
import { errorText } from "../host/errors";
import { onLanguage, t } from "../i18n/strings";
import { setTooltip } from "../ui/tooltip";

/// Una riga del centro attività. È `JobStatus` senza i campi che una riga non
/// disegna: chi arriva da un evento non conosce né il plugin né l'istante, e
/// inventarli per far tornare un tipo vorrebbe dire mostrarli.
export interface JobRow {
  id: string;
  job: string;
  progress: JobProgress | null;
}

/// Cosa un evento fa all'elenco: come è rimasto, e se **va richiesto da capo**.
///
/// Il secondo campo è la metà che non si può dedurre guardando il primo: un
/// progresso per un job che non conosciamo e un `overflow` lasciano l'elenco in
/// uno stato che sembra buono e non lo è.
export interface Result {
  jobs: JobRow[];
  reconcile: boolean;
}

/// La regola del centro attività, e l'unica cosa che qui vale la pena provare:
/// **come un evento cambia l'elenco**. Pura, perché il resto di questo modulo è
/// DOM e perché una regola che si prova solo aprendo l'app non la prova nessuno.
export function apply(jobs: JobRow[], notice: KernelNotice): Result {
  const unchanged = { jobs, reconcile: false };
  switch (notice.event.type) {
    case "job_started": {
      const { id, job } = notice.event;
      if (jobs.some((l) => l.id === id)) return unchanged;
      return { jobs: [...jobs, { id, job, progress: null }], reconcile: false };
    }
    case "job_progress": {
      const { id, progress } = notice.event;
      const inside = jobs.some((l) => l.id === id);
      // Un progresso per un lavoro che non abbiamo: l'avvio è stato buttato da
      // uno dei due freni, oppure questa finestra è arrivata dopo. Il nome del
      // job questo evento non lo porta — e inventarne uno («lavoro 7») sarebbe
      // una riga che mente — quindi la si chiede.
      if (!inside) return { jobs, reconcile: true };
      return {
        jobs: jobs.map((l) => (l.id === id ? { ...l, progress } : l)),
        reconcile: false,
      };
    }
    case "job_done": {
      const { id } = notice.event;
      return { jobs: jobs.filter((l) => l.id !== id), reconcile: false };
    }
    // «Riconcilia da zero», che per questo elenco vuol dire richiederlo: è la
    // ragione per cui la query esiste.
    case "overflow":
      return { jobs, reconcile: true };
    // Un vault che si apre o si chiude porta via i suoi lavori: sono di quel
    // vault, e questa shell ne guarda uno alla volta.
    case "vault_opened":
    case "vault_closed":
      return { jobs: [], reconcile: notice.event.type === "vault_opened" };
    default:
      return unchanged;
  }
}

/// Cosa mostra la riga di un lavoro: ciò che il job racconta di sé, o il nome
/// del suo entry point finché non racconta niente.
export function labelOf(job: JobRow): string {
  return job.progress?.label ?? job.job;
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
export function noticeOf(notice: KernelNotice): { text: string; tone: Tone } | null {
  if (notice.event.type !== "job_done") return null;
  const { job, result } = notice.event;
  // `result` attraversa l'IPC come un `Result` serializzato da serde: `Ok` è
  // ciò che il job ha reso, `Err` è un `PluginError`, che è (ancora) prosa
  // composta — §12.2 gli darà una forma, e a quel punto questa riga la userà.
  const error = (result as { Err?: unknown } | null)?.Err;
  return error === undefined
    ? { text: t("activity.finished", { job }), tone: "info" }
    : { text: t("activity.failed", { job, reason: describe(error) }), tone: "guasto" };
}

/// Un `PluginError` in una riga. Finché il §12.2 non gli dà una forma, ciò che
/// arriva è una variante con dentro una stringa: si prende la stringa, e se non
/// c'è si mostra il nome della variante — che è comunque più di «errore».
function describe(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const entries = Object.entries(error as Record<string, unknown>);
    const [name, detail] = entries[0] ?? [t("activity.unknown_error"), undefined];
    return typeof detail === "string" && detail.length > 0 ? detail : name;
  }
  return String(error);
}

// --- da qui in giù è disegno ------------------------------------------------

let jobs: JobRow[] = [];
let open = false;

export function mountActivity(): void {
  $("#activity-button").addEventListener("click", () => {
    open = !open;
    // Aprire è il secondo momento in cui conviene riconciliare: costa una query
    // e toglie di mezzo ogni deriva accumulata mentre nessuno guardava.
    if (open) void request();
    else redraw();
  });
  document.getElementById("activity-close")?.addEventListener("click", () => {
    open = false;
    redraw();
  });

  // Si ascolta **tutto** e si sceglie dentro `applica`: la regola sta in una
  // funzione sola, e questo pannello non si iscrive a cinque tipi che poi
  // qualcuno dimentica di allineare al contratto.
  onAnyEvent((eventNotice) => {
    const result = apply(jobs, eventNotice);
    jobs = result.jobs;
    redraw();
    if (result.reconcile) void request();
    // L'esito di un lavoro lungo è l'unico dei tre eventi del ciclo che l'utente
    // deve **leggere**: gli altri due li racconta la riga.
    const resultNotice = noticeOf(eventNotice);
    if (resultNotice) notify(resultNotice.text, resultNotice.tone);
  });

  // La lingua che cambia rifà il pulsante e le righe: il pulsante porta un
  // conteggio, quindi il testo fermo di `index.html` non lo può possedere.
  onLanguage(redraw);

  redraw();
}

/// Richiede l'elenco al kernel. Un vault che non c'è o che non risponde lascia
/// l'elenco com'era: un centro attività vuoto per un errore direbbe «non sta
/// girando niente», che è la bugia peggiore che questo pannello possa dire.
async function request(): Promise<void> {
  try {
    jobs = (await activeJobs()).map(fromStatus);
  } catch {
    // Non è un caso da mostrare: la riconciliazione riparte al prossimo evento.
  }
  redraw();
}

function fromStatus(status: JobStatus): JobRow {
  return { id: status.id, job: status.job, progress: status.progress };
}

function redraw(): void {
  const button = document.getElementById("activity-button");
  if (button) {
    button.textContent =
      jobs.length > 0 ? t("activity.count", { count: jobs.length }) : t("activity.title");
    button.classList.toggle("in-corso", jobs.length > 0);
    button.setAttribute("aria-expanded", String(open));
  }

  const panel = document.getElementById("activity-panel");
  if (!panel) return;
  panel.hidden = !open;
  if (!open) return;

  const list = panel.querySelector("#activity-list");
  if (!(list instanceof HTMLElement)) return;
  list.replaceChildren();
  if (jobs.length === 0) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = t("activity.none");
    list.appendChild(empty);
    return;
  }
  for (const job of jobs) {
    list.appendChild(row(job));
  }
}

function row(job: JobRow): HTMLLIElement {
  const el = document.createElement("li");
  el.className = "activity-row";

  const text = document.createElement("span");
  text.className = "activity-label";
  text.textContent = labelOf(job);
  setTooltip(text, `${job.job} · ${job.id}`);

  // Una barra **indeterminata** quando il totale non c'è: un `progress` senza
  // valore è l'attesa che non sa quanto dura, ed è ciò che il contratto dice
  // con `total: null` — disegnarne una piena a metà sarebbe inventare un dato.
  const bar = document.createElement("progress");
  if (job.progress && job.progress.total !== null) {
    bar.max = job.progress.total;
    bar.value = job.progress.done;
  }

  const stopButton = document.createElement("button");
  stopButton.className = "link-button";
  stopButton.textContent = t("app.cancel");
  setTooltip(stopButton, t("activity.stop"));
  stopButton.addEventListener("click", () => void cancel(job));

  el.append(text, bar, stopButton);
  return el;
}

/// Fermare è alzare una bandiera, e da lì in poi l'host del job gli dice di no
/// (decisione 0032). La riga **non** si toglie qui: la toglie il `job_done` che
/// arriva, perché un lavoro annullato ha comunque un esito — e toglierla prima
/// racconterebbe che si è fermato, quando invece si sta fermando.
async function cancel(job: JobRow): Promise<void> {
  try {
    await api.cancelJob(job.id);
  } catch (e) {
    notify(t("activity.stop_failed", { job: labelOf(job), reason: errorText(e) }), "guasto");
  }
}

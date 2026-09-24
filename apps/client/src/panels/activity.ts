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
import { asPluginError, errorText } from "../host/errors";
import { onLanguage, t } from "../i18n/strings";
import type { Lifetime } from "../ui/lifetime";
import { setTooltip } from "../ui/tooltip";
import { drawCountButton } from "../ui/icons";
import { focusableElements } from "../ui/a11y";

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
    // vault, e questa shell ne guarda uno alla volta. Il dubbio della query
    // fallita è del vault di prima: col vault nuovo non si eredita né lista
    // né stale (I04/R07-R08) — la verità la ridà la query sull'apertura.
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
  // ciò che il job ha reso, `Err` è un `PluginError` col `kind` del §12.2 —
  // che resta l'unica domanda su cui ramificare, mai una sottostringa.
  // L'esito annullato è un esito finale come gli altri: il job si è fermato
  // perché lo si è chiesto, e la riga che sparisce lo dice — non resta appesa.
  const error = (result as { Err?: unknown } | null)?.Err;
  if (error === undefined) return { text: t("activity.finished", { job }), tone: "info" };
  const outcome = asPluginError(error);
  if (outcome?.kind === "cancelled") return { text: t("activity.finished", { job }), tone: "info" };
  return { text: t("activity.failed", { job, reason: describeOutcome(error) }), tone: "guasto" };
}

/// Un esito fallito in una riga: il `message` del `PluginError` quando c'è, la
/// specie del `kind` quando il messaggio è vuoto, mai una chiave nuda. Gli esiti
/// storici fuori contratto (la vecchia forma `{Nome: dettaglio}`, una stringa
/// nuda, un valore qualunque) restano leggibili per non perdere il fatto, ma
/// sono il ripiego di un formato che non esiste più — non il ramo che decide.
function describeOutcome(error: unknown): string {
  const plugin = asPluginError(error);
  if (plugin) return plugin.message.trim() !== "" ? plugin.message : plugin.kind;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const entries = Object.entries(error as Record<string, unknown>);
    const [name, detail] = entries[0] ?? [t("activity.unknown_error"), undefined];
    return typeof detail === "string" && detail.length > 0 ? detail : name;
  }
  return String(error);
}

export type ExportContent =
  | { kind: "bytes"; value: readonly number[] }
  | { kind: "delivered"; value: string };
export interface ExportArtifact {
  path: string;
  media_type: string;
  content: ExportContent;
}

/** Only typed successful transfer results can offer a native Save action.
 * Delivered content is a receipt, never a second promise to write bytes. */
export function exportArtifacts(notice: KernelNotice): ExportArtifact[] | null {
  if (notice.event.type !== "job_done" ||
      !["import.transfer", "export.run"].includes(notice.event.job)) return null;
  const result = notice.event.result;
  if (!result || typeof result !== "object" || !("Ok" in result)) return null;
  const report = result.Ok;
  if (!report || typeof report !== "object" || !("artifacts" in report)) return null;
  const artifacts = report.artifacts;
  if (!Array.isArray(artifacts) || artifacts.length > 128) return null;
  let total = 0;
  const parsed: ExportArtifact[] = [];
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== "object") return null;
    const value = artifact as Record<string, unknown>;
    const content = value.content;
    if (typeof value.path !== "string" || !value.path ||
        value.path.startsWith("/") || value.path.includes("\\") ||
        value.path.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
        typeof value.media_type !== "string" ||
        !/^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(value.media_type) ||
        !content || typeof content !== "object") return null;
    const body = content as Record<string, unknown>;
    if (body.kind === "bytes" && Array.isArray(body.value) &&
        body.value.every((byte: unknown) => Number.isInteger(byte) && (byte as number) >= 0 && (byte as number) <= 255)) {
      total += body.value.length;
      if (total > 32 * 1024 * 1024) return null;
      parsed.push({ path: value.path, media_type: value.media_type, content: { kind: "bytes", value: body.value } });
    } else if (body.kind === "delivered" && typeof body.value === "string" && /^(0|[1-9][0-9]*)$/.test(body.value)) {
      parsed.push({ path: value.path, media_type: value.media_type, content: { kind: "delivered", value: body.value } });
    } else return null;
  }
  return parsed;
}

interface FinishedArtifact extends ExportArtifact {
  state: "ready" | "saving" | "saved" | "failed";
  detail: string;
}
interface FinishedExport {
  id: string;
  artifacts: FinishedArtifact[];
}
// --- da qui in giù è disegno ------------------------------------------------

let jobs: JobRow[] = [];
let open = false;
/// `true` = l'ultima query `jobs` è fallita: la lista sotto è quella di prima
/// e va letta come non aggiornata, mai come «non gira niente».
let stale = false;
/// Causa dell'ultimo fallimento, per lo stale esplicito (U64).
let staleReason = "";
/// Quante `request()` sono partite: vince l'ultima arrivata, le vecchie non
/// toccano né lista né stale — una risposta vecchia non può riaprire né
/// svuotare ciò che una nuova ha già detto (I04).
let generation = 0;
/// Chi ha aperto per ultimo il pannello, per riportargli il fuoco (C04).
let opener: HTMLElement | null = null;
let finished: FinishedExport[] = [];
let activityEpoch = 0;

/// Testi di stato con chiavi dedicate (U64): `activity.stale` non riusa
/// `activity.none` — «nessun lavoro» e «lista non aggiornata» sono due fatti
/// diversi, e comporli dalla stessa chiave li confonderebbe.
type P8Key = "activity.stale" | "activity.retry" | "activity.status" | "activity.progress";
function activityText(key: P8Key, args: Record<string, string | number> = {}): string {
  switch (key) {
    case "activity.stale":
      return t("activity.stale", { reason: String(args["reason"] ?? t("activity.title")) });
    case "activity.retry":
      return t("activity.retry", args);
    case "activity.status":
      return typeof args["state"] === "number" && args["state"] > 0
        ? t("activity.count", { count: args["state"] })
        : t("activity.title", args);
    case "activity.progress":
      return t("activity.progress", { done: args["done"] ?? 0, total: args["total"] ?? 0 });
  }
}
export function mountActivity(lifetime: Lifetime): void {
  const epoch = ++activityEpoch;
  lifetime.add(() => {
    if (epoch !== activityEpoch) return;
    activityEpoch++;
    finished = [];
    open = false;
  });
  lifetime.listen($("#activity-button"), "click", () => {
    if (open) closeActivity();
    else {
      if (document.activeElement instanceof HTMLElement) opener = document.activeElement;
      open = true;
      // Aprire è il secondo momento in cui conviene riconciliare: costa una query
      // e toglie di mezzo ogni deriva accumulata mentre nessuno guardava.
      void request();
      redraw();
      panelFirstFocusable()?.focus();
    }
  });
  const close = document.getElementById("activity-close");
  if (close) {
    lifetime.listen(close, "click", () => closeActivity());
  }
  const panel = document.getElementById("activity-panel");
  if (panel) {
    lifetime.listen(panel, "keydown", (e: KeyboardEvent) => {
      // C03: Escape chiude il pannello; nessun trap parallelo — il pannello è un
      // drawer non modale, quindi non intrappola il tab (trapFocus resta alle
      // modali: palette, ricerca, impostazioni). C04: il fuoco torna al trigger.
      if (e.key === "Escape") {
        e.preventDefault();
        closeActivity();
      }
    });
  }

  // Si ascolta **tutto** e si sceglie dentro `applica`: la regola sta in una
  // funzione sola, e questo pannello non si iscrive a cinque tipi che poi
  // qualcuno dimentica di allineare al contratto.
  lifetime.add(
    onAnyEvent((eventNotice) => {
      // Il dubbio della query fallita è del vault di prima: cambio vault non
      // eredita né lista né stale (I04/R07-R08) — la verità la ridà la query.
      if (eventNotice.event.type === "vault_opened" || eventNotice.event.type === "vault_closed") {
        stale = false;
        staleReason = "";
        finished = [];
      }
      const result = apply(jobs, eventNotice);
      jobs = result.jobs;
      const completed = eventNotice.event;
      if (completed.type === "job_done") {
        const artifacts = exportArtifacts(eventNotice);
        if (artifacts && artifacts.length > 0 &&
            !finished.some((report) => report.id === completed.id)) {
          finished.push({
            id: completed.id,
            artifacts: artifacts.map((artifact) => ({ ...artifact, state: "ready", detail: "" })),
          });
          // Keep at most two completed exports; byte-bearing reports are
          // bounded by the producer's 32 MiB cap and released on vault close.
          if (finished.length > 2) finished.shift();
        } else if (completed.job === "export.run" &&
            artifacts === null && completed.result &&
            typeof completed.result === "object" &&
            "Ok" in completed.result) {
          notify(t("activity.artifact_invalid"), "guasto");
        }
      }
      // Un evento autorevole chiude la finestra di dubbio: la lista torna quella
      // che il kernel racconta adesso, non quella dell'ultima query fallita.
      if (result.reconcile) {
        redraw();
        void request();
      } else {
        stale = false;
        staleReason = "";
        redraw();
      }
      // L'esito di un lavoro lungo è l'unico dei tre eventi del ciclo che l'utente
      // deve **leggere**: gli altri due li racconta la riga.
      const resultNotice = noticeOf(eventNotice);
      if (resultNotice) notify(resultNotice.text, resultNotice.tone);
    }),
  );
  // La lingua che cambia rifà il pulsante e le righe: il pulsante porta un
  // conteggio, quindi il testo fermo di `index.html` non lo può possedere.
  lifetime.add(onLanguage(redraw));

  redraw();
}

function closeActivity(): void {
  open = false;
  redraw();
  if (opener?.isConnected) opener.focus();
  opener = null;
}

function panelFirstFocusable(): HTMLElement | null {
  const panel = document.getElementById("activity-panel");
  if (!panel) return null;
  return focusableElements(panel)[0] ?? panel;
}

/// Richiede l'elenco al kernel. Un vault che non c'è o che non risponde lascia
/// l'elenco com'era: un centro attività vuoto per un errore direbbe «non sta
/// girando niente», che è la bugia peggiore che questo pannello possa dire.
/// La lista conservata si segnala come non aggiornata con retry (R05/U64/S17):
/// il recupero sta sull'evento/overflow che la richiama, o sul Riprova.
async function request(): Promise<void> {
  const mine = ++generation;
  try {
    const fresh = (await activeJobs()).map(fromStatus);
    if (mine !== generation) return;
    jobs = fresh;
    stale = false;
    staleReason = "";
  } catch (e) {
    if (mine !== generation) return;
    // Conserva la lista precedente e alza stale: la riconciliazione riparte al
    // prossimo evento/overflow o al Riprova — mai un retry loop nuovo.
    stale = true;
    staleReason = errorText(e);
  }
  redraw();
}

function fromStatus(status: JobStatus): JobRow {
  return { id: status.id, job: status.job, progress: status.progress };
}

function redraw(): void {
  const button = document.getElementById("activity-button");
  if (button) {
    // U64: titolo/stato reale — il conteggio quando c'è, mai uno stato inventato
    // quando la lista è non aggiornata: quello lo dice il banner nel pannello.
    const label = activityText("activity.status", { state: jobs.length });
    drawCountButton(button, "activity", label, jobs.length);
    button.classList.toggle("in-corso", jobs.length > 0);
    button.setAttribute("aria-expanded", String(open));
    setTooltip(button, label);
  }

  const panel = document.getElementById("activity-panel");
  if (!panel) return;
  panel.hidden = !open;
  if (!open) return;

  const list = panel.querySelector("#activity-list");
  if (!(list instanceof HTMLElement)) return;
  list.replaceChildren();
  // R05/U64/S17: query fallita = lista precedente + stale esplicito con retry.
  // Nessun-job e lista-non-aggiornata restano due righe diverse: la prima dice
  // che non gira niente, la seconda che non lo si sa più.
  if (stale) list.appendChild(staleNote());
  if (jobs.length === 0 && finished.length === 0) {
    const empty = document.createElement("li");
    empty.className = "muted";
    empty.textContent = t("activity.none");
    list.appendChild(empty);
  }
  for (const job of jobs) list.appendChild(row(job));
  for (const report of finished) {
    for (const artifact of report.artifacts) {
      const item = document.createElement("li");
      item.className = "activity-row";
      const label = document.createElement("span");
      label.className = "activity-label";
      label.textContent = artifact.path;
      item.append(label);
      const status = document.createElement("span");
      status.setAttribute("role", "status");
      if (artifact.state === "saved") {
        status.textContent = t("activity.artifact_saved", { path: artifact.detail });
      } else if (artifact.content.kind === "delivered") {
        status.textContent = t("activity.artifact_delivered", { size: artifact.content.value });
      } else {
        status.textContent = artifact.state === "saving" ? t("activity.artifact_saving") :
          artifact.state === "failed" ? t("activity.artifact_failed", { reason: artifact.detail }) :
            artifact.detail || t("activity.artifact_ready");
        const save = document.createElement("button");
        save.type = "button";
        save.className = "link-button";
        save.textContent = t("activity.artifact_save");
        save.disabled = artifact.state === "saving";
        save.addEventListener("click", () => void persistArtifact(report, artifact));
        item.append(save);
      }
      item.append(status);
      list.append(item);
    }
  }
}

async function persistArtifact(report: FinishedExport, artifact: FinishedArtifact): Promise<void> {
  if (artifact.state === "saving" || artifact.content.kind !== "bytes" ||
      !finished.includes(report)) return;
  const bytes = artifact.content.value;
  const epoch = activityEpoch;
  artifact.state = "saving";
  artifact.detail = "";
  redraw();
  try {
    const basename = artifact.path.slice(artifact.path.lastIndexOf("/") + 1);
    const outcome = await api.saveArtifact(basename, artifact.media_type, bytes);
    if (epoch !== activityEpoch || !finished.includes(report)) return;
    if (outcome.status === "saved") {
      artifact.state = "saved";
      artifact.detail = outcome.path;
      artifact.content = { kind: "delivered", value: String(bytes.length) };
    } else {
      artifact.state = "ready";
      artifact.detail = t("activity.artifact_cancelled");
    }
  } catch (error) {
    if (epoch !== activityEpoch || !finished.includes(report)) return;
    artifact.state = "failed";
    artifact.detail = errorText(error);
  }
  redraw();
}

/// La riga «non aggiornata»: testo + tooltip sullo stesso fatto, azione Riprova
/// che richiama la query — su evento/overflow, non in loop. Solo hook esistenti
/// (`muted`, `link-button`): nessuna nuova classe senza P8 (ownership sua).
function staleNote(): HTMLLIElement {
  const note = document.createElement("li");
  note.className = "muted";
  const label = document.createElement("span");
  const text = activityText("activity.stale", { reason: staleReason || t("activity.title") });
  label.textContent = text;
  setTooltip(label, text);
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "link-button";
  retry.textContent = activityText("activity.retry");
  retry.addEventListener("click", () => void request());
  note.append(label, document.createTextNode(" "), retry);
  return note;
}

function row(job: JobRow): HTMLLIElement {
  const el = document.createElement("li");
  el.className = "activity-row";

  const text = document.createElement("span");
  text.className = "activity-label";
  text.textContent = labelOf(job);
  setTooltip(text, `${job.job} · ${job.id}`);

  // U64: progresso reale o indeterminato — mai una barra a metà inventata, mai
  // una percentuale composta da testo (l'età del job non è un dato mostrato).
  // Indeterminato = `progress` nativo senza valore: il browser disegna l'attesa.
  const bar = document.createElement("progress");
  if (job.progress && job.progress.total !== null) {
    bar.max = job.progress.total;
    bar.value = job.progress.done;
    const state = document.createElement("span");
    state.className = "muted";
    state.textContent = activityText("activity.progress", {
      done: job.progress.done,
      total: job.progress.total,
    });
    setTooltip(state, activityText("activity.progress", {
      done: job.progress.done,
      total: job.progress.total,
    }));
    el.append(text, bar, state, stopButton(job));
  } else {
    el.append(text, bar, stopButton(job));
  }
  return el;
}

// U64: annullamento solo se supportato. Il contratto non distingue i job
// annullabili — `cancel_job` accetta qualunque id e risponde di sì anche per
// un job appena finito — quindi il pulsante c'è sempre, e il «non
// supportato» si legge nell'esito: `unknown_job` è il job che non c'è più,
// e la riga la toglie il `job_done` che arriva, non questo errore.
function stopButton(job: JobRow): HTMLButtonElement {
  const stop = document.createElement("button");
  stop.type = "button";
  stop.className = "link-button";
  stop.textContent = t("app.cancel");
  setTooltip(stop, t("activity.stop"));
  stop.addEventListener("click", () => void cancel(job));
  return stop;
}
/// Fermare è alzare una bandiera, e da lì in poi l'host del job gli dice di no
/// (decisione 0032). La riga **non** si toglie qui: la toglie il `job_done` che
/// arriva, perché un lavoro annullato ha comunque un esito — e toglierla prima
/// racconterebbe che si è fermato, quando invece si sta fermando.
async function cancel(job: JobRow): Promise<void> {
  try {
    await api.cancelJob(job.id);
  } catch (e) {
    // C06: l'errore resta tipizzato fino alla presentazione — `kind` sceglie il
    // ramo, `message` la frase. `unknown_job` non toglie la riga: il job che non
    // c'è più sparisce col suo `job_done`, e un errore qui non è la prova che
    // sia finito.
    const plugin = asPluginError(e);
    if (plugin?.kind === "unknown_job") return;
    notify(t("activity.stop_failed", { job: labelOf(job), reason: errorText(e) }), "guasto");
  }
}

// Centro sync P16: stato reale, pausa, versioni, conflitti, selezione.
//
// UI concreta su query_index/invoke_command/list_views esistenti + provider
// SyncViews/SyncCommands (crates/fub-services/src/sync/, registrati da Main).
// Nessun import @tauri-apps: solo host/ipc, host/query, ui/*, state/*, i18n.
//
// Classi definitive per Main/FrontendIntegration:
// - SyncCenterView: id view "sync.status" (LeftSidebar), render via
//   SyncViews::render_view (albero UiNode montato da mountDeclaredViews).
// - SyncCommands: sync.push_now / sync.pull_now / sync.pause / sync.resume /
//   sync.retry_conflict / sync.restore_version (invoke_command esistente).
// - Tipi: SyncStatusEntry{doc_id,state,local_counter:string,server_counter:string,
//   detail}, SyncVersionRow{doc_id,version:string,hash,ts_ms:number,vv_text},
//   SyncReport{pushed,pulled,applied,conflicts,pending:number,
//   details:SyncDocDetail[<=50],truncated_details:boolean}.
//   Contatori/versioni u64 come STRINGHE (regola confine oltre 2^53);
//   ts_ms resta number (aritmetica new Date, mai oltre 2^53).
import { api } from "../../host/ipc";
import { activeJobs,
settings,
vaultStatus, } from "../../host/query";
import type { JobStatus,
KernelNotice,
SettingEntry, } from "../../host/contract";
import { onEvent } from "../../state/kernel";
import { notify } from "../../ui/notify";
import { refreshOn, registerPanel, unregisterPanel } from "../../ui/panel-host";
import { isPanelVisible } from "../sidebar";
import { t } from "../../i18n/strings";
import { type Lifetime } from "../../ui/lifetime";

/** Stato per file/vault: contatori u64 come stringhe (regola confine). */
export interface SyncStatusEntry {
  doc_id: string;
  state: "in_sync" | "pending" | "conflict" | "error";
  local_counter: string;
  server_counter: string;
  detail: string | null;
}

/** Riga di log depurata (mai segreti: redazione lato host). */
export interface SyncLogLine {
  ts_ms: number;
  level: "info" | "warn" | "error";
  message: string;
}

/** Versione remota: version u64 come stringa, ts_ms resta number. */
export interface SyncVersionRow {
  doc_id: string;
  version: string;
  hash: string;
  ts_ms: number;
  vv_text: string;
}

/** Dettaglio per-doc del report (cap 50, vedi truncated_details). */
export interface SyncDocDetail {
  doc_id: string;
  outcome:
    | { kind: "applied" }
    | { kind: "conflict"; reason: string }
    | { kind: "skipped"; why: string };
  vv_text: string;
}

/** Report sync_once: summary + dettagli per --verbose. */
export interface SyncReport {
  pushed: number;
  pulled: number;
  applied: number;
  conflicts: number;
  pending: number;
  details: SyncDocDetail[];
  truncated_details: boolean;
}

/** Rende lo stato per file/vault come righe testo (puro, per test e shell). */
export function renderSyncStatus(entries: SyncStatusEntry[]): string[] {
  return entries.map((e) => {
    const counters = `${e.local_counter}/${e.server_counter}`;
    const tail = e.detail ? ` — ${e.detail}` : "";
    return `${e.doc_id} [${e.state} ${counters}]${tail}`;
  });
}

/** Rende il log depurato; righe con segreti sospetti marcate `[redacted?]`. */
export function renderSyncLog(lines: SyncLogLine[]): string[] {
  const suspect = /(password|token|secret|bearer|wrap_b64|ciphertext_b64|nonce_b64)\s*=/i;
  return lines.map((l) => {
    const flag = suspect.test(l.message) ? " [redacted?]" : "";
    return `${new Date(l.ts_ms).toISOString()} ${l.level}: ${l.message}${flag}`;
  });
}

/** Rende una riga versione/restore. */
export function syncVersionRow(row: SyncVersionRow): string {
  return `v${row.version} ${row.doc_id} ${row.hash} @${row.vv_text}`;
}

/** Etichetta pausa/ripresa (policy `sync.paused` + stato operativo). */
export function pauseLabel(paused: boolean): string {
  return paused ? "resume" : "pause";
}

const PANEL_ID = "shell:sync";
const SYNC_PAUSED_KEY = "sync.paused";

interface CenterState {
  paused: boolean;
  jobs: JobStatus[];
  status: string;
}

const center: CenterState = { paused: false, jobs: [], status: "" };

async function readPausedPolicy(): Promise<boolean> {
  const rows: SettingEntry[] = await settings().catch(() => []);
  const row = rows.find((r) => r.spec.key === SYNC_PAUSED_KEY);
  return row?.value === true;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`sync center: #${id} assente`);
  return node as T;
}

/** Monta il centro sync: stato vault, code, pausa, conflitti, selezione. */
export function mountSyncCenter(lifetime: Lifetime): void {
  const root = el<HTMLElement>("sync-center");
  const render = async (_notice?: KernelNotice): Promise<void> => {
    const status = await vaultStatus().catch(() => null);
    const jobs = await activeJobs().catch(() => []);
    const paused = await readPausedPolicy().catch(() => center.paused);
    center.paused = paused;
    center.jobs = jobs;
    const syncJobs = jobs.filter((j) => j.job.includes("sync"));
    const head =
      paused
        ? t("sync.paused_banner")
        : syncJobs.length > 0
          ? t("sync.running", { count: syncJobs.length })
          : t("sync.idle");
    const vault = status
      ? t("sync.vault_state", {
          watching: status.watching ? "on" : "off",
          failures: status.sync_failures,
        })
      : t("sync.no_vault");
    root.innerHTML = "";
    const h = document.createElement("h2");
    h.textContent = t("sync.title");
    const p = document.createElement("p");
    p.textContent = `${head} — ${vault}`;
    if (status?.last_sync_error) {
      const err = document.createElement("p");
      err.textContent = status.last_sync_error;
      err.className = "sync-error";
      root.append(h, p, err);
    } else {
      root.append(h, p);
    }
    const row = document.createElement("div");
    row.className = "sync-actions";
    const toggle = document.createElement("button");
    toggle.textContent = paused ? t("sync.resume") : t("sync.pause");
    toggle.addEventListener("click", () => void togglePaused());
    const push = document.createElement("button");
    push.textContent = t("sync.push_now");
    push.addEventListener("click", () => void runCommand("sync.push_now"));
    const pull = document.createElement("button");
    pull.textContent = t("sync.pull_now");
    pull.addEventListener("click", () => void runCommand("sync.pull_now"));
    row.append(toggle, push, pull);
    root.append(row);
    const sel = document.createElement("p");
    sel.textContent = t("sync.exclude_hint");
    root.append(sel);
  };
  registerPanel({
    id: PANEL_ID,
    title: "Sync",
    placement: "left_sidebar",
    refresh: refreshOn("index_updated", "batch_ended", "job_done"),
    visible: () => isPanelVisible("search") || isPanelVisible("files"),
    render,
  });
  lifetime.add(() => unregisterPanel(PANEL_ID));
  lifetime.add(onEvent("job_done", () => void render()));
  lifetime.add(onEvent("job_started", () => void render()));
  void render();
}

async function togglePaused(): Promise<void> {
  const next = !center.paused;
  try {
    await api.setSetting(SYNC_PAUSED_KEY, next);
    try {
      await api.invokeCommand(next ? "sync.pause" : "sync.resume", {});
    } catch {
      // Il comando è del coordinatore quando c'è; il setting è la policy
      // persistita e basta comunque.
    }
    center.paused = next;
    notify(t(next ? "sync.paused_set" : "sync.resumed_set"));
  } catch (e) {
    notify(t("sync.pause_failed", { reason: String(e) }), "guasto");
  }
}

async function runCommand(id: string): Promise<void> {
  try {
    const outcome = await api.invokeCommand(id, {});
    center.status = outcome.notify ?? "";
    notify(center.status || t("sync.command_ok", { command: id }));
  } catch (e) {
    notify(t("sync.command_failed", { command: id, reason: String(e) }), "guasto");
  }
}

/** Chiavi i18n consumate da questo centro (registrate da FrontendIntegration). */
export const SYNC_I18N_KEYS = [
  "sync.title",
  "sync.paused_banner",
  "sync.running",
  "sync.idle",
  "sync.no_vault",
  "sync.vault_state",
  "sync.pause",
  "sync.resume",
  "sync.push_now",
  "sync.pull_now",
  "sync.exclude_hint",
  "sync.paused_set",
  "sync.resumed_set",
  "sync.pause_failed",
  "sync.command_ok",
  "sync.command_failed",
] as const;

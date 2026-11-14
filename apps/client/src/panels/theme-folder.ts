// Installare un tema da una cartella, e leggere perché un tema è rifiutato
// (PA T36). Due pezzi di Aspetto che vivono accanto a «Temi installati»:
//
// - il bottone «Installa da cartella…», che c'è solo con la modalità
//   sviluppatore accesa. La regola vera sta nell'host
//   (`Host::install_theme_from_folder`): qui il bottone nascosto è solo il
//   modo di non offrire un gesto che l'host rifiuterebbe. La cartella si legge
//   prima senza scrivere (`checkThemeFolder`) e passa dal cancello del
//   catalogo (`vetThemeFolder`): un tema che la shell rifiuterebbe non arriva
//   mai nella cartella dei temi, e l'installazione chiede gli stessi byte;
// - la diagnosi: una riga per motivo, coi motivi così come li scrive chi
//   rifiuta (`validateThemeBundle` del loader, o l'host) divisi in campi, mai
//   riscritti. Un tentativo ha un esito solo: la diagnosi e un avviso che
//   dice la stessa cosa.
import { api } from "../host/ipc";
import { pickFolder } from "../host/dialog";
import { asPluginError, errorText, isErrorKind } from "../host/errors";
import type { PluginError, ThemeFolderCheck, ThemeFolderInstall } from "../host/contract";
import { openDialog } from "../kit/dialog";
import { writeClipboardText } from "../platform/clipboard";
import { plural, resolvedLanguage, t } from "../i18n/strings";
import {
  currentThemeId,
  reloadThemeCatalog,
  themeCatalog,
  themeRejections,
  vetThemeFolder,
  type Theme,
} from "../theme/theme";
import { notify } from "../ui/notify";
import type { Lifetime } from "../ui/lifetime";

/// La chiave della modalità sviluppatore (`fub_host::settings::DEVELOPER_MODE`).
export const DEVELOPER_MODE_KEY = "developer.mode";

/// Un motivo diviso nei suoi campi. `where` è `riga:colonna`, `null` quando il
/// motivo non ne ha; `file` è `null` quando il motivo non nomina un file.
export interface DiagnosisRow {
  readonly file: string | null;
  readonly where: string | null;
  readonly code: string;
  readonly why: string;
}

/// Un rifiuto da mostrare: chi, quando, e i motivi già divisi. `text` sono i
/// motivi così come sono arrivati, per «Copia la diagnosi».
export interface Diagnosis {
  readonly name: string;
  readonly at: number;
  readonly rows: readonly DiagnosisRow[];
  readonly text: readonly string[];
  /// Il tentativo voleva sostituire un tema installato, che resta com'era.
  readonly kept?: boolean;
}

/// I file che un canale del loader descrive. `foglio` e `contrasto` parlano
/// del foglio della luce controllata; un canale senza file resta senza.
function channelFile(channel: string, light: Theme | null): string | null {
  switch (channel) {
    case "manifest":
    case "caratteri":
      return "manifest.json";
    case "pelle":
      return "skin.css";
    case "foglio":
    case "contrasto":
      return light ? `sheet-${light}.css` : null;
    default:
      return null;
  }
}

/// `pelle: selector-hook (12:3): hook .x non dichiarato` e i suoi fratelli
/// (`foglio`, `pelle-tema`…): il canale, il codice della violazione, la
/// posizione, il perché.
const VIOLATION = /^([^:]+): ([a-z][a-z0-9-]*) \((\d+):(\d+)\): ([\s\S]*)$/;

/**
 * Divide i motivi di `validateThemeBundle` nei loro campi, senza riscriverli:
 * il canale (`pelle`, `foglio`, `manifest`…) dice il file, una violazione CSS
 * porta il suo codice e la sua posizione, ogni altro motivo ha per codice il
 * canale e per perché il resto della frase.
 */
export function diagnosisRows(reasons: readonly string[], light: Theme | null): DiagnosisRow[] {
  return reasons.map((reason) => {
    const violation = VIOLATION.exec(reason);
    if (violation) {
      const [, channel, code, line, column, why] = violation;
      return { file: channelFile(channel!, light), where: `${line}:${column}`, code: code!, why: why! };
    }
    const colon = reason.indexOf(": ");
    if (colon < 0) return { file: null, where: null, code: "", why: reason };
    const channel = reason.slice(0, colon);
    return { file: channelFile(channel, light), where: null, code: channel, why: reason.slice(colon + 2) };
  });
}

/// I file del fascio che un messaggio dell'host può nominare.
const BUNDLE_FILE = /\b(manifest\.json|skin\.css|sheet-(?:light|dark)\.css)\b/;

/// Il rifiuto dell'host all'installazione: una riga, col tipo dell'errore per
/// codice e il messaggio per perché. Il file c'è quando il messaggio lo nomina.
export function refusalRow(error: PluginError): DiagnosisRow {
  return { file: BUNDLE_FILE.exec(error.message)?.[1] ?? null, where: null, code: error.kind, why: error.message };
}

/// L'ultimo rifiuto di un'installazione da cartella (del cancello della shell
/// o dell'host). Lo toglie il tentativo dopo.
let refusal: Diagnosis | null = null;

/// Tutti i rifiuti da mostrare in Aspetto: quello dell'host all'ultima
/// installazione, poi quelli del loader all'ultima lettura del catalogo.
export function themeDiagnoses(): Diagnosis[] {
  const loader = themeRejections().map((rejection) => ({
    name: rejection.name,
    at: rejection.at,
    rows: diagnosisRows(rejection.reasons, rejection.light),
    text: rejection.reasons,
  }));
  return refusal ? [refusal, ...loader] : loader;
}

/// Solo per i test: dimentica il rifiuto dell'host.
export function forgetThemeRefusal(): void {
  refusal = null;
}

function folderName(source: string): string {
  return source.split(/[\\/]/).filter(Boolean).pop() ?? source;
}

function clock(at: number): string {
  return new Date(at).toLocaleTimeString(resolvedLanguage(), { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function span(className: string, text: string, tag: "span" | "code" = "span"): HTMLElement {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

/**
 * Il blocco di una diagnosi: il titolo coi motivi contati, l'ora del
 * tentativo, una riga per motivo e «Copia la diagnosi». Nasce con
 * `role="alert"`: c'è solo quando un tema è rifiutato.
 */
export function renderDiagnosis(diagnosis: Diagnosis): HTMLElement {
  const block = document.createElement("div");
  block.className = "setting-row setting-block tema-diagnosi";
  block.setAttribute("role", "alert");
  const text = document.createElement("div");
  text.className = "setting-text";
  const title = document.createElement("div");
  title.className = "setting-label";
  title.setAttribute("role", "heading");
  title.setAttribute("aria-level", "4");
  const count = diagnosis.rows.length;
  title.textContent = plural(count, "settings.themes.diagnosis.title.one", "settings.themes.diagnosis.title", {
    name: diagnosis.name,
  });
  const when = document.createElement("div");
  when.className = "muted";
  when.textContent = t(diagnosis.kept ? "settings.themes.diagnosis.when_kept" : "settings.themes.diagnosis.when", {
    time: clock(diagnosis.at),
  });
  text.append(title, when);

  const list = document.createElement("ol");
  list.className = "tema-diagnosi-lista";
  for (const row of diagnosis.rows) {
    const item = document.createElement("li");
    item.className = "tema-diagnosi-riga";
    item.append(
      span("tema-diagnosi-file", row.file ?? "—"),
      span("tema-diagnosi-dove", row.where ?? "—"),
      span("tema-diagnosi-codice", row.code, "code"),
      span("tema-diagnosi-perche", row.why),
    );
    list.append(item);
  }

  const actions = document.createElement("div");
  actions.className = "settings-actions";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "settings-btn";
  copy.textContent = t("settings.themes.diagnosis.copy");
  copy.addEventListener("click", () => {
    const report = [title.textContent ?? "", when.textContent ?? "", ...diagnosis.text.map((line) => `- ${line}`)].join("\n");
    void writeClipboardText(report).then(
      () => notify(t("settings.themes.diagnosis.copied"), "info"),
      (error: unknown) => notify(t("settings.themes.diagnosis.copy_failed", { reason: errorText(error) }), "guasto"),
    );
  });
  actions.append(copy);
  block.append(text, list, actions);
  return block;
}

/// Ciò che il bottone chiede al pannello che lo ospita.
export interface ThemeFolderHost {
  /// La vita del pannello: chiuderla chiude le finestre aperte da qui.
  readonly lifetime: Lifetime;
  /// Ridisegna Aspetto: il catalogo e la diagnosi sono cambiati.
  readonly rerender: () => Promise<void>;
}

/// Ridisegna Aspetto dopo che il disco è cambiato: il catalogo si rilegge
/// (un tema nuovo entra, o resta fuori coi motivi del loader) e quello in uso,
/// se è stato sostituito, si rimonta.
async function settle(host: ThemeFolderHost): Promise<void> {
  await reloadThemeCatalog().catch(() => []);
  await host.rerender();
}

/// Un rifiuto della cartella: la diagnosi in Aspetto e un avviso solo, che
/// dice la stessa cosa (chi, quanti motivi, dove leggerli).
async function showRefusal(host: ThemeFolderHost, diagnosis: Diagnosis): Promise<void> {
  refusal = diagnosis;
  const count = diagnosis.rows.length;
  notify(plural(count, "settings.themes.refused.one", "settings.themes.refused", { name: diagnosis.name }), "guasto");
  await host.rerender();
}

/// Se un tema con questo id è già installato: un rifiuto allora lo lascia
/// com'era, e la diagnosi lo dice.
async function installedAlready(id: string | null): Promise<boolean> {
  if (id === null) return false;
  const installed = await themeCatalog().catch(() => []);
  return installed.some((theme) => theme.manifest.id === id);
}

/// L'errore di una chiamata all'host: la modalità spenta si dice per quello
/// che è, la cartella cambiata dopo il controllo anche (niente è scritto);
/// ogni altro rifiuto della cartella diventa la diagnosi.
async function refused(host: ThemeFolderHost, source: string, error: unknown, id: string | null): Promise<void> {
  if (isErrorKind(error, "permission_denied")) {
    refusal = null;
    notify(t("settings.themes.developer_off"), "guasto");
    await host.rerender();
    return;
  }
  if (isErrorKind(error, "conflict")) {
    refusal = null;
    notify(t("settings.themes.changed", { folder: source }), "guasto");
    await host.rerender();
    return;
  }
  const plugin = asPluginError(error);
  if (!plugin) {
    notify(t("settings.themes.install_failed", { reason: errorText(error) }), "guasto");
    return;
  }
  await showRefusal(host, {
    name: folderName(source),
    at: Date.now(),
    rows: [refusalRow(plugin)],
    text: [plugin.message],
    kept: await installedAlready(id),
  });
}

/// Il cancello del catalogo sulla cartella letta: i motivi di ogni luce
/// rifiutata, divisi in righe, senza ripetere quelli che due luci hanno in
/// comune (la pelle è una sola). `null` se il catalogo la prenderebbe.
async function vetted(check: ThemeFolderCheck): Promise<Diagnosis | null> {
  const rejected = vetThemeFolder(check);
  if (rejected.length === 0) return null;
  const seen = new Set<string>();
  const rows: DiagnosisRow[] = [];
  const text: string[] = [];
  for (const { light, reasons } of rejected) {
    diagnosisRows(reasons, light).forEach((row, index) => {
      const key = `${row.file}|${row.where}|${row.code}|${row.why}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(row);
      text.push(reasons[index]!);
    });
  }
  return {
    name: check.manifest.name,
    at: Date.now(),
    rows,
    text,
    kept: await installedAlready(check.manifest.id),
  };
}

async function askReplace(
  host: ThemeFolderHost,
  source: string,
  outcome: Extract<ThemeFolderInstall, { outcome: "collision" }>,
): Promise<boolean> {
  const body = outcome.installed_version === null
    ? t("settings.themes.replace.body_unknown", { folder: source, id: outcome.id, version: outcome.version })
    : t("settings.themes.replace.body", {
        folder: source,
        id: outcome.id,
        version: outcome.version,
        installed: outcome.installed_version,
      });
  const inUse = currentThemeId() === outcome.id;
  const dialog = openDialog<boolean>({
    title: t("settings.themes.replace.title", { name: outcome.name }),
    description: inUse ? `${body} ${t("settings.themes.replace.in_use")}` : body,
    actions: [
      { id: "cancel", label: t("app.cancel"), value: false },
      { id: "replace", label: t("settings.themes.replace.ok"), kind: "primary", value: true, autofocus: true },
    ],
    dismissValue: false,
    lifetime: host.lifetime,
  });
  return dialog.result;
}

function tellReplaceFailed(
  host: ThemeFolderHost,
  source: string,
  outcome: Extract<ThemeFolderInstall, { outcome: "replace_failed" }>,
  wasInUse: boolean,
): Promise<void> {
  const body = t("settings.themes.replace_failed.body", { reason: errorText(outcome.error), folder: source });
  const dialog = openDialog<void>({
    title: t("settings.themes.replace_failed.title", { name: outcome.name }),
    description: wasInUse ? `${body} ${t("settings.themes.replace_failed.in_use")}` : body,
    actions: [{ id: "ok", label: t("settings.themes.replace_failed.ok"), kind: "primary", value: undefined }],
    dismissValue: undefined,
    lifetime: host.lifetime,
  });
  // Non è una domanda: dice che cosa è successo, e va letta.
  dialog.element.setAttribute("role", "alertdialog");
  return dialog.result;
}

/**
 * Il giro intero dell'installazione da cartella: la scelta, l'host, la
 * collisione con «Sostituisci», l'esito. Ogni chiamata all'host rilegge la
 * modalità sviluppatore: spenta nel frattempo, l'host rifiuta e lo si dice.
 */
export async function installThemeFolder(host: ThemeFolderHost): Promise<void> {
  const source = await pickFolder(t("settings.themes.install_pick"));
  if (source === null || host.lifetime.closed) return;
  refusal = null;
  let check: ThemeFolderCheck;
  try {
    check = await api.checkThemeFolder(source);
  } catch (error) {
    if (!host.lifetime.closed) await refused(host, source, error, null);
    return;
  }
  if (host.lifetime.closed) return;
  const rejection = await vetted(check);
  if (host.lifetime.closed) return;
  if (rejection) {
    await showRefusal(host, rejection);
    return;
  }
  const id = check.manifest.id;
  let outcome: ThemeFolderInstall;
  try {
    outcome = await api.installThemeFromFolder(source, false, check.digest);
  } catch (error) {
    if (!host.lifetime.closed) await refused(host, source, error, id);
    return;
  }
  if (host.lifetime.closed) return;
  if (outcome.outcome === "collision") {
    if (!(await askReplace(host, source, outcome)) || host.lifetime.closed) return;
    try {
      outcome = await api.installThemeFromFolder(source, true, check.digest);
    } catch (error) {
      if (!host.lifetime.closed) await refused(host, source, error, id);
      return;
    }
  }
  const wasInUse = currentThemeId() === outcome.id;
  await settle(host);
  if (outcome.outcome === "replace_failed") {
    await tellReplaceFailed(host, source, outcome, wasInUse);
    return;
  }
  if (outcome.outcome === "installed") {
    notify(
      outcome.replaced
        ? t("settings.themes.replaced", { name: outcome.name, version: outcome.version })
        : t("settings.themes.installed", { name: outcome.name }),
      "info",
    );
  }
}

/// Il bottone «Installa da cartella…» del blocco «Temi installati».
export function installFolderButton(host: ThemeFolderHost): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-btn";
  button.dataset.devAction = "install";
  button.textContent = t("settings.themes.install_folder");
  button.addEventListener("click", () => {
    button.disabled = true;
    void installThemeFolder(host)
      .catch((error: unknown) => notify(t("settings.themes.install_failed", { reason: errorText(error) }), "guasto"))
      .finally(() => {
        if (button.isConnected) button.disabled = false;
      });
  });
  return button;
}

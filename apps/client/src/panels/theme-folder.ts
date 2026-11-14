// Installare un tema da una cartella, e leggere perché un tema è rifiutato
// (PA T36). Due pezzi di Aspetto che vivono accanto a «Temi installati»:
//
// - il bottone «Installa da cartella…», che c'è solo con la modalità
//   sviluppatore accesa. La regola vera sta nell'host
//   (`Host::install_theme_from_folder`): qui il bottone nascosto è solo il
//   modo di non offrire un gesto che l'host rifiuterebbe. La cartella la
//   sceglie la persona nella finestra nativa che l'app apre
//   (`checkThemeFolder`): la shell non dà mai un path. L'host la legge senza
//   scrivere, e passa dal cancello del catalogo (`vetThemeFolder`): un tema
//   che la shell rifiuterebbe non arriva mai nella cartella dei temi, e
//   l'installazione chiede gli stessi byte;
// - la diagnosi: una riga per motivo. I motivi del loader
//   (`validateThemeBundle`) si dividono in campi, mai riscritti; quelli
//   dell'host arrivano tipizzati e si dicono con le parole della shell. Un
//   tentativo ha un esito solo: la diagnosi e un avviso che dice la stessa
//   cosa.
// - il tema collegato (PA T37): «Collega una cartella…» accanto a «Installa da
//   cartella…», e sotto «Temi installati» il blocco «Cartella collegata» con
//   l'ora dell'ultimo rimontaggio e «Scollega». La cartella la sceglie la
//   persona nella finestra nativa, come per installare; il rimontaggio a ogni
//   salvataggio è di `theme/theme.ts`, e qui si dice com'è andato.
import { api } from "../host/ipc";
import { errorText, isErrorKind } from "../host/errors";
import type {
  DiskCause,
  ThemeBlock,
  ThemeFolderCheck,
  ThemeFolderInstall,
  ThemeFolderLink,
  ThemeFolderRefusal,
} from "../host/contract";
import { openDialog } from "../kit/dialog";
import { writeClipboardText } from "../platform/clipboard";
import { plural, resolvedLanguage, t } from "../i18n/strings";
import {
  currentThemeId,
  currentThemePreview,
  linkedTheme,
  reloadThemeCatalog,
  themeCatalog,
  themeLinkChanged,
  themeRejections,
  vetThemeFolder,
  type LinkedThemeStatus,
  type Theme,
} from "../theme/theme";
import { notify } from "../ui/notify";
import { setTooltip } from "../ui/tooltip";
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
  /// Il tema non è rifiutato: è ciò che c'è già fra i temi di Fub a fermarlo.
  readonly blocked?: boolean;
  /// Il tema collegato: l'ora dell'ultimo fascio buono, che resta.
  readonly lastGood?: number;
  /// Con `lastGood`: l'ultimo buono è montato adesso (in uso o in anteprima).
  readonly mounted?: boolean;
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

/// Il rifiuto tipizzato dell'host: una riga, col file che il motivo nomina, il
/// motivo per codice e il perché con le parole della shell.
export function refusalRow(refusal: ThemeFolderRefusal): DiagnosisRow {
  const code = refusal.reason.replaceAll("_", "-");
  const row = (file: string | null, why: string): DiagnosisRow => ({ file, where: null, code, why });
  switch (refusal.reason) {
    case "not_a_theme":
      return row("manifest.json", t("settings.themes.refusal.not_a_theme"));
    case "engine":
      return row("manifest.json", t("settings.themes.refusal.engine", { declared: refusal.declared }));
    case "permissions":
      return row("manifest.json", t("settings.themes.refusal.permissions"));
    case "invalid_id":
      return row("manifest.json", t("settings.themes.refusal.invalid_id", { id: refusal.id }));
    case "series":
      return row("manifest.json", t("settings.themes.refusal.series"));
    case "traversal":
      return row(refusal.path, t("settings.themes.refusal.traversal"));
    case "catalog_state":
      return row(refusal.file, t("settings.themes.refusal.catalog_state"));
    case "malformed":
      return row(null, t("settings.themes.refusal.malformed", { detail: refusal.detail }));
  }
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
  const linkedOne = linkedDiagnosis(linkedTheme());
  const all = linkedOne ? [linkedOne, ...loader] : loader;
  return refusal ? [refusal, ...all] : all;
}

/// La diagnosi del tema collegato, se l'ultimo tentativo non è riuscito: i
/// motivi del cancello della shell, o il rifiuto tipizzato dell'host (un
/// manifest a metà), o la cartella che il disco non legge. La cartella sparita
/// e la collisione le dice il blocco «Cartella collegata».
export function linkedDiagnosis(status: LinkedThemeStatus | null): Diagnosis | null {
  if (status === null || status.attemptAt === null) return null;
  const { link } = status;
  const name = link.name ?? folderName(link.folder);
  const shown = currentThemePreview()?.id ?? currentThemeId();
  const kept = status.goodAt === null
    ? {}
    : { lastGood: status.goodAt, mounted: link.id !== null && shown === link.id };
  if (status.rejection !== null) {
    const { reasons, light } = status.rejection;
    return { name, at: status.attemptAt, rows: diagnosisRows(reasons, light), text: reasons, ...kept };
  }
  if (link.state === "refused") {
    const row = refusalRow(link.refusal);
    return { name, at: status.attemptAt, rows: [row], text: [row.why], ...kept };
  }
  if (link.state === "unreadable") {
    const why = t("settings.themes.linked.unreadable");
    return { name, at: status.attemptAt, rows: [{ file: null, where: null, code: "unreadable", why }], text: [why], ...kept };
  }
  return null;
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
  title.textContent = diagnosis.blocked
    ? plural(count, "settings.themes.diagnosis.blocked.one", "settings.themes.diagnosis.blocked", { name: diagnosis.name })
    : plural(count, "settings.themes.diagnosis.title.one", "settings.themes.diagnosis.title", { name: diagnosis.name });
  const when = document.createElement("div");
  when.className = "muted";
  when.textContent = diagnosis.lastGood !== undefined
    ? t(diagnosis.mounted ? "settings.themes.diagnosis.when_last_good" : "settings.themes.diagnosis.when_listed_good", {
        time: clock(diagnosis.at),
        good: clock(diagnosis.lastGood),
      })
    : t(diagnosis.kept ? "settings.themes.diagnosis.when_kept" : "settings.themes.diagnosis.when", {
        time: clock(diagnosis.at),
      });
  text.append(title, when);

  const list = document.createElement("ol");
  list.className = "tema-diagnosi-lista";
  for (const row of diagnosis.rows) {
    const item = document.createElement("li");
    item.className = "tema-diagnosi-riga";
    if (row.file === null && row.where === null) {
      // Un motivo che riguarda tutto il tema: niente colonne vuote.
      item.classList.add("tema-diagnosi-riga--tema");
    } else {
      // Un nome di file non si spezza: stretto si accorcia, e intero sta nel
      // suggerimento della shell (mai un `title` nativo).
      const file = span("tema-diagnosi-file", row.file ?? "—");
      if (row.file !== null) setTooltip(file, row.file);
      item.append(file, span("tema-diagnosi-dove", row.where ?? "—"));
    }
    item.append(span("tema-diagnosi-codice", row.code, "code"), span("tema-diagnosi-perche", row.why));
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
async function installedAlready(id: string): Promise<boolean> {
  const installed = await themeCatalog().catch(() => []);
  return installed.some((theme) => theme.manifest.id === id);
}

/// L'errore di una chiamata all'host (o della finestra di scelta): la
/// modalità spenta si dice per quello che è, ogni altro guasto con le parole
/// che porta (l'host le manda già nella lingua di chi guarda). Ogni fermata
/// dell'installazione è un esito tipizzato e non passa di qui. Il rifiuto di
/// prima, già tolto, sparisce anche dallo schermo.
async function failed(host: ThemeFolderHost, error: unknown): Promise<void> {
  refusal = null;
  if (isErrorKind(error, "permission_denied")) notify(t("settings.themes.developer_off"), "guasto");
  else notify(t("settings.themes.install_failed", { reason: errorText(error).replace(/[.\s]+$/, "") }), "guasto");
  await host.rerender();
}

/// Un'installazione che si è fermata senza scrivere: la cartella cambiata, un
/// controllo che non vale più, il disco che dice di no. Ognuno ha la sua
/// frase; con `replace` l'avviso dice anche che il tema installato è com'era.
async function stopped(
  host: ThemeFolderHost,
  folder: string,
  outcome: Extract<ThemeFolderInstall, { outcome: "changed" | "unchecked" | "failed" | "unreadable" }>,
  replace: boolean,
): Promise<void> {
  refusal = null;
  const name = { folder: folderName(folder) };
  const what =
    outcome.outcome === "failed"
      ? t(DISK_CAUSE[outcome.cause])
      : outcome.outcome === "unreadable"
        ? t(outcome.side === "folder" ? "settings.themes.unreadable.folder" : "settings.themes.unreadable.themes", name)
        : t(outcome.outcome === "changed" ? "settings.themes.changed" : "settings.themes.unchecked", name);
  notify(replace ? `${what} ${t("settings.themes.install_kept")}` : what, "guasto");
  await host.rerender();
}

/// La frase di ogni perché del disco.
const DISK_CAUSE: Record<DiskCause, "settings.themes.disk.full" | "settings.themes.disk.denied" | "settings.themes.disk.other"> = {
  full: "settings.themes.disk.full",
  denied: "settings.themes.disk.denied",
  other: "settings.themes.disk.other",
};

/// Scarta il permesso del controllo: la persona ha detto no, o la shell non
/// installa la cartella. Se l'host non risponde il permesso resta, ma vale solo
/// per quella cartella controllata: niente da dire alla persona.
function discard(): void {
  void api.discardThemeFolder().catch(() => undefined);
}

/// La frase di ogni perché che blocca.
const BLOCKED: Record<ThemeBlock, "settings.themes.blocked.pointer" | "settings.themes.blocked.link" | "settings.themes.blocked.layout"> = {
  pointer: "settings.themes.blocked.pointer",
  link: "settings.themes.blocked.link",
  layout: "settings.themes.blocked.layout",
};

/// Una diagnosi di un solo motivo che riguarda tutto il tema.
function wholeTheme(name: string, code: string, why: string, kept: boolean): Diagnosis {
  return { name, at: Date.now(), rows: [{ file: null, where: null, code, why }], text: [why], kept };
}

/// Il rifiuto tipizzato dell'host, come diagnosi di una riga.
function hostRefusal(name: string, refused: ThemeFolderRefusal, kept = false): Diagnosis {
  const row = refusalRow(refused);
  return { name, at: Date.now(), rows: [row], text: [row.why], kept };
}

/// Il cancello del catalogo sulla cartella letta: i motivi di ogni luce
/// rifiutata, divisi in righe, senza ripetere quelli che due luci hanno in
/// comune (la pelle è una sola). `null` se il catalogo la prenderebbe.
async function vetted(check: Extract<ThemeFolderCheck, { outcome: "ready" }>): Promise<Diagnosis | null> {
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
  folder: string,
  outcome: Extract<ThemeFolderInstall, { outcome: "collision" }>,
): Promise<boolean> {
  const body = outcome.installed_version === null
    ? t("settings.themes.replace.body_unknown", { folder, id: outcome.id, version: outcome.version })
    : t("settings.themes.replace.body", {
        folder,
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
  folder: string,
  outcome: Extract<ThemeFolderInstall, { outcome: "replace_failed" }>,
  wasInUse: boolean,
): Promise<void> {
  // Il guasto del disco (`outcome.error`) è in inglese e porta percorsi della
  // macchina: la finestra dice l'esito con le sue parole, e il nome tipizzato.
  const body = t("settings.themes.replace_failed.body", { kept: outcome.kept, folder });
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
 * Il giro intero dell'installazione da cartella: la scelta nella finestra
 * nativa, il controllo, l'host, la collisione con «Sostituisci», l'esito.
 * Ogni chiamata all'host rilegge la modalità sviluppatore: spenta nel
 * frattempo, l'host rifiuta e lo si dice.
 */
export async function installThemeFolder(host: ThemeFolderHost): Promise<void> {
  let check: ThemeFolderCheck;
  try {
    // Il titolo della finestra lo scrive l'host: è lì che la persona sceglie.
    check = await api.checkThemeFolder();
  } catch (error) {
    if (!host.lifetime.closed) await failed(host, error);
    return;
  }
  if (check.outcome === "cancelled" || host.lifetime.closed) {
    if (check.outcome === "ready") discard();
    return;
  }
  refusal = null;
  if (check.outcome === "refused") {
    await showRefusal(host, hostRefusal(folderName(check.folder), check.refusal));
    return;
  }
  const rejection = await vetted(check);
  if (rejection || host.lifetime.closed) {
    discard();
    if (rejection && !host.lifetime.closed) await showRefusal(host, rejection);
    return;
  }
  const { folder, digest, manifest } = check;
  let replace = false;
  let outcome: ThemeFolderInstall;
  try {
    outcome = await api.installThemeFromFolder(false, digest);
  } catch (error) {
    if (!host.lifetime.closed) await failed(host, error);
    return;
  }
  if (outcome.outcome === "collision") {
    if (host.lifetime.closed || !(await askReplace(host, folder, outcome)) || host.lifetime.closed) {
      discard();
      return;
    }
    replace = true;
    try {
      outcome = await api.installThemeFromFolder(true, digest);
    } catch (error) {
      if (!host.lifetime.closed) await failed(host, error);
      return;
    }
  }
  if (host.lifetime.closed && outcome.outcome !== "installed" && outcome.outcome !== "replace_failed") return;
  switch (outcome.outcome) {
    case "revoked": {
      // Il tema ritirato resta installato com'era, come per un rifiuto.
      const why = t("settings.themes.refusal.revoked", { name: outcome.name });
      await showRefusal(host, wholeTheme(outcome.name, "revoked", why, true));
      return;
    }
    case "blocked": {
      // Non è un difetto della cartella: è ciò che c'è già fra i temi di Fub.
      // Il tema installato con lo stesso id, se è lui, resta com'era.
      const why = t(BLOCKED[outcome.why], { name: manifest.name, path: outcome.path });
      await showRefusal(host, {
        ...wholeTheme(manifest.name, `blocked_${outcome.why}`, why, outcome.installed),
        blocked: true,
      });
      return;
    }
    case "refused":
      await showRefusal(host, hostRefusal(manifest.name, outcome.refusal, replace || (await installedAlready(manifest.id))));
      return;
    case "changed":
    case "unchecked":
    case "failed":
    case "unreadable":
      await stopped(host, folder, outcome, replace);
      return;
    case "collision":
      // Con `replace` l'host non risponde più `collision`.
      return;
    case "installed":
    case "replace_failed":
      break;
  }
  const wasInUse = currentThemeId() === outcome.id;
  if (host.lifetime.closed) {
    // Il disco è cambiato anche se il pannello è chiuso: il catalogo si
    // rilegge (il tema in uso, sostituito, si rimonta), ma niente si disegna.
    await reloadThemeCatalog().catch(() => []);
    return;
  }
  await settle(host);
  if (host.lifetime.closed) return;
  if (outcome.outcome === "replace_failed") {
    await tellReplaceFailed(host, folder, outcome, wasInUse);
    return;
  }
  notify(
    outcome.replaced
      ? t("settings.themes.replaced", { name: outcome.name, version: outcome.version })
      : t("settings.themes.installed", { name: outcome.name }),
    "info",
  );
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
      .catch((error: unknown) => (host.lifetime.closed ? undefined : failed(host, error)))
      .finally(() => {
        if (button.isConnected) button.disabled = false;
      });
  });
  return button;
}

// --- il tema collegato (PA T37) ---------------------------------------------

/// Un collegamento che non si è fatto: la cartella di prima resta collegata.
/// Un rifiuto delle porte è una diagnosi, come per installare; gli altri sono
/// una frase.
async function notLinked(host: ThemeFolderHost, outcome: Extract<ThemeFolderLink, { outcome: "refused" }>): Promise<void> {
  const { link } = outcome;
  const name = link.name ?? folderName(link.folder);
  switch (link.state) {
    case "refused": {
      const diagnosis = hostRefusal(name, link.refusal);
      refusal = diagnosis;
      notify(
        plural(diagnosis.rows.length, "settings.themes.linked.not_linked.one", "settings.themes.linked.not_linked", { name }),
        "guasto",
      );
      break;
    }
    case "collision":
      refusal = null;
      notify(t("settings.themes.linked.not_linked_collision", { name, id: link.id ?? name }), "guasto");
      break;
    case "missing":
      refusal = null;
      notify(t("settings.themes.linked.not_linked_missing"), "guasto");
      break;
    case "unreadable":
      refusal = null;
      notify(t("settings.themes.linked.not_linked_unreadable", { folder: folderName(link.folder) }), "guasto");
      break;
    case "ready":
      // L'host non rifiuta mai una cartella pronta.
      refusal = null;
      break;
  }
  await host.rerender();
}

/// Una chiamata del collegamento che non è arrivata a un esito: la modalità
/// spenta per quello che è, ogni altro guasto con le parole che porta.
async function linkFailed(host: ThemeFolderHost, error: unknown, unlink: boolean): Promise<void> {
  if (isErrorKind(error, "permission_denied") && !unlink) notify(t("settings.themes.developer_off"), "guasto");
  else {
    const reason = errorText(error).replace(/[.\s]+$/, "");
    notify(t(unlink ? "settings.themes.linked.unlink_failed" : "settings.themes.linked.link_failed", { reason }), "guasto");
  }
  await host.rerender();
}

/**
 * Il giro di «Collega una cartella…»: la scelta nella finestra nativa,
 * l'host che la legge con le porte dell'installazione e la collega, il
 * catalogo riletto. Il tema compare fra i temi installati, in sviluppo; se il
 * cancello della shell lo rifiuta la diagnosi lo dice, e il prossimo
 * salvataggio riprova.
 */
export async function linkThemeFolder(host: ThemeFolderHost): Promise<void> {
  let outcome: ThemeFolderLink;
  try {
    outcome = await api.linkThemeFolder();
  } catch (error) {
    if (!host.lifetime.closed) await linkFailed(host, error, false);
    return;
  }
  if (outcome.outcome === "cancelled") return;
  if (outcome.outcome === "refused") {
    if (!host.lifetime.closed) await notLinked(host, outcome);
    return;
  }
  refusal = null;
  // Il collegamento è dell'host anche se il pannello si è chiuso: il catalogo
  // si rilegge comunque.
  await themeLinkChanged(outcome.link);
  if (host.lifetime.closed) return;
  await host.rerender();
  const name = outcome.link.name ?? folderName(outcome.link.folder);
  if (linkedTheme()?.rejection == null && linkedTheme()?.attemptAt == null) {
    notify(t("settings.themes.linked.done", { name }), "info");
  }
}

/// «Scollega»: l'host dimentica la cartella e smette di guardarla, il catalogo
/// si rilegge e, se il tema collegato era in uso, torna la serie.
export async function unlinkThemeFolder(host: ThemeFolderHost): Promise<void> {
  try {
    await api.unlinkThemeFolder();
  } catch (error) {
    if (!host.lifetime.closed) await linkFailed(host, error, true);
    return;
  }
  await themeLinkChanged(null);
  if (host.lifetime.closed) return;
  notify(t("settings.themes.linked.unlinked"), "info");
  await host.rerender();
}

/// Un bottone di Aspetto che resta spento finché il suo giro non finisce.
function actionButton(label: string, action: string, run: () => Promise<void>, host: ThemeFolderHost): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-btn";
  button.dataset.devAction = action;
  button.textContent = label;
  button.addEventListener("click", () => {
    button.disabled = true;
    void run()
      .catch((error: unknown) => (host.lifetime.closed ? undefined : linkFailed(host, error, action === "unlink")))
      .finally(() => {
        if (button.isConnected) button.disabled = false;
      });
  });
  return button;
}

/// Il bottone «Collega una cartella…» del blocco «Temi installati».
export function linkFolderButton(host: ThemeFolderHost): HTMLButtonElement {
  return actionButton(t("settings.themes.link_folder"), "link", () => linkThemeFolder(host), host);
}

/// La riga di stato del blocco: com'è andato l'ultimo giro.
function linkedStatusText(status: LinkedThemeStatus): string {
  const { link } = status;
  if (link.state === "missing") return t("settings.themes.linked.missing");
  if (link.state === "collision") return t("settings.themes.linked.collision", { id: link.id ?? "" });
  if (status.reloaded !== null) {
    const time = clock(status.reloaded.at);
    return status.reloaded.changed.length > 0
      ? t("settings.themes.linked.reloaded_after", { time, files: status.reloaded.changed.join(", ") })
      : t("settings.themes.linked.reloaded", { time });
  }
  return t("settings.themes.linked.linked_at", { time: clock(status.since) });
}

/**
 * Il blocco «Cartella collegata», sotto «Temi installati»: la cartella, il
 * tema e la fiducia, l'ultimo rimontaggio (`role="status"`, così chi usa uno
 * screen reader sente «Ricaricato…» a ogni salvataggio) e «Scollega».
 */
export function renderLinkedFolder(host: ThemeFolderHost, status: LinkedThemeStatus): HTMLElement {
  const block = document.createElement("div");
  block.className = "setting-row setting-block";
  block.dataset.themeLinked = "";
  block.dataset.linkState = status.link.state;
  const text = document.createElement("div");
  text.className = "setting-text";
  const title = document.createElement("div");
  title.className = "setting-label";
  title.setAttribute("role", "heading");
  title.setAttribute("aria-level", "4");
  title.textContent = t("settings.themes.linked.title");
  const hint = document.createElement("div");
  hint.className = "muted";
  hint.textContent = status.link.name === null
    ? t("settings.themes.linked.hint_unknown", { folder: status.link.folder })
    : t("settings.themes.linked.hint", { folder: status.link.folder, name: status.link.name });
  text.append(title, hint);
  const line = document.createElement("div");
  line.className = "setting-source";
  line.setAttribute("role", "status");
  line.setAttribute("aria-live", "polite");
  line.textContent = linkedStatusText(status);
  const actions = document.createElement("div");
  actions.className = "settings-actions";
  actions.append(actionButton(t("settings.themes.linked.unlink"), "unlink", () => unlinkThemeFolder(host), host));
  block.append(text, line, actions);
  return block;
}

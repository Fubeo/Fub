// La schermata senza vault e i controlli della demo sono UI di macchina:
// i dati e le mutazioni passano dall'adattatore host, mai dal registro plugin.
import { api, type ConfigReport, type SupportPreview } from "../host/ipc";
import type { ComponentsMap } from "../host/contract";
import { settings, vaultEntries } from "../host/query";
import { pickSupportDestination } from "../host/dialog";
import { confirm } from "../platform/confirm";
import { errorText, asPluginError } from "../host/errors";
import { onEvent } from "../state/kernel";
import { on, state } from "../state/store";
import { guardDisabledKeys, laterReason, profileButton, RECOMMENDED } from "../panels/component-profiles";
import { trapFocus } from "./a11y";
import { t, onLanguage } from "../i18n/strings";
import { notify } from "./notify";
import { openLifetime, type Lifetime, type Teardown } from "./lifetime";
import { attachTooltip, setTooltip } from "./tooltip";

export interface OnboardingShell {
  openPath(path: string): Promise<void>;
  prepareSwitch(): Promise<boolean>;
  isOpening(): boolean;
  currentVault(): string;
  returnTo(path: string | null): Promise<void>;
}

export interface ContextualHelp {
  key: "help.not_found" | "help.already_exists" | "help.conflict" | "help.io" |
    "help.permission_denied" | "help.bad_args" | "help.unknown" | "help.unserved" |
    "help.cancelled" | "help.internal";
  tone: "info" | "guasto";
  action: "retry" | "other" | "repair" | "report";
}

export function helpFor(error: unknown): ContextualHelp {
  const kind = asPluginError(error)?.kind;
  switch (kind) {
    case "not_found": return { key: "help.not_found", tone: "info", action: "other" };
    case "already_exists": return { key: "help.already_exists", tone: "info", action: "other" };
    case "conflict": case "io": return { key: kind === "conflict" ? "help.conflict" : "help.io", tone: "guasto", action: "retry" };
    case "permission_denied": return { key: "help.permission_denied", tone: "guasto", action: "repair" };
    case "bad_args": return { key: "help.bad_args", tone: "info", action: "other" };
    case "unknown_command": case "unknown_view": case "unknown_job": return { key: "help.unknown", tone: "info", action: "report" };
    case "unserved": return { key: "help.unserved", tone: "info", action: "repair" };
    case "cancelled": return { key: "help.cancelled", tone: "info", action: "retry" };
    default: return { key: "help.internal", tone: "guasto", action: "report" };
  }
}

export function reportWithHelp(error: unknown): void {
  const help = helpFor(error);
  notify(`${errorText(error)}\n${t(help.key)}`, help.tone);
}

let mountedTeardown: Teardown | null = null;

// Una sola vita per la shell: la schermata si nasconde quando c'e` un vault,
// mentre i controlli demo restano nel chrome fino alla chiusura della pagina.
export function mountOnboarding(shell: OnboardingShell, parent?: Lifetime): Teardown {
  mountedTeardown?.();
  const lifetime = openLifetime();
  const teardown = () => lifetime.close();
  mountedTeardown = teardown;
  lifetime.add(() => { if (mountedTeardown === teardown) mountedTeardown = null; });
  parent?.add(teardown);
  if (lifetime.closed) return teardown;
  const onboarding = document.getElementById("onboarding");
  if (!onboarding) return teardown;
  onboarding.setAttribute("role", "region");
  onboarding.setAttribute("aria-label", t("onboarding.title"));
  const extra = document.createElement("div");
  extra.id = "onboarding-extra";
  extra.className = "onboarding-extra";
  onboarding.append(extra);
  lifetime.add(() => extra.remove());

  const button = (key: Parameters<typeof t>[0]): HTMLButtonElement => {
    const el = document.createElement("button");
    el.type = "button";
    el.textContent = t(key);
    return el;
  };
  // Diagnostica e recupero servono quando qualcosa non va: stanno dietro una
  // riga che si apre, e non davanti a chi sta aprendo il primo vault.
  const trouble = document.createElement("details");
  trouble.className = "onboarding-trouble";
  const troubleSummary = document.createElement("summary");
  troubleSummary.textContent = t("onboarding.trouble");
  trouble.append(troubleSummary);
  const section = (
    key: Parameters<typeof t>[0],
    detail: Parameters<typeof t>[0],
    into: HTMLElement = extra,
  ) => {
    const el = document.createElement("section");
    const title = document.createElement("h3");
    title.textContent = t(key);
    el.setAttribute("aria-label", t(key));
    const explanation = document.createElement("p");
    explanation.className = "muted";
    explanation.textContent = t(detail);
    const actions = document.createElement("div");
    actions.className = "onboarding-actions";
    const status = document.createElement("p");
    status.setAttribute("role", "status");
    status.hidden = true;
    el.append(title, explanation, actions, status);
    into.append(el);
    return { el, title, explanation, actions, status, key, detail };
  };
  const status = (el: HTMLElement, message: string | null): void => {
    el.hidden = !message;
    el.textContent = message ?? "";
  };
  const demo = section("demo.title", "demo.detail");
  status(demo.status, t("demo.checking"));
  demo.status.id = "onboarding-demo-status";
  const demoOpen = button("demo.open");
  demoOpen.className = "primary";
  const demoReset = button("demo.reset");
  const demoClose = button("demo.close");
  demo.actions.append(demoOpen, demoReset, demoClose);
  const chrome = document.createElement("div");
  chrome.setAttribute("role", "group");
  chrome.setAttribute("aria-label", t("demo.title"));
  const chromeReset = button("demo.reset");
  const chromeClose = button("demo.close");
  const chromeDiagnostics = button("support.diagnostics");
  chrome.append(chromeReset, chromeClose, chromeDiagnostics);
  document.getElementById("titlebar-right")?.prepend(chrome);
  lifetime.add(() => chrome.remove());

  extra.append(trouble);
  const support = section("support.title", "support.detail", trouble);
  const previewButton = button("support.preview");
  const exportButton = button("support.export");
  exportButton.disabled = true;
  lifetime.add(attachTooltip(exportButton, t("support.preview_first")));
  const diagnosticsButton = button("support.diagnostics");
  const previewContent = document.createElement("pre");
  previewContent.hidden = true;
  previewContent.tabIndex = 0;
  previewContent.style.maxWidth = "100%";
  previewContent.style.overflow = "auto";
  support.actions.append(previewButton, exportButton, diagnosticsButton);
  const exportReason = document.createElement("span");
  exportReason.id = "onboarding-export-reason";
  exportReason.className = "sr-only";
  exportReason.textContent = t("support.preview_first");
  support.el.append(exportReason);
  exportButton.setAttribute("aria-describedby", exportReason.id);
  support.el.append(previewContent);
  const diagnosticsReason = document.createElement("p");
  diagnosticsReason.className = "muted";
  diagnosticsReason.id = "onboarding-diagnostics-reason";
  diagnosticsReason.textContent = t("support.no_vault");
  diagnosticsButton.setAttribute("aria-describedby", diagnosticsReason.id);
  support.el.append(diagnosticsReason);
  lifetime.add(attachTooltip(demoOpen, ""));
  lifetime.add(attachTooltip(demoReset, ""));
  lifetime.add(attachTooltip(diagnosticsButton, ""));

  const recovery = section("recovery.title", "recovery.detail", trouble);
  const healthButton = button("recovery.check");
  const reports = document.createElement("div");
  recovery.actions.append(healthButton);
  recovery.el.append(reports);

  let demoRootResolved = false;
  let demoRoot: string | null = null;
  let demoPrevious: string | null = null;
  let preview: SupportPreview | null = null;
  let busy = false;
  const isDemo = (): boolean => demoRoot !== null && shell.currentVault() === demoRoot;
  const refresh = (): void => {
    const active = isDemo();
    chrome.hidden = !active;
    demoClose.hidden = !active;
    demoOpen.hidden = active;
    demoReset.disabled = !demoRoot || busy;
    chromeReset.disabled = busy;
    chromeClose.disabled = busy;
    chromeDiagnostics.disabled = busy;
    demoClose.disabled = busy;
    demoOpen.disabled = !demoRoot || busy;
    if (demoRootResolved && !demoRoot) {
      status(demo.status, t("demo.unavailable"));
      demoOpen.setAttribute("aria-describedby", demo.status.id);
      demoReset.setAttribute("aria-describedby", demo.status.id);
      setTooltip(demoOpen, t("demo.unavailable"));
      setTooltip(demoReset, t("demo.unavailable"));
    } else {
      demoOpen.removeAttribute("aria-describedby");
      demoReset.removeAttribute("aria-describedby");
      setTooltip(demoOpen, "");
      setTooltip(demoReset, "");
    }
    previewButton.disabled = busy;
    exportButton.disabled = busy || !preview;
    if (preview) exportButton.removeAttribute("aria-describedby");
    else exportButton.setAttribute("aria-describedby", exportReason.id);
    setTooltip(exportButton, preview ? "" : t("support.preview_first"));
    healthButton.disabled = busy;
    diagnosticsButton.disabled = busy || !shell.currentVault();
    diagnosticsReason.hidden = !!shell.currentVault();
    setTooltip(diagnosticsButton, !shell.currentVault() ? t("support.no_vault") : "");
  };
  // Nessuna UI finge che la demo esista quando manca una config dir.
  void api.demoRoot().then((root) => {
    if (lifetime.closed) return;
    demoRoot = root;
    demoRootResolved = true;
    if (root) status(demo.status, null);
    refresh();
  }).catch((error: unknown) => {
    if (!lifetime.closed) { status(demo.status, errorText(error)); reportWithHelp(error); }
  });
  let focusAfter: HTMLElement | null = null;
  const run = async (target: HTMLElement, operation: () => Promise<void>): Promise<void> => {
    if (busy || lifetime.closed) return;
    busy = true;
    refresh();
    try { await operation(); }
    catch (error) {
      if (!lifetime.closed) { status(target, errorText(error)); reportWithHelp(error); }
    } finally {
      busy = false;
      if (!lifetime.closed) {
        refresh();
        focusAfter?.focus();
      }
      focusAfter = null;
    }
  };
  const canSwitch = async (): Promise<boolean> => {
    if (!shell.isOpening() && await shell.prepareSwitch()) return true;
    status(demo.status, t("demo.switch_blocked"));
    return false;
  };
  lifetime.listen(demoOpen, "click", () => void run(demo.status, async () => {
    if (!await canSwitch()) return;
    status(demo.status, t("demo.opening"));
    const opened = await api.openDemo();
    demoRoot = opened.root;
    demoPrevious = opened.previous;
    try {
      await shell.openPath(opened.root);
    } catch (error) {
      let current = opened.previous;
      try { current = (await api.closeDemo(opened.previous)).current; }
      catch (rollbackError) { reportWithHelp(rollbackError); }
      try { await shell.returnTo(current); }
      catch (rollbackError) { reportWithHelp(rollbackError); }
      throw error;
    }
    status(demo.status, null);
    if (document.activeElement === document.body || document.activeElement === demoOpen) {
      focusAfter = chromeClose;
    }
  }));
  const reset = () => void run(demo.status, async () => {
    if (shell.isOpening()) { status(demo.status, t("demo.switch_blocked")); return; }
    const yes = await confirm(t("demo.reset_confirm"), {
      title: t("demo.reset"), okLabel: t("demo.reset"), danger: true,
    });
    if (!yes || !await canSwitch()) return;
    const root = await api.resetDemo();
    demoRoot = root;
    try {
      await shell.openPath(root);
      status(demo.status, t("demo.reset_done"));
    } catch (error) {
      try { await shell.returnTo(demoPrevious); }
      catch (rollbackError) { reportWithHelp(rollbackError); }
      throw error;
    }
  });
  lifetime.listen(demoReset, "click", reset);
  lifetime.listen(chromeReset, "click", reset);
  const close = () => void run(demo.status, async () => {
    if (!isDemo() || !await canSwitch()) return;
    const closed = await api.closeDemo(demoPrevious);
    await shell.returnTo(closed.current);
    focusAfter = closed.current ? document.getElementById("open-vault") : demoOpen;
    demoPrevious = null;
    status(demo.status, null);
    for (const error of closed.errors) reportWithHelp(error);
  });
  lifetime.listen(demoClose, "click", close);
  lifetime.listen(chromeClose, "click", close);

  lifetime.listen(previewButton, "click", () => void run(support.status, async () => {
    preview = null;
    exportButton.disabled = true;
    previewContent.hidden = true;
    status(support.status, t("support.working"));
    const result = await api.supportPreview(shell.currentVault() || null, 0);
    if (lifetime.closed) return;
    preview = result;
    previewContent.textContent = JSON.stringify(result, null, 2);
    previewContent.hidden = false;
    status(support.status, t("support.preview_done", {
      keys: result.machine.settings_keys.length,
      vaults: result.machine.known_vaults,
    }));
    previewContent.focus();
  }));
  lifetime.listen(exportButton, "click", () => void run(support.status, async () => {
    if (!preview) return;
    const shown = preview;
    const destination = await pickSupportDestination();
    if (!destination || lifetime.closed) return;
    const yes = await confirm(t("support.export_confirm", { dest: destination }), {
      title: t("support.export"), okLabel: t("support.export"),
    });
    if (!yes || lifetime.closed) return;
    const saved = await api.supportExport(shown, {
      acknowledged_preview: true, include_log: false, destination,
    });
    if (!lifetime.closed) status(support.status, t("support.export_done", { dest: saved }));
  }));
  const showDiagnostics = () => void run(support.status, async () => {
    const errors = await api.startupDiagnostics(shell.currentVault() || null);
    if (lifetime.closed) return;
    const message = errors.length ? errors.map(errorText).join("\n") : t("support.no_diagnostics");
    status(support.status, message);
    if (isDemo()) notify(message, errors.length ? "guasto" : "info");
  });
  lifetime.listen(diagnosticsButton, "click", showDiagnostics);
  lifetime.listen(chromeDiagnostics, "click", showDiagnostics);

  let healthReports: ConfigReport[] = [];
  const showHealth = async (): Promise<void> => {
    const health = await api.configHealth();
    healthReports = health;
    if (lifetime.closed) return;
    reports.replaceChildren();
    if (!health.length) {
      status(recovery.status, t("recovery.unavailable"));
      return;
    }
    status(recovery.status, health.every(report => report.status.kind === "healthy" || report.status.kind === "missing")
      ? t("recovery.healthy") : t("recovery.found"));
    for (const report of health) {
      const row = document.createElement("div");
      const text = document.createElement("p");
      text.textContent = `${report.path}: ${report.status.kind === "future_version"
        ? t("recovery.future", { found: report.status.found, supported: report.status.supported })
        : report.status.kind === "unreadable"
          ? t("recovery.unreadable", { reason: report.status.reason })
          : t(report.status.kind === "healthy" ? "recovery.ok" : "recovery.missing")}`;
      row.append(text);
      if (report.status.kind === "unreadable") {
        const backup = button("recovery.backup");
        const reset = button("recovery.reset");
        backup.dataset.action = "backup_only";
        reset.dataset.action = "reset_empty";
        backup.dataset.path = reset.dataset.path = report.path;
        row.append(backup, reset);
      }
      reports.append(row);
    }
  };
  lifetime.listen(reports, "click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const action = target.dataset.action;
    const path = target.dataset.path;
    if ((action !== "backup_only" && action !== "reset_empty") || !path
      || !healthReports.some(report => report.path === path && report.status.kind === "unreadable")) return;
    void run(recovery.status, async () => {
      const yes = await confirm(t(action === "reset_empty" ? "recovery.reset_confirm" : "recovery.backup_confirm", { path }), {
        title: t(action === "reset_empty" ? "recovery.reset" : "recovery.backup"),
        okLabel: t(action === "reset_empty" ? "recovery.reset" : "recovery.backup"),
        danger: action === "reset_empty",
      });
      if (!yes || lifetime.closed) return;
      const result = await api.recoverConfig(path, action);
      if (lifetime.closed) return;
      await showHealth();
      status(recovery.status, t("recovery.done", {
        backup: result.backup ?? t("recovery.no_backup"),
        restart: result.restart_required ? t("recovery.restart") : "",
      }));
    });
  });
  lifetime.listen(healthButton, "click", () => void run(recovery.status, showHealth));
  lifetime.add(on("vault", refresh));
  lifetime.add(onLanguage(() => {
    onboarding.setAttribute("aria-label", t("onboarding.title"));
    troubleSummary.textContent = t("onboarding.trouble");
    for (const item of [demo, support, recovery]) {
      item.el.setAttribute("aria-label", t(item.key));
      item.title.textContent = t(item.key);
      item.explanation.textContent = t(item.detail);
    }
    chrome.setAttribute("aria-label", t("demo.title"));
    for (const [el, key] of [
      [demoOpen, "demo.open"], [demoReset, "demo.reset"], [demoClose, "demo.close"],
      [chromeReset, "demo.reset"], [chromeClose, "demo.close"], [chromeDiagnostics, "support.diagnostics"],
      [previewButton, "support.preview"], [exportButton, "support.export"],
      [diagnosticsButton, "support.diagnostics"], [healthButton, "recovery.check"],
    ] as const) el.textContent = t(key);
    diagnosticsReason.textContent = t("support.no_vault");
    exportReason.textContent = t("support.preview_first");
    refresh();
  }));
  refresh();
  return teardown;
}

// --- il profilo di un vault nuovo ---------------------------------------------

/// Quanto la schermata del profilo aspetta, dopo una scelta che rimonta il
/// vault (la lavagna che si spegne o si accende), il `vault_opened` che dice
/// «è di nuovo su». Oltre, il vault si mostra lo stesso: la schermata non resta
/// appesa a un evento che non arriva.
export const PROFILE_REMOUNT_WAIT_MS = 2000;

/// Un vault appena aperto è **nuovo** (A6) se non ha voci visibili e nessuna
/// chiave `components.*` scritta nel vault. Lo si chiede all'anagrafe e alle
/// impostazioni, con le domande che la finestra fa già; una risposta che non
/// arriva vale «non nuovo», perché chiedere un profilo a un vault che ne ha uno
/// è peggio che non chiederlo.
export async function isNewVault(): Promise<boolean> {
  try {
    const [entries, entriesSettings] = await Promise.all([
      vaultEntries({ offset: 0, limit: 1 }),
      settings(),
    ]);
    if (entries.total > 0) return false;
    return !entriesSettings.some((entry) => entry.spec.key.startsWith("components.") && entry.source === "vault");
  } catch {
    return false;
  }
}

export interface VaultProfileHooks {
  /// Riscopre ciò che i bundle registrano, dopo che un profilo ne ha accesi o
  /// spenti (le stesse due domande della pagina «Componenti»).
  reloadProvider(): Promise<void>;
}

/// La schermata che chiede il profilo a un vault nuovo, dentro il benvenuto:
/// i profili con la riga condivisa, «Studio» già scelto, «Continua». Niente si
/// applica prima di «Continua» o di Esc, che vale «Studio». Si scioglie quando
/// il profilo è applicato (e il vault, se si è rimontato, è di nuovo su),
/// quando l'applicazione fallisce — il vault si apre come prima e l'errore si
/// dice —, quando un altro vault prende il suo posto o quando `parent` chiude.
export async function askVaultProfile(root: string, hooks: VaultProfileHooks, parent?: Lifetime): Promise<void> {
  const onboarding = document.getElementById("onboarding");
  if (!onboarding || parent?.closed) return;
  let map: ComponentsMap;
  try {
    map = await api.componentsMap(root);
  } catch (error) {
    profileFailed(errorText(error));
    return;
  }
  if (parent?.closed || state.vaultRoot !== root) return;
  const profiles = map.profili;
  const available = profiles.filter((profile) => !profile.piu_avanti);
  if (available.length === 0) return;
  const recommended = available.find((profile) => profile.nome === RECOMMENDED) ?? available[0]!;

  const lifetime = openLifetime();
  let done!: () => void;
  const finished = new Promise<void>((resolve) => { done = resolve; });
  lifetime.add(() => done());
  if (parent) {
    parent.add(() => lifetime.close());
    if (parent.closed) lifetime.close();
  }

  let chosen = recommended.nome;
  let busy = false;

  const screen = document.createElement("section");
  screen.id = "onboarding-profile";
  screen.className = "onboarding-profile";
  // Tiene il fuoco ed Esc ha un significato: è una finestra di dialogo, e lo
  // dice, così chi legge lo schermo non cerca dietro ciò che non si raggiunge.
  screen.setAttribute("role", "dialog");
  screen.setAttribute("aria-modal", "true");
  screen.setAttribute("aria-labelledby", "onboarding-profile-title");
  const title = document.createElement("h2");
  title.id = "onboarding-profile-title";
  const lede = document.createElement("p");
  lede.className = "onboarding-profile-lede";
  const row = document.createElement("div");
  row.className = "components-profiles";
  row.setAttribute("role", "group");
  row.setAttribute("aria-labelledby", title.id);
  const said = document.createElement("p");
  said.className = "onboarding-profile-status";
  said.setAttribute("role", "status");
  said.hidden = true;
  const actions = document.createElement("div");
  actions.className = "onboarding-actions";
  const go = document.createElement("button");
  go.type = "button";
  go.className = "primary";
  go.id = "onboarding-profile-continue";
  actions.append(go);
  const note = document.createElement("p");
  note.className = "onboarding-profile-note";
  screen.append(title, lede, row, said, actions, note);

  const say = (text: string | null): void => {
    said.hidden = !text;
    said.textContent = text ?? "";
  };
  const draw = (): void => {
    title.textContent = t("onboarding.profile.title");
    lede.textContent = t("onboarding.profile.lede");
    go.textContent = t("onboarding.profile.continue");
    note.textContent = t("onboarding.profile.note");
    const focused = row.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).closest<HTMLElement>("[data-profile]")?.dataset.profile
      : undefined;
    row.replaceChildren(...profiles.map((profile) => profileButton(profile, {
      pressed: profile.nome === chosen,
      busy,
      busyHere: false,
      onLater: (later) => say(laterReason(later)),
      onChoose: (picked) => {
        chosen = picked.nome;
        say(null);
        draw();
      },
    })));
    if (busy) {
      go.setAttribute("aria-disabled", "true");
      go.setAttribute("aria-busy", "true");
    } else {
      go.removeAttribute("aria-disabled");
      go.removeAttribute("aria-busy");
    }
    if (focused) row.querySelector<HTMLElement>(`[data-profile="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  };
  guardDisabledKeys(lifetime, screen, (name) => profiles.find((profile) => profile.nome === name), (later) =>
    say(laterReason(later)),
  );

  const apply = async (name: string): Promise<void> => {
    if (busy || lifetime.closed) return;
    busy = true;
    const profile = profiles.find((candidate) => candidate.nome === name);
    say(t("onboarding.profile.applying", { name: profile?.etichetta ?? name }));
    draw();
    // L'attesa del rimontaggio si arma **prima** di applicare: gli eventi
    // arrivano dietro la risposta, e uno perso lascerebbe aspettare a vuoto.
    let closed = false;
    let reopened!: () => void;
    const remounted = new Promise<void>((resolve) => { reopened = resolve; });
    const stopClosed = onEvent("vault_closed", (event) => {
      if (event.root === root) closed = true;
    });
    const stopOpened = onEvent("vault_opened", (event) => {
      if (event.root === root && closed) reopened();
    });
    lifetime.add(stopClosed);
    lifetime.add(stopOpened);
    let timer: ReturnType<typeof setTimeout> | undefined;
    lifetime.add(() => clearTimeout(timer));
    try {
      const result = await api.componentsApply({ azione: "profilo", nome: name }, true, root);
      if (lifetime.closed) return;
      if (result.risposta === "rifiuto") {
        profileFailed(result.rifiuto === "profilo_piu_avanti" && profile
          ? laterReason(profile)
          : t("components.refused.profile", { name: "nome" in result ? result.nome : name }));
        return;
      }
      for (const warning of result.avvisi) notify(errorText(warning), "guasto");
      if (result.scritture.some((write) => write.id === LAVAGNA)) {
        await Promise.race([
          remounted,
          new Promise<void>((resolve) => { timer = setTimeout(resolve, PROFILE_REMOUNT_WAIT_MS); }),
        ]);
        if (lifetime.closed) return;
      }
      if (result.applicato && result.scritture.some((write) => write.bundle)) {
        try {
          await hooks.reloadProvider();
        } catch (error) {
          notify(t("settings.components.reload_failed", { reason: errorText(error) }), "guasto");
        }
      }
    } catch (error) {
      if (!lifetime.closed) profileFailed(errorText(error));
    } finally {
      lifetime.close();
    }
  };

  lifetime.listen(go, "click", () => void apply(chosen));
  // Un altro vault al posto di questo: la domanda non è più sua.
  lifetime.add(on("vault", () => {
    if (state.vaultRoot !== root && !busy) lifetime.close();
  }));
  lifetime.add(onLanguage(() => {
    if (!busy) draw();
  }));

  draw();
  onboarding.append(screen);
  onboarding.dataset.step = "profile";
  lifetime.add(() => {
    screen.remove();
    if (onboarding.dataset.step === "profile") delete onboarding.dataset.step;
  });
  // Esc vale «Studio»: applica il consigliato e apre, come «Continua» su di lui.
  lifetime.add(trapFocus(screen, () => void apply(recommended.nome)));
  row.querySelector<HTMLElement>(`[data-profile="${CSS.escape(chosen)}"]`)?.focus();
  return finished;
}

/// L'id della lavagna: una scrittura sua vuol dire che il vault si rimonta
/// (`ComponentOutcome` in `host/contract.ts`).
const LAVAGNA = "fub.lavagna";

function profileFailed(reason: string): void {
  notify(t("onboarding.profile.failed", { reason }), "guasto");
}

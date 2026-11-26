// Il modulo «Impostazioni»: la scheda dei componenti, col catalogo e i permessi.
import { api } from "../host/ipc";
import { pickFile, pickFolder } from "../host/dialog";
import { confirm } from "../platform/confirm";
import { settings } from "../host/query";
import type { BundleInfo, InstalledPluginInfo, CatalogEntry, SettingEntry } from "../host/contract";
import { state } from "../state/store";
import { notify } from "../ui/notify";
import { TRUST_LABELS, rows, type PermissionRow } from "../ui/permissions";
import { errorText } from "../host/errors";
import { plural, t, type Key } from "../i18n/strings";
import { show } from "./settings-model";
import { composingKey } from "../kit/ime";
import {
  type EntryMap,
  blockedRows,
  componentsGeneration,
  componentsPage,
  panelEl,
  pendingRows,
  release,
  render,
  rowErrorNode,
  rowErrors,
  rowPending,
  sectionBlock,
  settingsHooks,
  tab,
  writeRow,
} from "./settings";
import { row } from "./settings-vault";
import { blockHead } from "./settings-form";
import { switchInput } from "./settings-fields";

// --- la scheda dei componenti -----------------------------------------------

const pendingComponents = new Set<string>();

export async function renderComponents(): Promise<HTMLElement[]> {
  // L'inventario installato non viene ricavato dai bundle runtime: così restano
  // visibili anche una scelta negata, un componente spento e un vault chiuso.
  // Le letture legate al vault sono indipendenti: se non c'è un guest, la loro
  // diagnosi non deve trasformare l'inventario macchina in una scheda vuota.
  const [installedResult, bundleResult, entryResult, budgetResult, limitedResult] = await Promise.allSettled([
    api.listInstalledPlugins(state.vaultRoot || undefined),
    api.listBundles(),
    settings(),
    Promise.resolve().then(() => api.pluginBudgetSnapshot()),
    Promise.resolve().then(() => api.pluginLimitedMode()),
    componentsPage.show(),
  ]);
  const installed = installedResult.status === "fulfilled" ? installedResult.value : [];
  const bundles = bundleResult.status === "fulfilled" ? bundleResult.value : [];
  const entries = entryResult.status === "fulfilled" ? entryResult.value : [];
  const forKey = new Map(entries.map((entry) => [entry.spec.key, entry]));
  // `runtime_known` è la prova del claim dell'installazione. Un filtro per solo
  // id nasconderebbe invece una feature ufficiale omonima, proprio quando
  // l'installazione è stata rifiutata per collisione.
  const installedRuntimeIds = new Set(
    installed.filter((plugin) => plugin.runtime_known).map((plugin) => plugin.id),
  );
  const native = bundles.filter(
    (bundle) => bundle.kind === "component" && !installedRuntimeIds.has(bundle.id),
  );
  // Lo stato del runtime in poche righe brevi in cima: diagnostica, non
  // contenuto, e non deve pesare quanto i componenti.
  const notes = document.createElement("div");
  notes.className = "settings-note";
  const status = document.createElement("div");
  status.className = "settings-status";
  status.setAttribute("aria-label", t("settings.components.runtime"));
  status.setAttribute("role", "group");
  if (limitedResult.status === "fulfilled") {
    status.append(row("setting-source", limitedResult.value.enabled
      ? t("settings.components.limited_on", { reason: limitedResult.value.reason ?? t("settings.components.limited_default") })
      : t("settings.components.limited_off")));
  } else status.append(row("setting-source", t("settings.components.limited_unavailable", { reason: errorText(limitedResult.reason) })));
  if (budgetResult.status === "fulfilled") {
    const b = budgetResult.value;
    status.append(row("setting-source", t("settings.components.budget", {
      live: b.live_instances, calls: b.total_calls, timeouts: b.timed_out_calls, oom: b.oom_calls,
    })));
  } else status.append(row("setting-source", t("settings.components.budget_unavailable", { reason: errorText(budgetResult.reason) })));
  if (bundleResult.status === "rejected") {
    status.append(row("setting-source", t("settings.read_failed", { reason: errorText(bundleResult.reason) })));
  }
  if (entryResult.status === "rejected") {
    status.append(row("setting-source", t("settings.read_failed", { reason: errorText(entryResult.reason) })));
  }
  notes.append(status);
  const nodes: HTMLElement[] = [componentsPage.element, notes];
  let index = 0;

  const add = sectionBlock(t("settings.components.add"), index++, { card: false });
  const installCard = document.createElement("div");
  installCard.className = "settings-card";
  installCard.append(installAction());
  add.body.append(installCard, renderCatalogSearch(installed));
  nodes.push(add.section);

  const guarded = native.filter((bundle) => rows(bundle).length > 0);
  if (guarded.length > 0) {
    const bundled = sectionBlock(t("settings.components.bundled_permissions"), index++, { card: false });
    for (const bundle of guarded) bundled.body.append(renderBundlePermissions(bundle, forKey));
    nodes.push(bundled.section);
  }

  const mine = sectionBlock(t("settings.components.installed"), index++, { card: false });
  if (installedResult.status === "rejected") {
    mine.body.append(row("muted settings-note", t("settings.read_failed", { reason: errorText(installedResult.reason) })));
  } else if (installed.length === 0) {
    mine.body.append(row("muted settings-note", t("settings.components.installed.none")));
  } else {
    for (const plugin of installed) mine.body.append(renderInstalledComponent(plugin, forKey));
  }
  nodes.push(mine.section);
  return nodes;
}

function renderCatalogSearch(installed: InstalledPluginInfo[]): HTMLElement {
  const panel = document.createElement("section");
  panel.className = "settings-card settings-catalog";
  const head = document.createElement("div");
  head.className = "setting-row setting-block";
  blockHead(head, t("settings.catalog.title"), t("settings.catalog.hint"));
  panel.append(head);
  const search = document.createElement("input");
  search.type = "search";
  search.className = "setting-input";
  search.placeholder = t("settings.catalog.search_placeholder");
  search.setAttribute("aria-label", t("settings.catalog.search"));
  const run = document.createElement("button");
  run.type = "button";
  run.className = "settings-btn";
  run.textContent = t("settings.catalog.run");
  const status = row("setting-source", "");
  status.setAttribute("role", "status");
  const results = document.createElement("div");
  results.className = "settings-catalog-results";
  const generation = componentsGeneration;
  let request = 0;
  run.addEventListener("click", () => {
    const mine = ++request;
    run.disabled = true;
    status.textContent = t("settings.catalog.checking");
    void Promise.resolve().then(() => api.catalogSearch(search.value)).then((entries) => {
      if (generation !== componentsGeneration || mine !== request || !panel.isConnected) return;
      results.replaceChildren(...entries.map((entry) => renderCatalogEntry(entry, installed)));
      status.textContent = t("settings.catalog.count", { count: entries.length });
    }).catch((error: unknown) => {
      if (generation === componentsGeneration && mine === request && panel.isConnected) {
        status.textContent = t("settings.catalog.unavailable", { reason: errorText(error) });
      }
    }).finally(() => {
      if (generation === componentsGeneration && mine === request) run.disabled = false;
    });
  });
  search.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !composingKey(event)) { event.preventDefault(); run.click(); }
  });
  const form = document.createElement("div");
  form.className = "settings-actions";
  form.append(search, run);
  head.append(form, status);
  panel.append(results);
  return panel;
}

function renderCatalogEntry(entry: CatalogEntry, installed: InstalledPluginInfo[]): HTMLElement {
  const item = document.createElement("section");
  item.className = "setting-row";
  const details = document.createElement("div");
  details.className = "setting-text";
  details.append(
    row("setting-label", `${entry.name} · ${entry.version} · ${entry.kind}`),
    row("setting-source", t("settings.catalog.provenance", { publisher: entry.provenance, license: entry.license, compatible: String(entry.compatible) })),
    row("setting-source", t("settings.catalog.digest", { digest: entry.digest, size: String(entry.size), abi: String(entry.abi) })),
    row("setting-source", entry.revoked
      ? t("settings.catalog.revoked")
      : t("settings.catalog.permissions", { permissions: entry.permissions.join(", ") || t("settings.catalog.no_permissions") })),
  );
  item.append(details);
  const buttons = document.createElement("div");
  buttons.className = "setting-control settings-actions";
  item.append(buttons);
  const current = installed.find((plugin) => plugin.id === entry.id);
  const action = (label: string, operation: (source: string) => Promise<unknown>, requiresSource = true, danger = false) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = danger ? "settings-btn settings-btn--danger" : "settings-btn";
    button.textContent = label;
    button.addEventListener("click", () => {
      const generation = componentsGeneration;
      button.disabled = true;
      void (async () => {
        const accepted = await confirm(t(entry.revoked ? "settings.catalog.confirm_revoked" : "settings.catalog.confirm", { action: label, name: entry.name, version: entry.version, publisher: entry.provenance, license: entry.license, digest: entry.digest }), {
          title: label, okLabel: label, danger,
        });
        if (!accepted || generation !== componentsGeneration || !item.isConnected) return;
        const source = requiresSource
          ? entry.kind === "theme" ? await pickFolder() : await pickFile()
          : "";
        if (requiresSource && source === null) return;
        if (generation !== componentsGeneration || !item.isConnected) return;
        await completeComponentAction(`catalog:${entry.id}`, [item],
          () => operation(source ?? ""), "settings.component_not_changed");
      })().catch((error: unknown) =>
        notify(t("settings.catalog.failed", { reason: errorText(error) }), "guasto"))
        .finally(() => { if (item.isConnected) button.disabled = false; });
    });
    buttons.append(button);
  };
  if (!entry.revoked) {
    if (entry.kind === "plugin") {
      if (!current) action(t("settings.catalog.install"), (source) => api.catalogInstall(entry.id, entry.version, source));
      else {
        action(t("settings.catalog.update"), (source) => api.catalogUpdate(current.installation, entry.version, source));
        action(t("settings.catalog.rollback"), (source) => api.catalogRollback(current.installation, entry.version, source));
      }
    } else {
      action(t("settings.catalog.install_theme"), (source) => api.catalogInstallTheme(entry.id, entry.version, source));
      action(t("settings.catalog.update_theme"), (source) => api.catalogUpdateTheme(entry.id, entry.version, source));
      action(t("settings.catalog.rollback_theme"), (source) => api.catalogRollbackTheme(entry.id, entry.version, source));
    }
  } else if (entry.kind === "plugin" && current) {
    action(t("settings.catalog.revoke"), () => api.catalogRevoke(current.installation), false, true);
  } else if (entry.kind === "theme") {
    action(t("settings.catalog.revoke_theme"), () => api.catalogRevokeTheme(entry.id), false, true);
  }
  return item;
}

function installAction(): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row";
  const text = document.createElement("div");
  text.className = "setting-text";
  const label = document.createElement("div");
  label.className = "setting-label";
  label.textContent = t("settings.components.install");
  text.append(label, row("muted", t("settings.components.install.hint")));
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-btn";
  button.textContent = t("settings.components.install.pick");
  button.disabled = pendingComponents.has("install");
  button.addEventListener("click", () => {
    if (pendingComponents.has("install")) return;
    const generation = componentsGeneration;
    pendingComponents.add("install");
    setPending([el], true);
    void (async () => {
      const path = await pickFile().catch((error: unknown) => {
        notify(t("settings.components.install_failed", { reason: errorText(error) }), "guasto");
        return null;
      });
      if (
        path === null ||
        generation !== componentsGeneration ||
        release === null ||
        panelEl.hidden ||
        tab !== "components"
      ) {
        pendingComponents.delete("install");
        if (generation === componentsGeneration && el.isConnected) await render();
        return;
      }
      await completeComponentAction(
        "install",
        [el],
        () => api.installPlugin(path),
        "settings.components.install_failed",
      );
    })();
  });
  const control = document.createElement("div");
  control.className = "setting-control";
  control.append(button);
  el.append(text, control);
  return el;
}

/// I riquadri aperti, per chiave: il corpo si ridisegna intero a ogni
/// scrittura e a ogni `setting_changed`, e un riquadro che si richiude da solo
/// porta via il controllo appena usato, il suo esito e il fuoco. La chiusura del
/// pannello li dimentica.
export const openDetails = new Set<string>();

/// Un riquadro che si apre e che ricorda di essere aperto. `force` lo apre
/// comunque: una riga dentro che sta scrivendo, o che ha fallito, deve restare
/// in vista col suo esito.
export function openableDetails(key: string, summaryText: string, force = false): { details: HTMLDetailsElement; body: HTMLElement } {
  const details = document.createElement("details");
  details.className = "settings-details";
  details.dataset.detailsKey = key;
  details.open = force || openDetails.has(key);
  if (details.open) openDetails.add(key);
  const summary = document.createElement("summary");
  summary.textContent = summaryText;
  const body = document.createElement("div");
  body.className = "settings-details-body";
  details.append(summary, body);
  details.addEventListener("toggle", () => {
    if (details.open) openDetails.add(key);
    else openDetails.delete(key);
  });
  return { details, body };
}

/// I permessi di un componente in un riquadro che si apre: il sommario dice
/// quanti sono, così un componente che chiede molto si riconosce senza aprirlo.
function permissionDetails(
  key: string,
  permissions: PermissionRow[],
  hints: string[],
  draw: (permission: PermissionRow) => HTMLElement,
): HTMLElement {
  if (permissions.length === 0) return row("muted setting-component-note", t("settings.permissions.none"));
  const busy = permissions.some((permission) => pendingRows.has(permission.key) || rowErrors.has(permission.key));
  const { details, body: inside } = openableDetails(
    `permissions:${key}`,
    plural(permissions.length, "settings.components.permissions.count.one", "settings.components.permissions.count"),
    busy,
  );
  for (const hint of hints) inside.append(row("muted", hint));
  for (const permission of permissions) inside.append(draw(permission));
  return details;
}

/// I permessi di un componente distribuito con Fub. Acceso e spento si
/// decidono nella pagina «Componenti» qui sopra (`components_apply`): qui
/// restano soltanto le preferenze granulari dei permessi, che sono sicurezza e
/// non scelta di che cosa usare.
function renderBundlePermissions(bundle: BundleInfo, forKey: EntryMap): HTMLElement {
  const card = document.createElement("div");
  card.className = "settings-card settings-component";
  card.dataset.bundlePermissions = bundle.id;
  const text = document.createElement("div");
  text.className = "setting-text";
  const label = document.createElement("span");
  label.className = "setting-label";
  label.textContent = bundle.name;
  text.append(label, row("muted", `${bundle.id} · ${t(TRUST_LABELS[bundle.trust])}`));
  card.append(text);
  const hints = [t("settings.permissions.hint")];
  if (!bundle.mounted) hints.push(t("settings.permissions.off_hint"));
  card.append(permissionDetails(`bundle:${bundle.id}`, rows(bundle), hints, (permission) => renderPermission(permission, forKey.get(permission.key))));
  return card;
}

const CONSENT_LABELS: Record<InstalledPluginInfo["consent"], Key> = {
  undecided: "settings.components.consent.undecided",
  denied: "settings.components.consent.denied",
  granted: "settings.components.consent.granted",
};

function renderInstalledComponent(plugin: InstalledPluginInfo, forKey: EntryMap): HTMLElement {
  const key = `installed:${plugin.installation}`;
  const pending = pendingComponents.has(key);
  const card = document.createElement("div");
  card.className = "settings-card settings-component";
  const nodes = [card];

  const header = document.createElement("div");
  header.className = "setting-row";
  const text = document.createElement("div");
  text.className = "setting-text";
  const name = document.createElement("div");
  name.className = "setting-label";
  name.setAttribute("role", "heading");
  name.setAttribute("aria-level", "4");
  name.textContent = plugin.name;
  text.append(
    name,
    row(
      "muted",
      t("settings.components.identity", {
        id: plugin.id,
        version: plugin.version,
        trust: t(TRUST_LABELS[plugin.trust]),
      }),
    ),
    row(
      "setting-source",
      t(plugin.mounted ? "settings.components.runtime.mounted" : "settings.components.runtime.off"),
    ),
  );
  if (plugin.catalog) text.append(
    row("setting-source", t("settings.components.signed", {
      key: plugin.catalog.key_id,
      generation: plugin.catalog.generation,
      publisher: plugin.catalog.publisher,
      license: plugin.catalog.license,
      compatible: plugin.catalog.compatible,
      url: plugin.catalog.url,
    })),
  );
  if (plugin.revoked) text.append(
    row("setting-source", plugin.revocation
      ? t("settings.components.revoked_signed", { key: plugin.revocation.key_id, generation: plugin.revocation.generation })
      : t("settings.components.revoked")),
  );
  header.append(text);
  card.append(header);

  const enabledRow = document.createElement("div");
  enabledRow.className = "setting-row";
  const enabledText = document.createElement("div");
  enabledText.className = "setting-text";
  const enabledLabel = document.createElement("label");
  const enabledId = `installed-enabled-${plugin.installation}`;
  enabledLabel.htmlFor = enabledId;
  enabledLabel.textContent = t("settings.components.enabled");
  enabledText.append(enabledLabel, row("muted", t("settings.components.enabled.hint")));
  const enabled = switchInput(enabledId, plugin.enabled);
  enabled.disabled = pending || plugin.revoked;
  enabled.addEventListener("change", () => {
    beginComponentAction(
      key,
      nodes,
      () => api.setInstalledPluginEnabled(plugin.installation, enabled.checked),
      "settings.components.enabled_failed",
    );
  });
  const enabledControl = document.createElement("div");
  enabledControl.className = "setting-control";
  enabledControl.append(enabled);
  enabledRow.append(enabledText, enabledControl);
  card.append(enabledRow);

  const consentRow = document.createElement("div");
  consentRow.className = "setting-row";
  const consentText = document.createElement("div");
  consentText.className = "setting-text";
  const consentLabel = document.createElement("label");
  const consentId = `installed-consent-${plugin.installation}`;
  consentLabel.htmlFor = consentId;
  consentLabel.textContent = t("settings.components.consent");
  consentText.append(consentLabel, row("muted", t("settings.components.consent.hint")));
  const consent = document.createElement("select");
  consent.className = "setting-select";
  consent.id = consentId;
  consent.disabled = pending;
  for (const value of ["undecided", "denied", "granted"] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = t(CONSENT_LABELS[value]);
    option.selected = value === plugin.consent;
    consent.append(option);
  }
  consent.addEventListener("change", () => {
    const next = consent.value as InstalledPluginInfo["consent"];
    const apply = () => beginComponentAction(
      key,
      nodes,
      () => api.setInstalledPluginConsent(plugin.installation, next),
      "settings.components.consent_failed",
    );
    if (next !== "granted") {
      apply();
      return;
    }
    // Il consenso è il momento in cui il componente ottiene i suoi permessi:
    // li si legge lì, nella domanda, e non solo nell'elenco sotto la riga.
    const asked = rows(plugin).map((permission) =>
      permission.detail ? `• ${permission.message} (${permission.detail})` : `• ${permission.message}`);
    void confirm(
      t("settings.components.consent.confirm", {
        name: plugin.name,
        permissions: asked.length > 0 ? asked.join("\n") : t("settings.permissions.none"),
      }),
      { title: t("settings.components.consent.confirm_title"), okLabel: t("settings.components.consent.grant") },
    ).then((accepted) => {
      if (accepted && consent.isConnected) apply();
      else consent.value = plugin.consent;
    }, () => { consent.value = plugin.consent; });
  });
  const consentControl = document.createElement("div");
  consentControl.className = "setting-control";
  consentControl.append(consent);
  consentRow.append(consentText, consentControl);
  card.append(consentRow);

  card.append(permissionDetails(
    `installed:${plugin.installation}`,
    rows(plugin),
    [t("settings.components.permissions.hint")],
    (permission) => renderPermission(permission, plugin.runtime_known ? forKey.get(permission.key) : undefined),
  ));

  const removeRow = document.createElement("div");
  removeRow.className = "setting-row";
  const removeText = document.createElement("div");
  removeText.className = "setting-text";
  const removeLabel = document.createElement("div");
  removeLabel.className = "setting-label";
  removeLabel.textContent = t("settings.components.remove");
  removeText.append(removeLabel, row("muted", t("settings.components.remove.hint")));
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "settings-btn settings-btn--danger";
  remove.textContent = t("settings.components.remove");
  remove.disabled = pending || plugin.enabled;
  if (plugin.enabled) {
    remove.setAttribute("aria-describedby", `installed-remove-hint-${plugin.installation}`);
    const disabledHint = row("setting-source", t("settings.components.remove.disabled"));
    disabledHint.id = `installed-remove-hint-${plugin.installation}`;
    removeText.append(disabledHint);
  }
  remove.addEventListener("click", () => {
    if (plugin.enabled || pendingComponents.has(key)) return;
    pendingComponents.add(key);
    setPending(nodes, true);
    void (async () => {
      const accepted = await confirm(t("settings.components.remove.confirm", { name: plugin.name }), {
        title: t("settings.components.remove.title"),
        okLabel: t("settings.components.remove"),
        danger: true,
      }).catch((error: unknown) => {
        notify(t("settings.components.remove_failed", { reason: errorText(error) }), "guasto");
        return false;
      });
      if (!accepted || !remove.isConnected || tab !== "components" || release === null) {
        pendingComponents.delete(key);
        if (remove.isConnected && release !== null && tab === "components") await render();
        return;
      }
      await completeComponentAction(
        key,
        nodes,
        () => api.removeInstalledPlugin(plugin.installation),
        "settings.components.remove_failed",
      );
    })();
  });
  const removeControl = document.createElement("div");
  removeControl.className = "setting-control";
  removeControl.append(remove);
  removeRow.append(removeText, removeControl);
  card.append(removeRow);
  if (pending) card.setAttribute("aria-busy", "true");
  return card;
}

function beginComponentAction(
  key: string,
  nodes: HTMLElement[],
  action: () => Promise<unknown>,
  failure: Key,
): void {
  if (pendingComponents.has(key)) return;
  pendingComponents.add(key);
  setPending(nodes, true);
  void completeComponentAction(key, nodes, action, failure);
}

async function completeComponentAction(
  key: string,
  nodes: HTMLElement[],
  action: () => Promise<unknown>,
  failure: Key,
): Promise<void> {
  try {
    const result = await action();
    const diagnostics = Array.isArray(result)
      ? result
      : result && typeof result === "object" && "diagnostics" in result && Array.isArray(result.diagnostics)
        ? result.diagnostics
        : [];
    for (const diagnostic of diagnostics) notify(errorText(diagnostic), "guasto");
  } catch (error) {
    notify(t(failure, { reason: errorText(error) }), "guasto");
  }
  try {
    await settingsHooks.reloadProvider();
  } catch (error) {
    notify(t("settings.components.reload_failed", { reason: errorText(error) }), "guasto");
  }
  pendingComponents.delete(key);
  if (release !== null && !panelEl.hidden && tab === "components") {
    await render();
  } else {
    setPending(nodes, false);
  }
}

function setPending(nodes: HTMLElement[], pending: boolean): void {
  for (const node of nodes) {
    node.setAttribute("aria-busy", String(pending));
    for (const control of node.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
      "input, select, button",
    )) {
      control.disabled = pending;
    }
  }
}

/// Una riga di permesso: la frase, il suo parametro e l'interruttore granulare
/// quando l'owner runtime corrisponde e la relativa impostazione esiste.
function renderPermission(p: PermissionRow, entry: SettingEntry | undefined): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row setting-permission";
  // Stessa identità delle righe di configurazione: il watcher `setting_changed`
  // cancella l'errore per chiave, e il focus torna qui (A03).
  el.dataset.settingKey = p.key;
  const text = document.createElement("div");
  text.className = "setting-text";
  const interactive = entry !== undefined && p.known;
  const description = document.createElement(interactive ? "label" : "div");
  description.textContent = p.message;
  if (interactive) (description as HTMLLabelElement).htmlFor = `permission-${p.key}`;
  text.append(description);
  if (p.detail) text.append(row("setting-source", p.detail));
  el.append(text);

  if (!p.known || !entry) return el;
  const pending = pendingRows.has(p.key);
  const failure = rowErrors.get(p.key);
  if (pending) el.setAttribute("aria-busy", "true");

  const granted = entry.value !== false;
  const input = switchInput(`permission-${p.key}`, granted);
  input.setAttribute("aria-label", t("settings.permission.grant", { cosa: p.message }));
  input.addEventListener("change", () => {
    void writeRow(p.key, show(input.checked), () => api.setSetting(p.key, input.checked), { failure: "settings.permission_not_changed" });
  });
  const control = document.createElement("div");
  control.className = "setting-control";
  control.append(input);
  el.append(control);
  if (pending) {
    text.append(rowPending());
    if (blockedRows.has(p.key)) input.disabled = true;
  } else if (failure) text.append(rowErrorNode(failure));
  if (!granted) text.append(row("setting-source", t("settings.permission.denied")));
  return el;
}

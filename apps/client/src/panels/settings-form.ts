// Il modulo «Impostazioni»: il modulo delle righe, i profili, il catalogo dei temi.
import { api } from "../host/ipc";
import { confirm } from "../platform/confirm";
import { settings } from "../host/query";
import type { SettingEntry, ThemeInfo, SettingScope } from "../host/contract";
import { state } from "../state/store";
import { notify } from "../ui/notify";
import { TRUST_LABELS } from "../ui/permissions";
import { SETTINGS_WITH_THEIR_OWN_GESTURE } from "../ui/shell-ids.generated";
import { errorText } from "../host/errors";
import { LANGUAGE_KEY, t } from "../i18n/strings";
import {
  MOTION_KEY,
  THEME_KEY,
  cancelThemePreview,
  currentThemeId,
  currentThemePreview,
  previewTheme,
  refreshThemeLink,
  selectTheme,
  themeCatalog,
} from "../theme/theme";
import { setTooltip } from "../ui/tooltip";
import {
  DEVELOPER_MODE_KEY,
  installFolderButton,
  linkFolderButton,
  renderDiagnosis,
  renderLinkedFolder,
  themeDiagnoses,
} from "./theme-folder";
import { loadCatalogPage } from "../dev/catalogo/carica";
import {
  CSS_SNIPPETS_KEY,
  DEFAULT_CSS_SNIPPETS,
  cancelCssSnippetsPreview,
  cssSnippetCatalog,
  disableCssSnippet,
  parseCssSnippets,
  previewCssSnippets,
  saveCssSnippets,
} from "../theme/snippets";
import { isModified, normalizeSearch, searchText } from "./settings-model";
import { DRAW_ENGINE_SETTING, motoreVisibile, riempiMotore } from "./settings-motore";
import {
  type FormSnapshot,
  type Group,
  formRows,
  formSnapshots,
  groupEntries,
  installRadioGroup,
  markModified,
  openedLifetime,
  render,
  rowSignature,
  schemaOf,
  sectionBlock,
  settingsLifetime,
  settleRadioGroup,
  write,
} from "./settings";
import { row } from "./settings-vault";
import { loadOwnListFields, renderRow } from "./settings-fields";
import { openableDetails } from "./settings-components";

// --- la scheda delle impostazioni -------------------------------------------

/// Le chiavi che sono **scorciatoie**, e non righe di configurazione.
///
/// Non si riconoscono dal prefisso della chiave — sarebbe indovinare — ma
/// componendole: per ogni comando si sa quale chiave gli è stata fabbricata,
/// perché la regola è una sola e sta scritto in `keybindingKey` (§18.2). È la
/// stessa mossa con cui questa shell riconosce qualunque altra cosa attraversi
/// il confine: rifà il conto invece di leggere una convenzione.
/// **Tutti i comandi**, e non più i soli comandi del kernel: da quando anche
export async function renderForm(): Promise<HTMLElement[]> {
  // Le scorciatoie **non stanno qui**: sono impostazioni come le altre, e
  // proprio per questo sarebbero venti righe senza gruppo in fondo alla scheda
  // della configurazione. Hanno una scheda loro, ed è la stessa forma — un
  // campo di testo, una sourceLabel, un «azzera» — perché è la stessa cosa.
  // E nemmeno i **permessi** (§23.17), per la stessa ragione e con lo stesso
  // conto rifatto: sono impostazioni come le altre, quindi finirebbero qui
  // come settanta righe senza gruppo la cui etichetta è una chiave nuda. Le
  // disegna la scheda dei componenti, accanto a chi le ha chieste, che è
  // l'unico posto in cui significano qualcosa.
  const all = await settings();
  const entries = formRows(all);
  // Le preferenze del motore del disegno non sono una riga: sono il riquadro
  // «Motore del disegno» nel gruppo dei disegni (`settings-motore.ts`).
  const motore = all.find((entry) => entry.spec.key === DRAW_ENGINE_SETTING);
  const vault = state.vaultRoot;
  const conMotore = motore !== undefined && motoreVisibile(vault) ? motore : null;
  const nodes: HTMLElement[] = [];
  if (entries.length === 0) nodes.push(row("muted settings-note", t("settings.none")));
  const themes = await themeCatalog().catch(() => []);
  await loadOwnListFields(entries);
  const groups = groupEntries(entries);
  // Ciò che ogni riga mostra si annota quando la riga si disegna: fra una riga
  // e l'altra può finire una scrittura in volo.
  const snapshot: FormSnapshot = { schema: schemaOf(entries), rows: new Map() };
  for (const [index, group] of groups.entries()) {
    const parts = sectionBlock(group.title, index);
    const changed = group.rows.filter(isModified);
    markModified(parts, changed.length);
    const reset = groupReset(group, changed);
    if (reset) parts.head.append(reset);
    for (const entry of group.rows) {
      snapshot.rows.set(entry.spec.key, rowSignature(entry));
      // I frammenti CSS e il catalogo dei temi sono blocchi, non righe, e
      // stanno **nel loro gruppo**: in fondo al form finivano sotto
      // «Diagnostica», lontani dall'aspetto che cambiano.
      if (entry.spec.key === CSS_SNIPPETS_KEY) {
        parts.body.append(renderCssSnippets(entry));
        continue;
      }
      const item = renderFormRow(entry);
      if (entry.spec.key === FRAME_KEY) await decorateFrame(item, entry);
      parts.body.append(item);
    }
    if (group.rows.some((entry) => entry.spec.key === THEME_KEY)) {
      // Con la modalità sviluppatore il blocco c'è anche senza temi
      // installati: è da lì che se ne installa uno.
      const developer = entries.some((entry) => entry.spec.key === DEVELOPER_MODE_KEY && entry.value === true);
      if (themes.length > 0 || developer) parts.body.append(renderThemeCatalog(themes, developer));
      // La cartella collegata si chiede all'host a ogni disegno: è lui che la
      // guarda, e la storia dei rimontaggi resta in `theme/theme.ts`.
      const link = developer ? await refreshThemeLink().catch(() => null) : null;
      const owner = settingsLifetime;
      if (link !== null && owner) parts.body.append(renderLinkedFolder({ lifetime: owner, rerender: render }, link));
      for (const diagnosis of themeDiagnoses()) parts.body.append(renderDiagnosis(diagnosis));
    }
    if (conMotore !== null && group.title === conMotore.spec.group) await appendMotore(parts.body, conMotore);
    nodes.push(parts.section);
  }
  // Il gruppo dei disegni senza altre righe da mostrare: il riquadro ha la
  // sezione sua, con lo stesso titolo.
  let sections = groups.length;
  if (conMotore !== null && !groups.some((group) => group.title === conMotore.spec.group)) {
    const parts = sectionBlock(conMotore.spec.group || t("settings.group.other"), sections++);
    await appendMotore(parts.body, conMotore);
    nodes.push(parts.section);
  }
  nodes.push(await renderProfiles(sections));
  formSnapshots.set(nodes, snapshot);
  return nodes;
}

/// Il riquadro «Motore del disegno» in fondo al gruppo dei disegni.
async function appendMotore(body: HTMLElement, entry: SettingEntry): Promise<void> {
  const owner = settingsLifetime;
  const vault = state.vaultRoot;
  if (!owner || owner.closed || !motoreVisibile(vault)) return;
  await riempiMotore(body, entry, { vault, vita: owner, ridisegna: () => void render() });
}

/// Le chiavi che hanno un gesto loro altrove, e che nel form generico sarebbero
/// un campo da non toccare a mano. L'elenco arriva generato da chi le possiede
/// (`fub_host::shell::SETTINGS_WITH_THEIR_OWN_GESTURE`): i tipi delle proprietà,
/// per esempio, sono del kernel e non della shell.
export const MANAGED_ELSEWHERE = new Set(SETTINGS_WITH_THEIR_OWN_GESTURE);

/// La cornice della finestra: le sue scelte dipendono da ciò che il sistema
/// offre, e cambiarla può chiedere di riaprire la finestra.
const FRAME_KEY = "chrome.frame";

/// Le chiavi il cui valore cambia più della loro riga: il tema (il catalogo
/// accanto), i frammenti CSS (un blocco, non una riga), la cornice (le scelte
/// dipendono dal sistema e dall'avviso di riapertura) e la lingua (tutte le
/// parole).
export const WHOLE_FORM_KEYS = new Set([THEME_KEY, CSS_SNIPPETS_KEY, FRAME_KEY, LANGUAGE_KEY]);

/// Una riga della scheda della configurazione con le sue note: la stessa nel
/// disegno intero e nell'aggiornamento per riga, che sennò la perderebbe. La
/// cornice no: è in `WHOLE_FORM_KEYS`, e la sua veste chiede all'host.
export function renderFormRow(entry: SettingEntry): HTMLElement {
  const item = renderRow(entry);
  if (entry.spec.key === MOTION_KEY) decorateMotion(item, entry);
  return item;
}

async function decorateFrame(item: HTMLElement, entry: SettingEntry): Promise<void> {
  const [capabilities, reopen] = await Promise.allSettled([
    Promise.resolve().then(() => api.frameCapabilities()),
    Promise.resolve().then(() => api.settingRequiresReopen(entry.spec.key)),
  ]);
  const text = item.querySelector(".setting-text");
  const control = item.querySelector<HTMLElement>("select, [role=radiogroup]");
  const choices = [...item.querySelectorAll<HTMLOptionElement | HTMLButtonElement>("option, button[data-choice]")];
  const valueOf = (choice: HTMLOptionElement | HTMLButtonElement) =>
    choice instanceof HTMLOptionElement ? choice.value : choice.dataset.choice ?? "";
  if (capabilities.status === "fulfilled") {
    for (const choice of choices) {
      // Solo spegnere: una scelta che il sistema non offre non si sceglie; le
      // altre restano come le ha disegnate la riga.
      if (valueOf(choice) === "system" && !capabilities.value.system) choice.disabled = true;
      if (valueOf(choice) === "custom" && !capabilities.value.custom) choice.disabled = true;
    }
    if (!capabilities.value.system && !capabilities.value.custom) disableControl(control);
  } else {
    disableControl(control);
    text?.append(row("setting-source", t("settings.frame.unavailable", { reason: errorText(capabilities.reason) })));
  }
  if (reopen.status === "fulfilled" && reopen.value) {
    text?.append(row("setting-source", t("settings.frame.reopen")));
  }
  if (control?.getAttribute("role") === "radiogroup") settleRadioGroup(control);
}

/// Il perché del valore di partenza delle animazioni, quando non è «segue il
/// sistema». Il default lo decide l'host (`fub_host::settings::motion_default`),
/// e oggi è «ridotte» per una sola ragione: la WebKitGTK di questo sistema
/// sfarfalla dopo un'animazione. Un'altra ragione domani vorrà la sua frase.
function decorateMotion(item: HTMLElement, entry: SettingEntry): void {
  if (entry.spec.kind.kind !== "choice" || entry.spec.kind.default !== "reduced") return;
  const note = row("setting-source", t("settings.motion.webkitgtk_default"));
  note.id = `setting-${entry.spec.key}-default-why`;
  item.querySelector(".setting-text")?.append(note);
  const control = item.querySelector<HTMLElement>("select, [role=radiogroup]");
  const existing = control?.getAttribute("aria-describedby");
  control?.setAttribute("aria-describedby", [existing, note.id].filter(Boolean).join(" "));
}

function disableControl(control: HTMLElement | null): void {
  if (!control) return;
  if (control instanceof HTMLSelectElement) {
    control.disabled = true;
    return;
  }
  control.setAttribute("aria-disabled", "true");
  for (const button of control.querySelectorAll<HTMLButtonElement>("button")) button.disabled = true;
}

/// «Ripristina gruppo», quando nel gruppo c'è qualcosa di diverso dal default:
/// riportare indietro una sezione intera era un «Azzera» riga per riga.
export function groupReset(group: Group, changed: SettingEntry[]): HTMLButtonElement | null {
  if (changed.length === 0) return null;
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "link-button settings-section-reset";
  reset.textContent = t("settings.group.reset");
  setTooltip(reset, t("settings.group.reset.hint", { group: group.title }));
  reset.addEventListener("click", () => {
    void (async () => {
      const accepted = await confirm(
        t("settings.group.reset.confirm", { group: group.title, count: changed.length }),
        { title: t("settings.group.reset"), okLabel: t("settings.group.reset.ok"), danger: true },
      );
      if (!accepted || settingsLifetime?.closed) return;
      await write(async () => {
        for (const entry of changed) await api.resetSetting(entry.spec.key);
      });
    })();
  });
  return reset;
}

/// Un blocco dentro una scheda: titolo e prosa in alto, il contenuto sotto a
/// tutta larghezza. È la forma del catalogo dei temi e dei frammenti CSS, che
/// non stanno in una colonna di controllo.
export function blockHead(el: HTMLElement, title: string, hint: string): HTMLElement {
  const text = document.createElement("div");
  text.className = "setting-text";
  const name = document.createElement("div");
  name.className = "setting-label";
  name.setAttribute("role", "heading");
  name.setAttribute("aria-level", "4");
  name.textContent = title;
  text.append(name, row("muted", hint));
  el.append(text);
  return text;
}

function renderCssSnippets(entry: SettingEntry): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "setting-row setting-block";
  panel.dataset.settingKey = CSS_SNIPPETS_KEY;
  panel.dataset.search = searchText(entry, entry.spec.label, t("settings.css.hint"));
  if (isModified(entry)) panel.dataset.modified = "true";
  blockHead(panel, entry.spec.label, t("settings.css.hint"));
  const source = document.createElement("textarea");
  source.className = "setting-code";
  // L'id è l'identità del campo fra due ridisegni: con lui tornano il fuoco
  // e il testo non ancora salvato (#401).
  source.id = `setting-${CSS_SNIPPETS_KEY}`;
  source.setAttribute("aria-label", entry.spec.label);
  source.rows = 7;
  source.spellcheck = false;
  source.value = typeof entry.value === "string" ? entry.value : DEFAULT_CSS_SNIPPETS;
  const status = row("setting-source", t("settings.css.trust"));
  status.setAttribute("role", "status");
  const actions = document.createElement("div");
  actions.className = "settings-actions";
  const preview = document.createElement("button");
  preview.type = "button";
  preview.className = "settings-btn";
  preview.textContent = t("settings.css.preview");
  preview.addEventListener("click", () => {
    try {
      previewCssSnippets(source.value);
      status.textContent = t("settings.css.preview_active");
    } catch (error) {
      status.textContent = t("settings.css.rejected", { reason: errorText(error) });
    }
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "settings-btn";
  cancel.textContent = t("settings.css.cancel_preview");
  cancel.addEventListener("click", () => {
    cancelCssSnippetsPreview();
    status.textContent = t("settings.css.preview_cancelled");
  });
  const save = document.createElement("button");
  save.type = "button";
  save.className = "settings-btn";
  save.textContent = t("settings.css.save");
  save.addEventListener("click", () => {
    save.disabled = true;
    void saveCssSnippets(source.value).then(() => {
      if (panel.isConnected) void render();
    }).catch((error: unknown) => {
      status.textContent = t("settings.css.not_saved", { reason: errorText(error) });
    }).finally(() => { save.disabled = false; });
  });
  actions.append(preview, cancel, save);
  panel.append(source, actions, status);
  try {
    const snippets = parseCssSnippets(source.value);
    const errors = new Map(cssSnippetCatalog().map((item) => [item.id, item.error]));
    for (const snippet of snippets.snippets) {
      const line = document.createElement("div");
      line.className = "setting-snippet";
      line.append(row("setting-source", t(snippet.enabled ? "settings.css.snippet_on" : "settings.css.snippet_off", { id: snippet.id }) + (errors.get(snippet.id) ? ` · ${errors.get(snippet.id)}` : "")));
      if (snippet.enabled) {
        const off = document.createElement("button");
        off.type = "button";
        off.className = "link-button";
        off.textContent = t("settings.css.disable", { id: snippet.id });
        off.addEventListener("click", () => void write(() => disableCssSnippet(snippet.id)));
        line.append(off);
      }
      panel.append(line);
    }
  } catch (error) {
    panel.append(row("setting-source", t("settings.css.needs_repair", { reason: errorText(error) })));
  }
  return panel;
}

/// Il profilo che il kernel crea di serie: il suo nome è un id (`Default`, come
/// `default_profile_name` in `settings.rs`), e si mostra nella lingua di chi
/// guarda. L'id resta quello che si manda all'host.
const DEFAULT_PROFILE = "Default";

function profileLabel(profile: string): string {
  return profile === DEFAULT_PROFILE ? t("settings.profiles.default") : profile;
}

/// I profili: una sezione in fondo alla configurazione, una scheda per
/// ambito. In vista resta il gesto comune — quale profilo è attivo e come
/// cambiarlo —; quelli rari (duplicare, esportare, importare, azzerare) stanno
/// in un riquadro che si apre.
///
/// Un errore dell'host qui dice **che cosa** non è riuscito, con la frase della
/// sua specie (`errorText(e, "specie")`): il suo messaggio è in inglese e lo scrive il
/// kernel per chi lo cerca nel registro, non per chi guarda il pannello.
async function renderProfiles(index: number): Promise<HTMLElement> {
  const scopes: { scope: SettingScope; vault?: string }[] = [{ scope: "machine" }];
  if (state.vaultRoot) scopes.push({ scope: "vault", vault: state.vaultRoot });
  const results = await Promise.allSettled(scopes.map(({ scope, vault }) =>
    Promise.resolve().then(() => api.settingsProfiles(scope, vault))));
  const parts = sectionBlock(t("settings.profiles.title"), index, { card: false });
  for (const [position, { scope, vault }] of scopes.entries()) {
    const title = t(scope === "machine" ? "settings.profiles.machine" : "settings.profiles.vault");
    const box = document.createElement("div");
    box.className = "settings-card settings-profile";
    box.dataset.profileScope = scope;
    box.dataset.search = normalizeSearch(`${title} ${t("settings.profiles.title")}`);
    const head = document.createElement("div");
    head.className = "setting-row";
    const text = document.createElement("div");
    text.className = "setting-text";
    const name = document.createElement("div");
    name.className = "setting-label";
    name.setAttribute("role", "heading");
    name.setAttribute("aria-level", "4");
    name.textContent = title;
    text.append(name);
    head.append(text);
    box.append(head);
    parts.body.append(box);
    const result = results[position]!;
    if (result.status === "rejected") {
      text.append(row("muted", t("settings.profiles.unavailable", { reason: errorText(result.reason, "specie") })));
      continue;
    }
    const { active, names } = result.value;
    text.append(row("setting-source", t("settings.profiles.active", { profile: profileLabel(active) })));
    const feedback = row("setting-source", t("settings.profiles.hint"));
    feedback.setAttribute("role", "status");
    text.append(feedback);
    const choice = document.createElement("select");
    choice.setAttribute("aria-label", t("settings.profiles.choice"));
    for (const profile of names) {
      const option = document.createElement("option");
      option.value = profile;
      option.textContent = profileLabel(profile);
      option.selected = profile === active;
      choice.append(option);
    }
    const control = document.createElement("div");
    control.className = "setting-control settings-actions";
    head.append(control);
    const { details: manage, body: inside } = openableDetails(`profiles:${scope}`, t("settings.profiles.manage"));
    box.append(manage);
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "setting-input";
    // Gli id tengono nome e JSON non ancora usati attraverso un ridisegno (#401).
    nameInput.id = `settings-profile-${scope}-name`;
    nameInput.placeholder = t("settings.profiles.new_name");
    nameInput.setAttribute("aria-label", t("settings.profiles.new_name"));
    const json = document.createElement("textarea");
    json.className = "setting-code";
    json.id = `settings-profile-${scope}-json`;
    json.rows = 5;
    json.spellcheck = false;
    json.placeholder = t("settings.profiles.json_placeholder");
    json.setAttribute("aria-label", t("settings.profiles.json"));
    let busy = false;
    const perform = async (action: () => Promise<unknown>, redraw = true) => {
      if (busy) return;
      busy = true;
      for (const button of box.querySelectorAll<HTMLButtonElement>("button")) button.disabled = true;
      try {
        await action();
        if (settingsLifetime?.closed || !box.isConnected) return;
        if (redraw) {
          feedback.textContent = t("settings.profiles.saved");
          // Il gesto riuscito ha usato nome e JSON: il ridisegno riparte
          // vuoto, come sempre, e non li riporta come bozza.
          nameInput.value = "";
          json.value = "";
          await render();
        }
      } catch (error) {
        if (box.isConnected) feedback.textContent = t("settings.profiles.not_changed", { reason: errorText(error, "specie") });
      } finally {
        busy = false;
        for (const button of box.querySelectorAll<HTMLButtonElement>("button")) button.disabled = false;
      }
    };
    const button = (parent: HTMLElement, title: string, action: () => void, danger = false) => {
      const control = document.createElement("button");
      control.type = "button";
      control.className = danger ? "settings-btn settings-btn--danger" : "settings-btn";
      control.textContent = title;
      control.addEventListener("click", action);
      parent.append(control);
    };
    control.append(choice);
    button(control, t("settings.profiles.switch"), () => void perform(() => api.switchSettingsProfile(scope, choice.value, vault)));
    const duplicateRow = document.createElement("div");
    duplicateRow.className = "settings-actions";
    duplicateRow.append(nameInput);
    button(duplicateRow, t("settings.profiles.duplicate"), () => {
      if (!nameInput.value.trim()) { feedback.textContent = t("settings.profiles.name_required"); return; }
      void perform(() => api.duplicateSettingsProfile(scope, choice.value, nameInput.value.trim(), vault));
    });
    const transfer = document.createElement("div");
    transfer.className = "settings-actions";
    button(transfer, t("settings.profiles.export"), () => void perform(async () => {
      json.value = await api.exportSettingsProfile(scope, choice.value, vault);
      feedback.textContent = t("settings.profiles.exported");
    }, false));
    button(transfer, t("settings.profiles.import"), () => {
      if (!json.value.trim()) { feedback.textContent = t("settings.profiles.json_required"); return; }
      // Pass the source verbatim. Parsing/reserializing here would discard
      // opaque values the native profile store knows how to retain.
      void perform(() => api.importSettingsProfile(scope, json.value, vault));
    });
    button(transfer, t("settings.profiles.reset"), () => {
      void (async () => {
        const accepted = await confirm(t("settings.profiles.reset_confirm", { profile: profileLabel(choice.value) }), {
          title: t("settings.profiles.reset_title"), okLabel: t("settings.profiles.reset_ok"), danger: true,
        });
        if (accepted && box.isConnected) await perform(() => api.resetSettingsProfile(scope, choice.value, vault));
      })().catch((error: unknown) => { feedback.textContent = t("settings.profiles.reset_cancelled", { reason: errorText(error, "specie") }); });
    }, true);
    inside.append(duplicateRow, json, transfer, row("muted", t("settings.profiles.frame_hint")));
  }
  return parts.section;
}

function renderThemeCatalog(themes: ThemeInfo[], developer: boolean): HTMLElement {
  const panel = document.createElement("div");
  panel.className = "setting-row setting-block";
  panel.dataset.themeCatalog = "";
  const text = blockHead(
    panel,
    t("settings.themes.title"),
    t(themes.length > 0 ? "settings.themes.preview_hint" : "settings.themes.none_installed"),
  );
  panel.dataset.search = normalizeSearch([
    t("settings.themes.title"),
    t("settings.themes.preview_hint"),
    ...themes.map((theme) => `${theme.manifest.name} ${theme.manifest.id}`),
  ].join(" "));

  const control = document.createElement("div");
  control.className = "segmented segmented--wide setting-segmented";
  control.setAttribute("role", "radiogroup");
  control.setAttribute("aria-label", t("settings.themes.title"));

  const currentPreview = currentThemePreview();
  const renderedId = currentPreview?.id ?? currentThemeId();
  const renderedLight =
    currentPreview?.light ??
    (document.documentElement.dataset.theme === "light" ? "light" : "dark");

  const labels = new Map<string, string>();
  for (const theme of themes) {
    for (const light of theme.manifest.lights) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "segmented-option";
      const label = t("settings.themes.option", {
        name: theme.manifest.name,
        light: t(
          light === "dark" ? "settings.themes.light.dark" : "settings.themes.light.light",
        ),
      });
      button.textContent = `${label} · ${t(TRUST_LABELS[theme.trust])}`;
      button.dataset.themeId = theme.manifest.id;
      button.dataset.themeLight = light;
      button.setAttribute("role", "radio");
      button.setAttribute(
        "aria-checked",
        String(renderedId === theme.manifest.id && renderedLight === light),
      );
      labels.set(theme.manifest.id + ":" + light, label);
      control.append(button);
    }
  }

  const actions = document.createElement("div");
  actions.className = "settings-actions";
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.className = "settings-btn";
  applyButton.textContent = t("settings.themes.apply");
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "settings-btn";
  cancelButton.textContent = t("settings.themes.cancel_preview");
  const status = row("setting-source", "");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  const refreshPreviewState = (): void => {
    const preview = currentThemePreview();
    applyButton.disabled = preview === null;
    cancelButton.disabled = preview === null;
    status.textContent = preview
      ? t("settings.themes.preview_active", {
          theme: labels.get(preview.id + ":" + preview.light) ?? preview.id,
        })
      : t("settings.themes.preview_none");
  };

  installRadioGroup(control, (button) => {
    const id = button.dataset.themeId!;
    const light = button.dataset.themeLight as "light" | "dark";
    void previewTheme(id, light)
      .then(refreshPreviewState)
      .catch((error: unknown) => {
        notify(t("settings.themes.preview_failed", { reason: errorText(error) }), "guasto");
        void render();
      });
  });

  applyButton.addEventListener("click", () => {
    const preview = currentThemePreview();
    if (!preview) return;
    void write(() => selectTheme(preview.id, preview.light));
  });
  cancelButton.addEventListener("click", () => {
    void write(() => cancelThemePreview());
  });
  if (themes.length > 0) actions.append(applyButton, cancelButton);
  // Il gesto di chi scrive un tema; l'host lo rifiuta comunque a chiave spenta.
  if (developer) {
    const owner = settingsLifetime;
    if (owner) {
      const host = { lifetime: owner, rerender: render };
      actions.append(installFolderButton(host), linkFolderButton(host), catalogPageButton());
    }
  }
  refreshPreviewState();

  if (themes.length > 0) {
    text.append(
      row(
        "setting-source",
        t("settings.themes.source", {
          ids: themes.map((theme) => theme.manifest.id).join(", "),
        }),
      ),
    );
    panel.append(control);
  }
  panel.append(actions);
  if (themes.length > 0) panel.append(status);
  return panel;
}

/// Il bottone che apre «Tutti i componenti» (`dev/catalogo/pagina.ts`): la
/// pagina arriva con un `import()` (`dev/catalogo/carica.ts`), così non pesa
/// su chi non scrive temi.
/// Vive quanto l'apertura del pannello: chiuse le impostazioni (anche da un
/// `vault_closed`), si chiude anche lei.
function catalogPageButton(): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-btn";
  button.dataset.devAction = "catalog";
  button.textContent = t("settings.themes.catalog");
  button.addEventListener("click", () => {
    // L'apertura del pannello di questo clic. Quando la pagina arriva, si apre
    // solo se il pannello è ancora quello e il bottone ancora lì: chiuse (e
    // magari riaperte) le Impostazioni, o cambiata scheda, il clic è vecchio.
    const owner = openedLifetime;
    if (!owner) return;
    const current = (): boolean => owner === openedLifetime && !owner.closed && button.isConnected;
    loadCatalogPage()
      .then((page) => {
        if (current()) page.openCatalogPage(owner);
      })
      .catch((error: unknown) => {
        if (current()) {
          notify(t("commands.failed", { command: t("settings.themes.catalog"), reason: errorText(error) }), "guasto");
        }
      });
  });
  return button;
}

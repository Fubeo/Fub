// Il modulo «Impostazioni»: le schede del vault e delle informazioni.
import { api } from "../host/ipc";
import type { KnownVault } from "../host/contract";
import { state } from "../state/store";
import { notify } from "../ui/notify";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { setTooltip } from "../ui/tooltip";
import { marcuzzoElement } from "../ui/marcuzzo";
import { SOURCE_URL, checkMessage } from "./about";
import { vaultNameEditor } from "./vault-rename";
import { close, render, sectionBlock, settingsHooks, updateChecker } from "./settings";

// --- la scheda dei vault conosciuti -----------------------------------------

export async function renderVault(): Promise<HTMLElement[]> {
  const vaults = await api.knownVaults();
  if (vaults.length === 0) {
    return [row("muted settings-note", t("settings.no_vaults"))];
  }
  const card = document.createElement("div");
  card.className = "settings-card";
  card.append(...vaults.map(renderVaultRow));
  return [card];
}

/// La scheda «Informazioni»: versione, licenza, sorgente e il controllo degli
/// aggiornamenti, che parte soltanto dal suo pulsante.
export async function renderAbout(): Promise<HTMLElement[]> {
  const version = await api.appVersion();
  const about = sectionBlock(t("about.title"), 0);
  const versionRow = document.createElement("div");
  versionRow.className = "setting-row";
  const versionText = document.createElement("div");
  versionText.className = "setting-text";
  const versionLabel = row("setting-label", t("about.version", { version }));
  const license = row("muted setting-path", t("about.license"));
  versionText.append(versionLabel, license);
  const source = document.createElement("a");
  source.className = "link-button";
  source.href = SOURCE_URL;
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  source.textContent = t("about.source");
  // Marcuzzo, il logo (D26), accanto alla versione.
  versionRow.classList.add("about-version");
  versionRow.append(marcuzzoElement("about-logo marcuzzo"), versionText, source);
  about.body.append(versionRow);

  const check = updateChecker?.state() ?? { kind: "idle" as const };
  const updates = sectionBlock(t("about.updates"), 1);
  const checkRow = document.createElement("div");
  checkRow.className = "setting-row";
  const status = row("setting-text muted", checkMessage(check, version));
  status.setAttribute("role", "status");
  const actions = document.createElement("div");
  actions.className = "setting-control";
  if (check.kind === "done" && check.newer && check.url) {
    const page = document.createElement("a");
    page.className = "link-button";
    page.href = check.url;
    page.target = "_blank";
    page.rel = "noopener noreferrer";
    page.textContent = t("about.release_page");
    actions.append(page);
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "settings-btn";
  button.textContent = t("about.check");
  button.disabled = check.kind === "checking";
  button.addEventListener("click", () => void updateChecker?.start());
  actions.append(button);
  checkRow.append(status, actions);
  updates.body.append(checkRow);
  return [about.section, updates.section];
}

function renderVaultRow(vault: KnownVault, index: number): HTMLElement {
  const el = document.createElement("div");
  el.className = "setting-row settings-vault";
  const text = document.createElement("div");
  text.className = "setting-text";
  // Il nome vuoto è il nome della cartella, e lo ricava chi disegna: tenerlo
  // scritto vorrebbe dire mostrare il nome vecchio dopo una rinomina.
  const { label, rename } = vaultNameEditor(vault, nameFolder(vault.root), `vault-name-${index}`, (name) => {
    void writeVault(() => api.setVaultLook(vault.root, vault.icon ?? null, name));
  });
  const path = row("muted setting-path", vault.root);
  text.append(label, path);

  const open = document.createElement("button");
  open.type = "button";
  open.className = "settings-btn";
  open.textContent = t("settings.open");
  // Il vault di questa finestra è già aperto: riaprirlo svuoterebbe le sessioni
  // e ripartirebbe da capo, mentre il chip del vault lo tratta come un no-op.
  if (vault.root === state.vaultRoot) {
    open.textContent = t("settings.open.current");
    open.disabled = true;
    setTooltip(open, t("settings.open.current.hint"));
  }
  open.addEventListener("click", () => {
    void (async () => {
      try {
        // La strada è **quella di `main.ts`** e non un `openVault` seguito da
        // un reload: ricaricare rimette la shell nello stato iniziale, e lo
        // stato iniziale si ricostruisce da `FUB_VAULT` — che quasi sempre
        // non c'è. Il backend avrebbe il vault aperto e la finestra sarebbe
        // vuota, senza nemmeno un modo di dirlo.
        await settingsHooks.openVault(vault.root);
        close();
      } catch (e) {
        notify(t("settings.open_failed", { reason: errorText(e) }), "guasto");
      }
    })();
  });

  // Il preferito è un pulsante a due stati: `aria-pressed` lo dice a chi
  // ascolta, la stella piena o vuota a chi guarda.
  const favoriteButton = document.createElement("button");
  favoriteButton.type = "button";
  favoriteButton.className = "settings-star";
  favoriteButton.textContent = vault.favorite ? "★" : "☆";
  favoriteButton.setAttribute("aria-pressed", String(vault.favorite));
  favoriteButton.setAttribute("aria-label", t("settings.favourite.label"));
  setTooltip(favoriteButton, t(vault.favorite ? "settings.unfavourite" : "settings.favourite"));
  favoriteButton.addEventListener("click", () => {
    void writeVault(() => api.setVaultFavorite(vault.root, !vault.favorite));
  });

  const forget = document.createElement("button");
  forget.type = "button";
  forget.className = "link-button";
  forget.textContent = t("settings.forget");
  setTooltip(forget, t("settings.forget.hint"));
  forget.addEventListener("click", () => {
    void writeVault(() => api.forgetVault(vault.root));
  });

  const actions = document.createElement("div");
  actions.className = "setting-control settings-actions";
  actions.append(favoriteButton, open, rename, forget);
  el.append(text, actions);
  return el;
}

async function writeVault(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (e) {
    notify(t("settings.registry_failed", { reason: errorText(e) }), "guasto");
  }
  await render();
}

function nameFolder(root: string): string {
  const parts = root.split(/[\\/]/).filter((p) => p !== "");
  return parts[parts.length - 1] ?? root;
}

export function row(className: string, text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  el.textContent = text;
  return el;
}

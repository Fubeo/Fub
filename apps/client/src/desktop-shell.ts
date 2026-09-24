// Il punto di montaggio della shell — e nient'altro.
//
// Qui si compone: si accendono i moduli di dominio, si iniettano i pochi
// collegamenti che due moduli non devono prendersi da sé (o sarebbero un ciclo
// di import), si apre il vault. Non c'è logica di dominio, e la regola per
// tenerlo così è semplice: se una funzione nuova risponde alla domanda «cosa fa
// questo pannello», non va qui — va nel pannello. È il file che, cresciuto per
// somma di eccezioni a quella regola, era arrivato a 1622 righe con 81 funzioni
// e 18 variabili globali (§1.1, §1.2).
// Il solo CSS importato staticamente: la struttura della shell, che non si
// tematizza. Foglio e pelle del tema di serie li monta il caricatore
// (`theme/loader.ts`) da `mountTheme`, qui sotto — e sono sostituiti, non
// accatastati.
import "./theme/structure.css";
import { pickFolder } from "./host/dialog";
import { onClose, api } from "./host/ipc";
import { vaultStatus, vaultEntries, settings } from "./host/query";
import { forwardNotice, onEvent, startKernelRouter } from "./state/kernel";
import { mountLocale } from "./state/locale";
import { loadOrganization } from "./state/organization";
import { emit, loadActiveSpace, loadExpanded, on, state } from "./state/store";
import { loadLayout, activeDoc, layout as paneLayout, split as splitPane, closePane } from "./state/layout";
import { loadCommandSpecs, beforeNote } from "./state/vault";
import { $ } from "./ui/dom";
import { applyIntent, takeNoticeAfterReload } from "./ui/intents";
import { mountLinkPreview } from "./ui/link-preview";
import { listenForFailures, mountNotifications, notify, setWatcherOff } from "./ui/notify";
import { closeCommandPalette, openCommandPalette, startCommand } from "./ui/palette";
import {
  allCommands,
  conflictMessage,
  keybindingKey,
  loadKeyOverrides,
  mountKeyOverrides,
  registerShellCommand,
} from "./ui/commands";
import { mountKeyboard } from "./ui/keyboard";
import { openLifetime, type Lifetime, type Teardown } from "./ui/lifetime";
import { mountSidebarCommands, showPanel } from "./panels/sidebar";
import { mountPanelHost, refreshAllPanels } from "./ui/panel-host";
import { mountDeclaredViews, mountViewInvalidation } from "./ui/views";
import { mountTitlebar } from "./ui/titlebar";
import { mountAppMenu } from "./ui/app-menu";
import { mountWebviewFocusMonitor } from "./ui/node";
import { registerMermaidRenderer } from "./ui/mermaid";
import { mountOnboarding } from "./ui/onboarding";
import { registerBaseRenderer } from "./editors/base/surface";
import { applyRailMachineSettings, mountRail, syncRail } from "./panels/rail";
import { mountStrings, t } from "./i18n/strings";
import { mountActivity } from "./panels/activity";
import { mountSettings } from "./panels/settings";
import { mountTheme } from "./theme/theme";
import { reducedMotion } from "./theme/reduced-motion";
import {
  freezeDocumentSurfaces,
  mountDocument,
  openDocument,
  recoverDrafts,
  setEditorTheme,
  synchronize,
} from "./panels/document";
import { flushPendingSave, flushBeforeClose } from "./state/document-session";
import { drainDocumentWindows, openCurrentInNewWindow } from "./state/document-windows";
import { mountExplorer } from "./panels/explorer";
import { closeInDocumentSearch, mountDocSearch } from "./panels/doc-search";
import { mountGraph } from "./panels/graph";
import { mountQuickSwitcher } from "./panels/quick-switcher";
import { clearSearch, mountSearch, searchFor } from "./panels/search";
import { errorText } from "./host/errors";
import type { ShellGeometry } from "./state/shell-geometry";
import { configureRail } from "./panels/rail";
import { mountBookmarksPanel } from "./state/bookmarks-ui";
import { mountWorkspacesPanel } from "./state/workspaces-ui";
import { mountShellOwnerCommands } from "./state/shell-commands";
import { hidePreview } from "./state/preview";
import { closeContextMenu } from "./ui/menu";
import type { SettingEntry } from "./host/contract";

/** Apply machine chrome at boot and after external profile/setting changes.
 * A frame change is intentionally NOT live: native decorations are chosen
 * before webview creation, and the settings panel warns about reopening. */
async function mountMachineChrome(lifetime: Lifetime): Promise<void> {
  let generation = 0;
  let frameAtBoot: string | null = null;
  let toolbarVisible = true;
  const panes = document.getElementById("panes");
  const applyToolbar = () => {
    if (!panes) return;
    for (const bar of panes.querySelectorAll<HTMLElement>(".pane-toolbar")) {
      bar.hidden = !toolbarVisible;
    }
  };
  const observer = new MutationObserver(applyToolbar);
  if (panes) observer.observe(panes, { childList: true, subtree: true });
  lifetime.add(() => { generation++; observer.disconnect(); });
  const apply = (entries: SettingEntry[]) => {
    if (lifetime.closed) return;
    const values = new Map(entries.map((entry) => [entry.spec.key, entry.value]));
    const valid = values.get("chrome.schema") === 1;
    applyRailMachineSettings(entries);
    document.getElementById("statusbar")?.toggleAttribute("hidden", valid && values.get("chrome.status.visible") === false);
    toolbarVisible = !valid || values.get("chrome.toolbar.visible") !== false;
    applyToolbar();
    if (frameAtBoot === null) {
      frameAtBoot = valid && values.get("chrome.frame") === "system" ? "system" : "custom";
      if (document.documentElement.dataset.clientShell !== "mobile") {
        document.getElementById("window-controls")?.toggleAttribute("hidden", frameAtBoot === "system");
      }
    }
  };
  const reread = async () => {
    const current = ++generation;
    try {
      const entries = await settings();
      if (current === generation && !lifetime.closed) apply(entries);
    } catch (error) {
      if (current === generation && !lifetime.closed) notify(t("shell.chrome_failed", { reason: errorText(error) }), "guasto");
    }
  };
  lifetime.add(onEvent("setting_changed", ({ key }) => {
    if (key.startsWith("chrome.")) void reread();
  }));
  await reread();
}
/// Schermata senza vault e layout adattivo: la shell possiede l'apertura,
/// l'onboarding possiede demo, supporto e recupero. Le due vite si chiudono
/// insieme; il picker di cartella resta registrato soltanto qui.
function mountAdaptiveShell(): void {
  const life = pageWindowLifetime;
  const layout = document.getElementById("layout");
  const sidebar = document.getElementById("sidebar");
  const inspector = document.getElementById("right-pane");
  const onboarding = document.getElementById("onboarding");
  if (!layout || !sidebar || !inspector || !onboarding) return;
  const openBtn = document.getElementById("onboarding-open");
  const settingsBtn = document.getElementById("onboarding-settings");
  const status = document.getElementById("onboarding-status");
  const errorBox = document.getElementById("onboarding-error");
  const errorTextEl = document.getElementById("onboarding-error-text");
  const retryBtn = document.getElementById("onboarding-retry");
  const chooseBtn = document.getElementById("onboarding-choose");
  const recentWrap = document.getElementById("onboarding-recent-wrap");
  const recentList = document.getElementById("onboarding-recent");
  const sidebarScrim = document.getElementById("sidebar-scrim");
  const inspectorScrim = document.getElementById("inspector-scrim");
  const divSidebar = document.getElementById("divider-sidebar");
  const divInspector = document.getElementById("divider-inspector");
  let opening = false;
  let lastDir: string | null = null;
  let lastTrigger: HTMLElement | null = null;
  // Preferenze esplicite (L01): mai sovrascritte dall'adattamento.
  let sidebarPref: boolean | null = null;
  let inspectorPref: boolean | null = null;
  try {
    const rawSidebar = localStorage.getItem("fub.layout.sidebar");
    sidebarPref = rawSidebar === "1" ? true : rawSidebar === "0" ? false : null;
    const rawInspector = localStorage.getItem("fub.layout.inspector");
    inspectorPref = rawInspector === "1" ? true : rawInspector === "0" ? false : null;
  } catch {
    sidebarPref = null;
    inspectorPref = null;
  }
  const hasVault = (): boolean => state.vaultRoot !== "";
  const closeDrawers = (restore = true): void => {
    layout.classList.remove("drawer-sidebar-open", "drawer-inspector-open");
    if (sidebarScrim) sidebarScrim.hidden = true;
    if (inspectorScrim) inspectorScrim.hidden = true;
    if (restore && lastTrigger?.isConnected) lastTrigger.focus();
    lastTrigger = null;
  };
  // Un solo drawer laterale aperto per volta in modalità compatta (L02).
  // La chiusura ripristina il focus al trigger (C04); Esc chiude (C03).
  // I trigger espliciti restano ai comandi/pulsanti esistenti; qui solo
  // chiusura singola, Esc, scrim e restore.
  const applyAdaptive = (): void => {
    const width = globalThis.window.innerWidth;
    layout.classList.toggle("layout-inspector-overlay", width >= 960 && width < 1200);
    layout.classList.toggle("layout-compact", width < 960);
    const inspectorOpen = inspectorPref ?? width >= 1200;
    const sidebarOpen = sidebarPref ?? width >= 960;
    sidebar.hidden = !sidebarOpen && !layout.classList.contains("drawer-sidebar-open");
    inspector.hidden = !inspectorOpen && !layout.classList.contains("drawer-inspector-open");
    if (divSidebar) divSidebar.hidden = sidebar.hidden;
    if (divInspector) divInspector.hidden = inspector.hidden;
    if (width >= 1200) closeDrawers(false);
  };
  pageWindowLifetime.listen(window, "shell:restore-geometry", ((event: CustomEvent<ShellGeometry>) => {
    const geometry = event.detail;
    if (geometry.sidebar?.visible !== undefined) sidebarPref = geometry.sidebar.visible;
    if (geometry.inspector?.visible !== undefined) inspectorPref = geometry.inspector.visible;
    applyAdaptive();
    configureRail(geometry);
    if (geometry.panel) showPanel(geometry.panel);
  }) as EventListener);
  const mountDivider = (
    divider: HTMLElement | null,
    target: HTMLElement,
    direction: 1 | -1,
    min: number,
    max: number,
  ): void => {
    if (!divider) return;
    let width = target.offsetWidth || min;
    let drag: { pointer: number; x: number; width: number; scale: number } | null = null;
    divider.setAttribute("role", "separator");
    divider.setAttribute("aria-orientation", "vertical");
    divider.tabIndex = 0;
    divider.setAttribute("aria-controls", target.id);
    divider.setAttribute("aria-valuemin", String(min));
    divider.setAttribute("aria-valuemax", String(max));
    const publish = (value: number): void => {
      width = value;
      divider.setAttribute("aria-valuenow", String(Math.round(value)));
      divider.setAttribute("aria-valuetext", `${Math.round(value)} px`);
    };
    const resize = (value: number): void => {
      const next = Math.min(max, Math.max(min, Math.round(value)));
      target.style.flexBasis = `${next}px`;
      target.style.width = `${next}px`;
      publish(next);
    };
    const endDrag = (): void => {
      const pointer = drag?.pointer;
      drag = null;
      if (pointer !== undefined && divider.hasPointerCapture(pointer)) {
        divider.releasePointerCapture(pointer);
      }
    };
    const endPointer = (e: PointerEvent): void => {
      if (drag?.pointer === e.pointerId) endDrag();
    };
    const observer = new ResizeObserver(() => {
      const actual = target.offsetWidth;
      if (actual > 0) publish(actual);
    });
    observer.observe(target);
    publish(width);
    pageWindowLifetime.listen(window, "shell:restore-geometry", ((event: CustomEvent<ShellGeometry>) => {
      const side = target.id === "sidebar" ? event.detail.sidebar : event.detail.inspector;
      if (side?.width !== undefined) resize(side.width);
    }) as EventListener);
    pageWindowLifetime.listen(divider, "keydown", (e) => {
      const next =
        e.key === "ArrowLeft" ? width - direction * 16 :
        e.key === "ArrowRight" ? width + direction * 16 :
        e.key === "Home" ? min :
        e.key === "End" ? max : null;
      if (next === null) return;
      e.preventDefault();
      resize(next);
    });
    pageWindowLifetime.listen(divider, "pointerdown", (e) => {
      if (e.button !== 0 || drag) return;
      e.preventDefault();
      divider.focus({ preventScroll: true });
      const scale = target.getBoundingClientRect().width / width || 1;
      drag = { pointer: e.pointerId, x: e.clientX, width, scale };
      divider.setPointerCapture(e.pointerId);
    });
    pageWindowLifetime.listen(divider, "pointermove", (e) => {
      if (drag?.pointer === e.pointerId) {
        resize(drag.width + direction * (e.clientX - drag.x) / drag.scale);
      }
    });
    pageWindowLifetime.listen(divider, "pointerup", endPointer);
    pageWindowLifetime.listen(divider, "pointercancel", endPointer);
    pageWindowLifetime.listen(divider, "lostpointercapture", endPointer);
    pageWindowLifetime.listen(globalThis.window, "blur", endDrag);
    pageWindowLifetime.add(() => {
      endDrag();
      observer.disconnect();
    });
  };
  const setOpening = (dir: string | null): void => {
    if (!status) return;
    if (dir) {
      status.hidden = false;
      status.textContent = t("onboarding.opening", { path: dir });
    } else {
      status.hidden = true;
      status.textContent = "";
    }
  };
  const setError = (reason: string | null): void => {
    if (!errorBox || !errorTextEl) return;
    if (!reason) {
      errorBox.hidden = true;
      errorTextEl.textContent = "";
      return;
    }
    errorBox.hidden = false;
    errorTextEl.textContent = reason;
  };
  const syncOnboarding = (): void => {
    const empty = !hasVault();
    onboarding.hidden = !empty;
    document.getElementById("panes")?.classList.toggle("onboarding-visible", empty);
    void refreshRecents();
    syncContextAvailability();
  };
  const refreshRecents = async (): Promise<void> => {
    if (!recentWrap || !recentList) return;
    let vaults: Array<{ root: string; name: string; icon?: string | null }> = [];
    try {
      vaults = await api.knownVaults();
    } catch {
      vaults = [];
    }
    if (life.closed) return;
    // Solo se reali da host: mai lista finta (U02).
    recentList.replaceChildren();
    if (vaults.length === 0 || hasVault()) {
      recentWrap.hidden = true;
      return;
    }
    recentWrap.hidden = false;
    for (const vault of vaults.slice(0, 8)) {
      const item = document.createElement("li");
      const name = vault.name || vault.root.split(/[\\/]/).filter(Boolean).pop() || vault.root;
      const open = document.createElement("button");
      open.type = "button";
      open.className = "link-button";
      open.textContent = `${vault.icon ?? ""} ${name}`.trim();
      open.setAttribute("aria-label", `${name} — ${vault.root}`);
      open.addEventListener("click", () => void openVaultFlow(vault.root));
      const path = document.createElement("div");
      path.className = "muted";
      path.textContent = vault.root;
      item.append(open, path);
      recentList.append(item);
    }
  };
  const syncContextAvailability = (): void => {
    // U03: senza contesto vault, Nuova nota/ricerca/grafo non devono sembrare
    // funzionanti; apertura/impostazioni/aiuto sempre disponibili. Solo DOM
    // (aria-disabled + intercetto), mai edit dei pannelli altrui.
    const empty = !hasVault();
    const searchInput = document.getElementById("search-input") as HTMLInputElement | null;
    if (searchInput) {
      searchInput.disabled = empty;
      searchInput.setAttribute("aria-disabled", String(empty));
    }
    const newNote = document.getElementById("new-note");
    if (newNote) {
      newNote.setAttribute("aria-disabled", String(empty));
      (newNote as HTMLButtonElement).disabled = empty;
    }
    const graph = document.getElementById("show-graph") as HTMLButtonElement | null;
    if (graph) {
      graph.disabled = empty;
      graph.setAttribute("aria-disabled", String(empty));
    }
    const trigger = document.getElementById("command-search");
    if (trigger) {
      trigger.setAttribute("aria-disabled", String(empty));
      (trigger as HTMLButtonElement).disabled = empty;
    }
  };
  const guardContext = (e: Event): void => {
    if (!hasVault()) {
      e.preventDefault();
      e.stopPropagation();
      syncOnboarding();
    }
  };
  const openVaultFlow = async (dir: string): Promise<void> => {
    if (opening || life.closed) return;
    opening = true;
    lastDir = dir;
    setError(null);
    setOpening(dir);
    try {
      await openVaultPath(dir, () => !life.closed);
      if (life.closed) return;
      setOpening(null);
      syncOnboarding();
      applyAdaptive();
    } catch (e) {
      if (life.closed) return;
      setOpening(null);
      setError(errorText(e));
    } finally {
      opening = false;
    }
  };
  const onPick = async (): Promise<void> => {
    if (opening || life.closed) return;
    // Picker annullato = stato invariato (U04): pickFolder null non tocca nulla.
    const dir = await pickFolder();
    if (!dir || life.closed) return;
    await openVaultFlow(dir);
  };
  pageWindowLifetime.listen(globalThis.window, "resize", applyAdaptive);
  pageWindowLifetime.listen(document, "keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (
        layout.classList.contains("drawer-sidebar-open") ||
        layout.classList.contains("drawer-inspector-open")
      ) {
        e.preventDefault();
        closeDrawers(true);
      }
    }
  });
  if (sidebarScrim) pageWindowLifetime.listen(sidebarScrim, "click", () => closeDrawers(true));
  if (inspectorScrim) pageWindowLifetime.listen(inspectorScrim, "click", () => closeDrawers(true));
  mountDivider(divSidebar, sidebar, 1, 200, 360);
  mountDivider(divInspector, inspector, -1, 240, 400);
  if (openBtn) pageWindowLifetime.listen(openBtn, "click", () => void onPick());
  if (chooseBtn) pageWindowLifetime.listen(chooseBtn, "click", () => void onPick());
  if (retryBtn)
    pageWindowLifetime.listen(retryBtn, "click", () => {
      if (lastDir) void openVaultFlow(lastDir);
      else void onPick();
    });
  if (settingsBtn)
    pageWindowLifetime.listen(settingsBtn, "click", () =>
      document.getElementById("open-settings")?.click(),
    );
  const graphBtn = document.getElementById("show-graph");
  if (graphBtn) pageWindowLifetime.listen(graphBtn, "click", guardContext, { capture: true });
  const searchInput = document.getElementById("search-input");
  if (searchInput) pageWindowLifetime.listen(searchInput, "click", guardContext, { capture: true });
  // Solo la shell apre i vault e sceglie cartelle: onboarding si iscrive una
  // volta alla stessa vita di pagina, senza un secondo listener sul picker.
  const showEmptyVault = async (): Promise<void> => {
    if (life.closed) return;
    state.vaultRoot = "";
    vaultPathEl.textContent = "";
    await loadLayout();
    if (life.closed) return;
    await synchronize();
    if (life.closed) return;
    emit("vault", "");
  };
  mountOnboarding({
    openPath: async (path) => {
      await openVaultPath(path, () => !life.closed, true);
      if (life.closed) return;
      syncOnboarding();
      applyAdaptive();
    },
    prepareSwitch: async () => {
      if (life.closed) return false;
      if (!await drainDocumentWindows()) return false;
      const pending = await flushPendingSave();
      if (pending.length === 0) return true;
      notify(t("demo.unsaved", { files: pending.join(", ") }), "guasto");
      return false;
    },
    isOpening: () => opening,
    currentVault: () => state.vaultRoot,
    returnTo: async (path) => {
      if (path) {
        if (life.closed) return;
        try {
          await openVaultPath(path, () => !life.closed, true);
        } catch (error) {
          await showEmptyVault();
          throw error;
        }
      } else {
        await showEmptyVault();
      }
      if (life.closed) return;
      syncOnboarding();
      applyAdaptive();
    },
  }, pageWindowLifetime);
  applyAdaptive();
  syncOnboarding();
  pageWindowLifetime.add(on("vault", () => syncOnboarding()));
  pageWindowLifetime.add(on("vault", () => applyAdaptive()));
  void refreshRecents();
}

const vaultPathEl = $("#vault-path");

/// Ciò che la palette chiede alla shell.
const paletteHost = {
  onEffect: applyIntent,
  notify,
  flushPendingSave,
  // Dal canale dati (§14.4), **con una finestra** (§2.9). Questi path
  // riempiono un `<datalist>`, cioè dei suggerimenti sopra un campo che resta
  // libero: chiedere l'anagrafe intera per proporne una manciata mandava
  // attraverso il ponte tutto il vault e creava un `<option>` per documento a
  // ogni apertura del pannello. Un suggerimento troncato non toglie niente a
  // chi scrive il path per intero.
  //
  // La forma giusta a regime è un'altra, ed è già scritto altrove: chiedere per
  // prefisso mentre si scrive, cioè `noteDalNome` (0082, 0083 — «le superfici
  // che propongono dei nomi fanno *la stessa* domanda»). Cablarla qui vuol dire
  // dare alla palette un campo che ascolta, che è la casella residua.
  listDocuments: () =>
    vaultEntries({ offset: 0, limit: 200 }, "document")
      .then((page) => page.items.map((e) => e.id))
      .catch(() => []),
};

/// Gli ascolti globali vivono fino allo smontaggio di questa finestra. Un
/// remount apre una Lifetime nuova; ogni callback asincrona del montaggio
/// precedente verifica il proprio epoch prima di disegnare.
let pageWindowLifetime = openLifetime();
let pageEpoch = 0;
let mounted: Promise<Teardown> | null = null;

/// Porta accanto ai bottoni della titlebar l'accordo efficace del comando.
function refreshTitlebarShortcuts(): void {
  const targets: Array<[string, string]> = [
    ["shell.palette", "open-palette-key"],
    ["shell.panel.search", "command-search-key"],
  ];
  for (const [id, elementId] of targets) {
    const key = document.getElementById(elementId);
    if (!(key instanceof HTMLElement)) continue;
    const binding = allCommands().find((entry) => entry.id === id)?.binding ?? null;
    key.textContent = binding ?? "";
    key.hidden = binding === null;
  }
}

async function init(): Promise<Teardown> {
  const lifetime = pageWindowLifetime;
  const epoch = pageEpoch;
  const teardown: Teardown = () => {
    if (lifetime.closed) return;
    pageEpoch++;
    lifetime.close();
  };
  const alive = (): boolean => !lifetime.closed && pageEpoch === epoch;
  // Il tema **per primo**, e prima di qualunque cosa disegni (§12.4): applica
  // subito l'ultima scelta nota, così il primo fotogramma è già nella luce
  // giusta invece di correggersi mezzo secondo dopo. La preferenza di moto si
  // legge nello stesso punto di avvio, prima che un grafo possa montarsi. Va prima di
  // `mountDocument` anche per una ragione meno cosmetica: l'editor nasce col
  // tema che trova sulla radice, e nascere col tema sbagliato vorrebbe dire
  // riconfigurarlo subito dopo.
  reducedMotion();
  mountTheme(pageWindowLifetime, setEditorTheme);

  // Le stringhe accanto al tema, e per la stessa ragione (§12.4): sono le due
  // cose che vanno applicate **prima** che qualcosa disegni, o il primo
  // fotogramma è nella luce sbagliata e nella lingua sbagliata, e si corregge
  // sotto gli occhi di chi guarda. Qui si riempie anche il testo fermo di
  // `index.html`, che fino a questa riga è la lingua di ripiego scritto nel
  // file.
  //
  // Ciò che passa di qui è **ciò che nessun altro sa rifare**: i pannelli, che
  // hanno tutti un `render` e un registro che sa chiamarli. Chi disegna testo
  // fuori dai pannelli — i due pulsanti della barra di stato, il titolo dello
  // spazio — si iscrive da sé con `onLanguage`, invece di allungare un elenco qui
  // che si scopre incompleto solo cambiando lingua.
  pageWindowLifetime.add(mountStrings(() => void refreshAllPanels()));
  await mountMachineChrome(pageWindowLifetime);
  if (!alive()) return teardown;

  // La titlebar custom (§Fase 2): i controlli finestra e il doppio click.
  // Va dopo `mountStrings` perché i suoi aria-label seguono la lingua, e
  // prima dei pannelli perché è il chrome — la cornice che c'è prima del
  // contenuto.
  mountTitlebar(pageWindowLifetime);
  mountWebviewFocusMonitor(pageWindowLifetime);
  registerMermaidRenderer();
  registerBaseRenderer((doc) => openDocument(doc));
  // I tre collegamenti iniettati, e la ragione per cui lo sono: il pannello del
  // documento mostra l'anteprima (in Lettura) e l'anteprima apre i documenti;
  // il pannello del documento manda a cercare un tag e la ricerca apre i
  // documenti; il grafo apre la nota di un nodo. In tutti i casi importarsi a
  // vicenda sarebbe un ciclo, e in un bundle ESM un ciclo è un `undefined`
  // all'avvio che non dice da dove viene. È la stessa forma con cui i tre
  // moduli dell'editor ricevono il mondo.
  mountDocument(pageWindowLifetime, { searchTag: (tag) => searchFor(`tags:${tag}`) });

  // Subito dopo il pannello del documento, perché è il suo testo che protegge, e
  // **prima** del vault: il ritardo del salvataggio comincia a correre alla
  // prima battuta, e un ascoltatore montato in fondo all'avvio sarebbe iscritto
  // dopo l'unico momento in cui non serve. Non si attende — la promessa è
  // l'iscrizione, non la chiusura — ma non è nemmeno buttata: un `catch` che
  // dice cosa non c'è, perché una finestra che chiudendo perde l'ultima battuta
  // non lo racconta a nessuno.
  const closeListener = onClose(async () => {
    freezeDocumentSurfaces(true);
    try {
      if (!await drainDocumentWindows()) {
        freezeDocumentSurfaces(false);
        return false;
      }
      await flushBeforeClose();
      return true;
    } catch (error) {
      freezeDocumentSurfaces(false);
      notify(t("document.close_failed", { reason: errorText(error) }), "guasto");
      return false;
    }
  }, (error) => {
    freezeDocumentSurfaces(false);
    notify(t("document.close_failed", { reason: errorText(error) }), "guasto");
  }).catch(() => {
    notify(t("document.close_unhooked"), "guasto");
    return () => {};
  });
  lifetime.listen(window, "pagehide", teardown, { once: true });
  pageWindowLifetime.add(() => {
    void closeListener.then(
      (unlisten) => unlisten(),
      () => notify(t("document.close_unhooked"), "guasto"),
    );
  });

  // L'host dei pannelli per primo: da qui in poi ogni pannello — nativo o
  // dichiarato dal backend — si presenta al registro invece di iscriversi da
  // sé agli eventi, ed è l'host a decidere quando ridisegnarlo (§1.2).
  mountPanelHost(pageWindowLifetime);
  // L'invito a ridisegnare che arriva da un provider (§2.5): sta accanto
  // all'host dei pannelli perché è l'altra metà della stessa domanda — quando
  // una view è invecchiata. Una la dichiara la view (`refresh`/`follows`),
  // l'altra la dice il provider quando ha finito qualcosa che il vault non
  // vede.
  mountViewInvalidation(pageWindowLifetime);
  mountExplorer(pageWindowLifetime);
  mountLinkPreview(pageWindowLifetime);
  mountBookmarksPanel(pageWindowLifetime);
  mountWorkspacesPanel(pageWindowLifetime);
  mountShellOwnerCommands();
  pageWindowLifetime.add(hidePreview);
  // La ricerca **dentro** la nota aperta (§21.4): stesso motore della casella
  // del vault, raggio ristretto al documento col fuoco. È un comando e non un
  // pannello, quindi qui basta dichiararlo.
  mountDocSearch();
  mountSearch(pageWindowLifetime);
  pageWindowLifetime.add(mountQuickSwitcher(async (doc, mode) => {
    if (mode === "window") {
      await openCurrentInNewWindow(doc);
      return;
    }
    if (mode === "split") {
      const parent = paneLayout.focus;
      const added = splitPane(parent, "row");
      if (!added) return;
      try {
        await openDocument(doc);
      } catch (error) {
        closePane(added);
        throw error;
      }
      return;
    }
    await openDocument(doc);
  }));
  pageWindowLifetime.add(closeCommandPalette);
  pageWindowLifetime.add(closeInDocumentSearch);
  pageWindowLifetime.add(closeContextMenu);
  // La rail (§Fase 2): le icone shell a sinistra — Note, Cerca, Grafo —
  // sempre visibili. Le view dichiarate `left_sidebar` si aggiungono dopo,
  // a ogni apertura di vault, con `syncRail()`. Va prima di `mountGraph`
  // perché crea `#show-graph`, che `mountGraph` ascolta.
  pageWindowLifetime.add(mountRail());
  mountGraph(pageWindowLifetime);
  // Le due superfici della barra di stato (§10.3): cosa sta girando, e cosa è
  // stato detto. Il centro attività si iscrive agli eventi del kernel, quindi
  // va montato prima che il router parta.
  mountNotifications(pageWindowLifetime);
  mountActivity(pageWindowLifetime);
  // La tastiera rilegge gli accordi quando una scorciatoia cambia (§18.2): anche
  // lei si iscrive a `setting_changed`, quindi anche lei prima del router.
  mountKeyOverrides(pageWindowLifetime);
  // Il pannello delle impostazioni (§11.1): il form lo genera lui dallo schema
  // che i componenti dichiarano, e da lì passano anche i componenti da
  // accendere e i vault conosciuti. Va montato prima del router, come il centro
  // attività: si iscrive a `setting_changed`.
  // Le due cose che il pannello di impostazioni fa fare al resto della shell e
  // non sa fare da sé: aprire un vault (che è una dozzina di passi in ordine, e
  // stanno scritti in un punto solo) e riscoprire i provider dopo che un
  // componente si è acceso o spento.
  mountSettings({
    openVault: openVaultPath,
    reloadProvider: async () => {
      // Le stesse due domande dell'apertura, e per la stessa ragione insieme:
      // non si leggono a vicenda, e chi accende un componente le aspetta
      // entrambe.
      await Promise.all([mountDeclaredViews(pageWindowLifetime), loadCommandSpecs()]);
      if (!alive()) return;
      syncRail();
    },
  }, pageWindowLifetime);

  pageWindowLifetime.listen($("#open-vault"), "click", () => void pickVault());

  // I due comandi che sono **di qui e di nessun pannello**: aprire un vault e
  // aprire la palette. Come ogni altro pannello, questo file dichiara i propri
  // (§18.2) invece di tenere l'elenco di tutti.
  //
  // Che la palette sia un comando come gli altri non è una civetteria: fino a
  // ieri il suo `Mod-Shift-p` era l'unica combinazione cablata dentro il
  // `keydown`, cioè l'unica che non compariva da nessuna parte e che nessuno
  // poteva scoprire senza leggere questo file.
  registerShellCommand({
    id: "shell.vault.open",
    title: "commands.vault.open",
    description: "commands.vault.open.desc",
    layer: "global",
    run: () => void pickVault(),
  });
  registerShellCommand({
    id: "shell.palette",
    title: "commands.palette",
    description: "commands.palette.desc",
    layer: "global",
    run: () => void openCommandPalette(paletteHost),
  });
  mountSidebarCommands();

  // La menubar applicativa (§Fase 2): cinque voci che invocano i comandi
  // di shell già registrati. Il menu non registra niente: legge il
  // registro, e `main.ts` gli inietta `run(id)` che risolve l'entry e la
  // esegue come farebbe la tastiera.
  pageWindowLifetime.add(mountAppMenu({
    run: (id) => {
      const entry = allCommands().find((e) => e.id === id);
      if (entry) startCommand(entry, paletteHost);
    },
  }));
  refreshTitlebarShortcuts();

  // Il trigger di ricerca nella titlebar: fa focus su `#search-input`, che è
  // la ricerca onesta — già lì, già cablata — e non una palette travestita.
  // Il suggerimento mostra l'accordo di `shell.panel.search`, per chi cerca un comando.
  pageWindowLifetime.listen($("#command-search"), "click", () => {
    showPanel("search");
    $("#search-input").focus();
  });
  pageWindowLifetime.listen($("#open-palette"), "click", () =>
    void openCommandPalette(paletteHost),
  );

  // La tastiera, in un punto solo, e su **un registro solo**: i comandi del
  // kernel e quelli della shell, con l'accordo efficace di ognuno — quello che
  // l'utente ha scelto, o quello dichiarato. La shell non cabla nessuna
  // combinazione: se un domani un plugin dichiara `Mod-Shift-t`, o `Mod-k d`,
  // funziona senza toccare questo file. Cos'è un accordo e quando è finito lo
  // sa `ui/keyboard.ts`, che è il posto in cui una sequenza a metà ha un tempo
  // e una via d'uscita (§18.2).
  mountKeyboard(pageWindowLifetime, (entry) => startCommand(entry, paletteHost));

  listenForFailures(pageWindowLifetime);

  const stopRouter = await startKernelRouter();
  if (!alive()) {
    stopRouter();
    return teardown;
  }
  pageWindowLifetime.add(stopRouter);

  // L'avviso di sessione (§25.5): la diagnosi «la cartella di configurazione
  // non si può scrivere» nasce all'avvio del backend, quando nessun ascoltatore
  // esiste ancora — una spinta sarebbe emessa nel vuoto. Si tira adesso, col
  // router in piedi, e si consegna come un evento qualunque: l'ordine dell'IPC
  // garantisce che `listenForFailures` — iscritta prima del router — sia già
  // lì a riceverlo.
  const notice = await api.sessionNotice();
  if (!alive()) return teardown;
  if (notice) forwardNotice(notice);

  // Il locale del sistema (§12.3), **prima** di aprire il vault: da qui in poi
  // ogni `render_view` lo trova già pubblicato, invece di disegnare il primo
  // giro con la lingua indeterminata e correggersi dopo. Chi lo cambia da fuori
  // — impostazioni del sistema, ora legale — se ne accorge al ritorno del
  // focus, e allora si ridisegna ciò che è appeso al contesto.
  mountLocale(pageWindowLifetime, () => {
    if (alive()) void mountDeclaredViews(pageWindowLifetime);
  });

  // Gli accordi riconfigurati, **prima** di sapere se un vault c'è (§16.3).
  // Quelli dei comandi di shell vivono nella macchina e non nel vault, quindi
  // esistono anche adesso: senza questa riga la finestra vuota risponderebbe
  // solo agli accordi dichiarati, cioè chi ha rimappato «Apri un vault»
  // troverebbe la sua combinazione muta esattamente nella schermata in cui
  // serve. Con un vault aperto la riga dopo la rifà, e costa una domanda.
  await loadKeyOverrides();
  if (!alive()) return teardown;
  refreshTitlebarShortcuts();

  const initial = await api.initialVault();
  if (!alive()) return teardown;
  // Chi apre un vault ripristina anche la sua disposizione (§1.2): è là dentro
  // che si sa quale fosse. Senza vault iniziale si disegna comunque il layout di
  // default, perché la finestra vuota deve essere in uno stato coerente — un
  // riquadro, vuoto, col fuoco — e non in nessuno stato.
  // La shell adattiva (P2) si monta prima di sapere se un vault c'è: mostra
  // l'onboarding a vault vuoto e applica i breakpoint, senza toccare l'ordine
  // di apertura qui sotto.
  mountAdaptiveShell();
  if (initial) await openVaultPath(initial, alive);
  else await synchronize();
  if (!alive()) return teardown;
  // L'avviso di una ricarica voluta (un ripristino da snapshot): la finestra
  // che lo ha chiesto non c'è più per dirlo.
  const reloaded = takeNoticeAfterReload();
  if (reloaded) notify(reloaded);
  return teardown;
}

async function pickVault(): Promise<void> {
  if (pageWindowLifetime.closed) return;
  const dir = await pickFolder();
  if (dir && !pageWindowLifetime.closed) await openVaultPath(dir);
}

async function openVaultPath(
  dir: string,
  alive: () => boolean = () => !pageWindowLifetime.closed,
  alreadyDrained = false,
): Promise<void> {
  if (!alive()) return;
  if (state.vaultRoot && !alreadyDrained && !await drainDocumentWindows()) return;
  if (!alive()) return;
  const info = await api.openVault(dir);
  if (!alive()) return;
  // Il segnale watcher è del vault che si sta aprendo: azzerarlo subito, poi
  // `warnIfUnwatched` lo rialza col suo stato (I04, mai verità del vault prima).
  setWatcherOff(false);
  vaultPathEl.textContent = info.root;
  // «Questo vault si è aperto a metà» (§15.7): la riga che il contratto teneva
  // in serbo per una superficie che non c'era. Ogni voce esce anche come evento
  // `trouble` — e da lì il centro notifiche la mostra già — ma la si legge
  // **anche** dall'esito, che è la ragione per cui il campo esiste: aprire un
  // vault è il carico sotto cui la coda eventi tronca (§20.5), e una nota che
  // la ricerca non trova e che il grafo non collega è precisamente ciò che non
  // si scopre finché non la si cerca.
  if (info.unread.length > 0) {
    notify(t("vault.partial", { count: info.unread.length }), "guasto");
  }
  state.vaultRoot = info.root;
  state.handledExtensions =
    info.extensions.length > 0 ? info.extensions : state.handledExtensions;
  // Lo stato di vista di **questo** vault (§11.2): come lo si stava guardando.
  // Dopo l'apertura, perché è il backend a tenerlo e la chiave è il vault
  // aperto; e prima del segnale, perché chi si iscrive disegna con questi.
  //
  // Il layout è il pezzo che il §11.2 aspettava: quanti riquadri, con che tab
  // dentro, in che modalità ciascuno. Non c'è più un `closeDocument()` qui —
  // chiudeva il documento del vault precedente perché non c'era niente da
  // ripristinare al posto suo, e adesso c'è: la finestra riparte com'era.
  //
  // **Insieme, e non in fila**: sono quattro domande che non si leggono a
  // vicenda — l'organizzazione, il layout, le cartelle aperte, lo spazio
  // attivo — e ciascuna è un giro sull'IPC. In fila costavano cinque andate e
  // ritorno (`loadLayout` ne fa due di suo), e chi apre un vault le paga
  // tutte una dopo l'altra prima di vedere qualcosa. L'ordine che i commenti
  // qui sopra dichiarano è **rispetto a `openVault` e al segnale**, non fra
  // loro: `Promise.all` lo tiene fermo. Nessuna delle quattro può rifiutare —
  // tutte e quattro hanno il proprio `catch` dentro — quindi qui non c'è la
  // domanda «cosa resta a metà se una va storta».
  await Promise.all([loadOrganization(), loadLayout(), loadExpanded(), loadActiveSpace()]);
  if (!alive()) return;
  await synchronize();
  if (!alive()) return;
  // **Ciò che era rimasto non salvato** (§15.2), e sta qui accanto a
  // `vault.partial` perché è la stessa specie di riga: due cose che l'apertura
  // deve dire e che nessun'altra superficie direbbe. La differenza è il verso —
  // là il vault ha perso qualcosa da leggere, qui l'utente ritrova qualcosa che
  // aveva scritto — ed è dopo il layout di proposito: il testo recuperato è un
  // buffer, e i buffer vanno messi quando i riquadri ci sono già.
  const recovered = await recoverDrafts();
  if (!alive()) return;
  if (recovered > 0) {
    notify(t("draft.found", { count: recovered }), "info");
  }
  // Da qui in poi lo stato del vault è coerente: chi ne dipende può ripartire.
  emit("vault", info.root);

  clearSearch();
  emit("documents");

  // Le view dichiarative si scoprono dal backend, non da id cablati. E come le
  // view, i comandi: l'elenco serve alle scorciatoie dichiarate — la palette lo
  // richiede da sé a ogni apertura, perché è il momento in cui costa nulla ed è
  // l'unico in cui deve essere fresco.
  //
  // Gli accordi riconfigurati vivono nelle impostazioni di **questo** vault
  // (0076), quindi si rileggono quando il vault cambia — insieme ai comandi che
  // ne sono i proprietari. «Insieme» qui è letterale: i tre elenchi non si
  // leggono a vicenda, e chi li aspetta è la riga dopo, che li vuole tutti e
  // tre. In fila erano tre andate e ritorno, adesso una.
  //
  // L'unica differenza che resta: se `list_views` rifiuta, i due elenchi che
  // prima non venivano nemmeno chiesti adesso arrivano lo stesso. È il verso
  // buono — un vault che si apre male tiene comunque i comandi e gli accordi —
  // e `Promise.all` rifiuta come rifiutava `mountDeclaredViews` da solo.
  await Promise.all([mountDeclaredViews(pageWindowLifetime), loadCommandSpecs(), loadKeyOverrides()]);
  if (!alive()) return;
  // S5-1: `mountDeclaredViews` svuota i contenitori delle view dichiarate
  // (views.ts) prima di rimontarle, e il grafo — view dichiarata anche lui —
  // resta senza superficie. `synchronize()` rifà il giro di `show` per ogni
  // riquadro e rimonta le view dichiarate (`montaVistaInRiquadro` in
  // document.ts è idempotente): è il passaggio che rimette a posto la tab del
  // grafo dopo l'azzeramento di `mountDeclaredViews`.
  await synchronize();
  if (!alive()) return;
  // Le view dichiarate `left_sidebar` sono state montate in `#views-left`:
  // la rail le scopre e aggiunge i bottoni dopo che `mountDeclaredViews` ha
  // riempito l'host.
  syncRail();
  if (!alive()) return;
  await warnIfCommandsContendKey();
  if (!alive()) return;
  // **Dopo** i conflitti, e non è indifferente: una scorciatoia sospesa non è in
  // vigore, quindi non partecipa a nessun conflitto — e dire prima «questo vault
  // ne propone tre» farebbe leggere l'avviso dei conflitti come se le riguardasse.
  await warnIfVaultProvidesKeys();
  if (!alive()) return;

  await warnIfUnwatched();
  if (!alive()) return;

  // La prima nota, chiesta con una finestra da uno (§14.4): l'apertura del
  // vault non porta più l'elenco intero, e per aprirne una non serve.
  //
  // **Solo se non c'era niente da ripristinare.** Aprire la prima nota era la
  // cosa giusta quando la finestra ripartiva sempre vuota; adesso che si
  // ricorda com'era, farlo comunque vorrebbe dire scavalcare con una nota
  // qualunque le tab che l'utente aveva lasciato aperte.
  if (!activeDoc()) {
    const before = await beforeNote();
    if (!alive()) return;
    if (before) {
      await openDocument(before);
      if (!alive()) return;
    }
  }
}

/// Se due comandi si contendono la stessa combinazione, **dirlo** (§18.2).
///
/// È l'unica cosa di questa voce che non veniva gratis. Un conflitto non è un
/// errore da rifiutare — chi ha rimappato ha il diritto di sbagliare, e
/// rifiutare la scrittura vorrebbe dire non poter scambiare due scorciatoie fra
/// loro senza passare per uno stato illegale — ma è qualcosa che nessuno
/// scoprirebbe da sé: si preme, parte l'altro comando, e non c'è niente da
/// guardare. L'avviso nomina i comandi, perché è da lì che si va a cambiarne
/// uno.
async function warnIfCommandsContendKey(): Promise<void> {
  const phrase = conflictMessage(allCommands());
  if (phrase) notify(phrase, "guasto");
}

/// Se questo vault propone dei tasti che nessuno ha guardato, **dirlo** (§23.13).
///
/// Un vault viaggia — un repo clonato, una cartella condivisa, un vault di
/// esempio — e le sue scorciatoie viaggiano con lui. Finché nessuno le ha
/// guardate non premono niente, che è la metà silenziosa di questa voce; questa
/// è l'altra metà, perché una scorciatoia sospesa e taciuta sarebbe una
/// configurazione che non fa effetto e nessuno che sappia dire perché.
///
/// L'avviso **nomina i comandi** e non li conta soltanto, per la stessa ragione
/// dei conflitti: «hai tre scorciatoie in sospeso» manda a cercare quali. E la
/// risposta non sta qui — sta nel pannello delle impostazioni, dove quelle righe
/// vivono e si vedono una per una. Un avviso con due bottoni chiederebbe di
/// decidere senza guardare, che è il gesto che questa voce esiste per non
/// insegnare.
async function warnIfVaultProvidesKeys(): Promise<void> {
  try {
    const suggested = await api.pendingKeybindings();
    const keys = Object.keys(suggested);
    if (keys.length === 0) return;
    const forKey = new Map(allCommands().map((c) => [keybindingKey(c.id), c.title]));
    const names = keys.map((k) => forKey.get(k) ?? k).join(", ");
    notify(t("app.vault_keys_pending", { count: keys.length, commands: names }));
  } catch {
    // Un vault che non sa dire cosa propone non è un motivo per non aprirlo, e
    // il silenzio qui è dalla parte giusta: le chiavi restano sospese finché
    // qualcuno non risponde, quindi ciò che si perde è la domanda, non il
    // presidio.
  }
}

/// Se questo vault non ha il rilevamento delle modifiche esterne, dirlo (§9.7).
///
/// È la promessa che Fub non manteneva in silenzio: senza watcher nessuno
/// vede le scritture altrui — network share, cloud drive, vault sincronizzati
/// con strumenti esterni — e il salvataggio successivo copre ciò che non è
/// stato visto. Un avviso all'apertura non è l'indicatore permanente che il
/// §20.4 chiedeva insieme allo stato del salvataggio — quello, per il watcher,
/// resta da fare — ma passa dalla stessa porta di tutto il resto, e non da una
/// console.
async function warnIfUnwatched(): Promise<void> {
  try {
    const state = await vaultStatus();
    setWatcherOff(!state.watching);
    if (!state.watching) {
      notify(t("app.external_changes"));
    }
  } catch {
    // Un vault che non sa dire come sta non è un motivo per non aprirlo: il
    // canale dati ha già risposto a tutto il resto.
  }
}

// Un avvio che fallisce non deve morire in silenzio: senza questo, un errore
// dell'IPC lascia la finestra a metà (lista file sì, vault no) e l'unico posto
// dove si vedeva era la console della webview, che in un'app impacchettata non
// si apre. Questo era l'unico fallimento della shell che arrivasse all'utente, e
// ci arrivava perché la barra del vault è il posto più visibile che c'era; col
// §20.4 la superficie vera c'è, e questo punto smette di essere l'eccezione per
// diventare la regola. **La barra resta**, e non è un doppione: l'avviso dice
// cosa è successo mentre succede, la barra dice perché quella finestra è a metà
// anche a chi la guarda un minuto dopo — che è la stessa coppia «una volta /
// finché non è riparato» dello stato di salvataggio.
//
// **L'avvio si esporta** (§17.2): non perché qualcuno lo attenda in produzione
// — in produzione questo è l'ultimo file che viene eseguito, e non c'è nessuno
// dopo — ma perché senza questa riga l'avvio non è *osservabile*. Un E2E che
// non può aspettare la fine del montaggio deve dormire un tempo a caso e
// sperare, cioè diventa un presidio che ogni tanto passa; e questa è l'unica
// promessa che la shell fa sul proprio boot. Chi la esporta la dichiara.
export function mountDesktopShell(): Promise<Teardown> {
  if (mounted && !pageWindowLifetime.closed) return mounted;
  if (pageWindowLifetime.closed) pageWindowLifetime = openLifetime();
  const lifetime = pageWindowLifetime;
  mounted = init().catch((e) => {
    const reason = errorText(e);
    const alreadyClosed = lifetime.closed;
    if (!alreadyClosed) {
      pageEpoch++;
      lifetime.close();
      notify(t("app.start_failed", { reason }), "guasto");
      vaultPathEl.textContent = t("app.start_failed", { reason });
    }
    return () => lifetime.close();
  });
  return mounted;
}

export const startup: Promise<Teardown> = mountDesktopShell();

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
import { pickVaultLocation } from "./platform/vault-picker";
import { onClose, api, window as nativeWindow } from "./host/ipc";
import { vaultStatus, vaultEntries, settings } from "./host/query";
import { forwardNotice, onEvent, startKernelRouter } from "./state/kernel";
import { mountLocale } from "./state/locale";
import { loadOrganization } from "./state/organization";
import { emit, loadActiveSpace, loadExpanded, on, state } from "./state/store";
import { loadLayout, activeDoc, layout as paneLayout, split as splitPane, closePane } from "./state/layout";
import { loadCommandSpecs, beforeNote, createNote } from "./state/vault";
import { $ } from "./ui/dom";
import { applyIntent, takeNoticeAfterReload } from "./ui/intents";
import { mountLinkPreview } from "./ui/link-preview";
import { listenForFailures, mountNotifications, notify, setWatcherOff } from "./ui/notify";
import { closeCommandPalette, openCommandPalette, startCommand } from "./ui/palette";
import {
  allCommands,
  conflictMessage,
  displayBinding,
  keybindingKey,
  loadKeyOverrides,
  mountKeyOverrides,
  registerShellCommand,
} from "./ui/commands";
import { mountKeyboard } from "./ui/keyboard";
import { openLifetime, type Lifetime, type Teardown } from "./ui/lifetime";
import { mountSidebarCommands, showPanel } from "./panels/sidebar";
import { revealSidePanel, setSidePanelController, toggleSidePanel, type SidePanel } from "./ui/side-panels";
import { mountPanelHost, refreshAllPanels } from "./ui/panel-host";
import { mountDeclaredViews, mountViewInvalidation } from "./ui/views";
import { openPrimaryView, opensWithoutParams, primaryViews } from "./ui/primary-views";
import { mountTitlebar } from "./ui/titlebar";
import { mountLongPressMenus } from "./ui/long-press";
import { platformSupports } from "./platform/capabilities";
import { mountAppMenu } from "./ui/app-menu";
import { mountWebviewFocusMonitor } from "./ui/node";
import { registerMermaidRenderer } from "./ui/mermaid";
import { mountOnboarding } from "./ui/onboarding";
import { registerBaseRenderer } from "./editors/base/surface";
import { applyRailMachineSettings, mountRail, refreshRailShortcuts, syncRail } from "./panels/rail";
import { mountStrings, onLanguage, plural, t } from "./i18n/strings";
import { mountActivity } from "./panels/activity";
import { mountSettings } from "./panels/settings";
import { mountTheme } from "./theme/theme";
import { reducedMotion } from "./theme/reduced-motion";
import {
  freezeDocumentSurfaces,
  mountDocument,
  focusEditor,
  openDocument,
  recoverDrafts,
  resetDocumentsForVault,
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
import { pageName } from "./rules/mirrored";
import type { ShellGeometry } from "./state/shell-geometry";
import { configureRail } from "./panels/rail";
import { mountBookmarksPanel } from "./state/bookmarks-ui";
import { mountWorkspacesPanel } from "./state/workspaces-ui";
import { mountShellOwnerCommands } from "./state/shell-commands";
import { hidePreview } from "./state/preview";
import { closeContextMenu } from "./ui/menu";
import { setTooltip } from "./ui/tooltip";
import type { SettingEntry } from "./host/contract";
import { adoptLegacyChrome, writeChrome } from "./state/machine-chrome";
import { Race } from "./ui/race";

/// Le impostazioni della macchina che ricordano i due pannelli laterali, e le
/// chiavi `localStorage` dove stavano prima (si adottano una volta).
const SIDE_SETTING = { sidebar: "chrome.sidebar.visible", inspector: "chrome.inspector.visible" } as const;
const LEGACY_SIDE = { sidebar: "fub.layout.sidebar", inspector: "fub.layout.inspector" } as const;

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
    // Non c'è più una barra in fondo: l'impostazione accende e spegne lo stato
    // del documento nella toolbar del riquadro (`#pane-status`).
    document.getElementById("app")?.toggleAttribute("data-status-off", valid && values.get("chrome.status.visible") === false);
    toolbarVisible = !valid || values.get("chrome.toolbar.visible") !== false;
    applyToolbar();
    if (frameAtBoot === null) {
      frameAtBoot = valid && values.get("chrome.frame") === "system" ? "system" : "custom";
      if (platformSupports("nativeWindowControls")) {
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
  const createBtn = document.getElementById("onboarding-create");
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
  // I divisori si trascinano con un puntatore fine: su una shell touch-first
  // restano nascosti anche quando i pannelli sono affiancati.
  const resizable = platformSupports("finePointer");
  let opening = false;
  let lastDir: string | null = null;
  let lastTrigger: HTMLElement | null = null;
  // Preferenze esplicite (L01): mai sovrascritte dall'adattamento. Sono
  // impostazioni della macchina, come il resto della cornice
  // (`state/machine-chrome.ts`); finché non si leggono vale il default,
  // cioè affiancati.
  let sidebarPref: boolean | null = null;
  let inspectorPref: boolean | null = null;
  const hasVault = (): boolean => state.vaultRoot !== "";
  // Lo scrim sta sotto il cassetto e sopra i riquadri: dentro il pannello
  // coprirebbe il pannello stesso, e ogni clic nel cassetto lo chiuderebbe.
  for (const scrim of [sidebarScrim, inspectorScrim]) if (scrim) layout.append(scrim);
  const closeDrawers = (restore = true): void => {
    layout.classList.remove("drawer-sidebar-open", "drawer-inspector-open");
    if (sidebarScrim) sidebarScrim.hidden = true;
    if (inspectorScrim) inspectorScrim.hidden = true;
    if (restore && lastTrigger?.isConnected) lastTrigger.focus();
    lastTrigger = null;
  };
  /// Sotto quale larghezza il pannello non sta più affiancato ed è un cassetto.
  const drawerBelow = (side: SidePanel): number => side === "sidebar" ? 960 : 1200;
  const isDrawer = (side: SidePanel): boolean => globalThis.window.innerWidth < drawerBelow(side);
  // Un solo drawer laterale aperto per volta in modalità compatta (L02).
  // La chiusura ripristina il focus al trigger (C04); Esc chiude (C03).
  // Lo aprono i comandi `shell.sidebar.toggle`/`shell.inspector.toggle`, la
  // rail e chiunque chieda un pannello (`ui/side-panels.ts`).
  const applyAdaptive = (): void => {
    const width = globalThis.window.innerWidth;
    layout.classList.toggle("layout-inspector-overlay", width >= 960 && width < 1200);
    layout.classList.toggle("layout-compact", width < 960);
    // Una preferenza vale per il pannello affiancato; da cassetto il
    // pannello si vede solo se è stato aperto.
    const inspectorOpen = !isDrawer("inspector") && (inspectorPref ?? true);
    const sidebarOpen = !isDrawer("sidebar") && (sidebarPref ?? true);
    sidebar.hidden = !sidebarOpen && !layout.classList.contains("drawer-sidebar-open");
    inspector.hidden = !inspectorOpen && !layout.classList.contains("drawer-inspector-open");
    if (divSidebar) divSidebar.hidden = !resizable || sidebar.hidden;
    if (divInspector) divInspector.hidden = !resizable || inspector.hidden;
    if (width >= 1200) closeDrawers(false);
    else if (width >= 960 && layout.classList.contains("drawer-sidebar-open")) closeDrawers(false);
  };
  const rememberPreference = (side: SidePanel, open: boolean): void => {
    if (side === "sidebar") sidebarPref = open;
    else inspectorPref = open;
    // La preferenza vale per questa sessione anche se la macchina non la ricorda.
    void writeChrome(SIDE_SETTING[side], open).catch(() => notify(t("state.not_remembered"), "info"));
  };
  const sideReads = new Race();
  const readSidePreferences = () => sideReads.last(async (expected) => {
    const entries = await expected(settings().catch(() => null));
    if (!entries) return;
    const values = new Map(entries.map((entry) => [entry.spec.key, entry]));
    if (values.get("chrome.schema")?.value !== 1) return;
    for (const side of ["sidebar", "inspector"] as const) {
      const entry = values.get(SIDE_SETTING[side]);
      if (!entry) continue;
      // Solo «chiuso» era una scelta: «aperto» è il default.
      const legacy = await expected(adoptLegacyChrome(LEGACY_SIDE[side], entry, (raw) => raw === "0" ? false : null));
      const open = legacy ?? entry.value !== false;
      if (side === "sidebar") sidebarPref = open;
      else inspectorPref = open;
    }
    applyAdaptive();
  });
  life.add(() => sideReads.cancel());
  life.add(onEvent("setting_changed", ({ key }) => {
    if (key === "chrome.schema" || key === SIDE_SETTING.sidebar || key === SIDE_SETTING.inspector) {
      void readSidePreferences();
    }
  }));
  void readSidePreferences();
  const openDrawer = (side: SidePanel): void => {
    const panel = side === "sidebar" ? sidebar : inspector;
    const scrim = side === "sidebar" ? sidebarScrim : inspectorScrim;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeDrawers(false);
    lastTrigger = trigger;
    layout.classList.add(`drawer-${side}-open`);
    if (scrim) scrim.hidden = false;
    applyAdaptive();
    if (!panel.contains(document.activeElement)) {
      panel.querySelector<HTMLElement>("input:not([disabled]), [tabindex='0'], button:not([disabled])")?.focus();
    }
  };
  life.add(setSidePanelController({
    visible: (side) => !(side === "sidebar" ? sidebar : inspector).hidden,
    reveal: (side) => {
      if (isDrawer(side)) {
        if (!layout.classList.contains(`drawer-${side}-open`)) openDrawer(side);
        return;
      }
      if ((side === "sidebar" ? sidebar : inspector).hidden) {
        rememberPreference(side, true);
        applyAdaptive();
      }
    },
    toggle: (side) => {
      if (isDrawer(side)) {
        if (layout.classList.contains(`drawer-${side}-open`)) {
          closeDrawers(true);
          applyAdaptive();
        } else {
          openDrawer(side);
        }
        return;
      }
      rememberPreference(side, (side === "sidebar" ? sidebar : inspector).hidden);
      applyAdaptive();
    },
  }));
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
      item.className = "onboarding-recent-item";
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
      // Un vault spostato o cancellato restava nell'elenco per sempre: qui si
      // toglie dai recenti, e la cartella resta dov'è.
      const forget = document.createElement("button");
      forget.type = "button";
      forget.className = "onboarding-forget";
      forget.textContent = "×";
      forget.setAttribute("aria-label", t("onboarding.recent.forget", { name }));
      setTooltip(forget, t("onboarding.recent.forget.hint"));
      forget.addEventListener("click", () => {
        void api.forgetVault(vault.root).then(
          async () => {
            await refreshRecents();
            // Il bottone premuto non c'è più: il fuoco va al recente che ha
            // preso il suo posto, o all'apertura se l'elenco è finito.
            (recentList.querySelector<HTMLElement>("button") ?? openBtn)?.focus();
          },
          (error: unknown) => notify(errorText(error), "guasto"),
        );
      });
      item.append(open, forget, path);
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
    // Le view principali nella rail: senza vault non c'è un kernel a cui
    // chiederle.
    for (const view of document.querySelectorAll<HTMLButtonElement>("#views-ribbon .rail-btn-main")) {
      view.disabled = empty;
      view.setAttribute("aria-disabled", String(empty));
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
  const onPick = async (title?: string): Promise<void> => {
    if (opening || life.closed) return;
    // Picker annullato = stato invariato (U04): un selettore che torna null
    // non tocca nulla.
    const dir = await pickVaultLocation(title);
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
        applyAdaptive();
      }
    }
  });
  if (sidebarScrim) pageWindowLifetime.listen(sidebarScrim, "click", () => { closeDrawers(true); applyAdaptive(); });
  if (inspectorScrim) pageWindowLifetime.listen(inspectorScrim, "click", () => { closeDrawers(true); applyAdaptive(); });
  if (resizable) {
    mountDivider(divSidebar, sidebar, 1, 200, 360);
    mountDivider(divInspector, inspector, -1, 240, 400);
  }
  if (openBtn) pageWindowLifetime.listen(openBtn, "click", () => void onPick());
  // Un vault nuovo è una cartella vuota aperta come vault: il selettore di
  // sistema sa già crearne una, qui gli si dice che è quello che si vuole.
  if (createBtn) pageWindowLifetime.listen(createBtn, "click", () => void onPick(t("onboarding.create.title")));
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
  // Delegato sulla rail: i bottoni delle view principali nascono e muoiono a
  // ogni giro di `syncRail`, la rail resta.
  const ribbon = document.getElementById("views-ribbon");
  if (ribbon) {
    pageWindowLifetime.listen(ribbon, "click", (event) => {
      if ((event.target as Element | null)?.closest?.(".rail-btn-main")) guardContext(event);
    }, { capture: true });
  }
  const searchInput = document.getElementById("search-input");
  if (searchInput) pageWindowLifetime.listen(searchInput, "click", guardContext, { capture: true });
  // Solo la shell apre i vault e sceglie cartelle: onboarding si iscrive una
  // volta alla stessa vita di pagina, senza un secondo listener sul picker.
  const showEmptyVault = async (): Promise<void> => {
    if (life.closed) return;
    state.vaultRoot = "";
    showVaultName("");
    await loadLayout(preferredPaneMode());
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
  pageWindowLifetime.add(on("active-doc", () => drawWindowTitle()));
  void refreshRecents();
}

const vaultPathEl = $("#vault-path");

/// Il nome con cui si riconosce il vault aperto: quello scelto nel registro dei
/// vault, altrimenti la cartella. Il percorso intero resta nel suggerimento.
let vaultName = "";

function folderName(root: string): string {
  return root.split(/[\\/]/).filter(Boolean).pop() ?? root;
}

/// La barra del titolo mostrava il percorso assoluto, che in una finestra
/// stretta si taglia proprio dove sta il nome.
function showVaultName(root: string): void {
  vaultName = root ? folderName(root) : "";
  vaultPathEl.textContent = vaultName;
  setTooltip(vaultPathEl, root);
  drawWindowTitle();
  if (!root) return;
  void api.knownVaults().then((known) => {
    if (state.vaultRoot !== root) return;
    const entry = known.find((vault) => vault.root === root);
    if (entry?.name) vaultName = entry.name;
    vaultPathEl.textContent = `${entry?.icon ?? ""} ${vaultName}`.trim();
    drawWindowTitle();
  }).catch(() => {});
}

/// Il titolo della finestra: la nota, il vault, l'app. È ciò che si legge
/// nella barra delle applicazioni e passando da una finestra all'altra.
function drawWindowTitle(): void {
  const doc = state.currentDoc;
  const note = doc ? pageName(doc) : null;
  const title = [note, vaultName || null, "Fub"].filter((part): part is string => !!part).join(" — ");
  if (document.title === title) return;
  document.title = title;
  // Dentro una promessa: il titolo nativo non deve poter interrompere chi
  // l'ha chiesto (l'apertura di un vault), nemmeno lanciando in sincrono.
  void Promise.resolve().then(() => nativeWindow.setTitle(title)).catch(() => {});
}

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

/// Porta sui bottoni della titlebar l'accordo efficace del comando, scritto
/// come si preme: dentro il campo di ricerca, e nel tooltip della palette.
function refreshTitlebarShortcuts(): void {
  refreshRailShortcuts();
  const binding = (id: string): string =>
    displayBinding(allCommands().find((entry) => entry.id === id)?.binding ?? null);
  const key = document.getElementById("command-search-key");
  if (key instanceof HTMLElement) {
    key.textContent = binding("shell.panel.search");
    key.hidden = key.textContent === "";
  }
  const palette = document.getElementById("open-palette");
  if (palette instanceof HTMLElement) {
    const chord = binding("shell.palette");
    setTooltip(palette, chord === "" ? t("commands.palette") : `${t("commands.palette")} (${chord})`);
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
  // Un dito apre i menu contestuali con la pressione lunga: gli stessi del
  // tasto destro, senza che ogni menu debba saperlo.
  mountLongPressMenus(pageWindowLifetime);
  registerMermaidRenderer();
  registerBaseRenderer((doc) => openDocument(doc));
  // I tre collegamenti iniettati, e la ragione per cui lo sono: il pannello del
  // documento mostra l'anteprima (in Lettura) e l'anteprima apre i documenti;
  // il pannello del documento manda a cercare un tag e la ricerca apre i
  // documenti; il grafo apre la nota di un nodo. In tutti i casi importarsi a
  // vicenda sarebbe un ciclo, e in un bundle ESM un ciclo è un `undefined`
  // all'avvio che non dice da dove viene. È la stessa forma con cui i tre
  // moduli dell'editor ricevono il mondo.
  // Un tag cliccato si cerca con la sintassi della barra (`tag:nome`), la
  // stessa che scriverebbe chi cerca a mano: sotto-tag compresi.
  mountDocument(pageWindowLifetime, {
    searchTag: (tag) => searchFor(/[\s"()[\]]/.test(tag) ? `tag:"${tag.replace(/"/g, "")}"` : `tag:${tag}`),
  });

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
  // La rail (§Fase 2): le icone shell a sinistra — Note, Cerca — sempre
  // visibili. Le view dichiarate (principali e `left_sidebar`) si aggiungono
  // dopo, a ogni apertura di vault, con `syncRail()`.
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
  registerShellCommand({
    id: "shell.sidebar.toggle",
    title: "commands.sidebar.toggle",
    description: "commands.sidebar.toggle.desc",
    layer: "global",
    run: () => toggleSidePanel("sidebar"),
  });
  registerShellCommand({
    id: "shell.inspector.toggle",
    title: "commands.inspector.toggle",
    description: "commands.inspector.toggle.desc",
    layer: "global",
    run: () => toggleSidePanel("inspector"),
  });
  registerShellCommand({
    id: "shell.settings",
    title: "commands.settings",
    description: "commands.settings.desc",
    layer: "global",
    run: () => document.getElementById("open-settings")?.click(),
  });
  registerShellCommand({
    id: "shell.note.new",
    title: "commands.note.new",
    description: "commands.note.new.desc",
    layer: "global",
    available: () => state.vaultRoot !== "",
    run: () => void newNoteInActiveSpace(),
  });
  registerShellCommand({
    id: "shell.zoom.in",
    title: "commands.zoom.in",
    description: "commands.zoom.in.desc",
    layer: "global",
    run: () => void zoomBy(1),
  });
  registerShellCommand({
    id: "shell.zoom.out",
    title: "commands.zoom.out",
    description: "commands.zoom.out.desc",
    layer: "global",
    run: () => void zoomBy(-1),
  });
  registerShellCommand({
    id: "shell.zoom.reset",
    title: "commands.zoom.reset",
    description: "commands.zoom.reset.desc",
    layer: "global",
    run: () => void zoomBy(0),
  });
  registerShellCommand({
    id: "shell.focus.toggle",
    title: "commands.focus.toggle",
    description: "commands.focus.toggle.desc",
    layer: "global",
    run: () => toggleFocusMode(),
  });

  // La menubar applicativa (§Fase 2): cinque voci che invocano i comandi
  // di shell già registrati. Il menu non registra niente: legge il
  // registro, e `main.ts` gli inietta `run(id)` che risolve l'entry e la
  // esegue come farebbe la tastiera.
  pageWindowLifetime.add(mountAppMenu({
    run: (id) => {
      const entry = allCommands().find((e) => e.id === id);
      if (entry) startCommand(entry, paletteHost);
    },
    // Letta a ogni apertura del menu: una scorciatoia rimappata si vede subito.
    shortcut: (id) => displayBinding(allCommands().find((e) => e.id === id)?.binding ?? null),
    // Le stesse view principali che la palette elenca, con la stessa frase.
    views: () => primaryViews().filter(opensWithoutParams).map((spec) => ({
      label: t("palette.open_view", { title: spec.title }),
      run: () => openPrimaryView(spec.id),
    })),
  }));
  refreshTitlebarShortcuts();
  pageWindowLifetime.add(onLanguage(refreshTitlebarShortcuts));

  // Il trigger di ricerca nella titlebar: fa focus su `#search-input`, che è
  // la ricerca onesta — già lì, già cablata — e non una palette travestita.
  // Il suggerimento mostra l'accordo di `shell.panel.search`, per chi cerca un comando.
  pageWindowLifetime.listen($("#command-search"), "click", () => {
    // La ricerca sta nella barra laterale: se è chiusa (o è un cassetto) si
    // apre prima, o il fuoco finirebbe su un campo che non si vede.
    revealSidePanel("sidebar");
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
  // Un rifiuto che nessuno ha raccolto è un guasto che nessuno vedrebbe: la
  // console della webview in un'app impacchettata non si apre.
  pageWindowLifetime.listen(window, "unhandledrejection", (event: PromiseRejectionEvent) => {
    notify(t("app.unexpected", { reason: errorText(event.reason) }), "guasto");
  });

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
    if (!alive()) return;
    // Il rimontaggio toglie dalla rail i bottoni delle view dichiarate: la
    // rail li rifà, coi titoli nella lingua nuova.
    void mountDeclaredViews(pageWindowLifetime).then(() => {
      if (alive()) syncRail();
    });
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

/// I passi dello zoom: gli stessi di un browser, dentro i limiti che
/// `appearance.zoom` ammette.
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

/// La modalità scelta per i riquadri nuovi (`editor.default-mode`), o niente
/// se non si riesce a leggerla: allora vale il default del layout.
async function preferredPaneMode(): Promise<string | undefined> {
  try {
    const value = (await settings()).find((entry) => entry.spec.key === "editor.default-mode")?.value;
    return typeof value === "string" && value !== "" ? value : undefined;
  } catch {
    return undefined;
  }
}

async function zoomBy(step: -1 | 0 | 1): Promise<void> {
  try {
    const entries = await settings();
    const current = entries.find((entry) => entry.spec.key === "appearance.zoom")?.value;
    const now = typeof current === "number" ? current : 1;
    let next = 1;
    if (step > 0) next = ZOOM_STEPS.find((value) => value > now + 0.001) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
    if (step < 0) next = [...ZOOM_STEPS].reverse().find((value) => value < now - 0.001) ?? ZOOM_STEPS[0]!;
    if (Math.abs(next - now) < 0.001) return;
    await api.setSetting("appearance.zoom", next);
    notify(t("shell.zoom_now", { percent: Math.round(next * 100) }), "info");
  } catch (error) {
    notify(t("shell.zoom_failed", { reason: errorText(error) }), "guasto");
  }
}

/// La scrittura senza cornice: rail, barra laterale, ispettore e divisori
/// escono di scena; lo stesso comando (o Esc) li rimette.
function toggleFocusMode(force?: boolean): void {
  const app = document.getElementById("app");
  if (!app) return;
  const on = force ?? !app.hasAttribute("data-focus-mode");
  app.toggleAttribute("data-focus-mode", on);
  if (on) notify(t("shell.focus_on"), "info");
}

async function newNoteInActiveSpace(): Promise<void> {
  try {
    const created = await createNote(undefined, state.activeSpace ?? undefined);
    if (created) await openDocument(created);
    focusEditor();
  } catch (error) {
    notify(t("explorer.create_failed", { reason: errorText(error) }), "guasto");
  }
}

async function pickVault(): Promise<void> {
  if (pageWindowLifetime.closed) return;
  const dir = await pickVaultLocation();
  if (dir && !pageWindowLifetime.closed) await openVaultPath(dir);
}

/// Apre un vault con la procedura intera della shell: ciò che resta del vault
/// precedente scritto prima, poi stato di vista, segnale `vault` e view. È la
/// porta di una shell che sceglie i vault a modo suo (il pannello dello spazio
/// su mobile): li sceglie lei, li apre questa.
export function openVault(dir: string): Promise<void> {
  return openVaultPath(dir);
}

async function openVaultPath(
  dir: string,
  alive: () => boolean = () => !pageWindowLifetime.closed,
  alreadyDrained = false,
): Promise<void> {
  if (!alive()) return;
  if (state.vaultRoot && !alreadyDrained) {
    // Il testo in coda va scritto nel vault a cui appartiene, prima di
    // lasciarlo: dopo, lo stesso path indicherebbe un file dell'altro vault.
    if (!await drainDocumentWindows()) return;
    const pending = await flushPendingSave();
    if (!alive()) return;
    if (pending.length > 0) {
      notify(t("demo.unsaved", { files: pending.join(", ") }), "guasto");
      return;
    }
  }
  if (!alive()) return;
  const info = await api.openVault(dir);
  if (!alive()) return;
  const unsaved = await resetDocumentsForVault();
  if (unsaved.length > 0) notify(t("demo.unsaved", { files: unsaved.join(", ") }), "guasto");
  if (!alive()) return;
  // Il segnale watcher è del vault che si sta aprendo: azzerarlo subito, poi
  // `warnIfUnwatched` lo rialza col suo stato (I04, mai verità del vault prima).
  setWatcherOff(false);
  showVaultName(info.root);
  // «Questo vault si è aperto a metà» (§15.7): la riga che il contratto teneva
  // in serbo per una superficie che non c'era. Ogni voce esce anche come evento
  // `trouble` — e da lì il centro notifiche la mostra già — ma la si legge
  // **anche** dall'esito, che è la ragione per cui il campo esiste: aprire un
  // vault è il carico sotto cui la coda eventi tronca (§20.5), e una nota che
  // la ricerca non trova e che il grafo non collega è precisamente ciò che non
  // si scopre finché non la si cerca.
  if (info.unread.length > 0) {
    notify(plural(info.unread.length, "vault.partial.one", "vault.partial"), "guasto");
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
  await Promise.all([loadOrganization(), loadLayout(preferredPaneMode()), loadExpanded(), loadActiveSpace()]);
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
    notify(plural(recovered, "draft.found.one", "draft.found"), "info");
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
    notify(plural(keys.length, "app.vault_keys_pending.one", "app.vault_keys_pending", { commands: names }));
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

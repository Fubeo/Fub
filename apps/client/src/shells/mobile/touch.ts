// UI touch mobile: toolbar compatta, azione rapida, tab switcher.
// Riusa la stessa shell: stessi layout, comandi, quick switcher, palette.
// Niente duplicati: solo adattatori di presentazione (44px, swipe, bottom sheet).

import { activeDoc,
activateTab,
closeTab,
layout,
openIn,
panes,
type Tab, } from "../../state/layout";
import type { MobileTreeGrant } from "./bridge";
import { documentSessions, flushPendingSave } from "../../state/document-session";
import { closeDocument, focusEditor, openDocument } from "../../panels/document";
import { openQuickSwitcher } from "../../panels/quick-switcher";
import { showPanel } from "../../panels/sidebar";
import { openCommandPalette, startCommand, type PaletteHost } from "../../ui/palette";
import { allCommands } from "../../ui/commands";
import type { Lifetime } from "../../ui/lifetime";

export interface QuickAction {
  id: string;
  run: () => void | Promise<void>;
}

export interface QuickActionPorts {
  createNote: () => Promise<string | null>;
  openDaily: () => Promise<string | null>;
  openSwitcher: () => void;
  openPalette: () => void;
  openSearch: () => void;
}

export function defaultQuickActions(ports: QuickActionPorts): QuickAction[] {
  return [
    { id: "mobile.new", run: () => ports.createNote().then(() => undefined) },
    { id: "mobile.daily", run: () => ports.openDaily().then(() => undefined) },
    { id: "mobile.switch", run: () => ports.openSwitcher() },
    { id: "mobile.commands", run: () => ports.openPalette() },
    { id: "mobile.search", run: () => ports.openSearch() },
  ];
}

export const MOBILE_TOUCH_TARGET_PX = 44;

export function touchFirst(): boolean {
  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) return true;
  if (typeof window !== "undefined" && "ontouchstart" in window) return true;
  return document.documentElement.dataset.clientShell === "mobile";
}

export interface TabEntry {
  doc: string | null;
  label: string;
  active: boolean;
  dirty: boolean;
}

export function currentTabs(): TabEntry[] {
  const focus = layout.focus;
  const pane = layout.panes[focus];
  if (!pane) return [];
  return pane.tabs.map((tab, index) => ({
    doc: tab.k === "doc" ? tab.doc : null,
    label: tab.k === "doc" ? tab.doc : tab.view,
    active: index === pane.active,
    dirty: tab.k === "doc" ? documentSessions.isDirty(tab.doc) : false,
  }));
}

export async function activateMobileTab(index: number): Promise<void> {
  activateTab(layout.focus, index);
  const doc = activeDoc();
  if (doc) await openDocument(doc);
}

export async function closeMobileTab(index: number): Promise<void> {
  const pane = layout.panes[layout.focus];
  const tab = pane?.tabs[index];
  if (!tab) return;
  if (tab.k !== "doc") {
    closeTab(layout.focus, index);
    return;
  }
  // Stesso percorso del desktop: prima il flush condiviso, poi la chiusura
  // dell'owner (che ricongiunge la bozza se resta sporco). Mai drop del dirty.
  await flushPendingSave();
  closeDocument(tab.doc);
}

export function swipeTarget(index: number, direction: "left" | "right"): number {
  const pane = layout.panes[layout.focus];
  const count = pane?.tabs.length ?? 0;
  if (count === 0) return -1;
  const delta = direction === "left" ? 1 : -1;
  return (index + delta + count) % count;
}

export interface ToolbarPorts {
  paletteHost: PaletteHost;
}

export function openMobilePalette(ports: ToolbarPorts): Promise<void> {
  return openCommandPalette(ports.paletteHost);
}

export function runMobileCommand(id: string, ports: ToolbarPorts): void {
  const entry = allCommands().find((command) => command.id === id);
  if (entry) startCommand(entry, ports.paletteHost);
}

export function mobileActiveTab(focus: string = layout.focus): Tab | null {
  const pane = layout.panes[focus];
  if (!pane) return null;
  return pane.active >= 0 && pane.active < pane.tabs.length
    ? (pane.tabs[pane.active] ?? null)
    : null;
}

export function openMobileSearch(): void {
  showPanel("search");
  document.getElementById("search-input")?.focus();
}

export function openMobileSwitcher(): void {
  openQuickSwitcher();
}

/// Accesso tree reale su mobile (SAF OPEN_DOCUMENT_TREE / picker iOS .folder).
/// NESSUN file->parent: un file picker non conferisce grant sulla cartella e
/// aprire il vault sul genitore sarebbe un bypass. Il grant arriva dal picker
/// nativo (template FubTreeAccess.*) come `fub://mobile-tree?uri=` e si
/// registra con `mobile_register_tree_grant`, poi mount via SystemStorage con
/// mode esplicito (ReadWrite/ReadOnly/CopyImport/NeedGrant).
export interface TreeAccessPorts {
  requestTreeAccess: () => Promise<MobileTreeGrant | null>;
}

export function focusMobileEditor(): void {
  focusEditor();
}

export function openMobileDoc(id: string): Promise<void> {
  openIn(layout.focus, id);
  return openDocument(id);
}

export function mobilePanes(): string[] {
  return panes();
}

export function mountMobileChrome(lifetime: Lifetime): void {
  lifetime.listen(window, "pagehide", () => {
    document.getElementById("quick-switcher")?.remove();
    document.getElementById("command-palette")?.remove();
  });
}

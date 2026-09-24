// Widget e azioni OS mobile: scorciatoie, widget, ricerca, assistenza.
// Solo porte pure + descrittori nativi cablati dallo script install-mobile.sh:
// widget Android (FubWidgetProvider + layout + info), shortcuts.xml,
// widget iOS WidgetKit (FubWidget.swift). Nessuna registrazione nativa qui
// (serve gen/): qui solo gli stessi comandi reali e i file da fondere.
// Niente duplicati: riusa comandi reali (note.create/note.daily/switcher).

export type MobileShortcutKind = "new" | "daily" | "search" | "switcher";

export interface MobileShortcut {
  kind: MobileShortcutKind;
  commandId: string;
  uri: string;
}

export function mobileShortcuts(): MobileShortcut[] {
  return [
    { kind: "new", commandId: "note.create", uri: "fub://new" },
    { kind: "daily", commandId: "note.daily", uri: "fub://daily" },
    { kind: "search", commandId: "shell.panel.search", uri: "fub://mobile-search" },
    { kind: "switcher", commandId: "shell.switcher", uri: "fub://mobile-switcher" },
  ];
}

export interface WidgetPorts {
  runCommand: (id: "note.create" | "note.daily") => Promise<void>;
  runSearch: (query: string) => void;
  openSwitcher: () => void;
}

export async function handleWidgetAction(
  ports: WidgetPorts,
  action: MobileShortcutKind,
  arg?: string,
): Promise<void> {
  switch (action) {
    case "new":
      return ports.runCommand("note.create");
    case "daily":
      return ports.runCommand("note.daily");
    case "switcher":
      ports.openSwitcher();
      return;
    case "search":
      ports.runSearch(arg ?? "");
      return;
  }
}

export function assistantSearchUrl(query: string): string {
  return `fub://search?q=${encodeURIComponent(query)}`;
}

/// File nativi reali (non placeholder) fusi da `mobile/install-mobile.sh` in
/// gen/ dopo init. Lo script è sorgente del repo (bash+python3, fail-closed
/// senza gen/); qui solo l'elenco che lo script deve trovare.
export const MOBILE_NATIVE_FILES = [
  "mobile/FubTreeAccess.kt",
  "mobile/ShareBridge.kt",
  "mobile/FubWidgetProvider.kt",
  "mobile/fub-widget-info.xml",
  "mobile/fub-widget-layout.xml",
  "mobile/shortcuts.xml",
  "mobile/fub-shortcut-labels.xml",
  "mobile/AndroidManifest.snippet.xml",
  "mobile/FubTreeAccess.swift",
  "mobile/ShareViewController.swift",
  "mobile/FubWidget.swift",
  "mobile/Info.plist.snippet.plist",
  "mobile/Fub.entitlements",
] as const;

export interface OsActionRegistration {
  shortcut: MobileShortcut;
  native: "android-shortcut" | "android-widget" | "ios-quick-action" | "ios-widget";
  source: (typeof MOBILE_NATIVE_FILES)[number];
  target: string;
  reason: string;
}

export function osActionPlan(shortcuts: MobileShortcut[]): OsActionRegistration[] {
  const out: OsActionRegistration[] = [];
  for (const shortcut of shortcuts) {
    out.push({
      shortcut,
      native: "android-shortcut",
      source: "mobile/shortcuts.xml",
      target: "gen/android/app/src/main/res/xml/shortcuts.xml",
      reason: "install-mobile.sh fonde shortcuts.xml + meta-data in MainActivity",
    });
  }
  out.push({
    shortcut: shortcuts[0] ?? { kind: "new", commandId: "note.create", uri: "fub://new" },
    native: "android-widget",
    source: "mobile/FubWidgetProvider.kt",
    target: "gen/android/app/src/main/java/dev/fub/app/FubWidgetProvider.kt + res/xml/fub_widget_info.xml + res/layout/fub_widget.xml + receiver",
    reason: "install-mobile.sh fonde provider + layout + info + receiver nel manifest",
  });
  out.push({
    shortcut: shortcuts[0] ?? { kind: "new", commandId: "note.create", uri: "fub://new" },
    native: "ios-widget",
    source: "mobile/FubWidget.swift",
    target: "gen/ios/Sources/<App>/FubWidget.swift (target Widget Extension)",
    reason: "install-mobile.sh copia il sorgente; membership Xcode a cura NativeIntegration",
  });
  return out;
}

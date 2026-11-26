// I temi e le viste di prova dell'host finto (`fake.ts` li ri-esporta).
import type {
  PluginError,
  SettingEntry,
  DiskCause,
  ThemeFolderRefusal,
  ThemeInfo,
  ThemePayload,
  ViewSpec,
} from "./contract";

/// La chiave della modalità sviluppatore (`fub_host::settings::DEVELOPER_MODE`).
export const DEVELOPER_MODE_KEY = "developer.mode";

/// Una cartella di tema per `themeFolders`: ciò che `extendingTheme` e i suoi
/// fratelli restituiscono, più l'errore di una sostituzione fallita a metà.
export interface ThemeFolderFake {
  info: ThemeInfo;
  payloads: Record<string, ThemePayload>;
  /// La sostituzione si ferma con questo errore, e il vecchio resta.
  replaceError?: PluginError;
  /// Il perché tipizzato di `replaceError` (`failed.cause`); di default
  /// `other`.
  replaceCause?: DiskCause;
  /// Le porte dell'installazione rifiutano i byte controllati (`refused`).
  installRefusal?: ThemeFolderRefusal;
  /// Con `replaceError`: il vecchio non torna (`replace_failed`).
  replaceLost?: boolean;
}

/// L'impronta finta di una cartella: cambia quando cambiano i suoi fasci.
export function folderDigest(folder: ThemeFolderFake): string {
  const text = JSON.stringify(folder.payloads);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `fake-${hash.toString(16)}`;
}

/// La riga di `developer.mode` come la dichiara il core: interruttore della
/// macchina, spento di default, nel gruppo «Sviluppo».
export function developerModeSetting(on: boolean): SettingEntry {
  return {
    spec: {
      key: DEVELOPER_MODE_KEY,
      label: "Modalità sviluppatore",
      description:
        "Per chi scrive un tema: in «Temi installati» compaiono «Installa da cartella…», che lo controlla e lo installa dalla sua cartella, «Collega una cartella…», che lo rimonta a ogni salvataggio, e «Tutti i componenti», che mostra ogni componente in ogni stato.",
      group: "Sviluppo",
      scope: "machine",
      kind: { kind: "toggle", default: false },
      program_writable: false,
    },
    value: on,
    source: on ? "machine" : "default",
  };
}

/// Una cartella di tema che il loader accetta: parte dalla serie senza fogli
/// suoi (le due luci prendono quelli di serie) e la pelle ritocca un pezzo.
export function folderTheme(id = "acme.carta", name = "Carta", version = "1.0.0"): ThemeFolderFake {
  const manifest: ThemeInfo["manifest"] = { ...extendingTheme(id).info.manifest, name, version };
  const skin = ".shell-tooltip { white-space: nowrap; }\n";
  return {
    info: { manifest, trust: "community" },
    payloads: {
      [`${id}:light`]: { manifest, light: "light", sheet: null, skin, assets: {} },
      [`${id}:dark`]: { manifest, light: "dark", sheet: null, skin, assets: {} },
    },
  };
}

/// Un tema che il loader della shell rifiuta: passa le porte dell'host (il
/// finto non le ha), ma la pelle usa un hook che l'anatomia non dichiara e un
/// `@font-face`, e il manifest parla `theme-1`. La diagnosi ha una riga per
/// motivo.
export function rejectedTheme(id = "acme.rotto", version = "1.0.0"): ThemeFolderFake {
  const base = extendingTheme(id);
  const manifest: ThemeInfo["manifest"] = { ...base.info.manifest, name: "Rotto", version, engine: "theme-1" };
  const skin = ".rotto-titolo { color: red; }\n@font-face { font-family: Rotto; }\n";
  return {
    info: { manifest, trust: "community" },
    payloads: {
      [`${id}:light`]: { manifest, light: "light", sheet: null, skin, assets: {} },
      [`${id}:dark`]: { manifest, light: "dark", sheet: null, skin, assets: {} },
    },
  };
}

/// Un tema installato che parte dalla serie (`extends`), pronto per le opzioni
/// `themes` e `themePayloads` del finto: porta il foglio chiaro e una pelle, e
/// la luce scura arriva con `sheet: null`, come la consegna l'host vero.
export function extendingTheme(id = "acme.carta"): {
  info: ThemeInfo;
  payloads: Record<string, ThemePayload>;
} {
  const manifest: ThemeInfo["manifest"] = {
    id,
    name: "Carta",
    version: "1.0.0",
    engine: "theme-2",
    lights: ["light", "dark"],
    asset_namespace: `theme://${id}/`,
    motion: ["opacity", "transform"],
    extends: "fub.serie",
  };
  const skin = ".carta { color: inherit; }";
  return {
    info: { manifest, trust: "community" },
    payloads: {
      [`${id}:light`]: { manifest, light: "light", sheet: ":root { --carta: #fbf7ee; }", skin, assets: {} },
      [`${id}:dark`]: { manifest, light: "dark", sheet: null, skin, assets: {} },
    },
  };
}

/// I byte di un WOFF2 finto: la firma `wOF2` e qualche byte dopo. Il finto non
/// disegna caratteri: conta che la forma arrivi come la consegna l'host vero.
export function fakeWoff2(size = 12): number[] {
  return [0x77, 0x4f, 0x46, 0x32, ...Array.from({ length: Math.max(0, size - 4) }, (_, i) => i & 0xff)];
}

/// Un tema che parte dalla serie e porta due caratteri (`fonts`): il manifest
/// li dichiara, il fascio porta i file fra gli asset anche se nessun CSS li
/// nomina, e la pelle usa la famiglia per nome. Come per `extendingTheme`, la
/// luce scura arriva con `sheet: null`.
export function fontTheme(id = "acme.caratteri"): {
  info: ThemeInfo;
  payloads: Record<string, ThemePayload>;
} {
  const manifest: ThemeInfo["manifest"] = {
    id,
    name: "Caratteri",
    version: "1.0.0",
    engine: "theme-2",
    lights: ["light", "dark"],
    asset_namespace: `theme://${id}/`,
    motion: ["opacity", "transform"],
    extends: "fub.serie",
    fonts: [
      { family: "Carta Serif", file: "fonts/carta.woff2", weight: 400, style: "normal" },
      { family: "Carta Serif", file: "fonts/carta-italic.woff2", weight: 400, style: "italic" },
    ],
  };
  const skin = '.shell-tooltip { font-family: "Carta Serif", var(--font-ui); }';
  const assets = {
    [`theme://${id}/fonts/carta.woff2`]: fakeWoff2(12),
    [`theme://${id}/fonts/carta-italic.woff2`]: fakeWoff2(9),
  };
  return {
    info: { manifest, trust: "community" },
    payloads: {
      [`${id}:light`]: { manifest, light: "light", sheet: null, skin, assets },
      [`${id}:dark`]: { manifest, light: "dark", sheet: null, skin, assets },
    },
  };
}

/// I byte UTF-8 di un set di icone del tema, come li consegna l'host vero fra
/// gli asset del fascio.
export function iconSetBytes(set: Readonly<Record<string, readonly string[]>>): number[] {
  return [...new TextEncoder().encode(JSON.stringify(set))];
}

/// Un tema che parte dalla serie e ridisegna qualche icona (`icons`): il
/// manifest nomina il set, il fascio lo porta fra gli asset anche se nessun
/// CSS lo nomina. Ridisegna una icona di serie (`search`), un alias
/// (`folder`, che vale per `vault`) e un nome che oggi nessuno disegna.
export function iconTheme(id = "acme.icone"): {
  info: ThemeInfo;
  payloads: Record<string, ThemePayload>;
  set: Record<string, string[]>;
} {
  const manifest: ThemeInfo["manifest"] = {
    id,
    name: "Icone",
    version: "1.0.0",
    engine: "theme-2",
    lights: ["light", "dark"],
    asset_namespace: `theme://${id}/`,
    motion: ["opacity", "transform"],
    extends: "fub.serie",
    icons: "icons.json",
  };
  const set = {
    search: ["M4 4h16v16H4z", "M8 12h8"],
    folder: ["M3 6h18v12H3z"],
    "modulo-spento": ["M12 3v18"],
  };
  const skin = ".shell-tooltip { white-space: nowrap; }\n";
  const assets = { [`theme://${id}/icons.json`]: iconSetBytes(set) };
  return {
    info: { manifest, trust: "community" },
    payloads: {
      [`${id}:light`]: { manifest, light: "light", sheet: null, skin, assets },
      [`${id}:dark`]: { manifest, light: "dark", sheet: null, skin, assets },
    },
    set,
  };
}

/// L'id della view cestino del finto: la stessa che `fub-features` registra,
/// perché ciò che si prova è che la shell la monti senza saperne nulla.
export const TRASH_VIEW = "fub.trash";

/// Una `ViewSpec` minima: quel che serve perché la shell la monti.
///
/// La maschera dichiara i tre eventi che cambiano il vault, ed è la stessa che
/// dichiarerebbe una view vera: senza, la view si disegnerebbe una volta sola e
/// un e2e non distinguerebbe «la shell onora `refresh`» da «la shell ridisegna
/// tutto sempre».
export function testViewSpec(id: string, surface: ViewSpec["surface"]): ViewSpec {
  return {
    id,
    title: id,
    surface,
    refresh: {
      kinds: ["document_changed", "document_removed", "document_renamed"],
      topics: [],
      subjects: [],
      changes: [],
    },
    follows: [],
    params: [],
    icon: null,
    order: 0,
    open_by_default: true,
    preferred_size: null,
    closable: false,
  };
}

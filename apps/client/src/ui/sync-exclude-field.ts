// Il campo di `sync.exclude`, nelle Impostazioni: una casella per tipo di file
// (immagini, audio, video, PDF) che non si replica. Un tipo è un gruppo di
// voci `ext:`, la forma che l'host legge già (`remote::is_user_excluded`); le
// altre voci della lista (cartelle, categorie) restano com'erano, dette in
// coda.
import type { SettingEntry } from "../host/contract";
import { t, type Key } from "../i18n/strings";

export const SYNC_KINDS = ["images", "audio", "video", "pdf"] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

/// Le estensioni di ciascun tipo. Il limite della lista è di 64 voci: tutte
/// insieme ne prendono 22.
export const KIND_EXTENSIONS: Readonly<Record<SyncKind, readonly string[]>> = {
  images: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "heic"],
  audio: ["mp3", "wav", "m4a", "ogg", "flac", "aac"],
  video: ["mp4", "mov", "webm", "mkv", "avi", "ogv"],
  pdf: ["pdf"],
};

const LABELS: Readonly<Record<SyncKind, Key>> = {
  images: "sync.kind.images",
  audio: "sync.kind.audio",
  video: "sync.kind.video",
  pdf: "sync.kind.pdf",
};

/// L'estensione di una voce `ext:` (o `.ext`), come la legge l'host: senza
/// punti davanti, minuscola. `null` per le altre voci.
function extensionOf(entry: string): string | null {
  const rule = entry.trim().toLowerCase();
  const ext = rule.startsWith("ext:") ? rule.slice(4) : rule.startsWith(".") ? rule : null;
  if (ext === null) return null;
  const bare = ext.replace(/^\.+/, "");
  return bare === "" ? null : bare;
}

/// Il tipo che appartiene a un'estensione, se c'è.
function kindOf(ext: string): SyncKind | null {
  return SYNC_KINDS.find((kind) => KIND_EXTENSIONS[kind].includes(ext)) ?? null;
}

/// I tipi esclusi per intero da `value`.
export function excludedKinds(value: readonly string[]): Set<SyncKind> {
  const exts = new Set(value.map(extensionOf).filter((ext): ext is string => ext !== null));
  return new Set(SYNC_KINDS.filter((kind) => KIND_EXTENSIONS[kind].every((ext) => exts.has(ext))));
}

/// `value` con il tipo `kind` escluso o incluso. Le voci di un tipo si tolgono
/// tutte, anche scritte a mano; le altre restano nel loro ordine.
export function withKind(value: readonly string[], kind: SyncKind, excluded: boolean): string[] {
  const kept = value.filter((entry) => {
    const ext = extensionOf(entry);
    return ext === null || kindOf(ext) !== kind;
  });
  return excluded ? [...kept, ...KIND_EXTENSIONS[kind].map((ext) => `ext:${ext}`)] : kept;
}

/// Le voci che non sono di un tipo: cartelle, categorie, estensioni d'altro.
function others(value: readonly string[]): string[] {
  return value.filter((entry) => {
    const ext = extensionOf(entry);
    return ext === null || kindOf(ext) === null;
  });
}

export function syncExcludeField(
  entry: SettingEntry,
  id: string,
  write: (value: string[], part: string, checked: boolean) => void,
): HTMLElement {
  const value = Array.isArray(entry.value) ? entry.value.filter((item): item is string => typeof item === "string") : [];
  const excluded = excludedKinds(value);
  const root = document.createElement("div");
  root.className = "setting-features";
  root.id = id;
  root.setAttribute("role", "group");
  root.setAttribute("aria-labelledby", `${id}-label`);
  for (const kind of SYNC_KINDS) {
    const name = t(LABELS[kind]);
    const item = document.createElement("label");
    item.className = "setting-feature";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.id = `${id}-${kind}`;
    box.checked = excluded.has(kind);
    box.addEventListener("change", () => write(withKind(value, kind, box.checked), name, box.checked));
    item.append(box, document.createTextNode(name));
    root.append(item);
  }
  const rest = others(value);
  if (rest.length > 0) {
    const note = document.createElement("p");
    note.className = "setting-description";
    note.textContent = t("sync.kind.others", { list: rest.join(", ") });
    root.append(note);
  }
  return root;
}

/// La lista come la dice il campo: i tipi per nome, poi le altre voci.
export function describeSyncExclude(value: readonly string[]): string {
  const kinds = [...excludedKinds(value)].map((kind) => t(LABELS[kind]));
  const partial = value.filter((entry) => {
    const ext = extensionOf(entry);
    const kind = ext === null ? null : kindOf(ext);
    return kind !== null && !excludedKinds(value).has(kind);
  });
  return [...kinds, ...partial, ...others(value)].join(", ");
}

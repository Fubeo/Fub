// Gli aiuti dell'host finto sul vault: link, organizzazione delle note, rinomina.
import { childName, parentOf } from "../rules/organizer";
import type { Organization, LiveLeaveReason } from "./contract";

/// Lo scrittore uscito per questi motivi può riprendere, se la sessione vive.
export function resumableLeave(reason: LiveLeaveReason): boolean {
  return reason === "lost" || reason === "heartbeat" || reason === "congested" || reason === "tooMuchTraffic";
}

/// Un path di link letto dalla cartella di `from`, come `resolve_against` in
/// `fub-abi`: il frammento cade, il percent-encoding si decodifica, `/` parte
/// dalla radice del vault e un `..` oltre la radice non nomina niente.
export function resolveAgainst(from: string, raw: string): string | null {
  const bare = raw.split("#")[0]!.trim();
  let path: string;
  try {
    path = decodeURIComponent(bare);
  } catch {
    path = bare;
  }
  if (!path) return null;
  const segments = path.startsWith("/") ? [] : from.split("/").slice(0, -1).filter(Boolean);
  for (const segment of path.replace(/^\//, "").split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.pop() === undefined) return null;
    } else {
      segments.push(segment);
    }
  }
  return segments.length ? segments.join("/") : null;
}

/// Il documento che la pagina di un wikilink nomina, fra `ids`: una nota per
/// nome, poi un file per nome (`![[foto.png]]`). È la risoluzione del finto,
/// più povera di quella del kernel: niente omonimi in ordine, niente path
/// relativi.
export function wikiPageDoc(ids: Iterable<string>, page: string): string | undefined {
  const all = [...ids];
  const expected = `${page}.md`;
  return all.find((id) => id === expected || id.endsWith(`/${expected}`))
    ?? all.find((id) => id === page || id.endsWith(`/${page}`));
}

/// Un wikilink (anche incorporato, `![[…]]`): la pagina, poi il frammento e
/// l'alias, che la rinomina lascia com'erano.
const WIKILINK = /(!?\[\[)([^\]|#\n]*)([^\]\n]*)\]\]/g;

/// L'organizzazione del vault come la tiene il kernel (`organization.rs`): una
/// copia, perché il client non deve condividere con il finto i suoi oggetti.
export function copyOrganization(org: Organization): Organization {
  return {
    icons: { ...org.icons },
    pinned: [...org.pinned],
    order: Object.fromEntries(Object.entries(org.order).map(([folder, names]) => [folder, [...names]])),
    spaces: [...org.spaces],
  };
}

/// Le liste dell'organizzazione sono insiemi ordinati: un id non ci sta due
/// volte, e chi c'era già non si sposta (come `senza_doppioni` del kernel).
function withoutDuplicates(org: Organization): void {
  const once = (ids: string[]) => [...new Set(ids)];
  org.pinned = once(org.pinned);
  org.spaces = once(org.spaces);
  for (const folder of Object.keys(org.order)) org.order[folder] = once(org.order[folder]!);
}

/// Il posto di un path nell'ordine scelto a mano della sua cartella: lo stesso
/// posto se la cartella resta, altrimenti esce da lì.
function moveInOrder(org: Organization, from: string, to: string): void {
  const names = org.order[parentOf(from)];
  const at = names?.indexOf(childName(from)) ?? -1;
  if (!names || at === -1) return;
  if (parentOf(from) === parentOf(to)) names[at] = childName(to);
  else names.splice(at, 1);
}

/// Un documento cambia path (`from` → `to`): l'icona segue se il path d'arrivo è
/// libero, il pin e il posto nell'ordine seguono. Come `migrate` del kernel.
export function moveNote(org: Organization, from: string, to: string): void {
  const icon = org.icons[from];
  if (icon !== undefined && (org.icons[to] === undefined || from === to)) {
    delete org.icons[from];
    org.icons[to] = icon;
  }
  org.pinned = org.pinned.map((id) => (id === from ? to : id));
  moveInOrder(org, from, to);
  withoutDuplicates(org);
}

/// Una cartella cambia path, con ciò che sta sotto: come `migrate_folder` del
/// kernel. Su una collisione vince ciò che la destinazione aveva già.
export function moveFolder(org: Organization, from: string, to: string): void {
  const rebase = (path: string): string | null =>
    path === from ? to : path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : null;
  for (const [key, icon] of Object.entries(org.icons)) {
    const moved = rebase(key);
    if (moved !== null && org.icons[moved] === undefined) {
      delete org.icons[key];
      org.icons[moved] = icon;
    }
  }
  for (const [key, names] of Object.entries(org.order)) {
    const moved = rebase(key);
    if (moved !== null && org.order[moved] === undefined) {
      delete org.order[key];
      org.order[moved] = names;
    }
  }
  org.pinned = org.pinned.map((path) => rebase(path) ?? path);
  org.spaces = org.spaces.map((path) => rebase(path) ?? path);
  moveInOrder(org, from, to);
  withoutDuplicates(org);
}

/// I testi riscritti da una rinomina di `from` in `to`, per documento: i soli
/// wikilink che nominavano `from` cambiano pagina, nella forma in cui erano
/// scritti (per nome o per path, con l'estensione se c'era), col frammento e
/// l'alias intatti. È la parte di `link_retarget_edits` che il banco usa; i
/// link Markdown `[testo](path)` il finto non li riscrive.
export function renameRewrites(texts: ReadonlyMap<string, string>, from: string, to: string): Map<string, string> {
  const dot = from.lastIndexOf(".");
  const ext = dot > from.lastIndexOf("/") ? from.slice(dot) : "";
  const stem = (id: string): string => (ext && id.endsWith(ext) ? id.slice(0, -ext.length) : id);
  const rewritten = new Map<string, string>();
  for (const [id, text] of texts) {
    const next = text.replace(WIKILINK, (whole, open: string, page: string, rest: string) => {
      const name = page.trim();
      if (name === "" || wikiPageDoc(texts.keys(), name) !== from) return whole;
      const withExt = ext !== "" && name.toLowerCase().endsWith(ext.toLowerCase());
      const byPath = name.includes("/");
      const target = byPath ? stem(to) : stem(to).slice(stem(to).lastIndexOf("/") + 1);
      return `${open}${target}${withExt ? ext : ""}${rest}]]`;
    });
    if (next !== text) rewritten.set(id, next);
  }
  return rewritten;
}

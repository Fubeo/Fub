// L'icona di una pagina fuori dalla pagina (K9): `icon:` del frontmatter, che
// la testata dei Blocchi scrive, si vede anche nell'esplora, nelle schede e
// accanto ai wikilink, come in Notion.
//
// Chi la possiede è l'indice: qui si tiene soltanto la risposta dell'ultima
// domanda, rifatta quando l'indice dice di essere cambiato. Una sola domanda
// per vault — le note che **hanno** un'icona, con quella chiave e basta — e
// non una per riga: le righe dell'esplora sono migliaia, le icone poche.

import { api } from "../host/ipc";
import type { DocumentMatch } from "../host/contract";
import { pageName } from "../rules/mirrored";
import { Race } from "../ui/race";
import type { Lifetime } from "../ui/lifetime";
import { onEvent } from "./kernel";
import { emit, on, openVaultRoot, vaultArg } from "./store";

/// Quante note con un'icona si leggono al più: oltre, le altre restano senza
/// fuori dalla pagina (dentro la testata la mostra comunque).
const LIMIT = 5000;

/// La chiave del frontmatter, la stessa che scrive la testata (`blocks/page.ts`).
const KEY = "icon";

let byDoc = new Map<string, string>();
/// Per nome di pagina, minuscolo: `null` quando due pagine omonime hanno icone
/// diverse, perché un `[[Nome]]` ambiguo non sa di quale si parla.
let byName = new Map<string, string | null>();
const race = new Race();

/// L'icona di un documento, se il suo frontmatter ne ha una.
export function pageIcon(doc: string): string | null {
  return byDoc.get(doc) ?? null;
}

/// L'icona della pagina a cui porta un wikilink scritto come `[[Nome]]` o
/// `[[Cartella/Nome]]`: si cerca il path intero (senza estensione), poi il nome.
export function linkedPageIcon(target: string): string | null {
  const written = target.trim();
  if (!written) return null;
  if (written.includes("/")) {
    for (const [doc, icon] of byDoc) {
      if (doc.replace(/\.[^./]+$/, "").toLowerCase() === written.toLowerCase()) return icon;
    }
  }
  return byName.get(pageName(written).toLowerCase()) ?? null;
}

/// Un valore che si mostra come icona: un testo breve (un'emoji, una lettera),
/// non un path o un indirizzo che un'altra app ha messo nella stessa chiave.
export function iconValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const icon = value.trim();
  if (!icon || icon.length > 16 || /[/\\:]/.test(icon)) return null;
  return icon;
}

/// Le mappe da una risposta dell'indice; esportata per i test.
export function iconsFrom(items: readonly DocumentMatch[]): { byDoc: Map<string, string>; byName: Map<string, string | null> } {
  const docs = new Map<string, string>();
  const names = new Map<string, string | null>();
  for (const item of items) {
    const icon = iconValue(item.properties?.find((p) => p.key === KEY)?.value);
    if (icon === null) continue;
    docs.set(item.doc, icon);
    const name = pageName(item.doc).toLowerCase();
    const before = names.get(name);
    names.set(name, before === undefined || before === icon ? icon : null);
  }
  return { byDoc: docs, byName: names };
}

function same(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) if (b.get(key) !== value) return false;
  return true;
}

async function refresh(): Promise<void> {
  const vault = openVaultRoot();
  await race.last(async (expected) => {
    const result = await expected(api.queryIndex({
      kind: "documents",
      matching: { any: [{ all: [{ negated: false, predicate: { kind: "property", filter: { key: KEY, test: { op: "exists" } } } }] }] },
      sort: null,
      select: { kind: "keys", keys: [KEY] },
      page: { offset: 0, limit: LIMIT },
      excerpts: "omit",
    }, ...vaultArg(vault)));
    if (result.kind !== "documents") throw new Error(`expected documents, got ${result.kind}`);
    const next = iconsFrom(result.value.items);
    if (same(byDoc, next.byDoc)) return;
    byDoc = next.byDoc;
    byName = next.byName;
    emit("page-icons");
  });
}

function clear(): void {
  race.cancel();
  if (byDoc.size === 0) return;
  byDoc = new Map();
  byName = new Map();
  emit("page-icons");
}

/// Tiene le icone allineate all'indice finché `lifetime` è vivo.
export function mountPageIcons(lifetime: Lifetime): void {
  // Un indice che non risponde lascia le icone di prima: è un ornamento, e
  // l'esplora non deve dire «guasto» per un'emoji che manca.
  const again = (): void => void refresh().catch(() => {});
  for (const event of ["index_updated", "batch_ended", "vault_opened"] as const) lifetime.add(onEvent(event, again));
  lifetime.add(on("vault", () => {
    clear();
    again();
  }));
  lifetime.add(on("documents", again));
  lifetime.add(clear);
  if (openVaultRoot() !== undefined) again();
}

// Gli spazi di lavoro di Obsidian (`.obsidian/workspaces.json`), portati fra i
// workspace di Fub.
//
// Li legge l'host (`settings.import_obsidian`) e li consegna così come sono:
// l'albero dei riquadri è della shell, e la traduzione vive qui. Di uno spazio
// si porta l'area principale — divisioni, gruppi di schede, le schede che
// aprono un file, quella davanti, le appuntate —; le barre laterali di
// Obsidian hanno pannelli che non sono quelli di Fub, e restano fuori. Una
// scheda che non apre un file (il grafo, una ricerca) si nomina per tipo; una
// scheda vuota non è niente. Uno spazio con lo stesso nome di un workspace che
// c'è già non si raddoppia. Che i file esistano lo verifica, come sempre,
// l'apertura del workspace.
import type { Layout, LayoutNode, PaneState, Tab } from "./layout";
import { parseLayout } from "./layout";
import { asRecord } from "./guard";
import { loadWorkspaces, saveWorkspace, workspaceLoadSnapshot } from "./workspaces";

/// Uno spazio tradotto, o le ragioni per cui non lo è.
export interface WorkspaceTranslation {
  name: string;
  layout: Layout | null;
  /// I tipi delle schede che non aprono un file, una volta ciascuno.
  lost: string[];
}

/// Che cosa è successo ai workspace.
export interface WorkspaceImport {
  added: number;
  same: number;
  lost: string[];
  refused: boolean;
}

function translateNode(
  value: unknown,
  panes: Record<string, PaneState>,
  lost: Set<string>,
): LayoutNode | null {
  const o = asRecord(value);
  if (!o) return null;
  if (o.type === "tabs") {
    const tabs: Tab[] = [];
    let active = -1;
    const current = typeof o.currentTab === "number" ? o.currentTab : 0;
    const leaves = Array.isArray(o.children) ? o.children : [];
    leaves.forEach((leaf, index) => {
      const l = asRecord(leaf);
      const view = asRecord(l?.state);
      const inner = asRecord(view?.state);
      const kind = typeof view?.type === "string" ? view.type : "?";
      const file = typeof inner?.file === "string" && inner.file.trim() !== "" ? inner.file : null;
      if (!file) {
        if (kind !== "empty") lost.add(kind);
        return;
      }
      if (index === current) active = tabs.length;
      tabs.push({ k: "doc", doc: file, ...(l?.pinned === true ? { pinned: true } : {}) });
    });
    if (tabs.length === 0) return null;
    const id = Object.keys(panes).length === 0 ? "main" : `pane-${Object.keys(panes).length + 1}`;
    panes[id] = { tabs, active: active >= 0 ? active : 0, modes: {} };
    return { k: "leaf", pane: id };
  }
  if (o.type === "split") {
    const children = (Array.isArray(o.children) ? o.children : [])
      .map((child) => translateNode(child, panes, lost))
      .filter((child): child is LayoutNode => child !== null);
    if (children.length === 0) return null;
    if (children.length === 1) return children[0]!;
    // In Obsidian una divisione «verticale» ha il divisore verticale: i
    // riquadri stanno affiancati, come la fila di Fub.
    return { k: "split", dir: o.direction === "horizontal" ? "col" : "row", children };
  }
  return null;
}

/// Dalle voci di `workspaces.json` (nome → spazio) ai layout di Fub. Pura.
export function translateObsidianWorkspaces(named: unknown): WorkspaceTranslation[] {
  const o = asRecord(named);
  if (!o) return [];
  return Object.entries(o).map(([name, space]) => {
    const lost = new Set<string>();
    const panes: Record<string, PaneState> = {};
    const tree = translateNode(asRecord(space)?.main, panes, lost);
    const layout = tree ? parseLayout({ tree, panes, focus: Object.keys(panes)[0] }) : null;
    return { name, layout, lost: [...lost] };
  });
}

/// Traduce e scrive fra i workspace del vault aperto.
export async function importObsidianWorkspaces(named: unknown): Promise<WorkspaceImport> {
  const spaces = translateObsidianWorkspaces(named);
  const out: WorkspaceImport = { added: 0, same: 0, lost: [], refused: false };
  if (spaces.length === 0) return out;
  const load = await loadWorkspaces();
  if (load.kind === "future" || load.kind === "corrupt") {
    return { ...out, lost: spaces.map((s) => s.name), refused: true };
  }
  const snapshot = workspaceLoadSnapshot();
  const names = new Set(snapshot.kind === "ok" ? snapshot.store.workspaces.map((w) => w.name) : []);
  for (const space of spaces) {
    for (const kind of space.lost) out.lost.push(`${space.name}: ${kind}`);
    if (names.has(space.name.trim())) {
      out.same++;
      continue;
    }
    if (!space.layout) {
      out.lost.push(space.name);
      continue;
    }
    if (!saveWorkspace(space.name, space.layout, [], null)) {
      out.refused = true;
      continue;
    }
    names.add(space.name.trim());
    out.added++;
  }
  return out;
}

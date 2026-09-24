// Pannello workspace nominati (F22): elenco, salva/carica/aggiorna/
// rinomina/elimina con fallback esplicito. Si popola da
// `state/workspaces.ts` (versionato, futuro/corrrotto mai riscritti).
// Il ripristino applica il layout reale con teardown corretto
// (`applyShellLayout`: release unwatched con flush, mai perdita dirty) e
// mostra il report (doc mancanti, view non dichiarate, history potata).
// Chiude in sé: `currentWorkspaceId` è l’ultimo applicato in questa
// sessione, non una verità persistita.
import { layout } from "./layout";
import { state } from "./store";
import {
  applyWorkspace,
  workspaceLoadSnapshot,
  deleteWorkspace,
  loadWorkspaces,
  renameWorkspace,
  saveWorkspace,
  type WorkspaceEntry,
} from "./workspaces";
import { applyWorkspaceById } from "./shell-commands";
import { notify } from "../ui/notify";
import { t } from "../i18n/strings";
import { showContextMenu } from "../ui/menu";
import { on } from "./store";
import { openLifetime, type Lifetime, type Teardown } from "../ui/lifetime";
import { primaryView } from "../ui/views";
import { captureShellGeometry } from "./shell-geometry";

let currentId: string | null = null;
let lastLoadedId: string | null = null;

export function currentWorkspaceId(): string | null {
  return currentId;
}

export function lastLoadedWorkspaceId(): string | null {
  return lastLoadedId;
}

export function setCurrentWorkspace(id: string | null): void {
  currentId = id;
  if (id) lastLoadedId = id;
}

export function clearCurrentWorkspace(): void {
  currentId = null;
}

function panel(): HTMLElement | null {
  return document.getElementById("workspaces-panel");
}

function ensurePanel(): HTMLElement {
  let el = panel();
  if (el) return el;
  const sidebar = document.getElementById("sidebar");
  el = document.createElement("section");
  el.id = "workspaces-panel";
  el.className = "workspaces-panel";
  el.setAttribute("aria-label", t("workspaces.title"));
  el.hidden = true;
  sidebar?.appendChild(el);
  return el;
}

export async function refreshWorkspacesPanel(): Promise<void> {
  const el = ensurePanel();
  if (el.hidden) return;
  const status = workspaceLoadSnapshot();
  el.replaceChildren();
  const head = document.createElement("div");
  head.className = "panel-title";
  const title = document.createElement("span");
  title.textContent = t("workspaces.title");
  head.appendChild(title);
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = t("workspaces.save");
  save.addEventListener("click", () => void saveWorkspaceFlow().then(() => refreshWorkspacesPanel()));
  head.appendChild(save);
  el.appendChild(head);
  if (status.kind === "future") {
    const warn = document.createElement("p");
    warn.className = "palette-desc";
    warn.textContent = t("workspaces.future", { version: status.version });
    el.appendChild(warn);
    return;
  }
  if (status.kind === "corrupt") {
    const warn = document.createElement("p");
    warn.className = "palette-desc";
    warn.textContent = t("workspaces.corrupt");
    el.appendChild(warn);
    return;
  }
  if (status.kind === "empty" || status.store.workspaces.length === 0) {
    const empty = document.createElement("p");
    empty.className = "palette-desc";
    empty.textContent = t("workspaces.empty");
    el.appendChild(empty);
    return;
  }
  const list = document.createElement("ul");
  list.className = "plain-list";
  for (const w of status.store.workspaces) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    const name = document.createElement("span");
    name.className = "palette-title";
    name.textContent = `${currentId === w.id ? "● " : ""}${w.name}`;
    const meta = document.createElement("span");
    meta.className = "palette-desc";
    meta.textContent = `${w.panes} riquadri · ${w.tabs} tab`;
    button.append(name, meta);
    button.addEventListener("click", () => void applyWorkspaceById(w.id));
    button.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showContextMenu(e, [
        { label: t("workspaces.load"), run: () => void applyWorkspaceById(w.id) },
        { label: t("workspaces.update"), run: () => void updateWorkspaceFlow(w.id) },
        { label: t("workspaces.rename"), run: () => {
          const next = window.prompt(t("workspaces.rename_title"), w.name);
          if (next === null) return;
          if (renameWorkspace(w.id, next)) void refreshWorkspacesPanel();
          else notify(t("workspaces.rename_failed"), "guasto");
        } },
        { label: t("workspaces.delete"), danger: true, run: () => {
          if (!window.confirm(t("workspaces.delete_confirm", { name: w.name }))) return;
          if (deleteWorkspace(w.id)) {
            if (currentId === w.id) currentId = null;
            void refreshWorkspacesPanel();
          } else notify(t("workspaces.delete_failed"), "guasto");
        } },
      ]);
    });
    li.appendChild(button);
    list.appendChild(li);
  }
  el.appendChild(list);
}

export async function saveWorkspaceFlow(): Promise<WorkspaceEntry | null> {
  const name = window.prompt(t("workspaces.save_title"), "");
  if (name === null) return null;
  const entry = saveWorkspace(name, layout, [...state.expanded], state.activeSpace, captureShellGeometry());
  if (!entry) {
    notify(t("workspaces.save_failed"), "guasto");
    return null;
  }
  setCurrentWorkspace(entry.id);
  notify(t("workspaces.saved"), "info");
  return entry;
}

export function loadWorkspaceFlow(): void {
  const el = ensurePanel();
  el.hidden = false;
  void refreshWorkspacesPanel();
}

async function updateWorkspaceFlow(id: string): Promise<void> {
  const { updateWorkspace } = await import("./workspaces");
  const entry = updateWorkspace(id, layout, [...state.expanded], state.activeSpace, captureShellGeometry());
  if (!entry) notify(t("workspaces.update_failed"), "guasto");
  else {
    setCurrentWorkspace(id);
    notify(t("workspaces.updated"), "info");
    void refreshWorkspacesPanel();
  }
}

export async function previewWorkspaceReport(id: string): Promise<string> {
  const computed = await applyWorkspace(id, layout, (view) => primaryView(view) !== undefined);
  if (!computed) return t("workspaces.missing");
  const parts: string[] = [];
  parts.push(`${computed.report.panes} riquadri · ${computed.report.tabs} tab`);
  if (computed.report.missingDocs.length > 0) {
    parts.push(t("workspaces.report_missing", { docs: computed.report.missingDocs.join(", ") }));
  }
  if (computed.report.undeclaredViews.length > 0) {
    parts.push(t("workspaces.report_views", { views: computed.report.undeclaredViews.join(", ") }));
  }
  return parts.join(" · ");
}

export function mountWorkspacesPanel(parent: Lifetime): Teardown {
  const life = openLifetime();
  const dispose = () => {
    if (life.closed) return;
    life.close();
    panel()?.remove();
    currentId = null;
    lastLoadedId = null;
  };
  parent.add(dispose);
  life.add(on("vault", () => {
    currentId = null;
    void loadWorkspaces().then(() => { if (!life.closed) void refreshWorkspacesPanel(); });
  }));
  void loadWorkspaces().then(() => { if (!life.closed) void refreshWorkspacesPanel(); });
  return dispose;
}

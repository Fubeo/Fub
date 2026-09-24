// Azioni dei segnalibri e dei workspace come comandi di shell (P06/F20,F22):
// esclusivamente gli id approvati in `crates/fub-host/src/shell.rs`
// (generato `shell-keys.generated.ts`, default `None`, personalizzabili).
// Nessun id inventato: `ShellCommand` non compila senza riga nel registro
// Rust, che è il presidio contro alias superflui (il workflow riusa i
// comandi kernel). Ogni azione passa da tastiera+palette+menu con lo stesso
// `run`, per la regola del §18.2.
import { activeDoc, layout } from "./layout";
import { applyWorkspace, deleteWorkspace, getWorkspace, renameWorkspace, updateWorkspace } from "./workspaces";
import { state } from "./store";
import { registerShellCommand } from "../ui/commands";
import { applyShellLayout } from "./shell-layout";
import { addBookmark, type BookmarkTarget } from "./bookmarks";
import { openDocument } from "../panels/document";
import { searchFor } from "../panels/search";
import { openViewIn } from "./layout";
import { notify } from "../ui/notify";
import { t } from "../i18n/strings";
import { resolvedReference } from "../host/query";
import { revealByteOffset } from "../panels/document";
import { captureShellGeometry, restoreShellGeometry } from "./shell-geometry";
import { saveActiveSpace, saveExpanded, emit } from "./store";

/// Apre un segnalibro eterogeneo con gli stessi verbi dell’app: doc via
/// `openDocument` (+ anchor via reveal quando il link lo nomina), cartella
/// via explorer (expanded+focus), ricerca via `searchFor`, view via
/// `openViewIn`, web via browser esterno (mai iframe nella shell fidata),
/// multi-tab via aperture in fila. Fallback non distruttivo: doc mancante
/// o view non dichiarata = avviso nominato, mai cancellazione.
export async function openBookmarkTarget(target: BookmarkTarget): Promise<void> {
  if (target.k === "doc") {
    try {
      await openDocument(target.doc);
      if (target.heading || target.block) {
        const resolved = await resolvedReference(
          { kind: "wiki", value: { page: target.doc, heading: target.heading ?? null, block: target.block ?? null } },
          target.doc,
        );
        if (resolved?.at && resolved.doc === target.doc) revealByteOffset(resolved.at.span.start);
      }
    } catch (e) {
      notify(t("preview.open_failed", { page: target.doc, reason: String(e) }), "guasto");
    }
    return;
  }
  if (target.k === "folder") {
    const store = await import("./store");
    state.expanded.add(target.path);
    store.saveExpanded();
    store.emit("organization");
    return;
  }
  if (target.k === "search") {
    searchFor(target.query);
    return;
  }
  if (target.k === "view") {
    openViewIn(layout.focus, target.view);
    return;
  }
  if (target.k === "web") {
    // Mai iframe nella shell fidata: si apre nel browser esterno via
    // ancora con rel/opener chiuso; se il bridge manca, si mostra l’URL.
    const anchor = document.createElement("a");
    anchor.href = target.url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
    return;
  }
  if (target.k === "workspace") {
    await applyWorkspaceById(target.workspace);
    return;
  }
  for (const tab of target.tabs) {
    if (tab.k === "doc") {
      try {
        await openDocument(tab.doc);
      } catch {
        notify(t("preview.open_failed", { page: tab.doc, reason: target.label ?? "" }), "guasto");
      }
    } else {
      openViewIn(layout.focus, tab.view);
    }
  }
}

function currentExpanded(): string[] {
  return [...state.expanded];
}

/// Registra i comandi approvati. Id, titoli e descrizioni seguono il
/// manifest mandato a Main/FrontendIntegration; gli accordi restano quelli
/// del generato (tutti `None`, personalizzabili, zero collisioni nuove).
export function mountShellOwnerCommands(): void {
  registerShellCommand({
    id: "shell.tab.pin",
    title: "commands.tab.pin",
    description: "commands.tab.pin.desc",
    layer: "document",
    run: () => {
      void import("../panels/document").then(({ pinCurrentTab }) => pinCurrentTab(true));
    },
  });
  registerShellCommand({
    id: "shell.tab.unpin",
    title: "commands.tab.unpin",
    description: "commands.tab.unpin.desc",
    layer: "document",
    run: () => {
      void import("../panels/document").then(({ pinCurrentTab }) => pinCurrentTab(false));
    },
  });
  registerShellCommand({
    id: "shell.tab.move.left",
    title: "commands.tab.move.left",
    description: "commands.tab.move.left.desc",
    layer: "document",
    run: () => {
      void import("../panels/document").then(({ moveCurrentTab }) => moveCurrentTab(-1));
    },
  });
  registerShellCommand({
    id: "shell.tab.move.right",
    title: "commands.tab.move.right",
    description: "commands.tab.move.right.desc",
    layer: "document",
    run: () => {
      void import("../panels/document").then(({ moveCurrentTab }) => moveCurrentTab(1));
    },
  });
  registerShellCommand({
    id: "shell.tab.close.others",
    title: "commands.tab.close.others",
    description: "commands.tab.close.others.desc",
    layer: "document",
    run: () => {
      void import("../panels/document").then(({ closeOtherTabs }) => closeOtherTabs());
    },
  });
  registerShellCommand({
    id: "shell.tab.close.unpinned",
    title: "commands.tab.close.unpinned",
    description: "commands.tab.close.unpinned.desc",
    layer: "document",
    run: () => {
      void import("../panels/document").then(({ closeUnpinnedTabs }) => closeUnpinnedTabs());
    },
  });
  registerShellCommand({
    id: "shell.pane.back",
    title: "commands.pane.back",
    description: "commands.pane.back.desc",
    layer: "pane",
    run: () => {
      void import("../panels/document").then(({ paneBack }) => paneBack());
    },
  });
  registerShellCommand({
    id: "shell.pane.forward",
    title: "commands.pane.forward",
    description: "commands.pane.forward.desc",
    layer: "pane",
    run: () => {
      void import("../panels/document").then(({ paneForward }) => paneForward());
    },
  });
  registerShellCommand({
    id: "shell.pane.link",
    title: "commands.pane.link",
    description: "commands.pane.link.desc",
    layer: "pane",
    run: () => {
      void import("../panels/document").then(({ linkCurrentPane }) => linkCurrentPane(true));
    },
  });
  registerShellCommand({
    id: "shell.pane.unlink",
    title: "commands.pane.unlink",
    description: "commands.pane.unlink.desc",
    layer: "pane",
    run: () => {
      void import("../panels/document").then(({ linkCurrentPane }) => linkCurrentPane(false));
    },
  });
  registerShellCommand({
    id: "shell.bookmarks.toggle",
    title: "commands.bookmarks.toggle",
    description: "commands.bookmarks.toggle.desc",
    layer: "global",
    run: () => {
      void import("./bookmarks-ui").then(({ toggleBookmarksPanel }) => toggleBookmarksPanel());
    },
  });
  registerShellCommand({
    id: "shell.bookmarks.save",
    title: "commands.bookmarks.save",
    description: "commands.bookmarks.save.desc",
    layer: "document",
    run: () => {
      const doc = activeDoc();
      if (!doc) {
        notify(t("docsearch.no_doc"), "guasto");
        return;
      }
      addBookmark(doc.split("/").pop() ?? doc, { k: "doc", doc });
      notify(t("bookmarks.saved"), "info");
    },
  });
  registerShellCommand({
    id: "shell.bookmarks.open",
    title: "commands.bookmarks.open",
    description: "commands.bookmarks.open.desc",
    layer: "global",
    run: () => {
      void import("./bookmarks-ui").then(({ openBookmarksPanel }) => openBookmarksPanel());
    },
  });
  registerShellCommand({
    id: "shell.bookmarks.group",
    title: "commands.bookmarks.group",
    description: "commands.bookmarks.group.desc",
    layer: "global",
    run: () => {
      void import("./bookmarks-ui").then(({ newBookmarkGroup }) => newBookmarkGroup());
    },
  });
  registerShellCommand({
    id: "shell.workspace.save",
    title: "commands.workspace.save",
    description: "commands.workspace.save.desc",
    layer: "global",
    run: () => {
      void import("./workspaces-ui").then(({ saveWorkspaceFlow }) => saveWorkspaceFlow());
    },
  });
  registerShellCommand({
    id: "shell.workspace.load",
    title: "commands.workspace.load",
    description: "commands.workspace.load.desc",
    layer: "global",
    run: () => {
      void import("./workspaces-ui").then(({ loadWorkspaceFlow }) => loadWorkspaceFlow());
    },
  });
  registerShellCommand({
    id: "shell.workspace.update",
    title: "commands.workspace.update",
    description: "commands.workspace.update.desc",
    layer: "global",
    run: async () => {
      const { currentWorkspaceId, loadWorkspaceFlow } = await import("./workspaces-ui");
      const id = currentWorkspaceId();
      if (!id) {
        loadWorkspaceFlow();
        return;
      }
      const updated = updateWorkspace(id, layout, currentExpanded(), state.activeSpace, captureShellGeometry());
      notify(t(updated ? "workspaces.updated" : "workspaces.update_failed"), updated ? "info" : "guasto");
    },
  });
  registerShellCommand({
    id: "shell.workspace.rename",
    title: "commands.workspace.rename",
    description: "commands.workspace.rename.desc",
    layer: "global",
    run: async () => {
      const ui = await import("./workspaces-ui");
      const id = ui.currentWorkspaceId() ?? ui.lastLoadedWorkspaceId();
      const entry = id ? getWorkspace(id) : null;
      if (!entry) {
        ui.loadWorkspaceFlow();
        return;
      }
      const name = window.prompt(t("workspaces.rename_title"), entry.name);
      if (name === null) return;
      if (!renameWorkspace(entry.id, name)) notify(t("workspaces.rename_failed"), "guasto");
      else ui.refreshWorkspacesPanel();
    },
  });
  registerShellCommand({
    id: "shell.workspace.delete",
    title: "commands.workspace.delete",
    description: "commands.workspace.delete.desc",
    layer: "global",
    run: async () => {
      const ui = await import("./workspaces-ui");
      const id = ui.currentWorkspaceId() ?? ui.lastLoadedWorkspaceId();
      if (!id) {
        ui.loadWorkspaceFlow();
        return;
      }
      const entry = getWorkspace(id);
      const ok = window.confirm(t("workspaces.delete_confirm", { name: entry?.name ?? id }));
      if (!ok) return;
      if (!deleteWorkspace(id)) notify(t("workspaces.delete_failed"), "guasto");
      else {
        ui.clearCurrentWorkspace();
        ui.refreshWorkspacesPanel();
      }
    },
  });
  registerShellCommand({
    id: "shell.preview.show",
    title: "commands.preview.show",
    description: "commands.preview.show.desc",
    layer: "document",
    run: () => {
      void import("./preview").then(({ showPreviewForCurrent }) => showPreviewForCurrent(false));
    },
  });
  registerShellCommand({
    id: "shell.preview.hide",
    title: "commands.preview.hide",
    description: "commands.preview.hide.desc",
    layer: "document",
    run: () => {
      void import("./preview").then(({ hidePreview }) => hidePreview());
    },
  });
}

/// Applica un workspace salvato al live con teardown corretto: chiude le
/// sessioni non più guardate (flush+draft via `release`), smonta le view
/// uscite, poi disegna. Il dirty non si perde: `release` fa flush prima di
/// chiudere, e il layout corrente resta intatto se l’apply fallisce.
export async function applyWorkspaceById(id: string): Promise<void> {
  const { primaryView } = await import("../ui/views");
  const computed = await applyWorkspace(id, layout, (view) => primaryView(view) !== undefined);
  if (!computed) {
    notify(t("workspaces.missing"), "guasto");
    return;
  }
  await applyShellLayout(computed.layout);
  const entry = getWorkspace(id);
  if (entry) {
    state.expanded = new Set(entry.expanded);
    state.activeSpace = entry.activeSpace && state.meta.spaces.includes(entry.activeSpace) ? entry.activeSpace : null;
    saveExpanded();
    saveActiveSpace();
    emit("organization");
  }
  if (computed.geometry) restoreShellGeometry(computed.geometry);
  const { setCurrentWorkspace } = await import("./workspaces-ui");
  setCurrentWorkspace(id);
  if (computed.report.missingDocs.length > 0 || computed.report.undeclaredViews.length > 0) {
    notify(
      t("workspaces.applied_partial", {
        missing: computed.report.missingDocs.join(", ") || "—",
        views: computed.report.undeclaredViews.join(", ") || "—",
      }),
      "guasto",
    );
  } else {
    notify(t("workspaces.applied"), "info");
  }
}

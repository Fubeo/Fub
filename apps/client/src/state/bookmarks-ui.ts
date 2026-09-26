import { confirm } from "../host/dialog";
import { pickFromList, promptText } from "../ui/dialogs";
import { activeTab, documents, layout, pane } from "./layout";
import {
  addBookmark,
  bookmarkLoadSnapshot,
  addGroup,
  listBookmarks,
  listGroups,
  loadBookmarks,
  moveBookmark,
  removeBookmark,
  removeGroup,
  renameBookmark,
  renameGroup,
  saveTabsAsBookmark,
  setBookmarkGroup,
  type Bookmark,
  type BookmarkTarget,
} from "./bookmarks";
import { on } from "./store";
import { openLifetime, type Lifetime, type Teardown } from "../ui/lifetime";
import { refreshOn, registerPanel, unregisterPanel, type Panel } from "../ui/panel-host";
import { showContextMenu } from "../ui/menu";
import { notify } from "../ui/notify";
import { t } from "../i18n/strings";
import { setTooltip } from "../ui/tooltip";
import { openBookmarkTarget } from "./shell-commands";
import { state } from "./store";
import { currentWorkspaceId } from "./workspaces-ui";

let lifetime: Lifetime | null = null;

/// L'id del pannello nel registro (`ui/panel-host.ts`): `shell:` perché è di
/// questa shell.
const PANEL_ID = "shell:bookmarks";

function panel(): HTMLElement | null {
  return document.getElementById("bookmarks-panel");
}

function ensurePanel(): HTMLElement {
  let el = panel();
  if (el) return el;
  const sidebar = document.getElementById("sidebar");
  el = document.createElement("section");
  el.id = "bookmarks-panel";
  el.className = "bookmarks-panel";
  el.setAttribute("aria-label", t("bookmarks.title"));
  el.hidden = true;
  sidebar?.appendChild(el);
  return el;
}

async function refresh(): Promise<void> {
  const el = ensurePanel();
  if (el.hidden) return;
  const status = bookmarkLoadSnapshot();
  el.replaceChildren();
  const head = document.createElement("div");
  head.className = "panel-title";
  const title = document.createElement("span");
  title.textContent = t("bookmarks.title");
  head.appendChild(title);
  const actions = document.createElement("div");
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = t("bookmarks.save_tabs");
  setTooltip(save, t("bookmarks.save_tabs_hint"));
  save.addEventListener("click", async () => {
    const p = pane(layout.focus);
    if (!p) return;
    const name = await promptText({ title: t("bookmarks.save_tabs"), label: t("bookmarks.name_title"), value: t("bookmarks.default_tabs") });
    if (name === null) return;
    const created = saveTabsAsBookmark(name, [...p.tabs]);
    if (!created) notify(t("bookmarks.save_failed"), "guasto");
    else void refresh();
  });
  const add = document.createElement("button");
  add.type = "button";
  add.textContent = t("bookmarks.add");
  add.setAttribute("aria-label", t("bookmarks.add_hint"));
  add.addEventListener("click", (event) => {
    const doc = activeTab();
    const options: Array<{ label: string; target: BookmarkTarget }> = [];
    if (doc?.k === "doc") {
      options.push({ label: t("bookmarks.type.file"), target: { k: "doc", doc: doc.doc } });
      options.push({ label: t("bookmarks.type.heading"), target: { k: "doc", doc: doc.doc, heading: "" } });
      options.push({ label: t("bookmarks.type.block"), target: { k: "doc", doc: doc.doc, block: "" } });
    }
    if (doc?.k === "view") options.push({ label: t("bookmarks.type.view"), target: { k: "view", view: doc.view } });
    const query = document.getElementById("search-input");
    if (query instanceof HTMLInputElement && query.value.trim())
      options.push({ label: t("bookmarks.type.search"), target: { k: "search", query: query.value.trim() } });
    if (state.activeSpace) options.push({ label: t("bookmarks.type.folder"), target: { k: "folder", path: state.activeSpace } });
    const workspaceId = currentWorkspaceId();
    if (workspaceId) options.push({ label: t("bookmarks.type.workspace"), target: { k: "workspace", workspace: workspaceId } });
    showContextMenu(event, options.map(({ label, target }) => ({
      label,
      run: async () => {
        if (target.k === "doc" && "heading" in target) {
          const heading = await promptText({ title: t("bookmarks.add"), label: t("bookmarks.type.heading") });
          if (!heading) return;
          target.heading = heading;
        }
        if (target.k === "doc" && "block" in target) {
          const block = await promptText({ title: t("bookmarks.add"), label: t("bookmarks.type.block") });
          if (!block) return;
          target.block = block;
        }
        const title = await promptText({ title: t("bookmarks.add"), label: t("bookmarks.name_title"), value: label });
        if (title === null) return;
        if (!addBookmark(title, target)) notify(t("bookmarks.save_failed"), "guasto");
        else void refresh();
      },
    })));
  });
  const group = document.createElement("button");
  group.type = "button";
  group.textContent = t("bookmarks.new_group");
  group.addEventListener("click", () => void newBookmarkGroup().then(() => refresh()));
  actions.append(save, add, group);
  head.appendChild(actions);
  el.appendChild(head);
  if (status.kind === "future") {
    const warn = document.createElement("p");
    warn.className = "palette-desc";
    warn.textContent = t("bookmarks.future", { version: status.version });
    el.appendChild(warn);
    return;
  }
  if (status.kind === "corrupt") {
    const warn = document.createElement("p");
    warn.className = "palette-desc";
    warn.textContent = t("bookmarks.corrupt");
    el.appendChild(warn);
    return;
  }
  const groups = listGroups();
  const bookmarks = listBookmarks();
  if (groups.length > 0) {
    const glist = document.createElement("ul");
    glist.className = "plain-list";
    for (const g of groups) {
      const li = document.createElement("li");
      const row = document.createElement("div");
      row.className = "palette-row";
      const name = document.createElement("span");
      name.className = "palette-title";
      name.textContent = g.title;
      row.appendChild(name);
      const count = document.createElement("span");
      count.className = "palette-desc";
      count.textContent = String(g.bookmarkIds.length);
      row.appendChild(count);
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showContextMenu(e, [
          { label: t("bookmarks.rename"), run: async () => {
            const next = await promptText({ title: t("bookmarks.rename"), label: t("bookmarks.rename_title"), value: g.title });
            if (next === null) return;
            renameGroup(g.id, next);
            void refresh();
          } },
          { separator: true, label: t("bookmarks.delete"), danger: true, run: async () => {
            const ok = await confirm(t("bookmarks.delete_group_confirm", { title: g.title }), {
              title: t("bookmarks.delete"),
              okLabel: t("bookmarks.delete"),
              danger: true,
            });
            if (!ok) return;
            removeGroup(g.id);
            void refresh();
          } },
        ]);
      });
      li.appendChild(row);
      const members = document.createElement("ul");
      members.className = "plain-list";
      for (const id of g.bookmarkIds) {
        const b = bookmarks.find((x) => x.id === id);
        if (!b) continue;
        members.appendChild(rowFor(b));
      }
      li.appendChild(members);
      glist.appendChild(li);
    }
    el.appendChild(glist);
  }
  const ungrouped = bookmarks.filter((b) => !groups.some((g) => g.bookmarkIds.includes(b.id)));
  const list = document.createElement("ul");
  list.className = "plain-list";
  for (const b of ungrouped) list.appendChild(rowFor(b));
  el.appendChild(list);
  if (bookmarks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "palette-desc";
    empty.textContent = t("bookmarks.empty");
    el.appendChild(empty);
  }
}

function rowFor(b: Bookmark): HTMLElement {
  const li = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "search-result";
  const title = document.createElement("span");
  title.className = "palette-title";
  title.textContent = b.title;
  const where = document.createElement("span");
  where.className = "palette-desc";
  where.textContent = describeTarget(b);
  button.append(title, where);
  setTooltip(button, describeTarget(b));
  button.addEventListener("click", () => void openBookmarkTarget(b.target));
  button.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e, [
      { label: t("bookmarks.open"), run: () => void openBookmarkTarget(b.target) },
      { label: t("bookmarks.rename"), run: async () => {
        const next = await promptText({ title: t("bookmarks.rename"), label: t("bookmarks.rename_title"), value: b.title });
        if (next === null) return;
        renameBookmark(b.id, next);
        void refresh();
      } },
      { separator: true, label: t("bookmarks.move_up"), run: () => {
        const list = listBookmarks();
        const at = list.findIndex((x) => x.id === b.id);
        if (moveBookmark(b.id, Math.max(0, at - 1))) void refresh();
      } },
      { label: t("bookmarks.move_down"), run: () => {
        const list = listBookmarks();
        const at = list.findIndex((x) => x.id === b.id);
        if (moveBookmark(b.id, Math.min(list.length - 1, at + 1))) void refresh();
      } },
      { label: t("bookmarks.assign_group"), run: () => void assignGroupFlow(b.id).then(() => refresh()) },
      { separator: true, label: t("bookmarks.delete"), danger: true, run: async () => {
        const ok = await confirm(t("bookmarks.delete_confirm", { title: b.title }), {
          title: t("bookmarks.delete"),
          okLabel: t("bookmarks.delete"),
          danger: true,
        });
        if (!ok) return;
        removeBookmark(b.id);
        void refresh();
      } },
    ]);
  });
  li.appendChild(button);
  return li;
}

function describeTarget(b: Bookmark): string {
  const target = b.target;
  if (target.k === "doc") return target.doc;
  if (target.k === "folder") return target.path === "" ? "/" : target.path;
  if (target.k === "search") return target.query;
  if (target.k === "view") return target.view;
  if (target.k === "workspace") return target.workspace;
  if (target.k === "web") return target.url;
  return t("bookmarks.tabs_count", { count: target.tabs.length });
}

async function assignGroupFlow(bookmarkId: string): Promise<void> {
  const groups = listGroups();
  if (groups.length === 0) {
    const created = await newBookmarkGroup();
    if (created) setBookmarkGroup(bookmarkId, created.id);
    return;
  }
  const choice = await pickFromList<string>({
    title: t("bookmarks.assign_group"),
    placeholder: t("bookmarks.group_filter"),
    items: groups.map((g) => ({ label: g.title, detail: String(g.bookmarkIds.length), value: g.id })),
  });
  if (choice !== null) setBookmarkGroup(bookmarkId, choice);
}

export async function newBookmarkGroup(): Promise<{ id: string } | null> {
  const name = await promptText({ title: t("bookmarks.new_group"), label: t("bookmarks.group_title") });
  if (name === null) return null;
  const group = addGroup(name);
  if (!group) {
    notify(t("bookmarks.group_failed"), "guasto");
    return null;
  }
  return { id: group.id };
}

/// Il pannello si vede quando il suo elemento non è nascosto: una sola verità,
/// quella che legge anche chi guarda lo schermo.
function isShown(): boolean {
  return panel()?.hidden === false;
}

export function openBookmarksPanel(): void {
  ensurePanel().hidden = false;
  void refresh();
}

export function toggleBookmarksPanel(): void {
  const el = ensurePanel();
  el.hidden = !el.hidden;
  if (!el.hidden) void refresh();
}

/// Monta il pannello dei segnalibri **nel registro dei pannelli**: dichiara chi
/// è, dove sta e cosa lo fa invecchiare, e quando ridisegnarlo lo decide
/// l'host — una rinomina riscrive i segnalibri che puntano alla nota, una coda
/// troncata li riconcilia, e un pannello nascosto non si ridisegna. Restano suoi
/// soltanto i segnali della shell: il vault che cambia (i segnalibri si
/// rileggono) e l'elenco dei documenti (quali bersagli esistono ancora).
export function mountBookmarksPanel(parent: Lifetime): Teardown {
  lifetime?.close();
  const life = openLifetime();
  lifetime = life;
  const registration: Panel = {
    id: PANEL_ID,
    title: "Segnalibri",
    placement: "left_sidebar",
    refresh: refreshOn("document_renamed"),
    visible: isShown,
    render: () => refresh(),
  };
  registerPanel(registration);
  const dispose = () => {
    if (life.closed) return;
    life.close();
    if (lifetime === life) {
      lifetime = null;
      unregisterPanel(PANEL_ID);
      panel()?.remove();
    }
  };
  parent.add(dispose);
  life.add(on("vault", () => {
    void loadBookmarks().then(() => { if (!life.closed) void refresh(); });
  }));
  life.add(on("documents", () => void refresh()));
  void loadBookmarks().then(() => { if (!life.closed) void refresh(); });
  return dispose;
}

export function currentOpenDocs(): string[] {
  const out: string[] = [];
  for (const id of Object.keys(layout.panes)) {
    const p = pane(id);
    if (!p) continue;
    for (const doc of documents(p)) {
      if (!out.includes(doc)) out.push(doc);
    }
  }
  return out;
}

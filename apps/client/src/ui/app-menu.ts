// La menubar applicativa: File, Modifica, Vista, Vai, Strumenti.
//
// Una menubar è un menu orizzontale di voci, ognuna delle quali apre un menu
// verticale sotto di sé. Non è una cosa che il web sa fare nativamente bene —
// il `<menu>` non ha la semantica, e le persone che navigano da tastiera
// perdono subito la via — quindi la costruiamo a mano, con i ruoli ARIA che
// la rendono navigabile (`menubar`, `menuitem`, `menu`, `menuitem`) e le
// scorciatoie che la rendono usabile (frecce, Escape, click).
//
// # Perché non registra comandi
//
// Le voci dei menu invocano comandi **già registrati** — `shell.vault.open`,
// `shell.palette`, `shell.graph` — e non ne dichiarano di nuovi. La dieta
// dei comandi di shell è chiusa, e un menu che inventasse i propri la
// violerebbe. Il menu è un lettore del registro, non un scrittore.
//
// # La iniezione, e perché
//
// Il menu non importa `allCommands` né `startCommand`: lo farebbe dipendere
// dalla palette, e la palette importa il menu? No — ma i due moduli
// condividono la stessa domanda («dammi l'entry di questo id»), e cablarla
// qui vorrebbe dire sapere cosa fa la palette quando la esegue. Quindi
// `main.ts` inietta `run(id)`: il menu chiede, `main.ts` risolve ed esegue.
import { $ } from "./dom";
import { showContextMenu, closeContextMenu, type MenuItem } from "./menu";
import { t } from "../i18n/strings";
import type { ShellCommandId } from "./shell-keys.generated";
import { openLifetime, type Teardown } from "./lifetime";

/// L'unica cosa che il menu chiede alla shell: esegui questo comando.
///
/// È una funzione e non un registro perché il menu non deve sapere chi
/// esegue — la palette, la tastiera, un altro menu — ma solo che **qualcuno
/// lo fa**. `main.ts` la costruisce da `allCommands` + `startCommand`, e la
/// passa qui dentro.
export interface MenuHost {
  run(id: ShellCommandId): void;
  /// La scorciatoia del comando come la si preme, se ne ha una: la mostra la
  /// voce accanto al nome, come in ogni menu che insegna le scorciatoie.
  shortcut?(id: ShellCommandId): string;
}


/// I cinque menu, nell'ordine canonico. Le voci sono i comandi di shell già
/// registrati — niente di nuovo, niente di cablato che il registro non sappia.
/// Le chiavi `titolo` sono i nomi dei menu stessi («File», «Vista») e
/// devono apparire come stringhe letterali nel sorgente, o il presidio
/// delle chiavi morte le dichiara morte.
/// Una voce è un comando di shell, o un click su un bottone che già c'è.
/// Impostazioni non è un comando di shell (la dieta è chiusa): è il bottone
/// `#open-settings`, e il menu lo preme invece di inventarsi un id.
/// `separator` mette una riga prima della voce, per raggruppare i gesti affini.
type MenuEntry = (
  | { label: string; command: ShellCommandId }
  | { label: string; click: string }
) & { separator?: boolean };

const MENU: { title: string; entries: MenuEntry[] }[] = [
  {
    title: "menu.file",
    entries: [
      { label: "menu.file.new_note", command: "shell.note.new" },
      { label: "menu.file.save", command: "shell.doc.save" },
      { label: "menu.file.open_vault", command: "shell.vault.open", separator: true },
      { label: "menu.file.reopen_tab", command: "shell.tab.reopen", separator: true },
      { label: "menu.file.close_tab", command: "shell.tab.close" },
      { label: "menu.tools.settings", command: "shell.settings", separator: true },
    ],
  },
  {
    title: "menu.edit",
    entries: [
      { label: "menu.edit.palette", command: "shell.palette" },
      { label: "menu.edit.doc_search", command: "shell.doc.search" },
    ],
  },
  {
    title: "menu.view",
    entries: [
      { label: "menu.view.files", command: "shell.panel.files" },
      { label: "menu.view.search", command: "shell.panel.search" },
      { label: "menu.view.graph", command: "shell.graph" },
      { label: "menu.view.sidebar", command: "shell.sidebar.toggle", separator: true },
      { label: "menu.view.inspector", command: "shell.inspector.toggle" },
      { label: "menu.view.focus", command: "shell.focus.toggle" },
      { label: "menu.view.mode_live", command: "shell.mode.live", separator: true },
      { label: "menu.view.mode_source", command: "shell.mode.source" },
      { label: "menu.view.mode_reading", command: "shell.mode.reading" },
      { label: "menu.view.zoom_in", command: "shell.zoom.in", separator: true },
      { label: "menu.view.zoom_out", command: "shell.zoom.out" },
      { label: "menu.view.zoom_reset", command: "shell.zoom.reset" },
    ],
  },
  {
    title: "menu.go",
    entries: [
      { label: "menu.go.switcher", command: "shell.switcher" },
      { label: "menu.go.back", command: "shell.pane.back", separator: true },
      { label: "menu.go.forward", command: "shell.pane.forward" },
      { label: "menu.go.next_tab", command: "shell.tab.next", separator: true },
      { label: "menu.go.previous_tab", command: "shell.tab.previous" },
    ],
  },
  { title: "menu.tools", entries: [{ label: "menu.tools.settings", command: "shell.settings" }] },
];
const mountedMenus = new WeakMap<HTMLElement, Teardown>();

/// Monta la menubar. Torna gli smontaggi, perché gli ascoltatori che attacca
/// sul `document` (chiusura con click/Escape) vivono quanto la menubar, non
/// quanto la finestra: se un domani la menubar si smontasse, non restano.
///
/// La menubar apre una **`Lifetime` sua** invece di ricevere quella della finestra,
/// ed è la riga precedente detta in un tipo: una vita ricevuta durerebbe quanto
/// chi la presta, e questi due ascoltatori devono morire prima. La coppia
/// `addEventListener`/`removeEventListener` scritto a mano diceva la stessa
/// cosa e la diceva **a memoria** — la seconda metà si può dimenticare, e
/// `check-ascoltatori.mjs` esiste perché è già successo (0133).
export function mountAppMenu(host: MenuHost): Teardown {
  const menubar = $("#app-menu");
  mountedMenus.get(menubar)?.();
  // La vita degli ascoltatori globali di questa menubar: si chiude nello
  // smontaggio qui sotto, ed è l'unica cosa che li tiene.
  const lifetime = openLifetime();
  const buttons: HTMLButtonElement[] = [];
  let menuOpen: number | null = null;
  let menuGeneration = 0;
  let disposed = false;

  menubar.setAttribute("role", "menubar");
  menubar.setAttribute("aria-orientation", "horizontal");

  function setExpanded(index: number, open: boolean): void {
    buttons[index]?.setAttribute("aria-expanded", String(open));
  }

  function setTabStop(index: number): void {
    buttons.forEach((button, i) => {
      button.tabIndex = i === index ? 0 : -1;
    });
  }

  // La chiusura è la stessa qualunque sia il gesto che la provoca. Azzerare lo
  // stato prima della superficie evita che il callback di chiusura rientri qui.
  function close(): void {
    const index = menuOpen;
    if (index === null) {
      buttons.forEach((button) => {
        if (button.getAttribute("aria-expanded") === "true") {
          button.setAttribute("aria-expanded", "false");
        }
      });
      return;
    }
    menuOpen = null;
    menuGeneration += 1;
    setExpanded(index, false);
    closeContextMenu();
  }

  function focusTopLevel(index: number): void {
    const button = buttons[index];
    if (!button) return;
    const keepMenuOpen = menuOpen !== null;
    if (keepMenuOpen) close();
    setTabStop(index);
    button.focus();
    if (keepMenuOpen) openMenu(index, button);
  }

  function moveTopLevel(index: number, delta: number): void {
    const next = (index + delta + buttons.length) % buttons.length;
    focusTopLevel(next);
  }

  function onDocClick(e: MouseEvent): void {
    if (!menubar.contains(e.target as Node)) close();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      if (menuOpen !== null) {
        e.preventDefault();
        close();
      }
      return;
    }
    // Mentre una voce del sottomenu è focalizzata, Left/Right cambia il
    // sottomenu aperto; le frecce verticali sono gestite da menu.ts.
    if (menuOpen === null) return;
    const context = document.getElementById("context-menu");
    if (!context?.contains(e.target as Node)) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const current = menuOpen;
    const next = (current + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    const button = buttons[next];
    if (!button) return;
    close();
    setTabStop(next);
    button.focus();
    openMenu(next, button);
  }

  lifetime.listen(document, "click", onDocClick);
  lifetime.listen(document, "keydown", onKey);

  MENU.forEach((menu, i) => {
    const button = document.createElement("button");
    button.id = `app-menu-${i}`;
    button.setAttribute("role", "menuitem");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.type = "button";
    button.tabIndex = i === 0 ? 0 : -1;
    button.dataset.i18n = menu.title;
    button.textContent = t(menu.title as never);

    lifetime.listen(button, "focus", () => setTabStop(i));
    lifetime.listen(button, "click", (e) => {
      e.stopPropagation();
      button.focus();
      toggleMenu(i, button);
    });
    // Hover su un'altra voce mentre un menu è aperto: passa a quella, come
    // ogni menubar che l'utente abbia mai usato. È il gesto che chi cerca
    // «Vista» fa dopo aver aperto «File» senza chiuderlo.
    lifetime.listen(button, "mouseenter", () => {
      if (menuOpen !== null && menuOpen !== i) toggleMenu(i, button);
    });
    lifetime.listen(button, "keydown", (e) => {
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          moveTopLevel(i, -1);
          break;
        case "ArrowRight":
          e.preventDefault();
          moveTopLevel(i, 1);
          break;
        case "Home":
          e.preventDefault();
          focusTopLevel(0);
          break;
        case "End":
          e.preventDefault();
          focusTopLevel(buttons.length - 1);
          break;
        case "ArrowDown":
          e.preventDefault();
          openMenu(i, button);
          break;
        case "ArrowUp":
          e.preventDefault();
          openMenu(i, button, true);
          break;
      }
    });

    buttons.push(button);
    menubar.append(button);
  });

  function toggleMenu(index: number, button: HTMLButtonElement): void {
    button.focus();
    setTabStop(index);
    if (menuOpen === index && document.getElementById("context-menu")) {
      close();
      return;
    }
    if (menuOpen !== null) close();
    openMenu(index, button);
  }

  function openMenu(index: number, button: HTMLButtonElement, last = false): void {
    const existing = document.getElementById("context-menu");
    if (menuOpen === index && existing) {
      const entries = existing.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      (last ? entries[entries.length - 1] : entries[0])?.focus();
      return;
    }
    if (menuOpen !== null) close();
    setTabStop(index);
    button.focus();
    menuOpen = index;
    setExpanded(index, true);
    const generation = ++menuGeneration;

    const entries = MENU[index]!.entries;
    const items: MenuItem[] = entries.map((v) => ({
      label: t(v.label as never),
      separator: v.separator,
      hint: "command" in v ? host.shortcut?.(v.command) || undefined : undefined,
      run: () => {
        // Il runner può essere raggiunto dopo un click nativo o da un test che
        // lo richiami direttamente: chiudere qui è quindi deliberatamente
        // idempotente e non dipende dal listener del bottone.
        close();
        if ("click" in v) {
          document.querySelector<HTMLElement>(v.click)?.click();
          return;
        }
        host.run(v.command);
      },
    }));
    // Il menu si apre sotto la voce, e non nel punto del click: una menubar
    // ha i menu allineati ai bottoni, e aprirli dove capita sarebbe un menu
    // che salta. `showContextMenu` usa `clientX/clientY`, quindi costruiamo
    // un evento finto dalla posizione del bottone.
    const rect = button.getBoundingClientRect();
    const fake = new MouseEvent("click", {
      clientX: rect.left,
      clientY: rect.bottom,
    });
    showContextMenu(fake, items, {
      labelledBy: button.id,
      onClose: () => {
        // Escape, click fuori e una seconda superficie chiudono il menu senza
        // passare da `close`: il callback impedisce che aria-expanded resti
        // appesa a true e che il click successivo richieda due tentativi.
        if (menuOpen !== index || menuGeneration !== generation) return;
        menuOpen = null;
        menuGeneration += 1;
        setExpanded(index, false);
      },
    });
    const opened = document.getElementById("context-menu");
    if (last) {
      const menuItems = opened?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
      (menuItems?.[menuItems.length - 1])?.focus();
    }
  }

  let teardown: Teardown;
  teardown = () => {
    if (disposed) return;
    disposed = true;
    close();
    lifetime.close();
    buttons.forEach((button) => button.setAttribute("aria-expanded", "false"));
    buttons.forEach((button) => button.remove());
    if (mountedMenus.get(menubar) === teardown) mountedMenus.delete(menubar);
  };
  mountedMenus.set(menubar, teardown);
  return teardown;
}
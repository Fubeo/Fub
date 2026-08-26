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
}


/// I cinque menu, nell'ordine canonico. Le voci sono i comandi di shell già
/// registrati — niente di nuovo, niente di cablato che il registro non sappia.
/// Le chiavi `titolo` sono i nomi dei menu stessi («File», «Vista») e
/// devono apparire come stringhe letterali nel sorgente, o il presidio
/// delle chiavi morte le dichiara morte.
/// Una voce è un comando di shell, o un click su un bottone che già c'è.
/// Impostazioni non è un comando di shell (la dieta è chiusa): è il bottone
/// `#open-settings`, e il menu lo preme invece di inventarsi un id.
type MenuEntry =
  | { label: string; command: ShellCommandId }
  | { label: string; click: string };

const MENU: { title: string; entries: MenuEntry[] }[] = [
  {
    title: "menu.file",
    entries: [
      { label: "menu.file.open_vault", command: "shell.vault.open" },
      { label: "menu.tools.settings", click: "#open-settings" },
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
      { label: "menu.view.mode_reading", command: "shell.mode.reading" },
      { label: "menu.view.mode_live", command: "shell.mode.live" },
    ],
  },
  { title: "menu.go", entries: [{ label: "menu.go.switcher", command: "shell.switcher" }] },
  { title: "menu.tools", entries: [{ label: "menu.tools.settings", click: "#open-settings" }] },
];

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
  const teardowns: Teardown[] = [];
  // La vita degli ascoltatori globali di questa menubar: si chiude nello
  // smontaggio qui sotto, ed è l'unica cosa che li tiene.
  const lifetime = openLifetime();
  let menuOpen: number | null = null;

  MENU.forEach((menu, i) => {
    const button = document.createElement("button");
    button.setAttribute("role", "menuitem");
    button.setAttribute("aria-haspopup", "menu");
    button.setAttribute("aria-expanded", "false");
    button.type = "button";
    button.dataset.i18n = menu.title;
    button.textContent = t(menu.title as never);

    button.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu(i, button, host);
    });
    // Hover su un'altra voce mentre un menu è aperto: passa a quella, come
    // ogni menubar che l'utente abbia mai usato. È il gesto che chi cerca
    // «Vista» fa dopo aver aperto «File» senza chiuderlo.
    button.addEventListener("mouseenter", () => {
      if (menuOpen !== null && menuOpen !== i) toggleMenu(i, button, host);
    });

    menubar.append(button);
  });

  // Click fuori o Escape chiude il menu aperto. Sono sul `document` e non
  // sulla menubar perché il menu è un overlay che vive fuori dalla menubar
  // (`showContextMenu` lo appende a `body`), e chiude chi ci clicca dentro.
  const close = () => {
    if (menuOpen !== null) {
      setExpanded(menuOpen, false);
      closeContextMenu();
      menuOpen = null;
    }
  };
  const onDocClick = (e: MouseEvent) => {
    if (!menubar.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  lifetime.listen(document, "click", onDocClick);
  lifetime.listen(document, "keydown", onKey);
  teardowns.push(() => lifetime.close());

  function setExpanded(index: number, open: boolean): void {
    const btn = menubar.children[index] as HTMLElement | undefined;
    if (btn) {
      // Aperto lo dice `aria-expanded`, e lo legge anche la pelle: la classe
      // `menu-open` era la stessa cosa scritto una seconda volta.
      btn.setAttribute("aria-expanded", String(open));
    }
  }

  function toggleMenu(
    index: number,
    button: HTMLButtonElement,
    host: MenuHost,
  ): void {
    if (menuOpen === index) {
      close();
      return;
    }
    if (menuOpen !== null) setExpanded(menuOpen, false);
    closeContextMenu();
    menuOpen = index;
    setExpanded(index, true);

    const entries = MENU[index]!.entries;
    const items: MenuItem[] = entries.map((v) => ({
      label: t(v.label as never),
      run: () => {
        if ("click" in v) {
          document.querySelector<HTMLElement>(v.click)?.click();
          return;
        }
        host.run(v.command);
      },
    }));
    // Il menu si apre sotto la voce, e non nel punto del click: una menubar
    // ha i menu allineati ai bottoni, e aprirli dove capita sarebbe un menu
    // che salza. `showContextMenu` usa `clientX/clientY`, quindi costruiamo
    // un evento finto dalla posizione del bottone.
    const rect = button.getBoundingClientRect();
    const fake = new MouseEvent("click", {
      clientX: rect.left,
      clientY: rect.bottom,
    });
    showContextMenu(fake, items);
  }

  return () => teardowns.forEach((s) => s());
}
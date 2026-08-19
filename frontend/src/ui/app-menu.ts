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
import { apriVita, type Smontaggio } from "./vita";

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
type VoceMenu =
  | { label: string; command: ShellCommandId }
  | { label: string; click: string };

const MENU: { titolo: string; voci: VoceMenu[] }[] = [
  {
    titolo: "menu.file",
    voci: [
      { label: "menu.file.open_vault", command: "shell.vault.open" },
      { label: "menu.tools.settings", click: "#open-settings" },
    ],
  },
  {
    titolo: "menu.edit",
    voci: [
      { label: "menu.edit.palette", command: "shell.palette" },
      { label: "menu.edit.doc_search", command: "shell.doc.search" },
    ],
  },
  {
    titolo: "menu.view",
    voci: [
      { label: "menu.view.files", command: "shell.panel.files" },
      { label: "menu.view.search", command: "shell.panel.search" },
      { label: "menu.view.graph", command: "shell.graph" },
      { label: "menu.view.mode_reading", command: "shell.mode.reading" },
      { label: "menu.view.mode_live", command: "shell.mode.live" },
    ],
  },
  { titolo: "menu.go", voci: [{ label: "menu.go.switcher", command: "shell.switcher" }] },
  { titolo: "menu.tools", voci: [{ label: "menu.tools.settings", click: "#open-settings" }] },
];

/// Monta la menubar. Torna gli smontaggi, perché gli ascoltatori che attacca
/// sul `document` (chiusura con click/Escape) vivono quanto la menubar, non
/// quanto la finestra: se un domani la menubar si smontasse, non restano.
///
/// La menubar apre una **`Vita` sua** invece di ricevere quella della finestra,
/// ed è la riga precedente detta in un tipo: una vita ricevuta durerebbe quanto
/// chi la presta, e questi due ascoltatori devono morire prima. La coppia
/// `addEventListener`/`removeEventListener` scritta a mano diceva la stessa
/// cosa e la diceva **a memoria** — la seconda metà si può dimenticare, e
/// `check-ascoltatori.mjs` esiste perché è già successo (0133).
export function mountAppMenu(host: MenuHost): Smontaggio {
  const menubar = $("#app-menu");
  const smontaggi: Smontaggio[] = [];
  // La vita degli ascoltatori globali di questa menubar: si chiude nello
  // smontaggio qui sotto, ed è l'unica cosa che li tiene.
  const vita = apriVita();
  let menuAperto: number | null = null;

  MENU.forEach((menu, i) => {
    const bottone = document.createElement("button");
    bottone.setAttribute("role", "menuitem");
    bottone.setAttribute("aria-haspopup", "menu");
    bottone.setAttribute("aria-expanded", "false");
    bottone.type = "button";
    bottone.dataset.i18n = menu.titolo;
    bottone.textContent = t(menu.titolo as never);

    bottone.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu(i, bottone, host);
    });
    // Hover su un'altra voce mentre un menu è aperto: passa a quella, come
    // ogni menubar che l'utente abbia mai usato. È il gesto che chi cerca
    // «Vista» fa dopo aver aperto «File» senza chiuderlo.
    bottone.addEventListener("mouseenter", () => {
      if (menuAperto !== null && menuAperto !== i) toggleMenu(i, bottone, host);
    });

    menubar.append(bottone);
  });

  // Click fuori o Escape chiude il menu aperto. Sono sul `document` e non
  // sulla menubar perché il menu è un overlay che vive fuori dalla menubar
  // (`showContextMenu` lo appende a `body`), e chiude chi ci clicca dentro.
  const chiudi = () => {
    if (menuAperto !== null) {
      setExpanded(menuAperto, false);
      closeContextMenu();
      menuAperto = null;
    }
  };
  const onDocClick = (e: MouseEvent) => {
    if (!menubar.contains(e.target as Node)) chiudi();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") chiudi();
  };
  vita.ascolta(document, "click", onDocClick);
  vita.ascolta(document, "keydown", onKey);
  smontaggi.push(() => vita.chiudi());

  function setExpanded(indice: number, aperto: boolean): void {
    const btn = menubar.children[indice] as HTMLElement | undefined;
    if (btn) {
      // Aperto lo dice `aria-expanded`, e lo legge anche la pelle: la classe
      // `menu-open` era la stessa cosa scritta una seconda volta.
      btn.setAttribute("aria-expanded", String(aperto));
    }
  }

  function toggleMenu(
    indice: number,
    bottone: HTMLButtonElement,
    host: MenuHost,
  ): void {
    if (menuAperto === indice) {
      chiudi();
      return;
    }
    if (menuAperto !== null) setExpanded(menuAperto, false);
    closeContextMenu();
    menuAperto = indice;
    setExpanded(indice, true);

    const voci = MENU[indice]!.voci;
    const items: MenuItem[] = voci.map((v) => ({
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
    const rect = bottone.getBoundingClientRect();
    const fake = new MouseEvent("click", {
      clientX: rect.left,
      clientY: rect.bottom,
    });
    showContextMenu(fake, items);
  }

  return () => smontaggi.forEach((s) => s());
}
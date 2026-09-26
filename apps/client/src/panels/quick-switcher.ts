// **Il quick switcher** (FEATURES 8.1, §21.5): si preme una scorciatoia, si
// scrivono tre lettere, si apre una nota.
//
// È la superficie che si usa più della ricerca stessa, ed è la ragione per cui
// la §21.5 la nominava pur non avendola: nasce da sé — chiunque la scriva in
// mezz'ora la scrive su `list_documents` con un `includes()` — e quel giorno
// l'app avrebbe **due** ricerche, con la peggiore sulla strada più battuta.
// Quindi non nasce da sé: nasce sulla porta della
// [0082](../../../docs/decisions/0182-provider-e-porte-generiche.md), che è
// `IndexQuery::Documents` con i campi ristretti al nome.
//
// # Cosa questo file NON contiene
//
// La query. Sta in `host/contract.ts` (`nameQuery`) e il giro sta in
// `host/query.ts` (`noteDalNome`), che è la regola della 0082 scritto come
// posizione dei file: le due superfici che propongono dei nomi — questa e
// l'autocompletamento dei wikilink — fanno **la stessa** domanda, e il giorno
// in cui il ranking dei nomi cambia cambia in un posto solo.
//
// E l'ordinamento. L'ordine dell'elenco è quello che arriva dal kernel, che è
// dove ci sono i dati per calcolare una rilevanza; un `sort` di qui la
// butterebbe via e non lo direbbe a nessuno.
//
// # A mani vuote
//
// Le note aperte di recente e le ricerche fatte di recente
// (`state/recenti.ts`), come in Obsidian: una scorciatoia premuta deve mostrare
// **qualcosa**, e le prime venti note del vault in ordine di path non sono
// qualcosa — sono un elenco arbitrario che costringe comunque a scrivere.
//
// Fino a ieri quella memoria viveva quanto la finestra, in attesa che la §21.7
// decidesse dove una cronologia si scrive. Adesso lo ha deciso
// ([0086](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md)): resta
// fra un avvio e l'altro, nello stato di vista della shell, e ha un
// interruttore — quindi le due liste qui sotto possono tornare **vuote** anche
// dopo un mese di uso, e non è un difetto, è qualcuno che ha spento la memoria.
//
// # E il gesto che chiude il giro
//
// Non l'ho trovata, creala. Compare solo a risultati vuoti, e il nome che
// propone non è la query così com'è: passa da `rules/nome-cercato.ts`, perché
// `note.create` prende un **path** e una query può contenere uno slash.
import { notesByName } from "../host/query";
import { Race } from "../ui/race";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { notify } from "../ui/notify";
import { searchedName } from "../rules/searched-name";
import { pageName } from "../rules/organizer";
import {
  forgetAll,
  existingRecentNotes,
  recentSearches,
  rememberOpens,
  rememberSearch,
} from "../state/recent";
import { createNote } from "../state/vault";
import { stableIdentifier, trapFocus } from "../ui/a11y";
import { registerShellCommand } from "../ui/commands";
import { setTooltip } from "../ui/tooltip";
import { markedTerms } from "../ui/highlight";
import { enterSurface, exitSurface } from "../ui/motion";
import { cancelScheduledPreview, hidePreview, schedulePreview, showStickyPreview } from "../state/preview";
import { openDocument } from "./document";
import { platformSupports } from "../platform/capabilities";

const OVERLAY_ID = "quick-switcher";
const LIST_ID = `${OVERLAY_ID}-list`;
const OPTION_ID_PREFIX = `${OVERLAY_ID}-option`;
export type SwitcherOpenMode = "here" | "split" | "window";
let dispatchOpen: (doc: string, mode: SwitcherOpenMode) => Promise<void> | void =
  (doc) => openDocument(doc);

/// Ctrl/Cmd apre accanto, con Maiusc in una finestra nuova. Dove la
/// piattaforma ha una finestra sola, Maiusc resta un'apertura accanto.
function openMode(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): SwitcherOpenMode {
  if (!e.ctrlKey && !e.metaKey) return "here";
  return e.shiftKey && platformSupports("multipleWindows") ? "window" : "split";
}

function entryKey(entry: Entry): string {
  return `${entry.k}:${entry.k === "doc" ? entry.doc : entry.k === "query" ? entry.q : entry.name}`;
}

function optionId(entry: Entry): string {
  return stableIdentifier(OPTION_ID_PREFIX, entryKey(entry));
}

/// Cosa può stare in questa lista.
///
/// Discriminata e non tre liste parallele: la selezione è **un indice solo** —
/// le frecce ci scorrono sopra e l'invio ne sceglie una — e tre liste
/// vorrebbero dire tenere d'accordo un indice con un'aritmetica di confini, che
/// è la cosa che si sbaglia il giorno in cui se ne aggiunge una quarta.
type Entry =
  /// Una nota del vault, per path.
  | { k: "doc"; doc: string }
  /// Una ricerca fatta di recente: si ripesca per rifarla.
  | { k: "query"; q: string }
  /// La nota che non c'era, col nome che il testo cercato propone.
  | { k: "crea"; name: string };

/// Come si scioglie la trappola del fuoco, quando il modale è aperto.
let release: (() => void) | null = null;
let invalidate: (() => void) | null = null;

export function closeQuickSwitcher(): void {
  invalidate?.();
  invalidate = null;
  hidePreview();
  const overlay = document.getElementById(OVERLAY_ID);
  release?.();
  release = null;
  if (overlay) {
    overlay.querySelector(".palette-box")?.replaceChildren();
    exitSurface(overlay, () => overlay.remove());
  }
}

/// Il comando, dichiarato da chi ce l'ha (§18.2).
///
/// L'accordo è `Mod-o` e sta in `SHELL_KEYS` come tutti gli altri: è quello di
/// Obsidian, ed è libero in tutti e tre i registri che questa shell tiene — i
/// comandi di shell, le spec del kernel (la fixture della
/// [0081](../../../docs/decisions/0185-capability-un-solo-guard.md)) e la
/// keymap dell'editor, che è il terzo e che nessun presidio guarda ancora.
///
/// Qui parte anche la memoria corta: la mette in ascolto chi ha interesse, che è
/// questo pannello e nessun altro.
export function mountQuickSwitcher(
  open: (doc: string, mode: SwitcherOpenMode) => Promise<void> | void = (doc) => openDocument(doc),
): () => void {
  dispatchOpen = open;
  const stopRemembering = rememberOpens();
  registerShellCommand({
    id: "shell.switcher",
    title: "commands.switcher",
    description: "commands.switcher.desc",
    layer: "global",
    run: () => openQuickSwitcher(),
  });
  // **Cancellare la memoria**, e perché il comando è di *shell* e non del
  // registro dei comandi.
  //
  // Perché non ci potrebbe arrivare. Lo stato di vista è recintato per
  // proprietario e l'id di chi scrive **non è un parametro** — lo timbra la
  // porta di Rust (0037) — quindi un `search.history.clear` scritto in
  // `fub-features` non potrebbe toccare ciò che sta sotto `fub.shell` nemmeno
  // volendo. Il prezzo, dichiarato nella 0086, è che questo gesto non è
  // invocabile da CLI né da un'automazione: sta nella palette, come ogni
  // comando di shell, e nient'altro.
  //
  // È dichiarato qui perché la regola del §18.2 è che dichiara chi ha
  // interesse, e chi ha interesse alla memoria corta è questo pannello: è lui
  // che la mette in ascolto (`rememberOpens`) ed è lui che la mostra.
  registerShellCommand({
    id: "shell.history.clear",
    title: "commands.history_clear",
    description: "commands.history_clear.desc",
    layer: "global",
    run: () => {
      forgetAll();
      notify(t("history.cleared"), "info");
    },
  });
  return () => {
    stopRemembering();
    closeQuickSwitcher();
    if (dispatchOpen === open) dispatchOpen = (doc) => openDocument(doc);
  };
}

export function openQuickSwitcher(): void {
  const box = openOverlay();
  // `openOverlay` may reuse a node that is still animating out. Start with one
  // surface, otherwise the old input/list pair survives beside the new one.
  box.replaceChildren();

  const input = document.createElement("input");
  input.className = "palette-input";
  input.placeholder = t("switcher.placeholder");
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-label", t("switcher.title"));
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "true");
  input.setAttribute("aria-haspopup", "listbox");
  // Etichetta di scope esplicita (U13): non un generico "Cerca…", ma il nome
  // della superficie con i suoi effetti (aprire, non cercare nel testo).
  const scope = document.createElement("p");
  scope.className = "palette-desc";
  scope.id = `${OVERLAY_ID}-instructions`;
  const hint = platformSupports("multipleWindows") ? "switcher.actions_hint" : "switcher.actions_hint_single_window";
  scope.textContent = `${t("switcher.title")} · ${t(hint)}`;
  input.setAttribute("aria-describedby", scope.id);
  const list = document.createElement("ul");
  list.id = LIST_ID;
  list.className = "plain-list palette-list";
  // Come la palette dei comandi: una riga è «quella scelta» e le frecce la
  // spostano, quindi è una listbox — e dirlo è ciò che permette di sapere su
  // cosa si sta per premere Invio senza guardare lo sfondo.
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", t("switcher.title"));
  // La selezione resta sull'input; il popup non è una fermata del tab.
  list.tabIndex = -1;
  input.setAttribute("aria-controls", list.id);
  box.append(scope, input, list);

  let visibleItems: Entry[] = [];
  let selected = 0;
  let alive = true;
  // Come nella ricerca dentro la nota: una risposta lenta di una query vecchia
  // non deve sovrascrivere i risultati di una più recente. La corsa è di questo
  // esemplare della palette, non del modulo (decisione 0134).
  const race = new Race();
  let timer: number | undefined;
  invalidate = () => {
    alive = false;
    race.cancel();
    if (timer !== undefined) window.clearTimeout(timer);
    hidePreview();
  };

  const render = () => {
    list.replaceChildren();
    const newItems = document.createDocumentFragment();
    for (const [i, entry] of visibleItems.entries()) {
      const li = document.createElement("li");
      li.id = optionId(entry);
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === selected));
      // Riga nativa (C01): bottone vero invece di `li` attivo — omonimi con
      // titolo + percorso disambiguante (U14), shortcut reale assente qui
      // perché l'azione è aprire (nessuna stringa duplicata).
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-result";
      const title = document.createElement("span");
      title.className = "palette-title";
      const where = document.createElement("span");
      where.className = "palette-desc";
      if (entry.k === "doc") {
        // Il nome pagina davanti e il path sotto, come in una linguetta: due note
        // omonime in cartelle diverse sono il caso in cui il nome non basta, ed
        // è anche il caso in cui questa superficie serve di più.
        // Le parole scritte, segnate nel nome: si vede *perché* una nota è lì,
        // e fra tre omonime quale combacia meglio.
        title.append(markedTerms(pageName(entry.doc), input.value.trim()));
        where.textContent = entry.doc;
        setTooltip(button, entry.doc);
      } else if (entry.k === "query") {
        title.textContent = entry.q;
        where.textContent = t("switcher.recent_search");
      } else {
        title.textContent = entry.name;
        where.textContent = t("switcher.create");
      }
      button.append(title, where);
      button.addEventListener("click", (e) => active(entry, openMode(e)));
      if (entry.k === "doc") {
        // Anteprima read-only con lifecycle (F16/shell.preview.*): hover
        // 350 ms, modificatore = subito, uscita = teardown. Stessi verbi
        // della lettura, nessuna sessione, nessun dirty toccato.
        button.addEventListener("mouseenter", (e) => {
          schedulePreview(entry.doc, box, e.ctrlKey || e.metaKey);
        });
        button.addEventListener("focus", () => schedulePreview(entry.doc, box, false));
        button.addEventListener("mouseleave", cancelScheduledPreview);
        button.addEventListener("blur", cancelScheduledPreview);
      }
      li.append(button);
      newItems.appendChild(li);
    }
    if (visibleItems.length === 0) {
      const empty = document.createElement("li");
      empty.id = `${OPTION_ID_PREFIX}-empty`;
      empty.className = "palette-empty";
      empty.setAttribute("role", "option");
      empty.setAttribute("aria-disabled", "true");
      empty.setAttribute("aria-selected", "false");
      empty.textContent = t(input.value.trim() ? "switcher.empty" : "switcher.hint");
      newItems.appendChild(empty);
    }
    list.appendChild(newItems);
    if (visibleItems.length === 0) {
      input.removeAttribute("aria-activedescendant");
    } else {
      input.setAttribute("aria-activedescendant", optionId(visibleItems[selected]!));
    }
  };

  /// Cosa fa una voce quando la si sceglie, ed è **una cosa diversa per specie**.
  ///
  /// Una nota si apre; una ricerca recente **riempie la casella** invece di
  /// aprire qualcosa, che è ciò che uno si aspetta da una cronologia — la si
  /// ripesca per rifarla, non per finire dritto da qualche parte; una nota da
  /// creare si crea e si apre.
  const active = (entry: Entry, mode: SwitcherOpenMode = "here") => {
    // La scheda non sopravvive alla scelta: aprire chiude anche lei, mai
    // orfana senza il suo modale.
    hidePreview();
    if (entry.k === "doc") {
      // La ricerca che ha portato qui si ricorda **adesso**, non a ogni tasto:
      // la memoria è di ciò che si è cercato, e ciò che si è cercato è il testo
      // che ha prodotto un'apertura. Ricordare mentre si digita riempirebbe la
      // lista di «r», «ri», «riu».
      rememberSearch(input.value);
      open(entry.doc, mode);
      return;
    }
    if (entry.k === "query") {
      input.value = entry.q;
      input.focus();
      void search();
      return;
    }
    void create(entry.name);
  };

  const open = (doc: string, mode: SwitcherOpenMode = "here") => {
    closeQuickSwitcher();
    void Promise.resolve(dispatchOpen(doc, mode)).catch((error: unknown) => notify(errorText(error), "guasto"));
  };

  /// La nota che la ricerca non ha trovato.
  ///
  /// Il nome è già passato da `nomeDaCercato`, quindi qui non si ripulisce
  /// niente; e non si controlla se sia libero, perché lo sa solo il vault e il
  /// comando glielo chiede già — `note.create` usa `create_document`, che su un
  /// path occupato **fallisce** invece di sovrascrivere una nota. È un caso
  /// possibile anche a risultati vuoti, perché la ricerca combacia sul
  /// contenuto: una nota che si chiama come la query può esistere senza
  /// contenerla. Quando succede si mostra l'errore del kernel e il modale resta
  /// aperto, che è la sola risposta onesta — inventare un `nome (2)` sarebbe
  /// creare una seconda nota a chi ne stava cercando una.
  const create = async (name: string) => {
    rememberSearch(input.value);
    try {
      const doc = await createNote(name);
      if (doc && alive) open(doc);
    } catch (e) {
      notify(errorText(e), "guasto");
    }
  };

  const search = async () => {
    if (!alive) return;
    const text = input.value.trim();
    const result = await race.last(async (expected) => {
      // A mani vuote le note aperte di recente e le ricerche fatte di recente:
      // dove stanno scritte, e a quali condizioni, sta in `state/recenti.ts`.
      // Le note passano dal vault perché una rinominata non si può proporre;
      // una ricerca non è un oggetto del vault e non ha niente da verificare.
      //
      // L'errore diventa un valore prima del cancello: sotto non c'è nessun
      // `catch`, quindi non c'è dove perdere il segnale di scadenza.
      return expected(
        (text
          ? notesByName(text).then((d) => d.map((doc): Entry => ({ k: "doc", doc })))
          : existingRecentNotes().then((d) => [
              ...d.map((doc): Entry => ({ k: "doc", doc })),
              ...recentSearches().map((q): Entry => ({ k: "query", q })),
            ])
        )
          .then((found) => ({ found }))
          .catch((e: unknown) => ({ error: errorText(e) })),
      );
    });
    if (!alive || !result) return;
    if ("error" in result) {
      visibleItems = [];
      render();
      // Il motivo in chiaro, come nella ricerca: «non disponibile» dice che
      // non si può cercare, non perché.
      const empty = list.querySelector(".palette-empty");
      if (empty) {
        empty.textContent = t("search.unavailable");
        setTooltip(empty as HTMLElement, result.error);
      }
      return;
    }
    const found = result.found;
    visibleItems = found;
    // Il gesto che chiude il giro: non l'ho trovata, creala. Compare **solo**
    // a risultati vuoti — con dei risultati sotto gli occhi, «crea» è la voce
    // che si preme per sbaglio — e solo se dal testo esce un nome di nota
    // (`nomeDaCercato` risponde `null` a chi ha scritto solo spazi o solo
    // caratteri che in un nome non ci possono stare).
    if (text && found.length === 0) {
      const name = searchedName(text);
      if (name) visibleItems = [{ k: "crea", name }];
    }
    selected = 0;
    render();
  };

  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    // Lo stesso freno delle altre superfici che cercano mentre si digita: il
    // giro per battuta è piccolo (banco `una_ricerca.rs`, fase 5), ma «piccolo»
    // moltiplicato per ogni tasto di una parola lunga resta una raffica di cui
    // interessa solo l'ultimo.
    timer = window.setTimeout(() => void search(), 180);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (visibleItems.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      selected = (selected + step + visibleItems.length) % visibleItems.length;
      render();
      list.children[selected]?.scrollIntoView?.({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Maiusc+Invio crea la nota col nome scritto anche se qualcosa combacia:
      // cercare «Riunione» e trovare «Riunione di marzo» non vuol dire che
      // «Riunione» esista. La voce «crea» resta solo a risultati vuoti, dove
      // non si preme per sbaglio; qui il gesto è esplicito.
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const name = searchedName(input.value.trim());
        if (name) void create(name);
        return;
      }
      const entry = visibleItems[selected];
      if (entry && entry.k === "doc" && e.altKey) {
        hidePreview();
        void showStickyPreview(entry.doc, box);
        return;
      }
      if (entry) active(entry, openMode(e));
    } else if (e.key === "Escape") {
      // U16: Escape chiude la superficie appropriata, il focus resta dov'era
      // prima dell'apertura (lo rimette `trapFocus` sciogliendosi). Con una
      // scheda aperta, prima si chiude lei: mai orfana senza modale.
      hidePreview();
      closeQuickSwitcher();
    }
  });

  // Le recenti si mostrano subito: il modale si apre già con qualcosa sotto le
  // dita, che è metà del motivo per cui questa superficie si usa tanto.
  render();
  void search();
  input.focus();
}

function openOverlay(): HTMLElement {
  closeQuickSwitcher();
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    // La forma è quella delle altre due modali (§21.4): da quando le modali sono
    // più d'una, l'aspetto di una modale è un fatto della shell.
    overlay.className = "modale";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.tabIndex = -1;
    const box = document.createElement("div");
    box.className = "palette-box";
    overlay.appendChild(box);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) closeQuickSwitcher();
    });
    document.body.appendChild(overlay);
  }
  overlay.setAttribute("aria-label", t("switcher.title"));
  enterSurface(overlay);
  release = trapFocus(overlay, closeQuickSwitcher);
  return overlay.querySelector<HTMLElement>(".palette-box")!;
}

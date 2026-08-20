// **Il quick switcher** (FEATURES 8.1, §21.5): si preme una scorciatoia, si
// scrivono tre lettere, si apre una nota.
//
// È la superficie che si usa più della ricerca stessa, ed è la ragione per cui
// la §21.5 la nominava pur non avendola: nasce da sé — chiunque la scriva in
// mezz'ora la scrive su `list_documents` con un `includes()` — e quel giorno
// l'app avrebbe **due** ricerche, con la peggiore sulla strada più battuta.
// Quindi non nasce da sé: nasce sulla porta della
// [0082](../../../docs/decisions/0082-una-porta-per-chi-cerca.md), che è
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
// ([0086](../../../docs/decisions/0086-una-cronologia-e-la-sua-porta.md)): resta
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
import { activatable, trapFocus } from "../ui/a11y";
import { registerShellCommand } from "../ui/commands";
import { openDocument } from "./document";

const OVERLAY_ID = "quick-switcher";

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

export function closeQuickSwitcher(): void {
  document.getElementById(OVERLAY_ID)?.remove();
  release?.();
  release = null;
}

/// Il comando, dichiarato da chi ce l'ha (§18.2).
///
/// L'accordo è `Mod-o` e sta in `SHELL_KEYS` come tutti gli altri: è quello di
/// Obsidian, ed è libero in tutti e tre i registri che questa shell tiene — i
/// comandi di shell, le spec del kernel (la fixture della
/// [0081](../../../docs/decisions/0081-un-accordo-ha-un-proprietario.md)) e la
/// keymap dell'editor, che è il terzo e che nessun presidio guarda ancora.
///
/// Qui parte anche la memoria corta: la mette in ascolto chi ha interesse, che è
/// questo pannello e nessun altro.
export function mountQuickSwitcher(): void {
  rememberOpens();
  registerShellCommand({
    id: "shell.switcher",
    title: "commands.switcher",
    description: "commands.switcher.desc",
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
    run: () => {
      forgetAll();
      notify(t("history.cleared"), "info");
    },
  });
}

export function openQuickSwitcher(): void {
  const box = openOverlay();

  const input = document.createElement("input");
  input.className = "palette-input";
  input.placeholder = t("switcher.placeholder");
  input.setAttribute("aria-label", t("switcher.title"));
  const list = document.createElement("ul");
  list.className = "plain-list palette-list";
  // Come la palette dei comandi: una riga è «quella scelta» e le frecce la
  // spostano, quindi è una listbox — e dirlo è ciò che permette di sapere su
  // cosa si sta per premere Invio senza guardare lo sfondo.
  list.setAttribute("role", "listbox");
  box.append(input, list);

  let visibleItems: Entry[] = [];
  let selected = 0;
  // Come nella ricerca dentro la nota: una risposta lenta di una query vecchia
  // non deve sovrascrivere i risultati di una più recente. La corsa è di questo
  // esemplare della palette, non del modulo (decisione 0134).
  const race = new Race();
  let timer: number | undefined;

  const render = () => {
    list.innerHTML = "";
    const newItems = document.createDocumentFragment();
    for (const [i, entry] of visibleItems.entries()) {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === selected));
      const title = document.createElement("span");
      title.className = "palette-title";
      const where = document.createElement("span");
      where.className = "palette-desc";
      if (entry.k === "doc") {
        // Il nome pagina davanti e il path sotto, come in una linguetta: due note
        // omonime in cartelle diverse sono il caso in cui il nome non basta, ed
        // è anche il caso in cui questa superficie serve di più.
        title.textContent = pageName(entry.doc);
        where.textContent = entry.doc;
      } else if (entry.k === "query") {
        title.textContent = entry.q;
        where.textContent = t("switcher.recent_search");
      } else {
        title.textContent = entry.name;
        where.textContent = t("switcher.create");
      }
      li.append(title, where);
      li.addEventListener("click", () => active(entry));
      activatable(li);
      newItems.appendChild(li);
    }
    if (visibleItems.length === 0) {
      const empty = document.createElement("li");
      empty.className = "palette-empty";
      empty.textContent = t(input.value.trim() ? "switcher.empty" : "switcher.hint");
      newItems.appendChild(empty);
    }
    list.appendChild(newItems);
  };

  /// Cosa fa una voce quando la si sceglie, ed è **una cosa diversa per specie**.
  ///
  /// Una nota si apre; una ricerca recente **riempie la casella** invece di
  /// aprire qualcosa, che è ciò che uno si aspetta da una cronologia — la si
  /// ripesca per rifarla, non per finire dritto da qualche parte; una nota da
  /// creare si crea e si apre.
  const active = (entry: Entry) => {
    if (entry.k === "doc") {
      // La ricerca che ha portato qui si ricorda **adesso**, non a ogni tasto:
      // la memoria è di ciò che si è cercato, e ciò che si è cercato è il testo
      // che ha prodotto un'apertura. Ricordare mentre si digita riempirebbe la
      // lista di «r», «ri», «riu».
      rememberSearch(input.value);
      open(entry.doc);
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

  const open = (doc: string) => {
    closeQuickSwitcher();
    void openDocument(doc);
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
      if (doc) open(doc);
    } catch (e) {
      notify(errorText(e), "guasto");
    }
  };

  const search = async () => {
    const text = input.value.trim();
    await race.last(async (expected) => {
      // A mani vuote le note aperte di recente e le ricerche fatte di recente:
      // dove stanno scritte, e a quali condizioni, sta in `state/recenti.ts`.
      // Le note passano dal vault perché una rinominata non si può proporre;
      // una ricerca non è un oggetto del vault e non ha niente da verificare.
      //
      // L'errore diventa un valore prima del cancello: sotto non c'è nessun
      // `catch`, quindi non c'è dove perdere il segnale di scadenza.
      const result = await expected(
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
      if ("error" in result) {
        visibleItems = [];
        render();
        // Il motivo in chiaro, come nella ricerca: «non disponibile» dice che
        // non si può cercare, non perché.
        const empty = list.querySelector(".palette-empty");
        if (empty) {
          empty.textContent = t("search.unavailable");
          (empty as HTMLElement).title = result.error;
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
    });
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
      list.children[selected]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      const entry = visibleItems[selected];
      if (entry) active(entry);
    }
  });

  // Le recenti si mostrano subito: il modale si apre già con qualcosa sotto le
  // dita, che è metà del motivo per cui questa superficie si usa tanto.
  void search();
  input.focus();
}

function openOverlay(): HTMLElement {
  closeQuickSwitcher();
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  // La forma è quella delle altre due modali (§21.4): da quando le modali sono
  // più d'una, l'aspetto di una modale è un fatto della shell.
  overlay.className = "modale";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", t("switcher.title"));
  overlay.tabIndex = -1;
  const box = document.createElement("div");
  box.className = "palette-box";
  overlay.appendChild(box);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) closeQuickSwitcher();
  });
  document.body.appendChild(overlay);
  release = trapFocus(overlay, closeQuickSwitcher);
  return box;
}

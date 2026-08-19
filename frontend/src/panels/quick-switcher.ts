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
// La query. Sta in `host/contract.ts` (`nomeCercato`) e il giro sta in
// `host/query.ts` (`noteDalNome`), che è la regola della 0082 scritta come
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
import { noteDalNome } from "../host/query";
import { Corsa } from "../ui/corsa";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { notify } from "../ui/notify";
import { nomeDaCercato } from "../rules/nome-cercato";
import { pageName } from "../rules/organizer";
import {
  dimenticaTutto,
  noteRecentiEsistenti,
  ricercheRecenti,
  ricordaLeAperture,
  ricordaRicerca,
} from "../state/recenti";
import { createNote } from "../state/vault";
import { attivabile, intrappolaFuoco } from "../ui/a11y";
import { registerShellCommand } from "../ui/commands";
import { openDocument } from "./document";

const OVERLAY_ID = "quick-switcher";

/// Cosa può stare in questa lista.
///
/// Discriminata e non tre liste parallele: la selezione è **un indice solo** —
/// le frecce ci scorrono sopra e l'invio ne sceglie una — e tre liste
/// vorrebbero dire tenere d'accordo un indice con un'aritmetica di confini, che
/// è la cosa che si sbaglia il giorno in cui se ne aggiunge una quarta.
type Voce =
  /// Una nota del vault, per path.
  | { k: "doc"; doc: string }
  /// Una ricerca fatta di recente: si ripesca per rifarla.
  | { k: "query"; q: string }
  /// La nota che non c'era, col nome che il testo cercato propone.
  | { k: "crea"; nome: string };

/// Come si scioglie la trappola del fuoco, quando il modale è aperto.
let sciogli: (() => void) | null = null;

export function chiudiQuickSwitcher(): void {
  document.getElementById(OVERLAY_ID)?.remove();
  sciogli?.();
  sciogli = null;
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
  ricordaLeAperture();
  registerShellCommand({
    id: "shell.switcher",
    title: "commands.switcher",
    description: "commands.switcher.desc",
    run: () => apriQuickSwitcher(),
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
  // che la mette in ascolto (`ricordaLeAperture`) ed è lui che la mostra.
  registerShellCommand({
    id: "shell.history.clear",
    title: "commands.history_clear",
    description: "commands.history_clear.desc",
    run: () => {
      dimenticaTutto();
      notify(t("history.cleared"), "info");
    },
  });
}

export function apriQuickSwitcher(): void {
  const box = apriOverlay();

  const input = document.createElement("input");
  input.className = "palette-input";
  input.placeholder = t("switcher.placeholder");
  input.setAttribute("aria-label", t("switcher.title"));
  const lista = document.createElement("ul");
  lista.className = "plain-list palette-list";
  // Come la palette dei comandi: una riga è «quella scelta» e le frecce la
  // spostano, quindi è una listbox — e dirlo è ciò che permette di sapere su
  // cosa si sta per premere Invio senza guardare lo sfondo.
  lista.setAttribute("role", "listbox");
  box.append(input, lista);

  let visibili: Voce[] = [];
  let scelto = 0;
  // Come nella ricerca dentro la nota: una risposta lenta di una query vecchia
  // non deve sovrascrivere i risultati di una più recente. La corsa è di questo
  // esemplare della palette, non del modulo (decisione 0134).
  const corsa = new Corsa();
  let timer: number | undefined;

  const disegna = () => {
    lista.innerHTML = "";
    const nuove = document.createDocumentFragment();
    for (const [i, voce] of visibili.entries()) {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(i === scelto));
      const titolo = document.createElement("span");
      titolo.className = "palette-title";
      const dove = document.createElement("span");
      dove.className = "palette-desc";
      if (voce.k === "doc") {
        // Il nome pagina davanti e il path sotto, come in una tab: due note
        // omonime in cartelle diverse sono il caso in cui il nome non basta, ed
        // è anche il caso in cui questa superficie serve di più.
        titolo.textContent = pageName(voce.doc);
        dove.textContent = voce.doc;
      } else if (voce.k === "query") {
        titolo.textContent = voce.q;
        dove.textContent = t("switcher.recent_search");
      } else {
        titolo.textContent = voce.nome;
        dove.textContent = t("switcher.create");
      }
      li.append(titolo, dove);
      li.addEventListener("click", () => attiva(voce));
      attivabile(li);
      nuove.appendChild(li);
    }
    if (visibili.length === 0) {
      const vuoto = document.createElement("li");
      vuoto.className = "palette-empty";
      vuoto.textContent = t(input.value.trim() ? "switcher.empty" : "switcher.hint");
      nuove.appendChild(vuoto);
    }
    lista.appendChild(nuove);
  };

  /// Cosa fa una voce quando la si sceglie, ed è **una cosa diversa per specie**.
  ///
  /// Una nota si apre; una ricerca recente **riempie la casella** invece di
  /// aprire qualcosa, che è ciò che uno si aspetta da una cronologia — la si
  /// ripesca per rifarla, non per finire dritto da qualche parte; una nota da
  /// creare si crea e si apre.
  const attiva = (voce: Voce) => {
    if (voce.k === "doc") {
      // La ricerca che ha portato qui si ricorda **adesso**, non a ogni tasto:
      // la memoria è di ciò che si è cercato, e ciò che si è cercato è il testo
      // che ha prodotto un'apertura. Ricordare mentre si digita riempirebbe la
      // lista di «r», «ri», «riu».
      ricordaRicerca(input.value);
      apri(voce.doc);
      return;
    }
    if (voce.k === "query") {
      input.value = voce.q;
      input.focus();
      void cerca();
      return;
    }
    void crea(voce.nome);
  };

  const apri = (doc: string) => {
    chiudiQuickSwitcher();
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
  const crea = async (nome: string) => {
    ricordaRicerca(input.value);
    try {
      const doc = await createNote(nome);
      if (doc) apri(doc);
    } catch (e) {
      notify(errorText(e), "guasto");
    }
  };

  const cerca = async () => {
    const testo = input.value.trim();
    await corsa.ultimo(async (atteso) => {
      // A mani vuote le note aperte di recente e le ricerche fatte di recente:
      // dove stanno scritte, e a quali condizioni, sta in `state/recenti.ts`.
      // Le note passano dal vault perché una rinominata non si può proporre;
      // una ricerca non è un oggetto del vault e non ha niente da verificare.
      //
      // L'errore diventa un valore prima del cancello: sotto non c'è nessun
      // `catch`, quindi non c'è dove perdere il segnale di scadenza.
      const esito = await atteso(
        (testo
          ? noteDalNome(testo).then((d) => d.map((doc): Voce => ({ k: "doc", doc })))
          : noteRecentiEsistenti().then((d) => [
              ...d.map((doc): Voce => ({ k: "doc", doc })),
              ...ricercheRecenti().map((q): Voce => ({ k: "query", q })),
            ])
        )
          .then((trovate) => ({ trovate }))
          .catch((e: unknown) => ({ errore: errorText(e) })),
      );
      if ("errore" in esito) {
        visibili = [];
        disegna();
        // Il motivo in chiaro, come nella ricerca: «non disponibile» dice che
        // non si può cercare, non perché.
        const vuoto = lista.querySelector(".palette-empty");
        if (vuoto) {
          vuoto.textContent = t("search.unavailable");
          (vuoto as HTMLElement).title = esito.errore;
        }
        return;
      }
      const trovate = esito.trovate;
      visibili = trovate;
      // Il gesto che chiude il giro: non l'ho trovata, creala. Compare **solo**
      // a risultati vuoti — con dei risultati sotto gli occhi, «crea» è la voce
      // che si preme per sbaglio — e solo se dal testo esce un nome di nota
      // (`nomeDaCercato` risponde `null` a chi ha scritto solo spazi o solo
      // caratteri che in un nome non ci possono stare).
      if (testo && trovate.length === 0) {
        const nome = nomeDaCercato(testo);
        if (nome) visibili = [{ k: "crea", nome }];
      }
      scelto = 0;
      disegna();
    });
  };

  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    // Lo stesso freno delle altre superfici che cercano mentre si digita: il
    // giro per battuta è piccolo (banco `una_ricerca.rs`, fase 5), ma «piccolo»
    // moltiplicato per ogni tasto di una parola lunga resta una raffica di cui
    // interessa solo l'ultimo.
    timer = window.setTimeout(() => void cerca(), 180);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (visibili.length === 0) return;
      const passo = e.key === "ArrowDown" ? 1 : -1;
      scelto = (scelto + passo + visibili.length) % visibili.length;
      disegna();
      lista.children[scelto]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      const voce = visibili[scelto];
      if (voce) attiva(voce);
    }
  });

  // Le recenti si mostrano subito: il modale si apre già con qualcosa sotto le
  // dita, che è metà del motivo per cui questa superficie si usa tanto.
  void cerca();
  input.focus();
}

function apriOverlay(): HTMLElement {
  chiudiQuickSwitcher();
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
    if (e.target === overlay) chiudiQuickSwitcher();
  });
  document.body.appendChild(overlay);
  sciogli = intrappolaFuoco(overlay, chiudiQuickSwitcher);
  return box;
}

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
// Le note aperte di recente (`state/recenti.ts`), come in Obsidian: una
// scorciatoia premuta deve mostrare **qualcosa**, e le prime venti note del
// vault in ordine di path non sono qualcosa — sono un elenco arbitrario che
// costringe comunque a scrivere. La memoria corta vive quanto la finestra: una
// cronologia che resta è materia della §21.7 e del capitolo 23, e questa voce
// non la anticipa.
import { noteDalNome } from "../host/query";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { pageName } from "../rules/organizer";
import { noteRecentiEsistenti, ricordaLeAperture } from "../state/recenti";
import { attivabile, intrappolaFuoco } from "../ui/a11y";
import { registerShellCommand } from "../ui/commands";
import { openDocument } from "./document";

const OVERLAY_ID = "quick-switcher";

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
}

export function apriQuickSwitcher(): void {
  const box = apriOverlay();

  const input = document.createElement("input");
  input.className = "palette-input";
  input.placeholder = t("switcher.placeholder");
  input.setAttribute("aria-label", t("switcher.title"));
  const lista = document.createElement("ul");
  lista.className = "palette-list";
  box.append(input, lista);

  let visibili: string[] = [];
  let scelto = 0;
  // Come nella ricerca dentro la nota: una risposta lenta di una query vecchia
  // non deve sovrascrivere i risultati di una più recente.
  let seq = 0;
  let timer: number | undefined;

  const disegna = () => {
    lista.innerHTML = "";
    const nuove = document.createDocumentFragment();
    for (const [i, doc] of visibili.entries()) {
      const li = document.createElement("li");
      li.classList.toggle("selected", i === scelto);
      const titolo = document.createElement("span");
      titolo.className = "palette-title";
      // Il nome pagina davanti e il path sotto, come in una tab: due note
      // omonime in cartelle diverse sono il caso in cui il nome non basta, ed è
      // anche il caso in cui questa superficie serve di più.
      titolo.textContent = pageName(doc);
      const dove = document.createElement("span");
      dove.className = "palette-desc";
      dove.textContent = doc;
      li.append(titolo, dove);
      li.addEventListener("click", () => apri(doc));
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

  const apri = (doc: string) => {
    chiudiQuickSwitcher();
    void openDocument(doc);
  };

  const cerca = async () => {
    const testo = input.value.trim();
    const mio = ++seq;
    try {
      // A mani vuote le recenti, ma passate dal vault: perché, e perché la
      // domanda è una sola, sta in `state/recenti.ts`.
      const trovate = testo ? await noteDalNome(testo) : await noteRecentiEsistenti();
      if (mio !== seq) return;
      visibili = trovate;
      scelto = 0;
      disegna();
    } catch (e) {
      if (mio !== seq) return;
      visibili = [];
      disegna();
      // Il motivo in chiaro, come nella ricerca: «non disponibile» dice che non
      // si può cercare, non perché.
      const vuoto = lista.querySelector(".palette-empty");
      if (vuoto) {
        vuoto.textContent = t("search.unavailable");
        (vuoto as HTMLElement).title = errorText(e);
      }
    }
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
      const doc = visibili[scelto];
      if (doc) apri(doc);
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

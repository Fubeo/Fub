// Il pannello della ricerca: la barra, il debounce, i risultati.
import type { DocumentMatch, Span } from "../host/contract";
import { textQuery } from "../host/contract";
import { matchingDocuments, vaultStatus } from "../host/query";
import { pageName } from "../rules/organizer";
import { rowsToShow } from "../rules/results";
import { $ } from "../ui/dom";
import { setTooltip } from "../ui/tooltip";
import { refreshOn, registerPanel } from "../ui/panel-host";
import { openDocument, revealByteOffset } from "./document";
import { isPanelVisible, showPanel } from "./sidebar";
import { errorText } from "../host/errors";
import { activatable } from "../ui/a11y";
import { t } from "../i18n/strings";
import { searchedName } from "../rules/searched-name";
import { rememberSearch } from "../state/recent";
import { createNote } from "../state/vault";
import { notify } from "../ui/notify";
import { Race } from "../ui/race";

const searchInputEl = $<HTMLInputElement>("#search-input");
const searchSummaryEl = $("#search-summary");
const searchResultsEl = $("#search-results");

let searchTimer: number | undefined;
/// Una risposta lenta di una query vecchia non deve sovrascrivere i risultati di
/// una più recente. Il contatore scritto a mano che stava qui è diventato il
/// tipo di `ui/race.ts` (decisione 0134), che questo pannello usava già in
/// tutt'e tre i modi: un giro per ricerca, il controllo anche nel ramo
/// d'errore, e l'annullamento a mani vuote.
const race = new Race();

export function mountSearch(): void {
  searchInputEl.addEventListener("input", scheduleSearch);
  searchInputEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") clearSearch();
  });
  // Risultati aperti su un vault che è cambiato: rifarli, non lasciarli
  // invecchiare sotto gli occhi di chi legge. Dentro un lotto (decisione 0011)
  // `index_updated` non arriva — arriva `batch_ended` — e chi reagisce
  // a uno deve reagire a entrambi, o dopo una rinomina con backlink la
  // ricerca resta ferma. `overflow` non si dichiara: lo tratta l'host,
  // riconciliando tutti i pannelli da zero.
  registerPanel({
    id: "shell:search",
    title: "Risultati",
    placement: "left_sidebar",
    refresh: refreshOn("index_updated", "batch_ended"),
    visible: () => isPanelVisible("search"),
    render: scheduleSearch,
  });
}

function scheduleSearch(): void {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void runSearch(), 180);
}

export function clearSearch(): void {
  window.clearTimeout(searchTimer);
  searchInputEl.value = "";
  // I giri in volo scadono anche qui: una risposta già in volo non deve
  // ripopolare un pannello che l'utente ha appena chiuso.
  race.cancel();
  showPanel("files");
  searchResultsEl.innerHTML = "";
}

/// Avvia una ricerca da fuori (il click su un tag, `ViewUpdate::RunSearch`, un
/// `CommandEffect::RunSearch`): riempie la barra e usa lo stesso giro
/// dell'utente, invece di una seconda strada che diverge.
export function searchFor(query: string): void {
  searchInputEl.value = query;
  void runSearch();
}

async function runSearch(): Promise<void> {
  const query = searchInputEl.value.trim();
  if (!query) {
    clearSearch();
    return;
  }
  await race.last(async (expected) => {
    // Ciò che l'utente digita è **testo cercato**, non una sintassi: la stringa
    // è il campo di una foglia, e non c'è più un parser di terzi che possa
    // rifiutarla a metà parola (§5.3).
    //
    // E l'ultimo termine è **incompleto**: questa casella cerca mentre si
    // digita, quindi `arch` deve trovare *architettura* prima che la parola sia
    // finita (§21.2). Lo dice la query, non un `*` appeso qui: la lingua è una
    // sola per la casella, la CLI, l'API locale e le automazioni.
    //
    // **L'errore diventa un valore prima del cancello.** Resta il caso in cui
    // nessuno serve la ricerca — un vault aperto senza indice full-text — ed è
    // una mancanza, non zero risultati, quindi va detta; ma dirla è una
    // scrittura come le altre, e passa dallo stesso `atteso` dei risultati
    // invece di essere un secondo posto in cui ricordarsi il controllo. Un
    // `try` attorno all'`atteso` ingoierebbe la scadenza insieme all'errore.
    const result = await expected(
      matchingDocuments(textQuery(query, true), { offset: 0, limit: 50 })
        .then((p) => ({ hits: p.items }))
        .catch((e: unknown) => ({ error: errorText(e) })),
    );
    if ("error" in result) {
      showSearchResults([], result.error);
      return;
    }
    const hits: DocumentMatch[] = result.hits;

    // **Zero risultati mentre il vault indicizza non è «niente trovato»** (§15.7).
    // Un vault si apre in due tempi: appena scansionato è utilizzabile, e la
    // ricerca si popola dopo. Nei primi secondi di un vault grande la risposta
    // vera è *non lo so ancora*, e disegnarla come una risposta negativa
    // manderebbe a cercare altrove chi aveva cercato bene.
    //
    // Lo si chiede **solo quando la risposta è vuota**: è l'unico caso in cui la
    // distinzione cambia cosa si scrive, e a ogni tasto premuto su una ricerca
    // che trova non si paga niente.
    let partial = false;
    if (hits.length === 0) {
      // Lo stato del vault è una **rifinitura del messaggio**: se non si riesce
      // a chiederlo, si dice «nessun risultato» come si è sempre fatto. Un
      // errore qui non deve togliere all'utente i risultati che ha.
      partial = await expected(
        vaultStatus()
          .then((s) => s.indexing === "running")
          .catch(() => false),
      );
    }
    showSearchResults(hits, null, partial);
  });
}

function showSearchResults(
  hits: DocumentMatch[],
  error: string | null,
  indexing = false,
): void {
  showPanel("search");
  // Il conteggio è un **argomento**, non una parola declinata: «1 risultato»
  // e «2 risultati» erano due rami di un ternario, che è la forma che una
  // lingua con tre plurali non può scrivere. Vale qui come vale in Rust, dove
  // il motore dei template non sceglie una forma plurale (§12.4).
  searchSummaryEl.textContent = error
    ? t("search.unavailable")
    : hits.length === 0
      ? indexing
        ? t("search.indexing")
        : t("search.empty")
      : t("search.count", { count: hits.length });

  searchResultsEl.innerHTML = "";
  // Le righe si montano **fuori dal documento** e si attaccano in una volta
  // sola. Non è cosmetica: una pagina di cinquanta note con le loro occorrenze
  // sono qualche migliaio di `<li>`, e attaccarli uno per uno a una lista che è
  // già nella pagina vuol dire chiedere al motore di rifare i conti del layout
  // qualche migliaio di volte — a ogni tasto premuto, perché questo pannello si
  // ridisegna mentre si scrive.
  const newItems = document.createDocumentFragment();
  for (const row of rowsToShow(hits)) {
    const li = document.createElement("li");
    setTooltip(li, row.doc);
    if (row.occurrence === undefined) {
      const title = document.createElement("span");
      title.className = "hit-title";
      title.textContent = pageName(row.doc);

      const snippet = document.createElement("span");
      snippet.className = "hit-snippet";
      snippet.appendChild(highlighted(row.snippet ?? "", row.highlights ?? []));
      li.append(title, snippet);
    } else {
      li.className = "hit-occurrence";
      li.textContent = t("search.occurrence", { n: row.occurrence });
    }
    openAt(li, row.doc, row.byteOffset);
    newItems.appendChild(li);
  }
  // **Non l'ho trovata, creala** (§21.7): il gesto che chiude il giro in
  // omnisearch. Solo a mani davvero vuote — non mentre il vault indicizza, dove
  // la risposta è *non lo so ancora*, e non su un errore, dove non si è cercato
  // affatto — e solo se dal testo esce un nome di nota: `nomeDaCercato` risponde
  // `null` a chi ha scritto solo spazi o solo caratteri che in un nome non ci
  // possono stare, e allora il gesto non si offre.
  //
  // Il nome non è la query così com'è, e la ragione sta in
  // `rules/nome-cercato.ts`: `note.create` prende un **path**, quindi uno slash
  // cercato creerebbe una cartella che nessuno ha chiesto.
  if (!error && hits.length === 0 && !indexing) {
    const name = searchedName(searchInputEl.value);
    if (name) newItems.appendChild(createRow(name));
  }
  searchResultsEl.appendChild(newItems);
}

/// La riga «crea questa nota».
///
/// Non si controlla se il nome sia **libero**: lo sa solo il vault, e il comando
/// glielo chiede già — `note.create` usa `create_document`, che su un path
/// occupato fallisce invece di sovrascrivere. È un caso possibile anche a
/// risultati vuoti, perché la ricerca combacia sul **contenuto**: una nota che
/// si chiama come la query può esistere senza contenerla. Quando succede si
/// mostra l'errore del kernel, che è la sola risposta onesta — inventare un
/// `nome (2)` sarebbe creare una seconda nota a chi ne stava cercando una.
function createRow(name: string): HTMLElement {
  const li = document.createElement("li");
  li.className = "hit-create";
  const title = document.createElement("span");
  title.className = "hit-title";
  title.textContent = name;
  const desc = document.createElement("span");
  desc.className = "hit-snippet";
  desc.textContent = t("search.create");
  li.append(title, desc);
  li.addEventListener("click", () => {
    rememberSearch(searchInputEl.value);
    void createNote(name)
      .then((doc) => {
        if (doc) void openDocument(doc);
      })
      .catch((e: unknown) => notify(errorText(e), "guasto"));
  });
  activatable(li);
  return li;
}

/// Cliccare (o attivare da tastiera) apre il documento e, se c'è un punto, ci
/// porta il cursore.
///
/// L'offset è in **byte UTF-8** — la valuta di ogni span del modello — e la
/// conversione a posizione dell'editor la fa `revealByteOffset`, la stessa che
/// usano l'outline e `ViewUpdate::Reveal`: la ricerca era l'unico cliente
/// naturale di quel giro e non aveva le coordinate da passargli.
function openAt(el: HTMLElement, doc: string, byteOffset?: number): void {
  el.addEventListener("click", () => {
    // La ricerca si ricorda **qui**, non a ogni tasto: questa casella interroga
    // mentre si digita, e una cronologia alimentata da lì si riempirebbe di
    // «r», «ri», «riu». Ciò che vale la pena ricordare è il testo che ha
    // prodotto un'apertura, cioè una ricerca **conclusa** (0086).
    rememberSearch(searchInputEl.value);
    void openDocument(doc).then(() => {
      if (byteOffset !== undefined) revealByteOffset(byteOffset);
    });
  });
  // Un risultato di ricerca si apre col mouse e adesso anche col linguetta: era una
  // `<li>` con un `click` sopra, cioè — per chi non usa il mouse — testo.
  activatable(el);
}

/// Lo snippet con le porzioni evidenziate, come nodi DOM.
///
/// Due invarianti in una funzione sola:
/// - il testo del provider entra **solo** come `textContent`/nodo di testo, mai
///   come HTML: un provider non può iniettare markup (vedi `DocumentMatch`);
/// - gli offset arrivano in **byte UTF-8** (è la valuta degli `Span` in tutto
///   il modello) mentre le stringhe JS sono UTF-16: si taglia sui byte e si
///   decodifica, invece di fingere che gli indici coincidano — con l'italiano
///   accentato non coinciderebbero quasi mai.
function highlighted(snippet: string, highlights: Span[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const bytes = new TextEncoder().encode(snippet);
  const decoder = new TextDecoder();
  let pos = 0;
  for (const h of highlights) {
    if (h.start < pos || h.end > bytes.length || h.start >= h.end) continue;
    frag.append(decoder.decode(bytes.subarray(pos, h.start)));
    const mark = document.createElement("mark");
    mark.textContent = decoder.decode(bytes.subarray(h.start, h.end));
    frag.append(mark);
    pos = h.end;
  }
  frag.append(decoder.decode(bytes.subarray(pos)));
  return frag;
}

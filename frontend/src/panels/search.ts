// Il pannello della ricerca: la barra, il debounce, i risultati.
import type { DocumentMatch, Span } from "../host/contract";
import { testoCercato } from "../host/contract";
import { documentiCheCombaciano } from "../host/query";
import { pageName } from "../rules/organizer";
import { $ } from "../ui/dom";
import { refreshOn, registerPanel } from "../ui/panel-host";
import { openDocument } from "./document";
import { isPanelVisible, showPanel } from "./sidebar";

const searchInputEl = $<HTMLInputElement>("#search-input");
const searchSummaryEl = $("#search-summary");
const searchResultsEl = $("#search-results");

let searchTimer: number | undefined;
/// Ogni ricerca porta il proprio numero d'ordine: una risposta lenta di una
/// query vecchia non deve sovrascrivere i risultati di una più recente.
let searchSeq = 0;

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
  // Il numero d'ordine avanza anche qui: una risposta già in volo non deve
  // ripopolare un pannello che l'utente ha appena chiuso.
  searchSeq++;
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
  const seq = ++searchSeq;
  let hits: DocumentMatch[];
  try {
    // Ciò che l'utente digita è **testo cercato**, non una sintassi: la stringa
    // è il campo di una foglia, e non c'è più un parser di terzi che possa
    // rifiutarla a metà parola (§5.3).
    hits = (await documentiCheCombaciano(testoCercato(query), { offset: 0, limit: 50 })).items;
  } catch (e) {
    // Resta il caso in cui **nessuno** serve la ricerca: un vault aperto senza
    // indice full-text. È una mancanza, non zero risultati, e va detta.
    if (seq === searchSeq) showSearchResults([], String(e));
    return;
  }
  if (seq !== searchSeq) return;
  showSearchResults(hits, null);
}

function showSearchResults(hits: DocumentMatch[], error: string | null): void {
  showPanel("search");
  searchSummaryEl.textContent = error
    ? "Ricerca non disponibile"
    : hits.length === 0
      ? "Nessun risultato"
      : `${hits.length} risultat${hits.length === 1 ? "o" : "i"}`;

  searchResultsEl.innerHTML = "";
  for (const hit of hits) {
    const li = document.createElement("li");
    li.title = hit.doc;

    const title = document.createElement("span");
    title.className = "hit-title";
    title.textContent = pageName(hit.doc);

    const snippet = document.createElement("span");
    snippet.className = "hit-snippet";
    snippet.appendChild(highlighted(hit.snippet ?? "", hit.highlights ?? []));

    li.append(title, snippet);
    li.addEventListener("click", () => void openDocument(hit.doc));
    searchResultsEl.appendChild(li);
  }
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

// Il pannello della ricerca: la barra, il debounce, i risultati.
import type { DocumentMatch, Span } from "../host/contract";
import { matchingDocuments, SearchSyntaxError, searchExpression, vaultStatus } from "../host/query";
import { pageName } from "../rules/organizer";
import { rowsToShow } from "../rules/results";
import { $ } from "../ui/dom";
import { setTooltip } from "../ui/tooltip";
import { refreshOn, registerPanel, unregisterPanel } from "../ui/panel-host";
import { openDocument, reveal } from "./document";
import { isPanelVisible, showPanel } from "./sidebar";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";
import { searchedName } from "../rules/searched-name";
import { rememberSearch } from "../state/recent";
import { createNote } from "../state/vault";
import { notify } from "../ui/notify";
import { Race } from "../ui/race";
import { on } from "../state/store";
import type { Lifetime } from "../ui/lifetime";
import { ClipboardUnavailable, writeClipboardText } from "../platform/clipboard";

const searchInputEl = $<HTMLInputElement>("#search-input");
const searchSummaryEl = $("#search-summary");
const searchResultsEl = $("#search-results");
/// Finestra del disegno: quante righe si chiedono al kernel per volta. La forma
/// delle righe resta in `rules/results.ts`; qui si decide solo il tetto.
const SEARCH_PAGE = 50;
const excluded = new Set<string>();
const excludedFolders = new Set<string>();
let shownHits: DocumentMatch[] = [];
let searchTimer: number | undefined;
/// Una risposta lenta di una query vecchia non deve sovrascrivere i risultati di
/// una più recente. Il contatore scritto a mano che stava qui è diventato il
/// tipo di `ui/race.ts` (decisione 0134), che questo pannello usava già in
/// tutt'e tre i modi: un giro per ricerca, il controllo anche nel ramo
/// d'errore, e l'annullamento a mani vuote.
const race = new Race();
/// La query del vault **di questa sessione**: aprire un risultato non la azzera
/// (U17) e cambiarla non tocca quella di un altro vault (R07: il cambio vault
/// passa da `clearSearch`, non da una memoria condivisa).
export function mountSearch(lifetime: Lifetime): void {
  // Le esclusioni restano mentre si affina la query: si vedono come etichette
  // sopra i risultati e si tolgono una per una (o tutte con Esc).
  lifetime.listen(searchInputEl, "input", () => scheduleSearch());
  lifetime.listen(searchInputEl, "keydown", (e) => {
    // La casella ha i suoi tasti, e sono questi: Invio apre il primo risultato,
    // Escape pulisce l'input e resta nel campo. La navigazione completa della
    // lista (Frecce/Enter/Esc) vive sulla lista, che è una listbox.
    if (e.key === "Enter") {
      e.preventDefault();
      // Una battuta ancora in attesa del debounce: prima si cerca il testo che
      // c'è, poi si apre il suo primo risultato — non quello della query di prima.
      if (searchTimer !== undefined) {
        window.clearTimeout(searchTimer);
        searchTimer = undefined;
        void runSearch().then(openFirstResult);
      } else {
        openFirstResult();
      }
    } else if (e.key === "Escape") {
      searchInputEl.value = "";
      excluded.clear();
      excludedFolders.clear();
      race.cancel();
      searchResultsEl.innerHTML = "";
      searchSummaryEl.textContent = "";
      drawExclusions();
    }
  });
  wireSearchListKeys(lifetime);
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
  // Cambio vault (R07): la query non si eredita — si azzera input e risultati,
  // senza forzare i file se l'utente stava guardando una view dichiarata.
  lifetime.add(on("vault", clearSearchState));
  lifetime.add(() => {
    window.clearTimeout(searchTimer);
    race.cancel();
    searchResultsEl.replaceChildren();
    shownHits = [];
    unregisterPanel("shell:search");
  });
}

function scheduleSearch(): void {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    searchTimer = undefined;
    void runSearch();
  }, 180);
}

/// Azzera input e risultati senza toccare il pannello mostrato: il cambio
/// vault non eredita la query del vault precedente (R07), ma non chiude
/// arbitrariamente una view ancora valida — `syncRail` decide cosa mostrare.
function clearSearchState(): void {
  window.clearTimeout(searchTimer);
  searchInputEl.value = "";
  excluded.clear();
  excludedFolders.clear();
  shownHits = [];
  race.cancel();
  searchResultsEl.innerHTML = "";
  searchSummaryEl.textContent = "";
}

export function clearSearch(): void {
  clearSearchState();
  showPanel("files");
}

/// Avvia una ricerca da fuori (il click su un tag, `ViewUpdate::RunSearch`, un
/// `CommandEffect::RunSearch`): riempie la barra e usa lo stesso giro
/// dell'utente, invece di una seconda strada che diverge.
export function searchFor(query: string): void {
  excluded.clear();
  excludedFolders.clear();
  searchInputEl.value = query;
  void runSearch();
}

/// Stati distinti (U15): iniziale (casella vuota), caricamento (solo se la
/// risposta tarda), risultati, zero risultati, indicizzazione, errore — mai
/// l'errore travestito da zero risultati. Le risposte obsolete le scarta `Race`.
/// Conteggi limitati con `search.count_limited` {shown, total} e `search.more`.
type ChiaveP8 = "search.loading" | "search.count_limited" | "search.more";
function testoP8(chiave: ChiaveP8, mostrati = 0, totale = 0): string {
  switch (chiave) {
    case "search.loading":
      return t("search.loading");
    case "search.count_limited":
      return t("search.count_limited", { shown: mostrati, total: totale });
    case "search.more":
      return t("search.more", { shown: mostrati, total: totale });
  }
}
async function runSearch(): Promise<void> {
  const query = searchInputEl.value.trim();
  drawExclusions();
  if (!query) {
    race.cancel();
    searchResultsEl.innerHTML = "";
    searchSummaryEl.textContent = "";
    return;
  }
  // Una sintassi a metà (`tag:` senza valore, una virgoletta aperta) è lo
  // stato normale di chi sta scrivendo, non un guasto: lo si dice nel
  // riepilogo e i risultati di prima restano dove sono.
  let expression: ReturnType<typeof searchExpression>;
  try {
    expression = searchExpression(query, [...excluded], [...excludedFolders]);
  } catch (error) {
    if (error instanceof SearchSyntaxError) {
      race.cancel();
      searchSummaryEl.textContent = t("search.syntax_incomplete", { reason: error.message });
      return;
    }
    showSearchResults([], errorText(error), false, 0);
    return;
  }
  // Caricamento: si mostra solo se il giro è ancora l'ultimo dopo 180ms, così
  // una risposta rapida non lampeggia.
  const slow = window.setTimeout(() => {
    if (searchInputEl.value.trim() === query) {
      searchSummaryEl.textContent = testoP8("search.loading");
      showPanel("search");
    }
  }, 180);
  await race.last(async (expected) => {
    try {
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
      type SearchPage = { items: DocumentMatch[]; total: number };
      type SearchFailure = { error: string };
      const isFailure = (v: SearchPage | SearchFailure): v is SearchFailure => "error" in v;
      const page = await expected(
        Promise.resolve()
          .then(() => matchingDocuments(expression, { offset: 0, limit: SEARCH_PAGE }))
          .catch((e: unknown): SearchFailure => ({ error: errorText(e) })),
      );
      if (isFailure(page)) {
        showSearchResults([], page.error, false, 0);
        return;
      }
      const hits: DocumentMatch[] = page.items;
      const total = page.total;

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
      showSearchResults(hits, null, partial, total);
    } finally {
      window.clearTimeout(slow);
    }
  });
}

function showSearchResults(
  hits: DocumentMatch[],
  error: string | null,
  indexing = false,
  total = hits.length,
): void {
  showPanel("search");
  // Il conteggio è un **argomento**, non una parola declinata: «1 risultato»
  // e «2 risultati» erano due rami di un ternario, che è la forma che una
  // lingua con tre plurali non può scrivere. Vale qui come vale in Rust, dove
  // il motore dei template non sceglie una forma plurale (§12.4).
  //
  // L'errore non è mai zero risultati (U15): ha testo suo e azione Riprova.
  // Il totale oltre la finestra non si tace (U12): si dice quante restano.
  if (error) {
    searchSummaryEl.textContent = t("search.unavailable");
    searchResultsEl.innerHTML = "";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "search-result";
    retry.textContent = `${error} · ${t("app.retry")}`;
    retry.addEventListener("click", () => void runSearch());
    const li = document.createElement("li");
    li.appendChild(retry);
    searchResultsEl.appendChild(li);
    setTooltip(searchSummaryEl, error);
    return;
  }
  searchSummaryEl.textContent =
    hits.length === 0
      ? indexing
        ? t("search.indexing")
        : t("search.empty")
      : total > hits.length
        ? testoP8("search.count_limited", hits.length, total)
        : t("search.count", { count: hits.length });

  searchResultsEl.innerHTML = "";
  shownHits = hits;
  const tools = document.createElement("li");
  tools.className = "search-tools";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "search-action";
  copy.textContent = t("search.copy_visible");
  copy.addEventListener("click", () => {
    void writeClipboardText(shownHits.map((hit) => hit.doc).join("\n"))
      .catch((err: unknown) => notify(
        err instanceof ClipboardUnavailable ? t("search.clipboard_unavailable") : errorText(err),
        "guasto",
      ));
  });
  if (hits.length > 0) tools.append(copy);
  // Gli operatori della barra, detti a parole: la sintassi c'è ed è ricca, ma
  // da un segnaposto non si scopre.
  const help = document.createElement("button");
  help.type = "button";
  help.className = "search-action";
  help.textContent = t("search.syntax_help");
  help.setAttribute("aria-expanded", "false");
  help.addEventListener("click", () => {
    const open = tools.querySelector(".search-syntax");
    if (open) {
      open.remove();
      help.setAttribute("aria-expanded", "false");
      return;
    }
    tools.append(syntaxHelp());
    help.setAttribute("aria-expanded", "true");
  });
  tools.append(help);
  searchResultsEl.append(tools);
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
    const button = document.createElement("button");
    button.type = "button";
    button.className = "search-result";
    if (row.occurrence === undefined) {
      const title = document.createElement("span");
      title.className = "hit-title";
      // Omonimi disambiguati (U14): titolo + percorso secondario, mai solo il
      // nome. Lo snippet solo se il provider l'ha fornito.
      title.textContent = pageName(row.doc);
      button.append(title);
      const path = document.createElement("span");
      path.className = "hit-path";
      path.textContent = row.doc;
      button.append(path);
      if (row.snippet !== undefined && row.snippet !== "") {
        const snippet = document.createElement("span");
        snippet.className = "hit-snippet";
        snippet.appendChild(highlighted(row.snippet, row.highlights ?? []));
        button.append(snippet);
      }
    } else {
      button.classList.add("hit-occurrence");
      button.textContent = t("search.occurrence", { n: row.occurrence });
    }
    openAt(button, row.doc, row.byteOffset);
    li.appendChild(button);
    if (row.occurrence === undefined) {
      // Le azioni della riga compaiono col puntatore o col fuoco sulla riga:
      // fuori dal giro del Tab, che resta una fermata per risultato, e
      // raggiungibili con → dal risultato (← o Esc per tornare).
      button.setAttribute("aria-keyshortcuts", "ArrowRight");
      const omit = document.createElement("button");
      omit.type = "button";
      omit.tabIndex = -1;
      omit.className = "search-action";
      omit.textContent = t("search.exclude");
      omit.setAttribute("aria-label", t("search.exclude_doc", { doc: row.doc }));
      omit.addEventListener("click", () => {
        excluded.add(row.doc);
        void runSearch();
      });
      li.appendChild(omit);
      const slash = row.doc.lastIndexOf("/");
      if (slash >= 0) {
        const folder = row.doc.slice(0, slash);
        const omitFolder = document.createElement("button");
        omitFolder.type = "button";
        omitFolder.tabIndex = -1;
        omitFolder.className = "search-action";
        omitFolder.textContent = t("search.exclude_folder", { folder });
        omitFolder.setAttribute("aria-label", t("search.exclude_folder", { folder }));
        omitFolder.addEventListener("click", () => {
          excludedFolders.add(folder);
          void runSearch();
        });
        li.appendChild(omitFolder);
      }
    }
    newItems.appendChild(li);
  }
  if (total > hits.length) {
    const li = document.createElement("li");
    const more = document.createElement("button");
    more.type = "button";
    more.className = "search-result";
    more.textContent = testoP8("search.more", hits.length, total);
    more.addEventListener("click", () => void runSearchMore(total));
    li.appendChild(more);
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
  if (!error && hits.length === 0 && !indexing && !searchInputEl.value.trim().startsWith('{"any"')) {
    const name = searchedName(searchInputEl.value);
    if (name) newItems.appendChild(createRow(name));
  }
  searchResultsEl.appendChild(newItems);
  wireSearchListSelection();
}

/// Gli operatori della barra, uno per riga: cosa si scrive e cosa fa.
const SYNTAX: readonly (readonly [string, Parameters<typeof t>[0]])[] = [
  ["tag:progetto", "search.syntax.tag"],
  ["folder:Diario", "search.syntax.folder"],
  ["path:2026/", "search.syntax.path"],
  ["file:riunione", "search.syntax.file"],
  ["heading:obiettivi", "search.syntax.heading"],
  ["task:todo", "search.syntax.task"],
  ['"frase esatta"', "search.syntax.phrase"],
  ["/regex/", "search.syntax.regex"],
  ["[stato:fatto]", "search.syntax.property"],
  ["a OR b", "search.syntax.or"],
  ["-parola", "search.syntax.not"],
  ["(a OR b) c", "search.syntax.group"],
];

function syntaxHelp(): HTMLElement {
  const list = document.createElement("dl");
  list.className = "search-syntax";
  for (const [example, key] of SYNTAX) {
    const term = document.createElement("dt");
    const code = document.createElement("code");
    code.textContent = example;
    term.append(code);
    const detail = document.createElement("dd");
    detail.textContent = t(key);
    list.append(term, detail);
  }
  return list;
}

/// Le esclusioni in corso, come etichette che si tolgono con un clic.
function drawExclusions(): void {
  let bar = document.getElementById("search-exclusions");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "search-exclusions";
    bar.className = "search-exclusions";
    searchSummaryEl.after(bar);
  }
  bar.replaceChildren();
  const chips: [string, () => void][] = [
    ...[...excluded].map((doc): [string, () => void] => [pageName(doc), () => excluded.delete(doc)]),
    ...[...excludedFolders].map((folder): [string, () => void] => [`${folder}/`, () => excludedFolders.delete(folder)]),
  ];
  bar.hidden = chips.length === 0;
  for (const [label, remove] of chips) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "search-chip";
    chip.textContent = `− ${label} ×`;
    chip.setAttribute("aria-label", t("search.exclusion_remove", { name: label }));
    chip.addEventListener("click", () => {
      remove();
      void runSearch();
    });
    bar.append(chip);
  }
}

/// La riga «crea questa nota».
///
/// Non si controlla se il nome sia **libero**: lo sa solo il vault, e il comando
/// glielo chiede già — `note.create` usa `create_document`, che su un path
/// occupato fallisce invece di sovrascrivere. È un caso possibile anche a
function createRow(name: string): HTMLElement {
  const li = document.createElement("li");
  li.className = "hit-create";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "search-result";
  const title = document.createElement("span");
  title.className = "hit-title";
  title.textContent = name;
  const desc = document.createElement("span");
  desc.className = "hit-snippet";
  desc.textContent = t("search.create");
  button.append(title, desc);
  button.addEventListener("click", () => {
    rememberSearch(searchInputEl.value);
    void createNote(name)
      .then((doc) => {
        if (doc) void openDocument(doc);
      })
      .catch((e: unknown) => notify(errorText(e), "guasto"));
  });
  li.appendChild(button);
  return li;
}

/// Cliccare (o attivare da tastiera) apre il documento e, se c'è un punto, ci
/// porta il cursore.
///
/// L'offset è in **byte UTF-8** — la valuta di ogni span del modello — e la
/// conversione a posizione della vista la fa `reveal`, la stessa che
/// usano l'outline e `ViewUpdate::Reveal`: la ricerca era l'unico cliente
/// naturale di quel giro e non aveva le coordinate da passargli.
///
/// Aprire non azzera la query (U17): la casella resta per affinare, i
/// risultati restano per tornarci.
function openAt(el: HTMLElement, doc: string, byteOffset?: number): void {
  el.addEventListener("click", () => {
    // La ricerca si ricorda **qui**, non a ogni tasto: questa casella interroga
    // mentre si digita, e una cronologia alimentata da lì si riempirebbe di
    // «r», «ri», «riu». Ciò che vale la pena ricordare è il testo che ha
    // prodotto un'apertura, cioè una ricerca **conclusa** (0086).
    rememberSearch(searchInputEl.value);
    void openDocument(doc).then(() => {
      if (byteOffset !== undefined) return reveal(doc, { span: { start: byteOffset, end: byteOffset } });
    });
  });
}


/// Pagina successiva della stessa query: oltre-200 trovabile (R06) senza
/// caricare tutto il vault — si chiede la finestra dopo, col `total` che il
/// kernel ha già contato prima della finestra.
async function runSearchMore(knownTotal: number): Promise<void> {
  const query = searchInputEl.value.trim();
  if (!query) return;
  const shown = shownHits.length;
  await race.last(async (expected) => {
    type SearchPage = { items: DocumentMatch[]; total: number };
    const page: SearchPage | { error: string } = await expected(
      Promise.resolve()
        .then(() => matchingDocuments(searchExpression(query, [...excluded], [...excludedFolders]), { offset: 0, limit: shown + SEARCH_PAGE }))
        .then((p) => ({ items: p.items, total: p.total }))
        .catch((e: unknown) => ({ error: errorText(e) })),
    );
    if ("error" in page) {
      showSearchResults([], page.error);
      return;
    }
    showSearchResults(page.items, null, false, Math.max(knownTotal, page.total));
  });
}

/// Invio nella casella apre il primo risultato; la lista è una listbox con
/// selezione a frecce (U16): il focus resta nel campo, le frecce muovono la
/// selezione senza spostarlo.
function openFirstResult(): void {
  searchResultsEl.querySelector<HTMLButtonElement>(".search-result")?.click();
}

/// Risultati come lista di comandi, non listbox: le righe aprono documenti o
/// eseguono azioni, non selezionano opzioni. Le frecce spostano il focus fra
/// i pulsanti nativi; Esc riporta al campo.
function wireSearchListKeys(lifetime: Lifetime): void {
  searchResultsEl.setAttribute("aria-label", t("search.results"));
  searchResultsEl.tabIndex = -1;
  lifetime.listen(searchResultsEl, "keydown", (e) => {
    const items = [...searchResultsEl.querySelectorAll<HTMLButtonElement>(".search-result")];
    if (items.length === 0) return;
    const current = document.activeElement;
    const at = current instanceof HTMLButtonElement ? items.indexOf(current) : -1;
    // Un'azione di riga (fuori dal Tab): ← ed Esc riportano al suo risultato,
    // → passa all'azione dopo.
    if (current instanceof HTMLButtonElement && current.classList.contains("search-action") &&
        !current.closest(".search-tools")) {
      const row = current.closest("li");
      const actions = [...(row?.querySelectorAll<HTMLButtonElement>(".search-action") ?? [])];
      if (e.key === "ArrowLeft" || e.key === "Escape") {
        e.preventDefault();
        const index = actions.indexOf(current);
        (index > 0 && e.key === "ArrowLeft" ? actions[index - 1] : row?.querySelector<HTMLButtonElement>(".search-result"))?.focus();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        actions[actions.indexOf(current) + 1]?.focus();
        return;
      }
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === "ArrowRight" && at >= 0) {
      const action = items[at]?.closest("li")?.querySelector<HTMLButtonElement>(".search-action");
      if (action) {
        e.preventDefault();
        action.focus();
      }
    } else if (e.key === "Enter" && current instanceof HTMLButtonElement) {
      e.preventDefault();
      current.click();
    } else if (e.key === "Escape") {
      searchInputEl.focus();
    }
  });
}

/// Dopo ogni disegno la prima riga è selezionabile da tastiera senza rubare il
/// focus: il campo resta dov'è (U16), la lista si naviga con Tab/frecce.
function wireSearchListSelection(): void {
  const first = searchResultsEl.querySelector<HTMLButtonElement>(".search-result");
  if (first) first.tabIndex = 0;
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

// **La ricerca dentro la nota aperta** (§21.4), che è il secondo modale di
// omnisearch e non è il trova/sostituisci.
//
// La differenza non è cosmetica ed è tutta la voce. `Trova/sostituisci` è
// **editing**: cammina sulle occorrenze grezze in ordine di posizione, e serve
// a cambiare del testo. Questa cerca *dentro* la nota con lo **stesso motore**
// di fuori — ordinata per rilevanza, con gli estratti evidenziati, e domani
// tollerante ai refusi come il resto senza che questo file debba saperlo.
//
// # Perché è così corta
//
// Perché non chiede niente di nuovo a nessuno, e le due cose che le servivano
// sono arrivate prima:
//
// - **il linguaggio la sapeva già dire**: è `Docs { docs: [la nota] }` in AND
//   con un `Text`, cioè una clausola di due letterali della
//   [0019](../../../docs/decisions/0182-provider-e-porte-generiche.md). La porta è
//   `testoNelDocumento` in `host/contract.ts`, che sta **là** e non qui per la
//   regola della [0082](../../../docs/decisions/0182-provider-e-porte-generiche.md):
//   tutto ciò che nella shell accetta del testo e propone delle note passa da
//   `IndexQuery::Documents`, o il ranking nasce quattro volte;
// - **le coordinate ci sono**: la [0049](../../../docs/decisions/0181-modello-documento-e-arene.md)
//   ha messo le occorrenze nella risposta, e da lì `rowsToShow` e
//   `reveal` sono le stesse identiche del pannello della ricerca. Un
//   risultato che non fosse cliccabile qui sarebbe una lista di conferme che
//   qualcosa esiste, in un documento che si sta già guardando.
//
// # Cosa resta a questo file
//
// Il disegno, e una decisione sola: **quale** nota. La dice `state.currentDoc`,
// che è il documento del riquadro col fuoco — non «l'ultimo aperto». Se non ce
// n'è uno, il modale lo dice invece di cercare in tutto il vault: una ricerca
// che cambia silenziosamente raggio è peggio di una che non parte.
import type { DocumentMatch } from "../host/contract";
import { textInDocument } from "../host/contract";
import { errorText } from "../host/errors";
import { matchingDocuments } from "../host/query";
import { t } from "../i18n/strings";
import { rowsToShow } from "../rules/results";
import { trapFocus } from "../ui/a11y";
import { registerShellCommand } from "../ui/commands";
import { Race } from "../ui/race";
import { setTooltip } from "../ui/tooltip";
import { state } from "../state/store";
import { highlighted } from "../ui/highlight";
import { enterSurface, exitSurface } from "../ui/motion";
import { reveal } from "./document";

const OVERLAY_ID = "doc-search";

/// Quante occorrenze si mostrano. Dentro **una** nota il numero è piccolo per
/// natura, e una finestra serve lo stesso: una nota di diario che nomina una
/// parola trecento volte non deve costruire trecento righe a ogni tasto.
const MAX_OCCURRENCES = 50;

/// Il proprietario di una singola apertura: chiudi prima la superficie, poi
/// invalida tutto ciò che potrebbe ancora riferirsi alla nota precedente.
interface SearchOwner {
  readonly generation: number;
  readonly doc: string | null;
  readonly race: Race;
  alive: boolean;
  timer: number | undefined;
  release: (() => void) | null;
}

let nextGeneration = 0;
let currentOwner: SearchOwner | null = null;

function isCurrent(owner: SearchOwner): boolean {
  return (
    currentOwner === owner &&
    owner.alive &&
    owner.generation === nextGeneration &&
    state.currentDoc === owner.doc
  );
}

export function closeInDocumentSearch(): void {
  const owner = currentOwner;
  if (owner) {
    owner.alive = false;
    owner.race.cancel();
    if (owner.timer !== undefined) {
      window.clearTimeout(owner.timer);
      owner.timer = undefined;
    }
    currentOwner = null;
    owner.release?.();
    owner.release = null;
  }

  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) {
    exitSurface(overlay, () => {
      // Un'uscita vecchia non rimuove la superficie riaperta nel frattempo.
      if (document.getElementById(OVERLAY_ID) === overlay && currentOwner === null) {
        overlay.remove();
      }
    });
  }
}

/// Il comando, dichiarato da chi ce l'ha (§18.2).
///
/// L'accordo è `Mod-f` e sta in `SHELL_KEYS` come tutti gli altri: è quello che
/// le dita si aspettano — in Obsidian Ctrl+F cerca nella nota e Ctrl+Shift+F nel
/// vault — ed è la coppia che la [0081](../../../docs/decisions/0185-capability-un-solo-guard.md)
/// ha appena rimesso in ordine da questa parte.
export function mountDocSearch(): void {
  registerShellCommand({
    id: "shell.doc.search",
    title: "commands.doc.search",
    description: "commands.doc.search.desc",
    layer: "document",
    run: () => openInDocumentSearch(),
  });
}

export function openInDocumentSearch(): void {
  const doc = state.currentDoc;
  closeInDocumentSearch();
  const owner: SearchOwner = {
    generation: ++nextGeneration,
    doc,
    race: new Race(),
    alive: true,
    timer: undefined,
    release: null,
  };
  const { overlay, box } = openOverlay();
  currentOwner = owner;
  owner.release = trapFocus(overlay, closeInDocumentSearch);

  const input = document.createElement("input");
  input.className = "palette-input";
  input.placeholder = t("docsearch.placeholder");
  input.setAttribute("aria-label", t("docsearch.title"));
  // Etichetta di scope esplicita (U13): "Cerca nella nota" — raggio un solo
  // documento, non il vault. Hook esistente `palette-desc`, nessun CSS nuovo.
  const scope = document.createElement("p");
  scope.className = "palette-desc";
  scope.textContent = t("docsearch.title");
  const summary = document.createElement("p");
  summary.className = "docsearch-summary";
  const list = document.createElement("ul");
  // Niente `role="listbox"`: qui nessuna riga è «scelta» — si scorre e si
  // clicca. Un ruolo di selezione senza selezione prometterebbe una freccia
  // che non c'è.
  list.className = "plain-list palette-list";
  list.setAttribute("aria-label", t("docsearch.title"));
  list.tabIndex = 0;
  // L'overlay può essere ancora quello dell'uscita precedente: sostituire è
  // atomico e impedisce a una riapertura di accumulare alberi di risultati.
  box.replaceChildren(scope, input, summary, list);

  if (doc === null) {
    summary.textContent = t("docsearch.no_doc");
    input.disabled = true;
    return;
  }

  const search = async () => {
    if (!isCurrent(owner)) return;
    const text = input.value.trim();
    if (!isCurrent(owner)) return;
    if (!text) {
      owner.race.cancel();
      if (!isCurrent(owner)) return;
      summary.textContent = "";
      list.replaceChildren();
      return;
    }
    await owner.race.last(async (expected) => {
      if (!isCurrent(owner)) return;
      const result = await expected(
        matchingDocuments(textInDocument([doc], text, true), {
          offset: 0,
          limit: MAX_OCCURRENCES,
        })
          .then((p) => ({ hits: p.items }))
          .catch((e: unknown) => ({ error: errorText(e) })),
      );
      if (!isCurrent(owner)) return;
      if ("error" in result) {
        summary.textContent = t("search.unavailable");
        list.replaceChildren();
        setTooltip(summary, result.error);
        return;
      }
      render(result.hits);
    });
  };

  const render = (hits: DocumentMatch[]) => {
    if (!isCurrent(owner)) return;
    const rows = rowsToShow(hits);
    if (!isCurrent(owner)) return;
    summary.textContent =
      rows.length === 0 ? t("search.empty") : t("search.count", { count: rows.length });
    const newItems = document.createDocumentFragment();
    for (const row of rows) {
      const li = document.createElement("li");
      const content = document.createElement("span");
      if (row.occurrence === undefined) {
        content.appendChild(highlighted(row.snippet ?? "", row.highlights ?? []));
      } else {
        li.className = "hit-occurrence";
        content.textContent = t("search.occurrence", { n: row.occurrence });
      }
      if (row.byteOffset !== undefined) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-result";
        button.appendChild(content);
        const where = row.byteOffset;
        // Il documento è già aperto: qui non si apre niente, ci si porta il
        // cursore — e il modale si chiude, perché il gesto è finito.
        button.addEventListener("click", () => {
          if (!isCurrent(owner)) return;
          const targetDoc = owner.doc;
          if (targetDoc === null || state.currentDoc !== targetDoc) return;
          closeInDocumentSearch();
          if (state.currentDoc !== targetDoc) return;
          void reveal(targetDoc, { span: { start: where, end: where } });
        });
        li.appendChild(button);
      } else {
        li.appendChild(content);
      }
      newItems.appendChild(li);
    }
    if (!isCurrent(owner)) return;
    list.replaceChildren(newItems);
  };

  input.addEventListener("input", () => {
    if (!isCurrent(owner)) return;
    if (owner.timer !== undefined) window.clearTimeout(owner.timer);
    owner.timer = window.setTimeout(() => {
      owner.timer = undefined;
      if (!isCurrent(owner)) return;
      void search();
    }, 180);
  });
  // U16: Frecce/Enter/Esc. Le frecce passano il fuoco fra i bottoni della
  // lista, e continuano a funzionare **dalla lista** (dopo la prima freccia il
  // fuoco non è più nel campo); Esc dalla lista torna al campo.
  list.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...list.querySelectorAll<HTMLButtonElement>(".search-result:not([disabled])")];
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "ArrowUp" && at <= 0) {
        input.focus();
        return;
      }
      const next = e.key === "ArrowDown" ? (at + 1) % items.length : at - 1;
      items[next]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      input.focus();
    }
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...list.querySelectorAll<HTMLButtonElement>(".search-result:not([disabled])")];
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      list.querySelector<HTMLButtonElement>(".search-result:not([disabled])")?.click();
    } else if (e.key === "Escape") {
      closeInDocumentSearch();
    }
  });
}

function openOverlay(): { overlay: HTMLElement; box: HTMLElement } {
  let overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.className = "modale";
    // Una modale dichiarata tale, come la palette: chi entra sente «finestra di
    // dialogo» e il linguetta non esce di sotto.
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.tabIndex = -1;
    const box = document.createElement("div");
    box.className = "palette-box";
    overlay.appendChild(box);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) closeInDocumentSearch();
    });
    document.body.appendChild(overlay);
  }
  overlay.setAttribute("aria-label", t("docsearch.title"));
  enterSurface(overlay);
  return { overlay, box: overlay.querySelector<HTMLElement>(".palette-box")! };
}

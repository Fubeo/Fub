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
//   [0019](../../../docs/decisions/0019-il-canale-dati.md). La porta è
//   `testoNelDocumento` in `host/contract.ts`, che sta **là** e non qui per la
//   regola della [0082](../../../docs/decisions/0082-una-porta-per-chi-cerca.md):
//   tutto ciò che nella shell accetta del testo e propone delle note passa da
//   `IndexQuery::Documents`, o il ranking nasce quattro volte;
// - **le coordinate ci sono**: la [0049](../../../docs/decisions/0049-una-posizione-dentro-un-documento.md)
//   ha messo le occorrenze nella risposta, e da lì `righeDaMostrare` e
//   `revealByteOffset` sono le stesse identiche del pannello della ricerca. Un
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
import { testoNelDocumento } from "../host/contract";
import { errorText } from "../host/errors";
import { documentiCheCombaciano } from "../host/query";
import { t } from "../i18n/strings";
import { righeDaMostrare } from "../rules/risultati";
import { attivabile, intrappolaFuoco } from "../ui/a11y";
import { registerShellCommand } from "../ui/commands";
import { state } from "../state/store";
import { evidenziato } from "../ui/highlight";
import { revealByteOffset } from "./document";

const OVERLAY_ID = "doc-search";

/// Quante occorrenze si mostrano. Dentro **una** nota il numero è piccolo per
/// natura, e una finestra serve lo stesso: una nota di diario che nomina una
/// parola trecento volte non deve costruire trecento righe a ogni tasto.
const QUANTE = 50;

/// Come si scioglie la trappola del fuoco, quando il modale è aperto.
let sciogli: (() => void) | null = null;

export function chiudiRicercaNellaNota(): void {
  document.getElementById(OVERLAY_ID)?.remove();
  sciogli?.();
  sciogli = null;
}

/// Il comando, dichiarato da chi ce l'ha (§18.2).
///
/// L'accordo è `Mod-f` e sta in `SHELL_KEYS` come tutti gli altri: è quello che
/// le dita si aspettano — in Obsidian Ctrl+F cerca nella nota e Ctrl+Shift+F nel
/// vault — ed è la coppia che la [0081](../../../docs/decisions/0081-un-accordo-ha-un-proprietario.md)
/// ha appena rimesso in ordine da questa parte.
export function mountDocSearch(): void {
  registerShellCommand({
    id: "shell.doc.search",
    title: "commands.doc.search",
    description: "commands.doc.search.desc",
    run: () => apriRicercaNellaNota(),
  });
}

export function apriRicercaNellaNota(): void {
  const doc = state.currentDoc;
  const box = apriOverlay();

  const input = document.createElement("input");
  input.className = "palette-input";
  input.placeholder = t("docsearch.placeholder");
  input.setAttribute("aria-label", t("docsearch.title"));
  const riassunto = document.createElement("p");
  riassunto.className = "docsearch-summary";
  const lista = document.createElement("ul");
  lista.className = "palette-list";
  box.append(input, riassunto, lista);

  if (doc === null) {
    // Niente nota, niente ricerca — e lo si dice qui invece di non aprire
    // niente: una scorciatoia premuta che non fa succedere nulla si legge come
    // un guasto della tastiera.
    riassunto.textContent = t("docsearch.no_doc");
    input.disabled = true;
    return;
  }

  // Lo stesso freno del pannello della ricerca, per la stessa ragione: si cerca
  // mentre si digita, e una query per tasto sarebbe una raffica di giri IPC di
  // cui interessa solo l'ultimo.
  let timer: number | undefined;
  // Ogni ricerca porta il proprio numero d'ordine: una risposta lenta di una
  // query vecchia non deve sovrascrivere i risultati di una più recente.
  let seq = 0;

  const cerca = async () => {
    const testo = input.value.trim();
    const mio = ++seq;
    if (!testo) {
      riassunto.textContent = "";
      lista.innerHTML = "";
      return;
    }
    let hits: DocumentMatch[];
    try {
      hits = (
        await documentiCheCombaciano(testoNelDocumento([doc], testo, true), {
          offset: 0,
          limit: QUANTE,
        })
      ).items;
    } catch (e) {
      if (mio === seq) {
        riassunto.textContent = t("search.unavailable");
        lista.innerHTML = "";
        // Il motivo in chiaro: «ricerca non disponibile» dice che non si può
        // cercare, non perché — e il perché qui è quasi sempre un vault senza
        // indice full-text.
        riassunto.title = errorText(e);
      }
      return;
    }
    if (mio !== seq) return;
    // Nessuno stato «sto ancora indicizzando» come nel pannello del vault: chi
    // ha una nota aperta l'ha aperta da un indice che risponde, e la domanda in
    // più a ogni ricerca vuota costerebbe più di ciò che chiarisce.
    disegna(hits);
  };

  const disegna = (hits: DocumentMatch[]) => {
    const righe = righeDaMostrare(hits);
    riassunto.textContent =
      righe.length === 0 ? t("search.empty") : t("search.count", { count: righe.length });
    lista.innerHTML = "";
    // Fuori dal documento e attaccate in una volta sola, come nel pannello: qui
    // si ridisegna a ogni tasto premuto.
    const nuove = document.createDocumentFragment();
    for (const riga of righe) {
      const li = document.createElement("li");
      if (riga.occorrenza === undefined) {
        li.appendChild(evidenziato(riga.snippet ?? "", riga.highlights ?? []));
      } else {
        li.className = "hit-occurrence";
        li.textContent = t("search.occurrence", { n: riga.occorrenza });
      }
      if (riga.byteOffset !== undefined) {
        const dove = riga.byteOffset;
        // Il documento è già aperto: qui non si apre niente, ci si porta il
        // cursore — e il modale si chiude, perché il gesto è finito.
        li.addEventListener("click", () => {
          chiudiRicercaNellaNota();
          revealByteOffset(dove);
        });
        attivabile(li);
      }
      nuove.appendChild(li);
    }
    lista.appendChild(nuove);
  };

  input.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void cerca(), 180);
  });
}

function apriOverlay(): HTMLElement {
  chiudiRicercaNellaNota();
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "modale";
  // Una modale dichiarata tale, come la palette: chi entra sente «finestra di
  // dialogo» e il tab non esce di sotto.
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", t("docsearch.title"));
  overlay.tabIndex = -1;
  const box = document.createElement("div");
  box.className = "palette-box";
  overlay.appendChild(box);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) chiudiRicercaNellaNota();
  });
  document.body.appendChild(overlay);
  // Dopo l'inserimento: `intrappolaFuoco` mette a fuoco il primo elemento, e
  // un elemento fuori dal documento non lo può prendere.
  sciogli = intrappolaFuoco(overlay, chiudiRicercaNellaNota);
  return box;
}

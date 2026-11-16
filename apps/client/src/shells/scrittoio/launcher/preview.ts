// L'anteprima del lanciatore: la nota della riga attiva, resa accanto all'elenco.
//
// La strada è quella delle altre anteprime della shell: la resa si chiede al
// canale dati (`render_preview`, la stessa proiezione della Lettura), passa
// dall'unico varco dell'HTML (`setSanitizedHtml`) e non tocca né sessioni né
// buffer. Non si usa la scheda di `state/preview.ts` perché quella è una sola
// per tutta la shell, e la contenderebbero il passaggio su un wikilink e
// `shell.preview.show`.
//
// È uno sguardo, non una regione: segue la riga attiva a ogni freccia, non si
// può raggiungere (il fuoco resta nel campo, Tab cambia modo) e ciò che dice
// la riga basta a scegliere. Per questo è inerte e fuori dall'albero
// dell'accessibilità: i collegamenti resi dentro non diventano fermate del Tab,
// e chi ascolta non sente una pagina che cambia sotto ogni freccia.
import { mediaKindOfId } from "../../../editors/media/media-types";
import { renderPreview } from "../../../host/query";
import { t } from "../../../i18n/strings";
import { formatKindOf } from "../../../ui/format-kind";
import { iconEl } from "../../../ui/icons";
import type { Lifetime } from "../../../ui/lifetime";
import { Race } from "../../../ui/race";
import { setSanitizedHtml } from "../../../ui/sanitize";
import { skeleton, SKELETON_DELAY_MS } from "../../../ui/skeleton";

/// Quanto la riga attiva deve restare ferma prima che si chieda la sua resa
/// (ms): chi scorre l'elenco non fa partire una domanda per riga.
export const PREVIEW_DELAY_MS = 90;
/// Dopo quanto una resa che non arriva si dice (ms): attenua quella di prima,
/// o se non ce n'è una mostra lo scheletro di una pagina.
export const PREVIEW_SLOW_MS = SKELETON_DELAY_MS;
/// Le righe dello scheletro della pagina.
const SKELETON_LINES = 6;

export interface Preview {
  /// Il riquadro, da posare accanto all'elenco.
  readonly element: HTMLElement;
  /// La nota da mostrare; `null` svuota il riquadro. Chiedere quella che già
  /// si mostra, o che si sta aspettando, non fa niente.
  follow(doc: string | null): void;
}

/// Un file che non è un documento (un PDF, un'immagine, un audio): il canale
/// dati non ha una resa da dargli, e chiederla vorrebbe dire un guasto per
/// riga. Lo dice il riquadro, senza domanda.
function mediaFile(doc: string): boolean {
  return formatKindOf(doc) === null && mediaKindOfId(doc) !== "other";
}

/// La cartella di un documento, letta come una strada: «Progetti › Mostra».
/// Vuota per un documento in cima al vault.
export function folderOf(doc: string): string {
  return doc.split("/").filter(Boolean).slice(0, -1).join(" › ");
}

/// Ciò che si vede e non è testo: una resa fatta solo di questo non è vuota.
const NOT_TEXT = "img, svg, video, audio, table, hr, canvas, iframe";

export function createPreview(lifetime: Lifetime): Preview {
  const element = document.createElement("div");
  element.className = "launcher-preview";
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("inert", "");
  // La resa è quella della Lettura: stesse classi, stessi stili.
  const page = document.createElement("div");
  page.className = "launcher-preview-page markdown-rendered";
  const note = document.createElement("p");
  note.className = "launcher-preview-note";
  note.hidden = true;
  // La resa sta su un foglio rialzato dentro il riquadro: è una pagina vista
  // da lontano, non testo steso sul fondo. La frase sta fuori dal foglio.
  const sheet = document.createElement("div");
  sheet.className = "launcher-preview-sheet";
  sheet.append(page);
  // Sotto il foglio, i dati della nota: dove sta. La data dell'ultima modifica
  // no: il lanciatore non la riceve, e chiederla vorrebbe una domanda in più
  // per ogni riga attiva.
  const meta = document.createElement("div");
  meta.className = "launcher-preview-meta";
  meta.hidden = true;
  const place = document.createElement("div");
  place.className = "launcher-preview-fact";
  const folderIcon = iconEl("folder");
  if (folderIcon) place.append(folderIcon);
  const folder = document.createElement("span");
  place.append(folder);
  meta.append(place);
  element.append(sheet, note, meta);
  /// I dati del documento mostrato; nessuno senza documento, o in cima al vault.
  const describe = (doc: string | null): void => {
    const where = doc === null ? "" : folderOf(doc);
    folder.textContent = where;
    meta.hidden = where === "";
  };

  const race = new Race();
  let wanted: string | null = null;
  let delay: number | undefined;
  let slow: number | undefined;

  const settle = (): void => {
    window.clearTimeout(delay);
    window.clearTimeout(slow);
    delay = undefined;
    slow = undefined;
    element.removeAttribute("data-waiting");
  };
  const say = (words: string | null): void => {
    note.hidden = words === null;
    note.textContent = words ?? "";
  };

  const ask = (doc: string): void => {
    delay = undefined;
    slow = window.setTimeout(() => {
      element.setAttribute("data-waiting", "");
      if (page.childElementCount === 0) {
        say(null);
        page.append(skeleton(SKELETON_LINES));
      }
    }, PREVIEW_SLOW_MS);
    // Una resa superata da una riga più nuova non arriva a disegnarsi; il
    // guasto diventa un valore prima del cancello, e passa dallo stesso.
    void race.last(async (expected) => {
      const outcome = await expected(
        renderPreview(doc).then(
          (rendered) => ({ html: rendered.html }),
          () => null,
        ),
      );
      settle();
      if (outcome === null) {
        page.replaceChildren();
        say(t("launcher.preview.failed"));
        return;
      }
      setSanitizedHtml(page, outcome.html);
      const empty = (page.textContent ?? "").trim() === "" && page.querySelector(NOT_TEXT) === null;
      say(empty ? t("launcher.preview.empty") : null);
    });
  };

  lifetime.add(() => {
    settle();
    race.cancel();
  });

  return {
    element,
    follow(doc) {
      if (lifetime.closed || doc === wanted) return;
      wanted = doc;
      settle();
      race.cancel();
      describe(doc);
      if (doc === null || mediaFile(doc)) {
        page.replaceChildren();
        say(doc === null ? null : t("launcher.preview.file"));
        return;
      }
      // Ciò che si vedeva resta finché arriva il resto: il riquadro non
      // lampeggia a ogni freccia.
      delay = window.setTimeout(() => ask(doc), PREVIEW_DELAY_MS);
    },
  };
}

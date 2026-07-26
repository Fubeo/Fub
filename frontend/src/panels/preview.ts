// Il documento **reso**: la superficie della modalità Lettura.
//
// Non è un pannello sempre acceso accanto all'editor — è l'editor che lascia il
// posto, ed è perché `PaneMode` è un enum di modalità **esclusive** (due
// superfici sullo stesso documento sono due verità da tenere allineate).
//
// Qui dentro c'è anche l'idratazione degli embed, che è l'unico pezzo di
// transclusion che vive nella shell: il provider emette solo un placeholder
// (`render_html` resta puro e per-documento), e chi ricuce l'albero è chi
// disegna.
//
// Il collegamento col mondo — «apri questa pagina» — **arriva iniettato**
// (`configurePreview`) e non importato: aprire un documento è del pannello del
// documento, che a sua volta mostra questo in Lettura. Importarsi a vicenda
// sarebbe un ciclo, e la forma iniettata è la stessa dei tre moduli
// dell'editor.
import { api } from "../host/ipc";
import { $ } from "../ui/dom";

const previewEl = $("#preview");

/// Profondità massima di transclusion: oltre, l'embed resta un link.
const MAX_EMBED_DEPTH = 5;

let apriPagina: (page: string) => Promise<void> = async () => {};

export interface PreviewDeps {
  /// Cliccare un wikilink: risolvere e aprire, o creare la nota che manca.
  openPage(page: string): Promise<void>;
}

export function configurePreview(deps: PreviewDeps): void {
  apriPagina = deps.openPage;
}

/// Mostra o nasconde la superficie di lettura.
export function setPreviewVisible(on: boolean): void {
  previewEl.hidden = !on;
}

export function clearPreview(): void {
  previewEl.innerHTML = "";
}

/// Chiede al kernel il documento reso e lo innesta, ricucendo link ed embed.
export async function updatePreview(id: string): Promise<void> {
  const html = await api.renderPreview(id);
  previewEl.innerHTML = html;
  wireWikilinks(previewEl);
  await hydrateEmbeds(previewEl, new Set([id]));
}

/// Navigazione dei wikilink dentro un frammento reso.
function wireWikilinks(container: HTMLElement): void {
  container.querySelectorAll<HTMLAnchorElement>("a.wikilink").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const page = a.dataset.wikilinkPage;
      if (!page) return;
      try {
        await apriPagina(page);
      } catch (err) {
        // Link non risolto e nota non creabile: si segna, non si tace.
        a.classList.add("unresolved");
        console.error(`FubMD: non riesco ad aprire «${page}»: ${err}`);
      }
    });
  });
}

// Transclusion: il provider emette solo placeholder `.embed` (render puro,
// per-documento); qui si chiede al kernel il contenuto e lo si innesta,
// ricorsivamente. La catena dei documenti già aperti spezza i cicli
// (`![[A]]` dentro A) e MAX_EMBED_DEPTH limita la profondità.
async function hydrateEmbeds(container: HTMLElement, chain: Set<string>): Promise<void> {
  const slots = Array.from(
    container.querySelectorAll<HTMLElement>(".embed[data-embed-page]"),
  );
  await Promise.all(
    slots.map(async (slot) => {
      const page = slot.dataset.embedPage;
      if (!page) return;
      if (chain.size > MAX_EMBED_DEPTH) {
        slot.classList.add("embed-too-deep");
        return;
      }
      try {
        const content = await api.renderEmbed(page, slot.dataset.embedHeading ?? null);
        if (chain.has(content.doc_id)) {
          slot.classList.add("embed-cycle");
          return;
        }
        slot.innerHTML = content.html;
        slot.classList.add("embed-loaded");
        wireWikilinks(slot);
        await hydrateEmbeds(slot, new Set([...chain, content.doc_id]));
      } catch {
        slot.classList.add("unresolved");
      }
    }),
  );
}

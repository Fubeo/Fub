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
import type { RenderedDocument } from "../host/contract";
import { api } from "../host/ipc";
import { mountTree } from "../ui/node";
import { setSanitizedHtml } from "../ui/sanitize";
import { errorText } from "../host/errors";

/// Profondità massima di transclusion: oltre, l'embed resta un link.
const MAX_EMBED_DEPTH = 5;

let apriPagina: (page: string, heading?: string, block?: string) => Promise<void> = async () => {};

export interface PreviewDeps {
  /// Cliccare un wikilink: risolvere e aprire, o creare la nota che manca.
  ///
  /// `heading` e `block` sono il punto che il link nomina, quando lo nomina
  /// (`[[Nota#Sezione]]`, `[[Nota#^blocco]]`): il parser li legge dalla 0003 e
  /// fino alla 0049 non c'era una risposta in cui metterli, quindi si
  /// perdevano qui.
  openPage(page: string, heading?: string, block?: string): Promise<void>;
}

export function configurePreview(deps: PreviewDeps): void {
  apriPagina = deps.openPage;
}

/// Svuota una superficie di lettura.
export function clearPreview(previewEl: HTMLElement): void {
  previewEl.innerHTML = "";
}

/// Chiede al kernel il documento reso e lo innesta in una superficie di
/// lettura, ricucendo link, parti ed embed.
///
/// **Il contenitore arriva da fuori.** Fino a ieri era `#preview`, letto qui:
/// era vero finché di riquadri ce n'era uno, e sarebbe diventato falso in
/// silenzio — due riquadri in Lettura avrebbero disegnato due documenti diversi
/// nello stesso elemento, e il secondo avrebbe vinto. Chi possiede la superficie
/// è il riquadro (§1.2), e questo modulo torna a sapere solo *come* si rende un
/// documento.
export async function updatePreview(previewEl: HTMLElement, id: string): Promise<void> {
  const reso = await api.renderPreview(id);
  innesta(previewEl, reso);
  await hydrateEmbeds(previewEl, new Set([id]));
}

/// Innesta un documento reso: l'HTML **sanitizzato**, e poi le parti
/// dichiarative dentro i loro buchi.
///
/// L'ordine conta: i buchi sono nell'HTML, quindi prima si innesta e poi si
/// cerca. E l'HTML passa dal punto unico (§3.6) come tutto ciò che entra nella
/// webview — anche se qui a produrlo è il nostro provider, perché la regola vale
/// per chi lo produce oggi e per chi lo produrrà.
function innesta(container: HTMLElement, reso: RenderedDocument): void {
  setSanitizedHtml(container, reso.html);
  wireWikilinks(container);
  mountParts(container, reso);
}

/// Monta le parti dichiarative di un documento reso (§3.2, §3.3).
///
/// È il momento in cui il blocco di un plugin diventa DOM **senza che questo
/// bundle sappia cosa sia**: la parte è un albero `UiNode`, e si disegna con lo
/// stesso `mountTree` delle view. Un `UiKind::Custom` di cui la shell non
/// conosce l'`ns` disegna il suo `fallback`, che è ciò che il contratto chiede a
/// chi non lo conosce.
///
/// Le azioni non sono cablate: una parte è un **disegno**, e non ha un
/// `ViewProvider` a cui mandare un click — chi lo vorrà passerà da una view
/// sulla superficie principale. Un `onAction` che non fa niente è la risposta
/// onesta, e non un `TODO` che finisce in un errore a runtime.
function mountParts(container: HTMLElement, reso: RenderedDocument): void {
  for (const part of reso.parts) {
    const slot = container.querySelector<HTMLElement>(`[data-ui-slot="${part.slot}"]`);
    if (!slot) continue; // il buco non c'è più: il documento è cambiato sotto
    slot.dataset.kind = part.kind;
    mountTree(slot, part.node, async () => {});
  }
}

/// Navigazione dei wikilink dentro un frammento reso.
function wireWikilinks(container: HTMLElement): void {
  container.querySelectorAll<HTMLAnchorElement>("a.wikilink").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const page = a.dataset.wikilinkPage;
      if (!page) return;
      try {
        await apriPagina(page, a.dataset.wikilinkHeading, a.dataset.wikilinkBlock);
      } catch (err) {
        // Link non risolto e nota non creabile: si segna, non si tace.
        a.classList.add("unresolved");
        console.error(`Fub: non riesco ad aprire «${page}»: ${errorText(err)}`);
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
        // Un embed passa dagli stessi renderer dell'anteprima: un diagramma
        // dentro una nota trasclusa resta un diagramma. `innesta` fa le tre cose
        // che servono — sanitizza, ricuce i link, monta le parti.
        innesta(slot, content);
        slot.classList.add("embed-loaded");
        await hydrateEmbeds(slot, new Set([...chain, content.doc_id]));
      } catch {
        slot.classList.add("unresolved");
      }
    }),
  );
}

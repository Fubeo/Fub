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
import type { EmbedContent, RenderedDocument } from "../host/contract";
import { api } from "../host/ipc";
import { mountTree } from "../ui/node";
import { setSanitizedHtml } from "../ui/sanitize";
import { errorText } from "../host/errors";
import { notify } from "../ui/notify";
import { t } from "../i18n/strings";
import { Corsa, type Atteso } from "../ui/corsa";

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

/// La corsa è **della superficie**, non del modulo.
///
/// Due riquadri in Lettura su due note sono due anteprime che si riempiono
/// insieme, e un contatore unico di modulo — che è com'erano scritte due delle
/// quattro implementazioni a mano — le farebbe annullare a vicenda. La mappa è
/// **debole** perché il padrone è l'elemento: quando il riquadro se ne va la sua
/// corsa se ne va con lui, e non c'è nessuna cancellazione da ricordarsi. È la
/// stessa regola della `Vita` (0133), col contenitore al posto della chiusura.
const corse = new WeakMap<HTMLElement, Corsa>();

function corsaDi(previewEl: HTMLElement): Corsa {
  const gia = corse.get(previewEl);
  if (gia) return gia;
  const nuova = new Corsa();
  corse.set(previewEl, nuova);
  return nuova;
}

/// Svuota una superficie di lettura.
export function clearPreview(previewEl: HTMLElement): void {
  // **Questa riga è il difetto 0031.** Svuotare non basta: la resa chiesta un
  // istante fa è ancora in volo, e senza far scadere il giro arriverebbe a
  // riempire un'anteprima che nessuno guarda più — quella del documento di
  // prima, dentro un riquadro che intanto mostra altro.
  corse.get(previewEl)?.annulla();
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
  await corsaDi(previewEl).ultimo(async (atteso) => {
    const reso = await atteso(api.renderPreview(id));
    innesta(previewEl, reso);
    // L'`atteso` scende nell'idratazione, e non è una comodità: gli embed sono
    // il **grosso** delle attese di un'anteprima — una nota che ne trascluda
    // dieci sono dieci viaggi dopo che il primo è già tornato — quindi è lì che
    // la finestra è larga. Passarlo giù è ciò che rende il controllo una cosa
    // che si eredita invece di una cosa che si riscrive.
    await hydrateEmbeds(previewEl, new Set([id]), new Map(), atteso);
  });
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
        // Link non risolto e nota non creabile: si segna, non si tace. Il
        // segno sul link dice *quale*, l'avviso dice *perché* — e senza il
        // secondo un click che non fa niente resta senza spiegazione (§20.4).
        a.classList.add("unresolved");
        notify(t("preview.open_failed", { page, reason: errorText(err) }), "guasto");
      }
    });
  });
}

// Transclusion: il provider emette solo placeholder `.embed` (render puro,
// per-documento); qui si chiede al kernel il contenuto e lo si innesta,
// ricorsivamente. La catena dei documenti già aperti spezza i cicli
// (`![[A]]` dentro A) e MAX_EMBED_DEPTH limita la profondità.
//
// # La stessa pagina si chiede una volta sola (§2.9)
//
// La profondità era limitata; la **larghezza** no, e le due si moltiplicano.
// Una nota che trascluda dieci note, ognuna delle quali ne trascluda altre
// dieci, faceva partire diecimila `render_embed` attraverso il ponte per un
// documento che di note distinte ne nomina venti — e ogni `![[Glossario]]`
// ripetuto tre volte nella stessa nota erano tre viaggi identici.
//
// Il memo è per **corsa di idratazione**, e la sua correttezza non è una
// scommessa sul kernel: è scritta nella firma di `FormatProvider::render_html`,
// che promette che *«la resa di un blocco dipende dal blocco, non dal resto del
// documento»* — cioè che chiedere due volte la stessa pagina con lo stesso
// heading rende due volte la stessa cosa. Un memo che sopravvivesse alla corsa
// sarebbe invece una cache, con la domanda «quando si invalida» attaccata; qui
// muore con l'anteprima che l'ha aperta, e la prossima apertura ricomincia.
//
// **Non è lazy loading**, e la differenza va detta: caricare un embed solo
// quando lo si vede è una domanda di layout, che in `happy-dom` non esiste
// (buco dichiarato n. 5 della 0112) e che qui resta scoperta. Questo toglie i
// viaggi *ripetuti*, non quelli *anticipati*.
async function hydrateEmbeds(
  container: HTMLElement,
  chain: Set<string>,
  memo: Map<string, Promise<EmbedContent>>,
  atteso: Atteso,
): Promise<void> {
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
      const heading = slot.dataset.embedHeading ?? null;
      const chiave = `${page} ${heading ?? ""}`;
      let chiesto = memo.get(chiave);
      if (!chiesto) {
        chiesto = api.renderEmbed(page, heading);
        memo.set(chiave, chiesto);
      }
      // L'errore diventa un valore prima del cancello — un embed che non si
      // risolve si segna e basta — così qui sotto non c'è nessun `catch` in cui
      // il segnale di scadenza possa perdersi.
      const content = await atteso(chiesto.then((c) => c).catch(() => null));
      if (!content) {
        slot.classList.add("unresolved");
        return;
      }
      if (chain.has(content.doc_id)) {
        slot.classList.add("embed-cycle");
        return;
      }
      // Un embed passa dagli stessi renderer dell'anteprima: un diagramma
      // dentro una nota trasclusa resta un diagramma. `innesta` fa le tre cose
      // che servono — sanitizza, ricuce i link, monta le parti.
      innesta(slot, content);
      slot.classList.add("embed-loaded");
      await hydrateEmbeds(slot, new Set([...chain, content.doc_id]), memo, atteso);
    }),
  );
}

// Trascinare un collegamento della Lettura come la nota che nomina.
//
// Un wikilink nomina una pagina, non un documento: chi lo riceve
// (l'editor, la striscia delle schede, i segnalibri) vuole l'id della nota, e
// `dragstart` deve dirlo subito, senza aspettare. La risoluzione parte quindi
// alla pressione, come per la scheda al passaggio; al primo movimento del
// trascinamento è già arrivata. Se non è arrivata, o il collegamento non porta a
// niente, il trascinamento resta quello del browser.
import { resolvedReference } from "../../../host/query";
import { offerNote } from "../../../ui/drag-types";
import type { Lifetime } from "../../../ui/lifetime";
import { activeDoc } from "../../../state/layout";
import { byId } from "../frame/dom";
import { linkOf } from "./link-card";

/// I wikilink della Lettura: in Live il collegamento è testo dell'editor, e
/// trascinarlo sposta il testo.
const READING_LINK = ".markdown-preview a.wikilink[data-wikilink-page]";

export function mountLinkDrag(lifetime: Lifetime): void {
  const panes = byId("panes");
  if (!panes) return;
  // Il collegamento premuto per ultimo e ciò che il vault ne ha detto. Una
  // risposta arrivata per un collegamento che non è più quello premuto non
  // vale.
  let pressed: { link: HTMLElement; doc: string | null } | null = null;
  lifetime.listen(panes, "pointerdown", (event: PointerEvent) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLElement>(READING_LINK) : null;
    if (!link) return;
    const ref = linkOf(link);
    if (!ref) return;
    const mine = { link, doc: null as string | null };
    pressed = mine;
    void resolvedReference(ref.target, activeDoc() ?? undefined).then(
      (resolved) => {
        if (pressed === mine && !lifetime.closed) mine.doc = resolved?.doc ?? null;
      },
      () => {},
    );
  });
  lifetime.listen(panes, "dragstart", (event: DragEvent) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLElement>(READING_LINK) : null;
    if (!link || !event.dataTransfer || pressed?.link !== link || !pressed.doc) return;
    offerNote(event.dataTransfer, pressed.doc);
  });
}

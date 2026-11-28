// La regola del clic che segue un link verso un altro documento del vault,
// la stessa in ogni posto dove si clicca (`editor.link-click`, E11, T20; la
// pagina è `docs/product/editor-writing.md`, «Il clic su un link»):
//
// - Alt col clic sbircia: la nota nella sbirciata (`state/note-peek.ts`), un
//   altro file a lato;
// - il «clic che apre» fa ciò che dice `editor.link-click`: `apri`, di serie,
//   porta la nota nel riquadro; `sbircia` la sbircia. Nel testo che si scrive
//   (la Scrittura) il clic che apre è Ctrl col clic, Cmd sul Mac, perché il
//   clic semplice è del cursore; in ciò che è reso (la Lettura, un blocco
//   reso, una scheda della nota, una cella di tabella resa) è il clic, con o
//   senza Ctrl/Cmd;
// - «Apri» del menu del link apre sempre.
//
// Vale per i wikilink e per i link Markdown verso un documento del vault
// (`[testo](nota.md)`); un indirizzo web resta del visore. Senza sbirciata
// (una finestra che non la offre) ogni gesto apre.
//
// Il modulo è puro (niente CodeMirror): lo usano anche la resa
// (`mount.ts`) e la shell.

/// Il gesto con cui si segue un link: il clic che apre (la regola la dice
/// `editor.link-click`), la sbirciata chiesta (Alt), l'apertura chiesta (il
/// menu «Apri»).
export type WikilinkGesture = "click" | "peek" | "open";

/// Il link che si sbircia, come è scritto: un wikilink o un percorso di un
/// link Markdown, relativo alla nota che lo contiene.
export type PeekLink =
  | { readonly kind: "wiki"; readonly page: string; readonly heading: string | null; readonly block: string | null }
  | { readonly kind: "path"; readonly path: string };

/// Chi segue un link: aprire, sbirciare (se la finestra lo sa fare), e la
/// regola del clic.
export interface WikilinkFollow {
  openWikilink(page: string, heading: string | null, block: string | null): void | Promise<void>;
  openPath?(path: string): void | Promise<void>;
  peekLink?(link: PeekLink): void | Promise<void>;
  linkClick?(): "apri" | "sbircia";
}

function wantsPeek(follow: WikilinkFollow, gesture: WikilinkGesture): boolean {
  return Boolean(follow.peekLink) && (gesture === "peek" || (gesture === "click" && follow.linkClick?.() === "sbircia"));
}

/// Segue il wikilink col gesto `gesture`: la sbirciata se è chiesta, o se il
/// clic che apre deve sbirciare; altrimenti la nota si apre. Senza
/// sbirciata, si apre sempre.
export function followWikilink(
  follow: WikilinkFollow,
  page: string,
  heading: string | null,
  block: string | null,
  gesture: WikilinkGesture,
): void | Promise<void> {
  if (wantsPeek(follow, gesture)) return follow.peekLink!({ kind: "wiki", page, heading, block });
  return follow.openWikilink(page, heading, block);
}

/// Segue un link Markdown verso un documento del vault con la stessa regola.
export function followPath(follow: WikilinkFollow, path: string, gesture: WikilinkGesture): void | Promise<void> {
  if (wantsPeek(follow, gesture)) return follow.peekLink!({ kind: "path", path });
  return follow.openPath?.(path);
}

/// Il tasto che col clic apre un link nel testo: Cmd sul Mac, dove Ctrl col
/// clic è il tasto destro, Ctrl altrove. È la regola di `keyboardPlatform`
/// (`ui/commands.ts`), qui senza importare il registro dei comandi.
export function linkModifier(event: MouseEvent, platform: string = globalThis.navigator?.platform ?? ""): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? event.metaKey : event.ctrlKey;
}

/// Il nome di quel tasto, per le frasi che lo dicono: «Cmd» sul Mac, «Ctrl» altrove.
export function linkModifierName(platform: string = globalThis.navigator?.platform ?? ""): string {
  return /Mac|iPhone|iPad|iPod/i.test(platform) ? "Cmd" : "Ctrl";
}

/// Il gesto di un clic sul testo che si scrive: Alt sbircia, Ctrl (Cmd sul
/// Mac) è il clic che apre; `null` per il clic semplice, che è del cursore, e
/// per le combinazioni (Ctrl+Alt, Maiusc).
export function textLinkGesture(event: MouseEvent, platform?: string): WikilinkGesture | null {
  if (event.button !== 0 || event.shiftKey) return null;
  const mod = linkModifier(event, platform);
  if (event.altKey && !mod && !event.ctrlKey && !event.metaKey) return "peek";
  if (mod && !event.altKey) return "click";
  return null;
}

/// Il gesto di un clic su ciò che è reso: Alt sbircia, ogni altro clic è il
/// clic che apre.
export function renderedLinkGesture(event: MouseEvent): WikilinkGesture {
  return event.altKey && !event.ctrlKey && !event.metaKey ? "peek" : "click";
}

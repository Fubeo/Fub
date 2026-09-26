// Come il Markdown scrive un rimando a un'altra voce del vault.
//
// La shell dice **cosa** mettere nel documento — un allegato appena
// depositato, una nota trascinata dall'albero — e il profilo dice **come**:
// la sintassi è del formato, non di chi deposita il file.
import type { SurfaceReference } from "../../../core/registry";
import { mediaKindOfId } from "../../../media/media-types";

/// Il Markdown di un rimando. Immagini, audio, video e PDF si incorporano,
/// perché la lettura li sa mostrare; ogni altro allegato diventa un link col
/// suo nome — prima uno zip diventava un'immagine rotta. Una nota diventa un
/// wikilink col nome più corto che la risolve.
export function markdownReference(reference: SurfaceReference): string {
  if (reference.kind === "note") return `[[${reference.name}]]`;
  const link = reference.link;
  let name = link.split("/").pop() ?? link;
  try {
    name = decodeURIComponent(name);
  } catch {
    // Un nome non codificato resta com'è.
  }
  if (mediaKindOfId(name) !== "other") return `![](${link})`;
  return `[${name.replace(/[[\]\\]/g, "\\$&")}](${link})`;
}

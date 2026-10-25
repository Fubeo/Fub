// Lo scheletro: la sagoma di ciò che sta arrivando, quando tarda.
//
// Compare soltanto dopo `SKELETON_DELAY_MS`, così una risposta rapida non
// lampeggia. È fermo, senza luccichio: chi aspetta non ha bisogno di un
// movimento in più. Sta fuori dall'albero dell'accessibilità; l'attesa la
// dice `aria-busy` sul contenitore che lo ospita.
import { SKELETON_DELAY_MS } from "../moto";

export { SKELETON_DELAY_MS };

/// Uno scheletro di `lines` righe, in un elemento `tag` (un `li` dentro un
/// elenco). `rows` lo spazia come un elenco di voci invece che come un testo.
export function skeleton(lines: number, tag: "div" | "li" = "div", rows = false): HTMLElement {
  const box = document.createElement(tag);
  box.className = rows ? "skeleton skeleton-rows" : "skeleton";
  box.setAttribute("aria-hidden", "true");
  if (tag === "li") box.setAttribute("role", "none");
  for (let index = 0; index < lines; index++) {
    const line = document.createElement("span");
    line.className = "skeleton-line";
    box.append(line);
  }
  return box;
}

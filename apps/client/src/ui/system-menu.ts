// Il menu della WebView non compare dove Fub non ha il suo.
//
// I menu contestuali di Fub ascoltano `contextmenu` e lo annullano quando si
// aprono. Dove nessuno lo ascolta (l'area vuota dell'esploratore, il grafo,
// l'ispettore, i risultati, la banda di stato) la WebView mostrava il suo:
// «Ricarica», «Ispeziona», voci che in un'app non hanno senso. Il guardiano è
// uno, sul documento, dopo tutti gli altri: un menu che non è stato annullato
// lo annulla lui.
//
// Il menu del sistema resta dove serve: nei campi di testo (Taglia, Copia,
// Incolla, il correttore), sul testo scelto (Copia), sul lettore audio e video
// (velocità, ciclo, immagine nell'immagine) e con Maiuscolo, il gesto di chi
// lo vuole apposta.
import type { Lifetime } from "./lifetime";

const NATIVE = "input, textarea, [contenteditable]:not([contenteditable='false']), video, audio";

function onSelectedText(target: Node): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  for (let i = 0; i < selection.rangeCount; i++) {
    if (selection.getRangeAt(i).intersectsNode(target)) return true;
  }
  return false;
}

export function mountSystemMenuGuard(lifetime: Lifetime): void {
  lifetime.listen(document, "contextmenu", (e) => {
    if (e.defaultPrevented || e.shiftKey) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    if (target.closest(NATIVE) || onSelectedText(target)) return;
    e.preventDefault();
  });
}

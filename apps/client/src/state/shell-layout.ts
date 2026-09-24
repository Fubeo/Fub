// Applica un layout validato alla shell live con teardown corretto
// (F22): per ogni documento non più guardato da nessuna tab, `release`
// (flush+draft+close) invece di `close` nudo — il dirty non si perde, la
// bozza resta recuperabile via `recoverDrafts`. Le view uscite si smontano
// per pane. Il layout corrente non si tocca finché il nuovo non è pronto:
// prima si calcola (con fallback), poi si pubblica con `setLayout`, poi si
// disegna. Nessuna sessione duplicata: `(vault,doc)` resta unica.
import { documentSessions } from "./document-session";
import { panes, pane, panesWithDoc, setLayout, type Layout } from "./layout";

async function releaseUnwatched(next: Layout): Promise<void> {
  const wanted = new Set<string>();
  for (const paneState of Object.values(next.panes)) {
    for (const tab of paneState.tabs) {
      if (tab.k === "doc") wanted.add(tab.doc);
    }
  }
  const current: string[] = [];
  for (const id of panes()) {
    const p = pane(id);
    if (!p) continue;
    for (const tab of p.tabs) {
      if (tab.k === "doc" && !wanted.has(tab.doc)) {
        if (!current.includes(tab.doc)) current.push(tab.doc);
      }
    }
  }
  for (const id of current) {
    if (panesWithDoc(id, next).length > 0) continue;
    await documentSessions.release(id);
  }
}

/// Pubblica il layout e ridisegna i pannelli che dipendono da esso. Il
/// disegno vero resta di `panels/document.ts` via segnale `layout`.
export async function applyShellLayout(next: Layout): Promise<void> {
  await releaseUnwatched(next);
  setLayout(next);
  const doc = await import("../panels/document");
  await doc.synchronize();
  await doc.publishContext();
}

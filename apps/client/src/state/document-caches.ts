// Le cache che le superfici tengono sui documenti del vault — trasclusioni,
// rese già chieste — e il solo modo in cui il pannello le avverte.
//
// Il pannello sa **che cosa** è successo a un documento: cambiato da fuori,
// tolto, rinominato. Quale cache dipenda da quale documento lo sa soltanto chi
// la tiene, e si iscrive qui finché ne ha una viva. Un profilo nuovo con una
// cache sua non tocca il pannello.

export interface DocumentCache {
  /// Il documento è cambiato o non c'è più: ciò che ne dipende va richiesto
  /// di nuovo.
  invalidate(documentId: string): void;
  /// Il documento ha cambiato path.
  rename(from: string, to: string): void;
}

const caches = new Set<DocumentCache>();

/// Iscrive una cache; il ritorno la toglie.
export function registerDocumentCache(cache: DocumentCache): () => void {
  caches.add(cache);
  return () => {
    caches.delete(cache);
  };
}

export function invalidateDocumentCaches(documentId: string): void {
  for (const cache of [...caches]) cache.invalidate(documentId);
}

export function renameInDocumentCaches(from: string, to: string): void {
  for (const cache of [...caches]) cache.rename(from, to);
}

// Il guard canonico per i dati che attraversano un confine non tipizzato:
// stato di vista letto da disco, payload IPC, risposte di provider. Un punto
// solo, così i parser di `state/` non ne ricreano uno per file.
export function asRecord(v: unknown): { [k: string]: unknown } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as { [k: string]: unknown };
}

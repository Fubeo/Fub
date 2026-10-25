// Il risultato di un comando del provider, letto dal suo testo JSON. Serve
// alle finestre e ai menu della barra, che chiedono gli stessi comandi.

/// Il risultato di un comando come testo JSON, letto. Il provider dà sempre
/// un oggetto: un risultato che non lo è arriva in `{value}`.
export function readResult(text: string | null): unknown {
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/// Un elenco nel risultato di un comando: l'elenco stesso, o quello in
/// `{value}`.
export function resultList(result: unknown): readonly unknown[] | null {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object" && Array.isArray((result as { value?: unknown }).value)) {
    return (result as { value: unknown[] }).value;
  }
  return null;
}

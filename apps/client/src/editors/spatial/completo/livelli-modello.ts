// I livelli come li legge il motore del Completo (K6 T15, giro 4): la lettura `layers` di
// `document.inspect` (T11), ridotta a ciò che serve ai comandi di livello. Nel motore un livello di
// Fub si chiama col suo id della scena (`<g id="l1" fub:layer="Nome">` è il livello «l1»), perché la
// mappa lega per nome; il nome che si vede resta `fub:layer`, e lo legge l'albero nativo dalla scena.
// Qui serve il numero del motore (`id` della lettura), che i comandi `layer.*` vogliono negli `ids`.

/// Un livello o un sottolivello, come lo dà il motore.
export interface LivelloDelMotore {
  /// Il numero del motore (`id` nella lettura): è ciò che i comandi di livello vogliono.
  readonly id: number;
  /// Il nome nel motore: per un livello di Fub, il suo id della scena.
  readonly nome: string;
  readonly visibile: boolean;
  readonly bloccato: boolean;
  /// I sottolivelli, dall'alto in basso.
  readonly figli: readonly LivelloDelMotore[];
}

/// La lista di nodi che la lettura porta sotto `chiave`, se c'è.
function listaDi(lettura: unknown, chiave: string): unknown[] | null {
  if (typeof lettura !== "object" || lettura === null) return null;
  const lista = (lettura as Record<string, unknown>)[chiave];
  return Array.isArray(lista) ? lista : null;
}

/// Il numero del motore di un nodo: un intero non negativo, anche scritto come testo (gli id `u64`
/// passano il JSON come testo, `docs/reference/ipc-contract.md`). `null` se non lo è.
function numeroDi(valore: unknown): number | null {
  const numero = typeof valore === "string" && /^\d+$/.test(valore) ? Number(valore) : valore;
  return typeof numero === "number" && Number.isSafeInteger(numero) && numero >= 0 ? numero : null;
}

/// Un nodo della lettura come livello: solo i livelli passano (`kind` «Layer»), e un nodo che non ha
/// un numero o un nome non conta.
function livelloDi(nodo: unknown): LivelloDelMotore | null {
  if (typeof nodo !== "object" || nodo === null) return null;
  const v = nodo as Record<string, unknown>;
  const id = numeroDi(v.id);
  if (v.kind !== "Layer" || id === null || typeof v.name !== "string") return null;
  const figli = (listaDi(nodo, "children") ?? [])
    .map(livelloDi)
    .filter((f): f is LivelloDelMotore => f !== null)
    .reverse();
  return { id, nome: v.name, visibile: v.visible !== false, bloccato: v.locked === true, figli };
}

/// I livelli di primo piano della lettura intera di `document.inspect` (`layers`, senza filtri: una
/// lettura filtrata dà `nodes`, piatti, e qui non entra). Una lettura senza `layers` non ha livelli.
export function livelliDi(lettura: unknown): LivelloDelMotore[] {
  const nodi = listaDi(lettura, "layers") ?? [];
  return nodi.map(livelloDi).filter((l): l is LivelloDelMotore => l !== null);
}

/// Il numero del motore di ogni livello per il suo nome nel motore, cioè per l'id della scena di un
/// livello di Fub. Un nome che due livelli hanno (non succede con gli id della scena, che sono unici)
/// non entra: il comando non saprebbe quale dei due cambiare. Il livello implicito del motore
/// (gli elementi fuori dai livelli) ha un nome che nessun id della scena ha, e non si cerca mai.
export function numeriDeiLivelli(livelli: readonly LivelloDelMotore[]): ReadonlyMap<string, number> {
  const numeri = new Map<string, number>();
  const doppi = new Set<string>();
  const scendi = (nodi: readonly LivelloDelMotore[]): void => {
    for (const nodo of nodi) {
      if (numeri.has(nodo.nome)) doppi.add(nodo.nome);
      else numeri.set(nodo.nome, nodo.id);
      scendi(nodo.figli);
    }
  };
  scendi(livelli);
  for (const nome of doppi) numeri.delete(nome);
  return numeri;
}

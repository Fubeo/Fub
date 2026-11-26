// Gli spazi di lavoro salvati dall'utente (piano K6, T7; l'impostazione
// `draw.workspaces`, che dichiara `crates/fub-features/src/draw.rs`).
//
// L'impostazione del vault è un elenco di stringhe JSON, una per spazio, e
// ognuna ha la sua versione (`"v": 1`). Chi legge tiene le voci come sono:
// una voce rotta si ignora (la menziona l'avviso), e una di una versione più
// nuova si mostra spenta, senza usarla. Chi scrive riporta tali e quali le
// voci che non legge: una scrittura non cancella ciò che non sa leggere.
//
// Qui niente DOM e niente impostazioni: solo il formato, così il menu, la
// finestra di gestione e il test lo usano allo stesso modo.

/// La versione che questo client scrive e legge.
export const SAVED_WORKSPACE_VERSION = 1;

/// La sezione o la scheda che uno spazio può aprire: le due che il disegno ha
/// (`DrawPanelId` in `chrome/hosts.ts`, senza le altre due).
export type SchedaSalvata = "design" | "layers";

/// Uno spazio salvato, come si legge da una voce della versione 1.
export interface SpazioSalvato {
  /// Stabile: il `draw.workspace` del vault lo nomina così.
  readonly id: string;
  /// Il nome che l'utente ha dato; unico fra gli spazi salvati, senza badare
  /// alle maiuscole.
  readonly nome: string;
  /// Gli strumenti della colonna, in ordine; vuoto, la colonna di serie.
  readonly colonna: readonly string[];
  readonly scheda: SchedaSalvata;
  /// La sezione dell'ispettore aperta, o `null`.
  readonly sezione: string | null;
  readonly righelli: boolean;
}

/// Una voce dell'elenco come si legge: uno spazio che si usa, una di una
/// versione più nuova (si mostra, non si usa), o una rotta (si ignora).
export type VoceSalvata =
  | { readonly kind: "spazio"; readonly raw: string; readonly spazio: SpazioSalvato }
  | { readonly kind: "piuNuova"; readonly raw: string; readonly nome: string | null }
  | { readonly kind: "rotta"; readonly raw: string };

/// Il perché di un'operazione che non si fa sull'elenco.
export type EsitoSalvataggio = "nome-occupato" | "non-trovato";

/// Il testo, se lo è e non è vuoto dopo gli spazi.
function testo(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const pulito = value.trim();
  return pulito === "" ? null : pulito;
}

/// La voce come si legge. Una stringa che non è JSON, o un oggetto con campi
/// che la versione 1 non ha, è rotta.
export function leggiVoce(raw: string): VoceSalvata {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: "rotta", raw };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { kind: "rotta", raw };
  const dati = value as Record<string, unknown>;
  const versione = dati.v;
  if (typeof versione === "number" && versione > SAVED_WORKSPACE_VERSION) {
    return { kind: "piuNuova", raw, nome: testo(dati.nome) };
  }
  if (versione !== SAVED_WORKSPACE_VERSION) return { kind: "rotta", raw };
  const id = testo(dati.id);
  const nome = testo(dati.nome);
  const scheda = dati.scheda;
  const colonna = dati.colonna;
  const sezione = dati.sezione;
  const righelli = dati.righelli;
  const valida =
    id !== null &&
    nome !== null &&
    (scheda === "design" || scheda === "layers") &&
    Array.isArray(colonna) &&
    colonna.every((item) => typeof item === "string") &&
    (sezione === null || typeof sezione === "string") &&
    typeof righelli === "boolean";
  if (!valida) return { kind: "rotta", raw };
  return {
    kind: "spazio",
    raw,
    spazio: {
      id,
      nome,
      colonna: [...colonna as string[]],
      scheda,
      sezione: sezione as string | null,
      righelli,
    },
  };
}

/// Le voci di un elenco come si leggono, nello stesso ordine.
export function leggiSpazi(raws: readonly string[]): readonly VoceSalvata[] {
  return raws.map(leggiVoce);
}

/// Gli spazi che si usano, in ordine.
export function spaziUsabili(voci: readonly VoceSalvata[]): readonly SpazioSalvato[] {
  return voci.flatMap((voce) => (voce.kind === "spazio" ? [voce.spazio] : []));
}

/// La voce JSON di uno spazio, con la versione per prima.
export function scriviVoce(spazio: SpazioSalvato): string {
  return JSON.stringify({
    v: SAVED_WORKSPACE_VERSION,
    id: spazio.id,
    nome: spazio.nome,
    colonna: [...spazio.colonna],
    scheda: spazio.scheda,
    sezione: spazio.sezione,
    righelli: spazio.righelli,
  });
}

/// Il confronto dei nomi: senza maiuscole, e senza spazi attorno.
export function stessoNome(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

/// Il nome è già di un altro spazio, usabile o di una versione più nuova: non
/// si sovrascrive una voce che non si capisce.
function nomeOccupato(voci: readonly VoceSalvata[], nome: string, idDaEscludere: string | null): boolean {
  return voci.some((voce) => {
    if (voce.kind === "spazio") return voce.spazio.id !== idDaEscludere && stessoNome(voce.spazio.nome, nome);
    if (voce.kind === "piuNuova") return voce.nome !== null && stessoNome(voce.nome, nome);
    return false;
  });
}

/// Aggiunge lo spazio `spazio`, o sostituisce quello che ha il suo id, o il suo
/// nome. Le voci rotte e le più nuove restano come sono, nello stesso posto.
/// Un nome che è di una voce più nuova non si prende: torna `nome-occupato`.
export function salvaSpazio(raws: readonly string[], spazio: SpazioSalvato): readonly string[] | EsitoSalvataggio {
  const voci = leggiSpazi(raws);
  const stesso = voci.find((voce) => voce.kind === "spazio" && (voce.spazio.id === spazio.id || stessoNome(voce.spazio.nome, spazio.nome)));
  if (stesso === undefined && nomeOccupato(voci, spazio.nome, null)) return "nome-occupato";
  if (stesso !== undefined && stesso.kind === "spazio") {
    // Lo stesso nome: si riscrive lo spazio che c'è, col suo id, perché un
    // `draw.workspace` che lo nomina continui a trovarlo.
    if (nomeOccupato(voci, spazio.nome, stesso.spazio.id)) return "nome-occupato";
    return raws.map((raw) => (raw === stesso.raw ? scriviVoce({ ...spazio, id: stesso.spazio.id }) : raw));
  }
  return [...raws, scriviVoce(spazio)];
}

/// Rinomina lo spazio `id`. Un nome già di un altro spazio, o di una voce più
/// nuova, non si prende.
export function rinominaSpazio(raws: readonly string[], id: string, nome: string): readonly string[] | EsitoSalvataggio {
  const voci = leggiSpazi(raws);
  const voce = voci.find((each) => each.kind === "spazio" && each.spazio.id === id);
  if (voce === undefined || voce.kind !== "spazio") return "non-trovato";
  if (nomeOccupato(voci, nome, id)) return "nome-occupato";
  return raws.map((raw) => (raw === voce.raw ? scriviVoce({ ...voce.spazio, nome: nome.trim() }) : raw));
}

/// Toglie lo spazio `id`; le altre voci restano come sono.
export function eliminaSpazio(raws: readonly string[], id: string): readonly string[] | EsitoSalvataggio {
  const voce = leggiSpazi(raws).find((each) => each.kind === "spazio" && each.spazio.id === id);
  if (voce === undefined) return "non-trovato";
  return raws.filter((raw) => raw !== voce.raw);
}

/// Un id nuovo, che non compare in nessuna voce (anche rotta o più nuova): così
/// un id vecchio, ricordato da un `draw.workspace`, non torna a indicare altro.
export function nuovoIdSpazio(raws: readonly string[], seme: number = Date.now()): string {
  for (let n = seme; ; n += 1) {
    const id = `salvato-${n.toString(36)}`;
    if (!raws.some((raw) => raw.includes(id))) return id;
  }
}

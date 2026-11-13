// I componenti accesi del vault aperto (K2): la mappa di `components_map`,
// letta una volta all'apertura e riletta quando l'host dice che una scelta
// l'ha cambiata. Registro degli editor, menu e riquadro «solo come file»
// leggono da qui, e nessuno ricalcola in TypeScript chi richiede chi (Q-4):
// la regola è dell'host, qui c'è soltanto il suo esito.
//
// Uno per vault: lo stato porta il `root` da cui è stato letto, e una lettura
// cominciata per un vault non arriva mai a un altro. Le letture non si
// sovrappongono: un evento arrivato mentre una è in volo chiede **un** giro in
// più, quanti che siano gli eventi (una scelta applicata ne manda anche sei),
// e la `Race` butta una risposta che un vault nuovo ha reso vecchia.

import { api } from "../host/ipc";
import { LANGUAGE_KEY } from "../i18n/strings";
import type { ComponentRow, ComponentsMap, SettingEntry } from "../host/contract";
import { Race } from "../ui/race";
import type { Lifetime } from "../ui/lifetime";
import { onEvent } from "./kernel";
import { on, openVaultRoot, vaultArg } from "./store";

/// Le chiavi dopo le quali la mappa va riletta: le quattro dello stato dei
/// componenti (D-5), l'elenco dei plugin spenti, che una scelta scrive una
/// volta per bundle, e la lingua, perché i nomi arrivano già tradotti.
const COMPONENT_KEYS = /^components\./;
const DISABLED_KEY = "plugins.disabled";

/// I componenti di un vault, come li ha detti l'host.
export class Components {
  readonly #rows: ReadonlyMap<string, ComponentRow>;

  constructor(
    /// Il vault da cui viene la mappa.
    readonly root: string,
    /// La mappa, o `null` se `components_map` non ha risposto: allora vale
    /// come un vault senza le chiavi dei componenti, tutto acceso tranne i
    /// plugin spenti (A1).
    readonly map: ComponentsMap | null,
    /// I plugin spenti, letti soltanto quando la mappa manca.
    readonly disabled: readonly string[] = [],
  ) {
    this.#rows = new Map((map?.righe ?? []).map((row) => [row.id, row]));
  }

  /// I pezzi di interfaccia che la mappa nomina, accesi o spenti.
  get uis(): string[] {
    return [...new Set((this.map?.righe ?? []).flatMap((row) => row.ui))];
  }

  /// Il componente `id` è acceso? Senza mappa lo è, se nessuno ha spento il
  /// suo plugin.
  on(id: string): boolean {
    if (!this.map) return !this.disabled.includes(id);
    return this.#rows.get(id)?.acceso ?? false;
  }

  /// La riga del componente `id`, col nome già nella lingua del vault.
  row(id: string): ComponentRow | undefined {
    return this.#rows.get(id);
  }

  /// Il pezzo di interfaccia `ui` (`editors/canvas`, …) è acceso: almeno una
  /// riga accesa lo carica, o nessuna riga lo nomina — allora non è legato a
  /// un componente e resta del nucleo. Senza mappa ogni pezzo è acceso: i
  /// formati di un plugin spento li toglie già l'host.
  uiOn(ui: string): boolean {
    if (!this.map) return true;
    let named = false;
    for (const row of this.map.righe) {
      if (!row.ui.includes(ui)) continue;
      if (row.acceso) return true;
      named = true;
    }
    return !named;
  }

  /// La riga spenta che accenderebbe `ui`, per il pulsante «Accendi …».
  offRowFor(ui: string): ComponentRow | null {
    if (!this.map || this.uiOn(ui)) return null;
    return this.map.righe.find((row) => row.ui.includes(ui)) ?? null;
  }

  /// Le stesse cose accese, con gli stessi nomi, di `other`: chi ascolta non
  /// ridisegna per niente, ma ridisegna quando cambia la lingua.
  sameAs(other: Components | null): boolean {
    if (!other || other.root !== this.root || !!other.map !== !!this.map) return false;
    if (!this.map || !other.map) return other.disabled.join("\n") === this.disabled.join("\n");
    if (other.map.righe.length !== this.map.righe.length) return false;
    return this.map.righe.every((row) => {
      const twin = other.row(row.id);
      return twin?.acceso === row.acceso && twin.nome === row.nome;
    });
  }
}

type Listener = (next: Components, previous: Components | null) => void;

interface VaultComponents {
  readonly root: string;
  current: Components | null;
  /// La lettura in volo, che chi apre un file di un componente aspetta.
  reading: Promise<Components> | null;
  /// Un evento è arrivato durante la lettura: ne serve un'altra, una sola.
  again: boolean;
}

let vault: VaultComponents | null = null;
const race = new Race();
const listeners = new Set<Listener>();
const readers = new Set<(next: Components) => void>();

/// I componenti del vault aperto, se la mappa è già arrivata.
export function components(): Components | null {
  const root = openVaultRoot();
  return root !== undefined && vault?.root === root ? vault.current : null;
}

/// I componenti del vault aperto, aspettando la lettura se è in volo, o
/// cominciandola se non c'è ancora: chi apre un file legato a un componente
/// non indovina. `null` senza un vault aperto.
export function componentsReady(): Promise<Components | null> {
  const root = openVaultRoot();
  if (root === undefined) return Promise.resolve(null);
  const entry = vaultEntry(root);
  if (entry.reading) return entry.reading;
  if (entry.current) return Promise.resolve(entry.current);
  return read(entry);
}

/// Chi deve sapere quando cambia ciò che è acceso: il registro, i menu, i
/// riquadri. Il disposer toglie l'ascolto.
export function onComponents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/// Chi mostra la mappa intera (la pagina «Componenti»: profilo, perché, chi è
/// in attesa) e deve saperlo a ogni lettura, anche quando ciò che è acceso
/// resta com'era. Il disposer toglie l'ascolto.
export function onComponentsRead(listener: (next: Components) => void): () => void {
  readers.add(listener);
  return () => readers.delete(listener);
}

function vaultEntry(root: string): VaultComponents {
  if (vault?.root !== root) {
    race.cancel();
    vault = { root, current: null, reading: null, again: false };
  }
  return vault;
}

/// Una lettura della mappa per il vault di `entry`. Se ne è già in volo una,
/// questa diventa il giro in più che la segue (uno solo, quanti che siano gli
/// eventi), e chi la chiede aspetta la fine di quel giro: la risposta vecchia
/// non arriva mai a chi ascolta, solo l'ultima.
function read(entry: VaultComponents): Promise<Components> {
  if (entry.reading) {
    entry.again = true;
    return entry.reading;
  }
  const reading = (async (): Promise<Components> => {
    try {
      let next: Components | undefined;
      do {
        entry.again = false;
        next = await race.last(async (expected) => expected(fetchComponents(entry.root)));
        // Scaduta: un vault nuovo ha preso il posto di questo, e la sua
        // lettura è un'altra. Chi aspettava questa riceve ciò che c'era.
        if (next === undefined) {
          entry.reading = null;
          return entry.current ?? new Components(entry.root, null);
        }
      } while (entry.again);
      // Nello stesso istante in cui il giro finisce: un evento che arriva
      // subito dopo trova la lettura chiusa e ne comincia una nuova, invece
      // di ricevere questa già finita.
      entry.reading = null;
      publish(entry, next);
      return next;
    } catch (error) {
      entry.reading = null;
      throw error;
    }
  })();
  entry.reading = reading;
  return reading;
}

/// La mappa nuova di `entry` diventa quella corrente, e chi ascolta lo sa se
/// è cambiato qualcosa.
function publish(entry: VaultComponents, next: Components): void {
  if (vault !== entry) return;
  const previous = entry.current;
  entry.current = next;
  for (const reader of [...readers]) {
    try {
      reader(next);
    } catch (error) {
      console.error(error);
    }
  }
  if (next.sameAs(previous)) return;
  for (const listener of [...listeners]) {
    try {
      listener(next, previous);
    } catch (error) {
      console.error(error);
    }
  }
}

/// La mappa del vault `root`. Se l'host non risponde vale tutto acceso tranne
/// i plugin spenti (A1), e l'errore va nei log.
async function fetchComponents(root: string): Promise<Components> {
  try {
    return new Components(root, await api.componentsMap(root));
  } catch (error) {
    console.error("Fub: la mappa dei componenti non si legge.", error);
    return new Components(root, null, await disabledPlugins(root));
  }
}

async function disabledPlugins(root: string): Promise<string[]> {
  try {
    const response = await api.queryIndex({ kind: "settings", plugin: null }, ...vaultArg(root));
    const entries: SettingEntry[] = response.kind === "settings" ? response.value : [];
    const value = entries.find((entry) => entry.spec.key === DISABLED_KEY)?.value;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/// Rilegge la mappa del vault aperto, se ce n'è uno: chi ha appena applicato
/// una scelta la aspetta, invece di contare sugli eventi.
export function refreshComponents(): Promise<Components | null> {
  const root = openVaultRoot();
  if (root === undefined) return Promise.resolve(null);
  return read(vaultEntry(root));
}

/// Gli ascolti che tengono la mappa fresca, ciascuno col suo disposer nella
/// vita di chi monta.
///
/// Una scelta manda i suoi eventi di fila (una chiave per volta, poi il
/// rimontaggio del vault), e nell'host vero ognuno arriva in un task suo. Li
/// fonde la coda di `read`, senza timer: una lettura in volo e al più una in
/// attesa, che parte quando la prima finisce, e chi ascolta sente soltanto
/// l'ultima. Il gesto della pagina (`refreshComponents`) passa dalla stessa
/// coda: una scelta con quanti eventi si voglia fa al più due letture. Gli
/// eventi arrivati nello stesso giro di microtask chiedono un giro solo, ma è
/// un risparmio in più: la garanzia è della coda. Chi ascolta (registro, menu,
/// la pagina «Componenti») non legge da sé.
export function mountComponents(lifetime: Lifetime): void {
  let asked = false;
  const refresh = (): void => {
    if (asked) return;
    asked = true;
    queueMicrotask(() => {
      asked = false;
      if (lifetime.closed) return;
      void refreshComponents().catch((error: unknown) => console.error(error));
    });
  };
  lifetime.add(onEvent("setting_changed", ({ key }) => {
    if (COMPONENT_KEYS.test(key) || key === DISABLED_KEY || key === LANGUAGE_KEY) refresh();
  }));
  lifetime.add(onEvent("vault_opened", ({ root }) => {
    if (root === openVaultRoot()) refresh();
  }));
  // Un vault aperto dalla shell: se la lettura non è già partita col primo
  // giro dei riquadri, parte qui.
  lifetime.add(on("vault", () => void componentsReady().catch((error: unknown) => console.error(error))));
  lifetime.add(() => {
    race.cancel();
    vault = null;
  });
}

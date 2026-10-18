// Ciò che la shell deve dare al correttore, senza il correttore: il tipo delle
// porte e il namespace della route. Sta da solo perché chi compone le
// superfici lo importa subito, mentre il client e gli adattatori si caricano
// soltanto quando una superficie li monta.
import type { IndexQuery, IndexResult, SettingEntry } from "../../host/contract";

/// Il namespace della route, che è anche l'id della feature.
export const PROOF_NS = "fub.proof";

/// Le porte che il client usa. La shell le lega al vault del documento; i test
/// le sostituiscono con un host finto.
export interface ProofPorts {
  queryIndex(query: IndexQuery): Promise<IndexResult>;
  invokeCommand(command: string, args: Record<string, unknown>): Promise<{ notify?: string | null }>;
  /// Le impostazioni di `fub.proof`.
  settings(): Promise<SettingEntry[]>;
  /// La lingua dell'interfaccia, per l'impostazione `auto`.
  interfaceLanguage(): string;
  /// Chiama `changed` quando la configurazione può essere cambiata: un'impostazione,
  /// la lingua dell'interfaccia, un vault riaperto. Torna come smettere.
  watch(changed: () => void): () => void;
}

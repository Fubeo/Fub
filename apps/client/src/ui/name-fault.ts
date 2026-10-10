// La frase di ciascun guasto di un nome che nasce (`rules/mirrored.ts`), per
// chi lo giudica prima di mandarlo: il riquadro dei file quando rinomina, e
// «Importa disegno» quando sceglie il nome del disegno nuovo.

import { t, type Key } from "../i18n/strings";
import type { NameFault } from "../rules/mirrored";

/// La mappa è un `Record` **esaustivo**, quindi un'etichetta nuova in
/// `NameFault` non compila finché non ha la sua chiave di catalogo. Un
/// `` `name_fault.${tag}` `` composto a mano avrebbe compilato sempre, e la
/// chiave mancante sarebbe comparsa a schermo.
const REASON: Record<NameFault, Key> = {
  empty: "name_fault.empty",
  traversal: "name_fault.traversal",
  machine: "name_fault.machine",
  control: "name_fault.control",
  reserved: "name_fault.reserved",
  device: "name_fault.device",
  "trailing-dot": "name_fault.trailing_dot",
  hidden: "name_fault.hidden",
  "too-long": "name_fault.too_long",
};

/// Perché un nome non si usa, nella lingua dell'interfaccia.
export function nameFaultText(fault: NameFault): string {
  return t(REASON[fault]);
}

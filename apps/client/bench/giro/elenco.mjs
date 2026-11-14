// **L'elenco del giro**: i gruppi di compiti, nell'ordine in cui una persona
// li fa nella pre-alpha. Il corridore (`bench/giro.mjs`) li fa girare di
// fila, sulla stessa pagina: un compito parte da dove il precedente l'ha
// lasciata, e il primo che fallisce ferma il giro.
//
// Un gruppo è `{ id, nome, compiti, prepara? }`:
//
// - `id` è il nome che `--solo=<id>` sceglie;
// - `compiti` sono i compiti del gruppo, in ordine (la forma è in `giro.mjs`);
// - `prepara(pagina, giro)`, facoltativo, porta la pagina al punto da cui il
//   gruppo parte quando gira da solo (`--solo`). Senza, il corridore apre il
//   vault del banco e aspetta la cornice pronta, cioè lo stato in cui il
//   gruppo «avvio» lascia la pagina.
//
// Un gruppo che non c'è ancora non si importa: lo aggiunge il suo task
// (PA T26 le note, T27 Word, Excel, SVG e PDF, T28 la lavagna e la penna,
// T29 ricette, componenti e aspetto, T30 conflitto, sola lettura, cestino,
// tastiera e guasti), una riga qui e il suo file accanto.
import { avvio } from "./avvio.mjs";
import { scrivere } from "./scrivere.mjs";
import { guasti } from "./guasti.mjs";

export const GRUPPI = [avvio, scrivere, guasti];

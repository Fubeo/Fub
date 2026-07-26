// Il sidecar dell'organizzazione: icone, note appuntate, ordinamenti
// per-cartella e spazi (`.fubmd/workspace.json`, decisioni O1–O9).
//
// È **autorevole, non derivato**: il kernel non ne sa nulla, e se il file è
// illeggibile non lo si sovrascrive — si lavora col default e si congela il
// salvataggio, perché salvare sopra a ciò che non si è riusciti a leggere è il
// modo più rapido di cancellare l'organizzazione di un utente.
//
// Sta in `state/` e non in `panels/explorer.ts` perché è **dato del vault** con
// un suo ciclo di vita (si carica all'apertura, migra ai rename, si salva a
// ogni ritocco): l'explorer ne è oggi l'unico lettore, ma il primo comando che
// appunterà una nota lo farà senza passare da un pannello.
import { api } from "../host/ipc";
import { childName, parentOf } from "../rules/organizer";
import { emit, metaVuota, state } from "./store";

/// Carica il sidecar del vault appena aperto. Non lancia: un sidecar rotto è
/// una condizione prevista, non un avvio fallito.
export async function loadOrganization(): Promise<void> {
  try {
    state.meta = await api.readWorkspaceMeta();
    state.metaBroken = false;
  } catch (e) {
    console.error(`FubMD: organizzazione del vault illeggibile, la congelo: ${e}`);
    state.meta = metaVuota();
    state.metaBroken = true;
  }
}

/// Scrive il sidecar e annuncia che l'organizzazione è cambiata.
export async function saveOrganization(): Promise<void> {
  emit("organization");
  if (state.metaBroken) return;
  try {
    await api.writeWorkspaceMeta(state.meta);
  } catch (e) {
    console.error(`FubMD: organizzazione del vault non salvata: ${e}`);
  }
}

/// Un rename (anche uno spostamento) porta con sé icona, pin e posto
/// nell'ordinamento: sono attaccati alla nota, non al suo vecchio path.
export function migrateOrganization(from: string, to: string): void {
  let cambiata = false;
  const icon = state.meta.icons[from];
  if (icon) {
    delete state.meta.icons[from];
    state.meta.icons[to] = icon;
    cambiata = true;
  }
  const i = state.meta.pinned.indexOf(from);
  if (i !== -1) {
    state.meta.pinned[i] = to;
    cambiata = true;
  }
  const ordine = state.meta.order[parentOf(from)];
  const posto = ordine?.indexOf(childName(from)) ?? -1;
  if (ordine && posto !== -1) {
    if (parentOf(from) === parentOf(to)) ordine[posto] = childName(to);
    else ordine.splice(posto, 1);
    cambiata = true;
  }
  if (cambiata) void saveOrganization();
}

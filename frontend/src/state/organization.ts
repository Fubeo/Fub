// L'organizzazione del vault: icone, note appuntate, ordinamenti per-cartella e
// spazi (`.fub/workspace.json`, decisioni O1–O9 e §11.3).
//
// È **autorevole, non derivato**: persa, non si ricostruisce. Dal §11.3 il file
// lo possiede il **kernel** — versione di schema, scrittura atomica, e un file
// che non si è potuto leggere non si riscrive — e questo modulo è ciò che ne
// resta di qua: uno specchio di ciò che il backend tiene, più le quattro
// scritture.
//
// Cosa è cambiato, e perché conta:
//
// - si **legge dal canale dati** (`organizzazione()`), come le impostazioni e i
//   tag: la stessa domanda che potrebbe fare un provider, dalla stessa porta;
// - si **scrive per chiave** e non a blob intero. Prima questo modulo rileggeva
//   tutto, cambiava un campo e riscriveva tutto: con due finestre sullo stesso
//   vault era una *lost update* — la seconda che salva cancella ciò che ha fatto
//   la prima, e nessuna delle due se ne accorge;
// - la **migrazione sui rename non è più qui**. C'era una `migrateOrganization`
//   che spostava icona, pin e posto quando la shell vedeva un `document_renamed`,
//   e dipendeva da un evento che può essere troncato (decisione 0034) e che a
//   Fub chiuso non arriva affatto. Adesso la fa il kernel dentro l'operazione
//   che sposta l'identità, quindi vale anche per le rinomine fatte da un'altra
//   app mentre Fub è aperto.
//
// Resta in `state/` e non in `panels/explorer.ts` perché è **dato del vault**:
// l'explorer ne è oggi l'unico lettore, ma il primo comando che appunterà una
// nota lo farà senza passare da un pannello.
import { api } from "../host/ipc";
import { organizzazione } from "../host/query";
import { emit, metaVuota, state } from "./store";
import { errorText } from "../host/errors";

/// Rilegge l'organizzazione del vault appena aperto. Non lancia: un sidecar
/// rotto è una condizione prevista, non un avvio fallito — il kernel risponde
/// con l'organizzazione vuota e rifiuta le scritture una per una, che è ciò che
/// tiene al sicuro quella che non è riuscito a leggere.
export async function loadOrganization(): Promise<void> {
  try {
    state.meta = await organizzazione();
  } catch (e) {
    console.error(`Fub: organizzazione del vault illeggibile: ${errorText(e)}`);
    state.meta = metaVuota();
  }
}

/// L'emoji accanto a una nota o a una cartella (`null` la toglie).
export async function setIcon(path: string, icon: string | null): Promise<void> {
  await scrivi(() => api.setIcon(path, icon), (org) => {
    if (icon) org.icons[path] = icon;
    else delete org.icons[path];
  });
}

/// Appunta o spunta una nota.
export async function setPinned(id: string, pinned: boolean): Promise<void> {
  await scrivi(() => api.setPinned(id, pinned), (org) => {
    const i = org.pinned.indexOf(id);
    if (pinned && i === -1) org.pinned.push(id);
    if (!pinned && i !== -1) org.pinned.splice(i, 1);
  });
}

/// Registra o toglie una cartella dagli spazi.
export async function setSpace(path: string, space: boolean): Promise<void> {
  await scrivi(() => api.setSpace(path, space), (org) => {
    const i = org.spaces.indexOf(path);
    if (space && i === -1) org.spaces.push(path);
    if (!space && i !== -1) org.spaces.splice(i, 1);
  });
}

/// L'ordine scelto a mano dei figli di una cartella (vuoto = alfabetico).
export async function setOrder(folder: string, names: string[]): Promise<void> {
  await scrivi(() => api.setOrder(folder, names), (org) => {
    if (names.length > 0) org.order[folder] = names;
    else delete org.order[folder];
  });
}

/// Una scrittura, e lo specchio locale che la segue.
///
/// **Prima il backend, poi lo specchio**, che è il verso opposto a quello di
/// prima: con l'ottimismo al contrario una scrittura rifiutata — un sidecar che
/// non si è potuto leggere — lascerebbe la sidebar a mostrare un'icona che sul
/// disco non c'è, e l'utente la ritroverebbe sparita alla riapertura.
///
/// Rileggere l'organizzazione intera dopo ogni ritocco sarebbe l'alternativa
/// pulita e costa un giro di IPC per click: `applica` fa localmente la stessa
/// cosa che il kernel ha appena fatto, e sono quattro righe per quattro chiavi.
async function scrivi(
  scrittura: () => Promise<void>,
  applica: (org: typeof state.meta) => void,
): Promise<void> {
  try {
    await scrittura();
  } catch (e) {
    console.error(`Fub: organizzazione non salvata: ${errorText(e)}`);
    return;
  }
  applica(state.meta);
  emit("organization");
}

// Le operazioni che cambiano il vault, in un posto solo.
//
// Nessuna di queste funzioni disegna niente e nessuna apre un documento: fanno
// l'operazione, aggiornano lo stato condiviso e **restituiscono** ciò che serve
// a chi le ha chiamate. È la regola che tiene i moduli aciclici — se `createNote`
// aprisse da sé la nota creata dovrebbe importare il pannello del documento, e
// il pannello del documento importa questo per creare la nota di un wikilink
// non risolto.
//
// Tutte passano dal **registro dei comandi** (decisione 0013): la shell chiede «crea
// una nota» esattamente come la chiederebbe una CLI, una macro o un plugin. È
// per questo che qui non c'è quasi nulla — la logica sta nelle feature, e
// questo modulo è solo il posto dove la shell smette di avere scorciatoie.
import { api } from "../host/ipc";
import { vociDelVault } from "../host/query";
import { COMANDI } from "../host/contract";
import { emit, state } from "./store";
import { t } from "../i18n/strings";

/// Annuncia che l'elenco dei documenti è cambiato. Chi ne disegna uno si
/// iscrive a `documents`; nessuno chiama nessuno per nome.
///
/// **Non porta più la lista** (§14.4): la portava, ed era l'intero vault
/// chiesto a ogni creazione, rinomina o ripristino per ridisegnare venti righe.
/// Chi disegna chiede la parte che gli serve — l'albero una cartella per volta,
/// la palette i nomi che le servono — e questo segnale dice solo *quando*.
export function refreshDocuments(): void {
  emit("documents");
}

/// La prima nota del vault, in ordine di path, o `null` se non ce ne sono.
///
/// Una domanda con una finestra da **uno**, e non l'elenco intero da cui
/// prendere il primo: è ciò che serve a chi deve aprire *qualcosa* dopo aver
/// chiuso il documento che stava guardando.
export async function primaNota(): Promise<string | null> {
  const page = await vociDelVault("document", undefined, { offset: 0, limit: 1 });
  return page.items[0]?.id ?? null;
}

/// Crea una nota e restituisce il suo id — **non** la apre.
///
/// L'id non torna come valore del comando ma come **effetto** (`navigate`): un
/// `CommandOutcome` non porta dati, porta ciò che la shell deve fare dopo — ed
/// è la stessa strada che percorre `trash.restore`, o un comando di un plugin
/// che crei una nota da un template. `null` significa che il comando è
/// riuscito ma non ha detto dove: non è un caso previsto, e chi chiama decide
/// se è un errore da mostrare.
export async function createNote(name?: string): Promise<string | null> {
  const outcome = await api.invokeCommand(COMANDI.crea, name ? { name } : undefined);
  refreshDocuments();
  return outcome.effect.kind === "navigate" ? outcome.effect.doc : null;
}

/// Rinomina (o sposta: è la stessa operazione, l'identità è il path).
///
/// Il rename riscrive i wikilink entranti, cioè file di terzi — chi chiama deve
/// aver messo in salvo il buffer prima, o la riscrittura del kernel finirebbe
/// sotto una copia più vecchia. `currentDoc` non si aggiorna qui: lo fa
/// l'evento `document_renamed`, perché l'identità è il path e chi la migra deve
/// essere un punto solo.
export async function renameNote(from: string, to: string): Promise<void> {
  await api.invokeCommand(COMANDI.rinomina, { doc: from, to });
  refreshDocuments();
}

/// Sposta una nota nel cestino.
export async function trashNote(id: string): Promise<void> {
  await api.invokeCommand(COMANDI.cestina, { doc: id });
}

/// Ripristina dal cestino e dice **dove** la nota è tornata.
///
/// Il comando non risponde con un id — non è ciò che un `CommandOutcome` sa
/// fare — ma con l'effetto `navigate`, che è *anche* ciò che la shell deve fare
/// dopo. Un effetto diverso qui sarebbe un comando che ha cambiato semantica
/// sotto i piedi di chi lo invoca, e vale la pena dirlo invece di ignorarlo.
export async function restoreFromTrash(entry: string, to?: string): Promise<string> {
  const outcome = await api.invokeCommand(COMANDI.ripristina, {
    entry,
    ...(to ? { to } : {}),
  });
  if (outcome.effect.kind !== "navigate") {
    throw new Error(`${COMANDI.ripristina} non ha detto dove è tornata la nota`);
  }
  return outcome.effect.doc;
}

/// Svuota il cestino e restituisce il messaggio che il comando ha prodotto.
export async function emptyTrash(): Promise<string> {
  const outcome = await api.invokeCommand(COMANDI.svuota);
  return outcome.notify ?? t("trash.emptied");
}

/// Il primo nome libero della famiglia «Nota», «Nota 1», … (D3): la convenzione
/// vive nel kernel, chiederla evita di averne una seconda copia qui.
export function proposeFreeName(id: string): Promise<string> {
  return api.proposeFreeName(id);
}

/// I comandi dichiarati dal kernel, per le scorciatoie di tastiera.
///
/// La palette li richiede da sé quando si apre — è il momento in cui costa
/// nulla ed è l'unico in cui devono essere freschi; qui servono a riconoscere
/// una combinazione di tasti senza un giro sull'IPC a ogni pressione.
export async function loadCommandSpecs(): Promise<void> {
  state.commandSpecs = await api.listCommands().catch(() => []);
}

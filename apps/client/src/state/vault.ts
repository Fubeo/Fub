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
import { settings, vaultEntries, vaultFolders, WITHOUT_PAGE } from "../host/query";
import { importDropped, type Dropped, type ImportOutcome } from "../ui/vault-transfer";
import { COMMANDS, type CommandOutcome, type Undo } from "../host/contract";
import { emit, openVaultRoot, setCommandSpecs, state, vaultArg } from "./store";
import { folderForNote } from "../rules/mirrored";
import { notify } from "../ui/notify";
import { errorText } from "../host/errors";
import { t } from "../i18n/strings";

// `openVaultRoot` e `vaultArg` vivono in `state/store.ts` e si ripresentano
// qui, dove i gesti li cercano da sempre (FUB-001).
export { openVaultRoot, vaultArg };

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
export async function beforeNote(): Promise<string | null> {
  const page = await vaultEntries({ offset: 0, limit: 1 }, "document");
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
export async function createNote(name?: string, folder?: string): Promise<string | null> {
  folder ??= await folderOfOpenNote();
  const args: Record<string, string> = {};
  if (name) args.name = name;
  if (folder) args.folder = folder;
  const outcome = await api.invokeCommand(
    COMMANDS.create,
    Object.keys(args).length > 0 ? args : undefined,
    undefined,
    openVaultRoot(),
  );
  refreshDocuments();
  return outcome.effect.kind === "navigate" ? outcome.effect.doc : null;
}

/// La cartella delle nuove note quando `files.new-note-folder` comincia con
/// `./` e c'è una nota aperta: quella della nota, o una sua sottocartella. Il
/// kernel non sa quale nota è aperta, e senza cartella crea dalla radice.
/// `undefined` lascia decidere a lui.
export async function folderOfOpenNote(): Promise<string | undefined> {
  const doc = state.currentDoc;
  if (!doc) return undefined;
  const declared = (await settings().catch(() => []))
    .find((item) => item.spec.key === "files.new-note-folder")?.value;
  if (typeof declared !== "string") return undefined;
  const trimmed = declared.trim();
  if (trimmed !== "." && !trimmed.startsWith("./")) return undefined;
  return folderForNote(trimmed, doc);
}

/// Duplica un file accanto all'originale (`note.duplicate`): il kernel sceglie
/// il nome libero e copia i byte. Torna l'id della copia, dall'effetto `navigate`.
export async function duplicateNote(doc: string, folder?: string): Promise<string | null> {
  const args = folder === undefined ? { doc } : { doc, folder };
  const outcome = await api.invokeCommand(COMMANDS.duplicate, args, undefined, openVaultRoot());
  refreshDocuments();
  return outcome.effect.kind === "navigate" ? outcome.effect.doc : null;
}

/// Passa una voce del vault al sistema: la mostra nel file manager o, con
/// `open`, la apre col programma che il sistema sceglie. Un programma non si
/// apre (aprirlo vorrebbe dire eseguirlo): si mostra, e lo si dice.
export async function handToSystem(path: string, open: boolean): Promise<void> {
  try {
    const outcome = await api.revealInSystem(path, open, openVaultRoot());
    if (outcome.status === "no_opener") notify(t("explorer.system_none"), "guasto");
    if (outcome.status === "executable") {
      notify(t("explorer.system_executable"), "info");
      await handToSystem(path, false);
    }
  } catch (error) {
    notify(t("explorer.system_failed", { reason: errorText(error) }), "guasto");
  }
}

/// Crea una cartella vuota e restituisce il path che il kernel ha scritto.
///
/// Il path torna normalizzato (NFC, spazi ai bordi dei segmenti) e può quindi
/// differire da quello digitato: è quello che l'albero mostrerà. L'albero si
/// aggiorna da sé con `index_updated`, come per ogni cambio del vault.
export async function createFolder(path: string): Promise<string> {
  const outcome = await api.invokeCommand(COMMANDS.createFolder, { path }, undefined, openVaultRoot());
  const effect = outcome.effect;
  if (effect.kind === "custom" && effect.ns === "fub.folder.created") {
    const made = (effect.payload as { path?: unknown } | null)?.path;
    if (typeof made === "string") return made;
  }
  return path;
}

/// Rinomina (o sposta: è la stessa operazione, l'identità è il path).
///
/// Il rename riscrive i wikilink entranti, cioè file di terzi — chi chiama deve
/// aver messo in salvo il buffer prima, o la riscrittura del kernel finirebbe
/// sotto una copia più vecchia. `currentDoc` non si aggiorna qui: lo fa
/// l'evento `document_renamed`, perché l'identità è il path e chi la migra deve
/// essere un punto solo.
export async function renameNote(from: string, to: string): Promise<void> {
  await api.invokeCommand(COMMANDS.rename, { doc: from, to }, undefined, openVaultRoot());
  refreshDocuments();
}

/// Rinomina o sposta una cartella intera (`folder.rename`): ogni voce passa
/// dalla rinomina del kernel, e le sessioni aperte la seguono con il loro
/// `document_renamed`. Come per una nota, chi chiama ha già messo in salvo i
/// buffer. Torna l'esito, che porta la frase e l'annullamento.
export async function renameFolder(from: string, to: string): Promise<CommandOutcome> {
  const outcome = await api.invokeCommand(COMMANDS.renameFolder, { folder: from, to }, undefined, openVaultRoot());
  refreshDocuments();
  return outcome;
}

/// Fa della nota la pagina della sua cartella (`note.folder_page`): la rinomina
/// in `_index`, e il kernel si porta dietro i link (decisione 0229).
export async function useAsFolderPage(doc: string): Promise<CommandOutcome> {
  const outcome = await api.invokeCommand(COMMANDS.folderPage, { doc }, undefined, openVaultRoot());
  refreshDocuments();
  return outcome;
}

/// «Nuova sottopagina» (`note.subpage`): `doc` diventa la pagina della sua
/// cartella, se non lo è già, e lì nasce `name`.
export async function createSubpage(doc: string, name: string): Promise<CommandOutcome> {
  const outcome = await api.invokeCommand(COMMANDS.subpage, { doc, name }, undefined, openVaultRoot());
  refreshDocuments();
  return outcome;
}

/// Manda nel cestino del vault una cartella intera (`folder.trash`).
export async function trashFolder(folder: string): Promise<CommandOutcome> {
  const outcome = await api.invokeCommand(COMMANDS.trashFolder, { folder }, undefined, openVaultRoot());
  refreshDocuments();
  return outcome;
}

/// Porta nel vault, sotto `folder`, file e cartelle arrivati da fuori (un
/// rilascio dal sistema o il selettore dei file). Il vault è quello aperto
/// quando il gesto è cominciato: un cambio di vault a metà non devia le
/// scritture che restano.
export async function importIntoVault(dropped: Dropped, folder: string): Promise<ImportOutcome> {
  const vault = openVaultRoot();
  const scope = { path: folder, descendants: false };
  const outcome = await importDropped(dropped, folder, {
    taken: async () => {
      const [folders, entries] = await Promise.all([
        vaultFolders(WITHOUT_PAGE, scope),
        vaultEntries(WITHOUT_PAGE, undefined, scope),
      ]);
      const name = (path: string) => path.slice(path.lastIndexOf("/") + 1);
      return new Set([...folders.items.map((f) => name(f.path)), ...entries.items.map((e) => name(e.id))]);
    },
    write: (id, bytes) => api.resourceWrite(id, bytes, null, vault),
    createFolder: (path) => api.invokeCommand(COMMANDS.createFolder, { path }, undefined, vault),
  }, errorText);
  refreshDocuments();
  return outcome;
}

/// Sposta una nota nel cestino scelto da `files.trash`.
///
/// `system` passa da `trash.os`, che prova il cestino del sistema e ripiega su
/// quello del vault senza perdere la nota: il ripiego si dice, perché chi ha
/// scelto il cestino di sistema la cercherebbe lì.
export async function trashNote(id: string): Promise<Undo | null> {
  // Il vault è quello di quando parte il gesto: `settings()` aspetta.
  const vault = openVaultRoot();
  const choice = (await settings()).find((entry) => entry.spec.key === "files.trash")?.value;
  if (choice !== "system") {
    const outcome = await api.invokeCommand(COMMANDS.trash, { doc: id }, undefined, vault);
    refreshDocuments();
    return outcome.undo;
  }
  const outcome = await api.invokeCommand(COMMANDS.osTrash, { doc: id }, undefined, vault);
  refreshDocuments();
  // Il ripiego lo dice l'host nel `notify`, la stessa frase che la palette
  // mostra: qui non si rilegge l'effetto per ricomporla.
  if (outcome.notify) notify(outcome.notify);
  return outcome.undo;
}

/// Il cestino scelto è quello del sistema? Lì la nota esce dal vault, e
/// l'annullamento dell'app non la riporta.
export async function trashesToSystem(): Promise<boolean> {
  try {
    return (await settings()).find((entry) => entry.spec.key === "files.trash")?.value === "system";
  } catch {
    return false;
  }
}

/// Annulla l'ultima operazione del vault (`vault.undo`), per il gesto
/// «Annulla» accanto a un esito.
export async function undoLastOperation(): Promise<void> {
  await api.invokeCommand(COMMANDS.undo, undefined, undefined, openVaultRoot());
  refreshDocuments();
}

// Ripristinare dal cestino, svuotarlo e proporre un nome libero non stanno più
// qui: erano i tre servizi del pannello cestino, e il pannello cestino è un
// `ViewProvider` (§1.2). Il provider invoca gli stessi due comandi — è il
// registro a essere la strada, non questo modulo — e il nome libero se lo fa
// dare da `VaultRead::free_name`, che è la stessa convenzione del kernel
// chiesta dall'altro lato del confine.


/// I comandi dichiarati dal kernel, per le scorciatoie di tastiera.
///
/// La palette li richiede da sé quando si apre — è il momento in cui costa
/// nulla ed è l'unico in cui devono essere freschi; qui servono a riconoscere
/// una combinazione di tasti senza un giro sull'IPC a ogni pressione.
export async function loadCommandSpecs(): Promise<void> {
  // Il `catch` che c'era era peggio di un `console.warn`, ed è il punto che il
  // §20.4 ha trovato **contandoli**: se l'elenco non arriva all'apertura del
  // vault, la palette è vuota e ogni scorciatoia dichiarata è morta — cioè metà
  // dei modi di usare l'app smette di rispondere — e non ne restava una riga da
  // nessuna parte. L'elenco vuoto resta la risposta giusta (un vault si apre
  // comunque, 0068); ciò che mancava è dirlo.
  setCommandSpecs(await api.listCommands(...vaultArg(openVaultRoot())).catch((e: unknown) => {
    notify(t("commands.list_failed", { reason: errorText(e) }), "guasto");
    return [];
  }));
}

//! Le stringhe dei comandi, in italiano e in inglese.

use super::*;

/// Le stringhe dei comandi: quindici titoli, quindici descrizioni,
/// ventisei etichette di parametro e le righe che un comando scrive quando ha
/// finito.
///
/// È il catalogo più grande del repo, ed è anche quello che si vede di più: la
/// palette è **la** superficie in cui un utente legge prosa scritta da un
/// componente, e finché queste righe erano `&str` dentro le spec, la palette
/// era italiana per chiunque — compreso chi aveva scelto `en` nelle
/// impostazioni e vedeva già il resto in inglese.
pub fn catalog() -> Vec<StringCatalog> {
    crate::formats::speaking(vec![catalog_it(), catalog_en()])
}

fn catalog_it() -> StringCatalog {
    StringCatalog::new("it")
        .with("search.open.title", "Cerca nel vault")
        .with(
            "search.open.desc",
            "Esegue una ricerca full-text sul vault e mostra i risultati. \
             Non modifica niente.",
        )
        .with("search.open.query.title", "Cerca")
        .with(
            "search.open.query.desc",
            "La query è testo libero oppure JSON di QueryExpr con `any` \
             esplicito; RunSearch porta la stessa stringa alla barra.",
        )
        .with(
            "selection.wikilink.title",
            "Trasforma la selezione in wikilink",
        )
        .with(
            "selection.wikilink.desc",
            "Avvolge il testo selezionato nel pannello attivo fra doppie \
             quadre, creando un riferimento a una nota con quel nome. \
             Richiede una selezione e un buffer salvato.",
        )
        .with("vault.replace.title", "Sostituisci in tutte le note")
        .with(
            "vault.replace.desc",
            "Sostituisce ogni occorrenza di un testo con un altro, in tutte \
             le note del vault o solo in quelle indicate. Simulandolo si \
             ottiene l'elenco delle note impattate e le modifiche esatte, \
             senza scrivere niente.",
        )
        .with("vault.replace.find.title", "Cerca")
        .with(
            "vault.replace.find.desc",
            "Il testo da sostituire. Non può essere vuoto.",
        )
        .with("vault.replace.replace.title", "Sostituisci con")
        .with(
            "vault.replace.replace.desc",
            "Il testo nuovo. Vuoto cancella le occorrenze.",
        )
        .with("vault.replace.whole_word.title", "Solo parole intere")
        .with(
            "vault.replace.whole_word.desc",
            "Se vero, sostituisce solo le occorrenze che non sono parte di una \
             parola più lunga. Default: falso.",
        )
        .with("vault.replace.docs.title", "Solo in queste note")
        .with(
            "vault.replace.docs.desc",
            "Gli id delle note su cui operare. Assente = tutto il vault; \
             elenco vuoto = nessuna nota.",
        )
        .with("note.create.title", "Nuova nota")
        .with(
            "note.create.desc",
            "Crea una nota vuota e la apre. Senza nome nasce «Senza titolo», e \
             se quel nome è preso «Senza titolo 1», «2», … Un nome senza \
             estensione diventa una nota markdown.",
        )
        .with(N_UNTITLED, "Senza titolo")
        .with("note.create.name.title", "Nome")
        .with(
            "note.create.name.desc",
            "Il nome o il path della nota, estensione compresa se diversa da \
             `.md`. Assente = «Senza titolo».",
        )
        .with("note.create.properties.title", "Proprietà iniziali")
        .with("note.create.properties.desc", "Oggetto JSON testuale delle proprietà iniziali del frontmatter; salvate insieme alla nota.")
        .with("note.create.folder.title", "Cartella")
        .with(
            "note.create.folder.desc",
            "La cartella in cui nasce la nota, al posto di quella configurata. \
             Un nome che è già un path non viene ribasato.",
        )
        .with("note.duplicate.title", "Duplica nota")
        .with(
            "note.duplicate.desc",
            "Crea una copia del file accanto all'originale, con un nome libero \
             («Nota copia»). I byte sono gli stessi: vale per ogni formato.",
        )
        .with("note.duplicate.doc.title", "Nota")
        .with("note.duplicate.doc.desc", "Il file da duplicare.")
        .with("note.duplicate.folder.title", "Cartella")
        .with(
            "note.duplicate.folder.desc",
            "La cartella in cui mettere la copia; lì tiene il nome dell'originale \
             se è libero. Vuota è la radice del vault.",
        )
        .with("note.rename.title", "Rinomina nota")
        .with(
            "note.rename.desc",
            "Rinomina o sposta una nota e riscrive i wikilink entranti che la \
             nominavano, così i riferimenti non si rompono. I link per alias \
             non vengono toccati.",
        )
        .with("note.rename.doc.title", "Nota")
        .with("note.rename.doc.desc", "La nota da rinominare.")
        .with("note.rename.to.title", "Nuovo path")
        .with(
            "note.rename.to.desc",
            "Il path nuovo, estensione compresa. Cambiare la cartella sposta \
             la nota.",
        )
        .with("note.trash.title", "Sposta nel cestino")
        .with(
            "note.trash.desc",
            "Sposta una nota nel cestino del vault. La nota esce dagli indici \
             ma non è distrutta: si recupera con «Ripristina dal cestino».",
        )
        .with("note.trash.doc.title", "Nota")
        .with(
            "note.trash.doc.desc",
            "La nota da cestinare. Assente = quella aperta.",
        )
        .with("trash.restore.title", "Ripristina dal cestino")
        .with(
            "trash.restore.desc",
            "Riporta nel vault una voce del cestino. Se il path d'origine è di \
             nuovo occupato serve un nome nuovo: senza, il ripristino è \
             rifiutato invece di sovrascrivere.",
        )
        .with("trash.restore.entry.title", "Voce del cestino")
        .with(
            "trash.restore.entry.desc",
            "L'id della voce nel cestino (`.trash/…`).",
        )
        .with("trash.restore.to.title", "Ripristina come")
        .with(
            "trash.restore.to.desc",
            "Path alternativo. Assente = il path d'origine.",
        )
        .with("trash.empty.title", "Svuota il cestino")
        .with(
            "trash.empty.desc",
            "Cancella definitivamente tutte le voci del cestino. Da qui non si \
             torna indietro.",
        )
        .with("vault.archive.title", "Archivia le note")
        .with(
            "vault.archive.desc",
            "Sposta le note indicate in una cartella, una rinomina alla volta: \
             i wikilink che le nominano vengono riscritti come per una rinomina \
             singola. Simulandolo si ottiene l'elenco di dove finirebbe ciascuna.",
        )
        .with("vault.archive.docs.title", "Note da archiviare")
        .with("vault.archive.docs.desc", "Gli id delle note da spostare.")
        .with("vault.archive.folder.title", "Cartella")
        .with(
            "vault.archive.folder.desc",
            "Dove spostarle. Assente = «Archivio».",
        )
        .with("folder.rename.title", "Rinomina o sposta la cartella")
        .with(
            "folder.rename.desc",
            "Porta una cartella, con tutto ciò che contiene, a un path nuovo: \
             ogni nota passa dalla rinomina di sempre, quindi i link che la \
             nominano vengono riscritti.",
        )
        .with("folder.rename.folder.title", "Cartella")
        .with("folder.rename.folder.desc", "Il path della cartella da spostare.")
        .with("folder.rename.to.title", "Nuovo path")
        .with(
            "folder.rename.to.desc",
            "Il path intero della cartella nuova, per esempio «Archivio/Progetti».",
        )
        .with("folder.trash.title", "Sposta la cartella nel cestino")
        .with(
            "folder.trash.desc",
            "Manda nel cestino ogni nota e allegato della cartella, poi toglie \
             le cartelle rimaste vuote. Si annulla come un cestino qualunque.",
        )
        .with("folder.trash.folder.title", "Cartella")
        .with("folder.trash.folder.desc", "Il path della cartella da cestinare.")
        .with("note.folder_page.title", "Usa come pagina della cartella")
        .with(
            "note.folder_page.desc",
            "Rinomina la nota in «_index», così cliccare la cartella la apre e \
             i link alla cartella la trovano. I link alla nota seguono. Non \
             sostituisce mai una pagina che c'è già.",
        )
        .with("note.folder_page.doc.title", "Nota")
        .with(
            "note.folder_page.doc.desc",
            "La nota da usare come pagina; in mancanza, quella aperta.",
        )
        .with("note.subpage.title", "Nuova sottopagina")
        .with(
            "note.subpage.desc",
            "Crea una nota dentro la cartella della pagina. Se la pagina non è \
             ancora quella di una cartella, prima la sposta in «Nome/_index»: i \
             link seguono. Non sostituisce mai una nota o una pagina che c'è già.",
        )
        .with("note.subpage.doc.title", "Pagina")
        .with(
            "note.subpage.doc.desc",
            "La pagina che riceve la sottopagina; in mancanza, quella aperta.",
        )
        .with("note.subpage.name.title", "Nome")
        .with("note.subpage.name.desc", "Il nome della sottopagina, senza cartella.")
        .with("note.task.toggle.title", "Spunta il task")
        .with(
            "note.task.toggle.desc",
            "Spunta o de-spunta la voce di task che si trova in una posizione \
             del documento: `[ ]` diventa `[x]` e ogni altro stato torna `[ ]`. \
             Senza argomenti agisce sul task sotto il cursore del pannello \
             attivo. Scrive un carattere solo.",
        )
        .with("note.task.toggle.doc.title", "Nota")
        .with(
            "note.task.toggle.doc.desc",
            "La nota su cui agire. Assente = quella del pannello attivo.",
        )
        .with("note.task.toggle.at.title", "Posizione")
        .with(
            "note.task.toggle.at.desc",
            "Posizione in byte dentro il documento: si spunta il task che la \
             contiene, il più interno se sono annidati. Assente = il cursore \
             del pannello attivo.",
        )
        .with("settings.set.title", "Cambia un'impostazione")
        .with(
            "settings.set.desc",
            "Scrive il valore di una chiave dichiarata, nel livello che la \
             chiave dichiara (il vault o la macchina). Solo le chiavi che si \
             sono dichiarate scrivibili da un programma: le altre le cambia chi \
             le sta guardando, dal pannello.",
        )
        .with("settings.set.key.title", "Chiave")
        .with(
            "settings.set.key.desc",
            "La chiave, es. `versioning.enabled`.",
        )
        .with("settings.set.value.title", "Valore")
        .with(
            "settings.set.value.desc",
            "Il valore, letto secondo la specie dichiarata dalla chiave: \
             `true`/`false` per un interruttore, un numero, il testo, o valori \
             separati da virgola per un elenco.",
        )
        .with("settings.reset.title", "Azzera un'impostazione")
        .with(
            "settings.reset.desc",
            "Dimentica ciò che era stato deciso per una chiave: torna a valere \
             il livello sotto, che è il default solo se non c'era niente in mezzo.",
        )
        .with("settings.reset.key.title", "Chiave")
        .with("settings.reset.key.desc", "La chiave da azzerare.")
        .with("settings.export.title", "Esporta le impostazioni")
        .with(
            "settings.export.desc",
            "Restituisce in JSON le impostazioni **decise** — non i default, che \
             non sono una scelta di nessuno. Non scrive un file: dove salvarlo \
             lo sa chi ha il dialogo di sistema, e un comando del registro non \
             ha (e non deve avere) accesso al filesystem fuori dal vault.",
        )
        .with("settings.import.title", "Importa le impostazioni")
        .with(
            "settings.import.desc",
            "Applica una configurazione esportata. Ciò che non si può applicare \
             — una chiave che nessuno dichiara, un valore fuori specie, una \
             chiave non scrivibile da un programma — viene **contato e detto**, \
             non applicato a metà in silenzio.",
        )
        .with("settings.import.json.title", "Configurazione")
        .with(
            "settings.import.json.desc",
            "L'oggetto JSON `{{\"chiave\": valore}}`.",
        )
        .with(E_NO_ACTIVE_PANE, "Nessun pannello attivo.")
        .with(
            AND_NO_OPEN_NOTES,
            "Nessuna nota aperta nel pannello attivo.",
        )
        .with(AND_NOTHING_SELECTED, "Niente di selezionato.")
        .with(
            E_EMPTY_SELECTION,
            "La selezione è vuota: non c'è testo da trasformare.",
        )
        .with(
            E_DIRTY_SELECTION,
            "Il buffer ha modifiche non salvate: salva prima di trasformare la selezione.",
        )
        .with(
            E_SELECTION_OUTSIDE,
            "La selezione non sta dentro il documento.",
        )
        .with(
            AND_SELECTION_HAS_LINK,
            "La selezione contiene già un riferimento.",
        )
        .with(
            E_EMPTY_FIND,
            "`find` non può essere vuoto: sostituirebbe il nulla ovunque.",
        )
        .with(E_EMPTY_TO, "`to` non può essere vuoto.")
        .with(
            AND_NO_NOTES_GIVEN,
            "Nessuna nota indicata e nessuna nota aperta nel pannello attivo.",
        )
        .with(AND_NOT_IN_TRASH, "`{entry}` non è nel cestino.")
        .with(
            E_PAGE_AT_ROOT,
            "`{doc}` sta nella radice del vault, che non ha una pagina.",
        )
        .with(E_PAGE_ALREADY, "`{doc}` è già la pagina della sua cartella.")
        .with(
            E_SUBPAGE_NAME,
            "Il nome della sottopagina non può essere vuoto né contenere «/».",
        )
        .with(
            AND_TASK_NO_NOTES,
            "Nessuna nota: né in `doc`, né nel pannello attivo.",
        )
        .with(
            AND_TASK_NO_POSITION,
            "Nessuna posizione in `at`, e nessun pannello attivo da cui prenderla.",
        )
        .with(
            AND_TASK_WRONG_PANE,
            "`at` non c'è e il cursore non è in {doc}: dire su quale nota agire \
             senza dire dove non basta.",
        )
        .with(AND_TASK_NO_CARET, "Nessun cursore nel pannello attivo.")
        .with(
            AND_TASK_DIRTY_BUFFER,
            "Il buffer ha modifiche non salvate: salva prima di spuntare, o dì la \
             posizione in `at`.",
        )
        .with(
            AND_TASK_NOT_FOUND,
            "Nessuna voce di task alla posizione {at} di {doc}.",
        )
        .with(
            AND_TASK_CHANGED,
            "{doc} è cambiata mentre si spuntavano i task: riprova.",
        )
        .with(
            AND_NOT_A_TOGGLE,
            "`{value}` non è un interruttore (`true` o `false`).",
        )
        .with(AND_NOT_A_NUMBER, "`{value}` non è un numero.")
        .with(E_EMPTY_FOLDER, "Manca la cartella.")
        .with(
            E_FOLDER_INTO_ITSELF,
            "«{folder}» non si sposta in «{to}», che sta dentro di lei.",
        )
        .with(
            E_FOLDER_ROLLBACK,
            "«{folder}» si è fermata a metà ({reason}), e non tutto è tornato \
             indietro: {failed}",
        )
        .with(
            E_UNDECLARED_KEY,
            "Nessuno ha dichiarato l'impostazione `{key}`.",
        )
        .with(
            E_NOT_PROGRAM_WRITABLE,
            "`{key}` non è scrivibile da un programma: la cambia l'utente.",
        )
        .with(E_NOT_JSON, "Non è un JSON valido: {reason}")
        .with(
            E_NOT_AN_OBJECT,
            "Atteso un oggetto `{{\"chiave\": valore}}`.",
        )
        .with(P_WIKILINK, "«{text}» diventa un riferimento in {doc}")
        .with(
            P_WIKILINK_MANY,
            "{count} selezioni diventano riferimenti in {doc}",
        )
        .with(P_REPLACE, "Sostituzioni: {occurrences} · Note: {notes}")
        .with(P_CREATE, "Crea «{doc}»")
        .with(P_RENAME, "«{doc}» diventa «{to}»")
        .with(P_TRASH, "«{doc}» va nel cestino")
        .with(P_RESTORE, "«{entry}» torna come «{doc}»")
        .with(P_EMPTY_TRASH, "Voci da cancellare per sempre: {count}")
        .with(P_ARCHIVE, "Note da archiviare in «{folder}»: {count}")
        .with(P_FOLDER_RENAME, "«{folder}» diventa «{to}» · Voci: {count}")
        .with(P_FOLDER_TRASH, "Nel cestino «{folder}» · Voci: {count}")
        .with(P_TASK_DONE, "Task spuntata in {doc}")
        .with(P_TASK_TODO, "Task da fare in {doc}")
        .with(P_SETTINGS_SET, "Cambia `{key}`")
        .with(P_SETTINGS_RESET, "Azzera `{key}`")
        .with(P_SETTINGS_IMPORT, "Impostazioni da applicare: {count}")
        .with(Y_SETTINGS_SET, "`{key}` passerebbe da {from} a {value}")
        .with(
            Y_SETTINGS_RESET,
            "`{key}` smetterebbe di valere {value} per decisione di qualcuno",
        )
        .with(D_WIKILINK, "Creato il riferimento a «{text}»")
        .with(D_WIKILINK_MANY, "Creati {count} riferimenti")
        .with(
            D_REPLACE,
            "Sostituzioni: {occurrences} · Note aggiornate: {notes}",
        )
        .with(
            D_REPLACE_PARTIAL,
            "Sostituzioni: {occurrences} · Note aggiornate: {notes} · Non \
             modificate: {failed}",
        )
        .with(D_CREATE, "Creata «{doc}»")
        .with(D_RENAME, "«{doc}» rinominata in «{to}»")
        .with(D_TRASH, "«{doc}» spostata nel cestino")
        .with(D_RESTORE, "Ripristinata «{doc}»")
        .with(
            D_EMPTY_TRASH,
            "Cestino svuotato · Voci cancellate per sempre: {count}",
        )
        .with(D_ARCHIVE, "Note archiviate in «{folder}»: {count}")
        .with(D_FOLDER_RENAME, "«{folder}» è diventata «{to}» · Voci: {count}")
        .with(
            D_FOLDER_RENAME_PARTIAL,
            "«{folder}» è diventata «{to}» · Voci: {count} · Da guardare: {failed}",
        )
        .with(D_FOLDER_TRASH, "«{folder}» è nel cestino · Voci: {count}")
        .with(
            D_FOLDER_TRASH_PARTIAL,
            "«{folder}» è nel cestino · Voci: {count} · Da guardare: {failed}",
        )
        .with(
            D_ARCHIVE_PARTIAL,
            "Note archiviate in «{folder}»: {count} · Non spostate: {failed}",
        )
        .with(D_SETTINGS_SET, "`{key}` adesso vale {value}")
        .with(D_SETTINGS_RESET, "`{key}` è tornata al valore di prima")
        .with(D_SETTINGS_EXPORT, "Impostazioni da salvare: {count}")
        .with(D_SETTINGS_IMPORT, "Impostazioni applicate: {count}")
        .with(
            D_SETTINGS_IMPORT_PARTIAL,
            "Impostazioni applicate: {count} · Saltate: {skipped} ({reasons})",
        )
        // --- l'annullamento (§13.3) ---------------------------------------
        //
        // Le etichette `undo.*` dicono **cosa si disferebbe**, non cosa è
        // successo: sono la frase che si legge in un menu, mesi dopo, e per
        // questo cominciano dal verbo di ciò che tornerebbe indietro.
        .with("vault.undo.title", "Annulla l'ultima operazione")
        .with(
            "vault.undo.desc",
            "Disfa l'ultima operazione annullabile fatta in questo vault: una \
             rinomina, una nota cestinata, una sostituzione. Non è l'annulla \
             dell'editor, che riguarda il testo che stai scrivendo e risponde a \
             Ctrl-Z.",
        )
        .with(P_UNDO, "Disferebbe l'ultima operazione annullabile")
        .with(D_UNDONE, "Annullato: {what}")
        .with(
            D_UNDONE_OF_PARTIAL,
            "Annullato: {what} — ma quell'operazione era già riuscita a metà \
             ({done} su {attempted}), quindi torna indietro solo quella parte.",
        )
        .with(
            D_UNDONE_PARTIAL,
            "Annullato a metà: {what} · Passi tornati indietro: {done} su \
             {attempted} · Fermato da: {failed}",
        )
        .with(D_NOTHING_TO_UNDO, "Niente da annullare")
        .with(U_WIKILINK, "il riferimento a «{text}»")
        .with(U_WIKILINK_MANY, "i {count} riferimenti")
        .with(
            U_REPLACE,
            "le sostituzioni · Occorrenze: {occurrences} · Note: {notes}",
        )
        .with(U_CREATE, "la creazione di «{doc}»")
        .with(U_RENAME, "la rinomina di «{doc}» in «{to}»")
        .with(U_TRASH, "«{doc}» nel cestino")
        .with(U_RESTORE, "il ripristino di «{doc}»")
        .with(U_ARCHIVE, "l'archiviazione in «{folder}» · Note: {count}")
        .with(U_FOLDER_RENAME, "lo spostamento di «{folder}» in «{to}»")
        .with(U_FOLDER_TRASH, "il cestino di «{folder}» · Voci: {count}")
        .with(U_TASK, "la task spuntata in {doc}")
}

fn catalog_en() -> StringCatalog {
    StringCatalog::new("en")
        .with("search.open.title", "Search the vault")
        .with(
            "search.open.desc",
            "Runs a full-text search over the vault and shows the results. \
             Changes nothing.",
        )
        .with("search.open.query.title", "Search")
        .with(
            "search.open.query.desc",
            "The query is free text or QueryExpr JSON with explicit `any`; \
             RunSearch carries the same string to the search bar.",
        )
        .with(
            "selection.wikilink.title",
            "Turn the selection into a wikilink",
        )
        .with(
            "selection.wikilink.desc",
            "Wraps the text selected in the active pane in double brackets, \
             creating a reference to a note with that name. Needs a selection \
             and a saved buffer.",
        )
        .with("vault.replace.title", "Replace across all notes")
        .with(
            "vault.replace.desc",
            "Replaces every occurrence of a text with another one, in all the \
             notes of the vault or only in the ones given. Simulating it gives \
             the list of affected notes and the exact changes, writing nothing.",
        )
        .with("vault.replace.find.title", "Find")
        .with(
            "vault.replace.find.desc",
            "The text to replace. Cannot be empty.",
        )
        .with("vault.replace.replace.title", "Replace with")
        .with(
            "vault.replace.replace.desc",
            "The new text. Empty deletes the occurrences.",
        )
        .with("vault.replace.whole_word.title", "Whole words only")
        .with(
            "vault.replace.whole_word.desc",
            "If true, replaces only the occurrences that are not part of a \
             longer word. Default: false.",
        )
        .with("vault.replace.docs.title", "Only in these notes")
        .with(
            "vault.replace.docs.desc",
            "The ids of the notes to work on. Absent = the whole vault; empty \
             list = no note.",
        )
        .with("note.create.title", "New note")
        .with(
            "note.create.desc",
            "Creates an empty note and opens it. With no name it is born \
             «Untitled», and if that name is taken «Untitled 1», «2», … A name \
             without extension becomes a markdown note.",
        )
        .with(N_UNTITLED, "Untitled")
        .with("note.create.name.title", "Name")
        .with(
            "note.create.name.desc",
            "The name or the path of the note, extension included if it is not \
             `.md`. Absent = «Untitled».",
        )
        .with("note.create.properties.title", "Initial properties")
        .with("note.create.properties.desc", "A JSON object encoded as text with the initial frontmatter properties, saved atomically with the note.")
        .with("note.create.folder.title", "Folder")
        .with(
            "note.create.folder.desc",
            "The folder the note is born in, instead of the configured one. A \
             name that is already a path is not rebased.",
        )
        .with("note.duplicate.title", "Duplicate note")
        .with(
            "note.duplicate.desc",
            "Creates a copy of the file next to the original, under a free name \
             (\"Note copy\"). The bytes are identical: it works for every format.",
        )
        .with("note.duplicate.doc.title", "Note")
        .with("note.duplicate.doc.desc", "The file to duplicate.")
        .with("note.duplicate.folder.title", "Folder")
        .with(
            "note.duplicate.folder.desc",
            "The folder that receives the copy; there it keeps the original name \
             when free. Empty is the vault root.",
        )
        .with("note.rename.title", "Rename note")
        .with(
            "note.rename.desc",
            "Renames or moves a note and rewrites the incoming wikilinks that \
             named it, so the references do not break. Links by alias are left \
             alone.",
        )
        .with("note.rename.doc.title", "Note")
        .with("note.rename.doc.desc", "The note to rename.")
        .with("note.rename.to.title", "New path")
        .with(
            "note.rename.to.desc",
            "The new path, extension included. Changing the folder moves the note.",
        )
        .with("note.trash.title", "Move to trash")
        .with(
            "note.trash.desc",
            "Moves a note to the vault trash. The note leaves the indexes but \
             is not destroyed: you get it back with «Restore from trash».",
        )
        .with("note.trash.doc.title", "Note")
        .with(
            "note.trash.doc.desc",
            "The note to trash. Absent = the open one.",
        )
        .with("trash.restore.title", "Restore from trash")
        .with(
            "trash.restore.desc",
            "Brings a trash entry back into the vault. If the original path is \
             taken again a new name is needed: without one, the restore is \
             refused instead of overwriting.",
        )
        .with("trash.restore.entry.title", "Trash entry")
        .with(
            "trash.restore.entry.desc",
            "The id of the entry in the trash (`.trash/…`).",
        )
        .with("trash.restore.to.title", "Restore as")
        .with(
            "trash.restore.to.desc",
            "Alternative path. Absent = the original path.",
        )
        .with("trash.empty.title", "Empty the trash")
        .with(
            "trash.empty.desc",
            "Deletes every trash entry for good. There is no way back from here.",
        )
        .with("vault.archive.title", "Archive the notes")
        .with(
            "vault.archive.desc",
            "Moves the given notes into a folder, one rename at a time: the \
             wikilinks that name them are rewritten as for a single rename. \
             Simulating it gives the list of where each one would end up.",
        )
        .with("vault.archive.docs.title", "Notes to archive")
        .with("vault.archive.docs.desc", "The ids of the notes to move.")
        .with("vault.archive.folder.title", "Folder")
        .with(
            "vault.archive.folder.desc",
            "Where to move them. Absent = «Archive».",
        )
        .with("folder.rename.title", "Rename or move folder")
        .with(
            "folder.rename.desc",
            "Moves a folder, with everything in it, to a new path: every note \
             goes through the usual rename, so the links that name it are \
             rewritten.",
        )
        .with("folder.rename.folder.title", "Folder")
        .with("folder.rename.folder.desc", "The path of the folder to move.")
        .with("folder.rename.to.title", "New path")
        .with(
            "folder.rename.to.desc",
            "The full path of the new folder, for example “Archive/Projects”.",
        )
        .with("folder.trash.title", "Move folder to trash")
        .with(
            "folder.trash.desc",
            "Sends every note and attachment in the folder to the trash, then \
             removes the folders left empty. Undone like any other trash.",
        )
        .with("folder.trash.folder.title", "Folder")
        .with("folder.trash.folder.desc", "The path of the folder to trash.")
        .with("note.folder_page.title", "Use as folder page")
        .with(
            "note.folder_page.desc",
            "Renames the note to «_index», so clicking the folder opens it and \
             links to the folder find it. Links to the note follow. It never \
             replaces a page that is already there.",
        )
        .with("note.folder_page.doc.title", "Note")
        .with(
            "note.folder_page.doc.desc",
            "The note to use as the page; otherwise, the open one.",
        )
        .with("note.subpage.title", "New subpage")
        .with(
            "note.subpage.desc",
            "Creates a note inside the page's folder. If the page is not a \
             folder's page yet, it first moves to «Name/_index»: links follow. \
             It never replaces a note or a page that is already there.",
        )
        .with("note.subpage.doc.title", "Page")
        .with(
            "note.subpage.doc.desc",
            "The page that gets the subpage; if missing, the open one.",
        )
        .with("note.subpage.name.title", "Name")
        .with("note.subpage.name.desc", "The subpage's name, without a folder.")
        .with("note.task.toggle.title", "Toggle the task")
        .with(
            "note.task.toggle.desc",
            "Ticks or unticks the task item found at a position in the \
             document: `[ ]` becomes `[x]` and every other state goes back to \
             `[ ]`. With no arguments it works on the task under the cursor of \
             the active pane. It writes a single character.",
        )
        .with("note.task.toggle.doc.title", "Note")
        .with(
            "note.task.toggle.doc.desc",
            "The note to work on. Absent = the one of the active pane.",
        )
        .with("note.task.toggle.at.title", "Position")
        .with(
            "note.task.toggle.at.desc",
            "Position in bytes inside the document: the task containing it is \
             ticked, the innermost one if they are nested. Absent = the cursor \
             of the active pane.",
        )
        .with("settings.set.title", "Change a setting")
        .with(
            "settings.set.desc",
            "Writes the value of a declared key, at the level the key declares \
             (the vault or the machine). Only the keys that declared themselves \
             writable by a program: the others are changed by whoever is \
             looking at them, from the panel.",
        )
        .with("settings.set.key.title", "Key")
        .with(
            "settings.set.key.desc",
            "The key, e.g. `versioning.enabled`.",
        )
        .with("settings.set.value.title", "Value")
        .with(
            "settings.set.value.desc",
            "The value, read according to the kind the key declares: \
             `true`/`false` for a toggle, a number, the text, or comma-separated \
             values for a list.",
        )
        .with("settings.reset.title", "Reset a setting")
        .with(
            "settings.reset.desc",
            "Forgets what had been decided for a key: the level below applies \
             again, which is the default only if there was nothing in between.",
        )
        .with("settings.reset.key.title", "Key")
        .with("settings.reset.key.desc", "The key to reset.")
        .with("settings.export.title", "Export the settings")
        .with(
            "settings.export.desc",
            "Returns the **decided** settings as JSON — not the defaults, which \
             are nobody's choice. It does not write a file: where to save it is \
             known by whoever has the system dialog, and a command of the \
             registry does not have (and must not have) access to the \
             filesystem outside the vault.",
        )
        .with("settings.import.title", "Import the settings")
        .with(
            "settings.import.desc",
            "Applies an exported configuration. What cannot be applied — a key \
             nobody declares, a value of the wrong kind, a key not writable by \
             a program — is **counted and told**, not half-applied in silence.",
        )
        .with("settings.import.json.title", "Configuration")
        .with(
            "settings.import.json.desc",
            "The JSON object `{{\"key\": value}}`.",
        )
        .with(E_NO_ACTIVE_PANE, "No active pane.")
        .with(AND_NO_OPEN_NOTES, "No note open in the active pane.")
        .with(AND_NOTHING_SELECTED, "Nothing selected.")
        .with(
            E_EMPTY_SELECTION,
            "The selection is empty: there is no text to transform.",
        )
        .with(
            E_DIRTY_SELECTION,
            "The buffer has unsaved changes: save before transforming the selection.",
        )
        .with(
            E_SELECTION_OUTSIDE,
            "The selection is not inside the document.",
        )
        .with(
            AND_SELECTION_HAS_LINK,
            "The selection already contains a reference.",
        )
        .with(
            E_EMPTY_FIND,
            "`find` cannot be empty: it would replace nothing everywhere.",
        )
        .with(E_EMPTY_TO, "`to` cannot be empty.")
        .with(
            AND_NO_NOTES_GIVEN,
            "No note given and no note open in the active pane.",
        )
        .with(AND_NOT_IN_TRASH, "`{entry}` is not in the trash.")
        .with(
            E_PAGE_AT_ROOT,
            "`{doc}` is at the vault root, which has no page.",
        )
        .with(E_PAGE_ALREADY, "`{doc}` is already its folder's page.")
        .with(
            E_SUBPAGE_NAME,
            "The subpage's name can't be empty or contain «/».",
        )
        .with(
            AND_TASK_NO_NOTES,
            "No note: neither in `doc`, nor in the active pane.",
        )
        .with(
            AND_TASK_NO_POSITION,
            "No position in `at`, and no active pane to take it from.",
        )
        .with(
            AND_TASK_WRONG_PANE,
            "`at` is missing and the cursor is not in {doc}: saying which note to \
             act on without saying where is not enough.",
        )
        .with(AND_TASK_NO_CARET, "No cursor in the active pane.")
        .with(
            AND_TASK_DIRTY_BUFFER,
            "The buffer has unsaved changes: save before ticking, or say the \
             position in `at`.",
        )
        .with(
            AND_TASK_NOT_FOUND,
            "No task item at position {at} of {doc}.",
        )
        .with(
            AND_TASK_CHANGED,
            "{doc} changed while ticking the tasks: try again.",
        )
        .with(
            AND_NOT_A_TOGGLE,
            "`{value}` is not a toggle (`true` or `false`).",
        )
        .with(AND_NOT_A_NUMBER, "`{value}` is not a number.")
        .with(E_EMPTY_FOLDER, "The folder is missing.")
        .with(
            E_FOLDER_INTO_ITSELF,
            "“{folder}” cannot move into “{to}”, which is inside it.",
        )
        .with(
            E_FOLDER_ROLLBACK,
            "“{folder}” stopped halfway ({reason}), and not everything came \
             back: {failed}",
        )
        .with(E_UNDECLARED_KEY, "Nobody has declared the setting `{key}`.")
        .with(
            E_NOT_PROGRAM_WRITABLE,
            "`{key}` is not writable by a program: the user changes it.",
        )
        .with(E_NOT_JSON, "Not valid JSON: {reason}")
        .with(E_NOT_AN_OBJECT, "Expected an object `{{\"key\": value}}`.")
        .with(P_WIKILINK, "«{text}» becomes a reference in {doc}")
        .with(
            P_WIKILINK_MANY,
            "{count} selections become references in {doc}",
        )
        .with(P_REPLACE, "Replacements: {occurrences} · Notes: {notes}")
        .with(P_CREATE, "Create «{doc}»")
        .with(P_RENAME, "«{doc}» becomes «{to}»")
        .with(P_TRASH, "«{doc}» goes to the trash")
        .with(P_RESTORE, "«{entry}» comes back as «{doc}»")
        .with(P_EMPTY_TRASH, "Entries to delete for good: {count}")
        .with(P_ARCHIVE, "Notes to archive in «{folder}»: {count}")
        .with(P_FOLDER_RENAME, "“{folder}” becomes “{to}” · Entries: {count}")
        .with(P_FOLDER_TRASH, "To the trash: “{folder}” · Entries: {count}")
        .with(P_TASK_DONE, "Task ticked in {doc}")
        .with(P_TASK_TODO, "Task to do in {doc}")
        .with(P_SETTINGS_SET, "Change `{key}`")
        .with(P_SETTINGS_RESET, "Reset `{key}`")
        .with(P_SETTINGS_IMPORT, "Settings to apply: {count}")
        .with(Y_SETTINGS_SET, "`{key}` would go from {from} to {value}")
        .with(
            Y_SETTINGS_RESET,
            "`{key}` would stop being {value} by someone's decision",
        )
        .with(D_WIKILINK, "Created the reference to «{text}»")
        .with(D_WIKILINK_MANY, "Created {count} references")
        .with(
            D_REPLACE,
            "Replacements: {occurrences} · Notes updated: {notes}",
        )
        .with(
            D_REPLACE_PARTIAL,
            "Replacements: {occurrences} · Notes updated: {notes} · Not changed: {failed}",
        )
        .with(D_CREATE, "Created «{doc}»")
        .with(D_RENAME, "«{doc}» renamed to «{to}»")
        .with(D_TRASH, "«{doc}» moved to the trash")
        .with(D_RESTORE, "Restored «{doc}»")
        .with(
            D_EMPTY_TRASH,
            "Trash emptied · Entries deleted for good: {count}",
        )
        .with(D_ARCHIVE, "Notes archived in «{folder}»: {count}")
        .with(D_FOLDER_RENAME, "“{folder}” is now “{to}” · Entries: {count}")
        .with(
            D_FOLDER_RENAME_PARTIAL,
            "“{folder}” is now “{to}” · Entries: {count} · To check: {failed}",
        )
        .with(D_FOLDER_TRASH, "“{folder}” is in the trash · Entries: {count}")
        .with(
            D_FOLDER_TRASH_PARTIAL,
            "“{folder}” is in the trash · Entries: {count} · To check: {failed}",
        )
        .with(
            D_ARCHIVE_PARTIAL,
            "Notes archived in «{folder}»: {count} · Not moved: {failed}",
        )
        .with(D_SETTINGS_SET, "`{key}` is now {value}")
        .with(D_SETTINGS_RESET, "`{key}` is back to what it was before")
        .with(D_SETTINGS_EXPORT, "Settings to save: {count}")
        .with(D_SETTINGS_IMPORT, "Settings applied: {count}")
        .with(
            D_SETTINGS_IMPORT_PARTIAL,
            "Settings applied: {count} · Skipped: {skipped} ({reasons})",
        )
        .with("vault.undo.title", "Undo the last operation")
        .with(
            "vault.undo.desc",
            "Undoes the last undoable operation in this vault: a rename, a note \
             sent to the trash, a replacement. This is not the editor's undo, \
             which is about the text you are typing and answers to Ctrl-Z.",
        )
        .with(P_UNDO, "Would undo the last undoable operation")
        .with(D_UNDONE, "Undone: {what}")
        .with(
            D_UNDONE_OF_PARTIAL,
            "Undone: {what} — but that operation had only half succeeded \
             ({done} of {attempted}), so only that part comes back.",
        )
        .with(
            D_UNDONE_PARTIAL,
            "Half undone: {what} · Steps rolled back: {done} of {attempted} · \
             Stopped by: {failed}",
        )
        .with(D_NOTHING_TO_UNDO, "Nothing to undo")
        .with(U_WIKILINK, "the reference to “{text}”")
        .with(U_WIKILINK_MANY, "the {count} references")
        .with(
            U_REPLACE,
            "the replacements · Occurrences: {occurrences} · Notes: {notes}",
        )
        .with(U_CREATE, "creating “{doc}”")
        .with(U_RENAME, "renaming “{doc}” to “{to}”")
        .with(U_TRASH, "sending “{doc}” to the trash")
        .with(U_RESTORE, "restoring “{doc}”")
        .with(U_ARCHIVE, "archiving into “{folder}” · Notes: {count}")
        .with(U_FOLDER_RENAME, "moving “{folder}” to “{to}”")
        .with(U_FOLDER_TRASH, "trashing “{folder}” · Entries: {count}")
        .with(U_TASK, "the task ticked in {doc}")
}

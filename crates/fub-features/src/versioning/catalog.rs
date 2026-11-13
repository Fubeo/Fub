//! Le stringhe del versioning, in tutte le lingue del catalogo.

use super::*;

/// Le stringhe del versioning. Vedi
/// [`backlinks::catalog`](crate::backlinks::catalog) per il perché stia nel
/// componente e non nella shell.
///
/// Le etichette del suo **interruttore** non stanno qui: le dichiara chi
/// dichiara lo schema (`fub_host::settings::versioning_settings`), e il suo
/// catalogo arriva al montaggio accanto a questo, come secondo catalogo della
/// stessa lingua.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(NO_VERSIONS, "Nessuna versione di {doc}.")
            .with(NO_SUCH_VERSION, "La versione del {when} di {doc} non c'è.")
            .with(CONTENT_GONE, "Il contenuto di {path} è sparito.")
            .with(
                CONTENT_MISMATCH,
                "Lo snapshot {path} non corrisponde all'indice delle versioni.",
            )
            .with(UNREADABLE, "{path} non si legge: {reason}")
            .with(
                METADATA_UNWRITABLE,
                "Non riesco a scrivere i metadati delle versioni: {reason}",
            )
            .with(
                INDEX_UNWRITABLE,
                "Non riesco a scrivere l'indice delle versioni: {reason}",
            )
            .with(VERSION_UNSAVED, "Versione di {doc} non salvata: {reason}")
            .with(
                TOMBSTONE_UNWRITABLE,
                "Tombstone di {doc} non scritto: {reason}",
            )
            .with(VIEW_TITLE, "Cronologia")
            .with(NO_ACTIVE_DOC, "Nessuna nota aperta.")
            .with(EMPTY, "Nessuna versione.")
            .with(COUNT, "Versioni: {count}")
            .with(CURRENT, "Versione attuale")
            .with(SIZE, "{size} byte")
            .with(FIRST_VERSION, "Prima versione · {size} byte")
            .with(GREW, "+{size} byte")
            .with(SHRANK, "−{size} byte")
            .with(SAME_SIZE, "Stessa dimensione")
            .with(WHEN, "{when}")
            .with(RESTORE_LABEL, "Ripristina")
            .with(
                RESTORE_QUESTION,
                "Riportare la nota a questa versione? Il testo di adesso resta nella cronologia.",
            )
            .with(RESTORE_CONFIRM_LABEL, "Sì, ripristina")
            .with(RESTORE_CANCEL_LABEL, "Annulla")
            .with(CLOSE_PREVIEW, "Chiudi l'anteprima")
            .with(
                BINARY_PREVIEW,
                "Versione binaria: {size} byte. Puoi ripristinarla senza convertirla in testo.",
            )
            .with(COMPARE_LABEL, "Confronta con l'attuale")
            .with(COPY_LABEL, "Copia il testo")
            .with(SHOW_TEXT, "Mostra il testo")
            .with(
                DIFF_SUMMARY,
                "Rispetto a questa versione, la nota attuale ha {added} righe in più e {removed} in meno.",
            )
            .with(DIFF_SAME, "Nessuna differenza: la nota attuale è identica.")
            .with(
                DIFF_ENDINGS,
                "Stesso testo riga per riga: cambiano solo i terminatori di riga.",
            )
            .with(
                DIFF_TOO_LARGE,
                "Troppe righe diverse per un confronto riga per riga ({lines}).",
            )
            .with(DIFF_SKIPPED, "… {count} righe uguali")
            .with(DIFF_TRUNCATED, "… altre {count} righe non mostrate")
            .with(
                DIFF_BINARY,
                "Una delle due versioni non è testo: il confronto riga per riga non si applica.",
            )
            .with(
                DIFF_CURRENT_TOO_LARGE,
                "La nota attuale supera {limit} MiB: non la leggo per confrontarla.",
            )
            .with(
                RESTORE_TOO_LARGE,
                "{doc} supera {limit} MiB e il versioning non lo fotografa: \
                 ripristinarlo perderebbe il contenuto attuale.",
            )
            .with(WHEN_TITLE, "Versione del {when}")
            .with(RESTORE_TITLE, "Ripristina una versione")
            .with(
                RESTORE_DESC,
                "Riscrive la nota com'era in quell'istante. Il ripristino è a \
                 sua volta una versione: si torna indietro anche da lui.",
            )
            .with(RESTORE_DOC_TITLE, "Nota")
            .with(RESTORE_DOC_DESC, "La nota da riportare indietro.")
            .with(RESTORE_TS_TITLE, "Istante")
            .with(
                RESTORE_TS_DESC,
                "L'istante della versione, in millisecondi UNIX.",
            )
            .with(PLAN_RESTORE, "Riporta {doc} alla versione del {when}")
            .with(DONE_RESTORE, "{doc} riportata alla versione del {when}")
            .with(UNDO_RESTORE, "Rimetti {doc} com'era prima del ripristino")
            .with(AND_NO_NOTES_GIVEN, "Nessuna nota da ripristinare.")
            .with(E_NO_TS_GIVEN, "Nessun istante da ripristinare.")
            .with(CLEAR_TITLE, "Svuota la cronologia")
            .with(
                CLEAR_DESC,
                "Cancella tutte le versioni salvate di tutte le note del vault. Le \
                 note non si toccano; da qui non si torna indietro.",
            )
            .with(
                PLAN_CLEAR,
                "Versioni da cancellare: {versions}. Note con una cronologia: {notes}.",
            )
            .with(
                DONE_CLEAR,
                "Cronologia svuotata. Versioni cancellate: {versions}. Note: {notes}.",
            )
            .with(S_GROUP, "Vault")
            .with(S_INTERVAL, "Intervallo fra le versioni")
            .with(
                S_INTERVAL_DESC,
                "Minuti. Nelle ultime 24 ore si tiene al più una versione per \
                 intervallo, più l'ultima; 0 le tiene tutte.",
            )
            .with(S_RETENTION, "Durata della cronologia")
            .with(
                S_RETENTION_DESC,
                "Giorni. Le versioni più vecchie se ne vanno quando la nota si salva \
                 di nuovo; l'ultima versione resta sempre. 0 tiene tutto.",
            ),
        StringCatalog::new("en")
            .with(NO_VERSIONS, "No version of {doc}.")
            .with(NO_SUCH_VERSION, "There is no version of {doc} from {when}.")
            .with(CONTENT_GONE, "The content of {path} is gone.")
            .with(
                CONTENT_MISMATCH,
                "Snapshot {path} does not match the versions index.",
            )
            .with(UNREADABLE, "{path} cannot be read: {reason}")
            .with(
                METADATA_UNWRITABLE,
                "Cannot write the versions metadata: {reason}",
            )
            .with(
                INDEX_UNWRITABLE,
                "Cannot write the versions index: {reason}",
            )
            .with(VERSION_UNSAVED, "Version of {doc} not saved: {reason}")
            .with(
                TOMBSTONE_UNWRITABLE,
                "Tombstone of {doc} not written: {reason}",
            )
            .with(VIEW_TITLE, "History")
            .with(NO_ACTIVE_DOC, "No note open.")
            .with(EMPTY, "No versions.")
            .with(COUNT, "Versions: {count}")
            .with(CURRENT, "Current version")
            .with(SIZE, "{size} bytes")
            .with(FIRST_VERSION, "First version · {size} bytes")
            .with(GREW, "+{size} bytes")
            .with(SHRANK, "−{size} bytes")
            .with(SAME_SIZE, "Same size")
            .with(WHEN, "{when}")
            .with(RESTORE_LABEL, "Restore")
            .with(
                RESTORE_QUESTION,
                "Take the note back to this version? The current text stays in the history.",
            )
            .with(RESTORE_CONFIRM_LABEL, "Yes, restore")
            .with(RESTORE_CANCEL_LABEL, "Cancel")
            .with(CLOSE_PREVIEW, "Close the preview")
            .with(
                BINARY_PREVIEW,
                "Binary version: {size} bytes. You can restore it without converting it to text.",
            )
            .with(COMPARE_LABEL, "Compare with current")
            .with(COPY_LABEL, "Copy the text")
            .with(SHOW_TEXT, "Show the text")
            .with(
                DIFF_SUMMARY,
                "Compared with this version, the current note has {added} more lines and {removed} fewer.",
            )
            .with(DIFF_SAME, "No difference: the current note is identical.")
            .with(
                DIFF_ENDINGS,
                "Same text line by line: only the line terminators change.",
            )
            .with(
                DIFF_TOO_LARGE,
                "Too many differing lines for a line-by-line comparison ({lines}).",
            )
            .with(DIFF_SKIPPED, "… {count} identical lines")
            .with(DIFF_TRUNCATED, "… {count} more lines not shown")
            .with(
                DIFF_BINARY,
                "One of the two versions is not text: a line-by-line comparison does not apply.",
            )
            .with(
                DIFF_CURRENT_TOO_LARGE,
                "The current note exceeds {limit} MiB: it is not read for a comparison.",
            )
            .with(
                RESTORE_TOO_LARGE,
                "{doc} exceeds {limit} MiB and versioning does not photograph it: \
                 restoring it would lose the current content.",
            )
            .with(WHEN_TITLE, "Version from {when}")
            .with(RESTORE_TITLE, "Restore a version")
            .with(
                RESTORE_DESC,
                "Rewrites the note as it was at that instant. The restore is \
                 itself a version: you can come back from it too.",
            )
            .with(RESTORE_DOC_TITLE, "Note")
            .with(RESTORE_DOC_DESC, "The note to take back in time.")
            .with(RESTORE_TS_TITLE, "Instant")
            .with(
                RESTORE_TS_DESC,
                "The version instant, in UNIX milliseconds.",
            )
            .with(PLAN_RESTORE, "Take {doc} back to the version from {when}")
            .with(DONE_RESTORE, "{doc} taken back to the version from {when}")
            .with(UNDO_RESTORE, "Put {doc} back as it was before the restore")
            .with(AND_NO_NOTES_GIVEN, "No note to restore.")
            .with(E_NO_TS_GIVEN, "No instant to restore.")
            .with(CLEAR_TITLE, "Clear the history")
            .with(
                CLEAR_DESC,
                "Deletes every saved version of every note in the vault. The notes \
                 are not touched; this cannot be undone.",
            )
            .with(
                PLAN_CLEAR,
                "Versions to delete: {versions}. Notes with a history: {notes}.",
            )
            .with(
                DONE_CLEAR,
                "History cleared. Versions deleted: {versions}. Notes: {notes}.",
            )
            .with(S_GROUP, "Vault")
            .with(S_INTERVAL, "Interval between versions")
            .with(
                S_INTERVAL_DESC,
                "Minutes. Within the last 24 hours at most one version per interval \
                 is kept, plus the latest; 0 keeps them all.",
            )
            .with(S_RETENTION, "History length")
            .with(
                S_RETENTION_DESC,
                "Days. Older versions go when the note is saved again; the latest \
                 version always stays. 0 keeps everything.",
            ),
    ]
}

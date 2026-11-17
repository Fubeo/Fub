//! Le stringhe dei template, in italiano e in inglese.

use super::*;

pub(super) fn catalog_it() -> StringCatalog {
    StringCatalog::new("it")
        .with(VIEW_TITLE, "Template")
        .with(EMPTY, "Nessun template in Templates/.")
        .with(CALENDAR_TITLE, "Calendario")
        .with(CALENDAR_PREV, "Mese prima")
        .with(CALENDAR_NEXT, "Mese dopo")
        .with(CALENDAR_TODAY, "Oggi")
        .with(CALENDAR_WEEK, "Sett.")
        .with(E_NO_TEMPLATE, "Nessun template indicato.")
        .with(E_EMPTY_TEMPLATE, "Il template «{doc}» è vuoto di nome.")
        .with(E_NO_NOTES, "Nessuna nota nel vault.")
        .with(E_NO_DOC, "Nessuna nota: né in `doc`, né in quella aperta.")
        .with(E_DIRTY, "Il buffer ha modifiche non salvate: salva prima di inserire.")
        .with(E_EMPTY_SELECTION, "La selezione è vuota: non c'è niente da estrarre.")
        .with(E_BAD_DATE, "`{value}` non è una data YYYY-MM-DD.")
        .with(E_BAD_TIME, "`{value}` non è un orario HH:MM.")
        .with(E_BAD_FOLDER, "La cartella «{value}» risale o nomina lo spazio macchina.")
        .with(E_MERGE_SELF, "«{doc}» dentro sé stessa: indica due note diverse.")
        .with(E_NO_SOURCES, "Le note indicate non esistono o sono vuote.")
        .with(E_AT_NOT_OFFSET, "`at` è una posizione in byte: {value} non lo è.")
        .with(E_MULTI_SELECTION, "L'estrazione accetta una selezione sola: lascia un unico intervallo.")
        .with(E_STALE_SELECTION, "La selezione in {doc} è cambiata: ripubblica il contesto e riprova.")
        .with(E_ASSET_MOVE, "«{doc}» contiene un allegato relativo: tieni la stessa cartella o correggi il path prima di spostarlo.")
        .with(E_REFERENCED_SOURCE, "«{doc}» ha riferimenti entranti: conserva la sorgente (`trash: false`) o aggiorna i link prima dell'unione.")
        .with(E_EXTRACT_CLEANUP, "Estrazione non riuscita ({reason}): «{doc}» è rimasta perché la compensazione non è riuscita ({cleanup}). Risolvila prima di riprovare.")
        .with(E_SOURCE_CHANGED, "«{doc}» è cambiata durante l'unione: riprova dalla versione corrente.")
        .with(E_SOURCE_COPIED, "«{doc}» è cambiata dopo la copia: la sorgente è stata conservata.")
        .with(E_BAD_FRONTMATTER, "Frontmatter del template non valido: {reason}")
        .with(E_BAD_FRONTMATTER_MAP, "Il frontmatter del template deve essere una mappa.")
        .with(E_BAD_ZONE, "Fuso orario «{zone}» non riconosciuto: scegli un nome IANA valido.")
        .with(E_BAD_INSTANT, "L'istante dell'orologio non è rappresentabile nel fuso orario.")
        .with(P_FROM, "Nuova nota da «{template}»")
        .with(D_FROM, "Creata {doc} da «{template}»")
        .with(U_FROM, "Annulla: crea {doc} da template")
        .with(P_DAILY, "Nota del {date}")
        .with(D_DAILY, "Creata la nota del {date}")
        .with(U_DAILY, "Annulla: nota del {date}")
        .with(D_DAILY_OPEN, "Aperta la nota del {date}")
        .with(P_UNIQUE, "Crea «{doc}»")
        .with(D_UNIQUE, "Creata «{doc}»")
        .with(U_UNIQUE, "Annulla: crea «{doc}»")
        .with(D_RANDOM, "Aperta {doc}")
        .with(P_INSERT_DT, "Inserisci {value} in {doc}")
        .with(D_INSERT_DT, "Inserito {value} in {doc}")
        .with(U_INSERT_DT, "Annulla: inserito {value} in {doc}")
        .with(P_INSERT_TPL, "Inserisci «{template}» in {doc}")
        .with(D_INSERT_TPL, "Inserito «{template}» in {doc}")
        .with(D_INSERT_TPL_PARTIAL, "Inserito «{template}» in {doc} · Proprietà non fuse: {failed}")
        .with(U_INSERT_TPL, "Annulla: inserito «{template}» in {doc}")
        .with(P_EXTRACT, "«{doc}» nasce da una selezione di {from}")
        .with(D_EXTRACT, "Creata «{doc}» da una selezione di {from}")
        .with(U_EXTRACT, "Annulla: estratto «{doc}» in {from}")
        .with(P_MERGE, "Unisci {count} note in «{doc}»")
        .with(D_MERGE, "Unite {count} note in «{doc}»")
        .with(D_MERGE_PARTIAL, "Unite {count} note in «{doc}» · Non unite: {failed}")
        .with(U_MERGE, "Annulla: unite {count} note in «{doc}»")
        .with("note.from_template.title", "Nuova nota da template")
        .with(
            "note.from_template.desc",
            "Crea una nota copiando un template, con variabili {{…}} sostituite.",
        )
        .with("note.from_template.template.title", "Template")
        .with(
            "note.from_template.template.desc",
            "Il path del template nel vault.",
        )
        .with("note.from_template.name.title", "Nome")
        .with(
            "note.from_template.name.desc",
            "Nome della nota nuova. Assente: quello del template.",
        )
        .with("note.from_template.folder.title", "Cartella")
        .with(
            "note.from_template.folder.desc",
            "Cartella di destinazione. Assente: la stessa del `name`.",
        )
        .with("note.daily.title", "Nota di oggi")
        .with(
            "note.daily.desc",
            "Apre o crea la nota giornaliera di oggi, col fuso dell'utente.",
        )
        .with("note.daily.date.title", "Data")
        .with("note.daily.date.desc", "YYYY-MM-DD. Assente: oggi.")
        .with("note.daily.folder.title", "Cartella")
        .with(
            "note.daily.folder.desc",
            "Cartella delle giornaliere. Assente: quella decisa nelle impostazioni.",
        )
        .with("note.daily.template.title", "Template")
        .with(
            "note.daily.template.desc",
            "Template della giornaliera. Assente: quello deciso nelle impostazioni.",
        )
        .with("note.unique.title", "Nuova nota univoca")
        .with(
            "note.unique.desc",
            "Crea una nota senza sovrascrivere mai: se il nome è preso, aggiunge un numero.",
        )
        .with("note.unique.name.title", "Nome")
        .with("note.unique.name.desc", "Il nome o il path voluto. Assente: «Senza titolo».")
        .with(N_UNTITLED, "Senza titolo")
        .with("note.unique.random.title", "Nome casuale")
        .with(
            "note.unique.random.desc",
            "Se vero, il nome nasce dal caso invece che da `name`. Default: falso.",
        )
        .with("note.unique.template.title", "Template")
        .with(
            "note.unique.template.desc",
            "Template da cui partire. Assente: nota vuota.",
        )
        .with("note.random.title", "Nota casuale")
        .with(
            "note.random.desc",
            "Apre una nota a caso fra quelle del vault. Non modifica niente.",
        )
        .with("note.insert_datetime.title", "Inserisci data/ora")
        .with(
            "note.insert_datetime.desc",
            "Inserisce la data o l'ora di adesso nel documento attivo, al cursore.",
        )
        .with("note.insert_datetime.doc.title", "Nota")
        .with(
            "note.insert_datetime.doc.desc",
            "La nota in cui inserire. Assente: quella aperta.",
        )
        .with("note.insert_datetime.at.title", "Posizione")
        .with(
            "note.insert_datetime.at.desc",
            "Posizione in byte. Assente: il cursore del pannello attivo.",
        )
        .with("note.insert_datetime.format.title", "Formato")
        .with(
            "note.insert_datetime.format.desc",
            "date, time o datetime. Assente: quello deciso nelle impostazioni.",
        )
        .with("note.insert_datetime.format.date", "Data")
        .with("note.insert_datetime.format.time", "Ora")
        .with("note.insert_datetime.format.datetime", "Data e ora")
        .with("note.insert_template.title", "Inserisci template al cursore")
        .with(
            "note.insert_template.desc",
            "Inserisce il corpo di un template al cursore e fonde nel frontmatter le proprietà assenti.",
        )
        .with("note.insert_template.template.title", "Template")
        .with("note.insert_template.template.desc", "Il path del template nel vault.")
        .with("note.insert_template.doc.title", "Nota")
        .with(
            "note.insert_template.doc.desc",
            "La nota in cui inserire. Assente: quella aperta.",
        )
        .with("note.insert_template.at.title", "Posizione")
        .with(
            "note.insert_template.at.desc",
            "Posizione in byte. Assente: il cursore del pannello attivo.",
        )
        .with("note.insert_template.merge.title", "Fondi proprietà")
        .with(
            "note.insert_template.merge.desc",
            "Se vero, le proprietà del template assenti nel target vengono aggiunte. Default: vero.",
        )
        .with("note.extract.title", "Estrai selezione in nota")
        .with(
            "note.extract.desc",
            "Crea una nota dalla selezione e la sostituisce con un link o un embed. La sorgente non si tocca prima che la destinazione sia sicura.",
        )
        .with("note.extract.name.title", "Nome")
        .with(
            "note.extract.name.desc",
            "Nome della nota nuova. Assente: titolo o prima riga della selezione.",
        )
        .with("note.extract.template.title", "Template")
        .with(
            "note.extract.template.desc",
            "Template che avvolge la selezione nella nota nuova; se non ne ha il segnaposto, la selezione va in coda. Assente: la sola selezione.",
        )
        .with("note.extract.replace.title", "Sostituisci con")
        .with(
            "note.extract.replace.desc",
            "link, embed o niente. Assente: link.",
        )
        .with("note.extract.replace.link", "Link")
        .with("note.extract.replace.embed", "Embed")
        .with("note.extract.replace.none", "Niente")
        .with("note.merge.title", "Unisci note")
        .with(
            "note.merge.desc",
            "Accoda o prepone note a una destinazione; le sorgenti vanno nel cestino solo a destinazione sicura.",
        )
        .with("note.merge.from.title", "Note da unire")
        .with("note.merge.from.desc", "Gli id delle note da unire nella destinazione.")
        .with("note.merge.into.title", "Destinazione")
        .with(
            "note.merge.into.desc",
            "La nota che riceve. Assente: quella aperta.",
        )
        .with("note.merge.mode.title", "Modo")
        .with("note.merge.mode.desc", "append o prepend. Assente: append.")
        .with("note.merge.mode.append", "Append")
        .with("note.merge.mode.prepend", "Prepend")
        .with("note.merge.separator.title", "Separatore")
        .with(
            "note.merge.separator.desc",
            "Testo fra i blocchi uniti. Assente: riga vuota.",
        )
        .with("note.merge.trash.title", "Cestina sorgenti")
        .with(
            "note.merge.trash.desc",
            "Se vero, le sorgenti unite vanno nel cestino. Default: vero.",
        )
        .with(S_GROUP, "Template e giornaliere")
        .with(S_DAILY_FOLDER, "Cartella delle giornaliere")
        .with(S_DAILY_FOLDER_DESC, "Dove `note.daily` crea le note. Viaggia col vault.")
        .with(S_DAILY_TEMPLATE, "Template della giornaliera")
        .with(
            S_DAILY_TEMPLATE_DESC,
            "Template usato da `note.daily` quando la nota non esiste.",
        )
        .with(S_DAILY_FORMAT, "Nome della giornaliera")
        .with(
            S_DAILY_FORMAT_DESC,
            "YYYY, YY, MMMM, MMM, MM, M, DD, D, dddd, ddd; il testo fra [ ] resta com'è e una / fa una sottocartella. Esempio: YYYY/MMMM/YYYY-MM-DD.",
        )
        .with(
            E_BAD_DAILY_FORMAT,
            "Il nome della giornaliera «{value}» non è un percorso valido: controlla daily.format.",
        )
        .with(S_DATE_FORMAT, "Formato di data/ora")
        .with(
            S_DATE_FORMAT_DESC,
            "`date`, `time` o `datetime`: cosa inserisce `note.insert_datetime` senza formato.",
        )
        .with(S_TIME_FORMAT, "Orologio a 12 o 24 ore")
        .with(
            S_TIME_FORMAT_DESC,
            "`h24` come ISO 8601, `h12` con AM/PM. Vale per l'ora inserita.",
        )
        .with(S_UNIQUE_PREFIX, "Prefisso delle note univoche")
        .with(
            S_UNIQUE_PREFIX_DESC,
            "Formato con `YYYY`, `MM`, `DD`, `HH`, `mm` messo davanti al nome di `note.unique`. Vuoto: nessun prefisso.",
        )
}

pub(super) fn catalog_en() -> StringCatalog {
    StringCatalog::new("en")
        .with(VIEW_TITLE, "Templates")
        .with(EMPTY, "No templates in Templates/.")
        .with(CALENDAR_TITLE, "Calendar")
        .with(CALENDAR_PREV, "Previous month")
        .with(CALENDAR_NEXT, "Next month")
        .with(CALENDAR_TODAY, "Today")
        .with(CALENDAR_WEEK, "Wk")
        .with(E_NO_TEMPLATE, "No template given.")
        .with(E_EMPTY_TEMPLATE, "Template «{doc}» has no usable name.")
        .with(E_NO_NOTES, "No notes in the vault.")
        .with(E_NO_DOC, "No note: neither in `doc`, nor in the open one.")
        .with(E_DIRTY, "The buffer has unsaved changes: save before inserting.")
        .with(E_EMPTY_SELECTION, "The selection is empty: there is nothing to extract.")
        .with(E_BAD_DATE, "`{value}` is not a YYYY-MM-DD date.")
        .with(E_BAD_TIME, "`{value}` is not a HH:MM time.")
        .with(E_BAD_FOLDER, "Folder «{value}» escapes or names machine space.")
        .with(E_MERGE_SELF, "«{doc}» into itself: name two different notes.")
        .with(E_NO_SOURCES, "The named notes do not exist or are empty.")
        .with(E_AT_NOT_OFFSET, "`at` is a byte position: {value} is not one.")
        .with(E_MULTI_SELECTION, "Extraction accepts one selection: keep a single range selected.")
        .with(E_STALE_SELECTION, "The selection in {doc} changed: publish the editor context again and retry.")
        .with(E_ASSET_MOVE, "«{doc}» has a relative embedded asset: keep the same folder or fix its path before moving it.")
        .with(E_REFERENCED_SOURCE, "«{doc}» has incoming references: keep the source (`trash: false`) or update its links before merging.")
        .with(E_EXTRACT_CLEANUP, "Extraction failed ({reason}): «{doc}» was preserved because cleanup failed ({cleanup}). Resolve it before retrying.")
        .with(E_SOURCE_CHANGED, "«{doc}» changed during merge: retry from its current version.")
        .with(E_SOURCE_COPIED, "«{doc}» changed after copying: the source was kept.")
        .with(E_BAD_FRONTMATTER, "Invalid template frontmatter: {reason}")
        .with(E_BAD_FRONTMATTER_MAP, "Template frontmatter must be a mapping.")
        .with(E_BAD_ZONE, "Unknown time zone «{zone}»: choose a valid IANA name.")
        .with(E_BAD_INSTANT, "The clock instant cannot be represented in this time zone.")
        .with(P_FROM, "New note from «{template}»")
        .with(D_FROM, "Created {doc} from «{template}»")
        .with(U_FROM, "Undo: create {doc} from template")
        .with(P_DAILY, "Note for {date}")
        .with(D_DAILY, "Created the note for {date}")
        .with(U_DAILY, "Undo: note for {date}")
        .with(D_DAILY_OPEN, "Opened the note for {date}")
        .with(P_UNIQUE, "Create «{doc}»")
        .with(D_UNIQUE, "Created «{doc}»")
        .with(U_UNIQUE, "Undo: create «{doc}»")
        .with(D_RANDOM, "Opened {doc}")
        .with(P_INSERT_DT, "Insert {value} into {doc}")
        .with(D_INSERT_DT, "Inserted {value} into {doc}")
        .with(U_INSERT_DT, "Undo: inserted {value} into {doc}")
        .with(P_INSERT_TPL, "Insert «{template}» into {doc}")
        .with(D_INSERT_TPL, "Inserted «{template}» into {doc}")
        .with(D_INSERT_TPL_PARTIAL, "Inserted «{template}» into {doc} · Properties not merged: {failed}")
        .with(U_INSERT_TPL, "Undo: inserted «{template}» into {doc}")
        .with(P_EXTRACT, "«{doc}» is born from a selection of {from}")
        .with(D_EXTRACT, "Created «{doc}» from a selection of {from}")
        .with(U_EXTRACT, "Undo: extracted «{doc}» into {from}")
        .with(P_MERGE, "Merge {count} notes into «{doc}»")
        .with(D_MERGE, "Merged {count} notes into «{doc}»")
        .with(D_MERGE_PARTIAL, "Merged {count} notes into «{doc}» · Not merged: {failed}")
        .with(U_MERGE, "Undo: merged {count} notes into «{doc}»")
        .with("note.from_template.title", "New note from template")
        .with(
            "note.from_template.desc",
            "Creates a note by copying a template, substituting {{…}} variables.",
        )
        .with("note.from_template.template.title", "Template")
        .with(
            "note.from_template.template.desc",
            "Vault path of the template.",
        )
        .with("note.from_template.name.title", "Name")
        .with(
            "note.from_template.name.desc",
            "Name of the new note. Absent: the template's name.",
        )
        .with("note.from_template.folder.title", "Folder")
        .with(
            "note.from_template.folder.desc",
            "Destination folder. Absent: the same as `name`.",
        )
        .with("note.daily.title", "Today's note")
        .with(
            "note.daily.desc",
            "Opens or creates today's daily note, in the user's timezone.",
        )
        .with("note.daily.date.title", "Date")
        .with("note.daily.date.desc", "YYYY-MM-DD. Absent: today.")
        .with("note.daily.folder.title", "Folder")
        .with(
            "note.daily.folder.desc",
            "Daily notes folder. Absent: the configured one.",
        )
        .with("note.daily.template.title", "Template")
        .with(
            "note.daily.template.desc",
            "Daily note template. Absent: the configured one.",
        )
        .with("note.unique.title", "New unique note")
        .with(
            "note.unique.desc",
            "Creates a note without ever overwriting: when the name is taken, a number is added.",
        )
        .with("note.unique.name.title", "Name")
        .with("note.unique.name.desc", "The wanted name or path. Absent: “Untitled”.")
        .with(N_UNTITLED, "Untitled")
        .with("note.unique.random.title", "Random name")
        .with(
            "note.unique.random.desc",
            "When true, the name comes from randomness instead of `name`. Default: false.",
        )
        .with("note.unique.template.title", "Template")
        .with(
            "note.unique.template.desc",
            "Template to start from. Absent: empty note.",
        )
        .with("note.random.title", "Random note")
        .with(
            "note.random.desc",
            "Opens a random note from the vault. It changes nothing.",
        )
        .with("note.insert_datetime.title", "Insert date/time")
        .with(
            "note.insert_datetime.desc",
            "Inserts the current date or time into the active document, at the cursor.",
        )
        .with("note.insert_datetime.doc.title", "Note")
        .with(
            "note.insert_datetime.doc.desc",
            "The note to insert into. Absent: the open one.",
        )
        .with("note.insert_datetime.at.title", "Position")
        .with(
            "note.insert_datetime.at.desc",
            "Byte position. Absent: the caret of the active pane.",
        )
        .with("note.insert_datetime.format.title", "Format")
        .with(
            "note.insert_datetime.format.desc",
            "date, time or datetime. Absent: the configured one.",
        )
        .with("note.insert_datetime.format.date", "Date")
        .with("note.insert_datetime.format.time", "Time")
        .with("note.insert_datetime.format.datetime", "Date and time")
        .with("note.insert_template.title", "Insert template at cursor")
        .with(
            "note.insert_template.desc",
            "Inserts a template body at the cursor and merges missing properties into the frontmatter.",
        )
        .with("note.insert_template.template.title", "Template")
        .with("note.insert_template.template.desc", "Vault path of the template.")
        .with("note.insert_template.doc.title", "Note")
        .with(
            "note.insert_template.doc.desc",
            "The note to insert into. Absent: the open one.",
        )
        .with("note.insert_template.at.title", "Position")
        .with(
            "note.insert_template.at.desc",
            "Byte position. Absent: the caret of the active pane.",
        )
        .with("note.insert_template.merge.title", "Merge properties")
        .with(
            "note.insert_template.merge.desc",
            "When true, the template properties missing in the target are added. Default: true.",
        )
        .with("note.extract.title", "Extract selection to note")
        .with(
            "note.extract.desc",
            "Creates a note from the selection and replaces it with a link or an embed. The source is untouched until the destination is safe.",
        )
        .with("note.extract.name.title", "Name")
        .with(
            "note.extract.name.desc",
            "Name of the new note. Absent: title or first line of the selection.",
        )
        .with("note.extract.template.title", "Template")
        .with(
            "note.extract.template.desc",
            "Template wrapping the selection in the new note; without its placeholder, the selection goes at the end. Absent: the selection alone.",
        )
        .with("note.extract.replace.title", "Replace with")
        .with(
            "note.extract.replace.desc",
            "link, embed or nothing. Absent: link.",
        )
        .with("note.extract.replace.link", "Link")
        .with("note.extract.replace.embed", "Embed")
        .with("note.extract.replace.none", "Nothing")
        .with("note.merge.title", "Merge notes")
        .with(
            "note.merge.desc",
            "Appends or prepends notes into a destination; sources go to trash only when the destination is safe.",
        )
        .with("note.merge.from.title", "Notes to merge")
        .with("note.merge.from.desc", "The ids of the notes to merge into the destination.")
        .with("note.merge.into.title", "Destination")
        .with(
            "note.merge.into.desc",
            "The receiving note. Absent: the open one.",
        )
        .with("note.merge.mode.title", "Mode")
        .with("note.merge.mode.desc", "append or prepend. Absent: append.")
        .with("note.merge.mode.append", "Append")
        .with("note.merge.mode.prepend", "Prepend")
        .with("note.merge.separator.title", "Separator")
        .with(
            "note.merge.separator.desc",
            "Text between merged blocks. Absent: blank line.",
        )
        .with("note.merge.trash.title", "Trash sources")
        .with(
            "note.merge.trash.desc",
            "When true, merged sources go to trash. Default: true.",
        )
        .with(S_GROUP, "Templates and daily notes")
        .with(S_DAILY_FOLDER, "Daily notes folder")
        .with(S_DAILY_FOLDER_DESC, "Where `note.daily` creates notes. It travels with the vault.")
        .with(S_DAILY_TEMPLATE, "Daily note template")
        .with(
            S_DAILY_TEMPLATE_DESC,
            "Template used by `note.daily` when the note does not exist.",
        )
        .with(S_DAILY_FORMAT, "Daily note name")
        .with(
            S_DAILY_FORMAT_DESC,
            "YYYY, YY, MMMM, MMM, MM, M, DD, D, dddd, ddd; text between [ ] stays as written and a / makes a subfolder. Example: YYYY/MMMM/YYYY-MM-DD.",
        )
        .with(
            E_BAD_DAILY_FORMAT,
            "The daily note name {value} is not a valid path: check daily.format.",
        )
        .with(S_DATE_FORMAT, "Date/time format")
        .with(
            S_DATE_FORMAT_DESC,
            "`date`, `time` or `datetime`: what `note.insert_datetime` inserts without a format.",
        )
        .with(S_TIME_FORMAT, "12 or 24 hour clock")
        .with(
            S_TIME_FORMAT_DESC,
            "`h24` as ISO 8601, `h12` with AM/PM. It applies to the inserted time.",
        )
        .with(S_UNIQUE_PREFIX, "Unique note prefix")
        .with(
            S_UNIQUE_PREFIX_DESC,
            "Format with `YYYY`, `MM`, `DD`, `HH`, `mm` put before the `note.unique` name. Empty: no prefix.",
        )
}

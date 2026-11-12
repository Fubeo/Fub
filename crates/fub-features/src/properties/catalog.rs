//! Le stringhe del pannello e dei comandi delle proprietà.

use super::*;

/// Le stringhe del pannello e dei comandi. Vedi
/// [`backlinks::catalog`](crate::backlinks::catalog) per il perché stiano qui.
pub fn catalog() -> Vec<StringCatalog> {
    crate::formats::speaking(vec![
        StringCatalog::new("it")
            .with(VIEW_TITLE, "Proprietà")
            .with(EMPTY_NO_NOTES, "Nessuna nota aperta.")
            .with(EMPTY_NO_PROPS, "Questa nota non ha proprietà.")
            .with(ADD_KEY_LABEL, "Chiave")
            .with(ADD_VALUE_LABEL, "Valore")
            .with(ADD_SUBMIT, "Aggiungi")
            .with(REMOVE_LABEL, "Rimuovi")
            .with(E_EMPTY_KEY, "La chiave è vuota.")
            .with(AND_NO_NOTES, "Nessuna nota su cui scrivere la proprietà.")
            .with(E_YAML, "Non ho potuto scrivere il frontmatter: {reason}")
            .with(P_SET, "Proprietà «{key}» in {doc}")
            .with(P_REMOVE, "Tolta «{key}» da {doc}")
            .with(P_REMOVE_MISSING, "«{key}» non c'era in {doc}")
            .with(U_SET, "Annulla: proprietà «{key}» in {doc}")
            .with(U_REMOVE, "Annulla: togli «{key}» da {doc}")
            .with(FAILED, "Non ho aggiornato le proprietà: {reason}")
            .with(DAILY_LABEL, "Nota del giorno")
            .with(SAME_DAY_LABEL, "Stesso giorno")
            .with(SAME_DAY_TITLE, "Altre note del {date}")
            .with(SAME_DAY_NONE, "Nessun'altra nota ha la data {date}.")
            .with(SAME_DAY_MORE, "e altre {count}")
            .with(E_DAILY, "Non ho aperto la nota del {date}: {reason}")
            .with(
                E_DAILY_OFF,
                "La nota del giorno non c'è: i modelli di nota sono spenti.",
            )
            .with(E_BOTH_FORMS, "{doc}: «{old}» e «{new}» ci sono entrambe")
            .with("note.property.set.title", "Imposta proprietà")
            .with(
                "note.property.set.desc",
                "Scrive una chiave del frontmatter della nota.",
            )
            .with("note.property.set.doc.title", "Nota")
            .with(
                "note.property.set.doc.desc",
                "La nota da modificare. Assente: quella aperta.",
            )
            .with("note.property.set.key.title", "Chiave")
            .with("note.property.set.key.desc", "Il nome della proprietà.")
            .with("note.property.set.value.title", "Valore")
            .with(
                "note.property.set.value.desc",
                "Frammento YAML (testo, numero, true/false, lista, [[wikilink]]).",
            )
            .with("note.property.remove.title", "Togli proprietà")
            .with(
                "note.property.remove.desc",
                "Toglie una chiave dal frontmatter della nota.",
            )
            .with("note.property.remove.doc.title", "Nota")
            .with(
                "note.property.remove.doc.desc",
                "La nota da modificare. Assente: quella aperta.",
            )
            .with("note.property.remove.key.title", "Chiave")
            .with(
                "note.property.remove.key.desc",
                "Il nome della proprietà da togliere.",
            )
            .with("note.property.set.expected.title", "Valore precedente")
            .with(
                "note.property.set.expected.desc",
                "JSON tagged del valore osservato, o absent.",
            )
            .with(
                "note.property.set.expected_revision.title",
                "Revisione precedente",
            )
            .with(
                "note.property.set.expected_revision.desc",
                "Revisione esatta della nota, se nota.",
            )
            .with("note.property.remove.expected.title", "Valore precedente")
            .with(
                "note.property.remove.expected.desc",
                "JSON tagged del valore osservato, o absent.",
            )
            .with(
                "note.property.remove.expected_revision.title",
                "Revisione precedente",
            )
            .with(
                "note.property.remove.expected_revision.desc",
                "Revisione esatta della nota, se nota.",
            )
            .with(SOURCE_ONLY, "«{key}»: solo sorgente ({value})")
            .with("mode.hidden", "Nascondi")
            .with("mode.structured", "Strutturato")
            .with("mode.source", "Sorgente")
            .with("source_open", "Apri il sorgente")
            .with(GLOBAL_TITLE, "Proprietà del vault")
            .with(STATUS_TITLE, "Proprietà della nota")
            .with(STATUS_COUNT, "Proprietà: {count}")
            .with(GLOBAL_EMPTY, "Nessuna proprietà trovata.")
            .with(GLOBAL_FILTER, "Cerca chiavi o valori")
            .with(GLOBAL_COUNT, "{key} · {count} note")
            .with(GLOBAL_VALUE_COUNT, "{value} · {count} note")
            .with(GLOBAL_DOCS, "Apri {doc}")
            .with(P_TYPE, "Tipo dichiarato per «{key}»: {value}")
            .with(
                P_RENAME,
                "Rinominata «{old_key}» in «{new_key}»: {count} note",
            )
            .with(U_RENAME, "Annulla rinomina «{old_key}» in «{new_key}»")
            .with(P_DELETE, "Tolta «{key}»: {count} note")
            .with(U_DELETE, "Annulla rimozione di «{key}» dal vault")
            .with(P_MIGRATE, "Proprietà vecchie convertite: {count} note")
            .with(U_MIGRATE, "Annulla la conversione delle proprietà vecchie")
            .with(
                "property.keys.migrate.title",
                "Converti le proprietà vecchie",
            )
            .with(
                "property.keys.migrate.desc",
                "Scrive tag, alias e cssclass come tags, aliases e cssclasses in tutto il vault, con anteprima e annullo.",
            )
            .with(P_ALIAS, "Alias «{alias}» aggiunto a {doc}")
            .with(P_ALIAS_PRESENT, "{doc} ha già l'alias «{alias}»")
            .with(U_ALIAS, "Annulla alias «{alias}»")
            .with(P_CLEAR, "Tolte le proprietà di {doc}")
            .with(P_CLEAR_NONE, "{doc} non ha proprietà")
            .with(U_CLEAR, "Rimetti le proprietà di {doc}")
            .with("property.type.set.title", "Dichiara tipo proprietà")
            .with(
                "property.type.set.desc",
                "Dichiara il tipo di una chiave per il vault.",
            )
            .with("property.type.set.key.title", "Chiave")
            .with("property.type.set.key.desc", "Chiave da tipizzare.")
            .with("property.type.set.type.title", "Tipo")
            .with(
                "property.type.set.type.desc",
                "text, list, number, checkbox, date, date_time o tags.",
            )
            .with("property.key.rename.title", "Rinomina proprietà nel vault")
            .with(
                "property.key.rename.desc",
                "Rinomina lessicalmente la chiave in tutte le note, con anteprima.",
            )
            .with("property.key.rename.old_key.title", "Vecchia chiave")
            .with("property.key.rename.old_key.desc", "Chiave esistente.")
            .with("property.key.rename.new_key.title", "Nuova chiave")
            .with(
                "property.key.rename.new_key.desc",
                "Chiave di destinazione.",
            )
            .with("property.key.delete.title", "Elimina proprietà dal vault")
            .with(
                "property.key.delete.desc",
                "Toglie la chiave da tutte le note che la portano, con anteprima.",
            )
            .with("property.key.delete.key.title", "Chiave")
            .with("property.key.delete.key.desc", "Chiave da togliere.")
            .with("note.alias.add.title", "Aggiungi alias")
            .with(
                "note.alias.add.desc",
                "Aggiunge un nome alternativo alla nota, nella lista aliases.",
            )
            .with("note.alias.add.alias.title", "Alias")
            .with("note.alias.add.alias.desc", "Il nome alternativo.")
            .with("note.alias.add.doc.title", "Nota")
            .with(
                "note.alias.add.doc.desc",
                "La nota; se manca, quella attiva.",
            )
            .with(
                "note.properties.clear.title",
                "Cancella le proprietà della nota",
            )
            .with(
                "note.properties.clear.desc",
                "Toglie tutto il frontmatter della nota, con anteprima e annullo.",
            )
            .with("note.properties.clear.doc.title", "Nota")
            .with(
                "note.properties.clear.doc.desc",
                "La nota; se manca, quella attiva.",
            ),
        StringCatalog::new("en")
            .with(VIEW_TITLE, "Properties")
            .with(EMPTY_NO_NOTES, "No note open.")
            .with(EMPTY_NO_PROPS, "This note has no properties.")
            .with(ADD_KEY_LABEL, "Key")
            .with(ADD_VALUE_LABEL, "Value")
            .with(ADD_SUBMIT, "Add")
            .with(REMOVE_LABEL, "Remove")
            .with(E_EMPTY_KEY, "The key is empty.")
            .with(AND_NO_NOTES, "No note to write the property on.")
            .with(E_YAML, "Could not write the frontmatter: {reason}")
            .with(P_SET, "Property «{key}» in {doc}")
            .with(P_REMOVE, "Removed «{key}» from {doc}")
            .with(P_REMOVE_MISSING, "«{key}» was not in {doc}")
            .with(U_SET, "Undo: property «{key}» in {doc}")
            .with(U_REMOVE, "Undo: remove «{key}» from {doc}")
            .with(FAILED, "Could not update properties: {reason}")
            .with(DAILY_LABEL, "Daily note")
            .with(SAME_DAY_LABEL, "Same day")
            .with(SAME_DAY_TITLE, "Other notes on {date}")
            .with(SAME_DAY_NONE, "No other note has the date {date}.")
            .with(SAME_DAY_MORE, "and {count} more")
            .with(E_DAILY, "Could not open the note for {date}: {reason}")
            .with(
                E_DAILY_OFF,
                "There is no daily note: note templates are off.",
            )
            .with(E_BOTH_FORMS, "{doc}: both «{old}» and «{new}» are there")
            .with("note.property.set.title", "Set property")
            .with(
                "note.property.set.desc",
                "Writes a frontmatter key of the note.",
            )
            .with("note.property.set.doc.title", "Note")
            .with(
                "note.property.set.doc.desc",
                "The note to change. Absent: the open one.",
            )
            .with("note.property.set.key.title", "Key")
            .with("note.property.set.key.desc", "The property name.")
            .with("note.property.set.value.title", "Value")
            .with(
                "note.property.set.value.desc",
                "YAML fragment (text, number, true/false, list, [[wikilink]]).",
            )
            .with("note.property.remove.title", "Remove property")
            .with(
                "note.property.remove.desc",
                "Removes a key from the note's frontmatter.",
            )
            .with("note.property.remove.doc.title", "Note")
            .with(
                "note.property.remove.doc.desc",
                "The note to change. Absent: the open one.",
            )
            .with("note.property.remove.key.title", "Key")
            .with(
                "note.property.remove.key.desc",
                "The property name to remove.",
            )
            .with("note.property.set.expected.title", "Previous value")
            .with(
                "note.property.set.expected.desc",
                "Tagged JSON of the observed value, or absent.",
            )
            .with(
                "note.property.set.expected_revision.title",
                "Previous revision",
            )
            .with(
                "note.property.set.expected_revision.desc",
                "Exact note revision, if known.",
            )
            .with("note.property.remove.expected.title", "Previous value")
            .with(
                "note.property.remove.expected.desc",
                "Tagged JSON of the observed value, or absent.",
            )
            .with(
                "note.property.remove.expected_revision.title",
                "Previous revision",
            )
            .with(
                "note.property.remove.expected_revision.desc",
                "Exact note revision, if known.",
            )
            .with(SOURCE_ONLY, "«{key}»: source only ({value})")
            .with("mode.hidden", "Hide")
            .with("mode.structured", "Structured")
            .with("mode.source", "Source")
            .with("source_open", "Open source")
            .with(GLOBAL_TITLE, "Vault properties")
            .with(STATUS_TITLE, "Note properties")
            .with(STATUS_COUNT, "Properties: {count}")
            .with(GLOBAL_EMPTY, "No properties found.")
            .with(GLOBAL_FILTER, "Search keys or values")
            .with(GLOBAL_COUNT, "{key} · {count} notes")
            .with(GLOBAL_VALUE_COUNT, "{value} · {count} notes")
            .with(GLOBAL_DOCS, "Open {doc}")
            .with(P_TYPE, "Declared type for «{key}»: {value}")
            .with(
                P_RENAME,
                "Renamed «{old_key}» to «{new_key}» in {count} notes",
            )
            .with(U_RENAME, "Undo rename «{old_key}» to «{new_key}»")
            .with(P_DELETE, "Removed «{key}» from {count} notes")
            .with(U_DELETE, "Undo removing «{key}» from the vault")
            .with(P_MIGRATE, "Converted old properties: {count} notes")
            .with(U_MIGRATE, "Undo converting old properties")
            .with("property.keys.migrate.title", "Convert old properties")
            .with(
                "property.keys.migrate.desc",
                "Write tag, alias and cssclass as tags, aliases and cssclasses across the vault, with a preview and undo.",
            )
            .with(P_ALIAS, "Alias «{alias}» added to {doc}")
            .with(P_ALIAS_PRESENT, "{doc} already has the alias «{alias}»")
            .with(U_ALIAS, "Undo alias «{alias}»")
            .with(P_CLEAR, "Cleared the properties of {doc}")
            .with(P_CLEAR_NONE, "{doc} has no properties")
            .with(U_CLEAR, "Restore the properties of {doc}")
            .with("property.type.set.title", "Declare property type")
            .with(
                "property.type.set.desc",
                "Declare a key's type for this vault.",
            )
            .with("property.type.set.key.title", "Key")
            .with("property.type.set.key.desc", "Key to type.")
            .with("property.type.set.type.title", "Type")
            .with(
                "property.type.set.type.desc",
                "text, list, number, checkbox, date, date_time or tags.",
            )
            .with("property.key.rename.title", "Rename vault property")
            .with(
                "property.key.rename.desc",
                "Rename the key lexically in all notes, with preview.",
            )
            .with("property.key.rename.old_key.title", "Old key")
            .with("property.key.rename.old_key.desc", "Existing key.")
            .with("property.key.rename.new_key.title", "New key")
            .with("property.key.rename.new_key.desc", "Destination key.")
            .with("property.key.delete.title", "Delete vault property")
            .with(
                "property.key.delete.desc",
                "Remove the key from every note that has it, with a preview.",
            )
            .with("property.key.delete.key.title", "Key")
            .with("property.key.delete.key.desc", "Key to remove.")
            .with("note.alias.add.title", "Add alias")
            .with(
                "note.alias.add.desc",
                "Add an alternative name to the note, in the aliases list.",
            )
            .with("note.alias.add.alias.title", "Alias")
            .with("note.alias.add.alias.desc", "The alternative name.")
            .with("note.alias.add.doc.title", "Note")
            .with(
                "note.alias.add.doc.desc",
                "The note; the active one if omitted.",
            )
            .with("note.properties.clear.title", "Clear note properties")
            .with(
                "note.properties.clear.desc",
                "Remove the note's whole frontmatter, with a preview and undo.",
            )
            .with("note.properties.clear.doc.title", "Note")
            .with(
                "note.properties.clear.doc.desc",
                "The note; the active one if omitted.",
            ),
    ])
}

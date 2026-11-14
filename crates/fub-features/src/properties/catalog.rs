//! Le stringhe del pannello e dei comandi delle proprietà.

use super::*;

/// Le stringhe del pannello e dei comandi. Vedi
/// [`backlinks::catalog`](crate::backlinks::catalog) per il perché stiano qui.
pub fn catalog() -> Vec<StringCatalog> {
    crate::formats::speaking(vec![
        options_it(StringCatalog::new("it"))
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
                "text, list, number, checkbox, date, date_time, tags, select, status o url.",
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
        options_en(StringCatalog::new("en"))
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
                "text, list, number, checkbox, date, date_time, tags, select, status or url.",
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

/// I nove colori e i tre gruppi, coi nomi dei colori dei Blocchi
/// (`blocks.color.*` in `markdown/strings.ts`).
const COLOR_NAMES_IT: [&str; 9] = [
    "Grigio",
    "Marrone",
    "Arancione",
    "Giallo",
    "Verde",
    "Blu",
    "Viola",
    "Rosa",
    "Rosso",
];
const COLOR_NAMES_EN: [&str; 9] = [
    "Gray", "Brown", "Orange", "Yellow", "Green", "Blue", "Purple", "Pink", "Red",
];
const GROUP_NAMES_IT: [&str; 3] = ["Da fare", "In corso", "Fatto"];
const GROUP_NAMES_EN: [&str; 3] = ["To do", "In progress", "Done"];

fn option_choices(
    mut catalog: StringCatalog,
    colors: [&str; 9],
    groups: [&str; 3],
) -> StringCatalog {
    for (color, title) in PropertyColor::ALL.iter().zip(colors) {
        catalog = catalog.with(
            format!("{PROPERTY_OPTION_SET}.{COLOR}.{}", color.as_key()),
            title,
        );
    }
    for (group, title) in StatusGroup::ALL.iter().zip(groups) {
        catalog = catalog.with(
            format!("{PROPERTY_OPTION_SET}.{GROUP}.{}", group.as_key()),
            title,
        );
    }
    catalog
}

/// Le opzioni di Selezione e Stato: il comando, il suo annullo, gli errori.
fn options_it(catalog: StringCatalog) -> StringCatalog {
    option_choices(catalog, COLOR_NAMES_IT, GROUP_NAMES_IT)
        .with(P_OPTION_ADD, "Opzione «{option}» aggiunta a «{key}»")
        .with(P_OPTION_SET, "Opzione «{option}» di «{key}» aggiornata")
        .with(P_OPTION_SAME, "L'opzione «{option}» di «{key}» è già così")
        .with(U_OPTION, "Annulla la modifica all'opzione «{option}» di «{key}»")
        .with(P_TYPES_RESTORE, "Tipi delle proprietà rimessi com'erano")
        .with(U_TYPES_RESTORE, "Annulla il ripristino dei tipi delle proprietà")
        .with(
            E_NOT_CHOICE,
            "«{key}» non è una Selezione né uno Stato: le opzioni sono solo per questi due tipi.",
        )
        .with(E_TYPES_SERIALIZE, "Non ho potuto scrivere il registro dei tipi: {reason}")
        .with(E_OPTION_EMPTY, "Il nome dell'opzione è vuoto.")
        .with(E_OPTION_TAKEN, "«{key}» ha già un'opzione «{option}».")
        .with(E_OPTION_MISSING, "«{key}» non ha un'opzione «{option}» da rinominare.")
        .with(E_COLOR, "«{value}» non è uno dei nove colori.")
        .with(E_GROUP, "«{value}» non è un gruppo: todo, doing o done.")
        .with(E_GROUP_NOT_STATUS, "Il gruppo vale solo per lo Stato, e «{key}» è una Selezione.")
        .with(
            E_TYPES_CHANGED,
            "I tipi delle proprietà sono cambiati nel frattempo: riprova sul registro di adesso.",
        )
        .with(
            E_TYPES_UNREADABLE,
            "Il registro dei tipi ({key}) è illeggibile o di una versione più nuova: non lo riscrivo.",
        )
        .with(
            "property.option.set.title",
            "Aggiungi o modifica un'opzione",
        )
        .with(
            "property.option.set.desc",
            "Aggiunge un'opzione a una Selezione o a uno Stato, o la rinomina, la colora e la raggruppa. Le note non cambiano.",
        )
        .with("property.option.set.key.title", "Proprietà")
        .with(
            "property.option.set.key.desc",
            "La chiave dichiarata Selezione o Stato.",
        )
        .with("property.option.set.option.title", "Opzione")
        .with(
            "property.option.set.option.desc",
            "Il nome dell'opzione; se non c'è, si aggiunge in fondo.",
        )
        .with("property.option.set.name.title", "Nuovo nome")
        .with(
            "property.option.set.name.desc",
            "Rinomina l'opzione. I valori già scritti nelle note restano com'erano.",
        )
        .with("property.option.set.color.title", "Colore")
        .with("property.option.set.color.desc", "Uno dei nove colori.")
        .with("property.option.set.group.title", "Gruppo")
        .with(
            "property.option.set.group.desc",
            "Solo per lo Stato: Da fare, In corso o Fatto.",
        )
        .with("property.option.set.expected.title", "Registro letto")
        .with(
            "property.option.set.expected.desc",
            "Il testo del registro che si è letto: se nel frattempo è cambiato, non si scrive.",
        )
        .with(
            "property.types.restore.title",
            "Rimetti i tipi delle proprietà",
        )
        .with(
            "property.types.restore.desc",
            "Rimette il registro dei tipi a un testo di prima, se nessuno l'ha cambiato: è l'annullo delle opzioni.",
        )
        .with("property.types.restore.value.title", "Registro di prima")
        .with(
            "property.types.restore.value.desc",
            "Il testo da rimettere.",
        )
        .with("property.types.restore.expected.title", "Registro di adesso")
        .with(
            "property.types.restore.expected.desc",
            "Il testo che il registro deve avere perché si rimetta quello di prima.",
        )
}

fn options_en(catalog: StringCatalog) -> StringCatalog {
    option_choices(catalog, COLOR_NAMES_EN, GROUP_NAMES_EN)
        .with(P_OPTION_ADD, "Option «{option}» added to «{key}»")
        .with(P_OPTION_SET, "Option «{option}» of «{key}» updated")
        .with(P_OPTION_SAME, "Option «{option}» of «{key}» is already like that")
        .with(U_OPTION, "Undo the change to option «{option}» of «{key}»")
        .with(P_TYPES_RESTORE, "Property types put back as they were")
        .with(U_TYPES_RESTORE, "Undo restoring the property types")
        .with(
            E_NOT_CHOICE,
            "«{key}» is neither a Select nor a Status: options are only for these two types.",
        )
        .with(E_TYPES_SERIALIZE, "Could not write the type registry: {reason}")
        .with(E_OPTION_EMPTY, "The option name is empty.")
        .with(E_OPTION_TAKEN, "«{key}» already has an option «{option}».")
        .with(E_OPTION_MISSING, "«{key}» has no option «{option}» to rename.")
        .with(E_COLOR, "«{value}» is not one of the nine colors.")
        .with(E_GROUP, "«{value}» is not a group: todo, doing or done.")
        .with(E_GROUP_NOT_STATUS, "Groups are only for Status, and «{key}» is a Select.")
        .with(
            E_TYPES_CHANGED,
            "The property types changed in the meantime: try again on the current registry.",
        )
        .with(
            E_TYPES_UNREADABLE,
            "The type registry ({key}) is unreadable or from a newer version: it is not rewritten.",
        )
        .with("property.option.set.title", "Add or change an option")
        .with(
            "property.option.set.desc",
            "Add an option to a Select or a Status, or rename, color and group it. Notes do not change.",
        )
        .with("property.option.set.key.title", "Property")
        .with(
            "property.option.set.key.desc",
            "The key declared as Select or Status.",
        )
        .with("property.option.set.option.title", "Option")
        .with(
            "property.option.set.option.desc",
            "The option name; added at the end if missing.",
        )
        .with("property.option.set.name.title", "New name")
        .with(
            "property.option.set.name.desc",
            "Rename the option. Values already written in notes stay as they are.",
        )
        .with("property.option.set.color.title", "Color")
        .with("property.option.set.color.desc", "One of the nine colors.")
        .with("property.option.set.group.title", "Group")
        .with(
            "property.option.set.group.desc",
            "Status only: To do, In progress or Done.",
        )
        .with("property.option.set.expected.title", "Registry read")
        .with(
            "property.option.set.expected.desc",
            "The registry text that was read: if it changed in the meantime, nothing is written.",
        )
        .with("property.types.restore.title", "Put back property types")
        .with(
            "property.types.restore.desc",
            "Put the type registry back to an earlier text, if nobody changed it: the undo of options.",
        )
        .with("property.types.restore.value.title", "Earlier registry")
        .with("property.types.restore.value.desc", "The text to put back.")
        .with("property.types.restore.expected.title", "Current registry")
        .with(
            "property.types.restore.expected.desc",
            "The text the registry must have for the earlier one to be put back.",
        )
}

//! Le frasi con cui un comando dell'host dice perché il nome scritto in un
//! campo «Documento» non basta: nessun documento adatto si chiama così, o se
//! ne chiamano così più d'uno.
//!
//! La regola è [`fub_abi::command::Args::named_document`]; le frasi stanno nel
//! catalogo del componente che possiede il comando, perché è lui a risolverle.
//! Qui c'è il testo una volta sola, per i cataloghi dell'host che lo portano
//! (il core, Craft, la pubblicazione).

use fub_abi::command::DocumentNameKeys;
use fub_abi::text::StringCatalog;

/// Le chiavi nei cataloghi dei bundle dell'host (Craft, la pubblicazione).
pub(crate) const KEYS: DocumentNameKeys<'static> = DocumentNameKeys {
    missing: "doc.missing",
    ambiguous: "doc.ambiguous",
};

/// Le chiavi nel catalogo del core, col prefisso delle sue chiavi.
pub(crate) const CORE_KEYS: DocumentNameKeys<'static> = DocumentNameKeys {
    missing: "host.doc.missing",
    ambiguous: "host.doc.ambiguous",
};

/// Aggiunge le due frasi, con le chiavi `keys`, ai cataloghi italiano e
/// inglese.
pub(crate) fn speaking(
    keys: DocumentNameKeys<'_>,
    it: StringCatalog,
    en: StringCatalog,
) -> (StringCatalog, StringCatalog) {
    let it = it
        .with(
            keys.missing,
            "Nessun documento che questo comando può usare si chiama «{doc}». Sceglilo \
             dall'elenco del campo.",
        )
        .with(
            keys.ambiguous,
            "Più documenti si chiamano «{doc}»: {docs}. Scegli dall'elenco del campo quello \
             giusto.",
        );
    let en = en
        .with(
            keys.missing,
            "No document this command can use is called “{doc}”. Pick it from the field's list.",
        )
        .with(
            keys.ambiguous,
            "More than one document is called “{doc}”: {docs}. Pick the right one from the \
             field's list.",
        );
    (it, en)
}

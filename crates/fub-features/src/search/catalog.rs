//! Le chiavi dei messaggi d'errore, le impostazioni dei pesi e le stringhe
//! della ricerca.

use super::*;

/// Le chiavi delle stringhe della ricerca.
///
/// Sono **tutte** messaggi d'errore, come nel versioning e per la stessa
/// ragione: la ricerca non disegna niente — il pannello è della shell, e i
/// risultati sono dati — quindi l'unica prosa che scrive è quella di quando non
/// riesce. Undici delle tredici sono un fallimento della libreria d'indice
/// impacchettato (vedi [`motivo`]); le altre due sono le due domande che la
/// ricerca non serve.
pub(super) const INDEX_CREATE: &str = "index_create";
pub(super) const INDEX_LOCKED: &str = "index_locked";
pub(super) const INDEX_READER: &str = "index_reader";
pub(super) const INDEX_COMMIT: &str = "index_commit";
pub(super) const INDEX_RELOAD: &str = "index_reload";
pub(super) const INDEX_CLOSE: &str = "index_close";
pub(super) const MANIFEST_WRITE: &str = "manifest_write";
pub(super) const COUNT: &str = "count";
pub(super) const SEARCH: &str = "search";
pub(super) const SNIPPET: &str = "snippet";
pub(super) const DOC_READ: &str = "doc_read";
pub(super) const TOKENIZER: &str = "tokenizer";
const IO: &str = "io";
pub(super) const UNSERVED_LEAF: &str = "unserved_leaf";
pub(super) const UNSERVED_FAMILY: &str = "unserved_family";
pub(super) const SELECT_UNSUPPORTED: &str = "select_unsupported";
/// I due tetti di `line:`, `block:` e `section:`: si cerca riga per riga, e
/// soltanto dentro un numero limitato di candidati.
pub(super) const SCOPE_TOO_MANY: &str = "scope_too_many";
pub(super) const SCOPE_TOO_LARGE: &str = "scope_too_large";
/// I nomi degli argomenti.
pub(super) const PATH: &str = "path";
pub(super) const REASON: &str = "reason";
pub(super) const WHAT: &str = "what";

/// Le chiavi delle stringhe dei **pesi** (§21.6). Sono le etichette che il
/// pannello disegna, e stanno accanto allo schema che le nomina: una `label`
/// senza la sua `SettingSpec` a fianco è la prima cosa che si disallinea.
///
/// Il suffisso `.label` sulle prime distingue la chiave della *stringa* da
/// quella dell'*impostazione* ([`BOOST_NAME_KEY`] e compagne): sono due spazi di
/// nomi diversi (§7.4) e potrebbero anche coincidere, ma due cose diverse con lo
/// stesso nome dentro lo stesso file sono un invito a scambiarle.
const S_GROUP: &str = "search.group";
const S_NAME: &str = "search.boost.name.label";
const S_NAME_DESC: &str = "search.boost.name.desc";
const S_HEADING: &str = "search.boost.heading.label";
const S_HEADING_DESC: &str = "search.boost.heading.desc";
const S_BODY: &str = "search.boost.body.label";
const S_BODY_DESC: &str = "search.boost.body.desc";
const S_TAGS: &str = "search.boost.tags.label";
const S_TAGS_DESC: &str = "search.boost.tags.desc";

/// Lo schema delle impostazioni della ricerca: **quanto pesa ciascun campo**
/// (§21.6).
///
/// # Perché sta qui e non in `fub-host`
///
/// L'altro schema di una feature ufficiale — l'interruttore del versioning —
/// vive in `fub_host::settings`, e la ragione scritta lì è che quell'interruttore
/// è **dell'host**: il versioning non sa di poter essere spento, e chi lo spegne
/// è chi monta. Qui è l'opposto e va detto, perché la disposizione diversa non
/// sia scambiata per una dimenticanza: un motore di ricerca sa benissimo di
/// avere dei pesi, li legge lui, ed è lui a saper dire cosa vuol dire metterne
/// uno a zero. Questa è la forma normale — un componente che dichiara le proprie
/// chiavi — ed è **esattamente** ciò che scriverebbe un plugin di terzi con un
/// indice configurabile; quella del versioning è l'eccezione, per un
/// interruttore che il componente stesso non possiede.
///
/// Ne segue la proprietà che rende la voce chiusa invece che spostata: i default
/// dello schema **sono** le costanti che il motore usa e che il banco della
/// seduta (`examples/una_ricerca.rs`) importa. Una fonte sola, e nessun posto in
/// cui possano divergere.
///
/// # Quattro chiavi, e i rapporti che contano
///
/// Anche il corpo, il cui default è 1.0 e che di fatto è l'unità di misura degli
/// altri tre. La ragione di dichiararlo lo stesso è che quattro campi
/// indicizzati con tre chiavi lasciano un caso speciale da spiegare a voce; la
/// cosa che va detta — alzarli tutti e quattro insieme non sposta un solo
/// risultato — si dice nella descrizione, che è dove qualcuno la legge.
///
/// Tutte e quattro `program_writable`, come `versioning.enabled`: un peso è
/// reversibile e non riguarda la privacy, e «questo vault è un archivio di
/// paper, alza gli heading» è il profilo di vault che il §11.1 apre. Il permesso
/// `fub:write-settings` resta il primo cancello, e nessun plugin di terzi ce
/// l'ha finché non se lo dichiara e qualcuno glielo concede.
pub fn settings() -> Vec<SettingSpec> {
    let weight = |key: &str, label: &str, desc: &str, default: f32| {
        SettingSpec::new(
            key,
            Text::key(label),
            SettingKind::Number {
                default: default as f64,
                min: Some(BOOST_MIN),
                max: Some(BOOST_MAX),
            },
        )
        .describing(Text::key(desc))
        .grouped(Text::key(S_GROUP))
        .program_writable()
    };
    vec![
        weight(BOOST_NAME_KEY, S_NAME, S_NAME_DESC, PAGE_NAME_BOOST),
        weight(BOOST_HEADING_KEY, S_HEADING, S_HEADING_DESC, HEADING_BOOST),
        weight(BOOST_BODY_KEY, S_BODY, S_BODY_DESC, BODY_BOOST),
        weight(BOOST_TAGS_KEY, S_TAGS, S_TAGS_DESC, TAGS_BOOST),
    ]
}

/// Le stringhe della ricerca: i suoi errori, e le etichette dei suoi pesi.
///
/// Vedi [`backlinks::catalog`](crate::backlinks::catalog) per il perché stia nel
/// componente e non nella shell. Le etichette dei pesi stanno in **questo**
/// catalogo e non in un secondo che il montaggio somma — come fa il versioning —
/// per la stessa ragione per cui ci sta lo schema: sono della ricerca, e un
/// componente che parla di sé lo fa con una voce sola.
///
/// Le descrizioni dicono le due cose che nessuno indovina guardando un numero:
/// che conta il **rapporto** fra i pesi e non il loro valore, e che **zero non
/// spegne la ricerca su quel campo** — la nota si trova ancora, smette solo di
/// salire per merito suo.
pub fn catalog() -> Vec<StringCatalog> {
    vec![
        StringCatalog::new("it")
            .with(
                INDEX_CREATE,
                "Non riesco a creare l'indice di ricerca: {reason}",
            )
            .with(
                INDEX_LOCKED,
                "L'indice di ricerca in {path} è occupato: {reason} — un'altra \
                 istanza di Fub ha forse questo vault già aperto.",
            )
            .with(
                INDEX_READER,
                "Non riesco a leggere l'indice di ricerca: {reason}",
            )
            .with(
                INDEX_COMMIT,
                "Non riesco a salvare l'indice di ricerca: {reason}",
            )
            .with(
                INDEX_RELOAD,
                "Non riesco a ricaricare l'indice di ricerca: {reason}",
            )
            .with(
                INDEX_CLOSE,
                "Non riesco a chiudere l'indice di ricerca: {reason}",
            )
            .with(
                MANIFEST_WRITE,
                "Non riesco a scrivere il manifest dell'indice: {reason}",
            )
            .with(COUNT, "Non riesco a contare i risultati: {reason}")
            .with(SEARCH, "La ricerca non è riuscita: {reason}")
            .with(
                SNIPPET,
                "Non riesco a preparare l'anteprima di un risultato: {reason}",
            )
            .with(
                DOC_READ,
                "Non riesco a leggere un documento dall'indice: {reason}",
            )
            .with(
                TOKENIZER,
                "Non riesco ad analizzare il testo cercato: {reason}",
            )
            .with(IO, "{path} non si legge: {reason}")
            .with(
                UNSERVED_LEAF,
                "La ricerca non valuta questa condizione: {what}",
            )
            .with(
                UNSERVED_FAMILY,
                "La ricerca non serve questa famiglia di domande: {what}",
            )
            .with(
                SELECT_UNSUPPORTED,
                "La ricerca non ordina per proprietà e non sceglie le colonne: \
                 quello lo fa chi ha il frontmatter.",
            )
            .with(
                SCOPE_TOO_MANY,
                "line:, block: e section: guardano al massimo 2048 note: \
                 aggiungi una parola o un filtro.",
            )
            .with(
                SCOPE_TOO_LARGE,
                "line:, block: e section: leggono al massimo 8 MiB di testo: \
                 aggiungi una parola o un filtro.",
            )
            .with(S_GROUP, "Ricerca")
            .with(S_NAME, "Peso del nome della nota")
            .with(
                S_NAME_DESC,
                "Quanto una corrispondenza nel titolo della nota la fa salire fra \
                 i risultati. Conta il rapporto fra i quattro pesi, non il loro \
                 valore: raddoppiarli tutti non cambia nessun ordine. A zero il \
                 campo si cerca ancora — la nota si trova — ma non fa più salire \
                 il risultato; per non cercarci affatto si restringono i campi \
                 della ricerca.",
            )
            .with(S_HEADING, "Peso dei titoli di sezione")
            .with(
                S_HEADING_DESC,
                "Quanto pesa una corrispondenza in un'intestazione. Chi a un \
                 argomento ha dedicato una sezione ne parla più di chi lo nomina \
                 in una riga.",
            )
            .with(S_BODY, "Peso del testo")
            .with(
                S_BODY_DESC,
                "Quanto pesa una corrispondenza nel corpo della nota. È il \
                 riferimento con cui si leggono gli altri tre: lasciandolo a 1 \
                 gli altri pesi si leggono come «quante volte più del testo».",
            )
            .with(S_TAGS, "Peso dei tag")
            .with(
                S_TAGS_DESC,
                "Quanto pesa una corrispondenza in un tag. Alzatelo se le note le \
                 organizzate per tag, abbassatelo se i tag li usate poco.",
            ),
        StringCatalog::new("en")
            .with(INDEX_CREATE, "Cannot create the search index: {reason}")
            .with(
                INDEX_LOCKED,
                "The search index in {path} is busy: {reason} — another instance of \
                 Fub may already have this vault open.",
            )
            .with(INDEX_READER, "Cannot read the search index: {reason}")
            .with(INDEX_COMMIT, "Cannot save the search index: {reason}")
            .with(INDEX_RELOAD, "Cannot reload the search index: {reason}")
            .with(INDEX_CLOSE, "Cannot close the search index: {reason}")
            .with(MANIFEST_WRITE, "Cannot write the index manifest: {reason}")
            .with(COUNT, "Cannot count the results: {reason}")
            .with(SEARCH, "The search failed: {reason}")
            .with(SNIPPET, "Cannot build the preview of a result: {reason}")
            .with(DOC_READ, "Cannot read a document from the index: {reason}")
            .with(TOKENIZER, "Cannot analyse the searched text: {reason}")
            .with(IO, "{path} cannot be read: {reason}")
            .with(
                UNSERVED_LEAF,
                "The search does not evaluate this condition: {what}",
            )
            .with(
                UNSERVED_FAMILY,
                "The search does not serve this family of questions: {what}",
            )
            .with(
                SELECT_UNSUPPORTED,
                "The search does not sort by property and does not pick columns: \
                 that is for whoever has the frontmatter.",
            )
            .with(
                SCOPE_TOO_MANY,
                "line:, block: and section: look at 2048 notes at most: \
                 add a word or a filter.",
            )
            .with(
                SCOPE_TOO_LARGE,
                "line:, block: and section: read 8 MiB of text at most: \
                 add a word or a filter.",
            )
            .with(S_GROUP, "Search")
            .with(S_NAME, "Note name weight")
            .with(
                S_NAME_DESC,
                "How much a match in the note title lifts it among the results. \
                 What counts is the ratio between the four weights, not their \
                 value: doubling them all changes no ordering. At zero the field \
                 is still searched — the note is still found — but it no longer \
                 lifts the result; to not search it at all, narrow the fields of \
                 the search.",
            )
            .with(S_HEADING, "Heading weight")
            .with(
                S_HEADING_DESC,
                "How much a match in a heading weighs. Someone who devoted a \
                 section to a topic says more about it than someone who names it \
                 in one line.",
            )
            .with(S_BODY, "Body weight")
            .with(
                S_BODY_DESC,
                "How much a match in the body of the note weighs. It is the \
                 reference the other three are read against: leaving it at 1 makes \
                 the others read as «how many times more than the body».",
            )
            .with(S_TAGS, "Tag weight")
            .with(
                S_TAGS_DESC,
                "How much a match in a tag weighs. Raise it if you organize your \
                 notes by tag, lower it if you barely use them.",
            ),
    ]
}

pub(super) fn io_err(path: &Utf8Path, and: std::io::Error) -> PluginError {
    PluginError::Internal(Text::message(
        IO,
        vec![
            Arg::text(PATH, path.to_string()),
            Arg::text(REASON, and.to_string()),
        ],
    ))
}

/// Il guscio comune degli undici fallimenti di libreria: una chiave che dice
/// **cosa** non è riuscito, e la causa così come la racconta chi l'ha vista.
///
/// Il `{reason}` resta la frase di Tantivy, in inglese, e non c'è modo di
/// tradurla: viene da fuori. Il degrado però è quello giusto — la frase che la
/// contiene si legge nella lingua di chi guarda, e la causa resta cercabile
/// così com'è, che è precisamente ciò che serve per riportarla a chi la sa
/// leggere.
pub(super) fn reason(key: &str, and: impl std::fmt::Display) -> Text {
    Text::message(key, vec![Arg::text(REASON, and.to_string())])
}

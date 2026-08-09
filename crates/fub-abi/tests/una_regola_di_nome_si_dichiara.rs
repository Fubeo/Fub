//! **Una regola di identità di un nome si dichiara** (decisione 0136).
//!
//! La domanda «quando due nomi sono lo stesso nome» in questo repo ha
//! **quarantadue** risposte in produzione, e non è il difetto. Quattro verbali
//! hanno stabilito che devono essere più d'una: la
//! [0020](../../../docs/decisions/0020-le-regole-in-un-posto-solo.md) («*due
//! requisiti che **devono** divergere, e una fixture che li legasse nascerebbe
//! rossa*»), la
//! [0107](../../../docs/decisions/0107-il-caso-di-una-lettera.md) («*la domanda
//! non era una: erano tre*»), la
//! [0058](../../../docs/decisions/0058-un-nome-che-nasce.md) («*un nome che c'è
//! e un nome che nasce non si giudicano con la stessa regola*») e la
//! [0115](../../../docs/decisions/0115-la-verita-e-la-dichiarazione.md).
//!
//! Il difetto è che la **quarantatreesima** nasce in silenzio. La 0115 lo aveva
//! già scritto — «*il generato, la fixture e il corpus prendono chi **cambia**
//! una regola, non chi ne **aggiunge** una accanto*» — e la
//! [0110](../../../docs/decisions/0110-la-struttura-non-e-una-preferenza.md) è
//! la prova del danno: `IgnorePolicy` confrontava i nomi per uguaglianza di
//! byte **tre commit dopo** che la 0107 aveva deciso quando due path sono lo
//! stesso path.
//!
//! Quindi questo non è un conto che **unifica**: è un conto che **pretende una
//! dichiarazione**. Ogni funzione di produzione che piega il caso, che
//! normalizza in NFC o che decide dove finisce una cartella vuole una riga in
//! [`regole()`] con la sua **famiglia** e la sua **ragione** — e la ragione dice
//! perché quella regola diverge dalle altre della sua famiglia, non cosa fa.
//!
//! # Perché un conto e non una porta
//!
//! La forma alternativa era `fub_abi::rules` esclusiva: ogni regola lì dentro e
//! irraggiungibile altrove. È chiusa quattro volte per iscritto — è la tesi
//! «unifichiamo», che la 0107 ha ripudiato come «*il tipo di riga peggiore che
//! un modulo possa contenere: dichiara **coperto** ciò che non lo è*» — e per
//! giunta è irreversibile: `fub_abi::rules` è WIT-adiacente, e ciò che ci entra
//! ci resta.
//!
//! # La tassonomia non è inventata qui: è estratta
//!
//! Le famiglie sono i **meccanismi incompatibili** che i sorgenti già usano, e
//! il criterio per stare nell'una o nell'altra è scritto in due posti che questo
//! banco non ha aggiunto: `crates/fub-kernel/src/occurrences.rs`, sopra
//! `prefix_len_ci` («*gli offset sono il prodotto di questa funzione*», per cui
//! si confronta carattere per carattere), e `crates/fub-features/src/tags.rs`,
//! sopra `contiene_a_meno_del_caso` («*la corsia veloce vale solo dove è
//! dimostrabilmente la stessa risposta*», cioè su nomi tutti ASCII).
//!
//! # Cosa guarda, e cosa gli sfugge — detto qui e non altrove
//!
//! Guarda ogni `.rs` sotto una cartella `src/`, ovunque nel repo, senza un
//! elenco di crate scritto a mano — la forma di
//! `una_sola_tabella_di_escape.rs`, ed è la forma giusta qui perché le regole
//! stanno in **sei** crate e un elenco di `include_str!` sarebbe la stessa
//! dimenticanza che il conto cerca. Salta la prosa (un commento che *racconta*
//! questo difetto ne nomina i gesti, e questo file ne è il primo esempio) e i
//! moduli `#[cfg(test)]`.
//!
//! Non guarda, ed è dichiarato:
//!
//! - **i `tests/`**. Un banco che scrive `to_lowercase()` per costruirsi
//!   un'attesa non sta installando una regola di produzione.
//! - **la shell TypeScript.** `frontend/` ha le sue regole di nome, e nessun
//!   attore le lega a queste; è la zona cieca che la 0115 aveva già nominata,
//!   e resta.
//! - **una regola scritta senza uno di questi gesti.** `MemoryHost::data_list`
//!   decide il contenimento con `starts_with(prefix + "/")` e non con un trim,
//!   quindi passa. La maglia intercetta il gesto **comodo**, che è l'unico che
//!   qualcuno farà avendo fretta; chi scrive la variante lunga sta già
//!   pensando, ed è l'unico caso in cui il conto può permettersi di non
//!   guardare.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

// ---------------------------------------------------------------------------
// Le famiglie
// ---------------------------------------------------------------------------

/// **Il gesto** che si legge nel sorgente. È ciò che il conto sa vedere, e non
/// coincide con la famiglia: serve a verificare che la famiglia dichiarata sia
/// almeno *compatibile* con ciò che la funzione fa davvero.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Gesto {
    /// `to_lowercase` / `to_uppercase`, su `str` o su `char`.
    Caso,
    /// `to_ascii_lowercase` / `to_ascii_uppercase` / `eq_ignore_ascii_case`.
    CasoAscii,
    /// `.nfc()` / `.nfd()`.
    Nfc,
    /// Un `/` tagliato da un capo o da tutti e due: è la forma in cui in questo
    /// repo si scrive «dove finisce una cartella».
    Confine,
}

/// **La famiglia** di una regola: quale meccanismo risponde, non quale domanda.
///
/// I tre meccanismi di piegatura del caso sono incompatibili fra loro e la
/// differenza è misurabile: `str::to_lowercase` è sensibile al contesto (`ΟΔΟΣ`
/// finisce in `οδος`, non in `οδοσ`) e sa allungare (`İ` diventa due caratteri);
/// `char::to_lowercase` non ha contesto e non lo sa; la corsia ASCII non ha né
/// l'uno né l'altro problema **e** non ha nessuna delle due capacità.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Famiglia {
    /// `str::to_lowercase`: full-Unicode, sensibile al contesto. È la
    /// piegatura di [`fub_abi::rules::path::resolution_key`], cioè quella da cui
    /// tutte le altre divergono.
    CasoContestuale,
    /// `char::to_lowercase`: senza contesto. Si sceglie **solo** quando il
    /// prodotto della funzione è un offset nel testo originale, perché una
    /// copia minuscola ha un'altra lunghezza in byte.
    CasoPerCarattere,
    /// `eq_ignore_ascii_case` / `to_ascii_lowercase`: la corsia che vale solo
    /// dove è dimostrabilmente la stessa risposta della contestuale.
    CasoAscii,
    /// NFC **senza** piegare il caso: due nomi che si scrivono con gli stessi
    /// caratteri e byte diversi sono lo stesso nome, ma `A` e `a` no.
    SoloNfc,
    /// Dove finisce una cartella: quali `/` si tagliano, e da quale capo.
    ConfineDiCartella,
}

impl Famiglia {
    /// Il gesto che una regola di questa famiglia **deve** mostrare. Senza
    /// questo legame la famiglia sarebbe una decorazione: si potrebbe scrivere
    /// `SoloNfc` accanto a una funzione che piega il caso e nessuno lo saprebbe.
    fn gesto(self) -> Gesto {
        match self {
            Famiglia::CasoContestuale | Famiglia::CasoPerCarattere => Gesto::Caso,
            Famiglia::CasoAscii => Gesto::CasoAscii,
            Famiglia::SoloNfc => Gesto::Nfc,
            Famiglia::ConfineDiCartella => Gesto::Confine,
        }
    }
}

// ---------------------------------------------------------------------------
// L'allowlist
// ---------------------------------------------------------------------------

/// Le regole di identità di un nome che esistono, con la famiglia e la ragione.
///
/// La chiave è `percorso/del/file.rs::funzione`. Si controlla in **tutte e due
/// le direzioni**: una funzione che compare nei sorgenti e non è qui è rossa, e
/// una riga che non corrisponde più a niente è rossa anche lei — un'allowlist
/// che resta lunga mentre il codice si accorcia smette di essere una fotografia
/// e diventa un ricordo (è la lezione di `un_lucchetto_solo.rs`).
///
/// **La ragione dice perché quella regola diverge dalle altre della sua
/// famiglia.** Dove è già scritta nel sorgente, è citata invece che riscritta:
/// una seconda stesura è una seconda regola, e questo banco esiste per contarle.
fn regole() -> BTreeMap<&'static str, (Famiglia, &'static str)> {
    BTreeMap::from([
        // -- CasoContestuale: la piegatura di riferimento ------------------
        (
            "crates/fub-abi/src/rules/path.rs::resolution_key",
            (
                Famiglia::CasoContestuale,
                "non diverge: è l'origine. «Unico punto di normalizzazione. Chi confronta due \
                 nomi di documento … deve passare da qui» (path.rs). Ogni altra riga di questa \
                 tabella si giudica rispetto a lei.",
            ),
        ),
        (
            "crates/fub-abi/src/model.rs::canonical_tag",
            (
                Famiglia::CasoContestuale,
                "diverge da `resolution_key` per la NFC, che non fa: è il difetto 0140 e non una \
                 ragione. Sta qui perché un tag non è un path e non passa dalla risoluzione, ma \
                 il passo mancante è dichiarato, non giustificato.",
            ),
        ),
        (
            "crates/fub-abi/src/model.rs::canonical_anchor",
            (
                Famiglia::CasoContestuale,
                "come `canonical_tag`, e per lo stesso difetto 0140. Diverge da lei per il solo \
                 fatto che un'ancora non ha gerarchia: nessuna delle due normalizza.",
            ),
        ),
        (
            "crates/fub-abi/src/rules/properties.rs::contains",
            (
                Famiglia::CasoContestuale,
                "confronta due valori di proprietà, non due nomi di file: piega entrambi i capi \
                 perché «chi filtra a mano non ricorda come aveva scritto il tag» \
                 (properties.rs), e la NFC non le serve perché nessuno dei due capi è un path.",
            ),
        ),
        (
            "crates/fub-features/src/tags.rs::contiene_a_meno_del_caso",
            (
                Famiglia::CasoContestuale,
                "ha due corsie e la lenta è questa: la ragione è scritta per intero sopra la \
                 funzione, ed è la sola riga del repo che spiega perché la corsia ASCII non è \
                 sempre lecita — «la corsia veloce vale solo dove è dimostrabilmente la stessa \
                 risposta». È il criterio di questa tabella.",
            ),
        ),
        (
            "crates/fub-features/src/tags.rs::build_tags_view",
            (
                Famiglia::CasoContestuale,
                "non è una regola di confronto: prepara l'ago **una volta** perché \
                 `contiene_a_meno_del_caso` lo riceve già minuscolo. Diverge perché piega un \
                 solo capo, e il contratto di quel capo sta nella riga di doc della funzione che \
                 lo consuma.",
            ),
        ),
        (
            "crates/fub-abi/src/custom.rs::claims",
            (
                Famiglia::CasoContestuale,
                "l'identità qui non è un nome di file ma la **chiave di contesa** fra due regole \
                 di sintassi sullo stesso formato: l'info string di un fence è scritta \
                 dall'autore della nota, e `RUST` e `rust` sono la stessa rivendicazione.",
            ),
        ),
        (
            "crates/fub-kernel/src/syntax.rs::apply",
            (
                Famiglia::CasoContestuale,
                "è il lato lettura di `custom.rs::claims` e deve piegare **come lei**, o una \
                 regola registrata come `Rust` non aggancerebbe mai il fence che ha rivendicato. \
                 La divergenza qui sarebbe il difetto, non la coincidenza.",
            ),
        ),
        (
            "crates/fub-kernel/src/syntax.rs::fence_rule",
            (
                Famiglia::CasoContestuale,
                "l'altro capo di `apply`: piega ciò che sta nel documento, mentre `apply` piega \
                 ciò che sta nella regola. Sono due stringhe diverse e una sola risposta, ed è \
                 per questo che non si possono scrivere in due modi.",
            ),
        ),
        (
            "crates/fub-kernel/src/registry.rs::register",
            (
                Famiglia::CasoContestuale,
                "l'identità di un'estensione nel registro è full-Unicode e non ASCII, e diverge \
                 apposta da `rules/media.rs`: qui l'estensione arriva dal **descrittore di un \
                 provider**, che è testo di terzi, non dal nome di un file del vault.",
            ),
        ),
        (
            "crates/fub-kernel/src/registry.rs::insert",
            (
                Famiglia::CasoContestuale,
                "è la scrittura della mappa che `register` interroga: divergere da lei vorrebbe \
                 dire un provider registrato sotto una chiave che nessuno cercherà.",
            ),
        ),
        (
            "crates/fub-kernel/src/registry.rs::provider_for_ext",
            (
                Famiglia::CasoContestuale,
                "la lettura della stessa mappa. Le tre righe di `registry.rs` sono una regola \
                 sola scritta nei tre punti in cui la chiave si costruisce, ed è il caso in cui \
                 il conto pretende che restino uguali.",
            ),
        ),
        (
            "crates/fub-kernel/src/registry.rs::default_extension",
            (
                Famiglia::CasoContestuale,
                "non interroga la mappa — «non si guarda `by_ext`, che è una mappa e non ha un \
                 primo» (registry.rs) — ma deve rendere l'estensione nella stessa forma, perché \
                 è quella con cui una nota nuova nascerà e verrà poi ricercata.",
            ),
        ),
        (
            "crates/fub-kernel/src/documents.rs::extension_of",
            (
                Famiglia::CasoContestuale,
                "è la chiave con cui il kernel interroga `registry.rs`, e piega come lei per \
                 costruzione. Diverge da `media.rs::kind_of`, che sulla stessa estensione è \
                 ASCII, perché quella risponde a «che specie di file è» e questa a «chi lo sa \
                 parsare».",
            ),
        ),
        (
            "crates/fub-abi/src/transfer.rs::extension",
            (
                Famiglia::CasoContestuale,
                "l'estensione di un file **in arrivo da fuori**, che sceglie il provider \
                 d'import: sta dal lato di `registry.rs` e non da quello di `media.rs`, per la \
                 stessa ragione.",
            ),
        ),
        (
            "crates/fub-sdk/src/testing/mod.rs::format_of",
            (
                Famiglia::CasoContestuale,
                "`MemoryHost` deve rispondere **come il kernel**, o un plugin provato contro di \
                 lui passerebbe nel banco e fallirebbe nell'app: la sua divergenza sarebbe una \
                 conformità falsa.",
            ),
        ),
        (
            "crates/fub-format-markdown/src/parse.rs::convert_block",
            (
                Famiglia::CasoContestuale,
                "non piega un nome scritto da qualcuno: piega il `Debug` di un enum di `comrak` \
                 (`Note`, `Tip`, …) per farne il campo `type` di un callout. La sorgente è \
                 generata dal compilatore, quindi la piegatura non ha un'altra regola con cui \
                 divergere.",
            ),
        ),
        (
            "crates/fub-kernel/src/index/plan.rs::name_of_predicate",
            (
                Famiglia::CasoContestuale,
                "come sopra: il `Debug` di `PredicateKind` che diventa il nome di un passo di \
                 piano. È diagnostica, non identità — nessuno confronta questa stringa con una \
                 scritta da un utente.",
            ),
        ),
        (
            "crates/fub-kernel/src/log.rs::compose",
            (
                Famiglia::CasoContestuale,
                "il livello di log in maiuscolo dentro una riga di file. È l'unica riga della \
                 tabella che va **verso l'alto**, e nessuno la riconverte: si legge «con `grep` \
                 e con l'occhio» (log.rs).",
            ),
        ),
        (
            "crates/fub-sdk/src/testing/conformita.rs::gli_span_affettano_la_sorgente",
            (
                Famiglia::CasoContestuale,
                "non installa una regola: **asserisce** che il `marker` di un'ancora nomini la \
                 sua ancora, e piega i due capi perché l'id normalizzato e il testo scritto \
                 possono differire di una maiuscola. Sta nei `src/` perché è la suite che i \
                 plugin di terzi eseguono.",
            ),
        ),
        // -- CasoPerCarattere: il caso in cui l'offset è il prodotto --------
        (
            "crates/fub-kernel/src/occurrences.rs::prefix_len_ci",
            (
                Famiglia::CasoPerCarattere,
                "la ragione è scritta sopra la funzione ed è l'asse di questa famiglia: «gli \
                 offset sono il prodotto di questa funzione: `to_lowercase` può cambiare la \
                 lunghezza in byte di ciò che tocca … e uno span misurato su un testo diverso da \
                 quello che l'editor ha aperto porterebbe il cursore altrove». Le manca la NFC, \
                 ed è il difetto 0140.",
            ),
        ),
        (
            "crates/fub-abi/src/model.rs::heading_slug",
            (
                Famiglia::CasoPerCarattere,
                "piega carattere per carattere perché sta già iterando i caratteri per tenere \
                 solo gli alfanumerici: non ha un offset da difendere come `prefix_len_ci`, ha \
                 un filtro. È la ragione per cui su NFD non diverge soltanto ma **cancella** \
                 l'accento (una `Mn` non è alfanumerica) — difetto 0140.",
            ),
        ),
        // -- CasoAscii: dove è dimostrabilmente la stessa risposta ----------
        (
            "crates/fub-abi/src/rules/media.rs::kind_of",
            (
                Famiglia::CasoAscii,
                "confronta un'estensione contro le estensioni dei provider dichiarati: sono \
                 token di formato, e un formato con un'estensione non ASCII non esiste. Diverge \
                 da `registry.rs` apposta, e la differenza è il §25.2.",
            ),
        ),
        (
            "crates/fub-abi/src/rules/media.rs::mime_for_ext",
            (
                Famiglia::CasoAscii,
                "la tabella dei MIME è ASCII per costruzione: «`FOTO.PNG` arriva dalle \
                 fotocamere e dai vault che vengono da Windows» (media.rs). Piega l'ingresso e \
                 non la tabella perché la tabella è già minuscola nel sorgente.",
            ),
        ),
        (
            "crates/fub-abi/src/rules/health.rs::is_attachment",
            (
                Famiglia::CasoAscii,
                "è la stessa domanda di `kind_of` vista al rovescio (non-documento invece che \
                 documento) e deve piegare **come lei**, o un `.MD` sarebbe un allegato per una \
                 delle due e un documento per l'altra.",
            ),
        ),
        (
            "crates/fub-abi/src/net.rs::header",
            (
                Famiglia::CasoAscii,
                "non è una regola di Fub: è HTTP. I nomi di header sono `token` per la RFC 9110, \
                 cioè ASCII, e piegarli in full-Unicode aggiungerebbe corrispondenze che il \
                 protocollo non ha.",
            ),
        ),
        (
            "crates/fub-abi/src/text.rs::template",
            (
                Famiglia::CasoAscii,
                "confronta un tag di lingua BCP 47, che è ASCII per la sua stessa grammatica: \
                 `IT` e `it` sono la stessa lingua, e non c'è nessun altro modo di scriverla.",
            ),
        ),
        (
            "crates/fub-abi/src/rules/path_policy.rs::is_dos_device",
            (
                Famiglia::CasoAscii,
                "i device DOS sono undici nomi ASCII fissati da Windows: «`con`, `CON.md` e \
                 `Con.txt.md` sono tutti la console» (path_policy.rs). Piegare in full-Unicode \
                 rifiuterebbe nomi che Windows accetta.",
            ),
        ),
        (
            "crates/fub-kernel/src/host/guard.rs::normalized_host",
            (
                Famiglia::CasoAscii,
                "un host DNS è ASCII o è punycode, e il limite è già dichiarato sopra la \
                 funzione: «non fa punycode … è un limite vero e sta scritto invece che \
                 scoperto». Una piegatura full-Unicode farebbe **credere** di averlo risolto.",
            ),
        ),
        (
            "crates/fub-kernel/src/host/guard.rs::split_url",
            (
                Famiglia::CasoAscii,
                "lo schema di un URL è ASCII per la RFC 3986. Sta accanto a `normalized_host` e \
                 non dentro: sono due capi dell'URL con due grammatiche diverse, e fonderli \
                 vorrebbe dire una regola che non è né dell'uno né dell'altro.",
            ),
        ),
        (
            "crates/fub-features/src/commands.rs::parse_value",
            (
                Famiglia::CasoAscii,
                "piega le parole di un toggle (`true`, `on`, `sì`) prima di confrontarle con un \
                 elenco letterale. Non è identità di un nome ma di un **valore di \
                 impostazione**, e l'elenco a cui si confronta è scritto qui accanto: piegare di \
                 più non aggiungerebbe nessuna risposta.",
            ),
        ),
        // -- SoloNfc: stessi caratteri, byte diversi ------------------------
        (
            "crates/fub-abi/src/rules/path.rs::exact_key",
            (
                Famiglia::SoloNfc,
                "la ragione è scritta sopra la funzione: «`resolution_key` dice **chi è \
                 candidato**, `exact_key` dice **chi ha ragione fra i candidati**». Divergere \
                 sul caso è il suo mestiere, non un difetto.",
            ),
        ),
        (
            "crates/fub-abi/src/rules/path_policy.rs::normalized",
            (
                Famiglia::SoloNfc,
                "normalizza per **segmento** e non sull'intera stringa, perché è la forma su cui \
                 `check` giudica un nome nuovo: «composte qui, non c'è più un ordine da \
                 ricordare» (path_policy.rs). Non piega il caso perché un nome nuovo si scrive \
                 come l'utente lo ha scritto (decisione 0058).",
            ),
        ),
        // -- ConfineDiCartella ---------------------------------------------
        (
            "crates/fub-abi/src/query.rs::within_folder",
            (
                Famiglia::ConfineDiCartella,
                "taglia i soli `/` **finali** e ha il ramo su sé stessa (`own == path`), perché \
                 risponde per un file **e** per una cartella: «per un file `own` è la cartella \
                 che lo contiene, per una cartella è la sua genitrice» (query.rs). È la regola \
                 dei predicati d'indice.",
            ),
        ),
        (
            "crates/fub-abi/src/rules/events.rs::folder_contains",
            (
                Famiglia::ConfineDiCartella,
                "taglia i `/` finali e **non** ha il ramo su sé stessa, ed è deliberato: la \
                 domanda degli eventi è «un documento dentro» e una cartella non è un documento. \
                 Diverge da `within_folder` sul caso `folder == id`, che per un evento non si \
                 presenta. Difetto 0141.",
            ),
        ),
        (
            "crates/fub-abi/src/transfer.rs::in_folder",
            (
                Famiglia::ConfineDiCartella,
                "taglia i `/` da **entrambi** i capi, perché la cartella d'export arriva da una \
                 richiesta di terzi e non da un `DocId`. È la terza risposta alla stessa \
                 domanda, e il banco di `transfer.rs` asserisce vero ciò che `within_folder` dà \
                 falso. Difetto 0141: qui è dichiarata, non risolta.",
            ),
        ),
        (
            "crates/fub-abi/src/transfer.rs::destination",
            (
                Famiglia::ConfineDiCartella,
                "non chiede se qualcosa sta dentro: **compone** un `DocId` dentro la cartella \
                 chiesta. Taglia da entrambi i capi come `in_folder` perché la stringa è la \
                 stessa, e divergere significherebbe importare in una cartella diversa da quella \
                 che poi si interroga.",
            ),
        ),
        (
            "crates/fub-features/src/search.rs::translate_predicate",
            (
                Famiglia::ConfineDiCartella,
                "non confronta: costruisce il **termine** con cui l'indice full-text è stato \
                 scritto, e taglia i `/` finali per farlo combaciare con `within_folder`, che è \
                 la regola che ha prodotto quel campo. Un trim diverso qui sarebbe una ricerca \
                 che non trova mai nulla.",
            ),
        ),
        (
            "crates/fub-features/src/commands.rs::vault_archive",
            (
                Famiglia::ConfineDiCartella,
                "normalizza la cartella d'archivio **scritta dall'utente** in un comando prima \
                 di comporne i `DocId`: taglia i soli `/` finali perché uno iniziale sarebbe un \
                 path assoluto, e quello lo rifiuta `valid_doc_id`, non questa riga.",
            ),
        ),
        (
            "crates/fub-kernel/src/workspace.rs::valid_doc_id",
            (
                Famiglia::ConfineDiCartella,
                "taglia il `/` **iniziale**, ed è l'unica della famiglia: è «la tolleranza del \
                 varco … di questo ingresso e non della regola» (workspace.rs). Non risponde \
                 alla domanda del contenimento, ma tocca lo stesso confine e la sua divergenza \
                 dev'essere visibile accanto alle altre.",
            ),
        ),
    ])
}

// ---------------------------------------------------------------------------
// Il cammino sui sorgenti
// ---------------------------------------------------------------------------

const NON_SI_ENTRA: &[&str] = &["target", "node_modules", ".git", ".fub"];

fn radice() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn sorgenti_di_produzione() -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    cammina(&radice(), "", &mut out);
    out
}

fn cammina(dir: &Path, rel: &str, out: &mut BTreeMap<String, String>) {
    let voci =
        std::fs::read_dir(dir).unwrap_or_else(|e| panic!("`{}` non si legge: {e}", dir.display()));
    for voce in voci {
        let voce = voce.unwrap_or_else(|e| panic!("dentro `{}`: {e}", dir.display()));
        let nome = voce
            .file_name()
            .into_string()
            .unwrap_or_else(|n| panic!("nome di file non UTF-8: {n:?}"));
        let percorso = if rel.is_empty() {
            nome.clone()
        } else {
            format!("{rel}/{nome}")
        };
        let tipo = voce
            .file_type()
            .unwrap_or_else(|e| panic!("`{percorso}`: {e}"));
        if tipo.is_dir() {
            if !NON_SI_ENTRA.contains(&nome.as_str()) {
                cammina(&voce.path(), &percorso, out);
            }
        } else if nome.ends_with(".rs") && percorso.contains("/src/") {
            let src = std::fs::read_to_string(voce.path())
                .unwrap_or_else(|e| panic!("`{percorso}` non si legge: {e}"));
            out.insert(percorso, src);
        }
    }
}

/// Le righe **di codice** di un sorgente, numerate da 1: niente commenti di
/// riga, niente modulo di prova.
///
/// È la stessa estrazione di `una_sola_tabella_di_escape.rs`, e per la stessa
/// ragione: in un repo in cui i file spiegano sé stessi, un conto che leggesse
/// la prosa presidierebbe se stesso.
fn righe_di_codice(sorgente: &str) -> Vec<(usize, &str)> {
    let righe: Vec<&str> = sorgente.lines().collect();
    let mut out = Vec::new();
    let mut n = 0;
    while n < righe.len() {
        let riga = righe[n];
        if riga.trim_start().starts_with("//") {
            n += 1;
            continue;
        }
        if riga == "#[cfg(test)]" && righe.get(n + 1).is_some_and(|r| r.starts_with("mod ")) {
            let fine = righe
                .iter()
                .enumerate()
                .skip(n + 2)
                .find(|(_, r)| **r == "}")
                .map(|(i, _)| i)
                .unwrap_or(righe.len() - 1);
            n = fine + 1;
            continue;
        }
        out.push((n + 1, riga));
        n += 1;
    }
    out
}

/// Il nome della funzione che una riga apre, se la apre.
///
/// Riconosce la sola forma che `cargo fmt` produce: modificatori, `fn`, nome.
/// Una riga che non è una firma non cambia la funzione corrente, quindi un
/// gesto scritto fuori da ogni `fn` si attribuisce a `<fuori>` — che non sta in
/// [`regole()`] e quindi è rosso, che è il verso giusto.
fn firma(riga: &str) -> Option<&str> {
    let t = riga.trim_start();
    let mut resto = t;
    for prefisso in ["pub(crate) ", "pub(super) ", "pub(self) ", "pub "] {
        if let Some(r) = resto.strip_prefix(prefisso) {
            resto = r;
            break;
        }
    }
    for prefisso in ["const ", "async ", "unsafe ", "extern \"C\" "] {
        if let Some(r) = resto.strip_prefix(prefisso) {
            resto = r;
        }
    }
    let resto = resto.strip_prefix("fn ")?;
    let fine = resto
        .find(|c: char| !c.is_alphanumeric() && c != '_')
        .unwrap_or(resto.len());
    match fine {
        0 => None,
        _ => Some(&resto[..fine]),
    }
}

/// Il gesto che una riga di codice mostra, se ne mostra uno.
fn gesto(riga: &str) -> Option<Gesto> {
    const ASCII: &[&str] = &[
        "to_ascii_lowercase",
        "to_ascii_uppercase",
        "eq_ignore_ascii_case",
    ];
    const CASO: &[&str] = &["to_lowercase", "to_uppercase"];
    const CONFINE: &[&str] = &[
        "trim_matches('/')",
        "trim_end_matches('/')",
        "trim_start_matches('/')",
    ];
    if ASCII.iter().any(|a| riga.contains(a)) {
        return Some(Gesto::CasoAscii);
    }
    if CASO.iter().any(|a| riga.contains(a)) {
        return Some(Gesto::Caso);
    }
    if riga.contains(".nfc()") || riga.contains(".nfd()") {
        return Some(Gesto::Nfc);
    }
    match CONFINE.iter().any(|a| riga.contains(a)) {
        true => Some(Gesto::Confine),
        false => None,
    }
}

/// Le regole viste nei sorgenti: chiave `file::funzione` → i gesti che mostra,
/// con la prima riga in cui compare ciascuno.
fn censimento() -> BTreeMap<String, (BTreeSet<Gesto>, usize)> {
    let mut out: BTreeMap<String, (BTreeSet<Gesto>, usize)> = BTreeMap::new();
    for (file, sorgente) in sorgenti_di_produzione() {
        let mut dentro = "<fuori>".to_string();
        for (n, riga) in righe_di_codice(&sorgente) {
            if let Some(nome) = firma(riga) {
                dentro = nome.to_string();
            }
            if let Some(g) = gesto(riga) {
                let voce = out
                    .entry(format!("{file}::{dentro}"))
                    .or_insert((BTreeSet::new(), n));
                voce.0.insert(g);
            }
        }
    }
    out
}

// ---------------------------------------------------------------------------
// I conti
// ---------------------------------------------------------------------------

/// **Una regola di identità di un nome vuole una famiglia e una ragione.**
#[test]
fn nessuna_regola_di_nome_senza_dichiarazione() {
    let regole = regole();
    let visti = censimento();

    let nuove: Vec<String> = visti
        .iter()
        .filter(|(k, _)| !regole.contains_key(k.as_str()))
        .map(|(k, (gesti, n))| format!("{k}  (riga {n}, {gesti:?})"))
        .collect();
    assert!(
        nuove.is_empty(),
        "{} regole di identità di un nome sono nate senza che nessuno le dichiarasse:\n  {}\n\n\
         Non è un invito a unificarle: il repo ha deciso quattro volte che devono essere più \
         d'una (decisioni 0020, 0107, 0058, 0115). È che la prossima non si accorge di essere \
         la prossima. Ogni riga vuole una voce in `regole()` con la sua **famiglia** — quale dei \
         meccanismi incompatibili usa — e la sua **ragione**, che dice perché diverge dalle \
         altre della stessa famiglia. Se la ragione non si riesce a scrivere, la risposta non è \
         inventarla: è che quella regola era una delle altre.",
        nuove.len(),
        nuove.join("\n  ")
    );

    let scadute: Vec<&str> = regole
        .keys()
        .filter(|k| !visti.contains_key(**k))
        .copied()
        .collect();
    assert!(
        scadute.is_empty(),
        "queste righe di `regole()` non corrispondono più a niente: {scadute:?} — \
         un'allowlist che resta lunga mentre il codice si accorcia è un ricordo, non una \
         fotografia"
    );
}

/// **La famiglia dichiarata è compatibile con ciò che la funzione fa.**
///
/// Senza questo conto la colonna *famiglia* sarebbe una decorazione: si potrebbe
/// scrivere `SoloNfc` accanto a una funzione che piega il caso in ASCII, e la
/// tabella direbbe il contrario del sorgente restando verde.
#[test]
fn la_famiglia_dichiarata_e_quella_che_si_legge() {
    let visti = censimento();
    let mut bugie = Vec::new();
    for (chiave, (famiglia, _)) in regole() {
        let Some((gesti, _)) = visti.get(chiave) else {
            continue; // lo dice l'altro conto
        };
        if !gesti.contains(&famiglia.gesto()) {
            bugie.push(format!(
                "{chiave}: dichiara {famiglia:?} (gesto {:?}) ma nel sorgente si legge {gesti:?}",
                famiglia.gesto()
            ));
        }
    }
    assert!(
        bugie.is_empty(),
        "la famiglia dichiarata non è quella che il sorgente mostra:\n  {}",
        bugie.join("\n  ")
    );
}

/// **Ogni riga porta una ragione, e la ragione non è il nome della funzione.**
///
/// La forma degenere di un'allowlist con una colonna «perché» è quella in cui il
/// perché ripete il cosa. Il conto non sa leggere l'italiano; sa però che una
/// ragione lunga come un nome non è una ragione, e che una che contiene il nome
/// della funzione e nient'altro di più lungo lo sta ripetendo.
#[test]
fn ogni_ragione_dice_qualcosa() {
    let corte: Vec<String> = regole()
        .into_iter()
        .filter(|(_, (_, perche))| perche.chars().count() < 80)
        .map(|(k, (_, perche))| format!("{k}: {perche:?}"))
        .collect();
    assert!(
        corte.is_empty(),
        "queste ragioni non argomentano niente:\n  {}",
        corte.join("\n  ")
    );
}

/// Il test del test: `nessuna_regola_di_nome_senza_dichiarazione` è verde anche
/// se il cammino non trova niente e se l'estrattore salta tutto, e le due avarie
/// sono indistinguibili da un repo dichiarato per intero.
#[test]
fn il_cammino_e_l_estrattore_agganciano() {
    let sorgenti = sorgenti_di_produzione();
    assert!(
        sorgenti.len() > 50,
        "solo {} sorgenti di produzione trovati: il camminatore non sta camminando",
        sorgenti.len()
    );

    let visti = censimento();
    assert_eq!(
        visti.len(),
        regole().len(),
        "il censimento vede {} regole e la tabella ne dichiara {}",
        visti.len(),
        regole().len()
    );
    assert!(
        visti.len() > 30,
        "il censimento vede solo {} regole: l'estrattore sta saltando più del dovuto",
        visti.len()
    );

    // Le cinque famiglie sono tutte popolate: una famiglia vuota sarebbe una
    // tassonomia inventata, che è precisamente ciò che questo banco non deve
    // fare.
    for famiglia in [
        Famiglia::CasoContestuale,
        Famiglia::CasoPerCarattere,
        Famiglia::CasoAscii,
        Famiglia::SoloNfc,
        Famiglia::ConfineDiCartella,
    ] {
        assert!(
            regole().values().any(|(f, _)| *f == famiglia),
            "la famiglia {famiglia:?} non ha nessuna regola: o non esiste, o il censimento non \
             la vede più"
        );
    }

    // E l'estrattore salta davvero i moduli di prova: `path.rs` ne ha uno che
    // nomina `resolution_key` e `to_lowercase`, e nessuna delle sue righe è
    // finita nel censimento sotto una funzione di test.
    let path_rs = sorgenti
        .get("crates/fub-abi/src/rules/path.rs")
        .expect("`rules/path.rs` non è stato letto dal camminatore");
    assert!(
        path_rs.contains("#[cfg(test)]"),
        "`rules/path.rs` non ha più un modulo di prova: questo controllo non aggancia più niente"
    );
    assert!(
        !visti.keys().any(|k| k.contains("::tests")),
        "una funzione di prova è entrata nel censimento"
    );
}

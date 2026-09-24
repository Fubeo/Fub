//! **Una regola di identità di un nome si dichiara** (decisione 0136).
//!
//! La domanda «quando due nomi sono lo stesso nome» in questo repo ha
//! **quarantacinque** risposte in produzione, e non è il difetto. Quattro verbali
//! hanno stabilito che devono essere più d'una: la
//! [0020](../../../docs/decisions/README.md) («*due
//! requisiti che **devono** divergere, e una fixture che li legasse nascerebbe
//! rossa*»), la
//! [0107](../../../docs/decisions/0192-impostazioni-locale-e-temi.md) («*la domanda
//! non era una: erano tre*»), la
//! [0058](../../../docs/decisions/0187-autorita-e-schemi-su-disco.md) («*un nome che c'è
//! e un nome che nasce non si giudicano con la stessa regola*») e la
//! [0115](../../../docs/decisions/0196-test-e-artefatti-generati.md).
//!
//! Il difetto è che la **quarantaseiesima** nasce in silenzio. La 0115 lo aveva
//! già scritto — «*il generato, la fixture e il corpus prendono chi **cambia**
//! una regola, non chi ne **aggiunge** una accanto*» — e la
//! [0110](../../../docs/decisions/0192-impostazioni-locale-e-temi.md) è
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
//! `prefix_len_there` («*gli offset sono il prodotto di questa funzione*», per cui
//! si confronta carattere per carattere), e `crates/fub-features/src/tags.rs`,
//! sopra `matches_case_insensitive` («*la corsia veloce vale solo dove è
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
//! - **la shell TypeScript.** `apps/client/` ha le sue regole di nome, e nessun
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
enum Gesture {
    /// `to_lowercase` / `to_uppercase`, su `str` o su `char`.
    Case,
    /// `to_ascii_lowercase` / `to_ascii_uppercase` / `eq_ignore_ascii_case`.
    AsciiCase,
    /// `.nfc()` / `.nfd()`.
    Nfc,
    /// Un `/` tagliato da un capo o da tutti e due: è la forma in cui in questo
    /// repo si scrive «dove finisce una cartella».
    Boundary,
}

/// **La famiglia** di una regola: quale meccanismo risponde, non quale domanda.
///
/// I tre meccanismi di piegatura del caso sono incompatibili fra loro e la
/// differenza è misurabile: `str::to_lowercase` è sensibile al contesto (`ΟΔΟΣ`
/// finisce in `οδος`, non in `οδοσ`) e sa allungare (`İ` diventa due caratteri);
/// `char::to_lowercase` non ha contesto e non lo sa; la corsia ASCII non ha né
/// l'uno né l'altro problema **e** non ha nessuna delle due capacità.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Family {
    /// `str::to_lowercase`: full-Unicode, sensibile al contesto. È la
    /// piegatura di [`fub_abi::rules::path::resolution_key`], cioè quella da cui
    /// tutte le altre divergono.
    ContextualCase,
    /// `char::to_lowercase`: senza contesto. Si sceglie **solo** quando il
    /// prodotto della funzione è un offset nel testo originale, perché una
    /// copia minuscola ha un'altra lunghezza in byte.
    PerCharacterCase,
    /// `eq_ignore_ascii_case` / `to_ascii_lowercase`: la corsia che vale solo
    /// dove è dimostrabilmente la stessa risposta della contestuale.
    AsciiCase,
    /// NFC **senza** piegare il caso: due nomi che si scrivono con gli stessi
    /// caratteri e byte diversi sono lo stesso nome, ma `A` e `a` no.
    NfcOnly,
    /// Dove finisce una cartella: quali `/` si tagliano, e da quale capo.
    FolderBoundary,
}

impl Family {
    /// Il gesto che una regola di questa famiglia **deve** mostrare. Senza
    /// questo legame la famiglia sarebbe una decorazione: si potrebbe scrivere
    /// `NfcOnly` accanto a una funzione che piega il caso e nessuno lo saprebbe.
    fn gesture(self) -> Gesture {
        match self {
            Family::ContextualCase | Family::PerCharacterCase => Gesture::Case,
            Family::AsciiCase => Gesture::AsciiCase,
            Family::NfcOnly => Gesture::Nfc,
            Family::FolderBoundary => Gesture::Boundary,
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
fn rules() -> BTreeMap<&'static str, (Family, &'static str)> {
    BTreeMap::from([
        // -- CasoContestuale: la piegatura di riferimento ------------------
        (
            "crates/fub-abi/src/rules/path.rs::resolution_key",
            (
                Family::ContextualCase,
                "non diverge: è l'origine. «Unico punto di normalizzazione. Chi confronta due \
                 nomi di documento … deve passare da qui» (path.rs). Ogni altra riga di questa \
                 tabella si giudica rispetto a lei.",
            ),
        ),
        (
            "crates/fub-abi/src/model.rs::canonical_tag",
            (
                Family::ContextualCase,
                "non diverge da `resolution_key` sul terreno — compone con `composed` come lei — \
                 ma sul dominio: un tag non è un path e non passa dalla risoluzione, quindi la \
                 regola resta sua e la sua gerarchia la decide `rules/tag.rs`.",
            ),
        ),
        (
            "crates/fub-abi/src/model.rs::canonical_anchor",
            (
                Family::ContextualCase,
                "come `canonical_tag`, e compone come lei. Diverge da lei per il solo fatto che \
                 un'ancora non ha gerarchia, e per la regola di validità che le sta accanto \
                 (`valid_anchor`), che a un nome di tag non si applica.",
            ),
        ),
        (
            "crates/fub-abi/src/rules/properties.rs::contains",
            (
                Family::ContextualCase,
                "confronta due valori di proprietà, non due nomi di file: piega entrambi i capi \
                 perché «chi filtra a mano non ricorda come aveva scritto il tag» \
                 (properties.rs), e la NFC non le serve perché nessuno dei due capi è un path.",
            ),
        ),
        (
            "crates/fub-format-sheet/src/lib.rs::search",
            (
                Family::ContextualCase,
                "cerca una sottostringa nel testo libero delle celle, non stabilisce l'identità \
                 di un path: piega query e input perché la grafia dell'utente non deve cambiare \
                 i risultati. Resta locale al formato perché restituisce coordinate stabili del \
                 foglio, mentre le altre ricerche lavorano su proprietà o indici di documenti.",
            ),
        ),
        (
            "crates/fub-features/src/tags.rs::matches_case_insensitive",
            (
                Family::ContextualCase,
                "ha due corsie e la lenta è questa: la ragione è scritta per intero sopra la \
                 funzione, ed è la sola riga del repo che spiega perché la corsia ASCII non è \
                 sempre lecita — «la corsia veloce vale solo dove è dimostrabilmente la stessa \
                 risposta». È il criterio di questa tabella.",
            ),
        ),
        (
            "crates/fub-features/src/tags.rs::build_tags_view",
            (
                Family::ContextualCase,
                "non è una regola di confronto: prepara l'ago **una volta** perché \
                 `matches_case_insensitive` lo riceve già minuscolo. Diverge perché piega un \
                 solo capo, e il contratto di quel capo sta nella riga di doc della funzione che \
                 lo consuma.",
            ),
        ),
        (
            "crates/fub-abi/src/custom.rs::claims",
            (
                Family::ContextualCase,
                "l'identità qui non è un nome di file ma la **chiave di contesa** fra due regole \
                 di sintassi sullo stesso formato: l'info string di un fence è scritta \
                 dall'autore della nota, e `RUST` e `rust` sono la stessa rivendicazione.",
            ),
        ),
        (
            "crates/fub-kernel/src/syntax.rs::apply",
            (
                Family::ContextualCase,
                "è il lato lettura di `custom.rs::claims` e deve piegare **come lei**, o una \
                 regola registrata come `Rust` non aggancerebbe mai il fence che ha rivendicato. \
                 La divergenza qui sarebbe il difetto, non la coincidenza.",
            ),
        ),
        (
            "crates/fub-kernel/src/syntax.rs::fence_rule",
            (
                Family::ContextualCase,
                "l'altro capo di `apply`: piega ciò che sta nel documento, mentre `apply` piega \
                 ciò che sta nella regola. Sono due stringhe diverse e una sola risposta, ed è \
                 per questo che non si possono scrivere in due modi.",
            ),
        ),
        (
            "crates/fub-kernel/src/registry.rs::register",
            (
                Family::ContextualCase,
                "l'identità di un'estensione nel registro è full-Unicode e non ASCII, e diverge \
                 apposta da `rules/media.rs`: qui l'estensione arriva dal **descrittore di un \
                 provider**, che è testo di terzi, non dal nome di un file del vault.",
            ),
        ),
        (
            "crates/fub-kernel/src/registry.rs::register_source",
            (
                Family::ContextualCase,
                "dichiara nella stessa mappa un formato privo di parser `DocumentModel`: \
                 l'assenza del provider non può cambiare l'identità dell'estensione, quindi \
                 deve piegarla esattamente come `register` prima di controllare i conflitti.",
            ),
        ),
        (
            "crates/fub-kernel/src/registry.rs::replace",
            (
                Family::ContextualCase,
                "è la sostituzione intenzionale nella stessa mappa di `register`: riceve lo \
                 stesso descrittore e deve piegare le estensioni nello stesso modo, o registrare \
                 e sostituire darebbero identità diverse alla stessa estensione.",
            ),
        ),
        (
            "crates/fub-kernel/src/registry.rs::provider_arc_for_ext",
            (
                Family::ContextualCase,
                "è lo stesso lookup di `provider_for_ext`, ma rende un `Arc` perché la callback \
                 possa essere invocata dopo aver rilasciato il workspace. La forma di ownership \
                 non può cambiare l'identità dell'estensione che sceglie il provider.",
            ),
        ),
        (
            "crates/fub-kernel/src/registry.rs::descriptor_for_ext",
            (
                Family::ContextualCase,
                "legge il descrittore congelato della stessa registrazione: deve risolvere le \
                 stesse chiavi di `provider_for_ext` e `provider_arc_for_ext`, o metadati e \
                 callback potrebbero attribuire la stessa estensione a provider diversi.",
            ),
        ),
        (
            "crates/fub-kernel/src/registry.rs::capabilities_for_ext",
            (
                Family::ContextualCase,
                "legge le capacità congelate accanto al descrittore: deve risolvere la stessa \
                 estensione di `descriptor_for_ext`, o il provider selezionato e le forme \
                 sintattiche dichiarate per quel documento potrebbero divergere.",
            ),
        ),
        (
            "crates/fub-kernel/src/registry.rs::provider_for_ext",
            (
                Family::ContextualCase,
                "la lettura della stessa mappa. Le tre righe di `registry.rs` sono una regola \
                 sola scritta nei tre punti in cui la chiave si costruisce, ed è il caso in cui \
                 il conto pretende che restino uguali.",
            ),
        ),
        (
            "crates/fub-kernel/src/registry.rs::default_extension",
            (
                Family::ContextualCase,
                "non interroga la mappa — «non si guarda `by_ext`, che è una mappa e non ha un \
                 primo» (registry.rs) — ma deve rendere l'estensione nella stessa forma, perché \
                 è quella con cui una nota nuova nascerà e verrà poi ricercata.",
            ),
        ),
        (
            "crates/fub-kernel/src/documents.rs::extension_of",
            (
                Family::ContextualCase,
                "è la chiave con cui il kernel interroga `registry.rs`, e piega come lei per \
                 costruzione. Diverge da `media.rs::kind_of`, che sulla stessa estensione è \
                 ASCII, perché quella risponde a «che specie di file è» e questa a «chi lo sa \
                 parsare».",
            ),
        ),
        (
            "crates/fub-abi/src/transfer.rs::extension",
            (
                Family::ContextualCase,
                "l'estensione di un file **in arrivo da fuori**, che sceglie il provider \
                 d'import: sta dal lato di `registry.rs` e non da quello di `media.rs`, per la \
                 stessa ragione.",
            ),
        ),
        (
            "crates/fub-sdk/src/testing/mod.rs::format_of",
            (
                Family::ContextualCase,
                "`MemoryHost` deve rispondere **come il kernel**, o un plugin provato contro di \
                 lui passerebbe nel banco e fallirebbe nell'app: la sua divergenza sarebbe una \
                 conformità falsa.",
            ),
        ),
        (
            "crates/fub-format-markdown/src/parse.rs::convert_block",
            (
                Family::ContextualCase,
                "non piega un nome scritto da qualcuno: piega il `Debug` di un enum di `comrak` \
                 (`Note`, `Tip`, …) per farne il campo `type` di un callout. La sorgente è \
                 generata dal compilatore, quindi la piegatura non ha un'altra regola con cui \
                 divergere.",
            ),
        ),
        (
            "crates/fub-kernel/src/index/plan.rs::name_of_predicate",
            (
                Family::ContextualCase,
                "come sopra: il `Debug` di `PredicateKind` che diventa il nome di un passo di \
                 piano. È diagnostica, non identità — nessuno confronta questa stringa con una \
                 scritta da un utente.",
            ),
        ),
        (
            "crates/fub-kernel/src/log.rs::compose",
            (
                Family::ContextualCase,
                "il livello di log in maiuscolo dentro una riga di file. È l'unica riga della \
                 tabella che va **verso l'alto**, e nessuno la riconverte: si legge «con `grep` \
                 e con l'occhio» (log.rs).",
            ),
        ),
        (
            "crates/fub-sdk/src/testing/conformance.rs::spans_slice_the_source",
            (
                Family::ContextualCase,
                "non installa una regola: **asserisce** che il `marker` di un'ancora nomini la \
                 sua ancora, e piega i due capi perché l'id normalizzato e il testo scritto \
                 possono differire di una maiuscola. Sta nei `src/` perché è la suite che i \
                 plugin di terzi eseguono.",
            ),
        ),
        (
            "crates/fub-abi/src/rules/keys.rs::chords",
            (
                Family::ContextualCase,
                "l'identità qui non è un nome ma un **gesto**: `Mod-Shift-G` e `mod-shift-g` \
                 sono lo stesso tasto premuto, e la NFC non c'entra perché il nome di un tasto \
                 arriva da `KeyboardEvent.key` e non dalla tastiera di chi scrive una nota. \
                 Diverge da `resolution_key` perché deve piegare **come la shell**, che è \
                 `toLowerCase()` di JavaScript, e a tenerle uguali è il mirror delle regole.",
            ),
        ),
        // -- CasoPerCarattere: il caso in cui l'offset è il prodotto --------
        (
            "crates/fub-kernel/src/occurrences.rs::prefix_len_there",
            (
                Family::PerCharacterCase,
                "la ragione è scritta sopra la funzione ed è l'asse di questa famiglia: «gli \
                 offset sono il prodotto di questa funzione: `to_lowercase` può cambiare la \
                 lunghezza in byte di ciò che tocca … e uno span misurato su un testo diverso da \
                 quello che l'editor ha aperto porterebbe il cursore altrove». La NFC la fa senza \
                 rinunciarci, componendo un grappolo canonico per volta (`cluster_end`).",
            ),
        ),
        (
            "crates/fub-abi/src/model.rs::heading_slug",
            (
                Family::PerCharacterCase,
                "piega carattere per carattere perché sta già iterando i caratteri per tenere \
                 solo gli alfanumerici: non ha un offset da difendere come `prefix_len_there`, ha \
                 un filtro. Proprio per quel filtro compone **prima** di iterare: una `Mn` non è \
                 alfanumerica, e senza `composed` l'accento non divergeva, spariva.",
            ),
        ),
        // -- CasoAscii: dove è dimostrabilmente la stessa risposta ----------
        (
            "crates/fub-abi/src/edit.rs::matches_bytes",
            (
                Family::AsciiCase,
                "non è identità di un nome ma compatibilità di migrazione: soltanto la vecchia \
                 revisione FNV-1a a sedici cifre accetta maiuscole e minuscole equivalenti, perché \
                 l'alfabeto esadecimale è ASCII. Le revisioni SHA-256 correnti restano canoniche \
                 e si confrontano esattamente; una piegatura Unicode inventerebbe equivalenze.",
            ),
        ),
        (
            "crates/fub-format-sheet/src/formula.rs::matches_ignore_ascii_case",
            (
                Family::AsciiCase,
                "confronta identificatori del linguaggio formule con il suo vocabolario chiuso \
                 (`IF`, `SUM`, `TRUE`): la grammatica accetta token ASCII e una piegatura Unicode \
                 attribuirebbe equivalenze che il formato non dichiara.",
            ),
        ),
        (
            "crates/fub-format-sheet/src/formula.rs::reference",
            (
                Family::AsciiCase,
                "converte le lettere di una coordinata A1 dopo averle già limitate con \
                 `is_ascii_alphabetic`: l'alfabeto delle colonne è A–Z per formato, quindi una \
                 maiuscola Unicode non può identificare una colonna.",
            ),
        ),
        (
            "crates/fub-abi/src/rules/media.rs::kind_of",
            (
                Family::AsciiCase,
                "confronta un'estensione contro le estensioni dei provider dichiarati: sono \
                 token di formato, e un formato con un'estensione non ASCII non esiste. Diverge \
                 da `registry.rs` apposta, e la differenza è il §25.2.",
            ),
        ),
        (
            "crates/fub-abi/src/rules/media.rs::mime_for_ext",
            (
                Family::AsciiCase,
                "la tabella dei MIME è ASCII per costruzione: «`FOTO.PNG` arriva dalle \
                 fotocamere e dai vault che vengono da Windows» (media.rs). Piega l'ingresso e \
                 non la tabella perché la tabella è già minuscola nel sorgente.",
            ),
        ),
        (
            "crates/fub-abi/src/rules/health.rs::is_attachment",
            (
                Family::AsciiCase,
                "è la stessa domanda di `kind_of` vista al rovescio (non-documento invece che \
                 documento) e deve piegare **come lei**, o un `.MD` sarebbe un allegato per una \
                 delle due e un documento per l'altra.",
            ),
        ),
        (
            "crates/fub-abi/src/net.rs::header",
            (
                Family::AsciiCase,
                "non è una regola di Fub: è HTTP. I nomi di header sono `token` per la RFC 9110, \
                 cioè ASCII, e piegarli in full-Unicode aggiungerebbe corrispondenze che il \
                 protocollo non ha.",
            ),
        ),
        (
            "crates/fub-abi/src/text.rs::template",
            (
                Family::AsciiCase,
                "confronta un tag di lingua BCP 47, che è ASCII per la sua stessa grammatica: \
                 `IT` e `it` sono la stessa lingua, e non c'è nessun altro modo di scriverla.",
            ),
        ),
        (
            "crates/fub-abi/src/rules/path_policy.rs::is_dos_device",
            (
                Family::AsciiCase,
                "i device DOS sono undici nomi ASCII fissati da Windows: «`con`, `CON.md` e \
                 `Con.txt.md` sono tutti la console» (path_policy.rs). Piegare in full-Unicode \
                 rifiuterebbe nomi che Windows accetta.",
            ),
        ),
        (
            "crates/fub-kernel/src/snapshot.rs::validate_portable_component",
            (
                Family::AsciiCase,
                "canonizza soltanto il prefisso ASCII del componente per confrontarlo \
                 con i device Windows riservati; i suffissi Unicode, come i \
                 superscritti di COM/LPT, restano espliciti nella tabella dei nomi.",
            ),
        ),
        (
            "crates/fub-kernel/src/host/guard.rs::normalized_host",
            (
                Family::AsciiCase,
                "un host DNS è ASCII o è punycode, e il limite è già dichiarato sopra la \
                 funzione: «non fa punycode … è un limite vero e sta scritto invece che \
                 scoperto». Una piegatura full-Unicode farebbe **credere** di averlo risolto.",
            ),
        ),
        (
            "crates/fub-kernel/src/host/guard.rs::split_url",
            (
                Family::AsciiCase,
                "lo schema di un URL è ASCII per la RFC 3986. Sta accanto a `normalized_host` e \
                 non dentro: sono due capi dell'URL con due grammatiche diverse, e fonderli \
                 vorrebbe dire una regola che non è né dell'uno né dell'altro.",
            ),
        ),
        (
            "crates/fub-host/src/theme.rs::referenced_assets",
            (
                Family::AsciiCase,
                "riconosce `url` nella grammatica CSS, dove il nome della funzione è ASCII e \
                 può arrivare con qualunque combinazione di maiuscole e minuscole. Non piega \
                 l'URL dell'asset: mantiene il namespace e il path byte-per-byte, e usa la \
                 corsia ASCII solo per il token che la RFC CSS rende case-insensitive.",
            ),
        ),
        (
            "crates/fub-host/src/theme.rs::css_collect_image_set",
            (
                Family::AsciiCase,
                "riconosce `url` nei candidati annidati di `image-set`, dove il nome della \
                 funzione è ASCII e il CSS ne ammette qualunque combinazione di maiuscole e \
                 minuscole. È il parser interno della stessa grammatica di `referenced_assets`, \
                 ma deve restare nominato perché attraversa il confine di una funzione annidata.",
            ),
        ),
        (
            "crates/fub-features/src/commands.rs::parse_value",
            (
                Family::AsciiCase,
                "piega le parole di un toggle (`true`, `on`, `sì`) prima di confrontarle con un \
                 elenco letterale. Non è identità di un nome ma di un **valore di \
                 impostazione**, e l'elenco a cui si confronta è scritto qui accanto: piegare di \
                 più non aggiungerebbe nessuna risposta.",
            ),
        ),
        (
            "crates/fub-kernel/src/registry.rs::has_doc_ext",
            (
                Family::AsciiCase,
                "è la domanda di `kind_of` fatta al registro invece che alla tabella dei \
                 formati, e la sua ragione è già scritta sopra la funzione: «il confronto resta \
                 disarmato sul caso, com'è in `kind_of` — le chiavi di `by_ext` sono già \
                 minuscole, ma la risposta dev'essere quella di sempre». Non diverge da \
                 `media.rs::kind_of`: **deve** coincidere con lei, o un `.MD` sarebbe un \
                 documento per una delle due e non per l'altra. È il `registry.rs` che la voce \
                 di `kind_of` nomina.",
            ),
        ),
        (
            "crates/fub-features/src/queries.rs::free_id",
            (
                Family::AsciiCase,
                "non confronta due nomi: ne **fabbrica** uno. Piega in ASCII perché l'alfabeto \
                 di ciò che produce è ASCII per costruzione — tiene i soli \
                 `is_ascii_alphanumeric` e manda tutto il resto a `-` — quindi una piegatura \
                 full-Unicode agirebbe su caratteri che la riga dopo butta via. È l'unica di \
                 questa famiglia che genera invece di decidere, e per questo non ha un gemello \
                 con cui dover coincidere: l'id di una query nasce qui e non arriva da nessun \
                 altro posto.",
            ),
        ),
        // -- NfcOnly: stessi caratteri, byte diversi ------------------------
        (
            "crates/fub-abi/src/rules/composition.rs::composed",
            (
                Family::NfcOnly,
                "non è una regola di identità: è il **terreno** su cui le altre la decidono, e \
                 l'unica riga della tabella che le altre chiamano invece di riscrivere. Diverge \
                 da `exact_key` perché non rifila: chi taglia gli spazi decide cosa sia un nome, \
                 questa decide soltanto come sono scritti i suoi caratteri.",
            ),
        ),
        (
            "crates/fub-abi/src/rules/path.rs::exact_key",
            (
                Family::NfcOnly,
                "la ragione è scritta sopra la funzione: «`resolution_key` dice **chi è \
                 candidato**, `exact_key` dice **chi ha ragione fra i candidati**». Divergere \
                 sul caso è il suo mestiere, non un difetto.",
            ),
        ),
        (
            "crates/fub-abi/src/rules/path_policy.rs::normalized",
            (
                Family::NfcOnly,
                "normalizza per **segmento** e non sull'intera stringa, perché è la forma su cui \
                 `check` giudica un nome nuovo: «composte qui, non c'è più un ordine da \
                 ricordare» (path_policy.rs). Non piega il caso perché un nome nuovo si scrive \
                 come l'utente lo ha scritto (decisione 0058).",
            ),
        ),
        // -- ConfineDiCartella ---------------------------------------------
        (
            "crates/fub-abi/src/rules/folders.rs::normalized",
            (
                Family::FolderBoundary,
                "è **la** regola: gli slash ai due capi sono cortesia e non componenti, e il \
                 confine è per segmento. Erano tre — i predicati d'indice, la maschera degli \
                 eventi, la selezione di un'esportazione — con tre trim diversi, al punto che il \
                 banco di `transfer.rs` asseriva vero (`/x/` contiene `x/a.md`) ciò che \
                 `within_folder` dava falso. Difetto 0141: adesso `within_folder`, \
                 `folder_contains` e la selezione d'export sono nomi locali di questa riga, e \
                 `single_folder.rs` is what turns red if a fourth surface rewrites it.",
            ),
        ),
        (
            "crates/fub-features/src/commands.rs::vault_archive",
            (
                Family::FolderBoundary,
                "normalizza la cartella d'archivio **scritta dall'utente** in un comando prima \
                 di comporne i `DocId`: taglia i soli `/` finali perché uno iniziale sarebbe un \
                 path assoluto, e quello lo rifiuta `valid_doc_id`, non questa riga.",
            ),
        ),
        (
            "crates/fub-abi/src/rules/path_policy.rs::from_outside",
            (
                Family::FolderBoundary,
                "taglia il `/` **iniziale**, ed è l'unica della famiglia: è la tolleranza del \
                 **varco**, non della regola — «i separatori Windows diventano `/`, e spazi e \
                 barre in testa se ne vanno» (path_policy.rs). Non risponde alla domanda del \
                 contenimento, ma tocca lo stesso confine e la sua divergenza dev'essere \
                 visibile accanto alle altre. Stava in `workspace::valid_doc_id`, che adesso la \
                 chiama: i varchi sono più d'uno (il sidecar dell'organizzazione, il doppio \
                 dell'SDK) e nessuno di loro ha `fub-kernel` fra le mani.",
            ),
        ),
        (
            "crates/fub-kernel/src/ignore.rs::parse_gitignore",
            (
                Family::FolderBoundary,
                "gli slash ai due capi sono **sintassi** della regola gitignore: quello in testa \
                 ancora il pattern alla radice e quello in coda lo limita alle cartelle. Dopo aver \
                 registrato quei due bit, li toglie prima di separare e normalizzare i segmenti; \
                 usare la regola di contenimento di `folders` perderebbe entrambe le informazioni.",
            ),
        ),
        // -- CasoContestuale: ricerche full-Unicode --------------------------
        (
            "crates/fub-features/src/base.rs::derive",
            (
                Family::ContextualCase,
                "piega il filtro di ricerca della vista e le etichette diagnostiche dei riepiloghi \
                 con `str::to_lowercase`: la query è testo libero dell'utente e deve comportarsi \
                 come la ricerca del foglio (`format-sheet::search`), non come un vocabolario \
                 chiuso. Diverge da `matches_case_insensitive` perché qui l'ago si piega una sola \
                 volta per tutte le righe, mentre là si piega a ogni confronto.",
            ),
        ),
        (
            "crates/fub-features/src/graph.rs::is_note",
            (
                Family::ContextualCase,
                "piega l'intero path in full-Unicode prima di riconoscere le estensioni documento \
                 (`.md`, `.txt`, …): la lista è ASCII ma l'input è un path del vault, e la piegatura \
                 larga non inventa estensioni, si limita a non disegnare un PNG come una nota. \
                 Diverge da `media.rs::kind_of` perché qui la domanda è di disegno, non di formato.",
            ),
        ),
        (
            "crates/fub-features/src/outline.rs::build_footnotes_view",
            (
                Family::ContextualCase,
                "riconcilia definizioni e riferimenti di footnote piegando le etichette in \
                 full-Unicode: un'etichetta è testo dell'autore e due grafie dello stesso nome \
                 devono incontrarsi. Diverge da `canonical_anchor` perché qui l'identità è locale \
                 al documento e non passa da nessuna chiave di risoluzione.",
            ),
        ),
        (
            "crates/fub-features/src/properties.rs::global_tree",
            (
                Family::ContextualCase,
                "piega il filtro di stato della vista e lo cerca come sottostringa nelle chiavi e \
                 nei valori delle proprietà: è la stessa ricerca full-Unicode di `derive`, ma sul \
                 canale indicizzato invece che sulle righe. Diverge da lei perché l'ago arriva da \
                 `view_state`, non dal piano, e il contratto di quel capo sta nel chiamante.",
            ),
        ),
        (
            "crates/fub-features/src/tags.rs::build_tags_tree",
            (
                Family::ContextualCase,
                "gemello di `build_tags_view`: prepara l'ago **una volta** perché \
                 `matches_case_insensitive` lo riceve già minuscolo. Diverge da lei perché l'albero \
                 qui ordina per conteggio e mostra il campo di filtro anche a elenco vuoto, ma \
                 l'identità del confronto resta quella della corsia lenta.",
            ),
        ),
        (
            "crates/fub-format-base/src/formula.rs::call_known",
            (
                Family::ContextualCase,
                "implementa `lower` e `upper` del linguaggio formule con la piegatura full-Unicode: \
                 sono funzioni di testo esposte all'utente e devono comportarsi come la shell, non \
                 come un vocabolario chiuso. Diverge dalle altre perché non decide un'identità ma \
                 produce una stringa, e la sua regola è la semantica del linguaggio.",
            ),
        ),
        (
            "crates/fub-format-base/src/model.rs::validate",
            (
                Family::ContextualCase,
                "costruisce l'etichetta diagnostica dei riepiloghi duplicati piegando chiave e \
                 aggregato: due riepiloghi che differiscono di una maiuscola sarebbero lo stesso \
                 riepilogo con due nomi. Diverge da `derive` perché qui la piegatura serve a \
                 rifiutare, non a cercare.",
            ),
        ),
        (
            "crates/fub-importers/src/enex.rs::end",
            (
                Family::ContextualCase,
                "canonizza l'hash della risorsa Evernote piegando in full-Unicode: l'alfabeto degli \
                 hash è esadecimale e la piegatura larga non inventa collisioni, si limita a \
                 tollerare la grafia del file. Diverge da `edit.rs::matches_bytes` perché là la \
                 tolleranza è la compatibilità dichiarata, qui è igiene d'importazione.",
            ),
        ),
        (
            "crates/fub-importers/src/export_pdf.rs::markdown_to_lines",
            (
                Family::ContextualCase,
                "va **verso l'alto** come `log.rs::compose`: i titoli stampati si alzano di caso \
                 per tipografia, e nessuno li riconverte. Diverge da lei perché qui la sorgente è \
                 il documento dell'utente e non un livello di log, ma la direzione resta \
                 decorativa e non d'identità.",
            ),
        ),
        (
            "crates/fub-wasm-host/src/catalog.rs::search",
            (
                Family::ContextualCase,
                "cerca per sottostringa su id e nome delle voci del catalogo piegando entrambi i \
                 capi in full-Unicode: gli id del catalogo sono testo di terzi e la query è testo \
                 libero. Diverge dalla ricerca del foglio perché restituisce voci paginate dal \
                 chiamante, non coordinate stabili.",
            ),
        ),
        // -- NfcOnly: chiavi composte senza piegare il caso ------------------
        (
            "crates/fub-app/src/mobile.rs::parse_tree_grant_query",
            (
                Family::NfcOnly,
                "compone in NFC le chiavi e i valori percent-decifrati della query `mobile-tree`: \
                 due grafie dello stesso parametro devono incontrarsi, ma `URI` e `uri` restano \
                 due chiavi diverse. Diverge da `decode_param` perché qui la canonicalizzazione è \
                 per coppia chiave-valore del trasporto mobile, non per singolo parametro.",
            ),
        ),
        (
            "crates/fub-host/src/automation.rs::decode_param",
            (
                Family::NfcOnly,
                "la ragione è scritta sopra la funzione: «canonicalizzazione encoding: \
                 percent-decode più NFC, la stessa per ogni trasporto». Non piega il caso perché \
                 un parametro `fub://` è un nome di protocollo, non una parola. Diverge da \
                 `exact_key` perché non decide fra candidati: prepara il terreno su cui gli altri \
                 decideranno.",
            ),
        ),
        // -- CasoAscii: schemi e URL (la grammatica è ASCII per RFC) ----------
        (
            "crates/fub-app/src/mobile.rs::validate_source_url",
            (
                Family::AsciiCase,
                "riconosce il prefisso `http(s)://` della `source_url` mobile piegando in ASCII: \
                 lo schema è ASCII per la RFC 3986 e una piegatura larga inventerebbe schemi che \
                 il protocollo non ha. Diverge dalla gemella di `automation.rs` perché qui il \
                 limite di lunghezza e di controllo sta accanto, nel canale mobile.",
            ),
        ),
        (
            "crates/fub-host/src/automation.rs::validate_source_url",
            (
                Family::AsciiCase,
                "gemella della precedente sul canale automazione: stesso prefisso, stessa corsia, \
                 ma il rifiuto qui è `AutomationError` e non un errore mobile. Diverge da \
                 `validate_callback` perché la domanda è «da dove viene la cattura», non «dove è \
                 lecito richiamare».",
            ),
        ),
        (
            "crates/fub-cli/src/capture.rs::validate_scheme",
            (
                Family::AsciiCase,
                "abbassa lo schema del payload di cattura prima di confrontarlo col vocabolario \
                 dei canali: gli schemi URI sono ASCII per grammatica. Diverge da `parse_fub_uri` \
                 perché qui lo schema arriva da un file non autenticato e il confronto è un cancello \
                 d'ingresso, non un'analisi.",
            ),
        ),
        (
            "crates/fub-host/src/automation.rs::validate_callback",
            (
                Family::AsciiCase,
                "abbassa lo schema della callback per rifiutare `javascript:`/`data:`/`vbscript:` e \
                 confronta host e schemi consentiti in ASCII: è un cancello di sicurezza e la \
                 piegatura larga allargerebbe il cancello. Diverge da `validate_scheme` perché qui \
                 la lista dei nemici è scritta nella funzione, non nel formato.",
            ),
        ),
        (
            "crates/fub-host/src/automation.rs::parse_fub_uri",
            (
                Family::AsciiCase,
                "abbassa l'azione del path `fub://` prima di smistarla: le azioni sono token del \
                 protocollo, ASCII per definizione. Diverge da `parse` perché là il vocabolario è \
                 quello dei comandi CLI e qui quello delle azioni URI — due grammatiche, due righe.",
            ),
        ),
        (
            "crates/fub-host/src/remote/mod.rs::validate_base_url",
            (
                Family::AsciiCase,
                "taglia lo slash finale della base e ne abbassa lo schema in ASCII: la tolleranza \
                 sul confine non cambia la grammatica dello schema, che resta RFC 3986. Diverge da \
                 `resolve_base` perché qui la base si giudica (e si rifiuta), là si usa.",
            ),
        ),
        (
            "crates/fub-importers/src/html.rs::is_http_img",
            (
                Family::AsciiCase,
                "riconosce il prefisso `http(s)://` di un `src` abbassando in ASCII: è la stessa \
                 domanda di `validate_source_url`, ma su un attributo HTML durante l'importazione. \
                 Diverge da lei perché qui non si rifiuta niente — si decide solo se scaricare — \
                 e la risposta sbagliata costa banda, non sicurezza.",
            ),
        ),
        (
            "crates/fub-services/src/publish/guard.rs::is_safe_href",
            (
                Family::AsciiCase,
                "abbassa lo schema del link pubblicato per confrontarlo con la lista dei permessi: \
                 gli schemi pericolosi si travestono di maiuscole (`JaVaScRiPt:`) e la corsia ASCII \
                 basta a smascherarli perché gli schemi sono ASCII. Diverge da `validate_callback` \
                 perché qui il cancello è in uscita, verso il lettore del sito.",
            ),
        ),
        // -- CasoAscii: host DNS e nomi di header (ASCII per protocollo) ------
        (
            "crates/fub-app/src/web_viewer.rs::host_allowed",
            (
                Family::AsciiCase,
                "confronta l'host della URL col allowlist con `eq_ignore_ascii_case`: un host DNS \
                 è ASCII o punycode, come dichiara `normalized_host`. Diverge da lei perché qui non \
                 si normalizza niente — si decide se il viewer può aprire — e la porta 443 fa parte \
                 della regola.",
            ),
        ),
        (
            "crates/fub-services/src/main.rs::read_request",
            (
                Family::AsciiCase,
                "abbassa i nomi degli header HTTP prima di smistarli: sono `token` per la RFC 9110, \
                 come dichiara `net.rs::header`. Diverge da lei perché qui gli header si leggono da \
                 un socket grezzo e il valore di `100-continue` si riconosce abbassato, non per \
                 tabella.",
            ),
        ),
        (
            "crates/fub-services/src/main.rs::handle_static",
            (
                Family::AsciiCase,
                "confronta l'host richiesto col dominio TLS in ASCII e pulisce gli slash iniziali \
                 del resto del path: due gesti perché sono due domande — «è il dominio giusto» e \
                 «dov'è il file». Diverge dalla gemella di `publish/mod.rs` perché qui il cancello \
                 TLS precede la risoluzione.",
            ),
        ),
        (
            "crates/fub-services/src/site_isolation.rs::serve_headers",
            (
                Family::AsciiCase,
                "abbassa il nome dell'header prima di decidere se servirlo al sito isolato: la \
                 grammatica degli header è ASCII e la piegatura larga fingerebbe di coprire nomi \
                 che il protocollo non ammette. Diverge da `read_request` perché qui gli header si \
                 filtrano in uscita, non si smistano in ingresso.",
            ),
        ),
        (
            "crates/fub-services/src/site_isolation.rs::save_mode",
            (
                Family::AsciiCase,
                "abbassa l'origine prima di confrontarla coi modi di salvataggio: l'origine è una \
                 stringa di protocollo e il vocabolario dei modi è chiuso qui accanto. Diverge da \
                 `parse` perché là il vocabolario è dei comandi e qui delle modalità — due elenchi, \
                 due righe.",
            ),
        ),
        // -- CasoAscii: vocabolari chiusi della CLI ---------------------------
        (
            "crates/fub-cli/src/capture.rs::build_payload",
            (
                Family::AsciiCase,
                "abbassa il `--mode` della cattura prima di confrontarlo col vocabolario dei modi: \
                 la grammatica dei flag è ASCII e una piegatura larga attribuirebbe modi che la CLI \
                 non dichiara. Diverge da `output.rs::parse` perché qui il vocabolario è del canale \
                 di cattura, là del formato d'uscita.",
            ),
        ),
        (
            "crates/fub-cli/src/completer.rs::completion_script",
            (
                Family::AsciiCase,
                "abbassa il nome della shell prima di scegliere lo script di completamento: i nomi \
                 di shell sono token ASCII (`bash`, `zsh`, `fish`). Diverge dagli altri vocabolari \
                 perché qui la risposta non è un valore ma un intero script generato.",
            ),
        ),
        (
            "crates/fub-cli/src/local.rs::diagnostics",
            (
                Family::AsciiCase,
                "abbassa il nome del controllo diagnostico prima di smistarlo: i controlli sono un \
                 elenco chiuso scritto qui accanto. Diverge da `completion_script` perché qui il \
                 nome sceglie cosa eseguire, là cosa stampare.",
            ),
        ),
        (
            "crates/fub-cli/src/local.rs::files",
            (
                Family::AsciiCase,
                "abbassa il `--kind` (`doc|asset|unknown`) e taglia gli slash della cartella dello \
                 scope: il vocabolario è la regola d'identità, lo scope è tolleranza di confine. \
                 Diverge da `search` perché qui i tipi sono `EntryKind`, là i campi di testo — due \
                 elenchi chiusi diversi.",
            ),
        ),
        (
            "crates/fub-cli/src/local.rs::search",
            (
                Family::AsciiCase,
                "abbassa i nomi dei campi (`name|body|tags|heading`) e taglia gli slash della \
                 cartella del filtro: come in `files`, il vocabolario decide e il confine tollera. \
                 Diverge da `build_matching` perché qui i nomi si validano contro `TextField`, là \
                 si compongono in `FolderScope`.",
            ),
        ),
        (
            "crates/fub-cli/src/local.rs::theme",
            (
                Family::AsciiCase,
                "abbassa il flag `--light` prima di confrontarlo col vocabolario dei temi: i nomi \
                 di tema sono token ASCII del formato. Diverge dagli altri vocabolari perché qui la \
                 risposta sceglie una tavolozza, non un comportamento.",
            ),
        ),
        (
            "crates/fub-cli/src/output.rs::parse",
            (
                Family::AsciiCase,
                "abbassa il formato d'uscita (`text|json|…`) prima di smistarlo: il vocabolario è \
                 chiuso e ASCII per costruzione. Diverge da `build_payload` perché qui la risposta \
                 è il canale di stampa di ogni comando, non un modo di cattura.",
            ),
        ),
        (
            "crates/fub-cli/src/local.rs::parse_property_flag",
            (
                Family::AsciiCase,
                "riconosce il marcatore `exists` dei flag di proprietà con `eq_ignore_ascii_case`: \
                 è una parola del linguaggio dei flag, non un nome del vault. Diverge da \
                 `parse_setting_value` perché qui il vocabolario è di un solo marcatore più la \
                 stringa vuota, là dei booleani.",
            ),
        ),
        (
            "crates/fub-cli/src/login.rs::parse_setting_value",
            (
                Family::AsciiCase,
                "riconosce `true|on|1` e `false|off|0` con `eq_ignore_ascii_case`: i booleani delle \
                 impostazioni sono parole ASCII del formato. Diverge da `truthy`/`excluded` perché \
                 qui il vocabolario è dell'ingresso login, là dell'esportazione del sito.",
            ),
        ),
        (
            "crates/fub-host/src/automation.rs::parse",
            (
                Family::AsciiCase,
                "abbassa il comando grezzo prima di smistarlo fra le azioni dell'automazione: il \
                 vocabolario dei comandi è ASCII e chiuso qui accanto. Diverge da `parse_fub_uri` \
                 perché qui l'input è testo libero dell'utente, là una URI già strutturata.",
            ),
        ),
        (
            "crates/fub-services/src/site_isolation.rs::parse",
            (
                Family::AsciiCase,
                "abbassa il comando grezzo del canale d'isolamento prima di smistarlo: stesso gesto \
                 di `automation.rs::parse`, ma il vocabolario è quello dei comandi sito, non \
                 dell'automazione. Diverge da lui perché due canali con due elenchi non possono \
                 condividere la riga senza condividere la grammatica.",
            ),
        ),
        (
            "crates/fub-wasm-host/src/limits.rs::configured",
            (
                Family::AsciiCase,
                "abbassa il valore di `FUB_WASM_BACKEND` prima di scegliere il motore: i nomi dei \
                 backend sono token ASCII di configurazione. Diverge dagli altri vocabolari perché \
                 qui l'input arriva dall'ambiente del processo, non da un flag o da un file.",
            ),
        ),
        // -- CasoAscii: consensi `y|yes` (stessa parola, due canali) -----------
        (
            "crates/fub-cli/src/capture.rs::confirm_capture",
            (
                Family::AsciiCase,
                "riconosce `y|yes` con `eq_ignore_ascii_case` prima di applicare una cattura non \
                 autenticata: il consenso è una parola del rituale CLI, non un nome. Diverge da \
                 `confirm_write` perché qui il rischio è importare da fuori, là sovrascrivere \
                 dentro — due paure, due righe.",
            ),
        ),
        (
            "crates/fub-cli/src/local.rs::confirm_write",
            (
                Family::AsciiCase,
                "gemella della precedente sul canale delle scritture locali: stessa parola `y|yes`, \
                 stessa corsia, ma il consenso qui copre una scrittura nel vault e non \
                 un'importazione. Diverge da lei perché il testo del riassunto mostrato è diverso e \
                 la soglia di pericolo sta da un'altra parte.",
            ),
        ),
        // -- CasoAscii: HTML (tag e attributi sono ASCII per spec) -------------
        (
            "crates/fub-importers/src/html.rs::html_to_markdown",
            (
                Family::AsciiCase,
                "abbassa i nomi dei tag durante la conversione a Markdown: i tag HTML sono ASCII \
                 per specifica e una piegatura larga inventerebbe elementi che il formato non ha. \
                 Diverge da `tag_name` perché qui il nome si usa per smistare la conversione, là \
                 per estrarlo dal sorgente.",
            ),
        ),
        (
            "crates/fub-importers/src/html.rs::parse_attrs",
            (
                Family::AsciiCase,
                "abbassa i nomi degli attributi durante l'analisi del tag: come i tag, sono ASCII \
                 per specifica. Diverge da `html_to_markdown` perché qui il nome sceglie il valore \
                 da tenere, là l'elemento da emettere.",
            ),
        ),
        (
            "crates/fub-importers/src/html.rs::tag_name",
            (
                Family::AsciiCase,
                "toglie `<` e `/` iniziali e abbassa il nome del tag in ASCII: il confine tollera \
                 la punteggiatura del sorgente, la regola è il vocabolario degli elementi. Diverge \
                 da `parse_attrs` perché qui si estrae il nome, là lo si confronta.",
            ),
        ),
        (
            "crates/fub-services/src/site_isolation.rs::html_has_script",
            (
                Family::AsciiCase,
                "abbassa i tag del documento pubblicato per riconoscere `<script>`: i tag sono \
                 ASCII e l'attaccante li traveste di maiuscole. Diverge da `html_to_markdown` \
                 perché qui la regola è un cancello di sicurezza in uscita, non una conversione.",
            ),
        ),
        (
            "crates/fub-services/src/site_isolation.rs::commit_has_custom_js",
            (
                Family::AsciiCase,
                "abbassa il path per riconoscere il suffisso `.js`: le estensioni dei file serviti \
                 sono ASCII e la domanda è «porta codice eseguibile». Diverge da `html_has_script` \
                 perché qui il segnale è nel nome del file, là nel suo contenuto.",
            ),
        ),
        (
            "crates/fub-host/src/publish/site.rs::verified_asset",
            (
                Family::AsciiCase,
                "abbassa il CSS per rifiutare `@import`, `url(`, `expression(` e `behavior:`: i \
                 vettori d'iniezione sono token ASCII e la piegatura larga allargherebbe il \
                 cancello. Diverge da `validate_public_asset` perché qui si ispeziona il contenuto, \
                 là il nome.",
            ),
        ),
        (
            "crates/fub-services/src/publish/site.rs::validate_public_asset",
            (
                Family::AsciiCase,
                "gemella della precedente sul canale dei servizi: stesso abbassamento, stesso \
                 elenco di vettori, ma il rifiuto qui è un errore di pubblicazione e non un veto di \
                 verifica. Diverge da lei perché due canali con due errori non condividono la riga.",
            ),
        ),
        // -- CasoAscii: nomi booleani dell'esportazione sito -------------------
        (
            "crates/fub-host/src/publish/site.rs::truthy",
            (
                Family::AsciiCase,
                "riconosce `true|yes|1` nei valori di configurazione del sito abbassando in ASCII: \
                 il vocabolario dei booleani è chiuso e ASCII. Diverge da `excluded` perché qui la \
                 risposta accende una funzione, là ne spegne una — due default opposti.",
            ),
        ),
        (
            "crates/fub-host/src/publish/site.rs::excluded",
            (
                Family::AsciiCase,
                "gemella rovesciata della precedente: riconosce `false|no|0` e tratta tutto il resto \
                 come escluso. Diverge da lei perché il default è negato — un valore illeggibile \
                 qui esclude, là non accende — e i default opposti non stanno nella stessa riga.",
            ),
        ),
        // -- CasoAscii: segmenti di path e categorie (liste chiuse) ------------
        (
            "crates/fub-host/src/publish/site.rs::is_private_path",
            (
                Family::AsciiCase,
                "abbassa ogni segmento per riconoscere `private|privato|secrets|.fub`: la lista dei \
                 nomi riservati è chiusa e ASCII. Diverge da `check_publish_path` perché qui la \
                 domanda è «si può mostrare», là «si può pubblicare» — due cancelli sullo stesso \
                 segmento.",
            ),
        ),
        (
            "crates/fub-services/src/publish/manifest.rs::check_publish_path",
            (
                Family::AsciiCase,
                "abbassa ogni segmento contro la lista dei nomi vietati in pubblicazione: stessa \
                 lista chiusa di `is_private_path`, ma il rifiuto qui è un errore di manifesto. \
                 Diverge da lei perché il canale è la pubblicazione, non la lettura.",
            ),
        ),
        (
            "crates/fub-host/src/remote/bundle.rs::check_external_overlap",
            (
                Family::AsciiCase,
                "abbassa ogni segmento contro la lista delle cartelle esterne (`.stfolder`, \
                 `.dropbox`, …): sono nomi di prodotto, ASCII per nascita. Diverge dalle altre \
                 liste perché qui la risposta non è un rifiuto ma un rilevamento di sovrapposizione.",
            ),
        ),
        (
            "crates/fub-host/src/remote/sync.rs::is_syncable_path",
            (
                Family::AsciiCase,
                "abbassa il path per riconoscere le categorie escluse dalla sincronizzazione \
                 (`cache|drafts|device|secrets|…`): la tassonomia delle cartelle di sistema è ASCII \
                 e chiusa. Diverge da `is_syncable_doc` perché qui la domanda è sul path grezzo, là \
                 sul documento con le sue esclusioni utente.",
            ),
        ),
        (
            "crates/fub-services/src/sync/mod.rs::is_syncable_doc",
            (
                Family::AsciiCase,
                "abbassa l'id del documento per le stesse categorie di `is_syncable_path`, ma sul \
                 canale dei servizi e con le esclusioni utente accanto. Diverge da lei perché due \
                 canali con due insiemi di eccezioni non condividono la riga.",
            ),
        ),
        (
            "crates/fub-services/src/sync/mod.rs::category_of",
            (
                Family::AsciiCase,
                "abbassa l'id per classificarlo (`attachments|config-shared|notes`): le categorie \
                 sono ASCII e chiuse. Diverge da `doc_kind_for` perché qui la categoria serve alla \
                 selezione di sincronizzazione, là al tipo di documento — due letture dello stesso \
                 id.",
            ),
        ),
        (
            "crates/fub-services/src/sync/causality.rs::doc_kind_for",
            (
                Family::AsciiCase,
                "abbassa l'id per distinguere note e allegati nella causalità: la tassonomia è la \
                 stessa di `category_of`, ma la domanda è l'ordinamento degli eventi, non la \
                 selezione. Diverge da lei perché un errore qui riordina la storia, là salta un \
                 file.",
            ),
        ),
        (
            "crates/fub-services/src/sync/mod.rs::ext_of",
            (
                Family::AsciiCase,
                "abbassa l'estensione dell'id per confrontarla con le liste di selezione: le \
                 estensioni confrontate sono token ASCII. Diverge da `is_selected` perché qui si \
                 estrae il suffisso, là lo si confronta — due metà della stessa domanda.",
            ),
        ),
        (
            "crates/fub-services/src/sync/mod.rs::is_selected",
            (
                Family::AsciiCase,
                "abbassa id, prefissi ed estensioni per decidere se il documento è selezionato: la \
                 selezione è case-insensitive per contratto del filtro utente. Diverge da `ext_of` \
                 perché qui la regola è la decisione finale, là un passaggio intermedio.",
            ),
        ),
        (
            "crates/fub-services/src/sync/mod.rs::parse_user_exclude",
            (
                Family::AsciiCase,
                "abbassa le voci d'esclusione dell'utente (`ext:` o prefissi): il linguaggio delle \
                 esclusioni è ASCII e la piegatura larga inventerebbe prefissi che l'utente non ha \
                 scritto. Diverge da `is_user_excluded` perché qui la regola si analizza, là si \
                 applica.",
            ),
        ),
        (
            "crates/fub-host/src/remote/mod.rs::is_user_excluded",
            (
                Family::AsciiCase,
                "abbassa id e regole per le stesse esclusioni utente di `parse_user_exclude`, ma sul \
                 canale remoto e con le categorie device-only gestite altrove. Diverge da lei perché \
                 qui la regola si applica a ogni documento remoto, là si analizza una volta sola.",
            ),
        ),
        (
            "crates/fub-kernel/src/index/core.rs::predicate",
            (
                Family::AsciiCase,
                "confronta il suffisso dell'id con l'estensione del filtro con \
                 `eq_ignore_ascii_case`: le estensioni dei file sono token ASCII. Diverge da \
                 `kind_of` perché qui l'estensione arriva da un predicato d'indice arbitrario, là \
                 dalla tabella dei formati.",
            ),
        ),
        (
            "crates/fub-format-canvas/src/parse.rs::is_media_path",
            (
                Family::AsciiCase,
                "abbassa il path per riconoscere le estensioni multimediali (`.png`, `.mp4`, …): \
                 sono token di formato, ASCII per definizione. Diverge da `is_note` perché qui la \
                 lista è dei media e la piegatura è stretta — là la lista è dei documenti e la \
                 piegatura è larga.",
            ),
        ),
        // -- CasoAscii: importatori (estensioni e nomi di formato) -------------
        (
            "crates/fub-importers/src/archive.rs::route_entry",
            (
                Family::AsciiCase,
                "abbassa il nome dell'entry per smistarla fra i formati d'importazione: le \
                 estensioni riconosciute sono ASCII. Diverge da `import_entry` perché qui la regola \
                 sceglie la strada, là la percorre.",
            ),
        ),
        (
            "crates/fub-importers/src/archive.rs::import_entry",
            (
                Family::AsciiCase,
                "abbassa l'estensione per scegliere l'importatore dell'entry: stesso vocabolario di \
                 `route_entry`, ma il confronto qui avviene dentro l'archivio già aperto. Diverge \
                 da lei perché il contesto — archivio contro file singolo — cambia cosa significa \
                 sbagliare.",
            ),
        ),
        (
            "crates/fub-importers/src/archive.rs::import",
            (
                Family::AsciiCase,
                "abbassa il nome per riconoscere il formato dell'archivio da importare: il \
                 vocabolario dei formati è chiuso e ASCII. Diverge dalle due precedenti perché qui \
                 la domanda è sul contenitore, là sul contenuto.",
            ),
        ),
        (
            "crates/fub-importers/src/common.rs::sanitize_component",
            (
                Family::AsciiCase,
                "abbassa il componente per confrontarlo coi nomi riservati durante la pulizia: i \
                 nomi Windows riservati sono ASCII. Diverge da `is_dos_device` perché qui la regola \
                 pulisce un nome d'importazione, là giudica un nome nuovo del vault.",
            ),
        ),
        (
            "crates/fub-features/src/properties.rs::encoded_key",
            (
                Family::AsciiCase,
                "abbassa la chiave per riconoscere `null|true|false|~` prima di citarla in YAML: \
                 sono parole riservate del formato, ASCII per specifica. Diverge da \
                 `sanitize_component` perché qui la regola decide la citazione, non la pulizia.",
            ),
        ),
        // -- CasoAscii: miscellanea (canali con la loro ragione) ---------------
        (
            "crates/fub-app/src/mobile.rs::classify",
            (
                Family::AsciiCase,
                "abbassa l'URL grezza per riconoscere i prefissi `fub://` e `http(s)://`: gli schemi \
                 sono ASCII per RFC 3986. Diverge da `validate_source_url` perché qui la piegatura \
                 smista fra canali (tree, ricerca, http), là valida un solo canale.",
            ),
        ),
        (
            "crates/fub-app/src/mobile.rs::validate_tree_grant",
            (
                Family::AsciiCase,
                "abbassa l'URI del grant per riconoscere `content://` con `/tree/` (Android) o \
                 `file://` (iOS): gli schemi delle piattaforme sono ASCII. Diverge da `classify` \
                 perché qui la regola è un'autorizzazione di accesso all'albero, non uno smistamento.",
            ),
        ),
        (
            "crates/fub-host/src/remote/bundle.rs::http_request",
            (
                Family::AsciiCase,
                "abbassa il path per rifiutare quelli che contengono `password=`: il nome del \
                 parametro è ASCII e il travestimento di maiuscole non deve passare. Diverge da \
                 `is_safe_href` perché qui la perdita è una credenziale nel log di sincronizzazione, \
                 là un link pericoloso pubblicato.",
            ),
        ),
        (
            "crates/fub-cli/src/output.rs::redact_key",
            (
                Family::AsciiCase,
                "confronta i byte della chiave coi nomi segreti con `eq_ignore_ascii_case`: i nomi \
                 dei segreti (`token`, `password`, …) sono ASCII e il confronto è a byte perché \
                 avviene sul flusso d'uscita. Diverge da `redact_json_value` perché qui la regola \
                 lavora sul testo grezzo, là sul valore già analizzato.",
            ),
        ),
        (
            "crates/fub-cli/src/output.rs::redact_json_value",
            (
                Family::AsciiCase,
                "abbassa il nome della chiave JSON per decidere se oscurarne il valore: stesso \
                 elenco di segreti di `redact_key`, ma sul documento analizzato. Diverge da lei \
                 perché due rappresentazioni diverse dello stesso segreto non condividono la riga.",
            ),
        ),
        (
            "crates/fub-host/src/publish/site.rs::doc_path",
            (
                Family::AsciiCase,
                "taglia gli slash e abbassa il gambo in ASCII per farne uno slug URL: gli slug \
                 pubblicati sono ASCII per costruzione. Diverge da `folders::normalized` perché qui \
                 la regola fabbrica un nome pubblico, non normalizza un nome del vault.",
            ),
        ),
        // -- ConfineDiCartella: comporre cartella e nome (tre canali) ---------
        (
            "crates/fub-app/src/mobile.rs::apply_mobile_capture",
            (
                Family::FolderBoundary,
                "compone `{cartella}/{nome}` tagliando gli slash della cartella scritta nel payload \
                 mobile: la tolleranza è sul confine digitato da fuori, non sull'identità della \
                 nota, che si decide accanto (slug o `Untitled`). Diverge da `folders::normalized` \
                 perché qui il nome non esiste ancora — si sta creando — e il confine si attraversa \
                 una volta sola.",
            ),
        ),
        (
            "crates/fub-cli/src/capture.rs::apply_payload",
            (
                Family::FolderBoundary,
                "gemella della precedente sul canale CLI: stessa composizione, stessa tolleranza, \
                 ma il payload qui arriva da un file o da flag non autenticati e il consenso sta \
                 accanto (`confirm_capture`). Diverge da lei perché due canali con due paure — \
                 importare da fuori contro salvare da dentro — non condividono la riga.",
            ),
        ),
        (
            "crates/fub-cli/src/native_host.rs::apply_capture",
            (
                Family::FolderBoundary,
                "gemella sul canale del native host: stessa composizione `{cartella}/{nome}`, ma il \
                 vault qui si apre da variabile d'ambiente o da ultimo noto prima di comporre. \
                 Diverge dalle due precedenti perché il confine si attraversa dopo aver scelto il \
                 vault, e sbagliare l'ordine vorrebbe dire comporre nel posto sbagliato.",
            ),
        ),
        (
            "crates/fub-cli/src/capture.rs::uri",
            (
                Family::FolderBoundary,
                "compone `{cartella}/{nome}` per le nuove URI (`new`, `daily`, `unique`) tagliando \
                 gli slash della cartella: come in `apply_payload`, la tolleranza è sul confine \
                 digitato. Diverge da lei perché qui la regola fabbrica l'id (tre forme, tre \
                 composizioni) e non applica un payload già pronto.",
            ),
        ),
        // -- ConfineDiCartella: scope di cartella nei filtri ------------------
        (
            "crates/fub-cli/src/local.rs::build_matching",
            (
                Family::FolderBoundary,
                "taglia gli slash della cartella prima di comporre `FolderScope`: la radice si \
                 scrive `` e non `/`, e il flag `recursive` decide i discendenti. Diverge da \
                 `matches_filter` perché qui lo scope si costruisce per interrogarne l'indice, là \
                 si confronta contro un path — preparare e decidere non stanno nella stessa riga.",
            ),
        ),
        (
            "crates/fub-features/src/base.rs::matches_filter",
            (
                Family::FolderBoundary,
                "taglia gli slash della cartella del filtro `InFolder` prima di confrontarla col \
                 genitore del path: il confronto è per uguaglianza di stringhe e gli slash di \
                 cortesia non devono cambiare la risposta. Diverge da `build_matching` perché qui \
                 la regola decide riga per riga, là una volta per query.",
            ),
        ),
        (
            "crates/fub-features/src/template.rs::valid_folder",
            (
                Family::FolderBoundary,
                "normalizza la cartella del comando e la valida con una sonda (`{cartella}/_`): \
                 taglia da entrambi i capi perché qui non c'è un rifiuto accanto a coprirne uno. \
                 Diverge da `vault_archive` perché là il `/` iniziale è un assoluto da rifiutare \
                 altrove, qui è cortesia da tollerare qui.",
            ),
        ),
        (
            "crates/fub-app/src/resources.rs::viewer_save",
            (
                Family::FolderBoundary,
                "rifiuta i path assoluti e taglia gli slash finali della cartella degli allegati: \
                 come `vault_archive`, taglia da un solo capo perché dall'altro c'è un rifiuto. \
                 Diverge da lei perché qui la cartella è quella del salvataggio dal viewer e il \
                 nome si sanifica accanto (`sanitize_file_name`), mentre là si compongono `DocId`.",
            ),
        ),
        // -- ConfineDiCartella: ambito dell'accoppiamento ---------------------
        (
            "crates/fub-host/src/automation.rs::pair_allows",
            (
                Family::FolderBoundary,
                "taglia gli slash di entrambe le cartelle — richiesta e accoppiata — prima di \
                 confrontarle: due tolleranze che devono coincidere, o l'accoppiamento negherebbe \
                 ciò che ha promesso per un `/` di cortesia. Diverge da `request_folder_of` perché \
                 qui si confrontano due cartelle, là se ne estrae una sola.",
            ),
        ),
        (
            "crates/fub-host/src/automation.rs::request_folder_of",
            (
                Family::FolderBoundary,
                "estrae la cartella richiesta dal payload — `folder`, o il genitore di `note` via \
                 `folders::parent`, o radice — tagliando gli slash perché il confronto con l'ambito \
                 è per uguaglianza. Diverge da `pair_allows` perché qui la regola produce il termine \
                 di confronto, là lo usa: produrre e usare non stanno nella stessa riga.",
            ),
        ),
        // -- ConfineDiCartella: slash finale delle basi remote ----------------
        (
            "crates/fub-host/src/remote/mod.rs::resolve_base",
            (
                Family::FolderBoundary,
                "taglia lo slash finale della base configurata prima di comporvi i path: la base è \
                 un prefisso e non una cartella del vault. Diverge da `validate_base_url` perché \
                 qui la base si usa per comporre, là si giudica per rifiutare — e da \
                 `check_endpoint_binding` perché qui il confronto è fra base e path, là fra due \
                 basi.",
            ),
        ),
        (
            "crates/fub-host/src/remote/mod.rs::check_endpoint_binding",
            (
                Family::FolderBoundary,
                "taglia lo slash finale di base corrente e base vincolata prima di confrontarle: \
                 due tolleranze simmetriche, o il vincolo scatterebbe per un `/` di cortesia. Diverge \
                 da `resolve_base` perché qui la domanda è «è la base promessa», là «dov'è il file» \
                 — vincolare e risolvere non stanno nella stessa riga.",
            ),
        ),
        // -- ConfineDiCartella: slash iniziale dei path richiesti -------------
        (
            "crates/fub-services/src/publish/mod.rs::handle_static",
            (
                Family::FolderBoundary,
                "toglie gli slash iniziali del resto del path prima di risolvere il file statico: \
                 il resto arriva da un URL e non da un `DocId`, e la radice si serve come \
                 `index.html`. Diverge da `resolve_static` perché qui la risoluzione è del canale \
                 servizi con la sua gestione d'errore, là del canale sito.",
            ),
        ),
        (
            "crates/fub-services/src/publish/site.rs::resolve_static",
            (
                Family::FolderBoundary,
                "toglie gli slash iniziali del path richiesto prima di cercare il file pubblicato: \
                 stessa tolleranza di `handle_static`, ma dentro il canale sito. Diverge da \
                 `resolve_redirect` perché qui il file si serve, là si insegue un redirect — \
                 servire e reindirizzare non stanno nella stessa riga.",
            ),
        ),
        (
            "crates/fub-services/src/publish/site.rs::resolve_redirect",
            (
                Family::FolderBoundary,
                "toglie gli slash iniziali del path richiesto prima di cercarlo nella tabella dei \
                 redirect: la tabella ha chiavi senza slash iniziale e la cortesia dell'URL non deve \
                 mancare la corrispondenza. Diverge da `resolve_static` perché qui la risposta è un \
                 «altrove», non un file.",
            ),
        ),

    ])
}

// ---------------------------------------------------------------------------
// Il cammino sui sorgenti
// ---------------------------------------------------------------------------

const NOT_IS_ENTERS: &[&str] = &["target", "node_modules", ".git", ".fub", "legacy_tests"];

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn sources_of_production() -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    walks(&root(), "", &mut out);
    out
}

fn walks(dir: &Path, rel: &str, out: &mut BTreeMap<String, String>) {
    let entries = std::fs::read_dir(dir)
        .unwrap_or_else(|and| panic!("`{}` non si legge: {and}", dir.display()));
    for entry in entries {
        let entry = entry.unwrap_or_else(|and| panic!("dentro `{}`: {and}", dir.display()));
        let name = entry
            .file_name()
            .into_string()
            .unwrap_or_else(|n| panic!("nome di file non UTF-8: {n:?}"));
        let path = if rel.is_empty() {
            name.clone()
        } else {
            format!("{rel}/{name}")
        };
        let kind = entry
            .file_type()
            .unwrap_or_else(|and| panic!("`{path}`: {and}"));
        if kind.is_dir() {
            if !NOT_IS_ENTERS.contains(&name.as_str()) {
                walks(&entry.path(), &path, out);
            }
        } else if name.ends_with(".rs") && path.contains("/src/") {
            let src = std::fs::read_to_string(entry.path())
                .unwrap_or_else(|and| panic!("`{path}` non si legge: {and}"));
            out.insert(path, src);
        }
    }
}

/// Le righe **di codice** di un sorgente, numerate da 1: niente commenti di
/// riga, niente modulo di prova.
///
/// È la stessa estrazione di `una_sola_tabella_di_escape.rs`, e per la stessa
/// ragione: in un repo in cui i file spiegano sé stessi, un conto che leggesse
/// la prosa presidierebbe se stesso.
fn code_lines(source: &str) -> Vec<(usize, &str)> {
    let rows: Vec<&str> = source.lines().collect();
    let mut out = Vec::new();
    let mut n = 0;
    while n < rows.len() {
        let row = rows[n];
        if row.trim_start().starts_with("//") {
            n += 1;
            continue;
        }
        if row == "#[cfg(test)]" && rows.get(n + 1).is_some_and(|r| r.starts_with("mod ")) {
            let end = rows
                .iter()
                .enumerate()
                .skip(n + 2)
                .find(|(_, r)| **r == "}")
                .map(|(the, _)| the)
                .unwrap_or(rows.len() - 1);
            n = end + 1;
            continue;
        }
        out.push((n + 1, row));
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
fn signature(row: &str) -> Option<&str> {
    let t = row.trim_start();
    let mut rest = t;
    for prefix in ["pub(crate) ", "pub(super) ", "pub(self) ", "pub "] {
        if let Some(r) = rest.strip_prefix(prefix) {
            rest = r;
            break;
        }
    }
    for prefix in ["const ", "async ", "unsafe ", "extern \"C\" "] {
        if let Some(r) = rest.strip_prefix(prefix) {
            rest = r;
        }
    }
    let rest = rest.strip_prefix("fn ")?;
    let end = rest
        .find(|c: char| !c.is_alphanumeric() && c != '_')
        .unwrap_or(rest.len());
    match end {
        0 => None,
        _ => Some(&rest[..end]),
    }
}

/// Il gesto che una riga di codice mostra, se ne mostra uno.
fn gesture(row: &str) -> Option<Gesture> {
    const ASCII: &[&str] = &[
        "to_ascii_lowercase",
        "to_ascii_uppercase",
        "eq_ignore_ascii_case",
    ];
    const CASE: &[&str] = &["to_lowercase", "to_uppercase"];
    const BOUNDARY: &[&str] = &[
        "trim_matches('/')",
        "trim_end_matches('/')",
        "trim_start_matches('/')",
    ];
    if ASCII.iter().any(|a| row.contains(a)) {
        return Some(Gesture::AsciiCase);
    }
    if CASE.iter().any(|a| row.contains(a)) {
        return Some(Gesture::Case);
    }
    // `composed(` è il gesto **comodo** della NFC da quando la forma composta ha
    // un nome (difetto 0140): chi normalizza la chiama, e chi non la chiama non
    // normalizza. `.nfc()` resta perché è ciò che `composed` stessa fa.
    if row.contains(".nfc()") || row.contains(".nfd()") || row.contains("composed(") {
        return Some(Gesture::Nfc);
    }
    match BOUNDARY.iter().any(|a| row.contains(a)) {
        true => Some(Gesture::Boundary),
        false => None,
    }
}

/// Le regole viste nei sorgenti: chiave `file::function` → i gesti che mostra,
/// con la prima riga in cui compare ciascuno.
fn inventory() -> BTreeMap<String, (BTreeSet<Gesture>, usize)> {
    let mut out: BTreeMap<String, (BTreeSet<Gesture>, usize)> = BTreeMap::new();
    for (file, source) in sources_of_production() {
        let mut within = "<fuori>".to_string();
        for (n, line) in code_lines(&source) {
            if let Some(name) = signature(line) {
                within = name.to_string();
            }
            if let Some(g) = gesture(line) {
                let entry = out
                    .entry(format!("{file}::{within}"))
                    .or_insert((BTreeSet::new(), n));
                entry.0.insert(g);
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
fn no_name_rule_without_declaration() {
    let rules = rules();
    let seen = inventory();

    let new: Vec<String> = seen
        .iter()
        .filter(|(k, _)| !rules.contains_key(k.as_str()))
        .map(|(k, (gestures, n))| format!("{k}  (riga {n}, {gestures:?})"))
        .collect();
    assert!(
        new.is_empty(),
        "{} regole di identità di un nome sono nate senza che nessuno le dichiarasse:\n  {}\n\n\
         Non è un invito a unificarle: il repo ha deciso quattro volte che devono essere più \
         d'una (decisioni 0020, 0107, 0058, 0115). È che la prossima non si accorge di essere \
         la prossima. Ogni riga vuole una voce in `regole()` con la sua **famiglia** — quale dei \
         meccanismi incompatibili usa — e la sua **ragione**, che dice perché diverge dalle \
         altre della stessa famiglia. Se la ragione non si riesce a scrivere, la risposta non è \
         inventarla: è che quella regola era una delle altre.",
        new.len(),
        new.join("\n  ")
    );

    let expired: Vec<&str> = rules
        .keys()
        .filter(|k| !seen.contains_key(**k))
        .copied()
        .collect();
    assert!(
        expired.is_empty(),
        "queste righe di `regole()` non corrispondono più a niente: {expired:?} — \
         un'allowlist che resta lunga mentre il codice si accorcia è un ricordo, non una \
         fotografia"
    );
}

/// **La famiglia dichiarata è compatibile con ciò che la funzione fa.**
///
/// Senza questo conto la colonna *famiglia* sarebbe una decorazione: si potrebbe
/// scrivere `NfcOnly` accanto a una funzione che piega il caso in ASCII, e la
/// tabella direbbe il contrario del sorgente restando verde.
#[test]
fn the_family_declared_and_that_that_is_reads() {
    let seen = inventory();
    let mut bugie = Vec::new();
    for (key, (family, _)) in rules() {
        let Some((gestures, _)) = seen.get(key) else {
            continue; // lo dice l'altro conto
        };
        if !gestures.contains(&family.gesture()) {
            bugie.push(format!(
                "{key}: dichiara {family:?} (gesto {:?}) ma nel sorgente si legge {gestures:?}",
                family.gesture()
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
fn every_reason_says_something() {
    let short_reasons: Vec<String> = rules()
        .into_iter()
        .filter(|(_, (_, why))| why.chars().count() < 80)
        .map(|(k, (_, why))| format!("{k}: {why:?}"))
        .collect();
    assert!(
        short_reasons.is_empty(),
        "queste ragioni non argomentano niente:\n  {}",
        short_reasons.join("\n  ")
    );
}

/// Il test del test: `no_name_rule_without_declaration` è verde anche
/// se il cammino non trova niente e se l'estrattore salta tutto, e le due avarie
/// sono indistinguibili da un repo dichiarato per intero.
#[test]
fn the_path_and_the_extractor_attach() {
    let sources = sources_of_production();
    assert!(
        sources.len() > 50,
        "solo {} sorgenti di produzione trovati: il camminatore non sta camminando",
        sources.len()
    );

    let seen = inventory();
    assert_eq!(
        seen.len(),
        rules().len(),
        "il censimento vede {} regole e la tabella ne dichiara {}",
        seen.len(),
        rules().len()
    );
    assert!(
        seen.len() > 30,
        "il censimento vede solo {} regole: l'estrattore sta saltando più del dovuto",
        seen.len()
    );

    // Le cinque famiglie sono tutte popolate: una famiglia vuota sarebbe una
    // tassonomia inventata, che è precisamente ciò che questo banco non deve
    // fare.
    for family in [
        Family::ContextualCase,
        Family::PerCharacterCase,
        Family::AsciiCase,
        Family::NfcOnly,
        Family::FolderBoundary,
    ] {
        assert!(
            rules().values().any(|(f, _)| *f == family),
            "la famiglia {family:?} non ha nessuna regola: o non esiste, o il censimento non \
             la vede più"
        );
    }

    // E l'estrattore salta davvero i moduli di prova: `path.rs` ne ha uno che
    // nomina `resolution_key` e `to_lowercase`, e nessuna delle sue righe è
    // finita nel censimento sotto una funzione di test.
    let path_rs = sources
        .get("crates/fub-abi/src/rules/path.rs")
        .expect("`rules/path.rs` non è stato letto dal camminatore");
    assert!(
        path_rs.contains("#[cfg(test)]"),
        "`rules/path.rs` non ha più un modulo di prova: questo controllo non aggancia più niente"
    );
    assert!(
        !seen.keys().any(|k| k.contains("::tests")),
        "una funzione di prova è entrata nel censimento"
    );
}

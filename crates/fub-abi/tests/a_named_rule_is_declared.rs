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
//! - **il codice di terzi in `vendor/`.** Piega il caso per le sue ragioni (il
//!   correttore di WordCraft lo fa per l'ortografia), non decide quando due nomi
//!   di Fub sono lo stesso nome; provenienza e modifiche stanno nel suo
//!   `UPSTREAM.md`. Chi lo usa in Fub per confrontare nomi scrive la regola qui
//!   fuori, e la regola si dichiara.
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

#[path = "a_named_rule_is_declared/regole.rs"]
mod regole;
use regole::rules;

// ---------------------------------------------------------------------------
// Il cammino sui sorgenti
// ---------------------------------------------------------------------------

const NOT_IS_ENTERS: &[&str] = &[
    "target",
    "node_modules",
    ".git",
    ".fub",
    "legacy_tests",
    "vendor",
];

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn sources_of_production() -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    walks(&root(), "", &mut out);
    // Un modulo di prova che sta in un file suo (`#[cfg(test)] mod tests;`)
    // non è produzione, come non lo è quello scritto dentro il genitore.
    let tests: Vec<String> = out
        .iter()
        .flat_map(|(path, src)| test_files(path, src))
        .collect();
    for path in tests {
        out.remove(&path);
    }
    out
}

/// I file dei moduli che `path` dichiara solo per le prove.
fn test_files(path: &str, src: &str) -> Vec<String> {
    let dir = match path.rsplit_once('/') {
        Some((dir, "mod.rs" | "lib.rs" | "main.rs")) => dir.to_string(),
        _ => path.trim_end_matches(".rs").to_string(),
    };
    let rows: Vec<&str> = src.lines().collect();
    rows.windows(2)
        .filter(|pair| pair[0].trim() == "#[cfg(test)]")
        .filter_map(|pair| {
            let name = pair[1].trim().strip_prefix("mod ")?.strip_suffix(';')?;
            Some([format!("{dir}/{name}.rs"), format!("{dir}/{name}/mod.rs")])
        })
        .flatten()
        .collect()
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
        if row == "#[cfg(test)]"
            && rows
                .get(n + 1)
                .is_some_and(|r| r.starts_with("mod ") && !r.ends_with(';'))
        {
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

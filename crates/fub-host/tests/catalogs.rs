//! Il presidio dei cataloghi **dell'applicazione** (§12.4): le impostazioni che
//! il core dichiara, e quelle dell'interruttore del versioning.
//!
//! È il gemello di `fub-features/tests/i_cataloghi.rs`, e sta in un crate
//! diverso per la ragione più semplice: le stringhe stanno dove sta lo schema
//! che descrivono, e questi due schemi stanno qui. Il lungo perché — cosa si
//! rompe in silenzio senza queste tre domande — sta scritto una volta sola, là.
//!
//! Un pezzo di `core_settings()` però **non** è di questo crate: le chiavi
//! `locale.*` le dichiara `fub-kernel`, e il loro catalogo pure. Che le due
//! metà si sommino a runtime lo garantisce `Strings::template`; che qui non si
//! confondano lo garantisce questo file, che le guarda insieme — come le vede
//! chi legge il pannello, che di due crate non sa niente.
use fub_abi::settings::{SettingKind, SettingSpec};
use fub_abi::text::{StringCatalog, Text};

/// I cataloghi che il bundle di core porta al montaggio.
///
/// **Non è più un elenco**: è la stessa funzione che `mount` chiama per
/// riempire il suo `.speaking(…)`. Qui c'erano sei righe scritte a mano, ed è
/// il difetto che questo giro ripara — un banco che riscrive ciò che giudica
/// giudica sé stesso, e infatti `maintenance` è mancata al montaggio per un
/// pezzo senza che questo file battesse ciglio. Un elenco a mano si accorge di
/// una **chiave** che manca, mai di un **catalogo** che manca, perché tutti i
/// presidi delle stringhe guardano dalle chiavi verso le frasi: le chiavi di
/// una famiglia non montata non le nomina nessuno, e le sue frasi non le
/// pretende nessuno.
///
/// **I cataloghi del kernel sono cinque** [conta: cataloghi-del-kernel], e le
/// famiglie che il montaggio conosce sono **cinque** [conta: famiglie-del-kernel]
/// anche loro. I due conti stanno in questa frase apposta: il
/// primo legge i `pub fn catalog()` dei sorgenti, il secondo le varianti di
/// `Family`, e una famiglia che nasce nel kernel senza entrare nell'elenco
fn catalogs_of_the_core() -> Vec<StringCatalog> {
    fub_host::settings::core_catalog_assembled()
}

/// I cataloghi che il bundle del **versioning** porta al montaggio.
///
/// Stessa forma e stessa ragione di [`cataloghi_del_core`], un giro dopo. Il
/// versioning è l'unica feature ufficiale che al montaggio somma due cataloghi
/// — il suo, e quello dell'interruttore che è dell'host (§11.1) — e quella
/// somma stava scritta **una volta sola**, dentro l'espressione `.speaking(…)`
/// di `mount.rs`. Questo file giudicava i due addendi separatamente: chiedeva
/// che le chiavi di `versioning_settings()` avessero una voce in
/// `versioning_settings_catalog()`, il che è vero **anche se al montaggio
/// quell'addendo non arriva**. Toglierlo dalla somma lasciava tutta la suite
/// verde e le tre etichette dell'interruttore nude nel pannello.
///
/// Adesso la somma è `fub_host::settings::catalog_assembled`, e a chiamarla sono
/// il montaggio e questo banco. La feature si cerca **nell'inventario**, non si
/// nomina: è la stessa `fn` che `mount` invoca, quindi fra ciò che si monta e
#[cfg(feature = "versioning")]
fn catalogs_of_the_versioning() -> Vec<StringCatalog> {
    let feature = fub_features::every_official_feature()
        .iter()
        .find(|f| f.id == fub_features::VERSIONING_ID)
        .expect("versioning is in the official features inventory");
    fub_host::settings::catalog_assembled(feature.id, (feature.catalog)())
}

/// **Ciò che una famiglia dichiara, il montaggio lo dice.**
///
/// Il conto prende la famiglia che nessuno ha elencato; questo test prende
/// l'altra metà, cioè il montaggio che smette di sommare una famiglia che
/// nell'elenco c'è — e la **nomina**, che è ciò che un conto non sa fare.
#[test]
fn every_kernel_family_arrives_at_mounting() {
    let mounted = catalogs_of_the_core();
    for family in fub_kernel::families::Family::ALL {
        for catalog in family.catalog() {
            for key in catalog.entries.keys() {
                let c_and = mounted
                    .iter()
                    .filter(|c| c.locale == catalog.locale)
                    .any(|c| c.entries.contains_key(key));
                assert!(
                    c_and,
                    "family `{}` declares `{key}` in `{}`, and the core bundle does not
                     mount it: those phrases reach nobody",
                    family.name(),
                    catalog.locale
                );
            }
        }
    }
}

/// Le chiavi che uno schema dichiara, e la prosa che ci fosse rimasta.
fn keys(specs: &[SettingSpec]) -> (Vec<String>, Vec<String>) {
    let (mut keys, mut wired) = (Vec::new(), Vec::new());
    let a = |t: &Text, location: &str, keys: &mut Vec<String>, wired: &mut Vec<String>| match t {
        Text::Message(m) => keys.push(m.key.clone()),
        Text::Literal(s) if s.is_empty() => {}
        Text::Literal(s) => wired.push(format!("{location}: «{s}»")),
    };
    for spec in specs {
        let location = format!("`{}`", spec.key);
        a(&spec.label, &location, &mut keys, &mut wired);
        a(&spec.description, &location, &mut keys, &mut wired);
        a(&spec.group, &location, &mut keys, &mut wired);
        if let SettingKind::Choice { options, .. } = &spec.kind {
            for or in options {
                a(&or.label, &location, &mut keys, &mut wired);
            }
        }
    }
    (keys, wired)
}

fn missing(keys: &[String], catalogs: &[StringCatalog]) -> Vec<String> {
    let languages: std::collections::BTreeSet<&str> =
        catalogs.iter().map(|c| c.locale.as_str()).collect();
    let mut out = Vec::new();
    for k in keys {
        for language in &languages {
            // Le lingue si guardano una per una e non catalogo per catalogo:
            // una chiave può stare in uno qualsiasi dei cataloghi di quella
            // lingua, ed è precisamente la somma che il montaggio fa.
            let c_and = catalogs
                .iter()
                .filter(|c| c.locale == *language)
                .any(|c| c.entries.contains_key(k));
            if !c_and {
                out.push(format!("`{k}` is missing in `{language}`"));
            }
        }
    }
    out
}

/// **Ciò che il kernel dichiara, il core lo monta.**
///
/// La verifica del rosso della §15.6 ha misurato che togliere una riga da
/// `core_settings()` — la riga che estende l'elenco con una famiglia del
/// kernel — non rendeva rosso **niente**: le chiavi sparivano dal pannello, chi
/// le legge tornava al default in silenzio (è la regola giusta: un vault senza
/// dichiarazione si comporta come ieri), e la sola cosa che restava era il
/// catalogo di stringhe che nessuno cita — che questi banchi non pretendono,
/// perché guardano dalle chiavi verso le frasi e non al contrario.
///
/// Le famiglie del kernel che dichiarano impostazioni sono
/// **quattro** [conta: impostazioni-del-kernel] — una in meno delle cinque che
/// parlano, perché `maintenance` porta delle etichette e non si configura. Qui
/// l'elenco non è più a mano nemmeno lui: è `Family::impostazioni()`, la
/// stessa fetta che `core_settings` monta. Il conto resta, e resta perché
/// guarda ciò che nessun elenco può guardare: una `pub fn calendar_settings()`
/// nata dentro `locale.rs` — file già contato — non è in nessuna variante, e a
/// vederla è solo un comando che legge i sorgenti da fuori.
#[test]
fn every_key_that_the_kernel_declares_and_mounted_from_the_core() {
    let mounted: std::collections::BTreeSet<String> = fub_host::settings::core_settings()
        .iter()
        .map(|s| s.key.clone())
        .collect();
    let from_the_kernel = fub_kernel::families::Family::all_settings();
    let forgotten: Vec<&str> = from_the_kernel
        .iter()
        .map(|s| s.key.as_str())
        .filter(|k| !mounted.contains(*k))
        .collect();
    assert!(
        forgotten.is_empty(),
        "the kernel declares these keys and the core bundle does not mount them:
         nobody can write them, and readers take the default forever
         {forgotten:?}"
    );
}

/// **La sola famiglia la cui etichetta è un dato e non una frase** (§16.3): le
/// scorciatoie dei comandi della shell.
///
/// Non è un indebolimento del presidio, è la mossa che la
/// [0071](../../../docs/decisions/0071-una-feature-si-spegne-dove-si-dichiara.md)
/// ha chiamato per nome — un presidio che diventa rosso per un caso nuovo e
/// legittimo si **circoscrive**. La ragione: la chiave `keys.shell.*` la
/// dichiara il bundle di core, ma il nome del comando che nomina («Apri il
/// pannello dei file») l'ha scritto la shell, e una frase la localizza chi l'ha
/// scritta ([0040](../../../docs/decisions/0040-chi-localizza.md)). Portarne una
/// copia nel catalogo del core vorrebbe dire trentadue stringhe tradotte due
/// volte, che è la famiglia di difetto della
/// [0072](../../../docs/decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md).
/// L'etichetta è quindi l'**id**, che è un dato: chi disegna la riga ci mette il
/// titolo (`disegnaRiga(entry, comando.title, …)`), e chi elenca le impostazioni
/// senza la shell davanti legge comunque di quale comando si tratti.
///
/// L'esenzione si **calcola** invece di essere un prefisso scritto a mano, e la
/// si pretende **esatta**: un'etichetta cablata in una chiave di shell che non è
/// più in tabella resta rossa, e una cablata altrove pure.
fn labels_that_are_a_id() -> std::collections::BTreeSet<String> {
    fub_host::shell::shell_keybinding_specs()
        .into_iter()
        .map(|s| format!("`{}`", s.key))
        .collect()
}

#[test]
fn the_settings_of_the_app_have_all_a_entry_in_all_the_languages() {
    let catalogs = catalogs_of_the_core();
    let (keys_core, all_wired) = keys(&fub_host::settings::core_settings());
    let exempted = labels_that_are_a_id();
    let (exempted, wired): (Vec<String>, Vec<String>) = all_wired
        .into_iter()
        .partition(|line| exempted.contains(line.split(':').next().unwrap_or("")));
    assert_eq!(
        exempted.len(),
        exempted.len(),
        "the id-label exemption is no longer exact: {exempted:?} vs {exempted:?}"
    );
    assert!(
        wired.is_empty(),
        "a label hardcoded in a schema is prose that no catalog reaches:\n  {}",
        wired.join("\n  ")
    );
    let missing_core = missing(&keys_core, &catalogs);
    assert!(missing_core.is_empty(), "{}", missing_core.join("\n  "));

    // Contro ciò che il versioning monta **davvero**, non contro il solo
    // catalogo dell'interruttore: quello lo si confronterebbe con sé stesso.
    let (keys_v, wired_v) = keys(&fub_host::settings::versioning_settings());
    assert!(wired_v.is_empty(), "{wired_v:?}");
    let missing_versioning = missing(&keys_v, &catalogs_of_the_versioning());
    assert!(
        missing_versioning.is_empty(),
        "the versioning toggle declares keys that the bundle does not mount:\n  {}\n\
         The catalog translating them sums in `settings::catalog_assembled`, and
         it is the only write of that sum: if it disappeared from there, these
         labels stay bare in the panel.",
        missing_versioning.join("\n  ")
    );
}

/// **Ciò che una feature dichiara, il montaggio non lo perde per strada.**
///
/// `catalog_assembled` somma; una somma può anche **sostituire**, e la differenza
/// non la vede nessuno degli altri banchi. `fub-features/tests/i_cataloghi.rs`
/// giudica il catalogo di ogni feature leggendolo dall'inventario, cioè senza
/// sapere se al montaggio ci arrivi; questo file, fino a qui, guardava la sola
/// riga del versioning. Misurato: riscrivendo la somma come il solo catalogo
/// dell'interruttore — cioè buttando via quello della feature — **tutto
/// `cargo test -p fub-host` resta verde**, e nell'app spariscono le etichette
/// della cronologia.
///
/// La domanda vale per tutte e dieci e non per il versioning soltanto: è la
/// prova che il secondo chiamante eredita: la riga che un giorno aggiungerà un
#[test]
fn every_official_feature_mounts_its_own_catalog() {
    for feature in fub_features::every_official_feature() {
        let own = (feature.catalog)();
        let mounted = fub_host::settings::catalog_assembled(feature.id, own.clone());
        for catalog in &own {
            for key in catalog.entries.keys() {
                let arrives = mounted
                    .iter()
                    .filter(|c| c.locale == catalog.locale)
                    .any(|c| c.entries.contains_key(key));
                assert!(
                    arrives,
                    "`{}` declares `{key}` in `{}` and the mount does not carry it:
                     `settings::catalog_assembled` **adds to** the feature catalog,
                     it does not replace it — a reader in that language would see the
                     bare key.",
                    feature.id, catalog.locale
                );
            }
        }
    }
}

#[test]
fn the_two_core_halves_do_not_step_on_each_others_toes() {
    // Due cataloghi della stessa lingua si sommano, e sommandosi possono
    // nascondersi: se `fub-host` e `fub-kernel` dichiarassero la stessa
    // chiave, chi legge ne vedrebbe **una** senza sapere quale — e la scelta
    // sarebbe l'ordine in cui `mount` le ha messe in fila, cioè niente che
    // qualcuno abbia deciso.
    //
    // L'unica sovrapposizione ammessa è quella voluta: nessuna. «Come il
    // sistema» la dice una chiave sola (`AS_SYSTEM_KEY`), e il tema la prende
    let host: std::collections::BTreeSet<String> = fub_host::settings::core_catalog()
        .iter()
        .filter(|c| c.locale == "it")
        .flat_map(|c| c.entries.keys().cloned())
        .collect();
    // Le famiglie non si elencano qui: le somma `Family::cataloghi()`, cioè
    // la stessa espressione che il montaggio usa. Erano cinque righe a mano, ed
    // erano l'ultima copia dell'elenco rimasta in questo file — una famiglia
    // nuova non entrava in questo confronto, quindi una chiave doppia fra host
    // e kernel poteva nascere restando verde.
    let kernel: std::collections::BTreeSet<String> = fub_kernel::families::Family::all_catalogs()
        .iter()
        .filter(|c| c.locale == "it")
        .flat_map(|c| c.entries.keys().cloned())
        .collect();
    let doubles: Vec<&String> = host.intersection(&kernel).collect();
    assert!(
        doubles.is_empty(),
        "two halves of the same component declare the same key: {doubles:?}"
    );
}

#[test]
fn every_language_of_the_core_says_the_same_things() {
    for catalogs in [catalogs_of_the_core(), catalogs_of_the_versioning()] {
        let for_language: std::collections::BTreeMap<&str, std::collections::BTreeSet<&String>> =
            catalogs.iter().fold(Default::default(), |mut acc, c| {
                acc.entry(c.locale.as_str())
                    .or_default()
                    .extend(c.entries.keys());
                acc
            });
        let mut languages = for_language.values();
        let Some(before) = languages.next() else {
            continue;
        };
        for other in languages {
            let difference: Vec<_> = before.symmetric_difference(other).collect();
            assert!(
                difference.is_empty(),
                "one language has keys the other does not: {difference:?}"
            );
        }
    }
}

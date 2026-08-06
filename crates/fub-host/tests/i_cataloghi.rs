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

/// I cataloghi che il bundle di core porta al montaggio, uniti come li unisce
/// `mount`.
///
/// **I cataloghi del kernel sono cinque** [conta: cataloghi-del-kernel], e il
/// numero sta scritto qui perché l'elenco è a mano: `maintenance` c'è mancato
/// per un pezzo, e non se ne accorgeva nessuno — un elenco scritto a mano si
/// accorge di una **chiave** che manca, mai di un **catalogo** che manca, e
/// nemmeno il gemello di `fub-features` lo vedrebbe. A prenderlo è l'attore che
/// la 0105 nomina per questa specie di buco: un conto che legge i sorgenti da
/// fuori. Se ne nasce uno che non è in questa lista, `check-prosa` diventa
/// rosso su questa riga — da adesso anche se nasce **dentro un file già
/// contato**, che è il caso in cui il conto guardava i file invece delle
/// dichiarazioni e restava fermo.
fn cataloghi_del_core() -> Vec<StringCatalog> {
    [
        fub_host::settings::core_catalog(),
        fub_kernel::locale::catalog(),
        fub_kernel::maintenance::catalog(),
        fub_kernel::journal::catalog(),
        fub_kernel::properties::catalog(),
        fub_kernel::ignore::catalog(),
    ]
    .concat()
}

/// Le chiavi che uno schema dichiara, e la prosa che ci fosse rimasta.
fn chiavi(specs: &[SettingSpec]) -> (Vec<String>, Vec<String>) {
    let (mut chiavi, mut cablate) = (Vec::new(), Vec::new());
    let una = |t: &Text, dove: &str, chiavi: &mut Vec<String>, cablate: &mut Vec<String>| match t {
        Text::Message(m) => chiavi.push(m.key.clone()),
        Text::Literal(s) if s.is_empty() => {}
        Text::Literal(s) => cablate.push(format!("{dove}: «{s}»")),
    };
    for spec in specs {
        let dove = format!("`{}`", spec.key);
        una(&spec.label, &dove, &mut chiavi, &mut cablate);
        una(&spec.description, &dove, &mut chiavi, &mut cablate);
        una(&spec.group, &dove, &mut chiavi, &mut cablate);
        if let SettingKind::Choice { options, .. } = &spec.kind {
            for o in options {
                una(&o.label, &dove, &mut chiavi, &mut cablate);
            }
        }
    }
    (chiavi, cablate)
}

fn mancanti(chiavi: &[String], cataloghi: &[StringCatalog]) -> Vec<String> {
    let lingue: std::collections::BTreeSet<&str> =
        cataloghi.iter().map(|c| c.locale.as_str()).collect();
    let mut out = Vec::new();
    for k in chiavi {
        for lingua in &lingue {
            // Le lingue si guardano una per una e non catalogo per catalogo:
            // una chiave può stare in uno qualsiasi dei cataloghi di quella
            // lingua, ed è precisamente la somma che il montaggio fa.
            let c_e = cataloghi
                .iter()
                .filter(|c| c.locale == *lingua)
                .any(|c| c.entries.contains_key(k));
            if !c_e {
                out.push(format!("«{k}» manca in «{lingua}»"));
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
/// **quattro** [conta: impostazioni-del-kernel], e il conto sta qui perché
/// anche questo elenco è a mano: stessa forma della riga di
/// `cataloghi_del_core`, e stessa riparazione — una `pub fn calendar_settings()`
/// aggiunta dentro `locale.rs` lasciava il conto a quattro e la suite verde,
/// perché il comando contava i file.
#[test]
fn ogni_chiave_che_il_kernel_dichiara_e_montata_dal_core() {
    let montate: std::collections::BTreeSet<String> = fub_host::settings::core_settings()
        .iter()
        .map(|s| s.key.clone())
        .collect();
    let dal_kernel = [
        fub_kernel::locale::locale_settings(),
        fub_kernel::journal::journal_settings(),
        fub_kernel::properties::properties_settings(),
        fub_kernel::ignore::ignore_settings(),
    ]
    .concat();
    let dimenticate: Vec<&str> = dal_kernel
        .iter()
        .map(|s| s.key.as_str())
        .filter(|k| !montate.contains(*k))
        .collect();
    assert!(
        dimenticate.is_empty(),
        "il kernel dichiara queste chiavi e il bundle del core non le monta: \
         nessuno può scriverle, e chi le legge prende il default per sempre \
         {dimenticate:?}"
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
fn etichette_che_sono_un_id() -> std::collections::BTreeSet<String> {
    fub_host::shell::shell_keybinding_specs()
        .into_iter()
        .map(|s| format!("`{}`", s.key))
        .collect()
}

#[test]
fn le_impostazioni_dell_app_hanno_tutte_una_voce_in_tutte_le_lingue() {
    let cataloghi = cataloghi_del_core();
    let (chiavi_core, tutte_cablate) = chiavi(&fub_host::settings::core_settings());
    let esentate = etichette_che_sono_un_id();
    let (esenti, cablate): (Vec<String>, Vec<String>) = tutte_cablate
        .into_iter()
        .partition(|riga| esentate.contains(riga.split(':').next().unwrap_or("")));
    assert_eq!(
        esenti.len(),
        esentate.len(),
        "l'esenzione delle etichette-id non è più esatta: {esenti:?} contro {esentate:?}"
    );
    assert!(
        cablate.is_empty(),
        "un'etichetta cablata dentro uno schema è prosa che nessun catalogo \
         raggiunge:\n  {}",
        cablate.join("\n  ")
    );
    let buchi = mancanti(&chiavi_core, &cataloghi);
    assert!(buchi.is_empty(), "{}", buchi.join("\n  "));

    let (chiavi_v, cablate_v) = chiavi(&fub_host::settings::versioning_settings());
    assert!(cablate_v.is_empty(), "{cablate_v:?}");
    let buchi_v = mancanti(
        &chiavi_v,
        &fub_host::settings::versioning_settings_catalog(),
    );
    assert!(buchi_v.is_empty(), "{}", buchi_v.join("\n  "));
}

#[test]
fn le_due_metà_del_core_non_si_pestano_i_piedi() {
    // Due cataloghi della stessa lingua si sommano, e sommandosi possono
    // nascondersi: se `fub-host` e `fub-kernel` dichiarassero la stessa
    // chiave, chi legge ne vedrebbe **una** senza sapere quale — e la scelta
    // sarebbe l'ordine in cui `mount` le ha messe in fila, cioè niente che
    // qualcuno abbia deciso.
    //
    // L'unica sovrapposizione ammessa è quella voluta: nessuna. «Come il
    // sistema» la dice una chiave sola (`AS_SYSTEM_KEY`), e il tema la prende
    // in prestito da lì invece di ridichiararla — che è appunto il motivo per
    // cui quella costante è pubblica.
    let host: std::collections::BTreeSet<String> = fub_host::settings::core_catalog()
        .iter()
        .filter(|c| c.locale == "it")
        .flat_map(|c| c.entries.keys().cloned())
        .collect();
    let kernel: std::collections::BTreeSet<String> = [
        fub_kernel::locale::catalog(),
        fub_kernel::maintenance::catalog(),
        fub_kernel::journal::catalog(),
        fub_kernel::properties::catalog(),
        fub_kernel::ignore::catalog(),
    ]
    .concat()
    .iter()
    .filter(|c| c.locale == "it")
    .flat_map(|c| c.entries.keys().cloned())
    .collect();
    let doppie: Vec<&String> = host.intersection(&kernel).collect();
    assert!(
        doppie.is_empty(),
        "due metà dello stesso componente dichiarano la stessa chiave: {doppie:?}"
    );
}

#[test]
fn ogni_lingua_del_core_dice_le_stesse_cose() {
    for cataloghi in [
        cataloghi_del_core(),
        fub_host::settings::versioning_settings_catalog(),
    ] {
        let per_lingua: std::collections::BTreeMap<&str, std::collections::BTreeSet<&String>> =
            cataloghi.iter().fold(Default::default(), |mut acc, c| {
                acc.entry(c.locale.as_str())
                    .or_default()
                    .extend(c.entries.keys());
                acc
            });
        let mut lingue = per_lingua.values();
        let Some(prima) = lingue.next() else { continue };
        for altra in lingue {
            let differenza: Vec<_> = prima.symmetric_difference(altra).collect();
            assert!(
                differenza.is_empty(),
                "una lingua ha chiavi che l'altra non ha: {differenza:?}"
            );
        }
    }
}

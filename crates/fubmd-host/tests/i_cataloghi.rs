//! Il presidio dei cataloghi **dell'applicazione** (§12.4): le impostazioni che
//! il core dichiara, e quelle dell'interruttore del versioning.
//!
//! È il gemello di `fubmd-features/tests/i_cataloghi.rs`, e sta in un crate
//! diverso per la ragione più semplice: le stringhe stanno dove sta lo schema
//! che descrivono, e questi due schemi stanno qui. Il lungo perché — cosa si
//! rompe in silenzio senza queste tre domande — sta scritto una volta sola, là.
//!
//! Un pezzo di `core_settings()` però **non** è di questo crate: le chiavi
//! `locale.*` le dichiara `fubmd-kernel`, e il loro catalogo pure. Che le due
//! metà si sommino a runtime lo garantisce `Strings::template`; che qui non si
//! confondano lo garantisce questo file, che le guarda insieme — come le vede
//! chi legge il pannello, che di due crate non sa niente.
use fubmd_abi::settings::{SettingKind, SettingSpec};
use fubmd_abi::text::{StringCatalog, Text};

/// I due cataloghi che il bundle di core porta al montaggio, uniti come li
/// unisce `mount`.
fn cataloghi_del_core() -> Vec<StringCatalog> {
    [
        fubmd_host::settings::core_catalog(),
        fubmd_kernel::locale::catalog(),
    ]
    .concat()
}

/// Le chiavi che uno schema dichiara, e la prosa che ci fosse rimasta.
fn chiavi(specs: &[SettingSpec]) -> (Vec<String>, Vec<String>) {
    let (mut chiavi, mut cablate) = (Vec::new(), Vec::new());
    let una = |t: &Text, dove: &str, chiavi: &mut Vec<String>, cablate: &mut Vec<String>| {
        match t {
            Text::Message(m) => chiavi.push(m.key.clone()),
            Text::Literal(s) if s.is_empty() => {}
            Text::Literal(s) => cablate.push(format!("{dove}: «{s}»")),
        }
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

#[test]
fn le_impostazioni_dell_app_hanno_tutte_una_voce_in_tutte_le_lingue() {
    let cataloghi = cataloghi_del_core();
    let (chiavi_core, cablate) = chiavi(&fubmd_host::settings::core_settings());
    assert!(
        cablate.is_empty(),
        "un'etichetta cablata dentro uno schema è prosa che nessun catalogo \
         raggiunge:\n  {}",
        cablate.join("\n  ")
    );
    let buchi = mancanti(&chiavi_core, &cataloghi);
    assert!(buchi.is_empty(), "{}", buchi.join("\n  "));

    let (chiavi_v, cablate_v) = chiavi(&fubmd_host::settings::versioning_settings());
    assert!(cablate_v.is_empty(), "{cablate_v:?}");
    let buchi_v = mancanti(&chiavi_v, &fubmd_host::settings::versioning_settings_catalog());
    assert!(buchi_v.is_empty(), "{}", buchi_v.join("\n  "));
}

#[test]
fn le_due_metà_del_core_non_si_pestano_i_piedi() {
    // Due cataloghi della stessa lingua si sommano, e sommandosi possono
    // nascondersi: se `fubmd-host` e `fubmd-kernel` dichiarassero la stessa
    // chiave, chi legge ne vedrebbe **una** senza sapere quale — e la scelta
    // sarebbe l'ordine in cui `mount` le ha messe in fila, cioè niente che
    // qualcuno abbia deciso.
    //
    // L'unica sovrapposizione ammessa è quella voluta: nessuna. «Come il
    // sistema» la dice una chiave sola (`AS_SYSTEM_KEY`), e il tema la prende
    // in prestito da lì invece di ridichiararla — che è appunto il motivo per
    // cui quella costante è pubblica.
    let host: std::collections::BTreeSet<String> = fubmd_host::settings::core_catalog()
        .iter()
        .filter(|c| c.locale == "it")
        .flat_map(|c| c.entries.keys().cloned())
        .collect();
    let kernel: std::collections::BTreeSet<String> = fubmd_kernel::locale::catalog()
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
    for cataloghi in [cataloghi_del_core(), fubmd_host::settings::versioning_settings_catalog()] {
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

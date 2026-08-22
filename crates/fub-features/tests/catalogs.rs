//! Il presidio dei **cataloghi** (§12.4): che le stringhe dichiarate esistano,
//! in tutte le lingue, e che non ne resti nessuna cablata.
//!
//! È la metà meccanica di questa voce. L'altra — riempire otto cataloghi — è
//! lavoro che si fa una volta; questa è ciò che impedisce che si disfi, e senza
//! si disferebbe **in silenzio**, che è la forma di rottura peggiore che le
//! stringhe abbiano: la scala della
//! [decisione 0040](../../../docs/decisions/0040-chi-localizza.md) non fallisce
//! mai, degrada. Una chiave senza voce non è un errore, è la chiave nuda
//! stampata a schermo; una lingua tradotta a metà non è un errore, è metà
//! pannello nell'altra lingua; una stringa dimenticata dentro una `ViewSpec`
//! non è un errore, è italiano per tutti. Tre modi di rompersi, zero rossi.
//!
//! Qui diventano tre rossi.
//!
//! # Le tre domande
//!
//! 1. **Le lingue dicono le stesse cose.** I cataloghi di un componente hanno
//!    tutti lo stesso insieme di chiavi. Chi aggiunge una riga in italiano e
//!    dimentica l'inglese lo scopre adesso e non da una segnalazione.
//! 2. **Ciò che si dichiara si può tradurre.** Ogni chiave che una `ViewSpec` o
//!    una `CommandSpec` porta ha una voce in ogni catalogo del suo componente.
//! 3. **Non è rimasto niente di cablato.** Nessuna delle stringhe dichiarate è
//!    un `Text::Literal`: un letterale lì dentro è prosa che nessun catalogo
//!    potrà mai raggiungere, ed è precisamente com'erano tutte prima di questa
//!    voce.
//!
//! Ciò che questo presidio **non** copre, e va detto: le chiavi che nascono
//! mentre un comando gira — un errore, il riassunto di un piano — non si
//! possono camminare da fuori, perché non esistono finché qualcosa non succede.
//! Le copre la domanda 1 dal lato del catalogo (se una lingua ne ha una e
//! l'altra no, è rosso) e i test dei comandi dall'altro, che le risolvono
//! davvero invece di stamparne il `Display`.
//!
//! # Su quali componenti, e come lo sa
//!
//! Gli otto erano elencati a mano qui sotto, ed era il difetto del
//! [§16.7](../../../docs/roadmap/16-crate-sdk-banchi-di-prova.md#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione)
//! nella sua forma più larga: non solo la quinta view sarebbe entrata muta, ma
//! la **nona feature** — una che non registra nessuna view — sarebbe entrata
//! senza che nessuno guardasse il suo catalogo. Adesso l'elenco viene da
//! [`fub_features::ogni_feature_ufficiale`], che è la stessa fetta da cui
//! `fub_host::mount` monta i bundle: un componente che esiste nell'app passa
//! di qui.
use fub_abi::settings::SettingKind;
use fub_abi::text::{StringCatalog, Text};
use fub_abi::traits::{CommandProvider, ViewProvider};

/// Le chiavi che un `Text` dichiarato porta con sé, e il grido quando invece è
/// prosa cablata.
fn key(text: &Text, location: &str, keys: &mut Vec<String>, wired: &mut Vec<String>) {
    match text {
        Text::Message(m) => keys.push(m.key.clone()),
        // Vuoto è lecito: una descrizione che nessuno ha scritto non è una
        // stringa italiana, è l'assenza di una stringa.
        Text::Literal(s) if s.is_empty() => {}
        Text::Literal(s) => wired.push(format!("{location}: «{s}»")),
    }
}

/// Un componente e ciò che dichiara: i cataloghi, e le chiavi delle sue spec.
struct Component {
    id: &'static str,
    catalogs: Vec<StringCatalog>,
    keys: Vec<String>,
    wired: Vec<String>,
}

/// Le chiavi che una view dichiara: oggi il titolo, e non serve altro perché è
/// l'unico `Text` che una `ViewSpec` porta.
fn of_a_view(id: &str, p: &dyn ViewProvider, keys: &mut Vec<String>, wired: &mut Vec<String>) {
    for spec in p.views() {
        key(
            &spec.title,
            &format!("{id}: titolo della view «{}»", spec.id),
            keys,
            wired,
        );
    }
}

/// Le chiavi che un `CommandProvider` dichiara: titolo, descrizione, e le due di
/// ogni parametro.
fn of_a_command(
    id: &str,
    p: &dyn CommandProvider,
    keys: &mut Vec<String>,
    wired: &mut Vec<String>,
) {
    for spec in p.commands() {
        key(
            &spec.title,
            &format!("{id}: titolo di «{}»", spec.id),
            keys,
            wired,
        );
        key(
            &spec.description,
            &format!("{id}: descrizione di «{}»", spec.id),
            keys,
            wired,
        );
        for par in &spec.params {
            let location = format!("{id}: «{}» / `{}`", spec.id, par.name);
            key(&par.title, &location, keys, wired);
            key(&par.description, &location, keys, wired);
        }
    }
}

fn components() -> Vec<Component> {
    fub_features::every_official_feature()
        .iter()
        .map(|f| {
            let (mut keys, mut wired) = (Vec::new(), Vec::new());
            // Chi non dichiara né view né comandi non porta chiavi camminabili
            // da fuori — la ricerca parla quando qualcosa va storto, i blocchi
            // quando un rendering non c'è, il versioning quando racconta uno
            // snapshot — e resta comunque un componente: il suo catalogo passa
            // dalle domande 1 e 3 come tutti gli altri, ed è lì che si vede una
            // lingua tradotta a metà.
            if let Some(builder) = f.view {
                of_a_view(f.id, builder().as_ref(), &mut keys, &mut wired);
            }
            if let Some(builder) = f.commands {
                of_a_command(f.id, builder().as_ref(), &mut keys, &mut wired);
            }
            Component {
                id: f.id,
                catalogs: (f.catalog)(),
                keys,
                wired,
            }
        })
        .collect()
}

#[test]
fn every_language_says_the_same_things() {
    let mut holes = Vec::new();
    for c in components() {
        assert!(
            c.catalogs.len() >= 2,
            "«{}» ha un catalogo in una lingua sola: la seconda è ciò che rende \
             il catalogo un catalogo e non un file di stringhe",
            c.id
        );
        let reference = &c.catalogs[0];
        for other in &c.catalogs[1..] {
            for k in reference.entries.keys() {
                if !other.entries.contains_key(k) {
                    holes.push(format!("{}: «{k}» manca in «{}»", c.id, other.locale));
                }
            }
            for k in other.entries.keys() {
                if !reference.entries.contains_key(k) {
                    holes.push(format!(
                        "{}: «{k}» c'è in «{}» e non in «{}»",
                        c.id, other.locale, reference.locale
                    ));
                }
            }
        }
    }
    assert!(
        holes.is_empty(),
        "una lingua tradotta a metà non fallisce, degrada — e chi legge vede la \
         chiave nuda:\n  {}",
        holes.join("\n  ")
    );
}

#[test]
fn every_key_declared_has_a_entry() {
    let mut holes_v = Vec::new();
    for c in components() {
        for k in &c.keys {
            for catalog in &c.catalogs {
                if !catalog.entries.contains_key(k) {
                    holes_v.push(format!("{}: «{k}» manca in «{}»", c.id, catalog.locale));
                }
            }
        }
    }
    assert!(
        holes_v.is_empty(),
        "una chiave senza voce scende all'ultimo gradino della 0040 — brutto, \
         onesto, e davanti a chi guarda:\n  {}",
        holes_v.join("\n  ")
    );
}

#[test]
fn no_hardcoded_prose_in_what_is_declared() {
    let wired: Vec<String> = components().into_iter().flat_map(|c| c.wired).collect();
    assert!(
        wired.is_empty(),
        "una stringa dentro una spec è prosa che nessun catalogo può \
         raggiungere: era così che stavano tutte prima del §12.4\n  {}",
        wired.join("\n  ")
    );
}

#[test]
fn the_settings_of_the_core_speak_also_their() {
    // Le impostazioni non sono di un componente di questo crate — le dichiarano
    // `fub-host` e `fub-kernel` — ma passano dalla stessa strada, e la
    // stessa strada vuole lo stesso presidio. Qui si guarda quelle del kernel,
    // che è l'unico dei due che questo crate vede; le altre le guarda il banco
    // di `fub-host`.
    //
    // **Le famiglie non si elencano più a mano.** Erano tre righe — `locale`,
    // `properties`, `ignore` — mentre il kernel ne dichiara cinque, e un elenco
    // scritto a mano si accorge di una chiave che manca, mai di una famiglia che
    // manca. Adesso sono `Family::cataloghi()` e `Family::impostazioni()`,
    // cioè le stesse due espressioni da cui `fub_host::settings` monta: una
    // famiglia nuova entra qui il giorno in cui entra in `Family::TUTTE`, e
    // in `TUTTE` la fa entrare il compilatore.
    let catalogs = fub_kernel::families::Family::all_catalogs();
    let (mut keys, mut wired) = (Vec::new(), Vec::new());
    // Le chiavi che il kernel **prende in prestito** invece di possederle.
    //
    // Misurato aprendo l'elenco alle cinque: `journal.retention` si mette nel
    // gruppo `core.group.privacy`, che è del bundle di core, e lo fa apposta —
    // due gruppi «Privacy» scritti da due componenti sarebbero due sezioni
    // identiche nel pannello, e la ragione sta scritta accanto alla riga in
    // `journal.rs`. La frase la localizza chi l'ha scritta
    // ([0040](../../../docs/decisions/0040-chi-localizza.md)), quindi in nessun
    // catalogo del kernel quella voce c'è né deve esserci: a giudicarla è il
    // banco di `fub-host`, che somma i due cataloghi.
    //
    // L'esenzione si **calcola dal namespace** e non è un elenco a mano: `core.`
    // è di chi monta. Una chiave che il kernel possiede — `journal.*`,
    // `locale.*`, `files.*`, `properties.*` — senza una voce nei cataloghi del
    // kernel resta rossa qui, ed è il verso che conta.
    for spec in fub_kernel::families::Family::all_settings() {
        let location = format!("kernel: `{}`", spec.key);
        key(&spec.label, &location, &mut keys, &mut wired);
        key(&spec.description, &location, &mut keys, &mut wired);
        key(&spec.group, &location, &mut keys, &mut wired);
        if let SettingKind::Choice { options, .. } = &spec.kind {
            for or in options {
                key(&or.label, &location, &mut keys, &mut wired);
            }
        }
    }
    let (core_keys, keys): (Vec<String>, Vec<String>) =
        keys.into_iter().partition(|k| k.starts_with("core."));
    assert!(wired.is_empty(), "{wired:?}");
    assert!(
        !core_keys.is_empty(),
        "nessuna chiave del kernel sta più nel namespace `core.`: l'esenzione qui \
         sopra non esenta più niente, e se è così va tolta invece di restare a \
         perdonare un caso che non c'è"
    );
    // Le lingue si guardano una per una e non catalogo per catalogo: una chiave
    // può stare in uno qualsiasi dei cataloghi di quella lingua, ed è
    // precisamente la somma che il montaggio fa (`Strings::template`).
    let languages: std::collections::BTreeSet<&str> =
        catalogs.iter().map(|c| c.locale.as_str()).collect();
    let missing: Vec<String> = keys
        .iter()
        .flat_map(|k| {
            languages
                .iter()
                .filter(|language| {
                    !catalogs
                        .iter()
                        .any(|c| c.locale == **language && c.entries.contains_key(k))
                })
                .map(move |language| format!("«{k}» manca in «{language}»"))
        })
        .collect();
    assert!(missing.is_empty(), "{}", missing.join(", "));
}

/// I pesi dei campi della ricerca (§21.6): l'unica feature di questo crate che
/// dichiari uno schema di impostazioni suo.
///
/// Il presidio generale qui sopra cammina view e comandi, cioè ciò che
/// l'inventario sa dire di una feature; le impostazioni non sono in quell'elenco
/// e passerebbero mute. La prosa è la parte che conta più dello schema: un campo
/// numerico senza la frase che spiega cosa fa lo zero è un campo che qualcuno
/// mette a zero credendo di spegnere la ricerca su quel campo, e trova le stesse
/// note di prima in un altro ordine.
#[cfg(feature = "search")]
#[test]
fn the_search_weights_speak_in_all_languages() {
    let catalogs = fub_features::search::catalog();
    let (mut keys, mut wired) = (Vec::new(), Vec::new());
    for spec in fub_features::search::settings() {
        let location = format!("ricerca: `{}`", spec.key);
        key(&spec.label, &location, &mut keys, &mut wired);
        key(&spec.description, &location, &mut keys, &mut wired);
        key(&spec.group, &location, &mut keys, &mut wired);
    }
    assert!(wired.is_empty(), "{wired:?}");
    let missing: Vec<String> = keys
        .iter()
        .flat_map(|k| {
            catalogs
                .iter()
                .filter(move |c| !c.entries.contains_key(k))
                .map(move |c| format!("«{k}» manca in «{}»", c.locale))
        })
        .collect();
    assert!(missing.is_empty(), "{}", missing.join(", "));
}

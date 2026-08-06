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
fn chiave(text: &Text, dove: &str, chiavi: &mut Vec<String>, cablate: &mut Vec<String>) {
    match text {
        Text::Message(m) => chiavi.push(m.key.clone()),
        // Vuoto è lecito: una descrizione che nessuno ha scritto non è una
        // stringa italiana, è l'assenza di una stringa.
        Text::Literal(s) if s.is_empty() => {}
        Text::Literal(s) => cablate.push(format!("{dove}: «{s}»")),
    }
}

/// Un componente e ciò che dichiara: i cataloghi, e le chiavi delle sue spec.
struct Componente {
    id: &'static str,
    cataloghi: Vec<StringCatalog>,
    chiavi: Vec<String>,
    cablate: Vec<String>,
}

/// Le chiavi che una view dichiara: oggi il titolo, e non serve altro perché è
/// l'unico `Text` che una `ViewSpec` porta.
fn di_una_view(
    id: &str,
    p: &dyn ViewProvider,
    chiavi: &mut Vec<String>,
    cablate: &mut Vec<String>,
) {
    for spec in p.views() {
        chiave(
            &spec.title,
            &format!("{id}: titolo della view «{}»", spec.id),
            chiavi,
            cablate,
        );
    }
}

/// Le chiavi che un `CommandProvider` dichiara: titolo, descrizione, e le due di
/// ogni parametro.
fn di_un_comando(
    id: &str,
    p: &dyn CommandProvider,
    chiavi: &mut Vec<String>,
    cablate: &mut Vec<String>,
) {
    for spec in p.commands() {
        chiave(
            &spec.title,
            &format!("{id}: titolo di «{}»", spec.id),
            chiavi,
            cablate,
        );
        chiave(
            &spec.description,
            &format!("{id}: descrizione di «{}»", spec.id),
            chiavi,
            cablate,
        );
        for par in &spec.params {
            let dove = format!("{id}: «{}» / `{}`", spec.id, par.name);
            chiave(&par.title, &dove, chiavi, cablate);
            chiave(&par.description, &dove, chiavi, cablate);
        }
    }
}

fn componenti() -> Vec<Componente> {
    fub_features::ogni_feature_ufficiale()
        .iter()
        .map(|f| {
            let (mut chiavi, mut cablate) = (Vec::new(), Vec::new());
            // Chi non dichiara né view né comandi non porta chiavi camminabili
            // da fuori — la ricerca parla quando qualcosa va storto, i blocchi
            // quando un rendering non c'è, il versioning quando racconta uno
            // snapshot — e resta comunque un componente: il suo catalogo passa
            // dalle domande 1 e 3 come tutti gli altri, ed è lì che si vede una
            // lingua tradotta a metà.
            if let Some(costruisci) = f.view {
                di_una_view(f.id, costruisci().as_ref(), &mut chiavi, &mut cablate);
            }
            if let Some(costruisci) = f.commands {
                di_un_comando(f.id, costruisci().as_ref(), &mut chiavi, &mut cablate);
            }
            Componente {
                id: f.id,
                cataloghi: (f.catalog)(),
                chiavi,
                cablate,
            }
        })
        .collect()
}

#[test]
fn ogni_lingua_dice_le_stesse_cose() {
    let mut buchi = Vec::new();
    for c in componenti() {
        assert!(
            c.cataloghi.len() >= 2,
            "«{}» ha un catalogo in una lingua sola: la seconda è ciò che rende \
             il catalogo un catalogo e non un file di stringhe",
            c.id
        );
        let riferimento = &c.cataloghi[0];
        for altro in &c.cataloghi[1..] {
            for k in riferimento.entries.keys() {
                if !altro.entries.contains_key(k) {
                    buchi.push(format!("{}: «{k}» manca in «{}»", c.id, altro.locale));
                }
            }
            for k in altro.entries.keys() {
                if !riferimento.entries.contains_key(k) {
                    buchi.push(format!(
                        "{}: «{k}» c'è in «{}» e non in «{}»",
                        c.id, altro.locale, riferimento.locale
                    ));
                }
            }
        }
    }
    assert!(
        buchi.is_empty(),
        "una lingua tradotta a metà non fallisce, degrada — e chi legge vede la \
         chiave nuda:\n  {}",
        buchi.join("\n  ")
    );
}

#[test]
fn ogni_chiave_dichiarata_ha_una_voce() {
    let mut buchi = Vec::new();
    for c in componenti() {
        for k in &c.chiavi {
            for catalogo in &c.cataloghi {
                if !catalogo.entries.contains_key(k) {
                    buchi.push(format!("{}: «{k}» manca in «{}»", c.id, catalogo.locale));
                }
            }
        }
    }
    assert!(
        buchi.is_empty(),
        "una chiave senza voce scende all'ultimo gradino della 0040 — brutto, \
         onesto, e davanti a chi guarda:\n  {}",
        buchi.join("\n  ")
    );
}

#[test]
fn niente_prosa_cablata_in_ciò_che_si_dichiara() {
    let cablate: Vec<String> = componenti().into_iter().flat_map(|c| c.cablate).collect();
    assert!(
        cablate.is_empty(),
        "una stringa dentro una spec è prosa che nessun catalogo può \
         raggiungere: era così che stavano tutte prima del §12.4\n  {}",
        cablate.join("\n  ")
    );
}

#[test]
fn le_impostazioni_del_core_parlano_anche_loro() {
    // Le impostazioni non sono di un componente di questo crate — le dichiarano
    // `fub-host` e `fub-kernel` — ma passano dalla stessa strada, e la
    // stessa strada vuole lo stesso presidio. Qui si guarda quelle del kernel,
    // che è l'unico dei due che questo crate vede; le altre le guarda il banco
    // di `fub-host`.
    let cataloghi = [
        fub_kernel::locale::catalog(),
        fub_kernel::properties::catalog(),
        fub_kernel::ignore::catalog(),
    ]
    .concat();
    let (mut chiavi, mut cablate) = (Vec::new(), Vec::new());
    // Le due famiglie insieme e non solo il locale: questo elenco è scritto a
    // mano, quindi una famiglia nuova dichiarata dal kernel resta scoperta
    // restando verde — è la stessa forma per cui `cataloghi_del_core()` in
    // `fub-host` aveva perso `maintenance`.
    let specs = [
        fub_kernel::locale::locale_settings(),
        fub_kernel::properties::properties_settings(),
        fub_kernel::ignore::ignore_settings(),
    ]
    .concat();
    for spec in specs {
        let dove = format!("kernel: `{}`", spec.key);
        chiave(&spec.label, &dove, &mut chiavi, &mut cablate);
        chiave(&spec.description, &dove, &mut chiavi, &mut cablate);
        chiave(&spec.group, &dove, &mut chiavi, &mut cablate);
        if let SettingKind::Choice { options, .. } = &spec.kind {
            for o in options {
                chiave(&o.label, &dove, &mut chiavi, &mut cablate);
            }
        }
    }
    assert!(cablate.is_empty(), "{cablate:?}");
    // Le lingue si guardano una per una e non catalogo per catalogo: una chiave
    // può stare in uno qualsiasi dei cataloghi di quella lingua, ed è
    // precisamente la somma che il montaggio fa (`Strings::template`).
    let lingue: std::collections::BTreeSet<&str> =
        cataloghi.iter().map(|c| c.locale.as_str()).collect();
    let mancanti: Vec<String> = chiavi
        .iter()
        .flat_map(|k| {
            lingue
                .iter()
                .filter(|lingua| {
                    !cataloghi
                        .iter()
                        .any(|c| c.locale == **lingua && c.entries.contains_key(k))
                })
                .map(move |lingua| format!("«{k}» manca in «{lingua}»"))
        })
        .collect();
    assert!(mancanti.is_empty(), "{}", mancanti.join(", "));
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
fn i_pesi_della_ricerca_parlano_in_tutte_le_lingue() {
    let cataloghi = fub_features::search::catalog();
    let (mut chiavi, mut cablate) = (Vec::new(), Vec::new());
    for spec in fub_features::search::settings() {
        let dove = format!("ricerca: `{}`", spec.key);
        chiave(&spec.label, &dove, &mut chiavi, &mut cablate);
        chiave(&spec.description, &dove, &mut chiavi, &mut cablate);
        chiave(&spec.group, &dove, &mut chiavi, &mut cablate);
    }
    assert!(cablate.is_empty(), "{cablate:?}");
    let mancanti: Vec<String> = chiavi
        .iter()
        .flat_map(|k| {
            cataloghi
                .iter()
                .filter(move |c| !c.entries.contains_key(k))
                .map(move |c| format!("«{k}» manca in «{}»", c.locale))
        })
        .collect();
    assert!(mancanti.is_empty(), "{}", mancanti.join(", "));
}

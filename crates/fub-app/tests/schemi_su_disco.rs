//! **I formati su disco sono quelli dichiarati** (§15.3).
//!
//! Ogni file che Fub scrive porta il suo numero di versione, e
//! [`docs/versionamento.md`](../../../docs/versionamento.md) ne tiene la
//! tabella: quale schema, in quale sorgente, a che numero è oggi. È l'elenco
//! che qualcuno legge il giorno in cui deve capire perché un file dell'utente
//! non si apre più — e fino a questo test era un elenco **tenuto a mano**.
//!
//! Cosa succedeva a tenerlo a mano, misurato il giorno in cui il test è nato:
//! la tabella dichiarava **nove** schemi mentre il codice ne aveva **dieci**
//! (`DIAGNOSTICS_VERSION`, nato con il suo campo e con il commento «§15.3» già
//! scritto accanto, non ci era mai entrato), e **cinque righe su nove**
//! puntavano a un numero di riga che il sorgente si era lasciato indietro. Un
//! puntatore sbagliato in un documento del genere non è un fastidio
//! tipografico: manda chi cerca la regola a leggerne un'altra.
//!
//! **Perché non basta `check-doc-links`.** Quei link scrivono il numero di riga
//! nel *testo* — `` [`crates/…/vaults.rs:40`](…) `` — e non nel frammento
//! dell'URL, e sono fra i link «senza un nome accanto da cercare» che quello
//! script conta e non verifica. Qui il nome da cercare c'è, ed è preciso: alla
//! riga dichiarata deve esserci una costante di versione, e il suo valore deve
//! essere il numero scritto nella colonna *Oggi*.
//!
//! **Perché non basta un conto.** `[conta: schemi-su-disco]` conta le costanti
//! nei sorgenti e `[conta: schemi-in-tabella]` conta le righe della tabella:
//! insieme prendono un formato **nato** e mai documentato, che è il caso che
//! nessun `include_str!` può vedere — un file che il test non include è un file
//! di cui il test non sa niente. Ma due conti uguali non dicono che siano gli
//! stessi undici: quello lo dice questo test, riga per riga. È la lezione della
//! [0105](../../../docs/decisions/0105-una-porta-si-nomina-e-un-presupposto-si-compila.md)
//! applicata a un terzo caso — *il conto prende ciò che nessuno ha elencato, il
//! test prende ciò che è elencato male* — e nessuno dei due basta da solo.
//!
//! Il legame con i sorgenti è `include_str!` e non `std::fs`, come in
//! `dieta_ipc.rs`: se un file si sposta, questo test **non compila**.

/// La tabella che questo test giudica: `## 3. Le versioni degli schemi su
/// disco`, in `docs/versionamento.md`.
const DOC: &str = include_str!("../../../docs/versionamento.md");

/// I sorgenti che la tabella cita. Un formato nuovo aggiunge una riga là e una
/// riga qui, e finché non fa tutt'e due il test lo dice per nome.
const SORGENTI: &[(&str, &str)] = &[
    (
        "crates/fub-host/src/vaults.rs",
        include_str!("../../fub-host/src/vaults.rs"),
    ),
    (
        "crates/fub-kernel/src/organization.rs",
        include_str!("../../fub-kernel/src/organization.rs"),
    ),
    (
        "crates/fub-kernel/src/viewstate.rs",
        include_str!("../../fub-kernel/src/viewstate.rs"),
    ),
    (
        "crates/fub-kernel/src/entries.rs",
        include_str!("../../fub-kernel/src/entries.rs"),
    ),
    (
        "crates/fub-kernel/src/settings.rs",
        include_str!("../../fub-kernel/src/settings.rs"),
    ),
    (
        "crates/fub-features/src/versioning.rs",
        include_str!("../../fub-features/src/versioning.rs"),
    ),
    (
        "crates/fub-features/src/search.rs",
        include_str!("../../fub-features/src/search.rs"),
    ),
    (
        "crates/fub-kernel/src/journal.rs",
        include_str!("../../fub-kernel/src/journal.rs"),
    ),
    (
        "crates/fub-kernel/src/drafts.rs",
        include_str!("../../fub-kernel/src/drafts.rs"),
    ),
    (
        "crates/fub-kernel/src/maintenance.rs",
        include_str!("../../fub-kernel/src/maintenance.rs"),
    ),
    (
        "crates/fub-kernel/src/vault.rs",
        include_str!("../../fub-kernel/src/vault.rs"),
    ),
];

/// Una riga della tabella: lo schema, dove sta dichiarato, e a che numero è.
#[derive(Debug)]
struct RigaDiTabella {
    schema: String,
    file: String,
    riga: usize,
    oggi: u32,
}

/// Legge la tabella degli schemi. Non è un parser di markdown: è la forma di
/// **quella** tabella, e una riga che non la rispetta viene ignorata — quindi
/// il verso «ogni costante ha la sua riga» è ciò che impedisce a una riga
/// scritta male di sparire in silenzio.
fn righe_della_tabella() -> Vec<RigaDiTabella> {
    let mut out = Vec::new();
    for riga in DOC.lines() {
        let riga = riga.trim();
        if !riga.starts_with('|') || !riga.contains("](../crates/") {
            continue;
        }
        let colonne: Vec<&str> = riga.split('|').map(str::trim).collect();
        // `| schema | [`file:riga`](…) | oggi | cosa contiene |` → cinque
        // colonne più i due bordi vuoti.
        if colonne.len() < 5 {
            continue;
        }
        let Some((file, numero)) = colonne[2]
            .split_once("[`")
            .and_then(|(_, resto)| resto.split_once("`]"))
            .and_then(|(dentro, _)| dentro.rsplit_once(':'))
        else {
            continue;
        };
        let Ok(numero) = numero.parse::<usize>() else {
            continue;
        };
        let Ok(oggi) = colonne[3].trim_matches('*').parse::<u32>() else {
            continue;
        };
        out.push(RigaDiTabella {
            schema: colonne[1].to_string(),
            file: file.to_string(),
            riga: numero,
            oggi,
        });
    }
    out
}

/// Le costanti di versione di un sorgente, per numero di riga.
///
/// Cerca la **proprietà** — una costante intera che dichiara una versione di
/// schema — e non il nome `SCHEMA_VERSION`: `DIAGNOSTICS_VERSION` è sfuggita per
/// un anno a un conto che guardava il nome, e chi l'ha chiamata così non ha
/// sbagliato niente.
fn versioni_dichiarate(sorgente: &str) -> Vec<(usize, u32)> {
    let mut out = Vec::new();
    for (i, riga) in sorgente.lines().enumerate() {
        let riga = riga.trim();
        // La visibilità non è la proprietà: `pub(crate) const` è la forma più
        // comune di questo codebase, e riconoscere solo `pub const` e `const`
        // avrebbe reso invisibile un formato che si era dichiarato per bene.
        let resto = riga.strip_prefix("pub").unwrap_or(riga).trim_start();
        let resto = match resto.find(") const ") {
            Some(i) if resto.starts_with('(') => &resto[i + 8..],
            _ => match resto.strip_prefix("const ") {
                Some(r) => r,
                None => continue,
            },
        };
        let Some((nome, tipo_e_valore)) = resto.split_once(": ") else {
            continue;
        };
        if !nome.ends_with("VERSION") {
            continue;
        }
        // E nemmeno la larghezza dell'intero lo è.
        let Some((tipo, valore)) = tipo_e_valore.split_once(" = ") else {
            continue;
        };
        if !matches!(tipo, "u8" | "u16" | "u32" | "u64" | "usize") {
            continue;
        }
        if let Ok(v) = valore.trim_end_matches(';').trim().parse::<u32>() {
            out.push((i + 1, v));
        }
    }
    out
}

fn sorgente(file: &str) -> Option<&'static str> {
    SORGENTI.iter().find(|(f, _)| *f == file).map(|(_, s)| *s)
}

#[test]
fn ogni_riga_della_tabella_punta_a_una_costante_che_esiste() {
    let righe = righe_della_tabella();
    assert!(
        righe.len() >= 11,
        "la tabella degli schemi si è accorciata: {} righe lette da \
         docs/versionamento.md. Se un formato è stato tolto va tolto anche da \
         SORGENTI; se è la forma della tabella a essere cambiata, è questo \
         parser a essere vecchio.",
        righe.len()
    );
    for riga in &righe {
        let Some(src) = sorgente(&riga.file) else {
            panic!(
                "«{}» cita {} che questo test non include: aggiungilo a SORGENTI, \
                 altrimenti quella riga non la verifica nessuno.",
                riga.schema, riga.file
            );
        };
        let dichiarate = versioni_dichiarate(src);
        let Some((_, valore)) = dichiarate.iter().find(|(n, _)| *n == riga.riga) else {
            panic!(
                "«{}» dice {}:{}, ma lì non c'è nessuna costante di versione. \
                 Le costanti di quel file stanno alle righe {:?}.",
                riga.schema,
                riga.file,
                riga.riga,
                dichiarate.iter().map(|(n, _)| *n).collect::<Vec<_>>()
            );
        };
        assert_eq!(
            *valore, riga.oggi,
            "«{}»: la tabella dice {}, il codice dice {} ({}:{}). \
             Il numero che conta è quello del codice — è quello che finisce nei \
             file dell'utente.",
            riga.schema, riga.oggi, valore, riga.file, riga.riga
        );
    }
}

#[test]
fn ogni_costante_di_versione_ha_la_sua_riga_in_tabella() {
    let righe = righe_della_tabella();
    for (file, src) in SORGENTI {
        for (numero, valore) in versioni_dichiarate(src) {
            let citata = righe
                .iter()
                .any(|r| r.file == *file && r.riga == numero && r.oggi == valore);
            assert!(
                citata,
                "{file}:{numero} dichiara la versione {valore} e nessuna riga di \
                 docs/versionamento.md lo dice. Un formato su disco che non sta \
                 nella tabella è un formato che nessuno saprà migrare: la riga \
                 costa meno del giorno in cui servirà."
            );
        }
    }
}

//! **Le due costanti di FNV-1a si scrivono in un posto solo.**
//!
//! Il posto è [`fub_abi::Fnv1a`], e ciò che presidia non è un'estetica: le tre
//! copie che c'erano prima — `Revision::of_bytes` nel contratto, `fingerprint`
//! nell'indice di ricerca, `fingerprint` nello store delle versioni — erano
//! ancora **uguali fra loro**, e questo era tutto il problema. Due di quei tre
//! numeri **finiscono su disco**: l'indice si rilegge a un avvio successivo, le
//! versioni pure, e il commento dello store dichiarava già di usare «la stessa
//! impronta che usa l'indice di ricerca» — cioè il contratto era scritto e la
//! copia che lo garantiva non c'era. Il giorno che una delle tre fosse cambiata,
//! i due archivi non si sarebbero più riletti e **nessun banco l'avrebbe
//! detto**, perché ogni copia resta coerente con sé stessa: chi impronta e chi
//! confronta sono la stessa riga. È il difetto 0223.
//!
//! # Perché un conto e non solo il compilatore
//!
//! Il compilatore la metà sua l'ha fatta: le due copie sono sparite e i loro
//! chiamanti passano da [`Fnv1a::nuova`]/[`Fnv1a::di`]. Ma non può accorgersi
//! del **gesto che ricomincia** — un quarto posto che vuole un `u64` stabile e
//! si riscrive le sue due `const`, perché in quel momento sono due righe e
//! sembra più breve che importare un tipo. È la variante che nessuno elenca, e
//! quella la prende un conto.
//!
//! # Cosa guarda, e cosa gli sfugge — detto qui e non altrove
//!
//! Guarda ogni `.rs` sotto una cartella `src/`, ovunque nel repo (nessun elenco
//! di crate scritto a mano), e ci cerca le **due costanti** in esadecimale,
//! normalizzando via gli `_`: `0xcbf2_9ce4_8422_2325` e
//! `0xcbf29ce484222325` sono la stessa riga per questo conto, che è la sola
//! differenza di forma che `cargo fmt` lascia libera.
//!
//! Gli sfugge, ed è dichiarato: le stesse costanti scritte in decimale, o
//! costruite sommando, o prese da una dipendenza esterna che porta il suo FNV.
//! Sono tutte più lunghe da scrivere della chiamata giusta, ed è precisamente
//! su questo che la maglia larga tiene: intercetta il gesto comodo, che è
//! l'unico che qualcuno farà.
//!
//! Non salta i commenti: se un giorno una prosa nominasse una delle due
//! costanti per esteso, questo conto diventerebbe rosso. È il verso innocuo —
//! la si sposta qui, dove sta già scritta spezzata proprio per non presidiare
//! sé stessa.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Le due costanti che fanno di un ciclo un FNV-1a a 64 bit, senza `_` e in
/// minuscolo.
///
/// Scritte a pezzi — `"cbf29ce4" + "84222325"` — perché altrimenti questo
/// elenco sarebbe esso stesso una copia, e un presidio che si conta dentro è un
/// presidio che non si può spostare né citare.
fn costanti() -> Vec<String> {
    vec![
        format!("0x{}{}", "cbf29ce4", "84222325"),
        format!("0x{}{}", "00000100", "000001b3"),
    ]
}

/// L'unico file di produzione autorizzato a contenerle: l'impronta vera.
///
/// Uno solo, e senza una struttura per le eccezioni: il giorno che ne servisse
/// un secondo la domanda da farsi è *perché due*, e la risposta va scritta
/// qui — non aggiunta a un elenco che cresce senza che nessuno se ne accorga.
const L_IMPRONTA: &str = "crates/fub-abi/src/edit.rs";

/// Le cartelle in cui non si entra.
const NON_SI_ENTRA: &[&str] = &["target", "node_modules", ".git", ".fub"];

fn radice() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Ogni `.rs` sotto una cartella `src/`, per percorso relativo alla radice.
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

/// La riga come la guarda il conto: niente `_`, tutto minuscolo.
fn normalizza(riga: &str) -> String {
    riga.replace('_', "").to_lowercase()
}

/// Chi scrive una delle due costanti nel codice di produzione, e dove.
fn siti() -> Vec<String> {
    let aghi = costanti();
    let mut out = Vec::new();
    for (file, sorgente) in sorgenti_di_produzione() {
        if file == L_IMPRONTA {
            continue;
        }
        for (n, riga) in sorgente.lines().enumerate() {
            let piatta = normalizza(riga);
            if aghi.iter().any(|a| piatta.contains(a.as_str())) {
                out.push(format!("{file}:{}   {}", n + 1, riga.trim()));
            }
        }
    }
    out
}

#[test]
fn le_costanti_di_fnv_stanno_in_un_file_solo() {
    let trovati = siti();
    assert!(
        trovati.is_empty(),
        "{} righe di produzione scrivono una costante di FNV-1a fuori da `{L_IMPRONTA}`:\n  {}\n\n\
         Un'impronta in più è un'impronta che diverge, e diverge in silenzio: questi numeri \
         finiscono su disco, e chi li ha scritti li rilegge con la sua stessa copia, quindi è \
         verde fino al giorno che due archivi devono parlarsi. Chi vuole il numero grezzo passa \
         da `fub_abi::Fnv1a` — `di` per un blocco solo, `nuova`/`mangia`/`valore` per una \
         sequenza di campi da separare.",
        trovati.len(),
        trovati.join("\n  ")
    );
}

/// Il test del test. `le_costanti_di_fnv_stanno_in_un_file_solo` è verde anche
/// se il cammino non trova niente e se il conto non aggancia, e le due avarie
/// sono indistinguibili da un repo pulito.
#[test]
fn il_cammino_e_il_conto_agganciano() {
    let sorgenti = sorgenti_di_produzione();
    assert!(
        sorgenti.len() > 50,
        "solo {} sorgenti di produzione trovati: il camminatore non sta camminando",
        sorgenti.len()
    );
    let impronta = sorgenti
        .get(L_IMPRONTA)
        .unwrap_or_else(|| panic!("`{L_IMPRONTA}` non è stato letto dal camminatore"));

    // Le due costanti stanno lì, e stanno nella forma con gli `_` che `cargo
    // fmt` produce: se il normalizzatore smettesse di togliere gli underscore,
    // qui ne vedrebbe zero e il conto vero non aggancerebbe più niente.
    let piatto = normalizza(impronta);
    for ago in costanti() {
        assert!(
            piatto.contains(&ago),
            "`{L_IMPRONTA}` non contiene più `{ago}`: l'impronta si è spostata, e questo \
             presidio sta guardando un file che non è più la sua casa"
        );
    }
    assert!(
        impronta.contains('_'),
        "`{L_IMPRONTA}` non scrive più le costanti a gruppi: il normalizzatore non è più \
         necessario, e questo controllo non prova più niente"
    );
}

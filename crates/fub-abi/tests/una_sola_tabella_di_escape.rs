//! **Nel codice di produzione le entità HTML si scrivono in un posto solo.**
//!
//! Il posto è [`fub_abi::html`], e ciò che presidia non è un'estetica: le tre
//! tabelle che c'erano prima **erano già divergenti**. `fub-features` non
//! copriva l'apice, `fub-kernel` non copriva né l'apice né il maggiore, e le
//! tre stavano in tre crate che non si vedono fra loro — cioè nella condizione
//! in cui una correzione fatta su una non arriva mai alle altre. È il difetto
//! 0048 visto per intero: non «una riga da aggiungere in `blocks.rs`», ma un
//! sito su tre.
//!
//! # Perché un conto e non solo il compilatore
//!
//! Il compilatore la metà sua l'ha fatta: le due tabelle divergenti sono
//! sparite e i loro chiamanti passano da [`fub_abi::html::attr`], che le
//! virgolette e l'escape li mette da sé. Ma il compilatore non può accorgersi
//! del **gesto che ricomincia** — un quarto emettitore di HTML che si scrive la
//! sua `fn escape_attr` privata, perché in quel momento è la cosa più breve da
//! fare. È la variante che nessuno ha elencato, e quella la prende un conto.
//!
//! # Cosa guarda, e cosa gli sfugge — detto qui e non altrove
//!
//! Guarda ogni `.rs` sotto una cartella `src/`, ovunque nel repo (nessun elenco
//! di crate scritto a mano), e ci cerca le **entità** — `&amp;`, `&lt;`,
//! `&gt;`, `&quot;`, `&#39;` — perché è l'unica cosa che una tabella di escape
//! deve contenere per funzionare, qualunque forma abbia: `match`, catena di
//! `replace`, array di coppie.
//!
//! Non guarda:
//!
//! - **la prosa.** Un commento che *racconta* questo difetto ne nomina le
//!   entità, e questo file ne è il primo esempio: senza il salto, il presidio
//!   presidierebbe se stesso.
//! - **i moduli `#[cfg(test)]` dentro i `src/`.** Un banco che asserisce
//!   `contains("&amp;")` sta verificando un'uscita, non costruendo una tabella.
//! - **i `tests/`.** Stessa ragione.
//!
//! Gli sfugge, ed è dichiarato: una tabella scritta coi code point
//! (`\u{26}amp;`), una costruita concatenando pezzi, e un escape che usa le
//! entità **nominate diverse** (`&apos;`, `&#x27;`). Sono tutte più lunghe da
//! scrivere della chiamata giusta, ed è precisamente su questo che la maglia
//! larga tiene: intercetta il gesto comodo, che è l'unico che qualcuno farà.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Le entità che una tabella di escape HTML deve contenere per essere una
/// tabella di escape HTML.
///
/// Scritte spezzate — `"&" + "amp;"` — perché altrimenti questo elenco sarebbe
/// esso stesso una tabella, e un presidio che si conta dentro è un presidio che
/// non si può spostare né citare.
fn entita() -> Vec<String> {
    ["amp;", "lt;", "gt;", "quot;", "#39;"]
        .iter()
        .map(|coda| format!("&{coda}"))
        .collect()
}

/// L'unico file di produzione autorizzato a contenerle: la tabella vera.
///
/// Uno solo, e senza una struttura per le eccezioni: il giorno che ne servisse
/// un secondo la domanda da farsi è *perché due*, e la risposta va scritta
/// qui — non aggiunta a un elenco che cresce senza che nessuno se ne accorga.
const LA_TABELLA: &str = "crates/fub-abi/src/html.rs";

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

/// Le righe **di codice** di un sorgente, numerate a partire da 1: niente
/// commenti di riga, niente modulo di prova.
///
/// Il modulo di prova si riconosce nella sola forma che il repo usa —
/// `#[cfg(test)]` a colonna zero, `mod … {` sotto, e la prima `}` a colonna
/// zero — che tiene perché `cargo fmt --all --check` è verde. Una forma diversa
/// non salta niente, cioè conta di più: il verso innocuo.
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

/// Chi scrive un'entità HTML nel codice di produzione, e dove.
fn siti() -> Vec<String> {
    let aghi = entita();
    let mut out = Vec::new();
    for (file, sorgente) in sorgenti_di_produzione() {
        if file == LA_TABELLA {
            continue;
        }
        for (n, riga) in righe_di_codice(&sorgente) {
            if aghi.iter().any(|a| riga.contains(a.as_str())) {
                out.push(format!("{file}:{n}   {}", riga.trim()));
            }
        }
    }
    out
}

#[test]
fn le_entita_html_stanno_in_un_file_solo() {
    let trovati = siti();
    assert!(
        trovati.is_empty(),
        "{} righe di produzione scrivono un'entità HTML fuori da `{LA_TABELLA}`:\n  {}\n\n\
         Una tabella di escape in più è una tabella che diverge: quelle che c'erano prima \
         erano tre e nessuna copriva gli stessi caratteri. Chi emette markup passa da \
         `fub_abi::html::escape` per il testo e da `fub_abi::html::attr` per un attributo — \
         `attr` mette lui le virgolette, quindi non c'è più un escape da ricordarsi.",
        trovati.len(),
        trovati.join("\n  ")
    );
}

/// Il test del test. `le_entita_html_stanno_in_un_file_solo` è verde anche se il
/// cammino non trova niente e se l'estrattore salta tutto, e le due avarie sono
/// indistinguibili da un repo pulito.
#[test]
fn il_cammino_e_l_estrattore_agganciano() {
    let sorgenti = sorgenti_di_produzione();
    assert!(
        sorgenti.len() > 50,
        "solo {} sorgenti di produzione trovati: il camminatore non sta camminando",
        sorgenti.len()
    );
    let tabella = sorgenti
        .get(LA_TABELLA)
        .unwrap_or_else(|| panic!("`{LA_TABELLA}` non è stato letto dal camminatore"));

    // Le entità nella tabella vera stanno nel *codice*, non nei suoi commenti:
    // se l'estrattore saltasse più del dovuto, qui ne vedrebbe zero.
    let nel_codice: Vec<&str> = righe_di_codice(tabella)
        .into_iter()
        .filter(|(_, r)| entita().iter().any(|a| r.contains(a.as_str())))
        .map(|(_, r)| r)
        .collect();
    assert_eq!(
        nel_codice.len(),
        5,
        "attese le cinque entità nel codice di `{LA_TABELLA}`, viste {}:\n{nel_codice:#?}",
        nel_codice.len()
    );

    // E l'estrattore salta davvero il modulo di prova: `html.rs` ne ha uno che
    // le nomina tutte, e nessuna delle sue righe è finita nel conto qui sopra.
    assert!(
        tabella.contains("#[cfg(test)]"),
        "`{LA_TABELLA}` non ha più un modulo di prova: questo controllo non aggancia più niente"
    );
}

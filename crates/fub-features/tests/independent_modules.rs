//! **La condizione dello split, valutata da qualcuno** (§16.3, secondo tempo).
//!
//! Il §16.3 lascia lo split in crate fuori con una condizione che non è una
//! data: *il primo import fra due moduli di feature che non sia un link di
//! documentazione*. Una condizione scritta così è esattamente ciò che la
//! [decisione 0072](../../../docs/decisions/0072-un-numero-si-scrive-accanto-a-come-si-ricava.md)
//! ha censito un piano più in su — un'affermazione in italiano dentro un
//! documento, che nessun compilatore legge e che invecchia in silenzio. Il
//! motivo per cui si scrive una condizione è **smettere di doverci pensare**, e
//! finché nessuno la valuta si è solo spostato il pensiero più in là.
//!
//! Questo banco la valuta. Quando diventa rosso non ha trovato un errore: ha
//! trovato che **la voce si è sbloccata**, e il messaggio lo dice con quelle
//! parole.
//!
//! # Perché non basta il compilatore, che pure sa farlo valere
//!
//! La [0071](../../../docs/decisions/0071-una-feature-si-spegne-dove-si-dichiara.md)
//! lascia il criterio: prima di scrivere un test che legge i sorgenti, si cerca
//! il confine che il compilatore già sa far valere. Qui c'è, ed è pure già in
//! CI. Ogni modulo di feature sta dietro il suo `#[cfg]` in `lib.rs`, quindi
//! nella build della sola `outline` un `use crate::search::…` scritto dentro
//! `outline.rs` non compila — e non compila nemmeno `use crate::SEARCH_ID`, cioè
//! la strada che passa dai `pub use` della radice e che un grep sul nome del
//! modulo non vedrebbe.
//!
//! Il buco non è in ciò che il compilatore prende: è in ciò che **insegna**. Chi
//! scrive quell'import e vede la build parziale diventare rossa non rinuncia
//! all'accoppiamento — ci mette davanti un `#[cfg(feature = "search")]`, che è
//! la riparazione che l'errore suggerisce. Da quel momento l'import compila in
//! ogni configurazione e ogni presidio resta verde, mentre l'accoppiamento
//! feature↔feature — l'unica cosa che lo split compra — c'è per davvero. La
//! forma che evade il confine è quella che il confine stesso ha appena chiesto,
//! e non è la forma distratta: è quella attenta.
//!
//! Per questo la domanda si pone anche ai sorgenti, e per questo la si pone
//! **prima** del `cfg` e non dopo: qui un `#[cfg]` davanti non nasconde niente.
//!
//! # La regola è più larga della condizione, ed è apposta
//!
//! Non si cercano gli import *verso un altro modulo di feature*: si chiede che
//! un modulo di feature **non nomini `crate::` affatto**. Le due cose oggi
//! coincidono — l'unica altra cosa che sta nella radice sono i `pub use` delle
//! feature stesse — ma la seconda si può controllare senza sapere quali moduli
//! esistano, e soprattutto non ha bisogno di distinguere `crate::search::X` da
//! `crate::X` da `use crate::{self as c}`. Un modulo di feature è ciò che sarà
//! un crate a sé: dentro non c'è nessun `crate::` da scrivere, perché la radice
//! che quel `crate::` nomina è proprio il confine che lo split disegnerà.
//!
//! Se un giorno nascesse un modulo **condiviso** e legittimo — un helper, un
//! tipo comune — la risposta non è indebolire questa soglia: è aggiungerlo a
//! [`RADICE`] con la sua ragione, così che «i moduli di feature non si parlano»
//! resti vero e diventi vero *rispetto a un vocabolario dichiarato*. È la mossa
//! che la 0071 ha chiamata per nome: un presidio che diventa rosso per un caso
//! nuovo e legittimo non si indebolisce, si circoscrive.

use std::collections::BTreeSet;

/// I file di `src/` che **non** sono moduli di feature, e la ragione.
///
/// - `lib.rs` è la radice: i `pub use` che rimontano le feature sono il suo
///   mestiere.
/// - `inventario.rs` è l'aggregatore. Importa tutti e otto i moduli **per
///   definizione**: è l'elenco di cosa esiste
///   ([0056](../../../docs/decisions/0056-un-elenco-che-e-la-sorgente.md)), e un
///   elenco che non nomina ciò che elenca non è un elenco. È l'unico file che
///   può, ed è anche il solo posto da cui uno split lo farebbe comunque —
///   diventerebbe il crate che dipende da tutti gli altri.
const ROOT: &[&str] = &["lib.rs", "inventario.rs"];

/// Toglie da un sorgente Rust tutto ciò che non è codice: commenti di riga
/// (compresi `///` e `//!`), commenti a blocco annidati, e il contenuto delle
/// stringhe.
///
/// I commenti perché la condizione li esclude alla lettera — «che non sia un
/// link di documentazione» — e oggi i riferimenti incrociati che esistono sono
/// **solo** quelli: sei moduli su otto linkano `backlinks::catalog` per spiegare
/// dove sta un catalogo. Un presidio che contasse la prosa sarebbe rosso da
/// prima di nascere, che è il difetto in cui la
/// [0057](../../../docs/decisions/0057-la-dieta-dell-ipc.md) era già inciampata
/// contando `#[tauri::command]` dentro i commenti.
///
/// Le stringhe perché un `"crate::"` dentro un messaggio d'errore non è un
/// import, e — più insidioso — perché una `"http://…"` dentro una stringa
/// farebbe partire un finto commento di riga che si mangia il resto della riga,
/// cioè un **falso verde**. È il verso in cui un errore di scanner costa caro.
///
/// I caratteri sopravvissuti sono sostituiti con uno spazio invece che tolti:
/// così non si saldano due token che erano separati da un commento.
fn only_code(source: &str) -> String {
    let byte: Vec<char> = source.chars().collect();
    let mut outside = String::with_capacity(source.len());
    let mut the = 0;
    while the < byte.len() {
        let c = byte[the];
        let after = byte.get(the + 1).copied();
        match (c, after) {
            // Commento di riga: fino al newline, che si tiene.
            ('/', Some('/')) => {
                while the < byte.len() && byte[the] != '\n' {
                    outside.push(' ');
                    the += 1;
                }
            }
            // Commento a blocco, annidabile come vuole Rust.
            ('/', Some('*')) => {
                let mut level = 0usize;
                while the < byte.len() {
                    if byte[the] == '/' && byte.get(the + 1) == Some(&'*') {
                        level += 1;
                        outside.push_str("  ");
                        the += 2;
                    } else if byte[the] == '*' && byte.get(the + 1) == Some(&'/') {
                        level -= 1;
                        outside.push_str("  ");
                        the += 2;
                        if level == 0 {
                            break;
                        }
                    } else {
                        outside.push(if byte[the] == '\n' { '\n' } else { ' ' });
                        the += 1;
                    }
                }
            }
            // Stringa: si salta fino alla chiusura, rispettando gli escape.
            ('"', _) => {
                outside.push(' ');
                the += 1;
                while the < byte.len() {
                    if byte[the] == '\\' {
                        outside.push_str("  ");
                        the += 2;
                        continue;
                    }
                    let end = byte[the] == '"';
                    outside.push(if byte[the] == '\n' { '\n' } else { ' ' });
                    the += 1;
                    if end {
                        break;
                    }
                }
            }
            _ => {
                outside.push(c);
                the += 1;
            }
        }
    }
    outside
}

/// I moduli di feature di questa build: `(nome del file, sorgente)`.
///
/// Si guarda **il disco** e non l'inventario, e la differenza conta: le cargo
/// feature spengono le righe dell'inventario, non i file. Un modulo spento
/// resta un file che qualcuno leggerà e riaccenderà, quindi la domanda gli va
/// posta lo stesso — e così il banco non ha bisogno di un `cfg` in testa per
/// avere un soggetto.
fn modules_of_feature() -> Vec<(String, String)> {
    let src = concat!(env!("CARGO_MANIFEST_DIR"), "/src");
    let mut outside = Vec::new();
    for entry in std::fs::read_dir(src).expect("il crate ha una cartella `src`") {
        let path = entry.expect("una voce leggibile di `src`").path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.ends_with(".rs") || ROOT.contains(&name) {
            continue;
        }
        let source = std::fs::read_to_string(&path)
            .unwrap_or_else(|and| panic!("«{name}» non si legge: {and}"));
        outside.push((name.to_string(), source));
    }
    outside.sort();
    assert!(
        !outside.is_empty(),
        "nessun modulo di feature in `src/`: o il crate è cambiato di forma, o \
         `RADICE` se li è mangiati tutti — in tutti e due i casi questo banco \
         non sta più guardando niente"
    );
    outside
}

/// **La condizione della §16.3, valutata.**
///
/// Rosso qui non vuol dire «hai sbagliato»: vuol dire che il secondo tempo del
/// §16.3 si è sbloccato, e che qualcuno deve andarlo a leggere prima di
/// proseguire. Il messaggio è scritto per essere letto da chi non ha in mente
/// niente di tutto questo.
#[test]
fn no_feature_module_names_at_root() {
    let mut offenders: BTreeSet<String> = BTreeSet::new();
    for (name, source) in modules_of_feature() {
        for (n, row) in only_code(&source).lines().enumerate() {
            if row.contains("crate::") {
                offenders.insert(format!("  {name}:{} → {}", n + 1, row.trim()));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "\n\n\
         ┌─ La §16.3 si è sbloccata. Questo non è un errore: è una voce di\n\
         │  roadmap che ti sta aspettando.\n\
         └─\n\
         \n\
         Un modulo di feature nomina `crate::`, cioè si parla con un altro\n\
         modulo di feature — e quello era, alla lettera, ciò che il §16.3\n\
         aspettava per giustificare il **secondo tempo**: lo split di\n\
         `fub-features` in un crate per bundle. Finché i moduli non si\n\
         parlavano, pagare venti `Cargo.toml` per otto moduli indipendenti era\n\
         un costo senza compratore. Adesso c'è un compratore.\n\
         \n\
         Dove:\n{}\n\
         \n\
         Cosa fare, in quest'ordine:\n\
         \n\
           1. leggi la §16.3 in `docs/roadmap/16-crate-sdk-banchi-di-prova.md`\n\
              e la decisione 0071, che le hanno lasciate scritte la condizione e\n\
              la ragione;\n\
           2. se ciò che hai scritto è davvero un accoppiamento fra due feature,\n\
              la voce è tua: lo split è il lavoro, e questo banco è ciò che te\n\
              l'ha detto;\n\
           3. se invece è un **helper condiviso** — un tipo comune, una funzione\n\
              che non appartiene a nessuna delle due — allora non è la voce che\n\
              si sblocca: mettilo in un modulo suo e aggiungilo a `RADICE` qui\n\
              sopra, con la ragione accanto. La soglia resta dov'è; cambia il\n\
              vocabolario in cui le si fa la domanda.\n\
         \n\
         Ciò che NON va fatto è togliere questo assert per tornare verdi: il\n\
         verde di prima diceva «i moduli non si parlano», e non è più vero.\n",
        offenders.into_iter().collect::<Vec<_>>().join("\n")
    );
}

/// E lo scanner si prova su una trappola, invece che sulla fiducia.
///
/// Un presidio che legge i sorgenti vale quanto vale il suo estrattore, e le due
/// specie di errore non costano uguale: contare un commento lo rende rosso
/// subito e qualcuno se ne accorge; **mancare** un `crate::` vero lo lascia
/// verde per sempre. Le righe qui sotto sono i casi in cui è mancarlo che è
/// facile — il `//` dentro una stringa, il commento a blocco che si chiude a
/// metà riga, l'import guardato da un `#[cfg]`.
#[test]
fn scanner_ignores_prose_and_finds_code() {
    let fake = r#"
//! Un doc-comment che linka [`backlinks::catalog`](crate::backlinks::catalog).
/// E un altro: vedi crate::search::SEARCH_ID.
// E un commento normale: crate::tags::TAGS_ID.
/* un blocco
   con crate::stats::STATS_ID dentro
   /* e uno annidato con crate::blocks::BLOCKS_ID */
*/
const URL: &str = "https://esempio.invalid/crate::finto";
const MESSAGGIO: &str = "una stringa con \" dentro e crate::versioning citato";
/* blocco che finisce a metà riga */ use crate::outline::OUTLINE_ID;
#[cfg(feature = "search")]
use crate::search::SearchIndex;
"#;

    let code = only_code(fake);
    let found: Vec<&str> = code
        .lines()
        .filter(|r| r.contains("crate::"))
        .map(|r| r.trim())
        .collect();

    assert_eq!(
        found.len(),
        2,
        "the scanner has found {} rows instead of 2:\n{found:#?}\n\
         (the two vere sono the'`use` after the block closed a metà row and that \
          dietro the `#[cfg]`; all the resto è prose or stringhe)",
        found.len()
    );
    assert!(
        found[0].contains("crate::outline::OUTLINE_ID"),
        "the `use` that follows a commento a block closed a metà row deve \
         survive: è the case in which saltare troppo costs a falso verde"
    );
    assert!(
        found[1].contains("crate::search::SearchIndex"),
        "the'import guardato from `#[cfg]` deve survive: è **the** form that the \
         compiler not takes, ed è the reason for which this bench exists"
    );
}

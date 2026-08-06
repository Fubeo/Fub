//! **Ogni tipo pubblico del contratto si vede dalla radice del crate** (§24.1).
//!
//! `lib.rs` diceva di riesportare «i tipi più usati, per import ergonomici», e
//! quella formula ha una proprietà che nessuno aveva scritto: *chi decide
//! l'elenco è chi si ricorda di aggiungercisi*. Un tipo nuovo nasce fuori
//! dall'elenco senza rompere niente e senza chiedere il permesso a nessuno, e
//! chi lo usa scrive `fub_abi::traits::JobId` mentre il suo vicino di riga
//! scrive `fub_abi::Paged`. Il path lungo passa da `traits`, che è un modulo di
//! **implementazione**: il giorno in cui si spezza — ed è la direzione in cui il
//! crate si muove dalla [0053](../../../docs/decisions/0053-il-contratto-ha-una-sorgente.md) —
//! quei path si rompono, e si rompono per chi sta fuori.
//!
//! Questo test toglie a chi scrive la facoltà di dimenticarsene. Non è un test
//! di comportamento: è un test sul **sorgente**. Legge `src/` per intero con
//! `syn` e ne ricava due insiemi per strade indipendenti:
//!
//! 1. **i tipi dichiarati** — ogni `pub struct`, `pub enum`, `pub trait`,
//!    `pub type` che sta in `src/**/*.rs`, moduli annidati compresi;
//! 2. **i tipi riesportati** — i nomi dentro i `pub use <modulo>::{…}` di
//!    `lib.rs`.
//!
//! Poi confronta **in una direzione sola**, e questa è la cosa da non imitare
//! a occhi chiusi. `dieta_ipc` e `ALLOWED_TRANSITIVE_ABI` confrontano il loro
//! elenco nei due versi, perché un elenco che resta lungo mentre il codice si
//! accorcia è un ricordo e non una fotografia; qui il verso di ritorno — «alla
//! radice c'è un nome che nel modulo non esiste più» — **non può diventare
//! rosso**, perché un `pub use` non è una stringa che nomina un simbolo, è un
//! riferimento a quel simbolo: se il tipo sparisce, il crate non compila.
//! Scriverne il test avrebbe dato un presidio verde per sempre, cioè
//! indistinguibile da uno soddisfatto. L'unico elenco di *stringhe* che c'è qui
//! è [`MODULI_QUALIFICATI`], e quello i due versi ce li ha entrambi.
//!
//! # I moduli qualificati, e perché non sono un'eccezione comoda
//!
//! Due moduli restano fuori, ed è per una ragione che il compilatore renderebbe
//! evidente: [`MODULI_QUALIFICATI`]. Non è una lista di sconti — è l'elenco dei
//! moduli **che si usano col loro nome davanti**, e per entrambi la riesportazione
//! alla radice non è indesiderabile, è impossibile. Un modulo che ci entra deve
//! portare la ragione, e non può avere neanche un tipo alla radice: dire «questo
//! si usa qualificato» e riesportarne metà sono due affermazioni che insieme non
//! vogliono dire niente, e il test le rifiuta.
//!
//! # Zone cieche dichiarate
//!
//! - **Solo i tipi.** Funzioni libere e costanti non sono contate. Una funzione
//!   si raggiunge attraverso il modulo che la nomina — `rules::path::resolution_key`
//!   dice *di chi è la regola*, e appiattirla alla radice le toglierebbe il
//!   soggetto —, mentre un tipo compare nella **firma** di qualcun altro e chi
//!   la legge deve poterlo nominare senza sapere in che file è stato scritto.
//!   `MAX_RANDOM_BYTES` è alla radice perché ce lo hanno messo, non perché una
//!   regola lo pretenda.
//! - **Solo `fub-abi`.** Gli altri crate del workspace non hanno un contratto da
//!   esporre e non sono guardati.
//! - **La visibilità effettiva non è il `pub` scritto.** Un tipo `pub` dentro un
//!   `mod` privato è irraggiungibile e qui risulterebbe mancante: succede
//!   diventando rosso, non passando verde, ed è il verso giusto in cui sbagliare.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// I moduli che si usano **qualificati**, con la ragione per cui lo sono.
///
/// La ragione è la parte che conta: per tutti e due la riesportazione alla
/// radice non si può proprio fare, e il motivo si legge nei nomi.
const MODULI_QUALIFICATI: &[(&str, &str)] = &[
    (
        "arena",
        "è la forma AL CONFINE degli alberi (span a larghezza fissa, figli per \
         indice): `arena::Block`, `arena::Inline`, `arena::Span`, `arena::UiNode` \
         e `arena::UiKind` portano di proposito lo stesso nome dei tipi dell'albero \
         nativo, perché sono lo stesso concetto visto dall'altra parte della \
         conversione. Riesportarli alla radice non è indesiderabile: sono cinque \
         collisioni di nome con `model` e `ui`.",
    ),
    (
        "rules",
        "è la parte di una risposta che non dipende da chi la dà, e si chiama col \
         soggetto davanti: `rules::path`, `rules::tag`, `rules::ids`. `Owner`, \
         `Naming`, `Newline` alla radice sarebbero tre parole senza il soggetto \
         che dice di quale regola parlano — e `rules` ha sottomoduli, quindi \
         l'appiattimento dovrebbe scegliere anche a che profondità fermarsi.",
    ),
];

/// Un tipo pubblico, come sta scritto nel sorgente.
#[derive(Debug)]
struct Tipo {
    /// Il modulo di **primo livello** (`traits`, `rules`, …): quello che compare
    /// nel `pub use` di `lib.rs`.
    modulo: String,
    /// Il path completo dentro il crate, per i messaggi (`rules::ids`).
    dove: String,
    nome: String,
}

fn src_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/src"))
}

fn parse(path: &Path) -> syn::File {
    let src = std::fs::read_to_string(path)
        .unwrap_or_else(|e| panic!("impossibile leggere {}: {e}", path.display()));
    syn::parse_file(&src).unwrap_or_else(|e| panic!("{} non parsa: {e}", path.display()))
}

fn e_pub(vis: &syn::Visibility) -> bool {
    matches!(vis, syn::Visibility::Public(_))
}

/// I tipi pubblici di un file, moduli annidati compresi. `dove` è il path del
/// modulo che contiene questi item.
fn tipi_di(items: &[syn::Item], modulo: &str, dove: &str, out: &mut Vec<Tipo>) {
    for item in items {
        let (vis, nome) = match item {
            syn::Item::Struct(i) => (&i.vis, i.ident.to_string()),
            syn::Item::Enum(i) => (&i.vis, i.ident.to_string()),
            syn::Item::Trait(i) => (&i.vis, i.ident.to_string()),
            syn::Item::Type(i) => (&i.vis, i.ident.to_string()),
            // Un `pub mod` scritto dentro un file è superficie come gli altri:
            // se ci nascesse un tipo, non deve poterci restare nascosto.
            syn::Item::Mod(m) => {
                if let (true, Some((_, dentro))) = (e_pub(&m.vis), m.content.as_ref()) {
                    let giu = format!("{dove}::{}", m.ident);
                    tipi_di(dentro, modulo, &giu, out);
                }
                continue;
            }
            _ => continue,
        };
        if e_pub(vis) {
            out.push(Tipo {
                modulo: modulo.to_string(),
                dove: dove.to_string(),
                nome,
            });
        }
    }
}

/// Ogni `.rs` sotto `src/`, in ordine deterministico.
fn sorgenti(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut voci: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("{} illeggibile: {e}", dir.display()))
        .map(|e| e.expect("voce di directory").path())
        .collect();
    voci.sort();
    for v in voci {
        if v.is_dir() {
            sorgenti(&v, out);
        } else if v.extension().is_some_and(|e| e == "rs") {
            out.push(v);
        }
    }
}

/// Tutti i tipi pubblici del crate, letti dai sorgenti.
fn tipi_dichiarati() -> Vec<Tipo> {
    let radice = src_dir();
    let mut file = Vec::new();
    sorgenti(&radice, &mut file);
    assert!(
        file.len() > 20,
        "solo {} sorgenti trovati sotto src/: il camminatore non sta camminando",
        file.len()
    );

    let mut out = Vec::new();
    for f in file {
        let rel = f.strip_prefix(&radice).expect("dentro src/");
        let mut segmenti: Vec<String> = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        // `foo/mod.rs` è il modulo `foo`; `foo/bar.rs` è `foo::bar`.
        let ultimo = segmenti.pop().expect("almeno un segmento");
        let base = ultimo.trim_end_matches(".rs").to_string();
        if base == "lib" && segmenti.is_empty() {
            continue; // la radice non dichiara tipi: li raccoglie
        }
        if base != "mod" {
            segmenti.push(base);
        }
        let Some(modulo) = segmenti.first().cloned() else {
            continue;
        };
        let dove = segmenti.join("::");
        tipi_di(&parse(&f).items, &modulo, &dove, &mut out);
    }
    out
}

/// I nomi riesportati da `lib.rs`, per modulo di primo livello.
///
/// Rifiuta le forme che questo lettore non sa giudicare — un `pub use
/// traits::*` per esempio, che è l'altro estremo del difetto: riesporta tutto
/// e rinuncia a dire cosa è superficie.
fn riesportati() -> BTreeMap<String, BTreeSet<String>> {
    let lib = src_dir().join("lib.rs");
    let mut out: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for item in parse(&lib).items {
        let syn::Item::Use(u) = item else { continue };
        if !e_pub(&u.vis) {
            continue;
        }
        let syn::UseTree::Path(p) = &u.tree else {
            panic!("`pub use` di lib.rs in una forma inattesa: attesa `pub use <modulo>::…`");
        };
        let modulo = p.ident.to_string();
        let voce = out.entry(modulo.clone()).or_default();
        match &*p.tree {
            syn::UseTree::Name(n) => {
                voce.insert(n.ident.to_string());
            }
            syn::UseTree::Group(g) => {
                for t in &g.items {
                    match t {
                        syn::UseTree::Name(n) => {
                            voce.insert(n.ident.to_string());
                        }
                        _ => panic!(
                            "`pub use {modulo}::{{…}}` contiene una forma che questo test non \
                             sa giudicare (glob, alias o path annidato): la superficie della \
                             radice si dichiara nome per nome"
                        ),
                    }
                }
            }
            _ => panic!(
                "`pub use {modulo}::…` non è né un nome né un gruppo di nomi: un `*` \
                 riesporta tutto e rinuncia a dire cosa è superficie"
            ),
        }
    }
    out
}

#[test]
fn ogni_tipo_pubblico_si_vede_dalla_radice() {
    let qualificati: BTreeSet<&str> = MODULI_QUALIFICATI.iter().map(|(m, _)| *m).collect();
    let radice = riesportati();

    let mut mancanti: Vec<String> = Vec::new();
    for t in tipi_dichiarati() {
        if qualificati.contains(t.modulo.as_str()) {
            continue;
        }
        let c_e = radice
            .get(&t.modulo)
            .is_some_and(|n| n.contains(t.nome.as_str()));
        if !c_e {
            mancanti.push(format!("{}::{}", t.dove, t.nome));
        }
    }
    mancanti.sort();

    assert!(
        mancanti.is_empty(),
        "{} tipi pubblici del contratto non si vedono da `fub_abi::`:\n  {}\n\n\
         Chi li usa deve scrivere il path lungo, che passa dal modulo in cui sono \
         stati dichiarati — un modulo di implementazione, che può spezzarsi. \
         Aggiungili al blocco `pub use` di src/lib.rs; se davvero il loro modulo \
         si usa qualificato, il posto in cui dirlo è MODULI_QUALIFICATI, con la \
         ragione.",
        mancanti.len(),
        mancanti.join("\n  ")
    );
}

#[test]
fn un_modulo_qualificato_lo_e_per_intero_e_con_una_ragione() {
    let moduli: BTreeSet<String> = tipi_dichiarati().into_iter().map(|t| t.modulo).collect();
    let radice = riesportati();

    for (nome, ragione) in MODULI_QUALIFICATI {
        assert!(
            moduli.contains(*nome),
            "`{nome}` è dichiarato modulo qualificato ma sotto src/ non c'è nessun \
             modulo con quel nome che dichiari tipi: un'eccezione a un difetto che \
             non esiste più è un ricordo, non un presidio"
        );
        assert!(
            ragione.len() > 80,
            "`{nome}` sta fra i moduli qualificati con una ragione di {} caratteri: \
             la ragione è la sola cosa che distingue questo elenco da uno sconto",
            ragione.len()
        );
        assert!(
            !radice.contains_key(*nome),
            "`{nome}` è dichiarato modulo qualificato — cioè «si usa col nome \
             davanti» — e insieme è riesportato dalla radice: sono due affermazioni \
             che insieme non vogliono dire niente. Togli il `pub use {nome}::…` \
             oppure togli `{nome}` da MODULI_QUALIFICATI."
        );
    }
}

/// Il test del test: il camminatore vede davvero i moduli annidati e i
/// sottomoduli su file.
///
/// Senza questo, `ogni_tipo_pubblico_si_vede_dalla_radice` potrebbe essere
/// verde perché non guarda niente — e un presidio che non aggancia è
/// indistinguibile da uno soddisfatto. I due tipi nominati qui stanno uno in un
/// sottomodulo su file (`rules::ids::Owner`) e uno in un file piano
/// (`traits::JobId`): se il camminatore si fermasse alla radice di `src/`, o
/// smettesse di scendere nelle cartelle, questo test lo direbbe per nome.
#[test]
fn il_camminatore_scende() {
    let tipi = tipi_dichiarati();
    let cerca = |dove: &str, nome: &str| {
        assert!(
            tipi.iter().any(|t| t.dove == dove && t.nome == nome),
            "`{dove}::{nome}` non è stato visto dal camminatore"
        );
    };
    cerca("rules::ids", "Owner");
    cerca("traits", "JobId");
    cerca("model", "DocId");

    // E il conto complessivo non è ridicolo: un estrattore che tornasse tre
    // tipi passerebbe le tre righe qui sopra.
    assert!(
        tipi.len() > 150,
        "solo {} tipi pubblici trovati in tutto il contratto: l'estrattore sta \
         guardando meno di quello che crede",
        tipi.len()
    );
}

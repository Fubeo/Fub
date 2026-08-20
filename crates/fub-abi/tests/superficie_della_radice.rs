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
const QUALIFIED_MODULES: &[(&str, &str)] = &[
    (
        "arena",
        "is the BOUNDARY form of the trees (fixed-width span, children by \
         index): `arena::Block`, `arena::Inline`, `arena::Span`, `arena::UiNode` \
         and `arena::UiKind` deliberately carry the same name as the native tree \
         types, because they are the same concept seen from the other side of the \
         conversion. Re-exporting them from the root is not undesirable: they are five \
         name collisions with `model` and `ui`.",
    ),
    (
        "rules",
        "is the part of a response that does not depend on who gives it, and \
         is named with the subject in front: `rules::path`, `rules::tag`, \
         `rules::ids`. `Owner`, `Naming`, `Newline` at the root would be three \
         words without the subject saying which rule they belong to — and `rules` \
         has sub-modules, so flattening should also choose how deep to stop.",
    ),
];

/// Un tipo pubblico, come sta scritto nel sorgente.
#[derive(Debug)]
struct TypeEntry {
    /// Il modulo di **primo livello** (`traits`, `rules`, …): quello che compare
    /// nel `pub use` di `lib.rs`.
    module: String,
    /// Il path completo dentro il crate, per i messaggi (`rules::ids`).
    path: String,
    name: String,
}

fn src_dir() -> PathBuf {
    PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/src"))
}

fn parse(path: &Path) -> syn::File {
    let src = std::fs::read_to_string(path)
        .unwrap_or_else(|and| panic!("cannot read {}: {and}", path.display()));
    syn::parse_file(&src).unwrap_or_else(|and| panic!("{} failed to parse: {and}", path.display()))
}

fn is_pub(vis: &syn::Visibility) -> bool {
    matches!(vis, syn::Visibility::Public(_))
}

/// I tipi pubblici di un file, moduli annidati compresi. `dove` è il path del
/// modulo che contiene questi item.
fn types_of(items: &[syn::Item], module: &str, where_: &str, out: &mut Vec<TypeEntry>) {
    for item in items {
        let (vis, name) = match item {
            syn::Item::Struct(the) => (&the.vis, the.ident.to_string()),
            syn::Item::Enum(the) => (&the.vis, the.ident.to_string()),
            syn::Item::Trait(the) => (&the.vis, the.ident.to_string()),
            syn::Item::Type(the) => (&the.vis, the.ident.to_string()),
            // Un `pub mod` scritto dentro un file è superficie come gli altri:
            // se ci nascesse un tipo, non deve poterci restare nascosto.
            syn::Item::Mod(m) => {
                if let (true, Some((_, inside))) = (is_pub(&m.vis), m.content.as_ref()) {
                    let down = format!("{where_}::{}", m.ident);
                    types_of(inside, module, &down, out);
                }
                continue;
            }
            _ => continue,
        };
        if is_pub(vis) {
            out.push(TypeEntry {
                module: module.to_string(),
                path: where_.to_string(),
                name,
            });
        }
    }
}

/// Ogni `.rs` sotto `src/`, in ordine deterministico.
fn sources(dir: &Path, out: &mut Vec<PathBuf>) {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .unwrap_or_else(|and| panic!("{} unreadable: {and}", dir.display()))
        .map(|and| and.expect("directory entry").path())
        .collect();
    entries.sort();
    for v in entries {
        if v.is_dir() {
            sources(&v, out);
        } else if v.extension().is_some_and(|and| and == "rs") {
            out.push(v);
        }
    }
}

/// Tutti i tipi pubblici del crate, letti dai sorgenti.
fn declared_types() -> Vec<TypeEntry> {
    let root = src_dir();
    let mut files = Vec::new();
    sources(&root, &mut files);
    assert!(
        files.len() > 20,
        "only {} sources found under src/: the walker is not walking",
        files.len()
    );

    let mut out = Vec::new();
    for f in files {
        let rel = f.strip_prefix(&root).expect("inside src/");
        let mut segments: Vec<String> = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect();
        // `foo/mod.rs` è il modulo `foo`; `foo/bar.rs` è `foo::bar`.
        let last = segments.pop().expect("at least one segment");
        let base = last.trim_end_matches(".rs").to_string();
        if base == "lib" && segments.is_empty() {
            continue; // la radice non dichiara tipi: li raccoglie
        }
        if base != "mod" {
            segments.push(base);
        }
        let Some(module) = segments.first().cloned() else {
            continue;
        };
        let where_ = segments.join("::");
        types_of(&parse(&f).items, &module, &where_, &mut out);
    }
    out
}

/// I nomi riesportati da `lib.rs`, per modulo di primo livello.
///
/// Rifiuta le forme che questo lettore non sa giudicare — un `pub use
/// traits::*` per esempio, che è l'altro estremo del difetto: riesporta tutto
/// e rinuncia a dire cosa è superficie.
fn reexported() -> BTreeMap<String, BTreeSet<String>> {
    let lib = src_dir().join("lib.rs");
    let mut out: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for item in parse(&lib).items {
        let syn::Item::Use(u) = item else { continue };
        if !is_pub(&u.vis) {
            continue;
        }
        let syn::UseTree::Path(p) = &u.tree else {
            panic!("`pub use` of lib.rs in an unexpected form: expected `pub use <module>::…`");
        };
        let module = p.ident.to_string();
        let entry = out.entry(module.clone()).or_default();
        match &*p.tree {
            syn::UseTree::Name(n) => {
                entry.insert(n.ident.to_string());
            }
            syn::UseTree::Group(g) => {
                for t in &g.items {
                    match t {
                        syn::UseTree::Name(n) => {
                            entry.insert(n.ident.to_string());
                        }
                        _ => panic!(
                            "`pub use {module}::{{…}}` contains a form this test cannot \
                             judge (glob, alias, or nested path): the root surface is \
                             declared name by name"
                        ),
                    }
                }
            }
            _ => panic!(
                "`pub use {module}::…` is neither a name nor a group of names: a `*` \
                 re-exports everything and gives up saying what is surface"
            ),
        }
    }
    out
}

#[test]
fn every_public_type_is_visible_from_the_root() {
    let qualified: BTreeSet<&str> = QUALIFIED_MODULES.iter().map(|(m, _)| *m).collect();
    let root = reexported();

    let mut missing: Vec<String> = Vec::new();
    for t in declared_types() {
        if qualified.contains(t.module.as_str()) {
            continue;
        }
        let has_it = root
            .get(&t.module)
            .is_some_and(|n| n.contains(t.name.as_str()));
        if !has_it {
            missing.push(format!("{}::{}", t.path, t.name));
        }
    }
    missing.sort();

    assert!(
        missing.is_empty(),
        "{} public types of the contract are not visible from `fub_abi::`:\n  {}\n\n\
         Anyone using them must write the long path, which goes through the module \
         where they were declared — an implementation module, which can break. \
         Add them to the `pub use` block in src/lib.rs; if their module really is \
         used qualified, the place to say so is QUALIFIED_MODULES, with the reason.",
        missing.len(),
        missing.join("\n  ")
    );
}

#[test]
fn a_qualified_module_is_qualified_throughout_and_with_reason() {
    let modules: BTreeSet<String> = declared_types().into_iter().map(|t| t.module).collect();
    let root = reexported();

    for (name, reason) in QUALIFIED_MODULES {
        assert!(
            modules.contains(*name),
            "`{name}` is declared a qualified module but under src/ there is no \
             module by that name declaring types: an exception to a defect that \
             no longer exists is a memory, not a guard"
        );
        assert!(
            reason.len() > 80,
            "`{name}` is in the qualified modules list with a reason of {} characters: \
             the reason is the only thing that distinguishes this list from a discount",
            reason.len()
        );
        assert!(
            !root.contains_key(*name),
            "`{name}` is declared a qualified module — i.e. \"used with the name in \
             front\" — and at the same time is re-exported from the root: these are \
             two statements that together mean nothing. Remove the `pub use {name}::…` \
             or remove `{name}` from QUALIFIED_MODULES."
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
fn the_walker_descends() {
    let types = declared_types();
    let look_for = |where_: &str, name: &str| {
        assert!(
            types.iter().any(|t| t.path == where_ && t.name == name),
            "`{where_}::{name}` was not seen by the walker"
        );
    };
    look_for("rules::ids", "Owner");
    look_for("traits", "JobId");
    look_for("model", "DocId");

    // E il conto complessivo non è ridicolo: un estrattore che tornasse tre
    // tipi passerebbe le tre righe qui sopra.
    assert!(
        types.len() > 150,
        "only {} public types found in the entire contract: the extractor is \
         looking at less than it thinks",
        types.len()
    );
}

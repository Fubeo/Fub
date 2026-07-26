//! Test di **proprietà**: l'aggiornamento incrementale del grafo deve produrre
//! esattamente ciò che produrrebbe un full-rebuild.
//!
//! Oracolo = [`LinkGraph::build`] su tutti i documenti presenti. Dopo *ogni*
//! operazione di una sequenza casuale (upsert/remove) confrontiamo l'osservabile
//! completo dei due grafi: risoluzione di ogni chiave, backlink e link uscenti
//! di ogni documento.
//!
//! Niente `proptest`: il kernel non ha dipendenze di test e questi casi si
//! generano con un PRNG deterministico di quattro righe. In compenso il seme è
//! stampato ad ogni fallimento, quindi ogni caso è riproducibile isolando il
//! seme (`cargo test -- --nocapture`).
//!
//! L'universo è volutamente piccolo e ostile: omonimi a profondità diverse,
//! alias che collidono con nomi di pagina, path che collidono a meno
//! dell'estensione (`nota.md` / `nota.txt`), link a documenti inesistenti.
//!
//! Ci sono **entrambe le specie di link** (decisione 0004), e non per completismo: un
//! link markdown è relativo alla cartella di chi lo scrive, quindi la stessa
//! stringa in due documenti è due chiavi diverse — ed è esattamente il genere di
//! cosa che un aggiornamento incrementale sbaglia e un full-rebuild no.

use std::collections::BTreeMap;

use fubmd_abi::model::{DocId, DocumentModel, Link, LinkTarget, Span};
use fubmd_kernel::LinkGraph;

/// I documenti che possono esistere nel vault sintetico.
const PATHS: &[&str] = &[
    "Nota.md",
    "sub/Nota.md",
    "sub/deep/Nota.md",
    "sub/nota.txt",
    "Altra.md",
    "sub/Altra.md",
    "people/Mario Rossi.md",
    "a.md",
    "sub/a.md",
];

/// Le chiavi che i wikilink possono usare (alcune non risolveranno mai).
const KEYS: &[&str] = &[
    "Nota",
    "nota",
    "sub/Nota",
    "sub/Nota.md",
    "sub/deep/Nota",
    "Altra",
    "sub/Altra",
    "Mario",
    "Mario Rossi",
    "people/Mario Rossi",
    "a",
    "sub/a",
    "Inesistente",
    "",
];

/// Le destinazioni che i link markdown possono usare. Sono relative a chi le
/// scrive: `Nota.md` dentro `sub/a.md` è `sub/Nota.md`, alla radice è un altro
/// documento — e `../` porta fuori dal vault da metà dei sorgenti.
const DESTS: &[&str] = &[
    "Nota.md",
    "Nota",
    "sub/Nota.md",
    "sub/nota.txt",
    "../Nota.md",
    "../../Altra.md",
    "./a.md",
    "/people/Mario Rossi.md",
    "deep/Nota.md",
    "Mario",
    "Nota.md#heading",
    "Nota%20B.md",
    "#solo-ancora",
    "",
];

/// Gli alias dichiarabili nel frontmatter: collidono di proposito fra loro e
/// con i nomi di pagina.
const ALIASES: &[&str] = &["Mario", "Nota", "Altra", "alias-solo", "a"];

// --- PRNG deterministico (xorshift64*) --------------------------------------

struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Rng(seed | 1)
    }

    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

// --- generazione ------------------------------------------------------------

#[derive(Debug, Clone)]
enum Op {
    Upsert {
        path: &'static str,
        links: Vec<&'static str>,
        dests: Vec<&'static str>,
        aliases: Vec<&'static str>,
    },
    Remove {
        path: &'static str,
    },
}

fn gen_op(rng: &mut Rng) -> Op {
    let path = PATHS[rng.below(PATHS.len())];
    // ~1 su 4 è una cancellazione: abbastanza da svuotare e ripopolare il vault
    // più volte in una sequenza lunga.
    if rng.below(4) == 0 {
        return Op::Remove { path };
    }
    let links = (0..rng.below(4))
        .map(|_| KEYS[rng.below(KEYS.len())])
        .collect();
    let dests = (0..rng.below(4))
        .map(|_| DESTS[rng.below(DESTS.len())])
        .collect();
    let aliases = (0..rng.below(3))
        .map(|_| ALIASES[rng.below(ALIASES.len())])
        .collect();
    Op::Upsert {
        path,
        links,
        dests,
        aliases,
    }
}

fn model(path: &str, links: &[&str], dests: &[&str], aliases: &[&str]) -> DocumentModel {
    let mut m = DocumentModel::empty(DocId::new(path));
    // I due tipi di link si alternano nell'ordine in cui li teniamo qui: è
    // l'ordine che finisce in `outgoing` e nei backlink, quindi va fissato.
    let wiki = links.iter().map(|k| (LinkTarget::wiki(*k), *k));
    let markdown = dests
        .iter()
        .map(|d| (LinkTarget::Path((*d).to_string()), *d));
    m.links = wiki
        .chain(markdown)
        .enumerate()
        .map(|(i, (target, written))| Link {
            target,
            embed: false,
            span: Span::new(i, i + 1),
            // il contesto entra nel BacklinkRef: distinguerlo per posizione
            // rende visibile anche un ordinamento sbagliato dei backlink.
            context: Some(format!("{path}#{i} → {written}")),
        })
        .collect();
    if !aliases.is_empty() {
        m.frontmatter
            .0
            .insert("aliases".into(), serde_json::json!(aliases));
    }
    m
}

// --- osservabile ------------------------------------------------------------

/// Tutto ciò che il resto del kernel può leggere dal grafo. Se due grafi hanno
/// lo stesso `Observed`, sono indistinguibili per l'applicazione.
#[derive(Debug, PartialEq)]
struct Observed {
    resolved: BTreeMap<String, Option<DocId>>,
    /// `"<sorgente> → <destinazione>"` → documento, per i link markdown.
    resolved_from: BTreeMap<String, Option<DocId>>,
    backlinks: BTreeMap<DocId, Vec<(DocId, Option<String>)>>,
    outgoing: BTreeMap<DocId, Vec<DocId>>,
}

fn observe(graph: &LinkGraph) -> Observed {
    let mut resolved = BTreeMap::new();
    for key in KEYS {
        resolved.insert((*key).to_string(), graph.resolve_wiki(key));
    }
    // Le chiavi da sole non bastano: anche i nomi/alias/path dei documenti
    // devono risolvere allo stesso modo nei due grafi.
    for path in PATHS {
        let id = DocId::new(*path);
        resolved.insert(
            id.page_name().to_string(),
            graph.resolve_wiki(id.page_name()),
        );
        resolved.insert((*path).to_string(), graph.resolve_wiki(path));
    }
    for alias in ALIASES {
        resolved.insert((*alias).to_string(), graph.resolve_wiki(alias));
    }
    // I link markdown si risolvono *da qualche parte*: la stessa destinazione
    // vista da due sorgenti è due domande diverse, e vanno fatte entrambe.
    let mut resolved_from = BTreeMap::new();
    for source in PATHS {
        let id = DocId::new(*source);
        for dest in DESTS {
            resolved_from.insert(format!("{source} → {dest}"), graph.resolve_path(&id, dest));
        }
    }

    let mut backlinks = BTreeMap::new();
    let mut outgoing = BTreeMap::new();
    for path in PATHS {
        let id = DocId::new(*path);
        let refs: Vec<(DocId, Option<String>)> = graph
            .backlinks(&id)
            .into_iter()
            .map(|r| (r.source, r.context))
            .collect();
        if !refs.is_empty() {
            backlinks.insert(id.clone(), refs);
        }
        let out = graph.outgoing(&id);
        if !out.is_empty() {
            outgoing.insert(id, out);
        }
    }

    Observed {
        resolved,
        resolved_from,
        backlinks,
        outgoing,
    }
}

// --- proprietà --------------------------------------------------------------

/// Esegue una sequenza di operazioni su un grafo incrementale e, in parallelo,
/// su uno stato di riferimento ricostruito da zero ad ogni passo.
fn run_sequence(seed: u64, ops: usize) {
    let mut rng = Rng::new(seed);
    let mut state: BTreeMap<DocId, DocumentModel> = BTreeMap::new();
    let mut graph = LinkGraph::default();
    let mut log: Vec<Op> = Vec::new();

    for step in 0..ops {
        let op = gen_op(&mut rng);
        log.push(op.clone());
        match &op {
            Op::Upsert {
                path,
                links,
                dests,
                aliases,
            } => {
                let m = model(path, links, dests, aliases);
                graph.upsert(&m);
                state.insert(m.id.clone(), m);
            }
            Op::Remove { path } => {
                let id = DocId::new(*path);
                graph.remove(&id);
                state.remove(&id);
            }
        }

        let rebuilt = LinkGraph::build(state.values());
        let (got, want) = (observe(&graph), observe(&rebuilt));
        assert_eq!(
            got, want,
            "divergenza incrementale/rebuild al passo {step} (seme {seed})\n\
             sequenza: {log:#?}"
        );
        assert_eq!(
            graph.documents(),
            state.keys().cloned().collect::<Vec<_>>(),
            "documenti disallineati al passo {step} (seme {seed})"
        );
    }
}

#[test]
fn incremental_matches_rebuild_on_random_sequences() {
    for seed in 1..=200u64 {
        run_sequence(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15), 60);
    }
}

#[test]
fn incremental_matches_rebuild_on_a_long_sequence() {
    run_sequence(0xFB_1D_u64, 2_000);
}

/// Costruire per upsert successivi dal vuoto == costruire in blocco.
#[test]
fn upserts_from_empty_match_build() {
    let mut rng = Rng::new(424_242);
    for _ in 0..50 {
        let mut docs = Vec::new();
        for _ in 0..PATHS.len() {
            let path = PATHS[rng.below(PATHS.len())];
            if docs.iter().any(|d: &DocumentModel| d.id.as_str() == path) {
                continue;
            }
            let links: Vec<&str> = (0..rng.below(4))
                .map(|_| KEYS[rng.below(KEYS.len())])
                .collect();
            let dests: Vec<&str> = (0..rng.below(4))
                .map(|_| DESTS[rng.below(DESTS.len())])
                .collect();
            let aliases: Vec<&str> = (0..rng.below(3))
                .map(|_| ALIASES[rng.below(ALIASES.len())])
                .collect();
            docs.push(model(path, &links, &dests, &aliases));
        }

        let mut incremental = LinkGraph::default();
        for doc in &docs {
            incremental.upsert(doc);
        }
        assert_eq!(
            observe(&incremental),
            observe(&LinkGraph::build(docs.iter()))
        );
    }
}

/// Misura grezza del guadagno su un vault sintetico grande. Non è un criterio
/// di accettazione (niente soglie in CI): serve a sapere l'ordine di grandezza.
/// `cargo test -p fubmd-kernel --release -- --ignored --nocapture`
#[test]
#[ignore = "micro-bench: si esegue a mano, in release"]
fn incremental_is_cheaper_than_rebuild() {
    use std::time::Instant;

    const DOCS: usize = 5_000;
    const EDITS: usize = 200;

    let mut rng = Rng::new(99);
    let docs: Vec<DocumentModel> = (0..DOCS)
        .map(|i| {
            let path = format!("dir{}/nota-{i}.md", i % 50);
            let links: Vec<String> = (0..5)
                .map(|_| format!("nota-{}", rng.below(DOCS)))
                .collect();
            let refs: Vec<&str> = links.iter().map(String::as_str).collect();
            let mut m = DocumentModel::empty(DocId::new(path));
            m.links = refs
                .iter()
                .map(|k| Link {
                    target: LinkTarget::wiki(*k),
                    embed: false,
                    span: Span::EMPTY,
                    context: None,
                })
                .collect();
            m
        })
        .collect();

    let mut graph = LinkGraph::build(docs.iter());
    let start = Instant::now();
    for i in 0..EDITS {
        graph.upsert(&docs[rng.below(DOCS)]);
        std::hint::black_box(i);
    }
    let incremental = start.elapsed();

    let start = Instant::now();
    for _ in 0..EDITS {
        std::hint::black_box(LinkGraph::build(docs.iter()));
    }
    let rebuild = start.elapsed();

    println!(
        "{DOCS} documenti, {EDITS} modifiche — incrementale {incremental:?}, rebuild {rebuild:?} \
         ({:.0}×)",
        rebuild.as_secs_f64() / incremental.as_secs_f64().max(f64::EPSILON)
    );
}

/// Svuotare il vault documento per documento lascia un grafo vuoto, non un
/// grafo pieno di residui.
#[test]
fn removing_everything_empties_the_graph() {
    let mut rng = Rng::new(7);
    let docs: Vec<DocumentModel> = PATHS
        .iter()
        .map(|p| {
            let links: Vec<&str> = (0..3).map(|_| KEYS[rng.below(KEYS.len())]).collect();
            let dests: Vec<&str> = (0..3).map(|_| DESTS[rng.below(DESTS.len())]).collect();
            model(p, &links, &dests, &["Mario"])
        })
        .collect();

    let mut graph = LinkGraph::build(docs.iter());
    for doc in &docs {
        graph.remove(&doc.id);
    }

    assert_eq!(observe(&graph), observe(&LinkGraph::default()));
    assert!(graph.documents().is_empty());
}

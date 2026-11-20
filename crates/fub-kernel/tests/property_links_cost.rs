//! **Quanto costa chiedere chi nomina una nota in una proprietà** (#503,
//! #479): deve crescere coi link che arrivano a quella nota, non col vault.
//!
//! La domanda la serve [`LinkGraph::property_linked`] dagli archi inversi che
//! il grafo tiene per i link delle proprietà. Una risposta calcolata
//! scorrendo il frontmatter di tutte le note — com'era prima «Collegata da»,
//! e com'era la rinomina che chiedeva le proprietà di tutto il vault —
//! allocherebbe per ogni nota letta. Qui lo stesso bersaglio, con gli stessi
//! tre link entranti, si chiede in un vault piccolo e in uno cento volte più
//! grande: allocazioni e byte devono essere gli stessi.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use fub_abi::model::{DocId, DocumentModel, Frontmatter};
use fub_kernel::LinkGraph;

thread_local! {
    /// Allocazioni e byte di **questo** thread: i test girano in parallelo.
    static ALLOC: Cell<(u64, u64)> = const { Cell::new((0, 0)) };
}

struct Counter;

unsafe impl GlobalAlloc for Counter {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let _ = ALLOC.try_with(|c| {
            let (n, b) = c.get();
            c.set((n + 1, b + layout.size() as u64))
        });
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOCATOR: Counter = Counter;

fn cost_of<T>(f: impl FnOnce() -> T) -> ((u64, u64), T) {
    let (n0, b0) = ALLOC.with(Cell::get);
    let out = f();
    let (n1, b1) = ALLOC.with(Cell::get);
    ((n1 - n0, b1 - b0), out)
}

fn note(path: &str, frontmatter: serde_json::Value) -> DocumentModel {
    let mut doc = DocumentModel::empty(DocId::new(path));
    doc.frontmatter = Frontmatter(frontmatter.as_object().unwrap().clone());
    doc
}

/// Un vault con il bersaglio, tre note che lo nominano in una proprietà e
/// `decoys` note che si nominano fra loro, anche loro nelle proprietà.
fn vault(decoys: usize) -> LinkGraph {
    let mut docs = vec![
        note("Progetti/Scorte.md", serde_json::json!({})),
        note(
            "Riunioni/a.md",
            serde_json::json!({"progetto": "[[Scorte]]"}),
        ),
        note(
            "Riunioni/b.md",
            serde_json::json!({"progetto": "[[Progetti/Scorte]]"}),
        ),
        note(
            "Riunioni/c.md",
            serde_json::json!({"rif": ["[[Altro]]", "[[Scorte|lo scorte]]"]}),
        ),
    ];
    for the in 0..decoys {
        docs.push(note(
            &format!("Esche/{the:05}.md"),
            serde_json::json!({
                "progetto": format!("[[{:05}]]", (the + 1) % decoys),
                "nota": "vedi [[Scorte]]"
            }),
        ));
    }
    LinkGraph::build(docs.iter())
}

#[test]
fn asking_who_names_a_note_costs_its_links_not_the_vault() {
    let target = [DocId::new("Progetti/Scorte.md")];
    let small = vault(50);
    let large = vault(5_000);
    // Un giro a vuoto per le inizializzazioni pigre.
    let _ = small.property_linked(&target, None);
    let _ = large.property_linked(&target, None);

    let (small_cost, small_found) = cost_of(|| small.property_linked(&target, None));
    let (large_cost, large_found) = cost_of(|| large.property_linked(&target, None));

    let expected: Vec<&str> = vec!["Riunioni/a.md", "Riunioni/b.md", "Riunioni/c.md"];
    let names = |found: &std::collections::BTreeSet<DocId>| {
        found
            .iter()
            .map(|d| d.as_str().to_string())
            .collect::<Vec<_>>()
    };
    assert_eq!(names(&small_found), expected);
    assert_eq!(names(&large_found), expected);
    assert_eq!(
        small_cost, large_cost,
        "chi nomina la nota costa (allocazioni, byte) {small_cost:?} su 54 note e \
         {large_cost:?} su 5004: la domanda ha cominciato a scorrere il vault"
    );
}

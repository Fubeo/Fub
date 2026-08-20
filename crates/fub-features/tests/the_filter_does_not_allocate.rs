//! **Il banco del filtro dei tag**: conta le allocazioni, non i millisecondi
//! (§17.1, [decisione 0113](../../../docs/decisions/0113-il-banco-conta-le-operazioni.md)).
//!
//! Il pannello tag ridisegna a **ogni battuta** nel campo filtro, e ridisegnarlo
//! vuol dire ripassare tutti i tag del vault. La riga che c'era —
//! `t.name.to_lowercase().contains(&cerca)` — costruiva una `String` nuova per
//! ogni tag e la buttava via subito dopo: su cinquecento tag sono cinquecento
//! allocazioni per tasto premuto, e crescono col vault.
//!
//! # Perché si misura una differenza e non un numero
//!
//! Il numero assoluto di allocazioni di `build_tags_view` non vuol dire niente e
//! non va asserito: dipende da quante voci finiscono nell'albero, dalle `String`
//! dei titoli, da `serde_json`. Quello che vuol dire tutto è **quanto quel
//! numero cresce quando il vault raddoppia a parità di albero prodotto**, che è
//! la forma di un rapporto e non di una soglia.
//!
//! Il trucco per tenere l'albero identico è filtrare con un ago che **non trova
//! niente**: cinquecento tag e mille tag danno lo stesso identico albero (il
//! campo più lo stato vuoto), quindi tutto ciò che li separa è il lavoro del
//! filtro. Prima: la differenza era ~500, cioè una `String` per tag in più.
//! Adesso: zero.
//!
//! # La zona cieca, dichiarata
//!
//! La corsia senza allocazioni vale sui nomi **ASCII**. Un tag accentato passa
//! ancora da `to_lowercase()`, e deve: `str::to_lowercase` è sensibile al
//! contesto (`ΟΔΟΣ` → `οδος`, con il sigma finale) e un confronto carattere per
//! carattere sarebbe il difetto 0070 riscritto qui. Il secondo test misura
//! quella corsia e **fissa che è ancora una allocazione per tag**: se un giorno
//! qualcuno la fa sparire, deve passare di qui e spiegare come.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use fub_abi::traits::TagCount;
use fub_features::tags::build_tags_view;

thread_local! {
    /// Le allocazioni fatte **da questo thread**: `cargo test` gira in
    /// parallelo, e un contatore condiviso misurerebbe il vicino di banco.
    static ALLOCATIONS: Cell<u64> = const { Cell::new(0) };
}

/// Passa tutto a `System` e conta le chiamate. Il `const { Cell::new(0) }` non è
/// un vezzo: una TLS con inizializzazione pigra allocherebbe al primo accesso, e
/// allocare dentro `alloc` è una ricorsione. Il `try_with` copre l'unico caso
/// che resta, un thread che sta morendo con le TLS già smontate.
struct Counter;

unsafe impl GlobalAlloc for Counter {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let _ = ALLOCATIONS.try_with(|c| c.set(c.get() + 1));
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOCATOR: Counter = Counter;

/// Quante allocazioni costa `f`.
fn allocations_of<T>(f: impl FnOnce() -> T) -> u64 {
    let before = ALLOCATIONS.with(Cell::get);
    let _ = f();
    ALLOCATIONS.with(Cell::get) - before
}

fn tags(count: usize, form: fn(usize) -> String) -> Vec<TagCount> {
    (0..count)
        .map(|the| TagCount {
            name: form(the),
            count: the as u32,
        })
        .collect()
}

/// Un ago che non compare in nessun nome: l'albero prodotto è lo stesso per
/// qualunque taglia del vault, quindi la differenza è tutta del filtro.
const NONE: &str = "zqxjk";

/// **Il presidio della 0051.** Filtrare mille tag ASCII non alloca più che
/// filtrarne cinquecento.
///
/// *Provato in rosso* sul codice vecchio (`t.name.to_lowercase().contains(..)`):
/// la differenza veniva 500, cioè esattamente una `String` per tag in più.
#[test]
fn a_keystroke__does_not_allocates__for_tag() {
    let small = tags(500, |the| format!("progetto/Rust-{the}"));
    let large = tags(1000, |the| format!("progetto/Rust-{the}"));

    // Un giro a vuoto: la prima chiamata paga le inizializzazioni pigre.
    let _ = build_tags_view(&small, NONE);
    let _ = build_tags_view(&large, NONE);

    let a = allocations_of(|| build_tags_view(&small, NONE));
    let b = allocations_of(|| build_tags_view(&large, NONE));

    assert_eq!(
        tree_entries(&build_tags_view(&small, NONE)),
        tree_entries(&build_tags_view(&large, NONE)),
        "il presidio regge solo se i due alberi sono lo stesso: nessun tag trovato, di qua e di là"
    );
    assert!(
        b <= a + 8,
        "cinquecento tag in più sono costati {} allocazioni in più ({a} → {b}): \
         il filtro sta di nuovo costruendo una String per tag",
        b as i64 - a as i64
    );
}

/// La corsia fuori dall'ASCII, **misurata e dichiarata**: lì la `String` per tag
/// c'è ancora, ed è il prezzo della risposta giusta sul sigma finale. Questo
/// test non chiede di ripararla — fissa che il costo è quello che crediamo, così
/// chi un giorno lo cambia (in meglio o in peggio) se ne accorge qui.
#[test]
fn outside_from_ascii_is_pays__still__a_string__for_tag() {
    let small = tags(500, |the| format!("progetto/Città-{the}"));
    let large = tags(1000, |the| format!("progetto/Città-{the}"));

    let _ = build_tags_view(&small, NONE);
    let _ = build_tags_view(&large, NONE);

    let a = allocations_of(|| build_tags_view(&small, NONE));
    let b = allocations_of(|| build_tags_view(&large, NONE));

    let difference = b as i64 - a as i64;
    assert!(
        (400..=600).contains(&difference),
        "attese ~500 allocazioni in più (una `to_lowercase()` per tag non ASCII), \
         trovate {difference} ({a} → {b})"
    );
}

/// I titoli delle voci dell'albero, in ordine.
fn tree_entries(node: &fub_abi::ui::UiNode) -> Vec<String> {
    use fub_abi::ui::UiKind;
    let mut out = Vec::new();
    fn walk(node: &fub_abi::ui::UiNode, out: &mut Vec<String>) {
        match &node.kind {
            UiKind::ListItem { title, .. } => out.push(title.to_string()),
            UiKind::Stack { children, .. } => children.iter().for_each(|c| walk(c, out)),
            UiKind::List { items } => items.iter().for_each(|c| walk(c, out)),
            _ => {}
        }
    }
    walk(node, &mut out);
    out
}

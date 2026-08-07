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
    static ALLOCAZIONI: Cell<u64> = const { Cell::new(0) };
}

/// Passa tutto a `System` e conta le chiamate. Il `const { Cell::new(0) }` non è
/// un vezzo: una TLS con inizializzazione pigra allocherebbe al primo accesso, e
/// allocare dentro `alloc` è una ricorsione. Il `try_with` copre l'unico caso
/// che resta, un thread che sta morendo con le TLS già smontate.
struct Contatore;

unsafe impl GlobalAlloc for Contatore {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let _ = ALLOCAZIONI.try_with(|c| c.set(c.get() + 1));
        System.alloc(layout)
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOCATORE: Contatore = Contatore;

/// Quante allocazioni costa `f`.
fn allocazioni_di<T>(f: impl FnOnce() -> T) -> u64 {
    let prima = ALLOCAZIONI.with(Cell::get);
    let _ = f();
    ALLOCAZIONI.with(Cell::get) - prima
}

fn tags(quanti: usize, forma: fn(usize) -> String) -> Vec<TagCount> {
    (0..quanti)
        .map(|i| TagCount {
            name: forma(i),
            count: i as u32,
        })
        .collect()
}

/// Un ago che non compare in nessun nome: l'albero prodotto è lo stesso per
/// qualunque taglia del vault, quindi la differenza è tutta del filtro.
const NESSUNO: &str = "zqxjk";

/// **Il presidio della 0051.** Filtrare mille tag ASCII non alloca più che
/// filtrarne cinquecento.
///
/// *Provato in rosso* sul codice vecchio (`t.name.to_lowercase().contains(..)`):
/// la differenza veniva 500, cioè esattamente una `String` per tag in più.
#[test]
fn una_battuta_non_alloca_per_tag() {
    let piccolo = tags(500, |i| format!("progetto/Rust-{i}"));
    let grande = tags(1000, |i| format!("progetto/Rust-{i}"));

    // Un giro a vuoto: la prima chiamata paga le inizializzazioni pigre.
    let _ = build_tags_view(&piccolo, NESSUNO);
    let _ = build_tags_view(&grande, NESSUNO);

    let a = allocazioni_di(|| build_tags_view(&piccolo, NESSUNO));
    let b = allocazioni_di(|| build_tags_view(&grande, NESSUNO));

    assert_eq!(
        voci_dell_albero(&build_tags_view(&piccolo, NESSUNO)),
        voci_dell_albero(&build_tags_view(&grande, NESSUNO)),
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
fn fuori_dallascii_si_paga_ancora_una_stringa_per_tag() {
    let piccolo = tags(500, |i| format!("progetto/Città-{i}"));
    let grande = tags(1000, |i| format!("progetto/Città-{i}"));

    let _ = build_tags_view(&piccolo, NESSUNO);
    let _ = build_tags_view(&grande, NESSUNO);

    let a = allocazioni_di(|| build_tags_view(&piccolo, NESSUNO));
    let b = allocazioni_di(|| build_tags_view(&grande, NESSUNO));

    let differenza = b as i64 - a as i64;
    assert!(
        (400..=600).contains(&differenza),
        "attese ~500 allocazioni in più (una `to_lowercase()` per tag non ASCII), \
         trovate {differenza} ({a} → {b})"
    );
}

/// I titoli delle voci dell'albero, in ordine.
fn voci_dell_albero(node: &fub_abi::ui::UiNode) -> Vec<String> {
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

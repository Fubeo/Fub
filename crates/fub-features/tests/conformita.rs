// Le view sono un sottoinsieme dell'inventario, e questo banco ha senso se ce
// n'è almeno una: il conto in coda — «zero implementazioni non è una suite» —
// resta la sua ragione d'essere, e senza questo `cfg` diventerebbe rosso in una
// build che non ha nessun pannello, che è una build legittima (§16.3).
#![cfg(any(
    feature = "backlinks",
    feature = "outline",
    feature = "tags",
    feature = "stats"
))]
//! Le feature ufficiali passano la **suite di conformità** dell'SDK.
//!
//! È il primo cliente vero di `fub_sdk::testing::conformita` ([decisione
//! 0054](../../../docs/decisions/0054-il-banco-del-lato-provider.md)), e serve a
//! due cose che non sono la stessa.
//!
//! La prima è ovvia: le view ufficiali rispettano il contratto che dichiarano.
//!
//! La seconda no, ed è la ragione per cui questo file sta qui invece che fra i
//! test del kernel: **le feature ufficiali sono il dogfooding del contratto**, e
//! una suite di conformità che nessuna implementazione vera passa non è una
//! suite, è un'opinione. Se una di queste asserzioni è troppo stretta, lo si
//! scopre qui — su codice che il progetto controlla — invece che addosso al
//! primo plugin di terzi, che non ha modo di distinguere «ho sbagliato io» da
//! «la suite pretende troppo».
//!
//! # Su quali view, e come lo sa
//!
//! Le quattro view erano elencate a mano qui dentro, come in
//! `view_refresh_masks.rs`: una suite di conformità che copre le implementazioni
//! che qualcuno si è ricordato di scriverci dentro è esattamente il difetto che
//! il
//! [§16.7](../../../docs/roadmap/16-crate-sdk-banchi-di-prova.md#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione)
//! accusa — e qui morde due volte, perché una view non provata non è solo una
//! view non presidiata: è **un dogfooding in meno**, cioè una prova in meno che
//! le asserzioni della suite siano giuste.
//!
//! Adesso l'elenco viene da [`fub_features::ogni_view_ufficiale`], che è la
//! stessa fetta da cui `fub_host::mount` registra i pannelli. Una view che
//! esiste nell'app passa di qui; una che non passa di qui non esiste nell'app, e
//! `fub-host/tests/le_view_ufficiali.rs` è ciò che tiene vera la seconda metà.

use fub_abi::traits::ViewProvider;
use fub_sdk::testing::{conformita, MemoryHost};

/// Ogni view ufficiale, costruita quando tocca a lei: la conformità è una
/// proprietà del singolo provider, e un `Vec` preparato prima terrebbe in vita
/// tutti i pannelli mentre se ne prova uno.
///
/// Il conto in coda non è una cerimonia: una suite che gira su zero
/// implementazioni non è una suite, è un test che passa — ed è lo stato in cui
/// questo file finirebbe se un giorno l'inventario cambiasse forma sotto di lui.
fn per_ogni_view(mut prova: impl FnMut(&dyn ViewProvider)) {
    let mut viste = 0;
    for f in fub_features::ogni_view_ufficiale() {
        prova((f.view.expect("è una riga con view"))().as_ref());
        viste += 1;
    }
    assert!(viste > 0, "l'inventario non ha nessuna view");
}

#[test]
fn le_view_ufficiali_rispettano_il_contratto() {
    let host = MemoryHost::new();

    per_ogni_view(|provider| {
        conformita::una_view_rispetta_il_contratto(provider, &host);
    });
}

#[test]
fn le_view_ufficiali_si_disegnano_anche_con_un_documento_aperto() {
    // A host vuoto ogni view cade nel proprio segnaposto, che è il ramo più
    // corto: la conformità va provata anche sul ramo che disegna qualcosa.
    let host = MemoryHost::new()
        .con_documento("nota.md", "# Titolo\n\nun corpo con #tag e [[Altra]].\n")
        .con_backlink("nota.md", &["Altra.md"])
        .con_tags(&[("tag", 1)]);
    host.set_active(Some("nota.md"));

    per_ogni_view(|provider| {
        conformita::una_view_rispetta_il_contratto(provider, &host);
    });
}

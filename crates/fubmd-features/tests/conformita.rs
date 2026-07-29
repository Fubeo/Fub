//! Le feature ufficiali passano la **suite di conformità** dell'SDK.
//!
//! È il primo cliente vero di `fubmd_sdk::testing::conformita` ([decisione
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
//! # Cosa questo file non fa
//!
//! Non itera su un inventario: le quattro view sono elencate a mano, come in
//! `view_refresh_masks.rs`. È esattamente il difetto che il
//! [§16.7](../../../docs/roadmap/16-crate-sdk-banchi-di-prova.md#167-due-presidi-sono-esaustivi-a-memoria-non-per-costruzione)
//! accusa, e resta aperto di proposito: l'inventario è la sua voce, non questa.

use fubmd_features::{BacklinksView, OutlineView, StatsView, TagPanelView};
use fubmd_sdk::testing::{conformita, MemoryHost};

#[test]
fn le_view_ufficiali_rispettano_il_contratto() {
    let host = MemoryHost::new();

    conformita::una_view_rispetta_il_contratto(&BacklinksView, &host);
    conformita::una_view_rispetta_il_contratto(&OutlineView, &host);
    conformita::una_view_rispetta_il_contratto(&TagPanelView, &host);
    conformita::una_view_rispetta_il_contratto(&StatsView, &host);
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

    conformita::una_view_rispetta_il_contratto(&BacklinksView, &host);
    conformita::una_view_rispetta_il_contratto(&OutlineView, &host);
    conformita::una_view_rispetta_il_contratto(&TagPanelView, &host);
    conformita::una_view_rispetta_il_contratto(&StatsView, &host);
}

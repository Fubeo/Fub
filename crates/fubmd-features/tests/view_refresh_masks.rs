//! La regola del lotto (decisione 0011) sulle maschere `refresh`, resa **meccanica**.
//!
//! Il lotto è additivo dappertutto tranne in un punto: dentro di esso
//! `index-updated` non viene emesso, e al suo posto arriva `batch-ended`. Chi
//! aveva dichiarato solo il primo, dentro un lotto non riceve più niente — e il
//! sintomo è il peggiore possibile: un pannello che smette di aggiornarsi
//! *soltanto* dopo una rinomina con backlink o una sostituzione in blocco, cioè
//! proprio nei casi in cui il vault è cambiato di più.
//!
//! Una nota nella prosa del contratto non basta a fermarlo. Qui è una
//! condizione su ogni view ufficiale, e la stessa
//! [`EventMask::misses_batches`] che un plugin può chiamare sulla propria — non
//! una seconda idea della regola scritta in un test.

use fubmd_abi::traits::{ViewProvider, ViewSpec};
use fubmd_features::{BacklinksView, OutlineView, StatsView, TagPanelView};

fn ogni_view() -> Vec<ViewSpec> {
    let providers: Vec<Box<dyn ViewProvider>> = vec![
        Box::new(BacklinksView),
        Box::new(OutlineView),
        Box::new(TagPanelView::default()),
        Box::new(StatsView),
    ];
    providers.iter().flat_map(|p| p.views()).collect()
}

#[test]
fn a_view_that_follows_the_index_follows_batches_too() {
    let views = ogni_view();
    assert!(!views.is_empty(), "le view ufficiali");
    for spec in views {
        assert!(
            !spec.refresh.misses_batches(),
            "la view «{}» dichiara `index-updated` senza `batch-ended`: dentro \
             un lotto non si ridisegnerebbe più, e smetterebbe di farlo esattamente \
             dopo una rinomina con backlink o una sostituzione in blocco",
            spec.id
        );
    }
}

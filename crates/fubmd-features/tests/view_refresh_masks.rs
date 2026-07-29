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
//!
//! «Ogni view ufficiale» era la parte che non teneva: le quattro erano costruite
//! per nome qui dentro, quindi la quinta sarebbe entrata restando tutto verde —
//! una rete con un buco silenzioso davanti a un difetto silenzioso (§16.7).
//! Adesso l'elenco viene da [`fubmd_features::ogni_view_ufficiale`], che è la
//! stessa fetta da cui `fubmd_host::mount` le registra: se una view esiste
//! nell'app, questa condizione la guarda.

use fubmd_abi::traits::ViewSpec;

fn ogni_view() -> Vec<ViewSpec> {
    fubmd_features::ogni_view_ufficiale()
        .flat_map(|f| (f.view.expect("è una riga con view"))().views())
        .collect()
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

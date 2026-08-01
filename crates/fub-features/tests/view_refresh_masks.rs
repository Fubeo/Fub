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
//! Adesso l'elenco viene da [`fub_features::ogni_view_ufficiale`], che è la
//! stessa fetta da cui `fub_host::mount` le registra: se una view esiste
//! nell'app, questa condizione la guarda.

use fub_abi::traits::ViewInstance;

#[test]
fn a_view_that_follows_the_index_follows_batches_too() {
    let providers = fub_features::ogni_view_ufficiale()
        .filter_map(|f| f.view.map(|v| v()))
        .collect::<Vec<_>>();
    assert!(!providers.is_empty(), "le view ufficiali");
    for provider in providers {
        for spec in provider.views() {
            // L'esemplare unico: è quello di cui il kernel risolve la
            // maschera alla registrazione, cioè quello che la shell monta.
            let instance = ViewInstance::only(&spec.id);
            assert!(
                !provider.interests(&instance).refresh.misses_batches(),
                "la view «{}» dichiara `index-updated` senza `batch-ended`: dentro \
                 un lotto non si ridisegnerebbe più, e smetterebbe di farlo esattamente \
                 dopo una rinomina con backlink o una sostituzione in blocco",
                spec.id
            );
        }
    }
}

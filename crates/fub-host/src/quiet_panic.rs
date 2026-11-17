//! Un panico voluto che non sporca l'output, senza zittire gli altri (#98).
//!
//! Le prove che avvelenano una custodia fanno paniare un thread di proposito.
//! Prima mettevano un hook muto **globale** per la durata del misfatto: con
//! `cargo test` i test girano come thread dello stesso processo, e il panico
//! di un test concorrente caduto in quella finestra spariva, lasciando
//! `FAILED` senza il perché. Qui l'hook si installa una volta sola, tace solo
//! per i thread che portano il nome [`QUIET`] e passa tutto il resto all'hook
//! di prima.

use std::sync::Once;

/// Il nome del thread il cui panico non si stampa.
const QUIET: &str = "fub-panico-voluto";

/// Esegue `misdeed` in un thread suo, il cui panico non si stampa, e aspetta
/// che finisca. Il panico resta un panico: chi lo vuole provare guarda gli
/// effetti (una custodia avvelenata), non il messaggio.
pub(crate) fn quietly<F>(misdeed: F)
where
    F: FnOnce() + Send + 'static,
{
    install();
    let _ = std::thread::Builder::new()
        .name(QUIET.into())
        .spawn(misdeed)
        .expect("the misdeed thread starts")
        .join();
}

fn install() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if std::thread::current().name() != Some(QUIET) {
                previous(info);
            }
        }));
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_misdeed_panics_and_the_caller_goes_on() {
        let (tx, rx) = std::sync::mpsc::channel();
        quietly(move || {
            tx.send(std::thread::current().name().map(str::to_owned))
                .unwrap();
            panic!("di proposito");
        });
        assert_eq!(rx.recv().unwrap().as_deref(), Some(QUIET));
    }
}

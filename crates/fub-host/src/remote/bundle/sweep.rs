//! Il giro di verifica: quando un passaggio rilegge tutto il vault.
//!
//! Un passaggio decide se un file è cambiato confrontando l'impronta che
//! l'indice del workspace tiene per quel file con quella sincronizzata
//! (`cursor.json`, `synced`), senza aprirlo. L'indice la calcola per documenti
//! e allegati quando li legge, la lega a misura, data, timbro di cambio e
//! identità del file e la toglie quando uno di questi cambia: alla scansione
//! d'apertura, per i file cambiati ad app chiusa, e a ogni evento del watcher
//! ad app aperta.
//!
//! Un evento del watcher perso lascerebbe però un'impronta che non dice più
//! il vero finché l'app non si riapre. Per questo, in un processo che resta
//! aperto, un passaggio ogni [`SWEEP_EVERY_MS`] non si fida dell'indice e
//! rilegge ogni file, come faceva ogni passaggio prima. Il primo passaggio di
//! un processo non lo fa: l'indice l'ha appena ricontrollato la scansione
//! d'apertura.
//!
//! L'orario sta in memoria, per cartella di stato: niente file nuovi, e un
//! orologio che torna indietro vuol dire un giro subito, mai uno rimandato.

use super::*;
use std::sync::Mutex;

/// Ogni quanto, in un processo aperto, un passaggio rilegge tutto il vault.
pub(super) const SWEEP_EVERY_MS: u64 = 24 * 60 * 60 * 1000;

/// L'inizio dell'ultimo giro (o della prima scansione) per cartella di stato.
static LAST_SWEEP: Mutex<BTreeMap<PathBuf, u64>> = Mutex::new(BTreeMap::new());

/// Se il passaggio sulla cartella `root`, partito a `now`, deve rileggere
/// tutto. La prima volta per `root` no: segna `now` come ultimo controllo.
pub(super) fn due(root: &Path, now: u64) -> bool {
    let mut last = LAST_SWEEP
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    due_in(&mut last, root, now)
}

/// Il giro partito a `started` sulla cartella `root` è finito senza errori.
pub(super) fn done(root: &Path, started: u64) {
    let mut last = LAST_SWEEP
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    last.insert(root.to_path_buf(), started);
}

fn due_in(last: &mut BTreeMap<PathBuf, u64>, root: &Path, now: u64) -> bool {
    match last.get(root) {
        None => {
            last.insert(root.to_path_buf(), now);
            false
        }
        Some(&at) => now < at || now - at >= SWEEP_EVERY_MS,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_sweep_comes_back_once_a_day_and_not_on_the_first_pass() {
        let mut last = BTreeMap::new();
        let root = Path::new("/stato/a");
        assert!(
            !due_in(&mut last, root, 10_000),
            "the open scan just checked"
        );
        assert!(!due_in(&mut last, root, 10_000 + SWEEP_EVERY_MS - 1));
        assert!(due_in(&mut last, root, 10_000 + SWEEP_EVERY_MS));
        assert!(
            due_in(&mut last, root, 9_000),
            "a clock gone back sweeps now, it does not stretch the trust"
        );
        assert!(
            !due_in(&mut last, Path::new("/stato/b"), 10_000 + SWEEP_EVERY_MS),
            "each vault keeps its own clock"
        );
    }

    #[test]
    fn a_finished_sweep_restarts_the_clock() {
        let root = Path::new("/stato/sweep-test-unico");
        assert!(!due(root, 1_000));
        assert!(due(root, 1_000 + SWEEP_EVERY_MS));
        done(root, 1_000 + SWEEP_EVERY_MS);
        assert!(!due(root, 1_000 + SWEEP_EVERY_MS + 1));
    }
}

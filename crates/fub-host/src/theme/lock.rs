//! Il lucchetto per id di un tema installato, in questo processo: chi cambia
//! ciò che sta sotto `themes/<id>/` (l'installazione dal catalogo, la
//! revoca, l'aggiornamento, la disinstallazione, la sostituzione da cartella)
//! lo prende, così la lettura del puntatore e la scrittura che ne dipende non
//! si mescolano con quella di un altro.
//!
//! È l'ultimo lucchetto preso: chi lo tiene non ne chiede altri, e non lo
//! chiede di nuovo per lo stesso tema (non è rientrante).
//!
//! Vale dentro il processo di Fub, dove stanno sia il catalogo sia
//! l'installazione da cartella. Non è un lucchetto sul file system: un altro
//! processo che scrive in `themes/` non lo vede.

use super::*;

use std::collections::HashSet;
use std::sync::{Condvar, Mutex, OnceLock};

struct ThemeLocks {
    busy: Mutex<HashSet<Utf8PathBuf>>,
    freed: Condvar,
}

fn locks() -> &'static ThemeLocks {
    static LOCKS: OnceLock<ThemeLocks> = OnceLock::new();
    LOCKS.get_or_init(|| ThemeLocks {
        busy: Mutex::new(HashSet::new()),
        freed: Condvar::new(),
    })
}

/// Tiene il tema `id` finché vive; lo lascia quando cade.
pub(super) struct ThemeGuard {
    key: Utf8PathBuf,
}

/// Aspetta che nessun altro tenga `themes/<id>` e lo prende. La chiave è il
/// path della voce sotto la cartella dei temi di `config_dir`.
pub(super) fn lock_theme(config_dir: &Utf8Path, id: &str) -> ThemeGuard {
    let key = crate::config::themes_dir(config_dir).join(id);
    let locks = locks();
    let mut busy = locks
        .busy
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    while busy.contains(&key) {
        busy = locks
            .freed
            .wait(busy)
            .unwrap_or_else(std::sync::PoisonError::into_inner);
    }
    busy.insert(key.clone());
    ThemeGuard { key }
}

impl Drop for ThemeGuard {
    fn drop(&mut self) {
        let locks = locks();
        locks
            .busy
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&self.key);
        locks.freed.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un secondo che chiede lo stesso tema aspetta che il primo lo lasci; un
    /// altro id no.
    #[test]
    fn the_same_theme_waits_and_another_does_not() {
        let config = Utf8PathBuf::from("/config-lock-test");
        let held = lock_theme(&config, "acme.carta");
        let _other = lock_theme(&config, "acme.lino");
        let (sent, got) = std::sync::mpsc::channel();
        let waiting = std::thread::spawn({
            let config = config.clone();
            move || {
                let _guard = lock_theme(&config, "acme.carta");
                sent.send(()).unwrap();
            }
        });
        assert!(got
            .recv_timeout(std::time::Duration::from_millis(100))
            .is_err());
        drop(held);
        got.recv_timeout(std::time::Duration::from_secs(5)).unwrap();
        waiting.join().unwrap();
    }
}

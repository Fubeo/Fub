//! Lavori indipendenti insieme. Aprire un documento grande vuol dire leggerlo,
//! scriverlo e misurare due volte i byte (inventario e flusso del file e della
//! prova a vuoto): sono lavori che non si parlano, e su più core finiscono
//! nel tempo del più lungo.

use std::panic::resume_unwind;
use std::sync::Mutex;
use std::thread;

/// Quanto stack ha un thread di lavoro: quello del thread principale, perché
/// il codec e la misura scendono nell'albero del documento.
const STACK: usize = 8 * 1024 * 1024;

/// `a` e `b` insieme, `a` su un altro thread; senza un thread, uno dopo
/// l'altro. Un panic resta il panic di chi chiama.
pub(crate) fn join<A, B, RA, RB>(a: A, b: B) -> (RA, RB)
where
    A: FnOnce() -> RA + Send,
    B: FnOnce() -> RB,
    RA: Send,
{
    // Il lavoro passa per lo slot: se il thread non parte, lo fa chi chiama.
    let slot = Mutex::new(Some(a));
    thread::scope(|scope| {
        let spawned = thread::Builder::new()
            .name("fub-rich".into())
            .stack_size(STACK)
            .spawn_scoped(scope, || take(&slot).map(|a| a()));
        let rb = b();
        let ra = match spawned {
            Ok(handle) => handle.join().unwrap_or_else(|panic| resume_unwind(panic)),
            Err(_) => None,
        };
        let ra = match ra {
            Some(ra) => ra,
            None => match take(&slot) {
                Some(a) => a(),
                None => unreachable!("il lavoro è partito e non ha dato niente"),
            },
        };
        (ra, rb)
    })
}

fn take<A>(slot: &Mutex<Option<A>>) -> Option<A> {
    slot.lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn i_due_lavori_danno_i_loro_risultati() {
        let data = [1, 2, 3];
        let (a, b) = join(|| data.iter().sum::<i32>(), || data.len());
        assert_eq!((a, b), (6, 3));
    }

    #[test]
    fn un_panic_del_lavoro_resta_il_panic_di_chi_chiama() {
        let caught = std::panic::catch_unwind(|| join(|| panic!("nel lavoro"), || ()));
        let panic = caught.unwrap_err();
        assert_eq!(panic.downcast_ref::<&str>(), Some(&"nel lavoro"));
    }
}

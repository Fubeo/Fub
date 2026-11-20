//! I tipi degli appunti GTK quando nessuno li possiede.
//!
//! Quando la pagina legge gli appunti (i tipi di un `paste` nativo, cioè
//! Ctrl+V in qualsiasi campo, o `navigator.clipboard.read`) WebKitGTK li
//! chiede, nel processo dell'app, con `gtk_clipboard_request_targets`. Se
//! la richiesta fallisce (su X11 nessun programma possiede gli appunti:
//! una sessione appena aperta, o il programma che aveva copiato è stato
//! chiuso) GTK 3 chiama la risposta con i tipi `NULL` e il loro numero
//! **`-1`**. WebKitGTK 2.54 non controlla il segno: legge `-1` tipi da
//! `NULL` e il processo dell'app muore di SIGSEGV, con la finestra e senza
//! una riga nel log (IMP-149). Il processo web non c'entra.
//!
//! Qui l'eseguibile `fub` esporta un suo `gtk_clipboard_request_targets`
//! (`main.rs`, e il build script che lo mette nella tabella dinamica): il
//! linker dinamico lo trova prima di quello di GTK, e WebKit chiama questo.
//! Le regole:
//!
//! - chiama **sempre il vero** (`dlsym(RTLD_NEXT)`), con gli stessi
//!   appunti, e risponde con la risposta di chi ha chiesto, una volta sola,
//!   quando risponde GTK;
//! - dalla risposta cambia soltanto il numero dei tipi: quando GTK dice che
//!   non ce ne sono (tipi `NULL` o numero negativo) il numero è 0, cioè
//!   «appunti vuoti», che ogni chiamante sa trattare. I tipi, quando ci sono,
//!   passano com'erano, e GTK li libera come prima;
//! - senza la funzione vera nel processo (non succede con GTK caricata)
//!   risponde subito «nessun tipo» invece di non rispondere.
//!
//! Vale per tutti gli appunti GTK del processo (`CLIPBOARD` e la selezione
//! primaria del clic centrale) e per ogni chiamante, GTK compresa: per tutti
//! «0 tipi» è la stessa cosa del fallimento. Va tolta quando WebKitGTK
//! controlla il numero negativo in una release verificata con la sonda di
//! `docs/architecture/desktop-webview.md` («Gli appunti senza
//! proprietario»).

use std::ffi::{c_int, c_void, CStr};
use std::sync::OnceLock;

/// `GtkClipboard`, che qui non si guarda mai dentro.
pub type GtkClipboard = c_void;

/// `GdkAtom`, un puntatore opaco.
pub type GdkAtom = *mut c_void;

/// `GtkClipboardTargetsReceivedFunc`.
pub type TipiRicevuti = unsafe extern "C" fn(*mut GtkClipboard, *mut GdkAtom, c_int, *mut c_void);

/// `gtk_clipboard_request_targets`. La risposta è un `Option` perché GTK
/// non la controlla e qui non si fanno ipotesi su chi chiama.
pub type RichiediTipi = unsafe extern "C" fn(*mut GtkClipboard, Option<TipiRicevuti>, *mut c_void);

/// Il numero dei tipi da dare a chi ha chiesto: 0 quando GTK dice che la
/// richiesta è fallita (tipi `NULL` o numero negativo), altrimenti il suo.
pub fn numero_dei_tipi(tipi: *const GdkAtom, numero: c_int) -> c_int {
    if tipi.is_null() || numero < 0 {
        0
    } else {
        numero
    }
}

/// Chi aveva chiesto i tipi, da richiamare quando GTK risponde.
struct Inoltro {
    risposta: TipiRicevuti,
    dati: *mut c_void,
}

/// La risposta data a GTK al posto di quella di chi ha chiesto.
///
/// # Safety
///
/// `dati` è l'[`Inoltro`] creato da [`richiedi_tipi_con`], e GTK chiama la
/// risposta una volta sola per richiesta.
unsafe extern "C" fn tipi_ricevuti(
    appunti: *mut GtkClipboard,
    tipi: *mut GdkAtom,
    numero: c_int,
    dati: *mut c_void,
) {
    // SAFETY: il contratto della funzione; l'inoltro si libera qui, una volta.
    let inoltro = unsafe { Box::from_raw(dati.cast::<Inoltro>()) };
    let numero = numero_dei_tipi(tipi, numero);
    // SAFETY: la risposta di chi ha chiesto, con i suoi dati e gli argomenti
    // di GTK; solo il numero è cambiato, e mai in più di quanti ce ne sono.
    unsafe { (inoltro.risposta)(appunti, tipi, numero, inoltro.dati) }
}

/// Chiede i tipi a `vero`, e a chi ha chiesto risponde col numero corretto.
///
/// # Safety
///
/// Il contratto di `gtk_clipboard_request_targets`: `appunti` è un
/// `GtkClipboard` valido, e `vero` chiama la risposta che riceve una volta
/// sola, con i dati che riceve.
pub unsafe fn richiedi_tipi_con(
    vero: RichiediTipi,
    appunti: *mut GtkClipboard,
    risposta: Option<TipiRicevuti>,
    dati: *mut c_void,
) {
    let Some(risposta) = risposta else {
        // SAFETY: la richiesta di chi chiama, com'è.
        return unsafe { vero(appunti, None, dati) };
    };
    let inoltro = Box::into_raw(Box::new(Inoltro { risposta, dati }));
    // SAFETY: il contratto della funzione; l'inoltro lo libera
    // `tipi_ricevuti`, che GTK chiama una volta.
    unsafe { vero(appunti, Some(tipi_ricevuti), inoltro.cast()) }
}

/// Il `gtk_clipboard_request_targets` di GTK: il prossimo dopo questo
/// eseguibile.
fn vero() -> Option<RichiediTipi> {
    static VERO: OnceLock<Option<RichiediTipi>> = OnceLock::new();
    // SAFETY: `RTLD_NEXT` con un nome terminato da zero; il simbolo di GTK ha
    // la firma di `RichiediTipi`.
    *VERO.get_or_init(|| unsafe { simbolo(libc::RTLD_NEXT, c"gtk_clipboard_request_targets") })
}

/// La funzione esportata da `main.rs`.
///
/// # Safety
///
/// Il contratto di `gtk_clipboard_request_targets`, come
/// [`richiedi_tipi_con`].
pub unsafe fn gtk_clipboard_request_targets(
    appunti: *mut GtkClipboard,
    risposta: Option<TipiRicevuti>,
    dati: *mut c_void,
) {
    match vero() {
        // SAFETY: il contratto della funzione.
        Some(vero) => unsafe { richiedi_tipi_con(vero, appunti, risposta, dati) },
        None => {
            if let Some(risposta) = risposta {
                // SAFETY: «nessun tipo», che è la risposta di GTK a una
                // richiesta fallita, col numero già corretto.
                unsafe { risposta(appunti, std::ptr::null_mut(), 0, dati) }
            }
        }
    }
}

/// La funzione di Fub è quella che il processo risolve? Sì se il primo
/// `gtk_clipboard_request_targets` del processo non è quello di GTK.
pub fn interposta() -> bool {
    // SAFETY: come in `vero`.
    let primo: Option<RichiediTipi> =
        unsafe { simbolo(libc::RTLD_DEFAULT, c"gtk_clipboard_request_targets") };
    match (primo, vero()) {
        (Some(primo), Some(vero)) => primo as usize != vero as usize,
        _ => false,
    }
}

/// Scrive nel log se la correzione è quella che WebKit chiamerà.
pub fn scrivi_nel_log() {
    tracing::info!(
        target: "fub.app",
        interposta = interposta(),
        "GTK clipboard targets guard"
    );
}

/// Un simbolo caricato nel processo.
///
/// # Safety
///
/// `T` è un puntatore a funzione con la firma C del simbolo.
unsafe fn simbolo<T: Copy>(dove: *mut c_void, nome: &CStr) -> Option<T> {
    // SAFETY: `dlsym` con un nome terminato da zero; un puntatore non nullo
    // è l'indirizzo della funzione, che chi chiama tipizza.
    let indirizzo = unsafe { libc::dlsym(dove, nome.as_ptr()) };
    (!indirizzo.is_null()).then(|| unsafe { std::mem::transmute_copy(&indirizzo) })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    thread_local! {
        /// Che cosa ha ricevuto la risposta di prova: appunti, tipi, numero, dati.
        static RICEVUTO: RefCell<Vec<(usize, usize, c_int, usize)>> = const { RefCell::new(Vec::new()) };
        /// Che cosa risponde il GTK di prova: tipi e numero.
        static GTK_RISPONDE: RefCell<(usize, c_int)> = const { RefCell::new((0, -1)) };
    }

    /// Una risposta che, come WebKitGTK 2.54, legge tutti i tipi che le dicono:
    /// con `-1` e `NULL` qui il test muore, come moriva Fub.
    unsafe extern "C" fn risposta_come_webkit(
        appunti: *mut GtkClipboard,
        tipi: *mut GdkAtom,
        numero: c_int,
        dati: *mut c_void,
    ) {
        // Un panic qui non torna a GTK: interrompe il test, che fallisce.
        assert!(
            numero >= 0 && (numero == 0 || !tipi.is_null()),
            "{numero} tipi da {tipi:?}: WebKitGTK morirebbe"
        );
        let letti: Vec<usize> = (0..numero as usize)
            // SAFETY: il numero che GTK (o la correzione) dichiara.
            .map(|i| unsafe { *tipi.add(i) } as usize)
            .collect();
        assert_eq!(letti.len(), numero as usize);
        RICEVUTO.with(|r| {
            r.borrow_mut()
                .push((appunti as usize, tipi as usize, numero, dati as usize))
        });
    }

    /// Un GTK di prova: risponde subito, una volta, con ciò che dice
    /// `GTK_RISPONDE`.
    unsafe extern "C" fn gtk_di_prova(
        appunti: *mut GtkClipboard,
        risposta: Option<TipiRicevuti>,
        dati: *mut c_void,
    ) {
        let (tipi, numero) = GTK_RISPONDE.with(|g| *g.borrow());
        if let Some(risposta) = risposta {
            // SAFETY: la risposta ricevuta, con i suoi dati.
            unsafe { risposta(appunti, tipi as *mut GdkAtom, numero, dati) }
        }
    }

    fn chiedi(tipi: usize, numero: c_int) -> (usize, usize, c_int, usize) {
        GTK_RISPONDE.with(|g| *g.borrow_mut() = (tipi, numero));
        RICEVUTO.with(|r| r.borrow_mut().clear());
        // SAFETY: il GTK di prova rispetta il contratto (una risposta, i dati
        // ricevuti); appunti e dati sono valori riconoscibili, mai letti.
        unsafe {
            richiedi_tipi_con(
                gtk_di_prova,
                0x10 as *mut GtkClipboard,
                Some(risposta_come_webkit),
                0x20 as *mut c_void,
            )
        };
        RICEVUTO.with(|r| {
            let r = r.borrow();
            assert_eq!(r.len(), 1, "una risposta sola");
            r[0]
        })
    }

    #[test]
    fn appunti_senza_proprietario_sono_vuoti_e_non_fanno_morire() {
        // Come GTK 3 su X11 quando nessuno possiede gli appunti.
        assert_eq!(chiedi(0, -1), (0x10, 0, 0, 0x20));
    }

    #[test]
    fn i_tipi_che_ci_sono_passano_come_sono() {
        let tipi: [GdkAtom; 2] = [0x111 as GdkAtom, 0x222 as GdkAtom];
        let indirizzo = tipi.as_ptr() as usize;
        assert_eq!(chiedi(indirizzo, 2), (0x10, indirizzo, 2, 0x20));
    }

    #[test]
    fn il_numero_si_corregge_solo_quando_gtk_dice_che_non_ce_ne_sono() {
        let un_tipo: GdkAtom = 0x1 as GdkAtom;
        assert_eq!(numero_dei_tipi(std::ptr::null(), -1), 0);
        assert_eq!(numero_dei_tipi(std::ptr::null(), 3), 0);
        assert_eq!(numero_dei_tipi(&un_tipo, -1), 0);
        assert_eq!(numero_dei_tipi(&un_tipo, 0), 0);
        assert_eq!(numero_dei_tipi(&un_tipo, 1), 1);
    }

    #[test]
    fn senza_risposta_la_richiesta_passa_com_e() {
        RICEVUTO.with(|r| r.borrow_mut().clear());
        // SAFETY: il GTK di prova non chiama una risposta assente.
        unsafe {
            richiedi_tipi_con(
                gtk_di_prova,
                0x10 as *mut GtkClipboard,
                None,
                0x20 as *mut c_void,
            )
        };
        assert!(RICEVUTO.with(|r| r.borrow().is_empty()));
    }
}

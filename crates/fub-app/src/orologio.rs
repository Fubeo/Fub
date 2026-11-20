//! L'orologio dei fotogrammi di GTK3 alla frequenza dello schermo, quando la
//! finestra disegna con GL sotto Wayland.
//!
//! Il processo dell'app ridisegna la webview a ogni giro dell'orologio dei
//! fotogrammi di GTK (`GdkFrameClock`). GTK3 decide quando fare il giro
//! successivo con l'intervallo di refresh scritto nei tempi del fotogramma
//! precedente (`gdk_frame_clock_paint_idle` in `gdk/gdkframeclockidle.c`, 3.24),
//! e quell'intervallo lo scrive solo il frame callback di Wayland
//! (`frame_callback` in `gdk/wayland/gdkwindow-wayland.c`), dalla frequenza
//! dello schermo della finestra. Quando WebKitGTK passa i fotogrammi sulla
//! scheda (DMA-BUF), la finestra disegna con GL e il commit lo fa
//! `eglSwapBuffers`: GTK non chiede più il suo frame callback, l'intervallo
//! resta 0 e GTK ripiega su `FRAME_INTERVAL`, 16 667 µs. La pagina va allora a
//! 60 fotogrammi al secondo esatti anche su uno schermo a 180 Hz, con il rAF
//! che il vblank emulato ([`crate::vblank`]) porta a 180
//! (`docs/architecture/desktop-webview.md`, «L'orologio di GTK3 nel modo GL»).
//!
//! Qui Fub scrive quell'intervallo al posto del frame callback: dopo ogni
//! disegno (`after-paint`), se il campo è ancora 0, ci mette il periodo dello
//! schermo su cui sta la finestra (`gdk_monitor_get_refresh_rate`). GTK non ha
//! un'API per scriverlo, e il campo è privato: la disposizione è quella di
//! `struct _GdkFrameTimings` (`gdk/gdkframeclockprivate.h`) dalla 3.24.21, che
//! ha aggiunto `smoothed_frame_time` ([`TempiGtk3`]). Per non scrivere mai nel
//! campo sbagliato:
//!
//! - si scrive solo se il getter pubblico
//!   (`gdk_frame_timings_get_refresh_interval`) dice 0 **e** il campo vale 0;
//! - dopo la scrittura il getter deve restituire il valore scritto; se no il
//!   campo torna 0 e l'orologio non si tocca più per tutto il processo;
//! - solo con GTK dalla [`GTK_DA`] e prima della 4, solo sotto Wayland, solo
//!   per 24–500 Hz; `FUB_OROLOGIO_GTK=0` la spegne.
//!
//! Dove GTK disegna da sé (memoria condivisa) il frame callback arriva dopo e
//! riscrive lo stesso valore: non cambia niente. Va tolta quando GTK3 scrive
//! l'intervallo anche nel modo GL; GTK4 non ha questo problema.

use std::ffi::{c_uint, c_void, OsStr};
use std::sync::atomic::{AtomicBool, Ordering};

/// L'interruttore: `FUB_OROLOGIO_GTK=0` spegne la correzione.
pub const INTERRUTTORE: &str = "FUB_OROLOGIO_GTK";

/// La prima GTK3 con la disposizione di [`TempiGtk3`]: la 3.24.21 ha aggiunto
/// `smoothed_frame_time` prima di `drawn_time` (NEWS: «Improve frame clock
/// smoothness»). Prima il campo stava 8 byte più in alto.
pub const GTK_DA: (u32, u32, u32) = (3, 24, 21);

/// Le frequenze corrette, come quelle del vblank emulato: fuori, l'orologio di
/// GTK resta com'è.
pub const HZ_MIN: u32 = crate::vblank::HZ_MIN;
pub const HZ_MAX: u32 = crate::vblank::HZ_MAX;

/// I primi campi di `struct _GdkFrameTimings` di GTK 3.24.21 e seguenti
/// (`gdk/gdkframeclockprivate.h`). Seguono i campi di debug e due bit, che qui
/// non servono: si legge e si scrive solo `refresh_interval`.
#[repr(C)]
#[derive(Default)]
pub struct TempiGtk3 {
    pub ref_count: c_uint,
    pub frame_counter: i64,
    pub cookie: u64,
    pub frame_time: i64,
    pub smoothed_frame_time: i64,
    pub drawn_time: i64,
    pub presentation_time: i64,
    pub refresh_interval: i64,
    pub predicted_presentation_time: i64,
}

/// Dove sta `refresh_interval` nei tempi di un fotogramma.
pub const CAMPO: usize = std::mem::offset_of!(TempiGtk3, refresh_interval);

/// La GTK caricata ha la disposizione nota?
pub fn versione_coperta(versione: (u32, u32, u32)) -> bool {
    versione >= GTK_DA && versione.0 == 3
}

/// L'interruttore è acceso? Tutto tranne `0` (anche l'assenza).
pub fn interruttore_acceso(valore: Option<&OsStr>) -> bool {
    crate::vblank::interruttore_acceso(valore)
}

/// Il periodo, in µs come lo scrive GTK, di uno schermo a `mhz` millihertz
/// (`gdk_monitor_get_refresh_rate`). Fuori dai limiti, niente.
pub fn intervallo_us(mhz: i32) -> Option<i64> {
    let mhz = u32::try_from(mhz).ok()?;
    let in_limiti = (HZ_MIN * 1000..=HZ_MAX * 1000).contains(&mhz);
    // Come `frame_callback` di GTK: 10^9 / millihertz.
    in_limiti.then(|| 1_000_000_000 / i64::from(mhz))
}

/// L'esito di una scrittura.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Scrittura {
    /// Il campo era vuoto e ora ha il periodo dello schermo.
    Scritta,
    /// GTK l'aveva già scritto (il frame callback): non si tocca.
    GiaPiena,
    /// Il campo non è quello che il getter legge: la disposizione non è
    /// quella nota. Il campo resta com'era.
    DisposizioneDiversa,
}

/// Scrive `valore` in `refresh_interval`, se è vuoto, e verifica con il
/// getter pubblico.
///
/// # Safety
///
/// `tempi` punta a un `GdkFrameTimings` vivo (o a un [`TempiGtk3`]) lungo
/// almeno `CAMPO + 8` byte, sul thread che lo usa; `leggi` è il getter di
/// `refresh_interval`.
pub unsafe fn scrivi(
    tempi: *mut c_void,
    valore: i64,
    leggi: unsafe fn(*mut c_void) -> i64,
) -> Scrittura {
    // SAFETY: vedi sopra; `CAMPO` è dentro la struttura ed è allineato a 8
    // come la struttura, che inizia con un `guint` seguito da un `gint64`.
    unsafe {
        if leggi(tempi) != 0 {
            return Scrittura::GiaPiena;
        }
        let campo = tempi.cast::<u8>().add(CAMPO).cast::<i64>();
        if campo.read() != 0 {
            return Scrittura::DisposizioneDiversa;
        }
        campo.write(valore);
        if leggi(tempi) != valore {
            campo.write(0);
            return Scrittura::DisposizioneDiversa;
        }
        Scrittura::Scritta
    }
}

/// Com'è andata all'avvio, per il log.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Avvio {
    /// Accesa: ogni finestra la prende alla prima pagina.
    Attiva,
    /// `FUB_OROLOGIO_GTK=0`.
    Spenta,
}

/// Decide all'avvio. GTK non è ancora partito: versione e backend si
/// guardano quando si aggancia la prima finestra.
pub fn prepara(interruttore: Option<&OsStr>) -> Avvio {
    let avvio = if interruttore_acceso(interruttore) {
        Avvio::Attiva
    } else {
        Avvio::Spenta
    };
    ATTIVA.store(avvio == Avvio::Attiva, Ordering::Release);
    avvio
}

/// Scrive nel log la decisione dell'avvio.
pub fn scrivi_nel_log(avvio: &Avvio) {
    tracing::info!(
        target: "fub.app",
        attiva = *avvio == Avvio::Attiva,
        ?avvio,
        interruttore = INTERRUTTORE,
        "GTK frame clock at the monitor rate"
    );
}

/// Accesa all'avvio, e spenta per sempre alla prima disposizione diversa.
static ATTIVA: AtomicBool = AtomicBool::new(false);

/// Aggancia l'orologio della finestra di una webview: una volta per orologio,
/// anche se la pagina si ricarica. Va chiamata sul thread principale
/// (`with_webview`).
pub fn aggancia(webview: &webkit2gtk::WebView) {
    use gtk::prelude::*;

    if !ATTIVA.load(Ordering::Acquire) {
        return;
    }
    let versione = (
        gtk::major_version(),
        gtk::minor_version(),
        gtk::micro_version(),
    );
    let widget = webview.upcast_ref::<gtk::Widget>();
    let wayland = widget.display().type_().name() == "GdkWaylandDisplay";
    if !versione_coperta(versione) || !wayland {
        if ATTIVA.swap(false, Ordering::AcqRel) {
            tracing::info!(
                target: "fub.app",
                gtk = %format!("{}.{}.{}", versione.0, versione.1, versione.2),
                wayland,
                "GTK frame clock at the monitor rate: not needed here"
            );
        }
        return;
    }
    match widget.frame_clock() {
        Some(orologio) => aggancia_orologio(widget, &orologio),
        // Prima di `realize` la finestra non ha l'orologio: lo si prende
        // appena c'è.
        None => {
            widget.connect_realize(|widget| {
                if let Some(orologio) = widget.frame_clock() {
                    aggancia_orologio(widget, &orologio);
                }
            });
        }
    }
}

/// Il segno, sull'orologio, che il gestore c'è già.
const SEGNO: &str = "fub-orologio-allo-schermo";

fn aggancia_orologio(widget: &gtk::Widget, orologio: &gtk::gdk::FrameClock) {
    use gtk::glib::prelude::*;
    use gtk::glib::translate::ToGlibPtr;
    use gtk::prelude::*;

    // SAFETY: il dato sotto `SEGNO` è solo questo `bool`, scritto e letto
    // qui, sul thread principale.
    unsafe {
        if orologio.data::<bool>(SEGNO).is_some() {
            return;
        }
        orologio.set_data(SEGNO, true);
    }
    let finestra = widget.downgrade();
    let primo = std::cell::Cell::new(true);
    orologio.connect_after_paint(move |orologio| {
        if !ATTIVA.load(Ordering::Acquire) {
            return;
        }
        let (Some(widget), Some(tempi)) = (finestra.upgrade(), orologio.current_timings()) else {
            return;
        };
        let Some(gdk_finestra) = widget.window() else {
            return;
        };
        let Some(mhz) = widget
            .display()
            .monitor_at_window(&gdk_finestra)
            .map(|schermo| schermo.refresh_rate())
        else {
            return;
        };
        let Some(valore) = intervallo_us(mhz) else {
            return;
        };
        let puntatore: *mut gtk::gdk::ffi::GdkFrameTimings = tempi.to_glib_none().0;
        // SAFETY: `tempi` tiene vivi i tempi del fotogramma corrente per
        // tutta la chiamata, sul thread principale; il getter è quello di GTK.
        let esito = unsafe { scrivi(puntatore.cast(), valore, leggi_da_gtk) };
        match esito {
            Scrittura::Scritta if primo.replace(false) => tracing::info!(
                target: "fub.app",
                mhz,
                intervallo_us = valore,
                "GTK frame clock at the monitor rate: first frame"
            ),
            Scrittura::DisposizioneDiversa => {
                ATTIVA.store(false, Ordering::Release);
                tracing::warn!(
                    target: "fub.app",
                    "GTK frame clock at the monitor rate: unknown GdkFrameTimings layout, off"
                );
            }
            _ => {}
        }
    });
}

/// `gdk_frame_timings_get_refresh_interval`.
///
/// # Safety
///
/// `tempi` è un `GdkFrameTimings` vivo.
unsafe fn leggi_da_gtk(tempi: *mut c_void) -> i64 {
    // SAFETY: vedi sopra.
    unsafe { gtk::gdk::ffi::gdk_frame_timings_get_refresh_interval(tempi.cast()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// La disposizione di GTK 3.24.21+: `guint`, il riempimento, sei
    /// `gint64` e poi `refresh_interval`.
    #[test]
    fn il_campo_sta_dove_lo_mette_gtk() {
        assert_eq!(CAMPO, 56);
        assert_eq!(std::mem::align_of::<TempiGtk3>(), 8);
    }

    /// Il getter vero di GTK, sulla nostra struttura, legge il campo che
    /// scriviamo: la disposizione è quella della GTK di questa macchina.
    #[test]
    fn il_getter_di_gtk_legge_il_nostro_campo() {
        let mut tempi = TempiGtk3::default();
        let puntatore = std::ptr::addr_of_mut!(tempi).cast::<c_void>();
        // SAFETY: `tempi` è vivo e lungo quanto serve.
        let esito = unsafe { scrivi(puntatore, 5_556, leggi_da_gtk) };
        assert_eq!(esito, Scrittura::Scritta);
        assert_eq!(tempi.refresh_interval, 5_556);
        assert_eq!(tempi.predicted_presentation_time, 0);
        assert_eq!(tempi.presentation_time, 0);
    }

    #[test]
    fn non_riscrive_quello_che_gtk_ha_gia_scritto() {
        let mut tempi = TempiGtk3 {
            refresh_interval: 16_667,
            ..TempiGtk3::default()
        };
        let puntatore = std::ptr::addr_of_mut!(tempi).cast::<c_void>();
        // SAFETY: come sopra.
        let esito = unsafe { scrivi(puntatore, 5_556, leggi_da_gtk) };
        assert_eq!(esito, Scrittura::GiaPiena);
        assert_eq!(tempi.refresh_interval, 16_667);
    }

    /// Un getter che legge un altro campo (una GTK con un'altra
    /// disposizione): il campo torna com'era e l'esito lo dice.
    #[test]
    fn con_unaltra_disposizione_non_lascia_niente() {
        unsafe fn legge_un_altro_campo(tempi: *mut c_void) -> i64 {
            // SAFETY: nei test `tempi` è un `TempiGtk3`.
            unsafe { (*tempi.cast::<TempiGtk3>()).predicted_presentation_time }
        }
        let mut tempi = TempiGtk3::default();
        let puntatore = std::ptr::addr_of_mut!(tempi).cast::<c_void>();
        // SAFETY: come sopra.
        let esito = unsafe { scrivi(puntatore, 5_556, legge_un_altro_campo) };
        assert_eq!(esito, Scrittura::DisposizioneDiversa);
        assert_eq!(tempi.refresh_interval, 0);

        // Il campo nostro già pieno mentre il getter dice 0: non si scrive.
        let mut tempi = TempiGtk3 {
            refresh_interval: 7,
            ..TempiGtk3::default()
        };
        let puntatore = std::ptr::addr_of_mut!(tempi).cast::<c_void>();
        // SAFETY: come sopra.
        let esito = unsafe { scrivi(puntatore, 5_556, legge_un_altro_campo) };
        assert_eq!(esito, Scrittura::DisposizioneDiversa);
        assert_eq!(tempi.refresh_interval, 7);
    }

    #[test]
    fn il_periodo_e_quello_di_gtk() {
        assert_eq!(intervallo_us(179_960), Some(5_556));
        assert_eq!(intervallo_us(60_000), Some(16_666));
        assert_eq!(intervallo_us(143_973), Some(6_945));
        assert_eq!(intervallo_us(0), None);
        assert_eq!(intervallo_us(-1), None);
        assert_eq!(intervallo_us(23_999), None);
        assert_eq!(intervallo_us(500_001), None);
        assert_eq!(intervallo_us(24_000), Some(41_666));
    }

    #[test]
    fn solo_le_gtk3_con_la_disposizione_nota() {
        assert!(versione_coperta((3, 24, 21)));
        assert!(versione_coperta((3, 24, 49)));
        assert!(!versione_coperta((3, 24, 20)));
        assert!(!versione_coperta((3, 22, 30)));
        assert!(!versione_coperta((4, 0, 0)));
    }

    #[test]
    fn linterruttore_spegne() {
        assert_eq!(prepara(Some(OsStr::new("0"))), Avvio::Spenta);
        assert_eq!(prepara(Some(OsStr::new("1"))), Avvio::Attiva);
        assert_eq!(prepara(None), Avvio::Attiva);
    }
}

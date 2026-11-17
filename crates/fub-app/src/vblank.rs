//! Il vblank emulato di WebKitGTK, dove il driver non lo dà (ADR 0246).
//!
//! In WebKitGTK il ritmo della pagina (rAF, aggiornamenti di rendering,
//! animazioni composte) lo dà un *display link* nel processo dell'app, cioè
//! in questo processo. Il display link chiede il vblank al kernel con
//! `drmWaitVBlank` sul nodo primario della scheda; dove il driver risponde
//! `EOPNOTSUPP` (`nvidia-drm`, ogni versione provata) ripiega su un timer
//! fisso a 60 Hz e la pagina resta a 62,5 Hz anche su uno schermo a 180 Hz
//! (`docs/architecture/desktop-webview.md`, «Il tetto dei 60 Hz di
//! WebKitGTK»).
//!
//! Qui l'eseguibile `fub` esporta un suo `drmWaitVBlank` (`main.rs`, e il
//! build script che lo mette nella tabella dinamica): il linker dinamico lo
//! trova prima di quello di libdrm, e WebKit chiama questo. Le regole:
//!
//! - chiama **sempre prima il vero** (`dlsym(RTLD_NEXT)`) ed emula solo se
//!   fallisce con `EOPNOTSUPP`; il fallimento si ricorda per (scheda, CRTC)
//!   e il vero non si richiama a ogni tick;
//! - emula solo le richieste che WebKit fa (relative o assolute, con i bit
//!   del CRTC; [`leggi_richiesta`]): ogni altra passa al vero com'è;
//! - la frequenza è quella della modalità del CRTC letta dal driver
//!   (`drmModeGetCrtc`, che su `nvidia-drm` funziona), riletta ogni secondo;
//!   fuori da [`HZ_MIN`]–[`HZ_MAX`] o con il CRTC spento si risponde come il
//!   driver (`-1`, `EOPNOTSUPP`), cioè il comportamento di prima;
//! - le scadenze sono assolute su `CLOCK_MONOTONIC` ([`Griglia`]): niente
//!   deriva, e i tempi della risposta sono quelli del kernel;
//! - `FUB_VBLANK_EMULATO=0` la spegne, e fuori da [`WEBKITGTK_DA`] /
//!   [`WEBKITGTK_FINO_A`] è spenta: allora la funzione passa tutto al vero.
//!
//! Il processo web e quello di rete non sono questo eseguibile e non ne sono
//! toccati. Va tolta quando WebKit ha un timer alla frequenza dello schermo
//! in una release verificata (PR WebKit 78603): basta un limite in
//! [`WEBKITGTK_FINO_A`].

use std::ffi::{c_int, c_long, c_uint, c_ulong, c_void, CStr, OsStr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

/// L'interruttore: `FUB_VBLANK_EMULATO=0` spegne l'emulazione.
pub const INTERRUTTORE: &str = "FUB_VBLANK_EMULATO";

/// **La prima WebKitGTK in cui l'emulazione è accesa**, ed è l'unico posto in
/// cui l'intervallo è scritto. È la versione in cui il modo in cui WebKit
/// chiama `drmWaitVBlank` è stato letto nel sorgente
/// (`Source/WebKit/UIProcess/glib/DisplayVBlankMonitorDRM.cpp`: richiesta
/// relativa, `sequence` 0 per provare e 1 per aspettare, bit del CRTC) e
/// misurato.
pub const WEBKITGTK_DA: (u32, u32, u32) = (2, 54, 0);

/// L'ultima WebKitGTK esclusa, quando ci sarà: la prima release con il timer
/// alla frequenza del monitor (PR WebKit 78603) verificata su NVIDIA. Finché
/// nessuna lo è l'intervallo resta aperto.
pub const WEBKITGTK_FINO_A: Option<(u32, u32, u32)> = None;

/// Le frequenze emulate: fuori, il comportamento di prima.
pub const HZ_MIN: u32 = 24;
pub const HZ_MAX: u32 = 500;

/// Un'attesa più lunga di così non si emula (il kernel, oltre i 3 s,
/// rinuncia con `EBUSY`): si risponde come il driver.
const ATTESA_MASSIMA_NS: i64 = 3_000_000_000;

/// Ogni quanto si rilegge la modalità del CRTC (un cambio di frequenza).
const RILETTURA_NS: i64 = 1_000_000_000;

// I bit di `drmVBlankSeqType` (`drm.h`).
const RELATIVA: u32 = 0x1;
const CRTC_ALTO_MASCHERA: u32 = 0x3e;
const CRTC_ALTO_SPOSTAMENTO: u32 = 1;
const SECONDARIO: u32 = 0x2000_0000;

/// La richiesta di `drmVBlank` (`xf86drm.h`).
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RichiestaVBlank {
    pub tipo: c_uint,
    pub sequenza: c_uint,
    pub segnale: c_ulong,
}

/// La risposta di `drmVBlank`: stessa memoria della richiesta.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RispostaVBlank {
    pub tipo: c_uint,
    pub sequenza: c_uint,
    pub tval_sec: c_long,
    pub tval_usec: c_long,
}

/// `drmVBlank`, l'unione di richiesta e risposta.
#[repr(C)]
pub union DrmVBlank {
    pub richiesta: RichiestaVBlank,
    pub risposta: RispostaVBlank,
}

/// Che cosa chiede una richiesta che si sa emulare.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Richiesta {
    /// `n` vblank dopo quello corrente; 0 è «dimmi il contatore».
    Relativa(u32),
    /// Il vblank numero `n` (contatore a 32 bit, come nel kernel).
    Assoluta(u32),
}

/// Il CRTC (indice, come lo calcola il kernel) e la richiesta, se la si sa
/// emulare. `None` per ogni bit che WebKit non usa (evento, segnale, flip,
/// `NEXTONMISS`): quelle richieste passano al vero com'è.
pub fn leggi_richiesta(tipo: u32, sequenza: u32) -> Option<(u32, Richiesta)> {
    if tipo & !(RELATIVA | CRTC_ALTO_MASCHERA | SECONDARIO) != 0 {
        return None;
    }
    let alto = (tipo & CRTC_ALTO_MASCHERA) >> CRTC_ALTO_SPOSTAMENTO;
    let pipe = if alto != 0 {
        alto
    } else {
        u32::from(tipo & SECONDARIO != 0)
    };
    let richiesta = if tipo & RELATIVA != 0 {
        Richiesta::Relativa(sequenza)
    } else {
        Richiesta::Assoluta(sequenza)
    };
    Some((pipe, richiesta))
}

/// Il vero ha fallito come fa `nvidia-drm`? Solo allora si emula.
pub fn da_emulare(ret: c_int, errno: c_int) -> bool {
    ret != 0 && errno == libc::EOPNOTSUPP
}

/// I campi di `drmModeModeInfo` che danno la frequenza.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Modo {
    /// kHz.
    pub clock: u32,
    pub htotal: u16,
    pub vtotal: u16,
    pub vscan: u16,
    pub flags: u32,
}

const MODO_INTERLACCIATO: u32 = 1 << 4;
const MODO_DBLSCAN: u32 = 1 << 5;

/// La frequenza della modalità in millihertz, arrotondata (179 960 per
/// 179,96 Hz, come la dà GTK), con le correzioni del kernel
/// (`drm_mode_vrefresh`) per interlacciato, doppia scansione e `vscan`.
/// `None` per una modalità vuota.
pub fn frequenza_mhz(modo: Modo) -> Option<u32> {
    let totale = u64::from(modo.htotal) * u64::from(modo.vtotal);
    if modo.clock == 0 || totale == 0 {
        return None;
    }
    let mut mhz = (u64::from(modo.clock) * 1_000_000 + totale / 2) / totale;
    if modo.flags & MODO_INTERLACCIATO != 0 {
        mhz *= 2;
    }
    if modo.flags & MODO_DBLSCAN != 0 {
        mhz /= 2;
    }
    if modo.vscan > 1 {
        mhz /= u64::from(modo.vscan);
    }
    u32::try_from(mhz).ok().filter(|&mhz| mhz > 0)
}

/// La frequenza è fra quelle che si emulano?
pub fn nei_limiti(mhz: u32) -> bool {
    (HZ_MIN * 1000..=HZ_MAX * 1000).contains(&mhz)
}

/// Il periodo in nanosecondi di una frequenza in millihertz.
pub fn periodo_ns(mhz: u32) -> i64 {
    1_000_000_000_000 / i64::from(mhz.max(1))
}

/// La griglia dei vblank emulati di un CRTC: il vblank numero `base + k`
/// cade a `origine + k · periodo` su `CLOCK_MONOTONIC`. Le scadenze sono
/// sempre calcolate dall'origine, mai sommando attese: non deriva.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Griglia {
    pub origine_ns: i64,
    pub periodo_ns: i64,
    pub base: u64,
}

impl Griglia {
    pub fn nuova(ora_ns: i64, periodo_ns: i64) -> Self {
        Griglia {
            origine_ns: ora_ns,
            periodo_ns: periodo_ns.max(1),
            base: 0,
        }
    }

    /// Il numero dell'ultimo vblank passato a `ora_ns`.
    pub fn conta(&self, ora_ns: i64) -> u64 {
        let passati = (ora_ns - self.origine_ns).max(0) / self.periodo_ns;
        self.base + passati as u64
    }

    /// Quando cade il vblank numero `k` (non prima dell'origine).
    pub fn scadenza(&self, k: u64) -> i64 {
        let passi = k.saturating_sub(self.base) as i64;
        self.origine_ns + passi * self.periodo_ns
    }

    /// La stessa griglia con un altro periodo, dall'ultimo vblank passato: il
    /// contatore non torna indietro e non salta.
    pub fn con_periodo(&self, ora_ns: i64, periodo_ns: i64) -> Self {
        let k = self.conta(ora_ns);
        Griglia {
            origine_ns: self.scadenza(k),
            periodo_ns: periodo_ns.max(1),
            base: k,
        }
    }
}

/// Il vblank da aspettare, come lo sceglie il kernel (`drm_wait_vblank`):
/// relativa = corrente + n; assoluta = n, e se è già passato (confronto a
/// 32 bit con la finestra di 2²³) nessuna attesa. `None` se l'attesa supera
/// [`ATTESA_MASSIMA_NS`]: non si emula.
pub fn bersaglio(griglia: &Griglia, ora_ns: i64, richiesta: Richiesta) -> Option<u64> {
    let corrente = griglia.conta(ora_ns);
    let corrente32 = corrente as u32;
    let voluto = match richiesta {
        Richiesta::Relativa(n) => corrente32.wrapping_add(n),
        Richiesta::Assoluta(n) => n,
    };
    let k = if corrente32.wrapping_sub(voluto) <= 1 << 23 {
        corrente
    } else {
        corrente + u64::from(voluto.wrapping_sub(corrente32))
    };
    (griglia.scadenza(k) - ora_ns <= ATTESA_MASSIMA_NS).then_some(k)
}

/// La risposta del vblank `k` caduto a `scadenza_ns`: il contatore a 32 bit
/// e il tempo in secondi e microsecondi di `CLOCK_MONOTONIC`, come il kernel.
/// Il tipo perde il bit della richiesta relativa, come nel kernel.
pub fn risposta(tipo: u32, k: u64, scadenza_ns: i64) -> RispostaVBlank {
    RispostaVBlank {
        tipo: tipo & !RELATIVA,
        sequenza: k as u32,
        tval_sec: (scadenza_ns.div_euclid(1_000_000_000)) as c_long,
        tval_usec: (scadenza_ns.rem_euclid(1_000_000_000) / 1000) as c_long,
    }
}

/// La WebKitGTK caricata è nell'intervallo?
pub fn versione_coperta(versione: (u32, u32, u32)) -> bool {
    versione >= WEBKITGTK_DA && WEBKITGTK_FINO_A.is_none_or(|fino| versione < fino)
}

/// L'interruttore è acceso? Tutto tranne `0` (anche l'assenza).
pub fn interruttore_acceso(valore: Option<&OsStr>) -> bool {
    valore.is_none_or(|v| v.to_str().map(str::trim) != Some("0"))
}

/// Com'è andata all'avvio, per il log.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Avvio {
    /// Accesa: WebKit chiamerà la funzione di Fub.
    Attiva,
    /// `FUB_VBLANK_EMULATO=0`.
    Spenta,
    /// WebKitGTK fuori dall'intervallo.
    VersioneFuori(String),
    /// Versione di WebKitGTK illeggibile: non si accende.
    VersioneIgnota,
    /// L'eseguibile non esporta il simbolo (build senza il build script), o
    /// libdrm non c'è: WebKit chiama quello di libdrm.
    NonInterposta,
}

/// Decide all'avvio, prima che parta GTK. `versione` è quella della libreria
/// caricata (`tauri::webview_version`).
pub fn prepara(versione: Option<&str>, interruttore: Option<&OsStr>) -> Avvio {
    let avvio = if !interruttore_acceso(interruttore) {
        Avvio::Spenta
    } else {
        match versione.and_then(fub_host::settings::Webview::webkitgtk) {
            None => Avvio::VersioneIgnota,
            Some(fub_host::settings::Webview::WebKitGtk(a, b, c))
                if !versione_coperta((a, b, c)) =>
            {
                Avvio::VersioneFuori(format!("{a}.{b}.{c}"))
            }
            Some(_) if !interposta() => Avvio::NonInterposta,
            Some(_) => Avvio::Attiva,
        }
    };
    ATTIVA.store(avvio == Avvio::Attiva, Ordering::Release);
    avvio
}

/// Scrive nel log la decisione dell'avvio. Il CRTC e la frequenza si sanno
/// solo quando WebKit crea il suo monitor: li scrive [`drm_wait_vblank`].
pub fn scrivi_nel_log(avvio: &Avvio) {
    tracing::info!(
        target: "fub.app",
        attiva = *avvio == Avvio::Attiva,
        ?avvio,
        interruttore = INTERRUTTORE,
        "WebKitGTK emulated vblank"
    );
}

static ATTIVA: AtomicBool = AtomicBool::new(false);

type WaitVBlank = unsafe extern "C" fn(c_int, *mut DrmVBlank) -> c_int;

/// Il `drmWaitVBlank` di libdrm: il prossimo dopo questo eseguibile.
fn vero() -> Option<WaitVBlank> {
    static VERO: OnceLock<Option<WaitVBlank>> = OnceLock::new();
    // SAFETY: `RTLD_NEXT` con un nome terminato da zero; il simbolo di
    // libdrm ha la firma `int drmWaitVBlank(int, drmVBlankPtr)`.
    *VERO.get_or_init(|| unsafe { simbolo(libc::RTLD_NEXT, c"drmWaitVBlank") })
}

/// La funzione di Fub è quella che il processo risolve? Sì se il primo
/// `drmWaitVBlank` del processo non è quello di libdrm.
fn interposta() -> bool {
    // SAFETY: come in `vero`.
    let primo: Option<WaitVBlank> = unsafe { simbolo(libc::RTLD_DEFAULT, c"drmWaitVBlank") };
    match (primo, vero()) {
        (Some(primo), Some(vero)) => primo as usize != vero as usize,
        _ => false,
    }
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

/// Lo stato di un CRTC visto da qui.
struct Crtc {
    scheda: u64,
    pipe: u32,
    /// L'id del CRTC per `drmModeGetCrtc`, letto una volta.
    id: Option<u32>,
    griglia: Option<Griglia>,
    /// La frequenza in vigore (0: niente emulazione; `None`: mai letta, così
    /// la prima lettura va nel log anche quando dice 0) e quando la si è letta.
    mhz: Option<u32>,
    letta_ns: i64,
}

static CRTC_CHE_FALLISCONO: Mutex<Vec<Crtc>> = Mutex::new(Vec::new());

fn ora_ns() -> i64 {
    let mut t = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `t` è un `timespec` valido e scrivibile.
    unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, &mut t) };
    // `time_t` e `c_long` sono `i64` su 64 bit e più stretti altrove.
    #[allow(clippy::useless_conversion)]
    let ns = i64::from(t.tv_sec) * 1_000_000_000 + i64::from(t.tv_nsec);
    ns
}

fn dormi_fino_a(scadenza_ns: i64) {
    let t = libc::timespec {
        tv_sec: scadenza_ns.div_euclid(1_000_000_000) as libc::time_t,
        tv_nsec: scadenza_ns.rem_euclid(1_000_000_000) as _,
    };
    // SAFETY: attesa a scadenza assoluta su un `timespec` valido; il resto
    // (ultimo argomento) non serve con `TIMER_ABSTIME`.
    while unsafe {
        libc::clock_nanosleep(
            libc::CLOCK_MONOTONIC,
            libc::TIMER_ABSTIME,
            &t,
            std::ptr::null_mut(),
        )
    } == libc::EINTR
    {}
}

fn errno() -> c_int {
    std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
}

fn metti_errno(valore: c_int) {
    // SAFETY: `__errno_location` dà l'errno di questo thread.
    unsafe { *libc::__errno_location() = valore };
}

/// La scheda di un descrittore (`st_rdev`): CRTC con lo stesso indice su
/// schede diverse sono CRTC diversi.
fn scheda_di(fd: c_int) -> Option<u64> {
    let mut stat = std::mem::MaybeUninit::<libc::stat>::uninit();
    // SAFETY: `fstat` scrive in `stat`, che si legge solo se riesce.
    (unsafe { libc::fstat(fd, stat.as_mut_ptr()) } == 0)
        .then(|| unsafe { stat.assume_init() }.st_rdev)
}

/// Il `drmWaitVBlank` che WebKit chiama (esportato da `main.rs`).
///
/// # Safety
///
/// Come `drmWaitVBlank` di libdrm: `vbl` punta a un `drmVBlank` valido e
/// scrivibile per tutta la chiamata.
pub unsafe fn drm_wait_vblank(fd: c_int, vbl: *mut DrmVBlank) -> c_int {
    let Some(vero) = vero() else {
        // Senza libdrm nessuno chiamerebbe questa funzione: si fallisce
        // come una chiamata non supportata.
        metti_errno(libc::ENOSYS);
        return -1;
    };
    if vbl.is_null() || !ATTIVA.load(Ordering::Acquire) {
        // SAFETY: gli argomenti di chi chiama, passati com'erano.
        return unsafe { vero(fd, vbl) };
    }
    // SAFETY: `vbl` è valido (contratto della funzione); la richiesta è il
    // campo che chi chiama ha scritto.
    let richiesta = unsafe { (*vbl).richiesta };
    let Some((pipe, cosa)) = leggi_richiesta(richiesta.tipo, richiesta.sequenza) else {
        // SAFETY: come sopra.
        return unsafe { vero(fd, vbl) };
    };
    let Some(scheda) = scheda_di(fd) else {
        // SAFETY: come sopra.
        return unsafe { vero(fd, vbl) };
    };
    let gia_fallito = CRTC_CHE_FALLISCONO
        .lock()
        .is_ok_and(|crtc| crtc.iter().any(|c| c.scheda == scheda && c.pipe == pipe));
    if !gia_fallito {
        // SAFETY: come sopra.
        let ret = unsafe { vero(fd, vbl) };
        if !da_emulare(ret, errno()) {
            return ret;
        }
        // Il vero può aver scritto nella struttura: si rimette la richiesta.
        // SAFETY: `vbl` è valido e scrivibile.
        unsafe { (*vbl).richiesta = richiesta };
        if let Ok(mut crtc) = CRTC_CHE_FALLISCONO.lock() {
            if !crtc.iter().any(|c| c.scheda == scheda && c.pipe == pipe) {
                crtc.push(Crtc {
                    scheda,
                    pipe,
                    id: None,
                    griglia: None,
                    mhz: None,
                    letta_ns: i64::MIN,
                });
            }
        }
    }
    let ora = ora_ns();
    let Some((griglia, k)) = pianifica(fd, scheda, pipe, ora, cosa) else {
        metti_errno(libc::EOPNOTSUPP);
        return -1;
    };
    let scadenza = griglia.scadenza(k);
    if scadenza > ora {
        dormi_fino_a(scadenza);
    }
    // SAFETY: `vbl` è valido e scrivibile; la risposta occupa la stessa
    // memoria della richiesta, come in libdrm.
    unsafe { (*vbl).risposta = risposta(richiesta.tipo, k, scadenza) };
    metti_errno(0);
    0
}

/// La griglia del CRTC (rileggendo la modalità se serve) e il vblank da
/// aspettare. `None`: il CRTC è spento, la frequenza è fuori dai limiti o
/// l'attesa è troppo lunga, e si risponde come il driver.
fn pianifica(
    fd: c_int,
    scheda: u64,
    pipe: u32,
    ora: i64,
    cosa: Richiesta,
) -> Option<(Griglia, u64)> {
    let mut tutti = CRTC_CHE_FALLISCONO.lock().ok()?;
    let crtc = tutti
        .iter_mut()
        .find(|c| c.scheda == scheda && c.pipe == pipe)?;
    if ora.saturating_sub(crtc.letta_ns) >= RILETTURA_NS {
        crtc.letta_ns = ora;
        if crtc.id.is_none() {
            crtc.id = drm::id_del_crtc(fd, pipe);
        }
        let letta = crtc
            .id
            .and_then(|id| drm::modo_del_crtc(fd, id))
            .and_then(frequenza_mhz);
        let mhz = letta.filter(|&mhz| nei_limiti(mhz)).unwrap_or(0);
        if crtc.mhz != Some(mhz) {
            tracing::info!(
                target: "fub.app",
                pipe,
                crtc = ?crtc.id,
                letta_mhz = ?letta,
                emulata_mhz = mhz,
                "WebKitGTK emulated vblank for CRTC"
            );
            crtc.griglia = (mhz != 0).then(|| match crtc.griglia {
                Some(griglia) => griglia.con_periodo(ora, periodo_ns(mhz)),
                None => Griglia::nuova(ora, periodo_ns(mhz)),
            });
            crtc.mhz = Some(mhz);
        }
    }
    let griglia = crtc.griglia?;
    Some((griglia, bersaglio(&griglia, ora, cosa)?))
}

/// Le funzioni di modalità di libdrm, cercate nel processo (WebKit carica
/// libdrm): l'app non si collega a libdrm al momento della compilazione.
mod drm {
    use std::ffi::{c_char, c_int};

    /// `drmModeModeInfo` (`xf86drmMode.h`).
    #[repr(C)]
    struct ModeInfo {
        clock: u32,
        hdisplay: u16,
        hsync_start: u16,
        hsync_end: u16,
        htotal: u16,
        hskew: u16,
        vdisplay: u16,
        vsync_start: u16,
        vsync_end: u16,
        vtotal: u16,
        vscan: u16,
        vrefresh: u32,
        flags: u32,
        tipo: u32,
        nome: [c_char; 32],
    }

    /// `drmModeCrtc`.
    #[repr(C)]
    struct Crtc {
        crtc_id: u32,
        buffer_id: u32,
        x: u32,
        y: u32,
        width: u32,
        height: u32,
        mode_valid: c_int,
        mode: ModeInfo,
        gamma_size: c_int,
    }

    /// `drmModeRes`.
    #[repr(C)]
    struct Res {
        count_fbs: c_int,
        fbs: *mut u32,
        count_crtcs: c_int,
        crtcs: *mut u32,
        count_connectors: c_int,
        connectors: *mut u32,
        count_encoders: c_int,
        encoders: *mut u32,
        min_width: u32,
        max_width: u32,
        min_height: u32,
        max_height: u32,
    }

    type GetResources = unsafe extern "C" fn(c_int) -> *mut Res;
    type FreeResources = unsafe extern "C" fn(*mut Res);
    type GetCrtc = unsafe extern "C" fn(c_int, u32) -> *mut Crtc;
    type FreeCrtc = unsafe extern "C" fn(*mut Crtc);

    fn cerca<T: Copy>(nome: &std::ffi::CStr) -> Option<T> {
        // SAFETY: ogni chiamata tipizza il simbolo con la firma di
        // `xf86drmMode.h`.
        unsafe { super::simbolo::<T>(libc::RTLD_DEFAULT, nome) }
    }

    /// L'id del CRTC di indice `pipe` (l'ordine di `drmModeGetResources`,
    /// lo stesso che WebKit usa per i bit della richiesta).
    pub fn id_del_crtc(fd: c_int, pipe: u32) -> Option<u32> {
        let get = cerca::<GetResources>(c"drmModeGetResources")?;
        let free = cerca::<FreeResources>(c"drmModeFreeResources")?;
        // SAFETY: `get` restituisce una struttura di libdrm o NULL; la si
        // legge entro `count_crtcs` e la si rilascia con la sua funzione.
        unsafe {
            let res = get(fd);
            if res.is_null() {
                return None;
            }
            let quanti = usize::try_from((*res).count_crtcs).unwrap_or(0);
            let id = (!(*res).crtcs.is_null() && (pipe as usize) < quanti)
                .then(|| *(*res).crtcs.add(pipe as usize));
            free(res);
            id
        }
    }

    /// La modalità del CRTC, se è acceso.
    pub fn modo_del_crtc(fd: c_int, id: u32) -> Option<super::Modo> {
        let get = cerca::<GetCrtc>(c"drmModeGetCrtc")?;
        let free = cerca::<FreeCrtc>(c"drmModeFreeCrtc")?;
        // SAFETY: come sopra; la struttura si legge e si rilascia.
        unsafe {
            let crtc = get(fd, id);
            if crtc.is_null() {
                return None;
            }
            let m = &(*crtc).mode;
            let modo = ((*crtc).mode_valid != 0).then_some(super::Modo {
                clock: m.clock,
                htotal: m.htotal,
                vtotal: m.vtotal,
                vscan: m.vscan,
                flags: m.flags,
            });
            free(crtc);
            modo
        }
    }

    /// Solo per i controlli di disposizione nei test.
    #[cfg(test)]
    pub fn dimensioni() -> (usize, usize, usize) {
        (
            std::mem::size_of::<ModeInfo>(),
            std::mem::size_of::<Crtc>(),
            std::mem::size_of::<Res>(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const P180: i64 = 5_556_790; // 1e12 / 179 960 mHz, troncato

    /// Le richieste che WebKitGTK 2.54 fa davvero: relativa con i bit del
    /// CRTC (`crtcBitmaskForIndex`), sequenza 0 per provare, 1 per aspettare.
    #[test]
    fn legge_le_richieste_di_webkit() {
        assert_eq!(
            leggi_richiesta(RELATIVA, 0),
            Some((0, Richiesta::Relativa(0)))
        );
        assert_eq!(
            leggi_richiesta(RELATIVA | SECONDARIO, 1),
            Some((1, Richiesta::Relativa(1)))
        );
        // Indice 2 e 3: (i << 1) & 0x3e.
        assert_eq!(
            leggi_richiesta(RELATIVA | 0x4, 1),
            Some((2, Richiesta::Relativa(1)))
        );
        assert_eq!(
            leggi_richiesta(RELATIVA | 0x6, 1),
            Some((3, Richiesta::Relativa(1)))
        );
        assert_eq!(leggi_richiesta(0, 7), Some((0, Richiesta::Assoluta(7))));
    }

    /// Evento, flip, `NEXTONMISS` e segnale non si emulano: passano al vero.
    #[test]
    fn le_altre_richieste_passano_al_vero() {
        for bit in [
            0x0400_0000,
            0x0800_0000,
            0x1000_0000,
            0x4000_0000,
            0x8000_0000,
        ] {
            assert_eq!(leggi_richiesta(RELATIVA | bit, 1), None, "{bit:#x}");
        }
    }

    #[test]
    fn emula_solo_dopo_eopnotsupp() {
        assert!(da_emulare(-1, libc::EOPNOTSUPP));
        assert!(!da_emulare(0, libc::EOPNOTSUPP));
        assert!(!da_emulare(-1, libc::EINVAL));
        assert!(!da_emulare(-1, libc::EPERM));
        assert!(!da_emulare(-1, libc::EBUSY));
    }

    /// La modalità vera dello schermo a 179,96 Hz di questa macchina
    /// (`drmModeGetCrtc` su `nvidia-drm`) e i casi del kernel.
    #[test]
    fn frequenza_della_modalita() {
        let lg = Modo {
            clock: 768_500,
            htotal: 2_720,
            vtotal: 1_570,
            vscan: 0,
            flags: 0x9,
        };
        assert_eq!(frequenza_mhz(lg), Some(179_960));
        let sessanta = Modo {
            clock: 148_500,
            htotal: 2_200,
            vtotal: 1_125,
            vscan: 0,
            flags: 0,
        };
        assert_eq!(frequenza_mhz(sessanta), Some(60_000));
        assert_eq!(
            frequenza_mhz(Modo {
                flags: MODO_INTERLACCIATO,
                ..sessanta
            }),
            Some(120_000)
        );
        assert_eq!(
            frequenza_mhz(Modo {
                flags: MODO_DBLSCAN,
                ..sessanta
            }),
            Some(30_000)
        );
        assert_eq!(
            frequenza_mhz(Modo {
                vscan: 2,
                ..sessanta
            }),
            Some(30_000)
        );
        assert_eq!(
            frequenza_mhz(Modo {
                clock: 0,
                ..sessanta
            }),
            None
        );
        assert_eq!(
            frequenza_mhz(Modo {
                htotal: 0,
                ..sessanta
            }),
            None
        );
    }

    #[test]
    fn limiti_di_frequenza() {
        assert!(!nei_limiti(23_999));
        assert!(nei_limiti(24_000));
        assert!(nei_limiti(179_960));
        assert!(nei_limiti(500_000));
        assert!(!nei_limiti(500_001));
        assert!(!nei_limiti(0));
    }

    /// Le scadenze vengono dall'origine: dopo un milione di vblank il
    /// millionesimo cade esattamente a origine + 10⁶ periodi.
    #[test]
    fn la_griglia_non_deriva() {
        let g = Griglia::nuova(1_000, P180);
        assert_eq!(g.conta(1_000), 0);
        assert_eq!(g.conta(1_000 + P180 - 1), 0);
        assert_eq!(g.conta(1_000 + P180), 1);
        assert_eq!(g.scadenza(1_000_000), 1_000 + 1_000_000 * P180);
        assert_eq!(g.conta(g.scadenza(1_000_000)), 1_000_000);
        // Un tempo prima dell'origine non dà numeri negativi.
        assert_eq!(g.conta(0), 0);
    }

    /// Un cambio di frequenza riparte dall'ultimo vblank: il contatore non
    /// torna indietro.
    #[test]
    fn cambio_di_periodo_continuo() {
        let g = Griglia::nuova(0, P180);
        let ora = 10 * P180 + 7;
        let h = g.con_periodo(ora, 16_666_666);
        assert_eq!(h.conta(ora), 10);
        assert_eq!(h.scadenza(10), 10 * P180);
        assert_eq!(h.scadenza(11), 10 * P180 + 16_666_666);
    }

    #[test]
    fn bersaglio_relativo() {
        let g = Griglia::nuova(0, P180);
        let ora = 5 * P180 + 100;
        // 0: il corrente, senza attesa (la prova di WebKit).
        assert_eq!(bersaglio(&g, ora, Richiesta::Relativa(0)), Some(5));
        // 1: il prossimo (il tick di WebKit).
        assert_eq!(bersaglio(&g, ora, Richiesta::Relativa(1)), Some(6));
        assert_eq!(bersaglio(&g, ora, Richiesta::Relativa(3)), Some(8));
    }

    #[test]
    fn bersaglio_assoluto() {
        let g = Griglia::nuova(0, P180);
        let ora = 5 * P180 + 100;
        assert_eq!(bersaglio(&g, ora, Richiesta::Assoluta(7)), Some(7));
        // Già passato: nessuna attesa, il corrente.
        assert_eq!(bersaglio(&g, ora, Richiesta::Assoluta(2)), Some(5));
        assert_eq!(bersaglio(&g, ora, Richiesta::Assoluta(5)), Some(5));
        // Un numero «nel futuro» oltre i 3 s non si emula.
        assert_eq!(bersaglio(&g, ora, Richiesta::Assoluta(5 + 10_000)), None);
    }

    /// Il contatore a 32 bit gira come nel kernel.
    #[test]
    fn bersaglio_al_giro_del_contatore() {
        let g = Griglia {
            origine_ns: 0,
            periodo_ns: P180,
            base: u64::from(u32::MAX) - 1,
        };
        let ora = P180 / 2;
        assert_eq!(
            bersaglio(&g, ora, Richiesta::Relativa(2)),
            Some(u64::from(u32::MAX) + 1)
        );
        assert_eq!(
            bersaglio(&g, ora, Richiesta::Assoluta(0)),
            Some(u64::from(u32::MAX) + 1)
        );
    }

    #[test]
    fn la_risposta_ha_i_tempi_del_kernel() {
        let r = risposta(
            RELATIVA | SECONDARIO,
            u64::from(u32::MAX) + 3,
            12_345_678_901,
        );
        assert_eq!(r.tipo, SECONDARIO);
        assert_eq!(r.sequenza, 2);
        assert_eq!(r.tval_sec, 12);
        assert_eq!(r.tval_usec, 345_678);
    }

    #[test]
    fn intervallo_di_versioni() {
        assert!(!versione_coperta((2, 52, 6)));
        assert!(!versione_coperta((2, 53, 99)));
        assert!(versione_coperta((2, 54, 0)));
        assert!(versione_coperta((2, 56, 1)));
    }

    #[test]
    fn interruttore() {
        assert!(interruttore_acceso(None));
        assert!(interruttore_acceso(Some(OsStr::new("1"))));
        assert!(interruttore_acceso(Some(OsStr::new(""))));
        assert!(!interruttore_acceso(Some(OsStr::new("0"))));
        assert!(!interruttore_acceso(Some(OsStr::new(" 0 "))));
    }

    /// Spenta dall'interruttore o fuori versione, la decisione lo dice; in un
    /// binario di test il simbolo non è esportato, quindi non è interposta.
    #[test]
    fn decisione_all_avvio() {
        assert_eq!(
            prepara(Some("2.54.0"), Some(OsStr::new("0"))),
            Avvio::Spenta
        );
        assert_eq!(
            prepara(Some("2.52.6"), None),
            Avvio::VersioneFuori("2.52.6".into())
        );
        assert_eq!(prepara(Some("boh"), None), Avvio::VersioneIgnota);
        assert_eq!(prepara(None, None), Avvio::VersioneIgnota);
        assert_eq!(prepara(Some("2.54.0"), None), Avvio::NonInterposta);
        assert!(!ATTIVA.load(Ordering::Acquire));
    }

    /// La memoria di `drmVBlank` e delle strutture di libdrm su 64 bit:
    /// richiesta e risposta coincidono (16 + 8 byte).
    #[test]
    fn disposizione_in_memoria() {
        assert_eq!(std::mem::size_of::<DrmVBlank>(), 24);
        assert_eq!(std::mem::size_of::<RichiestaVBlank>(), 16);
        assert_eq!(std::mem::size_of::<RispostaVBlank>(), 24);
        // ModeInfo 68, Crtc 100, Res 80 su 64 bit (`sizeof` delle stesse
        // strutture in C, compilate su x86_64).
        if cfg!(target_pointer_width = "64") {
            assert_eq!(drm::dimensioni(), (68, 100, 80));
        }
    }
}

//! L'estensione web della raccolta forzata, soltanto per il banco della memoria
//! (R1, #284).
//!
//! WebKitGTK 4.1 non dà al processo dell'app un modo per far raccogliere la
//! memoria al processo della WebView: lo si può fare soltanto da dentro, e
//! questa estensione lo fa. Il banco la costruisce con `rustc`, senza Cargo né
//! dipendenze (`memory.mjs`, `buildCollector`), e l'app la carica soltanto se
//! `FUB_BENCH_GC` nomina la sua cartella (`crates/fub-app/src/bench_gc.rs`).
//! Non entra nell'app che si distribuisce.
//!
//! Dà alla pagina `window.__fubBenchGc(parti)`, che torna quando ha finito:
//!
//! - `1`: una raccolta piena e sincrona di JavaScriptCore;
//! - `2`: il rilascio della memoria che WebKit fa da sé sotto memoria scarsa
//!   (`WTF::MemoryPressureHandler::releaseMemory`, critico e sincrono): le
//!   cache, il codice compilato e la memoria libera dell'allocatore di WebKit;
//! - `4`: `malloc_trim(0)`, la memoria libera di glibc restituita al sistema.
//!
//! `0`, o nessun argomento, vuol dire tutto. Torna le parti fatte: un simbolo
//! che questa WebKitGTK non esporta si salta invece di impedire all'estensione
//! di caricarsi. Le funzioni di WebKit, JavaScriptCore e GLib le risolve il
//! processo della WebView, che le ha già caricate.

use std::ffi::{c_char, c_int, c_uint, c_ulong, c_void};
use std::sync::atomic::{AtomicPtr, Ordering};

/// `G_TYPE_INT` di GLib.
const G_TYPE_INT: usize = 6 << 2;

const GC: c_int = 1;
const RELEASE: c_int = 2;
const TRIM: c_int = 4;
const ALL: c_int = GC | RELEASE | TRIM;

unsafe extern "C" {
    fn webkit_script_world_get_default() -> *mut c_void;
    fn webkit_frame_is_main_frame(frame: *mut c_void) -> c_int;
    fn webkit_frame_get_js_context_for_script_world(
        frame: *mut c_void,
        world: *mut c_void,
    ) -> *mut c_void;
    fn g_signal_connect_data(
        instance: *mut c_void,
        signal: *const c_char,
        handler: *const c_void,
        data: *mut c_void,
        destroy: *const c_void,
        flags: c_uint,
    ) -> c_ulong;
    fn jsc_value_new_function(
        context: *mut c_void,
        name: *const c_char,
        callback: *const c_void,
        data: *mut c_void,
        destroy: *const c_void,
        return_type: usize,
        n_parameters: c_uint,
        ...
    ) -> *mut c_void;
    fn jsc_context_set_value(context: *mut c_void, name: *const c_char, value: *mut c_void);
    fn g_object_unref(object: *mut c_void);
    fn malloc_trim(pad: usize) -> c_int;
    fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
}

/// Il contesto JavaScript della pagina principale, per la raccolta.
static PAGE: AtomicPtr<c_void> = AtomicPtr::new(std::ptr::null_mut());

/// Un simbolo del processo, se c'è.
fn symbol(name: &std::ffi::CStr) -> Option<*mut c_void> {
    // SAFETY: `RTLD_DEFAULT` (il puntatore nullo) cerca fra le librerie già
    // caricate; il nome è una stringa C valida.
    let found = unsafe { dlsym(std::ptr::null_mut(), name.as_ptr()) };
    (!found.is_null()).then_some(found)
}

extern "C" fn collect(parts: c_int, _data: *mut c_void) -> c_int {
    let parts = if parts == 0 { ALL } else { parts };
    let mut done = 0;
    if parts & GC != 0 {
        let page = PAGE.load(Ordering::Acquire);
        if let (false, Some(gc)) = (
            page.is_null(),
            symbol(c"JSSynchronousGarbageCollectForDebugging"),
        ) {
            // SAFETY: la firma è quella di `JavaScriptCore/JSBasePrivate.h`, e
            // `page` è il contesto vivo della pagina che sta chiamando.
            let gc: extern "C" fn(*mut c_void) = unsafe { std::mem::transmute(gc) };
            gc(page);
            done |= GC;
        }
    }
    if parts & RELEASE != 0
        && let (Some(singleton), Some(release)) = (
            symbol(c"_ZN3WTF21MemoryPressureHandler9singletonEv"),
            symbol(c"_ZN3WTF21MemoryPressureHandler13releaseMemoryENS_8CriticalENS_11SynchronousE"),
        )
    {
        // SAFETY: `MemoryPressureHandler::singleton()` e
        // `releaseMemory(Critical, Synchronous)`, con i due enum di un byte;
        // si chiamano dal thread principale, come fa WebKit.
        let singleton: extern "C" fn() -> *mut c_void = unsafe { std::mem::transmute(singleton) };
        let release: extern "C" fn(*mut c_void, bool, bool) =
            unsafe { std::mem::transmute(release) };
        release(singleton(), true, true);
        done |= RELEASE;
    }
    if parts & TRIM != 0 {
        // SAFETY: glibc, senza argomenti da verificare.
        unsafe { malloc_trim(0) };
        done |= TRIM;
    }
    done
}

extern "C" fn window_object_cleared(
    world: *mut c_void,
    _page: *mut c_void,
    frame: *mut c_void,
    _data: *mut c_void,
) {
    // SAFETY: gli argomenti sono quelli del segnale `window-object-cleared` di
    // `WebKitScriptWorld`, vivi per tutta la chiamata.
    unsafe {
        if webkit_frame_is_main_frame(frame) == 0 {
            return;
        }
        let context = webkit_frame_get_js_context_for_script_world(frame, world);
        if context.is_null() {
            return;
        }
        let global = symbol(c"webkit_frame_get_javascript_context_for_script_world").map(|get| {
            let get: extern "C" fn(*mut c_void, *mut c_void) -> *mut c_void =
                std::mem::transmute(get);
            get(frame, world)
        });
        PAGE.store(global.unwrap_or(std::ptr::null_mut()), Ordering::Release);
        let function = jsc_value_new_function(
            context,
            c"__fubBenchGc".as_ptr(),
            collect as *const c_void,
            std::ptr::null_mut(),
            std::ptr::null(),
            G_TYPE_INT,
            1,
            G_TYPE_INT,
        );
        jsc_context_set_value(context, c"__fubBenchGc".as_ptr(), function);
        g_object_unref(function);
        g_object_unref(context);
    }
}

/// Il punto d'ingresso che WebKitGTK chiama quando carica l'estensione.
#[unsafe(no_mangle)]
pub extern "C" fn webkit_web_extension_initialize(_extension: *mut c_void) {
    // SAFETY: il mondo predefinito vive quanto il processo; il gestore ha la
    // firma del segnale.
    unsafe {
        g_signal_connect_data(
            webkit_script_world_get_default(),
            c"window-object-cleared".as_ptr(),
            window_object_cleared as *const c_void,
            std::ptr::null_mut(),
            std::ptr::null(),
            0,
        );
    }
}

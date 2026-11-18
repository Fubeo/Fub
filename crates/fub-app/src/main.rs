// Evita una seconda console su Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    fub_app_lib::run();
}

/// Il `drmWaitVBlank` del processo dell'app, al posto di quello di libdrm
/// (ADR 0246). Il build script lo mette nella tabella dei simboli dinamici
/// dell'eseguibile, così il linker dinamico lo trova prima di libdrm quando
/// WebKitGTK lo chiama. Sta qui e non nella libreria perché solo l'oggetto
/// dell'eseguibile è sempre collegato per intero.
///
/// # Safety
///
/// È il contratto di `drmWaitVBlank` di libdrm: `vbl` punta a un `drmVBlank`
/// valido e scrivibile per tutta la chiamata.
#[cfg(target_os = "linux")]
#[no_mangle]
#[allow(non_snake_case)]
pub unsafe extern "C" fn drmWaitVBlank(
    fd: std::ffi::c_int,
    vbl: *mut fub_app_lib::vblank::DrmVBlank,
) -> std::ffi::c_int {
    // SAFETY: gli argomenti di chi chiama, con lo stesso contratto.
    unsafe { fub_app_lib::vblank::drm_wait_vblank(fd, vbl) }
}

/// Il `gtk_clipboard_request_targets` del processo dell'app, al posto di
/// quello di GTK: WebKitGTK muore se gli appunti non hanno proprietario
/// (`appunti_gtk.rs`). Esportato come `drmWaitVBlank`, e qui per la stessa
/// ragione.
///
/// # Safety
///
/// È il contratto di `gtk_clipboard_request_targets` di GTK 3: `clipboard` è
/// un `GtkClipboard` valido; GTK chiama `callback` una volta con `user_data`.
#[cfg(target_os = "linux")]
#[no_mangle]
pub unsafe extern "C" fn gtk_clipboard_request_targets(
    clipboard: *mut fub_app_lib::appunti_gtk::GtkClipboard,
    callback: Option<fub_app_lib::appunti_gtk::TipiRicevuti>,
    user_data: *mut std::ffi::c_void,
) {
    // SAFETY: gli argomenti di chi chiama, con lo stesso contratto.
    unsafe {
        fub_app_lib::appunti_gtk::gtk_clipboard_request_targets(clipboard, callback, user_data)
    }
}

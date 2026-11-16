//! Il tetto dei fotogrammi della webview (`appearance.frame-rate`).
//!
//! La shell rispetta da sé il tetto nei loop che disegna; qui resta ciò che la
//! pagina non può fare. Su macOS 13–15 WebKit tiene la pagina a 60 Hz anche su
//! uno schermo ProMotion, con la preferenza interna
//! `PreferPageRenderingUpdatesNear60FPSEnabled`. Senza tetto (il default) o con
//! un tetto sopra i 60 la si spegne e la webview segue lo schermo; con un tetto
//! fino a 60 resta accesa, che è anche il modo più economico di rispettarlo.
//!
//! Su macOS è un'API privata di WebKit, cercata a runtime: dove WebKit non la
//! espone non succede niente, e da macOS 26 la preferenza è ignorata perché il
//! limite non c'è più. Un'app per il Mac App Store dovrebbe toglierla.
//!
//! Su Linux la stessa preferenza esiste in WebKitGTK, accesa di serie, e porta
//! uno schermo a 144 Hz a 72 Hz (WebKit PR 78603). Lì è una feature pubblica
//! (`webkit_settings_set_feature_enabled`, dalla 2.42): i simboli si cercano a
//! runtime con `dlsym`, così un WebKitGTK più vecchio fa partire l'app lo
//! stesso e la pagina resta al suo ritmo. Conta solo dove WebKit si aggancia
//! al vblank DRM; dove ripiega sul timer fisso a 60 Hz il tetto resta quello.
//! WebView2 segue già il refresh dello schermo e non ha niente da regolare.

use fub_abi::settings::SettingEntry;
use tauri::{AppHandle, Manager, Runtime, Webview};

/// La webview può seguire lo schermo oltre i 60 Hz? Sì senza tetto, o con un
/// tetto sopra i 60.
pub fn beyond_60(machine: &[SettingEntry]) -> bool {
    let value = machine
        .iter()
        .find(|entry| entry.spec.key == fub_host::settings::APPEARANCE_FRAME_RATE)
        .and_then(|entry| entry.value.as_text())
        .unwrap_or_default();
    fub_host::settings::frame_rate_cap(value).is_none_or(|cap| cap > 60)
}

/// Porta il tetto su ogni finestra aperta: dopo che l'utente l'ha cambiato, o
/// dopo un cambio di profilo.
pub fn apply_all<R: Runtime>(app: &AppHandle<R>, beyond_60: bool) {
    for window in app.webview_windows().into_values() {
        apply(window.as_ref(), beyond_60);
    }
}

/// Porta il tetto su una webview. Un errore non ferma niente: la pagina resta
/// al ritmo che WebKit sceglie da sé.
pub fn apply<R: Runtime>(webview: &Webview<R>, beyond_60: bool) {
    #[cfg(target_os = "macos")]
    if let Err(error) = webview.with_webview(move |platform| {
        // SAFETY: `inner` è il `WKWebView` vivo di questa webview, e
        // `with_webview` chiama sul thread principale, l'unico da cui AppKit
        // e WebKit si toccano.
        unsafe { macos::prefer_60_fps(platform.inner(), !beyond_60) }
    }) {
        tracing::debug!(%error, "frame rate cap not applied to the webview");
    }
    #[cfg(target_os = "linux")]
    if let Err(error) = webview.with_webview(move |platform| {
        let esito = linux::prefer_60_fps(&platform.inner(), !beyond_60);
        tracing::info!(
            target: "fub.app",
            feature = linux::FEATURE_NAME,
            enabled = !beyond_60,
            ?esito,
            "WebKitGTK 60 fps preference"
        );
    }) {
        tracing::debug!(%error, "frame rate cap not applied to the webview");
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    let _ = (webview, beyond_60);
}

#[cfg(target_os = "linux")]
mod linux {
    use std::ffi::{c_char, c_int, c_void, CStr};

    use webkit2gtk::glib::object::ObjectType;
    use webkit2gtk::WebViewExt;

    /// L'identificatore in WebKitGTK: la chiave delle preferenze
    /// (`PreferPageRenderingUpdatesNear60FPSEnabled`, come su macOS) senza il
    /// suffisso `Enabled`, che l'API delle feature toglie. Verificato su
    /// WebKitGTK 2.54 (`webkit_settings_get_all_features`, stato «stable»,
    /// default acceso). La chiave intera resta accettata, per un WebKit che
    /// la esponesse così.
    pub const FEATURE_NAME: &str = "PreferPageRenderingUpdatesNear60FPS";

    /// È la feature del limite a 60 Hz?
    pub fn e_la_feature(id: &CStr) -> bool {
        let id = id.to_bytes();
        id == FEATURE_NAME.as_bytes() || id == b"PreferPageRenderingUpdatesNear60FPSEnabled"
    }

    /// Com'è andata, per il log.
    #[derive(Debug, PartialEq, Eq)]
    pub enum Esito {
        Applicata,
        /// WebKitGTK prima della 2.42: niente API delle feature.
        SenzaApi,
        /// L'API c'è ma la feature no (un WebKit che l'ha tolta o rinominata).
        FeatureAssente,
        SenzaImpostazioni,
    }

    extern "C" {
        /// Da libc (in libdl prima di glibc 2.34, che GTK porta comunque).
        fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    }

    type GetAll = unsafe extern "C" fn() -> *mut c_void;
    type Length = unsafe extern "C" fn(*mut c_void) -> usize;
    type Get = unsafe extern "C" fn(*mut c_void, usize) -> *mut c_void;
    type Identifier = unsafe extern "C" fn(*mut c_void) -> *const c_char;
    type SetEnabled = unsafe extern "C" fn(*mut c_void, *mut c_void, c_int);
    type Unref = unsafe extern "C" fn(*mut c_void);

    /// Un simbolo già caricato nel processo (`RTLD_DEFAULT`, che è `NULL`).
    ///
    /// # Safety
    ///
    /// `T` è un puntatore a funzione con la firma C del simbolo.
    unsafe fn simbolo<T: Copy>(nome: &CStr) -> Option<T> {
        // SAFETY: `dlsym` con un nome terminato da zero; un puntatore non
        // nullo è l'indirizzo della funzione, che chi chiama tipizza.
        let indirizzo = unsafe { dlsym(std::ptr::null_mut(), nome.as_ptr()) };
        (!indirizzo.is_null()).then(|| unsafe { std::mem::transmute_copy(&indirizzo) })
    }

    /// Accende o spegne il limite a 60 Hz delle `WebKitSettings` della
    /// webview. Va chiamata sul thread principale (`with_webview`).
    pub fn prefer_60_fps(webview: &webkit2gtk::WebView, prefer: bool) -> Esito {
        let Some(settings) = WebViewExt::settings(webview) else {
            return Esito::SenzaImpostazioni;
        };
        // SAFETY: ogni simbolo ha la firma di `WebKitSettings.h` e
        // `WebKitFeature.h` (2.42). La lista è nostra (transfer full) e si
        // rilascia; le feature e i loro identificatori sono della lista
        // (transfer none) e non la sopravvivono. `settings` è vivo per tutta
        // la chiamata.
        unsafe {
            let (
                Some(get_all),
                Some(length),
                Some(get),
                Some(identifier),
                Some(set_enabled),
                Some(unref),
            ) = (
                simbolo::<GetAll>(c"webkit_settings_get_all_features"),
                simbolo::<Length>(c"webkit_feature_list_get_length"),
                simbolo::<Get>(c"webkit_feature_list_get"),
                simbolo::<Identifier>(c"webkit_feature_get_identifier"),
                simbolo::<SetEnabled>(c"webkit_settings_set_feature_enabled"),
                simbolo::<Unref>(c"webkit_feature_list_unref"),
            )
            else {
                return Esito::SenzaApi;
            };
            let list = get_all();
            if list.is_null() {
                return Esito::FeatureAssente;
            }
            let feature = (0..length(list))
                .map(|index| get(list, index))
                .find(|feature| {
                    if feature.is_null() {
                        return false;
                    }
                    let id = identifier(*feature);
                    !id.is_null() && e_la_feature(CStr::from_ptr(id))
                });
            let esito = match feature {
                Some(feature) => {
                    set_enabled(settings.as_ptr().cast(), feature, c_int::from(prefer));
                    Esito::Applicata
                }
                None => Esito::FeatureAssente,
            };
            unref(list);
            esito
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    /// Il nome che WebKitGTK 2.54 dà davvero alla feature (letto dal vivo con
    /// `webkit_settings_get_all_features`): con la sola chiave delle
    /// preferenze la feature non si trovava e il limite restava acceso.
    #[test]
    fn la_feature_ha_il_nome_di_webkitgtk() {
        assert!(super::linux::e_la_feature(
            c"PreferPageRenderingUpdatesNear60FPS"
        ));
        assert!(super::linux::e_la_feature(
            c"PreferPageRenderingUpdatesNear60FPSEnabled"
        ));
        assert!(!super::linux::e_la_feature(c"PreferPageRenderingUpdates"));
        assert!(!super::linux::e_la_feature(c"UseGPUProcessForDOMRendering"));
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::{c_char, c_void, CStr};

    use objc2::runtime::{AnyObject, Bool};
    use objc2::{msg_send, sel};

    const FEATURE: &CStr = c"PreferPageRenderingUpdatesNear60FPSEnabled";

    /// Accende o spegne il limite a 60 Hz delle `WKPreferences` della webview.
    ///
    /// La preferenza ha cambiato lista fra le versioni di WebKit: `_features`
    /// da macOS 14, le liste sperimentale e interna prima. Si prova la prima
    /// che la contiene, e ogni selettore si chiede prima di usarlo.
    ///
    /// # Safety
    ///
    /// `webview` è un `WKWebView` vivo, e la chiamata avviene sul thread
    /// principale.
    pub unsafe fn prefer_60_fps(webview: *mut c_void, prefer: bool) {
        objc2::rc::autoreleasepool(|_| unsafe {
            let Some(webview) = webview.cast::<AnyObject>().as_ref() else {
                return;
            };
            let configuration: *mut AnyObject = msg_send![webview, configuration];
            let Some(configuration) = configuration.as_ref() else {
                return;
            };
            let preferences: *mut AnyObject = msg_send![configuration, preferences];
            let Some(preferences) = preferences.as_ref() else {
                return;
            };
            let class = preferences.class();
            let flag = Bool::new(prefer);

            if responds(class.as_ref(), sel!(_features))
                && responds(preferences, sel!(_setEnabled:forFeature:))
            {
                let features: *mut AnyObject = msg_send![class, _features];
                if let Some(feature) = find(features) {
                    let _: () = msg_send![preferences, _setEnabled: flag, forFeature: feature];
                    return;
                }
            }
            if responds(class.as_ref(), sel!(_experimentalFeatures))
                && responds(preferences, sel!(_setEnabled:forExperimentalFeature:))
            {
                let features: *mut AnyObject = msg_send![class, _experimentalFeatures];
                if let Some(feature) = find(features) {
                    let _: () =
                        msg_send![preferences, _setEnabled: flag, forExperimentalFeature: feature];
                    return;
                }
            }
            if responds(class.as_ref(), sel!(_internalDebugFeatures))
                && responds(preferences, sel!(_setEnabled:forInternalDebugFeature:))
            {
                let features: *mut AnyObject = msg_send![class, _internalDebugFeatures];
                if let Some(feature) = find(features) {
                    let _: () =
                        msg_send![preferences, _setEnabled: flag, forInternalDebugFeature: feature];
                }
            }
        });
    }

    /// `respondsToSelector:`, che su una classe chiede dei metodi di classe.
    unsafe fn responds(receiver: &AnyObject, selector: objc2::runtime::Sel) -> bool {
        let answer: Bool = unsafe { msg_send![receiver, respondsToSelector: selector] };
        answer.as_bool()
    }

    /// La voce di `FEATURE` in un `NSArray` di `_WKFeature`.
    unsafe fn find<'a>(features: *mut AnyObject) -> Option<&'a AnyObject> {
        let features = unsafe { features.as_ref() }?;
        let count: usize = unsafe { msg_send![features, count] };
        (0..count).find_map(|index| {
            let feature: *mut AnyObject = unsafe { msg_send![features, objectAtIndex: index] };
            let feature = unsafe { feature.as_ref() }?;
            let key: *mut AnyObject = unsafe { msg_send![feature, key] };
            let key = unsafe { key.as_ref() }?;
            let utf8: *const c_char = unsafe { msg_send![key, UTF8String] };
            (!utf8.is_null() && unsafe { CStr::from_ptr(utf8) } == FEATURE).then_some(feature)
        })
    }
}

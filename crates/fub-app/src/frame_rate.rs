//! Il tetto dei fotogrammi della webview (`appearance.frame-rate`).
//!
//! La shell rispetta da sé il tetto nei loop che disegna; qui resta ciò che la
//! pagina non può fare. Su macOS 13–15 WebKit tiene la pagina a 60 Hz anche su
//! uno schermo ProMotion, con la preferenza interna
//! `PreferPageRenderingUpdatesNear60FPSEnabled`. Senza tetto (il default) o con
//! un tetto sopra i 60 la si spegne e la webview segue lo schermo; con un tetto
//! fino a 60 resta accesa, che è anche il modo più economico di rispettarlo.
//!
//! È un'API privata di WebKit, cercata a runtime: dove WebKit non la espone non
//! succede niente, e da macOS 26 la preferenza è ignorata perché il limite non
//! c'è più. Un'app per il Mac App Store dovrebbe toglierla. WebView2 e
//! WebKitGTK seguono già il refresh dello schermo e non hanno niente da
//! regolare.

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
    #[cfg(not(target_os = "macos"))]
    let _ = (webview, beyond_60);
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

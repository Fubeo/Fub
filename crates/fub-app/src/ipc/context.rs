//! Comandi IPC del contesto attivo e della lingua del sistema.

use super::*;

// Le cinque azioni STRUTTURALI — crea, rinomina, cestina, ripristina, svuota —
// non sono più comandi Tauri: sono comandi del registro (decisione 0009), serviti da
// `CoreCommands` attraverso le capacità della decisione 0013, e la shell li invoca con
// `invoke_command` come li invocherebbe una CLI o un plugin.
//
// È ciò che rende vera la regola del §16.6 — "una feature nuova non deve poter
// aggiungere un comando Tauri" — che finché quelle cinque stavano qui valeva
// solo per le feature che non toccano il vault.
//
// E adesso non restano nemmeno le due LETTURE che il giro si era tenuto —
// `list_trash` e `propose_free_name`. Non sono state migrate: sono rimaste
// **senza chiamante**. Le chiedeva il pannello cestino di questa shell, che dal
// §1.2 è un `ViewProvider` e le chiede dall'altro lato del confine, dove sono
// due capacità del contratto (`VaultRead::list_trash`, `VaultRead::free_name`)
// e non due porte. Una porta che nessuno attraversa è una promessa che nessuno
// mantiene: il modo giusto di reggerla è toglierla, e rimetterla il giorno che
// qualcuno di qua abbia di nuovo quella domanda.

// `render_preview` e `render_embed` (0163) non sono più qui: sono passati al
// canale dati (`query_index` con `IndexQuery::RenderPreview` /
// `IndexQuery::RenderEmbed`), come l'outline e ogni altra lettura. Un fatto
// sul vault che solo la shell sapeva chiedere è adesso una domanda del canale
// di tutti — un `ViewProvider` che volesse mostrare un documento reso ce l'ha,
// e la shell non è più l'unica.

// --- view dichiarative (protocollo generico) -------------------------------
//
// Il canale core→UI dei `ViewProvider`: la shell chiede l'albero di una view e
// rimanda le azioni al provider, senza sapere cosa la view faccia. Il pannello
// backlink passa di qui come dovrà passarci un plugin — nessun comando ad-hoc
// per feature. L'enforcement del confine di fiducia (`Html`/`WebView` solo dal
// codice fidato) è dentro `render_view`/`view_action`, in un punto solo.

/// Contesto del pannello con il focus: quale nota, cosa c'è selezionato, in che
/// modalità. Lo pubblica la shell a ogni navigazione, movimento del cursore o
/// cambio di modalità; le view lo leggono via `HostEnv::active_context`.
///
/// Restituisce **gli id delle view da ridisegnare** — quelle la cui
/// `ViewSpec.follows` interseca ciò che è cambiato. Il conto lo fa il kernel e
/// non la shell perché la regola deve essere una sola: la shell sa *quando*
/// pubblicare, non *chi* segue cosa. `None` = nessun pannello (all'avvio, o
/// dopo che l'ultima nota è stata chiusa).
///
/// Gira nella corsia del contesto (`domande::CORSIA_CONTESTO`): la shell
/// pubblica senza aspettare la risposta di prima, e in fila l'ultima
/// pubblicazione resta l'ultima anche fuori dal thread principale.
#[tauri::command]
pub(crate) async fn set_active_context(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    context: Option<ViewContext>,
    vault: Option<String>,
) -> Result<Vec<String>, PluginError> {
    set_active_context_in_lane(app, &corsie, context, vault).await
}

pub(crate) async fn set_active_context_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    context: Option<ViewContext>,
    vault: Option<String>,
) -> Result<Vec<String>, PluginError> {
    host_lane(
        source,
        corsie,
        "active context",
        domande::CORSIA_CONTESTO,
        move |host| host.set_active_context(vault.as_deref(), context),
    )
    .await
}

/// La shell riporta cosa il **sistema** dice: lingua, fuso, calendario (§12.3).
///
/// Lo pubblica la webview perché è l'unica che lo sappia davvero — `Intl` porta
/// un ICU intero, il lato Rust avrebbe bisogno di un database dei fusi orari per
/// dare una risposta peggiore — e lo pubblica **una volta per tutti i vault**:
/// la lingua di chi guarda non è di un vault, a differenza del contesto di
/// pannello qui sopra. Ciò che l'utente ha scelto nelle chiavi `locale.*` sta
/// sopra a questo, e le due cose le compone il kernel.
///
/// Restituisce `true` se qualcosa è cambiato: la shell ridisegna solo allora.
#[tauri::command]
pub(crate) fn set_system_locale(host: State<Host>, locale: Locale) -> bool {
    host.publish_locale(locale)
}

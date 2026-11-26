//! Comandi IPC del registro dei comandi: elencare e invocare.

use super::*;

// --- comandi (protocollo generico) -----------------------------------------
//
// L'altro giro discovery+invoke accanto a quello delle view, e la ragione per
// cui questo file non deve più crescere di un comando Tauri per feature (§16.6):
// un'azione nuova si dichiara in un `CommandProvider` e arriva alla palette da
// sola, con i suoi parametri e il suo raggio.

/// I comandi offerti dai provider registrati.
///
/// La shell non ne cabla nessuno: disegna ciò che legge, chiede i parametri che
/// la spec dichiara e decide se chiedere conferma dal raggio dichiarato. Sono
/// le stesse informazioni che leggerebbero una CLI (27.1) o un chiamante
/// programmatico (22.4) — questo comando IPC è solo il primo dei suoi clienti.
/// Fuori dal thread principale (`host_read`).
#[tauri::command]
pub(crate) async fn list_commands(
    app: AppHandle,
    vault: Option<String>,
) -> Result<Vec<CommandSpec>, PluginError> {
    host_read(app, "command list", move |host| {
        host.commands(vault.as_deref())
    })
    .await
}

/// Esegue — o simula — un comando.
///
/// `mode` assente significa `apply`: è la scelta di **questo** confine, non del
/// contratto (dove un default non esiste apposta). Il webview è codice nostro e
/// il caso normale è eseguire; chi vuole il piano lo chiede, e riceve un
/// `CommandOutcome` con dentro l'effetto `plan`.
///
/// L'attore è [`Actor::User`] e **non** un parametro dell'IPC: da questo canale
/// passa la persona davanti allo schermo, per il tramite della webview, e
/// lasciare che il chiamante si dichiarasse chi vuole avrebbe reso l'origine una
/// stringa di cortesia — un'automazione (16.2) che potesse firmarsi "utente"
/// aggirerebbe l'unica difesa che 16.2 ha. Gli altri chiamanti del registro (la
/// CLI di 27.1, l'API locale di 27.2) sono canali diversi e diranno il proprio
/// attore là dove passano.
/// Anche `trash.os` passa da qui: la scelta è esplicita nel comando e
/// l'esito `effect.custom` distingue cestino OS e fallback interno, senza
/// introdurre un'altra porta Tauri o un writer della shell.
///
/// Un comando può durare secondi (la pagina web da catturare, l'esportazione
/// di una cartella, un plugin): gira nella corsia dei comandi
/// (`domande::CORSIA_COMANDI`), e due comandi mandati di fila si applicano in
/// quell'ordine, come sul thread principale.
#[tauri::command]
pub(crate) async fn invoke_command(
    app: AppHandle,
    corsie: State<'_, domande::Corsie>,
    command: String,
    args: Option<serde_json::Value>,
    mode: Option<InvokeMode>,
    vault: Option<String>,
) -> Result<CommandOutcome, PluginError> {
    invoke_command_in_lane(app, &corsie, command, args, mode, vault).await
}

pub(crate) async fn invoke_command_in_lane(
    source: impl HostSource,
    corsie: &domande::Corsie,
    command: String,
    args: Option<serde_json::Value>,
    mode: Option<InvokeMode>,
    vault: Option<String>,
) -> Result<CommandOutcome, PluginError> {
    host_lane(
        source,
        corsie,
        "command",
        domande::CORSIA_COMANDI,
        move |host| {
            host.invoke_user_command(
                vault.as_deref(),
                &command,
                args.unwrap_or(serde_json::Value::Null),
                mode.unwrap_or(InvokeMode::Apply),
            )
        },
    )
    .await
}

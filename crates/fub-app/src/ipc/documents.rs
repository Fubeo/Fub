//! Comandi IPC dei documenti: lettura, scrittura, bozze e chiusura.

use super::*;

// `list_documents` **non è più un comando** (§14.4). Era l'ultimo dato che la
// shell chiedeva fuori da `IndexQuery`, e la finestra che il contratto ha dal
// §5.5 questo confine non l'ha mai usata: restituiva l'intero vault in un
// `Vec<String>`, e chi disegnava venti righe ne riceveva diecimila. Chi vuole
// l'elenco lo chiede con `IndexQuery::Entries`, che la specie la sceglie e la
// pagina la taglia — e per cartella, che è ciò che serve a un albero.
//
// La **capacità** omonima resta dov'era (`VaultRead::list_documents`): quella
// la `Page` la prende, ed è l'elenco dei plugin, non quello della shell.

/// Il sorgente di un documento, la revisione che lo nomina e i metadati con
/// cui la shell sceglie la superficie (§18.1, §11.4): rispecchiato da
/// `DocumentSource` in `apps/client/src/host/contract.ts`.
///
/// Viaggiano **insieme**: chi apre il documento deve sia salvarlo contro la
/// revisione letta, sia montare la superficie dichiarata dal registro dei
/// formati. Separarli in più porte aggiungerebbe un viaggio IPC e potrebbe
/// associare al buffer metadati letti dopo un cambio di registro.
#[derive(serde::Serialize)]
pub struct DocumentSource {
    pub text: String,
    pub revision: String,
    pub format_id: Option<String>,
    pub source_kind: SourceKind,
    /// `grid_journal` per una cartella di Excel: il testo è il giornale delle
    /// celle cambiate, e i byte si leggono soltanto dalla griglia.
    pub text_kind: DocumentText,
}

/// Il lavoro di un comando sui documenti fuori dal thread principale: aprire
/// o salvare un `.docx` grande legge, proietta e misura il pacchetto, e sul
/// thread principale fermerebbe la finestra. L'ordine fra le scritture di un
/// documento lo tiene chi le manda, la `DocumentSession` con la sua coda; una
/// lettura superata la scarta la sessione. Le bozze restano sul thread
/// principale: sono testo senza codec, e due bozze dello stesso documento
/// devono arrivare nell'ordine in cui la shell le manda.
pub(crate) async fn off_main<T, F>(app: AppHandle, work: F) -> Result<T, PluginError>
where
    T: Send + 'static,
    F: FnOnce(&Host) -> Result<T, PluginError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || work(&app.state::<Host>()))
        .await
        .map_err(|error| unfinished("document", error))?
}

/// La chiave di apertura facoltativa di `read_document` e `write_document`:
/// assente o `null` è una lettura o una scrittura semplice, e una chiave
/// malformata è `BadArgs` prima di toccare il disco (`OpenKey::parse`).
pub(crate) fn open_key(open: Option<&str>) -> Result<Option<OpenKey>, PluginError> {
    open.map(OpenKey::parse).transpose()
}

/// Legge un documento. Senza `open` è una lettura semplice: la stessa
/// proiezione e la stessa revisione, ma il documento non conta come aperto.
/// Con `open`, la chiave di una sessione della shell, la revisione letta
/// resta segnata sotto la chiave finché `document_closed` non la chiude.
#[tauri::command]
pub(crate) async fn read_document(
    app: AppHandle,
    id: String,
    vault: Option<String>,
    open: Option<String>,
) -> Result<DocumentSource, PluginError> {
    let id = doc_id(&id)?;
    let key = open_key(open.as_deref())?;
    off_main(app, move |host| {
        // Un documento che non si legge (un .docx vuoto o rotto) dice perché
        // con una chiave del core: la frase la risolve `for_the_shell`.
        let read = match &key {
            Some(key) => host.open_document_with_format(vault.as_deref(), &id, key),
            None => host.read_document_with_format(vault.as_deref(), &id),
        };
        let (text, revision, format) = for_the_shell(host, vault.as_deref(), read)?;
        let format_id = format.as_ref().map(|known| known.descriptor.id.clone());
        let text_kind = document_text(format.as_ref());
        let source_kind = format
            .map(|known| known.descriptor.source)
            .unwrap_or(SourceKind::Text);
        Ok(DocumentSource {
            text,
            revision: revision.0,
            format_id,
            source_kind,
            text_kind,
        })
    })
    .await
}

/// Scalda in sottofondo il motore che apre questa estensione: la shell lo
/// chiede quando il puntatore si ferma su un file o una cartella si apre.
/// Un'estensione senza motore, o senza un provider attivo in un vault aperto,
/// non fa niente e non è un errore (`Host::warm_engine`).
#[tauri::command]
pub(crate) async fn warm_engine(app: AppHandle, extension: String) -> Result<(), PluginError> {
    off_main(app, move |host| {
        host.warm_engine(&extension);
        Ok(())
    })
    .await
}

/// La shell ha chiuso la sessione con questa chiave di apertura: l'host
/// dimentica le prove delle sue revisioni che nessun'altra chiave tiene, e le
/// cache dei documenti quando non resta aperta nessuna chiave
/// (`Host::document_closed`). Una chiave sconosciuta o già chiusa, o un vault
/// non aperto, non sono un errore; una chiave malformata è `BadArgs`.
#[tauri::command]
pub(crate) async fn document_closed(
    app: AppHandle,
    open: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    let key = OpenKey::parse(&open)?;
    off_main(app, move |host| {
        host.document_closed(vault.as_deref(), &key)
    })
    .await
}

/// **Scrive un documento intero** dichiarando da cosa parte (§18.1, §23.11).
///
/// `base` non è opzionale, e non è una svista: un campo mancante qui è un errore
/// di deserializzazione, cioè la shell che ha dimenticato di dichiarare non
/// scrive di nascosto — smette di scrivere, e lo si vede al primo salvataggio.
/// Fino alla decisione 0092 era un `Option<String>` col default `null`, e il
/// default voleva dire «sovrascrivi comunque»: la guardia si perdeva
/// **omettendola**, che è il modo in cui una guardia non protegge nessuno.
///
/// `open` è la chiave di apertura della sessione che scrive: con la chiave,
/// la revisione sovrascritta e quella nuova restano segnate sotto la chiave,
/// che si apre se non lo era; senza, le prove che il salvataggio ha lasciato
/// e che nessuna chiave tiene si dimenticano subito.
#[tauri::command]
pub(crate) async fn write_document(
    app: AppHandle,
    id: String,
    source: String,
    base: WriteBase,
    vault: Option<String>,
    open: Option<String>,
) -> Result<String, PluginError> {
    let id = doc_id(&id)?;
    let key = open_key(open.as_deref())?;
    off_main(app, move |host| {
        // Un salvataggio rifiutato (un documento in sola lettura, una
        // riscrittura che non si rileggeva uguale) dice perché con una chiave
        // del core: la frase la risolve `for_the_shell`.
        let written = match &key {
            Some(key) => host.write_open_document(vault.as_deref(), &id, &source, base, key),
            None => host.write_document(vault.as_deref(), &id, &source, base),
        };
        for_the_shell(host, vault.as_deref(), written).map(|revision| revision.0)
    })
    .await
}

/// **Scrive la bozza di un documento** (§15.2): ciò che c'è nel buffer adesso.
///
/// Una porta e non un comando del registro, ed è la sola riga di questo file
/// dove l'assenza di una capacità è **voluta per sempre** invece che in attesa
/// di un cliente: il testo non ancora salvato è il dato più privato che un vault
/// contenga, e una `draft_write` sull'`HostApi` lo darebbe a ogni plugin
/// montato. La shell non è un plugin, e questa è la sua porta.
///
/// `base` è la revisione del file su cui il buffer sta lavorando — assente per
/// una nota mai salvata — e la manda **chi ha il buffer**, perché è l'unico a
/// sapere da quale lettura quel testo si è discostato.
///
/// Fuori dal thread principale, e senza il turno di scrittura del workspace
/// (#485): la bozza parte anche mentre un salvataggio lento è in volo, e
/// aspettarlo qui fermerebbe la finestra per tutta la sua durata. L'ordine
/// delle bozze di un documento lo tiene la coda delle bozze della sessione,
/// che non ne manda mai due insieme.
#[tauri::command]
pub(crate) async fn save_draft(
    app: AppHandle,
    id: String,
    text: String,
    base: Option<String>,
    vault: Option<String>,
) -> Result<(), PluginError> {
    let id = doc_id(&id)?;
    off_main(app, move |host| {
        host.save_draft(vault.as_deref(), &id, &text, base.map(Revision::new))
    })
    .await
}

/// **Butta la bozza di un documento**: il buffer è tornato pulito, o l'utente ha
/// scelto di scartare ciò che aveva recuperato. Fuori dal thread principale
/// come [`save_draft`], e nella stessa coda della sessione.
#[tauri::command]
pub(crate) async fn discard_draft(
    app: AppHandle,
    id: String,
    vault: Option<String>,
) -> Result<(), PluginError> {
    let id = doc_id(&id)?;
    off_main(app, move |host| host.discard_draft(vault.as_deref(), &id)).await
}

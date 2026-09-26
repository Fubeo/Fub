//! Byte reali via IPC senza JSON: comandi Tauri tipizzati, Response binaria,
//! protocollo `fub-asset:` con Range, viewer isolato guardato, deposito byte.
//!
//! # Owner-side bodies (reachability requires NativeIntegration registration)
//!
//! `ResourceTable` (in `fub-host`) tiene le chiavi con lease `Arc` (lookup prima,
//! ricontrollo dopo l'I/O, fuori lock); range e deposito li serve il kernel
//! staged (`prepare_resource_open`, `Workspace::prepare_resource_read`,
//! `Host::write_document_bytes`); `Main` implementa `ResourceHost` e
//! `ResourceWrite` su `Host` in `session.rs` e collega — tabella unica su
//! `Host` con drain per-vault, contatore globale monotono non resettabile.
//! Here are the guarded bodies for NativeIntegration to register in `lib.rs`;
//! until registered they do not expose commands or a protocol at runtime:
//!
//! - [`resource_open_cmd`] — apre via `H: ResourceHost`, torna il descrittore
//!   JSON (handle come stringa, poche centinaia di byte, mai il file;
//!   `revision: None` in apertura — open metadata, mai hash);
//! - [`resource_read_chunk_cmd`] — chunk binario come `tauri::ipc::Response`
//!   (ArrayBuffer in JS, mai array JSON di numeri), clampato a
//!   `RESOURCE_CHUNK_BYTES`, short-read leciti, vuoto = EOF;
//! - [`resource_close_cmd`] — chiusura idempotente (`Ok` anche su handle gia'
//!   assente; la Custody che non si apre e' `Internal`);
//! - [`resource_write_body`] + [`resource_write_cmd`] — deposito byte veri via
//!   `H: ResourceWrite` (puro in `fub-host`, impl Main su `Host` via
//!   `Host::write_document_bytes`): `None` = create-only atomico,
//!   `Some(Revision)` = CAS, mai `Dictated`;
//! - [`handle_asset_request`] — il corpo del protocollo `fub-asset:`: solo
//!   handle aperti, `Range` valido -> `206` con `Content-Range` misurato sul
//!   servito, `Range` insoddisfacibile -> `416` con `bytes */len`, senza
//!   `Range` -> `200` completo entro il tetto inline o errore esplicito;
//! - [`open_viewer`] / [`viewer_save`] — costruzione e isolamento del viewer;
//! - [`guard_trusted_local`] — il gate per i comandi sensibili;
//! - [`make_pdf_loader`] — il riferimento al loader pdf.js in bundle.
//!
//! # Guard dei comandi sensibili: label E origin
//!
//! I comandi che toccano byte o finestre accettano solo finestre locali
//! fidate: label `main` o `document-*` **e** origin locale dell'app
//! (`tauri://localhost`, `http(s)://tauri.localhost`). Una `main` navigata su
//! un remoto non e' fidata: la label da sola non basta. La label e l'origin
//! arrivano da `window.label()` / `window.url()` (lato nativo, non da JS):
//! una pagina remota o il viewer non possono falsificarle. La label
//! `fub-viewer` non ha alcun ponte — anche se del JS reiniettato dentro il
//! viewer chiamasse `invoke("resource_read_chunk")`, il gate risponde
//! `PermissionDenied` prima di toccare l'host. Gli eventi globali restano
//! limitati alle finestre locali fidate dalla stessa regola.

use fub_abi::edit::Revision;
use fub_abi::net::HttpRequest;
use fub_abi::traits::HostNetwork;
use fub_abi::PluginError;
use fub_host::resources::{
    ResourceDescriptor, ResourceHandle, ResourceHost, ResourceWrite, ResourceWriteReceipt,
    RESOURCE_CHUNK_BYTES, RESOURCE_MAX_INLINE_BYTES,
};

use crate::web_viewer::{
    check_viewer_address, check_viewer_url, viewer_title, ViewerOpen, VIEWER_LABEL,
};

/// L'origin e' locale all'app se e' lo schema `tauri://` o l'host di
/// workaround `tauri.localhost` su http/https (vedi `manager/mod.rs`:
/// `tauri://localhost`, `http(s)://tauri.localhost`). Tutto il resto —
/// `https://` remoto, `fub-asset:`, `about:blank`, stringhe non-URL — non e'
/// locale.
pub fn is_local_origin(origin: &str) -> bool {
    let Ok(url) = origin.parse::<tauri::Url>() else {
        return false;
    };
    if !url.username().is_empty() || url.password().is_some() || url.port().is_some() {
        return false;
    }
    (url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
}

/// Le finestre locali fidate: label della shell (`main`) o di documento
/// (`document-*`) **su origin locale**. Tutto il resto — `fub-viewer` in
/// primis, qualunque label futura non elencata, e qualunque finestra navigata
/// su un remoto — non attraversa il gate.
pub fn is_trusted_local(label: &str, origin: &str) -> bool {
    (label == "main" || label.starts_with("document-")) && is_local_origin(origin)
}

/// Il gate dei comandi sensibili, da chiamare per primo in ogni handler che
/// tocca byte o finestre. `origin` e' `window.url().as_str()` letto lato
/// nativo da NativeIntegration, mai un parametro JS.
pub fn guard_trusted_local(label: &str, origin: &str) -> Result<(), PluginError> {
    if is_trusted_local(label, origin) {
        Ok(())
    } else {
        Err(PluginError::PermissionDenied(
            format!("window `{label}` is not a trusted local shell window").into(),
        ))
    }
}

// ---------------------------------------------------------------------------
// Comandi risorse: corpi completi, NativeIntegration li registra in lib.rs.
// ---------------------------------------------------------------------------

/// Apre una risorsa: descrittore JSON, mai i byte.
pub fn resource_open_cmd<H: ResourceHost>(
    host: &H,
    window_label: &str,
    origin: &str,
    id: &str,
    vault: Option<&str>,
) -> Result<ResourceDescriptor, PluginError> {
    guard_trusted_local(window_label, origin)?;
    let id = fub_host::doc_id(id)?;
    // Il recinto (`fenced`) lo applica `resource_open` via Main/Host.
    host.resource_open(vault, &id)
}

/// Legge un chunk come risposta binaria: `InvokeResponseBody::Raw`, che in JS
/// arriva come ArrayBuffer senza passare da un array JSON di numeri.
///
/// `len` oltre il tetto non e' un errore: si serve il tetto. `len == 0` torna
/// una risposta vuota lecita. Handle ignoto o chiuso: `BadArgs`, la stessa
/// faccia di `read_source` su una sorgente altrui.
pub fn resource_read_chunk_cmd<H: ResourceHost>(
    host: &H,
    window_label: &str,
    origin: &str,
    handle: ResourceHandle,
    offset: u64,
    len: u32,
) -> Result<tauri::ipc::Response, PluginError> {
    guard_trusted_local(window_label, origin)?;
    let bytes = host.resource_read(handle, offset, len.min(RESOURCE_CHUNK_BYTES))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Chiude un handle: idempotente (`Ok` anche su handle gia' assente, che resta
/// `BadArgs` solo per chi legge); la Custody che non si apre e' `Internal`,
/// mai mascherata da chiusura riuscita.
pub fn resource_close_cmd<H: ResourceHost>(
    host: &H,
    window_label: &str,
    origin: &str,
    handle: ResourceHandle,
) -> Result<(), PluginError> {
    guard_trusted_local(window_label, origin)?;
    host.resource_close(handle)
}

/// Quanto si puo' assemblare via `readAllResource` prima di dover passare allo
/// streaming `fub-asset:` con `Range`. Non e' interrogabile (regola 0094) ma e'
/// visibile quando morde: chi supera il tetto riceve `Io` con la cifra.
pub fn check_inline_limit(total: u64) -> Result<(), PluginError> {
    if total > RESOURCE_MAX_INLINE_BYTES {
        return Err(PluginError::Io(
            format!(
                "resource is {total} bytes, above the {RESOURCE_MAX_INLINE_BYTES}-byte inline limit: \
                 stream it over fub-asset: with Range instead of assembling every chunk"
            )
            .into(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Deposito byte veri: `ResourceWrite` e' puro in `fub-host`, qui solo i corpi.
// ---------------------------------------------------------------------------

/// Nome dell'header che porta i metadati del deposito: l'unico parametro JSON
/// del comando `resource_write`. Il corpo e' i byte grezzi (`InvokeBody::Raw`),
/// i parametri stanno qui — mai gli stessi parametri anche come argomenti JSON
/// Tauri, mai i byte come numeri JSON/base64.
pub const RESOURCE_WRITE_HEADER: &str = "x-fub-resource-write";

/// Quanti byte di metadati si accettano: un header oltre e' `BadArgs` prima di
/// qualsiasi I/O (16 KiB stanno larghi su id+vault+expected, e chi li supera
/// sta mandando qualcos'altro).
pub const RESOURCE_WRITE_META_MAX_BYTES: usize = 16 * 1024;

/// I metadati del deposito, decodificati dall'header: `id` (DocId fenced),
/// `vault` opzionale, `expected` OBBLIGATORIO (`null` = create-only, stringa =
/// CAS grezza). `expected` omesso = `BadArgs`: il chiamante deve dire se sta
/// creando o ricoprendo, e un default nascosto coprirebbe per sbaglio.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResourceWriteMeta {
    pub id: String,
    pub vault: Option<String>,
    pub expected: Option<String>,
}

/// Decodifica rigorosa dei metadati: percent-decoding UTF-8 -> oggetto JSON
/// tipizzato con i soli campi `id`/`vault`/`expected` -> validazione.
/// Malformazione a qualsiasi passo (header assente, oltre tetto, percent
/// invalido, UTF-8 invalido, JSON non-oggetto, campi extra o tipi sbagliati,
/// `expected` omesso, id/vault non stringhe) = `BadArgs` prima di I/O.
pub fn decode_resource_write_meta(
    headers: &tauri::http::HeaderMap,
    body_len: usize,
) -> Result<ResourceWriteMeta, PluginError> {
    let _ = body_len;
    let raw = headers
        .get(RESOURCE_WRITE_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| {
            PluginError::BadArgs(
                format!("resource_write misses the `{RESOURCE_WRITE_HEADER}` metadata header")
                    .into(),
            )
        })?;
    if raw.len() > RESOURCE_WRITE_META_MAX_BYTES {
        return Err(PluginError::BadArgs(
            format!("resource_write metadata exceeds {RESOURCE_WRITE_META_MAX_BYTES} bytes").into(),
        ));
    }
    let decoded = percent_decode_strict(raw)?;
    let value: serde_json::Value = serde_json::from_str(&decoded).map_err(|and| {
        PluginError::BadArgs(format!("resource_write metadata is not JSON: {and}").into())
    })?;
    let object = value.as_object().ok_or_else(|| {
        PluginError::BadArgs("resource_write metadata must be a JSON object".into())
    })?;
    for key in object.keys() {
        if key != "id" && key != "vault" && key != "expected" {
            return Err(PluginError::BadArgs(
                format!("resource_write metadata has an unknown field `{key}`").into(),
            ));
        }
    }
    let id = match object.get("id") {
        Some(serde_json::Value::String(id)) => id.clone(),
        _ => {
            return Err(PluginError::BadArgs(
                "resource_write metadata needs a string `id`".into(),
            ));
        }
    };
    let vault = match object.get("vault") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(vault)) => Some(vault.clone()),
        _ => {
            return Err(PluginError::BadArgs(
                "resource_write metadata needs `vault` as string or null".into(),
            ));
        }
    };
    let expected = match object.get("expected") {
        Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(expected)) => Some(expected.clone()),
        _ => {
            return Err(PluginError::BadArgs(
                "resource_write metadata needs `expected` present (null for create-only, string for CAS)".into(),
            ));
        }
    };
    Ok(ResourceWriteMeta {
        id,
        vault,
        expected,
    })
}

/// Percent-decoding rigoroso in UTF-8: `%` deve essere seguito da due cifre
/// esadecimali, il risultato deve essere UTF-8 valido. Qualsiasi scarto =
/// `BadArgs`, mai sostituzioni silenziose.
fn percent_decode_strict(raw: &str) -> Result<String, PluginError> {
    let bytes = raw.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len() {
                return Err(bad_meta("percent sequence is truncated"));
            }
            let pair = &raw[index + 1..index + 3];
            if !pair.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(bad_meta("percent sequence is not hexadecimal"));
            }
            let byte = u8::from_str_radix(pair, 16)
                .map_err(|_| bad_meta("percent sequence does not decode"))?;
            out.push(byte);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).map_err(|_| bad_meta("metadata is not UTF-8"))
}

fn bad_meta(reason: &str) -> PluginError {
    PluginError::BadArgs(format!("resource_write metadata is malformed: {reason}").into())
}

/// Estrae i byte grezzi dal corpo binario di un comando (`InvokeBody::Raw`,
/// quello che JS invia come `Uint8Array`): la forma con cui paste/drop,
/// download espliciti e finalizzazione del recorder atterrano nel vault, mai
/// base64 e mai array JSON di numeri. Un corpo JSON al posto dei byte e'
/// `BadArgs`: il client ha usato la forma sbagliata, non manca niente.
pub fn resource_write_body<'a>(
    request: &'a tauri::ipc::Request<'a>,
) -> Result<&'a [u8], PluginError> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.as_slice()),
        tauri::ipc::InvokeBody::Json(_) => Err(PluginError::BadArgs(
            "resource_write expects raw bytes (Uint8Array), not JSON".into(),
        )),
    }
}

/// Deposita byte veri: corpo binario via `InvokeBody::Raw` + metadati
/// dall'header `x-fub-resource-write`. Il comando nativo con corpo Raw legge i
/// parametri SOLO dall'header (NativeIntegration passa `request.headers()` e
/// `resource_write_body(request)`): non chiedere mai gli stessi parametri come
/// argomenti JSON Tauri. Rifiuta oltre il tetto inline con `Io` prima di
/// allocare: un deposito da 500 MiB via IPC non parte nemmeno. Torna la
/// ricevuta (id fenced scritto + revisione dei byte), mai un handle: fallire
/// l'open dopo non fa fallire il deposito.
pub fn resource_write_cmd<H: ResourceWrite>(
    host: &H,
    window_label: &str,
    origin: &str,
    headers: &tauri::http::HeaderMap,
    bytes: &[u8],
) -> Result<ResourceWriteReceipt, PluginError> {
    guard_trusted_local(window_label, origin)?;
    check_inline_limit(bytes.len() as u64)?;
    let meta = decode_resource_write_meta(headers, bytes.len())?;
    let id = fub_host::doc_id(&meta.id)?;
    let expected = meta.expected.map(Revision::new);
    host.resource_write(meta.vault.as_deref(), &id, bytes, expected)
}

// ---------------------------------------------------------------------------
// Protocollo fub-asset: con Range vero, solo handle aperti, solo fidate.
// ---------------------------------------------------------------------------

/// L'URL con cui la shell chiede un handle al protocollo, senza esporre path.
/// `fub-asset://localhost/3`: l'autorita' e' fissa, il path e' l'handle.
pub fn asset_url(handle: ResourceHandle) -> String {
    format!("fub-asset://localhost/{}", handle.0)
}

/// L'handle da un path di protocollo (`/3` -> handle 3). Tutto il resto e'
/// `BadArgs`: nomi, query, percent-encoding, risalite non aprono niente.
pub fn asset_handle_from_path(path: &str) -> Result<ResourceHandle, PluginError> {
    let raw = path.strip_prefix('/').unwrap_or(path);
    if raw.is_empty() || !raw.bytes().all(|b| b.is_ascii_digit()) {
        return Err(PluginError::BadArgs(
            format!("`{path}` is not an open resource handle").into(),
        ));
    }
    raw.parse::<u64>().map(ResourceHandle).map_err(|_| {
        PluginError::BadArgs(format!("`{path}` is not an open resource handle").into())
    })
}

/// Risolve un header `Range: bytes=start-end` in `[start, end)` clampato su
/// `len`. Forme ammesse: `bytes=N-`, `bytes=N-M`, `bytes=-S` (ultimi S byte).
/// Tutto il resto (multi-range, unita' ignote, fuori misura) e' `None`: il
/// chiamante risponde `416` con `bytes */len`, mai un `200`/`206` finto.
pub fn parse_range_header(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header.strip_prefix("bytes=")?.trim();
    if spec.contains(',') {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    if start.trim().is_empty() {
        let suffix: u64 = end.trim().parse().ok()?;
        if suffix == 0 || len == 0 {
            return None;
        }
        let take = suffix.min(len);
        return Some((len - take, len));
    }
    let from: u64 = start.trim().parse().ok()?;
    if from >= len {
        return None;
    }
    let to = if end.trim().is_empty() {
        len
    } else {
        end.trim().parse::<u64>().ok()?.saturating_add(1).min(len)
    };
    (to > from).then_some((from, to))
}

/// L'esito della risoluzione di una richiesta di protocollo: status, MIME,
/// eventuale `Content-Range`, e i byte da servire. `416` porta
/// `Content-Range: bytes */len` e corpo vuoto, come prescrive HTTP.
pub struct AssetResponse {
    pub status: u16,
    pub mime: String,
    pub content_range: Option<String>,
    pub body: Vec<u8>,
}
/// Una singola risposta Range resta bounded anche se il client chiede tutto il file.
pub const ASSET_MAX_RANGE_BYTES: u64 = 1024 * 1024;

/** Turns the guarded byte result into protocol headers, including a real 416. */
pub fn asset_http_response(
    served: AssetResponse,
) -> Result<tauri::http::Response<Vec<u8>>, PluginError> {
    let mut builder = tauri::http::Response::builder()
        .status(served.status)
        .header("content-type", served.mime)
        .header("content-length", served.body.len().to_string())
        .header("accept-ranges", "bytes")
        .header("cache-control", "no-store")
        .header("x-content-type-options", "nosniff");
    if let Some(range) = served.content_range {
        builder = builder.header("content-range", range);
    }
    builder
        .body(served.body)
        .map_err(|error| PluginError::Internal(format!("asset protocol response: {error}").into()))
}
/// Legge esattamente `[from, to)` a finestre clampate: mai l'intero file per
/// servire un intervallo. Solo il vuoto e' EOF: uno short-read non vuoto non
/// significa "finito", quindi il ciclo continua finche' avanza (stessa
/// semantica di `TransferRead`, dove solo il vuoto dice che non c'e' altro).
/// EOF prima di `to` (il file e' cambiato mentre si leggeva) e' `Io` che lo
/// dice, non un `Content-Range` che mente.
fn read_exact_range<H: ResourceHost>(
    host: &H,
    handle: ResourceHandle,
    from: u64,
    to: u64,
) -> Result<Vec<u8>, PluginError> {
    let mut out = Vec::new();
    let mut at = from;
    while at < to {
        let want = (to - at).min(u64::from(RESOURCE_CHUNK_BYTES)) as u32;
        let chunk = host.resource_read(handle, at, want)?;
        if chunk.is_empty() {
            return Err(PluginError::Io(
                format!(
                    "resource handle `{}` changed while reading (asked {from}-{to}, got {} bytes)",
                    handle.0,
                    out.len()
                )
                .into(),
            ));
        }
        if chunk.len() > want as usize {
            return Err(PluginError::Io(
                "resource read returned more bytes than requested".into(),
            ));
        }
        at += chunk.len() as u64;
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

/// Il corpo dell'handler `fub-asset:` che NativeIntegration registra con
/// `Builder::register_asynchronous_uri_scheme_protocol`.
///
/// - finestra non fidata (label o origin) -> `Err(PermissionDenied)`: il
///   viewer e le pagine remote non leggono le risorse del vault nemmeno con
///   l'handle giusto;
/// - handle ignoto/chiuso -> `Err(BadArgs)`; Custody che non si apre ->
///   `Err(Internal)` propagato, mai mascherato da handle mancante;
/// - `Range` valido -> `206` con `Content-Range` misurato **sul servito**
///   (short-read incluso; EOF inatteso e' `Io`, non un intervallo che mente);
/// - `Range` presente ma insoddisfacibile -> `Ok(416)` con
///   `Content-Range: bytes */len`, mai un primo chunk `206` finto;
/// - senza `Range` -> `200` completo **solo entro il tetto inline** (letto a
///   finestre bounded, mai l'intero file in un colpo); oltre il tetto `Io`
///   esplicito verso lo streaming con `Range`, mai un media troncato.
pub fn handle_asset_request<H: ResourceHost>(
    host: &H,
    webview_label: &str,
    origin: &str,
    path: &str,
    range: Option<&str>,
) -> Result<AssetResponse, PluginError> {
    guard_trusted_local(webview_label, origin)?;
    let handle = asset_handle_from_path(path)?;
    let descriptor = match host.resource_descriptor(handle)? {
        Some(descriptor) => descriptor,
        None => {
            return Err(PluginError::BadArgs(
                format!("resource handle `{}` is not open", handle.0).into(),
            ));
        }
    };
    let len = descriptor.len;
    let mime = descriptor.mime;
    match range {
        Some(header) => match parse_range_header(header, len) {
            Some((from, requested_to)) => {
                let to = requested_to.min(from.saturating_add(ASSET_MAX_RANGE_BYTES));
                let bytes = read_exact_range(host, handle, from, to)?;
                let end = from + bytes.len() as u64 - 1;
                Ok(AssetResponse {
                    status: 206,
                    mime,
                    content_range: Some(format!("bytes {from}-{end}/{len}")),
                    body: bytes,
                })
            }
            None => Ok(AssetResponse {
                status: 416,
                mime,
                content_range: Some(format!("bytes */{len}")),
                body: Vec::new(),
            }),
        },
        None => {
            check_inline_limit(len)?;
            if len == 0 {
                return Ok(AssetResponse {
                    status: 200,
                    mime,
                    content_range: None,
                    body: Vec::new(),
                });
            }
            let bytes = read_exact_range(host, handle, 0, len)?;
            Ok(AssetResponse {
                status: 200,
                mime,
                content_range: None,
                body: bytes,
            })
        }
    }
}

// ---------------------------------------------------------------------------
// Viewer isolato: costruzione guardata, nessun ponte, download negati.
// ---------------------------------------------------------------------------

/// Parametri validati per `open_viewer` in questo modulo.
pub struct ViewerWindow {
    pub url: tauri::Url,
    pub title: String,
    pub data_dir: camino::Utf8PathBuf,
}

/// Valida l'apertura: gate locale (label + origin), URL allowlisted, titolo,
/// profilo isolato sotto la config dir (mai dentro il vault). `open_viewer`
/// costruisce la WebviewWindow e applica la stessa policy a ogni navigazione.
pub fn prepare_viewer(
    window_label: &str,
    origin: &str,
    open: &ViewerOpen,
    config_dir: &camino::Utf8Path,
) -> Result<ViewerWindow, PluginError> {
    guard_trusted_local(window_label, origin)?;
    let url = check_viewer_url(open)?;
    Ok(ViewerWindow {
        url,
        title: viewer_title(&open.title),
        data_dir: crate::web_viewer::viewer_data_dir(config_dir),
    })
}

/// Corpo di `viewer_open`, da registrare da NativeIntegration.
///
/// L'origin si rilegge da `window.url()` lato nativo (una `main` navigata su
/// un remoto non passa il gate). Chiude una finestra viewer precedente con la
/// stessa label (una sola istanza: niente accumulo di profili), poi costruisce
/// con isolamento reale: profilo separato, niente bridge IPC (nessuna
/// capability remota registrata per `fub-viewer`; il gate sopra rifiuta
/// comunque ogni invoke da li' dentro), permessi negati di default, download
/// intercettati.
pub async fn open_viewer<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
    open: ViewerOpen,
    config_dir: camino::Utf8PathBuf,
) -> Result<String, PluginError> {
    let label = window.label().to_string();
    let origin = window.url().map(|url| url.to_string()).unwrap_or_default();
    let prepared = prepare_viewer(&label, &origin, &open, &config_dir)?;
    let navigation_policy = open;
    if let Some(previous) = app.get_webview_window(VIEWER_LABEL) {
        let _ = previous.close();
    }
    use tauri::webview::NewWindowResponse;
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    WebviewWindowBuilder::new(&app, VIEWER_LABEL, WebviewUrl::External(prepared.url))
        .title(prepared.title)
        .inner_size(1024.0, 760.0)
        .center()
        .focused(true)
        .visible(true)
        .decorations(true)
        .incognito(true)
        .data_directory(prepared.data_dir.into_std_path_buf())
        .on_navigation(move |url| {
            check_viewer_address(
                url.as_str(),
                navigation_policy.allow_remote,
                &navigation_policy.allowlist,
            )
            .is_ok()
        })
        .on_new_window(|_url, _features| NewWindowResponse::Deny)
        .on_download(|_webview, _event| false)
        .build()
        .map_err(|and| PluginError::Internal(format!("viewer window not opened: {and}").into()))?;
    Ok(VIEWER_LABEL.to_string())
}

/// Salvataggio come nota da URL approvato: trasformazione controllata, non
/// download implicito. La fetch passa dalla rete consentita dell'host
/// (`HostNetwork`, tetto 16 MiB di `UreqNetwork`), il deposito da
/// `H: ResourceWrite` in forma **create-only** (`None`: mai coprire — il nome
/// e' gia' unico per costruzione). La pagina ostile non tocca il vault:
/// tocca solo questo comando, con gate + allowlist.
#[allow(clippy::too_many_arguments)]
pub async fn viewer_save<H, N>(
    host: &H,
    net: &N,
    window_label: &str,
    origin: &str,
    url: &str,
    title: &str,
    allowlist: &[String],
    vault: Option<&str>,
    attachment_folder: &str,
) -> Result<ResourceWriteReceipt, PluginError>
where
    H: ResourceHost + ResourceWrite,
    N: HostNetwork + ?Sized,
{
    guard_trusted_local(window_label, origin)?;
    let open = ViewerOpen {
        url: url.to_string(),
        title: title.to_string(),
        allow_remote: true,
        allowlist: allowlist.to_vec(),
    };
    let approved = check_viewer_url(&open)?;
    let response = net
        .fetch(HttpRequest::get(approved.as_str()))
        .map_err(|and| match and {
            PluginError::Unserved(_) => PluginError::PermissionDenied(
                "network unavailable for this host: cannot save remote content".into(),
            ),
            other => other,
        })?;
    if !(200..300).contains(&response.status) {
        return Err(PluginError::Io(
            format!("saving `{url}`: the server answered {}", response.status).into(),
        ));
    }
    check_inline_limit(response.body.len() as u64)?;
    let remote_name = approved
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|base| !base.is_empty())
        .and_then(|base| percent_decode_strict(base).ok())
        .filter(|base| !base.contains('/') && !base.contains('\\'))
        .unwrap_or_else(|| "saved.html".to_string());
    let name = fub_host::resources::sanitize_file_name(&remote_name)
        .unwrap_or_else(|_| "saved.html".to_string());
    let trimmed_folder = attachment_folder.trim();
    let clean_folder = trimmed_folder.trim_end_matches('/');
    if trimmed_folder.starts_with('/') || clean_folder.is_empty() {
        return Err(PluginError::BadArgs(
            "attachment folder must be a nonempty relative path".into(),
        ));
    }
    let (stem, ext) = fub_host::resources::split_file_name(&name);
    for n in 0..=10_000 {
        let candidate = fub_host::resources::attachment_candidate(stem, ext, n);
        let id = fub_host::doc_id(&format!("{clean_folder}/{candidate}"))?;
        match host.resource_write(vault, &id, &response.body, None) {
            Err(PluginError::AlreadyExists(_)) => continue,
            result => return result,
        }
    }
    Err(PluginError::Io("no free attachment name remains".into()))
}

// ---------------------------------------------------------------------------
// pdf.js: versione reale su registry, worker locale, loader da bundle.
// ---------------------------------------------------------------------------

/// Versione richiesta del loader pdf.js locale: `pdfjs-dist@6.3.289`.
/// La shell rifiuta versioni diverse; l'installazione e il bundle del worker
/// sono un prerequisito dell'integrazione, mai una fetch CDN implicita.
pub const PDFJS_VERSION: &str = "6.3.289";

/// I file del bundle pdf.js da servire locali (mai CDN, niente rete
/// implicita): entry ESM + worker, nomi reali del pacchetto 6.3.289
/// (verificati su jsdelivr: `/build/pdf.min.mjs`, `/build/pdf.worker.min.mjs`,
/// default `/build/pdf.min.mjs`).
pub const PDFJS_ENTRY: &str = "pdf.min.mjs";
pub const PDFJS_WORKER: &str = "pdf.worker.min.mjs";

/// Bundle contract for an injected pdf.js loader. These file names do not
/// bundle the dependency by themselves: without a real local entry and worker
/// the PDF surface displays its explicit fallback.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PdfLoaderRef {
    pub version: &'static str,
    pub entry: &'static str,
    pub worker: &'static str,
}

/// Declares the expected local bundle entry and worker, not a loaded engine.
pub fn make_pdf_loader() -> PdfLoaderRef {
    PdfLoaderRef {
        version: PDFJS_VERSION,
        entry: PDFJS_ENTRY,
        worker: PDFJS_WORKER,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fub_abi::model::DocId;
    use fub_host::resources::ResourceTable;

    const LOCAL: &str = "tauri://localhost/";
    const LOCAL_HTTP: &str = "http://tauri.localhost/";
    const REMOTE: &str = "https://esempio.it/nota";

    #[test]
    fn only_local_main_and_document_windows_pass_the_gate() {
        assert!(guard_trusted_local("main", LOCAL).is_ok());
        assert!(guard_trusted_local("main", LOCAL_HTTP).is_ok());
        assert!(guard_trusted_local("document-1", LOCAL).is_ok());
        // Stessa label, ma navigata su un remoto: non fidata.
        assert!(guard_trusted_local("main", REMOTE).is_err());
        assert!(guard_trusted_local("document-1", REMOTE).is_err());
        for (label, origin) in [
            ("fub-viewer", LOCAL),
            ("viewer", LOCAL),
            ("", LOCAL),
            ("MAIN", LOCAL),
            ("document", LOCAL),
            ("remote-1", LOCAL),
            ("main", "fub-asset://localhost/3"),
            ("main", "about:blank"),
            ("main", "not a url"),
        ] {
            assert!(
                guard_trusted_local(label, origin).is_err(),
                "{label:?} @ {origin:?} non deve toccare byte o finestre"
            );
        }
    }

    #[test]
    fn asset_urls_carry_only_the_handle() {
        assert_eq!(asset_url(ResourceHandle(3)), "fub-asset://localhost/3");
        assert_eq!(asset_handle_from_path("/3").unwrap(), ResourceHandle(3));
        for bad in [
            "",
            "/",
            "/../x",
            "/3?y=1",
            "/%33",
            "/-1",
            "/18446744073709551616",
        ] {
            assert!(
                asset_handle_from_path(bad).is_err(),
                "{bad:?} non deve aprire niente"
            );
        }
    }

    #[test]
    fn ranges_cover_seek_suffix_and_open_end() {
        assert_eq!(parse_range_header("bytes=0-", 100), Some((0, 100)));
        assert_eq!(parse_range_header("bytes=10-19", 100), Some((10, 20)));
        assert_eq!(
            parse_range_header("bytes=90-999", 100),
            Some((90, 100)),
            "la fine oltre il file si clampa, non si rifiuta"
        );
        assert_eq!(parse_range_header("bytes=-10", 100), Some((90, 100)));
        assert_eq!(parse_range_header("bytes=0-0", 100), Some((0, 1)));
        for bad in [
            "bytes=100-",
            "bytes=50-40",
            "bytes=-0",
            "items=0-10",
            "bytes=0-1,2-3",
            "bytes=abc-",
        ] {
            assert_eq!(parse_range_header(bad, 100), None, "{bad:?}");
        }
    }

    struct MemoryHost {
        table: std::sync::Mutex<ResourceTable>,
        bytes: Vec<u8>,
    }

    impl MemoryHost {
        fn seeded(bytes: Vec<u8>) -> Self {
            let mut table = ResourceTable::default();
            table
                .open(
                    "/vault".to_string(),
                    DocId::new("a.bin"),
                    fub_host::resources::ResourceLease {
                        root: camino::Utf8PathBuf::from("/vault"),
                        path: "a.bin".to_string(),
                        identity: Some(fub_kernel::FileIdentity { volume: 1, file: 2 }),
                        stat: fub_kernel::Stat {
                            kind: fub_kernel::storage::EntryKind::File,
                            size: bytes.len() as u64,
                            mtime: 1000,
                        },
                        change: Some(7),
                        revision: None,
                    },
                    "application/octet-stream".to_string(),
                )
                .unwrap();
            MemoryHost {
                table: std::sync::Mutex::new(table),
                bytes,
            }
        }

        fn handle(&self) -> ResourceHandle {
            self.table
                .lock()
                .unwrap()
                .descriptor(ResourceHandle(1))
                .unwrap()
                .handle
        }
    }

    impl ResourceHost for MemoryHost {
        fn resource_open(
            &self,
            _vault: Option<&str>,
            _id: &DocId,
        ) -> Result<ResourceDescriptor, PluginError> {
            unreachable!("questi banchi aprono via tabella");
        }

        fn resource_read(
            &self,
            handle: ResourceHandle,
            offset: u64,
            len: u32,
        ) -> Result<Vec<u8>, PluginError> {
            if self.table.lock().unwrap().descriptor(handle).is_none() {
                return Err(PluginError::BadArgs(
                    format!("resource handle `{}` is not open", handle.0).into(),
                ));
            }
            let from = (offset as usize).min(self.bytes.len());
            let to = (from + len as usize).min(self.bytes.len());
            Ok(self.bytes[from..to].to_vec())
        }

        fn resource_descriptor(
            &self,
            handle: ResourceHandle,
        ) -> Result<Option<ResourceDescriptor>, PluginError> {
            Ok(self.table.lock().unwrap().descriptor(handle))
        }

        fn resource_close(&self, handle: ResourceHandle) -> Result<(), PluginError> {
            self.table.lock().unwrap().close(handle);
            Ok(())
        }
    }

    #[test]
    fn served_ranges_report_what_was_served() {
        let host = MemoryHost::seeded(vec![7u8; 200_000]);
        let _handle = host.handle();
        // Range oltre una finestra IPC: piu' letture, un solo Content-Range.
        let response =
            handle_asset_request(&host, "main", LOCAL, "/1", Some("bytes=0-199999")).unwrap();
        assert_eq!(response.status, 206);
        assert_eq!(
            response.content_range.as_deref(),
            Some("bytes 0-199999/200000")
        );
        assert_eq!(response.body.len(), 200_000);
        // Senza Range entro il tetto: 200 completo letto a finestre.
        let full = handle_asset_request(&host, "main", LOCAL, "/1", None).unwrap();
        assert_eq!(full.status, 200);
        assert_eq!(full.body.len(), 200_000);
    }

    #[test]
    fn oversized_ranges_are_bounded_and_truthfully_reported() {
        let host = MemoryHost::seeded(vec![7; ASSET_MAX_RANGE_BYTES as usize + 100]);
        let response = handle_asset_request(&host, "main", LOCAL, "/1", Some("bytes=0-")).unwrap();
        assert_eq!(response.status, 206);
        assert_eq!(response.body.len(), ASSET_MAX_RANGE_BYTES as usize);
        assert_eq!(
            response.content_range.as_deref(),
            Some("bytes 0-1048575/1048676"),
        );
    }

    #[test]
    fn unsatisfiable_ranges_are_416_never_a_fake_first_chunk() {
        let host = MemoryHost::seeded(vec![1u8; 100]);
        for header in ["bytes=100-", "bytes=50-40", "items=0-10", "bytes=0-1,2-3"] {
            let response = handle_asset_request(&host, "main", LOCAL, "/1", Some(header)).unwrap();
            assert_eq!(response.status, 416, "{header:?}");
            assert_eq!(
                response.content_range.as_deref(),
                Some("bytes */100"),
                "{header:?}"
            );
            assert!(response.body.is_empty(), "{header:?}");
        }
    }

    #[test]
    fn protocol_response_keeps_range_and_no_sniff_headers() {
        let host = MemoryHost::seeded(vec![1; 100]);
        let served = handle_asset_request(&host, "main", LOCAL, "/1", Some("bytes=100-")).unwrap();
        let response = asset_http_response(served).unwrap();
        assert_eq!(
            response.status(),
            tauri::http::StatusCode::RANGE_NOT_SATISFIABLE
        );
        assert_eq!(response.headers()["content-range"], "bytes */100");
        assert_eq!(response.headers()["content-length"], "0");
        assert_eq!(response.headers()["x-content-type-options"], "nosniff");
    }

    #[test]
    fn oversized_resources_without_range_are_an_explicit_error() {
        let host = MemoryHost::seeded(vec![0u8; 8]);
        // La tabella dice 8 byte ma il corpo ne dichiara di piu': si forza la
        // strada oltre-tetto con una len finta via descrittore sostituito.
        let big = handle_asset_request(&host, "main", LOCAL, "/999", None);
        assert!(
            matches!(big, Err(PluginError::BadArgs(_))),
            "handle ignoto resta BadArgs"
        );
        let missing = handle_asset_request(&host, "fub-viewer", LOCAL, "/1", None);
        assert!(
            matches!(missing, Err(PluginError::PermissionDenied(_))),
            "il viewer non legge il protocollo"
        );
    }

    #[test]
    fn write_metadata_decode_is_strict() {
        let meta = |encoded: &str| {
            let mut headers = tauri::http::HeaderMap::new();
            headers.insert(
                RESOURCE_WRITE_HEADER,
                encoded.parse().expect("header value"),
            );
            decode_resource_write_meta(&headers, 10)
        };
        let good =
            meta("%7B%22id%22%3A%22a%2Fb.png%22%2C%22vault%22%3Anull%2C%22expected%22%3Anull%7D")
                .unwrap();
        assert_eq!(good.id, "a/b.png");
        assert_eq!(good.vault, None);
        assert_eq!(good.expected, None);
        let cas = meta("%7B%22id%22%3A%22a.png%22%2C%22vault%22%3A%22v%22%2C%22expected%22%3A%22sha256%3Aabc%22%7D")
            .unwrap();
        assert_eq!(cas.expected.as_deref(), Some("sha256:abc"));
        for bad in [
            "%7B%22id%22%3A%22a.png%22%2C%22vault%22%3Anull%7D",
            "%7B%22id%22%3A%22a.png%22%2C%22vault%22%3Anull%2C%22expected%22%3Anull%2C%22x%22%3A1%7D",
            "%7B%22id%22%3A5%2C%22vault%22%3Anull%2C%22expected%22%3Anull%7D",
            "%7B%22id%22%3A%22a.png",
            "%FF%FE",
            "%7B%22id%22%3A%22a.png%22%2C%22vault%22%3Anull%2C%22expected%22%3A5%7D",
        ] {
            let mut headers = tauri::http::HeaderMap::new();
            headers.insert(RESOURCE_WRITE_HEADER, bad.parse().expect("header value"));
            assert!(
                matches!(
                    decode_resource_write_meta(&headers, 10),
                    Err(PluginError::BadArgs(_))
                ),
                "{bad:?} deve essere BadArgs"
            );
        }
        assert!(matches!(
            decode_resource_write_meta(&tauri::http::HeaderMap::new(), 10),
            Err(PluginError::BadArgs(_))
        ));
    }

    #[test]
    fn the_pdf_loader_names_the_real_bundle_files() {
        let loader = make_pdf_loader();
        assert_eq!(loader.version, "6.3.289");
        assert_eq!(loader.entry, "pdf.min.mjs");
        assert_eq!(loader.worker, "pdf.worker.min.mjs");
    }
}

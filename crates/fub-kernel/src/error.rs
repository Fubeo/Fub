//! Errori del kernel.

use camino::Utf8PathBuf;
use fub_abi::{FormatError, PluginError};

#[derive(Debug, thiserror::Error)]
pub enum KernelError {
    #[error("I/O su {path}: {source}")]
    Io {
        path: Utf8PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("nessun provider registrato per l'estensione {0:?}")]
    NoProvider(String),
    /// Nessun formato registrato, quindi nemmeno uno con cui far nascere una
    /// nota nuova.
    #[error("nessun formato registrato: non so con quale creare una nota")]
    NoDefaultFormat,
    /// Il nome non si può usare, e la ragione la dice
    /// [`NameFault`](fub_abi::rules::path_policy::NameFault).
    ///
    /// La ragione è nella variante e non solo nel log perché è **l'unica cosa
    /// utile** che si possa dire a chi ha appena scritto un titolo: «nome non
    /// valido» lascia indovinare quale carattere, e su un nome lungo non si
    /// indovina. È il §12.2 applicato al rifiuto di un nome.
    #[error("nome non valido per una nota ({name:?}): {why}")]
    BadName { name: String, why: String },
    #[error("documento non trovato: {0}")]
    NotFound(String),
    #[error("esiste già un documento: {0}")]
    AlreadyExists(String),
    #[error("path fuori dal vault: {0}")]
    OutsideVault(Utf8PathBuf),
    /// Il rename È riuscito (file, grafo, evento), ma la riscrittura dei
    /// wikilink entranti è fallita in una o più sorgenti — le altre sono
    /// state comunque completate.
    #[error("rename riuscito, ma la riscrittura dei link è fallita per: {0}")]
    LinkRewrite(String),
    /// Il sorgente su cui una modifica chirurgica era stata calcolata non è più
    /// quello: qualcuno ha scritto nel frattempo, e applicare gli span vecchi
    /// avrebbe tagliato i byte sbagliati. Non è stato scritto niente.
    #[error("{0} è cambiato da quando la modifica è stata calcolata")]
    Stale(String),
    /// Gli edit di una modifica chirurgica non stanno in piedi sul sorgente
    /// (fuori dal testo, a metà di un carattere, sovrapposti, due nello stesso
    /// punto). Come sopra: niente di parziale, niente scritto.
    #[error("modifica non applicabile a {doc}: {why}")]
    BadEdit { doc: String, why: String },
    #[error("path non UTF-8: {0}")]
    NonUtf8Path(std::path::PathBuf),
    #[error(transparent)]
    Format(#[from] FormatError),
}

pub type Result<T> = std::result::Result<T, KernelError>;

/// Un errore del kernel **come lo vede chi sta dall'altra parte del contratto**.
///
/// `KernelError` resta fuori dall'ABI e ci deve restare — è la lingua di *questo*
/// host, e un host diverso ne avrà un'altra, con altri casi. Ma proprio per
/// questo la traduzione verso [`PluginError`] è una scelta, non un cast: è il
/// punto in cui si decide **cosa può fare chi riceve**, e va fatta una volta
/// sola, qui, invece che a ogni confine con un `to_string()`.
///
/// Fino al §12.2 la traduzione era una funzione privata di `workspace.rs` che
/// distingueva due casi su tredici e appiattiva gli altri undici su
/// [`Internal`](PluginError::Internal). Il costo non era estetico: `Internal`
/// significa *«errore interno del plugin»*, cioè «segnala un bug», scritto sotto
/// un'azione che una persona aveva appena chiesto. Un disco pieno, un nome già
/// occupato e un documento sparito arrivavano tutti e tre con quella faccia, e
/// l'unico modo di distinguerli era cercare una sottostringa nella prosa
/// italiana — che è precisamente ciò che questa seduta è venuta a togliere.
///
/// # Le scelte che non sono ovvie
///
/// - [`NoProvider`](KernelError::NoProvider) e
///   [`NoDefaultFormat`](KernelError::NoDefaultFormat) diventano
///   [`Unserved`](PluginError::Unserved), non `Internal`: la forma è la stessa
///   che la variante già descrive per le query — *nessuno ha dichiarato di
///   servire questo* — e la risposta giusta da mostrare è «installa un plugin
///   per questo formato», non «qualcosa è andato storto». Che il non-servito sia
///   una rotta d'indice o un'estensione di file è un dettaglio di quale registro
///   si è guardato.
/// - [`OutsideVault`](KernelError::OutsideVault) diventa
///   [`PermissionDenied`](PluginError::PermissionDenied) e non
///   [`BadArgs`](PluginError::BadArgs): il path era ben formato, è il recinto ad
///   aver detto di no. È la stessa risposta che [`fenced_doc_id`] dà a una
///   risalita, e per chi la riceve i due recinti devono comportarsi uguale.
///
///   [`fenced_doc_id`]: crate::workspace::fenced_doc_id
/// - [`NonUtf8Path`](KernelError::NonUtf8Path) diventa [`Io`](PluginError::Io) e
///   non `BadArgs`, perché quel path non l'ha scritto chi chiama: l'ha trovato
///   il kernel camminando sul disco. È il mondo, come un disco pieno.
/// - [`LinkRewrite`](KernelError::LinkRewrite) diventa `Io` **per difetto, e con
///   una perdita dichiarata**: è l'unico caso di *successo parziale* — il rename
///   è avvenuto, sono i wikilink entranti di alcune sorgenti a non essere stati
///   riscritti — e il contratto non ha una variante che dica «è andata a metà».
///   `Io` è la meno sbagliata perché ciò che è fallito è scrivere quei file e il
///   verbo giusto resta «riprova»; ma chi la riceve non può sapere dal `kind`
///   che l'operazione principale è riuscita, e deve leggerne il messaggio, che
///   nomina le sorgenti. Inventare qui una variante `Partial` significherebbe
///   aggiungere al contratto un caso che nessun cliente legge ancora: è la
///   regola opposta a quella con cui le tre varianti nuove sono nate.
/// - [`Format`](KernelError::Format) si divide: `Unsupported` è ancora un
///   nessuno-lo-serve e va in `Unserved`, gli altri tre in `Internal`. Il
///   contratto non ha un «questo documento è malformato», e non gliene si
///   aggiunge uno finché non c'è chi lo legge — il payload porta comunque il
///   `Display` del [`FormatError`], che dice quale delle tre cose è fallita.
impl From<KernelError> for PluginError {
    fn from(e: KernelError) -> Self {
        match e {
            KernelError::NotFound(doc) => PluginError::NotFound(doc.into()),
            KernelError::AlreadyExists(doc) => PluginError::AlreadyExists(doc.into()),
            // Un conflitto è la sola cosa che chi chiama deve **riprovare**
            // (rileggendo e ricalcolando), un edit malformato la sola che deve
            // **correggere**: appiattirli lascerebbe la distinzione a chi legge
            // la prosa.
            KernelError::Stale(doc) => PluginError::Conflict(doc.into()),
            KernelError::BadEdit { doc, why } => {
                PluginError::BadArgs(format!("{doc}: {why}").into())
            }
            KernelError::BadName { name, why } => PluginError::BadArgs(
                format!("nome non valido per una nota ({name:?}): {why}").into(),
            ),
            KernelError::OutsideVault(path) => {
                PluginError::PermissionDenied(format!("path fuori dal vault: {path}").into())
            }
            KernelError::NoProvider(ext) => PluginError::Unserved(
                format!("nessun provider registrato per l'estensione {ext:?}").into(),
            ),
            KernelError::NoDefaultFormat => PluginError::Unserved(
                "nessun formato registrato: non so con quale creare una nota".into(),
            ),
            KernelError::Format(FormatError::Unsupported(what)) => {
                PluginError::Unserved(format!("formato non supportato: {what}").into())
            }
            e @ (KernelError::Io { .. }
            | KernelError::NonUtf8Path(_)
            | KernelError::LinkRewrite(_)) => PluginError::Io(e.to_string().into()),
            e @ KernelError::Format(_) => PluginError::Internal(e.to_string().into()),
        }
    }
}

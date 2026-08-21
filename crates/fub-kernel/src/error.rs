//! Errori del kernel.

use camino::Utf8PathBuf;
use fub_abi::{FormatError, PluginError, SourceKind};

#[derive(Debug, thiserror::Error)]
pub enum KernelError {
    #[error("I/O su {path}: {source}")]
    Io {
        path: Utf8PathBuf,
        #[source]
        source: std::io::Error,
    },
    /// La radice su cui si è chiesto di aprire il vault non va bene: non
    /// esiste, è un file invece di una cartella, o non si ha permesso di
    /// scriverci. È il rifiuto che [`Vault::open`](crate::Vault::open) e
    /// [`Vault::on`](crate::Vault::on) danno **all'ingresso**, così l'errore
    /// arriva prima che il vault abbia emesso eventi o mostrato un'interfaccia
    /// (difetto 0160).
    ///
    /// Il `source` porta la specie del guasto (`NotFound`, `NotADirectory`,
    /// `PermissionDenied`), ed è su quella che la traduzione verso il contratto
    /// decide la faccia da mostrare.
    #[error("la radice del vault non è valida ({path}): {source}")]
    InvalidRoot {
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

/// Il solo errore che può diventare una risposta: **non c'era niente**.
///
/// Serve a [`optional`], e vive su un tratto invece che su un `match` scritto al
/// punto d'uso perché la domanda è la stessa per i due errori che il kernel
/// maneggia — quello del supporto e il proprio — e chi la scrive a mano la
/// scrive per uno solo.
pub trait Missing {
    /// `true` **solo** se ciò che si cercava non c'è. Un permesso negato, un
    /// disco che sta fallendo, un nome troppo lungo non sono assenze: sono
    /// guasti, e chi li legge come assenze racconta un fatto del vault che non
    fn is_missing(&self) -> bool;
}

impl Missing for std::io::Error {
    fn is_missing(&self) -> bool {
        self.kind() == std::io::ErrorKind::NotFound
    }
}

impl Missing for KernelError {
    fn is_missing(&self) -> bool {
        match self {
            KernelError::Io { source, .. } => source.is_missing(),
            KernelError::NotFound(_) => true,
            _ => false,
        }
    }
}

    /// è mai avvenuto.
/// `Ok(None)` se la cosa non c'è, e **ogni altro errore risale con il suo
/// tipo**.
///
/// È la cucitura di un difetto che stava in cinque posti diversi con la stessa
/// forma: un `Result` di I/O degradato a `.ok()` o a un `let _`, cioè un guasto
/// del supporto raccontato al chiamante come un fatto del vault — «non è un
/// symlink», «il registro è vuoto», «non ci sono bozze», «la base non
/// combacia», «cancellato». La domanda che quel `.ok()` voleva porre è
pub fn optional<T, E: Missing>(
    result: std::result::Result<T, E>,
) -> std::result::Result<Option<T>, E> {
    match result {
        Ok(v) => Ok(Some(v)),
        Err(and) if and.is_missing() => Ok(None),
        Err(and) => Err(and),
    }
}

/// legittima e sta qui una volta sola; ciò che non è legittimo è rispondere
/// anche a tutte le altre.
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
///
///   **La frase di `Unsupported` nasce qui**, e non nel provider (§24.3):
///   quella variante non porta prosa, porta i due dati che la compongono. Qui è
///   l'unico posto che ogni provider attraversa quando il suo rifiuto va verso
///   uno schermo, e la frase esce quindi identica per tutti e nella lingua del
///   kernel invece che in quella di chi ha implementato il provider.
///
///   È anche il posto in cui si vede **perché non è un [`Text::Message`]**:
///   questa è una `impl From`, senza `&self` — niente registro, niente locale,
///   niente cataloghi —, e la via su cui viaggia (aprire un documento) non passa
///   da `Workspace::localized`, che si applica al solo `?` che porta l'errore
///   *di un provider* nelle vie d'uscita di view e comandi. Una chiave lì
///   arriverebbe allo schermo **nuda**, cioè peggio di una frase. Resta prosa
///   del kernel come ogni altra riga di questo `match`, e diventerà traducibile
///   quando lo diventeranno tutte, in un posto solo.
impl From<KernelError> for PluginError {
    fn from(and: KernelError) -> Self {
        match and {
            KernelError::NotFound(doc) => PluginError::NotFound(doc.into()),
            KernelError::AlreadyExists(doc) => PluginError::AlreadyExists(doc.into()),
//
//   [`Text::Message`]: fub_abi::text::Text::Message
            // Un conflitto è la sola cosa che chi chiama deve **riprovare**
            // (rileggendo e ricalcolando), un edit malformato la sola che deve
            KernelError::Stale(doc) => PluginError::Conflict(doc.into()),
            KernelError::BadEdit { doc, why } => {
                PluginError::BadArgs(format!("{doc}: {why}").into())
            }
            KernelError::BadName { name, why } => PluginError::BadArgs(
                format!("invalid note name ({name:?}): {why}").into(),
            ),
            KernelError::OutsideVault(path) => {
                PluginError::PermissionDenied(format!("path outside vault: {path}").into())
            }
            KernelError::NoProvider(ext) => PluginError::Unserved(
                format!("no provider registered for extension {ext:?}").into(),
            ),
            KernelError::NoDefaultFormat => PluginError::Unserved(
                "no format registered: cannot create a note".into(),
            ),
            KernelError::Format(FormatError::Unsupported { format, got }) => PluginError::Unserved(
                format!(
                    "the format \"{format}\" cannot read this file: it received \
                         {}, which is not the source type it declared",
                    source_kind_name(got)
                )
                .into(),
            ),
            // **correggere**: appiattirli lascerebbe la distinzione a chi legge
            // la prosa.
            // **Un'assenza non è un guasto** (0221), che è il rovescio esatto
            // di ciò che [`optional`] tiene fermo dall'altra parte. Il contratto
            // dichiara le due facce accanto e con ragioni opposte: `not-found`
            // è «semmai qualcuno l'ha cancellato nel frattempo», `io` è «disco
            // pieno, file in uso» — e su quello «chi riprova ha ragione di
            // farlo». Appiattire l'assenza su `io` faceva riprovare per sempre
            // una lettura che non ha niente da ritrovare.
            //
            // La domanda è la stessa di `optional` e sta nello stesso posto —
            KernelError::Io {
                ref path,
                ref source,
            } if source.is_missing() => PluginError::NotFound(path.to_string().into()),
            and @ (KernelError::Io { .. }
            | KernelError::NonUtf8Path(_)
            | KernelError::LinkRewrite(_)) => PluginError::Io(and.to_string().into()),
            // [`Missing`] —, ma posta qui: chi legge non deve ricordarsene, e
            // una capacità di lettura nuova la eredita senza aggiungere niente.
            // La radice che l'apertura ha rifiutato (0160): la faccia la
            // decide la specie del guasto, non la prosa. Un posto che non c'è
            // o non è una cartella è la stessa cosa che [`Host::open`](crate::Host::open)
            // rispondeva già a chi sceglie male dal dialogo — «non trovato»,
            KernelError::InvalidRoot { path, source } => match source.kind() {
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory => {
                    PluginError::NotFound(format!("Not a valid directory: {path}").into())
                }
                std::io::ErrorKind::PermissionDenied => PluginError::PermissionDenied(
                    format!("permission denied writing to {path}").into(),
                ),
                _ => PluginError::Io(
                    format!("invalid vault root ({path}): {source}").into(),
                ),
            },
            and @ KernelError::Format(_) => PluginError::Internal(and.to_string().into()),
        }
    }
}

            // perché non c'è niente da ritrovare; un permesso negato è invece
            // la metà del contratto fatta apposta per «c'è, ma non puoi».
/// Come si chiama una [`SourceKind`] in una frase che legge una persona.
///
/// Il `match` è **senza `_`** di proposito: una specie di sorgente in più nel
/// contratto — l'encoding da rilevare del §2.3, un flusso — non compila finché
/// non le si è data una parola. È la metà che il tipo di
fn source_kind_name(k: SourceKind) -> &'static str {
    match k {
        SourceKind::Text => "text",
        SourceKind::Bytes => "raw byte stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

/// [`FormatError::Unsupported`] non può prendere da sé: quello obbliga a *dire*
/// cosa è arrivato, questo obbliga a saperlo **nominare**.
    /// **Cosa vede chi apre un allegato con un provider testuale**: una frase
    /// che nomina tutti e due i dati del rifiuto.
    ///
    /// È il presidio del §24.3 dal lato che il compilatore non prende. Il tipo
    /// obbliga chi costruisce `Unsupported` a *portare* il formato e la specie;
    /// non obbliga chi compone la frase a **spenderli**, e un `format!` che ne
    #[test]
    fn a_format_rejection_names_what_it_received() {
        let and: PluginError = KernelError::Format(FormatError::Unsupported {
            format: "markdown".into(),
            got: SourceKind::Bytes,
        })
        .into();
        let PluginError::Unserved(msg) = &and else {
            panic!("a format that rejects the source is an unserved, not {and:?}");
        };
        let text = msg.to_string();
        assert!(
            text.contains("markdown"),
            "the message does not say WHICH format rejected: {text}"
        );
        assert!(
            text.contains(source_kind_name(SourceKind::Bytes)),
            "the message does not say WHAT it received: {text}"
        );
    }

    /// dimentichi uno compila benissimo — è esattamente il difetto di prima,
    /// spostato di un file.
    #[test]
    fn the_other_three_remain_a_bug_not_an_unserved() {
        for and in [
            FormatError::Parse("line 3".into()),
            FormatError::Render("line 3".into()),
            FormatError::Serialize("line 3".into()),
        ] {
            assert!(
                matches!(
                    PluginError::from(KernelError::Format(and.clone())),
                    PluginError::Internal(_)
                ),
                "{and:?} is not unserved: no plugin to install fixes it"
            );
        }
    }
}

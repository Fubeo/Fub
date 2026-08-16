//! Cosa sta **dietro** un handle di trasferimento (decisione 0102).
//!
//! Il contratto dice che i byte di un import possono restare dall'host e che
//! quelli di un export si possono versare mentre si producono
//! ([`fub_abi::transfer`]). Qui c'è il lato host di quelle due frasi: chi tiene
//! aperta una sorgente e la legge per pezzi, e dove finisce un artefatto.
//!
//! # Perché la lettura è posizionale
//!
//! `read_at(offset, len)` e non `next_chunk()`. La ragione non è di comodo ed è
//! la stessa che ha scartato le altre due strade della §23.6: un contenitore
//! zip — cioè `.docx`, `.epub`, `.odt` e mezzo mondo dei backup — tiene la
//! propria directory **in fondo**. Chi sa solo andare avanti non lo sfoglia, lo
//! scarica; e siccome la voce dichiarava che contenitore e stream «non sono due
//! voci», una forma sequenziale avrebbe chiuso metà del problema fingendo di
//! chiuderlo tutto.
//!
//! # Chi apre, chi chiude
//!
//! Apre chi ha aperto il dialogo di sistema — cioè l'app, attraverso
//! [`Workspace::open_source`](crate::workspace::Workspace::open_source) — e
//! chiude lo stesso. Il kernel **non** chiude alla fine di un `import`, di
//! proposito: la coppia preview→apply della decisione 0006 è due chiamate sulla
//! stessa sorgente, e chiuderla in mezzo vorrebbe dire riaprirla, cioè rileggere
//! ciò che si era già letto per rispondere alla stessa domanda.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use camino::Utf8Path;

use fub_abi::transfer::{
    ArtifactContent, ArtifactHandle, ArtifactSink, ExportArtifact, SourceHandle,
};
use fub_abi::PluginError;

/// Quanti byte di assaggio l'host legge all'apertura, per il dispatch.
///
/// Non attraversa il confine e non è una promessa: è quanto basta a riconoscere
/// una firma di formato (un `PK\x03\x04`, un `%PDF`, un frontmatter) senza
/// leggere la sorgente. Chi ha bisogno di più di così ha bisogno di un host, e
/// ce l'ha dentro `import`.
pub const PROLOGUE: usize = 8 * 1024;

/// Ciò che sta dietro una [`SourceHandle`].
///
/// Un trait e non un `File` perché le sorgenti non vengono tutte dal disco: un
/// download, un incolla, un'entrata di un archivio già aperto. Ciò che le
/// accomuna è saper rispondere a «dammi `len` byte a partire da `offset`», che è
/// la sola domanda che il contratto pone.
pub trait SourceBacking: Send {
    /// Legge a partire da `offset`. **Può restituire meno byte di `len`**, e
    /// deve restituirne zero quando `offset` è oltre la fine: è la firma del
    /// contratto, e chi la implementa non deve inventarsi un errore per dire
    /// «non c'è altro».
    fn read_at(&mut self, offset: u64, len: u32) -> Result<Vec<u8>, PluginError>;

    /// Quanti byte in tutto.
    fn len(&self) -> u64;

    /// Nessun byte.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// Una sorgente che sta su disco, letta senza entrarci tutta in memoria.
pub struct FileSource {
    file: File,
    len: u64,
}

impl FileSource {
    /// Apre il file. `Io` se non si può: aprire una sorgente è la prima cosa
    /// che può andare storta, e non è un difetto del provider che la riceverà.
    pub fn open(path: &Path) -> Result<Self, PluginError> {
        let file = File::open(path).map_err(|e| {
            PluginError::Io(format!("`{}` non si apre: {e}", path.display()).into())
        })?;
        let len = file
            .metadata()
            .map_err(|e| PluginError::Io(format!("`{}`: {e}", path.display()).into()))?
            .len();
        Ok(FileSource { file, len })
    }
}

impl SourceBacking for FileSource {
    fn read_at(&mut self, offset: u64, len: u32) -> Result<Vec<u8>, PluginError> {
        if offset >= self.len {
            return Ok(Vec::new());
        }
        self.file
            .seek(SeekFrom::Start(offset))
            .map_err(|e| PluginError::Io(format!("non si arriva a {offset}: {e}").into()))?;
        // `min` col residuo: allocare `len` su una richiesta da un gigabyte a
        // due byte dalla fine sarebbe un tetto dell'host pagato da chi non lo
        // ha superato.
        let quanti = (self.len - offset).min(u64::from(len)) as usize;
        let mut buf = vec![0u8; quanti];
        let letti = read_fino_a(&mut self.file, &mut buf)?;
        buf.truncate(letti);
        Ok(buf)
    }

    fn len(&self) -> u64 {
        self.len
    }
}

/// Legge riempiendo il buffer, fermandosi alla fine. `Interrupted` non è un
/// guasto: è il segnale che si riprova, e trattarlo come tale qui evita che una
/// lettura interrotta diventi una sorgente troncata in silenzio.
fn read_fino_a(f: &mut impl Read, buf: &mut [u8]) -> Result<usize, PluginError> {
    let mut letti = 0;
    while letti < buf.len() {
        match f.read(&mut buf[letti..]) {
            Ok(0) => break,
            Ok(n) => letti += n,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(PluginError::Io(format!("lettura fallita: {e}").into())),
        }
    }
    Ok(letti)
}

/// Una sorgente che sta già in memoria, dietro un handle.
///
/// Sembra una contraddizione e non lo è: serve a chi vuole *provare* la strada a
/// handle senza un file — i banchi di questo repo — e a chi ha byte che non
/// vengono dal disco. La forma che il provider vede è la stessa, ed è il punto.
pub struct MemorySource(pub Vec<u8>);

impl SourceBacking for MemorySource {
    fn read_at(&mut self, offset: u64, len: u32) -> Result<Vec<u8>, PluginError> {
        let da = (offset.min(self.0.len() as u64)) as usize;
        let a = da.saturating_add(len as usize).min(self.0.len());
        Ok(self.0[da..a].to_vec())
    }

    fn len(&self) -> u64 {
        self.0.len() as u64
    }
}

/// Le sorgenti che l'host tiene aperte, con la chiave che ha timbrato.
///
/// La chiave sale e non si riusa mai. Non è per eleganza: un numero riciclato
/// farebbe sì che un provider che si è tenuto un handle vecchio — cosa che il
/// contratto gli dice di non fare, ma che nessuno gli impedisce — leggerebbe
/// **la sorgente di qualcun altro** invece di ricevere il `BadArgs` che merita.
#[derive(Default)]
pub(crate) struct OpenSources {
    aperte: BTreeMap<u64, Box<dyn SourceBacking>>,
    prossima: u64,
}

impl OpenSources {
    /// Registra una sorgente e restituisce la sua chiave.
    pub(crate) fn open(&mut self, backing: Box<dyn SourceBacking>) -> SourceHandle {
        self.prossima += 1;
        let h = self.prossima;
        self.aperte.insert(h, backing);
        SourceHandle(h)
    }

    /// Chiude. Chiudere ciò che non c'è riesce: chi chiude due volte non sta
    /// sbagliando niente che valga un errore.
    pub(crate) fn close(&mut self, handle: SourceHandle) {
        self.aperte.remove(&handle.0);
    }

    pub(crate) fn read(
        &mut self,
        handle: SourceHandle,
        offset: u64,
        len: u32,
    ) -> Result<Vec<u8>, PluginError> {
        let Some(b) = self.aperte.get_mut(&handle.0) else {
            return Err(PluginError::BadArgs(
                "questo handle di sorgente non è (o non è più) aperto".into(),
            ));
        };
        b.read_at(offset, len)
    }

    /// Quanti byte ha la sorgente dietro una chiave.
    pub(crate) fn len(&self, handle: SourceHandle) -> Option<u64> {
        self.aperte.get(&handle.0).map(|b| b.len())
    }
}

// ---------------------------------------------------------------------------
// Il verso che esce
// ---------------------------------------------------------------------------

/// Un sink che tiene gli artefatti in memoria: il comportamento di sempre,
/// adesso dichiarato invece che implicito.
///
/// È il default di [`Workspace::export`](crate::workspace::Workspace::export) —
/// chi esporta tre note non deve scegliere una destinazione per averle.
#[derive(Default)]
pub struct MemorySink {
    aperti: BTreeMap<u64, (String, String, Vec<u8>)>,
    prossima: u64,
}

impl ArtifactSink for MemorySink {
    fn open_artifact(
        &mut self,
        path: &str,
        media_type: &str,
    ) -> Result<ArtifactHandle, PluginError> {
        controlla_path(path)?;
        self.prossima += 1;
        self.aperti.insert(
            self.prossima,
            (path.to_string(), media_type.to_string(), Vec::new()),
        );
        Ok(ArtifactHandle(self.prossima))
    }

    fn write_artifact(&mut self, handle: ArtifactHandle, bytes: &[u8]) -> Result<(), PluginError> {
        let Some((_, _, buf)) = self.aperti.get_mut(&handle.0) else {
            return Err(handle_ignoto());
        };
        buf.extend_from_slice(bytes);
        Ok(())
    }

    fn close_artifact(&mut self, handle: ArtifactHandle) -> Result<ExportArtifact, PluginError> {
        let Some((path, media_type, buf)) = self.aperti.remove(&handle.0) else {
            return Err(handle_ignoto());
        };
        // In memoria la ricevuta porta i byte: sono già qui, e dirlo
        // `Delivered` costringerebbe chi legge il rapporto a cercarli altrove
        // dove non ci sono.
        Ok(ExportArtifact {
            path,
            media_type,
            content: ArtifactContent::Bytes(buf),
        })
    }
}

/// Un sink che posa gli artefatti dentro una cartella.
///
/// È il lato host della promessa che la 0006 fa da sempre — «chi posa i byte
/// sul disco è l'host» — e fino alla 0102 non aveva un'implementazione, perché
/// i byte arrivavano tutti insieme e posarli era una riga di chi chiamava. Con
/// un export che versa a pezzi non lo è più.
///
/// # Il destinatario si tocca alla fine, o non si tocca
///
/// I byte non vanno sul path finale mentre arrivano: un export si versa a
/// pezzi, e un `File::create` sul destinatario **tronca subito** ciò che c'era
/// prima — quindi un export interrotto a metà (il provider che fallisce, il
/// processo che se ne va) aveva già distrutto l'esportazione precedente e ne
/// certificava come consegnata una monca. Ogni artefatto si scrive quindi
/// accanto, in un temporaneo con la forma che
/// [`nome_del_temporaneo`](crate::storage::nome_del_temporaneo) detta, e la
/// `rename` alla chiusura è ciò che lo rende visibile: chi guarda quella
/// cartella vede il file di prima finché non c'è quello nuovo, intero
/// (difetto 0183).
///
/// La ricevuta esce **dopo** un `sync_all`, e non dopo un `flush`: `File` non
/// ha un buffer suo, quindi il `flush` che stava qui non prometteva niente a
/// nessuno, mentre `ArtifactContent::Delivered` è un conto che dice «questi
/// byte ci sono».
pub struct DirectorySink {
    root: PathBuf,
    /// La radice risolta con `canonicalize`, calcolata una sola volta: è fissa
    /// per la vita del sink, e `resta_dentro` la chiedeva a ogni artefatto.
    root_vera: Option<PathBuf>,
    aperti: BTreeMap<u64, Artefatto>,
    prossima: u64,
}

/// Un artefatto a metà strada: dove sta adesso, dove andrà, e quanto ne è
/// passato.
struct Artefatto {
    path: String,
    media_type: String,
    /// Il temporaneo accanto al destinatario. È il file che si sta scrivendo.
    di_lato: PathBuf,
    /// Dove la `rename` lo porterà alla chiusura.
    dest: PathBuf,
    file: File,
    scritti: u64,
}

impl DirectorySink {
    /// Gli artefatti finiranno sotto `root`, che deve esistere.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        DirectorySink {
            root: root.into(),
            root_vera: None,
            aperti: BTreeMap::new(),
            prossima: 0,
        }
    }
}

impl ArtifactSink for DirectorySink {
    fn open_artifact(
        &mut self,
        path: &str,
        media_type: &str,
    ) -> Result<ArtifactHandle, PluginError> {
        controlla_path(path)?;
        let dest = self.root.join(path);
        let dir = dest.parent().unwrap_or(&self.root).to_path_buf();
        // Prima di creare, non dopo: `create_dir_all` attraversa un
        // collegamento senza chiedere, e le cartelle nate di là restano lì
        // anche se poi l'artefatto lo rifiutiamo.
        if self.root_vera.is_none() {
            self.root_vera = Some(self.root.canonicalize().map_err(|e| {
                PluginError::Io(format!("`{}` non si risolve: {e}", self.root.display()).into())
            })?);
        }
        let root_vera = self.root_vera.as_ref().expect("appena risolto");
        resta_dentro(root_vera, &dir)?;
        std::fs::create_dir_all(&dir)
            .map_err(|e| PluginError::Io(format!("`{}` non si crea: {e}", dir.display()).into()))?;
        // Il nome del file lo dà il provider ed è già passato da
        // `controlla_path`, quindi è UTF-8 e non ha separatori: la cartella
        // invece è quella che l'utente ha scelto, e può essere qualunque cosa.
        let nome = crate::storage::nome_del_temporaneo(
            dest.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("artefatto"),
        );
        let di_lato = dest.with_file_name(nome);
        let file = File::create(&di_lato).map_err(|e| {
            PluginError::Io(format!("`{}` non si scrive: {e}", dest.display()).into())
        })?;
        self.prossima += 1;
        self.aperti.insert(
            self.prossima,
            Artefatto {
                path: path.to_string(),
                media_type: media_type.to_string(),
                di_lato,
                dest,
                file,
                scritti: 0,
            },
        );
        Ok(ArtifactHandle(self.prossima))
    }

    fn write_artifact(&mut self, handle: ArtifactHandle, bytes: &[u8]) -> Result<(), PluginError> {
        let Some(a) = self.aperti.get_mut(&handle.0) else {
            return Err(handle_ignoto());
        };
        a.file
            .write_all(bytes)
            .map_err(|e| PluginError::Io(format!("`{}`: {e}", a.path).into()))?;
        a.scritti += bytes.len() as u64;
        Ok(())
    }

    fn close_artifact(&mut self, handle: ArtifactHandle) -> Result<ExportArtifact, PluginError> {
        let Some(a) = self.aperti.remove(&handle.0) else {
            return Err(handle_ignoto());
        };
        // Ogni via che esce di qui senza aver consegnato porta via il
        // temporaneo: un artefatto che non è arrivato non deve lasciare per
        // terra un file nascosto in una cartella dell'utente, che non è il
        // vault e non ha nessuna raccolta che ci passi.
        let guasto = |di_lato: &Path, e: std::io::Error, cosa: &str| {
            let _ = std::fs::remove_file(di_lato);
            PluginError::Io(format!("`{}` {cosa}: {e}", a.path).into())
        };
        // Il conto esce dopo che i byte sono sul disco, non dopo un `flush` che
        // su un `File` non fa niente.
        if let Err(e) = a.file.sync_all() {
            return Err(guasto(&a.di_lato, e, "non si conclude"));
        }
        drop(a.file);
        let di_lato = a.di_lato;
        if let Err(e) = std::fs::rename(&di_lato, &a.dest) {
            return Err(guasto(&di_lato, e, "non arriva a destinazione"));
        }
        // La cartella per ultima, e solo se si può guardare in UTF-8: è un
        // `fsync` best-effort come quello del vault, e la cartella la sceglie
        // l'utente in un dialogo di sistema.
        if let Some(dir) = a.dest.parent().and_then(Utf8Path::from_path) {
            crate::storage::sincronizza_la_cartella(dir);
        }
        Ok(ExportArtifact {
            path: a.path,
            media_type: a.media_type,
            content: ArtifactContent::Delivered(a.scritti),
        })
    }
}

/// Un sink che se ne va con degli artefatti ancora aperti non lascia i loro
/// temporanei per terra.
///
/// È il caso vero e non quello di scuola: l'export si interrompe perché il
/// provider ha fallito a metà, e chi lo teneva lascia cadere il sink senza
/// chiudere niente. Nel vault ci penserebbe la raccolta dei temporanei rimasti
/// indietro; qui siamo in una cartella dell'utente, dove non passa nessuno.
impl Drop for DirectorySink {
    fn drop(&mut self) {
        for (_, a) in std::mem::take(&mut self.aperti) {
            let _ = std::fs::remove_file(&a.di_lato);
        }
    }
}

fn handle_ignoto() -> PluginError {
    PluginError::BadArgs("questo handle di artefatto non è (o non è più) aperto".into())
}

/// Il path di un artefatto è **dentro l'esito**, e ci resta.
///
/// Stessa famiglia di `ImportSource::stem`, e per la stessa ragione: il path lo
/// scrive chi ha scritto il provider, cioè qualcuno che non è l'utente. Un
/// `../` qui non sarebbe un artefatto storto, sarebbe un file scritto fuori
/// dalla cartella che l'utente ha scelto nel dialogo.
/// **Un path lessicalmente pulito può uscire lo stesso dalla cartella scelta**,
/// e basta che un componente sia un collegamento: `esiti/fuga/rapporto.html` non
/// ha nessun `..` da rifiutare, ma se `fuga` è un symlink verso la home i byte
/// atterrano nella home (difetto 0194).
///
/// La differenza con [`controlla_path`] è chi risponde. Là la domanda è sul
/// *nome* — quello lo si può leggere — e la risposta è la stessa ovunque; qui la
/// domanda è «dove si finisce davvero», e a quella risponde solo il disco. Le due
/// stanno accanto perché la prima è la sola che il [`MemorySink`] può porre: in
/// memoria non c'è nessun collegamento da risolvere.
///
/// Si risolve il **primo antenato che esiste**, perché `canonicalize` non
/// risponde su un path che non c'è e i componenti mancanti li creerà questa
/// scrittura — cartelle vere, che non portano da nessuna parte. Il file finale
/// non entra nella domanda: i byte vanno in un temporaneo dal nome nuovo e la
/// `rename` della chiusura **sostituisce** un eventuale collegamento invece di
/// seguirlo, che è la stessa regola con cui il vault scrive (decisione 0065).
fn resta_dentro(root: &Path, dir: &Path) -> Result<(), PluginError> {
    let mut esistente = dir;
    while !esistente.exists() {
        match esistente.parent() {
            Some(su) => esistente = su,
            None => break,
        }
    }
    let dentro = esistente
        .canonicalize()
        .is_ok_and(|risolto| risolto.starts_with(root));
    if !dentro {
        return Err(PluginError::PermissionDenied(
            format!(
                "`{}` porta fuori dalla cartella scelta per l'export",
                dir.display()
            )
            .into(),
        ));
    }
    Ok(())
}

fn controlla_path(path: &str) -> Result<(), PluginError> {
    let storto = path.is_empty()
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains(':')
        || path
            .split(['/', '\\'])
            .any(|c| c == ".." || c == "." || c.is_empty());
    if storto {
        return Err(PluginError::PermissionDenied(
            format!("`{path}` non è un posto dentro l'esito di un export").into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// **Un collegamento dentro la cartella scelta non porta l'export fuori.**
    ///
    /// Il path dell'artefatto lo scrive chi ha scritto il provider, e qui non ha
    /// nessun `..` da farsi rifiutare: `fuga` è un nome come un altro, e il
    /// guardiano lessicale lo lasciava passare intero.
    ///
    /// Su Unix perché il caso si costruisce con un symlink, e su Windows crearne
    /// uno vuole un privilegio che un banco non ha.
    #[cfg(unix)]
    #[test]
    fn un_collegamento_nella_cartella_scelta_non_porta_l_export_fuori() {
        let scelta = tempfile::tempdir().expect("la cartella scelta nel dialogo");
        let altrove = tempfile::tempdir().expect("una cartella che nessuno ha scelto");
        std::os::unix::fs::symlink(altrove.path(), scelta.path().join("fuga"))
            .expect("il collegamento");

        let mut sink = DirectorySink::new(scelta.path());
        let e = sink
            .open_artifact("fuga/uscito.txt", "text/plain")
            .expect_err("un artefatto che atterra fuori dalla cartella scelta");
        assert!(
            matches!(e, PluginError::PermissionDenied(_)),
            "un'uscita dalla cartella scelta non è un permesso negato: {e:?}"
        );
        assert_eq!(
            std::fs::read_dir(altrove.path())
                .expect("la cartella di fuori")
                .count(),
            0,
            "l'export ha posato qualcosa fuori dalla cartella che l'utente ha scelto"
        );
    }

    #[test]
    fn una_lettura_oltre_la_fine_e_vuota_e_non_e_un_errore() {
        let mut s = MemorySource(b"0123456789".to_vec());
        assert_eq!(s.read_at(0, 4).unwrap(), b"0123");
        assert_eq!(s.read_at(8, 100).unwrap(), b"89");
        assert_eq!(
            s.read_at(10, 100).unwrap(),
            b"",
            "la fine si dice con un vuoto: chi legge in ciclo si ferma su \
             questo, e un errore lo farebbe fallire dopo aver letto tutto"
        );
        assert_eq!(s.read_at(9_999, 4).unwrap(), b"");
    }

    #[test]
    fn una_chiave_chiusa_non_diventa_la_sorgente_di_qualcun_altro() {
        let mut sorgenti = OpenSources::default();
        let a = sorgenti.open(Box::new(MemorySource(b"mia".to_vec())));
        sorgenti.close(a);
        let b = sorgenti.open(Box::new(MemorySource(b"tua".to_vec())));
        assert_ne!(
            a, b,
            "una chiave riciclata darebbe a chi si è tenuto un handle vecchio \
             la sorgente di qualcun altro invece del BadArgs che merita"
        );
        assert!(matches!(
            sorgenti.read(a, 0, 3),
            Err(PluginError::BadArgs(_))
        ));
        assert_eq!(sorgenti.read(b, 0, 3).unwrap(), b"tua");
    }

    #[test]
    fn un_artefatto_non_esce_dalla_cartella_che_l_utente_ha_scelto() {
        let mut sink = MemorySink::default();
        for storto in [
            "../fuori.md",
            "/etc/passwd",
            "a/../../b.md",
            "",
            "a//b.md",
            r"C:\x.md",
        ] {
            assert!(
                matches!(
                    sink.open_artifact(storto, "text/plain"),
                    Err(PluginError::PermissionDenied(_))
                ),
                "`{storto}` è stato accettato come posto dentro l'esito"
            );
        }
        assert!(sink.open_artifact("sotto/dentro.md", "text/plain").is_ok());
    }

    /// **Un export interrotto non ha già distrutto quello di prima** (difetto
    /// 0183).
    ///
    /// Il caso è quello vero: si riesporta sopra un'esportazione che c'è già —
    /// stesso nome di file, è il modo normale di aggiornarla — e il provider si
    /// ferma a metà. Prima di questa riga il destinatario era già troncato dal
    /// `File::create` e ci stavano dentro i byte arrivati fin lì.
    #[test]
    fn un_export_a_meta_non_ha_gia_mangiato_quello_di_prima() {
        let dir = tempfile::tempdir().expect("una cartella per l'esito");
        let dest = dir.path().join("esito.md");
        std::fs::write(&dest, b"l'esportazione di ieri").expect("c'era gia");

        let mut sink = DirectorySink::new(dir.path());
        let h = sink.open_artifact("esito.md", "text/markdown").unwrap();
        sink.write_artifact(h, b"meta").unwrap();
        // Il provider si ferma qui: nessuno chiude niente.
        drop(sink);

        assert_eq!(
            std::fs::read(&dest).unwrap(),
            b"l'esportazione di ieri",
            "il destinatario era già stato troncato: un export che non è mai \
             arrivato ha distrutto quello che c'era"
        );
        let rimasti: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.file_name()))
            .filter(|n| n != "esito.md")
            .collect();
        assert!(
            rimasti.is_empty(),
            "un temporaneo per terra in una cartella dell'utente, dove non \
             passa nessuna raccolta a toglierlo: {rimasti:?}"
        );
    }

    /// E quando invece arriva, arriva **intero e al suo nome**.
    ///
    /// La metà che impedisce alla riparazione di essere «non scrivere mai»: la
    /// `rename` deve portarlo a destinazione, e la ricevuta contare i byte che
    /// ci sono davvero.
    #[test]
    fn un_export_che_arriva_sostituisce_quello_di_prima_in_un_colpo() {
        let dir = tempfile::tempdir().expect("una cartella per l'esito");
        let dest = dir.path().join("esito.md");
        std::fs::write(&dest, b"l'esportazione di ieri").expect("c'era gia");

        let mut sink = DirectorySink::new(dir.path());
        let h = sink.open_artifact("esito.md", "text/markdown").unwrap();
        sink.write_artifact(h, b"quella ").unwrap();
        sink.write_artifact(h, b"di oggi").unwrap();
        let ricevuta = sink.close_artifact(h).unwrap();

        assert_eq!(std::fs::read(&dest).unwrap(), b"quella di oggi");
        assert_eq!(ricevuta.len(), 14, "il conto è dei byte consegnati");
        let quanti = std::fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(quanti, 1, "il temporaneo non è rimasto accanto");
    }

    #[test]
    fn la_ricevuta_conta_i_byte_che_sono_passati() {
        let mut sink = MemorySink::default();
        let h = sink.open_artifact("a.md", "text/markdown").unwrap();
        sink.write_artifact(h, b"uno").unwrap();
        sink.write_artifact(h, b"due").unwrap();
        let a = sink.close_artifact(h).unwrap();
        assert_eq!(a.len(), 6, "due versamenti, un conto solo");
        assert!(matches!(
            sink.close_artifact(h),
            Err(PluginError::BadArgs(_)),
        ));
    }
}

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
        let file = File::open(path).map_err(|and| {
            PluginError::Io(format!("cannot open `{}`: {and}", path.display()).into())
        })?;
        let len = file
            .metadata()
            .map_err(|and| PluginError::Io(format!("`{}`: {and}", path.display()).into()))?
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
            .map_err(|and| PluginError::Io(format!("cannot seek to {offset}: {and}").into()))?;
        // `min` col residuo: allocare `len` su una richiesta da un gigabyte a
        // due byte dalla fine sarebbe un tetto dell'host pagato da chi non lo
        // ha superato.
        let count = (self.len - offset).min(u64::from(len)) as usize;
        let mut buf = vec![0u8; count];
        let read = read_until_a(&mut self.file, &mut buf)?;
        buf.truncate(read);
        Ok(buf)
    }

    fn len(&self) -> u64 {
        self.len
    }
}

/// Legge riempiendo il buffer, fermandosi alla fine. `Interrupted` non è un
/// guasto: è il segnale che si riprova, e trattarlo come tale qui evita che una
/// lettura interrotta diventi una sorgente troncata in silenzio.
fn read_until_a(f: &mut impl Read, buf: &mut [u8]) -> Result<usize, PluginError> {
    let mut read = 0;
    while read < buf.len() {
        match f.read(&mut buf[read..]) {
            Ok(0) => break,
            Ok(n) => read += n,
            Err(and) if and.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(and) => return Err(PluginError::Io(format!("read failed: {and}").into())),
        }
    }
    Ok(read)
}

/// Una sorgente che sta già in memoria, dietro un handle.
///
/// Sembra una contraddizione e non lo è: serve a chi vuole *provare* la strada a
/// handle senza un file — i banchi di questo repo — e a chi ha byte che non
/// vengono dal disco. La forma che il provider vede è la stessa, ed è il punto.
pub struct MemorySource(pub Vec<u8>);

impl SourceBacking for MemorySource {
    fn read_at(&mut self, offset: u64, len: u32) -> Result<Vec<u8>, PluginError> {
        let from = (offset.min(self.0.len() as u64)) as usize;
        let a = from.saturating_add(len as usize).min(self.0.len());
        Ok(self.0[from..a].to_vec())
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
    open_sources: BTreeMap<u64, Box<dyn SourceBacking>>,
    next: u64,
}

impl OpenSources {
    /// Registra una sorgente e restituisce la sua chiave.
    pub(crate) fn open(&mut self, backing: Box<dyn SourceBacking>) -> SourceHandle {
        self.next += 1;
        let h = self.next;
        self.open_sources.insert(h, backing);
        SourceHandle(h)
    }

    /// Chiude. Chiudere ciò che non c'è riesce: chi chiude due volte non sta
    /// sbagliando niente che valga un errore.
    pub(crate) fn close(&mut self, handle: SourceHandle) {
        self.open_sources.remove(&handle.0);
    }

    pub(crate) fn read(
        &mut self,
        handle: SourceHandle,
        offset: u64,
        len: u32,
    ) -> Result<Vec<u8>, PluginError> {
        let Some(b) = self.open_sources.get_mut(&handle.0) else {
            return Err(PluginError::BadArgs(
                "this source handle is not (or is no longer) open".into(),
            ));
        };
        b.read_at(offset, len)
    }

    /// Quanti byte ha la sorgente dietro una chiave.
    pub(crate) fn len(&self, handle: SourceHandle) -> Option<u64> {
        self.open_sources.get(&handle.0).map(|b| b.len())
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
    open: BTreeMap<u64, (String, String, Vec<u8>)>,
    next: u64,
}

impl ArtifactSink for MemorySink {
    fn open_artifact(
        &mut self,
        path: &str,
        media_type: &str,
    ) -> Result<ArtifactHandle, PluginError> {
        check_path(path)?;
        self.next += 1;
        self.open.insert(
            self.next,
            (path.to_string(), media_type.to_string(), Vec::new()),
        );
        Ok(ArtifactHandle(self.next))
    }

    fn write_artifact(&mut self, handle: ArtifactHandle, bytes: &[u8]) -> Result<(), PluginError> {
        let Some((_, _, buf)) = self.open.get_mut(&handle.0) else {
            return Err(handle_unknown());
        };
        buf.extend_from_slice(bytes);
        Ok(())
    }

    fn close_artifact(&mut self, handle: ArtifactHandle) -> Result<ExportArtifact, PluginError> {
        let Some((path, media_type, buf)) = self.open.remove(&handle.0) else {
            return Err(handle_unknown());
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
/// [`temp_name`](crate::storage::temp_name) detta, e la
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
    /// per la vita del sink, e `stays_inside` la chiedeva a ogni artefatto.
    root_real: Option<PathBuf>,
    open: BTreeMap<u64, Artifact>,
    next: u64,
}

/// Un artefatto a metà strada: dove sta adesso, dove andrà, e quanto ne è
/// passato.
struct Artifact {
    path: String,
    media_type: String,
    /// Il temporaneo accanto al destinatario. È il file che si sta scrivendo.
    of_side: PathBuf,
    /// Dove la `rename` lo porterà alla chiusura.
    dest: PathBuf,
    file: File,
    written: u64,
}

impl DirectorySink {
    /// Gli artefatti finiranno sotto `root`, che deve esistere.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        DirectorySink {
            root: root.into(),
            root_real: None,
            open: BTreeMap::new(),
            next: 0,
        }
    }
}

impl ArtifactSink for DirectorySink {
    fn open_artifact(
        &mut self,
        path: &str,
        media_type: &str,
    ) -> Result<ArtifactHandle, PluginError> {
        check_path(path)?;
        let dest = self.root.join(path);
        let dir = dest.parent().unwrap_or(&self.root).to_path_buf();
        // Prima di creare, non dopo: `create_dir_all` attraversa un
        // collegamento senza chiedere, e le cartelle nate di là restano lì
        // anche se poi l'artefatto lo rifiutiamo.
        if self.root_real.is_none() {
            self.root_real = Some(self.root.canonicalize().map_err(|and| {
                PluginError::Io(format!("cannot resolve `{}`: {and}", self.root.display()).into())
            })?);
        }
        let root_real = self.root_real.as_ref().expect("just resolved");
        stays_inside(root_real, &dir)?;
        std::fs::create_dir_all(&dir)
            .map_err(|and| PluginError::Io(format!("cannot create `{}`: {and}", dir.display()).into()))?;
        // Il nome del file lo dà il provider ed è già passato da
        // `check_path`, quindi è UTF-8 e non ha separatori: la cartella
        // invece è quella che l'utente ha scelto, e può essere qualunque cosa.
        let name = crate::storage::temp_name(
            dest.file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("artefatto"),
        );
        let of_side = dest.with_file_name(name);
        let file = File::create(&of_side).map_err(|and| {
            PluginError::Io(format!("cannot write to `{}`: {and}", dest.display()).into())
        })?;
        self.next += 1;
        self.open.insert(
            self.next,
            Artifact {
                path: path.to_string(),
                media_type: media_type.to_string(),
                of_side,
                dest,
                file,
                written: 0,
            },
        );
        Ok(ArtifactHandle(self.next))
    }

    fn write_artifact(&mut self, handle: ArtifactHandle, bytes: &[u8]) -> Result<(), PluginError> {
        let Some(a) = self.open.get_mut(&handle.0) else {
            return Err(handle_unknown());
        };
        a.file
            .write_all(bytes)
            .map_err(|and| PluginError::Io(format!("`{}`: {and}", a.path).into()))?;
        a.written += bytes.len() as u64;
        Ok(())
    }

    fn close_artifact(&mut self, handle: ArtifactHandle) -> Result<ExportArtifact, PluginError> {
        let Some(a) = self.open.remove(&handle.0) else {
            return Err(handle_unknown());
        };
        // Ogni via che esce di qui senza aver consegnato porta via il
        // temporaneo: un artefatto che non è arrivato non deve lasciare per
        // terra un file nascosto in una cartella dell'utente, che non è il
        // vault e non ha nessuna raccolta che ci passi.
        let failure = |of_side: &Path, and: std::io::Error, what: &str| {
            let _ = std::fs::remove_file(of_side);
            PluginError::Io(format!("`{}` {what}: {and}", a.path).into())
        };
        // Il conto esce dopo che i byte sono sul disco, non dopo un `flush` che
        // su un `File` non fa niente.
        if let Err(and) = a.file.sync_all() {
            return Err(failure(&a.of_side, and, "sync failed"));
        }
        drop(a.file);
        let of_side = a.of_side;
        if let Err(and) = std::fs::rename(&of_side, &a.dest) {
            return Err(failure(&of_side, and, "rename to destination failed"));
        }
        // La cartella per ultima, e solo se si può guardare in UTF-8: è un
        // `fsync` best-effort come quello del vault, e la cartella la sceglie
        // l'utente in un dialogo di sistema.
        if let Some(dir) = a.dest.parent().and_then(Utf8Path::from_path) {
            crate::storage::sync_folder(dir);
        }
        Ok(ExportArtifact {
            path: a.path,
            media_type: a.media_type,
            content: ArtifactContent::Delivered(a.written),
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
        for (_, a) in std::mem::take(&mut self.open) {
            let _ = std::fs::remove_file(&a.of_side);
        }
    }
}

fn handle_unknown() -> PluginError {
    PluginError::BadArgs("this artifact handle is not (or is no longer) open".into())
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
/// La differenza con [`check_path`] è chi risponde. Là la domanda è sul
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
fn stays_inside(root: &Path, dir: &Path) -> Result<(), PluginError> {
    let mut existing = dir;
    while !existing.exists() {
        match existing.parent() {
            Some(on) => existing = on,
            None => break,
        }
    }
    let within = existing
        .canonicalize()
        .is_ok_and(|resolved| resolved.starts_with(root));
    if !within {
        return Err(PluginError::PermissionDenied(
            format!(
                "`{}` lands outside the folder chosen for the export",
                dir.display()
            )
            .into(),
        ));
    }
    Ok(())
}

fn check_path(path: &str) -> Result<(), PluginError> {
    let wrong = path.is_empty()
        || path.starts_with('/')
        || path.starts_with('\\')
        || path.contains(':')
        || path
            .split(['/', '\\'])
            .any(|c| c == ".." || c == "." || c.is_empty());
    if wrong {
        return Err(PluginError::PermissionDenied(
            format!("`{path}` is not a valid location inside an export output").into(),
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
    fn a_link_in_the_folder_choice_not_gate_the_export_outside() {
        let choice = tempfile::tempdir().expect("the folder chosen in the dialog");
        let elsewhere = tempfile::tempdir().expect("a folder nobody chose");
        std::os::unix::fs::symlink(elsewhere.path(), choice.path().join("fuga"))
            .expect("the link");

        let mut sink = DirectorySink::new(choice.path());
        let and = sink
            .open_artifact("fuga/uscito.txt", "text/plain")
            .expect_err("an artifact that lands outside the chosen folder");
        assert!(
            matches!(and, PluginError::PermissionDenied(_)),
            "escaping the chosen folder is not a permission denied: {and:?}"
        );
        assert_eq!(
            std::fs::read_dir(elsewhere.path())
                .expect("the outside folder")
                .count(),
            0,
            "the export placed something outside the folder the user chose"
        );
    }

    #[test]
    fn a_read_beyond_the_end_is_empty_not_an_error() {
        let mut s = MemorySource(b"0123456789".to_vec());
        assert_eq!(s.read_at(0, 4).unwrap(), b"0123");
        assert_eq!(s.read_at(8, 100).unwrap(), b"89");
        assert_eq!(
            s.read_at(10, 100).unwrap(),
            b"",
            "the end is signaled by an empty result: a loop reading on this \
             stops, while an error would cause it to fail after having read \
             everything"
        );
        assert_eq!(s.read_at(9_999, 4).unwrap(), b"");
    }

    #[test]
    fn a_key_closed_not_becomes_the_source_of_someone_other() {
        let mut sources = OpenSources::default();
        let a = sources.open(Box::new(MemorySource(b"mia".to_vec())));
        sources.close(a);
        let b = sources.open(Box::new(MemorySource(b"tua".to_vec())));
        assert_ne!(
            a, b,
            "a recycled key would give whoever kept an old handle someone \
             else's source instead of the BadArgs it deserves"
        );
        assert!(matches!(
            sources.read(a, 0, 3),
            Err(PluginError::BadArgs(_))
        ));
        assert_eq!(sources.read(b, 0, 3).unwrap(), b"tua");
    }

    #[test]
    fn a_artifact_not_exits_from_the_folder_that_the_user_has_selected() {
        let mut sink = MemorySink::default();
        for wrong in [
            "../fuori.md",
            "/etc/passwd",
            "a/../../b.md",
            "",
            "a//b.md",
            r"C:\x.md",
        ] {
            assert!(
                matches!(
                    sink.open_artifact(wrong, "text/plain"),
                    Err(PluginError::PermissionDenied(_))
                ),
                "`{wrong}` was accepted as a valid location inside the output"
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
    fn a_export_a_metadata_not_has_already_eaten_that_of_first() {
        let dir = tempfile::tempdir().expect("a folder for the output");
        let dest = dir.path().join("esito.md");
        std::fs::write(&dest, b"yesterday's export").expect("was already there");

        let mut sink = DirectorySink::new(dir.path());
        let h = sink.open_artifact("esito.md", "text/markdown").unwrap();
        sink.write_artifact(h, b"half").unwrap();
        // Il provider si ferma qui: nessuno chiude niente.
        drop(sink);

        assert_eq!(
            std::fs::read(&dest).unwrap(),
            b"yesterday's export",
            "the destination was already truncated: an export that never \
             arrived destroyed what was there"
        );
        let remaining: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|and| and.ok().map(|and| and.file_name()))
            .filter(|n| n != "esito.md")
            .collect();
        assert!(
            remaining.is_empty(),
            "a temp file left on the ground in a user's folder, where no \
             cleanup passes through: {remaining:?}"
        );
    }

    /// E quando invece arriva, arriva **intero e al suo nome**.
    ///
    /// La metà che impedisce alla riparazione di essere «non scrivere mai»: la
    /// `rename` deve portarlo a destinazione, e la ricevuta contare i byte che
    /// ci sono davvero.
    #[test]
    fn a_export_that_arrives_replaces_that_of_first_in_a_stroke() {
        let dir = tempfile::tempdir().expect("a folder for the output");
        let dest = dir.path().join("esito.md");
        std::fs::write(&dest, b"yesterday's export").expect("was already there");

        let mut sink = DirectorySink::new(dir.path());
        let h = sink.open_artifact("esito.md", "text/markdown").unwrap();
        sink.write_artifact(h, b"today's ").unwrap();
        sink.write_artifact(h, b"export").unwrap();
        let received = sink.close_artifact(h).unwrap();

        assert_eq!(std::fs::read(&dest).unwrap(), b"today's export");
        assert_eq!(received.len(), 14, "the count is of bytes delivered");
        let count = std::fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(count, 1, "the temp file did not remain alongside");
    }

    #[test]
    fn the_received_counts_the_byte_that_are_passed() {
        let mut sink = MemorySink::default();
        let h = sink.open_artifact("a.md", "text/markdown").unwrap();
        sink.write_artifact(h, b"one").unwrap();
        sink.write_artifact(h, b"two").unwrap();
        let a = sink.close_artifact(h).unwrap();
        assert_eq!(a.len(), 6, "two writes, one count");
        assert!(matches!(
            sink.close_artifact(h),
            Err(PluginError::BadArgs(_)),
        ));
    }
}

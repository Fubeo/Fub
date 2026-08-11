//! **La scrittura sa già che cosa ha scritto, e chi la sente rientrare la
//! riconosce come propria** (difetti 0179 e 0196).
//!
//! Sono due momenti della stessa scrittura, e prima di questo file nessuno dei
//! due era presidiato:
//!
//! 1. **subito dopo.** `touch_entry` ristatava il file appena scritto per
//!    prenderne dimensione e data, che i byte posati dicevano già. Costava una
//!    syscall per salvataggio, e in cambio apriva una finestra: se in quel
//!    momento un altro processo toglieva il file, l'anagrafe *toglieva la voce*
//!    di un documento che aveva appena risposto `Ok` e per cui era già uscito
//!    un `DocumentChanged`;
//! 2. **poco dopo.** Un salvataggio del kernel è una rename, una rename è un
//!    evento del filesystem, e il lotto del rilevatore riportava dentro il
//!    documento appena scritto — riletto, riparsato, reingerito, con un
//!    `DocumentChanged` a nome del rilevatore su una modifica che l'utente
//!    aveva appena fatto lui. Su ogni salvataggio di ogni nota.
//!
//! # Qui non si cronometra niente
//!
//! Un tempo su una macchina condivisa non è un segnale: si contano **le
//! operazioni**. Il supporto di prova annota le `read` e le `stat` per path, e
//! il provider di formato conta le proprie `parse`, che è il solo modo di
//! distinguere «non ha reingerito» da «ha reingerito una cosa uguale».
//!
//! # Il caso in cui non si riconosce, e va tenuto
//!
//! Il riconoscimento è **per impronta** e non per `mtime + size`. Il secondo è
//! il criterio dell'anagrafe (§14.1) e sarebbe costato una `stat` invece di una
//! lettura, ma sbaglia nel verso caro: una scrittura altrui nello stesso
//! millisecondo e della stessa lunghezza passerebbe per «immutato», e l'indice
//! resterebbe fermo su un documento vecchio. Per questo l'ultimo banco di
//! questo file guarda dall'altra parte — ciò che *è* cambiato da fuori deve
//! continuare a entrare — ed è la metà che rende il presidio un presidio invece
//! di una descrizione della scorciatoia.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::WriteBase;
use fub_abi::error::FormatError;
use fub_abi::event::{Event, Notice};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{IndexQuery, IndexResult, VaultEntry};
use fub_abi::FormatProvider;
use fub_kernel::storage::{DirEntry, FsStorage, Fusione, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, MachineSettings, Subscription, Workspace};

/// Il disco vero, con un quaderno accanto: **quali path si sono letti e quali
/// si sono statati**.
///
/// Il disco vero e non `MemStorage` perché le due porte del rilevatore
/// (`plan_sync`, `sync_path`) chiedono al filesystem se il path esiste: su un
/// supporto in memoria non ci sarebbe niente da sincronizzare, e il banco
/// sarebbe verde per la ragione sbagliata.
struct SupportoCheConta {
    inner: FsStorage,
    letture: Mutex<Vec<Utf8PathBuf>>,
    stat: Mutex<Vec<Utf8PathBuf>>,
    /// Il path che **sparisce nell'istante dopo essere stato scritto**: è la
    /// finestra del difetto 0179, presa invece che aspettata.
    sparisce: Mutex<Option<Utf8PathBuf>>,
}

impl SupportoCheConta {
    fn nuovo() -> Arc<Self> {
        Arc::new(SupportoCheConta {
            inner: FsStorage,
            letture: Mutex::new(Vec::new()),
            stat: Mutex::new(Vec::new()),
            sparisce: Mutex::new(None),
        })
    }

    fn letture_su(&self, path: &Utf8Path) -> usize {
        conta(&self.letture, path)
    }

    fn stat_su(&self, path: &Utf8Path) -> usize {
        conta(&self.stat, path)
    }

    fn azzera(&self) {
        self.letture.lock().expect("le letture").clear();
        self.stat.lock().expect("le stat").clear();
    }
}

fn conta(quaderno: &Mutex<Vec<Utf8PathBuf>>, path: &Utf8Path) -> usize {
    quaderno
        .lock()
        .expect("il quaderno")
        .iter()
        .filter(|p| p.as_path() == path)
        .count()
}

impl VaultStorage for SupportoCheConta {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        self.letture.lock().expect("le letture").push(path.into());
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<Stat> {
        let stat = self.inner.write(path, bytes)?;
        if self.sparisce.lock().expect("la finestra").as_deref() == Some(path) {
            self.inner.remove(path)?;
        }
        Ok(stat)
    }
    fn update(&self, path: &Utf8Path, fondi: Fusione<'_>) -> std::io::Result<()> {
        self.inner.update(path, fondi)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.inner.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.stat.lock().expect("le stat").push(path.into());
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

/// Un `.txt` che conta quante volte gli è stato chiesto di parsare.
struct FormatoCheConta(Arc<AtomicUsize>);

impl FormatProvider for FormatoCheConta {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("prova.conta", "Testo che conta (test)", &["txt"])
    }
    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::default()
    }
    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        self.0.fetch_add(1, Ordering::Relaxed);
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.text().unwrap_or_default().to_string();
        Ok(model)
    }
    fn render_html(&self, m: &DocumentModel, _o: &RenderOptions) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
    fn serialize(&self, m: &DocumentModel) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
}

struct Banco {
    _dir: tempfile::TempDir,
    root: Utf8PathBuf,
    supporto: Arc<SupportoCheConta>,
    parse: Arc<AtomicUsize>,
    ws: Workspace,
    rx: Subscription,
}

impl Banco {
    /// Una nota già indicizzata, i contatori a zero e la coda degli eventi
    /// vuota: da qui in poi tutto ciò che si conta è del salvataggio.
    fn nuovo() -> Banco {
        let dir = tempfile::tempdir().expect("cartella temporanea");
        let root = Utf8PathBuf::from_path_buf(dir.path().to_path_buf()).expect("path UTF-8");
        std::fs::write(root.join("nota.txt"), "prima\n").expect("semina");

        let supporto = SupportoCheConta::nuovo();
        let parse: Arc<AtomicUsize> = Arc::default();
        let mut registry = FormatRegistry::new();
        registry
            .register(Box::new(FormatoCheConta(parse.clone())))
            .expect("nessun conflitto di estensioni");
        let mut ws = Workspace::on(
            &root,
            registry,
            supporto.clone(),
            MachineSettings::in_memory(),
        );
        ws.reindex().expect("scansione iniziale");
        let rx = ws.bus().subscribe();
        supporto.azzera();
        parse.store(0, Ordering::Relaxed);
        Banco {
            _dir: dir,
            root,
            supporto,
            parse,
            ws,
            rx,
        }
    }

    fn nota(&self) -> Utf8PathBuf {
        self.root.join("nota.txt")
    }

    fn parse(&self) -> usize {
        self.parse.load(Ordering::Relaxed)
    }

    fn eventi(&self) -> Vec<Notice> {
        let mut visti = Vec::new();
        while let Ok(n) = self.rx.try_recv() {
            visti.push(n);
        }
        visti
    }

    fn voce(&self) -> Option<VaultEntry> {
        let IndexResult::Entries(page) = self
            .ws
            .query_index(IndexQuery::Entries {
                of_kind: None,
                within: None,
                page: None,
            })
            .expect("il kernel serve l'anagrafe")
        else {
            panic!("attesa l'anagrafe");
        };
        page.items.into_iter().find(|e| e.id.as_str() == "nota.txt")
    }
}

/// **Un salvataggio non torna a chiedere al disco cosa ha appena scritto**
/// (difetto 0179).
///
/// Zero letture e zero `stat` sul path della nota, e l'anagrafe che ne esce non
/// è un'approssimazione: dimensione e data sono **le stesse** che il
/// filesystem darebbe, perché vengono dal descrittore ancora aperto della
/// scrittura. Quella coincidenza è ciò che l'assenza della `stat` non può
/// costare — un'anagrafe con una data inventata farebbe rileggere l'intero
/// vault alla prossima apertura (§14.2), che è il baratto sbagliato.
#[test]
fn un_salvataggio_non_torna_a_chiedere_al_disco_cosa_ha_scritto() {
    let mut banco = Banco::nuovo();
    let nota = banco.nota();

    banco
        .ws
        .write_document(&DocId::new("nota.txt"), "seconda\n", WriteBase::Dictated)
        .expect("il salvataggio riesce");

    assert_eq!(
        banco.supporto.stat_su(&nota),
        0,
        "la scrittura ha ristatato il file che aveva appena posato: dimensione \
         e data le sanno i byte scritti, e chiederle di nuovo apre la finestra \
         in cui un altro processo può aver già tolto quel file (0179)"
    );
    assert_eq!(
        banco.supporto.letture_su(&nota),
        0,
        "la scrittura ha riletto ciò che ha scritto"
    );

    let voce = banco.voce().expect("la nota è in anagrafe");
    let vero = std::fs::metadata(&nota).expect("la nota sta sul disco");
    assert_eq!(voce.size, "seconda\n".len() as u64);
    assert_eq!(
        voce.mtime,
        vero.modified()
            .expect("il filesystem sa la data")
            .duration_since(std::time::UNIX_EPOCH)
            .expect("dopo il 1970")
            .as_millis() as u64,
        "l'anagrafe porta una data che non è quella del file: alla prossima \
         apertura nessuna voce combacerebbe, e il vault intero si rileggerebbe"
    );
}

/// **Una cancellazione nell'istante dopo non disfa l'anagrafe** (difetto 0179).
///
/// È la faccia di correttezza, e il comportamento **cambia** rispetto a prima:
/// dove il kernel toglieva la voce, adesso la tiene. È la risposta giusta, e la
/// ragione è l'ordine dei fatti — la scrittura ha risposto `Ok`, il
/// `DocumentChanged` è già uscito, e un'anagrafe che dicesse «quel documento
/// non c'è» contraddirebbe un evento che ha già annunciato il contrario, senza
/// annunciare niente a sua volta. La cancellazione è un fatto **di un altro**,
/// ed entra dalla porta da cui entrano i fatti altrui: il rilevatore, che la
/// riferisce con il suo `EntryRemoved`. Qui sotto se ne vede l'arrivo.
#[test]
fn una_cancellazione_nell_istante_dopo_non_disfa_l_anagrafe() {
    let mut banco = Banco::nuovo();
    let nota = banco.nota();
    *banco.supporto.sparisce.lock().expect("la finestra") = Some(nota.clone());

    banco
        .ws
        .write_document(&DocId::new("nota.txt"), "seconda\n", WriteBase::Dictated)
        .expect("il salvataggio riesce");

    assert!(
        banco.eventi().iter().any(|n| matches!(
            &n.event,
            Event::DocumentChanged { id, .. } if id.as_str() == "nota.txt"
        )),
        "la scrittura ha annunciato la modifica"
    );
    let voce = banco
        .voce()
        .expect("l'anagrafe tiene ciò che la scrittura ha annunciato");
    assert_eq!(
        voce.size,
        "seconda\n".len() as u64,
        "l'anagrafe descrive i byte scritti"
    );

    // E il fatto altrui arriva dalla sua porta, con il suo evento.
    *banco.supporto.sparisce.lock().expect("la finestra") = None;
    assert!(
        banco
            .ws
            .sync_path(&nota)
            .expect("la sincronizzazione riesce"),
        "il rilevatore vede che il file non c'è più"
    );
    assert!(banco.voce().is_none(), "e allora la voce se ne va");
}

/// **L'eco di un salvataggio non si riparsa e non annuncia niente** (difetto
/// 0196), dalla porta preparata — quella del lotto del rilevatore.
#[test]
fn l_eco_di_un_salvataggio_non_si_riparsa() {
    let mut banco = Banco::nuovo();
    let nota = banco.nota();
    banco
        .ws
        .write_document(&DocId::new("nota.txt"), "seconda\n", WriteBase::Dictated)
        .expect("il salvataggio riesce");
    banco.supporto.azzera();
    banco.parse.store(0, Ordering::Relaxed);
    let _ = banco.eventi();

    // Le due fasi del lotto, come le fa `ExternalSync::batch`.
    let piano = banco.ws.plan_sync(&nota);
    assert!(
        !banco
            .ws
            .sync_path_prepared(&nota, piano)
            .expect("la sincronizzazione riesce"),
        "il documento che il kernel ha appena scritto è tornato dentro come se \
         fosse cambiato da fuori (0196)"
    );

    assert_eq!(
        banco.parse(),
        0,
        "l'eco della propria scrittura è stata riparsata: succede a ogni \
         salvataggio di ogni nota"
    );
    assert!(
        banco.eventi().is_empty(),
        "l'eco ha annunciato un cambiamento a nome del rilevatore su una \
         modifica che l'utente aveva appena fatto lui"
    );
    assert!(
        banco.supporto.letture_su(&nota) <= 1,
        "riconoscere i propri byte costa la lettura del file, una volta: {}",
        banco.supporto.letture_su(&nota)
    );
}

/// **E lo eredita l'altra porta**, quella che il lotto prende quando il piano
/// non c'è: un file di cui nessuno ha preparato niente non deve costare di più.
#[test]
fn l_eco_non_si_riparsa_nemmeno_senza_piano() {
    let mut banco = Banco::nuovo();
    let nota = banco.nota();
    banco
        .ws
        .write_document(&DocId::new("nota.txt"), "seconda\n", WriteBase::Dictated)
        .expect("il salvataggio riesce");
    banco.supporto.azzera();
    banco.parse.store(0, Ordering::Relaxed);
    let _ = banco.eventi();

    assert!(
        !banco
            .ws
            .sync_path(&nota)
            .expect("la sincronizzazione riesce"),
        "niente è cambiato, e `sync_path` lo deve dire"
    );
    assert_eq!(banco.parse(), 0, "e non lo deve scoprire riparsando");
    assert!(banco.eventi().is_empty());
}

/// **Ciò che è cambiato davvero continua a entrare.**
///
/// È la metà che rende il riconoscimento un presidio e non una scorciatoia: se
/// bastasse un `return` all'inizio della sincronizzazione, i tre banchi sopra
/// sarebbero verdi e questo rosso.
#[test]
fn una_scrittura_altrui_entra_lo_stesso() {
    let mut banco = Banco::nuovo();
    let nota = banco.nota();
    banco
        .ws
        .write_document(&DocId::new("nota.txt"), "seconda\n", WriteBase::Dictated)
        .expect("il salvataggio riesce");
    banco.parse.store(0, Ordering::Relaxed);
    let _ = banco.eventi();

    std::fs::write(&nota, "da fuori\n").expect("scrittura da fuori");
    let piano = banco.ws.plan_sync(&nota);
    assert!(
        banco
            .ws
            .sync_path_prepared(&nota, piano)
            .expect("la sincronizzazione riesce"),
        "una scrittura di un altro processo è stata scambiata per la propria"
    );
    assert_eq!(banco.parse(), 1, "e si è riparsata, una volta");
    assert!(
        banco.eventi().iter().any(|n| matches!(
            &n.event,
            Event::DocumentChanged { id, .. } if id.as_str() == "nota.txt"
        )),
        "e chi ha il buffer aperto lo ha saputo"
    );
}

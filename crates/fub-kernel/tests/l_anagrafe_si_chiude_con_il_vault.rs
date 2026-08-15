//! **Ciò che si è toccato a sessione aperta non si riparsa alla riapertura.**
//!
//! # Perché un conto di letture e non un cronometro
//!
//! Il difetto che questo banco presidia era del tutto invisibile: l'anagrafe si
//! scriveva una volta sola, in fondo all'apertura, e le cinque strade che la
//! aggiornano a metà sessione (`touch_entry`: un salvataggio, una scrittura
//! vista dal rilevatore, il cestino, il ripristino, la rinomina) alzavano la
//! sola memoria. Alla riapertura quei documenti risultavano cambiati — perché
//! sul disco lo erano, rispetto a un'anagrafe di prima — e venivano riletti e
//! riparsati: esattamente il lavoro che l'anagrafe esiste per evitare.
//!
//! Non si vede col cronometro: su una nota sono microsecondi, e su una macchina
//! condivisa il rumore è più grande del segnale. Si vede contando **quante
//! `read` di documenti** passano per il supporto durante la riapertura. Quel
//! numero è lo stesso su ogni macchina, e la soglia qui sotto non è una stima:
//! è un'uguaglianza a zero.
//!
//! # Chi è stato rosso
//!
//! `una_riapertura_dopo_una_sessione_di_scritture_non_riparsa_niente`: togliendo
//! `store_entries` da [`Workspace::close_with`] fallisce con `letture = 40`
//! invece di `0` — una per documento toccato, su un vault di 400. Il numero
//! cresce col lavoro fatto nella sessione, non col vault: è il motivo per cui
//! la riga d'audit che lo descriveva («tutto ciò che si salva viene riletto»)
//! diceva più di quel che si osserva.
//!
//! `una_sessione_che_non_tocca_niente_non_riscrive_l_anagrafe`: togliendo il
//! confronto con la tabella già durevole in `EntryStore::store` fallisce con
//! `2` scritture invece di `0` — la fine dell'apertura e la chiusura, che si
//! scambiano lo stesso contenuto. È il rovescio della riga qui sopra: scrivere
//! l'anagrafe anche alla chiusura è gratis solo se non si riscrive ciò che il
//! disco ha già.
//!
//! **Verde anche prima, e dichiarato**: il secondo banco. Non prova che
//! qualcosa sia cambiato, prova che qualcosa **non** è cambiato — prima
//! rileggendo i quaranta documenti, adesso credendo all'anagrafe, la
//! riapertura racconta gli stessi link. È la metà che tiene ferma la
//! correttezza mentre la prima toglie il lavoro: un'anagrafe scritta alla
//! chiusura che raccontasse il contenuto di *prima* delle scritture farebbe
//! saltare il riparsing dicendo la cosa sbagliata, e il conto qui sopra
//! andrebbe al verde lo stesso.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use camino::{Utf8Path, Utf8PathBuf};
use fub_abi::edit::WriteBase;
use fub_abi::error::{FormatError, PluginError};
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel, Link, LinkTarget, Span};
use fub_abi::options::syntax;
use fub_abi::traits::{HostApi, IndexLoss, IndexProvider, IndexQuery, IndexResult, QueryRoute};
use fub_abi::FormatProvider;
use fub_kernel::storage::{DirEntry, Stat, VaultStorage};
use fub_kernel::{FormatRegistry, MachineSettings, MemStorage, Workspace};

/// Formato `.lnk`: una riga non vuota è il nome di una pagina collegata. È il
/// provider giocattolo di `workspace_incremental.rs`, ridotto a ciò che serve
/// qui: il kernel non deve conoscere il markdown nemmeno nei propri banchi.
struct LinkListProvider;

impl FormatProvider for LinkListProvider {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("linklist", "Lista di link (test)", &["lnk"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::of(&[syntax::WIKILINKS])
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let source = source.text().unwrap_or_default();
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        let mut offset = 0usize;
        for line in source.lines() {
            let span = Span::new(offset, offset + line.len());
            offset += line.len() + 1;
            let page = line.trim();
            if page.is_empty() {
                continue;
            }
            model.links.push(Link {
                target: LinkTarget::wiki(page),
                embed: false,
                span,
                context: None,
            });
        }
        model.text = source.to_string();
        Ok(model)
    }

    fn render_html(&self, m: &DocumentModel, _o: &RenderOptions) -> Result<String, FormatError> {
        Ok(format!("<pre>{}</pre>", m.text))
    }

    fn serialize(&self, m: &DocumentModel) -> Result<String, FormatError> {
        Ok(m.text.clone())
    }
}

/// Un supporto che **conta le letture dei documenti** e per il resto è il
/// supporto in memoria.
///
/// È la stessa cucitura di `SupportoCheAnnota` (`la_radice_non_si_muove.rs`)
/// stretta su una domanda sola: quanti documenti sono passati per il disco. Il
/// conto è **solo** sulle `read` di file `.lnk`, perché ciò che si vuole vedere
/// è il riparsing e non l'anagrafe, che si legge comunque una volta.
struct SupportoCheConta {
    inner: MemStorage,
    letture_di_documenti: Arc<AtomicUsize>,
    scritture_dell_anagrafe: Arc<AtomicUsize>,
}

impl SupportoCheConta {
    fn nuovo() -> (Arc<Self>, Arc<AtomicUsize>, Arc<AtomicUsize>) {
        let letture = Arc::new(AtomicUsize::new(0));
        let scritture = Arc::new(AtomicUsize::new(0));
        (
            Arc::new(SupportoCheConta {
                inner: MemStorage::new(),
                letture_di_documenti: Arc::clone(&letture),
                scritture_dell_anagrafe: Arc::clone(&scritture),
            }),
            letture,
            scritture,
        )
    }
}

impl VaultStorage for SupportoCheConta {
    fn read(&self, path: &Utf8Path) -> std::io::Result<Vec<u8>> {
        if path.as_str().ends_with(".lnk") {
            self.letture_di_documenti.fetch_add(1, Ordering::Relaxed);
        }
        self.inner.read(path)
    }
    fn write(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<fub_kernel::storage::Stat> {
        if path.as_str().ends_with("entries.json") {
            self.scritture_dell_anagrafe.fetch_add(1, Ordering::Relaxed);
        }
        self.inner.write(path, bytes)
    }
    /// L'anagrafe passa di qui e non dalla `write`, perché si **fonde** con ciò
    /// che sul disco c'è adesso (difetto 0189): a contare è la fusione che
    /// risponde con dei byte, cioè il file che cambia davvero — un
    /// aggiornamento che risponde «non scrivo» non è una scrittura, ed è
    /// esattamente ciò che questi banchi non vogliono contare.
    fn update(
        &self,
        path: &Utf8Path,
        fondi: fub_kernel::storage::Fusione<'_>,
    ) -> std::io::Result<()> {
        let anagrafe = path.as_str().ends_with("entries.json");
        let scritture = Arc::clone(&self.scritture_dell_anagrafe);
        let mut contando = move |vecchio: Option<&[u8]>| {
            let esito = fondi(vecchio);
            if anagrafe && matches!(esito, Ok(Some(_))) {
                scritture.fetch_add(1, Ordering::Relaxed);
            }
            esito
        };
        self.inner.update(path, &mut contando)
    }
    fn append(&self, path: &Utf8Path, bytes: &[u8]) -> std::io::Result<()> {
        if path.as_str().ends_with("entries.json") {
            self.scritture_dell_anagrafe.fetch_add(1, Ordering::Relaxed);
        }
        self.inner.append(path, bytes)
    }
    fn rename(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename(from, to)
    }
    fn rename_no_replace(&self, from: &Utf8Path, to: &Utf8Path) -> std::io::Result<()> {
        self.inner.rename_no_replace(from, to)
    }
    fn remove(&self, path: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove(path)
    }
    fn list(&self, dir: &Utf8Path) -> std::io::Result<Vec<DirEntry>> {
        self.inner.list(dir)
    }
    fn stat(&self, path: &Utf8Path) -> std::io::Result<Stat> {
        self.inner.stat(path)
    }
    fn remove_empty_dir(&self, dir: &Utf8Path) -> std::io::Result<()> {
        self.inner.remove_empty_dir(dir)
    }
}

/// Un indice che al `flush` **guarda l'orologio del disco**: si segna quante
/// volte l'anagrafe è già stata scritta nel momento in cui tocca a lui.
///
/// È tutto ciò che serve a rendere osservabile un ordine. Un indice che non
/// persiste niente non ha modo di accorgersi di essere stato chiuso dopo
/// l'anagrafe, e quello vero — la ricerca — se ne accorgerebbe solo alla
/// riapertura successiva a un processo ucciso in mezzo, che non è un fatto che
/// un banco possa produrre.
struct IndiceCheGuardaLAnagrafe {
    scritture_dell_anagrafe: Arc<AtomicUsize>,
    visto_ai_flush: Arc<std::sync::Mutex<Vec<usize>>>,
}

impl IndiceCheGuardaLAnagrafe {
    fn guarda(&self) {
        self.visto_ai_flush
            .lock()
            .unwrap()
            .push(self.scritture_dell_anagrafe.load(Ordering::Relaxed));
    }
}

impl IndexProvider for IndiceCheGuardaLAnagrafe {
    fn routes(&self) -> Vec<QueryRoute> {
        Vec::new()
    }
    fn activate(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        Ok(())
    }
    fn on_documents_indexed(&mut self, _docs: &[DocumentModel]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn on_documents_removed(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn reconcile(&mut self, _ids: &[DocId]) -> Vec<IndexLoss> {
        Vec::new()
    }
    fn flush(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.guarda();
        Ok(())
    }
    fn close(&mut self, _host: &mut dyn HostApi) -> Result<(), PluginError> {
        self.guarda();
        Ok(())
    }
    fn query(&self, _query: IndexQuery) -> Result<IndexResult, PluginError> {
        Err(PluginError::Unserved("niente".into()))
    }
}

const ROOT: &str = "/vault-anagrafe-alla-chiusura";
/// Quanti documenti. Non tre: il numero sbagliato deve essere **grande**
/// abbastanza da non sembrare un arrotondamento.
const DOCUMENTI: usize = 400;
/// Quanti se ne toccano a sessione aperta. È il numero che il difetto faceva
/// ricomparire come letture alla riapertura.
const TOCCATI: usize = 40;

fn nome(i: usize) -> String {
    format!("nota{i:04}.lnk")
}

fn semina(storage: &Arc<SupportoCheConta>) {
    for i in 0..DOCUMENTI {
        storage
            .inner
            .write(
                &Utf8PathBuf::from(format!("{ROOT}/{}", nome(i))),
                format!("nota{:04}\n", (i + 1) % DOCUMENTI).as_bytes(),
            )
            .expect("semina");
    }
}

fn aperto(storage: Arc<SupportoCheConta>) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(LinkListProvider))
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::on(
        ROOT,
        registry,
        storage as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("l'apertura del vault riesce");
    ws.reindex().expect("apertura");
    ws
}

/// [`aperto`], con **un indice registrato**: il terzo banco ne ha bisogno
/// perché l'ordine fra l'anagrafe e il flush si vede solo da dentro un flush.
fn aperto_con_indice(storage: Arc<SupportoCheConta>, index: IndiceCheGuardaLAnagrafe) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(LinkListProvider))
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::on(
        ROOT,
        registry,
        storage as Arc<dyn VaultStorage>,
        MachineSettings::in_memory(),
    )
    .expect("l'apertura del vault riesce");
    ws.register_core_feature("test.orologio", "test.orologio")
        .expect("dichiarato");
    ws.register_index_provider("test.orologio", Box::new(index))
        .expect("registrato");
    ws.reindex().expect("apertura");
    ws
}

/// Il corpo che le scritture di metà sessione lasciano: punta a un documento
/// **diverso** da quello di partenza, così che un'anagrafe stantia si veda
/// anche dai link e non solo dal conto.
fn corpo_nuovo(i: usize) -> String {
    format!("nota{:04}\n", (i + 7) % DOCUMENTI)
}

#[test]
fn una_riapertura_dopo_una_sessione_di_scritture_non_riparsa_niente() {
    let (storage, letture, _scritture) = SupportoCheConta::nuovo();
    semina(&storage);

    // Prima apertura: si legge tutto, ed è giusto — l'anagrafe non c'era.
    let mut prima = aperto(Arc::clone(&storage));
    assert_eq!(
        letture.load(Ordering::Relaxed),
        DOCUMENTI,
        "la prima apertura deve aver letto tutto: senza, il banco non ha soggetto"
    );

    // La sessione: si salva un pugno di note, e l'anagrafe in memoria le segue.
    for i in 0..TOCCATI {
        prima
            .write_document(&DocId::new(nome(i)), &corpo_nuovo(i), WriteBase::Dictated)
            .expect("salva");
    }
    prima.close();
    drop(prima);

    letture.store(0, Ordering::Relaxed);
    let _dopo = aperto(Arc::clone(&storage));
    let riletti = letture.load(Ordering::Relaxed);
    assert_eq!(
        riletti, 0,
        "la riapertura ha riletto e riparsato {riletti} documenti su {DOCUMENTI}: \
         l'anagrafe non ha seguito le {TOCCATI} scritture della sessione fino al disco"
    );
}

/// **Una sessione che non tocca niente non riscrive l'anagrafe.**
///
/// È il rovescio della riga qui sopra, e senza di esso quella riga sarebbe una
/// riparazione a metà: scrivere l'anagrafe alla chiusura vuol dire passare due
/// volte per lo stesso file in una sessione, e chi apre un vault e lo chiude
/// senza salvare niente pagherebbe una riga per file del vault per non dire
/// niente di nuovo — su un vault di duemila note sono tre megabyte e mezzo
/// riscritti a ogni uscita.
///
/// La soglia è **zero** e non «poche»: nella seconda sessione l'anagrafe sul
/// disco dice già tutto, quindi né la fine dell'apertura né la chiusura hanno
/// niente da scriverci.
#[test]
fn una_sessione_che_non_tocca_niente_non_riscrive_l_anagrafe() {
    let (storage, _letture, scritture) = SupportoCheConta::nuovo();
    semina(&storage);

    // Prima apertura: l'anagrafe nasce, e si scrive.
    let mut prima = aperto(Arc::clone(&storage));
    prima.close();
    drop(prima);
    assert!(
        scritture.load(Ordering::Relaxed) >= 1,
        "la prima apertura non ha scritto l'anagrafe: il banco non ha soggetto"
    );

    // Seconda: si apre da un'anagrafe che dice già tutto e si chiude senza
    // toccare niente.
    scritture.store(0, Ordering::Relaxed);
    let mut seconda = aperto(Arc::clone(&storage));
    seconda.close();
    let volte = scritture.load(Ordering::Relaxed);
    assert_eq!(
        volte, 0,
        "l'anagrafe è stata riscritta {volte} volte da una sessione che non ha \
         toccato nessun file: si riserializza e si sostituisce tutta anche \
         quando non è cambiato niente"
    );
}

/// La metà che il conto non vede: **l'anagrafe scritta alla chiusura deve dire
/// ciò che c'è sul disco**, non ciò che c'era all'apertura.
///
/// Un conto di letture è cieco alla taglia e al contenuto (trappola 14): una
/// chiusura che scrivesse l'anagrafe di *prima* delle scritture porterebbe il
/// banco sopra al verde per la ragione peggiore — la riapertura salterebbe il
/// riparsing credendo a metadati vecchi, e i link della nota resterebbero quelli
/// di ieri senza che nessuno se ne accorga fino a un `vault.repair`.
#[test]
fn l_anagrafe_scritta_alla_chiusura_racconta_le_scritture_e_non_l_apertura() {
    let (storage, _letture, _scritture) = SupportoCheConta::nuovo();
    semina(&storage);

    let mut prima = aperto(Arc::clone(&storage));
    for i in 0..TOCCATI {
        prima
            .write_document(&DocId::new(nome(i)), &corpo_nuovo(i), WriteBase::Dictated)
            .expect("salva");
    }
    prima.close();
    drop(prima);

    let dopo = aperto(Arc::clone(&storage));
    for i in 0..TOCCATI {
        assert_eq!(
            dopo.outgoing(&DocId::new(nome(i))),
            vec![DocId::new(nome((i + 7) % DOCUMENTI))],
            "{}: la riapertura racconta i link che il documento aveva all'apertura, \
             non quelli che la sessione gli ha scritto",
            nome(i)
        );
    }
    // E ciò che nessuno ha toccato è rimasto quello che era: la chiusura scrive
    // l'anagrafe, non la reinventa.
    assert_eq!(
        dopo.outgoing(&DocId::new(nome(DOCUMENTI - 1))),
        vec![DocId::new(nome(0))]
    );
}

/// **L'anagrafe si scrive per ultima, e non prima degli indici** (difetto
/// 0190).
///
/// I due punti che scrivono l'una e gli altri erano due — la fine
/// dell'apertura e la chiusura — e tenevano l'ordine opposto, quindi quale
/// stato a metà restasse sul disco dopo un'interruzione lo decideva quale dei
/// due percorsi stava correndo. Uno dei due ordini è però il solo che regga,
/// perché i due stati a metà non si equivalgono: l'anagrafe è ciò che alla
/// riapertura *risparmia* il lavoro — una voce che combacia col disco non si
/// rilegge, non si riparsa e non torna agli indici —, quindi un'anagrafe
/// scritta **prima** del flush è un disco che dichiara indicizzato ciò che
/// nessun indice ha ancora ricevuto, e alla riapertura quelle note ci sono, si
/// aprono, si leggono, e dalla ricerca sono sparite senza che nessuno lo dica.
/// Il verso opposto — flush fatto, anagrafe no — è il degrado che questo file
/// dichiara in testa: si rilegge, e non si perde niente.
///
/// Il conto non è un cronometro né un ordine di path: è l'indice stesso che, al
/// proprio `flush`, si segna quante volte l'anagrafe è già passata dal
/// supporto. Alla chiusura di una sessione che ha scritto, quel numero deve
/// essere ancora quello di fine apertura — l'anagrafe della chiusura viene
/// dopo.
#[test]
fn alla_chiusura_l_anagrafe_si_scrive_dopo_gli_indici() {
    let (storage, _letture, scritture) = SupportoCheConta::nuovo();
    semina(&storage);

    let visto_ai_flush = Arc::new(std::sync::Mutex::new(Vec::new()));
    let mut ws = aperto_con_indice(
        Arc::clone(&storage),
        IndiceCheGuardaLAnagrafe {
            scritture_dell_anagrafe: Arc::clone(&scritture),
            visto_ai_flush: Arc::clone(&visto_ai_flush),
        },
    );

    // Senza scritture la chiusura non ha niente da mettere in anagrafe, e il
    // banco resterebbe verde per assenza di soggetto.
    for i in 0..TOCCATI {
        ws.write_document(&DocId::new(nome(i)), &corpo_nuovo(i), WriteBase::Dictated)
            .expect("salva");
    }
    ws.close();

    let visti = visto_ai_flush.lock().unwrap().clone();
    let totale = scritture.load(Ordering::Relaxed);
    let ultimo = *visti
        .last()
        .expect("l'indice dev'essere stato chiuso almeno una volta");
    assert!(
        visti.len() >= 2 && totale >= 2,
        "il banco non ha soggetto: servono un giro d'indice e una scrittura \
         d'anagrafe alla fine dell'apertura e altrettanti alla chiusura \
         (viste: {visti:?}, anagrafi: {totale})"
    );
    assert_eq!(
        ultimo,
        totale - 1,
        "l'ultima volta che un indice ha scritto, l'anagrafe della chiusura era \
         già sul disco: da lì in avanti il disco dichiara indicizzato ciò che \
         quell'indice non ha ancora finito di scrivere, e chi muore in quella \
         finestra riapre un vault in cui le note ci sono, si aprono e si \
         leggono, ma dalla ricerca sono sparite in silenzio (viste: {visti:?}, \
         anagrafi in tutto: {totale})"
    );
}

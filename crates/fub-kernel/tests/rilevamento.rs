//! **Il rilevamento delle modifiche esterne si può chiedere** (§9.7, decisione
//! 0030).
//!
//! Il watcher è l'unico meccanismo con cui Fub viene a sapere che qualcun
//! altro ha toccato il vault: non c'è una riconciliazione periodica, `reindex`
//! gira solo all'apertura, e niente confronta mai la cache col disco. Finché
//! nessuno chiedeva se fosse vivo, un vault **con** rilevamento e uno **senza**
//! erano indistinguibili da fuori — e la sincronizzazione per-path scartava il
//! proprio esito con un `let _ =`, quindi un file che non si legge lasciava la
//! cache, il grafo e l'indice fermi a *prima*, per sempre, senza che niente lo
//! dicesse.
//!
//! Qui si prova che quei due fatti adesso **si chiedono**, e dallo stesso posto
//! da cui si chiede tutto il resto: il canale dati.

use camino::Utf8PathBuf;
use fub_abi::error::FormatError;
use fub_abi::format::{
    DocumentSource, FormatCapabilities, FormatDescriptor, ParseContext, RenderOptions,
};
use fub_abi::model::{DocId, DocumentModel};
use fub_abi::traits::{IndexQuery, IndexResult, VaultStatus};
use fub_abi::FormatProvider;
use fub_kernel::{FormatRegistry, Workspace};

/// Un formato `.txt` che si limita a tenere il testo: qui il parse non è la
/// cosa in prova, la lettura sì.
struct TestoNudo;

impl FormatProvider for TestoNudo {
    fn descriptor(&self) -> FormatDescriptor {
        FormatDescriptor::text("testo", "Testo nudo (test)", &["txt"])
    }

    fn capabilities(&self) -> FormatCapabilities {
        FormatCapabilities::of(&[])
    }

    fn parse(
        &self,
        source: &DocumentSource,
        ctx: &ParseContext,
    ) -> Result<DocumentModel, FormatError> {
        let mut model = DocumentModel::empty(DocId::new(ctx.doc_id.clone()));
        model.text = source.text().unwrap_or_default().to_string();
        Ok(model)
    }

    fn render_html(
        &self,
        model: &DocumentModel,
        _opts: &RenderOptions,
    ) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }

    fn serialize(&self, model: &DocumentModel) -> Result<String, FormatError> {
        Ok(model.text.clone())
    }
}

/// Directory temporanea usa-e-getta (niente dipendenze di test nel kernel).
struct TempDir(Utf8PathBuf);

impl TempDir {
    fn new(tag: &str) -> Self {
        let base = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .expect("temp dir non UTF-8")
            .join(format!("fub-rilevamento-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&base).expect("crea temp dir");
        TempDir(base)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn workspace(dir: &Utf8PathBuf) -> Workspace {
    let mut registry = FormatRegistry::new();
    registry
        .register(Box::new(TestoNudo))
        .expect("nessun conflitto di estensioni");
    let mut ws = Workspace::new(dir, registry).expect("l'apertura del vault riesce");
    ws.reindex().expect("scansione");
    ws
}

/// Lo stato del vault **passando dal canale dati**, che è l'unica strada che
/// avrà anche una feature.
fn stato(ws: &Workspace) -> VaultStatus {
    match ws.query_index(IndexQuery::VaultStatus) {
        Ok(IndexResult::VaultStatus(s)) => s,
        other => panic!("il canale dati ha risposto fuori tema: {other:?}"),
    }
}

/// Un vault senza rilevatore **lo dice**, e lo dice a chiunque sappia fare una
/// query — non a chi ha in mano l'host.
#[test]
fn un_vault_senza_rilevatore_lo_dice() {
    let dir = TempDir::new("senza");
    let ws = workspace(&dir.0);

    let s = stato(&ws);
    assert!(
        !s.watching,
        "nessuno ha alzato la bandiera: qui le scritture altrui non le vede nessuno"
    );
    assert_eq!(s.sync_failures, 0);
    assert_eq!(s.last_sync_error, None);
}

/// La bandiera è **una sola**, ed è del kernel: chi guarda la alza e la
/// risposta del canale dati cambia da sé.
///
/// È il punto della voce: prima la risposta era *per costruzione* — chi non
/// aveva avviato un debouncer diceva `false`, chi ne aveva avviato uno diceva
/// `true` per sempre, anche da morto — e nessuno gliela chiedeva.
#[test]
fn la_bandiera_e_una_sola_e_la_tiene_chi_guarda() {
    let dir = TempDir::new("bandiera");
    let ws = workspace(&dir.0);

    // Chi monta prende la bandiera e la alza avviandosi. Qui il rilevatore non
    // c'è — il kernel non sa cosa sia, ed è esattamente il motivo per cui il
    // fatto gli arriva così.
    let flag = ws.watch_flag();
    flag.store(true, std::sync::atomic::Ordering::Relaxed);
    assert!(stato(&ws).watching, "la risposta segue la bandiera");

    // E quando chi guarda smette — un debouncer che riporta errori, o che viene
    // distrutto — la abbassa, senza che nessuno debba avvisare il kernel.
    flag.store(false, std::sync::atomic::Ordering::Relaxed);
    assert!(
        !stato(&ws).watching,
        "una copia del valore, invece della bandiera, sarebbe rimasta a `true`"
    );
}

/// **Un esito scartato resta scritto.** I due chiamanti veri sono nel callback
/// del watcher e scrivono `let _ = ws.sync_path(…)`: qui si fa la stessa cosa,
/// e il vault se lo ricorda lo stesso.
#[test]
fn un_esito_scartato_dal_chiamante_resta_scritto_nel_vault() {
    let dir = TempDir::new("esito");
    let mut ws = workspace(&dir.0);

    // Un file che c'è e non si legge: byte non UTF-8 dentro un'estensione
    // gestita. È il caso vero — un file scritto da un'altra app con un encoding
    // suo — e non un errore inventato.
    let path = dir.0.join("Nota.txt");
    std::fs::write(&path, [0x66, 0x75, 0xff, 0xfe, 0x62]).expect("scrive i byte");

    // Esattamente come lo chiama il watcher: l'esito non lo guarda nessuno.
    let _ = ws.sync_path(&path);

    let s = stato(&ws);
    assert_eq!(
        s.sync_failures, 1,
        "il fallimento è stato contato anche se il chiamante non lo ha letto"
    );
    let messaggio = s.last_sync_error.expect("c'è un ultimo errore");
    assert!(
        messaggio.contains("Nota.txt"),
        "l'errore dice quale file: {messaggio}"
    );

    // Un secondo tentativo che va a buon fine non cancella il conto: «è già
    // successo» resta vero, e ciò che è rimasto indietro non torna indietro da
    // sé.
    std::fs::write(&path, "adesso si legge").expect("riscrive");
    ws.sync_path(&path).expect("adesso passa");
    let dopo = stato(&ws);
    assert_eq!(dopo.sync_failures, 1, "il conto non si azzera da solo");
    assert!(
        ws.read_source(&DocId::new("Nota.txt")).is_ok(),
        "e il documento è entrato: il conto è una memoria, non uno stato bloccante"
    );
}

/// Un rename riferito dal filesystem che fallisce conta **una volta sola**,
/// anche quando degrada internamente a `sync_path`.
#[test]
fn un_rename_che_fallisce_conta_una_volta_sola() {
    let dir = TempDir::new("rename");
    let mut ws = workspace(&dir.0);

    let da = dir.0.join("Vecchia.txt");
    let a = dir.0.join("Nuova.txt");
    // `da` non è mai stato indicizzato, quindi `sync_renamed_path` degrada al
    // percorso per-path su `a` — che non si legge.
    std::fs::write(&a, [0xff, 0xfe]).expect("scrive i byte");

    let _ = ws.sync_renamed_path(&da, &a);

    assert_eq!(
        stato(&ws).sync_failures,
        1,
        "la porta registra, il corpo interno no: un fallimento è un fallimento"
    );
}

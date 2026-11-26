use super::*;

/// Una politica che nega una famiglia sola: serve a provare il cancello di
/// [`Capability::Env`], che `ReadOnly` **concede** — leggere che ore sono
/// non è un effetto — e che quindi il presidio delle capacità simulate non
/// esercita.
struct Negate(Capability);

impl Policy for Negate {
    fn denies(&self, cap: Capability) -> Option<String> {
        (cap == self.0).then(|| "for testing".to_string())
    }
}

/// Un host che concede entropia a chiunque gliela chieda: ciò che si prova
/// qui è il cancello, non ciò che sta dietro.
struct Generous;

impl HostEnv for Generous {
    fn now_unix_millis(&self) -> u64 {
        0
    }

    fn user_locale(&self) -> Locale {
        Locale::default()
    }

    fn random_bytes(&self, n: u32) -> Result<Vec<u8>, PluginError> {
        Ok(vec![7; n as usize])
    }

    fn active_context(&self) -> Option<ViewContext> {
        None
    }
}

/// Un host che un contesto ce l'ha, con dentro una nota e del testo
/// selezionato: è il solo modo di provare che il cancello della selezione
/// taglia **un campo** e non la risposta intera.
struct WithContext;

impl HostEnv for WithContext {
    fn now_unix_millis(&self) -> u64 {
        0
    }

    fn user_locale(&self) -> Locale {
        Locale::default()
    }

    fn random_bytes(&self, n: u32) -> Result<Vec<u8>, PluginError> {
        Ok(vec![7; n as usize])
    }

    fn active_context(&self) -> Option<ViewContext> {
        Some(
            ViewContext::new("pane-1")
                .with_doc(Some(DocId::new("Diario/2026-08-04.md")))
                .with_selections(Some(fub_abi::session::SelectionSet::anchored(
                    fub_abi::model::Span::new(0, 7),
                    "segreto",
                ))),
        )
    }
}

/// **La leva che la 0095 esiste per dare**: il vault concesso, la nota
/// concessa, il testo no.
///
/// È il caso del diario — «sai che nota guardo, non sai cosa ci sto
/// scrivendo» — e non sarebbe stato esprimibile appoggiando la selezione a
/// `read-vault`, che è la strada che la §23.5 raccomandava per prima:
/// negarla lì avrebbe reso il plugin cieco sul vault, cioè avrebbe tolto
/// all'utente proprio la scelta fine.
#[test]
fn denying_the_selection_leaves_the_notes_visible() {
    let guard = Guard::new(WithContext, Negate(Capability::SessionSelection));
    let context = guard
        .active_context()
        .expect("denying the selection does not deny the context");
    assert_eq!(
        context.doc,
        Some(DocId::new("Diario/2026-08-04.md")),
        "which note I am looking at stays granted: it is the other permission"
    );
    assert!(
        context.selections.is_none(),
        "the selected text must not come through: {:?}",
        context.selections
    );
}

/// L'altro cancello, quello grosso: senza `Session` non c'è contesto, e con
/// lui se ne va anche il testo — che è dentro, e senza un contesto non ha
/// dove stare.
#[test]
fn denying_the_session_takes_the_selection_with_it() {
    let guard = Guard::new(WithContext, Negate(Capability::Session));
    assert!(
        guard.active_context().is_none(),
        "without `Session` the answer is that of a host without a shell"
    );
}

/// Il cancello dell'orologio non è più quello della sessione, ed è **tutta
/// la voce**: prima erano la stessa famiglia, quindi negare il testo
/// selezionato voleva dire negare che ore sono.
#[test]
fn the_clock_and_the_session_are_no_longer_the_same_gate() {
    let no_session = Guard::new(WithContext, Negate(Capability::Session));
    assert_eq!(
        no_session.now_unix_millis(),
        0,
        "the clock belongs to the machine: denying the session does not touch it"
    );
    let no_clock = Guard::new(WithContext, Negate(Capability::Env));
    assert!(
        no_clock.active_context().is_some(),
        "and vice versa: denying the clock does not deny which note is open"
    );
}

#[test]
fn session_context_honors_its_document_prefix() {
    let permissions = PluginPermissions {
        granted: [
            (permission::READ_SESSION, serde_json::json!(["Diario"])),
            (permission::READ_SELECTION, serde_json::json!(["Diario"])),
        ]
        .into_iter()
        .collect(),
    };
    let guard = Guard::new(
        WithContext,
        Granted::new("p", &permissions, Trust::Community),
    );
    assert!(guard.active_context().is_some());

    let permissions = PluginPermissions {
        granted: [(permission::READ_SESSION, serde_json::json!(["Progetti"]))]
            .into_iter()
            .collect(),
    };
    let guard = Guard::new(
        WithContext,
        Granted::new("p", &permissions, Trust::Community),
    );
    assert!(guard.active_context().is_none());
}

/// Il caso negato **dice di essere negato**, e non rende il vuoto.
///
/// Era l'unico fallback muto del `Guard` che mentiva: un `Vec` vuoto arriva
/// a chi chiama identico al troncamento sopra il tetto, e i due si
/// correggono in modi opposti — chiedere meno serve in un caso e non serve
/// a niente nell'altro (§23.12, decisione 0094). Un `assert` sulla
/// lunghezza sarebbe passato anche prima: solo la variante lo presidia.
#[test]
fn denied_entropy_says_so_instead_of_answering_empty() {
    let guard = Guard::new(Generous, Negate(Capability::Env));
    let err = guard
        .random_bytes(16)
        .expect_err("without `Env` entropy is not granted");
    assert!(
        matches!(err, PluginError::PermissionDenied(_)),
        "the refusal must name the permission: {err}"
    );
    assert!(
        err.message().to_string().contains("16"),
        "and it must say what was being done: {err}"
    );
}

/// Negare un'altra famiglia non tocca questa: il cancello è per famiglia, e
/// un `check` sulla capacità sbagliata passerebbe di qui rosso.
#[test]
fn a_different_denial_leaves_entropy_alone() {
    let guard = Guard::new(Generous, Negate(Capability::VaultWrite));
    assert_eq!(guard.random_bytes(4).unwrap().len(), 4);
}

/// Un host che annulla e basta: ciò che si prova qui è il cancello, non ciò
/// che sta dietro. Un `undo_last` arrivato fin qui è un annullamento
/// **eseguito**, ed è esattamente ciò che i banchi qui sotto pretendono di
/// vedere o di non vedere.
struct Undoes;

impl HostCommands for Undoes {
    fn run_command(
        &mut self,
        _command: &str,
        _args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError> {
        unreachable!("no bench in this module invokes a command")
    }

    fn undo_last(&mut self) -> Result<Option<Undone>, PluginError> {
        Ok(Some(Undone::whole(fub_abi::text::Text::Literal(
            "the rename".into(),
        ))))
    }
}
struct CountsUndoes(std::sync::Arc<std::sync::atomic::AtomicUsize>);

impl HostCommands for CountsUndoes {
    fn run_command(
        &mut self,
        _command: &str,
        _args: serde_json::Value,
    ) -> Result<CommandOutcome, PluginError> {
        unreachable!("no bench in this module invokes a command")
    }

    fn undo_last(&mut self) -> Result<Option<Undone>, PluginError> {
        self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(Some(Undone::whole(fub_abi::text::Text::Literal(
            "the replacement".into(),
        ))))
    }
}

struct CountsGlobalStructure {
    renames: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    sweeps: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

impl VaultRead for CountsGlobalStructure {
    fn read_document(&self, _id: &DocId) -> Result<String, PluginError> {
        unreachable!("the structural authorization benches do not read")
    }

    fn read_document_bytes(&self, _id: &DocId) -> Result<Vec<u8>, PluginError> {
        unreachable!("the structural authorization benches do not read bytes")
    }

    fn document_revision(&self, _id: &DocId) -> Result<Revision, PluginError> {
        unreachable!("the structural authorization benches do not read revisions")
    }

    fn list_documents(&self, _page: Option<Page>) -> Result<Paged<DocId>, PluginError> {
        unreachable!("the structural authorization benches do not list documents")
    }

    fn free_name(&self, id: &DocId) -> DocId {
        id.clone()
    }

    fn read_model(&self, _id: &DocId) -> Result<DocumentModel, PluginError> {
        unreachable!("the structural authorization benches do not parse")
    }

    fn format_of(&self, _id: &DocId) -> Option<DocumentFormat> {
        None
    }

    fn format_link(
        &self,
        _doc: &DocId,
        _link: &fub_abi::format::LinkInsert,
    ) -> Result<Option<String>, PluginError> {
        Ok(None)
    }

    fn task_state_edit(
        &self,
        _doc: &DocId,
        _marker: &fub_abi::model::TaskMarker,
        _done: bool,
    ) -> Result<Option<EditRequest>, PluginError> {
        Ok(None)
    }

    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError> {
        unreachable!("the structural authorization benches do not list trash")
    }
}

impl VaultStructure for CountsGlobalStructure {
    fn create_document(&mut self, _id: &DocId, _source: &str) -> Result<(), PluginError> {
        unreachable!("the structural authorization benches do not create")
    }

    fn rename_document(&mut self, _from: &DocId, _to: &DocId) -> Result<(), PluginError> {
        self.renames
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }

    fn trash_document(&mut self, _id: &DocId) -> Result<DocId, PluginError> {
        unreachable!("the structural authorization benches do not trash")
    }

    fn restore_document(
        &mut self,
        _entry: &DocId,
        _to: Option<DocId>,
    ) -> Result<DocId, PluginError> {
        unreachable!("the structural authorization benches do not restore")
    }

    fn empty_trash(&mut self) -> Result<u64, PluginError> {
        self.sweeps
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(0)
    }
}

fn scoped_structure_guard(
    renames: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    sweeps: std::sync::Arc<std::sync::atomic::AtomicUsize>,
) -> Guard<CountsGlobalStructure, Granted> {
    let mut permissions = PluginPermissions::of(&[permission::WRITE_VAULT]);
    permissions
        .granted
        .set(permission::WRITE_VAULT, serde_json::json!(["public/"]));
    Guard::new(
        CountsGlobalStructure { renames, sweeps },
        Granted::new("scoped", &permissions, Trust::Community),
    )
}

#[test]
fn a_path_scoped_rename_never_reaches_the_inner_mutation() {
    let renames = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let sweeps = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let mut guard = scoped_structure_guard(
        std::sync::Arc::clone(&renames),
        std::sync::Arc::clone(&sweeps),
    );

    let error = guard
        .rename_document(
            &DocId::new("public/Before.md"),
            &DocId::new("public/After.md"),
        )
        .expect_err("backlink rewrites require an unrestricted writer");

    assert!(matches!(error, PluginError::PermissionDenied(_)));
    assert_eq!(
        renames.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "both endpoints are in scope, but the global backlink mutation stays fenced"
    );
    assert_eq!(sweeps.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[test]
fn a_path_scoped_empty_trash_never_reaches_the_inner_sweep() {
    let renames = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let sweeps = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let mut guard = scoped_structure_guard(
        std::sync::Arc::clone(&renames),
        std::sync::Arc::clone(&sweeps),
    );

    let error = guard
        .empty_trash()
        .expect_err("emptying trash requires unrestricted structure access");

    assert!(matches!(error, PluginError::PermissionDenied(_)));
    assert_eq!(
        sweeps.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "the root path gate runs before the wrapped host can sweep"
    );
    assert_eq!(renames.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[test]
fn a_path_scoped_writer_cannot_start_a_global_undo() {
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let mut permissions =
        PluginPermissions::of(&[permission::RUN_COMMAND, permission::WRITE_VAULT]);
    permissions
        .granted
        .set(permission::WRITE_VAULT, serde_json::json!(["public/"]));
    let policy = Granted::new("scoped", &permissions, Trust::Community);
    let mut guard = Guard::new(CountsUndoes(std::sync::Arc::clone(&calls)), policy);

    let err = guard
        .undo_last()
        .expect_err("a public-only writer cannot undo a vault-wide entry");

    assert!(matches!(err, PluginError::PermissionDenied(_)));
    assert_eq!(
        calls.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "the path gate runs before the wrapped host can pop or replay"
    );
}

struct CountsByteWrites {
    writes: std::sync::Arc<std::sync::atomic::AtomicUsize>,
}

impl VaultRead for CountsByteWrites {
    fn read_document(&self, _id: &DocId) -> Result<String, PluginError> {
        unreachable!("the byte-write authorization benches do not read")
    }

    fn read_document_bytes(&self, _id: &DocId) -> Result<Vec<u8>, PluginError> {
        unreachable!("the byte-write authorization benches do not read bytes")
    }

    fn document_revision(&self, _id: &DocId) -> Result<Revision, PluginError> {
        unreachable!("the byte-write authorization benches do not read revisions")
    }

    fn list_documents(&self, _page: Option<Page>) -> Result<Paged<DocId>, PluginError> {
        unreachable!("the byte-write authorization benches do not list documents")
    }

    fn free_name(&self, id: &DocId) -> DocId {
        id.clone()
    }

    fn read_model(&self, _id: &DocId) -> Result<DocumentModel, PluginError> {
        unreachable!("the byte-write authorization benches do not parse")
    }

    fn format_of(&self, _id: &DocId) -> Option<DocumentFormat> {
        None
    }

    fn format_link(
        &self,
        _doc: &DocId,
        _link: &fub_abi::format::LinkInsert,
    ) -> Result<Option<String>, PluginError> {
        Ok(None)
    }

    fn task_state_edit(
        &self,
        _doc: &DocId,
        _marker: &fub_abi::model::TaskMarker,
        _done: bool,
    ) -> Result<Option<EditRequest>, PluginError> {
        Ok(None)
    }

    fn list_trash(&self) -> Result<Vec<TrashEntry>, PluginError> {
        unreachable!("the byte-write authorization benches do not list trash")
    }
}

impl VaultWrite for CountsByteWrites {
    fn write_document(
        &mut self,
        _id: &DocId,
        _source: &str,
        _base: WriteBase,
    ) -> Result<Revision, PluginError> {
        unreachable!("the byte-write authorization benches do not write text")
    }

    fn write_document_bytes(
        &mut self,
        _id: &DocId,
        bytes: &[u8],
        _expected: Option<Revision>,
    ) -> Result<Revision, PluginError> {
        self.writes
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(Revision::of_bytes(bytes))
    }

    fn apply_edit(
        &mut self,
        _id: &DocId,
        _request: EditRequest,
    ) -> Result<EditReport, PluginError> {
        unreachable!("the byte-write authorization benches do not edit")
    }
}

/// Il difetto che questo presidia è aggiungere il metodo al tratto e
/// dimenticare il cancello: la scrittura binaria passerebbe dove quella
/// testuale è negata, con gli stessi byte e un'altra porta.
#[test]
fn a_denied_writer_never_reaches_the_inner_byte_sink() {
    let writes = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let mut guard = Guard::new(
        CountsByteWrites {
            writes: std::sync::Arc::clone(&writes),
        },
        Negate(Capability::VaultWrite),
    );
    let err = guard
        .write_document_bytes(&DocId::new("Note.md"), &[0, 159, 146, 150], None)
        .expect_err("without `VaultWrite` raw bytes are not deposited");
    assert!(
        matches!(err, PluginError::PermissionDenied(_)),
        "the refusal must be a permission refusal: {err}"
    );
    assert_eq!(
        writes.load(std::sync::atomic::Ordering::SeqCst),
        0,
        "the family gate runs before the wrapped host can deposit a byte"
    );
}

/// Il rovescio: i byte stanno sotto la stessa famiglia del testo, non sotto
/// quella della lettura — negare `VaultRead` non chiude il deposito.
#[test]
fn denying_the_read_leaves_the_byte_sink_open() {
    let writes = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let mut guard = Guard::new(
        CountsByteWrites {
            writes: std::sync::Arc::clone(&writes),
        },
        Negate(Capability::VaultRead),
    );
    let bytes = [0u8, 159, 146, 150];
    let revision = guard
        .write_document_bytes(&DocId::new("Note.md"), &bytes, None)
        .expect("denying the read has nothing to do with depositing bytes");
    assert_eq!(revision, Revision::of_bytes(&bytes));
    assert_eq!(
        writes.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "the write reaches the wrapped host exactly once"
    );
}

/// **Disfare chiede lo stesso permesso di fare.**
///
/// La voce in cima alla pila può essere l'inverso di una rinomina, di una
/// creazione o di un cestinamento — cose che sono passate da
/// [`Capability::VaultStructure`] — e il cancello dell'annullamento chiedeva
/// la sola [`Capability::VaultWrite`]: chi aveva il permesso di riscrivere
/// il testo di una nota poteva disfare un trasloco che non avrebbe potuto
/// fare. Un recinto che perde restando scritto è il difetto peggiore che un
/// recinto possa avere, perché nessuno lo va a rileggere.
#[test]
fn undo_does_not_undo_a_family_that_is_not_granted() {
    let mut guard = Guard::new(Undoes, Negate(Capability::VaultStructure));
    let err = guard
        .undo_last()
        .expect_err("without `VaultStructure` a rename is not undone");
    assert!(
        matches!(err, PluginError::PermissionDenied(_)),
        "the refusal must be a permission refusal: {err}"
    );
    assert!(
        err.message().to_string().contains("undoing"),
        "and it must say what was being done: {err}"
    );
}

/// L'altra metà, che è ciò che rende il banco qui sopra una misura e non un
/// divieto: con le famiglie della scrittura concesse l'annullamento arriva
/// all'host e torna con la sua voce. Una famiglia estranea negata non lo
/// tocca — il cancello resta quello dell'annullamento, non un no generico.
#[test]
fn with_the_granted_families_the_undo_passes() {
    let mut guard = Guard::new(Undoes, Negate(Capability::Network));
    let undone = guard
        .undo_last()
        .expect("denying the network has nothing to do with undoing")
        .expect("the host has an entry to undo");
    assert_eq!(
        undone.label,
        fub_abi::text::Text::Literal("the rename".into())
    );
}

/// L'ultima famiglia dichiarata, nominata dal **compilatore** e non da un
/// conto.
///
/// L'aritmetica del presidio qui sotto sa dire se `ALL` è coerente con sé
/// stesso — niente buchi, niente doppioni — e non sa quante famiglie
/// esistano fuori di lui: togliere l'**ultima** riga e portare la lunghezza
/// a diciotto la lascia verde, perché `visti` e `attesi` diventano tutti e
/// due `0..17`. Cioè restava scoperto il caso che capita davvero, ed è
/// quello per cui il presidio esiste: aggiungo una famiglia in fondo e mi
/// dimentico `ALL`.
///
/// Il `match` è esaustivo apposta e non ha altro mestiere: una famiglia
/// nuova non compila finché non le si dà un posto qui. Lo ha trovato la
/// [§23.2](../../../../docs/decisions/0191-ui-dichiarativa-e-renderer.md)
/// provando rosso il presidio gemello delle superfici, che da questo aveva
/// copiato la forma **e il buco**.
fn last_declared_family(cap: Capability) -> u16 {
    match cap {
        Capability::VaultRead => 0,
        Capability::VaultWrite => 1,
        Capability::VaultStructure => 2,
        Capability::DataRead => 3,
        Capability::DataWrite => 4,
        Capability::Query => 5,
        Capability::Drafts => 6,
        Capability::Env => 7,
        Capability::Session => 8,
        Capability::SessionSelection => 9,
        Capability::Events => 10,
        Capability::Commands => 11,
        Capability::Services => 12,
        Capability::Network => 13,
        Capability::SettingsRead => 14,
        Capability::SettingsWrite => 15,
        Capability::ViewStateRead => 16,
        Capability::ViewStateWrite => 17,
        Capability::Transfer => 18,
        Capability::Notifications => 19,
    }
}

/// `ALL` è l'unico elenco scritto a mano rimasto in questo modulo, e tutto
/// il resto gli sta a valle: `Granted::new` ci folda sopra per calcolare i
/// permessi, e il presidio delle capacità simulate
/// (`kernel/tests/invoke_command.rs`) ci ricava l'insieme che pretende di
/// aver provato. Una famiglia che non finisse qui sparirebbe da entrambi
/// **restando verde** — e il commento sopra `ALL` diceva che «nascerebbe
/// negata a tutti, che è il modo giusto di sbagliare, ma va visto»: la prima
/// metà è vera per costruzione, la seconda non lo era da nessuna parte.
///
/// La lunghezza dichiarata (`[Capability; N]`, oggi venti) obbliga a **toccare**
/// l'elenco quando l'enum cresce, ma non a metterci dentro la variante
/// giusta: chi ha fretta soddisfa il compilatore duplicando una riga già
/// presente, e la famiglia nuova non viene iterata mai.
///
/// Questo lo chiude senza una proc-macro, sfruttando ciò su cui
/// [`CapabilitySet`] fa già affidamento (`1 << cap as u32`): i discriminanti
/// sono contigui da zero, quindi pretendere che quelli di `ALL` siano
/// esattamente `0..len` vieta insieme i duplicati e i buchi. Duplicare una
/// riga è rosso; dimenticare la variante nuova è rosso — **tranne in coda**,
/// e per quello c'è `last_declared_family`.
#[test]
fn the_discriminants_cover_every_family() {
    assert_eq!(
        Capability::ALL.len(),
        last_declared_family(Capability::Notifications) as usize + 1,
        "`Capability::ALL` is shorter than the enum: there is a family that \
             the compiler knows and the list does not name. It is the case the \
             arithmetic below does not see."
    );

    // E ognuna al **posto** che l'enum le dà. L'aritmetica qui sotto
    // ordina prima di confrontare, quindi due righe scambiate le sfuggono:
    // l'ha misurato la verifica del rosso della
    // [0105](../../../../docs/decisions/0191-ui-dichiarativa-e-renderer.md),
    // scambiando `SettingsRead` e `SettingsWrite` e trovando il workspace
    // interamente verde. Il presidio gemello delle superfici questo ciclo
    // ce l'aveva; questo, da cui quello aveva copiato la forma, no — ed è
    // la seconda zona cieca che si scopre guardando l'originale invece del
    // ricalco.
    for &cap in &Capability::ALL {
        assert_eq!(
            Capability::ALL[last_declared_family(cap) as usize],
            cap,
            "`{cap:?}` is not in `ALL` at the position the enum declaration \
                 gives it: two lines have been swapped, and whoever reads `ALL` \
                 to know the permission order reads an order that is not the \
                 real one."
        );
    }

    let mut seen: Vec<u16> = Capability::ALL.iter().map(|&c| c as u16).collect();
    seen.sort_unstable();
    let expected: Vec<u16> = (0..Capability::ALL.len() as u16).collect();
    assert_eq!(
        seen, expected,
        "`Capability::ALL` does not cover every family of the enum exactly \
             once: either a line is duplicated, or the new family was not added \
             and the length was made to work with a duplicate. Whatever is not \
             in `ALL` is not granted by `Granted::new` and not expected by the \
             simulated-capability guard: it disappears from both while staying \
             green."
    );
    assert!(
        Capability::ALL.len() <= u32::BITS as usize,
        "`CapabilitySet` holds families in a `u32`. It was a `u16`, and the \
             bits really did run out: with 0095 the families were sixteen — \
             exactly the bits — and 0096 gated them to seventeen. This line \
             noticed before `1 << cap` overflowed (in debug with a panic, in \
             release **silently**, that is granting a family to someone who had \
             not declared it). At thirty-three it will happen again: widen the \
             type, do not remove the assert."
    );
}

/// **Ogni permesso che governa una famiglia ha un nome nell'elenco che si
/// mostra** (§23.17).
///
/// È il presidio che rende vera la parola *tutti* del pannello dei permessi:
/// una famiglia nuova col suo permesso nuovo, dimenticato in
/// [`permission::ALL`](fub_abi::options::permission::ALL), sarebbe un
/// cancello che esiste, che l'utente non vede e che non può negare — cioè
/// esattamente il difetto da cui questa voce è nata, ripetuto in silenzio.
///
/// Il verso opposto **non** si presidia, ed è deliberato: `fub:camera`,
/// `fub:microphone`, `fub:read-clipboard`, `fub:write-clipboard` e
/// `fub:external-fs` sono nomi che nessuna famiglia consuma ancora, e
/// pretendere la corrispondenza piena costringerebbe a toglierli — cioè a
/// lasciare liberi cinque nomi che qualcun altro potrebbe prendersi.
///
/// E un nome tenuto senza famiglia va tenuto **della grana giusta**: gli
/// appunti erano uno e sono due dalla 0144, perché una spunta sola diceva
/// insieme *«può incollare»* e *«può leggere ciò che hai copiato»*, e la
/// grana di un permesso si corregge gratis solo finché nessun manifest l'ha
/// scritto.
#[test]
fn every_family_permission_is_named() {
    for cap in Capability::ALL {
        let Some(key) = cap.permission() else {
            continue;
        };
        assert!(
            permission::ALL.contains(&key),
            "family {cap:?} is governed by `{key}`, which is not in \
                 `permission::ALL`: no panel would show it, and the \
                 kernel would not fabricate the key used to deny it."
        );
    }
}

/// Un host che risponde a qualunque domanda: ciò che si prova qui è quale
/// **cancello** attraversa, non cosa c'è dietro.
struct ScopedDrafts;

impl HostQuery for ScopedDrafts {
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        match query {
            IndexQuery::Drafts { .. } => Ok(IndexResult::Drafts(Paged::all(vec![
                fub_abi::traits::DraftInfo {
                    doc: DocId::new("Progetti/2026.md"),
                    at: 0,
                    base: None,
                    exists: true,
                    current: None,
                    text: "inside".into(),
                },
                fub_abi::traits::DraftInfo {
                    doc: DocId::new("Altro/2026.md"),
                    at: 0,
                    base: None,
                    exists: true,
                    current: None,
                    text: "outside".into(),
                },
            ]))),
            _ => Ok(IndexResult::Documents(Paged::all(Vec::new()))),
        }
    }
}

#[test]
fn draft_results_are_filtered_one_item_at_a_time() {
    let granted = with_paths(permission::READ_DRAFTS, &["Progetti"]);
    let guard = Guard::new(ScopedDrafts, granted);
    let IndexResult::Drafts(page) = guard
        .query_index(IndexQuery::Drafts { page: None })
        .expect("drafts are granted")
    else {
        panic!("expected draft result");
    };
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].doc, DocId::new("Progetti/2026.md"));
}

struct IndexHost;

impl HostQuery for IndexHost {
    fn query_index(&self, query: IndexQuery) -> Result<IndexResult, PluginError> {
        match query {
            IndexQuery::Drafts { .. } => Ok(IndexResult::Drafts(Paged::all(vec![
                fub_abi::traits::DraftInfo {
                    doc: DocId::new("Diario/2026-08-04.md"),
                    at: 0,
                    base: None,
                    exists: true,
                    current: None,
                    text: "I have not saved it yet".into(),
                },
            ]))),
            _ => Ok(IndexResult::Documents(Paged::all(Vec::new()))),
        }
    }
}

/// **La leva che questa decisione esiste per dare, primo verso**: il vault
/// concesso, le bozze no.
///
/// Prima della 0096 questo caso non era esprimibile — `IndexQuery::Drafts`
/// passava da `Capability::Query`, cioè dallo stesso `fub:read-vault` che
/// governa i documenti salvati — e la frase *«puoi cercare nelle mie note,
/// non puoi leggere ciò che sto scrivendo adesso»* non aveva una spunta con
/// cui dirsi.
#[test]
fn denying_drafts_leaves_the_rest_of_the_index_readable() {
    let guard = Guard::new(IndexHost, Negate(Capability::Drafts));
    guard
        .query_index(IndexQuery::Documents {
            matching: Default::default(),
            sort: None,
            select: Default::default(),
            excerpts: Default::default(),
            page: None,
        })
        .expect("the rest of the index stays readable: it is the other permission");
    let err = guard
        .query_index(IndexQuery::Drafts { page: None })
        .expect_err("drafts are denied");
    assert!(
        matches!(err, PluginError::PermissionDenied(_)),
        "and the refusal must say so instead of returning an empty list: {err}"
    );
    assert!(
        err.message().to_string().contains("drafts"),
        "the refusal names what was being done: {err}"
    );
}

/// **Secondo verso, ed è quello che la forma cumulativa avrebbe reso
/// impossibile**: le bozze concesse, il vault no.
///
/// È il pannello di recupero dopo un crash — l'unico cliente che questa
/// domanda abbia mai avuto — e chiede una cosa sola: ritrovare ciò che si
/// stava scrivendo. Farlo dipendere da `read-vault` gli avrebbe fatto
/// chiedere l'intero vault per leggere il testo che l'utente non gli ha
/// consegnato, che è il modo in cui i permessi smettono di significare
/// qualcosa.
#[test]
fn granting_drafts_alone_does_not_open_the_index() {
    let guard = Guard::new(IndexHost, Negate(Capability::Query));
    match guard.query_index(IndexQuery::Drafts { page: None }) {
        Ok(IndexResult::Drafts(page)) => {
            assert_eq!(page.items.len(), 1, "drafts pass through");
        }
        other => panic!("drafts must pass with their own permission: {other:?}"),
    }
    assert!(
        guard
            .query_index(IndexQuery::Documents {
                matching: Default::default(),
                sort: None,
                select: Default::default(),
                excerpts: Default::default(),
                page: None,
            })
            .is_err(),
        "and they must not open the rest of the index"
    );
}

fn with_paths(key: &str, paths: &[&str]) -> Granted {
    let mut permissions = PluginPermissions::of(&[]);
    permissions.granted.set(
        key,
        serde_json::Value::Array(
            paths
                .iter()
                .map(|path| serde_json::Value::String((*path).into()))
                .collect(),
        ),
    );
    Granted::new("p", &permissions, Trust::Community)
}

#[test]
fn permission_prefixes_are_folder_scoped_on_every_document_port() {
    let granted = with_paths(permission::READ_VAULT, &["Progetti/"]);
    assert!(granted
        .denies_path(Capability::VaultRead, "Progetti/Alpha.md")
        .is_none());
    assert!(granted
        .denies_path(Capability::VaultRead, "Altro/Alpha.md")
        .is_some());
    assert!(granted
        .denies_path(Capability::VaultRead, "Progetti-vecchi/Alpha.md")
        .is_some());
    assert!(
        granted
            .denies_path(Capability::Query, "Altro/Alpha.md")
            .is_none(),
        "Query is aggregate and must not apply vault path prefixes"
    );
}

#[test]
fn a_missing_path_parameter_keeps_the_vault_unrestricted() {
    let granted = Granted::new(
        "p",
        &PluginPermissions::of(&[permission::READ_VAULT]),
        Trust::Community,
    );
    assert!(granted
        .denies_path(Capability::VaultRead, "Altro/Alpha.md")
        .is_none());
}

#[test]
fn session_and_selection_paths_are_independent() {
    let session = with_paths(permission::READ_SESSION, &["Progetti"]);
    assert!(session
        .denies_path(Capability::Session, "Progetti/Alpha.md")
        .is_none());
    assert!(session
        .denies_path(Capability::Session, "Altro/Alpha.md")
        .is_some());
    let selection = with_paths(permission::READ_SELECTION, &["Progetti"]);
    assert!(selection
        .denies_path(Capability::SessionSelection, "Altro/Alpha.md")
        .is_some());
}

/// Un host che risponde `200` a chiunque: ciò che si prova qui è il
/// cancello, non cosa c'è dall'altra parte del filo.
struct WithNetwork;

impl HostNetwork for WithNetwork {
    fn fetch(&self, _request: HttpRequest) -> Result<HttpResponse, PluginError> {
        Ok(HttpResponse {
            status: 200,
            headers: Vec::new(),
            body: b"hello".to_vec(),
        })
    }
}

fn with_network(hosts: &[&str]) -> Granted {
    let mut permissions = PluginPermissions::of(&[]);
    permissions.granted.set(
        permission::NETWORK,
        serde_json::Value::Array(
            hosts
                .iter()
                .map(|h| serde_json::Value::String((*h).into()))
                .collect(),
        ),
    );
    Granted::new("p", &permissions, Trust::Community)
}

/// **L'allowlist è vera**, ed è tutta la voce: un manifest che dichiara un
/// host e ne raggiunge un altro è una frase falsa scritta dall'app, non un
/// recinto che perde.
///
/// Prima della 0097 il parametro di un permesso non lo leggeva nessuno:
/// `fub:network` con un elenco dentro concedeva esattamente quanto
/// `fub:network` nudo.
/// Una rete che registra il tetto di byte ricevuto e non scarica niente:
/// se il cancello non inoltrasse `fetch_limited`, il default chiamerebbe
/// `fetch_cancelled` e qui non arriverebbe nessun tetto.
#[derive(Default)]
struct RecordsCap(std::sync::Mutex<Option<u64>>);

impl HostNetwork for RecordsCap {
    fn fetch(&self, _request: HttpRequest) -> Result<HttpResponse, PluginError> {
        panic!("a capped request must reach the wire with its cap")
    }

    fn fetch_limited(
        &self,
        _request: HttpRequest,
        _cancelled: &std::sync::atomic::AtomicBool,
        max_bytes: u64,
    ) -> Result<HttpResponse, LimitedFetchError> {
        *self.0.lock().unwrap() = Some(max_bytes);
        Err(LimitedFetchError::TooLarge {
            limit: max_bytes,
            status: 200,
            headers: Vec::new(),
        })
    }
}

/// Il tetto di byte attraversa il cancello, e il cancello resta un
/// cancello: un host fuori dall'allowlist non arriva al filo.
#[test]
fn the_byte_cap_crosses_the_gate() {
    let guard = Guard::new(RecordsCap::default(), with_network(&["api.acme.com"]));
    let flag = std::sync::atomic::AtomicBool::new(false);
    let err = guard
        .fetch_limited(HttpRequest::get("https://api.acme.com/x"), &flag, 1024)
        .expect_err("the wire refuses");
    assert_eq!(
        err,
        LimitedFetchError::TooLarge {
            limit: 1024,
            status: 200,
            headers: Vec::new(),
        }
    );
    assert_eq!(*guard.inner.0.lock().unwrap(), Some(1024));

    let guard = Guard::new(RecordsCap::default(), with_network(&["api.acme.com"]));
    let err = guard
        .fetch_limited(HttpRequest::get("https://altrove.example/x"), &flag, 1024)
        .expect_err("undeclared host");
    assert!(
        matches!(
            err,
            LimitedFetchError::Failed(PluginError::PermissionDenied(_))
        ),
        "{err:?}"
    );
    assert_eq!(*guard.inner.0.lock().unwrap(), None);
}

#[test]
fn the_manifest_says_where_and_it_is_true() {
    let guard = Guard::new(WithNetwork, with_network(&["api.acme.com"]));
    guard
        .fetch(HttpRequest::get("https://api.acme.com/v1/note"))
        .expect("the declared host passes");
    let err = guard
        .fetch(HttpRequest::get("https://altrove.example/raccogli"))
        .expect_err("the undeclared one does not");
    assert!(
        matches!(err, PluginError::PermissionDenied(_)),
        "and the refusal names the permission: {err}"
    );
    assert!(
        err.message().to_string().contains("api.acme.com"),
        "saying what was declared: {err}"
    );
}

/// **Il modo in cui un'allowlist si scavalca**, e la riga che lo impedisce.
///
/// Un host dichiarato che risponde `302` verso uno che non lo è porterebbe
/// fuori dal recinto senza che nessuno l'abbia deciso — e un client che
/// segue i redirect lo farebbe **in silenzio**, perché l'allowlist non ce
/// l'ha e non deve averla. Qui il salto è una **seconda chiamata**, quindi
/// ripassa dal cancello e il cancello lo ferma.
#[test]
fn a_redirect_out_of_the_fence_is_a_second_call_and_is_stopped() {
    let guard = Guard::new(WithNetwork, with_network(&["api.acme.com"]));
    let answer = HttpResponse {
        status: 302,
        headers: vec![fub_abi::net::HttpHeader::new(
            "Location",
            "https://altrove.example/raccogli",
        )],
        body: Vec::new(),
    };
    let salto = answer.redirect_to().expect("it is a redirect");
    assert!(
        guard.fetch(HttpRequest::get(salto)).is_err(),
        "following the jump is asking again, and the second question is \
             the one the fence stops"
    );
}

/// Le credenziali in un URL sono il modo più vecchio di far leggere a un
/// umano un indirizzo e a una macchina un altro.
#[test]
fn credentials_do_not_borrow_an_allowed_name() {
    let guard = Guard::new(WithNetwork, with_network(&["api.acme.com"]));
    assert!(
        guard
            .fetch(HttpRequest::get("https://api.acme.com@evil.example/x"))
            .is_err(),
        "the host is what is after the last `@`, not what is read before it"
    );
}

/// Il carattere `*` è obbligatorio proprio perché *«voglio anche i
/// sottodomini»* sia una cosa che si dice invece di una che succede — e
/// perché una `ends_with` nuda regalerebbe a chi dichiara `acme.com` il
/// dominio di qualcun altro.
#[test]
fn a_wildcard_does_not_hand_over_someone_elses_domain() {
    let guard = Guard::new(WithNetwork, with_network(&["*.acme.com"]));
    guard
        .fetch(HttpRequest::get("https://api.acme.com/x"))
        .expect("a proper subdomain passes");
    assert!(
        guard.fetch(HttpRequest::get("https://acme.com/x")).is_err(),
        "the bare domain does not: `*.` demands one level more"
    );
    assert!(
        guard
            .fetch(HttpRequest::get("https://evil-acme.com/x"))
            .is_err(),
        "and a name that ends up there by chance even less so"
    );
}

/// `fub:network` senza parametro è *qualunque host*, per la regola uniforme
/// di `OptionMap`. Ciò che cambia non è il cancello: è la frase che
/// l'utente legge quando gli si chiede di accettare.
#[test]
fn no_allowlist_means_anywhere_and_that_is_the_uniform_rule() {
    let mut permissions = PluginPermissions::of(&[]);
    permissions.granted.set(permission::NETWORK, true);
    let guard = Guard::new(
        WithNetwork,
        Granted::new("p", &permissions, Trust::Community),
    );
    guard
        .fetch(HttpRequest::get("https://ovunque.example/x"))
        .expect("no list means no fence: present = on");
}

/// Senza il permesso non si esce, e il rifiuto parla del **permesso** e non
/// di un elenco di host che non lo riguarda.
#[test]
fn without_the_permission_the_refusal_names_the_permission() {
    let guard = Guard::new(
        WithNetwork,
        Granted::new("p", &PluginPermissions::of(&[]), Trust::Community),
    );
    let err = guard
        .fetch(HttpRequest::get("https://api.acme.com/x"))
        .expect_err("no permission, no network");
    assert!(
        err.message().to_string().contains(permission::NETWORK),
        "whoever lacks the permission must read which one they are missing: {err}"
    );
}

/// In chiaro l'allowlist promette un host e la rete ne consegna un altro —
/// tranne verso sé stessi, dove non c'è rete da attraversare e dove vive un
/// modello che gira sulla macchina di chi usa l'app.
#[test]
fn plaintext_is_refused_except_towards_this_machine() {
    let guard = Guard::new(WithNetwork, with_network(&["api.acme.com", "localhost"]));
    let err = guard
        .fetch(HttpRequest::get("http://api.acme.com/x"))
        .expect_err("`http` outward is refused");
    assert!(matches!(err, PluginError::BadArgs(_)), "{err}");
    guard
        .fetch(HttpRequest::get("http://localhost:11434/api/generate"))
        .expect("toward this machine yes: that is where a local model runs");
}

/// **Il prefisso `127.` è una famiglia di nomi, non di indirizzi.**
///
/// `127.0.0.1.evil.example` è registrabile — la prima etichetta di un
/// dominio può cominciare con una cifra — e con un confronto per testo si
/// prendeva l'esenzione del loopback: `http` in chiaro verso la macchina di
/// qualcun altro, cioè l'unica cosa che la regola esiste per impedire.
#[test]
fn a_name_that_starts_like_a_loopback_address_is_not_this_machine() {
    let guard = Guard::new(
        WithNetwork,
        with_network(&["*.evil.example", "127.0.0.1", "::1"]),
    );
    let err = guard
        .fetch(HttpRequest::get("http://127.0.0.1.evil.example/x"))
        .expect_err("it is someone else's name, and in plaintext you do not go there");
    assert!(matches!(err, PluginError::BadArgs(_)), "{err}");
    guard
        .fetch(HttpRequest::get("http://127.0.0.1:11434/api/generate"))
        .expect("the real address yes");
    guard
        .fetch(HttpRequest::get("http://[::1]:11434/api/generate"))
        .expect("and its IPv6 form too");
}

/// **Un parametro illeggibile non è l'assenza di un parametro.**
///
/// `"fub:network": "api.acme.com"` — la stringa invece dell'elenco — è un
/// manifest scritto male, e prima cadeva sul ramo «nessun elenco», cioè
/// *qualunque host*: un errore di battitura che intende restringere apriva
/// a tutto, senza che niente lo dicesse. Adesso il recinto c'è e non nomina
/// nessuno.
#[test]
fn a_malformed_allowlist_fences_everything_out() {
    for wrong in [
        serde_json::json!("api.acme.com"),
        serde_json::json!(7),
        serde_json::json!([1, 2]),
        serde_json::json!({ "host": "api.acme.com" }),
    ] {
        let mut permissions = PluginPermissions::of(&[]);
        permissions.granted.set(permission::NETWORK, wrong.clone());
        let guard = Guard::new(
            WithNetwork,
            Granted::new("p", &permissions, Trust::Community),
        );
        let err = guard
            .fetch(HttpRequest::get("https://api.acme.com/x"))
            .expect_err("a malformed parameter grants nothing");
        assert!(
            matches!(err, PluginError::PermissionDenied(_)),
            "and it says so as a denied permission ({wrong}): {err}"
        );
        assert!(
            err.message().to_string().contains("is not a list of hosts"),
            "sending you to look for the flaw in the manifest and not in \
                 the URL ({wrong}): {err}"
        );
    }
}

/// **Una `DryRun` che scarica non è una simulazione.** L'effetto non è
/// nell'host — un `POST` crea qualcosa dall'altra parte, e perfino un `GET`
/// viene contato e registrato da chi risponde — quindi è la sola specie di
/// effetto che questo processo non può ritirare nemmeno volendo.
#[test]
fn a_simulation_does_not_reach_the_network() {
    let guard = Guard::new(
        WithNetwork,
        ReadOnly {
            why: "a simulation does not write",
        },
    );
    assert!(
        guard
            .fetch(HttpRequest::get("https://api.acme.com/x"))
            .is_err(),
        "simulating a download would be downloading"
    );
}

/// I due permessi sono **due chiavi diverse**, e il presidio è che nessuna
/// apra la porta dell'altra.
///
/// Senza questa riga la coppia avrebbe potuto nascere con `read-drafts`
/// mappato su `fub:read-vault` — cioè con un nome nuovo davanti al cancello
/// vecchio, che è la forma in cui un permesso sembra esserci e non c'è.
#[test]
fn the_two_permissions_are_not_the_same_key() {
    assert_eq!(Capability::Query.permission(), Some(permission::READ_VAULT));
    assert_eq!(
        Capability::Drafts.permission(),
        Some(permission::READ_DRAFTS)
    );
    let only_vault = PluginPermissions::of(&[permission::READ_VAULT]);
    let granted = Granted::new("p", &only_vault, Trust::Community);
    assert!(
        granted.denies(Capability::Query).is_none(),
        "`read-vault` grants the index"
    );
    assert!(
        granted.denies(Capability::Drafts).is_some(),
        "but not drafts: they were the same checkbox in the same manifest"
    );
}

/// Le notifiche si concedono **solo** a chi dichiara `fub:notifications`:
/// il permesso dei componenti di casa non le porta con sé, e un manifest a
/// cui l'utente l'ha tolto (la sottrazione di `restrict`) torna negato.
#[test]
fn notifications_follow_their_own_permission() {
    assert_eq!(
        Capability::Notifications.permission(),
        Some(permission::NOTIFICATIONS)
    );
    let core = Granted::new("fub.tasks", &PluginPermissions::core(), Trust::Core);
    assert!(
        core.denies(Capability::Notifications).is_some(),
        "the core permissions do not include notifications"
    );
    let mut declared = PluginPermissions::core();
    declared.granted.set(permission::NOTIFICATIONS, true);
    let granted = Granted::new("fub.tasks", &declared, Trust::Core);
    assert!(granted.denies(Capability::Notifications).is_none());
    declared.granted.remove(permission::NOTIFICATIONS);
    let revoked = Granted::new("fub.tasks", &declared, Trust::Core);
    let why = revoked
        .denies(Capability::Notifications)
        .expect("taken away, it is denied again");
    assert!(why.contains(permission::NOTIFICATIONS), "{why}");
    assert!(
        Granted::undeclared("fub.tasks")
            .denies(Capability::Notifications)
            .is_some(),
        "a component that is not mounted does not notify"
    );
}

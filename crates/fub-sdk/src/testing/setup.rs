//! Come si prepara un `MemoryHost`: la costruzione, la semina di documenti,
//! modelli, formati e servizi, e ciò che un banco legge dopo.

use super::*;

impl MemoryHost {
    pub fn new() -> Self {
        let host = MemoryHost::default();
        host.now.store(1_700_000_000_000, Ordering::Relaxed);
        host
    }
    /// La prossima domanda di un nome libero la **perde**: qualcun altro prende
    /// quel nome fra la risposta e la scrittura.
    ///
    /// È la finestra che `VaultRead::free_name` dichiara di lasciare aperta, e
    /// che senza questa maniglia non si costruisce se non con dei thread — cioè
    /// con una speranza sulla schedulazione al posto di un fatto.
    pub fn the_next_run_of_the_name_is_loses(&self) -> &Self {
        self.steals_the_name_free.store(true, Ordering::SeqCst);
        self
    }

    /// Il locale che questo doppio serve: chi prova una feature che formatta o
    /// che ordina lo dichiara, invece di scoprire il default.
    pub fn with_locale(self, locale: Locale) -> Self {
        *self.locale.lock().unwrap() = locale;
        self
    }

    /// Un host che non concede entropia: `random_bytes` rifiuta nominando il
    /// permesso, e chi costruisce un'identità deve accorgersene.
    pub fn without_entropy(self) -> Self {
        self.without_entropy.store(true, Ordering::Relaxed);
        self
    }

    /// Registra un importer sul banco, dopo quelli già registrati: come
    /// nell'host vero, [`HostServices::run_import`] sceglie il primo che
    /// riconosce la sorgente.
    pub fn with_import_provider(self, provider: Box<dyn ImportProvider>) -> Self {
        self.imports
            .lock()
            .unwrap()
            .push(Arc::new(Mutex::new(provider)));
        self
    }

    /// Registra un exporter sul banco: [`HostServices::run_export`] sceglie
    /// quello che offre la destinazione chiesta.
    pub fn with_export_provider(self, provider: Box<dyn ExportProvider>) -> Self {
        self.exports.lock().unwrap().push(Arc::from(provider));
        self
    }

    /// Apre una sorgente di import **dietro un handle**, e restituisce la
    /// [`ImportSource`] da dare al provider (decisione 0102).
    ///
    /// Il prologo è quello che leggerebbe il kernel. Serve a provare la strada a
    /// pezzi senza un file: un importer scritto contro `SourceContent::Bytes` e
    /// mai provato contro questa è un importer che si scoprirà sul vault vero di
    /// chi migra, che è il momento peggiore.
    pub fn with_source(
        &self,
        name: impl Into<String>,
        media_type: Option<String>,
        bytes: impl Into<Vec<u8>>,
    ) -> fub_abi::transfer::ImportSource {
        use fub_abi::transfer::{ImportSource, SourceContent, SourceHandle, StreamedSource};
        let bytes = bytes.into();
        let handle = self
            .next_source
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            + 1;
        let len = bytes.len() as u64;
        let prologue = bytes[..bytes.len().min(8 * 1024)].to_vec();
        self.sources.lock().unwrap().insert(handle, bytes);
        ImportSource {
            name: name.into(),
            media_type,
            content: SourceContent::Streamed(StreamedSource {
                handle: SourceHandle(handle),
                len,
                prologue,
            }),
        }
    }

    /// Prepara la prossima risposta di rete. Si può chiamare più volte: le
    /// risposte escono nell'ordine in cui sono entrate.
    pub fn with_response(self, answer: HttpResponse) -> Self {
        self.answers.lock().unwrap().push_back(Ok(answer));
        self
    }

    /// Prepara un **guasto** del trasporto: è l'altra metà, e serve tanto
    /// quanto la prima — chi scarica deve saper dire cosa fa quando la rete non
    /// c'è, e un banco che sa solo riuscire non glielo chiede mai.
    pub fn with_network_fault(self, why: &str) -> Self {
        self.answers
            .lock()
            .unwrap()
            .push_back(Err(PluginError::Io(why.to_string().into())));
        self
    }

    /// Prepara un **annullamento**: il job è stato fermato con la richiesta in
    /// volo, e il trasporto risponde `Cancelled` come quello dell'host vero.
    /// Chi scarica deve smettere, non trasformarlo in un guasto da riferire.
    pub fn with_network_cancelled(self) -> Self {
        self.answers
            .lock()
            .unwrap()
            .push_back(Err(PluginError::Cancelled("job annullato".into())));
        self
    }

    /// D'ora in poi `data_write` su questo path **fallisce**.
    ///
    /// Non è una crudeltà del doppio: è il disco pieno, la quota finita, il
    /// permesso tolto sotto i piedi mentre l'app è aperta. Serve perché la
    /// forma «muta lo stato, poi persisti» si giudica soltanto sul ramo in cui
    /// la persistenza non riesce, e un banco che sa solo riuscire non lo
    /// esercita mai. Si accende a metà partita di proposito — la storia si
    /// costruisce con le scritture buone, e poi cede quella che interessa.
    pub fn denies_write(&self, path: &str) {
        self.writes_negate.lock().unwrap().insert(path.to_string());
    }

    /// Quante volte quel path è stato scritto, e quanti byte in tutto.
    ///
    /// `(0, 0)` per un path mai scritto: non essere mai passati di lì è un
    /// conto, non un'assenza di risposta.
    pub fn writes_on(&self, path: &str) -> (usize, usize) {
        self.writes
            .lock()
            .unwrap()
            .get(path)
            .copied()
            .unwrap_or((0, 0))
    }

    /// Quante volte quel path (o quel `DocId`) è stato **letto**, e quanti byte
    /// in tutto. `(0, 0)` per ciò che nessuno ha mai aperto.
    pub fn reads_on(&self, path: &str) -> (usize, usize) {
        self.reads
            .lock()
            .unwrap()
            .get(path)
            .copied()
            .unwrap_or((0, 0))
    }

    /// Il totale delle letture: quante e quanti byte, su tutto.
    ///
    /// È la forma che serve quando la domanda non è *quel* documento ma
    /// **quanti**: «questo comando ha aperto il vault intero?» non si risponde
    /// path per path.
    pub fn read_totals(&self) -> (usize, usize) {
        self.reads
            .lock()
            .unwrap()
            .values()
            .fold((0, 0), |(n, b), (dn, db)| (n + dn, b + db))
    }

    /// Quante volte qualcuno ha chiesto il contesto attivo.
    ///
    /// La forma con cui si prova che un render è una **fotografia**: una sola
    /// lettura, e ciò che ne esce viene da quell'unica.
    pub fn reads_from_context(&self) -> u64 {
        self.reads_from_context.load(Ordering::Relaxed)
    }

    /// Segna una lettura riuscita. Privato: il conto si legge, non si scrive.
    pub(super) fn record_read(&self, key: &str, byte: usize) {
        let mut reads = self.reads.lock().unwrap();
        let count = reads.entry(key.to_string()).or_insert((0, 0));
        count.0 += 1;
        count.1 += byte;
    }

    /// Le richieste di rete che questo doppio ha visto, in ordine.
    pub fn network_requests(&self) -> Vec<HttpRequest> {
        self.requests.lock().unwrap().clone()
    }

    /// Sposta l'orologio in avanti di `ms`.
    pub fn advance(&self, ms: u64) {
        self.now.fetch_add(ms, Ordering::Relaxed);
    }

    /// Sposta l'orologio **indietro** di `ms`: è ciò che fa NTP, un cambio di
    /// fuso o una VM ripresa — e ciò contro cui il versioning deve difendersi.
    pub fn backtrack(&self, ms: u64) {
        self.now.fetch_sub(ms, Ordering::Relaxed);
    }

    /// Aggiunge un documento al vault finto (stile builder).
    pub fn with_document(self, id: &str, source: &str) -> Self {
        self.docs
            .lock()
            .unwrap()
            .insert(id.to_string(), source.as_bytes().to_vec());
        self
    }

    /// Aggiunge un documento che **non è testo**: un PDF, un `.canvas`, un file
    /// con un encoding suo.
    ///
    /// Chi lo legge con `read_document` riceve lo stesso errore che riceverebbe
    /// dal vault vero; chi lo legge con `read_document_bytes` riceve i byte.
    pub fn with_binary_document(self, id: &str, bytes: &[u8]) -> Self {
        self.docs
            .lock()
            .unwrap()
            .insert(id.to_string(), bytes.to_vec());
        self
    }

    /// Fa sparire un documento **senza emettere eventi**: è ciò che accade
    /// quando un `DocumentRemoved` va perso in un troncamento della coda.
    pub fn forgets_document(&self, id: &str) {
        self.docs.lock().unwrap().remove(id);
    }

    /// Sposta un documento **senza emettere eventi**: il rename perso.
    pub fn rename_of_hidden(&self, from: &str, to: &str) {
        let mut docs = self.docs.lock().unwrap();
        if let Some(source) = docs.remove(from) {
            docs.insert(to.to_string(), source);
        }
    }

    /// Imposta il documento attivo, come farebbe la shell su una navigazione:
    /// pannello principale, nessuna selezione, modalità normale.
    pub fn set_active(&self, id: Option<&str>) {
        *self.context.lock().unwrap() =
            id.map(|id| ViewContext::new("main").with_doc(Some(DocId::new(id))));
    }

    /// Pubblica un contesto intero: è la forma con cui si provano le view che
    /// seguono la selezione o la modalità.
    pub fn set_context(&self, context: Option<ViewContext>) {
        *self.context.lock().unwrap() = context;
    }

    /// Sposta il cursore (senza testo selezionato) nel documento attivo.
    /// `None` = il buffer è sporco, quindi nessuna coordinata sarebbe vera.
    pub fn set_caret(&self, byte: Option<usize>) {
        self.map_context(|c| {
            c.selections = Some(match byte {
                Some(b) => SelectionSet::caret(b),
                None => SelectionSet::floating(""),
            });
        });
    }

    /// Seleziona `text` a partire da `start` byte nel documento attivo.
    pub fn set_selection(&self, start: usize, text: &str) {
        self.map_context(|c| {
            c.selections = Some(SelectionSet::anchored(
                Span::new(start, start + text.len()),
                text,
            ));
        });
    }

    /// Più selezioni insieme, come le pubblica un pannello con più cursori: la
    /// **prima** coppia è la primaria, le altre le secondarie (decisione 0093).
    ///
    /// Che la primaria sia la prima *di questo elenco* è una comodità di questo
    /// aiuto, non una regola del contratto: là è un campo, e proprio perché è un
    /// campo un aiuto può sceglierla come gli torna.
    pub fn set_selections(&self, selections: &[(usize, &str)]) {
        let mut anchored = selections
            .iter()
            .map(|(start, text)| {
                AnchoredSelection::new(Span::new(*start, start + text.len()), *text)
            })
            .collect::<Vec<_>>();
        let primary = anchored.remove(0);
        self.map_context(|c| {
            c.selections = Some(SelectionSet::Anchored(AnchoredSelections {
                primary,
                secondary: anchored,
            }));
        });
    }

    /// Le stesse, a buffer sporco: il testo è vero, le coordinate no — per
    /// tutte.
    pub fn set_floating_selections(&self, texts: &[&str]) {
        use fub_abi::session::{FloatingSelection, FloatingSelections};
        let mut fluttuanti = texts
            .iter()
            .map(|t| FloatingSelection::new(*t))
            .collect::<Vec<_>>();
        let primary = fluttuanti.remove(0);
        self.map_context(|c| {
            c.selections = Some(SelectionSet::Floating(FloatingSelections {
                primary,
                secondary: fluttuanti,
            }));
        });
    }

    /// Cambia la modalità del pannello attivo.
    pub fn set_mode(&self, mode: PaneMode) {
        self.map_context(|c| c.mode = mode);
    }

    fn map_context(&self, f: impl FnOnce(&mut ViewContext)) {
        let mut ctx = self.context.lock().unwrap();
        let mut context = ctx.take().unwrap_or_else(|| ViewContext::new("main"));
        f(&mut context);
        *ctx = Some(context);
    }

    /// Semina un arco del grafo dei link: `from` nomina `to` (stile builder).
    ///
    /// Non deriva dai documenti seminati, e non è una pigrizia del doppio: per
    /// derivarlo bisognerebbe parsare, e questo host non parsa — è la stessa
    /// regola dell'outline e dei modelli.
    pub fn with_edge(self, from: &str, to: &str) -> Self {
        self.edges
            .lock()
            .unwrap()
            .push((from.to_string(), to.to_string()));
        self
    }

    /// Semina i backlink che [`HostQuery::query_index`] restituirà per `target`
    /// (stile builder).
    pub fn with_backlink(self, target: &str, sources: &[&str]) -> Self {
        let refs = sources
            .iter()
            .map(|s| BacklinkRef {
                source: DocId::new(*s),
                context: None,
            })
            .collect();
        self.backlinks
            .lock()
            .unwrap()
            .insert(target.to_string(), refs);
        self
    }

    /// Semina l'outline che [`HostQuery::query_index`] restituirà per `doc`
    /// (stile builder).
    pub fn with_outline(self, doc: &str, headings: &[Heading]) -> Self {
        self.outlines
            .lock()
            .unwrap()
            .insert(doc.to_string(), headings.to_vec());
        self
    }

    /// Semina l'aggregazione dei tag che [`IndexQuery::Tags`] restituirà
    /// (stile builder): coppie nome→conteggio.
    pub fn with_tags(self, tags: &[(&str, u32)]) -> Self {
        *self.tags.lock().unwrap() = tags
            .iter()
            .map(|(name, count)| TagCount {
                name: name.to_string(),
                count: *count,
            })
            .collect();
        self
    }

    /// Semina il modello che [`VaultRead::read_model`] restituirà per `doc`
    /// (stile builder).
    pub fn with_model(self, doc: &str, model: DocumentModel) -> Self {
        self.models.lock().unwrap().insert(doc.to_string(), model);
        self
    }

    /// Semina il formato che [`VaultRead::format_of`] restituirà per i documenti
    /// con questa estensione (stile builder).
    pub fn with_format(self, ext: &str, format: DocumentFormat) -> Self {
        self.formats.lock().unwrap().insert(ext.to_string(), format);
        self
    }

    /// **Dichiara** un'impostazione, come farebbe il manifest di chi la offre
    /// (stile builder). Senza dichiarazione una chiave non esiste: è la stessa
    /// regola del kernel, e il doppio la ripete perché è quella che una feature
    /// incontra.
    pub fn with_setting(self, spec: SettingSpec) -> Self {
        self.settings
            .lock()
            .unwrap()
            .insert(spec.key.clone(), (spec, None));
        self
    }

    /// Dichiara un'impostazione **e le dà un valore**, come se l'utente
    /// l'avesse scritta.
    pub fn with_value(self, spec: SettingSpec, value: SettingValue) -> Self {
        self.settings
            .lock()
            .unwrap()
            .insert(spec.key.clone(), (spec, Some(value)));
        self
    }

    /// Dice per conto di **quale esemplare di view** questo doppio sta agendo
    /// (stile builder), che è ciò che dà uno stato di vista a chi lo usa.
    ///
    /// Nell'app l'esemplare lo timbra l'host e nessuno lo nomina; qui lo nomina
    /// il test, perché il test è il chiamante — è la stessa asimmetria per cui
    /// `Workspace::view_state` prende il proprietario e la capacità no.
    pub fn with_instance(self, instance: &str) -> Self {
        *self.view_instance.lock().unwrap() = Some(instance.to_string());
        self
    }

    /// Cambia esemplare **tenendo ciò che è stato salvato**: è come riaprire lo
    /// stesso pannello in un'altra istanza, ed è il modo di provare che due
    /// esemplari non si mescolano senza costruire due host.
    pub fn switch_to_instance(&self, instance: &str) {
        *self.view_instance.lock().unwrap() = Some(instance.to_string());
    }
}

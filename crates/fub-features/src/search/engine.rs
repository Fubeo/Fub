//! Il motore: indicizzare, riconciliare e interrogare (`impl SearchIndex`),
//! con gli aiuti per costruire le query tantivy.

use super::*;

impl SearchIndex {
    pub(super) fn term_for(&self, id: &DocId) -> Term {
        Term::from_field_text(self.fields.doc_id, id.as_str())
    }

    /// Il documento come lo vuole tantivy.
    ///
    /// Sta fuori da `on_documents_indexed` per una ragione sola: comporlo non ha
    /// niente a che vedere col writer, e non deve tenerne il lock. Chi scrive lo
    /// prende per due chiamate, non per la costruzione di un record.
    pub(super) fn tantivy_doc(&self, doc: &DocumentModel) -> TantivyDocument {
        let f = self.fields;
        let mut td = TantivyDocument::new();
        td.add_text(f.doc_id, doc.id.as_str());
        td.add_text(f.page_name, doc.id.page_name());
        // Gli alias del frontmatter stanno nello stesso campo del nome, con lo
        // stesso tokenizer `default`: `nameQuery` trova per alias senza un
        // campo nuovo e senza bump di schema (la forma indicizzata non cambia,
        // cambia solo il contenuto). L'impronta li copre (vedi `fingerprint`),
        // così un alias aggiunto reindicizza la nota.
        for alias in doc.frontmatter.aliases() {
            td.add_text(f.page_name, &alias);
        }
        td.add_text(f.body, &doc.text);
        // Un valore per heading e non una stringa unita: due titoli attaccati
        // formerebbero una frase che nessuno ha scritto, e una ricerca per
        // frase la troverebbe.
        for heading in &doc.outline {
            td.add_text(f.headings, &heading.text);
        }
        td.add_text(f.layout, scope::layout(doc));
        // Un valore per tag (non una stringa unita): col tokenizer raw ogni
        // valore È un termine, e il termine è la forma canonica — la stessa
        // chiave con cui il kernel aggrega e il pannello interroga.
        for tag in tag_names(doc) {
            let canonical = canonical_tag(&tag);
            // Ogni antenato è un termine a sé: `#progetto/casa` si lascia
            // trovare da `progetto` con `descendants`, senza che nessuno debba
            // valutare un prefisso documento per documento.
            for ancestor in fub_abi::query::tag_ancestors(&canonical) {
                td.add_text(f.tag_paths, &ancestor);
            }
            td.add_text(f.tags, &canonical);
        }
        // Una cartella per ogni antenata: cercare in `Progetti` prende anche
        // `Progetti/sub`, e la radice (`""`) è su tutti.
        for folder in fub_abi::query::folders_of(&doc.id) {
            td.add_text(f.folder, folder);
        }
        td.add_text(f.folder_exact, fub_abi::query::folder_of(&doc.id));
        let tasks = task_states(doc);
        if tasks.open {
            td.add_text(f.task_state, "open");
        }
        if tasks.done {
            td.add_text(f.task_state, "done");
        }
        for due in &tasks.due {
            td.add_text(f.task_due, due);
        }
        td
    }

    /// Committa se ci sono scritture in sospeso, e riallinea il reader.
    ///
    /// Prende `&self` perché il commit può essere deciso anche da una `query`
    /// (chi interroga vede le proprie scritture), ed è **l'unico punto in cui
    /// una query tocca un lock esclusivo**. Quando non c'è niente in sospeso —
    /// cioè sempre, tranne subito dopo una scrittura — questa funzione è la
    /// lettura di un atomico e nient'altro.
    ///
    /// Qui c'era scritto «l'unico punto in cui una query tocca un lock», senza
    /// *esclusivo*, e la frase era **falsa**: [`FieldWeights`] sta dietro un
    /// `RwLock` e `text_query` ne prende la `read()` a ogni ricerca di testo.
    /// La differenza è tutta la §8.4 — una `read()` condivisa non mette nessuno
    /// in fila, un `Mutex` sì — e una parola mancante la cancellava. L'ha
    /// trovata il banco del §17.1
    /// ([decisione 0113](../../../docs/decisions/0196-test-e-artefatti-generati.md)),
    /// che è quello che il commento accanto ai pesi chiedeva quando diceva «*il
    /// banco della seduta è lì per smentirmi se sbaglio*».
    ///
    /// Il doppio controllo di `dirty` non è prudenza: due query concorrenti
    /// possono trovarlo alzato insieme, e la seconda non deve committare a
    /// vuoto. Non è nemmeno un residuo: è ciò che la
    /// [decisione 0026](../../../docs/decisions/0182-provider-e-porte-generiche.md) ha
    /// **installato** quando ha tolto il `Mutex<Inner>` che metteva in fila le
    /// ricerche — 43 op/s prima, 320 dopo a otto thread — e leggerlo come un
    /// lock che ferma i lettori per la durata del commit è leggere al contrario
    /// la riparazione che quei numeri hanno pagato. Le due `Ordering` non
    /// decorative sono queste: chi spegne `dirty`
    /// lo fa in `Release` **dopo** il `reload`, chi lo legge spento lo fa in
    /// `Acquire` **prima** di chiedere un `searcher` — cioè chi vede «pulito»
    /// vede anche l'indice ricaricato che ha reso vera quella parola.
    ///
    /// Non tocca il manifest: qui non c'è un host, e una query non ne ha uno. Il
    /// manifest lo riscrive [`SearchIndex::persist`], e finché non lo fa quello
    /// su disco risulta di un'altra epoca — cioè inaffidabile, che è il verso
    /// giusto in cui sbagliare.
    pub(super) fn commit(&self) -> Result<(), PluginError> {
        if !self.dirty.load(Ordering::Acquire) {
            return Ok(());
        }
        let mut guard = self.writer.lock().expect("mutex");
        if !self.dirty.load(Ordering::Acquire) {
            return Ok(());
        }
        // Chiuso: non c'è più niente da committare, e ciò che era in sospeso lo
        // ha già committato `close`. Dirlo come errore sarebbe dire che
        // qualcosa è andato storto, e non è andato storto niente.
        let Some(writer) = guard.as_mut() else {
            return Ok(());
        };
        let opstamp = writer
            .commit()
            .map_err(|and| PluginError::Internal(reason(INDEX_COMMIT, and)))?;
        self.reader
            .reload()
            .map_err(|and| PluginError::Internal(reason(INDEX_RELOAD, and)))?;
        self.opstamp.store(opstamp, Ordering::Relaxed);
        self.dirty.store(false, Ordering::Release);
        Ok(())
    }

    /// Legge le impronte dal manifest, ma solo se parla della stessa epoca
    /// dell'indice (vedi [`Manifest`]). Nel dubbio: nessuna impronta, cioè
    /// tutto verrà reindicizzato.
    pub(super) fn load_manifest(&mut self, host: &dyn HostApi) -> Result<(), PluginError> {
        // Un errore di lettura dello storage lo si segnala (l'indice
        // reindicizzerà tutto); un manifest assente, illeggibile o di
        // un'altra epoca è invece il caso normale, e non è un errore.
        let Some(raw) = host.data_read(MANIFEST)? else {
            return Ok(());
        };
        let Ok(manifest) = serde_json::from_slice::<Manifest>(&raw) else {
            return Ok(());
        };
        if manifest.schema_version != SCHEMA_VERSION
            || manifest.opstamp != self.opstamp.load(Ordering::Relaxed)
        {
            return Ok(());
        }
        self.fingerprints = manifest
            .docs
            .into_iter()
            .map(|(id, h)| (DocId::new(id), h))
            .collect();
        // Solo le revisioni di ciò che risulta indicizzato: una revisione senza
        // il documento a cui appartiene non è un'informazione parziale, è una
        // risposta sbagliata a `up_to_date` che aspetta di essere data.
        self.sources = manifest
            .sources
            .into_iter()
            .map(|(id, r)| (DocId::new(id), Revision::new(r)))
            .filter(|(id, _)| self.fingerprints.contains_key(id))
            .collect();
        self.manifest_at = Some(manifest.opstamp);
        Ok(())
    }

    /// Prende nota di **che revisione** è il documento appena indicizzato,
    /// consumando ciò che la domanda del kernel aveva dichiarato.
    ///
    /// Nessuna dichiarazione = si dimentica quella di prima. È la sola scelta
    /// che non mente: tenerla vorrebbe dire attribuire al testo di adesso la
    /// revisione del testo di allora, e alla riapertura saltare un documento
    /// modificato.
    pub(super) fn notes_source(&mut self, id: &DocId) {
        match self.announced.lock().expect("mutex").remove(id) {
            Some(revision) => self.sources.insert(id.clone(), revision),
            None => self.sources.remove(id),
        };
    }

    /// Dimentica tutto di un documento: l'impronta del modello, quella del
    /// sorgente e la dichiarazione che era in volo. Le tre insieme, perché una
    /// sola che sopravvivesse alle altre sarebbe una promessa senza il
    /// documento dietro.
    pub(super) fn forget(&mut self, id: &DocId) {
        self.fingerprints.remove(id);
        self.sources.remove(id);
        self.announced.lock().expect("mutex").remove(id);
    }

    /// Rende durevoli le impronte, se quelle su disco non sono già le nostre.
    ///
    /// Il manifest si scrive DOPO il commit e cita il suo opstamp: se qualcosa
    /// va storto qui, alla riapertura le impronte risulteranno di un'altra
    /// epoca e si reindicizzerà — mai il contrario. E se non c'è niente di
    /// nuovo non si scrive: è ciò che rende osservabile «riaprire un vault
    /// immutato non produce scritture».
    pub(super) fn persist(&mut self, host: &mut dyn HostApi) -> Result<(), PluginError> {
        let opstamp = self.opstamp.load(Ordering::Relaxed);
        if self.manifest_at == Some(opstamp) {
            return Ok(());
        }
        let manifest = Manifest {
            schema_version: SCHEMA_VERSION,
            opstamp,
            docs: self
                .fingerprints
                .iter()
                .map(|(id, h)| (id.as_str().to_string(), *h))
                .collect(),
            sources: self
                .sources
                .iter()
                .map(|(id, r)| (id.as_str().to_string(), r.0.clone()))
                .collect(),
        };
        let raw = serde_json::to_vec(&manifest)
            .map_err(|and| PluginError::Internal(reason(MANIFEST_WRITE, and)))?;
        host.data_write(MANIFEST, &raw)?;
        self.manifest_at = Some(opstamp);
        Ok(())
    }

    /// La ricerca vera: l'albero della query, tradotto, e la finestra.
    ///
    /// La finestra si applica **alla sorgente** — `offset`/`limit` vanno al
    /// collector di tantivy, non a un `Vec` già costruito — ed è la ragione per
    /// cui un indice pagina meglio di chi lo interroga: la pagina 40 non costa
    /// come le prime 40 messe insieme. `total` arriva dal collector `Count`
    /// sulla stessa query, così chi disegna può scrivere "1-20 di 4321".
    ///
    /// Prima qui arrivava una **stringa**, e finiva dritta nel `QueryParser` di
    /// tantivy: la sintassi di ricerca che l'utente digitava era quella di una
    /// dipendenza, e un errore di parsing di tantivy diventava «Query
    /// incompleta» nella shell. Adesso arriva un albero, e questo modulo lo
    /// **traduce**: la stringa libera sopravvive solo dentro la foglia di testo,
    /// dove è quello che è — dei termini da cercare.
    pub(super) fn search(
        &self,
        matching: &QueryExpr,
        page: Option<Page>,
        excerpts: Excerpts,
    ) -> Result<Paged<DocumentMatch>, PluginError> {
        // Chi interroga vede le proprie scritture, anche senza flush. È la sola
        // riga di questa funzione che possa fermarsi ad aspettare qualcuno, e
        // solo se c'è davvero una scrittura in sospeso (vedi `commit`).
        self.commit()?;
        let f = self.fields;
        let mut text_parts: Vec<Box<dyn Query>> = Vec::new();
        let query = self.translate(matching, &mut text_parts)?;
        // Una ricerca senza termini non è "tutto il vault" solo perché la
        // stringa è vuota: se l'albero non seleziona niente, non seleziona
        // niente — ed è il pianificatore a sapere se il resto della domanda ha
        // altri rami.
        let Some(query) = query else {
            return Ok(Paged::all(Vec::new()));
        };
        let searcher = self.reader.searcher();

        let total = searcher
            .search(&*query, &tantivy::collector::Count)
            .map_err(|and| PluginError::Internal(reason(COUNT, and)))?;
        let (offset, limit) = match page {
            // Senza finestra si restituisce tutto ciò che combacia: il tetto è
            // il conteggio, non un numero inventato qui. E non è una svista da
            // vault grande: è **come il pianificatore interroga sempre**
            // (`fub-kernel/src/index/plan.rs`), perché ordine e finestra di una
            // risposta a `Documents` sono del contratto e non di tantivy
            // ([decisione 0020](../../../docs/decisions/README.md)).
            // Quanto costi l'argomento di `with_limit` è misurato in
            // `tests/una_ricerca_senza_finestra.rs`, e la risposta è: niente. Il
            // costo sta in `searcher.doc`, cioè nelle righe restituite.
            None => (0usize, total),
            Some(p) => (p.offset as usize, p.limit as usize),
        };
        if limit == 0 || offset >= total {
            return Ok(Paged {
                items: Vec::new(),
                offset: offset as u32,
                total: total as u32,
            });
        }

        // `with_limit` va in panico su 0 — intercettato sopra.
        let collector = tantivy::collector::TopDocs::with_limit(limit)
            .and_offset(offset)
            .order_by_score();
        let top = searcher
            .search(&*query, &collector)
            .map_err(|and| PluginError::Internal(reason(SEARCH, and)))?;

        // La **rilevanza** ce l'ha chi ha una foglia di testo, e solo lui:
        // evidenziare la cartella o il tag per cui una nota è stata selezionata
        // non vuol dire niente, e `tipo: progetto` non è più vero su una nota
        // che su un'altra. Si decide qui perché `text_parts` finisce dentro il
        // generatore, e perché non dipende dagli estratti: il punteggio serve a
        // **ordinare**, e ordinare è ciò che si fa prima di sapere quale pagina
        // resta.
        let scored = !text_parts.is_empty();
        // Gli estratti invece si generano solo se qualcuno li ha chiesti
        // (§21.9). Non è una micro-ottimizzazione: senza finestra — che è come
        // chiede il pianificatore, perché l'ordine della risposta è del
        // contratto e non di tantivy — questa riga vale un estratto per **ogni**
        // documento che combacia. Su duemila note e un termine comune erano
        // duemila estratti generati per mostrarne venti, cioè i ventuno
        // millisecondi che la §21.9 non sapeva spiegare.
        let mut snippets = match !scored || !excerpts.wanted() {
            true => None,
            false => {
                let text_query: Box<dyn Query> = Box::new(BooleanQuery::new(
                    text_parts
                        .into_iter()
                        .map(|q| (Occur::Should, q))
                        .collect::<Vec<_>>(),
                ));
                let mut gen = SnippetGenerator::create(&searcher, &*text_query, f.body)
                    .map_err(|and| PluginError::Internal(reason(SNIPPET, and)))?;
                gen.set_max_num_chars(SNIPPET_CHARS);
                Some(gen)
            }
        };

        let mut hits = Vec::with_capacity(top.len());
        for (score, address) in top {
            let doc: TantivyDocument = searcher
                .doc(address)
                .map_err(|and| PluginError::Internal(reason(DOC_READ, and)))?;
            let Some(id) = doc.get_first(f.doc_id).and_then(|v| v.as_str()) else {
                continue;
            };
            let mut hit = DocumentMatch::of(DocId::new(id));
            if scored {
                hit.score = Some(score);
            }
            if let Some(snippets) = snippets.as_mut() {
                let body = doc.get_first(f.body).and_then(|v| v.as_str()).unwrap_or("");
                let snippet = snippets.snippet_from_doc(&doc);
                let (text, highlights) = if snippet.fragment().is_empty() {
                    // Match sul solo titolo o sui soli tag: nessun frammento da
                    // evidenziare, ma un incipit è meglio di una riga vuota.
                    (head_of(body, SNIPPET_CHARS), Vec::new())
                } else {
                    let ranges = snippet
                        .highlighted()
                        .iter()
                        .map(|r| Span::new(r.start, r.end))
                        .collect();
                    (snippet.fragment().to_string(), ranges)
                };
                hit.snippet = Some(text);
                hit.highlights = highlights;
            }
            hits.push(hit);
        }
        Ok(Paged {
            items: hits,
            offset: offset as u32,
            total: total as u32,
        })
    }

    /// L'albero del contratto → l'albero di tantivy.
    ///
    /// `text_parts` raccoglie le sole foglie di testo: servono al generatore di
    /// snippet, che deve evidenziare ciò che l'utente ha cercato e non i filtri
    /// che gli stanno intorno.
    ///
    /// `None` significa «questa espressione non seleziona niente», che non è la
    /// stessa cosa di «tutto»: una clausola con una foglia di testo vuota è
    /// vuota, mentre un'espressione senza clausole è tutto il vault.
    fn translate(
        &self,
        expr: &QueryExpr,
        text_parts: &mut Vec<Box<dyn Query>>,
    ) -> Result<Option<Box<dyn Query>>, PluginError> {
        if expr.any.is_empty() {
            return Ok(Some(Box::new(AllQuery)));
        }
        let mut clauses: Vec<(Occur, Box<dyn Query>)> = Vec::new();
        for clause in &expr.any {
            if let Some(q) = self.translate_clause(clause, text_parts)? {
                clauses.push((Occur::Should, q));
            }
        }
        match clauses.len() {
            0 => Ok(None),
            1 => Ok(Some(clauses.pop().expect("ce n'è una").1)),
            _ => Ok(Some(Box::new(BooleanQuery::new(clauses)))),
        }
    }

    fn translate_clause(
        &self,
        clause: &QueryClause,
        text_parts: &mut Vec<Box<dyn Query>>,
    ) -> Result<Option<Box<dyn Query>>, PluginError> {
        if clause.all.is_empty() {
            return Ok(Some(Box::new(AllQuery)));
        }
        let mut parts: Vec<(Occur, Box<dyn Query>)> = Vec::new();
        let mut only_negated = true;
        for literal in &clause.all {
            let translated = self.translate_predicate(&literal.predicate, text_parts)?;
            match (literal.negated, translated) {
                // Un letterale positivo che non seleziona niente svuota l'AND.
                (false, None) => return Ok(None),
                (false, Some(q)) => {
                    only_negated = false;
                    parts.push((Occur::Must, q));
                }
                // Negare ciò che non seleziona niente non toglie niente.
                (true, None) => {}
                (true, Some(q)) => parts.push((Occur::MustNot, q)),
            }
        }
        if parts.is_empty() {
            return Ok(Some(Box::new(AllQuery)));
        }
        if only_negated {
            // Un booleano di soli `MustNot` non ha da cosa sottrarre.
            parts.push((Occur::Must, Box::new(AllQuery)));
        }
        Ok(Some(Box::new(BooleanQuery::new(parts))))
    }

    fn translate_predicate(
        &self,
        predicate: &QueryPredicate,
        text_parts: &mut Vec<Box<dyn Query>>,
    ) -> Result<Option<Box<dyn Query>>, PluginError> {
        let f = self.fields;
        match predicate {
            QueryPredicate::Text(text) => {
                let Some(q) = self.text_query(text)? else {
                    return Ok(None);
                };
                text_parts.push(q.box_clone());
                Ok(Some(q))
            }
            QueryPredicate::Task { status } => Ok(Some(term_query(
                f.task_state,
                match status {
                    TaskStatus::Open => "open",
                    TaskStatus::Done => "done",
                },
            ))),
            QueryPredicate::TaskDue { min, max } => {
                let term = |date: &str| Term::from_field_text(f.task_due, date);
                let edge = |bound: &Option<DueBound>, open: Bound<Term>| match bound {
                    Some(DueBound {
                        date,
                        inclusive: true,
                    }) => Bound::Included(term(date)),
                    Some(DueBound {
                        date,
                        inclusive: false,
                    }) => Bound::Excluded(term(date)),
                    None => open,
                };
                // Senza estremo in basso si parte dalla chiave vuota, che sta
                // prima di ogni data: l'intervallo deve sapere il suo campo.
                Ok(Some(Box::new(RangeQuery::new(
                    edge(min, Bound::Included(term(""))),
                    edge(max, Bound::Unbounded),
                ))))
            }
            QueryPredicate::Regex { pattern, fields } => {
                if pattern.len() > MAX_REGEX_BYTES {
                    return Err(PluginError::BadArgs("regex exceeds 256 bytes".into()));
                }
                let regex = regex::RegexBuilder::new(pattern)
                    .multi_line(true)
                    .size_limit(1 << 20)
                    .dfa_size_limit(1 << 20)
                    .build()
                    .map_err(|err| PluginError::BadArgs(format!("invalid regex: {err}").into()))?;
                self.scan_fields(fields, |values| {
                    values.iter().any(|value| regex.is_match(value))
                })
            }
            QueryPredicate::Scoped { scope, text } => {
                // I candidati li trova l'indice, col corpo e le sue regole; qui
                // si tengono quelli che hanno tutto nella stessa unità.
                let body = TextQuery {
                    fields: vec![TextField::Body],
                    ..text.clone()
                };
                let Some(matcher) = scope::Matcher::new(text) else {
                    return Ok(None);
                };
                let Some(candidates) = self.text_query(&body)? else {
                    return Ok(None);
                };
                text_parts.push(candidates.box_clone());
                self.scan_layouts(&*candidates, |layout| matcher.within(layout, *scope))
            }
            QueryPredicate::Tag { name, descendants } => {
                let field = if *descendants { f.tag_paths } else { f.tags };
                Ok(Some(term_query(field, &canonical_tag(name))))
            }
            QueryPredicate::Folder { path, descendants } => {
                let field = if *descendants {
                    f.folder
                } else {
                    f.folder_exact
                };
                // Non confronta: **costruisce** il termine con cui il campo è stato
                // scritto. La normalizzazione dev'essere quella di
                // `within_folder`, che è la regola che quel campo l'ha
                // prodotto — un trim diverso qui è una ricerca che non trova
                // mai niente (difetto 0141).
                Ok(Some(term_query(field, folders::normalized(path))))
            }
            QueryPredicate::Docs { docs } => {
                if docs.is_empty() {
                    return Ok(None);
                }
                Ok(Some(Box::new(BooleanQuery::new(
                    docs.iter()
                        .map(|d| (Occur::Should, term_query(f.doc_id, d.as_str())))
                        .collect::<Vec<_>>(),
                ))))
            }
            // Il routing non manda qui ciò che non è stato dichiarato: se
            // succede è un errore del kernel, non una domanda malposta.
            // Il `{what}` porta la foglia che non si valuta — il Debug del
            // predicato (`Linked`, `Property` o `Custom` col suo payload) — e
            // la chiave è già in catalogo: nessuna nuova stringa fuori da
            // `catalog()`.
            other => Err(PluginError::Unserved(Text::message(
                UNSERVED_LEAF,
                vec![Arg::text(
                    WHAT,
                    format!("{:?} (routes: {:?})", other, self.routes()),
                )],
            ))),
        }
    }

    /// La foglia di testo: dei **termini**, non un linguaggio.
    ///
    /// I termini si ricavano col tokenizer del campo — lo stesso che ha
    /// indicizzato il documento — invece che spezzando la stringa a mano: è
    /// l'unico modo perché «Rust» trovi `rust` senza replicare qui le regole
    /// dell'analizzatore.
    fn text_query(&self, text: &TextQuery) -> Result<Option<Box<dyn Query>>, PluginError> {
        if text.case_sensitive && text.text.len() > MAX_REGEX_BYTES {
            return Err(PluginError::BadArgs(
                "case-sensitive text exceeds 256 bytes".into(),
            ));
        }
        let f = self.fields;
        if text.case_sensitive {
            let parts: Vec<String> = match text.mode {
                TextMode::Phrase => vec![regex::escape(&text.text)],
                TextMode::Terms => text
                    .text
                    .split(|ch: char| !ch.is_alphanumeric())
                    .filter(|word| !word.is_empty())
                    .map(regex::escape)
                    .collect(),
            };
            if parts.is_empty() {
                return Ok(None);
            }
            let last = parts.len() - 1;
            let expressions = parts
                .iter()
                .enumerate()
                .map(|(at, part)| {
                    let boundary = if at == last && text.partial_last_term {
                        ""
                    } else {
                        r"\b"
                    };
                    format!(r"\b{part}{boundary}")
                })
                .map(|pattern| {
                    regex::Regex::new(&pattern)
                        .expect("escaped literal has a valid regular expression")
                })
                .collect::<Vec<_>>();
            return self.scan_fields(&text.fields, |values| {
                expressions
                    .iter()
                    .all(|regex| values.iter().any(|value| regex.is_match(value)))
            });
        }
        // Una sola lettura per query, e non una per campo: i quattro pesi vanno
        // presi nello stesso istante, o una query lanciata mentre qualcuno
        // muove uno slider potrebbe pesare il nome con la taratura nuova e gli
        // heading con quella vecchia — un ordinamento che non corrisponde a
        // nessuna configurazione mai esistita.
        let w = *self.weights.read().expect("rwlock");
        let wanted: Vec<(Field, f32)> = if text.fields.is_empty() {
            vec![
                (f.page_name, w.name),
                (f.headings, w.heading),
                (f.body, w.body),
                (f.tags, w.tags),
            ]
        } else {
            text.fields
                .iter()
                .map(|field| match field {
                    TextField::Name => (f.page_name, w.name),
                    TextField::Body => (f.body, w.body),
                    TextField::Tags => (f.tags, w.tags),
                    TextField::Heading => (f.headings, w.heading),
                })
                .collect()
        };
        if text.text.trim().is_empty() {
            return Ok(None);
        }
        // La **tolleranza è dicibile e non ancora onorata**, ed è così di
        // proposito (decisione 0050): la forma entra nel contratto prima del
        // comportamento, perché la forma scade col freeze di M4 e il fuzzy no.
        // Il `match` è esaustivo apposta — il giorno che `Typos` diventa una
        // `FuzzyTermQuery`, il compilatore porta chi lo scrive esattamente qui,
        // invece di lasciare il caso assorbito da un `_`.
        match text.tolerance {
            // Ciò che il motore fa oggi, ed è l'unico verso in cui questo
            // silenzio è innocuo: chi ha chiesto l'esattezza la ottiene.
            TextTolerance::Exact => {}
            // Chi ha chiesto di essere indovinato riceve una ricerca esatta —
            // meno risultati, non risultati sbagliati. Il verso opposto (essere
            // tolleranti senza che nessuno lo abbia chiesto) è quello che la
            // §21.1 chiama un difetto, perché su questo canale ci passano anche
            // le scritture.
            TextTolerance::Typos => {}
        }

        let mut for_field: Vec<(Occur, Box<dyn Query>)> = Vec::new();
        let mut for_term: Vec<Vec<(Occur, Box<dyn Query>)>> = Vec::new();
        // I tre campi di prosa (`page_name`, `headings`, `body`) condividono
        // il tokenizer `default` dello schema (vedi `build_schema`): il testo
        // della query si tokenizza una volta sola, e i termini differiscono
        // solo per il campo a cui sono legati. I tag restano un passaggio a
        // parte — col tokenizer `raw` il termine è la stringa intera.
        let words = if wanted.iter().any(|(f, _)| *f != self.fields.tags) {
            self.token_texts(&text.text)?
        } else {
            Vec::new()
        };
        for (field, boost) in wanted {
            let terms = if field == self.fields.tags {
                self.terms_of(field, &text.text)?
            } else {
                words
                    .iter()
                    .map(|p| Term::from_field_text(field, p))
                    .collect()
            };
            if terms.is_empty() {
                continue;
            }
            // L'ultimo termine è quello che si sta ancora scrivendo, e solo
            // lui: `arch async` cerca `async` per intero e `arch` come
            // prefisso, cioè quello che ha sotto le dita chi digita.
            let last = terms.len() - 1;
            match text.mode {
                // La frase: la sequenza esatta, in un campo alla volta. Con un
                // termine solo non c'è nessuna sequenza da rispettare, e
                // `PhraseQuery` va in panico: è un termine.
                TextMode::Phrase => {
                    let q: Box<dyn Query> = match (terms.len(), text.partial_last_term) {
                        (1, false) => Box::new(TermQuery::new(
                            terms[0].clone(),
                            IndexRecordOption::WithFreqs,
                        )),
                        (1, true) => self.prefix_query(field, &terms[0])?,
                        // Una frase il cui ultimo termine è incompleto è
                        // esattamente ciò che `PhrasePrefixQuery` esprime: la
                        // sequenza, e in coda un prefisso.
                        (_, true) => Box::new(PhrasePrefixQuery::new(terms)),
                        (_, false) => Box::new(PhraseQuery::new(terms)),
                    };
                    for_field.push((Occur::Should, boosted(q, boost)));
                }
                // I termini: ognuno deve comparire (in qualche campo), che è
                // ciò che si aspetta chi digita due parole.
                TextMode::Terms => {
                    for (at, term) in terms.into_iter().enumerate() {
                        let q: Box<dyn Query> = if at == last && text.partial_last_term {
                            self.prefix_query(field, &term)?
                        } else {
                            Box::new(TermQuery::new(term, IndexRecordOption::WithFreqs))
                        };
                        if for_term.len() <= at {
                            for_term.push(Vec::new());
                        }
                        for_term[at].push((Occur::Should, boosted(q, boost)));
                    }
                }
            }
        }

        match text.mode {
            TextMode::Phrase => match for_field.len() {
                0 => Ok(None),
                _ => Ok(Some(Box::new(BooleanQuery::new(for_field)))),
            },
            TextMode::Terms => {
                if for_term.is_empty() {
                    return Ok(None);
                }
                let all: Vec<(Occur, Box<dyn Query>)> = for_term
                    .into_iter()
                    .map(|alternatives| {
                        let q: Box<dyn Query> = Box::new(BooleanQuery::new(alternatives));
                        (Occur::Must, q)
                    })
                    .collect();
                Ok(Some(Box::new(BooleanQuery::new(all))))
            }
        }
    }

    /// Il raw stored è la fonte di verità per regex e grafia case-sensitive:
    /// l'indice tokenizzato ha già dimenticato punteggiatura e maiuscole. Oltre
    /// al tetto dichiarato rifiutiamo la domanda, mai una pagina parziale.
    fn scan_fields(
        &self,
        requested: &[TextField],
        mut matches: impl FnMut(&[&str]) -> bool,
    ) -> Result<Option<Box<dyn Query>>, PluginError> {
        self.commit()?;
        let searcher = self.reader.searcher();
        if searcher.num_docs() > MAX_SCAN_DOCS {
            return Err(PluginError::BadArgs(
                "regex/case-sensitive search is limited to 2048 indexed documents".into(),
            ));
        }
        let fields = if requested.is_empty() {
            &ALL_TEXT_FIELDS[..]
        } else {
            requested
        };
        let mut docs = Vec::new();
        let mut scanned = 0usize;
        let candidates = searcher
            .search(
                &AllQuery,
                &tantivy::collector::TopDocs::with_limit(MAX_SCAN_DOCS as usize).order_by_score(),
            )
            .map_err(|err| PluginError::Internal(reason(SEARCH, err)))?;
        for (_, address) in candidates {
            let doc: TantivyDocument = searcher
                .doc(address)
                .map_err(|err| PluginError::Internal(reason(DOC_READ, err)))?;
            let Some(id) = doc.get_first(self.fields.doc_id).and_then(|v| v.as_str()) else {
                continue;
            };
            let mut values = Vec::new();
            for field in fields {
                let stored = match field {
                    TextField::Name => self.fields.page_name,
                    TextField::Body => self.fields.body,
                    TextField::Tags => self.fields.tags,
                    TextField::Heading => self.fields.headings,
                };
                values.extend(doc.get_all(stored).filter_map(|value| value.as_str()));
            }
            scanned = scanned.saturating_add(values.iter().map(|s| s.len()).sum::<usize>());
            if scanned > MAX_SCAN_BYTES {
                return Err(PluginError::BadArgs(
                    "regex/case-sensitive search exceeds 8 MiB of indexed text".into(),
                ));
            }
            if matches(&values) {
                docs.push((Occur::Should, term_query(self.fields.doc_id, id)));
            }
        }
        Ok((!docs.is_empty()).then(|| Box::new(BooleanQuery::new(docs)) as Box<dyn Query>))
    }

    /// I documenti di `candidates` la cui forma (`layout`) passa `matches`.
    ///
    /// Gli stessi tetti di [`Self::scan_fields`], ma sui soli candidati: chi
    /// cerca in una riga ha già detto quali parole ci devono stare.
    fn scan_layouts(
        &self,
        candidates: &dyn Query,
        mut matches: impl FnMut(&str) -> bool,
    ) -> Result<Option<Box<dyn Query>>, PluginError> {
        self.commit()?;
        let searcher = self.reader.searcher();
        let found = searcher
            .search(
                candidates,
                &tantivy::collector::TopDocs::with_limit(MAX_SCAN_DOCS as usize + 1)
                    .order_by_score(),
            )
            .map_err(|err| PluginError::Internal(reason(SEARCH, err)))?;
        if found.len() > MAX_SCAN_DOCS as usize {
            return Err(PluginError::BadArgs(Text::key(SCOPE_TOO_MANY)));
        }
        let mut docs = Vec::new();
        let mut scanned = 0usize;
        for (_, address) in found {
            let doc: TantivyDocument = searcher
                .doc(address)
                .map_err(|err| PluginError::Internal(reason(DOC_READ, err)))?;
            let Some(id) = doc.get_first(self.fields.doc_id).and_then(|v| v.as_str()) else {
                continue;
            };
            let layout = doc
                .get_first(self.fields.layout)
                .and_then(|v| v.as_str())
                .unwrap_or("");
            scanned = scanned.saturating_add(layout.len());
            if scanned > MAX_SCAN_BYTES {
                return Err(PluginError::BadArgs(Text::key(SCOPE_TOO_LARGE)));
            }
            if matches(layout) {
                docs.push((Occur::Should, term_query(self.fields.doc_id, id)));
            }
        }
        Ok((!docs.is_empty()).then(|| Box::new(BooleanQuery::new(docs)) as Box<dyn Query>))
    }

    /// Un termine **incompleto**: tutto ciò che comincia così.
    ///
    /// È un automa sul dizionario dei termini — cioè un intervallo aperto nella
    /// term dictionary, che è il costo vero di una ricerca mentre si digita
    /// (§21.9 lo dice per iscritto: un prefisso apre un intervallo). Il testo
    /// arriva già passato dal tokenizer del campo, quindi qui non ci sono
    /// maiuscole né punteggiatura da normalizzare; l'escape c'è lo stesso,
    /// perché ciò che entra in un motore di regex viene da chi digita e non da
    /// noi.
    fn prefix_query(&self, field: Field, term: &Term) -> Result<Box<dyn Query>, PluginError> {
        let value = term.value();
        let pattern = format!("{}.*", escape_regex(value.as_str().unwrap_or_default()));
        let query = RegexQuery::from_pattern(&pattern, field)
            .map_err(|and| PluginError::Internal(reason(TOKENIZER, and)))?;
        Ok(Box::new(query))
    }

    /// Il testo della query tokenizzato una volta sola, col tokenizer che
    /// i tre campi di prosa condividono: i `Term` differiscono solo per il
    /// campo a cui si legano, non per come la stringa si spezza.
    fn token_texts(&self, text: &str) -> Result<Vec<String>, PluginError> {
        let mut analyzer = self
            .index
            .tokenizer_for_field(self.fields.page_name)
            .map_err(|and| PluginError::Internal(reason(TOKENIZER, and)))?;
        let mut words = Vec::new();
        let mut stream = analyzer.token_stream(text);
        while let Some(token) = stream.next() {
            words.push(token.text.to_string());
        }
        Ok(words)
    }

    /// I termini di un testo secondo il tokenizer del campo. Per un campo
    /// `STRING` (i tag) il tokenizer è `raw`, e il termine è la stringa intera —
    /// che è esattamente ciò che serve.
    fn terms_of(&self, field: Field, text: &str) -> Result<Vec<Term>, PluginError> {
        let mut analyzer = self
            .index
            .tokenizer_for_field(field)
            .map_err(|and| PluginError::Internal(reason(TOKENIZER, and)))?;
        let mut terms = Vec::new();
        let mut stream = analyzer.token_stream(text);
        while let Some(token) = stream.next() {
            terms.push(Term::from_field_text(field, &token.text));
        }
        Ok(terms)
    }
}

/// La scadenza di una task: la data dopo `📅` nel paragrafo della voce, come
/// la scrive il plugin Tasks (`📅 2026-10-19`).
pub(super) fn item_due(blocks: &[Block]) -> Option<String> {
    let Some(Block::Paragraph { inlines, .. }) = blocks.first() else {
        return None;
    };
    let text: String = inlines
        .iter()
        .map(|inline| match inline {
            fub_abi::model::Inline::Text(s) => s.as_str(),
            _ => " ",
        })
        .collect();
    let after = text.rsplit_once('📅')?.1.trim_start();
    let date = after.get(..10)?;
    let b = date.as_bytes();
    let shaped = b.iter().enumerate().all(|(at, c)| match at {
        4 | 7 => *c == b'-',
        _ => c.is_ascii_digit(),
    });
    (shaped
        && after[10..]
            .chars()
            .next()
            .is_none_or(|c| !c.is_ascii_digit()))
    .then(|| date.to_string())
}

fn term_query(field: Field, value: &str) -> Box<dyn Query> {
    Box::new(TermQuery::new(
        Term::from_field_text(field, value),
        IndexRecordOption::Basic,
    ))
}

/// I metacaratteri di regex resi letterali.
///
/// Non ci sono liste di caratteri «pericolosi» da tenere aggiornate: tutto ciò
/// che non è alfanumerico si scrive con la fuga davanti, che è sempre lecito e
/// non richiede di sapere quali metacaratteri conosca il motore di oggi.
fn escape_regex(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 4);
    for c in text.chars() {
        if !c.is_alphanumeric() {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

fn boosted(query: Box<dyn Query>, boost: f32) -> Box<dyn Query> {
    if boost == 1.0 {
        query
    } else {
        Box::new(BoostQuery::new(query, boost))
    }
}

/// I primi `max` caratteri di `text`, troncati su un confine di carattere e
/// senza spezzare l'ultima parola quando si può evitare.
pub(super) fn head_of(text: &str, max: usize) -> String {
    // Una passata sola: se `nth(max)` non c'è, il testo è già corto.
    let cut = match text.char_indices().nth(max) {
        None => return text.to_string(),
        Some((the, _)) => the,
    };
    let head = &text[..cut];
    let trimmed = match head.rfind(char::is_whitespace) {
        Some(sp) if sp > cut / 2 => &head[..sp],
        _ => head,
    };
    format!("{}…", trimmed.trim_end())
}

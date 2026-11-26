//! Contesto attivo e interrogazioni degli indici.

use super::*;

/// Una proiezione locale risolta fino al confine dei provider. Sorgente,
/// parser, regole e renderer sono valori posseduti: nessuno porta con sé una
/// guardia del workspace.
pub struct PreparedLocalProjection {
    pub(super) id: DocId,
    pub(super) resolved_page: Option<String>,
    pub(super) source_revision: Revision,
    pub(super) source: DocumentSource,
    pub(super) parser: PreparedParse,
    pub(super) renderers: crate::renderer::RendererRegistry,
    pub(super) kind: LocalProjectionKind,
    pub(super) routing_generation: u64,
    pub(super) projection_generation: u64,
}

pub(super) enum LocalProjectionKind {
    Preview,
    Print,
    Embed {
        heading: Option<String>,
        block: Option<String>,
    },
}

/// Il risultato esterno di una proiezione, ancora da validare contro lo stato
/// corrente del workspace.
pub struct CompletedLocalProjection {
    pub(super) id: DocId,
    pub(super) resolved_page: Option<String>,
    pub(super) source_revision: Revision,
    pub(super) result: IndexResult,
    pub(super) routing_generation: u64,
    pub(super) projection_generation: u64,
}

impl PreparedLocalProjection {
    /// Attraversa `FormatProvider::parse`, le `SyntaxRule`,
    /// `FormatProvider::render_html` e i `CustomRenderer`. Il chiamante deve
    /// aver già rilasciato ogni guardia di `Custody<Workspace>`.
    pub fn invoke(self) -> std::result::Result<CompletedLocalProjection, PluginError> {
        let PreparedLocalProjection {
            id,
            resolved_page,
            source_revision,
            source,
            parser,
            renderers,
            kind,
            routing_generation,
            projection_generation,
        } = self;
        let model = parser.invoke(source).map_err(PluginError::from)?;
        let (model, result_kind, print) = match kind {
            LocalProjectionKind::Preview => (model, None, false),
            LocalProjectionKind::Print => (model, None, true),
            LocalProjectionKind::Embed { block, heading } => {
                let clipped = match (block.as_deref(), heading.as_deref()) {
                    (Some(block), _) => block_of(&model, block)
                        .ok_or_else(|| PluginError::NotFound(format!("{id}#^{block}").into()))?,
                    (None, Some(heading)) => section_of(&model, heading)
                        .ok_or_else(|| PluginError::NotFound(format!("{id}#{heading}").into()))?,
                    (None, None) => model,
                };
                (clipped, Some(id.0.clone()), false)
            }
        };
        let options = if print {
            RenderOptions {
                target: RenderTarget::Print,
                ..Default::default()
            }
        } else {
            RenderOptions::preview()
        };
        let rendered = parser
            .render(&model, &renderers, &options)
            .map_err(PluginError::from)?;
        let result = if print {
            IndexResult::RenderPrint(rendered.into())
        } else if let Some(doc_id) = result_kind {
            IndexResult::RenderEmbed(EmbedContent {
                doc_id,
                content: rendered.into(),
            })
        } else {
            IndexResult::RenderPreview(rendered.into())
        };
        Ok(CompletedLocalProjection {
            id,
            resolved_page,
            source_revision,
            result,
            routing_generation,
            projection_generation,
        })
    }
}

impl Workspace {
    // --- sessione ----------------------------------------------------------

    /// Pubblica il contesto del pannello con il focus e restituisce **le view
    /// da ridisegnare**: quelle il cui `follows` interseca ciò che è cambiato,
    /// in ordine di registrazione.
    ///
    /// Lo chiama la shell a ogni cambio di nota, di selezione o di modalità. È
    /// l'unico modo di scrivere il contesto: le view lo **leggono** via
    /// [`HostEnv::active_context`](fub_abi::traits::HostEnv::active_context),
    /// nessuno lo scrive dall'interno del contratto — vedi il campo `session` e [`Session`].
    ///
    /// Il conto di *cosa* ridisegnare sta qui e non nella shell perché la
    /// risposta non deve dipendere da chi la calcola: la regola è una
    /// ([`ViewContext::changes`]), e a M5 un host diverso avrà la stessa. La
    /// shell resta padrona del *quando* (è lei a pubblicare) e ignara del
    /// *chi* (non conosce gli id delle view).
    pub fn set_active_context(&self, context: Option<ViewContext>) -> Vec<String> {
        // Il taglio del §8.1 passa qui: la sessione dice *cosa* è cambiato, il
        // workspace traduce la maschera in id di view. È deliberato che il
        // componente non sappia che le view esistono.
        let named = context.as_ref().and_then(|c| c.doc.clone());
        let changed = self.session.publish(context);
        if changed.is_empty() {
            return Vec::new();
        }
        // Una riga per pubblicazione che cambia qualcosa, non per lettura: le
        // view lo leggono senza documento (vedi `active_context`).
        if let Some(doc) = named.filter(|doc| !self.docs.vault.exists(doc)) {
            tracing::info!(
                target: "fub.kernel",
                "contesto su un documento che non è nel vault ({doc}): le view lo leggono senza documento"
            );
        }
        // `views()` risolve già le due maschere sull'esemplare unico (§22.3):
        // qui non serve una seconda strada per la stessa domanda, e averla
        // vorrebbe dire due posti dove la regola può divergere.
        self.views()
            .into_iter()
            .filter(|spec| spec.follows.intersects(&changed))
            .map(|spec| spec.id)
            .collect()
    }

    /// Scorciatoia per chi ha un pannello solo: il documento attivo, senza
    /// selezione né modalità dichiarata.
    ///
    /// Non è una seconda strada per la stessa cosa — è la stessa strada con i
    /// campi che chi non ha lo split non ha da dire. Azzera la selezione:
    /// dichiarare un documento e lasciare la selezione del precedente sarebbe
    /// l'unico modo di produrre uno span mentitore.
    ///
    /// La shell **non passa più di qui** dal §1.2: i suoi riquadri sono N e
    /// pubblica `ViewContext` interi. Restano i test e gli esempi, ed è il
    /// motivo per cui questo non si toglie — la comodità è onesta, e nominare
    /// `MAIN_PANE` in un banco con un riquadro solo è ciò che si vuole davvero
    /// dire. Che i riquadri siano N non ha cambiato niente qui sotto: il kernel
    /// non tiene una mappa di riquadri e non deve, perché la domanda a cui
    /// risponde — cosa sta guardando l'utente adesso — è una sola per
    /// definizione (vedi la 0078).
    pub fn set_active_document(&self, id: Option<DocId>) -> Vec<String> {
        let context = id.map(|id| ViewContext::new(MAIN_PANE).with_doc(Some(id)));
        self.set_active_context(context)
    }

    /// Il contesto del pannello con il focus, se la shell ne ha pubblicato uno.
    ///
    /// **Un documento che non è nel vault non si serve.** La shell pubblica di
    /// suo e in ritardo (il cursore aspetta 150 ms): può nominare la nota che
    /// un rename dal titolo ha appena spostato, quella che un altro programma
    /// ha appena tolto, o la linguetta ripristinata di un file sparito ad app
    /// chiusa. Servito così, ogni view che legge il documento attivo —
    /// struttura, note a piè di pagina, proprietà, statistiche — falliva con
    /// `NotFound`, e la shell lo diceva come un pannello rotto (IMP-1800). È la
    /// stessa verità di [`Session::invalidate`] con `Gone`, letta dall'altro
    /// lato: il documento cade, la selezione con lui (i suoi offset erano di
    /// quel testo), riquadro e modalità restano. Il contesto pubblicato non si
    /// riscrive: se il file torna, la stessa domanda lo ritrova senza aspettare
    /// che la shell ripubblichi. Il fatto si scrive nel log quando la shell lo
    /// pubblica ([`set_active_context`](Workspace::set_active_context)), non a
    /// ogni lettura.
    pub fn active_context(&self) -> Option<ViewContext> {
        let mut context = self.session.context()?;
        if context
            .doc
            .as_ref()
            .is_some_and(|doc| !self.docs.vault.exists(doc))
        {
            context.doc = None;
            context.selections = None;
        }
        Some(context)
    }

    /// Il documento del contesto attivo: la lettura che il kernel usa dove il
    /// pannello non c'entra (rename, rimozione, comodità dei test).
    pub fn active_document(&self) -> Option<DocId> {
        self.session.document()
    }

    /// Congela il piano delle query servite dal canale dati generico. Le quattro
    /// famiglie composte dal `Workspace` restano sul percorso locale soltanto
    /// quando la rotta appartiene al core; se un indice esterno la sostituisce,
    /// anche quella callback attraversa il percorso staccato.
    pub fn prepare_detached_index_query(&self, query: &IndexQuery) -> Option<PreparedIndexQuery> {
        match query {
            IndexQuery::RenderPreview { .. }
            | IndexQuery::RenderPrint { .. }
            | IndexQuery::RenderEmbed { .. }
            | IndexQuery::Settings { .. }
            | IndexQuery::SyntaxForms { .. }
                if !self.indexes.query_owner_is_external(query) =>
            {
                None
            }
            _ => Some(self.indexes.prepare_query()),
        }
    }

    /// Prepara le due proiezioni servite localmente senza eseguire provider.
    /// Una rotta sostituita da un indice esterno resta sul planner staccato e
    /// non entra qui.
    pub fn prepare_local_index_projection(
        &self,
        query: &IndexQuery,
    ) -> Result<Option<PreparedLocalProjection>> {
        if self.indexes.query_owner_is_external(query) {
            return Ok(None);
        }
        let (id, resolved_page, kind) = match query {
            IndexQuery::RenderPreview { doc } => (doc.clone(), None, LocalProjectionKind::Preview),
            IndexQuery::RenderPrint { doc } => (doc.clone(), None, LocalProjectionKind::Print),
            IndexQuery::RenderEmbed {
                page,
                heading,
                block,
            } => {
                let id = self
                    .resolve_link(page)
                    .ok_or_else(|| KernelError::NotFound(page.clone()))?;
                (
                    id,
                    Some(page.clone()),
                    LocalProjectionKind::Embed {
                        heading: heading.clone(),
                        block: block.clone(),
                    },
                )
            }
            _ => return Ok(None),
        };
        if !self.indexes.core.metas.contains_key(&id) {
            return Err(KernelError::NotFound(id.to_string()));
        }
        let source = self.docs.source_from_disk(&id)?;
        let source_revision = Revision::of_bytes(source.bytes());
        let parser = self.docs.prepare_parse(&id)?;
        Ok(Some(PreparedLocalProjection {
            id,
            resolved_page,
            source_revision,
            source,
            parser,
            renderers: self.docs.renderers.clone(),
            kind,
            routing_generation: self.indexes.routing_generation(),
            projection_generation: self.projection_generation,
        }))
    }

    /// Accetta una proiezione soltanto se appartiene ancora alla stessa rotta,
    /// alla stessa pipeline e allo stesso sorgente. Mutazioni su altri
    /// documenti sono compatibili e non la invalidano; qualunque registrazione
    /// o ritiro di regole sintattiche o renderer è invece conservativamente
    /// incompatibile con lo snapshot della pipeline.
    pub fn finish_local_index_projection(
        &self,
        completed: CompletedLocalProjection,
    ) -> std::result::Result<IndexResult, PluginError> {
        self.indexes
            .ensure_query_is_current(completed.routing_generation)?;
        if completed.projection_generation != self.projection_generation {
            return Err(PluginError::Conflict(
                "la pipeline di proiezione è cambiata durante la query".into(),
            ));
        }
        if !self.indexes.core.metas.contains_key(&completed.id) {
            return Err(PluginError::Conflict(
                format!("{} è stato ritirato durante la query", completed.id).into(),
            ));
        }
        if completed
            .resolved_page
            .as_deref()
            .is_some_and(|page| self.resolve_link(page).as_ref() != Some(&completed.id))
        {
            return Err(PluginError::Conflict(
                format!(
                    "il riferimento a {} è cambiato durante la query",
                    completed.id
                )
                .into(),
            ));
        }
        let current = match self.docs.source_from_disk(&completed.id) {
            Ok(current) => current,
            Err(error) if error.is_missing() => {
                return Err(PluginError::Conflict(
                    format!("{} è stato rimosso durante la query", completed.id).into(),
                ));
            }
            Err(error) => return Err(error.into()),
        };
        if Revision::of_bytes(current.bytes()) != completed.source_revision {
            return Err(PluginError::Conflict(
                format!("{} è cambiato durante la query", completed.id).into(),
            ));
        }
        Ok(completed.result)
    }

    /// Completa la sola parte locale della risposta dopo l'esecuzione del
    /// piano staccato. Prima rifiuta una fotografia il cui routing è cambiato;
    /// poi traduce le occorrenze sul sorgente corrente senza riattraversare
    /// alcun provider.
    pub fn finish_detached_index_query(
        &self,
        completed: CompletedIndexQuery,
        query: &IndexQuery,
    ) -> std::result::Result<IndexResult, PluginError> {
        self.indexes
            .ensure_query_is_current(completed.routing_generation)?;
        let needles = occurrences::wanted(query);
        Ok(match completed.result {
            IndexResult::Documents(page) if !needles.is_empty() => {
                IndexResult::Documents(self.locate(page, &needles))
            }
            other => other,
        })
    }

    // --- indici -----------------------------------------------------------

    /// Interroga il canale dati.
    ///
    /// **Un percorso di dispatch solo.** Prima erano due e mezzo: sette varianti
    /// su nove le serviva il kernel con un `return` anticipato, e le altre due
    /// giravano su tutti gli indici registrati in ordine finché uno non
    /// rispondeva `BadArgs`. Adesso chi serve cosa è dichiarato
    /// ([`QueryRoute`]), le risposte del kernel
    /// sono un indice registrato per primo, e ciò che nessuno serve torna come
    /// [`PluginError::Unserved`] invece che come l'errore dell'ultimo
    /// interpellato.
    ///
    /// Chi compone la risposta quando la domanda ha foglie di proprietari
    /// diversi è il pianificatore (vedi [`crate::index::plan`]).
    ///
    /// # E poi la risposta si **localizza**
    ///
    /// Un risultato di ricerca che sa dire *quale nota* e non *a che punto*
    /// rende inesprimibili tre cose (la ricerca dentro la nota aperta, il salto
    /// all'occorrenza successiva, N risultati per nota): è la §21.3, chiusa
    /// dalla decisione 0049 con
    /// [`DocumentMatch::occurrences`](fub_abi::traits::DocumentMatch::occurrences).
    ///
    /// A riempirle è **qui**, e non chi indicizza, per una ragione di verità e
    /// non di comodo: le coordinate sono byte del **sorgente**, e chi indicizza
    /// ha in mano la proiezione a testo piano del documento — vedi
    /// [`crate::occurrences`]. Il sorgente ce l'ha il vault, cioè questo
    /// componente, che è anche l'unico punto in cui *ogni* risposta passa,
    /// compresa quella di un motore di terzi che rivendicasse
    /// [`QueryKind::Documents`](fub_abi::traits::QueryKind::Documents).
    ///
    /// Chi ha già riempito `occurrences` non viene toccato: un indice che
    /// sappia dire *dove* — perché tiene i sorgenti, perché è un motore diverso
    pub fn query_index(&self, query: IndexQuery) -> std::result::Result<IndexResult, PluginError> {
        // La resa (§1.6, decisione 0163) è intercettata qui e non passa da
        // `indexes.query`: `CoreIndex` non ha i documenti né i renderer, e la
        // rotta che dichiara (`QueryRoute::Query`) serve solo a dire che il
        // kernel è il risponditore — come Outline. La fast-path di prima era un
        // comando Tauri bespoke; adesso è il canale dati di tutti.
        match query {
            IndexQuery::RenderPreview { doc } => Ok(IndexResult::RenderPreview(
                self.render_preview(&doc)?.into(),
            )),
            IndexQuery::RenderPrint { doc } => Ok(IndexResult::RenderPrint(
                self.render_document(
                    &doc,
                    RenderOptions {
                        target: RenderTarget::Print,
                        ..Default::default()
                    },
                )?
                .into(),
            )),
            IndexQuery::RenderEmbed {
                page,
                heading,
                block,
            } => {
                let (doc_id, content) =
                    self.render_embed(&page, heading.as_deref(), block.as_deref())?;
                Ok(IndexResult::RenderEmbed(EmbedContent {
                    doc_id: doc_id.0,
                    content: content.into(),
                }))
            }
            // Le etichette, come la resa: `CoreIndex` ha lo store e non i
            // cataloghi. `settings_entries` risolve per proprietario; senza
            // questa porta un `Text::Message` uscirebbe nudo, e sul filo
            // diventerebbe `{"key": …}` dove la shell si aspetta una stringa
            // `[object Object]` nel pannello. Presidiato da
            // `settings_as_out_resolved_too`.
            IndexQuery::Settings { plugin } => Ok(IndexResult::Settings(
                self.settings_entries(plugin.as_deref()),
            )),
            IndexQuery::SyntaxForms { doc } => {
                Ok(IndexResult::SyntaxForms(self.syntax_forms(&doc)))
            }
            other => {
                let needles = occurrences::wanted(&other);
                let result = self
                    .indexes
                    .query(other)
                    .map_err(|failure| self.localized_query_failure(failure))?;
                match result {
                    IndexResult::Documents(page) if !needles.is_empty() => {
                        Ok(IndexResult::Documents(self.locate(page, &needles)))
                    }
                    other => Ok(other),
                }
            }
        }
    }

    /// Apre i sorgenti della pagina e ci trova dentro i testi cercati.
    ///
    /// Costa **una lettura per riga**, e il tetto di
    /// [`occurrences::max_docs`] è ciò che impedisce a una domanda senza
    /// finestra di aprire il vault intero: oltre quel numero le righe restano
    /// senza coordinate, che è ciò che `occurrences` vuoto significa da
    /// contratto. Un documento che non si legge o che è sparito da sotto non è
    /// un errore della ricerca — la riga resta, senza il punto.
    pub(super) fn locate(
        &self,
        mut page: Paged<DocumentMatch>,
        needles: &[String],
    ) -> Paged<DocumentMatch> {
        for hit in page.items.iter_mut().take(occurrences::max_docs()) {
            if !hit.occurrences.is_empty() {
                continue;
            }
            let Ok(source) = self.docs.read_source(&hit.doc) else {
                continue;
            };
            // La revisione è quella del testo appena letto, non una presa
            // altrove: uno span vale sul sorgente su cui è stato misurato, e
            // dire «di quando» con l'impronta di un'altra lettura sarebbe la
            // bugia che il campo esiste per impedire.
            let revision = Revision::of(&source);
            hit.occurrences = occurrences::locate(&source, needles)
                .into_iter()
                .map(|span| DocPosition::at(span, revision.clone()))
                .collect();
        }
        page
    }

    /// Chi risponderebbe a questa domanda, e come: il piano.
    ///
    /// Serve a due cose che valgono adesso — **provare** il routing invece di
    /// descriverlo, e dire in un messaggio chi avrebbe dovuto rispondere. Non è
    /// l'explain plan di 9.2, che è una superficie con altri clienti.
    pub fn query_plan(&self, query: &IndexQuery) -> QueryPlan {
        self.indexes.plan_of(query)
    }

    /// Le rotte dichiarate: chi serve cosa, oggi, in questo montaggio.
    ///
    /// Non attraversa il contratto — l'inventario di ciò che è attivo è il §7.6
    /// — ma è ciò che rende il routing ispezionabile invece che descritto.
    pub fn query_routes(&self) -> Vec<(QueryRoute, String)> {
        self.indexes
            .routes
            .declared()
            .into_iter()
            .map(|(route, target)| (route, self.indexes.name_of(target)))
            .collect()
    }

    /// Porta gli indici a un punto di consistenza (vedi
    /// [`IndexProvider::flush`]). Da chiamare quando un lotto di modifiche è
    /// finito: il kernel non decide da solo *quando* è finito un lotto.
    ///
    /// È una **fase sua** (difetto 0113): chi ha i thread la chiama in un
    /// prestito esclusivo separato da quello della chiusura dell'indicizzazione
    /// ([`finish_index_with_graph`]), come la terza fase di
    /// `ExternalSync::batch`. Fra i due prestiti il lucchetto si rilascia, e
    /// un lettore concorrente non aspetta la somma delle fasi ma la sola che
    /// sta correndo — il flush tocca solo gli indici e il disco, non lo stato
    /// condiviso del workspace.
    ///
    /// L'errore di un indice non fa fallire il chiamante — un indice è stato
    /// *derivato*, la verità è il vault e si ricostruisce.
    ///
    /// **Li racconta da sé** (§20.3, decisione 0052), e continua a
    /// restituirli. È la forma della
    /// [decisione 0030](../../../docs/decisions/0183-composizione-host-kernel.md):
    /// un `Result` che dipende dall'attenzione di chi lo riceve è un `Result`
    /// che si perde, e il posto dove metterlo al sicuro è dentro chi lo
    /// produce. Qui il doc diceva «restituisce gli errori perché chi ha un
    /// canale di notifica possa mostrarli», e i tre chiamanti in produzione
    /// erano un `eprintln!`, un `let _ =` e una risalita fino a un altro
    /// `eprintln!` — il canale era stato costruito e collegato a metà.
    ///
    /// Il valore di ritorno resta perché c'è un chiamante che deve **agire** e
    /// non solo mostrare: la chiusura del vault (decisione 0029) li risale fino
    /// a chi spegne l'app, e in quel momento l'event bus sta per smettere di
    /// avere ascoltatori. Chi si limita a guardare adesso non deve più fare
    /// niente.
    ///
    /// È anche il punto in cui un indice **scrive**: riceve un [`HostApi`]
    /// intestato al proprio id, come gli event handler durante il dispatch.
    /// Gli indici escono dal workspace per la durata delle chiamate, così
    /// l'host può prestare `&mut Workspace` senza aliasing.
    pub fn flush_indexes(&mut self) -> Vec<PluginError> {
        let errors = self.lend(
            |ws| &mut ws.indexes.providers,
            |ws, indexes| {
                let mut errors = Vec::new();
                for (id, index) in indexes.iter() {
                    let _call = match crate::index::IndexCall::enter(id, index) {
                        Ok(call) => call,
                        Err(error) => {
                            errors.push(error);
                            continue;
                        }
                    };
                    let mut index = index.write();
                    let mut host = ws.host_for(id, InvokeMode::Apply);
                    if let Err(and) = index.flush(&mut host) {
                        errors.push(and);
                    }
                }
                errors
            },
        );
        // Un flush fallito è la perdita di un **derivato**: il vault è intatto,
        // e ciò che non è stato scritto si ricostruisce alla riapertura. Non
        // nomina un documento — il flush è per indice, non per nota — ed è
        // esattamente il caso per cui il soggetto di un guasto è opzionale.
        for error in errors.iter().cloned() {
            self.report_trouble(Severity::Warning, None, error, None);
        }
        // Ciò che i flush hanno emesso si consegna a chiamate tornate, non
        // dentro il frame di un provider.
        self.dispatch_pending();
        errors
    }
}

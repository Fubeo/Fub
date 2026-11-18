//! Il pannello cronologia (`HistoryView`): la lista delle versioni, l'anteprima
//! e la conferma del ripristino.

use super::*;

// ---------------------------------------------------------------------------
// Il pannello cronologia (§1.2), e il comando che ripristina
// ---------------------------------------------------------------------------
//
// # Chi scrive le versioni è chi le disegna
//
// Il §1.2 chiedeva di migrare la cronologia al protocollo dichiarativo, e la
// domanda che la migrazione ha dovuto rispondere è *da dove le legge*. Il
// pannello nativo le chiedeva a tre comandi Tauri, che le chiedevano allo store
// che vive nell'host. Un `ViewProvider` non ha né l'uno né gli altri — e non gli
// servono: questa view è dello **stesso plugin** che le versioni le scrive,
// quindi le rilegge dal proprio spazio dati con `data_read`, che è una capacità
// del contratto e non una scorciatoia. È la stessa strada che avrebbe un plugin
// di terzi che si tenesse uno store suo.
//
// Ne segue che il pannello non condivide l'esemplare in memoria dello store con
// l'handler che lo riempie: rilegge `versions.json` a ogni disegno. Non è un
// costo trascurato, è la scelta giusta due volte — l'indice è un file piccolo
// che sta nella cache del sistema, e un pannello che rilegge dice sempre la
// verità anche quando a scrivere è stata un'altra finestra.
//
// # Versioning spento significa pannello assente, e adesso per costruzione
//
// La shell nativa lo faceva con un `hidden` guidato da `VaultInfo.versioning`:
// il pannello c'era comunque, e a tenerlo vuoto era una riga di TypeScript.
// Adesso la view la registra la feature, e una feature spenta non si monta —
// quindi non c'è nessuna `ViewSpec` da montare, e nessuno la disegna. È la
// spegnibilità totale (D7) ottenuta togliendo codice invece di aggiungendone.

/// Id della `ViewSpec` della cronologia.
pub const HISTORY_VIEW: &str = "history";
/// L'id, nel registro, del comando che riporta una nota a una sua versione.
pub const VERSION_RESTORE: &str = "version.restore";
/// L'id del comando che svuota la cronologia del vault intero.
pub const VERSION_CLEAR: &str = "version.clear";
/// L'id del comando che conserva un testo nella cronologia, con una nota.
pub const VERSION_KEEP: &str = "version.keep";

/// Mostra il contenuto di una versione; l'istante sta nel payload.
pub(super) const A_PREVIEW: &str = "preview";
/// Chiude l'anteprima aperta.
const A_CLOSE_PREVIEW: &str = "close_preview";
/// Chiede di ripristinare la versione il cui istante sta nel payload: il
/// pannello domanda prima di riscrivere la nota.
const A_RESTORE: &str = "restore";
/// Il sì alla domanda: ripristina davvero.
const A_RESTORE_CONFIRM: &str = "restore_confirm";
/// Il no: la domanda sparisce e non succede niente.
const A_RESTORE_CANCEL: &str = "restore_cancel";
/// Confronta con la nota attuale la versione il cui istante sta nel payload.
const A_COMPARE: &str = "compare";
/// Il testo intero della versione scelta, invece del confronto che è la vista
/// di partenza.
const A_SHOW_TEXT: &str = "show_text";
/// Mette negli appunti il testo della versione il cui istante sta nel payload.
const A_COPY: &str = "copy";
/// La chiave del payload, e quella sotto cui l'anteprima aperta resta scritta
/// nello stato di vista dell'esemplare (§11.2).
pub(super) const TS: &str = "ts";
const PREVIEW_STATE: &str = "preview";
/// Se l'anteprima aperta mostra il confronto invece del testo.
const COMPARE_STATE: &str = "compare";
/// L'istante di cui si sta chiedendo il ripristino, finché non si risponde.
const CONFIRM_STATE: &str = "restore_confirm";
/// Disfa l'ultimo ripristino fatto da questo pannello.
const A_UNDO_RESTORE: &str = "undo_restore";
/// L'annullamento dell'ultimo ripristino, finché vale ([`RestoreUndo`]).
const UNDO_STATE: &str = "restore_undo";

/// Ciò che il pannello ricorda dopo un «Sì, ripristina» per offrire
/// «Annulla».
///
/// Non è un secondo meccanismo di annullamento: [`undo`](RestoreUndo::undo) è
/// l'[`Undo`](fub_abi::command::Undo) che `version.restore` ha dichiarato,
/// tale e quale, e «Annulla» ne esegue i passi con `run_command`, come farebbe
/// chi annulla dalla pila. Il pannello lo tiene perché la pila del kernel non
/// arriva a chi ha cliccato qui (vedi [`A_RESTORE`]).
///
/// [`revision`](RestoreUndo::revision) è la revisione della nota **subito
/// dopo** il ripristino: l'offerta vale finché la nota è quella. Una scrittura
/// dopo — una battuta, un altro ripristino, un file cambiato da fuori — la
/// toglie, perché «com'era prima del ripristino» non sarebbe più il contrario
/// dell'ultima cosa successa.
#[derive(Serialize, Deserialize)]
struct RestoreUndo {
    doc: String,
    ts: u64,
    revision: String,
    undo: fub_abi::command::Undo,
}

impl RestoreUndo {
    /// L'offerta ricordata, se è di `doc` e la nota non è cambiata da allora.
    fn current(doc: &DocId, host: &dyn ReadApi) -> Result<Option<Self>, PluginError> {
        let Some(raw) = host.view_state(UNDO_STATE)? else {
            return Ok(None);
        };
        let Ok(offer) = serde_json::from_value::<RestoreUndo>(raw) else {
            return Ok(None);
        };
        if offer.doc != doc.as_str() {
            return Ok(None);
        }
        let now = host.document_revision(doc).ok().map(|revision| revision.0);
        Ok((now.as_deref() == Some(offer.revision.as_str())).then_some(offer))
    }
}

/// Le versioni di un documento secondo la voce già caricata dell'indice.
fn versions_of_docs(doc: Option<&DocVersions>) -> Vec<VersionRef> {
    doc.map(|d| d.versions.iter().rev().cloned().collect())
        .unwrap_or_default()
}

/// Il contenuto di una versione, data la voce già caricata dell'indice.
pub(super) fn version_source_doc(
    doc: &DocVersions,
    id: &DocId,
    ts: u64,
    host: &dyn ReadApi,
) -> Result<Vec<u8>, PluginError> {
    let version = doc.versions.iter().find(|v| v.ts == ts).ok_or_else(|| {
        PluginError::NotFound(Text::message(
            NO_SUCH_VERSION,
            vec![Arg::timestamp(WHEN, ts), Arg::text(DOC, id.as_str())],
        ))
    })?;
    let path = blob(&doc.dir, &snapshot_name(ts, id.as_str()));
    read_snapshot(&path, version, host)
}

pub(super) fn read_snapshot(
    path: &str,
    version: &VersionRef,
    host: &dyn ReadApi,
) -> Result<Vec<u8>, PluginError> {
    let bytes = host.data_read(path)?.ok_or_else(|| {
        PluginError::Internal(Text::message(CONTENT_GONE, vec![Arg::text(PATH, path)]))
    })?;
    if bytes.len() as u64 != version.size || Fnv1a::hash(&bytes) != version.hash {
        return Err(PluginError::Internal(Text::message(
            CONTENT_MISMATCH,
            vec![Arg::text(PATH, path)],
        )));
    }
    Ok(bytes)
}

/// Il pannello cronologia: le versioni della nota aperta, e come tornarci.
pub struct HistoryView;

impl ViewProvider for HistoryView {
    fn interests(&self, _instance: &ViewInstance) -> ViewInterests {
        ViewInterests {
            // Una versione nasce da una scrittura, e da niente altro: la
            // maschera è più stretta di quella dei pannelli che leggono
            // l'indice.
            refresh: EventMask::of([
                EventKind::DocumentChanged,
                EventKind::EntryChanged,
                EventKind::BatchEnded,
            ]),
            // …e la storia è di **quella** nota. Non di dove sta il cursore.
            follows: ContextMask::document(),
        }
    }

    fn views(&self) -> Vec<ViewSpec> {
        vec![ViewSpec::new(
            HISTORY_VIEW,
            Text::key(VIEW_TITLE),
            ViewSurface::RightSidebar,
        )
        .with_icon("history")
        .ordered(3)]
    }

    fn render_view(
        &self,
        _instance: &ViewInstance,
        host: &dyn ReadApi,
    ) -> Result<UiNode, PluginError> {
        tree(host)
    }

    fn on_action(
        &mut self,
        _instance: &ViewInstance,
        action: UiAction,
        host: &mut dyn HostApi,
    ) -> Result<ViewUpdate, PluginError> {
        match action.action.0.as_str() {
            // L'anteprima si **ricorda**, non si disegna e basta: il pannello si
            // ridisegna a ogni scrittura, e un'anteprima che vivesse nel solo
            // albero sparirebbe al primo salvataggio di chi la sta leggendo.
            A_PREVIEW => {
                let (Some(_), Some(ts)) = (
                    same_notes(&action, host),
                    action.payload.get(TS).and_then(|v| v.as_u64()),
                ) else {
                    return Ok(ViewUpdate::None);
                };
                host.set_view_state(PREVIEW_STATE, Some(serde_json::Value::from(ts)))?;
                host.set_view_state(COMPARE_STATE, None)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // Il confronto è la stessa anteprima vista in un altro modo: resta
            // nello stato di vista per la stessa ragione, e si chiude con lei.
            A_COMPARE | A_SHOW_TEXT => {
                let (Some(_), Some(ts)) = (
                    same_notes(&action, host),
                    action.payload.get(TS).and_then(|v| v.as_u64()),
                ) else {
                    return Ok(ViewUpdate::None);
                };
                host.set_view_state(PREVIEW_STATE, Some(serde_json::Value::from(ts)))?;
                host.set_view_state(
                    COMPARE_STATE,
                    Some(serde_json::Value::Bool(action.action.0 == A_COMPARE)),
                )?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // Copiare non scrive niente nel vault: il testo va alla shell, che
            // possiede gli appunti. Il kernel lascia passare questo intento
            // solo dai provider del core.
            A_COPY => {
                let (Some(doc), Some(ts)) = (
                    same_notes(&action, host),
                    action.payload.get(TS).and_then(|v| v.as_u64()),
                ) else {
                    return Ok(ViewUpdate::None);
                };
                let docs = read_index(host)?;
                let entry = docs.get(doc.as_str()).ok_or_else(|| {
                    PluginError::NotFound(Text::message(
                        NO_VERSIONS,
                        vec![Arg::text(DOC, doc.as_str())],
                    ))
                })?;
                let text = String::from_utf8(version_source_doc(entry, &doc, ts, host)?)
                    .map_err(|_| PluginError::BadArgs(Text::key(DIFF_BINARY)))?;
                Ok(ViewUpdate::Custom {
                    ns: fub_abi::ui::CLIPBOARD_TEXT_NS.to_string(),
                    payload: serde_json::json!({ "text": text }),
                })
            }
            A_CLOSE_PREVIEW => {
                host.set_view_state(PREVIEW_STATE, None)?;
                host.set_view_state(COMPARE_STATE, None)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // Ripristinare **non** è una scrittura di questo pannello: è il
            // comando `version.restore`, invocato per id come lo invocherebbe la
            // palette o un plugin. Una view che riscrivesse il documento da sé
            // avrebbe un'operazione fuori dal registro — quindi fuori
            // dall'annullamento, fuori dalla simulazione e fuori dalla palette.
            // Ripristinare riscrive la nota, e da questo pannello l'annullamento
            // del comando non arriva a chi ha cliccato: prima si chiede.
            A_RESTORE => {
                let (Some(_), Some(ts)) = (
                    same_notes(&action, host),
                    action.payload.get(TS).and_then(|v| v.as_u64()),
                ) else {
                    return Ok(ViewUpdate::None);
                };
                host.set_view_state(CONFIRM_STATE, Some(serde_json::Value::from(ts)))?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            A_RESTORE_CANCEL => {
                host.set_view_state(CONFIRM_STATE, None)?;
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            A_RESTORE_CONFIRM => {
                host.set_view_state(CONFIRM_STATE, None)?;
                let (Some(doc), Some(ts)) = (
                    same_notes(&action, host),
                    action.payload.get(TS).and_then(|v| v.as_u64()),
                ) else {
                    return Ok(ViewUpdate::None);
                };
                host.set_view_state(PREVIEW_STATE, None)?;
                host.set_view_state(COMPARE_STATE, None)?;
                host.set_view_state(UNDO_STATE, None)?;
                let outcome = host.run_command(
                    VERSION_RESTORE,
                    serde_json::json!({ DOC: doc.as_str(), TS: ts }),
                )?;
                // L'annullamento che il comando ha dichiarato, se l'ha
                // dichiarato: senza una preimmagine leggibile non promette
                // niente, e il pannello non offre niente.
                if let Some(undo) = outcome.undo.filter(|undo| !undo.is_empty()) {
                    let revision = host.document_revision(&doc)?.0;
                    let offer = RestoreUndo {
                        doc: doc.to_string(),
                        ts,
                        revision,
                        undo,
                    };
                    host.set_view_state(
                        UNDO_STATE,
                        Some(
                            serde_json::to_value(offer)
                                .map_err(|error| PluginError::Internal(error.to_string().into()))?,
                        ),
                    )?;
                }
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            // «Annulla» dopo un ripristino: i passi dell'`Undo` che
            // `version.restore` ha dichiarato, eseguiti come li eseguirebbe la
            // pila. Un'offerta scaduta (la nota è cambiata) non fa niente:
            // l'albero l'aveva già tolta, e questo è il clic arrivato prima del
            // ridisegno.
            A_UNDO_RESTORE => {
                let Some(doc) = same_notes(&action, host) else {
                    return Ok(ViewUpdate::None);
                };
                let offer = RestoreUndo::current(&doc, host)?;
                host.set_view_state(UNDO_STATE, None)?;
                if let Some(offer) = offer {
                    for step in offer.undo.steps {
                        if let fub_abi::command::UndoStep::Command { command, args } = step {
                            host.run_command(&command, args)?;
                        }
                    }
                }
                Ok(ViewUpdate::Replace { root: tree(host)? })
            }
            _ => Ok(ViewUpdate::None),
        }
    }
}

/// La nota su cui questa riga è stata **disegnata**, e solo se è ancora
/// l'attiva.
///
/// È il difetto 0047 nel suo secondo sito, e qui è peggio che nell'outline:
/// là un salto scaduto portava il cursore nel punto sbagliato, qui una riga
/// scaduta **scrive**. Le due metà di un ripristino venivano da due istanti
/// diversi — il `ts` dalla storia della nota *disegnata*, la nota da quella
/// *attiva adesso* — e fra i due ci sta la finestra in cui il pannello vecchio è
/// ancora sotto il dito di chi clicca, perché il ridisegno che segue un cambio
/// di nota arriva dopo. Ne usciva un `version.restore` con la nota B e un
/// istante della storia di A: se B quell'istante non ce l'ha è un errore in
/// faccia a chi non ha sbagliato niente, e se ce l'ha — due scritture nello
/// stesso millisecondo sono un lotto, non una coincidenza — è B riportata
/// indietro senza che nessuno l'abbia chiesto.
///
/// Si **butta**, e non si ripristina la nota ricordata: `interests()` di questo
/// pannello dichiara `follows: document`, cioè promette di seguire l'attiva, e
/// scrivere d'autorità su quella di prima sarebbe insieme una contraddizione
/// della propria registrazione e la più invasiva delle due risposte sbagliate.
/// Un click scaduto non fa niente, e quello dopo — sul pannello giusto, che nel
/// frattempo è arrivato — lo fa.
fn same_notes(action: &UiAction, host: &dyn ReadApi) -> Option<DocId> {
    let drawn = action.payload.get(DOC).and_then(|v| v.as_str())?;
    let activate = host.active_context().and_then(|c| c.doc)?;
    (activate.as_str() == drawn).then_some(activate)
}

pub(super) fn tree(host: &dyn ReadApi) -> Result<UiNode, PluginError> {
    let Some(doc) = host.active_context().and_then(|c| c.doc) else {
        return Ok(UiNode::empty_state(Text::key(NO_ACTIVE_DOC)));
    };
    // L'indice si carica una volta sola: la lista e l'anteprima lo leggono
    // entrambe, e rileggerlo per ciascuna era un doppio parse.
    let docs = read_index(host)?;
    let entry = docs.get(doc.as_str());
    let versions = versions_of_docs(entry);
    if versions.is_empty() {
        return Ok(UiNode::empty_state(Text::key(EMPTY)));
    }
    // `versions` non vuota implica una voce: l'anteprima la riusa.
    let entry = entry.expect("versioni non vuote implicano una voce dell'indice");

    let previewed = host
        .view_state(PREVIEW_STATE)?
        .and_then(|v| v.as_u64())
        .filter(|ts| versions.iter().any(|v| v.ts == *ts));
    // La versione attuale è l'ultima fotografia del disco, non l'ultima
    // versione: un testo conservato più recente non è mai stato la nota.
    let on_disk = entry.latest_on_disk().map(|v| v.ts);
    let mut children = vec![UiNode::text(Text::message(
        COUNT,
        vec![Arg::int("count", versions.len() as i64)],
    ))];
    // Dopo un ripristino, prima della lista: è la cosa appena successa, e
    // disfarla è il gesto che si cerca subito.
    if let Some(offer) = RestoreUndo::current(&doc, host)? {
        children.push(
            UiNode::row(
                4,
                vec![
                    UiNode::text(Text::message(
                        RESTORED,
                        vec![Arg::timestamp(WHEN, offer.ts)],
                    )),
                    UiNode::button(
                        Text::key(UNDO_LABEL),
                        Intent::Neutral,
                        ActionRef::with(A_UNDO_RESTORE, serde_json::json!({ DOC: doc.as_str() })),
                    ),
                ],
            )
            .with_key("restore-undo"),
        );
    }
    children.push(UiNode::list(
        versions
            .iter()
            .enumerate()
            .map(|(the, v)| {
                // La variazione di una fotografia si misura sulla fotografia
                // prima, saltando i testi conservati che le stanno in mezzo.
                let older = versions[the + 1..].iter().find(|older| !older.is_kept());
                row(
                    v,
                    Some(v.ts) == on_disk,
                    older,
                    previewed == Some(v.ts),
                    doc.as_str(),
                )
            })
            .collect(),
    ));

    // L'anteprima testuale resta testo, mai HTML. Un contenuto non UTF-8
    // mostra la dimensione e resta ripristinabile come byte.
    if let Some(ts) = previewed {
        let bytes = version_source_doc(entry, &doc, ts, host)?;
        let current = on_disk == Some(ts);
        let note = versions
            .iter()
            .find(|v| v.ts == ts)
            .and_then(|v| v.note.clone());
        // Di una versione passata si vuole sapere prima di tutto *cosa è
        // cambiato*: il confronto è la vista di partenza, e il testo intero è
        // a un clic. La versione attuale, identica alla nota, si mostra come
        // testo.
        let comparing = host
            .view_state(COMPARE_STATE)?
            .and_then(|v| v.as_bool())
            .unwrap_or(!current);
        let payload = serde_json::json!({ DOC: doc.as_str(), TS: ts });
        let text = std::str::from_utf8(&bytes).is_ok();
        let body = if comparing {
            if over_the_cap(&doc, None, host)? {
                UiNode::text(Text::message(DIFF_CURRENT_TOO_LARGE, vec![cap_in_mib()]))
            } else {
                comparison(&bytes, &host.read_document_bytes(&doc)?)
            }
        } else {
            match String::from_utf8(bytes) {
                Ok(text) => UiNode::text(text),
                Err(error) => UiNode::text(Text::message(
                    BINARY_PREVIEW,
                    vec![Arg::int("size", error.as_bytes().len() as i64)],
                )),
            }
        };
        // I gesti stanno sopra il testo, dove li si trova senza scorrerlo. Il
        // ripristino è l'unico primario, e c'è solo per le versioni passate:
        // ripristinare l'attuale riscriverebbe il file con ciò che contiene.
        let mut actions = Vec::new();
        let asking = !current
            && host
                .view_state(CONFIRM_STATE)?
                .and_then(|v| v.as_u64())
                .is_some_and(|asked| asked == ts);
        if asking {
            // La domanda al posto del bottone, dove l'occhio già stava.
            actions.push(UiNode::text(Text::key(RESTORE_QUESTION)));
            actions.push(UiNode::button(
                Text::key(RESTORE_CONFIRM_LABEL),
                Intent::Danger,
                ActionRef::with(A_RESTORE_CONFIRM, payload.clone()),
            ));
            actions.push(UiNode::button(
                Text::key(RESTORE_CANCEL_LABEL),
                Intent::Neutral,
                ActionRef::new(A_RESTORE_CANCEL),
            ));
        } else if !current {
            actions.push(UiNode::button(
                Text::key(RESTORE_LABEL),
                Intent::Primary,
                ActionRef::with(A_RESTORE, payload.clone()),
            ));
        }
        actions.push(if comparing {
            UiNode::button(
                Text::key(SHOW_TEXT),
                Intent::Neutral,
                ActionRef::with(A_SHOW_TEXT, payload.clone()),
            )
        } else {
            UiNode::button(
                Text::key(COMPARE_LABEL),
                Intent::Neutral,
                ActionRef::with(A_COMPARE, payload.clone()),
            )
        });
        if text {
            actions.push(UiNode::button(
                Text::key(COPY_LABEL),
                Intent::Neutral,
                ActionRef::with(A_COPY, payload),
            ));
        }
        actions.push(UiNode::button(
            Text::key(CLOSE_PREVIEW),
            Intent::Neutral,
            ActionRef::new(A_CLOSE_PREVIEW),
        ));
        children.push(UiNode::keyed(
            format!("preview:{ts}"),
            UiKind::Section {
                title: Text::message(WHEN_TITLE, vec![Arg::timestamp(WHEN, ts)]),
                collapsed: false,
                // La nota di un testo conservato sta sopra i gesti: è la
                // ragione per cui questa versione c'è, e la prima cosa da
                // leggere prima di ripristinarla.
                children: note
                    .map(|note| UiNode::text(Text::message(KEPT_NOTE, vec![Arg::text(NOTE, note)])))
                    .into_iter()
                    .chain([UiNode::row(4, actions), body])
                    .collect(),
            },
        ));
    }
    Ok(UiNode::column(1, children))
}

//! I comandi strutturali sulle note: creare, duplicare, rinominare, pagine di
//! cartella e sottopagine, cestino, ripristino e annullamento.

use super::*;

// ---------------------------------------------------------------------------
// I comandi strutturali (decisione 0013)
// ---------------------------------------------------------------------------
//
// Sono sottili apposta: tutto ciò che fanno lo fanno chiedendolo all'host. La
// validazione dei path, il recinto del vault, la riscrittura dei backlink e il
// lotto stanno dietro le capacità, dove stavano già — la novità è che adesso ci
// si arriva **dal di fuori**, con la stessa firma che avrà un plugin.

pub(super) fn plan(summary: Text, docs: Vec<DocId>) -> CommandOutcome {
    let plan = docs
        .into_iter()
        .fold(CommandPlan::of_edits(summary, Vec::new()), |p, d| {
            p.with_doc(d)
        });
    CommandOutcome::done().with_effect(CommandEffect::Plan(plan))
}

/// The command parameter is text because ParamKind has no object variant.
/// Reject duplicate keys before JSON-to-map conversion and never interpolate
/// untrusted strings into YAML: the serializer quotes keys and scalar values.
fn initial_properties(raw: Option<&str>) -> Result<String, PluginError> {
    let Some(raw) = raw else {
        return Ok(String::new());
    };
    if raw.len() > 64 * 1024 {
        return Err(PluginError::BadArgs(
            "note.create: proprietà troppo grandi".into(),
        ));
    }
    struct UniqueProperties;
    impl<'de> serde::de::Visitor<'de> for UniqueProperties {
        type Value = serde_json::Map<String, serde_json::Value>;
        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("un oggetto JSON di proprietà")
        }
        fn visit_map<M: serde::de::MapAccess<'de>>(
            self,
            mut map: M,
        ) -> Result<Self::Value, M::Error> {
            let mut values = serde_json::Map::new();
            while let Some((key, value)) = map.next_entry::<String, serde_json::Value>()? {
                if key.trim().is_empty()
                    || key.trim() != key
                    || key.len() > 256
                    || key.contains('\n')
                    || key.contains('\r')
                {
                    return Err(serde::de::Error::custom("chiave proprietà non valida"));
                }
                if values.len() >= 128 {
                    return Err(serde::de::Error::custom("troppe proprietà"));
                }
                if values.insert(key, value).is_some() {
                    return Err(serde::de::Error::custom("chiave proprietà duplicata"));
                }
            }
            Ok(values)
        }
    }
    let mut deserializer = serde_json::Deserializer::from_str(raw);
    let values = serde::de::Deserializer::deserialize_map(&mut deserializer, UniqueProperties)
        .map_err(|e| PluginError::BadArgs(format!("note.create: proprietà JSON: {e}").into()))?;
    deserializer
        .end()
        .map_err(|e| PluginError::BadArgs(format!("note.create: proprietà JSON: {e}").into()))?;
    if values.is_empty() {
        return Ok(String::new());
    }
    let yaml = serde_yaml_ng::to_string(&values)
        .map_err(|e| PluginError::BadArgs(format!("note.create: proprietà YAML: {e}").into()))?;
    if yaml.len() > 64 * 1024 {
        return Err(PluginError::BadArgs(
            "note.create: frontmatter troppo grande".into(),
        ));
    }
    Ok(format!("---\n{yaml}---\n"))
}
pub(super) fn notes_create(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let requested = args.text("name").map(str::trim).filter(|n| !n.is_empty());
    let initial = initial_properties(args.text("properties"))?;
    let extension = crate::formats::new_note_extension(host)?;
    // «Nuova nota qui»: la cartella scelta vale al posto di quella configurata.
    let folder = args
        .text("folder")
        .map(fub_abi::rules::folders::normalized)
        .filter(|f| !f.is_empty());
    let placed = |name: &str| match &folder {
        Some(folder) if !name.contains('/') => format!("{folder}/{name}"),
        _ => name.to_string(),
    };
    let id = match requested {
        Some(name) => DocId::new(crate::formats::with_extension(
            host,
            &placed(name),
            &extension,
        )),
        // Il nome libero lo chiede all'host: la convenzione D3 è una sola, e
        // sta nel vault che è l'unico a sapere cosa è occupato.
        None => host.free_name(&DocId::new(placed(&format!(
            "{}.{extension}",
            untitled(host)
        )))),
    };
    // Le proprietà iniziali sono un frontmatter: davanti a un `.base` o a un
    // canvas corromperebbero il file che nasce.
    if !initial.is_empty() {
        crate::formats::require(host, &id, fub_abi::options::syntax::FRONTMATTER)?;
    }

    if mode.is_dry_run() {
        return Ok(plan(one(P_CREATE, A_DOC, id.as_str()), vec![id]));
    }

    // `create_document` e non `write_document`: se il path è occupato questo
    // comando deve fallire, non sovrascrivere una nota dell'utente.
    host.create_document(&id, &initial)?;
    let notify = one(D_CREATE, A_DOC, id.as_str());
    // L'inverso di «crea» è «cestina», ed è un comando che sta in questo stesso
    // registro: l'annullamento non ha bisogno di un verbo suo (§13.3). Che sia
    // il **cestino** e non una cancellazione definitiva non è prudenza — è che
    // l'inverso di un gesto reversibile deve restare reversibile, o annullare
    // sarebbe più distruttivo di ciò che annulla.
    let undo = Undo::by_command(
        one(U_CREATE, A_DOC, id.as_str()),
        NOTES_TRASH,
        serde_json::json!({ "doc": id.as_str() }),
    );
    Ok(CommandOutcome::notify(notify)
        .undoable(undo)
        .with_effect(CommandEffect::Navigate { doc: id }))
}

/// Il nome della copia: «Nota.md» diventa «Nota copia.md», e se c'è già
/// l'host sceglie il primo libero.
fn duplicate_name(doc: &DocId) -> String {
    let id = doc.as_str();
    let (stem, ext) = match id.rfind('.') {
        Some(dot) if dot > id.rfind('/').map_or(0, |s| s + 1) => id.split_at(dot),
        _ => (id, ""),
    };
    format!("{stem} copia{ext}")
}

pub(super) fn notes_duplicate(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = args
        .document("doc")
        .expect("l'host ha convalidato un parametro obbligatorio");
    // «Incolla» nell'esplora risorse: la copia va in un'altra cartella e lì
    // tiene il suo nome; nella stessa cartella diventa «Nota copia».
    let folder = args.text("folder").map(fub_abi::rules::folders::normalized);
    let wanted = match folder {
        Some(folder) if folder != fub_abi::query::folder_of(&doc) => {
            let id = doc.as_str();
            let name = &id[id.rfind('/').map_or(0, |s| s + 1)..];
            if folder.is_empty() {
                name.to_string()
            } else {
                format!("{folder}/{name}")
            }
        }
        _ => duplicate_name(&doc),
    };
    let id = host.free_name(&DocId::new(wanted));
    if mode.is_dry_run() {
        return Ok(plan(one(P_CREATE, A_DOC, id.as_str()), vec![id]));
    }
    // I byte e non il testo: un'immagine o un PDF si duplicano come una nota.
    // `None` come base = crea soltanto se non esiste, mai sovrascrivere.
    let bytes = host.read_document_bytes(&doc)?;
    host.write_document_bytes(&id, &bytes, None)?;
    let undo = Undo::by_command(
        one(U_CREATE, A_DOC, id.as_str()),
        NOTES_TRASH,
        serde_json::json!({ "doc": id.as_str() }),
    );
    Ok(CommandOutcome::notify(one(D_CREATE, A_DOC, id.as_str()))
        .undoable(undo)
        .with_effect(CommandEffect::Navigate { doc: id }))
}

pub(super) fn notes_rename(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = args
        .document("doc")
        .expect("l'host ha convalidato un parametro obbligatorio");
    let to = args
        .text("to")
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_EMPTY_TO)))?;
    // Un nome senza estensione eredita quella del documento: rinominare un
    // canvas in «Lavagna» non lo fa diventare una nota Markdown.
    let to = DocId::new(crate::formats::keeping_extension(host, &doc, to));

    if mode.is_dry_run() {
        // L'insieme impattato di una rinomina non è «la nota»: sono anche tutte
        // quelle che la nominano, perché è lì che il kernel riscriverà i
        // wikilink. Il piano è ciò che l'utente approva, e approvare «rinomina
        // una nota» quando le note toccate sono quaranta è un consenso
        // strappato — quindi i backlink si chiedono all'indice.
        let mut docs = vec![doc.clone(), to.clone()];
        if let IndexResult::Backlinks(sources) = host.query_index(IndexQuery::Backlinks {
            target: doc.clone(),
            page: None,
        })? {
            for BacklinkRef { source, .. } in sources.items {
                if !docs.contains(&source) {
                    docs.push(source);
                }
            }
        }
        return Ok(plan(two(P_RENAME, doc.as_str(), to.as_str()), docs));
    }

    host.rename_document(&doc, &to)?;
    // L'inverso di una rinomina è **la rinomina all'incontrario**, e con essa
    // torna indietro gratis anche tutto ciò che la rinomina si era portata
    // dietro: i wikilink riscritti nelle sorgenti, l'organizzazione, lo stato
    // per-documento. È l'argomento per cui `UndoStep::Command` esiste — un
    // linguaggio di operazioni inverse avrebbe dovuto rifare quel lavoro, e
    // rifarlo *uguale*.
    //
    // L'etichetta e gli argomenti vanno in **verso opposto**, ed è la sola riga
    // di questa funzione in cui vale la pena guardarci due volte: gli argomenti
    // sono l'operazione da fare (`to` → `doc`, la rinomina all'incontrario),
    // l'etichetta è l'operazione da **disfare** (`doc` → `to`, quella appena
    // fatta). Scriverle nello stesso verso è il refuso naturale qui, e produce
    // un «Annullato: la rinomina di «Nuova.md» in «Vecchia.md»» che nomina il
    // rimedio invece del male — come tutte le altre `undo.*`, questa nomina ciò
    // che è successo.
    let undo = Undo::by_command(
        two(U_RENAME, doc.as_str(), to.as_str()),
        NOTES_RENAME,
        serde_json::json!({ "doc": to.as_str(), "to": doc.as_str() }),
    );
    // Nessun `Navigate`: chi guardava quella nota la segue attraverso
    // `document-renamed`, e chi ne guardava un'altra non deve essere spostato.
    Ok(CommandOutcome::notify(two(D_RENAME, doc.as_str(), to.as_str())).undoable(undo))
}

/// `note.folder_page`: la nota diventa `X/_index.<ext>` con la rinomina di
/// `note.rename`, che si porta dietro i link, il piano del dry-run e
/// l'annullamento. Rifiuta se la cartella ha già una pagina, con qualunque
/// estensione: due pagine per una cartella non si scelgono, e una che c'è non
/// si sovrascrive.
pub(super) fn notes_folder_page(
    args: Args<'_>,
    _mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = args
        .document("doc")
        .or_else(|| host.active_context().and_then(|c| c.doc))
        .ok_or_else(|| PluginError::BadArgs(Text::key(AND_NO_NOTES_GIVEN)))?;
    if doc.is_folder_page() {
        return Err(PluginError::BadArgs(one(
            E_PAGE_ALREADY,
            A_DOC,
            doc.as_str(),
        )));
    }
    let Some((folder, base)) = doc.as_str().rsplit_once('/') else {
        return Err(PluginError::BadArgs(one(
            E_PAGE_AT_ROOT,
            A_DOC,
            doc.as_str(),
        )));
    };
    let extension = base
        .rsplit_once('.')
        .filter(|(stem, _)| !stem.is_empty())
        .map(|(_, ext)| ext);
    let to = match extension {
        Some(ext) => format!("{folder}/{FOLDER_PAGE_STEM}.{ext}"),
        None => format!("{folder}/{FOLDER_PAGE_STEM}"),
    };
    if let Some(page) = folder_page_in(host, folder)? {
        return Err(PluginError::AlreadyExists(page.to_string().into()));
    }
    // La rinomina vera, annidata: il modo (dry-run o no) lo propaga l'host.
    host.run_command(
        NOTES_RENAME,
        serde_json::json!({ "doc": doc.as_str(), "to": to }),
    )
}

/// La pagina della cartella `folder`, se c'è, con qualunque estensione.
fn folder_page_in(host: &mut dyn HostApi, folder: &str) -> Result<Option<DocId>, PluginError> {
    let entries = match host.query_index(IndexQuery::Entries {
        of_kind: None,
        within: Some(FolderScope {
            path: folder.to_string(),
            descendants: false,
        }),
        page: None,
    })? {
        IndexResult::Entries(entries) => entries,
        other => return Err(off_topic("voci", &other)),
    };
    Ok(entries
        .items
        .into_iter()
        .map(|e| e.id)
        .find(DocId::is_folder_page))
}

/// `note.subpage`: «Nuova sottopagina» su `Viaggio.md`. Se la nota non è
/// ancora la pagina di una cartella la sposta in `Viaggio/_index.md` con la
/// rinomina di `note.rename` (`[[Viaggio]]` continua a trovarla, perché il
/// nome della pagina è quello della cartella), poi crea `Viaggio/Nome.md`.
/// Il link nel testo lo scrive chi ha il buffer. Non sovrascrive niente: una
/// pagina che la cartella ha già, o una nota col nome chiesto, fermano tutto
/// prima del primo passo; e se la creazione fallisce dopo lo spostamento, la
/// pagina torna dov'era.
pub(super) fn notes_subpage(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = args
        .document("doc")
        .or_else(|| host.active_context().and_then(|c| c.doc))
        .ok_or_else(|| PluginError::BadArgs(Text::key(AND_NO_NOTES_GIVEN)))?;
    let name = args
        .text("name")
        .map(str::trim)
        .filter(|n| !n.is_empty() && !n.contains('/'))
        .ok_or_else(|| PluginError::BadArgs(Text::key(E_SUBPAGE_NAME)))?;
    let extension = match crate::formats::extension_of(&doc) {
        Some(ext) => ext.to_string(),
        None => crate::formats::new_note_extension(host)?,
    };
    // La cartella della pagina, e dove andrebbe la pagina se non ci sta già.
    let (folder, moved) = if doc.is_folder_page() {
        let folder = doc.as_str().rsplit_once('/').map_or("", |(f, _)| f);
        (folder.to_string(), None)
    } else {
        let id = doc.as_str();
        let stem = match id.rsplit_once('.') {
            Some((stem, _)) if stem.len() > id.rfind('/').map_or(0, |s| s + 1) => stem,
            _ => id,
        };
        let page = DocId::new(format!("{stem}/{FOLDER_PAGE_STEM}.{extension}"));
        (stem.to_string(), Some(page))
    };
    let child = DocId::new(crate::formats::with_extension(
        host,
        &format!("{folder}/{name}"),
        &extension,
    ));
    if moved.is_some() {
        if let Some(page) = folder_page_in(host, &folder)? {
            return Err(PluginError::AlreadyExists(page.to_string().into()));
        }
    }
    // Il vault sa che cosa è occupato, anche per una differenza di maiuscole.
    if host.free_name(&child) != child {
        return Err(PluginError::AlreadyExists(child.to_string().into()));
    }

    if mode.is_dry_run() {
        let mut docs = vec![doc.clone()];
        docs.extend(moved.iter().cloned());
        docs.push(child.clone());
        return Ok(plan(one(P_CREATE, A_DOC, child.as_str()), docs));
    }

    if let Some(page) = &moved {
        host.run_command(
            NOTES_RENAME,
            serde_json::json!({ "doc": doc.as_str(), "to": page.as_str() }),
        )?;
    }
    if let Err(error) = host.create_document(&child, "") {
        // Il passo fallito non lascia la pagina a metà strada: torna dov'era,
        // con i link. Se anche il ritorno fallisce, l'errore che conta resta
        // quello della creazione.
        if let Some(page) = &moved {
            let _ = host.run_command(
                NOTES_RENAME,
                serde_json::json!({ "doc": page.as_str(), "to": doc.as_str() }),
            );
        }
        return Err(error);
    }
    // Si annulla all'incontrario: prima la sottopagina nel cestino, poi la
    // pagina al suo posto di prima.
    let mut steps = vec![UndoStep::Command {
        command: NOTES_TRASH.to_string(),
        args: serde_json::json!({ "doc": child.as_str() }),
    }];
    if let Some(page) = &moved {
        steps.push(UndoStep::Command {
            command: NOTES_RENAME.to_string(),
            args: serde_json::json!({ "doc": page.as_str(), "to": doc.as_str() }),
        });
    }
    let undo = Undo {
        label: one(U_CREATE, A_DOC, child.as_str()),
        steps,
    };
    Ok(CommandOutcome::notify(one(D_CREATE, A_DOC, child.as_str())).undoable(undo))
}

pub(super) fn notes_trash(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let doc = args
        .document("doc")
        .or_else(|| host.active_context().and_then(|c| c.doc))
        .ok_or_else(|| PluginError::BadArgs(Text::key(AND_NO_NOTES_GIVEN)))?;

    if mode.is_dry_run() {
        return Ok(plan(one(P_TRASH, A_DOC, doc.as_str()), vec![doc]));
    }

    let trashed = host.trash_document(&doc)?;
    // L'inverso è il ripristino, **con il path d'origine dichiarato**: senza
    // `to`, un ripristino torna al nome originale, e se nel frattempo qualcuno
    // ha occupato quel path fallisce. Dirlo esplicitamente non cambia il caso
    // normale e rende leggibile ciò che l'annullamento promette.
    let undo = Undo::by_command(
        one(U_TRASH, A_DOC, doc.as_str()),
        TRASH_RESTORE,
        serde_json::json!({ "entry": trashed.as_str(), "to": doc.as_str() }),
    );
    Ok(CommandOutcome::notify(one(D_TRASH, A_DOC, doc.as_str())).undoable(undo))
}

pub(super) fn trash_restore(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let entry = args
        .document("entry")
        .expect("l'host ha convalidato un parametro obbligatorio");
    let to = args
        .text("to")
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(|t| DocId::new(crate::formats::keeping_extension(host, &entry, t)));

    if mode.is_dry_run() {
        // Dove tornerebbe lo sa il cestino, non chi invoca: si legge, così il
        // piano nomina il documento vero anche quando `to` non c'è.
        let entry = host
            .list_trash()?
            .into_iter()
            .find(|and| and.id == entry)
            .ok_or_else(|| PluginError::BadArgs(one(AND_NOT_IN_TRASH, A_ENTRY, entry.as_str())))?;
        let target = to.unwrap_or(entry.original);
        let summary = Text::message(
            P_RESTORE,
            vec![
                Arg::text(A_ENTRY, entry.id.as_str()),
                Arg::text(A_DOC, target.as_str()),
            ],
        );
        return Ok(plan(summary, vec![target]));
    }

    let target = host.restore_document(&entry, to)?;
    let notify = one(D_RESTORE, A_DOC, target.as_str());
    // E l'inverso del ripristino è di nuovo il cestino: le due voci si
    // rimandano l'una all'altra, che è ciò che rende annullabile anche
    // l'annullamento — se non fosse per la bandiera che dice che un
    // annullamento non entra in pila, sarebbe un ciclo.
    let undo = Undo::by_command(
        one(U_RESTORE, A_DOC, target.as_str()),
        NOTES_TRASH,
        serde_json::json!({ "doc": target.as_str() }),
    );
    Ok(CommandOutcome::notify(notify)
        .undoable(undo)
        .with_effect(CommandEffect::Navigate { doc: target }))
}

/// Annulla l'ultima operazione annullabile (§13.3).
///
/// Il comando è **sottile come gli strutturali**, e per la stessa ragione: tutto
/// ciò che fa lo chiede all'host. Che esista comunque, invece di lasciare la
/// capacità nuda, è ciò che gli dà un posto nella palette, una scorciatoia e una
/// descrizione per un umano — le tre cose che la decisione 0009 dà gratis a
/// qualunque comando e a nessuna capacità.
///
/// In simulazione non prova ad annullare e non guarda nemmeno la pila: un piano
/// onesto direbbe *quali* documenti tornerebbero indietro, e per saperlo
/// bisognerebbe togliere la voce dalla pila — cioè fare metà dell'operazione per
/// raccontarla. Dice quindi la sola cosa vera che può dire senza toccare niente.
pub(super) fn vault_undo(
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    if mode.is_dry_run() {
        return Ok(plan(Text::key(P_UNDO), Vec::new()));
    }
    let Some(done) = host.undo_last()? else {
        // Niente da annullare non è un errore: è la risposta normale a un vault
        // appena aperto, e chi la riceve ha una frase da mostrare.
        return Ok(CommandOutcome::notify(Text::key(D_NOTHING_TO_UNDO)));
    };
    let what = Arg::text(A_WHAT, done.label.as_literal().unwrap_or_default());

    // I due conti dicono cose diverse e **si scelgono in quest'ordine** (§23.14):
    // se l'annullamento si è fermato, quella è la notizia di adesso e va detta
    // per prima; se invece è andato per intero, resta da dire che l'operazione
    // che ha disfatto era già a metà per conto suo. Dirle tutte e due in una
    // riga sola vorrebbe dire quattro numeri in una notifica, che è il modo di
    // non farne leggere nessuno.
    //
    // Il `partial` dell'esito porta **sempre** quello dell'annullamento, anche
    // quando la frase parla dell'operazione: è ciò che è successo adesso, ed è
    // l'unico dei due su cui chi automatizza può fare qualcosa.
    let message = match (&done.replay, &done.operation) {
        (Some(replay), _) => Text::message(
            D_UNDONE_PARTIAL,
            vec![
                what,
                Arg::int(A_DONE, replay.done as i64),
                Arg::int(A_ATTEMPTED, replay.attempted as i64),
                Arg::text(A_FAILED, why(&replay.failures)),
            ],
        ),
        (None, Some(operation)) => Text::message(
            D_UNDONE_OF_PARTIAL,
            vec![
                what,
                Arg::int(A_DONE, operation.done as i64),
                Arg::int(A_ATTEMPTED, operation.attempted as i64),
            ],
        ),
        (None, None) => Text::message(D_UNDONE, vec![what]),
    };
    Ok(CommandOutcome::notify(message).partially(done.replay))
}

/// Una chiave di impostazione che non è passata, col perché **e la sua specie**.
///
/// Il soggetto non è un documento — è una chiave — quindi va dentro la frase e
/// non nel [`Failure::subject`], che esiste perché chi disegna ci attacchi un
/// link e un link vuole un `DocId`. Ciò che si guadagna rispetto al
/// `format!("`{key}` ({e})")` di prima è la **variante**: un
/// [`PermissionDenied`](PluginError::PermissionDenied) resta un permesso negato
/// invece di appiattirsi in una stringa, e chi mostra l'esito può dire
/// «l'amministratore l'ha bloccata» invece di «qualcosa è andato storto».
pub(super) fn skipped_key(key: &str, mut and: PluginError) -> Failure {
    let within = and.message().to_string();
    *and.message_mut() = format!("`{key}` ({within})").into();
    Failure::other(and)
}

/// I perché dei guasti, in una riga: `«nota.md» (il documento è cambiato…)`.
///
/// Restano in italiano come le ragioni dell'import delle impostazioni, e per la
/// stessa ragione scritta lì: metà di queste frasi vengono dal kernel, che
/// scrive italiano cablato, e tradurre l'altra metà lascerebbe un messaggio
/// mezzo in una lingua e mezzo nell'altra. Ciò che *è* traducibile viaggia
/// intanto come dato, in [`CommandOutcome::partial`], dove chi disegna lo trova
/// intero.
pub(super) fn why(failures: &[Failure]) -> String {
    failures
        .iter()
        .map(|g| match &g.subject {
            Some(doc) => format!("«{doc}» ({})", g.error),
            None => g.error.to_string(),
        })
        .collect::<Vec<_>>()
        .join("; ")
}

pub(super) fn trash_empty(
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    if mode.is_dry_run() {
        let entries = host.list_trash()?;
        return Ok(plan(
            count_text(P_EMPTY_TRASH, entries.len()),
            entries.into_iter().map(|and| and.id).collect(),
        ));
    }

    let count = host.empty_trash()?;
    Ok(CommandOutcome::notify(count_text(
        D_EMPTY_TRASH,
        count as usize,
    )))
}

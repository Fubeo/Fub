//! `folder.rename` e `folder.trash`: una cartella intera, una voce alla volta.

use super::*;

// ---------------------------------------------------------------------------
// folder.rename / folder.trash — una cartella intera, una voce alla volta
// ---------------------------------------------------------------------------

/// Una cartella detta da chi invoca, senza spazi e senza gli slash di
/// cortesia ([`folders`](fub_abi::rules::folders)). La radice non è una
/// cartella che si sposta o si cestina.
fn folder_arg(args: &Args<'_>, name: &str) -> Result<String, PluginError> {
    let folder = args
        .text(name)
        .map(|f| fub_abi::rules::folders::normalized(f.trim()).trim())
        .unwrap_or_default();
    if folder.is_empty() {
        return Err(PluginError::BadArgs(Text::key(E_EMPTY_FOLDER)));
    }
    Ok(folder.to_string())
}

/// Ciò che una cartella contiene secondo il vault: le voci a ogni profondità e
/// le sottocartelle, entrambe in ordine. `None` se la cartella non c'è.
struct FolderTree {
    entries: Vec<DocId>,
    folders: Vec<String>,
}

fn folder_tree(host: &dyn HostApi, folder: &str) -> Result<Option<FolderTree>, PluginError> {
    let parent = folder.rsplit_once('/').map_or("", |(parent, _)| parent);
    let siblings = match host.query_index(IndexQuery::Folders {
        under: Some(FolderScope::direct(parent)),
        page: None,
    })? {
        IndexResult::Folders(siblings) => siblings,
        other => return Err(off_topic("cartelle", &other)),
    };
    if !siblings.items.iter().any(|f| f.path == folder) {
        return Ok(None);
    }
    let within = FolderScope {
        path: folder.to_string(),
        descendants: true,
    };
    let entries = match host.query_index(IndexQuery::Entries {
        of_kind: None,
        within: Some(within.clone()),
        page: None,
    })? {
        IndexResult::Entries(entries) => entries,
        other => return Err(off_topic("voci", &other)),
    };
    let folders = match host.query_index(IndexQuery::Folders {
        under: Some(within),
        page: None,
    })? {
        IndexResult::Folders(folders) => folders,
        other => return Err(off_topic("cartelle", &other)),
    };
    Ok(Some(FolderTree {
        entries: entries.items.into_iter().map(|e| e.id).collect(),
        folders: folders.items.into_iter().map(|f| f.path).collect(),
    }))
}

/// Lo stesso path, portato da sotto `from` a sotto `to`.
fn rebased(path: &str, from: &str, to: &str) -> String {
    format!("{to}{}", &path[from.len()..])
}

/// Toglie dal disco le cartelle date, le figlie prima delle madri, e dice
/// quali sono rimaste perché contengono ancora qualcosa — un file nascosto o
/// escluso dal vault, che non si cancella per far posto a una rinomina.
fn remove_folders(host: &mut dyn HostApi, mut folders: Vec<String>) -> Vec<String> {
    // Una discendente è sempre più lunga della sua antenata, quindi l'ordine
    // lessicale al contrario la mette prima.
    folders.sort();
    folders.dedup();
    let mut kept = Vec::new();
    for folder in folders.into_iter().rev() {
        match host.remove_empty_folder(&folder) {
            Ok(()) | Err(PluginError::NotFound(_)) => {}
            Err(_) => kept.push(folder),
        }
    }
    kept.reverse();
    kept
}

/// Un nome di cartella libero accanto a `to`, per la tappa intermedia di una
/// rinomina che cambia solo le maiuscole: su un disco che non le distingue,
/// `Foo` → `foo` direttamente sarebbe spostare ogni voce dove già sta.
fn free_hop(host: &dyn HostApi, to: &str) -> Result<String, PluginError> {
    for n in 1.. {
        let hop = format!("{to}.~{n}");
        if folder_tree(host, &hop)?.is_none()
            && archive_revision(host, &DocId::new(&*hop))?.is_none()
        {
            return Ok(hop);
        }
    }
    unreachable!("la sequenza dei candidati è infinita")
}

/// L'esito di uno spostamento di cartella andato in porto.
struct FolderMove {
    count: usize,
    /// Voci spostate i cui link entranti non si sono riscritti tutti.
    warnings: Vec<Failure>,
    /// Cartelle d'origine rimaste perché non erano vuote sul disco.
    kept: Vec<String>,
}

/// Sposta l'albero di `from` sotto `to`, **tutto o niente**: se una voce non
/// si sposta, quelle già spostate tornano dov'erano prima che l'errore risalga.
/// Solo se anche il ritorno fallisce lo stato resta a metà, e l'errore elenca
/// cosa è rimasto dove.
fn move_folder(
    host: &mut dyn HostApi,
    from: &str,
    to: &str,
    tree: &FolderTree,
) -> Result<FolderMove, PluginError> {
    // Prima le cartelle: la destinazione e le sottocartelle, comprese quelle
    // vuote che nessuna voce porterebbe con sé. Crearle per prime è anche ciò
    // che giudica il nome nuovo (riservato, escluso dal vault) prima che una
    // sola voce si muova. Una che c'è già si riusa: la destinazione è libera o
    // fatta solo di cartelle senza voci, quindi non si mescola niente.
    let mut created = Vec::new();
    let mut wanted = vec![to.to_string()];
    wanted.extend(tree.folders.iter().map(|f| rebased(f, from, to)));
    for folder in wanted {
        match host.create_folder(&folder) {
            Ok(()) => created.push(folder),
            Err(PluginError::AlreadyExists(_)) => {}
            Err(error) => {
                remove_folders(host, created);
                return Err(error);
            }
        }
    }

    // Poi ciò che il vault tiene per path di cartella (icona, spazio, ordine dei
    // figli), che le voci spostate una per una non porterebbero: la prima nota
    // che lascia la cartella toglierebbe il suo nome dall'ordine scelto a mano.
    let carried = match host.migrate_folder_organization(from, to) {
        Ok(()) => true,
        Err(PluginError::Unserved(_)) => false,
        Err(error) => {
            remove_folders(host, created);
            return Err(error);
        }
    };

    let mut moved: Vec<(DocId, DocId)> = Vec::new();
    let mut warnings = Vec::new();
    for doc in &tree.entries {
        let target = DocId::new(rebased(doc.as_str(), from, to));
        let Err(error) = host.rename_document(doc, &target) else {
            moved.push((doc.clone(), target));
            continue;
        };
        // La rinomina può riuscire e la riscrittura dei link no: la voce è
        // al posto nuovo, e tornare indietro adesso vorrebbe dire rifare la
        // stessa riscrittura che è appena fallita. Si va avanti e lo si dice.
        if archive_revision(host, doc)?.is_none() && archive_revision(host, &target)?.is_some() {
            warnings.push(Failure::of(doc.clone(), error));
            moved.push((doc.clone(), target));
            continue;
        }
        let mut stuck = Vec::new();
        for (back, there) in moved.iter().rev() {
            if let Err(failure) = host.rename_document(there, back) {
                stuck.push(format!("«{there}» ({failure})"));
            }
        }
        if stuck.is_empty() {
            if carried {
                let _ = host.migrate_folder_organization(to, from);
            }
            remove_folders(host, created);
            return Err(error);
        }
        return Err(PluginError::Conflict(Text::message(
            E_FOLDER_ROLLBACK,
            vec![
                Arg::text(A_FOLDER, from),
                Arg::text(A_REASON, error.to_string()),
                Arg::text(A_FAILED, stuck.join("; ")),
            ],
        )));
    }

    let mut origin = vec![from.to_string()];
    origin.extend(tree.folders.iter().cloned());
    Ok(FolderMove {
        count: moved.len(),
        warnings,
        kept: remove_folders(host, origin),
    })
}

/// I perché da mostrare dopo uno spostamento o un cestinamento riuscito: i
/// link rimasti vecchi e le cartelle rimaste piene.
fn folder_leftovers(warnings: &[Failure], kept: &[String]) -> String {
    let mut parts = Vec::new();
    if !warnings.is_empty() {
        parts.push(why(warnings));
    }
    parts.extend(
        kept.iter().map(|folder| {
            format!("«{folder}» (contiene file che il vault non mostra, ed è rimasta)")
        }),
    );
    parts.join("; ")
}

fn folder_text(
    key: &str,
    folder: &str,
    to: Option<&str>,
    count: usize,
    failed: Option<String>,
) -> Text {
    let mut args = vec![Arg::text(A_FOLDER, folder), Arg::int(A_COUNT, count as i64)];
    if let Some(to) = to {
        args.push(Arg::text(A_TO, to));
    }
    if let Some(failed) = failed {
        args.push(Arg::text(A_FAILED, failed));
    }
    Text::message(key, args)
}

/// Rinomina o sposta una cartella: ogni voce passa dalla rinomina di una nota
/// sola, quindi i link che la nominano si riscrivono e lo stato per-documento
/// la segue. `to` è il path intero della cartella nuova, così rinominare
/// (`Progetti` → `Lavori`) e spostare (`Progetti` → `Archivio/Progetti`) sono
/// lo stesso gesto.
///
/// La destinazione deve essere libera, o fatta soltanto di cartelle senza voci:
/// due cartelle con dentro dei file non si fondono in silenzio. L'inverso è la
/// rinomina all'incontrario, ed è per questo che l'annullamento passa anche
/// quando all'origine è rimasta una cartella che conteneva file nascosti.
pub(super) fn folder_rename(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let folder = folder_arg(&args, "folder")?;
    let to = folder_arg(&args, "to")?;
    if to == folder {
        return Ok(CommandOutcome::done());
    }
    if to.starts_with(&format!("{folder}/")) {
        return Err(PluginError::BadArgs(Text::message(
            E_FOLDER_INTO_ITSELF,
            vec![Arg::text(A_FOLDER, &*folder), Arg::text(A_TO, &*to)],
        )));
    }
    let tree =
        folder_tree(host, &folder)?.ok_or_else(|| PluginError::NotFound(folder.clone().into()))?;
    // Lo stesso nome per la risoluzione: su un disco che non distingue il caso
    // è la stessa cartella, e si passa da una tappa intermedia.
    let only_case =
        fub_abi::rules::path::resolution_key(&to) == fub_abi::rules::path::resolution_key(&folder);
    if !only_case {
        let taken = match folder_tree(host, &to)? {
            Some(there) => !there.entries.is_empty(),
            // Non una cartella: forse un file con quel nome.
            None => archive_revision(host, &DocId::new(&*to))?.is_some(),
        };
        if taken {
            return Err(PluginError::AlreadyExists(to.into()));
        }
    }

    if mode.is_dry_run() {
        let mut docs: Vec<DocId> = Vec::new();
        let mut seen: HashSet<DocId> = HashSet::new();
        let mut edits: Vec<PlannedEdit> = Vec::new();
        for doc in &tree.entries {
            let target = rebased(doc.as_str(), &folder, &to);
            let args = serde_json::json!({ "doc": doc.as_str(), "to": target });
            let CommandOutcome {
                effect: CommandEffect::Plan(nested),
                ..
            } = host.run_command(NOTES_RENAME, args)?
            else {
                continue;
            };
            for d in nested.docs {
                if seen.insert(d.clone()) {
                    docs.push(d);
                }
            }
            edits.extend(nested.edits);
        }
        let summary = folder_text(
            P_FOLDER_RENAME,
            &folder,
            Some(&to),
            tree.entries.len(),
            None,
        );
        let plan = docs
            .into_iter()
            .fold(CommandPlan::of_edits(summary, edits), CommandPlan::with_doc);
        return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(plan)));
    }

    let done = if only_case {
        let hop = free_hop(host, &to)?;
        let first = move_folder(host, &folder, &hop, &tree)?;
        let hopped =
            folder_tree(host, &hop)?.ok_or_else(|| PluginError::NotFound(hop.clone().into()))?;
        let mut second = move_folder(host, &hop, &to, &hopped)?;
        second.warnings.extend(first.warnings);
        second.kept.extend(first.kept);
        second
    } else {
        move_folder(host, &folder, &to, &tree)?
    };

    let leftovers = folder_leftovers(&done.warnings, &done.kept);
    let notify = if leftovers.is_empty() {
        folder_text(D_FOLDER_RENAME, &folder, Some(&to), done.count, None)
    } else {
        folder_text(
            D_FOLDER_RENAME_PARTIAL,
            &folder,
            Some(&to),
            done.count,
            Some(leftovers),
        )
    };
    let undo = Undo::by_command(
        folder_text(U_FOLDER_RENAME, &folder, Some(&to), done.count, None),
        FOLDER_RENAME,
        serde_json::json!({ "folder": to, "to": folder }),
    );
    Ok(CommandOutcome::notify(notify)
        .undoable(undo)
        .with_effect(CommandEffect::Custom {
            ns: "fub.folder.moved".into(),
            payload: serde_json::json!({ "from": folder, "to": to }),
        }))
}

/// Manda nel cestino una cartella: ogni voce col cestino di una nota sola, poi
/// le cartelle rimaste vuote. Tutto o niente come lo spostamento: se una voce
/// non parte, quelle già cestinate tornano al loro posto.
///
/// L'annullamento ripristina ogni voce al suo path, e con le voci tornano le
/// cartelle che le contengono. Una sottocartella che era **vuota** non ha una
/// voce che la riporti, e resta fuori: non c'era niente dentro da perdere.
pub(super) fn folder_trash(
    args: Args<'_>,
    mode: InvokeMode,
    host: &mut dyn HostApi,
) -> Result<CommandOutcome, PluginError> {
    let folder = folder_arg(&args, "folder")?;
    let tree =
        folder_tree(host, &folder)?.ok_or_else(|| PluginError::NotFound(folder.clone().into()))?;
    if mode.is_dry_run() {
        let summary = folder_text(P_FOLDER_TRASH, &folder, None, tree.entries.len(), None);
        return Ok(plan(summary, tree.entries));
    }

    let mut trashed: Vec<(DocId, DocId)> = Vec::new();
    for doc in &tree.entries {
        match host.trash_document(doc) {
            Ok(entry) => trashed.push((entry, doc.clone())),
            Err(error) => {
                let mut stuck = Vec::new();
                for (entry, original) in trashed.iter().rev() {
                    if let Err(failure) = host.restore_document(entry, Some(original.clone())) {
                        stuck.push(format!("«{original}» ({failure})"));
                    }
                }
                if stuck.is_empty() {
                    return Err(error);
                }
                return Err(PluginError::Conflict(Text::message(
                    E_FOLDER_ROLLBACK,
                    vec![
                        Arg::text(A_FOLDER, &*folder),
                        Arg::text(A_REASON, error.to_string()),
                        Arg::text(A_FAILED, stuck.join("; ")),
                    ],
                )));
            }
        }
    }
    let mut origin = vec![folder.clone()];
    origin.extend(tree.folders.iter().cloned());
    let kept = remove_folders(host, origin);

    let count = trashed.len();
    let notify = if kept.is_empty() {
        folder_text(D_FOLDER_TRASH, &folder, None, count, None)
    } else {
        folder_text(
            D_FOLDER_TRASH_PARTIAL,
            &folder,
            None,
            count,
            Some(folder_leftovers(&[], &kept)),
        )
    };
    let steps = trashed
        .into_iter()
        .map(|(entry, original)| UndoStep::Command {
            command: TRASH_RESTORE.into(),
            args: serde_json::json!({ "entry": entry.as_str(), "to": original.as_str() }),
        })
        .collect();
    Ok(CommandOutcome::notify(notify)
        .undoable(Undo {
            label: folder_text(U_FOLDER_TRASH, &folder, None, count, None),
            steps,
        })
        .with_effect(CommandEffect::Custom {
            ns: "fub.folder.trashed".into(),
            payload: serde_json::json!({ "folder": folder }),
        }))
}

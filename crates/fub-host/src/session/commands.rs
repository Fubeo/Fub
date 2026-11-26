//! Viste, comandi e comandi di montaggio e fotografia.

use super::*;

impl Host {
    pub fn views(&self, vault: Option<&str>) -> Result<Vec<ViewSpec>, PluginError> {
        self.read_workspace(vault, |workspace| Ok(workspace.views()))
    }

    pub fn render_view(
        &self,
        vault: Option<&str>,
        instance: &ViewInstance,
    ) -> Result<UiNode, PluginError> {
        let workspace = self.with_session(vault, |session| session.workspace.clone())?;
        let prepared = {
            let ws = workspace.read()?;
            ws.prepare_view_render(instance)?
        };
        let detached = JobHost::new(workspace.clone(), prepared.owner().to_string())
            .for_view_instance(prepared.instance_id().to_string());
        let outcome = prepared.invoke(&detached);
        let ws = workspace.read()?;
        ws.finish_view_render(prepared, outcome)
    }

    pub fn view_action(
        &self,
        vault: Option<&str>,
        instance: &ViewInstance,
        action: UiAction,
    ) -> Result<ViewUpdate, PluginError> {
        let workspace = self.with_session(vault, |session| session.workspace.clone())?;
        let _turn = workspace.write_turn();
        let mut prepared = {
            let mut ws = workspace.write()?;
            ws.prepare_view_action(instance, action)?
        };
        let mut detached = JobHost::new(workspace.clone(), prepared.owner().to_string())
            .for_view_instance(prepared.instance_id().to_string());
        let outcome = prepared.invoke(&mut detached);
        let deferred = {
            let mut ws = workspace.write()?;
            ws.finish_view_action_deferred(prepared, outcome)
        };
        finish_events(&workspace, deferred)?
    }

    pub fn commands(&self, vault: Option<&str>) -> Result<Vec<CommandSpec>, PluginError> {
        self.read_workspace(vault, |workspace| {
            let mut specs = workspace.commands();
            let mounts = mount_specs();
            specs.retain(|spec| {
                spec.id != OS_TRASH_COMMAND
                    && spec.id != FOLDER_CREATE
                    && spec.id != crate::capture::CAPTURE_APPLY
                    && spec.id != crate::web_clip::WEB_CLIP
                    && spec.id != crate::export_folder::EXPORT_FOLDER
                    && spec.id != crate::obsidian_import::OBSIDIAN_IMPORT
                    && !crate::connector_tokens::specs()
                        .iter()
                        .any(|own| own.id == spec.id)
                    && !crate::uri_inbox::specs()
                        .iter()
                        .any(|own| own.id == spec.id)
                    && !mounts.iter().any(|own| own.id == spec.id)
            });
            specs.retain(|spec| spec.id != SNAPSHOT_CREATE && spec.id != SNAPSHOT_APPLY);
            let mut own = vec![
                os_trash_spec(),
                folder_create_spec(),
                crate::capture::spec(),
                crate::web_clip::spec(),
                crate::export_folder::spec(&workspace.export_targets()),
                crate::obsidian_import::spec(),
            ];
            own.extend(crate::connector_tokens::specs());
            own.extend(crate::uri_inbox::specs());
            own.extend(mounts);
            own.extend(snapshot_specs());
            // I comandi dell'host parlano col catalogo del core, nella lingua di
            // chi guarda, come quelli che passano dal registro.
            for spec in &mut own {
                workspace.localize_as(crate::settings::CORE_ID, spec);
            }
            specs.extend(own);
            Ok(specs)
        })
    }

    /// Tabella tipizzata, aggiornata dal documento autorevole prima di ogni lettura.
    pub fn mount_routes(&self, vault: Option<&str>) -> Result<Vec<MountRoute>, PluginError> {
        let (mounts, storage) = self.with_session(vault, |session| {
            (session.mounts.clone(), Arc::clone(&session.storage))
        })?;
        let _turn = mounts.write_turn();
        let root = mounts.read()?.root().to_owned();
        let fresh = MountRegistry::load(&*storage, &fub_kernel::FsStorage, &root)
            .map_err(PluginError::from)?;
        let routes = fresh.routing_table();
        *mounts.write()? = fresh;
        Ok(routes)
    }

    pub(super) fn invoke_mount_command(
        &self,
        mounts: Custody<MountRegistry>,
        storage: Arc<dyn VaultStorage>,
        spec: CommandSpec,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        spec.validate_args(&args)?;
        let _turn = mounts.write_turn();
        let root = mounts.read()?.root().to_owned();
        // Il registro sta nel vault; le cartelle montate stanno sulla macchina.
        let storage: &dyn VaultStorage = &*storage;
        let targets: &dyn VaultStorage = &fub_kernel::FsStorage;
        let mut fresh = MountRegistry::load(storage, targets, &root).map_err(PluginError::from)?;
        // Ciò che l'utente legge: l'effetto tipizzato resta per chi lo consuma,
        // ma la palette mostra il `notify`, e senza un comando riuscito è muto.
        let said = match spec.id.as_str() {
            MOUNT_ADD => {
                let name = args["name"].as_str().expect("spec validata");
                let chosen = Utf8Path::new(args["target"].as_str().expect("spec validata"));
                let namespace = args["namespace"].as_str().expect("spec validata");
                // Il piano mostra il nome che verrà salvato, non quello scelto.
                let target = fresh
                    .register(targets, name, chosen, namespace)
                    .map_err(PluginError::from)?;
                if mode.is_dry_run() {
                    let summary = Text::message(
                        "host.mount.plan.add",
                        vec![
                            Arg::text("name", name),
                            Arg::text("target", target.as_str()),
                            Arg::text("namespace", namespace),
                        ],
                    );
                    return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(
                        CommandPlan::of_edits(summary, Vec::new()),
                    )));
                }
                fresh
                    .persist_add(storage, targets, name)
                    .map_err(mount_io_error)?;
                fresh = MountRegistry::load(storage, targets, &root).map_err(PluginError::from)?;
                Some(Text::message(
                    "host.mount.added",
                    vec![
                        Arg::text("name", name),
                        Arg::text("target", target.as_str()),
                    ],
                ))
            }
            MOUNT_REMOVE => {
                let name = args["name"].as_str().expect("spec validata");
                if mode.is_dry_run() {
                    if !fresh.is_configured(name) {
                        return Err(PluginError::NotFound(Text::message(
                            "host.mount.absent",
                            vec![Arg::text("name", name)],
                        )));
                    }
                    let summary =
                        Text::message("host.mount.plan.remove", vec![Arg::text("name", name)]);
                    return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(
                        CommandPlan::of_edits(summary, Vec::new()),
                    )));
                }
                fresh
                    .persist_remove(storage, name)
                    .map_err(mount_io_error)?;
                fresh = MountRegistry::load(storage, targets, &root).map_err(PluginError::from)?;
                Some(Text::message(
                    "host.mount.removed",
                    vec![Arg::text("name", name)],
                ))
            }
            MOUNT_LIST => None,
            _ => unreachable!("dispatch scelto dalle spec mount"),
        };
        let routes = fresh.routing_table();
        let diagnostics = fresh.diagnostics().to_vec();
        *mounts.write()? = fresh;
        let said = said.unwrap_or_else(|| mount_listing(&routes, &diagnostics));
        Ok(
            CommandOutcome::notify(said).with_effect(CommandEffect::Custom {
                ns: "fub.mount.routes".into(),
                payload: serde_json::json!({
                    "routes": routes,
                    "diagnostics": diagnostics,
                }),
            }),
        )
    }

    /// Crea o applica uno snapshot completo. Il vault si chiude prima di
    /// toccare il disco e si riapre **comunque** alla fine, anche dopo un
    /// errore: l'apertura esegue la recovery di ciò che un guasto a metà ha
    /// lasciato. Tutto l'I/O offline avviene sotto il claim `Applying`, così
    /// nessun'altra apertura della stessa radice può infilarsi in mezzo.
    pub(super) fn invoke_snapshot_command(
        &self,
        root: Utf8PathBuf,
        spec: CommandSpec,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        spec.validate_args(&args)?;
        let text = |key: &str| args[key].as_str().expect("spec validata").to_owned();
        if spec.id == SNAPSHOT_CREATE {
            let target = new_outside_folder(&root, &text("target"))?;
            if mode.is_dry_run() {
                let summary = Text::message(
                    "host.snapshot.plan.create",
                    vec![
                        Arg::text("root", root.as_str()),
                        Arg::text("target", target.as_str()),
                    ],
                );
                return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(
                    CommandPlan::of_edits(summary, Vec::new()),
                )));
            }
            // Il lease resta di questo processo fra la chiusura e la
            // riapertura: senza, un altro scrittore potrebbe entrare nel vault
            // mentre lo si copia.
            let _writer = self.writer_lease(&root)?;
            let faults = self.close_vault(&root)?;
            for fault in faults {
                tracing::warn!(target: "fub.snapshot", "chiusura prima dello snapshot: {fault}");
            }
            let captured = (|| {
                let _claim = self.claim_snapshot(&root).map_err(snapshot_host_error)?;
                let bundle =
                    fub_kernel::snapshot::SnapshotBundle::capture(&root).map_err(snapshot_error)?;
                bundle.write_to(&target).map_err(snapshot_error)?;
                Ok::<usize, PluginError>(bundle.len())
            })();
            self.open(&root)?;
            let entries = captured?;
            return Ok(CommandOutcome::notify(Text::message(
                "host.snapshot.done.create",
                vec![
                    Arg::text("target", target.as_str()),
                    Arg::int("count", entries as i64),
                ],
            ))
            .with_effect(CommandEffect::Custom {
                ns: "fub.vault.snapshot".into(),
                payload: serde_json::json!({ "target": target, "entries": entries }),
            }));
        }

        let source = snapshot_source(&root, &text("source"))?;
        let backup = new_outside_folder(&root, &text("backup"))?;
        if source.starts_with(&backup) || backup.starts_with(&source) {
            return Err(PluginError::BadArgs(Text::key("host.snapshot.distinct")));
        }
        // La lettura valida manifest, digest e payload prima di chiudere
        // qualsiasi cosa: uno snapshot rotto non costa una chiusura del vault.
        let bundle =
            fub_kernel::snapshot::SnapshotBundle::read_from(&source).map_err(snapshot_error)?;
        if mode.is_dry_run() {
            let summary = Text::message(
                "host.snapshot.plan.apply",
                vec![
                    Arg::text("root", root.as_str()),
                    Arg::int("count", bundle.len() as i64),
                    Arg::text("source", source.as_str()),
                    Arg::text("backup", backup.as_str()),
                ],
            );
            return Ok(CommandOutcome::done().with_effect(CommandEffect::Plan(
                CommandPlan::of_edits(summary, Vec::new()),
            )));
        }
        let _writer = self.writer_lease(&root)?;
        let faults = self.close_vault(&root)?;
        for fault in faults {
            tracing::warn!(target: "fub.snapshot", "chiusura prima del ripristino: {fault}");
        }
        let applied = (|| {
            let claim = self.claim_snapshot(&root).map_err(snapshot_host_error)?;
            let current =
                fub_kernel::snapshot::SnapshotBundle::capture(&root).map_err(snapshot_error)?;
            current.write_to(&backup).map_err(snapshot_error)?;
            let rebased = bundle
                .rebased(current.base_revision().clone())
                .map_err(snapshot_error)?;
            let report =
                fub_kernel::snapshot::apply_snapshot(&root, &rebased).map_err(snapshot_error)?;
            self.mounts_after_apply(&root, claim.token(), claim.writer())?;
            drop(claim);
            Ok::<_, PluginError>(report)
        })();
        let report = match applied {
            Ok(report) => {
                self.become_current(&root)?;
                report
            }
            Err(error) => {
                // Riapre per la via normale, che completa o annulla ciò che il
                // record persistente dice: l'errore resta quello del ripristino.
                if let Err(reopen) = self.open(&root) {
                    tracing::error!(target: "fub.snapshot", "riapertura dopo errore: {reopen}");
                }
                return Err(error);
            }
        };
        Ok(CommandOutcome::notify(Text::message(
            "host.snapshot.done.apply",
            vec![
                Arg::text("source", source.as_str()),
                Arg::int("count", report.entries as i64),
                Arg::text("backup", backup.as_str()),
            ],
        ))
        .with_effect(CommandEffect::Custom {
            ns: fub_abi::ui::VAULT_RESTORED_NS.into(),
            payload: serde_json::json!({
                "root": root,
                "entries": report.entries,
                "backup": backup,
            }),
        }))
    }

    pub(super) fn invoke_os_trash_command(
        &self,
        workspace: &Custody<Workspace>,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        let spec = os_trash_spec();
        spec.validate_args(&args)?;
        let id = args
            .get("doc")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| PluginError::BadArgs("doc obbligatorio".into()))?;
        // Il recinto prima di tutto, come per un id scelto dall'elenco; poi il
        // nome scritto a mano, fra tutti i documenti: che cosa si può
        // cestinare lo dicono i permessi e il cestino, qui sotto.
        let id = fenced_doc_id(&DocId::new(id))?;
        let id = {
            let ws = workspace.read()?;
            fub_abi::command::resolve_document_name(
                id.as_str(),
                |doc| {
                    &ws.free_name(doc) != doc
                        && (ws.format_of(doc).is_some() || ws.document_revision(doc).is_ok())
                },
                || Ok(ws.documents()),
                |_| true,
                crate::doc_names::CORE_KEYS,
            )?
        };
        let id = fenced_doc_id(&id)?;
        let _turn = workspace.write_turn();
        let prepared = {
            let ws = workspace.read()?;
            authorize_path(
                &ws.granted_policy(crate::settings::CORE_ID),
                Capability::VaultStructure,
                id.as_str(),
                || format!("trashing `{id}`"),
            )?;
            if mode.is_dry_run() {
                return Ok(CommandOutcome::done()
                    .with_effect(CommandEffect::Plan(CommandPlan::default().with_doc(id))));
            }
            ws.prepare_document_deletion(&id)
                .map_err(PluginError::from)?
        };
        let completed = prepared
            .invoke_os(self.os_trash.as_ref())
            .map_err(PluginError::from)?;
        let committed = {
            let mut ws = workspace.write()?;
            ws.commit_os_document_deletion(completed)
                .map_err(|failure| *failure)
        };
        let committed = match committed {
            Ok(committed) => committed,
            Err((error, completed)) => {
                completed.rollback().map_err(PluginError::from)?;
                return Err(PluginError::from(error));
            }
        };
        let finalized = committed.invoke();
        let receipt = with_event_drain(workspace, |ws| ws.finish_os_document_deletion(finalized))?
            .map_err(|failure| {
                let (error, _) = *failure;
                error
            })?;
        Ok(os_trash_outcome(receipt))
    }
}

from pathlib import Path

p=Path('crates/fub-host/src/session.rs')
s=p.read_text()
s=s.replace('#[cfg(feature = "versioning")]\nuse fub_abi::edit::WriteBase;\nuse fub_abi::model::DocId;\nuse fub_abi::traits::JobId;\nuse fub_abi::{Notice, PluginError};', 'use fub_abi::command::{CommandOutcome, CommandSpec, InvokeMode};\nuse fub_abi::edit::{Revision, WriteBase};\nuse fub_abi::model::DocId;\nuse fub_abi::session::ViewContext;\nuse fub_abi::traits::{JobId, ViewInstance, ViewSpec};\nuse fub_abi::ui::{UiAction, UiNode, ViewUpdate};\nuse fub_abi::{Actor, Notice, PluginError};')
needle='''    /// Un handle clonato al workspace di un vault (o del corrente), o l'errore
    /// se non è aperto.
    pub fn workspace(&self, vault: Option<&str>) -> Result<Custody<Workspace>, PluginError> {
        self.with_session(vault, |s| s.workspace.clone())
    }
'''
insert='''    /// Esegue una lettura breve sul workspace selezionato. La custodia non
    /// attraversa questa porta: i consumer dell'host ricevono operazioni, non
    /// l'oggetto monolitico che le implementa.
    fn read_workspace<R>(
        &self,
        vault: Option<&str>,
        f: impl FnOnce(&Workspace) -> Result<R, PluginError>,
    ) -> Result<R, PluginError> {
        self.in_session(vault, |session| {
            let workspace = session.workspace.read()?;
            f(&workspace)
        })
    }

    /// Gemello esclusivo di [`read_workspace`](Self::read_workspace). Resta
    /// privato proprio per impedire che il vecchio `Host::workspace` rinasca
    /// come una closure generica esposta ai consumer.
    fn write_workspace<R>(
        &self,
        vault: Option<&str>,
        f: impl FnOnce(&mut Workspace) -> Result<R, PluginError>,
    ) -> Result<R, PluginError> {
        self.in_session(vault, |session| {
            let mut workspace = session.workspace.write()?;
            f(&mut workspace)
        })
    }

    /// Sorgente e revisione dalla stessa lettura.
    pub fn read_document(
        &self,
        vault: Option<&str>,
        id: &DocId,
    ) -> Result<(String, Revision), PluginError> {
        self.read_workspace(vault, |workspace| {
            let source = workspace.read_source(id).map_err(PluginError::from)?;
            let revision = Revision::of(&source);
            Ok((source, revision))
        })
    }

    pub fn write_document(
        &self,
        vault: Option<&str>,
        id: &DocId,
        source: &str,
        base: WriteBase,
    ) -> Result<Revision, PluginError> {
        self.write_workspace(vault, |workspace| {
            workspace.write_document(id, source, base).map_err(PluginError::from)
        })
    }

    pub fn save_draft(
        &self,
        vault: Option<&str>,
        id: &DocId,
        text: &str,
        base: Option<Revision>,
    ) -> Result<(), PluginError> {
        self.write_workspace(vault, |workspace| {
            workspace.save_draft(id, text, base).map_err(|error| {
                PluginError::Internal(format!("draft not written: {error}").into())
            })
        })
    }

    pub fn discard_draft(&self, vault: Option<&str>, id: &DocId) -> Result<(), PluginError> {
        self.write_workspace(vault, |workspace| {
            workspace.discard_draft(id).map_err(|error| {
                PluginError::Internal(format!("draft not discarded: {error}").into())
            })
        })
    }

    pub fn set_active_context(
        &self,
        vault: Option<&str>,
        context: Option<ViewContext>,
    ) -> Result<Vec<String>, PluginError> {
        self.read_workspace(vault, |workspace| Ok(workspace.set_active_context(context)))
    }

    pub fn views(&self, vault: Option<&str>) -> Result<Vec<ViewSpec>, PluginError> {
        self.read_workspace(vault, |workspace| Ok(workspace.views()))
    }

    pub fn render_view(
        &self,
        vault: Option<&str>,
        instance: &ViewInstance,
    ) -> Result<UiNode, PluginError> {
        self.read_workspace(vault, |workspace| workspace.render_view(instance))
    }

    pub fn view_action(
        &self,
        vault: Option<&str>,
        instance: &ViewInstance,
        action: UiAction,
    ) -> Result<ViewUpdate, PluginError> {
        self.write_workspace(vault, |workspace| workspace.view_action(instance, action))
    }

    pub fn commands(&self, vault: Option<&str>) -> Result<Vec<CommandSpec>, PluginError> {
        self.read_workspace(vault, |workspace| Ok(workspace.commands()))
    }

    pub fn invoke_user_command(
        &self,
        vault: Option<&str>,
        command: &str,
        args: serde_json::Value,
        mode: InvokeMode,
    ) -> Result<CommandOutcome, PluginError> {
        self.write_workspace(vault, |workspace| {
            workspace.invoke_command(command, args, mode, Actor::User)
        })
    }

    pub fn view_state(
        &self,
        vault: Option<&str>,
        owner: &str,
        instance: &str,
        key: &str,
    ) -> Result<Option<serde_json::Value>, PluginError> {
        self.read_workspace(vault, |workspace| Ok(workspace.view_state(owner, instance, key)))
    }

    pub fn set_view_state(
        &self,
        vault: Option<&str>,
        owner: &str,
        instance: &str,
        key: &str,
        value: Option<serde_json::Value>,
    ) -> Result<(), PluginError> {
        self.read_workspace(vault, |workspace| {
            workspace
                .set_view_state(owner, instance, key, value)
                .map_err(|error| PluginError::Io(error.into()))
        })
    }

    /// Accesso al workspace soltanto nei build di debug, per i banchi interni.
    /// La shell e i consumer di produzione non ricevono più questa capacità.
    #[cfg(debug_assertions)]
    #[doc(hidden)]
    pub fn debug_workspace(
        &self,
        vault: Option<&str>,
    ) -> Result<Custody<Workspace>, PluginError> {
        self.with_session(vault, |session| session.workspace.clone())
    }
'''
if needle not in s:
    raise SystemExit('Host::workspace block not found')
p.write_text(s.replace(needle, insert))

p=Path('crates/fub-app/src/lib.rs')
s=p.read_text()
repls={
'''    let ws = host.workspace(vault.as_deref())?;
    let ws = ws.read()?;
    let text = ws.read_source(&doc_id(&id)?).map_err(PluginError::from)?;
    let revision = Revision::of(&text).0;
    Ok(DocumentSource { text, revision })''':'''    let (text, revision) = host.read_document(vault.as_deref(), &doc_id(&id)?)?;
    Ok(DocumentSource { text, revision: revision.0 })''',
'''    let ws = host.workspace(vault.as_deref())?;
    let mut ws = ws.write()?;
    ws.write_document(&doc_id(&id)?, &source, base)
        .map(|r| r.0)
        .map_err(PluginError::from)''':'''    host.write_document(vault.as_deref(), &doc_id(&id)?, &source, base)
        .map(|revision| revision.0)''',
'''    let ws = host.workspace(vault.as_deref())?;
    let mut ws = ws.write()?;
    ws.save_draft(&doc_id(&id)?, &text, base.map(Revision::new))
        .map_err(|and| PluginError::Internal(format!("draft not written: {and}").into()))''':'''    host.save_draft(vault.as_deref(), &doc_id(&id)?, &text, base.map(Revision::new))''',
'''    let ws = host.workspace(vault.as_deref())?;
    let mut ws = ws.write()?;
    ws.discard_draft(&doc_id(&id)?)
        .map_err(|and| PluginError::Internal(format!("draft not discarded: {and}").into()))''':'''    host.discard_draft(vault.as_deref(), &doc_id(&id)?)''',
'''    let ws = host.workspace(vault.as_deref())?;
    let ws = ws.read()?;
    Ok(ws.set_active_context(context))''':'''    host.set_active_context(vault.as_deref(), context)''',
'''    let ws = host.workspace(vault.as_deref())?;
    let ws = ws.read()?;
    Ok(ws.views())''':'''    host.views(vault.as_deref())''',
'''    let ws = host.workspace(vault.as_deref())?;
    let ws = ws.read()?;
    ws.render_view(&view_instance(view, instance, params))''':'''    host.render_view(vault.as_deref(), &view_instance(view, instance, params))''',
'''    let ws = host.workspace(vault.as_deref())?;
    let mut ws = ws.write()?;
    ws.view_action(
        &view_instance(view, instance, params),''':'''    host.view_action(
        vault.as_deref(),
        &view_instance(view, instance, params),''',
'''    let ws = host.workspace(vault.as_deref())?;
    let ws = ws.read()?;
    Ok(ws.commands())''':'''    host.commands(vault.as_deref())''',
'''    let ws = host.workspace(vault.as_deref())?;
    let mut ws = ws.write()?;
    ws.invoke_command(
        &command,
        args.unwrap_or(serde_json::Value::Null),
        mode.unwrap_or(InvokeMode::Apply),
        Actor::User,
    )''':'''    host.invoke_user_command(
        vault.as_deref(),
        &command,
        args.unwrap_or(serde_json::Value::Null),
        mode.unwrap_or(InvokeMode::Apply),
    )''',
'''    let ws = host.workspace(vault.as_deref())?;
    let ws = ws.read()?;
    Ok(ws.view_state(SHELL_OWNER, SHELL_INSTANCE, &key))''':'''    host.view_state(vault.as_deref(), SHELL_OWNER, SHELL_INSTANCE, &key)''',
'''    let ws = host.workspace(vault.as_deref())?;
    // Prestito **condiviso**: lo store ha il suo lucchetto dentro, e prendere
    // qui quello esclusivo del workspace bloccherebbe chi legge per il tempo di
    // una scrittura su disco — per salvare uno scroll.
    let ws = ws.read()?;
    ws.set_view_state(SHELL_OWNER, SHELL_INSTANCE, &key, value)
        .map_err(|and| PluginError::Io(and.into()))''':'''    host.set_view_state(vault.as_deref(), SHELL_OWNER, SHELL_INSTANCE, &key, value)''',
}
for a,b in repls.items():
    if a not in s:
        raise SystemExit('app replacement missing: '+a.splitlines()[0])
    s=s.replace(a,b)
p.write_text(s)

# Internal benches retain generic access only in debug builds.
for root in [Path('crates/fub-host/tests'), Path('crates/fub-host/examples')]:
    for file in root.rglob('*.rs'):
        text=file.read_text()
        if '.workspace(' in text:
            file.write_text(text.replace('.workspace(', '.debug_workspace('))

Path('.github/scripts/check-host-workspace-boundary.mjs').write_text('''import fs from "node:fs";\nimport path from "node:path";\n\nconst bad = [];\nfor (const name of fs.readdirSync("crates/fub-app/src", { recursive: true })) {\n  const file = path.join("crates/fub-app/src", String(name));\n  if (!file.endsWith(".rs") || !fs.statSync(file).isFile()) continue;\n  if (/\\.workspace\\s*\\(/.test(fs.readFileSync(file, "utf8"))) bad.push(file);\n}\nif (bad.length) {\n  console.error(`Accesso generico Host::workspace vietato nella shell: ${bad.join(", ")}`);\n  process.exit(1);\n}\nconsole.log("confine Host/Workspace: shell su porte strette");\n''')

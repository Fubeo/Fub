from pathlib import Path

p = Path('crates/fub-host/src/session.rs')
s = p.read_text()
s = s.replace('''#[cfg(feature = "versioning")]
fn with_read_version_host<R>(''', '''#[cfg(all(feature = "versioning", test))]
fn with_read_version_host<R>(''')
s = s.replace('''        let ws = self.workspace(vault)?;
        let ws = ws.read()?;
        ws.query_index(query)
''', '''        self.read_workspace(vault, |workspace| workspace.query_index(query))
''')
s = s.replace('''        let store = self.versions(vault)?;
        let ws = self.workspace(vault)?;
        with_read_version_host(&ws, |host| store.read(id, ts, host))?
''', '''        let store = self.versions(vault)?;
        self.read_workspace(vault, |workspace| {
            workspace.with_read_host(VERSIONING_ID, |host| store.read(id, ts, host))
        })
''')
s = s.replace('''        let source = self.read_version(vault, id, ts)?;
        let ws = self.workspace(vault)?;
        let mut ws = ws.write()?;
        // **Detta**, come l'importer (§18.1): un ripristino non discende dal
        // testo che c'è adesso — lo sostituisce **apposta**, ed è il gesto con
        // cui l'utente dice che quello di adesso non gli va bene. È l'altra
        // metà del ripristino che il comando `version.restore` dichiara allo
        // stesso modo, e le due righe dicono adesso la stessa parola.
        ws.write_document(id, &source, WriteBase::Dictated)
            .map(|_| ())
            .map_err(PluginError::from)
''', '''        let source = self.read_version(vault, id, ts)?;
        // **Detta**, come l'importer (§18.1): un ripristino non discende dal
        // testo che c'è adesso — lo sostituisce **apposta**.
        self.write_document(vault, id, &source, WriteBase::Dictated)
            .map(|_| ())
''')
if 'self.workspace(vault)?' in s:
    raise SystemExit('restano callsite interni Host::workspace')
p.write_text(s)

# La sostituzione ampia dei banchi distingue Host::workspace(Some/None) da
# VaultSession::workspace(), che è un accessor interno senza argomenti.
for root in [Path('crates/fub-host/tests'), Path('crates/fub-host/examples')]:
    for file in root.rglob('*.rs'):
        text = file.read_text()
        if '.debug_workspace()' in text:
            file.write_text(text.replace('.debug_workspace()', '.workspace()'))

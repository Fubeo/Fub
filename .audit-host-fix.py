from pathlib import Path

p = Path('crates/fub-host/src/session.rs')
s = p.read_text()
s = s.replace('''        let ws = self.workspace(vault)?;\n        let ws = ws.read()?;\n        ws.query_index(query)\n''', '''        self.read_workspace(vault, |workspace| workspace.query_index(query))\n''')
s = s.replace('''        let store = self.versions(vault)?;\n        let ws = self.workspace(vault)?;\n        with_read_version_host(&ws, |host| store.read(id, ts, host))?\n''', '''        let store = self.versions(vault)?;\n        self.read_workspace(vault, |workspace| {\n            workspace.with_read_host(VERSIONING_ID, |host| store.read(id, ts, host))\n        })\n''')
s = s.replace('''        let source = self.read_version(vault, id, ts)?;\n        let ws = self.workspace(vault)?;\n        let mut ws = ws.write()?;\n        // **Detta**, come l'importer (§18.1): un ripristino non discende dal\n        // testo che c'è adesso — lo sostituisce **apposta**, ed è il gesto con\n        // cui l'utente dice che quello di adesso non gli va bene. È l'altra\n        // metà del ripristino che il comando `version.restore` dichiara allo\n        // stesso modo, e le due righe dicono adesso la stessa parola.\n        ws.write_document(id, &source, WriteBase::Dictated)\n            .map(|_| ())\n            .map_err(PluginError::from)\n''', '''        let source = self.read_version(vault, id, ts)?;\n        // **Detta**, come l'importer (§18.1): un ripristino non discende dal\n        // testo che c'è adesso — lo sostituisce **apposta**.\n        self.write_document(vault, id, &source, WriteBase::Dictated)\n            .map(|_| ())\n''')
if 'self.workspace(vault)?' in s:
    raise SystemExit('restano callsite interni Host::workspace')
p.write_text(s)

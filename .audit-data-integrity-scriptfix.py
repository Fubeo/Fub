from pathlib import Path

p = Path('.audit-data-integrity.py')
s = p.read_text()
old = '''stat_method = \'\'\'    pub fn stat(&self, id: &DocId) -> Result<Stat> {\n        let path = self.path(id);\n        self.storage\n            .stat(&path)\n            .map_err(|source| KernelError::Io { path, source })\n    }\n\'\'\'\nstat_plus = stat_method + \'\'\'\n    /// Identità filesystem della voce, se il backend la conosce. Un errore o un\n    /// backend senza identità diventano `None`: il chiamante deve rinunciare a\n    /// inferire una rinomina, mai inventarne una.\n    pub fn file_identity(&self, id: &DocId) -> Option<FileIdentity> {\n        self.storage.file_identity(&self.path(id)).ok().flatten()\n    }\n\'\'\'\n'''
new = '''stat_method = \'\'\'    pub fn stat(&self, id: &DocId) -> Option<(u64, u64)> {\n        let stat = self.storage.stat(&self.path_for(id).ok()?).ok()?;\n        stat.is_file().then_some((stat.size, stat.mtime))\n    }\n\'\'\'\nstat_plus = stat_method + \'\'\'\n    /// Identità filesystem della voce, se il backend la conosce. Un errore o un\n    /// backend senza identità diventano `None`: il chiamante deve rinunciare a\n    /// inferire una rinomina, mai inventarne una.\n    pub fn file_identity(&self, id: &DocId) -> Option<FileIdentity> {\n        let path = self.path_for(id).ok()?;\n        self.storage.file_identity(&path).ok().flatten()\n    }\n\'\'\'\n'''
if s.count(old) != 1:
    raise SystemExit(f'atteso un solo marker Vault::stat nel generatore, trovati {s.count(old)}')
p.write_text(s.replace(old, new))

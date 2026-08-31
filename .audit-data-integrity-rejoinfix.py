from pathlib import Path

p = Path('.audit-data-integrity.py')
s = p.read_text()

marker = "if s.count(old_old_map) != 1:\n"
override = '''old_old_map = \'\'\'        let mut disappeared: BTreeMap<Revision, Vec<DocId>> = BTreeMap::new();\n        let snapshot = self.entry_store.snapshot();\n        for (id, entry) in &snapshot {\n            if entry.size == 0 || self.indexes.core.entries.contains_key(id) || trashed.contains(id)\n            {\n                continue;\n            }\n            if let Some(fingerprint) = entry.fingerprint.clone() {\n                disappeared.entry(fingerprint).or_default().push(id.clone());\n            }\n        }\n\'\'\'\nnew_old_map = \'\'\'        let mut disappeared: BTreeMap<(crate::storage::FileIdentity, Revision), Vec<DocId>> =\n            BTreeMap::new();\n        let snapshot = self.entry_store.snapshot();\n        for (id, entry) in &snapshot {\n            if entry.size == 0 || self.indexes.core.entries.contains_key(id) || trashed.contains(id)\n            {\n                continue;\n            }\n            if let (Some(identity), Some(fingerprint)) = (entry.identity, entry.fingerprint.clone()) {\n                disappeared\n                    .entry((identity, fingerprint))\n                    .or_default()\n                    .push(id.clone());\n            }\n        }\n\'\'\'\n'''
if s.count(marker) != 1:
    raise SystemExit('marker old_old_map non unico')
s = s.replace(marker, override + marker)

marker = "if s.count(old_new_map) != 1:\n"
override = '''old_new_map = \'\'\'        let mut appeared: BTreeMap<Revision, Vec<DocId>> = BTreeMap::new();\n        for entry in self.indexes.core.entries.values() {\n            if entry.size == 0 || self.entry_store.known(&entry.id).is_some() {\n                continue;\n            }\n            match &entry.fingerprint {\n                Some(fingerprint) if disappeared.contains_key(fingerprint) => appeared\n                    .entry(fingerprint.clone())\n                    .or_default()\n                    .push(entry.id.clone()),\n                _ => continue,\n            }\n        }\n\'\'\'\nnew_new_map = \'\'\'        let mut appeared: BTreeMap<(crate::storage::FileIdentity, Revision), Vec<DocId>> =\n            BTreeMap::new();\n        for entry in self.indexes.core.entries.values() {\n            if entry.size == 0 || self.entry_store.known(&entry.id).is_some() {\n                continue;\n            }\n            let (Some(identity), Some(fingerprint)) =\n                (self.docs.vault.file_identity(&entry.id), entry.fingerprint.clone())\n            else {\n                continue;\n            };\n            let key = (identity, fingerprint);\n            if disappeared.contains_key(&key) {\n                appeared.entry(key).or_default().push(entry.id.clone());\n            }\n        }\n\'\'\'\n'''
if s.count(marker) != 1:
    raise SystemExit('marker old_new_map non unico')
s = s.replace(marker, override + marker)

marker = "if s.count(old_loop) != 1:\n"
override = '''old_loop = \'\'\'        for (fingerprint, mut from) in disappeared {\n            let Some(a) = appeared.get(&fingerprint) else {\n                // raccolta se ne occupa come si è sempre occupata.\n                // Il pavimento e la porta insieme (0062): una riga nel log per chi\n                continue;\n            };\n\'\'\'\nnew_loop = \'\'\'        for (identity_and_digest, mut from) in disappeared {\n            let Some(a) = appeared.get(&identity_and_digest) else {\n                // raccolta se ne occupa come si è sempre occupata.\n                // Il pavimento e la porta insieme (0062): una riga nel log per chi\n                continue;\n            };\n\'\'\'\n'''
if s.count(marker) != 1:
    raise SystemExit('marker old_loop non unico')
s = s.replace(marker, override + marker)

p.write_text(s)

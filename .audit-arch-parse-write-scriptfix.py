from pathlib import Path

path = Path('.audit-arch-parse-write.py')
text = path.read_text()
repls = [
    (
        '    descriptor: DocumentFormat,\n',
        '    descriptor: fub_abi::format::FormatDescriptor,\n',
        'prepared descriptor type',
    ),
    (
        '            &self.descriptor.descriptor.id,\n',
        '            &self.descriptor.id,\n',
        'prepared descriptor safety id',
    ),
    (
        '            .apply(&mut model, &ctx, &self.descriptor.descriptor.id);\n',
        '            .apply(&mut model, &ctx, &self.descriptor.id);\n',
        'prepared descriptor syntax id',
    ),
    (
        '''        Ok(PreparedParse {\n            id: id.clone(),\n            descriptor: DocumentFormat {\n                descriptor,\n                capabilities: fub_abi::format::FormatCapabilities::default(),\n            },\n            provider,\n            syntax: self.syntax.clone(),\n        })\n''',
        '''        Ok(PreparedParse {\n            id: id.clone(),\n            descriptor,\n            provider,\n            syntax: self.syntax.clone(),\n        })\n''',
        'prepared descriptor construction',
    ),
    (
        '''        self.insert_normalized(provider, extensions);\n        Ok(())''',
        '''        self.insert_normalized(provider, descriptor, extensions);\n        Ok(())''',
        'registry register insert',
    ),
]
for old, new, label in repls:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected one match, found {count}')
    text = text.replace(old, new, 1)
# The base script used a broader replacement for the same registry line. Remove
# that operation now that the exact register branch has already been rewritten.
old = '''text = replace_once(text, "        self.insert_normalized(provider, extensions);", "        self.insert_normalized(provider, descriptor, extensions);", "registry register insert")\n'''
count = text.count(old)
if count != 1:
    raise SystemExit(f'remove broad registry replacement: expected one match, found {count}')
text = text.replace(old, '', 1)
path.write_text(text)

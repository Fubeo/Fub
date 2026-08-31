from pathlib import Path

p = Path('crates/fub-abi/src/edit.rs')
s = p.read_text()
old = '        assert_eq!(Revision::of("foobar").as_str(), "85944171f73967e8");\n'
new = '''        assert_eq!(
            Revision::of("foobar").as_str(),
            "sha256:c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2"
        );
'''
if s.count(old) != 1:
    raise SystemExit(f'attesa una sola asserzione FNV della Revision, trovate {s.count(old)}')
p.write_text(s.replace(old, new))

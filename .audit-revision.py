from pathlib import Path
import re

# DATA-002: Revision passa a SHA-256. Fnv1a resta pubblico perché altri
# sottosistemi lo usano come impronta non di sicurezza e perché serve a leggere
# revisioni legacy durante la migrazione.
p = Path('crates/fub-abi/src/edit.rs')
s = p.read_text()

marker = '''impl Default for Fnv1a {
    fn default() -> Self {
        Fnv1a::new()
    }
}

'''
sha_impl = r'''/// SHA-256 usato dalle revisioni. È privato: il contratto espone la revisione
/// come valore opaco, non l'algoritmo come API da riutilizzare altrove.
fn sha256(bytes: &[u8]) -> [u8; 32] {
    const H0: [u32; 8] = [
        0x6a09_e667,
        0xbb67_ae85,
        0x3c6e_f372,
        0xa54f_f53a,
        0x510e_527f,
        0x9b05_688c,
        0x1f83_d9ab,
        0x5be0_cd19,
    ];
    const K: [u32; 64] = [
        0x428a_2f98, 0x7137_4491, 0xb5c0_fbcf, 0xe9b5_dba5, 0x3956_c25b, 0x59f1_11f1,
        0x923f_82a4, 0xab1c_5ed5, 0xd807_aa98, 0x1283_5b01, 0x2431_85be, 0x550c_7dc3,
        0x72be_5d74, 0x80de_b1fe, 0x9bdc_06a7, 0xc19b_f174, 0xe49b_69c1, 0xefbe_4786,
        0x0fc1_9dc6, 0x240c_a1cc, 0x2de9_2c6f, 0x4a74_84aa, 0x5cb0_a9dc, 0x76f9_88da,
        0x983e_5152, 0xa831_c66d, 0xb003_27c8, 0xbf59_7fc7, 0xc6e0_0bf3, 0xd5a7_9147,
        0x06ca_6351, 0x1429_2967, 0x27b7_0a85, 0x2e1b_2138, 0x4d2c_6dfc, 0x5338_0d13,
        0x650a_7354, 0x766a_0abb, 0x81c2_c92e, 0x9272_2c85, 0xa2bf_e8a1, 0xa81a_664b,
        0xc24b_8b70, 0xc76c_51a3, 0xd192_e819, 0xd699_0624, 0xf40e_3585, 0x106a_a070,
        0x19a4_c116, 0x1e37_6c08, 0x2748_774c, 0x34b0_bcb5, 0x391c_0cb3, 0x4ed8_aa4a,
        0x5b9c_ca4f, 0x682e_6ff3, 0x748f_82ee, 0x78a5_636f, 0x84c8_7814, 0x8cc7_0208,
        0x90be_fffa, 0xa450_6ceb, 0xbef9_a3f7, 0xc671_78f2,
    ];

    let bit_len = (bytes.len() as u64).wrapping_mul(8);
    let mut padded = bytes.to_vec();
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_be_bytes());

    let mut h = H0;
    for chunk in padded.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (slot, word) in w[..16].iter_mut().zip(chunk.chunks_exact(4)) {
            *slot = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7)
                ^ w[i - 15].rotate_right(18)
                ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17)
                ^ w[i - 2].rotate_right(19)
                ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh] = h;
        for (&k, &word) in K.iter().zip(w.iter()) {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let choice = (e & f) ^ ((!e) & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(choice)
                .wrapping_add(k)
                .wrapping_add(word);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let majority = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(majority);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        for (slot, value) in h.iter_mut().zip([a, b, c, d, e, f, g, hh]) {
            *slot = slot.wrapping_add(value);
        }
    }

    let mut out = [0u8; 32];
    for (slot, value) in out.chunks_exact_mut(4).zip(h) {
        slot.copy_from_slice(&value.to_be_bytes());
    }
    out
}

fn sha256_text(bytes: &[u8]) -> String {
    use std::fmt::Write as _;

    let mut out = String::with_capacity(7 + 64);
    out.push_str("sha256:");
    for byte in sha256(bytes) {
        write!(&mut out, "{byte:02x}").expect("scrivere dentro String non fallisce");
    }
    out
}

'''
if 'fn sha256(bytes: &[u8])' not in s:
    if marker not in s:
        raise SystemExit('marker Default Fnv1a non trovato')
    s = s.replace(marker, marker + sha_impl)

s = s.replace(
'''/// FNV-1a a 64 bit: l'impronta stabile di questo repo.
///
/// A mano invece che con [`DefaultHasher`](std::collections::hash_map::DefaultHasher)
/// perché quest'ultimo non promette lo stesso valore fra versioni di Rust né
/// fra piattaforme, e questi numeri **sopravvivono su disco** — l'indice di
/// ricerca e lo store delle versioni li rileggono a un avvio successivo, magari
/// dopo un aggiornamento.
''',
'''/// FNV-1a a 64 bit: un'impronta stabile legacy e non di sicurezza.
///
/// [`Revision`] non la usa più per i nuovi valori: resta qui per i sottosistemi
/// che hanno bisogno di una piccola impronta stabile e per riconoscere revisioni
/// persistite prima della migrazione a SHA-256. `DefaultHasher` non è adatto
/// nemmeno a questi usi perché non promette stabilità fra versioni e piattaforme.
''')

old = '''    /// L'impronta di un sorgente, come la deriva questo host: FNV-1a a 64 bit
    /// in esadecimale, la stessa famiglia di impronte stabili fra piattaforme
    /// che usano l'indice di ricerca e il versioning.
'''
new = '''    /// L'impronta di un sorgente, come la deriva questo host: SHA-256 con
    /// prefisso `sha256:`. Il prefisso rende esplicito il formato persistito e
    /// permette alla migrazione di distinguere le vecchie revisioni FNV-1a.
'''
if old not in s:
    raise SystemExit('doc Revision FNV non trovato')
s = s.replace(old, new)

old = '''    pub fn of_bytes(source: &[u8]) -> Self {
        let h = Fnv1a::hash(source);
        Revision(format!("{h:016x}"))
    }

    pub fn as_str(&self) -> &str {
'''
new = '''    pub fn of_bytes(source: &[u8]) -> Self {
        Revision(sha256_text(source))
    }

    /// Verifica una revisione contro i byte reali. Accetta la forma SHA-256
    /// corrente e, soltanto durante la migrazione, la vecchia FNV-1a a 16 cifre.
    /// Ogni valore nuovo emesso dall'host resta comunque SHA-256.
    pub fn matches_bytes(&self, source: &[u8]) -> bool {
        if self.0.starts_with("sha256:") {
            return self.0 == sha256_text(source);
        }
        self.0.len() == 16
            && self.0.bytes().all(|byte| byte.is_ascii_hexdigit())
            && self
                .0
                .eq_ignore_ascii_case(&format!("{:016x}", Fnv1a::hash(source)))
    }

    pub fn matches(&self, source: &str) -> bool {
        self.matches_bytes(source.as_bytes())
    }

    pub fn as_str(&self) -> &str {
'''
if old not in s:
    raise SystemExit('impl Revision::of_bytes non trovato')
s = s.replace(old, new)

old = '''        let current = Revision::of(source);
        if current != self.base {
'''
new = '''        let current = Revision::of(source);
        if !self.base.matches(source) {
'''
if old not in s:
    raise SystemExit('guardia EditRequest non trovata')
s = s.replace(old, new)

# Test vettori ufficiali/ampi + compatibilità legacy nel percorso puro.
test_marker = '''    fn request(source: &str, edits: Vec<TextEdit>) -> EditRequest {
        EditRequest::new(Revision::of(source), edits)
    }

'''
tests = '''    #[test]
    fn revision_uses_sha256_and_reads_legacy_fnv_during_migration() {
        assert_eq!(
            Revision::of("").as_str(),
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
        assert_eq!(
            Revision::of("abc").as_str(),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(
            Revision::of("foobar").as_str(),
            "sha256:c3ab8ff13720e8ad9047dd39466b3c8974e592c2fa383d4a3960714caef0c4f2"
        );

        let legacy = Revision::new(format!("{:016x}", Fnv1a::hash(b"foobar")));
        assert!(legacy.matches("foobar"));
        assert!(!legacy.matches("barfoo"));
        let request = EditRequest::new(legacy, vec![TextEdit::insert(6, "!")]);
        assert_eq!(request.apply_to("foobar").unwrap().0, "foobar!");
    }

'''
if 'revision_uses_sha256_and_reads_legacy_fnv_during_migration' not in s:
    if test_marker not in s:
        raise SystemExit('marker test edit.rs non trovato')
    s = s.replace(test_marker, test_marker + tests)
p.write_text(s)

# WriteBase::DescendsFrom deve accettare una base legacy soltanto quando il
# testo sul disco è davvero quello. Il test rende il requisito esplicito.
p = Path('crates/fub-kernel/tests/guarded_write.rs')
s = p.read_text()
s = s.replace('use fub_abi::edit::{Revision, WriteBase};', 'use fub_abi::edit::{Fnv1a, Revision, WriteBase};')
legacy_test = '''
#[test]
fn a_legacy_fnv_base_still_guards_the_same_source_during_migration() {
    let mut ws = vault();
    let id = doc("legacy.md");
    ws.write_document(&id, "com'era", WriteBase::Dictated)
        .expect("prima scrittura");

    let legacy = Revision::new(format!("{:016x}", Fnv1a::hash(b"com'era")));
    ws.write_document(
        &id,
        "com'è adesso",
        WriteBase::DescendsFrom(legacy.clone()),
    )
    .expect("la revisione legacy nomina esattamente il testo sul disco");

    ws.write("legacy.md", "cambiato da fuori");
    let err = ws
        .write_document(&id, "non coprire", WriteBase::DescendsFrom(legacy))
        .expect_err("la compatibilità legacy non deve indebolire la guardia");
    assert!(matches!(err, KernelError::Stale(_)), "{err:?}");
    assert_eq!(ws.read("legacy.md"), "cambiato da fuori");
}
'''
if 'a_legacy_fnv_base_still_guards_the_same_source_during_migration' not in s:
    s += legacy_test
p.write_text(s)

# Migra la guardia del write completo: il testo già letto resta anche il valore
# atteso della CAS, quindi il confronto forte e la scrittura atomica parlano
# dello stesso snapshot.
p = Path('crates/fub-kernel/src/workspace.rs')
s = p.read_text()
start = s.find('WriteBase::DescendsFrom(expected) => {')
end = s.find('WriteBase::Dictated =>', start)
if start < 0 or end < 0:
    raise SystemExit('ramo WriteBase::DescendsFrom non trovato in workspace')
segment = s[start:end]
original = segment
# Forma più comune: revisione calcolata in una variabile e poi confrontata.
segment, n1 = re.subn(
    r'let\s+(\w+)\s*=\s*Revision::of\(&?(\w+)\);\n(\s*)if\s+\1\s*!=\s*expected\s*\{',
    lambda m: f'let {m.group(1)} = Revision::of(&{m.group(2)});\n{m.group(3)}if !expected.matches(&{m.group(2)}) {{',
    segment,
    count=1,
)
# Variante con confronto diretto.
if n1 == 0:
    segment, n2 = re.subn(
        r'if\s+Revision::of\(&?(\w+)\)\s*!=\s*expected\s*\{',
        lambda m: f'if !expected.matches(&{m.group(1)}) {{',
        segment,
        count=1,
    )
else:
    n2 = 0
# Variante atteso a sinistra.
if n1 + n2 == 0:
    segment, n3 = re.subn(
        r'if\s+expected\s*!=\s*Revision::of\(&?(\w+)\)\s*\{',
        lambda m: f'if !expected.matches(&{m.group(1)}) {{',
        segment,
        count=1,
    )
else:
    n3 = 0
if n1 + n2 + n3 != 1:
    raise SystemExit('confronto Revision/expected non riconosciuto nel ramo DescendsFrom:\n' + original[:2200])
s = s[:start] + segment + s[end:]
p.write_text(s)

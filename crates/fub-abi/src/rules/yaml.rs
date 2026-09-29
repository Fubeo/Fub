//! Quanto costa leggere uno YAML, e quando non lo si legge.
//!
//! Un frontmatter, un `.base`, un template sono YAML scritto da chiunque abbia
//! messo un file nel vault. Il parser (libyaml, sotto `serde_yaml_ng`) paga per
//! ogni token tante unità quante sono in quel momento le collezioni di flusso
//! aperte (`[`, `{`), e le paga **tutte prima** che il limite di ricorsione del
//! deserializzatore possa fermarlo: 160 KB di `[` annidate costavano nove
//! secondi, un mega qualche ora.
//!
//! [`within_budget`] è il controllo da fare prima di chiamare il parser. Non
//! prova a sapere quante collezioni sono davvero aperte: per saperlo bisogna
//! tokenizzare come libyaml, e un conteggio che si fidi delle chiusure si
//! inganna con una `]` dentro una stringa fra virgolette (`[ "]" [ "]" …`).
//! Usa un tetto che non si inganna: in ogni punto le collezioni aperte non sono
//! più delle `[` e `{` già viste, quindi il lavoro del parser non supera la
//! somma, byte per byte, di quelle aperture. Oltre [`BUDGET`] lo YAML non si
//! legge, e chi chiama lo tratta come uno YAML che non ha capito: un
//! frontmatter resta verbatim, un `.base` non si apre, un valore resta testo.
//!
//! Il tetto è largo per i file veri: cinquecento wikilink fra virgolette in
//! venti KB di frontmatter restano sotto di un ordine di grandezza, e un file
//! senza parentesi non lo tocca a nessuna lunghezza.

/// La somma, byte per byte, delle `[` e `{` già viste oltre la quale uno YAML
/// non si legge. Al peggio, tutte aperture, è circa un decimo di secondo di
/// parser.
pub const BUDGET: u64 = 1 << 27;

/// Il motivo che accompagna uno YAML oltre [`BUDGET`], per chi lo mostra.
pub const OVER_BUDGET: &str =
    "lo YAML apre troppe collezioni `[` e `{` per la sua lunghezza: non si legge";

/// Se lo YAML si può dare al parser senza che il suo costo esploda (vedi il
/// modulo).
pub fn within_budget(yaml: &str) -> bool {
    let mut openers = 0u64;
    let mut work = 0u64;
    for &byte in yaml.as_bytes() {
        work += openers;
        if work > BUDGET {
            return false;
        }
        if matches!(byte, b'[' | b'{') {
            openers += 1;
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_frontmatter_is_far_below_the_budget() {
        let links: String = (0..500)
            .map(|i| format!("  - \"[[Una nota dal titolo più lungo {i}]]\"\n"))
            .collect();
        let yaml = format!("title: Una nota\ntags: [a, b, c]\nrelated:\n{links}");
        assert!(yaml.len() > 20_000, "{}", yaml.len());
        let mut openers = 0u64;
        let work: u64 = yaml
            .bytes()
            .map(|byte| {
                let before = openers;
                openers += u64::from(matches!(byte, b'[' | b'{'));
                before
            })
            .sum();
        assert!(work * 10 < BUDGET, "{work}");
        assert!(within_budget(&yaml));
    }

    #[test]
    fn a_long_yaml_without_brackets_never_exceeds_it() {
        let yaml: String = (0..200_000).map(|i| format!("k{i}: v\n")).collect();
        assert!(within_budget(&yaml));
    }

    #[test]
    fn deep_flow_nesting_is_refused() {
        assert!(!within_budget(&format!("a: {}", "[".repeat(20_000))));
        assert!(!within_budget(&format!("a: {}x", "{a: ".repeat(10_000))));
        assert!(within_budget(&format!(
            "a: {}{}",
            "[".repeat(100),
            "]".repeat(100)
        )));
    }

    /// Le chiusure non abbassano il conto: una `]` fra virgolette per libyaml è
    /// testo, e chi la contasse lascerebbe passare l'annidamento vero.
    #[test]
    fn quoted_closers_do_not_hide_the_nesting() {
        assert!(!within_budget(&format!("a: {}", "[ \"]\" ".repeat(10_000))));
    }
}

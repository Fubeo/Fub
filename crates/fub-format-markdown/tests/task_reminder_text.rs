//! **Il promemoria `⏰` è testo del compito**, come la scadenza `📅`.
//!
//! Il parser non ha una sintassi per lui, ed è voluto: la regola che lo legge
//! sta nel contratto (`fub_abi::rules::tasks::task_reminder`) e lavora sul
//! testo del compito che il modello dà. Questo file tiene le due metà della
//! promessa: il modello porta il `⏰` intatto nel testo del compito, dove la
//! regola lo trova, e la riserializzazione lo riscrive byte per byte.

use fub_abi::format::{DocumentSource, ParseContext};
use fub_abi::model::Block;
use fub_abi::rules::tasks::{reminder_minute, task_reminder, task_text};
use fub_abi::FormatProvider;
use fub_format_markdown::MarkdownProvider;

const SOURCE: &str = "- [ ] Chiamare Mario ⏰ 2026-11-13 09:30 📅 2026-11-14\n\
                      - [x] Fatto ⏰ 2026-11-12\n\
                      - [ ] In **grassetto** ⏰ 2026-11-13 18:00\n";

#[test]
fn the_reminder_stays_in_the_task_text_and_comes_back_byte_for_byte() {
    let provider = MarkdownProvider::new();
    let model = provider
        .parse(
            &DocumentSource::from(SOURCE),
            &ParseContext::obsidian("compiti.md"),
        )
        .expect("parses");

    let Some(Block::List { items, .. }) = model.body.first() else {
        panic!("a list: {:?}", model.body);
    };
    let found: Vec<Option<i64>> = items
        .iter()
        .map(|item| task_reminder(&task_text(&item.blocks)).and_then(|r| r.minute))
        .collect();
    assert_eq!(
        found,
        vec![
            reminder_minute("2026-11-13 09:30"),
            reminder_minute("2026-11-12 09:00"),
            reminder_minute("2026-11-13 18:00"),
        ],
        "the rule finds every reminder in the model's task text"
    );
    assert!(found.iter().all(Option::is_some));

    assert_eq!(
        provider.serialize(&model).expect("serializes"),
        SOURCE,
        "the reminder is written back as it was"
    );
}

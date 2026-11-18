//! Ogni provider di comandi ufficiale passa la **conformità dei comandi**
//! dell'SDK (`fub_sdk::testing::conformance::a_command_provider_respects_the_contract`).
//!
//! È lo stesso dogfooding di `conformance.rs` per le view: una suite che nessuna
//! implementazione vera passa non è una suite, e se un'asserzione è troppo
//! stretta lo si scopre qui, su codice che il progetto controlla, invece che
//! addosso al primo componente o alla prima ricetta di terzi.
//!
//! L'elenco viene da [`fub_features::every_official_feature`], la stessa fetta
//! da cui l'host monta i comandi: un provider che esiste nell'app passa di qui
//! senza che nessuno se ne ricordi. Le feature ufficiali sono del core, quindi
//! l'id si giudica con `Owner::Core`.
//!
//! Ogni provider gira su due banchi: vuoto, che è la palette senza una nota
//! aperta, e con una nota Markdown attiva e il cursore dentro, che è ciò che
//! serve a un comando per arrivare fin dove scriverebbe. I comandi che si
//! fermano su una porta che `MemoryHost` non ha (un servizio di un altro
//! bundle, un comando altrui da comporre) sono saltati e stampati, mai
//! contati come provati.

use fub_abi::rules::ids::Owner;
use fub_sdk::testing::{conformance, MemoryHost};

const NOTA: &str = "conformita/nota.md";
const TESTO: &str = "---\ntags: [prova]\n---\n# Titolo\n\nUn paragrafo con #tag e [[altra nota]].\n\n- [ ] un compito\n";

/// Il banco con una nota aperta: il cursore sta nel paragrafo.
fn with_an_open_note() -> MemoryHost {
    let host = MemoryHost::new()
        .with_document(NOTA, TESTO)
        .with_document("conformita/altra nota.md", "# Altra\n");
    host.set_active(Some(NOTA));
    host.set_caret(TESTO.find("paragrafo"));
    host
}

#[test]
fn the_official_command_providers_respect_the_contract() {
    let mut seen = 0;
    for feature in fub_features::every_official_feature() {
        let Some(build) = feature.commands else {
            continue;
        };
        seen += 1;
        for (bench, mut host) in [
            ("vuoto", MemoryHost::new()),
            ("con una nota aperta", with_an_open_note()),
        ] {
            let mut provider = build();
            let skipped = conformance::a_command_provider_respects_the_contract(
                provider.as_mut(),
                &mut host,
                Owner::Core,
            );
            // La suite li ha già stampati uno per uno: qui si dice di chi sono.
            if !skipped.is_empty() {
                eprintln!(
                    "^ {} sul banco {bench}: {} comandi saltati",
                    feature.id,
                    skipped.len()
                );
            }
        }
    }
    // Una suite che gira su zero implementazioni non è una suite: è un test
    // che passa. Con le cargo feature di default i provider di comandi ci sono.
    #[cfg(feature = "commands")]
    assert!(seen > 0, "l'inventario non ha nessun provider di comandi");
    let _ = seen;
}

/// Il comando di una ricetta passa la stessa suite, giudicato come un bundle
/// di terzi (`Owner::Plugin("recipe.<id>")`): è un provider che l'host monterà
/// per ogni ricetta adottata.
///
/// Due ricette: quella d'esempio del contratto, che chiede la nota (la suite
/// non la invoca, perché ha un parametro obbligatorio), e una senza parametri
/// obbligatori, che la suite invoca in simulazione. `MemoryHost` non ha un
/// registro dei comandi, quindi il suo primo passo risponde `UnknownCommand` e
/// la ricetta si ferma lì senza scrivere: saltata e detta, mai contata come
/// provata. I passi veri attraverso il kernel sono in `tests/recipes_e2e.rs`.
#[cfg(feature = "recipes")]
#[test]
fn the_command_of_a_recipe_respects_the_contract() {
    use fub_abi::format::{DocumentSource, ParseContext};
    use fub_abi::FormatProvider;
    use fub_features::recipes::{parse, RecipeCommand};

    const ESEMPIO: &str = r#"fub-recipe: 1
id: archivia-la-nota
title: Archivia la nota
description: Segna la data e sposta la nota in Archivio.
steps:
  - run: note.property.set
    args:
      doc: "{{doc}}"
      key: archiviata
      value: "{{date}}"
  - run: note.rename
    args:
      doc: "{{doc}}"
      to: "Archivio/{{title}}.md""#;
    const SENZA_NOTA: &str = r#"fub-recipe: 1
id: diario-di-oggi
title: Diario di oggi
description: Apre la nota del giorno.
keybinding: Mod-Alt-d
surfaces: [slash]
params:
  - name: tono
    title: Tono
    kind: choice
    options: [calmo, allegro]
steps:
  - run: note.daily
    args: { date: "{{date}}" }"#;

    let registry: Vec<_> = fub_features::every_official_feature()
        .iter()
        .filter_map(|feature| feature.commands)
        .flat_map(|provider| provider().commands())
        .collect();
    for (yaml, invoked) in [(ESEMPIO, false), (SENZA_NOTA, true)] {
        let source = format!("# Ricetta\n\n```fub-recipe\n{yaml}\n```\n");
        let model = fub_format_markdown::MarkdownProvider::new()
            .parse(
                &DocumentSource::Text(source.clone()),
                &ParseContext::obsidian("Recipes/Ricetta.md"),
            )
            .expect("il Markdown si legge");
        let recipe = parse(&model, &source).expect("la ricetta si legge");
        let bundle = format!("recipe.{}", recipe.id);
        let mut command = RecipeCommand::new(recipe, &registry);
        for mut host in [MemoryHost::new(), with_an_open_note()] {
            let skipped = conformance::a_command_provider_respects_the_contract(
                &mut command,
                &mut host,
                Owner::Plugin(&bundle),
            );
            if invoked {
                assert_eq!(skipped.len(), 1, "{bundle}: {skipped:?}");
                assert!(skipped[0].why.contains("note.daily"), "{skipped:?}");
            } else {
                assert!(skipped.is_empty(), "{bundle}: {skipped:?}");
            }
        }
    }
}

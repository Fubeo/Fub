//! Le dichiarazioni delle impostazioni dell'editor.

use super::*;

pub(super) fn editor_settings() -> Vec<SettingSpec> {
    let choice = |key, label, description, default: &str, options: Vec<UiOption>| {
        SettingSpec::new(
            key,
            Text::key(label),
            SettingKind::Choice {
                default: default.into(),
                options,
            },
        )
        .describing(Text::key(description))
        .grouped(Text::key(C_GROUP_EDITOR))
        .for_machine()
    };
    let mut settings = vec![choice(
        EDITOR_DEFAULT_MODE,
        C_EDITOR_DEFAULT_MODE,
        C_EDITOR_DEFAULT_MODE_DESC,
        "live_preview",
        vec![
            UiOption::new("live_preview", Text::key(C_MODE_WRITING)),
            UiOption::new("source", Text::key(C_MODE_SOURCE)),
            UiOption::new("reading", Text::key(C_MODE_READING)),
            // I Blocchi sono dentro Scrittura (E1). Chi li aveva scelti ha
            // `blocks` nel file della macchina, e quel valore resta suo: non si
            // riscrive, e una scelta tolta lo farebbe ignorare con un avviso e
            // ricadere sul predefinito. Resta allora fra le scelte, in fondo,
            // con l'etichetta di Scrittura: due scelte con la stessa etichetta
            // sono la stessa scelta, e il pannello mostra soltanto la prima
            // (`visibleChoices` in `apps/client/src/panels/settings-model.ts`).
            // La shell apre `blocks` in Scrittura (`SurfaceMode.formerIds`).
            UiOption::new("blocks", Text::key(C_MODE_WRITING)),
        ],
    )];
    settings.push(choice(
        EDITOR_LIVE_REVEAL,
        C_EDITOR_LIVE_REVEAL,
        C_EDITOR_LIVE_REVEAL_DESC,
        "mai",
        vec![
            UiOption::new("mai", Text::key(C_EDITOR_LIVE_REVEAL_NEVER)),
            UiOption::new("elemento", Text::key(C_EDITOR_LIVE_REVEAL_ELEMENT)),
            UiOption::new("riga", Text::key(C_EDITOR_LIVE_REVEAL_LINE)),
        ],
    ));
    // I blocchi come preferenza (D1, E2): una voce a sé, subito dopo i segni
    // di Scrittura, perché sono la prima scelta su come si scrive.
    settings.push(
        SettingSpec::toggle(EDITOR_BLOCKS, Text::key(C_EDITOR_BLOCKS), true)
            .describing(Text::key(C_EDITOR_BLOCKS_DESC))
            .grouped(Text::key(C_GROUP_EDITOR))
            .for_machine(),
    );
    settings.extend(
        [
            (
                EDITOR_SPELLCHECK,
                C_EDITOR_SPELLCHECK,
                C_EDITOR_SPELLCHECK_DESC,
                true,
            ),
            (
                EDITOR_LINE_WRAP,
                C_EDITOR_LINE_WRAP,
                C_EDITOR_LINE_WRAP_DESC,
                true,
            ),
            (
                EDITOR_LINE_NUMBERS,
                C_EDITOR_LINE_NUMBERS,
                C_EDITOR_LINE_NUMBERS_DESC,
                true,
            ),
            (
                EDITOR_CLOSE_BRACKETS,
                C_EDITOR_CLOSE_BRACKETS,
                C_EDITOR_CLOSE_BRACKETS_DESC,
                true,
            ),
            (
                EDITOR_LIVE_GUIDE,
                C_EDITOR_LIVE_GUIDE,
                C_EDITOR_LIVE_GUIDE_DESC,
                true,
            ),
            (
                EDITOR_MATH_SOURCE,
                C_EDITOR_MATH_SOURCE,
                C_EDITOR_MATH_SOURCE_DESC,
                false,
            ),
            (
                EDITOR_FOLD_GUTTER,
                C_EDITOR_FOLD_GUTTER,
                C_EDITOR_FOLD_GUTTER_DESC,
                true,
            ),
            (
                EDITOR_SMART_LISTS,
                C_EDITOR_SMART_LISTS,
                C_EDITOR_SMART_LISTS_DESC,
                true,
            ),
            (
                EDITOR_STRICT_LINE_BREAKS,
                C_EDITOR_STRICT_LINE_BREAKS,
                C_EDITOR_STRICT_LINE_BREAKS_DESC,
                true,
            ),
            (
                EDITOR_INDENT_GUIDES,
                C_EDITOR_INDENT_GUIDES,
                C_EDITOR_INDENT_GUIDES_DESC,
                false,
            ),
            (
                EDITOR_CURSOR_BLINK,
                C_EDITOR_CURSOR_BLINK,
                C_EDITOR_CURSOR_BLINK_DESC,
                false,
            ),
            (
                EDITOR_SOFT_CURSOR,
                C_EDITOR_SOFT_CURSOR,
                C_EDITOR_SOFT_CURSOR_DESC,
                false,
            ),
            (
                EDITOR_TYPEWRITER,
                C_EDITOR_TYPEWRITER,
                C_EDITOR_TYPEWRITER_DESC,
                false,
            ),
            (
                EDITOR_PASTE_HTML,
                C_EDITOR_PASTE_HTML,
                C_EDITOR_PASTE_HTML_DESC,
                true,
            ),
            (EDITOR_RTL, C_EDITOR_RTL, C_EDITOR_RTL_DESC, false),
            (
                EDITOR_PREVIEW_MODIFIER,
                C_EDITOR_PREVIEW_MODIFIER,
                C_EDITOR_PREVIEW_MODIFIER_DESC,
                false,
            ),
        ]
        .into_iter()
        .map(|(key, label, description, default)| {
            SettingSpec::toggle(key, Text::key(label), default)
                .describing(Text::key(description))
                .grouped(Text::key(C_GROUP_EDITOR))
                .for_machine()
        }),
    );
    settings.push(choice(
        EDITOR_MATH_HELP,
        C_EDITOR_MATH_HELP,
        C_EDITOR_MATH_HELP_DESC,
        "piene",
        vec![
            UiOption::new("piene", Text::key(C_EDITOR_MATH_HELP_FULL)),
            UiOption::new("discrete", Text::key(C_EDITOR_MATH_HELP_DISCREET)),
            UiOption::new("spente", Text::key(C_EDITOR_MATH_HELP_OFF)),
        ],
    ));
    settings.push(choice(
        EDITOR_INDENT,
        C_EDITOR_INDENT,
        C_EDITOR_INDENT_DESC,
        "2",
        vec![
            UiOption::new("tab", Text::key(C_EDITOR_INDENT_TAB)),
            UiOption::new("2", Text::key(C_EDITOR_INDENT_2)),
            UiOption::new("4", Text::key(C_EDITOR_INDENT_4)),
        ],
    ));
    settings.push(choice(
        EDITOR_PROPERTIES,
        C_EDITOR_PROPERTIES,
        C_EDITOR_PROPERTIES_DESC,
        "visible",
        vec![
            UiOption::new("visible", Text::key(C_EDITOR_PROPERTIES_VISIBLE)),
            UiOption::new("hidden", Text::key(C_EDITOR_PROPERTIES_HIDDEN)),
            UiOption::new("source", Text::key(C_EDITOR_PROPERTIES_SOURCE)),
        ],
    ));
    settings.push(choice(
        EDITOR_MINIBAR,
        C_EDITOR_MINIBAR,
        C_EDITOR_MINIBAR_DESC,
        "auto",
        vec![
            UiOption::new("auto", Text::key(C_EDITOR_MINIBAR_AUTO)),
            UiOption::new("always", Text::key(C_EDITOR_MINIBAR_ALWAYS)),
            UiOption::new("menu", Text::key(C_EDITOR_MINIBAR_MENU)),
            UiOption::new("off", Text::key(C_EDITOR_MINIBAR_OFF)),
        ],
    ));
    settings.push(choice(
        EDITOR_TOOLBAR,
        C_EDITOR_TOOLBAR,
        C_EDITOR_TOOLBAR_DESC,
        "compatta",
        vec![
            UiOption::new("compatta", Text::key(C_EDITOR_TOOLBAR_COMPACT)),
            UiOption::new("completa", Text::key(C_EDITOR_TOOLBAR_FULL)),
            UiOption::new("nascosta", Text::key(C_EDITOR_TOOLBAR_HIDDEN)),
        ],
    ));
    settings.push(choice(
        EDITOR_LINK_CLICK,
        C_EDITOR_LINK_CLICK,
        C_EDITOR_LINK_CLICK_DESC,
        "apri",
        vec![
            UiOption::new("apri", Text::key(C_EDITOR_LINK_CLICK_OPEN)),
            UiOption::new("sbircia", Text::key(C_EDITOR_LINK_CLICK_PEEK)),
        ],
    ));
    settings.push(choice(
        EDITOR_GRID_COPY_MARK,
        C_EDITOR_GRID_COPY_MARK,
        C_EDITOR_GRID_COPY_MARK_DESC,
        "dash-pulse",
        vec![
            UiOption::new("dash-pulse", Text::key(C_EDITOR_GRID_COPY_MARK_BOTH)),
            UiOption::new("dash", Text::key(C_EDITOR_GRID_COPY_MARK_DASH)),
            UiOption::new("pulse", Text::key(C_EDITOR_GRID_COPY_MARK_PULSE)),
        ],
    ));
    settings.push(choice(
        EDITOR_GRID_SELECTION_SPEED,
        C_EDITOR_GRID_SELECTION_SPEED,
        C_EDITOR_GRID_SELECTION_SPEED_DESC,
        "normal",
        vec![
            UiOption::new("quick", Text::key(C_EDITOR_GRID_SELECTION_SPEED_QUICK)),
            UiOption::new("normal", Text::key(C_EDITOR_GRID_SELECTION_SPEED_NORMAL)),
            UiOption::new("soft", Text::key(C_EDITOR_GRID_SELECTION_SPEED_SOFT)),
            UiOption::new("none", Text::key(C_EDITOR_GRID_SELECTION_SPEED_NONE)),
        ],
    ));
    settings.push(
        SettingSpec::toggle(EDITOR_SLASH, Text::key(C_EDITOR_SLASH), true)
            .describing(Text::key(C_EDITOR_SLASH_DESC))
            .grouped(Text::key(C_GROUP_EDITOR))
            .for_machine(),
    );
    settings.push(
        SettingSpec::toggle(EDITOR_HINTS, Text::key(C_EDITOR_HINTS), true)
            .describing(Text::key(C_EDITOR_HINTS_DESC))
            .grouped(Text::key(C_GROUP_EDITOR))
            .for_machine(),
    );
    settings.push(
        SettingSpec::toggle(EDITOR_TYPOGRAPHY, Text::key(C_EDITOR_TYPOGRAPHY), false)
            .describing(Text::key(C_EDITOR_TYPOGRAPHY_DESC))
            .grouped(Text::key(C_GROUP_EDITOR))
            .for_machine(),
    );
    settings.push(
        SettingSpec::new(
            EDITOR_SLASH_HIDDEN,
            Text::key(C_EDITOR_SLASH_HIDDEN),
            SettingKind::List {
                default: Vec::new(),
            },
        )
        .describing(Text::key(C_EDITOR_SLASH_HIDDEN_DESC))
        .grouped(Text::key(C_GROUP_EDITOR))
        .for_machine(),
    );
    settings.push(
        SettingSpec::new(
            EDITOR_SLASH_SECTIONS,
            Text::key(C_EDITOR_SLASH_SECTIONS),
            SettingKind::List {
                default: SLASH_SECTIONS.iter().map(|id| (*id).into()).collect(),
            },
        )
        .describing(Text::key(C_EDITOR_SLASH_SECTIONS_DESC))
        .grouped(Text::key(C_GROUP_EDITOR))
        .for_machine(),
    );
    settings.push(
        SettingSpec::toggle(EDITOR_VIM, Text::key(C_EDITOR_VIM), false)
            .describing(Text::key(C_EDITOR_VIM_DESC))
            .grouped(Text::key(C_GROUP_EDITOR))
            .for_machine(),
    );
    settings
}

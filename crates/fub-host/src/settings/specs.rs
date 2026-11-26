//! Le dichiarazioni delle impostazioni del programma (gruppi, tipi, valori di serie), tranne quelle dell'editor.

use super::*;

/// Le impostazioni del bundle di core.
///
/// Le chiavi `locale.*` (§12.3) stanno qui e non in una feature per la stessa
/// ragione di `plugins.disabled`: in che lingua legge l'utente non è di nessun
/// componente, è dell'applicazione — e appenderle a una feature vorrebbe dire
/// che spegnendo quella feature sparisce la lingua.
pub fn core_settings() -> Vec<SettingSpec> {
    // L'ordine di questo elenco è l'ordine del pannello (le righe escono in
    // ordine di dichiarazione, e i gruppi in ordine di prima apparizione):
    // prima ciò che si guarda e si tocca più spesso, cioè l'aspetto e la
    // scrittura, poi i file, e in fondo ciò che si tocca per diagnosticare.
    let mut settings = appearance_settings();
    settings.extend(chrome_settings());
    settings.extend(editor_settings());
    settings.extend(profile_settings());
    settings.push(
        SettingSpec::new(
            ATTACHMENT_FOLDER,
            Text::key(C_ATTACHMENT_FOLDER),
            SettingKind::Text {
                default: DEFAULT_ATTACHMENT_FOLDER.into(),
            },
        )
        .describing(Text::key(C_ATTACHMENT_FOLDER_DESC))
        .grouped(Text::key(C_GROUP_FILES)),
    );
    settings.push(
        SettingSpec::new(
            NEW_NOTE_FOLDER,
            Text::key(C_NEW_NOTE_FOLDER),
            SettingKind::Text {
                default: DEFAULT_NEW_NOTE_FOLDER.into(),
            },
        )
        .describing(Text::key(C_NEW_NOTE_FOLDER_DESC))
        .grouped(Text::key(C_GROUP_FILES)),
    );
    settings.push(
        SettingSpec::new(
            NEW_NOTE_EXTENSION,
            Text::key(C_NEW_NOTE_EXTENSION),
            SettingKind::Text {
                default: DEFAULT_NEW_NOTE_EXTENSION.into(),
            },
        )
        .describing(Text::key(C_NEW_NOTE_EXTENSION_DESC))
        .grouped(Text::key(C_GROUP_FILES)),
    );
    settings.push(
        SettingSpec::new(
            FILES_TRASH,
            Text::key(C_FILES_TRASH),
            SettingKind::Choice {
                default: FILES_TRASH_VAULT.into(),
                options: vec![
                    UiOption::new(FILES_TRASH_VAULT, Text::key(C_FILES_TRASH_VAULT)),
                    UiOption::new(FILES_TRASH_SYSTEM, Text::key(C_FILES_TRASH_SYSTEM)),
                ],
            },
        )
        .describing(Text::key(C_FILES_TRASH_DESC))
        .grouped(Text::key(C_GROUP_FILES)),
    );
    settings.push(
        SettingSpec::new(
            FILES_STARTUP,
            Text::key(C_FILES_STARTUP),
            SettingKind::Choice {
                default: String::new(),
                options: vec![
                    UiOption::new("", Text::key(C_FILES_STARTUP_SESSION)),
                    UiOption::new(FILES_STARTUP_DAILY, Text::key(C_FILES_STARTUP_DAILY)),
                    UiOption::new(FILES_STARTUP_NEW, Text::key(C_FILES_STARTUP_NEW)),
                    UiOption::new(FILES_STARTUP_FIXED, Text::key(C_FILES_STARTUP_FIXED)),
                ],
            },
        )
        .describing(Text::key(C_FILES_STARTUP_DESC))
        .grouped(Text::key(C_GROUP_FILES)),
    );
    settings.push(
        SettingSpec::new(
            FILES_STARTUP_NOTE,
            Text::key(C_FILES_STARTUP_NOTE),
            SettingKind::Text {
                default: String::new(),
            },
        )
        .describing(Text::key(C_FILES_STARTUP_NOTE_DESC))
        .grouped(Text::key(C_GROUP_FILES)),
    );
    settings.push(
        SettingSpec::new(
            FILES_PEOPLE_FOLDER,
            Text::key(C_FILES_PEOPLE_FOLDER),
            SettingKind::Text {
                default: "Persone".into(),
            },
        )
        .describing(Text::key(C_FILES_PEOPLE_FOLDER_DESC))
        .grouped(Text::key(C_GROUP_FILES)),
    );
    settings.push(
        SettingSpec::new(
            FILES_TYPES_FOLDER,
            Text::key(C_FILES_TYPES_FOLDER),
            SettingKind::Text {
                default: DEFAULT_TYPES_FOLDER.into(),
            },
        )
        .describing(Text::key(C_FILES_TYPES_FOLDER_DESC))
        .grouped(Text::key(C_GROUP_FILES)),
    );
    settings.push(
        SettingSpec::toggle(FILES_CONFIRM_TRASH, Text::key(C_FILES_CONFIRM_TRASH), true)
            .describing(Text::key(C_FILES_CONFIRM_TRASH_DESC))
            .grouped(Text::key(C_GROUP_FILES)),
    );
    settings.push(
        SettingSpec::toggle(
            FILES_LEGACY_FOLDER_PAGES,
            Text::key(C_FILES_LEGACY_FOLDER_PAGES),
            false,
        )
        .describing(Text::key(C_FILES_LEGACY_FOLDER_PAGES_DESC))
        .grouped(Text::key(C_GROUP_FILES)),
    );
    settings.push(
        SettingSpec::new(
            URI_ALLOWED,
            Text::key(C_URI_ALLOWED),
            SettingKind::List {
                default: Vec::new(),
            },
        )
        .describing(Text::key(C_URI_ALLOWED_DESC))
        .grouped(Text::key(C_GROUP_FILES))
        .for_machine(),
    );
    settings.push(
        SettingSpec::new(
            FILES_LINK_STYLE,
            Text::key(C_FILES_LINK_STYLE),
            SettingKind::Choice {
                default: FILES_LINK_WIKI.into(),
                options: vec![
                    UiOption::new(FILES_LINK_WIKI, Text::key(C_FILES_LINK_WIKI)),
                    UiOption::new(FILES_LINK_MARKDOWN, Text::key(C_FILES_LINK_MARKDOWN)),
                ],
            },
        )
        .describing(Text::key(C_FILES_LINK_STYLE_DESC))
        .grouped(Text::key(C_GROUP_FILES)),
    );
    settings.push(
        SettingSpec::new(
            FILES_LINK_FORMAT,
            Text::key(C_FILES_LINK_FORMAT),
            SettingKind::Choice {
                default: FILES_LINK_SHORTEST.into(),
                options: vec![
                    UiOption::new(FILES_LINK_SHORTEST, Text::key(C_FILES_LINK_SHORTEST)),
                    UiOption::new(FILES_LINK_RELATIVE, Text::key(C_FILES_LINK_RELATIVE)),
                    UiOption::new(FILES_LINK_ABSOLUTE, Text::key(C_FILES_LINK_ABSOLUTE)),
                ],
            },
        )
        .describing(Text::key(C_FILES_LINK_FORMAT_DESC))
        .grouped(Text::key(C_GROUP_FILES)),
    );
    settings.push(
        SettingSpec::toggle(FILES_AUTO_REVEAL, Text::key(C_FILES_AUTO_REVEAL), false)
            .describing(Text::key(C_FILES_AUTO_REVEAL_DESC))
            .grouped(Text::key(C_GROUP_FILES))
            .for_machine(),
    );
    // **Non** `program_writable`, ed è la riga che conta: un componente che
    // potesse spegnere gli altri sarebbe un componente con potere di veto su
    // tutto ciò che gli sta accanto — compreso ciò che lo controlla. Chi
    // accende e spegne è la persona davanti allo schermo, e passa dalla shell.
    settings.push(
        SettingSpec::new(
            PLUGINS_DISABLED,
            Text::key(C_PLUGINS_DISABLED),
            SettingKind::List {
                default: Vec::new(),
            },
        )
        .describing(Text::key(C_PLUGINS_DISABLED_DESC))
        .grouped(Text::key(C_GROUP_COMPONENTS)),
    );
    // Lo stato dei componenti che `plugins.disabled` non sa dire. Come lei,
    // **non** `program_writable`: lo scrive soltanto chi accende e spegne.
    settings.extend(components_settings());
    settings.push(history_enabled_spec());
    settings.push(log_level_spec());
    settings.push(log_verbose_spec());
    settings.push(perf_probe_spec());
    settings.push(developer_mode_spec());
    settings.push(developer_theme_folder_spec());
    #[cfg(feature = "http-client")]
    settings.extend(service_settings());
    settings.extend(live_settings());
    settings.extend(viewer_settings());
    settings.push(map_tile_hosts_spec());
    #[cfg(feature = "craft")]
    settings.extend(craft_settings());
    // **Le famiglie del kernel, tutte, e non una a una.** Quelle righe erano
    // quattro `extend` scritti a mano — `locale`, `journal`, `properties`,
    // `ignore` — e ogni chiave del kernel sta là dove sta chi la legge (§11.1):
    // il formato delle date lo legge il parser del frontmatter, quali file sono
    // di questo vault lo legge la scansione. Ciò che *non* era di nessuno era
    // l'elenco: una famiglia nuova che nessuno aggiungeva qui restava senza
    // chiavi nel pannello, chi le legge tornava al default in silenzio, e
    // niente diventava rosso. Adesso l'elenco è
    // [`Famiglia::TUTTE`](fub_kernel::famiglie::Famiglia::TUTTE), e chi ne
    // aggiunge una la aggiunge in un posto solo.
    settings.extend(fub_kernel::families::Family::all_settings());
    // Le scorciatoie dei comandi **della shell** (§16.3). Stanno nel bundle di
    // core per la ragione di `plugins.disabled`: la shell non è una feature e
    // non porta un manifest, quindi l'unico posto in cui può dichiarare è
    // questo. Sono le sole chiavi `keys.*` che il core dichiara — quelle dei
    // comandi del kernel le fabbrica il `Workspace` registrando il provider che
    // le possiede, e queste un provider non ce l'hanno.
    settings.extend(crate::shell::shell_keybinding_specs());
    settings
}

/// Le chiavi di [`core_settings`] che vivono nel **livello macchina**.
///
/// Si ricavano filtrando invece di essere un secondo elenco, e la ragione è
/// quella di sempre: due elenchi della stessa cosa sono due elenchi che nessuno
/// confronta, e il giorno che una famiglia diventa di macchina questo sarebbe
/// l'unico a non saperlo.
pub fn core_machine_settings() -> Vec<SettingSpec> {
    core_settings()
        .into_iter()
        .filter(|spec| spec.scope == fub_abi::settings::SettingScope::Machine)
        .collect()
}

/// Chi scrive (D11 A): il nome della persona, di macchina, e la firma dei
/// commenti scelta per il vault. Nessuna delle due è `program_writable`: il
/// nome che finisce nei file lo sceglie la persona, dalla shell.
pub(super) fn profile_settings() -> Vec<SettingSpec> {
    let [name_choice, initials_choice, none_choice] = COMMENTS_AUTHOR_CHOICES;
    vec![
        SettingSpec::new(
            PROFILE_NAME,
            Text::key(C_PROFILE_NAME),
            SettingKind::Text {
                default: String::new(),
            },
        )
        .describing(Text::key(C_PROFILE_NAME_DESC))
        .grouped(Text::key(C_GROUP_PROFILE))
        .for_machine(),
        SettingSpec::new(
            COMMENTS_AUTHOR,
            Text::key(C_COMMENTS_AUTHOR),
            SettingKind::Choice {
                default: name_choice.into(),
                options: vec![
                    UiOption::new(name_choice, Text::key(C_COMMENTS_AUTHOR_NAME)),
                    UiOption::new(initials_choice, Text::key(C_COMMENTS_AUTHOR_INITIALS)),
                    UiOption::new(none_choice, Text::key(C_COMMENTS_AUTHOR_NONE)),
                ],
            },
        )
        .describing(Text::key(C_COMMENTS_AUTHOR_DESC))
        .grouped(Text::key(C_GROUP_PROFILE)),
    ]
}

/// Tema, contrasto e preferenze di lettura sono della macchina: descrivono la
/// persona davanti allo schermo e restano vere passando da un vault o da un
/// tema all'altro. Il livello macchina le rende leggibili anche prima di aprire
/// un vault.
///
/// **Non** `program_writable`: un tema è reversibile e si vede subito, quindi
/// il danno di un componente che lo cambia è piccolo. La ragione non è il
/// danno, è che *nessuno lo ha chiesto* — il caso vero, «scuro al tramonto», è
/// un pezzo di 6.2, dove si decide se un componente possa avere in mano
/// l'aspetto e con che permesso.
pub(super) fn appearance_settings() -> Vec<SettingSpec> {
    appearance_settings_on(WEBVIEW.get().copied())
}

/// Le chiavi dell'aspetto su una webview data: i test scelgono la webview che
/// il processo, una volta dichiarata, non può più cambiare.
pub(super) fn appearance_settings_on(webview: Option<Webview>) -> Vec<SettingSpec> {
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
        .grouped(Text::key(C_GROUP_APPEARANCE))
        .for_machine()
    };
    let system = || {
        UiOption::new(
            fub_kernel::locale::AS_SYSTEM,
            Text::key(fub_kernel::locale::AS_SYSTEM_KEY),
        )
    };
    let number = |key, label, description, default, min, max| {
        SettingSpec::new(
            key,
            Text::key(label),
            SettingKind::Number {
                default,
                min: Some(min),
                max: Some(max),
            },
        )
        .describing(Text::key(description))
        .grouped(Text::key(C_GROUP_APPEARANCE))
        .for_machine()
    };

    let mut settings = vec![
        choice(
            APPEARANCE_THEME,
            C_THEME,
            C_THEME_DESC,
            fub_kernel::locale::AS_SYSTEM,
            vec![
                system(),
                UiOption::new("light", Text::key(C_THEME_LIGHT)),
                UiOption::new("dark", Text::key(C_THEME_DARK)),
            ],
        ),
        SettingSpec::new(
            APPEARANCE_THEME_ID,
            Text::key(C_THEME_ID),
            SettingKind::Text {
                default: "fub.serie".into(),
            },
        )
        .describing(Text::key(C_THEME_ID_DESC))
        .grouped(Text::key(C_GROUP_APPEARANCE))
        .for_machine(),
        choice(
            APPEARANCE_CONTRAST,
            C_CONTRAST,
            C_CONTRAST_DESC,
            fub_kernel::locale::AS_SYSTEM,
            vec![
                system(),
                UiOption::new("normal", Text::key(C_CONTRAST_NORMAL)),
                UiOption::new("high", Text::key(C_CONTRAST_HIGH)),
            ],
        ),
        number(
            APPEARANCE_ACCENT,
            C_ACCENT,
            C_ACCENT_DESC,
            160.0,
            0.0,
            360.0,
        ),
        choice(
            APPEARANCE_DENSITY,
            C_DENSITY,
            C_DENSITY_DESC,
            "comfortable",
            vec![
                UiOption::new("compact", Text::key(C_DENSITY_COMPACT)),
                UiOption::new("comfortable", Text::key(C_DENSITY_COMFORTABLE)),
                UiOption::new("relaxed", Text::key(C_DENSITY_RELAXED)),
            ],
        ),
        choice(
            APPEARANCE_BARS,
            C_BARS,
            C_BARS_DESC,
            "light",
            vec![
                UiOption::new("light", Text::key(C_BARS_LIGHT)),
                UiOption::new("marked", Text::key(C_BARS_MARKED)),
            ],
        ),
        number(
            CHROME_COMPACTNESS,
            C_COMPACTNESS,
            C_COMPACTNESS_DESC,
            0.0,
            0.0,
            CHROME_COMPACTNESS_MAX,
        ),
        number(APPEARANCE_ZOOM, C_ZOOM, C_ZOOM_DESC, DEFAULT_ZOOM, 0.5, 2.0),
        choice(
            APPEARANCE_MOTION,
            C_MOTION,
            C_MOTION_DESC,
            motion_default(webview),
            vec![
                system(),
                UiOption::new("calm", Text::key(C_MOTION_CALM)),
                UiOption::new("reduced", Text::key(C_MOTION_REDUCED)),
            ],
        ),
        choice(
            APPEARANCE_FRAME_RATE,
            C_FRAME_RATE,
            C_FRAME_RATE_DESC,
            "",
            std::iter::once(UiOption::new("", Text::key(C_FRAME_RATE_DISPLAY)))
                .chain(FRAME_RATE_CAPS.iter().map(|cap| {
                    UiOption::new(
                        cap.to_string(),
                        Text::message(C_FRAME_RATE_CAP, vec![Arg::int("fps", i64::from(*cap))]),
                    )
                }))
                .collect(),
        ),
        choice(
            APPEARANCE_DIAGRAM_STYLE,
            C_DIAGRAM_STYLE,
            C_DIAGRAM_STYLE_DESC,
            DIAGRAM_STYLES[0],
            vec![
                UiOption::new(DIAGRAM_STYLES[0], Text::key(C_DIAGRAM_STYLE_ARMONIA)),
                UiOption::new(DIAGRAM_STYLES[1], Text::key(C_DIAGRAM_STYLE_ACQUERELLO)),
                UiOption::new(DIAGRAM_STYLES[2], Text::key(C_DIAGRAM_STYLE_AURORA)),
                UiOption::new(DIAGRAM_STYLES[3], Text::key(C_DIAGRAM_STYLE_BLUEPRINT)),
                UiOption::new(DIAGRAM_STYLES[4], Text::key(C_DIAGRAM_STYLE_INCHIOSTRO)),
            ],
        ),
        choice(
            APPEARANCE_CONTENT_LOOK,
            C_CONTENT_LOOK,
            C_CONTENT_LOOK_DESC,
            CONTENT_LOOKS[0],
            vec![
                UiOption::new(CONTENT_LOOKS[0], Text::key(C_CONTENT_LOOK_AUTO)),
                UiOption::new(CONTENT_LOOKS[1], Text::key(C_CONTENT_LOOK_FILE)),
                UiOption::new(CONTENT_LOOKS[2], Text::key(C_CONTENT_LOOK_ADAPTED)),
            ],
        ),
        choice(
            APPEARANCE_FONT,
            C_FONT,
            C_FONT_DESC,
            "newsreader",
            vec![
                UiOption::new("newsreader", Text::key(C_FONT_NEWSREADER)),
                UiOption::new("hanken", Text::key(C_FONT_HANKEN)),
                UiOption::new("literata", Text::key(C_FONT_LITERATA)),
                UiOption::new("inter", Text::key(C_FONT_INTER)),
                UiOption::new("system", Text::key(C_FONT_SYSTEM)),
            ],
        ),
        choice(
            APPEARANCE_FONT_UI,
            C_FONT_UI,
            C_FONT_UI_DESC,
            "hanken",
            vec![
                UiOption::new("hanken", Text::key(C_FONT_HANKEN)),
                UiOption::new("inter", Text::key(C_FONT_INTER)),
                UiOption::new("system", Text::key(C_FONT_SYSTEM)),
            ],
        ),
        choice(
            APPEARANCE_FONT_MONO,
            C_FONT_MONO,
            C_FONT_MONO_DESC,
            "plex",
            vec![
                UiOption::new("plex", Text::key(C_FONT_PLEX)),
                UiOption::new("jetbrains", Text::key(C_FONT_JETBRAINS)),
                UiOption::new("system", Text::key(C_FONT_SYSTEM)),
            ],
        ),
        number(APPEARANCE_BODY, C_BODY, C_BODY_DESC, 18.0, 12.0, 28.0),
        number(
            APPEARANCE_LINE_HEIGHT,
            C_LINE_HEIGHT,
            C_LINE_HEIGHT_DESC,
            1.65,
            1.2,
            2.4,
        ),
        number(
            APPEARANCE_MEASURE,
            C_MEASURE,
            C_MEASURE_DESC,
            58.0,
            40.0,
            100.0,
        ),
        SettingSpec::new(
            APPEARANCE_CSS_SNIPPETS,
            Text::key(C_CSS_SNIPPETS),
            SettingKind::Text {
                default: r#"{"version":1,"snippets":[]}"#.into(),
            },
        )
        .describing(Text::key(C_CSS_SNIPPETS_DESC))
        .grouped(Text::key(C_GROUP_APPEARANCE))
        .for_machine(),
    ];
    // Solo dove c'è WebKitGTK: su Windows e macOS la scelta non avrebbe
    // niente da cambiare, e una riga che non fa niente è una riga che mente.
    if cfg!(target_os = "linux") {
        let at = settings
            .iter()
            .position(|spec| spec.key == APPEARANCE_FRAME_RATE)
            .map_or(settings.len(), |index| index + 1);
        settings.insert(
            at,
            choice(
                APPEARANCE_RENDERING,
                C_RENDERING,
                C_RENDERING_DESC,
                RENDERING_MODES[0],
                vec![
                    UiOption::new(RENDERING_MODES[0], Text::key(C_RENDERING_AUTO)),
                    UiOption::new(RENDERING_MODES[1], Text::key(C_RENDERING_GPU)),
                    UiOption::new(RENDERING_MODES[2], Text::key(C_RENDERING_CPU)),
                ],
            ),
        );
    }
    settings
}

pub(super) fn chrome_settings() -> Vec<SettingSpec> {
    let toggle = |key, label, description| {
        SettingSpec::toggle(key, Text::key(label), true)
            .describing(Text::key(description))
            .grouped(Text::key(C_GROUP_CHROME))
            .for_machine()
    };
    vec![
        SettingSpec::new(
            CHROME_SCHEMA,
            Text::key(C_CHROME_SCHEMA),
            SettingKind::Number {
                default: CHROME_SCHEMA_VERSION,
                min: Some(CHROME_SCHEMA_VERSION),
                max: Some(CHROME_SCHEMA_VERSION),
            },
        )
        .describing(Text::key(C_CHROME_SCHEMA_DESC))
        .grouped(Text::key(C_GROUP_CHROME))
        .for_machine(),
        toggle(CHROME_RAIL_VISIBLE, C_CHROME_RAIL, C_CHROME_RAIL_DESC),
        SettingSpec::new(
            CHROME_RAIL_ORDER,
            Text::key(C_CHROME_ORDER),
            SettingKind::List {
                default: vec!["files".into(), "search".into(), "graph".into()],
            },
        )
        .describing(Text::key(C_CHROME_ORDER_DESC))
        .grouped(Text::key(C_GROUP_CHROME))
        .for_machine(),
        SettingSpec::new(
            CHROME_RAIL_HIDDEN,
            Text::key(C_CHROME_HIDDEN),
            SettingKind::List {
                default: Vec::new(),
            },
        )
        .describing(Text::key(C_CHROME_HIDDEN_DESC))
        .grouped(Text::key(C_GROUP_CHROME))
        .for_machine(),
        toggle(
            CHROME_SIDEBAR_VISIBLE,
            C_CHROME_SIDEBAR,
            C_CHROME_SIDEBAR_DESC,
        ),
        toggle(
            CHROME_INSPECTOR_VISIBLE,
            C_CHROME_INSPECTOR,
            C_CHROME_INSPECTOR_DESC,
        ),
        toggle(CHROME_STATUS_VISIBLE, C_CHROME_STATUS, C_CHROME_STATUS_DESC),
        toggle(
            CHROME_TOOLBAR_VISIBLE,
            C_CHROME_TOOLBAR,
            C_CHROME_TOOLBAR_DESC,
        ),
        toggle(
            CHROME_FORMATBAR_VISIBLE,
            C_CHROME_FORMATBAR,
            C_CHROME_FORMATBAR_DESC,
        ),
        SettingSpec::new(
            CHROME_FRAME,
            Text::key(C_CHROME_FRAME),
            SettingKind::Choice {
                default: "custom".into(),
                options: vec![
                    UiOption::new("system", Text::key(C_FRAME_SYSTEM)),
                    UiOption::new("custom", Text::key(C_FRAME_CUSTOM)),
                ],
            },
        )
        .describing(Text::key(C_CHROME_FRAME_DESC))
        .grouped(Text::key(C_GROUP_CHROME))
        .for_machine(),
    ]
}

/// Changing decorations requires rebuilding the native window. The shell must
/// not claim a live frame switch until the platform adapter explicitly applies it.
#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct FrameCapabilities {
    pub system: bool,
    pub custom: bool,
    pub requires_reopen: bool,
}

pub fn frame_capabilities() -> FrameCapabilities {
    let desktop = cfg!(not(any(target_os = "android", target_os = "ios")));
    FrameCapabilities {
        system: desktop,
        custom: desktop,
        requires_reopen: desktop,
    }
}

/// Il tetto in fotogrammi al secondo di un valore di [`APPEARANCE_FRAME_RATE`].
/// `None` è il massimo dello schermo: il default, e anche un valore che non
/// è fra i tetti offerti.
pub fn frame_rate_cap(value: &str) -> Option<u32> {
    value
        .parse()
        .ok()
        .filter(|cap| FRAME_RATE_CAPS.contains(cap))
}

/// I valori di testo di macchina che servono **prima che parta GTK**, letti dal
/// file di macchina senza montare l'host: oggi `appearance.rendering` e
/// `appearance.motion`, per il percorso di disegno di `fub_app::run`.
///
/// Si legge come lo legge l'host: schema del core, profilo attivo, un valore
/// sconosciuto che vale il predefinito, un file assente o illeggibile che vale
/// i predefiniti. Il file non si scrive. Senza cartella di configurazione
/// valgono i predefiniti. Una chiave non dichiarata (`appearance.rendering`
/// fuori da Linux) non compare.
pub fn startup_machine_texts(
    config_dir: Option<&camino::Utf8Path>,
    keys: &[&str],
) -> BTreeMap<String, String> {
    let machine = match config_dir {
        Some(dir) => {
            fub_kernel::MachineSettings::open(&crate::config::machine_settings_path(dir)).0
        }
        None => fub_kernel::MachineSettings::in_memory(),
    };
    if machine.declare(&core_machine_settings()).is_err() {
        return BTreeMap::new();
    }
    keys.iter()
        .filter_map(|key| {
            let (value, _) = machine.effective(key).ok()?;
            Some(((*key).to_owned(), value.as_text()?.to_owned()))
        })
        .collect()
}

pub fn setting_requires_reopen(key: &str) -> bool {
    matches!(key, CHROME_FRAME | CHROME_SCHEMA)
}

/// Le app Craft (N7): dove sono i loro programmi, se Fub può farne avviare la
/// riga di comando per le anteprime, quanto pesa al più un file da leggere
/// intero per l'anteprima, e i due interruttori dell'albero. Tutte di
/// macchina (i programmi e le scelte sono di questo computer e non viaggiano
/// col vault), nel gruppo «App esterne».
#[cfg(feature = "craft")]
pub(super) fn craft_settings() -> Vec<SettingSpec> {
    let external = |spec: SettingSpec, description: &str| {
        spec.describing(Text::key(description))
            .grouped(Text::key(C_GROUP_EXTERNAL_APPS))
            .for_machine()
    };
    vec![
        external(
            SettingSpec::new(
                CRAFT_EDITOR_PATHS,
                Text::key(C_CRAFT_EDITOR_PATHS),
                SettingKind::List {
                    default: Vec::new(),
                },
            ),
            C_CRAFT_EDITOR_PATHS_DESC,
        ),
        // **Non** `program_writable`, ed è la riga che conta, come per
        // `plugins.disabled` e i permessi: accenderla vuol dire lasciare che
        // Fub avvii un programma esterno, e quell'azione la decide la persona
        // davanti allo schermo, dalla shell o dalla CLI di Fub nel suo
        // terminale. Un plugin, un bundle o un comando del registro che
        // potessero accenderla avvierebbero programmi da sé; un vault
        // importato non può, perché la chiave è di macchina.
        external(
            SettingSpec::new(
                CRAFT_CLI_PREVIEWS,
                Text::key(C_CRAFT_CLI_PREVIEWS),
                SettingKind::Choice {
                    default: CRAFT_CLI_PREVIEWS_ASK.into(),
                    options: vec![
                        UiOption::new(CRAFT_CLI_PREVIEWS_ASK, Text::key(C_CRAFT_CLI_PREVIEWS_ASK)),
                        UiOption::new(CRAFT_CLI_PREVIEWS_ON, Text::key(C_CRAFT_CLI_PREVIEWS_ON)),
                        UiOption::new(CRAFT_CLI_PREVIEWS_OFF, Text::key(C_CRAFT_CLI_PREVIEWS_OFF)),
                    ],
                },
            ),
            C_CRAFT_CLI_PREVIEWS_DESC,
        ),
        external(
            SettingSpec::new(
                CRAFT_PREVIEW_MAX_MIB,
                Text::key(C_CRAFT_PREVIEW_MAX_MIB),
                SettingKind::Number {
                    default: CRAFT_PREVIEW_MAX_MIB_DEFAULT,
                    min: Some(CRAFT_PREVIEW_MAX_MIB_MIN),
                    max: Some(CRAFT_PREVIEW_MAX_MIB_MAX),
                },
            ),
            C_CRAFT_PREVIEW_MAX_MIB_DESC,
        ),
        external(
            SettingSpec::toggle(
                CRAFT_TREE_THUMBNAILS,
                Text::key(C_CRAFT_TREE_THUMBNAILS),
                false,
            ),
            C_CRAFT_TREE_THUMBNAILS_DESC,
        ),
        external(
            SettingSpec::toggle(CRAFT_TREE_SHOW_XMP, Text::key(C_CRAFT_TREE_SHOW_XMP), true),
            C_CRAFT_TREE_SHOW_XMP_DESC,
        ),
    ]
}

#[cfg(feature = "http-client")]
pub(super) fn service_settings() -> Vec<SettingSpec> {
    vec![
        SettingSpec::new(
            SYNC_SERVER_URL,
            Text::key(C_SYNC_SERVER_URL),
            SettingKind::Text {
                default: String::new(),
            },
        )
        .describing(Text::key(C_SYNC_SERVER_URL_DESC))
        .grouped(Text::key(C_GROUP_SYNC))
        .for_machine(),
        SettingSpec::toggle(SYNC_PAUSED, Text::key(C_SYNC_PAUSED), false)
            .describing(Text::key(C_SYNC_PAUSED_DESC))
            .grouped(Text::key(C_GROUP_SYNC))
            .for_machine(),
        SettingSpec::new(
            SYNC_EXCLUDE,
            Text::key(C_SYNC_EXCLUDE),
            SettingKind::List {
                default: Vec::new(),
            },
        )
        .describing(Text::key(C_SYNC_EXCLUDE_DESC))
        .grouped(Text::key(C_GROUP_SYNC))
        .for_machine(),
        SettingSpec::new(
            PUBLISH_SERVER_URL,
            Text::key(C_PUBLISH_SERVER_URL),
            SettingKind::Text {
                default: String::new(),
            },
        )
        .describing(Text::key(C_PUBLISH_SERVER_URL_DESC))
        .grouped(Text::key(C_GROUP_PUBLISH))
        .for_machine(),
    ]
}

/// **Il cancello della persona**: le chiavi il cui valore ha una forma che la
/// specie dello schema non sa dire, controllata prima che arrivi al suo livello.
///
/// Lo schema dice «testo» per un fuso e per un indirizzo, e il kernel accetta
/// quindi qualunque testo; chi sa se un nome è un fuso, o un testo un indirizzo
/// a cui l'host accetta di collegarsi, è l'host — il database dei fusi sta in
/// [`crate::wall`], la regola degli indirizzi in
/// [`validate_base_url`](crate::remote::validate_base_url). Senza questo
/// cancello `Mars/Olympus` si salvava, e le sveglie a un orario di parete
/// smettevano di suonare senza che nessuno lo dicesse; un server di
/// sincronizzazione `ftp://…` si salvava, e falliva soltanto alla prima replica.
///
/// Vuoto resta ammesso: per il fuso vuol dire «come il sistema», per un server
/// «nessun server configurato». Il rifiuto è un [`PluginError::BadArgs`] con una
/// chiave del catalogo del core, che chi lo porta alla shell risolve nella
/// lingua di chi guarda.
pub fn user_value_problem(
    key: &str,
    value: &fub_abi::settings::SettingValue,
) -> Option<fub_abi::PluginError> {
    if key == crate::map_tiles::MAP_TILE_HOSTS {
        let fub_abi::settings::SettingValue::List(hosts) = value else {
            return None;
        };
        let wrong = hosts
            .iter()
            .find(|host| !crate::map_tiles::is_host_name(host.trim()))?;
        return Some(fub_abi::PluginError::BadArgs(Text::message(
            C_REJECTED_TILE_HOST,
            vec![Arg::text("value", wrong)],
        )));
    }
    let text = value.as_text()?;
    if key == fub_kernel::locale::TIMEZONE {
        if text.is_empty() || crate::wall::known_zone(text) {
            return None;
        }
        return Some(fub_abi::PluginError::BadArgs(Text::message(
            C_REJECTED_TIMEZONE,
            vec![Arg::text("name", text)],
        )));
    }
    #[cfg(feature = "http-client")]
    if key == SYNC_SERVER_URL || key == PUBLISH_SERVER_URL {
        if text.trim().is_empty() || crate::remote::validate_base_url(text).is_ok() {
            return None;
        }
        return Some(fub_abi::PluginError::BadArgs(Text::message(
            C_REJECTED_SERVER_URL,
            vec![Arg::text("value", text)],
        )));
    }
    None
}

/// Il visore web: di macchina, perché fidarsi di un sito è una scelta di chi
/// usa questo PC, non un dato del vault che si sincronizza altrove.
pub(super) fn viewer_settings() -> Vec<SettingSpec> {
    vec![
        SettingSpec::new(
            crate::web_clip::VIEWER_HOSTS,
            Text::key(C_VIEWER_HOSTS),
            SettingKind::List {
                default: Vec::new(),
            },
        )
        .describing(Text::key(C_VIEWER_HOSTS_DESC))
        .grouped(Text::key(C_GROUP_VIEWER))
        .for_machine(),
        SettingSpec::toggle(
            crate::web_clip::VIEWER_LINKS,
            Text::key(C_VIEWER_LINKS),
            false,
        )
        .describing(Text::key(C_VIEWER_LINKS_DESC))
        .grouped(Text::key(C_GROUP_VIEWER))
        .for_machine(),
    ]
}

/// Gli host delle tessere della vista Mappa: di macchina, perché far uscire
/// una richiesta è una scelta di chi usa questo PC — un vault scaricato non
/// la porta con sé. Vuota di serie: nessuna richiesta senza un sì. Non
/// `program_writable`: un componente non si apre la rete da solo. Nella
/// Privacy, accanto a ciò che decide cosa lascia la macchina.
pub(super) fn map_tile_hosts_spec() -> SettingSpec {
    SettingSpec::new(
        crate::map_tiles::MAP_TILE_HOSTS,
        Text::key(C_MAP_TILE_HOSTS),
        SettingKind::List {
            default: Vec::new(),
        },
    )
    .describing(Text::key(C_MAP_TILE_HOSTS_DESC))
    .grouped(Text::key(C_GROUP_PRIVACY))
    .for_machine()
}

/// La sessione live: di macchina, perché la porta è una regola del firewall di
/// questo PC e non di un vault.
pub(super) fn live_settings() -> Vec<SettingSpec> {
    vec![SettingSpec::new(
        LIVE_PORT,
        Text::key(C_LIVE_PORT),
        SettingKind::Number {
            default: 0.0,
            min: Some(0.0),
            max: Some(f64::from(u16::MAX)),
        },
    )
    .describing(Text::key(C_LIVE_PORT_DESC))
    .grouped(Text::key(C_GROUP_LIVE))
    .for_machine()]
}

/// La porta di [`LIVE_PORT`] da un valore della macchina: 0, cioè una porta
/// libera, se la chiave manca o il valore non è un intero da 0 a 65535.
pub fn live_port(value: Option<f64>) -> u16 {
    value
        .filter(|port| port.fract() == 0.0 && (0.0..=f64::from(u16::MAX)).contains(port))
        .map_or(0, |port| port as u16)
}

/// La memoria di ciò che si è cercato e aperto come [`SettingSpec`] (§21.7).
///
/// **Non** `program_writable`, e qui la ragione non è la reversibilità: è la
/// riga della [0036](../../../docs/decisions/0192-impostazioni-locale-e-temi.md)
/// che il §11 ha messo per iscritto — *le impostazioni di privacy e dell'AI non
/// stanno fra quelle*. Un componente che potesse riaccendere da sé la memoria di
/// cosa cerchi è un componente che si allarga i permessi, e la differenza col
/// tema è che qui il danno non si vede: un tema cambiato lo si nota al prossimo
/// sguardo, una cronologia riaccesa la si scopre quando è già lunga.
///
/// **Accesa** di default, ed è una scelta e non un'inerzia. Il dato non lascia
/// la macchina — vive nello stato di vista della shell, che sta nella cartella
/// di configurazione e non nel vault, quindi non entra in un sync né in un
/// repo — c'è un interruttore, e c'è un gesto che la cancella. L'opt-in è la
/// forma giusta quando un dato *esce*; qui non esce, e una memoria spenta di
/// default sarebbe una funzione che nessuno trova e che quindi tanto vale non
/// scrivere.
///
/// Del **vault** e non di macchina, come ogni altra preferenza dopo la
/// [0076](../../../docs/decisions/0192-impostazioni-locale-e-temi.md): chi
/// dice «di questo vault non tenere traccia» lo dice del vault — è la proprietà
/// dell'archivio, non del computer da cui lo si apre — e una scelta di privacy
/// che vale su un portatile e non sull'altro è una scelta che non protegge.
/// L'interruttore viaggia; ciò che governa no.
pub(super) fn history_enabled_spec() -> SettingSpec {
    SettingSpec::toggle(HISTORY_ENABLED, Text::key(C_HISTORY), true)
        .describing(Text::key(C_HISTORY_DESC))
        .grouped(Text::key(C_GROUP_PRIVACY))
}

/// Il livello del log come [`SettingSpec`] (§17.3). Le opzioni nascono dal
/// [`Level::ALL`](fub_kernel::log::Level::ALL) del kernel, e non da un elenco
/// scritto qui a mano, per la stessa ragione per cui le feature ufficiali stanno
/// in un inventario: due elenchi della stessa cosa sono due elenchi che nessuno
/// confronta, e il giorno che si aggiunge un gradino quello qui sotto sarebbe
/// l'unico a non saperlo.
pub(super) fn log_level_spec() -> SettingSpec {
    SettingSpec::new(
        LOG_LEVEL,
        Text::key(C_LOG_LEVEL),
        SettingKind::Choice {
            default: fub_kernel::log::Level::default().as_str().into(),
            options: fub_kernel::log::Level::ALL
                .iter()
                .map(|level| {
                    UiOption::new(
                        level.as_str(),
                        Text::key(format!("{C_LOG_LEVEL}{}", level.as_str())),
                    )
                })
                .collect(),
        },
    )
    .describing(Text::key(C_LOG_LEVEL_DESC))
    .grouped(Text::key(C_GROUP_DIAGNOSTICS))
    // Di macchina: vedi [`LOG_LEVEL`].
    .for_machine()
}

/// I componenti verbosi come [`SettingSpec`] (§17.3).
pub(super) fn log_verbose_spec() -> SettingSpec {
    SettingSpec::new(
        LOG_VERBOSE,
        Text::key(C_LOG_VERBOSE),
        SettingKind::List {
            default: Vec::new(),
        },
    )
    .describing(Text::key(C_LOG_VERBOSE_DESC))
    .grouped(Text::key(C_GROUP_DIAGNOSTICS))
    .for_machine()
}

/// La sonda delle prestazioni come [`SettingSpec`]: vedi [`PERF_PROBE`].
pub(super) fn perf_probe_spec() -> SettingSpec {
    SettingSpec::new(
        PERF_PROBE,
        Text::key(C_PERF_PROBE),
        SettingKind::Toggle { default: false },
    )
    .describing(Text::key(C_PERF_PROBE_DESC))
    .grouped(Text::key(C_GROUP_DIAGNOSTICS))
    .for_machine()
}

/// La modalità sviluppatore come [`SettingSpec`]: vedi [`DEVELOPER_MODE`].
pub(super) fn developer_mode_spec() -> SettingSpec {
    SettingSpec::new(
        DEVELOPER_MODE,
        Text::key(C_DEVELOPER_MODE),
        SettingKind::Toggle { default: false },
    )
    .describing(Text::key(C_DEVELOPER_MODE_DESC))
    .grouped(Text::key(C_GROUP_DEVELOPMENT))
    .for_machine()
}

/// La cartella collegata come [`SettingSpec`]: vedi [`DEVELOPER_THEME_FOLDER`].
pub(super) fn developer_theme_folder_spec() -> SettingSpec {
    SettingSpec::new(
        DEVELOPER_THEME_FOLDER,
        Text::key(C_DEVELOPER_THEME_FOLDER),
        SettingKind::Text {
            default: String::new(),
        },
    )
    .describing(Text::key(C_DEVELOPER_THEME_FOLDER_DESC))
    .grouped(Text::key(C_GROUP_DEVELOPMENT))
    .for_machine()
}

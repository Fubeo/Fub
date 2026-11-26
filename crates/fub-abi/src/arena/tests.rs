use super::*;
use crate::model::{
    Block as B, ColumnAlign, Inline as I, LinkTarget, ListItem as LI, Span as S, TableCell,
    TableRow as TR, TaskMarker,
};
use crate::ui::{
    ActionRef, Align, Axis, Intent, KeyValueEntry, TableColumn, UiKind, UiNode as U, UiOption,
};

/// Un corpo che tocca ogni variante e annida a più livelli: se il
/// round-trip regge qui, regge.
fn body() -> Vec<B> {
    vec![
        B::Heading {
            level: 2,
            inlines: vec![
                I::Text("Title with ".into()),
                I::Strong(vec![I::Emph(vec![I::Text("emphasis".into())])]),
            ],
            anchor: Some("title-with-emphasis".into()),
            span: S::new(0, 30),
            explicit_anchor: None,
        },
        B::Paragraph {
            inlines: vec![
                I::Code("code".into()),
                I::Link {
                    target: LinkTarget::wiki("Other"),
                    label: Some(vec![I::Text("label".into())]),
                    embed: false,
                    span: S::new(31, 60),
                },
                I::Link {
                    target: LinkTarget::Url("https://example".into()),
                    label: None,
                    embed: false,
                    span: S::new(61, 80),
                },
                I::Link {
                    target: LinkTarget::Path("attachments/photo.png".into()),
                    label: None,
                    embed: true,
                    span: S::new(81, 90),
                },
                I::TagRef {
                    name: "tag/nested".into(),
                    span: S::new(91, 94),
                },
                I::Custom {
                    custom_kind: "math-inline".into(),
                    attrs: serde_json::json!({"tex": "x^2"}),
                    span: S::new(95, 105),
                },
            ],
            anchor: Some("block-1".into()),
            span: S::new(31, 105),
        },
        B::List {
            ordered: true,
            items: vec![
                LI {
                    blocks: vec![B::Paragraph {
                        inlines: vec![I::Text("first".into())],
                        anchor: None,
                        span: S::new(106, 113),
                    }],
                    task: Some(TaskMarker {
                        symbol: Some('x'),
                        span: S::new(108, 111),
                    }),
                    span: S::new(106, 113),
                },
                LI {
                    blocks: vec![
                        B::Paragraph {
                            inlines: vec![I::Text("second".into())],
                            anchor: None,
                            span: S::new(114, 123),
                        },
                        B::Quote {
                            blocks: vec![B::ThematicBreak {
                                anchor: None,
                                span: S::new(124, 127),
                            }],
                            anchor: None,
                            span: S::new(124, 128),
                        },
                    ],
                    task: Some(TaskMarker {
                        symbol: None,
                        span: S::new(116, 119),
                    }),
                    span: S::new(114, 128),
                },
                LI {
                    blocks: vec![B::Paragraph {
                        inlines: vec![I::Text("not a task".into())],
                        anchor: None,
                        span: S::new(129, 145),
                    }],
                    task: None,
                    span: S::new(129, 145),
                },
            ],
            anchor: None,
            span: S::new(106, 145),
            start: Some(1),
        },
        B::CodeBlock {
            lang: Some("rust".into()),
            code: "fn main() {}".into(),
            anchor: None,
            span: S::new(146, 160),
        },
        B::Table {
            head: Some(TR {
                cells: vec![
                    TableCell {
                        inlines: vec![I::Text("a".into())],
                        span: S::new(161, 164),
                    },
                    TableCell {
                        inlines: vec![I::Strong(vec![I::Text("b".into())])],
                        span: S::new(165, 170),
                    },
                ],
            }),
            rows: vec![TR {
                cells: vec![TableCell {
                    inlines: vec![I::Link {
                        target: LinkTarget::wiki("Note"),
                        label: None,
                        embed: false,
                        span: S::new(171, 179),
                    }],
                    span: S::new(171, 180),
                }],
            }],
            align: vec![ColumnAlign::Left, ColumnAlign::None],
            anchor: Some("table".into()),
            span: S::new(161, 181),
        },
        B::Custom {
            custom_kind: "callout".into(),
            attrs: serde_json::json!({"type": "note"}),
            blocks: vec![B::Paragraph {
                inlines: vec![I::Text("inside the callout".into())],
                anchor: None,
                span: S::new(190, 200),
            }],
            anchor: None,
            span: S::new(182, 201),
        },
    ]
}

/// Un albero che contiene **ogni** specie di nodo.
///
/// Il round-trip qui sotto è il presidio della conversione albero↔arena, e
/// vale quanto è larga questa fixture: il `match` esaustivo garantisce che
/// una variante nuova non si possa dimenticare, non che i suoi campi siano
/// mappati sul campo giusto. Con trentatré varianti, un `label` copiato al
/// posto di un `title` è l'errore che si fa davvero — e senza un campione
/// per variante non lo vedrebbe nessuno.
fn ui_tree_fixture() -> U {
    let action = || Some(ActionRef::with("open", serde_json::json!({"doc": "a.md"})));
    U::stack(
        Axis::Column,
        6,
        vec![
            U::heading(3, "3 backlink"),
            U::list(vec![
                U::list_item("Note", Some("context".into()), action())
                    .with_key("a.md")
                    .dragging_document(crate::model::DocId::new("a.md")),
                U::list_item("No action", None, None),
            ]),
            U::button("Do", Intent::Danger, ActionRef::new("do")),
            U::new(UiKind::Html {
                html: "<b>trusted</b>".into(),
            }),
            U::new(UiKind::WebView {
                url: "https://example".into(),
                height: 200,
            }),
            U::new(UiKind::Section {
                title: "Section".into(),
                collapsed: true,
                children: vec![U::text("inside")],
            }),
            U::new(UiKind::Table {
                columns: vec![
                    TableColumn::new("Note"),
                    TableColumn::aligned("Words", Align::End),
                ],
                rows: vec![U::keyed(
                    "a.md",
                    UiKind::Row {
                        cells: vec![U::text("Note"), U::text("42")],
                        action: action(),
                    },
                )],
            }),
            U::new(UiKind::Tree {
                roots: vec![U::new(UiKind::TreeItem {
                    label: "folder".into(),
                    expanded: true,
                    action: None,
                    selected: false,
                    children: vec![U::new(UiKind::TreeItem {
                        label: "note".into(),
                        expanded: false,
                        action: action(),
                        selected: true,
                        children: vec![],
                    })],
                })],
            }),
            U::new(UiKind::Tabs {
                active: 1,
                tabs: vec![
                    U::new(UiKind::Tab {
                        label: "One".into(),
                        action: None,
                        children: vec![U::text("first")],
                    }),
                    U::new(UiKind::Tab {
                        label: "Two".into(),
                        action: Some(ActionRef::new("tab:2")),
                        children: vec![U::text("second")],
                    }),
                ],
            }),
            U::badge("draft", Intent::Neutral),
            U::new(UiKind::Icon {
                name: "search".into(),
            }),
            U::new(UiKind::Progress {
                value: Some(0.25),
                label: Some("index".into()),
            }),
            U::separator(),
            U::new(UiKind::EmptyState {
                title: "Nothing here".into(),
                detail: Some("Create the first note".into()),
                action: action(),
            }),
            U::new(UiKind::KeyValue {
                entries: vec![KeyValueEntry {
                    label: "Words".into(),
                    value: "42".into(),
                }],
            }),
            U::new(UiKind::Form {
                children: vec![
                    U::new(UiKind::TextInput {
                        field: "title".into(),
                        label: Some("Title".into()),
                        value: "New".into(),
                        placeholder: Some("untitled".into()),
                        action: None,
                    }),
                    U::new(UiKind::TextArea {
                        field: "body".into(),
                        label: None,
                        value: "text".into(),
                        rows: 4,
                        action: action(),
                    }),
                    U::new(UiKind::Number {
                        field: "weight".into(),
                        label: Some("Weight".into()),
                        value: Some(1.5),
                        min: Some(0.0),
                        max: Some(10.0),
                        step: Some(0.5),
                        action: None,
                    }),
                    U::new(UiKind::Checkbox {
                        field: "pinned".into(),
                        label: "Pinned".into(),
                        value: true,
                        action: None,
                    }),
                    U::new(UiKind::Select {
                        field: "folder".into(),
                        label: Some("Folder".into()),
                        value: vec!["journal".into()],
                        options: vec![
                            UiOption::new("journal", "Journal"),
                            UiOption::new("notes", "Notes"),
                        ],
                        multiple: false,
                        action: None,
                    }),
                    U::new(UiKind::Radio {
                        field: "order".into(),
                        label: None,
                        value: Some("date".into()),
                        options: vec![UiOption::new("date", "by date")],
                        action: None,
                    }),
                    U::new(UiKind::Slider {
                        field: "threshold".into(),
                        label: Some("Threshold".into()),
                        value: 0.5,
                        min: 0.0,
                        max: 1.0,
                        step: 0.1,
                        action: None,
                    }),
                    U::new(UiKind::DatePicker {
                        field: "when".into(),
                        label: None,
                        value: Some("2026-07-26".into()),
                        action: None,
                    }),
                ],
                submit_label: "Save".into(),
                submit: ActionRef::with("save", serde_json::json!({"doc": "a.md"})),
            }),
            U::new(UiKind::Custom {
                ns: "fub.graph".into(),
                payload: serde_json::json!({"nodes": 3}),
                fallback: vec![U::text("the graph, in words")],
            }),
            U::pending(Some("payload".into())),
            U::failed("I did not make it", Some(ActionRef::new("retry"))),
            U::text("queue"),
        ],
    )
}

#[test]
fn document_tree_round_trip_is_the_identity() {
    let body = body();
    let tree = DocumentTree::flatten(&body);
    assert_eq!(tree.rebuild().expect("valid arena"), body);
}

#[test]
fn ui_tree_round_trip_is_the_identity() {
    let root = ui_tree_fixture();
    let tree = UiTree::flatten(&root);
    assert_eq!(tree.rebuild().expect("valid arena"), root);
}

#[test]
fn an_empty_body_is_an_empty_arena() {
    let tree = DocumentTree::flatten(&[]);
    assert!(tree.blocks.is_empty() && tree.inlines.is_empty() && tree.roots.is_empty());
    assert_eq!(tree.rebuild().unwrap(), Vec::<B>::new());
}

#[test]
fn every_child_is_interned_before_its_parent() {
    // Post-order: un nodo non può riferire un indice più grande del proprio,
    // ed è ciò che rende impossibile costruire un ciclo appiattendo.
    let tree = DocumentTree::flatten(&body());
    for (the, block) in tree.blocks.iter().enumerate() {
        let children: Vec<BlockRef> = match block {
            Block::Quote { blocks, .. } | Block::Custom { blocks, .. } => blocks.clone(),
            Block::List { items, .. } => items
                .iter()
                .flat_map(|it| it.blocks.iter())
                .copied()
                .collect(),
            _ => Vec::new(),
        };
        for f in children {
            assert!(
                f.at() < the,
                "block {the} references {f:?}, which has not been interned yet"
            );
        }
    }
}

#[test]
fn an_index_out_of_range_is_an_error_not_a_panic() {
    let mut tree = DocumentTree::flatten(&body());
    tree.roots.push(BlockRef(9_999));
    assert!(matches!(
        tree.rebuild(),
        Err(ArenaError::OutOfRange { index: 9_999, .. })
    ));

    // Anche dentro un nodo, non solo fra le radici.
    let mut tree = DocumentTree::flatten(&body());
    tree.blocks.push(Block::Quote {
        blocks: vec![BlockRef(7_777)],
        anchor: None,
        span: Span::default(),
    });
    let at = BlockRef(next_index(tree.blocks.len()) - 1);
    tree.roots = vec![at];
    assert!(matches!(
        tree.rebuild(),
        Err(ArenaError::OutOfRange { index: 7_777, .. })
    ));

    // E negli inline, che hanno un'arena loro.
    let mut tree = DocumentTree::flatten(&body());
    tree.blocks.push(Block::Paragraph {
        inlines: vec![InlineRef(4_242)],
        anchor: None,
        span: Span::default(),
    });
    tree.roots = vec![BlockRef(next_index(tree.blocks.len()) - 1)];
    assert!(matches!(
        tree.rebuild(),
        Err(ArenaError::OutOfRange { index: 4_242, .. })
    ));

    let tree = UiTree {
        nodes: Vec::new(),
        root: UiRef(0),
    };
    assert!(matches!(
        tree.rebuild(),
        Err(ArenaError::OutOfRange {
            index: 0,
            len: 0,
            ..
        })
    ));
}

#[test]
fn a_cycle_is_an_error_not_a_hang() {
    // Un blocco che contiene se stesso: appiattendo non può nascere, ma
    // arriva da fuori — ed è la ragione per cui `rebuild` non si fida.
    let tree = DocumentTree {
        blocks: vec![Block::Quote {
            blocks: vec![BlockRef(0)],
            anchor: None,
            span: Span::default(),
        }],
        inlines: Vec::new(),
        roots: vec![BlockRef(0)],
    };
    assert!(matches!(
        tree.rebuild(),
        Err(ArenaError::Cycle { index: 0, .. })
    ));

    // Anche attraverso una voce di lista, che dalla decisione 0003 è un record e non
    // più una `Vec` nuda: il `path` deve attraversarla.
    let tree = DocumentTree {
        blocks: vec![Block::List {
            ordered: false,
            items: vec![ListItem {
                blocks: vec![BlockRef(0)],
                task: None,
                span: Span::default(),
            }],
            anchor: None,
            span: Span::default(),
            start: None,
        }],
        inlines: Vec::new(),
        roots: vec![BlockRef(0)],
    };
    assert!(matches!(
        tree.rebuild(),
        Err(ArenaError::Cycle { index: 0, .. })
    ));

    let tree = DocumentTree {
        blocks: vec![Block::Paragraph {
            inlines: vec![InlineRef(0)],
            anchor: None,
            span: Span::default(),
        }],
        inlines: vec![Inline::Emph(vec![InlineRef(0)])],
        roots: vec![BlockRef(0)],
    };
    assert!(matches!(
        tree.rebuild(),
        Err(ArenaError::Cycle { index: 0, .. })
    ));

    let tree = UiTree {
        nodes: vec![UiNode {
            key: None,
            kind: crate::arena::UiKind::Stack {
                dir: Axis::Row,
                gap: 0,
                children: vec![UiRef(0)],
            },
            drag: None,
        }],
        root: UiRef(0),
    };
    assert!(matches!(
        tree.rebuild(),
        Err(ArenaError::Cycle { index: 0, .. })
    ));
}

/// Una catena lunga senza cicli, arrivata dal confine: ricostruirla
/// ricorreva un livello per nodo e la pila dell'host finiva. Oltre il
/// tetto è un errore tipizzato, fino al tetto si ricostruisce.
#[test]
fn a_chain_deeper_than_the_limit_is_an_error_not_a_stack_overflow() {
    let quotes = |levels: u32| DocumentTree {
        blocks: (0..levels)
            .map(|at| Block::Quote {
                blocks: if at + 1 < levels {
                    vec![BlockRef(at + 1)]
                } else {
                    Vec::new()
                },
                anchor: None,
                span: Span::default(),
            })
            .collect(),
        inlines: Vec::new(),
        roots: vec![BlockRef(0)],
    };
    assert!(quotes(MAX_ARENA_DEPTH).rebuild().is_ok());
    assert!(matches!(
        quotes(MAX_ARENA_DEPTH + 1).rebuild(),
        Err(ArenaError::TooDeep { .. })
    ));
    let deep = quotes(200_000);
    let outcome = std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(move || deep.rebuild().map(|_| ()))
        .unwrap()
        .join()
        .expect("la ricostruzione non cade");
    assert!(matches!(outcome, Err(ArenaError::TooDeep { .. })));

    let emphases = DocumentTree {
        blocks: vec![Block::Paragraph {
            inlines: vec![InlineRef(0)],
            anchor: None,
            span: Span::default(),
        }],
        inlines: (0..200_000u32)
            .map(|at| Inline::Emph(vec![InlineRef(at + 1)]))
            .chain(std::iter::once(Inline::HardBreak))
            .collect(),
        roots: vec![BlockRef(0)],
    };
    assert!(matches!(
        emphases.rebuild(),
        Err(ArenaError::TooDeep { .. })
    ));

    let stacks = UiTree {
        nodes: (0..200_000u32)
            .map(|at| UiNode {
                key: None,
                kind: crate::arena::UiKind::Stack {
                    dir: Axis::Row,
                    gap: 0,
                    children: vec![UiRef(at + 1)],
                },
                drag: None,
            })
            .chain(std::iter::once(UiNode {
                key: None,
                kind: crate::arena::UiKind::Pending { label: None },
                drag: None,
            }))
            .collect(),
        root: UiRef(0),
    };
    assert!(matches!(stacks.rebuild(), Err(ArenaError::TooDeep { .. })));
}

#[test]
fn the_same_subtree_twice_is_not_a_cycle() {
    // Due riferimenti allo stesso nodo (un DAG) non sono un ciclo: si
    // ricostruisce due volte. Il rilevamento guarda il *percorso*, non
    // l'insieme dei visitati — confonderli rifiuterebbe arene legittime.
    let tree = DocumentTree {
        blocks: vec![
            Block::ThematicBreak {
                anchor: None,
                span: Span::default(),
            },
            Block::Quote {
                blocks: vec![BlockRef(0), BlockRef(0)],
                anchor: None,
                span: Span::default(),
            },
        ],
        inlines: Vec::new(),
        roots: vec![BlockRef(1)],
    };
    let rebuilt = tree.rebuild().expect("a DAG is reconstructible");
    assert_eq!(
        rebuilt,
        vec![B::Quote {
            blocks: vec![
                B::ThematicBreak {
                    anchor: None,
                    span: S::EMPTY
                },
                B::ThematicBreak {
                    anchor: None,
                    span: S::EMPTY
                }
            ],
            anchor: None,
            span: S::EMPTY,
        }]
    );
}

#[test]
fn span_crosses_and_comes_back_unchanged() {
    for native in [S::EMPTY, S::new(0, 1), S::new(1_234, 5_678)] {
        let wide: Span = native.into();
        assert_eq!(wide.start as usize, native.start);
        assert_eq!(model::Span::try_from(wide).unwrap(), native);
    }
    // E il limite della piattaforma: su 64 bit ci sta tutto, su wasm32 no.
    let huge = Span {
        start: 0,
        end: u64::MAX,
    };
    match model::Span::try_from(huge) {
        Ok(s) => assert_eq!(s.end, usize::MAX, "on 64-bit u64::MAX fits in usize"),
        Err(and) => assert_eq!(and, ArenaError::SpanTooWide { value: u64::MAX }),
    }
}

#[test]
fn spans_survive_the_whole_round_trip() {
    // Non basta che gli span convertano: devono restare attaccati al nodo
    // giusto dopo l'appiattimento, che riordina tutto.
    let body = body();
    let tree = DocumentTree::flatten(&body);
    let rebuilt = tree.rebuild().unwrap();
    let spans = |bs: &[B]| -> Vec<(usize, usize)> {
        bs.iter().map(|b| (b.span().start, b.span().end)).collect()
    };
    assert_eq!(spans(&body), spans(&rebuilt));
}

/// Le forme nuove della decisione 0003 attraversano e tornano: lo stato di una task, il
/// suo marcatore, l'ancora di un blocco, le celle di una tabella.
#[test]
fn tasks_anchors_and_tables_survive_the_boundary() {
    let tree = DocumentTree::flatten(&body());
    let rebuilt = tree.rebuild().unwrap();

    let B::List { items, .. } = &rebuilt[2] else {
        panic!("the third root is a list");
    };
    assert_eq!(
        items
            .iter()
            .map(|the| the.task.map(|t| t.checked()))
            .collect::<Vec<_>>(),
        vec![Some(true), Some(false), None]
    );
    assert_eq!(items[1].task.unwrap().span, S::new(116, 119));

    assert_eq!(rebuilt[0].anchor(), Some("title-with-emphasis"));
    assert_eq!(rebuilt[1].anchor(), Some("block-1"));
    assert_eq!(rebuilt[3].anchor(), None);

    let B::Table {
        head, rows, align, ..
    } = &rebuilt[4]
    else {
        panic!("the fifth root is a table");
    };
    assert_eq!(head.as_ref().unwrap().cells.len(), 2);
    assert_eq!(align, &vec![ColumnAlign::Left, ColumnAlign::None]);
    assert_eq!(
        rows[0].cells[0].inlines,
        vec![I::Link {
            target: LinkTarget::wiki("Note"),
            label: None,
            embed: false,
            span: S::new(171, 179),
        }]
    );
}

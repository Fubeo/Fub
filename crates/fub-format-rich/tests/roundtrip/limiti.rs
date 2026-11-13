//! Limiti e rifiuti: proiezioni malformate, dati opachi, file che non sono Word,
//! documenti aperti in sola lettura.

use super::*;

#[test]
fn un_documento_che_si_scrive_non_dice_che_cosa_manca() {
    let opened = open(Codec::Docx, &bytes(&sample())).unwrap();
    assert_eq!(opened.readonly, None);
    assert!(Projection::from_json(&opened.projection)
        .unwrap()
        .missing
        .is_empty());
}

#[test]
fn una_proiezione_malformata_è_rifiutata_con_la_sua_specie() {
    let file = bytes(&sample());
    let opened = open(Codec::Docx, &file).unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&opened.projection).unwrap();
    value["version"] = 5.into();
    assert_eq!(
        save(Codec::Docx, &file, &value.to_string()),
        Err(RichError::Version(5))
    );
    // Un Fub più nuovo aggiunge campi: la versione si legge prima del resto.
    value["campo_futuro"] = true.into();
    value["blocks"][0]["nuovo"] = 1.into();
    assert_eq!(
        save(Codec::Docx, &file, &value.to_string()),
        Err(RichError::Version(5))
    );
    value["version"] = 4.into();
    value["opaque_schema"] = 999.into();
    assert_eq!(
        save(Codec::Docx, &file, &value.to_string()),
        Err(RichError::OpaqueSchema(999))
    );
    value["opaque_schema"] = OPAQUE_SCHEMA.into();
    value.as_object_mut().unwrap().remove("campo_futuro");
    value["blocks"][0].as_object_mut().unwrap().remove("nuovo");
    value["inatteso"] = true.into();
    assert!(matches!(
        save(Codec::Docx, &file, &value.to_string()),
        Err(RichError::Malformed(_))
    ));

    let mut p = projection(&file);
    let Inline::Text { x, .. } = &mut para_mut(&mut p, 1).c[0] else {
        panic!()
    };
    x.push('\u{FFFC}');
    assert!(matches!(
        save(Codec::Docx, &file, &p.to_json().unwrap()),
        Err(RichError::Malformed(_))
    ));
}

#[test]
fn la_proiezione_dichiara_lo_schema_dei_dati_opachi() {
    let file = bytes(&sample());
    let opened = open(Codec::Docx, &file).unwrap();
    let mut value: serde_json::Value = serde_json::from_str(&opened.projection).unwrap();
    assert_eq!(value["version"], fub_format_rich::projection::VERSION);
    assert_eq!(value["opaque_schema"], OPAQUE_SCHEMA);
    let edited = |value: &serde_json::Value| {
        let mut p = Projection::from_json(&value.to_string()).unwrap();
        let Inline::Text { x, .. } = &mut para_mut(&mut p, 1).c[0] else {
            panic!()
        };
        x.push_str(" e ancora");
        p.to_json().unwrap()
    };
    assert!(matches!(
        save(Codec::Docx, &file, &edited(&value)),
        Ok(Saved::Bytes(_))
    ));
    // Una bozza di versione 2, di prima dei segni della 3, si salva.
    value["version"] = 2.into();
    assert!(matches!(
        save(Codec::Docx, &file, &edited(&value)),
        Ok(Saved::Bytes(_))
    ));

    // Uno schema più nuovo non si legge, nemmeno in parte.
    value["opaque_schema"] = (OPAQUE_SCHEMA + 1).into();
    assert_eq!(
        save(Codec::Docx, &file, &value.to_string()),
        Err(RichError::OpaqueSchema(OPAQUE_SCHEMA + 1))
    );
    // Una versione con lo schema, senza lo schema, è malformata.
    value.as_object_mut().unwrap().remove("opaque_schema");
    assert!(matches!(
        save(Codec::Docx, &file, &value.to_string()),
        Err(RichError::Malformed(_))
    ));
    // La versione 1, quella delle bozze di prima, ha lo schema 0 e si salva.
    value["version"] = 1.into();
    let v1 = Projection::from_json(&value.to_string()).unwrap();
    assert_eq!(v1.schema(), 0);
    assert!(matches!(
        save(Codec::Docx, &file, &edited(&value)),
        Ok(Saved::Bytes(_))
    ));
    // Ma non dichiara uno schema.
    value["opaque_schema"] = 0.into();
    assert!(matches!(
        save(Codec::Docx, &file, &value.to_string()),
        Err(RichError::Malformed(_))
    ));
}

#[test]
fn un_file_che_non_è_word_non_si_apre() {
    assert!(matches!(
        open(Codec::Docx, b"non sono uno zip"),
        Err(RichError::Codec(_))
    ));
}

#[test]
fn uno_stile_di_tabella_che_il_file_nomina_senza_averlo_resta_ma_uno_incollato_no() {
    // Word ignora uno stile di tabella che il file non definisce, e molti file
    // ne hanno: è del file, e il salvataggio lo lascia.
    let mut d = sample();
    let WcBlock::Table(table) = std::sync::Arc::make_mut(&mut d.body[4]) else {
        panic!()
    };
    table.props.style = Some("Tabella1".into());
    let file = bytes(&d);
    let mut p = projection(&file);
    let Block::Table(table) = &mut p.blocks[4] else {
        panic!()
    };
    let Block::Para(cell) = &mut table.rows[0].cells[0].blocks[0] else {
        panic!()
    };
    let Inline::Text { x, .. } = &mut cell.c[0] else {
        panic!()
    };
    *x = "riscritta".into();
    let pasted = p.blocks[4].clone();
    let after = read(&saved(&file, &p));
    let WcBlock::Table(now) = &*after.body[4] else {
        panic!()
    };
    assert_eq!(now.props.style.as_deref(), Some("Tabella1"));

    // La stessa tabella incollata in un documento che non la nomina perde lo
    // stile che lì non c'è.
    let other = bytes(&{
        let mut d = sample();
        d.body.truncate(2);
        d
    });
    let mut q = projection(&other);
    q.blocks.push(pasted);
    let after = read(&saved(&other, &q));
    // Il corpo di Word finisce con un paragrafo: la tabella è l'ultima prima.
    let now = after
        .body
        .iter()
        .rev()
        .find_map(|b| match &**b {
            WcBlock::Table(t) => Some(t),
            _ => None,
        })
        .unwrap();
    assert_eq!(
        now.rows[0].cells[0].blocks[0]
            .as_para()
            .unwrap()
            .plain_text(),
        "riscritta"
    );
    assert_eq!(now.props.style, None);
}

#[test]
fn ciò_che_il_codec_riscrive_senza_perdere_non_chiude_il_documento() {
    // Il codec rinumera le parti nell'ordine in cui le scrive, arrotonda le
    // misure al twip e fonde le impostazioni che il modello non tiene con
    // quelle che genera: niente di questo è una perdita.
    let mut d = sample();
    let footer = d.add_part(
        wordcraft_doc::PartKind::Footer,
        vec![para_block(text("piede", CharProps::default()))],
    );
    let header = d.add_part(
        wordcraft_doc::PartKind::Header,
        vec![para_block(text("testa", CharProps::default()))],
    );
    d.last_section.headers.default = Some(header);
    d.last_section.footers.default = Some(footer);
    let WcBlock::Table(table) = std::sync::Arc::make_mut(&mut d.body[4]) else {
        panic!()
    };
    table.rows[0].props.height = Some(25.544922);
    let settings = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:zoom w:percent="120"/><w:proofState w:spelling="clean"/><w:defaultTabStop w:val="708"/><w:rsids><w:rsidRoot w:val="00A1B2C3"/></w:rsids></w:settings>"#;
    d.passthrough.insert(
        wordcraft_docx::SETTINGS_ORIG.into(),
        std::sync::Arc::new(settings.as_bytes().to_vec()),
    );
    let file = bytes(&d);
    assert_ne!(read(&file), {
        let mut n = d.clone();
        n.normalize_runs();
        n
    });
    let mut p = projection(&file);
    let Inline::Text { x, .. } = &mut para_mut(&mut p, 1).c[0] else {
        panic!()
    };
    *x = "Una prosa nuova ".into();
    let after = read(&saved(&file, &p));
    let kept = &after.passthrough[wordcraft_docx::SETTINGS_ORIG];
    let kept = std::str::from_utf8(kept).unwrap();
    assert!(
        kept.contains(r#"<w:rsidRoot w:val="00A1B2C3"/>"#) && kept.contains("<w:proofState"),
        "{kept}"
    );
    assert_eq!(
        after.parts[&after.last_section.headers.default.unwrap()].blocks[0]
            .as_para()
            .unwrap()
            .plain_text(),
        "testa"
    );
    assert_eq!(
        after.parts[&after.last_section.footers.default.unwrap()].blocks[0]
            .as_para()
            .unwrap()
            .plain_text(),
        "piede"
    );
}

#[test]
fn una_nota_mostrata_due_volte_apre_in_sola_lettura() {
    // Due rimandi alla stessa nota e uno a un'altra: la superficie non sa
    // mostrare due volte la stessa nota, e il codec di WordCraft non rilegge la
    // seconda. Il documento si legge, non si scrive.
    let mut d = sample();
    let first = d.add_part(
        wordcraft_doc::PartKind::Footnote,
        vec![para_block(text("prima", CharProps::default()))],
    );
    let second = d.add_part(
        wordcraft_doc::PartKind::Footnote,
        vec![para_block(text("seconda", CharProps::default()))],
    );
    let mut p = text("rimandi", CharProps::default());
    for id in [first, first, second] {
        let at = p.len();
        p.insert_object(
            at,
            InlineObject::NoteRef {
                kind: NoteKind::Footnote,
                id,
                custom: String::new(),
            },
            &CharProps::default(),
        )
        .unwrap();
    }
    d.body.push(para_block(p));
    let last = d.body.len() - 1;
    let file = bytes(&d);
    let opened = open(Codec::Docx, &file).unwrap();
    assert_eq!(opened.readonly, Some(ReadOnly::Projection));
    // «Che cosa manca?» dice il paragrafo dei rimandi.
    assert_eq!(
        Projection::from_json(&opened.projection).unwrap().missing,
        [Missing {
            what: MissingWhat::Changed,
            block: Some(last),
        }]
    );
    let mut projection = Projection::from_json(&opened.projection).unwrap();
    assert_eq!(projection.readonly, Some(ReadOnly::Projection));
    // Una modifica si rifiuta con il motivo misurato all'apertura; e chi
    // togliesse quel campo trova comunque la rilettura a dire di no.
    para_mut(&mut projection, 0).c.push(Inline::Text {
        ins: None,
        del: None,
        x: " cambiato".into(),
        k: None,
        m: Vec::new(),
        href: None,
        f: Look::default(),
    });
    assert_eq!(
        save(Codec::Docx, &file, &projection.to_json().unwrap()),
        Err(RichError::ReadOnly(ReadOnly::Projection))
    );
    projection.readonly = None;
    assert!(save(Codec::Docx, &file, &projection.to_json().unwrap()).is_err());
}

use fub_host::automation::{
    nm_attachment_write_gate, nm_frame_to_str, nm_write_gate, pair_allows, read_nm_frame,
    validate_capture_v1, validate_envelope, validate_nm_attachment_begin,
    validate_nm_attachment_chunk, validate_nm_attachment_commit, validate_nm_request,
    write_nm_frame, AttachmentMeta, AutomationKind, CaptureEnvelope, CaptureMode, CapturePayloadV1,
    CaptureTarget, NmAttachmentBegin, NmAttachmentChunk, NmAttachmentCommit, NmRequest, PairEntry,
    ATTACHMENT_MAX_BYTES, NM_ATTACHMENT_BEGIN_KIND, NM_ATTACHMENT_CHUNK_KIND,
    NM_ATTACHMENT_COMMIT_KIND, NM_REQUEST_KIND,
};

fn envelope() -> CaptureEnvelope {
    CaptureEnvelope {
        nonce: "capture-once".into(),
        origin: "clipper-extension".into(),
        extension_id: Some("clipper@fub.local".into()),
        timestamp_ms: Some(1),
    }
}
fn target() -> CaptureTarget {
    CaptureTarget {
        mode: CaptureMode::Create,
        vault: Some("main".into()),
        folder: Some("Clips/Web".into()),
        note: None,
    }
}
fn payload() -> CapturePayloadV1 {
    CapturePayloadV1 {
        v: 1,
        title: "Original".into(),
        markdown: "body".into(),
        source_url: Some("https://example.test/article".into()),
        properties: None,
        target: target(),
    }
}
fn pairs() -> Vec<PairEntry> {
    vec![PairEntry {
        extension_id: "clipper@fub.local".into(),
        vault: Some("main".into()),
        folder: Some("Clips".into()),
    }]
}

#[test]
fn capture_and_envelope_fail_closed_on_cross_transport_payloads() {
    let mut p = payload();
    assert!(validate_capture_v1(&p).is_ok());
    p.v = 2;
    assert_eq!(
        validate_capture_v1(&p).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    p.v = 1;
    p.markdown = "é".repeat(524_289);
    assert_eq!(
        validate_capture_v1(&p).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    p = payload();
    p.source_url = Some("https://user:secret@example.test/".into());
    assert_eq!(
        validate_capture_v1(&p).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    p = payload();
    p.target.folder = Some("../outside".into());
    assert_eq!(
        validate_capture_v1(&p).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    p = payload();
    p.target.mode = CaptureMode::Append;
    assert_eq!(
        validate_capture_v1(&p).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    let mut e = envelope();
    e.origin = "web-page".into();
    assert_eq!(
        validate_envelope(&e).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    e = envelope();
    e.nonce = "\n".into();
    assert_eq!(
        validate_envelope(&e).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    let mut nm = NmRequest {
        kind: NM_REQUEST_KIND.into(),
        v: 1,
        envelope: envelope(),
        payload: payload(),
    };
    assert!(validate_nm_request(&nm).is_ok());
    nm.kind = "note.delete".into();
    assert_eq!(
        validate_nm_request(&nm).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    nm.kind = NM_REQUEST_KIND.into();
    nm.v = 2;
    assert_eq!(
        validate_nm_request(&nm).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
}

#[test]
fn pairing_is_bound_to_extension_vault_and_folder_boundary() {
    let paired = pairs();
    assert!(pair_allows(
        &paired,
        "clipper@fub.local",
        Some("main"),
        "Clips/Web"
    ));
    assert!(!pair_allows(
        &paired,
        "other@fub.local",
        Some("main"),
        "Clips/Web"
    ));
    assert!(!pair_allows(
        &paired,
        "clipper@fub.local",
        Some("private"),
        "Clips/Web"
    ));
    assert!(!pair_allows(
        &paired,
        "clipper@fub.local",
        Some("main"),
        "ClipsExtra"
    ));
    assert!(!pair_allows(&paired, "clipper@fub.local", Some("main"), ""));
    assert!(nm_write_gate(&paired, &envelope(), &payload()).is_ok());
    let mut e = envelope();
    e.extension_id = None;
    assert!(nm_write_gate(&paired, &e, &payload()).unwrap_err().1);
    assert!(nm_attachment_write_gate(&paired, &envelope(), &target()).is_ok());
    let mut outside = target();
    outside.folder = Some("Private".into());
    assert!(
        nm_attachment_write_gate(&paired, &envelope(), &outside)
            .unwrap_err()
            .1
    );
}

#[test]
fn native_frames_are_length_prefixed_bounded_and_strict_utf8() {
    let mut bytes = Vec::new();
    write_nm_frame(&mut bytes, br#"{"kind":"fub-capture-v1"}"#).unwrap();
    assert_eq!(
        u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize,
        bytes.len() - 4
    );
    assert_eq!(
        nm_frame_to_str(&read_nm_frame(&mut bytes.as_slice()).unwrap()).unwrap(),
        "{\"kind\":\"fub-capture-v1\"}"
    );
    assert_eq!(
        read_nm_frame(&mut [0u8; 4].as_slice()).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    assert_eq!(
        read_nm_frame(&mut u32::MAX.to_le_bytes().as_slice())
            .unwrap_err()
            .kind(),
        AutomationKind::BadArgs
    );
    let cut = [3, 0, 0, 0, 1];
    assert_eq!(
        read_nm_frame(&mut cut.as_slice()).unwrap_err().kind(),
        AutomationKind::Unavailable
    );
    assert_eq!(
        nm_frame_to_str(&[0xff]).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    assert_eq!(
        write_nm_frame(&mut Vec::new(), &[]).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
}

#[test]
fn native_attachment_requires_digest_safe_name_scope_and_bounded_ordered_wire() {
    let mut begin = NmAttachmentBegin {
        kind: NM_ATTACHMENT_BEGIN_KIND.into(),
        v: 1,
        envelope: envelope(),
        target: target(),
        attachment: AttachmentMeta {
            name: "photo.png".into(),
            sha256: "a".repeat(64),
            bytes: ATTACHMENT_MAX_BYTES,
        },
    };
    assert!(validate_nm_attachment_begin(&begin).is_ok());
    begin.attachment.name = "../escape.png".into();
    assert_eq!(
        validate_nm_attachment_begin(&begin).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    begin.attachment.name = "photo.png".into();
    begin.attachment.sha256 = "A".repeat(64);
    assert_eq!(
        validate_nm_attachment_begin(&begin).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    begin.attachment.sha256 = "a".repeat(64);
    begin.attachment.bytes += 1;
    assert_eq!(
        validate_nm_attachment_begin(&begin).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    begin.attachment.bytes = 1;
    begin.target.mode = CaptureMode::Append;
    assert_eq!(
        validate_nm_attachment_begin(&begin).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    let mut chunk = NmAttachmentChunk {
        kind: NM_ATTACHMENT_CHUNK_KIND.into(),
        v: 1,
        envelope: envelope(),
        transfer_id: "transfer-1".into(),
        index: 0,
        data: "YQ==".into(),
    };
    assert!(validate_nm_attachment_chunk(&chunk).is_ok());
    chunk.data = "not!base64".into();
    assert_eq!(
        validate_nm_attachment_chunk(&chunk).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    chunk.data = "YQ==".into();
    chunk.index = 64;
    assert_eq!(
        validate_nm_attachment_chunk(&chunk).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
    let mut commit = NmAttachmentCommit {
        kind: NM_ATTACHMENT_COMMIT_KIND.into(),
        v: 1,
        envelope: envelope(),
        transfer_id: "transfer-1".into(),
    };
    assert!(validate_nm_attachment_commit(&commit).is_ok());
    commit.transfer_id = "../steal".into();
    assert_eq!(
        validate_nm_attachment_commit(&commit).unwrap_err().kind(),
        AutomationKind::BadArgs
    );
}

//! I limiti e i codici di chiusura: ogni riga delle tabelle «Limiti del
//! protocollo» e «Codici di chiusura».

use std::time::Duration;

use futures_util::SinkExt;
use tokio::time::{sleep, Instant};

use super::support::{config, frame, join, ops, rejoin, renew, start, stroke, Raw};
use crate::counter::Counter;
use crate::host::{
    EndReason, LeaveReason, LiveEvent, LiveHost, SendError, ShellMessage, StartError,
};
use crate::limits::{MAX_COMMIT, MAX_INK_PTS, MAX_SNAPSHOT};
use crate::protocol::{HostMessage, InkPoints, NackReason, WriterMessage};

/// La riga di un `ink.pts` con i campioni indicati.
fn points(count: usize) -> String {
    let pts = vec!["[1.25,2.5,0.5,1000.125]"; count].join(",");
    format!(r#"{{"v":1,"t":"ink.pts","s":"o7k2m9x4q","pts":[{pts}]}}"#)
}

#[tokio::test(start_paused = true)]
async fn ink_points_up_to_64_kib_pass_and_beyond_close_with_1009() {
    let mut live = start();
    let (mut raw, _) = join(&live.net, &live.target).await;
    let fits = (MAX_INK_PTS - 64) / 24;
    assert!(points(fits).len() <= MAX_INK_PTS);
    assert!(raw.text(points(fits)).await);
    let received = live
        .events
        .find(|event| match event {
            LiveEvent::InkPoints(InkPoints { pts, .. }) => Some(pts.len()),
            _ => None,
        })
        .await;
    assert_eq!(received, fits);

    let over = points(fits + 8);
    assert!(over.len() > MAX_INK_PTS);
    assert!(raw.text(over.clone()).await);
    let closed = raw.closed().await;
    assert_eq!((closed.code, closed.error), (Some(1009), Some(1009)));
    assert_eq!(
        closed.detail,
        Some(format!(
            "ink.pts of {} bytes exceeds {MAX_INK_PTS}",
            over.len()
        ))
    );
    let reason = live
        .events
        .find(|event| match event {
            LiveEvent::WriterDisconnected {
                reason, resumable, ..
            } => Some((reason, resumable)),
            _ => None,
        })
        .await;
    assert_eq!(reason, (LeaveReason::Violation { code: 1009 }, false));
}

#[tokio::test(start_paused = true)]
async fn a_commit_beyond_the_limits_of_the_operations_gets_a_limit_nack() {
    let mut live = start();
    let (mut raw, _) = join(&live.net, &live.target).await;
    // Oltre 8 MiB: l'host risponde da sé, senza tenere le operazioni.
    let big = format!(
        r#"{{"v":1,"t":"commit","c":"1","ops":[{{"op":"add","x":"{}"}}]}}"#,
        "a".repeat(MAX_COMMIT)
    );
    assert!(raw.text(big.clone()).await);
    match raw.recv().await {
        Some(HostMessage::Nack(nack)) => {
            assert_eq!(
                (nack.c, nack.reason, nack.index),
                (Counter(1), NackReason::Limit, None)
            );
            assert_eq!(
                nack.detail,
                format!("a commit of {} bytes exceeds {MAX_COMMIT}", big.len())
            );
        }
        other => panic!("expected a nack, got {other:?}"),
    }
    // Oltre le 10 000 operazioni, lo stesso.
    let many = format!(
        r#"{{"v":1,"t":"commit","c":"2","ops":[{}]}}"#,
        vec![r#"{"op":"add"}"#; 10_001].join(",")
    );
    assert!(raw.text(many).await);
    match raw.recv().await {
        Some(HostMessage::Nack(nack)) => {
            assert_eq!((nack.c, nack.reason), (Counter(2), NackReason::Limit));
            assert_eq!(nack.detail, "a commit carries more than 10000 operations");
        }
        other => panic!("expected a nack, got {other:?}"),
    }
    // La connessione resta, e alla shell non è arrivato niente.
    assert!(raw.commit(3, ops("o3")).await);
    let c = live
        .events
        .find(|event| match event {
            LiveEvent::Commit { c, .. } => Some(c),
            _ => None,
        })
        .await;
    assert_eq!(c, Counter(3));
    assert_eq!(live.host.status().stats.commits, 3);
}

#[tokio::test(start_paused = true)]
async fn a_document_beyond_20_mib_does_not_open_a_session() {
    let mut big = config();
    big.snapshot.text = "a".repeat(MAX_SNAPSHOT + 1);
    assert!(matches!(
        LiveHost::start_in_memory(big),
        Err(StartError::SnapshotTooLarge { size }) if size == MAX_SNAPSHOT + 1
    ));
    // Nei 20 MiB, ma con gli escape del JSON oltre il messaggio WebSocket.
    let mut escaped = config();
    escaped.snapshot.text = "\"".repeat(MAX_SNAPSHOT);
    assert!(matches!(
        LiveHost::start_in_memory(escaped),
        Err(StartError::SnapshotTooLarge { .. })
    ));
    let mut fits = config();
    fits.snapshot.text = "a".repeat(MAX_SNAPSHOT);
    assert!(LiveHost::start_in_memory(fits).is_ok());
}

#[tokio::test(start_paused = true)]
async fn a_snapshot_beyond_20_mib_turns_the_session_read_only_with_4008() {
    let mut live = start();
    let (mut raw, _) = join(&live.net, &live.target).await;
    let text = "a".repeat(MAX_SNAPSHOT + 1);
    let sent = live.host.send(ShellMessage::Snapshot {
        seq: Counter(8),
        text,
    });
    assert_eq!(
        sent,
        Err(SendError::SnapshotTooLarge {
            size: MAX_SNAPSHOT + 1
        })
    );
    let closed = raw.closed().await;
    assert_eq!((closed.code, closed.error), (Some(4008), Some(4008)));
    let reason = live
        .events
        .find(|event| match event {
            LiveEvent::Ended { reason } => Some(reason),
            _ => None,
        })
        .await;
    assert_eq!(reason, EndReason::ReadOnly);
    assert_eq!(
        live.host.send(ShellMessage::Ops {
            seq: Counter(9),
            ops: ops("o1")
        }),
        Err(SendError::Ended)
    );
}

#[tokio::test(start_paused = true)]
async fn a_frame_beyond_24_mib_closes_with_1009_before_its_payload() {
    let live = start();
    let (mut raw, _) = join(&live.net, &live.target).await;
    // Solo l'intestazione: l'host rifiuta dalla lunghezza dichiarata, senza
    // leggere né tenere i 24 MiB.
    let mut header = vec![0x81, 0x80 | 127];
    header.extend_from_slice(&(24u64 * 1024 * 1024 + 1).to_be_bytes());
    header.extend_from_slice(&[1, 2, 3, 4]);
    raw.bytes(&header).await;
    let closed = raw.closed().await;
    assert_eq!((closed.code, closed.error), (Some(1009), Some(1009)));
    assert_eq!(closed.detail.as_deref(), Some("the message exceeds 24 MiB"));
}

#[tokio::test(start_paused = true)]
async fn a_message_beyond_24_mib_in_several_frames_closes_with_1009() {
    let live = start();
    let (mut raw, _) = join(&live.net, &live.target).await;
    // Ogni frame sta nel limite; il messaggio che compongono no.
    raw.bytes(&frame(0x01, &vec![b' '; 16 * 1024 * 1024])).await;
    raw.bytes(&frame(0x80, &vec![b' '; 8 * 1024 * 1024 + 1]))
        .await;
    let closed = raw.closed().await;
    assert_eq!((closed.code, closed.error), (Some(1009), Some(1009)));
    assert_eq!(closed.detail.as_deref(), Some("the message exceeds 24 MiB"));
}

#[tokio::test(start_paused = true)]
async fn more_than_240_messages_in_a_second_close_with_4006_and_the_resume_waits_5_seconds() {
    let mut live = start();
    let (mut raw, welcome) = join(&live.net, &live.target).await;
    // Fuori dal secondo del `hello`, 240 messaggi nello stesso istante passano.
    sleep(Duration::from_secs(1)).await;
    for id in 1..=240 {
        assert!(raw.ping(id).await);
    }
    for id in 1..=240 {
        assert!(matches!(raw.recv().await, Some(HostMessage::Pong(pong)) if pong.id == id));
    }
    sleep(Duration::from_secs(1)).await;
    for id in 241..=481 {
        raw.ping(id).await;
    }
    let closed = raw.closed().await;
    assert_eq!((closed.code, closed.error), (Some(4006), Some(4006)));
    assert_eq!(
        closed.detail.as_deref(),
        Some("more than 240 messages in a second")
    );
    let left = Instant::now();
    let reason = live
        .events
        .find(|event| match event {
            LiveEvent::WriterDisconnected {
                reason, resumable, ..
            } => Some((reason, resumable)),
            _ => None,
        })
        .await;
    assert_eq!(reason, (LeaveReason::TooMuchTraffic, true));

    let mut early = Raw::open(&live.net, &live.target).await;
    early.resume(&live.target, &welcome.resume).await;
    let closed = early.closed().await;
    assert_eq!(closed.code, Some(4006));
    assert_eq!(
        closed.detail.as_deref(),
        Some("wait 5 seconds after 4006 before resuming")
    );
    tokio::time::sleep_until(left + Duration::from_secs(5)).await;
    rejoin(&live.net, &live.target, &welcome.resume).await;
}

#[tokio::test(start_paused = true)]
async fn a_writer_without_hello_for_5_seconds_gets_4002() {
    let live = start();
    let opened = Instant::now();
    let mut raw = Raw::open(&live.net, &live.target).await;
    let closed = raw.closed().await;
    assert_eq!((closed.code, closed.error), (Some(4002), Some(4002)));
    assert_eq!(closed.detail.as_deref(), Some("no hello within 5 seconds"));
    assert_eq!(opened.elapsed(), Duration::from_secs(5));

    // La scadenza vale dall'accettazione del socket: un ping ogni secondo
    // non la sposta, e un socket che non comincia nemmeno TLS cade lo stesso.
    let opened = Instant::now();
    let mut patient = Raw::open(&live.net, &live.target).await;
    let mut silent = live.net.dial().unwrap();
    for _ in 0..4 {
        sleep(Duration::from_secs(1)).await;
        patient
            .ws
            .send(tokio_tungstenite::tungstenite::Message::Ping(
                Default::default(),
            ))
            .await
            .ok();
    }
    assert_eq!(patient.close_code().await, 4002);
    let mut byte = [0u8; 1];
    assert_eq!(
        tokio::io::AsyncReadExt::read(&mut silent, &mut byte)
            .await
            .unwrap(),
        0
    );
    assert_eq!(opened.elapsed(), Duration::from_secs(5));
    assert_eq!(live.host.status().stats.rejected, 3);
}

#[tokio::test(start_paused = true)]
async fn two_missed_heartbeats_close_the_connection_and_answered_ones_keep_it() {
    let mut live = start();
    let (mut raw, _) = join(&live.net, &live.target).await;
    // Uno scrittore che legge risponde da sé ai ping dell'host: quasi un
    // minuto dopo è ancora collegato.
    let reading = tokio::time::timeout(Duration::from_secs(55), raw.recv()).await;
    assert!(reading.is_err(), "{reading:?}");
    assert!(live.host.status().writer.unwrap().connected);
    assert!(live.host.status().writer.unwrap().clock.is_none());

    // Uno che smette di leggere non risponde più: al secondo heartbeat
    // mancato l'host chiude, fra 20 e 30 secondi.
    let stopped = Instant::now();
    let reason = live
        .events
        .find(|event| match event {
            LiveEvent::WriterDisconnected {
                reason, resumable, ..
            } => Some((reason, resumable)),
            _ => None,
        })
        .await;
    assert_eq!(reason, (LeaveReason::Heartbeat, true));
    let elapsed = stopped.elapsed();
    assert!(
        elapsed >= Duration::from_secs(20) && elapsed <= Duration::from_secs(30),
        "{elapsed:?}"
    );
    drop(raw);
}

#[tokio::test(start_paused = true)]
async fn the_host_closing_says_1001_with_a_bye() {
    let mut live = start();
    let (mut raw, _) = join(&live.net, &live.target).await;
    let report = live.host.stop(EndReason::HostClosing).await;
    assert!(report.pending.is_empty());
    let closed = raw.closed().await;
    assert_eq!((closed.code, closed.error), (Some(1001), None));
    assert_eq!(
        closed.detail.as_deref(),
        Some("the host is closing the session")
    );
    let ended = live
        .events
        .find(|event| match event {
            LiveEvent::Ended { reason } => Some(reason),
            _ => None,
        })
        .await;
    assert_eq!(ended, EndReason::HostClosing);
}

#[tokio::test(start_paused = true)]
async fn an_unknown_session_gets_4001() {
    let live = start();
    let mut raw = Raw::open(&live.net, &live.target).await;
    let text = super::support::hello(
        &live.target,
        crate::protocol::Credential::Secret(zeroize::Zeroizing::new(live.target.secret.encode())),
    )
    .to_json()
    .replace(&live.target.session.encode(), "AAAAAAAAAAA");
    assert!(raw.text(text).await);
    let closed = raw.closed().await;
    assert_eq!((closed.code, closed.error), (Some(4001), Some(4001)));
    assert_eq!(closed.detail.as_deref(), Some("unknown session"));
}

#[tokio::test(start_paused = true)]
async fn an_invalid_hello_gets_4002() {
    let live = start();
    let secret = live.target.secret.encode();
    let session = live.target.session.encode();
    let device = r#""device":{"name":"Tablet","kind":"tablet"},"caps":{"pressure":true,"tilt":false,"coalesced":true,"predicted":false}"#;
    for text in [
        "not json".to_owned(),
        format!(r#"{{"v":1,"t":"hello","session":"{session}",{device}}}"#),
        format!(
            r#"{{"v":1,"t":"hello","session":"{session}","secret":"{secret}","resume":"{secret}",{device}}}"#
        ),
        format!(
            r#"{{"v":1,"t":"hello","session":"{session}","secret":"{secret}",{device},"extra":1}}"#
        ),
        format!(r#"{{"v":1,"t":"hello","session":"{session}","secret":"{secret}"}}"#),
        format!(
            r#"{{"v":1,"t":"hello","session":"{session}","secret":"{secret}","device":{{"name":"{}","kind":"tablet"}},"caps":{{"pressure":true,"tilt":false,"coalesced":true,"predicted":false}}}}"#,
            "a".repeat(200)
        ),
        r#"{"v":1,"t":"ping","id":1,"a":1}"#.to_owned(),
        format!(
            r#"{{"v":1,"t":"hello","session":"{session}","secret":"{secret}",{device},"pad":"{}"}}"#,
            " ".repeat(16 * 1024)
        ),
    ] {
        let mut raw = Raw::open(&live.net, &live.target).await;
        assert!(raw.text(text.clone()).await);
        assert_eq!(raw.close_code().await, 4002, "{text}");
    }
    // Un secondo `hello` dopo il `welcome`, lo stesso.
    let (mut raw, _) = join(&live.net, &live.target).await;
    raw.hello(&live.target).await;
    let closed = raw.closed().await;
    assert_eq!(closed.code, Some(4002));
    assert_eq!(closed.detail.as_deref(), Some("hello after welcome"));
}

#[tokio::test(start_paused = true)]
async fn a_closed_document_says_4005() {
    let mut live = start();
    let (mut raw, _) = join(&live.net, &live.target).await;
    let report = live.host.stop(EndReason::DocumentClosed).await;
    assert!(report.pending.is_empty());
    let closed = raw.closed().await;
    assert_eq!((closed.code, closed.error), (Some(4005), Some(4005)));
    assert_eq!(
        closed.detail.as_deref(),
        Some("the document was closed on the PC")
    );
    let reason = live
        .events
        .find(|event| match event {
            LiveEvent::WriterDisconnected {
                reason, resumable, ..
            } => Some((reason, resumable)),
            _ => None,
        })
        .await;
    assert_eq!(reason, (LeaveReason::SessionEnded, false));
}

#[tokio::test(start_paused = true)]
async fn an_unknown_version_or_type_gets_4007() {
    let mut live = start();
    for text in [
        r#"{"v":2,"t":"ping","id":1,"a":1}"#,
        r#"{"t":"ping","id":1,"a":1}"#,
        r#"{"v":1,"t":"teleport"}"#,
        r#"{"v":1,"t":"welcome"}"#,
    ] {
        // Lo scrittore che ha violato il protocollo non riprende: ogni caso
        // entra con un QR nuovo.
        let (mut raw, _) = join(&live.net, &renew(&live)).await;
        assert!(raw.text(text).await);
        assert_eq!(raw.close_code().await, 4007, "{text}");
        let reason = live
            .events
            .find(|event| match event {
                LiveEvent::WriterDisconnected {
                    reason, resumable, ..
                } => Some((reason, resumable)),
                _ => None,
            })
            .await;
        assert_eq!(reason, (LeaveReason::Violation { code: 4007 }, false));
    }
}

#[tokio::test(start_paused = true)]
async fn binary_malformed_and_invalid_frames_get_1003_1002_and_1007() {
    let live = start();
    let cases: [(&str, Vec<u8>, u16); 5] = [
        ("binary", frame(0x82, b"{}"), 1003),
        ("reserved bit", frame(0xC1, b"{}"), 1002),
        ("unmasked", vec![0x81, 0x02, b'{', b'}'], 1002),
        ("not UTF-8", frame(0x81, &[0xff, 0xfe]), 1007),
        ("not JSON", frame(0x81, b"{"), 1007),
    ];
    for (name, bytes, code) in cases {
        // Ogni caso con il suo scrittore: il precedente ha chiuso senza
        // ripresa.
        let (mut raw, _) = join(&live.net, &renew(&live)).await;
        raw.bytes(&bytes).await;
        assert_eq!(raw.close_code().await, code, "{name}");
    }
    // Un messaggio che rispetta la forma ma non i valori: 1007.
    let (mut raw, _) = join(&live.net, &renew(&live)).await;
    let invalid = WriterMessage::InkPoints(InkPoints {
        s: stroke("o7k2m9x4q"),
        pts: vec![[0.0, 0.0, 0.5, 0.0]],
    })
    .to_json()
    .replace("0.5", "2.0");
    assert!(raw.text(invalid).await);
    let closed = raw.closed().await;
    assert_eq!(closed.code, Some(1007));
    assert!(closed.detail.unwrap().contains("pressure"));
}

#[tokio::test(start_paused = true)]
async fn the_end_of_the_session_says_1000_with_a_bye() {
    let mut live = start();
    let (mut raw, _) = join(&live.net, &live.target).await;
    assert!(raw.commit(1, ops("o1")).await);
    live.events
        .find(|event| matches!(event, LiveEvent::Commit { .. }).then_some(()))
        .await;
    let report = live.host.stop(EndReason::Terminated).await;
    assert_eq!(report.pending.len(), 1);
    let closed = raw.closed().await;
    assert_eq!((closed.code, closed.error), (Some(1000), None));
    assert_eq!(
        closed.detail.as_deref(),
        Some("the session was terminated on the PC")
    );
}

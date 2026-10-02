//! La ripresa (§7): il gettone che ruota, la connessione sostituita, la
//! finestra di 2 minuti, `lastC` e i commit rimandati.

use std::time::Duration;

use tokio::time::{sleep, Instant};

use super::support::{heavy_ops, join, ops, rejoin, start, Live, Raw, SEQ, SNAPSHOT};
use crate::counter::{Counter, WriterId};
use crate::host::{LeaveReason, LiveEvent, ReleaseReason, ShellMessage};
use crate::protocol::{HostMessage, NackReason};

const WRITER: WriterId = WriterId(1);

/// Aspetta che l'host veda la caduta dello scrittore.
async fn left(live: &mut Live) -> (LeaveReason, bool) {
    live.events
        .find(|event| match event {
            LiveEvent::WriterDisconnected {
                reason, resumable, ..
            } => Some((reason, resumable)),
            _ => None,
        })
        .await
}

/// Il prossimo messaggio dell'host che non è un `pong`.
async fn next(raw: &mut Raw) -> HostMessage {
    loop {
        match raw.recv().await {
            Some(HostMessage::Pong(_)) => {}
            Some(message) => return message,
            None => panic!("the host closed the connection"),
        }
    }
}

fn ack(c: u64, seq: u64, id: &str) -> ShellMessage {
    ShellMessage::Ack {
        writer: WRITER,
        c: Counter(c),
        seq: Counter(seq),
        echo: ops(id),
        duplicate: false,
    }
}

#[tokio::test(start_paused = true)]
async fn the_token_rotates_and_the_old_one_lasts_until_the_first_message() {
    let mut live = start();
    let (raw, first) = join(&live.net, &live.target).await;
    live.net.cut();
    drop(raw);
    assert_eq!(left(&mut live).await, (LeaveReason::Lost, true));

    // Il `welcome` della ripresa si perde: lo scrittore non manda niente e
    // cade di nuovo, poi riprova con il gettone che aveva.
    let (raw, second) = rejoin(&live.net, &live.target, &first.resume).await;
    assert_ne!(second.resume.encode(), first.resume.encode());
    live.net.cut();
    drop(raw);
    let (mut raw, third) = rejoin(&live.net, &live.target, &first.resume).await;
    assert_ne!(third.resume.encode(), second.resume.encode());

    // Il primo messaggio sulla nuova connessione conferma il gettone nuovo:
    // il vecchio non vale più.
    assert!(raw.ping(1).await);
    assert_eq!(next_pong(&mut raw).await, 1);
    live.net.cut();
    drop(raw);
    let mut stale = Raw::open(&live.net, &live.target).await;
    stale.resume(&live.target, &first.resume).await;
    let closed = stale.closed().await;
    assert_eq!(closed.code, Some(4004));
    assert_eq!(
        closed.detail.as_deref(),
        Some("the resume token is not valid")
    );
    rejoin(&live.net, &live.target, &third.resume).await;
}

async fn next_pong(raw: &mut Raw) -> u64 {
    loop {
        match raw.recv().await {
            Some(HostMessage::Pong(pong)) => return pong.id,
            Some(_) => {}
            None => panic!("the host closed the connection"),
        }
    }
}

#[tokio::test(start_paused = true)]
async fn a_resume_replaces_the_connection_the_host_still_holds() {
    let mut live = start();
    let (mut old, welcome) = join(&live.net, &live.target).await;
    let (mut new, _) = rejoin(&live.net, &live.target, &welcome.resume).await;
    let closed = old.closed().await;
    assert_eq!((closed.code, closed.error), (Some(4003), Some(4003)));
    assert_eq!(
        closed.detail.as_deref(),
        Some("replaced by a newer connection of the same writer")
    );

    // Per la shell: entrato, caduto, ripreso.
    let mut seen = Vec::new();
    while seen.len() < 3 {
        match live.events.next().await.unwrap() {
            LiveEvent::WriterConnected { resumed, .. } => seen.push(format!("connected {resumed}")),
            LiveEvent::WriterDisconnected {
                reason, resumable, ..
            } => seen.push(format!("disconnected {reason:?} {resumable}")),
            _ => {}
        }
    }
    assert_eq!(
        seen,
        [
            "connected false",
            "disconnected Lost true",
            "connected true"
        ]
    );
    // La connessione vecchia, chiusa dopo, non tocca quella nuova.
    assert!(new.ping(1).await);
    assert_eq!(next_pong(&mut new).await, 1);
    assert!(live.host.status().writer.unwrap().connected);
}

#[tokio::test(start_paused = true)]
async fn the_resume_window_closes_two_minutes_after_the_fall() {
    let mut live = start();
    let (raw, welcome) = join(&live.net, &live.target).await;
    live.net.cut();
    drop(raw);
    left(&mut live).await;
    assert_eq!(
        live.host.status().writer.unwrap().resume_expires_in_ms,
        Some(120_000)
    );

    // A un secondo dalla scadenza si riprende, e la finestra riparte dalla
    // caduta successiva.
    sleep(Duration::from_secs(119)).await;
    let (raw, welcome) = rejoin(&live.net, &live.target, &welcome.resume).await;
    live.net.cut();
    drop(raw);
    left(&mut live).await;
    let fell = Instant::now();
    let released = live
        .events
        .find(|event| match event {
            LiveEvent::WriterReleased { writer, reason } => Some((writer, reason)),
            _ => None,
        })
        .await;
    assert_eq!(released, (WRITER, ReleaseReason::ResumeExpired));
    assert_eq!(fell.elapsed(), Duration::from_secs(120));
    assert!(live.host.status().writer.is_none());
    let mut late = Raw::open(&live.net, &live.target).await;
    late.resume(&live.target, &welcome.resume).await;
    assert_eq!(late.close_code().await, 4004);
}

#[tokio::test(start_paused = true)]
async fn the_writer_resends_above_last_c_and_each_commit_is_answered_once() {
    let mut live = start();
    let (mut raw, welcome) = join(&live.net, &live.target).await;
    for (c, id) in [(1, "o1"), (2, "o2"), (3, "o3")] {
        assert!(raw.commit(c, ops(id)).await);
    }
    for expected in 1..=3 {
        let c = live
            .events
            .find(|event| match event {
                LiveEvent::Commit { c, .. } => Some(c),
                _ => None,
            })
            .await;
        assert_eq!(c, Counter(expected));
    }
    // La shell risponde fuori ordine: il primo commit aspetta ancora.
    live.host.send(ack(2, 8, "o2")).unwrap();
    live.host
        .send(ShellMessage::Nack {
            writer: WRITER,
            c: Counter(3),
            reason: NackReason::Locked,
            detail: "the layer is locked".into(),
            index: Some(0),
        })
        .unwrap();
    assert!(matches!(next(&mut raw).await, HostMessage::Ack(ack) if ack.c == Counter(2)));
    assert!(matches!(next(&mut raw).await, HostMessage::Nack(nack) if nack.c == Counter(3)));

    live.net.cut();
    drop(raw);
    left(&mut live).await;
    // `lastC` si ferma prima del primo commit in attesa: lo scrittore li
    // rimanda tutti e tre, e ciascuno riceve la sua risposta una volta.
    let (mut raw, second) = rejoin(&live.net, &live.target, &welcome.resume).await;
    assert_eq!(second.last_c, Counter(0));
    assert!(matches!(next(&mut raw).await, HostMessage::Snapshot(snapshot) if snapshot.seq == SEQ));
    assert!(matches!(next(&mut raw).await, HostMessage::Ops(ops) if ops.seq == Counter(8)));
    for (c, id) in [(1, "o1"), (2, "o2"), (3, "o3")] {
        assert!(raw.commit(c, ops(id)).await);
    }
    assert!(matches!(next(&mut raw).await, HostMessage::Ack(ack) if ack.c == Counter(2)));
    assert!(matches!(next(&mut raw).await, HostMessage::Nack(nack) if nack.c == Counter(3)));
    live.host.send(ack(1, 9, "o1")).unwrap();
    assert!(matches!(next(&mut raw).await, HostMessage::Ack(ack) if ack.c == Counter(1)));
    assert!(live.host.status().pending.is_empty());
    let duplicates = live
        .events
        .ready()
        .into_iter()
        .filter(|event| matches!(event, LiveEvent::Commit { .. }))
        .count();
    assert_eq!(duplicates, 0);

    // Ora `lastC` è 3: dopo il `welcome` arrivano snapshot, registro e il
    // `nack` che lo scrittore non rimanda.
    live.net.cut();
    drop(raw);
    left(&mut live).await;
    let (mut raw, third) = rejoin(&live.net, &live.target, &second.resume).await;
    assert_eq!(third.last_c, Counter(3));
    assert!(matches!(next(&mut raw).await, HostMessage::Snapshot(_)));
    assert!(matches!(next(&mut raw).await, HostMessage::Ops(ops) if ops.seq == Counter(8)));
    assert!(matches!(next(&mut raw).await, HostMessage::Ops(ops) if ops.seq == Counter(9)));
    assert!(matches!(next(&mut raw).await, HostMessage::Nack(nack) if nack.c == Counter(3)));
    // Un commit sotto `lastC` con la risposta ricordata la riceve di nuovo;
    // senza, sarebbe applicato due volte, e l'host chiude.
    assert!(raw.commit(3, ops("o3")).await);
    assert!(matches!(next(&mut raw).await, HostMessage::Nack(nack) if nack.c == Counter(3)));
    live.net.cut();
    drop(raw);
    left(&mut live).await;
    let (mut raw, fourth) = rejoin(&live.net, &live.target, &third.resume).await;
    assert_eq!(fourth.last_c, Counter(3));
    assert!(raw.commit(2, ops("o2")).await);
    let closed = raw.closed().await;
    assert_eq!(closed.code, Some(1007));
    assert_eq!(
        closed.detail.as_deref(),
        Some("commit 2 is at or below lastC 3")
    );
}

#[tokio::test(start_paused = true)]
async fn a_commit_sent_again_with_other_operations_is_refused() {
    let mut live = start();
    let (mut raw, welcome) = join(&live.net, &live.target).await;
    assert!(raw.commit(1, ops("o1")).await);
    live.events
        .find(|event| matches!(event, LiveEvent::Commit { .. }).then_some(()))
        .await;
    live.net.cut();
    drop(raw);
    left(&mut live).await;
    let (mut raw, _) = rejoin(&live.net, &live.target, &welcome.resume).await;
    assert!(raw.commit(1, ops("o9")).await);
    let closed = raw.closed().await;
    assert_eq!(closed.code, Some(1007));
    assert_eq!(
        closed.detail.as_deref(),
        Some("commit 1 was sent again with different operations")
    );
    // Il commit resta alla shell, che risponde ancora.
    assert_eq!(live.host.status().pending.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn after_a_long_absence_the_writer_waits_for_a_fresh_snapshot() {
    let mut live = start();
    let (raw, welcome) = join(&live.net, &live.target).await;
    live.net.cut();
    drop(raw);
    left(&mut live).await;

    // La shell lavora intanto: oltre 4 MiB di registro chiede uno snapshot,
    // oltre 16 MiB il registro si butta.
    let mut seq = SEQ.0;
    for _ in 0..5 {
        seq += 1;
        live.host
            .send(ShellMessage::Ops {
                seq: Counter(seq),
                ops: heavy_ops(1024 * 1024),
            })
            .unwrap();
    }
    live.events
        .find(|event| matches!(event, LiveEvent::SnapshotWanted).then_some(()))
        .await;
    for _ in 0..12 {
        seq += 1;
        live.host
            .send(ShellMessage::Ops {
                seq: Counter(seq),
                ops: heavy_ops(1024 * 1024),
            })
            .unwrap();
    }
    let wanted = live
        .events
        .ready()
        .into_iter()
        .filter(|event| matches!(event, LiveEvent::SnapshotWanted))
        .count();
    assert_eq!(wanted, 0, "the soft threshold asks once");

    // Chi rientra riceve il `welcome` e aspetta lo snapshot della shell.
    let (mut raw, again) = rejoin(&live.net, &live.target, &welcome.resume).await;
    assert_eq!(again.seq, Counter(seq));
    live.events
        .find(|event| matches!(event, LiveEvent::SnapshotWanted).then_some(()))
        .await;
    let text = r#"<svg xmlns="http://www.w3.org/2000/svg"><path id="o1"/></svg>"#;
    live.host
        .send(ShellMessage::Snapshot {
            seq: Counter(seq),
            text: text.into(),
        })
        .unwrap();
    match next(&mut raw).await {
        HostMessage::Snapshot(snapshot) => {
            assert_eq!((snapshot.seq, snapshot.text.as_str()), (Counter(seq), text));
        }
        other => panic!("expected the fresh snapshot, got {other:?}"),
    }
    assert_ne!(text, SNAPSHOT);
}

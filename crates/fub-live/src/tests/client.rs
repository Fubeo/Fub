//! Il client in Rust contro l'host vero: ingresso, inchiostro, commit,
//! ripresa con i commit rimandati, orologio, fine della sessione.

use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::Arc;
use std::time::Duration;

use tokio::time::Instant;

use super::support::{caps, device, document, ops, start, stroke, Live, SEQ, SNAPSHOT};
use crate::client::{
    ClientConfig, ClientEvent, ClientEvents, CommitError, ConnectError, EndCause, Ink, LiveClient,
};
use crate::clock::wall_clock_ms;
use crate::counter::{Counter, WriterId};
use crate::host::{EndReason, LeaveReason, LiveEvent, ShellMessage};
use crate::limits::{Limits, MAX_COMMIT, MAX_SNAPSHOT};
use crate::pairing::PairingTarget;
use crate::protocol::{Device, InkBegin, InkPoints, NackReason, Ops, Retry, Tool, View};
use crate::token::PairingSecret;

const WRITER: WriterId = WriterId(1);

async fn connect(live: &Live) -> (LiveClient, ClientEvents) {
    connect_with(live, ClientConfig::new(device(), caps())).await
}

async fn connect_with(live: &Live, config: ClientConfig) -> (LiveClient, ClientEvents) {
    let (client, mut events) =
        LiveClient::connect_in_memory(&live.net, live.target.clone(), config)
            .await
            .unwrap();
    match events.recv().await {
        Some(ClientEvent::Connected {
            resumed: false,
            doc,
            limits,
            seq,
            last_c,
        }) => {
            assert_eq!(
                (doc, limits, seq, last_c),
                (document(), Limits::V1, SEQ, Counter(0))
            );
        }
        other => panic!("expected the first connection, got {other:?}"),
    }
    match events.recv().await {
        Some(ClientEvent::Snapshot(snapshot)) => assert_eq!(snapshot.text, SNAPSHOT),
        other => panic!("expected the snapshot, got {other:?}"),
    }
    (client, events)
}

/// Il prossimo evento del client che `pick` riconosce.
async fn find<T>(events: &mut ClientEvents, mut pick: impl FnMut(ClientEvent) -> Option<T>) -> T {
    loop {
        let event = tokio::time::timeout(Duration::from_secs(3600), events.recv())
            .await
            .expect("no client event within an hour")
            .expect("the client events ended");
        if let Some(found) = pick(event) {
            return found;
        }
    }
}

async fn shell_commit(live: &mut Live) -> (Counter, Ops) {
    live.events
        .find(|event| match event {
            LiveEvent::Commit { c, ops, .. } => Some((c, ops)),
            _ => None,
        })
        .await
}

fn ack(c: Counter, seq: u64, echo: Ops) -> ShellMessage {
    ShellMessage::Ack {
        writer: WRITER,
        c,
        seq: Counter(seq),
        echo,
        duplicate: false,
    }
}

#[tokio::test(start_paused = true)]
async fn the_client_draws_commits_and_says_goodbye() {
    let mut live = start();
    let (client, mut events) = connect(&live).await;
    let s = stroke("o7k2m9x4q");
    let begin = InkBegin {
        s,
        layer: "l1".into(),
        tool: Tool::Highlighter,
        fill: "#ffcc00".into(),
        fill_opacity: 0.4,
        brush: "pf1".into(),
    };
    client.ink(Ink::Begin(begin.clone())).unwrap();
    // Più di 256 campioni in una volta: partono in più messaggi, tutti.
    let pts: Vec<[f64; 4]> = (0..600)
        .map(|i| [f64::from(i), 0.0, 0.5, f64::from(i)])
        .collect();
    client
        .ink(Ink::Points(InkPoints {
            s,
            pts: pts.clone(),
        }))
        .unwrap();
    client.ink(Ink::End(s)).unwrap();
    client
        .view(View {
            x: 1.0,
            y: 2.0,
            scale: 1.5,
            w: 800.0,
            h: 600.0,
        })
        .unwrap();
    let c = client.commit(ops("o1")).unwrap();
    assert_eq!(c, Counter(1));

    assert!(matches!(
        live.events.find(|event| match event { LiveEvent::InkBegin(got) => Some(got), _ => None }).await,
        got if got == begin
    ));
    let mut received = Vec::new();
    while received.len() < pts.len() {
        let more = live
            .events
            .find(|event| match event {
                LiveEvent::InkPoints(points) => Some(points.pts),
                _ => None,
            })
            .await;
        received.extend(more);
    }
    assert_eq!(received, pts);
    live.events
        .find(|event| matches!(event, LiveEvent::InkEnd { .. }).then_some(()))
        .await;
    let (got, got_ops) = shell_commit(&mut live).await;
    assert_eq!((got, got_ops), (c, ops("o1")));
    assert_eq!(client.pending().len(), 1);

    live.host.send(ack(c, 8, ops("o1"))).unwrap();
    let acked = find(&mut events, |event| match event {
        ClientEvent::Ack(ack) => Some(ack),
        _ => None,
    })
    .await;
    assert_eq!(
        (acked.c, acked.seq, acked.duplicate),
        (c, Counter(8), false)
    );
    assert!(client.pending().is_empty());

    assert!(client.close().await.is_empty());
    let reason = live
        .events
        .find(|event| match event {
            LiveEvent::WriterDisconnected {
                reason, resumable, ..
            } => Some((reason, resumable)),
            _ => None,
        })
        .await;
    assert_eq!(reason, (LeaveReason::WriterBye, false));
    let cause = find(&mut events, |event| match event {
        ClientEvent::Ended { cause, unconfirmed } => Some((cause, unconfirmed)),
        _ => None,
    })
    .await;
    assert_eq!(cause.0, EndCause::Local);
    assert!(cause.1.is_empty());
    assert!(events.recv().await.is_none());
}

#[tokio::test(start_paused = true)]
async fn the_client_estimates_how_far_ahead_the_pc_clock_is() {
    let mut live = start();
    let mut config = ClientConfig::new(device(), caps());
    // Il tablet è 1,5 secondi indietro rispetto al PC.
    config.clock = Arc::new(|| wall_clock_ms() - 1500.0);
    let (client, mut events) = connect_with(&live, config).await;
    let estimate = find(&mut events, |event| match event {
        ClientEvent::Clock(estimate) => Some(estimate),
        _ => None,
    })
    .await;
    assert!((estimate.offset_ms - 1500.0).abs() < 250.0, "{estimate:?}");
    assert!(estimate.rtt_ms.is_some());
    assert_eq!(client.clock(), Some(estimate));
    // Anche l'host vede lo stesso scarto.
    let host = live
        .events
        .find(|event| match event {
            LiveEvent::Clock(estimate) => Some(estimate),
            _ => None,
        })
        .await;
    assert!((host.offset_ms - 1500.0).abs() < 250.0, "{host:?}");
}

#[tokio::test(start_paused = true)]
async fn a_fall_resumes_and_resends_only_the_commits_above_last_c() {
    let mut live = start();
    let (client, mut events) = connect(&live).await;
    let first = client.commit(ops("o1")).unwrap();
    let second = client.commit(ops("o2")).unwrap();
    let third = client.commit(ops("o3")).unwrap();
    for expected in [first, second, third] {
        assert_eq!(shell_commit(&mut live).await.0, expected);
    }
    live.host.send(ack(first, 8, ops("o1"))).unwrap();
    find(&mut events, |event| {
        matches!(event, ClientEvent::Ack(_)).then_some(())
    })
    .await;

    live.net.cut();
    let retry = find(&mut events, |event| match event {
        ClientEvent::Disconnected { retry } => Some(retry),
        _ => None,
    })
    .await;
    assert_eq!(retry, Retry::Resume);
    // Un commit fatto mentre la rete manca parte alla ripresa.
    let fourth = client.commit(ops("o4")).unwrap();
    let last_c = find(&mut events, |event| match event {
        ClientEvent::Connected {
            resumed: true,
            last_c,
            ..
        } => Some(last_c),
        _ => None,
    })
    .await;
    assert_eq!(last_c, first);

    // La shell vede il quarto commit e nessun doppione del secondo e del terzo.
    assert_eq!(shell_commit(&mut live).await.0, fourth);
    for (c, seq, id) in [(second, 9, "o2"), (third, 10, "o3"), (fourth, 11, "o4")] {
        live.host.send(ack(c, seq, ops(id))).unwrap();
    }
    for expected in [second, third, fourth] {
        let acked = find(&mut events, |event| match event {
            ClientEvent::Ack(ack) => Some(ack.c),
            _ => None,
        })
        .await;
        assert_eq!(acked, expected);
    }
    assert!(client.pending().is_empty());
    let commits = live
        .events
        .ready()
        .into_iter()
        .filter(|event| matches!(event, LiveEvent::Commit { .. }));
    assert_eq!(commits.count(), 0);
    assert_eq!(live.host.status().stats.admitted, 2);
}

#[tokio::test(start_paused = true)]
async fn while_the_network_is_down_the_client_retries_with_backoff() {
    let mut live = start();
    let (client, mut events) = connect(&live).await;
    live.net.set_down(true);
    live.net.cut();
    find(&mut events, |event| {
        matches!(event, ClientEvent::Disconnected { .. }).then_some(())
    })
    .await;
    let c = client.commit(ops("o1")).unwrap();
    // Trenta secondi senza rete: i tentativi si diradano fino a 5 secondi,
    // la finestra della ripresa resta aperta.
    tokio::time::sleep(Duration::from_secs(30)).await;
    assert_eq!(client.pending().len(), 1);
    let back = Instant::now();
    live.net.set_down(false);
    find(&mut events, |event| match event {
        ClientEvent::Connected { resumed: true, .. } => Some(()),
        ClientEvent::Ended { cause, .. } => panic!("the client gave up: {cause:?}"),
        _ => None,
    })
    .await;
    assert!(
        back.elapsed() <= Duration::from_secs(5),
        "{:?}",
        back.elapsed()
    );
    assert_eq!(shell_commit(&mut live).await.0, c);
    // Nessun tentativo in più arriva all'host oltre a quello riuscito.
    assert_eq!(live.host.status().stats.accepted, 2);
}

#[tokio::test(start_paused = true)]
async fn a_silent_network_is_noticed_and_the_resume_replaces_the_stale_connection() {
    let mut live = start();
    let (_client, mut events) = connect(&live).await;
    live.events
        .find(|event| matches!(event, LiveEvent::WriterConnected { .. }).then_some(()))
        .await;
    let silenced = Instant::now();
    live.net.silence();
    find(&mut events, |event| {
        matches!(event, ClientEvent::Disconnected { .. }).then_some(())
    })
    .await;
    // Il client si accorge del silenzio a 25 secondi, prima che l'host conti
    // due heartbeat mancati.
    assert!(
        silenced.elapsed() <= Duration::from_secs(25),
        "{:?}",
        silenced.elapsed()
    );
    find(&mut events, |event| {
        matches!(event, ClientEvent::Connected { resumed: true, .. }).then_some(())
    })
    .await;
    let mut seen = Vec::new();
    while seen.len() < 2 {
        match live.events.next().await.unwrap() {
            LiveEvent::WriterDisconnected {
                reason, resumable, ..
            } => seen.push(format!("{reason:?} {resumable}")),
            LiveEvent::WriterConnected { resumed, .. } => seen.push(format!("connected {resumed}")),
            _ => {}
        }
    }
    assert_eq!(seen, ["Lost true", "connected true"]);
}

#[tokio::test(start_paused = true)]
async fn the_end_of_the_session_leaves_the_unanswered_commits_to_the_app() {
    let mut live = start();
    let (client, mut events) = connect(&live).await;
    let c = client.commit(ops("o1")).unwrap();
    shell_commit(&mut live).await;
    let report = live.host.stop(EndReason::DocumentClosed).await;
    assert_eq!(report.pending.len(), 1);
    let (cause, unconfirmed) = find(&mut events, |event| match event {
        ClientEvent::Ended { cause, unconfirmed } => Some((cause, unconfirmed)),
        _ => None,
    })
    .await;
    assert_eq!(
        cause,
        EndCause::Closed {
            code: 4005,
            detail: "the document was closed on the PC".into()
        }
    );
    assert_eq!(unconfirmed.len(), 1);
    assert_eq!((unconfirmed[0].c, &unconfirmed[0].ops), (c, &ops("o1")));
    assert_eq!(client.commit(ops("o2")), Err(CommitError::Ended));
    assert_eq!(client.close().await.len(), 1);
}

#[tokio::test(start_paused = true)]
async fn without_the_host_the_client_gives_up_two_minutes_after_the_fall() {
    let live = start();
    let (client, mut events) = connect(&live).await;
    client.commit(ops("o1")).unwrap();
    let Live { host, .. } = live;
    host.stop(EndReason::HostClosing).await;
    let fell = Instant::now();
    let retry = find(&mut events, |event| match event {
        ClientEvent::Disconnected { retry } => Some(retry),
        _ => None,
    })
    .await;
    assert_eq!(retry, Retry::Resume);
    let (cause, unconfirmed) = find(&mut events, |event| match event {
        ClientEvent::Ended { cause, unconfirmed } => Some((cause, unconfirmed)),
        _ => None,
    })
    .await;
    assert_eq!(cause, EndCause::ResumeExpired);
    assert_eq!(unconfirmed.len(), 1);
    let elapsed = fell.elapsed();
    assert!(
        elapsed >= Duration::from_secs(120) && elapsed < Duration::from_secs(126),
        "{elapsed:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn a_nack_lost_in_the_fall_reaches_the_app_once() {
    let mut live = start();
    let (client, mut events) = connect(&live).await;
    let first = client.commit(ops("o1")).unwrap();
    let second = client.commit(ops("o2")).unwrap();
    shell_commit(&mut live).await;
    shell_commit(&mut live).await;
    // Il `nack` parte mentre la rete è muta e si perde.
    live.net.silence();
    live.host
        .send(ShellMessage::Nack {
            writer: WRITER,
            c: first,
            reason: NackReason::Locked,
            detail: "the layer is locked".into(),
            index: Some(0),
        })
        .unwrap();
    live.net.cut();
    let last_c = find(&mut events, |event| match event {
        ClientEvent::Connected {
            resumed: true,
            last_c,
            ..
        } => Some(last_c),
        _ => None,
    })
    .await;
    assert_eq!(last_c, first);
    let nack = find(&mut events, |event| match event {
        ClientEvent::Nack(nack) => Some(nack),
        _ => None,
    })
    .await;
    assert_eq!((nack.c, nack.reason), (first, NackReason::Locked));
    assert_eq!(client.pending().len(), 1);

    // Il secondo commit, rimandato, riceve la sua risposta; a un'altra
    // ripresa il `nack` torna, ma l'app non lo vede due volte.
    live.host.send(ack(second, 8, ops("o2"))).unwrap();
    find(&mut events, |event| {
        matches!(event, ClientEvent::Ack(_)).then_some(())
    })
    .await;
    live.net.cut();
    find(&mut events, |event| {
        matches!(event, ClientEvent::Connected { resumed: true, .. }).then_some(())
    })
    .await;
    let client_ping = find(&mut events, |event| match event {
        ClientEvent::Clock(_) => Some(()),
        ClientEvent::Nack(nack) => panic!("the nack of {} came twice", nack.c),
        _ => None,
    });
    client_ping.await;
    assert!(client.pending().is_empty());
}

#[tokio::test(start_paused = true)]
async fn the_client_keeps_under_the_rate_of_the_host() {
    let mut live = start();
    let (client, _events) = connect(&live).await;
    let started = Instant::now();
    let strokes: Vec<String> = (0..600).map(|i| format!("o{i:08}")).collect();
    for s in &strokes {
        client.ink(Ink::Cancel(stroke(s))).unwrap();
    }
    for _ in 0..600 {
        live.events
            .find(|event| matches!(event, LiveEvent::InkCancel { .. }).then_some(()))
            .await;
    }
    // 600 messaggi a 120 al secondo: quasi 5 secondi, e nessuna chiusura.
    assert!(
        started.elapsed() >= Duration::from_secs(4),
        "{:?}",
        started.elapsed()
    );
    assert!(live.host.status().writer.unwrap().connected);
}

#[tokio::test(start_paused = true)]
async fn a_snapshot_of_20_mib_reaches_the_client_in_one_message() {
    let live = start();
    let (_client, mut events) = connect(&live).await;
    live.host
        .send(ShellMessage::Snapshot {
            seq: Counter(8),
            text: "a".repeat(MAX_SNAPSHOT),
        })
        .unwrap();
    let snapshot = find(&mut events, |event| match event {
        ClientEvent::Snapshot(snapshot) => Some(snapshot),
        _ => None,
    })
    .await;
    assert_eq!(
        (snapshot.seq, snapshot.text.len()),
        (Counter(8), MAX_SNAPSHOT)
    );
}

#[tokio::test(start_paused = true)]
async fn the_client_refuses_before_sending_what_the_protocol_does_not_allow() {
    let live = start();
    let config = ClientConfig::new(device(), caps());

    let public = PairingTarget {
        addr: SocketAddrV4::new(Ipv4Addr::new(8, 8, 8, 8), 4000),
        ..live.target.clone()
    };
    assert!(matches!(
        LiveClient::connect_in_memory(&live.net, public, config.clone()).await,
        Err(ConnectError::NotPrivate(ip)) if ip == Ipv4Addr::new(8, 8, 8, 8)
    ));
    let mut long = config.clone();
    long.device = Device {
        name: "a".repeat(200),
        kind: "tablet".into(),
    };
    assert!(matches!(
        LiveClient::connect_in_memory(&live.net, live.target.clone(), long).await,
        Err(ConnectError::InvalidDevice)
    ));
    let wrong = PairingTarget {
        secret: PairingSecret::parse("AAAAAAAAAAAAAAAAAAAAAA").unwrap(),
        ..live.target.clone()
    };
    match LiveClient::connect_in_memory(&live.net, wrong, config.clone()).await {
        Err(ConnectError::Refused { code, detail }) => {
            assert_eq!(
                (code, detail.as_str()),
                (4004, "the pairing secret is wrong")
            );
        }
        other => panic!("expected a refusal, got {:?}", other.map(|_| ())),
    }
    assert_eq!(live.host.status().stats.accepted, 1);

    let (client, _events) = connect(&live).await;
    let s = stroke("o7k2m9x4q");
    assert!(client
        .ink(Ink::Points(InkPoints {
            s,
            pts: vec![[0.0, 0.0, 2.0, 0.0]]
        }))
        .is_err());
    assert!(client
        .ink(Ink::Points(InkPoints { s, pts: Vec::new() }))
        .is_err());
    assert!(client
        .view(View {
            x: 0.0,
            y: 0.0,
            scale: 0.0,
            w: 1.0,
            h: 1.0
        })
        .is_err());
    let many = Ops::parse(
        &format!("[{}]", vec![r#"{"op":"add"}"#; 10_001].join(",")),
        usize::MAX,
    )
    .unwrap();
    assert_eq!(
        client.commit(many),
        Err(CommitError::TooManyOperations { count: 10_001 })
    );
    let big = super::support::heavy_ops(MAX_COMMIT);
    assert!(matches!(
        client.commit(big),
        Err(CommitError::TooLarge { .. })
    ));
    assert!(client.pending().is_empty());
}

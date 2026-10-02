//! L'API dell'host per la shell (FD-303): gli eventi, `send`, `status`,
//! `stop`, e la chiusura che non lascia compiti né porte.

use std::net::{Ipv4Addr, SocketAddrV4};
use std::sync::atomic::Ordering;
use std::time::Duration;

use tokio::net::{TcpListener, TcpStream};

use super::support::{caps, config, device, join, ops, rejoin, start, Live, Raw, SEQ, SNAPSHOT};
use crate::client::{ClientConfig, ClientEvent, ConnectError, EndCause, LiveClient};
use crate::clock::wall_clock_ms;
use crate::counter::{Counter, WriterId};
use crate::host::{
    EndReason, LiveEvent, LiveHost, PendingCommit, SendError, ShellMessage, StartError,
};
use crate::net::ListenAddr;
use crate::pairing::PairingTarget;
use crate::protocol::{
    HostMessage, InkBegin, InkPoints, NackReason, Ping, Tool, View, WriterMessage,
};
use crate::token::Fingerprint;

const WRITER: WriterId = WriterId(1);

async fn pong(raw: &mut Raw) -> crate::protocol::Pong {
    loop {
        match raw.recv().await {
            Some(HostMessage::Pong(pong)) => return pong,
            Some(_) => {}
            None => panic!("the host closed the connection"),
        }
    }
}

async fn commit_event(live: &mut Live) -> Counter {
    live.events
        .find(|event| match event {
            LiveEvent::Commit { c, .. } => Some(c),
            _ => None,
        })
        .await
}

#[tokio::test(start_paused = true)]
async fn stop_returns_the_unanswered_commits_and_leaves_no_task() {
    let mut live = start();
    let tasks = live.host.live_tasks();
    let (mut raw, _) = join(&live.net, &live.target).await;
    assert!(raw.commit(1, ops("o1")).await);
    assert!(raw.commit(2, ops("o2")).await);
    assert_eq!(commit_event(&mut live).await, Counter(1));
    assert_eq!(commit_event(&mut live).await, Counter(2));
    live.host
        .send(ShellMessage::Ack {
            writer: WRITER,
            c: Counter(1),
            seq: Counter(8),
            echo: ops("o1"),
            duplicate: false,
        })
        .unwrap();
    assert!(tasks.load(Ordering::Acquire) >= 2);

    let report = live.host.stop(EndReason::Terminated).await;
    assert_eq!(
        report.pending,
        [PendingCommit {
            writer: WRITER,
            c: Counter(2),
            ops: ops("o2")
        }]
    );
    assert_eq!(tasks.load(Ordering::Acquire), 0);
    assert_eq!(raw.closed().await.code, Some(1000));
    // L'ultimo evento è la fine, poi più niente.
    let mut last = None;
    while let Some(event) = live.events.next().await {
        last = Some(event);
    }
    assert!(matches!(
        last,
        Some(LiveEvent::Ended {
            reason: EndReason::Terminated
        })
    ));
}

#[tokio::test(start_paused = true)]
async fn dropping_the_host_closes_the_session_like_the_app() {
    let Live {
        host,
        mut events,
        net,
        target,
    } = start();
    let tasks = host.live_tasks();
    let (mut raw, _) = join(&net, &target).await;
    drop(host);
    let closed = raw.closed().await;
    assert_eq!(closed.code, Some(1001));
    let reason = events
        .find(|event| match event {
            LiveEvent::Ended { reason } => Some(reason),
            _ => None,
        })
        .await;
    assert_eq!(reason, EndReason::HostClosing);
    assert!(events.next().await.is_none());
    assert_eq!(tasks.load(Ordering::Acquire), 0);
}

#[tokio::test(start_paused = true)]
async fn the_shell_gets_every_sample_of_a_stroke_in_one_event_and_the_last_view() {
    let mut live = start();
    let (mut raw, _) = join(&live.net, &live.target).await;
    live.events
        .find(|event| matches!(event, LiveEvent::WriterConnected { .. }).then_some(()))
        .await;
    let s = super::support::stroke("o7k2m9x4q");
    let begin = InkBegin {
        s,
        layer: "l1".into(),
        tool: Tool::Pen,
        fill: "#112233".into(),
        fill_opacity: 1.0,
        brush: "pf1".into(),
    };
    assert!(raw.send(&WriterMessage::InkBegin(begin.clone())).await);
    for index in 0..50 {
        let t = f64::from(index);
        let pts = vec![[t, t, 0.5, 2.0 * t], [t, t + 0.5, 0.5, 2.0 * t + 1.0]];
        assert!(
            raw.send(&WriterMessage::InkPoints(InkPoints { s, pts }))
                .await
        );
    }
    for x in [1.0, 2.0, 3.0] {
        let view = View {
            x,
            y: 0.0,
            scale: 1.0,
            w: 800.0,
            h: 600.0,
        };
        assert!(raw.send(&WriterMessage::View(view)).await);
    }
    assert!(raw.send(&WriterMessage::InkEnd(s)).await);
    // Il `pong` dice che l'host ha letto tutto; la shell legge solo ora.
    assert!(
        raw.send(&WriterMessage::Ping(Ping { id: 1, a: 10.0 }))
            .await
    );
    pong(&mut raw).await;

    let events = live.events.ready();
    assert_eq!(events.len(), 5, "{events:?}");
    assert!(matches!(&events[0], LiveEvent::InkBegin(got) if *got == begin));
    match &events[1] {
        LiveEvent::InkPoints(points) => {
            assert_eq!(points.pts.len(), 100);
            assert!(points.pts.windows(2).all(|pair| pair[0][3] < pair[1][3]));
        }
        other => panic!("expected the samples, got {other:?}"),
    }
    assert!(matches!(&events[2], LiveEvent::View(view) if view.x == 3.0));
    assert!(matches!(&events[3], LiveEvent::InkEnd { s: got } if *got == s));
    assert!(matches!(&events[4], LiveEvent::Clock(_)));
}

#[tokio::test(start_paused = true)]
async fn a_ping_gets_a_pong_with_the_pc_clock() {
    let mut live = start();
    let (mut raw, _) = join(&live.net, &live.target).await;
    let before = wall_clock_ms();
    assert!(
        raw.send(&WriterMessage::Ping(Ping { id: 7, a: 123.5 }))
            .await
    );
    let pong = pong(&mut raw).await;
    let after = wall_clock_ms();
    assert_eq!((pong.id, pong.a), (7, 123.5));
    assert!(
        before <= pong.b && pong.b <= after,
        "{before} {} {after}",
        pong.b
    );
    let estimate = live
        .events
        .find(|event| match event {
            LiveEvent::Clock(estimate) => Some(estimate),
            _ => None,
        })
        .await;
    // Senza un giro di heartbeat misurato, l'andata vale zero. Il confronto
    // ammette l'ultima cifra: `serde_json` legge i decimali senza garantire
    // il valore più vicino.
    assert!(
        (estimate.offset_ms - (pong.b - 123.5)).abs() < 1e-3,
        "{estimate:?} {pong:?}"
    );
    assert_eq!(estimate.rtt_ms, None);
    assert_eq!(live.host.status().writer.unwrap().clock, Some(estimate));
}

#[tokio::test(start_paused = true)]
async fn the_shell_operations_and_snapshots_reach_the_writer_and_whoever_comes_back() {
    let mut live = start();
    let (mut raw, welcome) = join(&live.net, &live.target).await;
    live.host
        .send(ShellMessage::Ops {
            seq: Counter(8),
            ops: ops("p1"),
        })
        .unwrap();
    assert!(
        matches!(raw.recv().await, Some(HostMessage::Ops(message)) if message.seq == Counter(8) && message.ops == ops("p1"))
    );
    // Gli snapshot in coda non si accumulano: vale l'ultimo.
    live.host
        .send(ShellMessage::Snapshot {
            seq: Counter(9),
            text: "<svg/>".into(),
        })
        .unwrap();
    assert!(
        matches!(raw.recv().await, Some(HostMessage::Snapshot(snapshot)) if snapshot.seq == Counter(9))
    );
    assert_eq!(live.host.status().seq, Counter(9));

    live.net.cut();
    drop(raw);
    live.events
        .find(|event| matches!(event, LiveEvent::WriterDisconnected { .. }).then_some(()))
        .await;
    let (mut raw, again) = rejoin(&live.net, &live.target, &welcome.resume).await;
    assert_eq!(again.seq, Counter(9));
    // Lo snapshot nuovo, e nessun registro dietro.
    assert!(
        matches!(raw.recv().await, Some(HostMessage::Snapshot(snapshot)) if snapshot.text == "<svg/>")
    );
    assert!(raw.ping(1).await);
    assert!(matches!(raw.recv().await, Some(HostMessage::Pong(_))));
}

#[tokio::test(start_paused = true)]
async fn send_refuses_what_the_session_cannot_deliver_and_changes_nothing() {
    let mut live = start();
    let (mut raw, _) = join(&live.net, &live.target).await;
    assert!(raw.commit(1, ops("o1")).await);
    assert!(raw.commit(2, ops("o2")).await);
    commit_event(&mut live).await;
    commit_event(&mut live).await;

    let unknown = live.host.send(ShellMessage::Nack {
        writer: WRITER,
        c: Counter(5),
        reason: NackReason::Locked,
        detail: String::new(),
        index: None,
    });
    assert_eq!(
        unknown,
        Err(SendError::UnknownCommit {
            writer: WRITER,
            c: Counter(5)
        })
    );
    let other_writer = live.host.send(ShellMessage::Ack {
        writer: WriterId(2),
        c: Counter(1),
        seq: Counter(8),
        echo: ops("o1"),
        duplicate: false,
    });
    assert!(matches!(other_writer, Err(SendError::UnknownCommit { .. })));
    let backwards = live.host.send(ShellMessage::Ack {
        writer: WRITER,
        c: Counter(1),
        seq: Counter(6),
        echo: ops("o1"),
        duplicate: false,
    });
    assert_eq!(
        backwards,
        Err(SendError::SeqRegression {
            seq: Counter(6),
            current: SEQ
        })
    );
    let long = live.host.send(ShellMessage::Nack {
        writer: WRITER,
        c: Counter(1),
        reason: NackReason::InvalidElem,
        detail: "x".repeat(64 * 1024 + 1),
        index: None,
    });
    assert_eq!(
        long,
        Err(SendError::TooLarge {
            size: 64 * 1024 + 1,
            limit: 64 * 1024
        })
    );
    for message in [
        ShellMessage::Ops {
            seq: Counter(6),
            ops: ops("p1"),
        },
        ShellMessage::Snapshot {
            seq: Counter(6),
            text: "<svg/>".into(),
        },
    ] {
        assert!(matches!(
            live.host.send(message),
            Err(SendError::SeqRegression { .. })
        ));
    }
    let status = live.host.status();
    assert_eq!((status.seq, status.pending.len()), (SEQ, 2));

    // Un `ack` duplicato non sposta il documento, e il contatore può restare
    // quello di prima.
    live.host
        .send(ShellMessage::Ack {
            writer: WRITER,
            c: Counter(2),
            seq: SEQ,
            echo: ops("o2"),
            duplicate: true,
        })
        .unwrap();
    match raw.recv().await {
        Some(HostMessage::Ack(ack)) => {
            assert!(ack.duplicate && ack.c == Counter(2) && ack.seq == SEQ)
        }
        other => panic!("expected the ack, got {other:?}"),
    }
    let status = live.host.status();
    assert_eq!(
        status.pending,
        [PendingCommit {
            writer: WRITER,
            c: Counter(1),
            ops: ops("o1")
        }]
    );
    assert_eq!((status.stats.commits, status.stats.answered), (2, 1));
}

#[tokio::test(start_paused = true)]
async fn status_follows_the_writer_through_a_fall() {
    let mut live = start();
    let status = live.host.status();
    assert!(!status.ended && status.writer.is_none());
    assert_eq!(status.pairing_expires_in_ms, Some(300_000));
    let (raw, _) = join(&live.net, &live.target).await;
    live.events
        .find(|event| matches!(event, LiveEvent::WriterConnected { .. }).then_some(()))
        .await;
    let writer = live.host.status().writer.unwrap();
    assert_eq!(
        (writer.writer, writer.device, writer.caps),
        (WRITER, device(), caps())
    );
    assert!(writer.connected && writer.resume_expires_in_ms.is_none());
    assert_eq!(live.host.status().pairing_expires_in_ms, None);

    live.net.cut();
    drop(raw);
    live.events
        .find(|event| matches!(event, LiveEvent::WriterDisconnected { .. }).then_some(()))
        .await;
    tokio::time::sleep(Duration::from_secs(30)).await;
    let writer = live.host.status().writer.unwrap();
    assert!(!writer.connected);
    assert_eq!(writer.resume_expires_in_ms, Some(90_000));
    let stats = live.host.status().stats;
    assert_eq!(
        (
            stats.accepted,
            stats.admitted,
            stats.rejected,
            stats.refused
        ),
        (1, 1, 0, 0)
    );
}

#[tokio::test(start_paused = true)]
async fn a_start_with_an_invalid_document_or_name_is_refused() {
    let mut document = config();
    document.document.id = String::new();
    assert!(matches!(
        LiveHost::start_in_memory(document),
        Err(StartError::InvalidDocument)
    ));
    let mut name = config();
    name.host_name = Some("a\nb".into());
    assert!(matches!(
        LiveHost::start_in_memory(name),
        Err(StartError::InvalidHostName)
    ));
}

/// Sul loopback, con il TCP vero e l'orologio vero: il percorso che la shell
/// usa, su ogni sistema della CI.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn over_tcp_the_session_runs_and_then_frees_its_port_and_its_tasks() {
    // Con l'orologio vero un blocco non scade da solo: un minuto basta e
    // avanza a una prova che dura qualche millisecondo.
    tokio::time::timeout(Duration::from_secs(60), over_tcp())
        .await
        .expect("the loopback session got stuck");
}

async fn over_tcp() {
    let mut loopback = config();
    loopback.listen = ListenAddr::loopback();
    let (host, events) = LiveHost::start(loopback.clone()).await.unwrap();
    let mut events = super::support::Events::new(events);
    let tasks = host.live_tasks();
    let addr = host.info().addr;
    assert_eq!(*addr.ip(), Ipv4Addr::LOCALHOST);
    assert_ne!(addr.port(), 0);
    // La porta è presa: una seconda sessione lì non parte.
    loopback.port = addr.port();
    assert!(matches!(
        LiveHost::start(loopback).await,
        Err(StartError::Bind { .. })
    ));

    let target = PairingTarget::parse(&host.pairing().unwrap().payload).unwrap();
    // Un certificato diverso da quello del QR: il client non manda niente.
    let stranger = PairingTarget {
        fingerprint: Fingerprint::of_certificate(b"stranger"),
        ..target.clone()
    };
    let config = ClientConfig::new(device(), caps());
    assert!(matches!(
        LiveClient::connect(stranger, config.clone()).await,
        Err(ConnectError::FingerprintMismatch)
    ));

    let (client, mut client_events) = LiveClient::connect(target, config).await.unwrap();
    assert!(matches!(
        client_events.recv().await,
        Some(ClientEvent::Connected { resumed: false, .. })
    ));
    assert!(
        matches!(client_events.recv().await, Some(ClientEvent::Snapshot(snapshot)) if snapshot.text == SNAPSHOT)
    );
    let c = client.commit(ops("o1")).unwrap();
    let got = events
        .find(|event| match event {
            LiveEvent::Commit { c, .. } => Some(c),
            _ => None,
        })
        .await;
    assert_eq!(got, c);
    host.send(ShellMessage::Ack {
        writer: WRITER,
        c,
        seq: Counter(8),
        echo: ops("o1"),
        duplicate: false,
    })
    .unwrap();
    loop {
        match client_events.recv().await {
            Some(ClientEvent::Ack(ack)) => {
                assert_eq!(ack.c, c);
                break;
            }
            Some(_) => {}
            None => panic!("the client ended"),
        }
    }
    let stats = host.status().stats;
    assert_eq!((stats.admitted, stats.rejected), (1, 1));

    let report = host.stop(EndReason::Terminated).await;
    assert!(report.pending.is_empty());
    assert_eq!(tasks.load(Ordering::Acquire), 0);
    loop {
        match client_events.recv().await {
            Some(ClientEvent::Ended { cause, unconfirmed }) => {
                assert!(
                    matches!(cause, EndCause::Closed { code: 1000, .. }),
                    "{cause:?}"
                );
                assert!(unconfirmed.is_empty());
                break;
            }
            Some(_) => {}
            None => panic!("the client ended without saying why"),
        }
    }
    drop(client);
    // Il listener è chiuso: nessuno si collega, e la porta si lega di nuovo.
    assert!(TcpStream::connect(addr).await.is_err());
    let again = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, addr.port())).await;
    assert!(again.is_ok(), "{again:?}");
}

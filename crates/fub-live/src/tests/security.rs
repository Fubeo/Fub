//! Le contromisure di §9 che stanno nel crate: l'impronta, il segreto, le
//! richieste ammesse, i limiti contro l'esaurimento delle risorse.

use std::net::Ipv4Addr;
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::{sleep, Instant};
use tokio_rustls::TlsConnector;
use tokio_tungstenite::tungstenite::Error as WsError;

use super::support::{caps, device, join, ops, start, Raw};
use crate::client::{ClientConfig, ConnectError, LiveClient};
use crate::counter::Counter;
use crate::host::{LeaveReason, LiveEvent, ShellMessage};
use crate::net::ListenAddr;
use crate::pairing::PairingTarget;
use crate::tls::{client_config, server_name};
use crate::token::Fingerprint;

#[tokio::test(start_paused = true)]
async fn a_host_without_the_certificate_of_the_qr_gets_nothing_from_the_writer() {
    let mut live = start();
    let stranger = PairingTarget {
        fingerprint: Fingerprint::of_certificate(b"stranger"),
        ..live.target.clone()
    };
    let connected = LiveClient::connect_in_memory(
        &live.net,
        stranger.clone(),
        ClientConfig::new(device(), caps()),
    )
    .await;
    assert!(matches!(connected, Err(ConnectError::FingerprintMismatch)));
    assert!(Raw::try_open(&live.net, &stranger, "/live", None)
        .await
        .is_err());
    // L'host ha visto due handshake TLS falliti e nessun `hello`.
    sleep(Duration::from_millis(1)).await;
    let stats = live.host.status().stats;
    assert_eq!((stats.accepted, stats.admitted, stats.rejected), (2, 0, 2));
    assert!(live.events.ready().is_empty());
    assert!(live.host.pairing().is_some());
}

#[tokio::test(start_paused = true)]
async fn only_the_live_path_and_the_origin_of_the_host_open_a_session() {
    let live = start();
    let status = |result: Result<Raw, WsError>| match result {
        Ok(_) => 101,
        Err(WsError::Http(response)) => response.status().as_u16(),
        Err(error) => panic!("unexpected error {error}"),
    };
    let target = &live.target;
    assert_eq!(
        status(Raw::try_open(&live.net, target, "/", None).await),
        404
    );
    assert_eq!(
        status(Raw::try_open(&live.net, target, "/live/", None).await),
        404
    );
    assert_eq!(
        status(Raw::try_open(&live.net, target, "/live?s=1", None).await),
        404
    );
    // Una pagina di un altro sito non apre la sessione dal browser del tablet.
    let evil = Some("https://evil.example");
    assert_eq!(
        status(Raw::try_open(&live.net, target, "/live", evil).await),
        403
    );
    let own = format!("https://{}", target.addr);
    assert_eq!(
        status(Raw::try_open(&live.net, target, "/live", Some(&own)).await),
        101
    );
    assert_eq!(
        status(Raw::try_open(&live.net, target, "/live", None).await),
        101
    );
}

#[tokio::test(start_paused = true)]
async fn a_request_that_is_not_an_upgrade_is_dropped() {
    let live = start();
    let io = live.net.dial().unwrap();
    let mut tls = TlsConnector::from(client_config(live.target.fingerprint).unwrap())
        .connect(server_name(*live.target.addr.ip()), io)
        .await
        .unwrap();
    let request = format!("GET /live HTTP/1.1\r\nHost: {}\r\n\r\n", live.target.addr);
    tls.write_all(request.as_bytes()).await.unwrap();
    tls.flush().await.unwrap();
    let mut response = Vec::new();
    let _ = tls.read_to_end(&mut response).await;
    let response = String::from_utf8_lossy(&response);
    assert!(!response.contains("101"), "{response}");
    sleep(Duration::from_millis(1)).await;
    assert_eq!(live.host.status().stats.rejected, 1);
}

#[tokio::test(start_paused = true)]
async fn more_than_eight_connections_negotiating_at_once_are_refused() {
    let live = start();
    let started = Instant::now();
    let idle: Vec<_> = (0..8).map(|_| live.net.dial().unwrap()).collect();
    sleep(Duration::from_millis(1)).await;
    let mut ninth = live.net.dial().unwrap();
    let mut byte = [0u8; 1];
    assert_eq!(ninth.read(&mut byte).await.unwrap(), 0);
    assert_eq!(started.elapsed(), Duration::from_millis(1));
    assert_eq!(live.host.status().stats.refused, 1);

    // Allo scadere dei 5 secondi del `hello` i posti tornano liberi.
    sleep(Duration::from_secs(5)).await;
    join(&live.net, &live.target).await;
    let stats = live.host.status().stats;
    assert_eq!(
        (
            stats.accepted,
            stats.refused,
            stats.rejected,
            stats.admitted
        ),
        (10, 1, 8, 1)
    );
    drop(idle);
}

#[tokio::test(start_paused = true)]
async fn a_writer_that_sends_more_than_64_kib_before_its_hello_is_cut_off() {
    let live = start();
    let mut raw = Raw::open(&live.net, &live.target).await;
    assert!(raw.text("a".repeat(100 * 1024)).await);
    let closed = raw.closed().await;
    if let Some(code) = closed.code {
        assert_eq!(code, 4002, "{closed:?}");
    }
    assert_eq!(live.host.status().stats.admitted, 0);
}

#[tokio::test(start_paused = true)]
async fn the_operations_reach_the_shell_as_sent_and_only_their_shape_is_checked() {
    let mut live = start();
    let (mut raw, _) = join(&live.net, &live.target).await;
    // Il contenuto lo valida la shell come quello locale: l'host non lo
    // interpreta e non lo riscrive.
    let hostile = r#"[{"op":"add","parent":"l1","elem":{"tag":"script","d":"M0 0","on":"x"}}]"#;
    let text = format!(r#"{{"v":1,"t":"commit","c":"1","ops":{hostile}}}"#);
    assert!(raw.text(text).await);
    let got = live
        .events
        .find(|event| match event {
            LiveEvent::Commit { ops, .. } => Some(ops),
            _ => None,
        })
        .await;
    assert_eq!(got.json(), hostile);
    // Una forma che non è un array di operazioni chiude con 1007.
    assert!(
        raw.text(r#"{"v":1,"t":"commit","c":"2","ops":[{"id":"o1"}]}"#)
            .await
    );
    assert_eq!(raw.close_code().await, 1007);
}

#[tokio::test(start_paused = true)]
async fn too_many_commits_waiting_for_the_pc_close_with_4006() {
    let mut live = start();
    let (mut raw, _) = join(&live.net, &live.target).await;
    sleep(Duration::from_secs(1)).await;
    for c in 1..=200 {
        assert!(raw.commit(c, ops("o1")).await);
    }
    sleep(Duration::from_secs(1)).await;
    for c in 201..=257 {
        raw.commit(c, ops("o1")).await;
    }
    let closed = raw.closed().await;
    assert_eq!((closed.code, closed.error), (Some(4006), Some(4006)));
    assert_eq!(
        closed.detail.as_deref(),
        Some("too many commits are waiting for the PC")
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
    assert_eq!(reason, (LeaveReason::TooMuchTraffic, true));
    // I commit arrivati restano alla shell.
    assert_eq!(live.host.status().pending.len(), 256);
}

#[tokio::test(start_paused = true)]
async fn a_writer_that_does_not_read_is_dropped_before_its_queue_grows() {
    let mut live = start();
    let (raw, _) = join(&live.net, &live.target).await;
    for seq in 8..10_008 {
        live.host
            .send(ShellMessage::Ops {
                seq: Counter(seq),
                ops: ops("p1"),
            })
            .unwrap();
    }
    let reason = live
        .events
        .find(|event| match event {
            LiveEvent::WriterDisconnected {
                reason, resumable, ..
            } => Some((reason, resumable)),
            _ => None,
        })
        .await;
    assert_eq!(reason, (LeaveReason::Congested, true));
    drop(raw);
}

#[test]
fn the_listener_binds_only_a_private_address() {
    for ip in [
        [10, 0, 0, 1],
        [172, 16, 0, 1],
        [172, 31, 255, 254],
        [192, 168, 1, 20],
    ] {
        assert!(ListenAddr::new(Ipv4Addr::from(ip)).is_ok(), "{ip:?}");
    }
    for ip in [
        [0, 0, 0, 0],
        [127, 0, 0, 1],
        [8, 8, 8, 8],
        [169, 254, 1, 1],
        [172, 32, 0, 1],
        [255, 255, 255, 255],
    ] {
        assert!(ListenAddr::new(Ipv4Addr::from(ip)).is_err(), "{ip:?}");
    }
}

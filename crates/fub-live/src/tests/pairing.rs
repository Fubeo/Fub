//! L'abbinamento e l'ingresso: il segreto monouso, l'ordine dei controlli,
//! il QR nuovo.

use std::time::Duration;

use tokio::time::sleep;
use zeroize::Zeroizing;

use super::support::{caps, device, document, hello, join, start, Raw, SEQ};
use crate::counter::{Counter, WriterId};
use crate::host::{LeaveReason, LiveEvent, ReleaseReason, RenewError};
use crate::limits::Limits;
use crate::pairing::PairingTarget;
use crate::protocol::{Credential, WriterMessage};
use crate::token::PairingSecret;

#[tokio::test(start_paused = true)]
async fn the_secret_admits_one_writer_and_then_is_spent() {
    let mut live = start();
    let (mut raw, welcome) = join(&live.net, &live.target).await;
    assert_eq!(welcome.session.encode(), live.target.session.encode());
    assert_eq!(welcome.doc, document());
    assert_eq!(welcome.seq, SEQ);
    assert_eq!(welcome.last_c, Counter(0));
    assert_eq!(welcome.limits, Limits::V1);
    let connected = live
        .events
        .find(|event| match event {
            LiveEvent::WriterConnected {
                writer,
                device,
                caps,
                resumed,
            } => Some((writer, device, caps, resumed)),
            _ => None,
        })
        .await;
    assert_eq!(connected, (WriterId(1), device(), caps(), false));

    // Il QR non vale più, né per la shell né per un secondo dispositivo: c'è
    // già uno scrittore (4003).
    assert!(live.host.pairing().is_none());
    let mut second = Raw::open(&live.net, &live.target).await;
    second.hello(&live.target).await;
    assert_eq!(second.close_code().await, 4003);

    // Lo scrittore saluta: l'abbinamento finisce e il segreto resta speso.
    assert!(raw.send(&WriterMessage::Bye).await);
    let closed = raw.closed().await;
    assert_eq!(closed.code, Some(1000));
    assert_eq!(closed.detail.as_deref(), Some("bye"));
    live.events
        .find(|event| {
            matches!(
                event,
                LiveEvent::WriterDisconnected {
                    reason: LeaveReason::WriterBye,
                    resumable: false,
                    ..
                }
            )
            .then_some(())
        })
        .await;
    let mut third = Raw::open(&live.net, &live.target).await;
    third.hello(&live.target).await;
    let closed = third.closed().await;
    assert_eq!((closed.code, closed.error), (Some(4004), Some(4004)));
    assert_eq!(
        closed.detail.as_deref(),
        Some("the pairing secret expired or was used")
    );

    let stats = live.host.status().stats;
    assert_eq!((stats.accepted, stats.admitted, stats.rejected), (3, 1, 2));
}

#[tokio::test(start_paused = true)]
async fn the_checks_run_in_the_order_of_the_spec() {
    // Versione, sessione, scrittore presente (4003), segreto (4004): un
    // `hello` sbagliato in più punti riceve il codice del primo controllo.
    let live = start();
    let other_session = PairingTarget {
        session: crate::token::SessionId::parse("AAAAAAAAAAA").unwrap(),
        ..live.target.clone()
    };
    let wrong_secret = PairingTarget {
        secret: PairingSecret::parse("AAAAAAAAAAAAAAAAAAAAAA").unwrap(),
        ..live.target.clone()
    };
    let attempt = |target: PairingTarget, version: u8| {
        let net = live.net.clone();
        let fingerprint_target = live.target.clone();
        async move {
            let mut raw = Raw::open(&net, &fingerprint_target).await;
            let secret = Credential::Secret(Zeroizing::new(target.secret.encode()));
            let text = hello(&target, secret).to_json().replacen(
                r#""v":1"#,
                &format!(r#""v":{version}"#),
                1,
            );
            assert!(raw.text(text).await);
            raw.close_code().await
        }
    };

    // Nessuno scrittore: il segreto sbagliato è 4004, ma non brucia il QR.
    assert_eq!(attempt(other_session.clone(), 2).await, 4007);
    assert_eq!(attempt(other_session.clone(), 1).await, 4001);
    assert_eq!(attempt(wrong_secret.clone(), 1).await, 4004);
    assert!(live.host.pairing().is_some());

    let (_raw, _) = join(&live.net, &live.target).await;
    assert_eq!(attempt(other_session, 1).await, 4001);
    assert_eq!(attempt(wrong_secret, 1).await, 4003);
    assert_eq!(attempt(live.target.clone(), 2).await, 4007);
}

#[tokio::test(start_paused = true)]
async fn an_unused_secret_expires_after_five_minutes() {
    let mut live = start();
    let pairing = live.host.pairing().unwrap();
    assert_eq!(pairing.expires_in_ms, 300_000);
    sleep(Duration::from_secs(299)).await;
    assert_eq!(live.host.status().pairing_expires_in_ms, Some(1000));
    sleep(Duration::from_secs(1)).await;
    live.events
        .find(|event| matches!(event, LiveEvent::PairingExpired).then_some(()))
        .await;
    assert!(live.host.pairing().is_none());
    assert_eq!(live.host.status().pairing_expires_in_ms, None);
    let mut late = Raw::open(&live.net, &live.target).await;
    late.hello(&live.target).await;
    assert_eq!(late.close_code().await, 4004);

    // Un QR nuovo, con un segreto nuovo: il vecchio resta scaduto.
    let renewed = live.host.renew_pairing().unwrap();
    assert_eq!(renewed.expires_in_ms, 300_000);
    let target = PairingTarget::parse(&renewed.payload).unwrap();
    assert_eq!(target.session.encode(), live.target.session.encode());
    assert_ne!(target.secret.encode(), live.target.secret.encode());
    let mut old = Raw::open(&live.net, &live.target).await;
    old.hello(&live.target).await;
    assert_eq!(old.close_code().await, 4004);
    join(&live.net, &target).await;
}

#[tokio::test(start_paused = true)]
async fn a_new_qr_waits_for_the_writer_to_leave_and_then_releases_it() {
    let mut live = start();
    let (raw, welcome) = join(&live.net, &live.target).await;
    assert_eq!(
        live.host.renew_pairing().unwrap_err(),
        RenewError::WriterConnected
    );

    live.net.cut();
    drop(raw);
    let (reason, resumable) = live
        .events
        .find(|event| match event {
            LiveEvent::WriterDisconnected {
                reason, resumable, ..
            } => Some((reason, resumable)),
            _ => None,
        })
        .await;
    assert_eq!((reason, resumable), (LeaveReason::Lost, true));

    // Con lo scrittore fuori, il QR nuovo gli toglie la ripresa.
    let renewed = live.host.renew_pairing().unwrap();
    let released = live
        .events
        .find(|event| match event {
            LiveEvent::WriterReleased { writer, reason } => Some((writer, reason)),
            _ => None,
        })
        .await;
    assert_eq!(released, (WriterId(1), ReleaseReason::PairingRenewed));
    let mut stale = Raw::open(&live.net, &live.target).await;
    stale.resume(&live.target, &welcome.resume).await;
    assert_eq!(stale.close_code().await, 4004);

    let target = PairingTarget::parse(&renewed.payload).unwrap();
    join(&live.net, &target).await;
    let writer = live
        .events
        .find(|event| match event {
            LiveEvent::WriterConnected { writer, .. } => Some(writer),
            _ => None,
        })
        .await;
    assert_eq!(writer, WriterId(2));
}

#[tokio::test(start_paused = true)]
async fn the_qr_carries_address_session_secret_fingerprint_and_name() {
    let live = start();
    let pairing = live.host.pairing().unwrap();
    let info = live.host.info();
    let expected = format!(
        "fubdraw://live?h={}&s={}&k={}&f={}&n=Studio%20di%20Ada",
        info.addr,
        info.session.encode(),
        live.target.secret.encode(),
        info.fingerprint.encode()
    );
    assert_eq!(pairing.payload.as_str(), expected);
    assert_eq!(live.target.host_name.as_deref(), Some("Studio di Ada"));
    assert!(pairing.qr_svg.starts_with("<svg"));
    // Il segreto non finisce nei log.
    let printed = format!("{pairing:?}");
    assert!(!printed.contains(&live.target.secret.encode()), "{printed}");
}

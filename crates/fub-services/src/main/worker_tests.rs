//! Prove del pool di worker del binario.

use super::*;

/// **Un panic spegne una richiesta, non il worker.** La prima connessione
/// va in panic, la seconda arriva allo stesso worker e viene servita.
#[test]
fn a_panicking_request_leaves_the_worker_alive() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let clients: Vec<TcpStream> = (0..2)
        .map(|_| TcpStream::connect(address).unwrap())
        .collect();
    let (tx, rx) = std::sync::mpsc::sync_channel(2);
    for _ in &clients {
        tx.send((listener.accept().unwrap().0, Instant::now()))
            .unwrap();
    }
    drop(tx);
    let served = std::sync::atomic::AtomicUsize::new(0);
    run_worker(&Mutex::new(rx), &|_, _| {
        if served.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
            panic!("il difetto che una richiesta trova");
        }
    });
    assert_eq!(
        served.load(std::sync::atomic::Ordering::SeqCst),
        2,
        "dopo il panic il worker ha servito anche la seconda connessione"
    );
}

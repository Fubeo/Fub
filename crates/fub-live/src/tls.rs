//! Il certificato effimero della sessione e le due configurazioni TLS.
//!
//! A ogni sessione l'host genera una chiave ECDSA P-256 e un certificato
//! autofirmato per l'indirizzo su cui ascolta. La chiave resta in memoria,
//! dentro `rustls`, e la sua copia in DER si azzera appena caricata. Il QR
//! porta l'impronta SHA-256 del certificato, e il client accetta quel
//! certificato e nessun altro: nessuna catena, nessuna CA, nessuna data,
//! perché l'orologio di un tablet può essere sbagliato di anni. La firma del
//! handshake invece si verifica sempre: è lei a provare che dall'altra parte
//! c'è chi possiede la chiave, e non chi ha solo copiato il certificato.
//!
//! Entrambi i lati parlano solo TLS 1.3 con il provider `ring`, senza ticket
//! né ripresa di sessione: una sessione dura minuti, e la ripresa TLS
//! allungherebbe la vita dei segreti oltre quella della chiave.

use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;

use rcgen::{
    CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose, KeyPair,
    KeyUsagePurpose, SanType, PKCS_ECDSA_P256_SHA256,
};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::client::Resumption;
use rustls::crypto::{CryptoProvider, WebPkiSupportedAlgorithms};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer, ServerName, UnixTime};
use rustls::server::NoServerSessionStorage;
use rustls::sign::{CertifiedKey, SingleCertAndKey};
use rustls::{CertificateError, DigitallySignedStruct, SignatureScheme};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use zeroize::Zeroizing;

use crate::limits::{MAX_FRAME, MAX_MESSAGE};
use crate::token::Fingerprint;

/// Il certificato non si è potuto generare o caricare.
#[derive(Debug, thiserror::Error)]
pub enum TlsError {
    /// `rcgen` ha rifiutato i parametri o la chiave.
    #[error("ephemeral certificate: {0}")]
    Certificate(#[from] rcgen::Error),
    /// `rustls` ha rifiutato la configurazione o la chiave.
    #[error("TLS configuration: {0}")]
    Rustls(#[from] rustls::Error),
}

/// L'identità TLS dell'host per una sessione.
pub(crate) struct ServerIdentity {
    pub(crate) config: Arc<rustls::ServerConfig>,
    pub(crate) fingerprint: Fingerprint,
    #[cfg(test)]
    pub(crate) certificate: CertificateDer<'static>,
}

fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

/// Genera la chiave e il certificato per `ip`, e la configurazione del server.
pub(crate) fn server_identity(ip: Ipv4Addr) -> Result<ServerIdentity, TlsError> {
    let key = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256)?;
    let mut params = CertificateParams::default();
    // Il nome comune non dice niente di chi usa il PC: il nome del PC lo porta
    // il QR, e il certificato lo vede chiunque apra una connessione.
    let mut name = DistinguishedName::new();
    name.push(DnType::CommonName, "Fub live session");
    params.distinguished_name = name;
    params.subject_alt_names = vec![SanType::IpAddress(IpAddr::V4(ip))];
    params.key_usages = vec![KeyUsagePurpose::DigitalSignature];
    params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    let certificate = params.self_signed(&key)?;
    let der: CertificateDer<'static> = certificate.der().clone();
    let fingerprint = Fingerprint::of_certificate(&der);

    // La chiave in PKCS#8 esiste solo il tempo di caricarla in `ring`: la
    // copia si azzera all'uscita, e `KeyPair` fa lo stesso con la propria.
    let pkcs8 = Zeroizing::new(key.serialize_der());
    let borrowed = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(pkcs8.as_slice()));
    let signing = rustls::crypto::ring::sign::any_ecdsa_type(&borrowed)?;
    drop(borrowed);
    drop(pkcs8);
    drop(key);

    Ok(ServerIdentity {
        #[cfg(test)]
        certificate: der.clone(),
        config: server_config(CertifiedKey::new(vec![der], signing))?,
        fingerprint,
    })
}

fn server_config(certified: CertifiedKey) -> Result<Arc<rustls::ServerConfig>, TlsError> {
    let mut config = rustls::ServerConfig::builder_with_provider(provider())
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .with_no_client_auth()
        .with_cert_resolver(Arc::new(SingleCertAndKey::from(certified)));
    config.session_storage = Arc::new(NoServerSessionStorage {});
    config.send_tls13_tickets = 0;
    config.max_early_data_size = 0;
    Ok(Arc::new(config))
}

/// La configurazione del client: accetta solo il certificato con l'impronta
/// del QR.
pub(crate) fn client_config(pinned: Fingerprint) -> Result<Arc<rustls::ClientConfig>, TlsError> {
    let provider = provider();
    let verifier = PinnedVerifier {
        pinned,
        algorithms: provider.signature_verification_algorithms,
    };
    let mut config = rustls::ClientConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth();
    config.resumption = Resumption::disabled();
    config.enable_early_data = false;
    Ok(Arc::new(config))
}

/// Il nome con cui il client presenta la connessione: l'indirizzo. Con un
/// indirizzo IP `rustls` non manda SNI.
pub(crate) fn server_name(ip: Ipv4Addr) -> ServerName<'static> {
    ServerName::IpAddress(IpAddr::V4(ip).into())
}

/// L'errore di `rustls` che il verificatore restituisce per un'impronta
/// diversa. Nessun altro percorso lo produce, perché nessun altro
/// verificatore gira nel client.
pub(crate) const FINGERPRINT_MISMATCH: rustls::Error =
    rustls::Error::InvalidCertificate(CertificateError::ApplicationVerificationFailure);

/// Il verificatore del client: confronta l'impronta del certificato foglia a
/// tempo costante, e ignora catena, nome e date. La firma del handshake la
/// verifica con gli algoritmi del provider.
#[derive(Debug)]
struct PinnedVerifier {
    pinned: Fingerprint,
    algorithms: WebPkiSupportedAlgorithms,
}

impl ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, rustls::Error> {
        if Fingerprint::of_certificate(end_entity).matches(&self.pinned) {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(FINGERPRINT_MISMATCH)
        }
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &CertificateDer<'_>,
        _dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        // La configurazione offre solo TLS 1.3: arrivare qui vorrebbe dire che
        // il server ha negoziato una versione che il client non ha proposto.
        Err(rustls::Error::General("TLS 1.2 is not offered".into()))
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, rustls::Error> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &self.algorithms)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algorithms.supported_schemes()
    }
}

/// La configurazione WebSocket di entrambi i lati: 24 MiB per messaggio e per
/// frame, perché uno snapshot di 20 MiB deve passare in un frame solo.
pub(crate) fn websocket_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE))
        .max_frame_size(Some(MAX_FRAME))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rustls::client::WebPkiServerVerifier;
    use rustls::RootCertStore;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_rustls::{TlsAcceptor, TlsConnector};

    const IP: Ipv4Addr = Ipv4Addr::new(192, 168, 1, 20);

    /// Un handshake in memoria fra un server e un client, con un byte di dati
    /// applicativi per lato quando riesce.
    async fn handshake(
        server: Arc<rustls::ServerConfig>,
        client: Arc<rustls::ClientConfig>,
    ) -> Result<rustls::ProtocolVersion, std::io::Error> {
        let (near, far) = tokio::io::duplex(64 * 1024);
        let accept = async move {
            let mut stream = TlsAcceptor::from(server).accept(far).await?;
            let mut byte = [0u8; 1];
            stream.read_exact(&mut byte).await?;
            stream.write_all(&byte).await?;
            stream.flush().await?;
            Ok::<_, std::io::Error>(())
        };
        let connect = async move {
            let mut stream = TlsConnector::from(client)
                .connect(server_name(IP), near)
                .await?;
            let version = stream.get_ref().1.protocol_version();
            stream.write_all(b"x").await?;
            stream.flush().await?;
            let mut byte = [0u8; 1];
            stream.read_exact(&mut byte).await?;
            version.ok_or_else(|| std::io::Error::other("no version"))
        };
        let (accepted, connected) = tokio::join!(accept, connect);
        let version = connected?;
        accepted?;
        Ok(version)
    }

    fn rustls_error(error: &std::io::Error) -> Option<&rustls::Error> {
        error
            .get_ref()
            .and_then(|inner| inner.downcast_ref::<rustls::Error>())
    }

    #[test]
    fn the_certificate_names_the_listening_address_and_serves_tls() {
        let identity = server_identity(IP).unwrap();
        assert_eq!(
            identity.fingerprint,
            Fingerprint::of_certificate(&identity.certificate)
        );
        // Un verificatore WebPKI che si fida del certificato stesso: il nome
        // alternativo è l'indirizzo, l'uso è l'autenticazione del server.
        let mut roots = RootCertStore::empty();
        roots.add(identity.certificate.clone()).unwrap();
        let verifier = WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider())
            .build()
            .unwrap();
        let now = UnixTime::now();
        assert!(verifier
            .verify_server_cert(&identity.certificate, &[], &server_name(IP), &[], now)
            .is_ok());
        let other = server_name(Ipv4Addr::new(192, 168, 1, 21));
        assert!(verifier
            .verify_server_cert(&identity.certificate, &[], &other, &[], now)
            .is_err());
        // Due sessioni, due chiavi, due impronte.
        assert_ne!(
            identity.fingerprint,
            server_identity(IP).unwrap().fingerprint
        );
    }

    #[tokio::test]
    async fn the_pinned_client_speaks_tls_13_with_its_host() {
        let identity = server_identity(IP).unwrap();
        let client = client_config(identity.fingerprint).unwrap();
        let version = handshake(identity.config, client).await.unwrap();
        assert_eq!(version, rustls::ProtocolVersion::TLSv1_3);
    }

    #[tokio::test]
    async fn a_different_fingerprint_is_refused_before_any_data() {
        let identity = server_identity(IP).unwrap();
        let stranger = server_identity(IP).unwrap();
        let client = client_config(stranger.fingerprint).unwrap();
        let error = handshake(identity.config, client).await.unwrap_err();
        assert_eq!(rustls_error(&error), Some(&FINGERPRINT_MISMATCH));
    }

    #[tokio::test]
    async fn the_handshake_signature_is_verified_even_for_the_pinned_certificate() {
        // Chi ha copiato il certificato ma non ha la chiave: il certificato è
        // quello del QR, la firma del handshake no.
        let genuine = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).unwrap();
        let mut params = CertificateParams::default();
        params.subject_alt_names = vec![SanType::IpAddress(IpAddr::V4(IP))];
        let certificate = params.self_signed(&genuine).unwrap().der().clone();
        let thief = KeyPair::generate_for(&PKCS_ECDSA_P256_SHA256).unwrap();
        let pkcs8 = thief.serialize_der();
        let signing = rustls::crypto::ring::sign::any_ecdsa_type(&PrivateKeyDer::Pkcs8(
            PrivatePkcs8KeyDer::from(pkcs8.as_slice()),
        ))
        .unwrap();
        let fingerprint = Fingerprint::of_certificate(&certificate);
        let server = server_config(CertifiedKey::new(vec![certificate], signing)).unwrap();
        let error = handshake(server, client_config(fingerprint).unwrap())
            .await
            .unwrap_err();
        assert!(
            matches!(
                rustls_error(&error),
                Some(rustls::Error::InvalidCertificate(
                    CertificateError::BadSignature
                ))
            ),
            "{error:?}"
        );
    }

    #[test]
    fn the_websocket_limits_hold_a_snapshot() {
        let config = websocket_config();
        assert_eq!(config.max_message_size, Some(MAX_MESSAGE));
        assert_eq!(config.max_frame_size, Some(MAX_FRAME));
    }
}

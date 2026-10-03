//! L'indirizzo su cui la sessione ascolta.
//!
//! Il listener si lega a un solo indirizzo IPv4 privato (RFC 1918: 10/8,
//! 172.16/12, 192.168/16), quello scritto nel QR: mai `0.0.0.0`, che lo
//! esporrebbe anche su un'interfaccia pubblica o su una VPN, e mai un indirizzo
//! pubblico. Con più interfacce si propone quella della rotta predefinita, e
//! l'utente può sceglierne un'altra.

use std::fmt;
use std::io;
use std::net::{Ipv4Addr, SocketAddr, UdpSocket};

use if_addrs::{IfAddr, IfOperStatus};

/// Un indirizzo IPv4 privato su cui la sessione può ascoltare.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct ListenAddr(Ipv4Addr);

/// L'indirizzo non è privato.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("{0} is not a private IPv4 address (10/8, 172.16/12, 192.168/16)")]
pub struct NotPrivate(pub Ipv4Addr);

impl ListenAddr {
    /// Accetta solo un indirizzo di RFC 1918.
    pub fn new(ip: Ipv4Addr) -> Result<ListenAddr, NotPrivate> {
        if ip.is_private() {
            Ok(ListenAddr(ip))
        } else {
            Err(NotPrivate(ip))
        }
    }

    /// Il loopback, solo per le prove: su ogni sistema della CI esiste, e un
    /// indirizzo privato vero no.
    #[cfg(test)]
    pub(crate) fn loopback() -> ListenAddr {
        ListenAddr(Ipv4Addr::LOCALHOST)
    }

    /// L'indirizzo.
    pub fn ip(&self) -> Ipv4Addr {
        self.0
    }
}

impl fmt::Display for ListenAddr {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.0, formatter)
    }
}

/// Un indirizzo che l'utente può scegliere.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    /// L'indirizzo.
    pub addr: ListenAddr,
    /// Il nome dell'interfaccia, come lo dà il sistema.
    pub interface: String,
    /// È l'indirizzo da cui esce la rotta predefinita.
    pub default_route: bool,
}

/// Gli indirizzi privati delle interfacce attive, con quello della rotta
/// predefinita per primo. Una lista vuota vuol dire che il PC non è su una
/// rete locale: la sessione non si apre.
pub fn candidate_addresses() -> io::Result<Vec<Candidate>> {
    let default = default_route_source();
    let mut found: Vec<Candidate> = Vec::new();
    for interface in if_addrs::get_if_addrs()? {
        let IfAddr::V4(v4) = &interface.addr else {
            continue;
        };
        // Un'interfaccia giù non porta pacchetti; `Unknown` è lo stato di
        // alcune interfacce virtuali che funzionano, e resta.
        let usable = matches!(
            interface.oper_status,
            IfOperStatus::Up | IfOperStatus::Unknown
        );
        let Ok(addr) = ListenAddr::new(v4.ip) else {
            continue;
        };
        if !usable || found.iter().any(|candidate| candidate.addr == addr) {
            continue;
        }
        found.push(Candidate {
            addr,
            interface: interface.name.clone(),
            default_route: default == Some(v4.ip),
        });
    }
    found.sort_by(|a, b| {
        b.default_route
            .cmp(&a.default_route)
            .then_with(|| a.addr.ip().cmp(&b.addr.ip()))
    });
    Ok(found)
}

/// L'indirizzo locale che il sistema sceglierebbe per uscire verso Internet.
/// `connect` su un socket UDP non manda pacchetti: chiede solo la rotta. La
/// destinazione è in TEST-NET-1 (RFC 5737), che nessuno usa davvero.
fn default_route_source() -> Option<Ipv4Addr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 9)).ok()?;
    match socket.local_addr().ok()? {
        SocketAddr::V4(local) if !local.ip().is_unspecified() => Some(*local.ip()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_rfc_1918_addresses_are_accepted() {
        for ip in [
            "10.0.0.1",
            "10.255.255.254",
            "172.16.0.1",
            "172.31.255.1",
            "192.168.1.20",
        ] {
            assert!(ListenAddr::new(ip.parse().unwrap()).is_ok(), "{ip}");
        }
        for ip in [
            "0.0.0.0",
            "127.0.0.1",
            "169.254.1.1",
            "172.15.0.1",
            "172.32.0.1",
            "192.169.0.1",
            "100.64.0.1",
            "8.8.8.8",
            "255.255.255.255",
            "224.0.0.1",
        ] {
            assert!(ListenAddr::new(ip.parse().unwrap()).is_err(), "{ip}");
        }
    }

    #[test]
    fn the_candidates_are_private_and_the_default_comes_first() {
        // L'ambiente della prova non è noto: la forma della lista sì.
        let candidates = candidate_addresses().unwrap();
        assert!(candidates
            .iter()
            .all(|candidate| candidate.addr.ip().is_private()));
        let defaults = candidates
            .iter()
            .filter(|candidate| candidate.default_route)
            .count();
        assert!(defaults <= 1);
        if defaults == 1 {
            assert!(candidates[0].default_route);
        }
    }
}

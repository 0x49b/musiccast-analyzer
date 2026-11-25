//! Device discovery: SSDP plus a sweep of the /24 subnet, each candidate verified via YXC.

use crate::i18n::pick;
use crate::yxc;
use std::collections::BTreeSet;
use std::net::{IpAddr, Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream, UdpSocket};
use std::thread;
use std::time::{Duration, Instant};

/// Local IPv4 address of the interface that holds the default route (nothing is sent).
pub fn local_ip() -> Option<Ipv4Addr> {
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    match sock.local_addr().ok()?.ip() {
        IpAddr::V4(v4) if !v4.is_loopback() && !v4.is_unspecified() => Some(v4),
        _ => None,
    }
}

fn ssdp(local: Ipv4Addr) -> Vec<Ipv4Addr> {
    let mut found = Vec::new();
    let Ok(sock) = UdpSocket::bind(SocketAddrV4::new(local, 0)) else {
        return found;
    };
    let _ = sock.set_read_timeout(Some(Duration::from_millis(1500)));
    let msg =
        "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\n\
               ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n\r\n";
    for _ in 0..2 {
        let _ = sock.send_to(msg.as_bytes(), "239.255.255.250:1900");
    }
    let deadline = Instant::now() + Duration::from_secs(4);
    let mut buf = [0u8; 2048];
    while Instant::now() < deadline {
        match sock.recv_from(&mut buf) {
            Ok((_, SocketAddr::V4(src))) => found.push(*src.ip()),
            Ok(_) => {}
            Err(_) => break,
        }
    }
    found
}

/// All hosts in the /24 with port 80 open. Wired devices do not always answer SSDP.
fn sweep(local: Ipv4Addr) -> Vec<Ipv4Addr> {
    let [a, b, c, _] = local.octets();
    let handles: Vec<_> = (1u8..=254)
        .map(|d| {
            let ip = Ipv4Addr::new(a, b, c, d);
            thread::spawn(move || {
                let addr = SocketAddr::new(IpAddr::V4(ip), 80);
                TcpStream::connect_timeout(&addr, Duration::from_millis(900))
                    .ok()
                    .map(|_| ip)
            })
        })
        .collect();
    handles
        .into_iter()
        .filter_map(|h| h.join().ok().flatten())
        .collect()
}

pub fn find_devices() -> Result<Vec<String>, String> {
    let local = local_ip().ok_or_else(no_network)?;

    let ssdp_handle = thread::spawn(move || ssdp(local));
    let mut candidates: BTreeSet<Ipv4Addr> = sweep(local).into_iter().collect();
    candidates.extend(ssdp_handle.join().unwrap_or_default());
    candidates.remove(&local);

    let handles: Vec<_> = candidates
        .into_iter()
        .map(|ip| {
            thread::spawn(move || yxc::get(&ip.to_string(), "system/getDeviceInfo").map(|_| ip))
        })
        .collect();
    let mut devices: Vec<Ipv4Addr> = handles
        .into_iter()
        .filter_map(|h| h.join().ok().flatten())
        .collect();
    devices.sort();
    Ok(devices.iter().map(Ipv4Addr::to_string).collect())
}

/// Accept only private IPv4 addresses (or loopback) as device addresses.
pub fn parse_private_ip(text: &str) -> Option<String> {
    let ip: Ipv4Addr = text.trim().parse().ok()?;
    (ip.is_private() || ip.is_loopback()).then(|| ip.to_string())
}

pub fn no_network() -> String {
    pick(
        "No active network connection found.",
        "Keine aktive Netzwerkverbindung gefunden.",
    )
    .to_owned()
}

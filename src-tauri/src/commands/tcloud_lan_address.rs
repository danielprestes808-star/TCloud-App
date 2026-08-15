use serde::{Deserialize, Serialize};
use std::net::{IpAddr, Ipv4Addr, UdpSocket};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TCloudLanAddress {
    pub ip: String,
    pub port: u16,
    pub base_url: String,
}

fn detect_lan_ip() -> IpAddr {
    let socket = UdpSocket::bind("0.0.0.0:0");
    if let Ok(socket) = socket {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(local) = socket.local_addr() {
                return local.ip();
            }
        }
    }
    IpAddr::V4(Ipv4Addr::LOCALHOST)
}

#[tauri::command]
pub fn tcloud_get_lan_address(port: Option<u16>) -> TCloudLanAddress {
    let port = port.unwrap_or(9868);
    let ip = detect_lan_ip().to_string();
    TCloudLanAddress {
        ip: ip.clone(),
        port,
        base_url: format!("http://{}:{}", ip, port),
    }
}

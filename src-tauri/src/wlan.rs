//! Wi-Fi adapters and scanning with tools that ship with Windows (PowerShell, netsh).

use crate::i18n::pick;
use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Adapter {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub status: String,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Net {
    pub ssid: String,
    pub bssid: String,
    pub signal: u32,
    pub channel: u32,
}

/// Runs a process without a console window flashing up and returns its stdout.
fn run_hidden(cmd: &mut Command) -> Option<String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let out = cmd.output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub fn adapters() -> Vec<Adapter> {
    // Deliberately free of double quotes so that command-line quoting stays trivial
    let script = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; \
        Get-NetAdapter | Where-Object { [string]$_.PhysicalMediaType -match '802\\.11|Wireless' \
        -or $_.InterfaceDescription -match 'Wireless|Wi-?Fi|WLAN|802\\.11' } | \
        ForEach-Object { [pscustomobject]@{ name = $_.Name; description = $_.InterfaceDescription; \
        status = [string]$_.Status } } | ConvertTo-Json -Compress";
    let Some(out) = run_hidden(Command::new("powershell").args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        script,
    ])) else {
        return Vec::new();
    };
    // One match yields an object, several an array, none an empty output
    match serde_json::from_str::<serde_json::Value>(out.trim()) {
        Ok(v @ serde_json::Value::Array(_)) => serde_json::from_value(v).unwrap_or_default(),
        Ok(v @ serde_json::Value::Object(_)) => serde_json::from_value::<Adapter>(v)
            .map(|a| vec![a])
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

pub fn scan(adapter: Option<&str>) -> Result<Vec<Net>, String> {
    let mut cmd = Command::new("netsh");
    cmd.args(["wlan", "show", "networks", "mode=bssid"]);
    if let Some(name) = adapter.map(str::trim).filter(|n| !n.is_empty()) {
        if name.contains('"') || !adapters().iter().any(|a| a.name == name) {
            return Err(format!(
                "{}: {name}",
                pick("Unknown adapter", "Unbekannter Adapter")
            ));
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            // netsh expects interface="name with spaces"
            cmd.raw_arg(format!("interface=\"{name}\""));
        }
    }
    let out = run_hidden(&mut cmd).ok_or_else(|| {
        pick(
            "netsh could not be started.",
            "netsh konnte nicht gestartet werden.",
        )
        .to_owned()
    })?;
    Ok(parse_netsh(&out))
}

/// Parses `netsh wlan show networks mode=bssid` (German, English, French, Italian output).
pub fn parse_netsh(out: &str) -> Vec<Net> {
    let mut nets: Vec<Net> = Vec::new();
    let mut ssid = String::new();
    for line in out.lines() {
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let (key, value) = (key.trim(), value.trim());
        let word = key.split_whitespace().next().unwrap_or("");
        let numbered = key
            .split_whitespace()
            .nth(1)
            .is_some_and(|n| n.chars().all(|c| c.is_ascii_digit()));

        if word == "SSID" && numbered {
            ssid = value.to_owned();
        } else if word == "BSSID" && numbered {
            nets.push(Net {
                ssid: ssid.clone(),
                bssid: value.to_owned(),
                signal: 0,
                channel: 0,
            });
        } else if let Some(cur) = nets.last_mut() {
            if key == "Signal" {
                cur.signal = value.trim_end_matches('%').trim().parse().unwrap_or(0);
            } else if matches!(key, "Kanal" | "Channel" | "Canal" | "Canale") {
                cur.channel = value.parse().unwrap_or(0);
            }
        }
    }
    nets
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_german_output() {
        let out = "\
Schnittstellenname : Wi-Fi 2
Momentan sind 2 Netzwerke sichtbar.

SSID 1 : srg-47141
    Netzwerktyp             : Infrastruktur
    Authentifizierung       : WPA2-Personal
    BSSID 1                 : aa:bb:cc:dd:ee:01
         Signal             : 88%
         Funktyp            : 802.11n
         Band               : 2,4 GHz
         Kanal              : 1
         Kanalauslastung:         12 (4 %)
    BSSID 2                 : aa:bb:cc:dd:ee:02
         Signal             : 40%
         Kanal              : 44

SSID 2 :
    BSSID 1                 : 11:22:33:44:55:66
         Signal             : 55%
         Channel            : 6
";
        let nets = parse_netsh(out);
        assert_eq!(nets.len(), 3);
        assert_eq!(
            nets[0],
            Net {
                ssid: "srg-47141".into(),
                bssid: "aa:bb:cc:dd:ee:01".into(),
                signal: 88,
                channel: 1
            }
        );
        assert_eq!((nets[1].signal, nets[1].channel), (40, 44));
        assert_eq!((nets[2].ssid.as_str(), nets[2].channel), ("", 6));
    }
}

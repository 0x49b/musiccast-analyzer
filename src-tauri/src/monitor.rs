//! Hintergrund-Monitoring: protokolliert Statusaenderungen und meldet Abbrueche.

use crate::yxc;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

#[derive(Serialize, Clone)]
pub struct MonitorEntry {
    pub time: String,
    pub ip: String,
    pub name: String,
    pub status: String,
    pub signal: Option<i64>,
}

#[derive(Default)]
pub struct MonitorShared {
    pub on: AtomicBool,
    /// Wird bei jedem Start erhoeht, damit ein alter Thread sich sicher beendet
    pub generation: AtomicU64,
    pub interval_secs: AtomicU64,
    pub log: Mutex<Vec<MonitorEntry>>,
    /// Vom Benutzer gewaehlter Pfad; None bedeutet Standard (Desktop)
    pub custom_log_path: Mutex<Option<PathBuf>>,
}

#[derive(Clone, PartialEq)]
struct Snapshot {
    online: bool,
    role: String,
    channel: Option<i64>,
}

const LOG_FILE_NAME: &str = "musiccast-monitor.csv";

/// Standard: Desktop des Benutzers. Faellt auf den App-Datenordner zurueck, wenn es keinen gibt.
pub fn default_log_path(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(desktop) = app.path().desktop_dir() {
        if desktop.is_dir() {
            return Some(desktop.join(LOG_FILE_NAME));
        }
    }
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join(LOG_FILE_NAME))
}

pub fn log_path(app: &AppHandle, m: &MonitorShared) -> Option<PathBuf> {
    let custom = m.custom_log_path.lock().ok().and_then(|p| p.clone());
    custom.or_else(|| default_log_path(app))
}

/// Prueft eine Benutzereingabe: absoluter Pfad, Ordner vorhanden, Datei beschreibbar.
/// Ein Ordner wird um den Standard-Dateinamen ergaenzt, eine fehlende Endung um .csv.
pub fn resolve_user_path(text: &str) -> Result<PathBuf, String> {
    let cleaned = text.trim().trim_matches('"').trim();
    if cleaned.is_empty() {
        return Err("Pfad ist leer.".into());
    }
    let mut path = PathBuf::from(cleaned);
    if !path.is_absolute() {
        return Err("Bitte einen absoluten Pfad angeben, z.B. C:\\Logs\\musiccast.csv".into());
    }
    if path.is_dir() {
        path.push(LOG_FILE_NAME);
    } else if path.extension().is_none() {
        path.set_extension("csv");
    }
    match path.parent() {
        Some(dir) if dir.is_dir() => {}
        _ => {
            return Err(format!(
                "Der Ordner von {} existiert nicht.",
                path.display()
            ))
        }
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("{} ist nicht beschreibbar: {e}", path.display()))?;
    Ok(path)
}

fn append_csv(path: &Path, e: &MonitorEntry) {
    // Kopfzeile auch dann schreiben, wenn die Datei schon leer angelegt wurde
    let is_new = std::fs::metadata(path)
        .map(|m| m.len() == 0)
        .unwrap_or(true);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        if is_new {
            let _ = writeln!(f, "Zeit;IP;Name;Status;Signal");
        }
        let signal = e.signal.map(|s| s.to_string()).unwrap_or_default();
        let _ = writeln!(
            f,
            "{};{};{};{};{}",
            e.time,
            e.ip,
            e.name.replace(';', ","),
            e.status,
            signal
        );
    }
}

fn active(m: &MonitorShared, generation: u64) -> bool {
    m.on.load(Ordering::Relaxed) && m.generation.load(Ordering::Relaxed) == generation
}

pub fn run(app: AppHandle, m: Arc<MonitorShared>, known: Arc<Mutex<Vec<String>>>, generation: u64) {
    let mut last: HashMap<String, Snapshot> = HashMap::new();
    let mut names: HashMap<String, String> = HashMap::new();

    while active(&m, generation) {
        let ips = known.lock().map(|k| k.clone()).unwrap_or_default();
        for ip in ips {
            if !active(&m, generation) {
                return;
            }
            let dist = yxc::get(&ip, "dist/getDistributionInfo");
            let net = dist
                .as_ref()
                .and_then(|_| yxc::get(&ip, "system/getNetworkStatus"));
            if let Some(n) = net
                .as_ref()
                .and_then(|n| n.get("network_name"))
                .and_then(|v| v.as_str())
            {
                names.insert(ip.clone(), n.to_owned());
            }
            let wired = net
                .as_ref()
                .and_then(|n| n.get("connection"))
                .and_then(|v| v.as_str())
                .is_some_and(|c| c.contains("wired"));
            let snap = Snapshot {
                online: dist.is_some(),
                role: dist
                    .as_ref()
                    .and_then(|d| d.get("role"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_owned(),
                channel: net
                    .as_ref()
                    .filter(|_| !wired)
                    .and_then(|n| n.pointer("/wireless_lan/ch"))
                    .and_then(|v| v.as_i64()),
            };
            let prev = last.get(&ip);
            if prev == Some(&snap) {
                continue;
            }

            let name = names.get(&ip).cloned().unwrap_or_default();
            let status = if !snap.online {
                "OFFLINE".to_owned()
            } else {
                let conn = match (wired, snap.channel) {
                    (true, _) => "LAN".to_owned(),
                    (false, Some(ch)) => format!("WLAN Kanal {ch}"),
                    (false, None) => "WLAN".to_owned(),
                };
                let role = match snap.role.as_str() {
                    "server" => "Master",
                    "client" => "Client",
                    _ => "kein Link",
                };
                format!("online | {role} | {conn}")
            };
            let entry = MonitorEntry {
                time: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                ip: ip.clone(),
                name: name.clone(),
                status,
                signal: net
                    .as_ref()
                    .filter(|_| !wired)
                    .and_then(|n| n.pointer("/wireless_lan/strength"))
                    .and_then(|v| v.as_i64()),
            };

            // Nur echte Verschlechterungen melden, nicht den ersten Messwert
            if let Some(p) = prev {
                let label = if name.is_empty() { ip.clone() } else { name };
                let problem = if p.online && !snap.online {
                    Some(format!("{label} ist offline."))
                } else if snap.online
                    && p.role != "none"
                    && !p.role.is_empty()
                    && snap.role == "none"
                {
                    Some(format!("{label} ist aus der Link-Gruppe gefallen."))
                } else {
                    None
                };
                if let Some(body) = problem {
                    let _ = app
                        .notification()
                        .builder()
                        .title("MusicCast Analyzer")
                        .body(body)
                        .show();
                }
            }

            // Pfad pro Eintrag aufloesen, damit eine Aenderung sofort greift
            if let Some(p) = log_path(&app, &m) {
                append_csv(&p, &entry);
            }
            if let Ok(mut log) = m.log.lock() {
                log.push(entry.clone());
                if log.len() > 2000 {
                    log.remove(0);
                }
            }
            let _ = app.emit("monitor-entry", &entry);
            last.insert(ip, snap);
        }

        // In kleinen Schritten schlafen, damit Stoppen sofort greift
        let ticks = m.interval_secs.load(Ordering::Relaxed).clamp(5, 600) * 4;
        for _ in 0..ticks {
            if !active(&m, generation) {
                return;
            }
            thread::sleep(Duration::from_millis(250));
        }
    }
}

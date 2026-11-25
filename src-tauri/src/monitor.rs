//! Background monitoring: logs status changes and reports dropouts.

use crate::i18n::{lang, pick, Lang};
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
    /// Status text in the language that was active when the entry was created
    pub status: String,
    pub online: bool,
    pub signal: Option<i64>,
}

#[derive(Default)]
pub struct MonitorShared {
    pub on: AtomicBool,
    /// Incremented on every start so that an older thread reliably stops
    pub generation: AtomicU64,
    pub interval_secs: AtomicU64,
    pub log: Mutex<Vec<MonitorEntry>>,
    /// Path chosen by the user; None means the default (Desktop)
    pub custom_log_path: Mutex<Option<PathBuf>>,
}

#[derive(Clone, PartialEq)]
struct Snapshot {
    online: bool,
    role: String,
    channel: Option<i64>,
}

const LOG_FILE_NAME: &str = "musiccast-monitor.csv";

/// Default: the user's Desktop. Falls back to the app data folder when there is none.
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

/// Validates user input: absolute path, existing folder, writable file.
/// A folder gets the default file name appended, a missing extension becomes .csv.
pub fn resolve_user_path(text: &str) -> Result<PathBuf, String> {
    let cleaned = text.trim().trim_matches('"').trim();
    if cleaned.is_empty() {
        return Err(pick("The path is empty.", "Pfad ist leer.").into());
    }
    let mut path = PathBuf::from(cleaned);
    if !path.is_absolute() {
        return Err(pick(
            "Enter an absolute path, e.g. C:\\Logs\\musiccast.csv",
            "Bitte einen absoluten Pfad angeben, z.B. C:\\Logs\\musiccast.csv",
        )
        .into());
    }
    if path.is_dir() {
        path.push(LOG_FILE_NAME);
    } else if path.extension().is_none() {
        path.set_extension("csv");
    }
    match path.parent() {
        Some(dir) if dir.is_dir() => {}
        _ => {
            return Err(match lang() {
                Lang::En => format!("The folder of {} does not exist.", path.display()),
                Lang::De => format!("Der Ordner von {} existiert nicht.", path.display()),
            })
        }
    }
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| match lang() {
            Lang::En => format!("{} is not writable: {e}", path.display()),
            Lang::De => format!("{} ist nicht beschreibbar: {e}", path.display()),
        })?;
    Ok(path)
}

/// The CSV is data for other tools and therefore always written in English.
fn append_csv(path: &Path, e: &MonitorEntry, status: &str) {
    // Write the header even if the file already exists but is still empty
    let is_new = std::fs::metadata(path)
        .map(|m| m.len() == 0)
        .unwrap_or(true);
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(path) {
        if is_new {
            let _ = writeln!(f, "Time;IP;Name;Status;Signal");
        }
        let signal = e.signal.map(|s| s.to_string()).unwrap_or_default();
        let _ = writeln!(
            f,
            "{};{};{};{};{}",
            e.time,
            e.ip,
            e.name.replace(';', ","),
            status,
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
            let connection = net
                .as_ref()
                .and_then(|n| n.get("connection"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let wired = connection.contains("wired");
            let extended = connection.contains("extend");
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
            let describe = |language: Lang| -> String {
                if !snap.online {
                    return "OFFLINE".to_owned();
                }
                let de = language == Lang::De;
                let conn = match (wired, extended, snap.channel) {
                    (true, _, _) => (if de { "Kabel" } else { "wired" }).to_owned(),
                    (_, true, _) => (if de { "erweitert" } else { "extended" }).to_owned(),
                    (_, _, Some(ch)) if de => format!("WLAN Kanal {ch}"),
                    (_, _, Some(ch)) => format!("Wi-Fi channel {ch}"),
                    (_, _, None) => (if de { "WLAN" } else { "Wi-Fi" }).to_owned(),
                };
                let role = match (snap.role.as_str(), de) {
                    ("server", _) => "master",
                    ("client", _) => "client",
                    (_, true) => "kein Link",
                    (_, false) => "no link",
                };
                format!("online | {role} | {conn}")
            };
            let status = describe(lang());
            let entry = MonitorEntry {
                time: chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                ip: ip.clone(),
                name: name.clone(),
                status,
                online: snap.online,
                signal: net
                    .as_ref()
                    .filter(|_| !wired)
                    .and_then(|n| n.pointer("/wireless_lan/strength"))
                    .and_then(|v| v.as_i64()),
            };

            // Report real deteriorations only, never the first reading
            if let Some(p) = prev {
                let label = if name.is_empty() { ip.clone() } else { name };
                let problem = if p.online && !snap.online {
                    Some(match lang() {
                        Lang::En => format!("{label} is offline."),
                        Lang::De => format!("{label} ist offline."),
                    })
                } else if snap.online
                    && p.role != "none"
                    && !p.role.is_empty()
                    && snap.role == "none"
                {
                    Some(match lang() {
                        Lang::En => format!("{label} dropped out of the link group."),
                        Lang::De => format!("{label} ist aus der Link-Gruppe gefallen."),
                    })
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

            // Resolve the path per entry so that a change takes effect immediately
            if let Some(p) = log_path(&app, &m) {
                append_csv(&p, &entry, &describe(Lang::En));
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

        // Sleep in small steps so that stopping takes effect immediately
        let ticks = m.interval_secs.load(Ordering::Relaxed).clamp(5, 600) * 4;
        for _ in 0..ticks {
            if !active(&m, generation) {
                return;
            }
            thread::sleep(Duration::from_millis(250));
        }
    }
}

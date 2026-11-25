mod discovery;
mod monitor;
mod wlan;
mod yxc;

use monitor::{MonitorEntry, MonitorShared};
use serde::Serialize;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::menu::{Menu, MenuItem, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, State, Wry};
use yxc::{Device, Step};

pub struct AppState {
    known: Arc<Mutex<Vec<String>>>,
    monitor: Arc<MonitorShared>,
}

impl AppState {
    fn known(&self) -> Vec<String> {
        self.known.lock().map(|k| k.clone()).unwrap_or_default()
    }

    fn require_known(&self, ip: &str) -> Result<(), String> {
        if self.known().iter().any(|k| k == ip) {
            Ok(())
        } else {
            Err(format!("{ip} ist nicht in der Geraeteliste."))
        }
    }
}

/// Fragt alle Geraete parallel ab, Reihenfolge bleibt erhalten.
fn status_all(ips: Vec<String>) -> Vec<Device> {
    let handles: Vec<_> = ips
        .into_iter()
        .map(|ip| thread::spawn(move || yxc::device_status(&ip)))
        .collect();
    handles.into_iter().filter_map(|h| h.join().ok()).collect()
}

#[tauri::command(async)]
fn get_adapters() -> Result<Vec<wlan::Adapter>, String> {
    Ok(wlan::adapters())
}

/// Sucht Geraete neu (SSDP + Subnetz) oder uebernimmt eine manuelle IP-Liste.
#[tauri::command(async)]
fn discover(state: State<'_, AppState>, ips: Option<Vec<String>>) -> Result<Vec<Device>, String> {
    let found = match ips {
        Some(list) => {
            let mut parsed: Vec<String> = list
                .iter()
                .filter_map(|t| discovery::parse_private_ip(t))
                .collect();
            parsed.dedup();
            if parsed.is_empty() {
                return Err("Keine gueltige private IPv4-Adresse angegeben.".into());
            }
            parsed
        }
        None => discovery::find_devices()?,
    };
    if !found.is_empty() {
        if let Ok(mut known) = state.known.lock() {
            *known = found;
        }
    }
    Ok(status_all(state.known()))
}

#[tauri::command(async)]
fn get_devices(state: State<'_, AppState>) -> Result<Vec<Device>, String> {
    Ok(status_all(state.known()))
}

#[tauri::command(async)]
fn scan_wlan(adapter: Option<String>) -> Result<Vec<wlan::Net>, String> {
    wlan::scan(adapter.as_deref())
}

#[tauri::command(async)]
fn link(
    state: State<'_, AppState>,
    master: String,
    clients: Vec<String>,
    name: Option<String>,
) -> Result<Vec<Step>, String> {
    state.require_known(&master)?;
    let clients: Vec<String> = clients.into_iter().filter(|c| *c != master).collect();
    if clients.is_empty() {
        return Err("Mindestens einen Client waehlen.".into());
    }
    for c in &clients {
        state.require_known(c)?;
    }
    Ok(yxc::link(&master, &clients, name.as_deref()))
}

#[tauri::command(async)]
fn unlink(state: State<'_, AppState>) -> Result<Vec<Step>, String> {
    Ok(yxc::unlink(&state.known()))
}

#[tauri::command(async)]
fn set_group_name(state: State<'_, AppState>, name: String) -> Result<Vec<Step>, String> {
    if name.trim().is_empty() {
        return Err("Gruppennamen eingeben.".into());
    }
    let master = yxc::find_server(&state.known()).ok_or("Keine aktive Gruppe (kein Master).")?;
    Ok(vec![yxc::set_group_name(&master, &name)])
}

#[tauri::command(async)]
fn set_power(state: State<'_, AppState>, ip: String, on: bool) -> Result<Step, String> {
    state.require_known(&ip)?;
    Ok(yxc::set_power(&ip, on))
}

#[tauri::command(async)]
fn switch_to_wired(state: State<'_, AppState>, ip: String) -> Result<Step, String> {
    state.require_known(&ip)?;
    Ok(yxc::switch_to_wired(&ip))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorStatus {
    on: bool,
    interval: u64,
    log_path: Option<String>,
    default_log_path: Option<String>,
    custom_log_path: bool,
    log: Vec<MonitorEntry>,
}

fn monitor_snapshot(app: &AppHandle, m: &MonitorShared) -> MonitorStatus {
    MonitorStatus {
        on: m.on.load(Ordering::Relaxed),
        interval: m.interval_secs.load(Ordering::Relaxed),
        log_path: monitor::log_path(app, m).map(|p| p.display().to_string()),
        default_log_path: monitor::default_log_path(app).map(|p| p.display().to_string()),
        custom_log_path: m
            .custom_log_path
            .lock()
            .map(|p| p.is_some())
            .unwrap_or(false),
        log: m.log.lock().map(|l| l.clone()).unwrap_or_default(),
    }
}

#[tauri::command(async)]
fn monitor_status(app: AppHandle, state: State<'_, AppState>) -> Result<MonitorStatus, String> {
    Ok(monitor_snapshot(&app, &state.monitor))
}

#[tauri::command(async)]
fn monitor_start(
    app: AppHandle,
    state: State<'_, AppState>,
    interval: u64,
) -> Result<MonitorStatus, String> {
    if state.known().is_empty() {
        return Err("Erst Geraete suchen.".into());
    }
    let m = state.monitor.clone();
    m.interval_secs
        .store(interval.clamp(5, 600), Ordering::Relaxed);
    m.on.store(true, Ordering::Relaxed);
    let generation = m.generation.fetch_add(1, Ordering::Relaxed) + 1;

    let (app2, m2, known) = (app.clone(), m.clone(), state.known.clone());
    thread::spawn(move || monitor::run(app2, m2, known, generation));
    Ok(monitor_snapshot(&app, &m))
}

#[tauri::command(async)]
fn monitor_stop(app: AppHandle, state: State<'_, AppState>) -> Result<MonitorStatus, String> {
    state.monitor.on.store(false, Ordering::Relaxed);
    Ok(monitor_snapshot(&app, &state.monitor))
}

/// Adresse des Router-Portals: die .1 im Netz der Schnittstelle mit Default-Route.
#[tauri::command(async)]
fn router_url() -> Result<String, String> {
    let ip = discovery::local_ip().ok_or("Keine aktive Netzwerkverbindung gefunden.")?;
    let [a, b, c, _] = ip.octets();
    Ok(format!("http://{a}.{b}.{c}.1"))
}

/// Haengt die angegebenen Geraete in einen bestehenden Standort um.
#[tauri::command(async)]
fn set_location(
    state: State<'_, AppState>,
    ips: Vec<String>,
    id: String,
    name: String,
) -> Result<Vec<Step>, String> {
    let name = name.trim();
    if !yxc::is_location_id(&id) {
        return Err("Standort-ID muss aus 32 Hex-Zeichen bestehen.".into());
    }
    if name.is_empty() || name.chars().count() > 64 {
        return Err("Standortname fehlt oder ist zu lang.".into());
    }
    for ip in &ips {
        state.require_known(ip)?;
    }
    Ok(ips
        .iter()
        .flat_map(|ip| yxc::set_location(ip, &id, name))
        .collect())
}

/// Setzt den Pfad der CSV-Datei. Ohne Angabe gilt wieder der Standard (Desktop).
#[tauri::command(async)]
fn monitor_set_log_path(
    app: AppHandle,
    state: State<'_, AppState>,
    path: Option<String>,
) -> Result<MonitorStatus, String> {
    let custom = match path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(text) => Some(monitor::resolve_user_path(text)?),
        None => None,
    };
    if let Ok(mut slot) = state.monitor.custom_log_path.lock() {
        *slot = custom;
    }
    Ok(monitor_snapshot(&app, &state.monitor))
}

fn show_main_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Natives Fenstermenue mit Tastenkuerzeln. Jeder Eintrag traegt eine ID mit dem Praefix "m:";
/// der Rest der ID geht als Ereignis "menu" an die Oberflaeche (siehe `commands` in App.tsx).
fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, label: &str, accelerator: Option<&str>| -> tauri::Result<MenuItem<Wry>> {
        let builder = MenuItemBuilder::with_id(format!("m:{id}"), label);
        match accelerator {
            Some(keys) => builder.accelerator(keys).build(app),
            None => builder.build(app),
        }
    };

    let file = SubmenuBuilder::new(app, "Datei")
        .item(&item("quit", "Beenden", None)?)
        .build()?;
    let view = SubmenuBuilder::new(app, "Ansicht")
        .item(&item("view-devices", "Ger\u{00e4}te", Some("Ctrl+1"))?)
        .item(&item("view-wlan", "WLAN", Some("Ctrl+2"))?)
        .item(&item("view-monitor", "Monitoring", Some("Ctrl+3"))?)
        .item(&item("view-settings", "Einstellungen", Some("Ctrl+4"))?)
        .separator()
        .item(&item(
            "toggle-dock",
            "Unteren Bereich ein- oder ausklappen",
            Some("Ctrl+J"),
        )?)
        .build()?;
    let devices = SubmenuBuilder::new(app, "Ger\u{00e4}te")
        .item(&item("discover", "Im Netzwerk suchen", Some("F5"))?)
        .item(&item("refresh", "Status aktualisieren", Some("Ctrl+R"))?)
        .separator()
        .item(&item("link", "Angekreuzte verlinken", Some("Ctrl+L"))?)
        .item(&item(
            "unlink",
            "Links aufl\u{00f6}sen",
            Some("Ctrl+Shift+L"),
        )?)
        .build()?;
    let wlan = SubmenuBuilder::new(app, "WLAN")
        .item(&item("scan", "Netze scannen", Some("F6"))?)
        .build()?;
    let monitoring = SubmenuBuilder::new(app, "Monitoring")
        .item(&item(
            "toggle-monitor",
            "Starten oder stoppen",
            Some("Ctrl+M"),
        )?)
        .build()?;

    Menu::with_items(app, &[&file, &view, &devices, &wlan, &monitoring])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let monitor = Arc::new(MonitorShared::default());
    monitor.interval_secs.store(10, Ordering::Relaxed);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState {
            known: Arc::new(Mutex::new(Vec::new())),
            monitor,
        })
        .menu(build_app_menu)
        .on_menu_event(|app, event| {
            let id: &str = event.id.as_ref();
            match id.strip_prefix("m:") {
                Some("quit") => app.exit(0),
                Some(command) => {
                    let _ = app.emit("menu", command);
                }
                // Eintraege ohne Praefix gehoeren zum Tray-Menue und werden dort behandelt
                None => {}
            }
        })
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Fenster \u{00f6}ffnen", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let mut tray = TrayIconBuilder::new()
                .tooltip("MusicCast Analyzer")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        // Solange das Monitoring laeuft, schliesst das X nur das Fenster: die App bleibt im Tray
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                if state.monitor.on.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_adapters,
            discover,
            get_devices,
            scan_wlan,
            link,
            unlink,
            set_group_name,
            set_power,
            switch_to_wired,
            monitor_status,
            monitor_start,
            monitor_stop,
            monitor_set_log_path,
            set_location,
            router_url
        ])
        .run(tauri::generate_context!())
        .expect("Fehler beim Starten der Tauri-Anwendung");
}

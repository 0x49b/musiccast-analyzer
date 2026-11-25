mod discovery;
mod i18n;
mod monitor;
mod wlan;
mod yxc;

use i18n::{lang, pick, Lang};
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
    /// Latest state of the update check, so the UI can still fetch it after it has loaded
    update: Mutex<Option<UpdateStatus>>,
}

/// State of the automatic update. `phase`: checking, current, downloading, installing, error.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    phase: String,
    version: Option<String>,
    percent: Option<u8>,
    message: Option<String>,
}

fn report_update(
    app: &AppHandle,
    phase: &str,
    version: Option<&str>,
    percent: Option<u8>,
    message: Option<String>,
) {
    let status = UpdateStatus {
        phase: phase.to_owned(),
        version: version.map(str::to_owned),
        percent,
        message,
    };
    if let Ok(mut slot) = app.state::<AppState>().update.lock() {
        *slot = Some(status.clone());
    }
    let _ = app.emit("update-status", status);
}

/// Checks the latest GitHub release, downloads a newer version, installs it and restarts.
/// The updater plugin verifies the download's signature against the key in tauri.conf.json.
async fn update_on_start(app: AppHandle) -> tauri_plugin_updater::Result<()> {
    use tauri_plugin_updater::UpdaterExt;

    report_update(&app, "checking", None, None, None);
    let Some(update) = app.updater()?.check().await? else {
        report_update(&app, "current", None, None, None);
        return Ok(());
    };
    let version = update.version.clone();
    report_update(&app, "downloading", Some(&version), Some(0), None);

    let progress_app = app.clone();
    let progress_version = version.clone();
    let mut received: u64 = 0;
    let mut last_percent: u8 = 0;
    update
        .download_and_install(
            move |chunk, total| {
                received += chunk as u64;
                if let Some(total) = total.filter(|t| *t > 0) {
                    let percent = (received.saturating_mul(100) / total).min(100) as u8;
                    if percent != last_percent {
                        last_percent = percent;
                        report_update(
                            &progress_app,
                            "downloading",
                            Some(&progress_version),
                            Some(percent),
                            None,
                        );
                    }
                }
            },
            || {},
        )
        .await?;

    // On Windows the installer quits the app itself and relaunches it afterwards;
    // on other platforms the restart below takes care of that.
    report_update(&app, "installing", Some(&version), None, None);
    app.restart();
}

#[tauri::command(async)]
fn update_status(state: State<'_, AppState>) -> Result<Option<UpdateStatus>, String> {
    Ok(state.update.lock().map(|s| s.clone()).unwrap_or(None))
}

impl AppState {
    fn known(&self) -> Vec<String> {
        self.known.lock().map(|k| k.clone()).unwrap_or_default()
    }

    fn require_known(&self, ip: &str) -> Result<(), String> {
        if self.known().iter().any(|k| k == ip) {
            Ok(())
        } else {
            Err(match lang() {
                Lang::En => format!("{ip} is not in the device list."),
                Lang::De => format!("{ip} ist nicht in der Ger\u{e4}teliste."),
            })
        }
    }
}

/// Queries all devices in parallel and keeps their order.
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

/// Runs a fresh discovery (SSDP plus subnet) or adopts a manual list of addresses.
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
                return Err(pick(
                    "No valid private IPv4 address given.",
                    "Keine g\u{fc}ltige private IPv4-Adresse angegeben.",
                )
                .into());
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
        return Err(pick(
            "Select at least one client.",
            "Mindestens einen Client w\u{e4}hlen.",
        )
        .into());
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
        return Err(pick("Enter a group name.", "Gruppennamen eingeben.").into());
    }
    let master = yxc::find_server(&state.known()).ok_or_else(|| {
        pick(
            "No active group (no master).",
            "Keine aktive Gruppe (kein Master).",
        )
        .to_owned()
    })?;
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
        return Err(pick("Find devices first.", "Erst Ger\u{e4}te suchen.").into());
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

/// Address of the router portal: the .1 in the network of the interface with the default route.
#[tauri::command(async)]
fn router_url() -> Result<String, String> {
    let ip = discovery::local_ip().ok_or_else(discovery::no_network)?;
    let [a, b, c, _] = ip.octets();
    Ok(format!("http://{a}.{b}.{c}.1"))
}

/// Moves the given devices into an existing location.
#[tauri::command(async)]
fn set_location(
    state: State<'_, AppState>,
    ips: Vec<String>,
    id: String,
    name: String,
) -> Result<Vec<Step>, String> {
    let name = name.trim();
    if !yxc::is_location_id(&id) {
        return Err(pick(
            "The location ID must consist of 32 hex characters.",
            "Standort-ID muss aus 32 Hex-Zeichen bestehen.",
        )
        .into());
    }
    if name.is_empty() || name.chars().count() > 64 {
        return Err(pick(
            "The location name is missing or too long.",
            "Standortname fehlt oder ist zu lang.",
        )
        .into());
    }
    for ip in &ips {
        state.require_known(ip)?;
    }
    Ok(ips
        .iter()
        .flat_map(|ip| yxc::set_location(ip, &id, name))
        .collect())
}

/// Sets the path of the CSV file. Without a value the default (Desktop) applies again.
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

const TRAY_ID: &str = "main";

fn build_tray_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let show = MenuItem::with_id(
        app,
        "show",
        pick("Open window", "Fenster \u{f6}ffnen"),
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", pick("Quit", "Beenden"), true, None::<&str>)?;
    Menu::with_items(app, &[&show, &quit])
}

/// The language is stored next to the app's other configuration so that menus and
/// notifications already use it before the UI has loaded.
fn settings_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("settings.json"))
}

fn load_language(app: &AppHandle) {
    let stored = settings_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
        .and_then(|v| v.get("language")?.as_str().and_then(Lang::parse));
    i18n::set(stored.unwrap_or(Lang::En));
}

fn save_language(app: &AppHandle) {
    if let Some(path) = settings_path(app) {
        let body = serde_json::json!({ "language": lang().code() });
        let _ = std::fs::write(path, body.to_string());
    }
}

#[tauri::command(async)]
fn get_language() -> Result<String, String> {
    Ok(lang().code().to_owned())
}

/// Switches the language, stores it and rebuilds the native menus in the new language.
#[tauri::command(async)]
fn set_language(app: AppHandle, language: String) -> Result<String, String> {
    let next = Lang::parse(&language).ok_or_else(|| format!("unknown language: {language}"))?;
    // The UI reports its language on every start; nothing to rebuild if it has not changed
    if next == lang() {
        return Ok(next.code().to_owned());
    }
    i18n::set(next);
    save_language(&app);
    let menu = build_app_menu(&app).map_err(|e| e.to_string())?;
    app.set_menu(menu).map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let tray_menu = build_tray_menu(&app).map_err(|e| e.to_string())?;
        tray.set_menu(Some(tray_menu)).map_err(|e| e.to_string())?;
    }
    Ok(next.code().to_owned())
}

/// Native window menu with keyboard shortcuts. Every entry carries an ID prefixed with "m:";
/// the rest of the ID is sent to the UI as a "menu" event (see `commands` in App.tsx).
fn build_app_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let item = |id: &str, label: &str, accelerator: Option<&str>| -> tauri::Result<MenuItem<Wry>> {
        let builder = MenuItemBuilder::with_id(format!("m:{id}"), label);
        match accelerator {
            Some(keys) => builder.accelerator(keys).build(app),
            None => builder.build(app),
        }
    };

    let file = SubmenuBuilder::new(app, pick("File", "Datei"))
        .item(&item("quit", pick("Quit", "Beenden"), None)?)
        .build()?;
    let view = SubmenuBuilder::new(app, pick("View", "Ansicht"))
        .item(&item(
            "view-devices",
            pick("Devices", "Ger\u{e4}te"),
            Some("Ctrl+1"),
        )?)
        .item(&item("view-wlan", pick("Wi-Fi", "WLAN"), Some("Ctrl+2"))?)
        .item(&item("view-monitor", "Monitoring", Some("Ctrl+3"))?)
        .item(&item(
            "view-settings",
            pick("Settings", "Einstellungen"),
            Some("Ctrl+4"),
        )?)
        .separator()
        .item(&item(
            "toggle-dock",
            pick(
                "Toggle bottom panel",
                "Unteren Bereich ein- oder ausklappen",
            ),
            Some("Ctrl+J"),
        )?)
        .build()?;
    let devices = SubmenuBuilder::new(app, pick("Devices", "Ger\u{e4}te"))
        .item(&item(
            "discover",
            pick("Find on network", "Im Netzwerk suchen"),
            Some("F5"),
        )?)
        .item(&item(
            "refresh",
            pick("Refresh status", "Status aktualisieren"),
            Some("Ctrl+R"),
        )?)
        .separator()
        .item(&item(
            "link",
            pick("Link checked devices", "Angekreuzte verlinken"),
            Some("Ctrl+L"),
        )?)
        .item(&item(
            "unlink",
            pick("Unlink all", "Links aufl\u{f6}sen"),
            Some("Ctrl+Shift+L"),
        )?)
        .build()?;
    let wlan = SubmenuBuilder::new(app, pick("Wi-Fi", "WLAN"))
        .item(&item(
            "scan",
            pick("Scan networks", "Netze scannen"),
            Some("F6"),
        )?)
        .build()?;
    let monitoring = SubmenuBuilder::new(app, "Monitoring")
        .item(&item(
            "toggle-monitor",
            pick("Start or stop", "Starten oder stoppen"),
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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            known: Arc::new(Mutex::new(Vec::new())),
            monitor,
            update: Mutex::new(None),
        })
        .menu(|app| {
            // The menu is built before `setup` runs, so the stored language is loaded here
            load_language(app);
            build_app_menu(app)
        })
        .on_menu_event(|app, event| {
            let id: &str = event.id.as_ref();
            match id.strip_prefix("m:") {
                Some("quit") => app.exit(0),
                Some(command) => {
                    let _ = app.emit("menu", command);
                }
                // Entries without the prefix belong to the tray menu and are handled there
                None => {}
            }
        })
        .setup(|app| {
            let menu = build_tray_menu(app.handle())?;

            let mut tray = TrayIconBuilder::with_id(TRAY_ID)
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

            // Check for updates in release builds only: there is nothing to replace in dev mode
            if !cfg!(debug_assertions) {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = update_on_start(handle.clone()).await {
                        report_update(&handle, "error", None, None, Some(e.to_string()));
                    }
                });
            }
            Ok(())
        })
        // While monitoring runs, the close button only hides the window: the app stays in the tray
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
            router_url,
            update_status,
            get_language,
            set_language
        ])
        .run(tauri::generate_context!())
        .expect("failed to start the Tauri application");
}

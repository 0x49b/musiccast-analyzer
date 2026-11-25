//! Yamaha Extended Control (YXC): the local HTTP API of MusicCast devices.

use crate::i18n::{lang, pick, Lang};
use serde::Serialize;
use serde_json::{json, Value};
use std::sync::OnceLock;
use std::time::Duration;

fn agent() -> &'static ureq::Agent {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    AGENT.get_or_init(|| {
        ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_millis(1500))
            .timeout(Duration::from_secs(4))
            .build()
    })
}

fn url(ip: &str, path: &str) -> String {
    format!("http://{ip}/YamahaExtendedControl/v1/{path}")
}

pub fn get(ip: &str, path: &str) -> Option<Value> {
    agent().get(&url(ip, path)).call().ok()?.into_json().ok()
}

pub fn post(ip: &str, path: &str, body: &Value) -> Option<Value> {
    agent()
        .post(&url(ip, path))
        .send_json(body)
        .ok()?
        .into_json()
        .ok()
}

pub fn response_code(v: &Option<Value>) -> Option<i64> {
    v.as_ref()?.get("response_code")?.as_i64()
}

fn s(v: Option<&Value>, ptr: &str) -> Option<String> {
    v?.pointer(ptr)?.as_str().map(str::to_owned)
}

fn i(v: Option<&Value>, ptr: &str) -> Option<i64> {
    v?.pointer(ptr)?.as_i64()
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub ip: String,
    pub online: bool,
    pub name: Option<String>,
    pub model: Option<String>,
    pub firmware: Option<String>,
    pub connection: Option<String>,
    pub ssid: Option<String>,
    pub channel: Option<i64>,
    pub strength: Option<i64>,
    pub security: Option<String>,
    pub dhcp: Option<bool>,
    pub role: Option<String>,
    pub group_id: Option<String>,
    pub group_name: Option<String>,
    pub clients: Vec<String>,
    pub power: Option<String>,
    pub input: Option<String>,
    /// MusicCast location: only devices sharing an ID show up together in the Yamaha app
    pub location_id: Option<String>,
    pub location_name: Option<String>,
}

pub fn device_status(ip: &str) -> Device {
    let Some(info) = get(ip, "system/getDeviceInfo") else {
        return Device {
            ip: ip.to_owned(),
            ..Default::default()
        };
    };
    let net = get(ip, "system/getNetworkStatus");
    let dist = get(ip, "dist/getDistributionInfo");
    let status = get(ip, "main/getStatus");
    let location = get(ip, "system/getLocationInfo");
    let (net, dist, status, location) = (
        net.as_ref(),
        dist.as_ref(),
        status.as_ref(),
        location.as_ref(),
    );

    let clients = dist
        .and_then(|d| d.get("client_list"))
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|c| c.get("ip_address")?.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();

    Device {
        ip: ip.to_owned(),
        online: true,
        name: s(net, "/network_name"),
        model: s(Some(&info), "/model_name"),
        // system_version arrives as a number (e.g. 2.16)
        firmware: info.get("system_version").map(|v| match v {
            Value::String(t) => t.clone(),
            other => other.to_string(),
        }),
        connection: s(net, "/connection"),
        ssid: s(net, "/wireless_lan/ssid"),
        channel: i(net, "/wireless_lan/ch"),
        strength: i(net, "/wireless_lan/strength"),
        security: s(net, "/wireless_lan/type"),
        dhcp: net.and_then(|n| n.get("dhcp")).and_then(Value::as_bool),
        role: s(dist, "/role"),
        group_id: s(dist, "/group_id"),
        group_name: s(dist, "/group_name"),
        clients,
        power: s(status, "/power"),
        input: s(status, "/input"),
        location_id: s(location, "/id"),
        location_name: s(location, "/name"),
    }
}

#[derive(Serialize, Clone)]
pub struct Step {
    pub step: String,
    pub code: Option<i64>,
    pub ok: bool,
}

fn step(label: String, res: Option<Value>) -> Step {
    let code = response_code(&res);
    Step {
        step: label,
        code,
        ok: code == Some(0),
    }
}

fn role_of(ip: &str) -> Option<String> {
    s(get(ip, "dist/getDistributionInfo").as_ref(), "/role")
}

/// Builds a link group: register the clients, configure the master, start distribution.
pub fn link(master: &str, clients: &[String], name: Option<&str>) -> Vec<Step> {
    let mut steps = Vec::new();

    // Reuse the master's existing group, otherwise create a new ID (32 hex characters)
    let dist = get(master, "dist/getDistributionInfo");
    let existing = s(dist.as_ref(), "/group_id").filter(|g| {
        s(dist.as_ref(), "/role").as_deref() == Some("server")
            && !g.is_empty()
            && !g.chars().all(|c| c == '0')
    });
    let group_id =
        existing.unwrap_or_else(|| uuid::Uuid::new_v4().simple().to_string().to_uppercase());

    steps.push(step(
        format!("{master} {}", pick("power on", "einschalten")),
        get(master, "main/setPower?power=on"),
    ));
    for c in clients {
        steps.push(step(
            format!("{c} {}", pick("power on", "einschalten")),
            get(c, "main/setPower?power=on"),
        ));
        steps.push(step(
            format!("{c} setClientInfo"),
            post(
                c,
                "dist/setClientInfo",
                &json!({ "group_id": group_id, "zone": ["main"], "server_ip_address": master }),
            ),
        ));
    }
    steps.push(step(
        format!("{master} setServerInfo"),
        post(
            master,
            "dist/setServerInfo",
            &json!({ "group_id": group_id, "zone": "main", "type": "add", "client_list": clients }),
        ),
    ));

    let group_name = match name.map(str::trim).filter(|n| !n.is_empty()) {
        Some(n) => Some(n.to_owned()),
        None => s(
            get(master, "system/getNetworkStatus").as_ref(),
            "/network_name",
        )
        .map(|m| format!("{m} +{}", clients.len())),
    };
    if let Some(n) = group_name {
        steps.push(set_group_name(master, &n));
    }

    steps.push(step(
        format!("{master} startDistribution"),
        get(master, "dist/startDistribution?num=0"),
    ));
    steps
}

/// Dissolves every group among the known devices.
pub fn unlink(known: &[String]) -> Vec<Step> {
    let mut steps = Vec::new();
    let roles: Vec<(String, Option<String>)> =
        known.iter().map(|ip| (ip.clone(), role_of(ip))).collect();

    for (ip, role) in &roles {
        if role.as_deref() == Some("client") {
            steps.push(step(
                format!("{ip} setClientInfo {}", pick("(clear)", "(leer)")),
                post(
                    ip,
                    "dist/setClientInfo",
                    &json!({ "group_id": "", "zone": ["main"] }),
                ),
            ));
        }
    }
    for (ip, role) in &roles {
        if role.as_deref() == Some("server") {
            steps.push(step(
                format!("{ip} stopDistribution"),
                get(ip, "dist/stopDistribution"),
            ));
            steps.push(step(
                format!("{ip} setServerInfo {}", pick("(clear)", "(leer)")),
                post(ip, "dist/setServerInfo", &json!({ "group_id": "" })),
            ));
        }
    }
    steps
}

pub fn set_group_name(master: &str, name: &str) -> Step {
    let name: String = name.trim().chars().take(32).collect();
    step(
        format!("{master} setGroupName '{name}'"),
        post(master, "dist/setGroupName", &json!({ "name": name })),
    )
}

pub fn find_server(known: &[String]) -> Option<String> {
    known
        .iter()
        .find(|ip| role_of(ip).as_deref() == Some("server"))
        .cloned()
}

pub fn set_power(ip: &str, on: bool) -> Step {
    let p = if on { "on" } else { "standby" };
    let label = match (on, lang()) {
        (true, Lang::En) => "power on",
        (false, Lang::En) => "standby",
        (true, Lang::De) => "einschalten",
        (false, Lang::De) => "in Standby",
    };
    step(
        format!("{ip} {label}"),
        get(ip, &format!("main/setPower?power={p}")),
    )
}

/// Switches the device's network connection to wired (DHCP).
/// Afterwards it is no longer reachable at its previous Wi-Fi address.
pub fn switch_to_wired(ip: &str) -> Step {
    step(
        format!("{ip} setWiredLan"),
        post(ip, "system/setWiredLan", &json!({ "dhcp": true })),
    )
}

fn percent_encode(text: &str) -> String {
    text.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

pub fn is_location_id(id: &str) -> bool {
    id.len() == 32 && id.chars().all(|c| c.is_ascii_hexdigit())
}

/// Moves a device into an existing MusicCast location.
///
/// `setLocationId` and `setLocationName` are not publicly documented; the Yamaha app uses them
/// during setup. Observed on a WX-010: GET with `?id=` returns code 4 (invalid parameter), POST
/// with `{"id": ...}` is accepted as a request but can be refused with code 5 (guarded in the
/// current state). The name is only set once the ID has been accepted, so that two locations
/// never end up with the same name. The last step reads the location back and is the actual
/// proof of success.
pub fn set_location(ip: &str, id: &str, name: &str) -> Vec<Step> {
    let mut steps = Vec::new();

    let by_post = step(
        format!("{ip} setLocationId (POST)"),
        post(ip, "system/setLocationId", &json!({ "id": id })),
    );
    let mut id_ok = by_post.ok;
    let guarded = by_post.code == Some(5);
    steps.push(by_post);
    if !id_ok && !guarded {
        let by_get = step(
            format!("{ip} setLocationId (GET)"),
            get(ip, &format!("system/setLocationId?id={id}")),
        );
        id_ok = by_get.ok;
        steps.push(by_get);
    }

    if id_ok {
        let by_post = step(
            format!("{ip} setLocationName (POST)"),
            post(ip, "system/setLocationName", &json!({ "name": name })),
        );
        let name_ok = by_post.ok;
        steps.push(by_post);
        if !name_ok {
            steps.push(step(
                format!("{ip} setLocationName (GET)"),
                get(
                    ip,
                    &format!("system/setLocationName?name={}", percent_encode(name)),
                ),
            ));
        }
    }

    let now = get(ip, "system/getLocationInfo");
    let now_id = s(now.as_ref(), "/id").unwrap_or_default();
    let now_name = s(now.as_ref(), "/name").unwrap_or_default();
    let moved = now_id.eq_ignore_ascii_case(id);
    let hint = if moved {
        ""
    } else if guarded {
        pick(
            ", NOT changed. The device guards this setting (code 5) although it should not be \
             in a link group: hold CONNECT on the device for 5 seconds and retry right away",
            ", NICHT umgestellt. Das Ger\u{e4}t sperrt die \u{c4}nderung (Code 5), obwohl es in \
             keiner Link-Gruppe sein sollte: am Ger\u{e4}t CONNECT 5 Sekunden halten und gleich \
             danach erneut versuchen",
        )
    } else {
        pick(", NOT changed", ", NICHT umgestellt")
    };
    let check = pick("check: location is now", "Kontrolle: Standort ist jetzt");
    steps.push(Step {
        step: format!("{ip} {check} '{now_name}' ({now_id}){hint}"),
        code: response_code(&now),
        ok: moved,
    });
    steps
}

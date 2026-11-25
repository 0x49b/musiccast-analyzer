/**
 * All user-facing text of the UI. English is the default language, German the second one.
 * `de` must have exactly the shape of `en`; TypeScript enforces that through `Messages`.
 */
export type Lang = "en" | "de";

export const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "de", label: "Deutsch" },
];

export function isLang(value: unknown): value is Lang {
  return value === "en" || value === "de";
}

const en = {
  locale: "en-GB",

  ready: "Ready",
  error: (e: string) => `Error: ${e}`,
  cancel: "Cancel",

  nav: {
    aria: "Sections",
    devices: "Devices",
    wlan: "Wi-Fi",
    monitor: "Monitoring",
    settings: "Settings",
    monitoringRunning: "Monitoring is running",
  },

  busy: {
    discover: "Searching for devices on the network ...",
    refresh: "Querying devices ...",
    scan: "Scanning Wi-Fi ...",
    link: "Linking devices ...",
    unlink: "Unlinking ...",
    groupName: "Setting group name ...",
    power: "Switching ...",
    wired: "Switching to wired ...",
    location: "Setting location ...",
    monitor: "Monitoring ...",
    csv: "Setting CSV path ...",
  },

  /** Names of actions as they appear in the console summary line. */
  action: {
    link: "Link",
    unlink: "Unlink",
    unlinkBeforeLocation: "Unlink (before location change)",
    groupName: "Group name",
    power: "Power",
    wired: "Switch to wired",
    location: (name: string) => `Location «${name}»`,
  },

  console: {
    empty: "Every command sent to the devices appears here with its response code.",
    discovery: (n: number) => `Device discovery: ${n} found`,
    deviceLine: (ip: string, name: string, model: string, connection: string, location: string, id: string) =>
      `  ${ip}  ${name} (${model}, ${connection}, location «${location}» ${id})`,
    offlineLine: (ip: string) => `  ${ip}  offline`,
    scan: (adapter: string, n: number) => `Wi-Fi scan via ${adapter}: ${n} networks`,
    allAdapters: "all adapters",
    nothingToDo: (action: string) => `${action}: nothing to do (no matching device).`,
    summary: (action: string, steps: number, failed: number) => `${action}: ${steps} steps, ${failed} failed`,
    stepLine: (ok: boolean, step: string, code: string) => `  ${ok ? "OK  " : "FAIL"} ${step}  (code ${code})`,
    failed: (what: string, e: string) => `${what} Error: ${e}`,
    monitorStarted: (interval: number) => `Monitoring started, every ${interval} s`,
    monitorStopped: "Monitoring stopped",
    csvPath: (path: string) => `CSV path: ${path}`,
    updateFound: (version: string) => `Update ${version} found, downloading`,
    updateInstalling: (version: string) => `Installing update ${version}, the app will restart`,
    updateCurrent: "The app is up to date.",
    updateFailed: (message: string) => `Update check failed: ${message}`,
    unknownError: "unknown error",
  },

  notify: {
    chooseMasterClient: "Check one master and at least one client.",
    wiredDone: "Switched. The device now gets a new address over the cable. Search again in 1 to 2 minutes (F5).",
    adaptersFailed: (e: string) => `The adapters could not be read: ${e}`,
  },

  /** YXC response codes as described in Yamaha's specification. */
  code: {
    none: "no response",
    0: "0 ok",
    1: "1 device is still initialising",
    2: "2 internal error",
    3: "3 invalid request",
    4: "4 invalid parameter",
    5: "5 guarded in the current state",
    6: "6 timeout",
    99: "99 firmware update in progress",
  },

  connection: { wired: "Wired", extended: "Extended", wifi: "Wi-Fi" },
  role: { master: "Master", client: "Client", none: "no link" },
  signalAria: (value: number) => `Signal ${value}`,

  devices: {
    title: "Devices",
    find: "Find devices",
    findTitle: "Search the network (F5)",
    refresh: "Refresh",
    refreshTitle: "Query the status again (Ctrl+R)",
    group: "Group",
    link: "Link",
    linkTitle: "Link the checked devices (Ctrl+L)",
    setName: "Set name",
    unlink: "Unlink all",
    unlinkTitle: "Dissolve all groups (Ctrl+Shift+L)",
    locationsInfo: (n: number) =>
      `The devices are spread over ${n} MusicCast locations. The Yamaha app shows only one at a time.`,
    target: "Target",
    move: "Move devices",
    moveNamed: (names: string) => `Move ${names}`,
    empty: "No MusicCast devices found yet.",
    emptyHint: "F5 searches the network. Fixed addresses can be entered in Settings.",
    col: {
      master: "Master",
      masterTitle: "Master of the new group",
      client: "Client",
      clientTitle: "Client of the new group",
      name: "Name",
      connection: "Connection",
      signal: "Signal",
      link: "Link",
      location: "Location",
      address: "Address",
      power: "Power",
    },
    asMaster: (name: string) => `${name} as master`,
    asClient: (name: string) => `${name} as client`,
    unknown: "Unknown",
    noAnswer: "No response",
    noRadio: "no radio",
    on: "On",
    standby: "Standby",
  },

  inspector: {
    hint: "Select a device in the list to see its details and actions.",
    address: "Address",
    connection: "Connection",
    wifi: "Wi-Fi",
    channel: "Channel",
    signal: "Signal",
    firmware: "Firmware",
    link: "Link",
    location: "Location",
    input: "Input",
    toStandby: "Switch to standby",
    powerOn: "Power on",
    toWired: "Switch to wired",
    wiredNote: (ip: string) =>
      `Only with the LAN cable plugged in. The device leaves ${ip} and gets a new address over the cable. If that fails, only a factory reset helps.`,
    wiredConfirm: "Cable is plugged in, switch",
  },

  wlan: {
    title: "Wi-Fi",
    adapter: "Adapter",
    allAdapters: "All adapters",
    scan: "Scan Wi-Fi",
    scanTitle: "Scan networks in range (F6)",
    usage: "2.4 GHz usage",
    noScan: "No scan yet. F6 scans with the selected adapter.",
    emptyScan:
      "The scan is empty. Is the adapter enabled? Windows 11 requires location access for this (Settings, Privacy, Location).",
    summary: (n: number, scores: string) =>
      `${n} networks. Interference score for channels 1, 6, 11: ${scores}. Lower is better.`,
    spectrumAria: "Usage of channels 1 to 13",
    yourChannel: "Your channel",
    recommended: (channel: number | null) => (channel ? `Recommended: channel ${channel}` : "Recommended"),
    heightLegend: "Height: sum of the signal strengths of other networks",
    col: { channel: "Channel", signal: "Signal", network: "Network" },
    hidden: "Hidden network",
  },

  monitor: {
    title: "Monitoring",
    interval: "Interval in seconds",
    start: "Start monitoring",
    stop: "Stop monitoring",
    clear: "Clear list",
    pathTitle: "Change the path in Settings",
    empty: "No entries yet.",
    emptyHint:
      "Monitoring records every change: offline, role change, channel change. Windows shows a notification for dropouts. While it runs, the app stays active in the notification area when you close the window.",
    col: { time: "Time", device: "Device", address: "Address", status: "Status", signal: "Signal" },
  },

  settings: {
    title: "Settings",
    appearance: "Appearance",
    theme: "Colour scheme",
    themes: { system: "System", light: "Light", dark: "Dark" },
    language: "Language",
    deviceList: "Device list",
    fixedAddresses: "Fixed addresses",
    useAddresses: "Use addresses",
    fixedHint: "Replaces automatic discovery until you search again with F5.",
    monitorLog: "Monitoring log",
    csvFile: "CSV file",
    applyPath: "Apply path",
    useDesktop: "Use Desktop",
    csvHint: "Absolute path to a file or a folder. Without a value the file is placed on the Desktop.",
    router: "Router",
    routerIntro: "The app changes nothing on the router. Set these values in your router's portal:",
    channelBefore: "2.4 GHz channel fixed at",
    channelAfter: ", bandwidth 20 MHz",
    scanFirst: "(scan Wi-Fi first)",
    wpa2: "WPA2 encryption",
    quietHours: "Wi-Fi quiet hours off",
    staticIp: "A static IP is set up for every MusicCast device",
    openPortal: "Open router portal",
  },

  dock: { hints: "Hints", console: "Console", clear: "Clear", collapse: "Collapse", expand: "Expand" },
  level: { bad: "Problem", warn: "Check", info: "Note", ok: "OK" },

  statusbar: {
    devices: (n: number) => `${n} ${n === 1 ? "device" : "devices"}`,
    linked: (n: number) => `${n} linked`,
    noLink: "no link",
    locations: (n: number) => `${n} locations`,
    monitorOn: (interval: number) => `Monitoring every ${interval} s`,
    monitorOff: "Monitoring off",
  },

  update: {
    checking: "Checking for updates ...",
    downloading: (version: string, percent: number | null) =>
      `Downloading update ${version}${percent != null ? `, ${percent} %` : ""}`,
    installing: (version: string) => `Installing update ${version}, the app will restart`,
    failed: "Update check failed",
  },

  rec: {
    offline: (ip: string) =>
      `${ip} does not respond. The device is off, in deep sleep (enable network standby) or its IP has changed.`,
    weakSignal: (name: string, strength: number) =>
      `${name}: weak Wi-Fi signal (${strength}). This is a likely cause of link dropouts. Move it closer to the access point, connect it by cable or attach it in extended mode to a wired MusicCast device.`,
    insecure: (name: string, security: string) =>
      `${name}: the Wi-Fi is unencrypted or uses WEP («${security}»). Set WPA2 on the router.`,
    locationPart: (name: string, devices: string) => `«${name}»: ${devices}`,
    locations: (n: number, parts: string) =>
      `The devices are in ${n} different MusicCast locations (${parts}). The Yamaha app only ever shows one location, and Link only works within one. The bar above the device list moves them all into one location.`,
    noWired:
      "No device is connected by cable. A wired MusicCast device can serve the others itself in extended mode.",
    extended: (names: string) =>
      `${names} runs in extended mode through another MusicCast device instead of the router's Wi-Fi.`,
    wiredPlusWifi: (wired: string, wifi: string) =>
      `${wired} is wired. ${wifi} still uses the router's Wi-Fi and could move to extended mode as well.`,
    staticIps: (list: string) =>
      `The app cannot see whether static IPs are set on the router. Please check in the router portal for: ${list}. Once done, tick it off in Settings under Router.`,
    channels: (list: string) =>
      `The devices report different channels (${list}). They are connected to different access points or to another device's MusicCast network.`,
    firmware: (model: string, versions: string) =>
      `${model}: different firmware versions (${versions}). Update them all in the MusicCast app.`,
    notLinked: "Nothing is linked at the moment.",
    channelOff: (own: number, best: number) =>
      `Your 2.4 GHz network runs on channel ${own}. Fix it to channel ${best} on the router, 20 MHz.`,
    channelFull: (own: number, best: number, current: number, bestScore: number) =>
      `Channel ${own} is much busier than channel ${best} (${current} vs. ${bestScore}). Fix it to ${best} on the router.`,
    channelOk: (own: number) =>
      `Channel ${own} is fine. Fix it on the router so that it does not change automatically.`,
    bestChannel: (channel: number) => `Best 2.4 GHz channel right now: ${channel}.`,
    allGood: "Nothing unusual. Start monitoring and let it run overnight.",
    nothingChecked: "Nothing checked yet. F5 finds devices, F6 scans the Wi-Fi.",
  },
};

export type Messages = typeof en;

const de: Messages = {
  locale: "de-CH",

  ready: "Bereit",
  error: (e) => `Fehler: ${e}`,
  cancel: "Abbrechen",

  nav: {
    aria: "Bereiche",
    devices: "Geräte",
    wlan: "WLAN",
    monitor: "Monitoring",
    settings: "Einstellungen",
    monitoringRunning: "Monitoring läuft",
  },

  busy: {
    discover: "Suche Geräte im Netzwerk ...",
    refresh: "Frage Geräte ab ...",
    scan: "Scanne WLAN ...",
    link: "Verlinke Geräte ...",
    unlink: "Löse Links auf ...",
    groupName: "Setze Gruppennamen ...",
    power: "Schalte ...",
    wired: "Stelle auf Kabel um ...",
    location: "Setze Standort ...",
    monitor: "Monitoring ...",
    csv: "Setze CSV-Pfad ...",
  },

  action: {
    link: "Verlinken",
    unlink: "Links auflösen",
    unlinkBeforeLocation: "Links auflösen (vor Standortwechsel)",
    groupName: "Gruppenname",
    power: "Power",
    wired: "Auf Kabel umstellen",
    location: (name) => `Standort «${name}»`,
  },

  console: {
    empty: "Hier erscheint jeder Befehl an die Geräte mit seinem Antwortcode.",
    discovery: (n) => `Gerätesuche: ${n} gefunden`,
    deviceLine: (ip, name, model, connection, location, id) =>
      `  ${ip}  ${name} (${model}, ${connection}, Standort «${location}» ${id})`,
    offlineLine: (ip) => `  ${ip}  offline`,
    scan: (adapter, n) => `WLAN-Scan über ${adapter}: ${n} Netze`,
    allAdapters: "alle Adapter",
    nothingToDo: (action) => `${action}: nichts zu tun (kein passendes Gerät).`,
    summary: (action, steps, failed) => `${action}: ${steps} Schritte, ${failed} fehlgeschlagen`,
    stepLine: (ok, step, code) => `  ${ok ? "OK  " : "FAIL"} ${step}  (Code ${code})`,
    failed: (what, e) => `${what} Fehler: ${e}`,
    monitorStarted: (interval) => `Monitoring gestartet, alle ${interval} s`,
    monitorStopped: "Monitoring gestoppt",
    csvPath: (path) => `CSV-Pfad: ${path}`,
    updateFound: (version) => `Update ${version} gefunden, lade herunter`,
    updateInstalling: (version) => `Update ${version} wird installiert, die App startet neu`,
    updateCurrent: "Die App ist aktuell.",
    updateFailed: (message) => `Update-Prüfung fehlgeschlagen: ${message}`,
    unknownError: "unbekannter Fehler",
  },

  notify: {
    chooseMasterClient: "Einen Master und mindestens einen Client ankreuzen.",
    wiredDone: "Umgestellt. Das Gerät bezieht jetzt per Kabel eine neue IP. In 1 bis 2 Minuten neu suchen (F5).",
    adaptersFailed: (e) => `Adapter konnten nicht gelesen werden: ${e}`,
  },

  code: {
    none: "keine Antwort",
    0: "0 ok",
    1: "1 Gerät initialisiert noch",
    2: "2 interner Fehler",
    3: "3 ungültige Anfrage",
    4: "4 ungültiger Parameter",
    5: "5 im aktuellen Zustand gesperrt",
    6: "6 Zeitüberschreitung",
    99: "99 Firmware-Update läuft",
  },

  connection: { wired: "Kabel", extended: "Erweitert", wifi: "WLAN" },
  role: { master: "Master", client: "Client", none: "kein Link" },
  signalAria: (value) => `Signal ${value}`,

  devices: {
    title: "Geräte",
    find: "Geräte suchen",
    findTitle: "Im Netzwerk suchen (F5)",
    refresh: "Aktualisieren",
    refreshTitle: "Status neu abfragen (Ctrl+R)",
    group: "Gruppe",
    link: "Verlinken",
    linkTitle: "Angekreuzte Geräte verlinken (Ctrl+L)",
    setName: "Namen setzen",
    unlink: "Links auflösen",
    unlinkTitle: "Alle Gruppen auflösen (Ctrl+Shift+L)",
    locationsInfo: (n) =>
      `Die Geräte liegen in ${n} MusicCast-Standorten. Die Yamaha-App zeigt jeweils nur einen.`,
    target: "Ziel",
    move: "Geräte umhängen",
    moveNamed: (names) => `${names} umhängen`,
    empty: "Noch keine MusicCast-Geräte gefunden.",
    emptyHint: "F5 sucht im Netzwerk. Feste Adressen lassen sich in den Einstellungen eintragen.",
    col: {
      master: "Master",
      masterTitle: "Master der neuen Gruppe",
      client: "Client",
      clientTitle: "Client der neuen Gruppe",
      name: "Name",
      connection: "Verbindung",
      signal: "Signal",
      link: "Link",
      location: "Standort",
      address: "Adresse",
      power: "Power",
    },
    asMaster: (name) => `${name} als Master`,
    asClient: (name) => `${name} als Client`,
    unknown: "Unbekannt",
    noAnswer: "Keine Antwort",
    noRadio: "kein Funk",
    on: "An",
    standby: "Standby",
  },

  inspector: {
    hint: "Ein Gerät in der Liste wählen, um Details und Aktionen zu sehen.",
    address: "Adresse",
    connection: "Verbindung",
    wifi: "WLAN",
    channel: "Kanal",
    signal: "Signal",
    firmware: "Firmware",
    link: "Link",
    location: "Standort",
    input: "Eingang",
    toStandby: "In Standby schalten",
    powerOn: "Einschalten",
    toWired: "Auf Kabel umstellen",
    wiredNote: (ip) =>
      `Nur mit eingestecktem LAN-Kabel. Das Gerät verlässt ${ip} und bezieht per Kabel eine neue Adresse. Schlägt das fehl, hilft nur ein Werksreset.`,
    wiredConfirm: "Kabel steckt, umstellen",
  },

  wlan: {
    title: "WLAN",
    adapter: "Adapter",
    allAdapters: "Alle Adapter",
    scan: "WLAN scannen",
    scanTitle: "Netze in Reichweite scannen (F6)",
    usage: "Belegung 2.4 GHz",
    noScan: "Noch kein Scan. F6 scannt mit dem gewählten Adapter.",
    emptyScan:
      "Der Scan ist leer. Adapter aktiviert? Windows 11 verlangt dafür den Standortzugriff (Einstellungen, Datenschutz, Standort).",
    summary: (n, scores) => `${n} Netze. Störwert für Kanal 1, 6, 11: ${scores}. Kleiner ist besser.`,
    spectrumAria: "Belegung der Kanäle 1 bis 13",
    yourChannel: "Dein Kanal",
    recommended: (channel) => (channel ? `Empfohlen: Kanal ${channel}` : "Empfohlen"),
    heightLegend: "Höhe: Summe der Signalstärken fremder Netze",
    col: { channel: "Kanal", signal: "Signal", network: "Netz" },
    hidden: "Verstecktes Netz",
  },

  monitor: {
    title: "Monitoring",
    interval: "Intervall in Sekunden",
    start: "Monitoring starten",
    stop: "Monitoring stoppen",
    clear: "Liste leeren",
    pathTitle: "Pfad in den Einstellungen ändern",
    empty: "Noch keine Einträge.",
    emptyHint:
      "Das Monitoring notiert jede Änderung: offline, Rollenwechsel, Kanalwechsel. Abbrüche meldet Windows als Benachrichtigung. Solange es läuft, bleibt die App beim Schliessen im Infobereich aktiv.",
    col: { time: "Zeit", device: "Gerät", address: "Adresse", status: "Status", signal: "Signal" },
  },

  settings: {
    title: "Einstellungen",
    appearance: "Darstellung",
    theme: "Farbschema",
    themes: { system: "System", light: "Hell", dark: "Dunkel" },
    language: "Sprache",
    deviceList: "Geräteliste",
    fixedAddresses: "Feste Adressen",
    useAddresses: "Adressen verwenden",
    fixedHint: "Ersetzt die automatische Suche, bis du wieder mit F5 suchst.",
    monitorLog: "Monitoring-Protokoll",
    csvFile: "CSV-Datei",
    applyPath: "Pfad übernehmen",
    useDesktop: "Desktop verwenden",
    csvHint: "Absoluter Pfad zu einer Datei oder einem Ordner. Ohne Angabe liegt die Datei auf dem Desktop.",
    router: "Router",
    routerIntro: "Die App ändert am Router nichts. Diese Werte im Portal deines Routers setzen:",
    channelBefore: "2.4-GHz-Kanal fest auf",
    channelAfter: ", Bandbreite 20 MHz",
    scanFirst: "(erst WLAN scannen)",
    wpa2: "Verschlüsselung WPA2",
    quietHours: "WLAN-Ruhezeiten aus",
    staticIp: "Statische IP pro MusicCast-Gerät ist eingerichtet",
    openPortal: "Router-Portal öffnen",
  },

  dock: { hints: "Hinweise", console: "Konsole", clear: "Leeren", collapse: "Einklappen", expand: "Ausklappen" },
  level: { bad: "Problem", warn: "Prüfen", info: "Hinweis", ok: "In Ordnung" },

  statusbar: {
    devices: (n) => `${n} ${n === 1 ? "Gerät" : "Geräte"}`,
    linked: (n) => `${n} verlinkt`,
    noLink: "kein Link",
    locations: (n) => `${n} Standorte`,
    monitorOn: (interval) => `Monitoring alle ${interval} s`,
    monitorOff: "Monitoring aus",
  },

  update: {
    checking: "Suche nach Updates ...",
    downloading: (version, percent) => `Lade Update ${version}${percent != null ? `, ${percent} %` : ""}`,
    installing: (version) => `Installiere Update ${version}, die App startet neu`,
    failed: "Update-Prüfung fehlgeschlagen",
  },

  rec: {
    offline: (ip) =>
      `${ip} antwortet nicht. Gerät aus, im Tiefschlaf (Netzwerk-Standby aktivieren) oder IP geändert.`,
    weakSignal: (name, strength) =>
      `${name}: schwaches WLAN-Signal (${strength}). Das ist ein wahrscheinlicher Grund für Link-Abbrüche. Näher an den Zugangspunkt, per Kabel oder im erweiterten Modus an ein verkabeltes MusicCast-Gerät hängen.`,
    insecure: (name, security) =>
      `${name}: WLAN ist unverschlüsselt oder nutzt WEP («${security}»). Im Router WPA2 einstellen.`,
    locationPart: (name, devices) => `«${name}»: ${devices}`,
    locations: (n, parts) =>
      `Die Geräte liegen in ${n} verschiedenen MusicCast-Standorten (${parts}). Die Yamaha-App zeigt immer nur einen Standort, und Link funktioniert nur innerhalb eines Standorts. Die Leiste über der Geräteliste hängt alle in einen Standort um.`,
    noWired:
      "Kein Gerät hängt am Kabel. Ein verkabeltes MusicCast-Gerät kann im erweiterten Modus die anderen selbst versorgen.",
    extended: (names) =>
      `${names} läuft im erweiterten Modus über ein anderes MusicCast-Gerät statt über das Router-WLAN.`,
    wiredPlusWifi: (wired, wifi) =>
      `${wired} ist verkabelt. ${wifi} hängt noch am Router-WLAN und könnte ebenfalls in den erweiterten Modus.`,
    staticIps: (list) =>
      `Ob im Router statische IPs hinterlegt sind, kann die App nicht sehen. Bitte im Router-Portal prüfen für: ${list}. Wenn erledigt, in den Einstellungen unter Router abhaken.`,
    channels: (list) =>
      `Die Geräte melden unterschiedliche Kanäle (${list}). Sie hängen an verschiedenen Zugangspunkten oder am MusicCast-Netz eines anderen Geräts.`,
    firmware: (model, versions) =>
      `${model}: unterschiedliche Firmware (${versions}). In der MusicCast-App alle aktualisieren.`,
    notLinked: "Aktuell ist nichts verlinkt.",
    channelOff: (own, best) =>
      `Dein 2.4-GHz-Netz läuft auf Kanal ${own}. Im Router fix auf Kanal ${best} stellen, 20 MHz.`,
    channelFull: (own, best, current, bestScore) =>
      `Kanal ${own} ist deutlich voller als Kanal ${best} (${current} vs. ${bestScore}). Im Router fix auf ${best} stellen.`,
    channelOk: (own) =>
      `Kanal ${own} ist in Ordnung. Im Router fix einstellen, damit er nicht automatisch wechselt.`,
    bestChannel: (channel) => `Bester 2.4-GHz-Kanal aktuell: ${channel}.`,
    allGood: "Nichts Auffälliges. Monitoring starten und über Nacht laufen lassen.",
    nothingChecked: "Noch nichts geprüft. F5 sucht Geräte, F6 scannt das WLAN.",
  },
};

export const messages: Record<Lang, Messages> = { en, de };

/** Text for a YXC response code in the given language. */
export function codeText(t: Messages, code: number | null): string {
  if (code === null) return t.code.none;
  const known = t.code as unknown as Record<string, string | undefined>;
  return known[String(code)] ?? String(code);
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "./api";
import {
  WEAK_SIGNAL,
  bestChannel,
  channelLoad,
  channelScore,
  codeText,
  defaultLocation,
  isExtended,
  isWired,
  isWireless,
  locationsOf,
  ownNetwork,
  recommendations,
} from "./logic";
import type { Adapter, Device, MonitorEntry, MonitorStatus, Net, RecLevel, Step } from "./types";

type Theme = "system" | "light" | "dark";
const THEMES: { id: Theme; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Hell" },
  { id: "dark", label: "Dunkel" },
];

const LEVEL_LABEL: Record<RecLevel, string> = {
  bad: "Problem",
  warn: "Prüfen",
  info: "Hinweis",
  ok: "In Ordnung",
};

type View = "devices" | "wlan" | "monitor" | "settings";
type DockTab = "hints" | "console";

const VIEWS: { id: View; label: string; key: string }[] = [
  { id: "devices", label: "Geräte", key: "Ctrl+1" },
  { id: "wlan", label: "WLAN", key: "Ctrl+2" },
  { id: "monitor", label: "Monitoring", key: "Ctrl+3" },
  { id: "settings", label: "Einstellungen", key: "Ctrl+4" },
];

interface ConsoleLine {
  id: number;
  time: string;
  level: "ok" | "bad" | "info";
  text: string;
}
let consoleSeq = 0;
const clock = () => new Date().toLocaleTimeString("de-CH", { hour12: false });

function load(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Speicher nicht verfuegbar: Einstellung gilt nur fuer diese Sitzung */
  }
}

/** Symbole der Seitenleiste, 16px, eine Strichstaerke. */
function Icon({ name }: { name: View }) {
  const paths: Record<View, ReactNode> = {
    devices: (
      <>
        <rect x="3.5" y="1.5" width="9" height="13" rx="1.5" />
        <circle cx="8" cy="9.5" r="2.5" />
        <circle cx="8" cy="4.5" r="0.6" fill="currentColor" stroke="none" />
      </>
    ),
    wlan: (
      <>
        <path d="M1.5 6.2a9.5 9.5 0 0 1 13 0" />
        <path d="M4 8.9a6 6 0 0 1 8 0" />
        <circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" />
      </>
    ),
    monitor: <path d="M1.5 8.5h3l1.8-5 3 9 1.9-4h3.3" />,
    settings: (
      <>
        <path d="M2 4.5h12M2 11.5h12" />
        <circle cx="5.5" cy="4.5" r="1.7" fill="var(--side)" />
        <circle cx="10.5" cy="11.5" r="1.7" fill="var(--side)" />
      </>
    ),
  };
  return (
    <svg className="icon" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/** Pegelanzeige in zehn Segmenten, wie an einem Verstaerker. */
function Meter({ value, max = 100 }: { value: number; max?: number }) {
  const lit = Math.max(0, Math.min(10, Math.round((value / max) * 10)));
  const tone = value < WEAK_SIGNAL ? "bad" : value < 60 ? "warn" : "ok";
  return (
    <span className={`meter ${tone}`} role="img" aria-label={`Signal ${value}`}>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < lit ? "on" : ""} />
      ))}
    </span>
  );
}

function connectionLabel(d: Device): string {
  if (isWired(d)) return "Kabel";
  if (isExtended(d)) return "Erweitert";
  if (isWireless(d)) return "WLAN";
  return d.connection ?? "";
}
function roleLabel(d: Device): string {
  return d.role === "server" ? "Master" : d.role === "client" ? "Client" : "kein Link";
}

export default function App() {
  const [view, setView] = useState<View>("devices");
  const [dockTab, setDockTab] = useState<DockTab>("hints");
  const [dockOpen, setDockOpen] = useState(true);
  const [dockHeight, setDockHeight] = useState(() => Number(load("mc-dock", "190")) || 190);
  const [selected, setSelected] = useState("");
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = load("mc-theme", "system");
    return stored === "light" || stored === "dark" ? stored : "system";
  });

  // Farbschema anwenden: Oberflaeche ueber data-theme, Titelleiste und Menue ueber das Fenster
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    save("mc-theme", theme);
    try {
      void getCurrentWindow()
        .setTheme(theme === "system" ? null : theme)
        .catch(() => undefined);
    } catch {
      /* ausserhalb von Tauri gibt es kein Fenster-Objekt */
    }
  }, [theme]);

  const [adapters, setAdapters] = useState<Adapter[]>([]);
  const [adapter, setAdapter] = useState("");
  const [devices, setDevices] = useState<Device[]>([]);
  const [nets, setNets] = useState<Net[] | null>(null);
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [ipsText, setIpsText] = useState("");

  const [master, setMaster] = useState("");
  const [clients, setClients] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");
  const [confirmWired, setConfirmWired] = useState<string | null>(null);
  const [targetLocation, setTargetLocation] = useState("");
  const [confirmLocation, setConfirmLocation] = useState(false);

  const [staticDone, setStaticDone] = useState(load("mc-static", "0") === "1");
  const [monitor, setMonitor] = useState<MonitorStatus | null>(null);
  const [log, setLog] = useState<MonitorEntry[]>([]);
  const [interval, setIntervalSecs] = useState(10);
  const [logPathText, setLogPathText] = useState("");
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);

  /** Haengt Zeilen an die Konsole an (maximal 500 bleiben erhalten). */
  const print = useCallback((level: ConsoleLine["level"], ...texts: string[]) => {
    const time = clock();
    setConsoleLines((prev) =>
      [...prev, ...texts.map((text) => ({ id: ++consoleSeq, time, level, text }))].slice(-500),
    );
  }, []);

  const consoleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [consoleLines, dockTab, dockOpen]);

  const toastTimer = useRef<number | undefined>(undefined);
  const notify = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 4500);
  }, []);

  /** Fuehrt eine Aktion mit Anzeige in der Statusleiste aus; Fehler landen in Konsole und Meldung. */
  const run = useCallback(
    async <T,>(text: string, action: () => Promise<T>): Promise<T | undefined> => {
      setBusy(text);
      try {
        return await action();
      } catch (e) {
        notify(`Fehler: ${String(e)}`);
        print("bad", `${text} Fehler: ${String(e)}`);
        return undefined;
      } finally {
        setBusy("");
      }
    },
    [notify, print],
  );

  /** Schreibt die Einzelschritte einer Aktion mit Response-Code in die Konsole. */
  const printSteps = useCallback(
    (action: string, result: Step[]) => {
      if (result.length === 0) {
        print("info", `${action}: nichts zu tun (kein passendes Gerät).`);
        return;
      }
      const bad = result.filter((s) => !s.ok).length;
      print(bad ? "bad" : "info", `${action}: ${result.length} Schritte, ${bad} fehlgeschlagen`);
      for (const s of result) {
        print(s.ok ? "ok" : "bad", `  ${s.ok ? "OK  " : "FAIL"} ${s.step}  (Code ${codeText(s.code)})`);
      }
      // Fehlgeschlagene Schritte holen die Konsole nach vorn
      if (bad) {
        setDockOpen(true);
        setDockTab("console");
      }
    },
    [print],
  );

  const applyDevices = useCallback((list: Device[]) => {
    setDevices(list);
    const server = list.find((d) => d.role === "server");
    setMaster((m) => server?.ip ?? (list.some((d) => d.ip === m) ? m : ""));
    setClients(new Set(list.filter((d) => d.role === "client").map((d) => d.ip)));
    setSelected((s) => (list.some((d) => d.ip === s) ? s : (list[0]?.ip ?? "")));
    if (server?.groupName) setGroupName(server.groupName);
  }, []);

  const discover = useCallback(
    async (ips?: string[]) => {
      const list = await run("Suche Geräte im Netzwerk ...", () => api.discover(ips));
      if (!list) return;
      applyDevices(list);
      print(
        "info",
        `Gerätesuche: ${list.length} gefunden`,
        ...list.map(
          (d) =>
            `  ${d.ip}  ${d.online ? `${d.name ?? "?"} (${d.model ?? "?"}, ${d.connection ?? "?"}, Standort «${d.locationName ?? "?"}» ${d.locationId ?? ""})` : "offline"}`,
        ),
      );
    },
    [run, applyDevices, print],
  );

  const refresh = useCallback(async () => {
    const list = await run("Frage Geräte ab ...", () => api.getDevices());
    if (list) applyDevices(list);
  }, [run, applyDevices]);

  const scan = useCallback(async () => {
    save("mc-adapter", adapter);
    const list = await run("Scanne WLAN ...", () => api.scanWlan(adapter));
    if (!list) return;
    setNets(list);
    print("info", `WLAN-Scan über ${adapter || "alle Adapter"}: ${list.length} Netze`);
  }, [run, adapter, print]);

  const recs = useMemo(() => recommendations(devices, nets, staticDone), [devices, nets, staticDone]);
  const own = useMemo(() => ownNetwork(devices), [devices]);
  const nets24 = useMemo(() => (nets ?? []).filter((n) => n.channel >= 1 && n.channel <= 14), [nets]);
  const best = useMemo(() => (nets ? bestChannel(nets, own?.ssid ?? null) : null), [nets, own]);
  const loads = useMemo(() => channelLoad(nets24, own?.ssid ?? null), [nets24, own]);
  const maxLoad = Math.max(1, ...loads);
  const locations = useMemo(() => locationsOf(devices), [devices]);
  const mixedLocations = locations.length > 1;
  // Ohne Auswahl gilt «Home» (bzw. der groesste Standort, falls es kein «Home» gibt)
  const target = locations.find((l) => l.id === targetLocation) ?? defaultLocation(locations);
  const toMove = target ? devices.filter((d) => d.online && d.locationId !== target.id) : [];
  const current = devices.find((d) => d.ip === selected) ?? null;
  const issues = recs.filter((r) => r.level === "bad" || r.level === "warn").length;
  const linked = devices.filter((d) => d.role === "server" || d.role === "client").length;

  const showSteps = (action: string, result: Step[] | undefined) => {
    if (result) printSteps(action, result);
    window.setTimeout(refresh, 1500);
  };

  const doLink = async () => {
    const list = [...clients].filter((ip) => ip !== master);
    if (!master || list.length === 0) {
      notify("Einen Master und mindestens einen Client ankreuzen.");
      return;
    }
    showSteps("Verlinken", await run("Verlinke Geräte ...", () => api.link(master, list, groupName.trim())));
  };

  const doUnlink = async () => {
    showSteps("Links auflösen", await run("Löse Links auf ...", () => api.unlink()));
  };

  const doWired = async (ip: string) => {
    setConfirmWired(null);
    const step = await run("Stelle auf Kabel um ...", () => api.switchToWired(ip));
    if (!step) return;
    printSteps("Auf Kabel umstellen", [step]);
    if (step.ok) {
      notify("Umgestellt. Das Gerät bezieht jetzt per Kabel eine neue IP. In 1 bis 2 Minuten neu suchen (F5).");
    }
  };

  const doSetLocation = async () => {
    setConfirmLocation(false);
    if (!target || toMove.length === 0) return;
    // Geraete in einer Link-Gruppe sperren die Aenderung (Code 5): Gruppe zuerst aufloesen
    if (devices.some((d) => d.role === "server" || d.role === "client")) {
      const unlinked = await run("Löse Links auf ...", () => api.unlink());
      if (!unlinked) return;
      printSteps("Links auflösen (vor Standortwechsel)", unlinked);
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
    }
    showSteps(
      `Standort «${target.name}»`,
      await run("Setze Standort ...", () =>
        api.setLocation(
          toMove.map((d) => d.ip),
          target.id,
          target.name,
        ),
      ),
    );
  };

  const toggleMonitor = async () => {
    const next = await run("Monitoring ...", () => (monitor?.on ? api.monitorStop() : api.monitorStart(interval)));
    if (!next) return;
    setMonitor(next);
    print("info", next.on ? `Monitoring gestartet, alle ${next.interval} s` : "Monitoring gestoppt");
  };

  const applyLogPath = async (path: string) => {
    const next = await run("Setze CSV-Pfad ...", () => api.monitorSetLogPath(path));
    if (!next) return;
    setMonitor(next);
    setLogPathText(next.logPath ?? "");
    save("mc-logpath", next.customLogPath ? (next.logPath ?? "") : "");
    print("info", `CSV-Pfad: ${next.logPath ?? "?"}`);
  };

  // Befehle aus dem nativen Menue (und dessen Tastenkuerzeln) laufen ueber diese Tabelle.
  // Die Ref haelt immer die Funktionen des aktuellen Renders.
  const commands = useRef<Record<string, () => void>>({});
  commands.current = {
    "view-devices": () => setView("devices"),
    "view-wlan": () => setView("wlan"),
    "view-monitor": () => setView("monitor"),
    "view-settings": () => setView("settings"),
    "toggle-dock": () => setDockOpen((open) => !open),
    discover: () => {
      setView("devices");
      void discover();
    },
    refresh: () => void refresh(),
    link: () => void doLink(),
    unlink: () => void doUnlink(),
    scan: () => {
      setView("wlan");
      void scan();
    },
    "toggle-monitor": () => void toggleMonitor(),
  };

  // Start: Adapter und Monitoring-Status laden, Geraete suchen, auf Ereignisse hoeren
  useEffect(() => {
    api
      .getAdapters()
      .then((list) => {
        setAdapters(list);
        const stored = load("mc-adapter", "");
        const usb = list.find((a) => /8812|USB/i.test(a.description));
        setAdapter(list.some((a) => a.name === stored) ? stored : (usb?.name ?? ""));
      })
      .catch((e) => notify(`Adapter konnten nicht gelesen werden: ${String(e)}`));

    // Gespeicherten CSV-Pfad wiederherstellen; ist er ungueltig geworden, gilt der Standard
    const storedPath = load("mc-logpath", "");
    (storedPath ? api.monitorSetLogPath(storedPath).catch(() => api.monitorStatus()) : api.monitorStatus())
      .then((s) => {
        setMonitor(s);
        setLog(s.log);
        setIntervalSecs(s.interval);
        setLogPathText(s.logPath ?? "");
      })
      .catch(() => undefined);

    void discover();

    const offEntry = listen<MonitorEntry>("monitor-entry", (event) => {
      setLog((prev) => [...prev, event.payload].slice(-2000));
    });
    const offMenu = listen<string>("menu", (event) => {
      commands.current[event.payload]?.();
    });
    return () => {
      offEntry.then((off) => off());
      offMenu.then((off) => off());
    };
    // Nur einmal beim Start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hoehe des unteren Bereichs mit der Maus ziehen
  const startDockResize = (e: ReactMouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = dockHeight;
    let latest = startH;
    const move = (ev: MouseEvent) => {
      latest = Math.max(90, Math.min(window.innerHeight * 0.6, startH + (startY - ev.clientY)));
      setDockHeight(latest);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      save("mc-dock", String(Math.round(latest)));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Das Kontextmenue des Browsers gehoert nicht in eine Desktop-App; in Textfeldern und
  // markierbarem Text bleibt es, damit Kopieren und Einfuegen funktionieren.
  const onContextMenu = (e: ReactMouseEvent) => {
    const el = e.target as HTMLElement;
    if (!el.closest("input, textarea, .selectable")) e.preventDefault();
  };

  // ---------------------------------------------------------------- Ansicht: Geraete
  const devicesView = (
    <>
      <div className="toolbar">
        <h1>Geräte</h1>
        <button className="primary" disabled={!!busy} onClick={() => discover()} title="Im Netzwerk suchen (F5)">
          Geräte suchen
        </button>
        <button disabled={!!busy || devices.length === 0} onClick={refresh} title="Status neu abfragen (Ctrl+R)">
          Aktualisieren
        </button>
        <span className="sep" />
        <label className="inline">
          Gruppe
          <input
            type="text"
            maxLength={32}
            style={{ width: 150 }}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
        </label>
        <button disabled={!!busy || !master} onClick={doLink} title="Angekreuzte Geräte verlinken (Ctrl+L)">
          Verlinken
        </button>
        <button
          disabled={!!busy || !groupName.trim() || linked === 0}
          onClick={async () =>
            showSteps("Gruppenname", await run("Setze Gruppennamen ...", () => api.setGroupName(groupName.trim())))
          }
        >
          Namen setzen
        </button>
        <button disabled={!!busy || linked === 0} onClick={doUnlink} title="Alle Gruppen auflösen (Ctrl+Shift+L)">
          Links auflösen
        </button>
      </div>

      {mixedLocations && target && (
        <div className="infobar">
          <span className="infobar__text">
            Die Geräte liegen in {locations.length} MusicCast-Standorten. Die Yamaha-App zeigt jeweils nur einen.
          </span>
          <label className="inline">
            Ziel
            <select
              value={target.id}
              onChange={(e) => {
                setTargetLocation(e.target.value);
                setConfirmLocation(false);
              }}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}, {l.id.slice(0, 8)} ({l.devices.map((d) => d.name ?? d.ip).join(", ")})
                </option>
              ))}
            </select>
          </label>
          {confirmLocation ? (
            <>
              <button disabled={!!busy} onClick={doSetLocation}>
                {toMove.map((d) => d.name ?? d.ip).join(", ")} umhängen
              </button>
              <button onClick={() => setConfirmLocation(false)}>Abbrechen</button>
            </>
          ) : (
            <button disabled={!!busy || toMove.length === 0} onClick={() => setConfirmLocation(true)}>
              Geräte umhängen
            </button>
          )}
        </div>
      )}

      <div className="split">
        <div className="pane grow">
          {devices.length === 0 ? (
            <div className="empty">
              <p>Noch keine MusicCast-Geräte gefunden.</p>
              <p className="dim">F5 sucht im Netzwerk. Feste Adressen lassen sich in den Einstellungen eintragen.</p>
            </div>
          ) : (
            <table className="list">
              <thead>
                <tr>
                  <th className="narrow" title="Master der neuen Gruppe">
                    Master
                  </th>
                  <th className="narrow" title="Client der neuen Gruppe">
                    Client
                  </th>
                  <th>Name</th>
                  <th>Verbindung</th>
                  <th>Signal</th>
                  <th>Link</th>
                  <th>Standort</th>
                  <th>Adresse</th>
                  <th>Power</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => {
                  const wl = isWireless(d) || isExtended(d);
                  return (
                    <tr
                      key={d.ip}
                      className={selected === d.ip ? "is-selected" : ""}
                      onClick={() => {
                        setSelected(d.ip);
                        setConfirmWired(null);
                      }}
                    >
                      <td className="narrow">
                        <input
                          type="radio"
                          name="master"
                          aria-label={`${d.name ?? d.ip} als Master`}
                          disabled={!d.online}
                          checked={master === d.ip}
                          onChange={() => setMaster(d.ip)}
                        />
                      </td>
                      <td className="narrow">
                        <input
                          type="checkbox"
                          aria-label={`${d.name ?? d.ip} als Client`}
                          disabled={!d.online || master === d.ip}
                          checked={clients.has(d.ip) && master !== d.ip}
                          onChange={(e) => {
                            const next = new Set(clients);
                            if (e.target.checked) next.add(d.ip);
                            else next.delete(d.ip);
                            setClients(next);
                          }}
                        />
                      </td>
                      <td className="strong">{d.name ?? "Unbekannt"}</td>
                      {!d.online ? (
                        <td colSpan={5} className="bad">
                          Keine Antwort
                        </td>
                      ) : (
                        <>
                          <td>{connectionLabel(d)}</td>
                          <td>
                            {wl && (d.strength ?? 0) > 0 ? (
                              <span className="signal">
                                <Meter value={d.strength as number} />
                                <span className="num">{d.strength}</span>
                              </span>
                            ) : (
                              <span className="dim">{isWired(d) ? "kein Funk" : ""}</span>
                            )}
                          </td>
                          <td className={d.role && d.role !== "none" ? "" : "dim"}>{roleLabel(d)}</td>
                          <td className={mixedLocations ? "warn" : ""}>{d.locationName ?? ""}</td>
                        </>
                      )}
                      <td className="num">{d.ip}</td>
                      <td className={d.power === "on" ? "" : "dim"}>
                        {d.online ? (d.power === "on" ? "An" : "Standby") : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <aside className="pane inspector">
          {!current ? (
            <p className="dim pad">Ein Gerät in der Liste wählen, um Details und Aktionen zu sehen.</p>
          ) : (
            <>
              <div className="inspector__head">
                <div className="strong">{current.name ?? current.ip}</div>
                <div className="dim">{current.model ?? (current.online ? "" : "Keine Antwort")}</div>
              </div>
              <dl className="props selectable">
                <dt>Adresse</dt>
                <dd className="num">{current.ip}</dd>
                <dt>Verbindung</dt>
                <dd>{connectionLabel(current)}</dd>
                {isWireless(current) && (
                  <>
                    <dt>WLAN</dt>
                    <dd>{current.ssid ?? ""}</dd>
                    <dt>Kanal</dt>
                    <dd className="num">{current.channel ?? ""}</dd>
                  </>
                )}
                {(current.strength ?? 0) > 0 && (
                  <>
                    <dt>Signal</dt>
                    <dd className="num">{current.strength}</dd>
                  </>
                )}
                <dt>Firmware</dt>
                <dd className="num">{current.firmware ?? ""}</dd>
                <dt>Link</dt>
                <dd>
                  {roleLabel(current)}
                  {current.groupName ? `, ${current.groupName}` : ""}
                </dd>
                <dt>Standort</dt>
                <dd>
                  {current.locationName ?? ""}
                  {current.locationId ? <span className="dim num"> {current.locationId.slice(0, 8)}</span> : null}
                </dd>
                <dt>Eingang</dt>
                <dd>{current.input ?? ""}</dd>
              </dl>
              {current.online && (
                <div className="inspector__actions">
                  <button
                    disabled={!!busy}
                    onClick={async () => {
                      const step = await run("Schalte ...", () => api.setPower(current.ip, current.power !== "on"));
                      if (step) printSteps("Power", [step]);
                      window.setTimeout(refresh, 1200);
                    }}
                  >
                    {current.power === "on" ? "In Standby schalten" : "Einschalten"}
                  </button>
                  {isWireless(current) &&
                    (confirmWired === current.ip ? (
                      <>
                        <p className="note">
                          Nur mit eingestecktem LAN-Kabel. Das Gerät verlässt {current.ip} und bezieht per Kabel eine
                          neue Adresse. Schlägt das fehl, hilft nur ein Werksreset.
                        </p>
                        <button disabled={!!busy} onClick={() => doWired(current.ip)}>
                          Kabel steckt, umstellen
                        </button>
                        <button onClick={() => setConfirmWired(null)}>Abbrechen</button>
                      </>
                    ) : (
                      <button disabled={!!busy} onClick={() => setConfirmWired(current.ip)}>
                        Auf Kabel umstellen
                      </button>
                    ))}
                </div>
              )}
            </>
          )}
        </aside>
      </div>
    </>
  );

  // ---------------------------------------------------------------- Ansicht: WLAN
  const wlanView = (
    <>
      <div className="toolbar">
        <h1>WLAN</h1>
        <label className="inline">
          Adapter
          <select value={adapter} onChange={(e) => setAdapter(e.target.value)} style={{ maxWidth: 340 }}>
            <option value="">Alle Adapter</option>
            {adapters.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name} ({a.description}, {a.status})
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={!!busy} onClick={scan} title="Netze in Reichweite scannen (F6)">
          WLAN scannen
        </button>
      </div>
      <div className="split">
        <div className="pane grow pad">
          <h2>Belegung 2.4 GHz</h2>
          <p className="dim">
            {nets === null
              ? "Noch kein Scan. F6 scannt mit dem gewählten Adapter."
              : nets.length === 0
                ? "Der Scan ist leer. Adapter aktiviert? Windows 11 verlangt dafür den Standortzugriff (Einstellungen, Datenschutz, Standort)."
                : `${nets24.length} Netze. Störwert für Kanal 1, 6, 11: ${[1, 6, 11]
                    .map((c) => channelScore(nets24, c, own?.ssid ?? null))
                    .join(", ")}. Kleiner ist besser.`}
          </p>
          <div className="spectrum" aria-label="Belegung der Kanäle 1 bis 13">
            {loads.map((sum, i) => {
              const lit = Math.round((sum / maxLoad) * 12);
              const isOwn = own?.channel === i + 1;
              const isBest = best?.channel === i + 1;
              return (
                <div key={i} className={`spectrum__col${isOwn ? " is-own" : ""}${isBest ? " is-best" : ""}`}>
                  <span className="spectrum__value num">{sum || ""}</span>
                  <span className="spectrum__stack">
                    {Array.from({ length: 12 }, (_, s) => (
                      <i key={s} className={12 - s <= lit ? "on" : ""} />
                    ))}
                  </span>
                  <span className="spectrum__ch num">{i + 1}</span>
                </div>
              );
            })}
          </div>
          <p className="legend">
            <span className="legend__own">Dein Kanal</span>
            <span className="legend__best">Empfohlen{best ? `: Kanal ${best.channel}` : ""}</span>
            <span className="dim">Höhe: Summe der Signalstärken fremder Netze</span>
          </p>
        </div>
        <div className="pane networks">
          <table className="list selectable">
            <thead>
              <tr>
                <th className="narrow">Kanal</th>
                <th>Signal</th>
                <th>Netz</th>
              </tr>
            </thead>
            <tbody>
              {[...(nets ?? [])]
                .sort((a, b) => a.channel - b.channel || b.signal - a.signal)
                .map((n) => (
                  <tr key={n.bssid} title={n.bssid}>
                    <td className="narrow num">{n.channel}</td>
                    <td>
                      <span className="signal">
                        <Meter value={n.signal} />
                        <span className="num">{n.signal}</span>
                      </span>
                    </td>
                    <td className={own?.ssid && n.ssid === own.ssid ? "strong" : ""}>{n.ssid || "Verstecktes Netz"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  // ---------------------------------------------------------------- Ansicht: Monitoring
  const monitorView = (
    <>
      <div className="toolbar">
        <h1>Monitoring</h1>
        <label className="inline">
          Intervall in Sekunden
          <input
            type="number"
            min={5}
            max={600}
            style={{ width: 72 }}
            value={interval}
            disabled={monitor?.on}
            onChange={(e) => setIntervalSecs(Number(e.target.value) || 10)}
          />
        </label>
        <button className="primary" disabled={!!busy} onClick={toggleMonitor} title="Ctrl+M">
          {monitor?.on ? "Monitoring stoppen" : "Monitoring starten"}
        </button>
        <span className="sep" />
        <button disabled={log.length === 0} onClick={() => setLog([])}>
          Liste leeren
        </button>
        <span className="toolbar__fill" />
        <span className="dim selectable" title="Pfad in den Einstellungen ändern">
          {monitor?.logPath ?? ""}
        </span>
      </div>
      <div className="pane grow">
        {log.length === 0 ? (
          <div className="empty">
            <p>Noch keine Einträge.</p>
            <p className="dim">
              Das Monitoring notiert jede Änderung: offline, Rollenwechsel, Kanalwechsel. Abbrüche meldet Windows als
              Benachrichtigung. Solange es läuft, bleibt die App beim Schliessen im Infobereich aktiv.
            </p>
          </div>
        ) : (
          <table className="list selectable">
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Gerät</th>
                <th>Adresse</th>
                <th>Status</th>
                <th>Signal</th>
              </tr>
            </thead>
            <tbody>
              {[...log].reverse().map((e, i) => (
                <tr key={`${e.time}-${e.ip}-${i}`}>
                  <td className="num">{e.time}</td>
                  <td>{e.name}</td>
                  <td className="num">{e.ip}</td>
                  <td className={e.status === "OFFLINE" ? "bad" : ""}>{e.status}</td>
                  <td className="num">{e.signal ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );

  // ---------------------------------------------------------------- Ansicht: Einstellungen
  const settingsView = (
    <>
      <div className="toolbar">
        <h1>Einstellungen</h1>
      </div>
      <div className="pane grow pad settings">
        <h2>Darstellung</h2>
        <div className="form">
          <span className="form__label" id="theme-label">
            Farbschema
          </span>
          <div className="form__field">
            <div className="segmented" role="group" aria-labelledby="theme-label">
              {THEMES.map((t) => (
                <button key={t.id} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <h2>Geräteliste</h2>
        <div className="form">
          <label htmlFor="ips">Feste Adressen</label>
          <div className="form__field">
            <input
              id="ips"
              type="text"
              placeholder="192.168.1.101, 192.168.1.115"
              value={ipsText}
              onChange={(e) => setIpsText(e.target.value)}
            />
            <button
              disabled={!!busy || !ipsText.trim()}
              onClick={() => {
                setView("devices");
                void discover(ipsText.split(/[,;\s]+/).filter(Boolean));
              }}
            >
              Adressen verwenden
            </button>
            <p className="dim">Ersetzt die automatische Suche, bis du wieder mit F5 suchst.</p>
          </div>
        </div>

        <h2>Monitoring-Protokoll</h2>
        <div className="form">
          <label htmlFor="csv">CSV-Datei</label>
          <div className="form__field">
            <input
              id="csv"
              type="text"
              placeholder="C:\Logs\musiccast.csv"
              value={logPathText}
              onChange={(e) => setLogPathText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void applyLogPath(logPathText);
              }}
            />
            <button
              disabled={!!busy || !logPathText.trim() || logPathText.trim() === monitor?.logPath}
              onClick={() => applyLogPath(logPathText)}
            >
              Pfad übernehmen
            </button>
            <button disabled={!!busy || !monitor?.customLogPath} onClick={() => applyLogPath("")}>
              Desktop verwenden
            </button>
            <p className="dim">
              Absoluter Pfad zu einer Datei oder einem Ordner. Ohne Angabe liegt die Datei auf dem Desktop.
            </p>
          </div>
        </div>

        <h2>Router</h2>
        <p className="measure">
          Die App ändert am Router nichts. Diese Werte im Portal deines Routers setzen:
        </p>
        <ul className="checklist">
          <li>
            2.4-GHz-Kanal fest auf <b>{best ? best.channel : "(erst WLAN scannen)"}</b>, Bandbreite 20 MHz
          </li>
          <li>Verschlüsselung WPA2</li>
          <li>WLAN-Ruhezeiten aus</li>
          <li>
            <label>
              <input
                type="checkbox"
                checked={staticDone}
                onChange={(e) => {
                  setStaticDone(e.target.checked);
                  save("mc-static", e.target.checked ? "1" : "0");
                }}
              />
              Statische IP pro MusicCast-Gerät ist eingerichtet
            </label>
          </li>
        </ul>
        <div className="form__field">
          <button
            onClick={async () => {
              // Adresse beim Klick neu bestimmen, falls das Netzwerk gewechselt hat
              const url = await api.routerUrl().catch((e) => {
                notify(`Fehler: ${String(e)}`);
                return "";
              });
              if (!url) return;
              openUrl(url).catch((e) => notify(String(e)));
            }}
          >
            Router-Portal öffnen
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="app" onContextMenu={onContextMenu}>
      <nav className="sidebar" aria-label="Bereiche">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`nav-item${view === v.id ? " is-active" : ""}`}
            aria-current={view === v.id ? "page" : undefined}
            title={v.key}
            onClick={() => setView(v.id)}
          >
            <Icon name={v.id} />
            <span>{v.label}</span>
            {v.id === "devices" && devices.length > 0 && <span className="count num">{devices.length}</span>}
            {v.id === "monitor" && monitor?.on && <span className="live" title="Monitoring läuft" />}
          </button>
        ))}
      </nav>

      <div className="main">
        <div className="view">
          {view === "devices" && devicesView}
          {view === "wlan" && wlanView}
          {view === "monitor" && monitorView}
          {view === "settings" && settingsView}
        </div>

        <div className="dock" style={dockOpen ? { height: dockHeight } : undefined}>
          {dockOpen && <div className="dock__resize" onMouseDown={startDockResize} />}
          <div className="dock__tabs" role="tablist">
            <button
              role="tab"
              aria-selected={dockOpen && dockTab === "hints"}
              className={dockOpen && dockTab === "hints" ? "is-active" : ""}
              onClick={() => {
                setDockTab("hints");
                setDockOpen(true);
              }}
            >
              Hinweise{issues > 0 ? ` (${issues})` : ""}
            </button>
            <button
              role="tab"
              aria-selected={dockOpen && dockTab === "console"}
              className={dockOpen && dockTab === "console" ? "is-active" : ""}
              onClick={() => {
                setDockTab("console");
                setDockOpen(true);
              }}
            >
              Konsole
            </button>
            <span className="toolbar__fill" />
            {dockOpen && dockTab === "console" && (
              <button disabled={consoleLines.length === 0} onClick={() => setConsoleLines([])}>
                Leeren
              </button>
            )}
            <button onClick={() => setDockOpen((open) => !open)} title="Ctrl+J">
              {dockOpen ? "Einklappen" : "Ausklappen"}
            </button>
          </div>
          {dockOpen && dockTab === "hints" && (
            <ul className="hints selectable">
              {recs.map((r, i) => (
                <li key={i}>
                  <span className={`hints__level ${r.level}`}>{LEVEL_LABEL[r.level]}</span>
                  <span>{r.text}</span>
                </li>
              ))}
            </ul>
          )}
          {dockOpen && dockTab === "console" && (
            <div className="console selectable" ref={consoleRef}>
              {consoleLines.length === 0 ? (
                <span className="dim">Hier erscheint jeder Befehl an die Geräte mit seinem Antwortcode.</span>
              ) : (
                consoleLines.map((l) => (
                  <div key={l.id} className={l.level === "info" ? "" : l.level}>
                    <span className="dim">{l.time}</span> {l.text}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <footer className="statusbar">
        <span className={busy ? "statusbar__busy" : ""} role="status">
          {busy || "Bereit"}
        </span>
        <span className="toolbar__fill" />
        <span>
          {devices.length} {devices.length === 1 ? "Gerät" : "Geräte"}
        </span>
        <span>{linked > 0 ? `${linked} verlinkt` : "kein Link"}</span>
        {mixedLocations && <span className="warn">{locations.length} Standorte</span>}
        <span>{monitor?.on ? `Monitoring alle ${monitor.interval} s` : "Monitoring aus"}</span>
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

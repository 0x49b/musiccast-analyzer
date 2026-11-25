import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "./api";
import { LANGS, codeText, isLang, messages } from "./i18n";
import type { Lang, Messages } from "./i18n";
import {
  WEAK_SIGNAL,
  bestChannel,
  channelLoad,
  channelScore,
  defaultLocation,
  isExtended,
  isWired,
  isWireless,
  locationsOf,
  ownNetwork,
  recommendations,
} from "./logic";
import type { Adapter, Device, MonitorEntry, MonitorStatus, Net, Step, UpdateStatus } from "./types";

type Theme = "system" | "light" | "dark";
const THEMES: Theme[] = ["system", "light", "dark"];

type View = "devices" | "wlan" | "monitor" | "settings";
type DockTab = "hints" | "console";

const VIEWS: { id: View; key: string }[] = [
  { id: "devices", key: "Ctrl+1" },
  { id: "wlan", key: "Ctrl+2" },
  { id: "monitor", key: "Ctrl+3" },
  { id: "settings", key: "Ctrl+4" },
];

interface ConsoleLine {
  id: number;
  time: string;
  level: "ok" | "bad" | "info";
  text: string;
}
let consoleSeq = 0;

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
    /* storage unavailable: the setting only lasts for this session */
  }
}

/** Sidebar icons, 16px, one stroke width. */
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
    <svg
      className="icon"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/** Level meter in ten segments, like on an amplifier. */
function Meter({ value, label, max = 100 }: { value: number; label: string; max?: number }) {
  const lit = Math.max(0, Math.min(10, Math.round((value / max) * 10)));
  const tone = value < WEAK_SIGNAL ? "bad" : value < 60 ? "warn" : "ok";
  return (
    <span className={`meter ${tone}`} role="img" aria-label={label}>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={i < lit ? "on" : ""} />
      ))}
    </span>
  );
}

/** Short text for the status bar; empty when there is nothing to report. */
function updateText(t: Messages, u: UpdateStatus | null): string {
  if (!u) return "";
  switch (u.phase) {
    case "checking":
      return t.update.checking;
    case "downloading":
      return t.update.downloading(u.version ?? "", u.percent);
    case "installing":
      return t.update.installing(u.version ?? "");
    case "error":
      return t.update.failed;
    default:
      return "";
  }
}

function connectionLabel(t: Messages, d: Device): string {
  if (isWired(d)) return t.connection.wired;
  if (isExtended(d)) return t.connection.extended;
  if (isWireless(d)) return t.connection.wifi;
  return d.connection ?? "";
}
function roleLabel(t: Messages, d: Device): string {
  return d.role === "server" ? t.role.master : d.role === "client" ? t.role.client : t.role.none;
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
  // English is the default; the last choice is restored after a restart
  const [lang, setLang] = useState<Lang>(() => {
    const stored = load("mc-lang", "en");
    return isLang(stored) ? stored : "en";
  });
  const t = messages[lang];
  // Callbacks read the current language through this ref, so they need not be recreated
  const tRef = useRef(t);
  tRef.current = t;

  // Apply the colour scheme: the UI through data-theme, title bar and menu through the window
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    save("mc-theme", theme);
    try {
      void getCurrentWindow()
        .setTheme(theme === "system" ? null : theme)
        .catch(() => undefined);
    } catch {
      /* outside of Tauri there is no window object */
    }
  }, [theme]);

  // Apply the language: persist it and hand it to the Rust side, which translates the
  // native menus, notifications and error messages
  useEffect(() => {
    document.documentElement.lang = lang;
    save("mc-lang", lang);
    api.setLanguage(lang).catch(() => undefined);
  }, [lang]);

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
  const [update, setUpdate] = useState<UpdateStatus | null>(null);

  /** Appends lines to the console (the latest 500 are kept). */
  const print = useCallback((level: ConsoleLine["level"], ...texts: string[]) => {
    const time = new Date().toLocaleTimeString(tRef.current.locale, { hour12: false });
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

  /** Runs an action with a status-bar message; errors go to the console and a toast. */
  const run = useCallback(
    async <T,>(text: string, action: () => Promise<T>): Promise<T | undefined> => {
      setBusy(text);
      try {
        return await action();
      } catch (e) {
        notify(tRef.current.error(String(e)));
        print("bad", tRef.current.console.failed(text, String(e)));
        return undefined;
      } finally {
        setBusy("");
      }
    },
    [notify, print],
  );

  /** Writes the individual steps of an action with their response codes to the console. */
  const printSteps = useCallback(
    (action: string, result: Step[]) => {
      const tr = tRef.current;
      if (result.length === 0) {
        print("info", tr.console.nothingToDo(action));
        return;
      }
      const bad = result.filter((s) => !s.ok).length;
      print(bad ? "bad" : "info", tr.console.summary(action, result.length, bad));
      for (const s of result) {
        print(s.ok ? "ok" : "bad", tr.console.stepLine(s.ok, s.step, codeText(tr, s.code)));
      }
      // Failed steps bring the console to the front
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
      const list = await run(tRef.current.busy.discover, () => api.discover(ips));
      if (!list) return;
      applyDevices(list);
      const tr = tRef.current;
      print(
        "info",
        tr.console.discovery(list.length),
        ...list.map((d) =>
          d.online
            ? tr.console.deviceLine(
                d.ip,
                d.name ?? "?",
                d.model ?? "?",
                d.connection ?? "?",
                d.locationName ?? "?",
                d.locationId ?? "",
              )
            : tr.console.offlineLine(d.ip),
        ),
      );
    },
    [run, applyDevices, print],
  );

  const refresh = useCallback(async () => {
    const list = await run(tRef.current.busy.refresh, () => api.getDevices());
    if (list) applyDevices(list);
  }, [run, applyDevices]);

  const scan = useCallback(async () => {
    save("mc-adapter", adapter);
    const list = await run(tRef.current.busy.scan, () => api.scanWlan(adapter));
    if (!list) return;
    setNets(list);
    const tr = tRef.current;
    print("info", tr.console.scan(adapter || tr.console.allAdapters, list.length));
  }, [run, adapter, print]);

  const recs = useMemo(() => recommendations(t, devices, nets, staticDone), [t, devices, nets, staticDone]);
  const own = useMemo(() => ownNetwork(devices), [devices]);
  const nets24 = useMemo(() => (nets ?? []).filter((n) => n.channel >= 1 && n.channel <= 14), [nets]);
  const best = useMemo(() => (nets ? bestChannel(nets, own?.ssid ?? null) : null), [nets, own]);
  const loads = useMemo(() => channelLoad(nets24, own?.ssid ?? null), [nets24, own]);
  const maxLoad = Math.max(1, ...loads);
  const locations = useMemo(() => locationsOf(devices), [devices]);
  const mixedLocations = locations.length > 1;
  // Without a selection the target is "Home" (or the largest location if there is no "Home")
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
      notify(t.notify.chooseMasterClient);
      return;
    }
    showSteps(t.action.link, await run(t.busy.link, () => api.link(master, list, groupName.trim())));
  };

  const doUnlink = async () => {
    showSteps(t.action.unlink, await run(t.busy.unlink, () => api.unlink()));
  };

  const doWired = async (ip: string) => {
    setConfirmWired(null);
    const step = await run(t.busy.wired, () => api.switchToWired(ip));
    if (!step) return;
    printSteps(t.action.wired, [step]);
    if (step.ok) notify(t.notify.wiredDone);
  };

  const doSetLocation = async () => {
    setConfirmLocation(false);
    if (!target || toMove.length === 0) return;
    // Devices in a link group guard this setting (code 5): dissolve the group first
    if (devices.some((d) => d.role === "server" || d.role === "client")) {
      const unlinked = await run(t.busy.unlink, () => api.unlink());
      if (!unlinked) return;
      printSteps(t.action.unlinkBeforeLocation, unlinked);
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
    }
    showSteps(
      t.action.location(target.name),
      await run(t.busy.location, () =>
        api.setLocation(
          toMove.map((d) => d.ip),
          target.id,
          target.name,
        ),
      ),
    );
  };

  const toggleMonitor = async () => {
    const next = await run(t.busy.monitor, () => (monitor?.on ? api.monitorStop() : api.monitorStart(interval)));
    if (!next) return;
    setMonitor(next);
    print("info", next.on ? t.console.monitorStarted(next.interval) : t.console.monitorStopped);
  };

  const applyLogPath = async (path: string) => {
    const next = await run(t.busy.csv, () => api.monitorSetLogPath(path));
    if (!next) return;
    setMonitor(next);
    setLogPathText(next.logPath ?? "");
    save("mc-logpath", next.customLogPath ? (next.logPath ?? "") : "");
    print("info", t.console.csvPath(next.logPath ?? "?"));
  };

  // Commands from the native menu (and its keyboard shortcuts) are dispatched through this
  // table. The ref always holds the functions of the current render.
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

  // Startup: load adapters and the monitoring state, find devices, listen for events
  useEffect(() => {
    api
      .getAdapters()
      .then((list) => {
        setAdapters(list);
        const stored = load("mc-adapter", "");
        const usb = list.find((a) => /8812|USB/i.test(a.description));
        setAdapter(list.some((a) => a.name === stored) ? stored : (usb?.name ?? ""));
      })
      .catch((e) => notify(tRef.current.notify.adaptersFailed(String(e))));

    // Restore the stored CSV path; if it has become invalid, the default applies
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

    // Update state: fetch it once (the check starts before the UI has loaded), then listen
    const onUpdate = (u: UpdateStatus | null) => {
      if (!u) return;
      setUpdate(u);
      const tr = tRef.current;
      if (u.phase === "downloading" && u.percent === 0) print("info", tr.console.updateFound(u.version ?? ""));
      if (u.phase === "installing") print("info", tr.console.updateInstalling(u.version ?? ""));
      if (u.phase === "current") print("info", tr.console.updateCurrent);
      if (u.phase === "error") print("bad", tr.console.updateFailed(u.message ?? tr.console.unknownError));
    };
    api
      .updateStatus()
      .then(onUpdate)
      .catch(() => undefined);
    const offUpdate = listen<UpdateStatus>("update-status", (event) => onUpdate(event.payload));

    return () => {
      offEntry.then((off) => off());
      offMenu.then((off) => off());
      offUpdate.then((off) => off());
    };
    // Runs once at startup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag the height of the bottom panel with the mouse
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

  // The browser's context menu has no place in a desktop app; it stays available in text
  // fields and selectable text so that copy and paste keep working.
  const onContextMenu = (e: ReactMouseEvent) => {
    const el = e.target as HTMLElement;
    if (!el.closest("input, textarea, .selectable")) e.preventDefault();
  };

  const nameOf = (d: Device) => d.name ?? d.ip;

  // ---------------------------------------------------------------- View: devices
  const devicesView = (
    <>
      <div className="toolbar">
        <h1>{t.devices.title}</h1>
        <button className="primary" disabled={!!busy} onClick={() => discover()} title={t.devices.findTitle}>
          {t.devices.find}
        </button>
        <button disabled={!!busy || devices.length === 0} onClick={refresh} title={t.devices.refreshTitle}>
          {t.devices.refresh}
        </button>
        <span className="sep" />
        <label className="inline">
          {t.devices.group}
          <input
            type="text"
            maxLength={32}
            style={{ width: 150 }}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
        </label>
        <button disabled={!!busy || !master} onClick={doLink} title={t.devices.linkTitle}>
          {t.devices.link}
        </button>
        <button
          disabled={!!busy || !groupName.trim() || linked === 0}
          onClick={async () =>
            showSteps(t.action.groupName, await run(t.busy.groupName, () => api.setGroupName(groupName.trim())))
          }
        >
          {t.devices.setName}
        </button>
        <button disabled={!!busy || linked === 0} onClick={doUnlink} title={t.devices.unlinkTitle}>
          {t.devices.unlink}
        </button>
      </div>

      {mixedLocations && target && (
        <div className="infobar">
          <span className="infobar__text">{t.devices.locationsInfo(locations.length)}</span>
          <label className="inline">
            {t.devices.target}
            <select
              value={target.id}
              onChange={(e) => {
                setTargetLocation(e.target.value);
                setConfirmLocation(false);
              }}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}, {l.id.slice(0, 8)} ({l.devices.map(nameOf).join(", ")})
                </option>
              ))}
            </select>
          </label>
          {confirmLocation ? (
            <>
              <button disabled={!!busy} onClick={doSetLocation}>
                {t.devices.moveNamed(toMove.map(nameOf).join(", "))}
              </button>
              <button onClick={() => setConfirmLocation(false)}>{t.cancel}</button>
            </>
          ) : (
            <button disabled={!!busy || toMove.length === 0} onClick={() => setConfirmLocation(true)}>
              {t.devices.move}
            </button>
          )}
        </div>
      )}

      <div className="split">
        <div className="pane grow">
          {devices.length === 0 ? (
            <div className="empty">
              <p>{t.devices.empty}</p>
              <p className="dim">{t.devices.emptyHint}</p>
            </div>
          ) : (
            <table className="list">
              <thead>
                <tr>
                  <th className="narrow" title={t.devices.col.masterTitle}>
                    {t.devices.col.master}
                  </th>
                  <th className="narrow" title={t.devices.col.clientTitle}>
                    {t.devices.col.client}
                  </th>
                  <th>{t.devices.col.name}</th>
                  <th>{t.devices.col.connection}</th>
                  <th>{t.devices.col.signal}</th>
                  <th>{t.devices.col.link}</th>
                  <th>{t.devices.col.location}</th>
                  <th>{t.devices.col.address}</th>
                  <th>{t.devices.col.power}</th>
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
                          aria-label={t.devices.asMaster(nameOf(d))}
                          disabled={!d.online}
                          checked={master === d.ip}
                          onChange={() => setMaster(d.ip)}
                        />
                      </td>
                      <td className="narrow">
                        <input
                          type="checkbox"
                          aria-label={t.devices.asClient(nameOf(d))}
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
                      <td className="strong">{d.name ?? t.devices.unknown}</td>
                      {!d.online ? (
                        <td colSpan={4} className="bad">
                          {t.devices.noAnswer}
                        </td>
                      ) : (
                        <>
                          <td>{connectionLabel(t, d)}</td>
                          <td>
                            {wl && (d.strength ?? 0) > 0 ? (
                              <span className="signal">
                                <Meter value={d.strength as number} label={t.signalAria(d.strength as number)} />
                                <span className="num">{d.strength}</span>
                              </span>
                            ) : (
                              <span className="dim">{isWired(d) ? t.devices.noRadio : ""}</span>
                            )}
                          </td>
                          <td className={d.role && d.role !== "none" ? "" : "dim"}>{roleLabel(t, d)}</td>
                          <td className={mixedLocations ? "warn" : ""}>{d.locationName ?? ""}</td>
                        </>
                      )}
                      <td className="num">{d.ip}</td>
                      <td className={d.power === "on" ? "" : "dim"}>
                        {d.online ? (d.power === "on" ? t.devices.on : t.devices.standby) : ""}
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
            <p className="dim pad">{t.inspector.hint}</p>
          ) : (
            <>
              <div className="inspector__head">
                <div className="strong">{nameOf(current)}</div>
                <div className="dim">{current.model ?? (current.online ? "" : t.devices.noAnswer)}</div>
              </div>
              <dl className="props selectable">
                <dt>{t.inspector.address}</dt>
                <dd className="num">{current.ip}</dd>
                <dt>{t.inspector.connection}</dt>
                <dd>{connectionLabel(t, current)}</dd>
                {isWireless(current) && (
                  <>
                    <dt>{t.inspector.wifi}</dt>
                    <dd>{current.ssid ?? ""}</dd>
                    <dt>{t.inspector.channel}</dt>
                    <dd className="num">{current.channel ?? ""}</dd>
                  </>
                )}
                {(current.strength ?? 0) > 0 && (
                  <>
                    <dt>{t.inspector.signal}</dt>
                    <dd className="num">{current.strength}</dd>
                  </>
                )}
                <dt>{t.inspector.firmware}</dt>
                <dd className="num">{current.firmware ?? ""}</dd>
                <dt>{t.inspector.link}</dt>
                <dd>
                  {roleLabel(t, current)}
                  {current.groupName ? `, ${current.groupName}` : ""}
                </dd>
                <dt>{t.inspector.location}</dt>
                <dd>
                  {current.locationName ?? ""}
                  {current.locationId ? <span className="dim num"> {current.locationId.slice(0, 8)}</span> : null}
                </dd>
                <dt>{t.inspector.input}</dt>
                <dd>{current.input ?? ""}</dd>
              </dl>
              {current.online && (
                <div className="inspector__actions">
                  <button
                    disabled={!!busy}
                    onClick={async () => {
                      const step = await run(t.busy.power, () => api.setPower(current.ip, current.power !== "on"));
                      if (step) printSteps(t.action.power, [step]);
                      window.setTimeout(refresh, 1200);
                    }}
                  >
                    {current.power === "on" ? t.inspector.toStandby : t.inspector.powerOn}
                  </button>
                  {isWireless(current) &&
                    (confirmWired === current.ip ? (
                      <>
                        <p className="note">{t.inspector.wiredNote(current.ip)}</p>
                        <button disabled={!!busy} onClick={() => doWired(current.ip)}>
                          {t.inspector.wiredConfirm}
                        </button>
                        <button onClick={() => setConfirmWired(null)}>{t.cancel}</button>
                      </>
                    ) : (
                      <button disabled={!!busy} onClick={() => setConfirmWired(current.ip)}>
                        {t.inspector.toWired}
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

  // ---------------------------------------------------------------- View: Wi-Fi
  const wlanView = (
    <>
      <div className="toolbar">
        <h1>{t.wlan.title}</h1>
        <label className="inline">
          {t.wlan.adapter}
          <select value={adapter} onChange={(e) => setAdapter(e.target.value)} style={{ maxWidth: 340 }}>
            <option value="">{t.wlan.allAdapters}</option>
            {adapters.map((a) => (
              <option key={a.name} value={a.name}>
                {a.name} ({a.description}, {a.status})
              </option>
            ))}
          </select>
        </label>
        <button className="primary" disabled={!!busy} onClick={scan} title={t.wlan.scanTitle}>
          {t.wlan.scan}
        </button>
      </div>
      <div className="split">
        <div className="pane grow pad">
          <h2>{t.wlan.usage}</h2>
          <p className="dim">
            {nets === null
              ? t.wlan.noScan
              : nets.length === 0
                ? t.wlan.emptyScan
                : t.wlan.summary(
                    nets24.length,
                    [1, 6, 11].map((c) => channelScore(nets24, c, own?.ssid ?? null)).join(", "),
                  )}
          </p>
          <div className="spectrum" aria-label={t.wlan.spectrumAria}>
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
            <span className="legend__own">{t.wlan.yourChannel}</span>
            <span className="legend__best">{t.wlan.recommended(best ? best.channel : null)}</span>
            <span className="dim">{t.wlan.heightLegend}</span>
          </p>
        </div>
        <div className="pane networks">
          <table className="list selectable">
            <thead>
              <tr>
                <th className="narrow">{t.wlan.col.channel}</th>
                <th>{t.wlan.col.signal}</th>
                <th>{t.wlan.col.network}</th>
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
                        <Meter value={n.signal} label={t.signalAria(n.signal)} />
                        <span className="num">{n.signal}</span>
                      </span>
                    </td>
                    <td className={own?.ssid && n.ssid === own.ssid ? "strong" : ""}>{n.ssid || t.wlan.hidden}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  // ---------------------------------------------------------------- View: monitoring
  const monitorView = (
    <>
      <div className="toolbar">
        <h1>{t.monitor.title}</h1>
        <label className="inline">
          {t.monitor.interval}
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
          {monitor?.on ? t.monitor.stop : t.monitor.start}
        </button>
        <span className="sep" />
        <button disabled={log.length === 0} onClick={() => setLog([])}>
          {t.monitor.clear}
        </button>
        <span className="toolbar__fill" />
        <span className="dim selectable" title={t.monitor.pathTitle}>
          {monitor?.logPath ?? ""}
        </span>
      </div>
      <div className="pane grow">
        {log.length === 0 ? (
          <div className="empty">
            <p>{t.monitor.empty}</p>
            <p className="dim">{t.monitor.emptyHint}</p>
          </div>
        ) : (
          <table className="list selectable">
            <thead>
              <tr>
                <th>{t.monitor.col.time}</th>
                <th>{t.monitor.col.device}</th>
                <th>{t.monitor.col.address}</th>
                <th>{t.monitor.col.status}</th>
                <th>{t.monitor.col.signal}</th>
              </tr>
            </thead>
            <tbody>
              {[...log].reverse().map((e, i) => (
                <tr key={`${e.time}-${e.ip}-${i}`}>
                  <td className="num">{e.time}</td>
                  <td>{e.name}</td>
                  <td className="num">{e.ip}</td>
                  <td className={e.online === false ? "bad" : ""}>{e.status}</td>
                  <td className="num">{e.signal ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );

  // ---------------------------------------------------------------- View: settings
  const settingsView = (
    <>
      <div className="toolbar">
        <h1>{t.settings.title}</h1>
      </div>
      <div className="pane grow pad settings">
        <h2>{t.settings.appearance}</h2>
        <div className="form">
          <span className="form__label" id="theme-label">
            {t.settings.theme}
          </span>
          <div className="form__field">
            <div className="segmented" role="group" aria-labelledby="theme-label">
              {THEMES.map((id) => (
                <button key={id} aria-pressed={theme === id} onClick={() => setTheme(id)}>
                  {t.settings.themes[id]}
                </button>
              ))}
            </div>
          </div>
          <span className="form__label" id="language-label">
            {t.settings.language}
          </span>
          <div className="form__field">
            <div className="segmented" role="group" aria-labelledby="language-label">
              {LANGS.map((l) => (
                <button key={l.id} aria-pressed={lang === l.id} lang={l.id} onClick={() => setLang(l.id)}>
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <h2>{t.settings.deviceList}</h2>
        <div className="form">
          <label htmlFor="ips">{t.settings.fixedAddresses}</label>
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
              {t.settings.useAddresses}
            </button>
            <p className="dim">{t.settings.fixedHint}</p>
          </div>
        </div>

        <h2>{t.settings.monitorLog}</h2>
        <div className="form">
          <label htmlFor="csv">{t.settings.csvFile}</label>
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
              {t.settings.applyPath}
            </button>
            <button disabled={!!busy || !monitor?.customLogPath} onClick={() => applyLogPath("")}>
              {t.settings.useDesktop}
            </button>
            <p className="dim">{t.settings.csvHint}</p>
          </div>
        </div>

        <h2>{t.settings.router}</h2>
        <p className="measure">{t.settings.routerIntro}</p>
        <ul className="checklist">
          <li>
            {t.settings.channelBefore} <b>{best ? best.channel : t.settings.scanFirst}</b>
            {t.settings.channelAfter}
          </li>
          <li>{t.settings.wpa2}</li>
          <li>{t.settings.quietHours}</li>
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
              {t.settings.staticIp}
            </label>
          </li>
        </ul>
        <div className="form__field">
          <button
            onClick={async () => {
              // Determine the address on every click in case the network has changed
              const url = await api.routerUrl().catch((e) => {
                notify(t.error(String(e)));
                return "";
              });
              if (!url) return;
              openUrl(url).catch((e) => notify(String(e)));
            }}
          >
            {t.settings.openPortal}
          </button>
        </div>
      </div>
    </>
  );

  const updateLabel = updateText(t, update);

  return (
    <div className="app" onContextMenu={onContextMenu}>
      <nav className="sidebar" aria-label={t.nav.aria}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`nav-item${view === v.id ? " is-active" : ""}`}
            aria-current={view === v.id ? "page" : undefined}
            title={v.key}
            onClick={() => setView(v.id)}
          >
            <Icon name={v.id} />
            <span>{t.nav[v.id]}</span>
            {v.id === "devices" && devices.length > 0 && <span className="count num">{devices.length}</span>}
            {v.id === "monitor" && monitor?.on && <span className="live" title={t.nav.monitoringRunning} />}
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
              {t.dock.hints}
              {issues > 0 ? ` (${issues})` : ""}
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
              {t.dock.console}
            </button>
            <span className="toolbar__fill" />
            {dockOpen && dockTab === "console" && (
              <button disabled={consoleLines.length === 0} onClick={() => setConsoleLines([])}>
                {t.dock.clear}
              </button>
            )}
            <button onClick={() => setDockOpen((open) => !open)} title="Ctrl+J">
              {dockOpen ? t.dock.collapse : t.dock.expand}
            </button>
          </div>
          {dockOpen && dockTab === "hints" && (
            <ul className="hints selectable">
              {recs.map((r, i) => (
                <li key={i}>
                  <span className={`hints__level ${r.level}`}>{t.level[r.level]}</span>
                  <span>{r.text}</span>
                </li>
              ))}
            </ul>
          )}
          {dockOpen && dockTab === "console" && (
            <div className="console selectable" ref={consoleRef}>
              {consoleLines.length === 0 ? (
                <span className="dim">{t.console.empty}</span>
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
          {busy || t.ready}
        </span>
        <span className="toolbar__fill" />
        {updateLabel && <span className={update?.phase === "error" ? "warn" : ""}>{updateLabel}</span>}
        <span>{t.statusbar.devices(devices.length)}</span>
        <span>{linked > 0 ? t.statusbar.linked(linked) : t.statusbar.noLink}</span>
        {mixedLocations && <span className="warn">{t.statusbar.locations(locations.length)}</span>}
        <span>{monitor?.on ? t.statusbar.monitorOn(monitor.interval) : t.statusbar.monitorOff}</span>
      </footer>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

import { invoke } from "@tauri-apps/api/core";
import type { Adapter, Device, MonitorStatus, Net, Step, UpdateStatus } from "./types";

// Parameternamen muessen zu den Rust-Commands in src-tauri/src/lib.rs passen
export const api = {
  getAdapters: () => invoke<Adapter[]>("get_adapters"),
  discover: (ips?: string[]) => invoke<Device[]>("discover", { ips: ips ?? null }),
  getDevices: () => invoke<Device[]>("get_devices"),
  scanWlan: (adapter: string) => invoke<Net[]>("scan_wlan", { adapter: adapter || null }),
  link: (master: string, clients: string[], name: string) =>
    invoke<Step[]>("link", { master, clients, name: name || null }),
  unlink: () => invoke<Step[]>("unlink"),
  setGroupName: (name: string) => invoke<Step[]>("set_group_name", { name }),
  setPower: (ip: string, on: boolean) => invoke<Step>("set_power", { ip, on }),
  switchToWired: (ip: string) => invoke<Step>("switch_to_wired", { ip }),
  setLocation: (ips: string[], id: string, name: string) =>
    invoke<Step[]>("set_location", { ips, id, name }),
  updateStatus: () => invoke<UpdateStatus | null>("update_status"),
  /** Adresse x.x.x.1 im Netz, mit dem dieser PC verbunden ist. */
  routerUrl: () => invoke<string>("router_url"),
  monitorStatus: () => invoke<MonitorStatus>("monitor_status"),
  monitorStart: (interval: number) => invoke<MonitorStatus>("monitor_start", { interval }),
  monitorStop: () => invoke<MonitorStatus>("monitor_stop"),
  /** Leerer Pfad stellt den Standard (Desktop) wieder her. */
  monitorSetLogPath: (path: string) =>
    invoke<MonitorStatus>("monitor_set_log_path", { path: path.trim() || null }),
};

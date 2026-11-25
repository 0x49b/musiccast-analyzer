export interface Adapter {
  name: string;
  description: string;
  status: string;
}

export interface Device {
  ip: string;
  online: boolean;
  name: string | null;
  model: string | null;
  firmware: string | null;
  connection: string | null;
  ssid: string | null;
  channel: number | null;
  strength: number | null;
  security: string | null;
  dhcp: boolean | null;
  role: string | null;
  groupId: string | null;
  groupName: string | null;
  clients: string[];
  power: string | null;
  input: string | null;
  locationId: string | null;
  locationName: string | null;
}

export interface Net {
  ssid: string;
  bssid: string;
  signal: number;
  channel: number;
}

export interface Step {
  step: string;
  code: number | null;
  ok: boolean;
}

export interface MonitorEntry {
  time: string;
  ip: string;
  name: string;
  status: string;
  signal: number | null;
}

export interface MonitorStatus {
  on: boolean;
  interval: number;
  logPath: string | null;
  defaultLogPath: string | null;
  customLogPath: boolean;
  log: MonitorEntry[];
}

export interface UpdateStatus {
  phase: "checking" | "current" | "downloading" | "installing" | "error";
  version: string | null;
  percent: number | null;
  message: string | null;
}

export type RecLevel = "bad" | "warn" | "info" | "ok";

export interface Recommendation {
  level: RecLevel;
  text: string;
}

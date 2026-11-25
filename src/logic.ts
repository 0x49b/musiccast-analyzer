import type { Messages } from "./i18n";
import type { Device, Net, Recommendation } from "./types";

export const isWireless = (d: Device) => /wireless/.test(d.connection ?? "");
export const isWired = (d: Device) => /wired/.test(d.connection ?? "");
/** Extended mode: the device hangs off another device's MusicCast network (extend_1, extend_2 ...). */
export const isExtended = (d: Device) => /extend/.test(d.connection ?? "");
export const label = (d: Device) => d.name || d.ip;

/** Threshold for a "weak signal". The scale of the Yamaha API is not documented. */
export const WEAK_SIGNAL = 40;

export function ownNetwork(devices: Device[]): { ssid: string | null; channel: number } | null {
  const d = devices.find((x) => x.online && isWireless(x) && (x.channel ?? 0) > 0);
  return d ? { ssid: d.ssid, channel: d.channel as number } : null;
}

/** Interference from other networks in the overlap range (+/- 4 channels), weighted by signal and distance. */
export function channelScore(nets: Net[], channel: number, ownSsid: string | null): number {
  let score = 0;
  for (const n of nets) {
    if (n.channel < 1 || n.channel > 14) continue;
    if (ownSsid && n.ssid === ownSsid) continue;
    const dist = Math.abs(n.channel - channel);
    if (dist <= 4) score += n.signal * (1 - dist / 5);
  }
  return Math.round(score);
}

export function bestChannel(nets: Net[], ownSsid: string | null): { channel: number; score: number } {
  return [1, 6, 11]
    .map((channel) => ({ channel, score: channelScore(nets, channel, ownSsid) }))
    .sort((a, b) => a.score - b.score)[0];
}

/** Sum of the signal strengths of other networks per channel 1 to 13. */
export function channelLoad(nets: Net[], ownSsid: string | null): number[] {
  const sums: number[] = [];
  for (let c = 1; c <= 13; c++) {
    sums.push(
      nets
        .filter((n) => n.channel === c && !(ownSsid && n.ssid === ownSsid))
        .reduce((a, n) => a + n.signal, 0),
    );
  }
  return sums;
}

export interface LocationInfo {
  id: string;
  name: string;
  devices: Device[];
}

/** All locations of the reachable devices. */
export function locationsOf(devices: Device[]): LocationInfo[] {
  const map = new Map<string, LocationInfo>();
  for (const d of devices) {
    if (!d.online || !d.locationId) continue;
    const entry = map.get(d.locationId) ?? { id: d.locationId, name: d.locationName ?? "?", devices: [] };
    entry.devices.push(d);
    map.set(d.locationId, entry);
  }
  return [...map.values()];
}

/** Default target: the location called "Home", otherwise the one with the most devices. */
export function defaultLocation(locations: LocationInfo[]): LocationInfo | null {
  if (locations.length === 0) return null;
  // With several locations of the same name, the one with the most devices wins
  const bySize = [...locations].sort((a, b) => b.devices.length - a.devices.length);
  return bySize.find((l) => l.name.trim().toLowerCase() === "home") ?? bySize[0];
}

export function recommendations(
  t: Messages,
  devices: Device[],
  nets: Net[] | null,
  staticIpsDone: boolean,
): Recommendation[] {
  const out: Recommendation[] = [];
  const online = devices.filter((d) => d.online);

  for (const d of devices.filter((x) => !x.online)) {
    out.push({ level: "bad", text: t.rec.offline(d.ip) });
  }

  for (const d of online) {
    if (isWireless(d) && (d.strength ?? 0) > 0 && (d.strength as number) < WEAK_SIGNAL) {
      out.push({ level: "bad", text: t.rec.weakSignal(label(d), d.strength as number) });
    }
    if (isWireless(d) && /^(none|wep)$/i.test(d.security ?? "")) {
      out.push({ level: "bad", text: t.rec.insecure(label(d), d.security ?? "") });
    }
  }

  // Different MusicCast locations: the devices do not see each other in the Yamaha app
  const locations = locationsOf(devices);
  if (locations.length > 1) {
    const parts = locations.map((l) => t.rec.locationPart(l.name, l.devices.map(label).join(", ")));
    out.push({ level: "bad", text: t.rec.locations(locations.length, parts.join("; ")) });
  }

  const wired = online.filter(isWired);
  if (online.length > 0 && wired.length === 0) {
    out.push({ level: "warn", text: t.rec.noWired });
  }
  const extended = online.filter(isExtended);
  const viaRouter = online.filter(isWireless);
  if (extended.length > 0) {
    out.push({ level: "ok", text: t.rec.extended(extended.map(label).join(", ")) });
  }
  if (wired.length > 0 && viaRouter.length > 0) {
    out.push({
      level: "info",
      text: t.rec.wiredPlusWifi(wired.map(label).join(", "), viaRouter.map(label).join(", ")),
    });
  }

  const dhcp = online.filter((d) => d.dhcp === true);
  if (dhcp.length > 0 && !staticIpsDone) {
    out.push({ level: "info", text: t.rec.staticIps(dhcp.map((d) => `${label(d)} (${d.ip})`).join(", ")) });
  }

  const channels = [
    ...new Set(online.filter((d) => isWireless(d) && (d.channel ?? 0) > 0).map((d) => d.channel)),
  ];
  if (channels.length > 1) {
    out.push({ level: "warn", text: t.rec.channels(channels.join(", ")) });
  }

  const firmwareByModel = new Map<string, Set<string>>();
  for (const d of online) {
    if (!d.model || !d.firmware) continue;
    const set = firmwareByModel.get(d.model) ?? new Set<string>();
    set.add(d.firmware);
    firmwareByModel.set(d.model, set);
  }
  for (const [model, versions] of firmwareByModel) {
    if (versions.size > 1) {
      out.push({ level: "warn", text: t.rec.firmware(model, [...versions].join(", ")) });
    }
  }

  if (online.length > 1 && !online.some((d) => d.role === "server")) {
    out.push({ level: "info", text: t.rec.notLinked });
  }

  if (nets && nets.length > 0) {
    const own = ownNetwork(devices);
    const best = bestChannel(nets, own?.ssid ?? null);
    if (own) {
      const current = channelScore(nets, own.channel, own.ssid);
      if (![1, 6, 11].includes(own.channel)) {
        out.push({ level: "warn", text: t.rec.channelOff(own.channel, best.channel) });
      } else if (own.channel !== best.channel && current > best.score * 1.3 + 20) {
        out.push({ level: "warn", text: t.rec.channelFull(own.channel, best.channel, current, best.score) });
      } else {
        out.push({ level: "ok", text: t.rec.channelOk(own.channel) });
      }
    } else {
      out.push({ level: "info", text: t.rec.bestChannel(best.channel) });
    }
  }

  if (out.length === 0) {
    out.push(
      devices.length > 0
        ? { level: "ok", text: t.rec.allGood }
        : { level: "info", text: t.rec.nothingChecked },
    );
  }
  return out;
}

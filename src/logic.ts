import type { Device, Net, Recommendation } from "./types";

export const isWireless = (d: Device) => /wireless/.test(d.connection ?? "");
export const isWired = (d: Device) => /wired/.test(d.connection ?? "");
/** Erweiterter Modus: das Geraet haengt am MusicCast-Netz eines anderen Geraets (extend_1, extend_2 ...). */
export const isExtended = (d: Device) => /extend/.test(d.connection ?? "");
export const label = (d: Device) => d.name || d.ip;

/** Schwellwert fuer "schwaches Signal". Die Skala der Yamaha-API ist nicht dokumentiert. */
export const WEAK_SIGNAL = 40;

export function ownNetwork(devices: Device[]): { ssid: string | null; channel: number } | null {
  const d = devices.find((x) => x.online && isWireless(x) && (x.channel ?? 0) > 0);
  return d ? { ssid: d.ssid, channel: d.channel as number } : null;
}

/** Stoerung durch fremde Netze im Ueberlappungsbereich (+/- 4 Kanaele), nach Signal und Abstand gewichtet. */
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

/** Summe der Signalstaerken fremder Netze pro Kanal 1 bis 13. */
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

/** Alle Standorte der erreichbaren Geraete. */
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

/** Vorgabe fuer das Ziel: der Standort «Home», sonst der mit den meisten Geraeten. */
export function defaultLocation(locations: LocationInfo[]): LocationInfo | null {
  if (locations.length === 0) return null;
  // Bei mehreren gleichnamigen Standorten gewinnt der mit den meisten Geraeten
  const bySize = [...locations].sort((a, b) => b.devices.length - a.devices.length);
  return bySize.find((l) => l.name.trim().toLowerCase() === "home") ?? bySize[0];
}

/** Bedeutung der YXC-Response-Codes laut Yamaha-Spezifikation. */
export function codeText(code: number | null): string {
  switch (code) {
    case null:
      return "keine Antwort";
    case 0:
      return "0 ok";
    case 1:
      return "1 Gerät initialisiert noch";
    case 2:
      return "2 interner Fehler";
    case 3:
      return "3 ungültige Anfrage";
    case 4:
      return "4 ungültiger Parameter";
    case 5:
      return "5 im aktuellen Zustand gesperrt";
    case 6:
      return "6 Zeitüberschreitung";
    case 99:
      return "99 Firmware-Update läuft";
    default:
      return String(code);
  }
}

export function recommendations(
  devices: Device[],
  nets: Net[] | null,
  staticIpsDone: boolean,
): Recommendation[] {
  const out: Recommendation[] = [];
  const online = devices.filter((d) => d.online);

  for (const d of devices.filter((x) => !x.online)) {
    out.push({
      level: "bad",
      text: `${d.ip} antwortet nicht. Gerät aus, im Tiefschlaf (Netzwerk-Standby aktivieren) oder IP geändert.`,
    });
  }

  for (const d of online) {
    if (isWireless(d) && (d.strength ?? 0) > 0 && (d.strength as number) < WEAK_SIGNAL) {
      out.push({
        level: "bad",
        text: `${label(d)}: schwaches WLAN-Signal (${d.strength}). Das ist ein wahrscheinlicher Grund für Link-Abbrüche. Näher an den Zugangspunkt, per Kabel oder im erweiterten Modus an ein verkabeltes MusicCast-Gerät hängen.`,
      });
    }
    if (isWireless(d) && /^(none|wep)$/i.test(d.security ?? "")) {
      out.push({
        level: "bad",
        text: `${label(d)}: WLAN ist unverschlüsselt oder nutzt WEP («${d.security}»). Im Router WPA2 einstellen.`,
      });
    }
  }

  // Unterschiedliche MusicCast-Standorte: Geraete sehen sich in der Yamaha-App nicht
  const locations = new Map<string, { name: string; devices: string[] }>();
  for (const d of online) {
    if (!d.locationId) continue;
    const entry = locations.get(d.locationId) ?? { name: d.locationName ?? "?", devices: [] };
    entry.devices.push(label(d));
    locations.set(d.locationId, entry);
  }
  if (locations.size > 1) {
    const parts = [...locations.values()].map((l) => `«${l.name}»: ${l.devices.join(", ")}`);
    out.push({
      level: "bad",
      text: `Die Geräte liegen in ${locations.size} verschiedenen MusicCast-Standorten (${parts.join("; ")}). Die Yamaha-App zeigt immer nur einen Standort, und Link funktioniert nur innerhalb eines Standorts. Die Leiste über der Geräteliste hängt alle in einen Standort um.`,
    });
  }

  const wired = online.filter(isWired);
  if (online.length > 0 && wired.length === 0) {
    out.push({
      level: "warn",
      text: "Kein Gerät hängt am Kabel. Ein verkabeltes MusicCast-Gerät kann im erweiterten Modus die anderen selbst versorgen.",
    });
  }
  const extended = online.filter(isExtended);
  const viaRouter = online.filter(isWireless);
  if (extended.length > 0) {
    out.push({
      level: "ok",
      text: `${extended.map(label).join(", ")} läuft im erweiterten Modus über ein anderes MusicCast-Gerät statt über das Router-WLAN.`,
    });
  }
  if (wired.length > 0 && viaRouter.length > 0) {
    out.push({
      level: "info",
      text: `${wired.map(label).join(", ")} ist verkabelt. ${viaRouter.map(label).join(", ")} hängt noch am Router-WLAN und könnte ebenfalls in den erweiterten Modus.`,
    });
  }

  const dhcp = online.filter((d) => d.dhcp === true);
  if (dhcp.length > 0 && !staticIpsDone) {
    out.push({
      level: "info",
      text: `Ob im Router statische IPs hinterlegt sind, kann die App nicht sehen. Bitte im Router-Portal prüfen für: ${dhcp
        .map((d) => `${label(d)} (${d.ip})`)
        .join(", ")}. Wenn erledigt, in den Einstellungen unter Router abhaken.`,
    });
  }

  const channels = [
    ...new Set(online.filter((d) => isWireless(d) && (d.channel ?? 0) > 0).map((d) => d.channel)),
  ];
  if (channels.length > 1) {
    out.push({
      level: "warn",
      text: `Die Geräte melden unterschiedliche Kanäle (${channels.join(", ")}). Sie hängen an verschiedenen Zugangspunkten oder am MusicCast-Netz eines anderen Geräts.`,
    });
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
      out.push({
        level: "warn",
        text: `${model}: unterschiedliche Firmware (${[...versions].join(", ")}). In der MusicCast-App alle aktualisieren.`,
      });
    }
  }

  if (online.length > 1 && !online.some((d) => d.role === "server")) {
    out.push({ level: "info", text: "Aktuell ist nichts verlinkt." });
  }

  if (nets && nets.length > 0) {
    const own = ownNetwork(devices);
    const best = bestChannel(nets, own?.ssid ?? null);
    if (own) {
      const current = channelScore(nets, own.channel, own.ssid);
      if (![1, 6, 11].includes(own.channel)) {
        out.push({
          level: "warn",
          text: `Dein 2.4-GHz-Netz läuft auf Kanal ${own.channel}. Im Router fix auf Kanal ${best.channel} stellen, 20 MHz.`,
        });
      } else if (own.channel !== best.channel && current > best.score * 1.3 + 20) {
        out.push({
          level: "warn",
          text: `Kanal ${own.channel} ist deutlich voller als Kanal ${best.channel} (${current} vs. ${best.score}). Im Router fix auf ${best.channel} stellen.`,
        });
      } else {
        out.push({
          level: "ok",
          text: `Kanal ${own.channel} ist in Ordnung. Im Router fix einstellen, damit er nicht automatisch wechselt.`,
        });
      }
    } else {
      out.push({ level: "info", text: `Bester 2.4-GHz-Kanal aktuell: ${best.channel}.` });
    }
  }

  if (out.length === 0) {
    out.push(
      devices.length > 0
        ? { level: "ok", text: "Nichts Auffälliges. Monitoring starten und über Nacht laufen lassen." }
        : { level: "info", text: "Noch nichts geprüft. F5 sucht Geräte, F6 scannt das WLAN." },
    );
  }
  return out;
}

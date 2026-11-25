# MusicCast Analyzer

Desktop-App (Tauri 2, Rust, React + TypeScript) fuer Diagnose, Link und Monitoring von Yamaha MusicCast im Heimnetz.

## Voraussetzungen (Windows)

- Rust (stable, MSVC-Toolchain) und die Visual Studio C++ Build Tools
- Node.js 18 oder neuer
- WebView2 Runtime (bei Windows 10/11 in der Regel vorhanden)

## Starten und Bauen

```powershell
npm install
npm run tauri dev      # Entwicklung mit Hot Reload
npm run tauri build    # Release: src-tauri\target\release\musiccast-analyzer.exe und NSIS-Installer
```

Mit installiertem `tauri-cli` (`cargo install tauri-cli --version "^2"`) geht auch `cargo tauri dev` bzw. `cargo tauri build`.
`npm install` braucht es in jedem Fall, weil das Frontend mit Vite gebaut wird.

`npm run typecheck` prueft die TypeScript-Typen separat. Der Build selbst laeuft ueber Vite und bricht bei Typfehlern nicht ab.

## Funktionen

- WLAN-Adapter waehlen und 2.4-GHz-Scan ueber `netsh` (Kanalbelegung, Empfehlung fuer Kanal 1, 6 oder 11)
- MusicCast-Geraete finden (SSDP plus Scan des /24-Subnetzes) oder IPs manuell angeben
- Empfehlungen: schwaches Signal, unterschiedliche Zugangspunkte, Firmware-Staende, Kanalwahl
- MusicCast Link: Master und Clients waehlen, verlinken, Gruppennamen setzen, Links aufloesen, Power
- "Auf LAN umstellen": schaltet ein Geraet per `system/setWiredLan` von WLAN auf Kabel um
- Monitoring im Hintergrund mit Tray-Icon, CSV-Log und Windows-Benachrichtigung bei Abbruch

## Automatisches Update

Die installierte App prueft beim Start den neuesten GitHub-Release (`latest.json`), laedt ein neueres
Update, installiert es und startet neu. Im Dev-Modus (`npm run tauri dev`) findet keine Pruefung statt.

Updates muessen signiert sein. Einmalig einrichten:

```powershell
npm run tauri signer generate -- -w "$HOME\.tauri\musiccast-analyzer.key"
```

- Den ausgegebenen oeffentlichen Schluessel in `src-tauri/tauri.conf.json` bei `plugins.updater.pubkey` eintragen.
- Im GitHub-Repo unter Settings, Secrets and variables, Actions zwei Secrets anlegen:
  `TAURI_SIGNING_PRIVATE_KEY` (Inhalt der `.key`-Datei) und `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Den privaten Schluessel sicher aufbewahren. Geht er verloren, koennen installierte Apps keine Updates mehr annehmen.

Fuer einen lokalen `npm run tauri build` muessen dieselben beiden Werte als Umgebungsvariablen gesetzt sein.

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `src/` | React-Frontend (`App.tsx`), Empfehlungslogik (`logic.ts`), Tauri-Aufrufe (`api.ts`) |
| `src-tauri/src/yxc.rs` | Yamaha Extended Control: Status, Link, Power, setWiredLan |
| `src-tauri/src/discovery.rs` | Geraetesuche |
| `src-tauri/src/wlan.rs` | Adapterliste (PowerShell) und Scan (netsh) |
| `src-tauri/src/monitor.rs` | Hintergrund-Monitoring |
| `src-tauri/src/lib.rs` | Tauri-Commands, Tray, Fensterverhalten |

## Hinweise

- Die App aendert nichts am Router. "Router-Portal oeffnen" zeigt auf die .1 des verbundenen Netzes.
- Die Request-Bodies der YXC-Aufrufe fuer Link und `setWiredLan` sind nicht gegen die Spezifikation verifiziert. Die UI zeigt pro Schritt den `response_code` an.
- Solange das Monitoring laeuft, schliesst das Fenster-X die App nicht, sie bleibt im Tray. Beenden ueber das Tray-Menue.
- Das CSV-Log liegt im App-Datenordner, der Pfad steht im Abschnitt Monitoring.

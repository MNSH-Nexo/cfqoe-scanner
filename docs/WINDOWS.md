# Running CFQoE Scanner on Windows

## 1. Install Node.js

Install the LTS build from <https://nodejs.org> (version 20 or newer). Confirm it in PowerShell:

```powershell
node -v
```

## 2. Get the scanner

```powershell
git clone https://github.com/MNSH-Nexo/cfqoe-scanner.git
cd cfqoe-scanner
```

If you do not have Git, download the ZIP from GitHub and extract it, for example to
`C:\Users\<you>\CFQoE`.

## 3. Add Xray

1. Download `Xray-windows-64.zip` from the official Xray-core releases page.
2. Extract it.
3. Copy `xray.exe` into the `xray` folder of the scanner:

```
C:\Users\<you>\cfqoe-scanner\xray\xray.exe
```

Verify with menu option **5 (System Check)**.

## 4. Start

Double click **`Start-CFQoE.cmd`**, or run:

```powershell
node bin\cfqoe.js
```

## 5. First run

1. Option **3** → paste your `vless://` link. It is written to `data\config.secret.uri` with a
   restricted ACL so only your Windows account can read it.
2. Option **5** → confirm Node and Xray are detected.
3. Option **1** → Quick Scan.
4. Option **6** → view the best IPs.

## Notes

- No administrator rights are needed and nothing is written outside the folder.
- Windows Defender may ask about `xray.exe` the first time it opens a local port; this is the
  local SOCKS inbound on `127.0.0.1`.
- If the terminal shows boxes instead of table lines, use Windows Terminal instead of the legacy
  console, or set `NO_COLOR=1`.
- To remove the tool, delete the folder. Nothing is left in the registry or in AppData.

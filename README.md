# Arabic PowerShell Terminal (User Guide)

A VS Code terminal panel that runs PowerShell and displays Arabic text correctly (shaping + right-to-left), while keeping the UI left-to-right like a normal terminal.

## What you get
- Inline prompt at the bottom with support for Enter, Backspace, Arrow keys, and Ctrl+C.
- Live PowerShell output (stdout + stderr) with ANSI colors.
- Arabic shaping + bidi applied to both output and the prompt, so Arabic looks natural.
- Auto-scroll and LTR layout; Arabic text itself renders RTL.

## How to use
1. Open the Command Palette in VS Code (Ctrl+Shift+P / Cmd+Shift+P).
2. Run: `Arabic PowerShell Terminal` (command id: `arabicTerminal.open`).
3. Type commands in the prompt at the bottom and press Enter.
   - Ctrl+C sends an interrupt.
   - Arrow keys move the cursor in the prompt.

## Install the extension
- From a VSIX file:
  1. Save the `.vsix` locally.
  2. VS Code → Extensions view → `...` menu → `Install from VSIX...` → pick the file.
- From Marketplace (once published): search “Arabic PowerShell Terminal” and install.

## Requirements
- PowerShell available in PATH (`pwsh` or `powershell.exe` on Windows).
- VS Code 1.80.0 or newer.

## Tips
- If you don’t see colors, check that the command emits ANSI sequences (most do by default).
- The UI is LTR; Arabic text still renders RTL automatically.
- If the prompt stops responding, close and reopen the command via the Command Palette.

## Privacy
- Commands are executed locally; no data is sent anywhere.

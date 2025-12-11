# Arabic Terminal (PowerShell)

WebView-based terminal for VS Code that runs PowerShell, keeps an inline prompt, and renders Arabic text with proper shaping + bidi. ANSI colors are preserved, and stdout/stderr stream live above the prompt.

## Features
- Inline interactive prompt (Enter, Backspace, Arrow keys, Ctrl+C).
- Live stdout/stderr streaming with ANSI colors.
- Arabic shaping (arabic-reshaper) and bidi ordering (bidi-js) applied to output and prompt text.
- Auto-scroll, LTR layout with correct RTL rendering for Arabic text.
- Uses PowerShell (pwsh/powershell.exe) by default.

## Commands
- Command Palette → `Arabic PowerShell Terminal` (`arabicTerminal.open`).

## Installation (Local / VSIX)
1) Install dependencies: `pnpm install` (or `npm install`).
2) Build: `pnpm run build`.
3) Package: `vsce package` (install `@vscode/vsce` globally if needed).
4) Install the `.vsix` in VS Code: Extensions panel → `...` → `Install from VSIX...`.

## Development
- Watch build: `pnpm run watch`
- One-off build: `pnpm run build`
- Launch Extension Host: press `F5` in VS Code, then run the command from the palette.

## Publishing
1) Set `publisher` in `package.json` to your Marketplace publisher ID (slug).
2) `vsce login <publisher>`
3) `vsce publish` (or `vsce publish patch/minor/major`)

## Notes
- Ensure PowerShell is available in PATH (`pwsh` or `powershell.exe` on Windows).
- `.vscodeignore` excludes `.env` and other non-essential files from the VSIX.

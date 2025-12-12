import * as vscode from 'vscode';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const WEBVIEW_ROOT = ['src', 'webview'];

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand('arabicTerminal.open', () => {
    const panel = vscode.window.createWebviewPanel(
      'arabicTerminal',
      'Arabic PowerShell',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.file(path.join(context.extensionPath, ...WEBVIEW_ROOT)),
        ],
      }
    );

    panel.webview.html = getWebviewContent(context, panel);

    const cwd =
      vscode.window.activeTextEditor?.document?.uri?.scheme === 'file'
        ? path.dirname(vscode.window.activeTextEditor.document.uri.fsPath)
        : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const shell = createShell(cwd);
    if (!shell) {
      vscode.window.showErrorMessage('Failed to start PowerShell session');
      return;
    }

    shell.stdout.on('data', (data: Buffer) => {
      panel.webview.postMessage({ type: 'stdout', text: data.toString('utf8') });
    });

    shell.stderr.on('data', (data: Buffer) => {
      panel.webview.postMessage({ type: 'stderr', text: data.toString('utf8') });
    });

    shell.on('exit', (code) => {
      panel.webview.postMessage({ type: 'exit', code });
    });

    panel.webview.onDidReceiveMessage(
      (msg) => {
        if (!shell.killed) {
          if (msg.type === 'input') {
            const input = String(msg.text ?? '');
            shell.stdin.write(input.endsWith('\n') ? input : `${input}\n`);
          } else if (msg.type === 'interrupt') {
            try {
              shell.stdin.write('\x03'); // Ctrl+C
            } catch {
              shell.kill();
            }
          }
        }
      },
      undefined,
      context.subscriptions
    );

    panel.onDidDispose(
      () => {
        try {
          shell.kill();
        } catch {
          // ignore
        }
      },
      null,
      context.subscriptions
    );
  });

  context.subscriptions.push(disposable);
}

function createShell(cwd?: string): ChildProcessWithoutNullStreams | null {
  const candidates =
    process.platform === 'win32'
      ? ['powershell.exe', 'pwsh.exe', 'pwsh']
      : ['pwsh', 'powershell', 'bash', 'sh'];

  for (const cmd of candidates) {
    try {
      return spawn(cmd, [], { stdio: 'pipe', cwd });
    } catch {
      continue;
    }
  }
  return null;
}

function getWebviewContent(
  context: vscode.ExtensionContext,
  panel: vscode.WebviewPanel
) {
  const webview = panel.webview;
  const webviewRoot = path.join(context.extensionPath, ...WEBVIEW_ROOT);
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(webviewRoot, 'renderer.js'))
  );
  const arabicReshaperUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(webviewRoot, 'deps', 'arabic-reshaper.min.js'))
  );
  const bidiUri = webview.asWebviewUri(
    vscode.Uri.file(path.join(webviewRoot, 'deps', 'bidi.min.js'))
  );

  const htmlPath = path.join(webviewRoot, 'index.html');
  const rawHtml = fs.readFileSync(htmlPath, 'utf8');

  return rawHtml
    .replace(/__CSP_SOURCE__/g, webview.cspSource)
    .replace(/__SCRIPT_URI__/g, String(scriptUri))
    .replace(/__ARABIC_RESHAPER_URI__/g, String(arabicReshaperUri))
    .replace(/__BIDI_URI__/g, String(bidiUri));
}

export function deactivate() {}
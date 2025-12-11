"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const WEBVIEW_ROOT = ['src', 'webview'];
function activate(context) {
    const disposable = vscode.commands.registerCommand('arabicTerminal.open', () => {
        const panel = vscode.window.createWebviewPanel('arabicTerminal', 'Arabic PowerShell', vscode.ViewColumn.One, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.file(path.join(context.extensionPath, ...WEBVIEW_ROOT)),
            ],
        });
        panel.webview.html = getWebviewContent(context, panel);
        const shell = createShell();
        if (!shell) {
            vscode.window.showErrorMessage('Failed to start PowerShell session');
            return;
        }
        shell.stdout.on('data', (data) => {
            panel.webview.postMessage({ type: 'stdout', text: data.toString('utf8') });
        });
        shell.stderr.on('data', (data) => {
            panel.webview.postMessage({ type: 'stderr', text: data.toString('utf8') });
        });
        shell.on('exit', (code) => {
            panel.webview.postMessage({ type: 'exit', code });
        });
        panel.webview.onDidReceiveMessage((msg) => {
            if (!shell.killed) {
                if (msg.type === 'input') {
                    const input = String(msg.text ?? '');
                    shell.stdin.write(input.endsWith('\n') ? input : `${input}\n`);
                }
                else if (msg.type === 'interrupt') {
                    try {
                        shell.stdin.write('\x03'); // Ctrl+C
                    }
                    catch {
                        shell.kill();
                    }
                }
            }
        }, undefined, context.subscriptions);
        panel.onDidDispose(() => {
            try {
                shell.kill();
            }
            catch {
                // ignore
            }
        }, null, context.subscriptions);
    });
    context.subscriptions.push(disposable);
}
function createShell() {
    const candidates = process.platform === 'win32'
        ? ['powershell.exe', 'pwsh.exe', 'pwsh']
        : ['pwsh', 'powershell', 'bash', 'sh'];
    for (const cmd of candidates) {
        try {
            return (0, child_process_1.spawn)(cmd, [], { stdio: 'pipe' });
        }
        catch {
            continue;
        }
    }
    return null;
}
function getWebviewContent(context, panel) {
    const webview = panel.webview;
    const webviewRoot = path.join(context.extensionPath, ...WEBVIEW_ROOT);
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(webviewRoot, 'renderer.js')));
    const arabicReshaperUri = webview.asWebviewUri(vscode.Uri.file(path.join(webviewRoot, 'deps', 'arabic-reshaper.min.js')));
    const bidiUri = webview.asWebviewUri(vscode.Uri.file(path.join(webviewRoot, 'deps', 'bidi.min.js')));
    const htmlPath = path.join(webviewRoot, 'index.html');
    const rawHtml = fs.readFileSync(htmlPath, 'utf8');
    return rawHtml
        .replace(/__CSP_SOURCE__/g, webview.cspSource)
        .replace(/__SCRIPT_URI__/g, String(scriptUri))
        .replace(/__ARABIC_RESHAPER_URI__/g, String(arabicReshaperUri))
        .replace(/__BIDI_URI__/g, String(bidiUri));
}
function deactivate() { }

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
const VIEW_ID = 'arabicTerminal.view';
const PANEL_ID = 'arabicTerminalPanel';
function activate(context) {
    const provider = new ArabicTerminalViewProvider(context);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
        webviewOptions: { retainContextWhenHidden: true },
    }));
    const openCmd = vscode.commands.registerCommand('arabicTerminal.open', async () => {
        // Focus the custom panel tab, then the view itself
        await vscode.commands.executeCommand(`workbench.view.panel.${PANEL_ID}`).then(undefined, () => { });
        await vscode.commands.executeCommand('arabicTerminal.view.focus').then(undefined, () => { });
    });
    context.subscriptions.push(openCmd);
}
function deactivate() { }
class ArabicTerminalViewProvider {
    constructor(context) {
        this.context = context;
        this.currentCwd = process.cwd();
    }
    resolveWebviewView(webviewView) {
        this.view = webviewView;
        const { webview } = webviewView;
        webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, ...WEBVIEW_ROOT))],
        };
        webview.html = this.getWebviewContent(webview);
        this.currentCwd = this.detectInitialCwd();
        webview.postMessage({ type: 'cwd', path: this.currentCwd });
        this.shell = createShell(this.currentCwd);
        if (!this.shell) {
            vscode.window.showErrorMessage('Failed to start PowerShell session');
            return;
        }
        this.shell.stdout.on('data', (data) => {
            this.view?.webview.postMessage({ type: 'stdout', text: data.toString('utf8') });
        });
        this.shell.stderr.on('data', (data) => {
            this.view?.webview.postMessage({ type: 'stderr', text: data.toString('utf8') });
        });
        this.shell.on('exit', (code) => {
            this.view?.webview.postMessage({ type: 'exit', code });
        });
        webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
        webviewView.onDidDispose(() => this.disposeShell());
    }
    handleMessage(msg) {
        if (!this.shell || this.shell.killed)
            return;
        if (msg.type === 'input') {
            const input = String(msg.text ?? '');
            const trimmed = input.trim();
            const cdMatch = /^cd\s+(.+)$/i.exec(trimmed);
            const slMatch = /^set-location\s+(.+)$/i.exec(trimmed);
            const targetDir = cdMatch?.[1] ?? slMatch?.[1];
            if (targetDir) {
                const resolved = resolvePath(targetDir, this.currentCwd);
                if (resolved) {
                    this.currentCwd = resolved;
                    this.view?.webview.postMessage({ type: 'cwd', path: this.currentCwd });
                }
            }
            this.shell.stdin.write(input.endsWith('\n') ? input : `${input}\n`);
        }
        else if (msg.type === 'complete') {
            const prefix = String(msg.prefix ?? '');
            const completions = getPathCompletions(prefix, this.currentCwd);
            this.view?.webview.postMessage({ type: 'completionItems', items: completions });
        }
        else if (msg.type === 'interrupt') {
            try {
                this.shell.stdin.write('\x03');
            }
            catch {
                this.shell.kill();
            }
        }
    }
    disposeShell() {
        if (this.shell && !this.shell.killed) {
            try {
                this.shell.kill();
            }
            catch {
                // ignore
            }
        }
    }
    detectInitialCwd() {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document?.uri?.scheme === 'file') {
            return path.dirname(editor.document.uri.fsPath);
        }
        const firstWs = vscode.workspace.workspaceFolders?.[0];
        if (firstWs?.uri?.fsPath)
            return firstWs.uri.fsPath;
        return process.cwd();
    }
    getWebviewContent(webview) {
        const webviewRoot = path.join(this.context.extensionPath, ...WEBVIEW_ROOT);
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
}
function createShell(cwd) {
    const candidates = process.platform === 'win32'
        ? ['powershell.exe', 'pwsh.exe', 'pwsh']
        : ['pwsh', 'powershell', 'bash', 'sh'];
    for (const cmd of candidates) {
        try {
            return (0, child_process_1.spawn)(cmd, [], { stdio: 'pipe', cwd });
        }
        catch {
            continue;
        }
    }
    return undefined;
}
function resolvePath(target, cwd) {
    try {
        const base = cwd || process.cwd();
        const resolved = path.resolve(base, target.replace(/^['"]|['"]$/g, ''));
        const stat = fs.statSync(resolved);
        if (stat.isDirectory())
            return resolved;
    }
    catch {
        // ignore
    }
    return null;
}
function getPathCompletions(prefix, cwd) {
    const sep = path.sep;
    const baseCwd = cwd || process.cwd();
    const cleaned = prefix.replace(/^['"]|['"]$/g, '');
    const hasSep = cleaned.includes(sep);
    const dirPart = hasSep ? cleaned.slice(0, cleaned.lastIndexOf(sep) + 1) : '';
    const basePart = hasSep ? cleaned.slice(cleaned.lastIndexOf(sep) + 1) : cleaned;
    const dirPath = path.resolve(baseCwd, dirPart || '.');
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        return entries
            .filter((e) => e.name.toLowerCase().startsWith(basePart.toLowerCase()))
            .map((e) => {
            const suffix = e.isDirectory() ? sep : '';
            return `${dirPart}${e.name}${suffix}`;
        });
    }
    catch {
        return [];
    }
}

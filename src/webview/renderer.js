// renderer.js — runs inside the WebView
(() => {
  const vscode = acquireVsCodeApi();

  const outputEl = document.getElementById('output');
  const promptTextEl = document.getElementById('promptText');
  const promptLabelEl = document.getElementById('promptLabel');
  const hiddenInput = document.getElementById('hiddenInput');

  const PROMPT_PREFIX = 'PS> ';

  let buffer = '';
  let cursor = 0;
  let pendingStdout = '';
  let pendingStderr = '';
  let processExited = false;
  let ansiStateStdout = defaultAnsiState();
  let ansiStateStderr = defaultAnsiState();
  let currentCwd = '';
  let initialCwdShown = false;
  let pendingCompletion = null;

  promptLabelEl.textContent = PROMPT_PREFIX.trim();

  const caretEl = document.createElement('span');
  caretEl.className = 'caret';

  focusPrompt();
  renderPrompt();

  // ---------- Arabic shaping + bidi helpers (no-op now that deps are removed) ----------
  function shapeAndBidi(text) {
    return text;
  }

  // ---------- ANSI to HTML ----------
  function defaultAnsiState() {
    return { fg: null, bg: null, bold: false, italic: false, underline: false };
  }

  function parseAnsi(text, state) {
    const ansiRegex = /\x1b\[([0-9;]*)m/g; // allow empty params (e.g., ESC[m)
    const spans = [];
    let lastIndex = 0;
    let styleState = { ...state };

    for (const match of text.matchAll(ansiRegex)) {
      const index = match.index ?? 0;
      if (index > lastIndex) {
        spans.push({ text: text.slice(lastIndex, index), style: toStyle(styleState) });
      }
      const raw = match[1];
      const codes = raw === '' ? [0] : raw.split(';').map((n) => Number(n));
      styleState = applyCodes(styleState, codes);
      lastIndex = index + match[0].length;
    }

    if (lastIndex < text.length) {
      spans.push({ text: text.slice(lastIndex), style: toStyle(styleState) });
    }
    return { spans, state: styleState };
  }

  function applyCodes(state, codes) {
    const next = { ...state };
    const fgMap = {
      30: '#000000', 31: '#cd3131', 32: '#0dbc79', 33: '#e5e510',
      34: '#2472c8', 35: '#bc3fbc', 36: '#11a8cd', 37: '#e5e5e5',
      90: '#666666', 91: '#f14c4c', 92: '#23d18b', 93: '#f5f543',
      94: '#3b8eea', 95: '#d670d6', 96: '#29b8db', 97: '#e5e5e5',
    };
    const bgMap = {
      40: '#000000', 41: '#cd3131', 42: '#0dbc79', 43: '#e5e510',
      44: '#2472c8', 45: '#bc3fbc', 46: '#11a8cd', 47: '#e5e5e5',
      100: '#666666', 101: '#f14c4c', 102: '#23d18b', 103: '#f5f543',
      104: '#3b8eea', 105: '#d670d6', 106: '#29b8db', 107: '#e5e5e5',
    };

    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) {
        next.fg = null;
        next.bg = null;
        next.bold = false;
        next.italic = false;
        next.underline = false;
      } else if (code === 1) {
        next.bold = true;
      } else if (code === 3) {
        next.italic = true;
      } else if (code === 4) {
        next.underline = true;
      } else if (code === 7) {
        const tmp = next.fg;
        next.fg = next.bg;
        next.bg = tmp;
      } else if (code === 22) {
        next.bold = false;
      } else if (code === 23) {
        next.italic = false;
      } else if (code === 24) {
        next.underline = false;
      } else if (code === 27) {
        const tmp = next.fg;
        next.fg = next.bg;
        next.bg = tmp;
      } else if (code === 39) {
        next.fg = null;
      } else if (code === 49) {
        next.bg = null;
      } else if (code === 38 || code === 48) {
        const isFg = code === 38;
        const mode = codes[i + 1];
        if (mode === 5 && typeof codes[i + 2] === 'number') {
          const idx = codes[i + 2];
          const color = xterm256Color(idx);
          if (color) {
            if (isFg) next.fg = color;
            else next.bg = color;
          }
          i += 2;
        } else if (mode === 2 && typeof codes[i + 2] === 'number') {
          const r = codes[i + 2];
          const g = codes[i + 3];
          const b = codes[i + 4];
          if ([r, g, b].every((v) => typeof v === 'number' && !Number.isNaN(v))) {
            const color = `#${clampByte(r).toString(16).padStart(2, '0')}${clampByte(g)
              .toString(16)
              .padStart(2, '0')}${clampByte(b).toString(16).padStart(2, '0')}`;
            if (isFg) next.fg = color;
            else next.bg = color;
          }
          i += 4;
        }
      } else if (fgMap[code]) {
        next.fg = fgMap[code];
      } else if (bgMap[code]) {
        next.bg = bgMap[code];
      }
    }

    return next;
  }

  function toStyle(state) {
    const styles = [];
    if (state.fg) styles.push(`color:${state.fg}`);
    if (state.bg) styles.push(`background:${state.bg}`);
    if (state.bold) styles.push('font-weight:bold');
    if (state.italic) styles.push('font-style:italic');
    if (state.underline) styles.push('text-decoration: underline');
    return styles.join(';');
  }

  function createStyledLine(text, cls, incomingState) {
    const lineEl = document.createElement('div');
    lineEl.className = cls ? `line ${cls}` : 'line';

    const { spans, state } = parseAnsi(text, incomingState);
    spans.forEach((frag) => {
      if (!frag.text) return;
      const span = document.createElement('span');
      span.textContent = shapeAndBidi(frag.text);
      if (frag.style) span.setAttribute('style', frag.style);
      lineEl.appendChild(span);
    });
    return { element: lineEl, state };
  }

  function appendStreamLine(text, stream) {
    const isErr = stream === 'stderr';
    const currentState = isErr ? ansiStateStderr : ansiStateStdout;
    const { element, state } = createStyledLine(text, isErr ? 'stderr' : undefined, currentState);
    if (isErr) {
      ansiStateStderr = state;
    } else {
      ansiStateStdout = state;
    }
    outputEl.appendChild(element);
    scrollToBottom();
  }

  function appendPlainLine(text, cls) {
    const { element } = createStyledLine(text, cls, defaultAnsiState());
    outputEl.appendChild(element);
    scrollToBottom();
  }

  function appendCwdLine(force = false) {
    if (!currentCwd) return;
    if (!initialCwdShown || force) {
      appendPlainLine(currentCwd);
      initialCwdShown = true;
    }
  }

  function clearOutput() {
    outputEl.innerHTML = '';
    pendingStdout = '';
    pendingStderr = '';
    ansiStateStdout = defaultAnsiState();
    ansiStateStderr = defaultAnsiState();
    scrollToBottom();
  }

  function scrollToBottom() {
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  // ---------- Prompt handling ----------
  function renderPrompt() {
    promptTextEl.innerHTML = '';
    const shaped = shapeAndBidi(buffer);
    const before = shaped.slice(0, cursor);
    const after = shaped.slice(cursor);
    promptTextEl.append(document.createTextNode(before), caretEl, document.createTextNode(after));
  }

  function focusPrompt() {
    hiddenInput.focus();
    setTimeout(() => hiddenInput.focus(), 0);
  }

  function insertText(text) {
    if (processExited || !text) return;
    buffer = buffer.slice(0, cursor) + text + buffer.slice(cursor);
    cursor += text.length;
    renderPrompt();
  }

  function backspace() {
    if (cursor === 0 || processExited) return;
    buffer = buffer.slice(0, cursor - 1) + buffer.slice(cursor);
    cursor -= 1;
    renderPrompt();
  }

  function moveCursor(delta) {
    const next = Math.min(Math.max(0, cursor + delta), buffer.length);
    cursor = next;
    renderPrompt();
  }

  function replaceWordAtCursor(replacement) {
    const { start, end } = getWordBounds();
    buffer = buffer.slice(0, start) + replacement + buffer.slice(end);
    cursor = start + replacement.length;
    renderPrompt();
  }

  function getWordBounds() {
    const left = buffer.slice(0, cursor);
    const right = buffer.slice(cursor);
    const start = left.lastIndexOf(' ') + 1;
    const nextSpace = right.indexOf(' ');
    const end = nextSpace === -1 ? buffer.length : cursor + nextSpace;
    return { start, end };
  }

  function clearPrompt() {
    buffer = '';
    cursor = 0;
    renderPrompt();
  }

  function echoCommand(cmd) {
    appendPlainLine(PROMPT_PREFIX + cmd, 'stdin-echo');
  }

  function executeCommand() {
    if (processExited) return;
    const cmd = buffer;
    const normalized = cmd.trim().toLowerCase();
    if (normalized === 'clear' || normalized === 'cls') {
      clearOutput();
      appendCwdLine(true);
      vscode.postMessage({ type: 'input', text: cmd });
      clearPrompt();
      return;
    }
    echoCommand(cmd);
    vscode.postMessage({ type: 'input', text: cmd });
    clearPrompt();
  }

  function interruptProcess() {
    if (processExited) return;
    vscode.postMessage({ type: 'interrupt' });
    appendPlainLine('^C', 'stdin-echo');
    clearPrompt();
  }

  // ---------- Output stream handling ----------
  function handleStreamChunk(kind, text) {
    const normalized = text.replace(/\r\n/g, '\n');
    if (/\u001b\[\d*J/.test(normalized)) {
      // Clear screen escape sequences (e.g., ESC[2J)
      clearOutput();
    }
    if (kind === 'stderr') {
      pendingStderr = consumeLines(normalized, pendingStderr, 'stderr');
    } else {
      pendingStdout = consumeLines(normalized, pendingStdout, 'stdout');
    }
  }

  function consumeLines(chunk, pending, stream) {
    const combined = pending + chunk;
    const parts = combined.split('\n');
    const remainder = parts.pop() ?? '';
    parts.forEach((part) => appendStreamLine(part + '\n', stream));
    return remainder;
  }

  function flushPending() {
    if (pendingStdout) {
      appendStreamLine(pendingStdout, 'stdout');
      pendingStdout = '';
    }
    if (pendingStderr) {
      appendStreamLine(pendingStderr, 'stderr');
      pendingStderr = '';
    }
  }

  // ---------- Event wiring ----------
  hiddenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeCommand();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      backspace();
      return;
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      moveCursor(-1);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      moveCursor(1);
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      interruptProcess();
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      requestCompletion();
      return;
    }
  });

  hiddenInput.addEventListener('input', () => {
    const val = hiddenInput.value;
    if (val) {
      insertText(val);
      hiddenInput.value = '';
    }
  });

  window.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text');
    if (text) insertText(text);
  });

  // Global Ctrl+C to send interrupt when nothing is selected
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key.toLowerCase() !== 'c') return;
    const selection = window.getSelection();
    const hasSelection = selection && !selection.isCollapsed;
    if (hasSelection) return; // allow copy when user selected text
    e.preventDefault();
    interruptProcess();
  });

  promptTextEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    focusPrompt();
  });

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (msg.type === 'stdout') {
      handleStreamChunk('stdout', msg.text ?? '');
    } else if (msg.type === 'stderr') {
      handleStreamChunk('stderr', msg.text ?? '');
    } else if (msg.type === 'exit') {
      processExited = true;
      flushPending();
      appendPlainLine(`[process exited with code ${msg.code}]`);
      clearPrompt();
    } else if (msg.type === 'cwd') {
      currentCwd = msg.path || '';
      appendCwdLine(false);
    } else if (msg.type === 'completionItems') {
      applyCompletionItems(msg.items ?? []);
    }
  });

  // initial focus when the webview loads
  window.addEventListener('focus', focusPrompt);

  // ---------- Completion handling ----------
  function requestCompletion() {
    const { start, end } = getWordBounds();
    const currentWord = buffer.slice(start, end);
    pendingCompletion = { start, end };
    vscode.postMessage({ type: 'complete', prefix: currentWord });
  }

  function applyCompletionItems(items) {
    if (!pendingCompletion) return;
    if (!items.length) {
      pendingCompletion = null;
      return;
    }
    if (items.length === 1) {
      replaceWordAtCursor(items[0]);
    } else {
      const common = longestCommonPrefix(items);
      if (common && common.length > 0) {
        replaceWordAtCursor(common);
      }
      appendPlainLine(items.join('    '));
    }
    pendingCompletion = null;
  }

  function longestCommonPrefix(strings) {
    if (!strings.length) return '';
    let prefix = strings[0];
    for (const s of strings.slice(1)) {
      while (!s.toLowerCase().startsWith(prefix.toLowerCase())) {
        prefix = prefix.slice(0, -1);
        if (!prefix) break;
      }
      if (!prefix) break;
    }
    return prefix;
  }

  function clampByte(n) {
    if (Number.isNaN(n)) return 0;
    return Math.min(255, Math.max(0, n));
  }

  function xterm256Color(idx) {
    if (idx == null || Number.isNaN(idx)) return null;
    const n = Math.max(0, Math.min(255, idx));
    if (n < 16) {
      const table = [
        '#000000', '#cd0000', '#00cd00', '#cdcd00', '#0000ee', '#cd00cd', '#00cdcd', '#e5e5e5',
        '#7f7f7f', '#ff0000', '#00ff00', '#ffff00', '#5c5cff', '#ff00ff', '#00ffff', '#ffffff',
      ];
      return table[n];
    }
    if (n >= 16 && n <= 231) {
      const v = n - 16;
      const r = Math.floor(v / 36) % 6;
      const g = Math.floor(v / 6) % 6;
      const b = v % 6;
      const comp = [r, g, b].map((c) => (c === 0 ? 0 : c * 40 + 55));
      return `#${comp.map((c) => clampByte(c).toString(16).padStart(2, '0')).join('')}`;
    }
    // grayscale 232-255
    const level = 8 + (n - 232) * 10;
    const hex = clampByte(level).toString(16).padStart(2, '0');
    return `#${hex}${hex}${hex}`;
  }
})();
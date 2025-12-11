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

  promptLabelEl.textContent = PROMPT_PREFIX.trim();

  const caretEl = document.createElement('span');
  caretEl.className = 'caret';

  focusPrompt();
  renderPrompt();

  // ---------- Arabic shaping + bidi helpers ----------
  function shapeArabic(text) {
    try {
      if (window.arabicReshaper?.reshape) {
        return window.arabicReshaper.reshape(text);
      }
      if (window.arabicReshaper?.ArabicReshaper) {
        const reshaper = new window.arabicReshaper.ArabicReshaper();
        return reshaper.reshape(text);
      }
    } catch {
      // ignore
    }
    return text;
  }

  function applyBidi(text) {
    try {
      const bidiLib = window.bidi;
      if (!bidiLib) return text;
      if (typeof bidiLib.reorderParagraphs === 'function') {
        const res = bidiLib.reorderParagraphs(text);
        if (Array.isArray(res) && res[0]?.str) return res[0].str;
      }
      if (typeof bidiLib.reorderLogical === 'function') {
        return bidiLib.reorderLogical(text);
      }
      if (typeof bidiLib.reorderVisual === 'function') {
        return bidiLib.reorderVisual(text);
      }
      if (bidiLib.Bidi) {
        const bidi = new bidiLib.Bidi();
        bidi.setParagraph(text);
        return bidi.getText();
      }
    } catch {
      // ignore
    }
    return text;
  }

  function shapeAndBidi(text) {
    return applyBidi(shapeArabic(text));
  }

  // ---------- ANSI to HTML ----------
  function defaultAnsiState() {
    return { fg: null, bg: null, bold: false, italic: false, underline: false };
  }

  function parseAnsi(text, state) {
    const ansiRegex = /\x1b\[(\d+(?:;\d+)*)m/g;
    const spans = [];
    let lastIndex = 0;
    let styleState = { ...state };

    for (const match of text.matchAll(ansiRegex)) {
      const index = match.index ?? 0;
      if (index > lastIndex) {
        spans.push({ text: text.slice(lastIndex, index), style: toStyle(styleState) });
      }
      const codes = match[1].split(';').map(Number);
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

    codes.forEach((code) => {
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
      } else if (code === 22) {
        next.bold = false;
      } else if (code === 23) {
        next.italic = false;
      } else if (code === 24) {
        next.underline = false;
      } else if (code === 39) {
        next.fg = null;
      } else if (code === 49) {
        next.bg = null;
      } else if (fgMap[code]) {
        next.fg = fgMap[code];
      } else if (bgMap[code]) {
        next.bg = bgMap[code];
      }
    });

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
    }
  });

  // initial focus when the webview loads
  window.addEventListener('focus', focusPrompt);
})();
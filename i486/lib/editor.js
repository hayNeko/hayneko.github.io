/* i486/lib/editor.js — textarea-backed editor for the i486 mini IDE.
   I486.Editor.create(host, opts) -> instance (UI-CONTRACT.md section 4).
   A real, editable <textarea> sits transparently over a highlighted <pre>;
   keys are only intercepted where the contract asks for it (Tab, Enter,
   Ctrl+Enter, Ctrl+B), so selection, undo and IME stay native. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.I486 = root.I486 || {};
  for (var k in api) {
    if (Object.prototype.hasOwnProperty.call(api, k)) root.I486[k] = api[k];
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var INDENT = '  ';
  var RENDER_DELAY = 16;
  var EVENTS = ['change', 'cursor', 'assemble', 'breakpoint'];

  function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }

  function escapeText(text) {
    return text.replace(/[&<>]/g, function (ch) {
      return ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;';
    });
  }

  function highlightApi() {
    var api = typeof globalThis !== 'undefined' ? globalThis.I486 : null;
    return api && api.Highlight && typeof api.Highlight.html === 'function' ? api.Highlight : null;
  }

  function highlightHtml(source) {
    var api = highlightApi();
    if (api) return api.html(source);
    var cls = 'code-line';
    var lines = (source == null ? '' : String(source)).split('\n');
    var out = '';
    for (var i = 0; i < lines.length; i++) {
      out += '<span class="' + cls + '">' + escapeText(lines[i]) + '</span>';
    }
    return out;
  }

  function fragmentsFromHtml(html) {
    var box = el('div', '');
    box.innerHTML = html;
    var frag = document.createDocumentFragment();
    while (box.firstChild) frag.appendChild(box.firstChild);
    return frag;
  }

  function Editor(host, options) {
    this.host = host;
    this.opts = options || {};
    this.handlers = Object.create(null);
    for (var i = 0; i < EVENTS.length; i++) this.handlers[EVENTS[i]] = [];
    this._adopted = Object.create(null);

    this._bp = Object.create(null);
    this._err = Object.create(null);
    this._activeLine = 0;
    this._curLine = 0;
    this._caretOn = false;
    this._lineH = 19;
    this._padTop = 8;
    this._lines = [];
    this._text = null;
    this._timer = 0;
    this._composing = false;
    this.gutterRows = [];

    this._build();
    this._bind();
    this._adopt(this.opts);
    this._measure();
    this._renderAll();
  }

  Editor.prototype._build = function () {
    var host = this.host;
    var textarea = this.opts.textarea || host.querySelector('textarea[data-i486="source"]') || host.querySelector('textarea');
    if (!textarea) throw new Error('I486.Editor.create: textarea not found in host');

    var shell = host.querySelector('.ed-shell');
    if (!shell) {
      shell = el('div', 'ed-shell');
      host.appendChild(shell);
    }

    var gutter = this.opts.gutter || shell.querySelector('[data-i486="gutter"]');
    if (!gutter) {
      gutter = el('div', 'ed-gutter');
      gutter.setAttribute('data-i486', 'gutter');
      gutter.setAttribute('aria-hidden', 'true');
      shell.insertBefore(gutter, shell.firstChild);
    }
    var gutterInner = gutter.querySelector('.ed-gutter__inner');
    if (!gutterInner) {
      gutterInner = el('div', 'ed-gutter__inner');
      gutter.appendChild(gutterInner);
    }

    var code = shell.querySelector('.ed-code');
    if (!code) {
      code = el('div', 'ed-code');
      shell.appendChild(code);
    }

    var activeEl = code.querySelector('.ed-active');
    if (!activeEl) {
      activeEl = el('div', 'ed-active');
      activeEl.hidden = true;
      code.appendChild(activeEl);
    }
    var caretEl = code.querySelector('.ed-caret');
    if (!caretEl) {
      caretEl = el('div', 'ed-caret');
      caretEl.hidden = true;
      code.appendChild(caretEl);
    }

    var pre = this.opts.highlight || code.querySelector('[data-i486="highlight"]');
    if (!pre) {
      pre = document.createElement('pre');
      pre.className = 'ed-pre';
      pre.setAttribute('data-i486', 'highlight');
      pre.setAttribute('aria-hidden', 'true');
      code.appendChild(pre);
    }

    if (textarea.parentNode !== code) code.appendChild(textarea);
    textarea.spellcheck = false;
    textarea.setAttribute('autocomplete', 'off');
    textarea.setAttribute('autocapitalize', 'off');
    textarea.setAttribute('autocorrect', 'off');
    textarea.setAttribute('wrap', 'off');
    if (!textarea.id) textarea.id = 'i486-source';
    if (!textarea.getAttribute('aria-label')) textarea.setAttribute('aria-label', 'assembly source');

    this.shell = shell;
    this.gutter = gutter;
    this.gutterInner = gutterInner;
    this.code = code;
    this.pre = pre;
    this.activeEl = activeEl;
    this.caretEl = caretEl;
    this.textarea = textarea;
  };

  Editor.prototype._bind = function () {
    var self = this;
    var ta = this.textarea;

    ta.addEventListener('scroll', function () { self._syncScroll(); }, { passive: true });

    ta.addEventListener('input', function () {
      if (self._composing) return;
      self._emitChange();
      self._scheduleRender();
    });

    ta.addEventListener('keydown', function (event) { self._onKeyDown(event); });
    ta.addEventListener('keyup', function () { self._emitCursor(); });
    ta.addEventListener('mouseup', function () { self._emitCursor(); });
    ta.addEventListener('focus', function () {
      self._caretOn = true;
      self._emitCursor();
    });
    ta.addEventListener('blur', function () {
      self._caretOn = false;
      if (self.caretEl) self.caretEl.hidden = true;
    });

    ta.addEventListener('compositionstart', function () { self._composing = true; });
    ta.addEventListener('compositionend', function () {
      self._composing = false;
      self._emitChange();
      self._scheduleRender(0);
    });

    this.gutter.addEventListener('mousedown', function (event) {
      var row = event.target && event.target.closest ? event.target.closest('.gc-line') : null;
      if (!row) return;
      event.preventDefault();
      var line = parseInt(row.getAttribute('data-line'), 10);
      if (line > 0) self.toggleBreakpoint(line);
    });
  };

  Editor.prototype._adopt = function (options) {
    if (!options) return;
    var map = { onChange: 'change', onCursor: 'cursor', onAssemble: 'assemble', onBreakpoint: 'breakpoint' };
    for (var key in map) {
      if (!hasOwn(map, key)) continue;
      var fn = options[key];
      if (typeof fn !== 'function') continue;
      var evt = map[key];
      var seen = this._adopted[evt] || (this._adopted[evt] = new Set());
      if (seen.has(fn)) continue;
      seen.add(fn);
      this.handlers[evt].push(fn);
    }
  };

  Editor.prototype._measure = function () {
    var lineHeight = 19;
    var padTop = 8;
    try {
      var cs = window.getComputedStyle(this.pre);
      var lh = parseFloat(cs.lineHeight);
      var pt = parseFloat(cs.paddingTop);
      if (isFinite(lh) && lh > 0) lineHeight = lh;
      if (isFinite(pt) && pt >= 0) padTop = pt;
    } catch (err) {
      lineHeight = 19;
    }
    this._lineH = lineHeight;
    this._padTop = padTop;
    this.activeEl.style.height = lineHeight + 'px';
    this.caretEl.style.height = lineHeight + 'px';
  };

  Editor.prototype._renderAll = function () {
    var text = this.textarea.value;
    this._text = text;
    this._lines = text.split('\n');
    this.pre.textContent = '';
    this.pre.appendChild(fragmentsFromHtml(highlightHtml(this._lines.join('\n'))));
    this._paintGutter();
    this._syncScroll();
    this._syncCursorVisual();
    this._placeOverlay(this.activeEl, this._activeLine);
    this.shell.classList.add('is-mounted');
  };

  Editor.prototype._renderDelta = function () {
    var text = this.textarea.value;
    if (text === this._text) return;
    var next = text.split('\n');
    var prev = this._lines;
    if (!prev || this.pre.children.length !== prev.length) {
      this._renderAll();
      return;
    }

    var start = 0;
    var shortest = Math.min(prev.length, next.length);
    while (start < shortest && prev[start] === next[start]) start++;
    var endOld = prev.length;
    var endNew = next.length;
    while (endOld > start && endNew > start && prev[endOld - 1] === next[endNew - 1]) {
      endOld--;
      endNew--;
    }

    if (endOld !== start || endNew !== start) {
      var frag = fragmentsFromHtml(highlightHtml(next.slice(start, endNew).join('\n')));
      var ref = this.pre.children[endOld] || null;
      for (var i = start; i < endOld; i++) this.pre.removeChild(this.pre.children[start]);
      if (ref && ref.parentNode === this.pre) this.pre.insertBefore(frag, ref);
      else this.pre.appendChild(frag);
    }

    var countChanged = next.length !== prev.length;
    this._text = text;
    this._lines = next;
    if (countChanged) this._paintGutter();
    this._syncScroll();
    this._syncCursorVisual();
    this._placeOverlay(this.activeEl, this._activeLine);
  };

  Editor.prototype._paintGutter = function () {
    var total = this._lines.length;
    var rows = this.gutterRows;
    var inner = this.gutterInner;

    while (rows.length < total) {
      var row = el('span', 'gc-line');
      var dot = el('span', 'gc-dot');
      dot.setAttribute('aria-hidden', 'true');
      var mark = el('span', 'gc-err');
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = '!';
      var num = el('span', 'gc-no');
      row.appendChild(dot);
      row.appendChild(mark);
      row.appendChild(num);
      inner.appendChild(row);
      rows.push(row);
    }
    while (rows.length > total) inner.removeChild(rows.pop());

    var current = this._curLine;
    for (var i = 0; i < total; i++) {
      var line = i + 1;
      var label = String(line);
      var node = rows[i];
      var no = node.lastChild;
      if (no.textContent !== label) no.textContent = label;
      if (node.getAttribute('data-line') !== label) node.setAttribute('data-line', label);

      var hasBp = this._bp[line] === true;
      if (node.classList.contains('is-bp') !== hasBp) node.classList.toggle('is-bp', hasBp);
      var hasErr = hasOwn(this._err, line);
      if (node.classList.contains('is-err') !== hasErr) node.classList.toggle('is-err', hasErr);
      var isCurrent = line === current;
      if (node.classList.contains('is-active') !== isCurrent) node.classList.toggle('is-active', isCurrent);

      var title = hasErr ? this._err[line].join('\n') : '';
      if ((node.getAttribute('title') || '') !== title) {
        if (title) node.setAttribute('title', title);
        else node.removeAttribute('title');
      }
    }

    if (this.gutter) this.gutter.style.setProperty('--ed-digits', String(Math.max(2, String(total).length)));
  };

  Editor.prototype._syncScroll = function () {
    var ta = this.textarea;
    var x = ta.scrollLeft || 0;
    var y = ta.scrollTop || 0;
    this.pre.style.transform = 'translate(' + (-x) + 'px,' + (-y) + 'px)';
    if (this.gutterInner) this.gutterInner.style.transform = 'translateY(' + (-y) + 'px)';
    if (this._caretOn) this._placeOverlay(this.caretEl, this._curLine || 1);
    this._placeOverlay(this.activeEl, this._activeLine);
  };

  Editor.prototype._placeOverlay = function (node, line) {
    if (!node) return;
    if (!line || line < 1) {
      node.hidden = true;
      return;
    }
    var top = (line - 1) * this._lineH + this._padTop - (this.textarea.scrollTop || 0);
    node.hidden = false;
    node.style.transform = 'translateY(' + top + 'px)';
  };

  Editor.prototype._syncCursorVisual = function () {
    var cursor = this.getCursor();
    if (this._caretOn) this._placeOverlay(this.caretEl, cursor.line);
    if (cursor.line !== this._curLine) {
      var rows = this.gutterRows;
      if (rows[this._curLine - 1]) rows[this._curLine - 1].classList.remove('is-active');
      if (rows[cursor.line - 1]) rows[cursor.line - 1].classList.add('is-active');
      this._curLine = cursor.line;
    }
    return cursor;
  };

  Editor.prototype._emitCursor = function () {
    var cursor = this._syncCursorVisual();
    this._fire('cursor', cursor);
    return cursor;
  };

  Editor.prototype._emitChange = function () {
    this._fire('change', this.textarea.value);
  };

  Editor.prototype._scheduleRender = function (delay) {
    var self = this;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(function () {
      self._timer = 0;
      self._renderDelta();
      self._emitCursor();
    }, typeof delay === 'number' ? delay : RENDER_DELAY);
  };

  Editor.prototype._fire = function (evt, arg) {
    var list = this.handlers[evt];
    if (!list || !list.length) return;
    for (var i = 0; i < list.length; i++) {
      try {
        list[i].call(this, arg, this);
      } catch (err) {
        if (typeof console !== 'undefined' && console.error) {
          console.error('I486.Editor: "' + evt + '" listener failed', err);
        }
      }
    }
  };

  Editor.prototype._onKeyDown = function (event) {
    if (this._composing || event.isComposing) return;
    var mod = event.ctrlKey || event.metaKey;

    if (mod && event.key === 'Enter') {
      event.preventDefault();
      this._fire('assemble', this.textarea.value);
      return;
    }
    if (mod && (event.key === 'b' || event.key === 'B')) {
      event.preventDefault();
      this.toggleBreakpoint(this.getCursor().line);
      return;
    }
    if (event.key === 'Tab' && !mod && !event.altKey) {
      event.preventDefault();
      this._tab();
      return;
    }
    if (event.key === 'Enter' && !mod && !event.altKey && !event.shiftKey) {
      event.preventDefault();
      this._newline();
    }
  };

  Editor.prototype._tab = function () {
    var ta = this.textarea;
    var start = ta.selectionStart;
    var end = ta.selectionEnd;
    var value = ta.value;
    if (start === end || value.slice(start, end).indexOf('\n') === -1) {
      this._insertText(INDENT);
      return;
    }
    var lineStart = value.lastIndexOf('\n', start - 1) + 1;
    var block = value.slice(lineStart, end);
    var parts = block.split('\n');
    var added = 0;
    var firstAdded = 0;
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i].length) continue;
      parts[i] = INDENT + parts[i];
      added += INDENT.length;
      if (i === 0) firstAdded = INDENT.length;
    }
    this._replaceRange(lineStart, end, parts.join('\n'));
    ta.selectionStart = start + firstAdded;
    ta.selectionEnd = end + added;
  };

  Editor.prototype._newline = function () {
    var ta = this.textarea;
    var pos = ta.selectionStart;
    var value = ta.value;
    var lineStart = value.lastIndexOf('\n', pos - 1) + 1;
    var match = /^[ \t]*/.exec(value.slice(lineStart, pos));
    var indent = match ? match[0] : '';
    if (pos - lineStart < indent.length) indent = indent.slice(0, pos - lineStart);
    this._insertText('\n' + indent);
  };

  Editor.prototype._insertText = function (text) {
    var ta = this.textarea;
    ta.focus();
    var ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch (err) {
      ok = false;
    }
    if (!ok) {
      var start = ta.selectionStart;
      var end = ta.selectionEnd;
      ta.setRangeText(text, start, end, 'end');
      this._afterProgrammaticEdit();
    }
  };

  Editor.prototype._replaceRange = function (start, end, text) {
    var ta = this.textarea;
    ta.focus();
    ta.selectionStart = start;
    ta.selectionEnd = end;
    var ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch (err) {
      ok = false;
    }
    if (!ok) {
      ta.setRangeText(text, start, end, 'end');
      this._afterProgrammaticEdit();
    }
  };

  Editor.prototype._afterProgrammaticEdit = function () {
    this._emitChange();
    this._scheduleRender(0);
    this._emitCursor();
  };

  Editor.prototype.getValue = function () {
    return this.textarea ? this.textarea.value : '';
  };

  Editor.prototype.setValue = function (value) {
    if (!this.textarea) return this;
    this.textarea.value = value == null ? '' : String(value);
    this.textarea.selectionStart = this.textarea.selectionEnd = 0;
    this.textarea.scrollTop = 0;
    this.textarea.scrollLeft = 0;
    this._renderAll();
    this._emitCursor();
    return this;
  };

  Editor.prototype.insert = function (text) {
    this._insertText(text == null ? '' : String(text));
    return this;
  };

  Editor.prototype.focus = function () {
    this.textarea.focus();
    return this;
  };

  Editor.prototype.setErrors = function (list) {
    var map = Object.create(null);
    if (list && list.length) {
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        if (!item) continue;
        var line = parseInt(item.line, 10);
        if (!(line > 0)) continue;
        if (!map[line]) map[line] = [];
        map[line].push(String(item.message == null ? 'error' : item.message));
      }
    }
    this._err = map;
    this._paintGutter();
    return this;
  };

  Editor.prototype.clearErrors = function () {
    this._err = Object.create(null);
    this._paintGutter();
    return this;
  };

  Editor.prototype.setActiveLine = function (line) {
    var target = parseInt(line, 10);
    this._activeLine = target > 0 ? target : 0;
    this._placeOverlay(this.activeEl, this._activeLine);
    return this;
  };

  Editor.prototype.setBreakpoints = function (lines) {
    var map = Object.create(null);
    if (lines && lines.length) {
      for (var i = 0; i < lines.length; i++) {
        var line = parseInt(lines[i], 10);
        if (line > 0) map[line] = true;
      }
    }
    this._bp = map;
    this._paintGutter();
    return this;
  };

  Editor.prototype.toggleBreakpoint = function (line) {
    var target = parseInt(line, 10);
    if (!(target > 0)) return false;
    if (this._bp[target]) delete this._bp[target];
    else this._bp[target] = true;
    var row = this.gutterRows[target - 1];
    if (row) row.classList.toggle('is-bp', this._bp[target] === true);
    this._fire('breakpoint', this.getBreakpointLines());
    return this._bp[target] === true;
  };

  Editor.prototype.getBreakpointLines = function () {
    var lines = [];
    for (var key in this._bp) {
      if (this._bp[key] === true) lines.push(parseInt(key, 10));
    }
    lines.sort(function (a, b) { return a - b; });
    return lines;
  };

  Editor.prototype.getCursor = function () {
    var ta = this.textarea;
    if (!ta) return { line: 1, col: 1 };
    var value = ta.value;
    var pos = ta.selectionStart || 0;
    if (pos > value.length) pos = value.length;
    var line = 1;
    var last = -1;
    for (var i = 0; i < pos; i++) {
      if (value.charCodeAt(i) === 10) {
        line++;
        last = i;
      }
    }
    return { line: line, col: pos - last };
  };

  Editor.prototype.setCursor = function (line, col) {
    var ta = this.textarea;
    if (!ta) return this;
    var value = ta.value;
    var target = Math.max(1, parseInt(line, 10) || 1);
    var pos = 0;
    var current = 1;
    while (current < target) {
      var nl = value.indexOf('\n', pos);
      if (nl < 0) break;
      pos = nl + 1;
      current++;
    }
    var lineEnd = value.indexOf('\n', pos);
    if (lineEnd < 0) lineEnd = value.length;
    var column = Math.max(1, parseInt(col, 10) || 1);
    var at = Math.min(pos + column - 1, lineEnd);
    ta.selectionStart = ta.selectionEnd = at;
    this._reveal(current);
    this._syncCursorVisual();
    return this;
  };

  Editor.prototype._reveal = function (line) {
    var ta = this.textarea;
    var top = (line - 1) * this._lineH;
    var view = ta.clientHeight - this._padTop * 2;
    if (top < ta.scrollTop) ta.scrollTop = top;
    else if (top + this._lineH > ta.scrollTop + view) ta.scrollTop = top + this._lineH - view;
  };

  Editor.prototype.on = function (evt, fn) {
    if (typeof fn !== 'function') return this;
    var list = this.handlers[evt] || (this.handlers[evt] = []);
    list.push(fn);
    return this;
  };

  Editor.prototype.destroy = function () {
    if (this._timer) clearTimeout(this._timer);
    this._timer = 0;
    if (this.host) delete this.host.__i486EditorInstance;
  };

  Editor.prototype.isAttached = function () {
    var node = this.shell;
    while (node) {
      if (node === this.host) return true;
      node = node.parentNode;
    }
    return false;
  };

  function create(host, options) {
    if (!host) throw new Error('I486.Editor.create: host element required');
    var existing = host.__i486EditorInstance;
    if (existing && existing.isAttached()) {
      existing._adopt(options);
      return existing;
    }
    if (existing) delete host.__i486EditorInstance;
    var editor = new Editor(host, options);
    host.__i486EditorInstance = editor;
    return editor;
  }

  function selfMount() {
    if (typeof document === 'undefined') return;
    var host = document.querySelector('[data-i486="editor-host"]');
    if (!host || host.__i486EditorInstance) return;
    var textarea = host.querySelector('textarea[data-i486="source"]');
    if (!textarea) return;
    try {
      create(host, { textarea: textarea });
    } catch (err) {
      if (typeof console !== 'undefined' && console.error) console.error('I486.Editor: mount failed', err);
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', selfMount);
    else selfMount();
  }

  return { Editor: { create: create } };
});

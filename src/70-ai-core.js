/* ================= iCalPad assistant: the parts that do not touch the page =================
   Key storage, the streaming client, the worksheet tools and their checks, and the system prompt.
   This file runs in the browser and in Node (for the tests). It never contacts Anthropic by itself:
   a request is only made when the user has opened the assistant, entered a key and sent a message.
   Rules this code enforces:
   - iCalPad computes, the model writes. Tools add worksheet blocks; the engine produces every answer.
   - Everything the model writes goes through Core.parseStatement and Core.evalDoc, like typed input. No eval.
   - The API key lives in memory, sessionStorage, or (only if the user asks) localStorage. Nowhere else. */
const AICore = (() => {
'use strict';
const SYSTEM_MD = "__SYSTEM_MD__";
const API_URL = 'https://api.anthropic.com/v1/messages', API_VERSION = '2023-06-01';
const MODELS = [
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'balanced, the default' },
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'more capable' },
  { id: 'claude-fable-5-2', name: 'Claude Fable 5.2', note: 'most capable, highest cost' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'fastest, lowest cost' },
];
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MAX_TOOL_CALLS = 30, MAX_TOKENS = 16000, MAX_RETRIES = 4;
const LIMITS = { math: 600, text: 1500, heading: 160, caption: 120 };

// ---------- the API key ----------
const K_KEY = 'icalpad.ai.key', K_REM = 'icalpad.ai.remember';
function KeyStore(local, session) {
  let mem = '';
  const get = (st, k) => { try { return st ? st.getItem(k) : null; } catch (e) { return null; } };
  const put = (st, k, v) => { try { if (!st) return; if (v == null || v === '') st.removeItem(k); else st.setItem(k, v); } catch (e) { /* storage may be blocked */ } };
  const ks = {
    remembered: () => get(local, K_REM) === '1',
    get: () => mem || get(session, K_KEY) || (get(local, K_REM) === '1' ? get(local, K_KEY) : '') || '',
    has: () => !!ks.get(),
    set(key, remember) {
      key = String(key || '').trim(); mem = key;
      if (remember) { put(local, K_KEY, key); put(local, K_REM, '1'); put(session, K_KEY, null); }
      else { put(local, K_KEY, null); put(local, K_REM, null); put(session, K_KEY, key); }
    },
    setRemember(on) { ks.set(ks.get(), on); if (on && !ks.get()) put(local, K_REM, '1'); },
    forget() { mem = ''; put(local, K_KEY, null); put(local, K_REM, null); put(session, K_KEY, null); },
  };
  return ks;
}
/* Anything shown to the user or written to the console goes through scrub(), so a key can never leak into a message. */
function scrub(text, key) {
  let s = String(text == null ? '' : text);
  if (key && key.length >= 8) s = s.split(key).join('[hidden key]');
  return s.replace(/sk-ant-[A-Za-z0-9_\-]{6,}/g, '[hidden key]');
}
const looksLikeKey = k => /^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(String(k || '').trim());

// ---------- errors ----------
class AIError extends Error { constructor(kind, message, extra) { super(message); this.kind = kind; Object.assign(this, extra || {}); } }
function httpError(status, detail, key) {
  const d = detail ? ' ' + scrub(detail, key).slice(0, 300) : '';
  const msg = status === 401 ? 'Anthropic did not accept the API key (401). Check the key in the assistant settings.'
    : status === 403 ? 'This API key is not allowed to do that (403).' + d
    : status === 404 ? 'Anthropic did not find that model (404). Pick another model in the assistant settings.' + d
    : status === 413 ? 'The message is too large (413). Try a smaller picture or a shorter PDF.'
    : status === 429 ? 'Rate limit reached (429). Wait a minute, then try again.' + d
    : status === 529 ? 'Anthropic is overloaded right now (529). Try again in a minute.'
    : status === 400 ? 'Anthropic rejected the request (400).' + d
    : status >= 500 ? `Anthropic had a server error (${status}). Try again in a moment.`
    : `The request failed (${status}).` + d;
  return new AIError(status === 401 ? 'auth' : status === 429 ? 'rate' : status === 529 ? 'overloaded' : 'http', msg, { status });
}
const RETRY = new Set([429, 500, 502, 503, 504, 529]);
const sleepFor = (ms, signal) => new Promise((res, rej) => {
  if (signal && signal.aborted) return rej(new AIError('abort', 'Stopped'));
  const t = setTimeout(res, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); rej(new AIError('abort', 'Stopped')); }, { once: true });
});

// ---------- streaming (server-sent events) ----------
function sseParser(onEvent) {
  let buf = '', ev = '', data = [];
  const dispatch = () => { if (data.length) { const raw = data.join('\n'); let j = null; try { j = JSON.parse(raw); } catch (e) { j = null; } if (j) onEvent(ev || j.type, j); } ev = ''; data = []; };
  return {
    push(chunk) {
      buf += chunk; let i;
      while ((i = buf.search(/\r?\n/)) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + (buf[i] === '\r' ? 2 : 1));
        if (line === '') dispatch();
        else if (line.startsWith('event:')) ev = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
    },
    end() { if (buf) { this.push('\n'); } dispatch(); },
  };
}
/* Builds one assistant message from the stream. Thinking blocks are kept whole (with signatures), because the API needs them back unchanged during a tool loop. */
function assembler(cb = {}) {
  const msg = { content: [], stop_reason: null, usage: {} }, json = {};
  const on = (type, d) => {
    if (type === 'message_start') { msg.id = d.message && d.message.id; Object.assign(msg.usage, (d.message && d.message.usage) || {}); }
    else if (type === 'content_block_start') {
      const b = JSON.parse(JSON.stringify(d.content_block || {}));
      if (b.type === 'tool_use') { json[d.index] = ''; b.input = {}; }
      if (b.type === 'text') b.text = b.text || '';
      if (b.type === 'thinking') { b.thinking = b.thinking || ''; b.signature = b.signature || ''; }
      msg.content[d.index] = b; if (cb.onBlockStart) cb.onBlockStart(b, d.index);
    } else if (type === 'content_block_delta') {
      const b = msg.content[d.index], x = d.delta || {}; if (!b) return;
      if (x.type === 'text_delta') { b.text += x.text; if (cb.onText) cb.onText(x.text, d.index); }
      else if (x.type === 'input_json_delta') json[d.index] += x.partial_json || '';
      else if (x.type === 'thinking_delta') b.thinking += x.thinking || '';
      else if (x.type === 'signature_delta') b.signature = (b.signature || '') + (x.signature || '');
      else if (x.type === 'citations_delta') (b.citations = b.citations || []).push(x.citation);
    } else if (type === 'content_block_stop') {
      const b = msg.content[d.index]; if (!b) return;
      if (b.type === 'tool_use') { try { b.input = json[d.index] ? JSON.parse(json[d.index]) : {}; } catch (e) { b.input = {}; b._badJson = true; } }
      if (cb.onBlockStop) cb.onBlockStop(b, d.index);
    } else if (type === 'message_delta') {
      if (d.delta && d.delta.stop_reason) msg.stop_reason = d.delta.stop_reason;
      if (d.usage) Object.assign(msg.usage, d.usage);
    } else if (type === 'error') {
      const e = d.error || {};
      throw new AIError(e.type === 'overloaded_error' ? 'overloaded' : 'stream', e.type === 'overloaded_error' ? 'Anthropic is overloaded right now (529). Try again in a minute.' : 'The response stopped with an error: ' + (e.message || e.type || 'unknown'), { retryable: e.type === 'overloaded_error' || e.type === 'api_error' });
    }
  };
  return { msg, on };
}
async function readStream(res, onEvent, signal) {
  const p = sseParser(onEvent);
  if (!res.body || !res.body.getReader) { p.push(await res.text()); p.end(); return; }
  const rd = res.body.getReader(), dec = new TextDecoder();
  const stop = () => { try { rd.cancel(); } catch (e) { /* already closed */ } };
  if (signal) signal.addEventListener('abort', stop, { once: true });
  try {
    for (;;) {
      if (signal && signal.aborted) throw new AIError('abort', 'Stopped');
      const { done, value } = await rd.read();
      if (done) break;
      p.push(dec.decode(value, { stream: true }));
    }
    p.end();
  } finally { if (signal) signal.removeEventListener('abort', stop); }
  if (signal && signal.aborted) throw new AIError('abort', 'Stopped');
}
/* One request, retried with backoff on 429, 529 and 5xx. Honors retry-after. */
async function request({ fetchFn, key, body, signal, onStatus, sleep = sleepFor }) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchFn(API_URL, {
        method: 'POST', signal, body: JSON.stringify(body),
        headers: { 'x-api-key': key, 'anthropic-version': API_VERSION, 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
      });
    } catch (e) {
      if ((signal && signal.aborted) || (e && e.name === 'AbortError')) throw new AIError('abort', 'Stopped');
      throw new AIError('network', 'Could not reach Anthropic. Check your internet connection, then try again.');
    }
    if (res.ok) return res;
    let detail = ''; try { const j = await res.json(); detail = (j && j.error && j.error.message) || ''; } catch (e) { /* no body */ }
    if (RETRY.has(res.status) && attempt < MAX_RETRIES) {
      const ra = parseFloat(res.headers && res.headers.get && res.headers.get('retry-after'));
      const ms = ra > 0 ? Math.min(60, ra) * 1000 : Math.min(30000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 250);
      if (onStatus) onStatus({ kind: 'retry', status: res.status, attempt: attempt + 1, ms, text: `${res.status === 429 ? 'Rate limited' : res.status === 529 ? 'Anthropic is busy' : 'Server error'} (${res.status}). Trying again in ${Math.round(ms / 1000)} s…` });
      await sleep(ms, signal); continue;
    }
    throw httpError(res.status, detail, key);
  }
}

// ---------- worksheet tools ----------
const TOOLS = [
  { name: 'get_syntax_guide', description: 'Returns the iCalPad syntax guide: block types, math line forms, functions, units. It is generated from the running code.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_worksheet', description: 'Returns every block on the worksheet in reading order, with its id, type, content and status (ok or the exact error). Values are not included; use get_result for those.', input_schema: { type: 'object', properties: {} } },
  { name: 'add_block', description: 'Adds one block. Types: heading, text, note (a highlighted remark), definition (name := value), equation (a relation shown as written, such as M = w*L^2/8 or x^2 + 3 = 7, or a check such as M <= 100 kN*m), result (an expression ending with =, = unit or ->, which iCalPad evaluates), image (a source picture; content is an image_ref such as img1). The block is checked and evaluated. If it has an error it is not added and the exact error is returned.', input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['heading', 'text', 'note', 'definition', 'equation', 'result', 'image'] }, content: { type: 'string', description: 'The block content in iCalPad syntax. One line for math and headings.' }, after_id: { type: 'string', description: 'Put the new block right below this block. Leave out to add at the end of the page.' }, level: { type: 'integer', enum: [1, 2, 3], description: 'Heading level (1 is largest). Default 2.' } }, required: ['type', 'content'] } },
  { name: 'edit_block', description: 'Replaces the content of an existing heading, text, note or math block. Checked like add_block; on an error nothing changes and the exact error is returned.', input_schema: { type: 'object', properties: { id: { type: 'string' }, content: { type: 'string' }, type: { type: 'string', enum: ['heading', 'text', 'note', 'definition', 'equation', 'result'], description: 'Leave out to keep the current type.' } }, required: ['id', 'content'] } },
  { name: 'move_block', description: 'Moves a block to just below another block (after_id), or to the top of the page when after_id is left out. A move that would break a calculation is undone and the error is returned.', input_schema: { type: 'object', properties: { id: { type: 'string' }, after_id: { type: 'string' } }, required: ['id'] } },
  { name: 'delete_block', description: 'Deletes a block. If other blocks would then have errors, nothing is deleted and those errors are returned, unless force is true.', input_schema: { type: 'object', properties: { id: { type: 'string' }, force: { type: 'boolean' } }, required: ['id'] } },
  { name: 'evaluate', description: 'Recalculates the worksheet and returns any blocks with errors.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_result', description: 'Returns the value iCalPad computed for a result or check block, exactly as shown on the worksheet. Use it only to read or explain results; never type the value into the worksheet.', input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'attach_source_image', description: 'Places a picture the user sent in this chat on the worksheet as a collapsible source reference, so the user can compare it with what you wrote.', input_schema: { type: 'object', properties: { image_ref: { type: 'string', description: 'The reference given with the attachment, such as img1.' }, caption: { type: 'string', description: 'A short caption, for example "Source: hand calculation".' }, after_id: { type: 'string' }, collapsed: { type: 'boolean', description: 'Start folded. Default false.' } }, required: ['image_ref'] } },
];
const TOOL_NAMES = new Set(TOOLS.map(t => t.name));

/* AST helpers over parseStatement trees (no evaluation). */
const isUnitName = n => !!(Core.UNITS[n] || n === 'deg');
function unitOnly(x) {
  if (!x) return false;
  if (x.t === 'sym') return isUnitName(x.name);
  if (x.t === 'bin' && (x.op === '*' || x.op === '/')) return unitOnly(x.l) && unitOnly(x.r);
  if (x.t === 'bin' && x.op === '^') return unitOnly(x.l) && (x.r.t === 'num' || (x.r.t === 'neg' && x.r.x.t === 'num'));
  return false;
}
/* A typed number, possibly with units: 90, -2.5, 90 kN*m, 20 kN/m. Nothing calculated. */
function literalQty(x) {
  if (!x) return false;
  if (x.t === 'num') return true;
  if (x.t === 'neg') return literalQty(x.x);
  if (x.t === 'bin' && x.op === '*') return (literalQty(x.l) && unitOnly(x.r)) || (unitOnly(x.l) && literalQty(x.r));
  if (x.t === 'bin' && x.op === '/') return literalQty(x.l) && unitOnly(x.r);
  return false;
}
function parseMath(src) { try { return { st: Core.parseStatement(src) }; } catch (e) { return { err: (e && e.message) || 'This line could not be read' }; } }
function mathType(src) {
  const { st } = parseMath(src); if (!st) return 'math';
  return st.kind === 'def' ? 'definition' : st.kind === 'eval' ? 'result' : st.kind === 'empty' ? 'math' : 'equation';
}
function blockType(rg) {
  if (rg.type === 'text') return rg.kind === 'note' ? 'note' : /^#{1,3}\s/.test(rg.src || '') ? 'heading' : 'text';
  if (rg.type === 'image') return rg.ref ? 'source_image' : rg.img ? 'picture' : 'sketch';
  if (rg.type === 'plot') return 'plot';
  return mathType(rg.src || '');
}
function blockContent(rg) {
  if (rg.type === 'text') return blockType(rg) === 'heading' ? rg.src.replace(/^#{1,3}\s+/, '') : rg.src;
  if (rg.type === 'image') return rg.cap || '';
  if (rg.type === 'plot') return `${rg.exprs} | ${rg.xvar} from ${rg.x0} to ${rg.x1}`;
  return rg.src;
}
function statusOf(rg, results) {
  const r = results && results.get(rg.id); if (!r) return 'ok';
  if (r.err) return 'error: ' + r.err;
  if (r.pending) return 'waiting for the advanced solver';
  return 'ok';
}
function errorsOf(regions, results) { const m = new Map(); for (const rg of regions) { const r = results.get(rg.id); if (r && r.err) m.set(rg.id, r.err); } return m; }
function newErrors(before, after, skip) { const out = []; for (const [id, err] of after) if (id !== skip && before.get(id) !== err) out.push({ id, error: err }); return out; }

/* Text, headings and notes may not state values with "=", unless the number is a given typed in a math block on the page. */
function textStatesValue(text, regions) {
  const typed = new Set(); for (const rg of regions) if (rg.type === 'math') for (const m of String(rg.src).matchAll(/\d+(?:\.\d+)?/g)) typed.add(String(+m[0]));
  for (const m of String(text).matchAll(/(?:=|≈|\\approx)\s*\$?\s*(-?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?)/g)) { const n = String(+m[1].replace(',', '.')); if (!typed.has(n)) return m[0].trim(); }
  return null;
}
/* Checks content for a block type. Returns { src, kind? } for the region, or { error }. */
function checkContent(type, content, level, regions, selfId) {
  if (typeof content !== 'string') return { error: 'content must be a string.' };
  const c = content.replace(/\r\n?/g, '\n').trim();
  if (!c) return { error: 'content is empty.' };
  if (type === 'heading' || type === 'text' || type === 'note') {
    if (type === 'heading' && c.includes('\n')) return { error: 'A heading must be one line.' };
    if (c.length > (type === 'heading' ? LIMITS.heading : LIMITS.text)) return { error: `Too long: keep a ${type} under ${type === 'heading' ? LIMITS.heading : LIMITS.text} characters.` };
    const said = textStatesValue(c, regions.filter(r => r.id !== selfId));
    if (said) return { error: `A ${type} block cannot state a value ("${said}"). Put given values in definitions (name := value unit) and let result lines (name =) show computed values.` };
    if (type === 'heading') { const lv = [1, 2, 3].includes(level) ? level : 2; return { region: { type: 'text', src: /^#{1,3}\s/.test(c) ? c : '#'.repeat(lv) + ' ' + c, w: 760 } }; }
    if (/^#{1,3}\s/.test(c)) return { error: 'Text starting with # becomes a heading. Use type heading, or remove the #.' };
    return { region: type === 'note' ? { type: 'text', kind: 'note', src: c, w: 560 } : { type: 'text', src: c, w: 640 } };
  }
  if (type === 'definition' || type === 'equation' || type === 'result') {
    if (c.includes('\n')) return { error: 'A math block must be one line. Add one block per line.' };
    if (c.length > LIMITS.math) return { error: `Too long: keep a math line under ${LIMITS.math} characters.` };
    const p = parseMath(c); if (p.err) return { error: p.err };
    const st = p.st;
    if (type === 'definition') {
      if (st.kind !== 'def') return { error: 'A definition needs :=, for example  w := 20 kN/m' };
      if (literalQty(st.expr)) {
        for (const rg of regions) {
          if (rg.id === selfId || rg.type !== 'math') continue;
          const q = parseMath(rg.src).st; if (!q) continue;
          const name = q.kind === 'def' ? q.name : q.kind === 'expr' && q.expr.t === 'rel' && q.expr.op === '=' && q.expr.l.t === 'sym' ? q.expr.l.name : null;
          const rhs = q.kind === 'def' ? q.expr : name ? q.expr.r : null;
          if (name === st.name && rhs && !literalQty(rhs)) return { error: `${st.name} is calculated by iCalPad in block ${rg.id}. Do not type its value; add a result line such as  ${st.name} =  instead.` };
        }
      }
    } else if (type === 'result') {
      if (st.kind !== 'eval') return { error: st.kind === 'def' ? 'This is a definition (it uses :=). Use type definition, then add a result line such as  name =' : 'A result line ends with = , = unit, or ->, for example  M =   or   M = kN*m   or   x ->' };
      if (st.show === 'num' && !st.unit && literalQty(st.expr)) return { error: 'This result line only repeats a typed number. A result must be calculated from names defined above (for example  M = ), or convert units (for example  5 ft + 3 in = cm).' };
    } else {
      if (st.kind === 'def') return { error: 'This line uses :=, so it is a definition. Use type definition.' };
      if (st.kind === 'eval') return { error: 'This line ends with = or ->, so it is a result line. Use type result.' };
      const e = st.expr;
      if (e.t === 'rel' && e.op === '=' && e.l.t === 'sym' && literalQty(e.r)) return { error: `Write a given value as a definition:  ${e.l.name} := ...  (type definition). Never type a calculated value; use a result line such as  ${e.l.name} =` };
    }
    return { region: { type: 'math', src: c } };
  }
  return { error: `Unknown block type "${type}". Use heading, text, note, definition, equation, result or image.` };
}

/* The tool executor. `doc` is the page (in the browser, the command layer; in tests, a fake built on Core.evalDoc).
   doc: regions(), region(id), results(), add(spec, afterId), edit(id, patch), move(id, afterId), positions(), setPositions(map),
        remove(id) -> copy, restore(copy), evaluate() -> results, addImage(src) -> key */
function Executor(doc, opt = {}) {
  const images = opt.images || new Map();                 // image_ref -> { src, name, mime }
  const log = [], changed = new Set(), actions = [];
  const exists = id => typeof id === 'string' && !!doc.region(id);
  const bad = (error, extra) => ({ ok: false, result: { error, ...(extra || {}) } });
  const good = result => ({ ok: true, result });
  const errs = () => errorsOf(doc.regions(), doc.results());
  const tools = {
    get_syntax_guide: () => good({ guide: syntaxGuide() }),
    get_worksheet: () => good({ blocks: doc.regions().map(rg => ({ id: rg.id, type: blockType(rg), content: blockContent(rg), status: statusOf(rg, doc.results()) })) }),
    evaluate() {
      const res = doc.evaluate(), list = doc.regions().filter(rg => res.get(rg.id) && res.get(rg.id).err).map(rg => ({ id: rg.id, content: blockContent(rg), error: res.get(rg.id).err }));
      return good({ blocks: doc.regions().length, errors: list, ok: !list.length });
    },
    get_result({ id }) {
      if (!exists(id)) return bad(`No block with id ${id}.`);
      const rg = doc.region(id), r = doc.results().get(id);
      if (rg.type !== 'math') return bad('Only math blocks have results.');
      if (!r) return bad('This block has not been evaluated.');
      if (r.err) return bad('This block has an error: ' + r.err);
      if (r.pending) return good({ id, status: 'waiting for the advanced solver' });
      if (r.kind === 'check') return good({ id, source: rg.src, check: r.check ? 'OK (true)' : 'NG (false)' });
      if (r.kind === 'def') return good({ id, source: rg.src, note: 'Definitions do not display a value. Add a result line such as  ' + (r.name || 'name') + ' =  to show it.' });
      if (r.kind === 'expr') return good({ id, source: rg.src, note: 'This equation is shown as written and has no computed value.' });
      return good({ id, source: rg.src, value: r.text, shown_as: 'computed by iCalPad' });
    },
    add_block({ type, content, after_id, level }) {
      if (after_id != null && !exists(after_id)) return bad(`No block with id ${after_id}. Use get_worksheet to see the ids.`);
      if (type === 'image') return tools.attach_source_image({ image_ref: content, after_id });
      const chk = checkContent(type, content, level, doc.regions(), null); if (chk.error) return bad(chk.error, { added: false });
      const before = errs(), rg = doc.add(chk.region, after_id || null), res = doc.evaluate(), r = res.get(rg.id);
      if (r && r.err) { doc.remove(rg.id); doc.evaluate(); return bad(r.err, { added: false, content: chk.region.src, note: 'Nothing was added. Fix the content and call add_block again.' }); }
      const broke = newErrors(before, errs(), rg.id);
      if (broke.length) { doc.remove(rg.id); doc.evaluate(); return bad('Adding this block breaks other blocks, so it was not added.', { added: false, broken: broke }); }
      log.push({ op: 'add', id: rg.id, src: rg.src }); changed.add(rg.id); actions.push({ op: 'Added', type, text: blockContent(rg), id: rg.id });
      return good({ id: rg.id, type: blockType(rg), status: statusOf(rg, res) });
    },
    edit_block({ id, content, type }) {
      if (!exists(id)) return bad(`No block with id ${id}.`);
      const rg = doc.region(id); if (rg.type !== 'math' && rg.type !== 'text') return bad('Only heading, text, note and math blocks can be edited.');
      const cur = blockType(rg), t = type || (['definition', 'equation', 'result', 'heading', 'text', 'note'].includes(cur) ? cur : rg.type === 'math' ? mathType(content) : 'text');
      if ((rg.type === 'math') !== ['definition', 'equation', 'result'].includes(t)) return bad(`Block ${id} is a ${cur} block and cannot become a ${t} block. Delete it and add a new one.`);
      const lvl = cur === 'heading' ? (/^(#{1,3})\s/.exec(rg.src) || ['', '##'])[1].length : 2;
      const chk = checkContent(t, content, lvl, doc.regions(), id); if (chk.error) return bad(chk.error, { changed: false });
      const old = { src: rg.src, kind: rg.kind, w: rg.w }, patch = { src: chk.region.src, kind: chk.region.kind };
      if (old.src === patch.src && old.kind === patch.kind) return good({ id, unchanged: true, status: statusOf(rg, doc.results()) });
      const before = errs(); doc.edit(id, patch); const res = doc.evaluate(), r = res.get(id);
      const undoEdit = () => { doc.edit(id, { src: old.src, kind: old.kind }); doc.evaluate(); };
      if (r && r.err) { undoEdit(); return bad(r.err, { changed: false, note: 'The block was left as it was.' }); }
      const broke = newErrors(before, errs(), id);
      if (broke.length) { undoEdit(); return bad('This change breaks other blocks, so it was not made.', { changed: false, broken: broke }); }
      log.push({ op: 'edit', id, old, now: patch.src }); changed.add(id); actions.push({ op: 'Changed', type: t, text: blockContent(doc.region(id)), from: old.src, id });
      return good({ id, type: blockType(doc.region(id)), status: statusOf(doc.region(id), res) });
    },
    move_block({ id, after_id }) {
      if (!exists(id)) return bad(`No block with id ${id}.`);
      if (after_id != null && !exists(after_id)) return bad(`No block with id ${after_id}.`);
      if (after_id === id) return bad('A block cannot move below itself.');
      const rg = doc.region(id), from = doc.positions(), before = errs();
      doc.move(id, after_id || null); doc.evaluate();
      const broke = newErrors(before, errs(), null);
      if (broke.length) { doc.setPositions(from); doc.evaluate(); return bad('This move breaks the calculation (a name would be used before it is defined), so the block was left where it was.', { moved: false, broken: broke }); }
      log.push({ op: 'move', id, from, to: doc.positions() }); changed.add(id); actions.push({ op: 'Moved', type: blockType(rg), text: blockContent(rg), id });
      return good({ id, moved: true });
    },
    delete_block({ id, force }) {
      if (!exists(id)) return bad(`No block with id ${id}.`);
      const before = errs(), rg = doc.region(id), what = { type: blockType(rg), text: blockContent(rg) }, copy = doc.remove(id); doc.evaluate();
      const broke = newErrors(before, errs(), id);
      if (broke.length && !force) { doc.restore(copy); doc.evaluate(); return bad('Deleting this block would break other blocks, so it was kept. Call again with force: true to delete anyway.', { deleted: false, broken: broke }); }
      log.push({ op: 'delete', id, copy }); changed.delete(id); actions.push({ op: 'Deleted', ...what, id });
      return good({ id, deleted: true, ...(broke.length ? { broken: broke } : {}) });
    },
    attach_source_image({ image_ref, caption, after_id, collapsed }) {
      const im = typeof image_ref === 'string' && images.get(image_ref.trim());
      if (!im) return bad(`No picture called ${image_ref} in this chat. Pictures the user sent are listed as img1, img2, …`);
      if (!/^data:image\/(png|jpeg|gif|webp);base64,/.test(im.src)) return bad('Only pictures can be placed on the worksheet. PDF pages cannot.');
      if (after_id != null && !exists(after_id)) return bad(`No block with id ${after_id}.`);
      const cap = String(caption || ('Source: ' + (im.name || 'picture'))).replace(/\s+/g, ' ').trim().slice(0, LIMITS.caption);
      const key = doc.addImage(im.src), ar = im.h && im.w ? im.h / im.w : 0.75;
      const rg = doc.add({ type: 'image', img: key, w: Math.min(460, Math.max(160, im.w || 460)), ar: Math.min(8, Math.max(0.05, ar)), ann: [], ref: true, cap, ...(collapsed ? { fold: true } : {}) }, after_id || null);
      doc.evaluate();
      log.push({ op: 'add', id: rg.id }); changed.add(rg.id); actions.push({ op: 'Attached', type: 'source image', text: cap, id: rg.id });
      return good({ id: rg.id, type: 'source_image' });
    },
  };
  function exec(name, input) {
    if (!TOOL_NAMES.has(name)) return bad(`Unknown tool ${name}.`);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('The tool input must be an object.');
    try { return tools[name](input); } catch (e) { return bad('The tool failed: ' + ((e && e.message) || 'unknown error')); }
  }
  return { exec, log, changed, actions };
}
/* Reverses one assistant turn, newest change first. Blocks the user changed afterwards are left alone and reported. */
function undoTurn(doc, log) {
  const skipped = [];
  for (let i = log.length - 1; i >= 0; i--) {
    const o = log[i];
    if (o.op === 'add') { const rg = doc.region(o.id); if (!rg) continue; if (o.src != null && rg.src !== o.src) { skipped.push(o.id); continue; } doc.remove(o.id); }
    else if (o.op === 'edit') { const rg = doc.region(o.id); if (!rg) continue; if (rg.src !== o.now) { skipped.push(o.id); continue; } doc.edit(o.id, { src: o.old.src, kind: o.old.kind }); }
    else if (o.op === 'move') {           // put back only the blocks that are still where this move left them
      const now = doc.positions(), back = {};
      for (const id in o.from) if (now[id] && o.to[id] && now[id].x === o.to[id].x && now[id].y === o.to[id].y) back[id] = o.from[id];
      doc.setPositions(back);
    }
    else if (o.op === 'delete') { if (!doc.region(o.id)) doc.restore(o.copy); }
  }
  doc.evaluate();
  return { skipped };
}

// ---------- the syntax guide and system prompt, generated from the running code ----------
function syntaxGuide() {
  const out = ['# iCalPad syntax (generated from the code that runs this page)', '',
    '## Block types for add_block',
    '- heading: one short line. level 1, 2 or 3.',
    '- text: one or two plain sentences. Math inside $ signs is typeset, for example $M_u$.',
    '- note: a highlighted remark: an assumption, a doubt, a flag on an equation that looks wrong.',
    '- definition: `name := expression`. Givens: `L := 6 m`. Derived: `M := w*L^2/8`. Functions: `f(x) := x^2 + 1`.',
    '- result: an expression ending with `=` (number), `= unit` (number in that unit) or `->` (exact symbolic answer, optionally followed by a keyword such as simplify, expand, factor, float). iCalPad fills in the answer.',
    '- equation: a relation shown as written, such as `x^2 + 3 = 7` or `M = w*L^2/8`. If the left side is a single name with no value yet, iCalPad also defines it. A comparison (`<=`, `>=`, `<`, `>`) gets an OK or NG stamp.',
    '- image: a source picture from this chat (content is its image_ref). Same as attach_source_image.',
    '', '## Rules',
    '- One statement per math block. Blocks are read top to bottom, then left to right; a name must be defined above where it is used.',
    '- Names: letters, digits, underscores for subscripts (M_max, sigma_y), and a trailing prime (fc\'). Greek letters are written as words (alpha, beta, sigma, phi, rho, epsilon, theta).',
    '- Multiplication can be implicit between a number and a unit (20 kN/m) but write * between names (w*L^2).',
    '- LaTeX input is accepted on a math line (for example \\frac{w L^2}{8} =).',
    '- Units attach to numbers: 20 kN/m, 4 ksi, 9.81 m/s^2. Mixed units are converted automatically.',
  ];
  for (const [h, rows] of HELP) {
    if (/working on the page/i.test(h)) continue;
    out.push('', '## ' + h); for (const [c, d] of rows) out.push(`- \`${c}\`: ${d}`);
  }
  out.push('', '## Functions', Object.keys(Core.FN).concat(Object.keys(Core.NF)).filter((v, i, a) => a.indexOf(v) === i).join(', '));
  out.push('', '## Operations that bind a variable', Object.keys(Core.BIND).join(', '));
  out.push('', '## Units', Object.keys(Core.UNITS).concat(['deg']).join(', '));
  out.push('', '## Constants', 'pi, e, inf, i (imaginary unit), g (standard gravity, a unit)');
  return out.join('\n');
}
const MODE_TEXT = {
  neat: 'Mode: Neat up. Convert only. Do not add steps, solve, or add result lines the source does not have unless I ask.',
  solve: 'Mode: Set up and solve. Write a title, the givens with units, assumptions, the equations in order, result lines so iCalPad computes the answers, and a short check.',
};
function systemPrompt() { return SYSTEM_MD.trim() + '\n\n' + syntaxGuide(); }
/* A compact view of the page sent with each message (ids, types, content, status; no values). */
function snapshot(regions, results, cap = 14000) {
  if (!regions.length) return 'The worksheet is empty.';
  const lines = []; let n = 0;
  for (const rg of regions) {
    const ln = `${rg.id} | ${blockType(rg)} | ${blockContent(rg).replace(/\n/g, ' / ')}${statusOf(rg, results) === 'ok' ? '' : ' | ' + statusOf(rg, results)}`;
    if (n + ln.length > cap) { lines.push(`… ${regions.length - lines.length} more blocks. Call get_worksheet to see them.`); break; }
    lines.push(ln); n += ln.length + 1;
  }
  return 'Current worksheet (id | type | content | status), in reading order:\n' + lines.join('\n');
}
function userContent({ text, mode, attachments, page }) {
  const blocks = [];
  for (const a of attachments || []) {
    if (a.mime === 'application/pdf') blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: a.data }, title: a.name ? String(a.name).slice(0, 200) : undefined });
    else blocks.push({ type: 'image', source: { type: 'base64', media_type: a.mime, data: a.data } });
  }
  const refs = (attachments || []).map(a => `${a.ref}: ${a.mime === 'application/pdf' ? 'PDF' : 'picture'}${a.name ? ' (' + String(a.name).slice(0, 80) + ')' : ''}`);
  const parts = [MODE_TEXT[mode] || MODE_TEXT.neat, page];
  if (refs.length) parts.push('Attached, in order: ' + refs.join('; ') + '.');
  parts.push('My message:\n' + (String(text || '').trim() || (refs.length ? 'Please write this on the worksheet.' : '')));
  blocks.push({ type: 'text', text: parts.join('\n\n') });
  return blocks;
}

// ---------- one assistant turn: stream, run tools, repeat ----------
function cleanAssistant(content) {
  return content.filter(b => b && !(b.type === 'text' && !b.text)).map(b => { if (b.type === 'tool_use') { const { _badJson, ...rest } = b; return rest; } if (b.type === 'text' && b.citations === undefined) { const { citations, ...rest } = b; return rest; } return b; });
}
const CACHEABLE = new Set(['text', 'image', 'document', 'tool_result', 'tool_use']);
/* Marks the end of the conversation so far for prompt caching, without changing the stored history. */
function withCacheMark(messages) {
  return messages.map((m, i) => i !== messages.length - 1 || !Array.isArray(m.content) ? m
    : { ...m, content: m.content.map((b, j) => j === m.content.length - 1 && CACHEABLE.has(b.type) ? { ...b, cache_control: { type: 'ephemeral' } } : b) });
}
async function runTurn({ fetchFn, key, model, messages, content, exec, signal, on = () => {}, sleep = sleepFor, maxTokens = MAX_TOKENS, usage }) {
  const last = messages[messages.length - 1];
  if (last && last.role === 'user') last.content = last.content.concat(content || []);
  else if (content && content.length) messages.push({ role: 'user', content });
  else throw new AIError('state', 'There is nothing to send.');
  usage = usage || {}; for (const k of ['input', 'output', 'cacheRead', 'cacheWrite', 'requests']) usage[k] = usage[k] || 0;
  let calls = 0, stop = null, limitHit = false;
  const system = [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }];
  for (let round = 0; round < MAX_TOOL_CALLS + 5; round++) {
    const body = { model, max_tokens: maxTokens, system, tools: TOOLS, messages: withCacheMark(messages), stream: true };
    let asm;
    for (let attempt = 0; ; attempt++) {
      const res = await request({ fetchFn, key, body, signal, sleep, onStatus: s => on('status', s) });
      on('status', { kind: 'streaming', text: 'Writing…' });
      asm = assembler({ onText: t => on('text', t), onBlockStart: b => { if (b.type === 'tool_use') on('tool_start', b); } });
      try { await readStream(res, asm.on, signal); break; }
      catch (e) {
        if (e.kind === 'abort') throw e;
        if (e.retryable && attempt < MAX_RETRIES && !asm.msg.content.some(b => b && b.type !== 'thinking')) { const ms = Math.min(30000, 1000 * 2 ** attempt); on('status', { kind: 'retry', text: `${e.message} Trying again in ${Math.round(ms / 1000)} s…` }); await sleep(ms, signal); continue; }
        throw e;
      }
    }
    const m = asm.msg; usage.requests++;
    usage.input += m.usage.input_tokens || 0; usage.output += m.usage.output_tokens || 0; usage.cacheRead += m.usage.cache_read_input_tokens || 0; usage.cacheWrite += m.usage.cache_creation_input_tokens || 0;
    const blocks = cleanAssistant(m.content);
    stop = m.stop_reason;
    if (blocks.length) messages.push({ role: 'assistant', content: blocks });
    on('message', { blocks, stop });
    if (stop === 'pause_turn') continue;
    if (stop !== 'tool_use') break;
    const results = [];
    for (const b of blocks) {
      if (b.type !== 'tool_use') continue;
      calls++;
      let r;
      if (calls > MAX_TOOL_CALLS) { limitHit = true; r = { ok: false, result: { error: `The limit of ${MAX_TOOL_CALLS} tool calls for this message was reached. Stop and summarize.` } }; }
      else r = await exec(b.name, b.input);
      on('tool', { name: b.name, input: b.input, ok: r.ok, result: r.result, n: calls });
      results.push({ type: 'tool_result', tool_use_id: b.id, content: JSON.stringify(r.result), ...(r.ok ? {} : { is_error: true }) });
    }
    messages.push({ role: 'user', content: results });
    if (limitHit) break;
  }
  return { usage, calls: Math.min(calls, MAX_TOOL_CALLS), stop, limitHit };
}

// ---------- safe rendering of model text ----------
/* Model text is untrusted. It is escaped first (Core.mdToHtml escapes before adding its own markup), so tags in it stay text. */
function renderSafe(text) {
  const src = String(text == null ? '' : text).replace(/[\u0001\u0002]/g, '').replace(/`[^`\n]+`/g, m => m.replace(/\*/g, '\u0001').replace(/\$/g, '\u0002'));   // keep * and $ inside code as typed
  return Core.mdToHtml(src).replace(/\u0001/g, '*').replace(/\u0002/g, '$');
}
function fmtUsage(u) {
  const f = n => Number(n || 0).toLocaleString('en-US');
  return `Tokens: ${f(u.input + u.cacheRead + u.cacheWrite)} in${u.cacheRead ? ` (${f(u.cacheRead)} cached)` : ''}, ${f(u.output)} out, ${u.requests} ${u.requests === 1 ? 'request' : 'requests'}`;
}
/* Counts pages in a PDF without a PDF library (an estimate). */
function pdfPages(bytes) { let s = ''; const n = Math.min(bytes.length, 8e6); for (let i = 0; i < n; i += 65536) s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(n, i + 65536))); return (s.match(/\/Type\s*\/Page(?![s\w])/g) || []).length; }

return { withCacheMark, MODELS, DEFAULT_MODEL, MAX_TOOL_CALLS, MAX_TOKENS, API_URL, API_VERSION, TOOLS, KeyStore, scrub, looksLikeKey, AIError, httpError, sseParser, assembler, readStream, request, runTurn,
  Executor, undoTurn, checkContent, literalQty, blockType, blockContent, syntaxGuide, systemPrompt, snapshot, userContent, renderSafe, fmtUsage, pdfPages, MODE_TEXT, SYSTEM_MD };
})();

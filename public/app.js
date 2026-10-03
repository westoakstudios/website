// language: JavaScript, file: public/app.js
const POLL_MS = 3000;
const tbody = document.querySelector('#clients tbody');
const table = document.querySelector('#clients');
const empty = document.querySelector('#empty');
const count = document.querySelector('#count');
const bulkCmd = document.querySelector('#bulk-cmd');
const bulkMsg = document.querySelector('#bulk-msg');
const amountInput = document.querySelector('#amount');
const sendBtn = document.querySelector('#send');

let filter = 'all';
let targetOf = 'all';
let targetMode = 'all';
let snapshot = [];

function ago(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

async function api(url, opts) {
  const r = await fetch(url, opts);
  if (r.status === 401) { location.href = '/login'; return null; }
  return r;
}

async function post(url, body, method = 'POST') {
  const r = await api(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r || !r.ok) return null;
  return r.json().catch(() => ({}));
}

function queueList(queue, ip) {
  const ul = document.createElement('ul');
  ul.className = 'queue-list';
  for (const { id, cmd } of queue) {
    const li = document.createElement('li');
    li.className = 'queue-item';
    const c = document.createElement('span');
    c.className = 'cmd';
    c.textContent = cmd;
    const btn = document.createElement('button');
    btn.className = 'cancel';
    btn.textContent = 'cancel';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      await post('/queue', { ip, id }, 'DELETE');
      poll();
    });
    li.append(c, btn);
    ul.append(li);
  }
  return ul;
}

function patchRow(tr, client) {
  const name = tr.querySelector('.c-name');
  const nextName = client.name || '—';
  if (name.textContent !== nextName) name.textContent = nextName;

  const st = tr.querySelector('.c-state');
  const stateText = client.online ? 'online' : 'offline';
  if (st.textContent !== stateText) {
    st.textContent = stateText;
    st.className = 'c-state ' + (client.online ? 'state-online' : 'state-offline');
  }

  const seen = tr.querySelector('.c-seen');
  const seenText = ago(client.lastSeen);
  if (seen.textContent !== seenText) seen.textContent = seenText;

  const queueCell = tr.querySelector('.c-queue');
  const sig = client.queue.map((q) => q.id).join(',');
  if (queueCell.dataset.sig !== sig) {
    queueCell.dataset.sig = sig;
    queueCell.replaceChildren();
    if (client.queue.length) queueCell.append(queueList(client.queue, client.ip));
  }
}

function makeRow(client) {
  const tr = document.createElement('tr');
  tr.dataset.ip = client.ip;

  const name = document.createElement('td');
  name.className = 'c-name';

  const ip = document.createElement('td');
  ip.textContent = client.ip;

  const st = document.createElement('td');
  st.className = 'c-state';

  const seen = document.createElement('td');
  seen.className = 'c-seen';

  const cmdCell = document.createElement('td');
  cmdCell.className = 'cmd-input';
  const form = document.createElement('form');
  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'command…';
  input.autocomplete = 'off';
  input.maxLength = 4096;
  const btn = document.createElement('button');
  btn.textContent = 'queue';
  form.append(input, btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = input.value.trim();
    if (!v) return;
    btn.disabled = true;
    try {
      const r = await post('/queue', { ip: client.ip, cmd: v });
      if (r) input.value = '';
    } finally {
      btn.disabled = false;
      poll();
    }
  });
  cmdCell.append(form);

  const queueCell = document.createElement('td');
  queueCell.className = 'c-queue';

  tr.append(name, ip, st, seen, cmdCell, queueCell);
  patchRow(tr, client);
  return tr;
}

function render() {
  const existing = new Map([...tbody.children].map((tr) => [tr.dataset.ip, tr]));
  const seen = new Set();
  const ordered = [];

  for (const client of snapshot) {
    seen.add(client.ip);
    const tr = existing.get(client.ip);
    if (tr) {
      patchRow(tr, client);
      ordered.push(tr);
    } else {
      ordered.push(makeRow(client));
    }
  }

  for (const [ip, tr] of existing) {
    if (!seen.has(ip)) tr.remove();
  }

  for (let i = 0; i < ordered.length; i++) {
    if (tbody.children[i] !== ordered[i]) {
      tbody.insertBefore(ordered[i], tbody.children[i] || null);
    }
  }

  applyFilter();
}

function applyFilter() {
  const rows = [...tbody.children];
  for (const tr of rows) {
    const stateText = tr.querySelector('.c-state').textContent;
    const pass = filter === 'all' || stateText === filter;
    tr.style.display = pass ? '' : 'none';
  }
  table.classList.toggle('hidden', rows.length === 0);
  empty.classList.toggle('hidden', rows.length > 0);
}

async function poll() {
  try {
    const r = await api('/clients');
    if (!r || !r.ok) throw new Error();
    snapshot = await r.json();
    render();
    const on = snapshot.filter((c) => c.online).length;
    const off = snapshot.length - on;
    count.textContent = `${on} online · ${off} offline`;
  } catch {
    count.textContent = 'server unreachable';
  }
}

document.querySelectorAll('.filters button').forEach((b) => {
  b.addEventListener('click', () => {
    filter = b.dataset.filter;
    document.querySelectorAll('.filters button').forEach((x) => x.classList.toggle('active', x === b));
    applyFilter();
  });
});

document.querySelectorAll('.targeting .seg button').forEach((b) => {
  b.addEventListener('click', () => {
    const group = b.closest('.seg');
    group.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    if (group.dataset.role === 'of') targetOf = b.dataset.of;
    if (group.dataset.role === 'mode') {
      targetMode = b.dataset.mode;
      amountInput.disabled = targetMode === 'all';
      if (targetMode === 'all') amountInput.value = '';
      if (targetMode === 'percent' && !amountInput.value) amountInput.value = 50;
      if (targetMode === 'count' && !amountInput.value) amountInput.value = 100;
    }
  });
});

// tag the seg groups so the click handler can tell them apart
document.querySelectorAll('.targeting .seg').forEach((g, i) => {
  g.dataset.role = i === 0 ? 'of' : 'mode';
});

sendBtn.addEventListener('click', async () => {
  const cmd = bulkCmd.value.trim();
  if (!cmd) return;

  let target;
  if (targetMode === 'all') {
    target = targetOf;
  } else {
    const n = Number(amountInput.value);
    if (!Number.isFinite(n) || n <= 0) {
      bulkMsg.textContent = 'enter a number';
      return;
    }
    target = targetMode === 'percent'
      ? { percent: n, of: targetOf }
      : { count: n, of: targetOf };
  }

  sendBtn.disabled = true;
  try {
    const r = await post('/queue-all', { target, cmd });
    if (r) {
      bulkMsg.textContent = `queued to ${r.queued} of ${r.pool} (${r.scope})`;
      bulkCmd.value = '';
    } else {
      bulkMsg.textContent = 'failed';
    }
  } finally {
    sendBtn.disabled = false;
    poll();
  }
});

poll();
setInterval(poll, POLL_MS);
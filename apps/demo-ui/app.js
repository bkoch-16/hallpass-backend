// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let currentEndpoint = null;

function getBaseUrl() {
  const stage = document.getElementById('stage-select').value;
  const group = getSelectedGroup();
  return group?.baseUrls?.[stage] ?? '';
}

function getSelectedGroup() {
  const sel = document.getElementById('group-select');
  return CONFIG.groups[parseInt(sel.value, 10)] ?? null;
}

function getSelectedSubgroup() {
  const group = getSelectedGroup();
  if (!group?.subgroups) return null;
  const sel = document.getElementById('subgroup-select');
  return group.subgroups[parseInt(sel.value, 10)] ?? null;
}

function getSelectedEndpoint() {
  const sel = document.getElementById('endpoint-select');
  const subgroup = getSelectedSubgroup();
  const group = getSelectedGroup();
  const endpoints = subgroup ? subgroup.endpoints : group?.endpoints;
  if (!endpoints) return null;
  return endpoints[parseInt(sel.value, 10)] ?? null;
}

// ---------------------------------------------------------------------------
// User bar
// ---------------------------------------------------------------------------

async function fetchMe() {
  const base = getBaseUrl();
  if (!base) return;
  try {
    const res = await fetch(base + '/api/users/me', { credentials: 'include' });
    const bar = document.getElementById('user-bar');
    const dot = document.getElementById('user-dot');
    const txt = document.getElementById('user-text');
    if (res.ok) {
      const data = await res.json();
      bar.classList.remove('unauthenticated');
      dot.classList.remove('grey');
      const stage = document.getElementById('stage-select').value;
      txt.textContent = [data.name, data.email, data.role, stage].filter(Boolean).join('  \u00b7  ');
    } else {
      bar.classList.add('unauthenticated');
      dot.classList.add('grey');
      txt.textContent = 'Not logged in';
    }
  } catch {
    // Network error — leave as-is
  }
}

// ---------------------------------------------------------------------------
// Render endpoint details
// ---------------------------------------------------------------------------

function renderEndpoint(ep) {
  currentEndpoint = ep;

  const badge = document.getElementById('method-badge');
  badge.textContent = ep.method;
  badge.className = 'method-badge method-' + ep.method;
  document.getElementById('url-display').textContent = ep.url.replace('{{Base}}', '');
  document.getElementById('description-text').textContent = ep.description;

  const pvCard = document.getElementById('path-var-card');
  const pvFields = document.getElementById('path-var-fields');
  pvFields.innerHTML = '';
  if (ep.pathVariables.length > 0) {
    for (const pv of ep.pathVariables) {
      pvFields.appendChild(makeFieldRow('path-' + pv.key, pv.key, pv.value));
    }
    pvCard.classList.remove('hidden');
  } else {
    pvCard.classList.add('hidden');
  }

  const qpCard = document.getElementById('query-param-card');
  const qpFields = document.getElementById('query-param-fields');
  qpFields.innerHTML = '';
  if (ep.queryParams.length > 0) {
    for (const qp of ep.queryParams) {
      qpFields.appendChild(makeFieldRow('query-' + qp.key, qp.key, qp.value));
    }
    qpCard.classList.remove('hidden');
  } else {
    qpCard.classList.add('hidden');
  }

  const bodyCard = document.getElementById('body-card');
  const bodyInput = document.getElementById('body-input');
  if (ep.body !== null) {
    bodyInput.value = ep.body;
    bodyCard.classList.remove('hidden');
  } else {
    bodyInput.value = '';
    bodyCard.classList.add('hidden');
  }

  document.getElementById('response-card').classList.add('hidden');
}

function makeFieldRow(id, key, defaultValue) {
  const row = document.createElement('div');
  row.className = 'field-row';
  const label = document.createElement('span');
  label.className = 'field-key';
  label.textContent = key;
  const input = document.createElement('input');
  input.className = 'field-input';
  input.id = id;
  input.value = defaultValue ?? '';
  input.placeholder = key;
  row.appendChild(label);
  row.appendChild(input);
  return row;
}

// ---------------------------------------------------------------------------
// Build request URL
// ---------------------------------------------------------------------------

function buildUrl(ep) {
  const base = getBaseUrl();
  let url = ep.url.replace('{{Base}}', base);

  for (const pv of ep.pathVariables) {
    const input = document.getElementById('path-' + pv.key);
    const val = input ? input.value.trim() : pv.value;
    url = url.replace(':' + pv.key, encodeURIComponent(val));
  }

  const params = [];
  for (const qp of ep.queryParams) {
    const input = document.getElementById('query-' + qp.key);
    const val = input ? input.value.trim() : '';
    if (val !== '') params.push(encodeURIComponent(qp.key) + '=' + encodeURIComponent(val));
  }
  if (params.length > 0) url += '?' + params.join('&');

  return url;
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

async function send() {
  const ep = currentEndpoint;
  if (!ep) return;

  const btn = document.getElementById('send-btn');
  btn.disabled = true;
  btn.textContent = 'Sending\u2026';

  const url = buildUrl(ep);
  const noBody = ['GET', 'HEAD', 'DELETE'].includes(ep.method);
  const bodyVal = document.getElementById('body-input').value.trim();

  const headers = {};
  for (const h of (ep.headers ?? [])) {
    headers[h.key] = h.value.replace('{{Base}}', getBaseUrl());
  }

  const opts = {
    method: ep.method,
    credentials: 'include',
    headers,
  };

  if (!noBody && bodyVal) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = bodyVal;
  }

  let status = 0;
  let statusLabel = 'Network Error';
  let bodyText = '';
  try {
    const res = await fetch(url, opts);
    status = res.status;
    statusLabel = res.status + (res.statusText ? ' ' + res.statusText : '');
    const ct = res.headers.get('content-type') ?? '';
    const raw = await res.text();
    if (ct.includes('application/json') && raw) {
      try { bodyText = JSON.stringify(JSON.parse(raw), null, 2); } catch { bodyText = raw; }
    } else {
      bodyText = raw || '(empty body)';
    }
  } catch (err) {
    bodyText = err.message;
  }

  const badge = document.getElementById('status-badge');
  badge.textContent = statusLabel;
  const cls = status >= 500 ? 'status-5xx' : status >= 400 ? 'status-4xx' : status >= 300 ? 'status-3xx' : 'status-2xx';
  badge.className = 'status-badge ' + (status ? cls : 'status-4xx');
  document.getElementById('response-body').textContent = bodyText;
  document.getElementById('response-card').classList.remove('hidden');

  btn.disabled = false;
  btn.textContent = 'Send \u2192';

  if (ep.url.includes('/auth/')) {
    await fetchMe();
  }
}

// ---------------------------------------------------------------------------
// Populate selectors
// ---------------------------------------------------------------------------

function populateStageSelect() {
  const sel = document.getElementById('stage-select');
  CONFIG.stages.forEach((stage) => {
    const opt = document.createElement('option');
    opt.value = stage;
    opt.textContent = stage;
    sel.appendChild(opt);
  });
  if (CONFIG.stages.includes('Prod')) sel.value = 'Prod';
}

function populateGroupSelect() {
  const sel = document.getElementById('group-select');
  sel.innerHTML = '';
  const sorted = CONFIG.groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => a.g.name.localeCompare(b.g.name));
  sorted.forEach(({ g, i }) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = g.name;
    sel.appendChild(opt);
  });
  return sorted[0]?.i ?? 0;
}

function populateSubgroupSelect(group) {
  const label = document.getElementById('subgroup-label');
  const sel = document.getElementById('subgroup-select');
  sel.innerHTML = '';

  if (!group?.subgroups?.length) {
    label.classList.add('hidden');
    return;
  }

  group.subgroups.forEach((sg, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = sg.name;
    sel.appendChild(opt);
  });
  label.classList.remove('hidden');
}

function populateEndpointSelect(endpoints) {
  const sel = document.getElementById('endpoint-select');
  sel.innerHTML = '';
  if (!endpoints) return;
  const sorted = endpoints
    .map((ep, i) => ({ ep, i }))
    .sort((a, b) => a.ep.name.localeCompare(b.ep.name));
  sorted.forEach(({ ep, i }) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = ep.method + '  ' + ep.name;
    sel.appendChild(opt);
  });
}

function getActiveEndpoints() {
  const group = getSelectedGroup();
  if (!group) return [];
  if (group.subgroups?.length) {
    const subgroup = getSelectedSubgroup();
    return subgroup?.endpoints ?? group.subgroups[0]?.endpoints ?? [];
  }
  return group.endpoints;
}

// ---------------------------------------------------------------------------
// Info panel toggle
// ---------------------------------------------------------------------------

function initInfoPanel() {
  const toggle = document.getElementById('info-toggle');
  const body = document.getElementById('info-panel-body');
  const icon = document.getElementById('info-toggle-icon');
  icon.style.transform = 'rotate(180deg)';
  toggle.addEventListener('click', () => {
    const collapsed = body.classList.toggle('collapsed');
    icon.style.transform = collapsed ? '' : 'rotate(180deg)';
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  initInfoPanel();
  populateStageSelect();
  const firstGroupIdx = populateGroupSelect();
  const firstGroup = CONFIG.groups[firstGroupIdx];
  populateSubgroupSelect(firstGroup);
  populateEndpointSelect(getActiveEndpoints());

  const ep = getSelectedEndpoint();
  if (ep) renderEndpoint(ep);

  document.getElementById('stage-select').addEventListener('change', fetchMe);

  document.getElementById('group-select').addEventListener('change', (e) => {
    const group = CONFIG.groups[parseInt(e.target.value, 10)];
    populateSubgroupSelect(group);
    populateEndpointSelect(getActiveEndpoints());
    const ep = getSelectedEndpoint();
    if (ep) renderEndpoint(ep);
  });

  document.getElementById('subgroup-select').addEventListener('change', () => {
    populateEndpointSelect(getActiveEndpoints());
    const ep = getSelectedEndpoint();
    if (ep) renderEndpoint(ep);
  });

  document.getElementById('endpoint-select').addEventListener('change', () => {
    const ep = getSelectedEndpoint();
    if (ep) renderEndpoint(ep);
  });

  document.getElementById('send-btn').addEventListener('click', send);

  fetchMe();
}

init();

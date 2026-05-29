// ── Mobile menu ──────────────────────────────────────────────────────────
(function () {
  const hamburger = document.getElementById('hamburger');
  const sidebar   = document.getElementById('sidebar');
  const overlay   = document.getElementById('sidebar-overlay');
  if (!hamburger) return;

  function openMenu()  { sidebar.classList.add('open');    overlay.classList.add('visible'); }
  function closeMenu() { sidebar.classList.remove('open'); overlay.classList.remove('visible'); }

  hamburger.addEventListener('click', () =>
    sidebar.classList.contains('open') ? closeMenu() : openMenu()
  );
  overlay.addEventListener('click', closeMenu);

  // Close when a nav link is tapped on mobile
  sidebar.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => {
      if (window.innerWidth <= 768) closeMenu();
    })
  );
})();

// ── Polling ───────────────────────────────────────────────────────────────
let activeFieldKey = null;
const dirtyFields = new Set(); // fields edited but not yet saved

document.addEventListener('focusin', e => {
  const el = e.target;
  if ((el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && el.dataset.field) {
    activeFieldKey = el.dataset.field;
  }
});

document.addEventListener('focusout', () => {
  activeFieldKey = null;
});

// Mark a field dirty as soon as the user starts typing
document.addEventListener('input', e => {
  const el = e.target;
  if ((el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && el.dataset.field) {
    dirtyFields.add(el.dataset.field);
  }
});

async function pollData() {
  try {
    const resp = await fetch('/api/data');
    if (!resp.ok) return;
    const data = await resp.json();

    // Update all plain [data-field] elements not currently focused
    document.querySelectorAll('[data-field]').forEach(el => {
      const key = el.dataset.field;
      if (key === activeFieldKey || dirtyFields.has(key)) return;
      if (data[key] === undefined || data[key] === null) return;
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        if (el.value !== String(data[key])) {
          el.value = data[key];
        }
      }
    });

    // Page-specific hook
    if (typeof window.onPollUpdate === 'function') {
      window.onPollUpdate(data);
    }
  } catch (e) {
    // silent — network blip
  }
}

// Start polling after a short delay
setTimeout(() => {
  pollData();
  setInterval(pollData, 5000);
}, 1000);


// ── Save helpers ──────────────────────────────────────────────────────────

async function saveField(key, value, btn) {
  return saveFields({ [key]: value }, btn);
}

async function saveFields(fields, btn) {
  if (btn) btn.disabled = true;
  try {
    const resp = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (resp.ok) {
      Object.keys(fields).forEach(k => dirtyFields.delete(k));
      flashSaved(btn);
    }
  } catch (e) {
    console.error('Save error:', e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function flashSaved(btn) {
  if (!btn) return;
  const orig = btn.textContent;
  btn.textContent = '✓ Сохранено';
  btn.classList.add('btn-success');
  btn.classList.remove('btn-primary');
  setTimeout(() => {
    btn.textContent = orig;
    btn.classList.remove('btn-success');
    btn.classList.add('btn-primary');
  }, 2000);
}


// ── Round-1: generate round-2 ─────────────────────────────────────────────

async function generateRound2(btn) {
  btn.disabled = true;
  btn.textContent = 'Копирую...';
  const resp = await fetch('/api/data');
  const data = await resp.json();
  await saveFields({
    r2_meanings:  data.r1_gen  || '',
    r2_problems:  data.r1_prob || '',
    r2_solutions: data.r1_sol  || '',
    r2_deeds:     data.r1_mak  || '',
    r2_export:    data.r1_exp  || '',
  });
  window.location.href = '/round/2';
}


// ── Round-2: dynamic lists ────────────────────────────────────────────────
// Items use timestamp-based IDs assigned at first save, e.g.:
//   r2_cc_1748523901234_text   – text of one cultural-code item
//   r2_cc_1748523901234_votes  – its vote count
//   r2_cc_1748523901234_del    – tombstone flag (item was deleted)
//
// No shared counter → no race condition between concurrent users.
// Each user's save writes to a unique key; no one overwrites anyone else.
// Editing a saved item re-writes the same key (safe: only one editor at a time).

function _reKey(s) {
  // Escape special regex chars in a string used inside RegExp()
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function makeDynamicList(containerId, fieldKey, maxItems) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  const isCC    = (fieldKey === 'r2_cc');
  const pattern = new RegExp('^' + _reKey(fieldKey) + '_(\\d+)_text$');

  function tKey(id) { return fieldKey + '_' + id + '_text'; }
  function vKey(id) { return fieldKey + '_' + id + '_votes'; }
  function dKey(id) { return fieldKey + '_' + id + '_del'; }

  // knownIds tracks all IDs currently rendered in DOM
  // (real timestamp IDs for saved items, '__new__N' for unsaved)
  const knownIds = new Set();
  let tempSeq = 0;

  function addRow(realId, text, votes, focusIt) {
    // realId = '' for a brand-new unsaved item
    const trackId = realId || ('__new__' + (++tempSeq));
    if (knownIds.has(trackId)) return; // already in DOM
    knownIds.add(trackId);

    const div = document.createElement('div');
    div.className        = 'list-item';
    div.dataset.realId   = realId;   // '' until first save
    div.dataset.trackId  = trackId;

    const ta = document.createElement('textarea');
    ta.rows        = 2;
    ta.placeholder = isCC ? 'Культурный код' : 'Городская проблема';
    ta.value       = text || '';
    // data-field only set once we have a real ID (enables poll sync + dirtyFields)
    if (realId) ta.dataset.field = tKey(realId);

    const vi = document.createElement('input');
    vi.type        = 'number'; vi.min = 0; vi.max = 99;
    vi.placeholder = 'Голоса'; vi.className = 'votes-input';
    vi.value       = (votes != null && votes !== '') ? votes : '';
    if (realId) vi.dataset.field = vKey(realId);

    const saveBtn = document.createElement('button');
    saveBtn.className   = 'btn btn-primary btn-sm';
    saveBtn.textContent = 'Записать';
    saveBtn.addEventListener('click', () => {
      let id = div.dataset.realId;

      if (!id) {
        // First save: mint a timestamp ID now
        id = Date.now().toString();
        div.dataset.realId = id;
        // Migrate tracking entry
        knownIds.delete(div.dataset.trackId);
        div.dataset.trackId = id;
        knownIds.add(id);
        // Wire up [data-field] so polling & dirtyFields work from here on
        ta.dataset.field = tKey(id);
        vi.dataset.field = vKey(id);
      }

      const f = {};
      f[tKey(id)] = ta.value;
      f[vKey(id)] = vi.value !== '' ? parseInt(vi.value) : null;
      saveFields(f, saveBtn);
    });

    const delBtn = document.createElement('button');
    delBtn.className   = 'btn btn-danger btn-sm';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => {
      const id = div.dataset.realId;
      knownIds.delete(div.dataset.trackId);
      div.remove();
      if (id) {
        // Write tombstone so the item never reappears via polling
        saveFields({ [dKey(id)]: 1 }, null);
        dirtyFields.delete(tKey(id));
        dirtyFields.delete(vKey(id));
      }
    });

    div.append(ta, vi, saveBtn, delBtn);
    container.appendChild(div);
    if (focusIt) ta.focus();
  }

  // Load items pre-rendered by the server (array of {id, text, votes})
  const initEl = document.getElementById(containerId + '-init');
  if (initEl) {
    try {
      const items = JSON.parse(initEl.textContent || '[]');
      items.forEach(it => addRow(it.id, it.text, it.votes, false));
    } catch (e) { /* ignore */ }
  }

  // "+ Добавить" — creates an unsaved row; ID is assigned on first save
  document.getElementById(containerId + '-add')?.addEventListener('click', () => {
    if (knownIds.size >= maxItems) return;
    addRow('', '', null, true);
  });

  // Hide the now-unused "save whole list" button if present
  const oldSaveBtn = document.getElementById(containerId + '-save');
  if (oldSaveBtn) oldSaveBtn.style.display = 'none';

  return {
    // Called by onPollUpdate every 5 s.
    // Scans server data for timestamp keys not yet in DOM and adds them.
    // Existing rows are updated field-by-field by the standard pollData() loop.
    sync(data) {
      Object.keys(data).forEach(key => {
        const m = key.match(pattern);
        if (!m) return;
        const id = m[1];
        if (knownIds.has(id)) return;       // already rendered
        if (data[dKey(id)]) return;         // tombstoned
        addRow(id, data[tKey(id)] || '', data[vKey(id)] ?? null, false);
      });
    },
  };
}

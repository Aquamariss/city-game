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
// Items are stored as individual fields per index:
//   {fieldKey}_count          – total number of items
//   {fieldKey}_{i}_text       – text of item i
//   {fieldKey}_{i}_votes      – votes for item i
// This lets dirty-field protection work per-item and lets polling
// add new items from other users without destroying unsaved edits.

function makeDynamicList(containerId, fieldKey, maxItems) {
  const container = document.getElementById(containerId);
  if (!container) return null;

  const countKey = fieldKey + '_count';
  const isCC     = (fieldKey === 'r2_cc');

  function tKey(i) { return fieldKey + '_' + i + '_text'; }
  function vKey(i) { return fieldKey + '_' + i + '_votes'; }

  let domCount = 0;

  function addRow(i, text, votes, focusIt) {
    const div = document.createElement('div');
    div.className  = 'list-item';
    div.dataset.rowIndex = i;

    const ta = document.createElement('textarea');
    ta.rows        = 2;
    ta.placeholder = isCC ? 'Культурный код' : 'Городская проблема';
    ta.value       = text || '';
    ta.dataset.field = tKey(i);

    const vi = document.createElement('input');
    vi.type        = 'number'; vi.min = 0; vi.max = 99;
    vi.placeholder = 'Голоса'; vi.className = 'votes-input';
    vi.value       = (votes != null && votes !== '') ? votes : '';
    vi.dataset.field = vKey(i);

    const saveBtn = document.createElement('button');
    saveBtn.className   = 'btn btn-primary btn-sm';
    saveBtn.textContent = 'Записать';
    saveBtn.addEventListener('click', () => {
      const idx = parseInt(div.dataset.rowIndex);
      const f = {};
      f[tKey(idx)] = ta.value;
      f[vKey(idx)] = vi.value !== '' ? parseInt(vi.value) : null;
      saveFields(f, saveBtn);
    });

    const delBtn = document.createElement('button');
    delBtn.className   = 'btn btn-danger btn-sm';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => deleteItem(div));

    div.append(ta, vi, saveBtn, delBtn);
    container.appendChild(div);
    domCount++;
    if (focusIt) ta.focus();
  }

  function getItems() {
    return Array.from(container.querySelectorAll('[data-row-index]')).map(row => {
      const v = row.querySelector('input[type=number]')?.value;
      return {
        text:  row.querySelector('textarea')?.value || '',
        votes: (v !== '' && v != null) ? parseInt(v) : null,
      };
    });
  }

  function clearListDirty() {
    for (let i = 0; i <= domCount + 1; i++) {
      dirtyFields.delete(tKey(i));
      dirtyFields.delete(vKey(i));
    }
    dirtyFields.delete(countKey);
  }

  function rebuild(items) {
    container.innerHTML = '';
    domCount = 0;
    items.forEach((it, i) => addRow(i, it.text, it.votes, false));
  }

  function deleteItem(div) {
    const items = getItems();
    const idx   = parseInt(div.dataset.rowIndex);
    items.splice(idx, 1);
    clearListDirty();
    rebuild(items);
    const f = { [countKey]: items.length };
    items.forEach((it, i) => { f[tKey(i)] = it.text; f[vKey(i)] = it.votes; });
    saveFields(f, null);
  }

  // Load initial data from embedded JSON
  const initEl = document.getElementById(containerId + '-init');
  if (initEl) {
    try {
      const d   = JSON.parse(initEl.textContent || '{}');
      const cnt = d.count || 0;
      for (let i = 0; i < cnt; i++) {
        addRow(i, d.items?.[i]?.text, d.items?.[i]?.votes, false);
      }
    } catch (e) { /* ignore */ }
  }

  // "+ Добавить" button
  document.getElementById(containerId + '-add')?.addEventListener('click', () => {
    if (domCount >= maxItems) return;
    const idx = domCount;
    saveFields({ [countKey]: idx + 1 }, null); // announce new slot to other users
    addRow(idx, '', null, true);
  });

  // Hide old "save whole list" button — each item has its own save
  const oldSaveBtn = document.getElementById(containerId + '-save');
  if (oldSaveBtn) oldSaveBtn.style.display = 'none';

  return {
    // Called by onPollUpdate — only adds rows for indices not yet in DOM.
    // Existing row values are synced by the standard [data-field] pollData() loop.
    sync(data) {
      const serverCount = typeof data[countKey] === 'number' ? data[countKey] : 0;
      for (let i = domCount; i < serverCount; i++) {
        addRow(i, data[tKey(i)] || '', data[vKey(i)] ?? null, false);
      }
    },
  };
}

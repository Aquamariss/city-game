// ── Polling ───────────────────────────────────────────────────────────────
let activeFieldKey = null;

document.addEventListener('focusin', e => {
  const el = e.target;
  if ((el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') && el.dataset.field) {
    activeFieldKey = el.dataset.field;
  }
});

document.addEventListener('focusout', () => {
  activeFieldKey = null;
});

async function pollData() {
  try {
    const resp = await fetch('/api/data');
    if (!resp.ok) return;
    const data = await resp.json();

    // Update all plain [data-field] elements not currently focused
    document.querySelectorAll('[data-field]').forEach(el => {
      const key = el.dataset.field;
      if (key === activeFieldKey) return;
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

function makeDynamicList(containerId, fieldKey, maxItems) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let items = [];

  function render() {
    container.innerHTML = '';
    items.forEach((item, i) => {
      const div = document.createElement('div');
      div.className = 'list-item';

      const ta = document.createElement('textarea');
      ta.rows = 2;
      ta.placeholder = fieldKey === 'r2_cultural_codes' ? 'Культурный код' : 'Городская проблема';
      ta.value = item.text || '';
      ta.addEventListener('input', () => { items[i].text = ta.value; });

      const votes = document.createElement('input');
      votes.type = 'number';
      votes.min = 0;
      votes.max = 99;
      votes.placeholder = 'Голоса';
      votes.className = 'votes-input';
      votes.value = item.votes != null ? item.votes : '';
      votes.addEventListener('input', () => {
        items[i].votes = votes.value !== '' ? parseInt(votes.value) : null;
      });

      const del = document.createElement('button');
      del.className = 'btn btn-danger btn-sm';
      del.textContent = '✕';
      del.addEventListener('click', () => {
        items.splice(i, 1);
        render();
      });

      div.appendChild(ta);
      div.appendChild(votes);
      div.appendChild(del);
      container.appendChild(div);
    });
  }

  // Add button
  const addBtn = document.getElementById(containerId + '-add');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      if (items.length >= maxItems) return;
      items.push({ text: '', votes: null });
      render();
    });
  }

  // Save button
  const saveBtn = document.getElementById(containerId + '-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      saveFields({ [fieldKey]: items }, saveBtn);
    });
  }

  // Load initial data from page
  const initEl = document.getElementById(containerId + '-init');
  if (initEl) {
    try {
      items = JSON.parse(initEl.textContent || '[]');
    } catch (e) {
      items = [];
    }
    render();
  }

  // Expose for polling updates
  return {
    update(newItems) {
      if (!activeFieldKey || !activeFieldKey.startsWith(fieldKey)) {
        items = newItems || [];
        render();
      }
    }
  };
}

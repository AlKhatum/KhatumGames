/**
 * Teyvat AU — Dashboard Application
 */

let nationsData = null;
let rulesData = null;
let engine = null;
let currentNation = null;
let turnLog = [];
let turnNumber = 1;
let pendingChanges = [];

// ─── Init ───

async function init() {
  try {
    const [nationsResp, rulesResp] = await Promise.all([
      fetch('data/nations.json'),
      fetch('data/rules.json')
    ]);
    nationsData = await nationsResp.json();
    rulesData = await rulesResp.json();

    engine = new CascadeEngine(rulesData, nationsData.metricsMeta);

    // restore from localStorage
    const saved = localStorage.getItem('teyvat_au_state');
    if (saved) {
      try {
        const state = JSON.parse(saved);
        if (state.nations) {
          for (const nation of nationsData.nations) {
            const savedNation = state.nations.find(n => n.id === nation.id);
            if (savedNation?.metrics) {
              nation.metrics = savedNation.metrics;
            }
          }
        }
        if (state.turnNumber) turnNumber = state.turnNumber;
        if (state.turnLog) turnLog = state.turnLog;
      } catch (e) { /* ignore corrupt save */ }
    }

    renderNationTabs();
    selectNation(nationsData.nations[0].id);
    updateTurnCounter();
    renderTurnLog();
  } catch (err) {
    document.getElementById('app').innerHTML =
      `<div class="error-msg">Ошибка загрузки данных: ${err.message}</div>`;
  }
}

// ─── State persistence ───

function saveState() {
  try {
    localStorage.setItem('teyvat_au_state', JSON.stringify({
      nations: nationsData.nations.map(n => ({ id: n.id, metrics: n.metrics })),
      turnNumber,
      turnLog: turnLog.slice(-200)
    }));
  } catch (e) { /* storage full — ignore */ }
}

// ─── Navigation ───

function renderNationTabs() {
  const container = document.getElementById('nation-tabs');
  container.innerHTML = '';
  for (const nation of nationsData.nations) {
    const tab = document.createElement('button');
    tab.className = 'nation-tab';
    tab.dataset.id = nation.id;
    tab.style.setProperty('--nation-color', nation.color);
    tab.innerHTML = `<span class="tab-dot" style="background:${nation.color}"></span>${nation.name}<a href="nation.html?id=${nation.id}&gm=1" class="tab-link" title="Страница нации (ГМ)" onclick="event.stopPropagation()">↗</a>`;
    tab.onclick = () => selectNation(nation.id);
    container.appendChild(tab);
  }
}

function selectNation(id) {
  currentNation = nationsData.nations.find(n => n.id === id);
  if (!currentNation) return;

  document.querySelectorAll('.nation-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.id === id);
  });

  renderNationHeader();
  renderMetricsGrid();
  renderWarnings();
  populateGMPanel();
}

// ─── Header ───

function renderNationHeader() {
  const n = currentNation;
  const header = document.getElementById('nation-header');
  header.innerHTML = `
    <div class="header-main">
      <h2 style="color:${n.color}">${n.name}</h2>
      <span class="header-subtitle">${n.fullName}</span>
    </div>
    <div class="header-tags">
      <span class="tag tag-era">${n.eraName}</span>
      <span class="tag tag-course">${n.courseName}</span>
      <span class="tag tag-element" style="border-color:${n.color}">${n.element}</span>
      <span class="tag tag-religion">${n.religion}</span>
    </div>
  `;
}

// ─── Metrics Grid ───

function renderMetricsGrid() {
  const grid = document.getElementById('metrics-grid');
  grid.innerHTML = '';

  const catOrder = [
    'economy', 'diplomacy', 'politics',
    'military_general', 'military_ground', 'military_air', 'military_naval',
    'culture'
  ];

  for (const catKey of catOrder) {
    const cat = nationsData.categories[catKey];
    const catMetrics = Object.entries(nationsData.metricsMeta)
      .filter(([, m]) => m.category === catKey);

    const stats = engine.getCategoryTotal(currentNation.metrics, catKey);

    const card = document.createElement('div');
    card.className = 'metric-card';
    card.style.setProperty('--cat-color', cat.color);

    let metricsHTML = '';
    for (const [key, meta] of catMetrics) {
      const val = currentNation.metrics[key];
      const colorClass = engine.getMetricColor(val);
      const pct = (val / 12 * 100).toFixed(0);

      metricsHTML += `
        <div class="metric-row" data-metric="${key}">
          <span class="metric-name" title="${meta.name}">${meta.name}</span>
          <div class="metric-bar-wrap">
            <div class="metric-bar metric-${colorClass}" style="width:${pct}%"></div>
          </div>
          <span class="metric-value metric-${colorClass}">${val}</span>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-header">
        <span class="card-icon">${cat.icon}</span>
        <span class="card-title">${cat.name}</span>
        <span class="card-avg" title="Среднее">${stats.avg}</span>
      </div>
      <div class="card-body">${metricsHTML}</div>
    `;

    grid.appendChild(card);
  }
}

// ─── Warnings ───

function renderWarnings() {
  const container = document.getElementById('warnings');
  const warnings = engine.getActiveWarnings(currentNation);

  if (warnings.length === 0) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = warnings.map(w => `
    <div class="warning-item warning-${w.severity}">
      <span class="warning-icon">${w.severity === 'critical' ? '🔴' : '⚠️'}</span>
      <div>
        <strong>${w.label}</strong>
        <p>${w.desc}</p>
      </div>
    </div>
  `).join('');
}

// ─── GM Panel ───

function populateGMPanel() {
  const select = document.getElementById('gm-metric-select');
  select.innerHTML = '';

  const catOrder = [
    'economy', 'diplomacy', 'politics',
    'military_general', 'military_ground', 'military_air', 'military_naval',
    'culture'
  ];

  for (const catKey of catOrder) {
    const cat = nationsData.categories[catKey];
    const group = document.createElement('optgroup');
    group.label = cat.name;

    const catMetrics = Object.entries(nationsData.metricsMeta)
      .filter(([, m]) => m.category === catKey);

    for (const [key, meta] of catMetrics) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = `${meta.name} [${currentNation.metrics[key]}]`;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }

  renderPendingChanges();
}

function addChange() {
  const metric = document.getElementById('gm-metric-select').value;
  const delta = parseInt(document.getElementById('gm-delta').value, 10);
  const reason = document.getElementById('gm-reason').value.trim();

  if (!metric || isNaN(delta) || delta === 0) return;

  pendingChanges.push({ metric, delta, reason });
  renderPendingChanges();

  document.getElementById('gm-delta').value = '';
  document.getElementById('gm-reason').value = '';
}

function removeChange(idx) {
  pendingChanges.splice(idx, 1);
  renderPendingChanges();
}

function renderPendingChanges() {
  const list = document.getElementById('pending-changes');
  if (pendingChanges.length === 0) {
    list.innerHTML = '<p class="empty-hint">Добавьте изменения через панель выше</p>';
    return;
  }

  list.innerHTML = pendingChanges.map((ch, i) => {
    const name = nationsData.metricsMeta[ch.metric]?.name || ch.metric;
    const sign = ch.delta > 0 ? '+' : '';
    return `
      <div class="pending-item">
        <span>${name}: <strong>${sign}${ch.delta}</strong></span>
        ${ch.reason ? `<span class="pending-reason">${ch.reason}</span>` : ''}
        <button class="btn-remove" onclick="removeChange(${i})">✕</button>
      </div>
    `;
  }).join('');
}

function applyChanges() {
  if (pendingChanges.length === 0 || !currentNation) return;

  const result = engine.applyTurnChanges(currentNation, pendingChanges);

  // log entry
  const logEntry = {
    turn: turnNumber,
    nation: currentNation.name,
    nationId: currentNation.id,
    timestamp: new Date().toISOString(),
    changes: pendingChanges.map(c => ({
      metric: c.metric,
      metricName: nationsData.metricsMeta[c.metric]?.name,
      delta: c.delta,
      reason: c.reason
    })),
    log: result.log,
    warnings: result.warnings
  };
  turnLog.push(logEntry);

  // apply
  currentNation.metrics = result.newMetrics;
  pendingChanges = [];

  saveState();
  renderMetricsGrid();
  renderWarnings();
  populateGMPanel();
  renderTurnLog();
  showResultModal(result);
}

// ─── Result Modal ───

function showResultModal(result) {
  const modal = document.getElementById('result-modal');
  const body = document.getElementById('result-body');

  let html = '<div class="result-section"><h4>Изменения:</h4><ul>';
  for (const line of result.log) {
    const isWarning = line.includes('⚠');
    const isCascade = line.startsWith('  ↳');
    html += `<li class="${isWarning ? 'result-warn' : ''} ${isCascade ? 'result-cascade' : ''}">${line}</li>`;
  }
  html += '</ul></div>';

  if (result.warnings.length > 0) {
    html += '<div class="result-section result-warnings"><h4>Предупреждения:</h4>';
    for (const w of result.warnings) {
      html += `<div class="warning-item warning-${w.severity}">
        <strong>${w.label}</strong>: ${w.desc}
      </div>`;
    }
    html += '</div>';
  }

  body.innerHTML = html;
  modal.classList.add('visible');
}

function closeModal() {
  document.getElementById('result-modal').classList.remove('visible');
}

// ─── Turn Management ───

function updateTurnCounter() {
  document.getElementById('turn-number').textContent = turnNumber;
}

function nextTurn() {
  turnNumber++;
  updateTurnCounter();
  saveState();

  turnLog.push({
    turn: turnNumber,
    nation: '—',
    timestamp: new Date().toISOString(),
    changes: [],
    log: [`═══ Ход ${turnNumber} ═══`],
    warnings: []
  });

  renderTurnLog();
}

function renderTurnLog() {
  const container = document.getElementById('turn-log-body');
  if (turnLog.length === 0) {
    container.innerHTML = '<p class="empty-hint">История ходов пуста</p>';
    return;
  }

  const recent = turnLog.slice(-30).reverse();
  container.innerHTML = recent.map(entry => {
    const time = new Date(entry.timestamp).toLocaleString('ru-RU', {
      hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit'
    });

    if (entry.changes.length === 0 && entry.log.length === 1) {
      return `<div class="log-entry log-separator">${entry.log[0]}</div>`;
    }

    return `
      <div class="log-entry">
        <div class="log-header">
          <span class="log-nation">${entry.nation}</span>
          <span class="log-time">Ход ${entry.turn} · ${time}</span>
        </div>
        <div class="log-details">
          ${entry.changes.map(c => {
            const sign = c.delta > 0 ? '+' : '';
            return `<span class="log-change">${c.metricName}: ${sign}${c.delta}${c.reason ? ` (${c.reason})` : ''}</span>`;
          }).join('')}
        </div>
        ${entry.warnings.length > 0 ? `<div class="log-warnings">${entry.warnings.map(w => `⚠ ${w.label}`).join(' · ')}</div>` : ''}
      </div>
    `;
  }).join('');
}

// ─── Export / Import ───

function exportJSON() {
  const data = {
    version: '1.0',
    exportDate: new Date().toISOString(),
    turnNumber,
    nations: nationsData.nations.map(n => ({
      id: n.id,
      name: n.name,
      era: n.era,
      course: n.course,
      metrics: n.metrics
    })),
    turnLog
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `teyvat_au_turn${turnNumber}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.nations || !Array.isArray(data.nations)) {
        alert('Неверный формат файла');
        return;
      }

      for (const imported of data.nations) {
        const nation = nationsData.nations.find(n => n.id === imported.id);
        if (nation && imported.metrics) {
          nation.metrics = imported.metrics;
        }
      }

      if (data.turnNumber) turnNumber = data.turnNumber;
      if (data.turnLog) turnLog = data.turnLog;

      saveState();
      selectNation(currentNation?.id || nationsData.nations[0].id);
      updateTurnCounter();
      renderTurnLog();
      alert('Данные импортированы');
    } catch (err) {
      alert('Ошибка импорта: ' + err.message);
    }
  };
  input.click();
}

function resetAll() {
  if (!confirm('Сбросить ВСЕ данные к стартовым значениям? Это действие необратимо.')) return;
  localStorage.removeItem('teyvat_au_state');
  turnLog = [];
  turnNumber = 1;
  pendingChanges = [];
  location.reload();
}

// ─── Compare View ───

function showCompare() {
  const modal = document.getElementById('compare-modal');
  const body = document.getElementById('compare-body');

  const catOrder = ['economy', 'diplomacy', 'politics', 'military_general', 'culture'];
  const catAgg = {};

  for (const catKey of catOrder) {
    catAgg[catKey] = {};
    for (const nation of nationsData.nations) {
      const stats = engine.getCategoryTotal(nation.metrics, catKey);
      catAgg[catKey][nation.id] = stats.avg;
    }
  }

  let html = '<table class="compare-table"><thead><tr><th>Сфера</th>';
  for (const n of nationsData.nations) {
    html += `<th style="color:${n.color}">${n.name}</th>`;
  }
  html += '</tr></thead><tbody>';

  for (const catKey of catOrder) {
    const cat = nationsData.categories[catKey];
    html += `<tr><td>${cat.icon} ${cat.name}</td>`;
    for (const n of nationsData.nations) {
      const val = parseFloat(catAgg[catKey][n.id]);
      const cls = engine.getMetricColor(Math.round(val));
      html += `<td class="metric-${cls}">${val}</td>`;
    }
    html += '</tr>';
  }

  // total row
  html += '<tr class="compare-total"><td>ОБЩЕЕ</td>';
  for (const n of nationsData.nations) {
    const total = Object.values(n.metrics).reduce((s, v) => s + v, 0);
    html += `<td><strong>${total}</strong></td>`;
  }
  html += '</tr>';

  html += '</tbody></table>';
  body.innerHTML = html;
  modal.classList.add('visible');
}

function closeCompare() {
  document.getElementById('compare-modal').classList.remove('visible');
}

// ─── Boot ───

document.addEventListener('DOMContentLoaded', init);

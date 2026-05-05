'use strict';

/* ── State ─────────────────────────────────────── */
let selectedFiles   = [];
let uploadedResults = [];
let cleanMode       = 'all';
let sessionHistory  = [];   // { type, name, size, bytesSaved, risk, preview, blobUrl, filename, timestamp }

/* ── DOM refs ──────────────────────────────────── */
const dropZone       = document.getElementById('dropZone');
const fileInput      = document.getElementById('fileInput');
const fileQueue      = document.getElementById('fileQueue');
const optionsRow     = document.getElementById('optionsRow');
const processBtn     = document.getElementById('processBtn');
const progressWrap   = document.getElementById('progressBar');
const progressFill   = document.getElementById('progressFill');
const progressLabel  = document.getElementById('progressLabel');
const resultsArea    = document.getElementById('resultsArea');
const compressCheck  = document.getElementById('compressCheck');
const qualityGroup   = document.getElementById('qualityGroup');
const qualitySlider  = document.getElementById('qualitySlider');
const qualityVal     = document.getElementById('qualityVal');
const historySection = document.getElementById('historySection');
const historyList    = document.getElementById('historyList');

/* ── Helpers ────────────────────────────────────── */
function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b/1024).toFixed(1)} KB`;
  return `${(b/1048576).toFixed(2)} MB`;
}

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function setProgress(pct, label) {
  progressFill.style.width = pct + '%';
  progressLabel.textContent = label;
}

function showProgress(show) {
  progressWrap.classList.toggle('hidden', !show);
}

function escHtml(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

/* ── File Selection ─────────────────────────────── */
dropZone.addEventListener('click', e => {
  if (e.target === fileInput || e.target.htmlFor === 'fileInput' || e.target.closest('label[for="fileInput"]')) return;
  fileInput.click();
});
dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  addFiles([...e.dataTransfer.files]);
});
fileInput.addEventListener('change', () => addFiles([...fileInput.files]));

function addFiles(newFiles) {
  const allowed = ['image/jpeg','image/png','image/webp'];
  newFiles.forEach(f => {
    if (!allowed.includes(f.type)) return;
    if (f.size > 10 * 1024 * 1024) { alert(`${f.name} exceeds 10MB limit.`); return; }
    if (!selectedFiles.find(x => x.name === f.name && x.size === f.size)) {
      selectedFiles.push(f);
    }
  });
  renderQueue();
}

function renderQueue() {
  if (!selectedFiles.length) {
    fileQueue.classList.add('hidden');
    optionsRow.style.display = 'none';
    return;
  }
  fileQueue.classList.remove('hidden');
  optionsRow.style.display = 'flex';
  fileQueue.innerHTML = selectedFiles.map((f, i) => `
    <div class="file-item">
      <span>🖼️</span>
      <span class="file-name">${escHtml(f.name)}</span>
      <span class="file-size">${fmtBytes(f.size)}</span>
      <button class="file-remove" onclick="removeFile(${i})" title="Remove">✕</button>
    </div>`).join('');
}

window.removeFile = function(i) {
  selectedFiles.splice(i, 1);
  renderQueue();
};

/* ── Mode Toggle ────────────────────────────────── */
document.querySelectorAll('.toggle-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    cleanMode = btn.dataset.mode;
  });
});

/* ── Compression ────────────────────────────────── */
compressCheck.addEventListener('change', () => {
  qualityGroup.classList.toggle('hidden', !compressCheck.checked);
});
qualitySlider.addEventListener('input', () => {
  qualityVal.textContent = qualitySlider.value;
});

/* ── Process ─────────────────────────────────────── */
processBtn.addEventListener('click', processImages);

async function processImages() {
  if (!selectedFiles.length) return;

  processBtn.disabled = true;
  showProgress(true);
  setProgress(5, 'Uploading images…');
  resultsArea.innerHTML = '';
  uploadedResults = [];

  try {
    const fd = new FormData();
    selectedFiles.forEach(f => fd.append('images', f));
    setProgress(20, `Uploading ${selectedFiles.length} image(s)…`);
    const uploadRes  = await fetch('/upload', { method: 'POST', body: fd });
    const uploadData = await uploadRes.json();

    setProgress(40, 'Analyzing metadata…');

    let items = [];
    if (uploadData.bulk) {
      items = uploadData.results;
    } else if (uploadData.error) {
      showError(uploadData.error);
      return;
    } else {
      items = [uploadData];
    }

    uploadedResults = items;

    const quality    = parseInt(qualitySlider.value);
    const doCompress = compressCheck.checked;

    if (items.length > 1) {
      await processBulk(items, quality, doCompress);
    } else {
      await processSingle(items[0], quality, doCompress);
    }

  } catch (err) {
    showError('Network error: ' + err.message);
  } finally {
    processBtn.disabled = false;
    showProgress(false);
    selectedFiles = [];
    renderQueue();
  }
}

async function processSingle(item, quality, doCompress) {
  if (item.error) { showError(item.error); return; }

  setProgress(55, 'Removing metadata…');
  const cleanRes = await fetch('/clean', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      uid: item.uid,
      filename: item.filename,
      mode: cleanMode,
      quality, compress: doCompress
    })
  });
  const cleanData = await cleanRes.json();
  if (cleanData.error) { showError(cleanData.error); return; }

  // Fetch the cleaned file into memory — this also triggers server-side deletion
  setProgress(80, 'Saving to session…');
  const blobRes = await fetch('/download/' + encodeURIComponent(cleanData.cleaned_filename));
  const blob    = await blobRes.blob();
  const blobUrl = URL.createObjectURL(blob);

  sessionHistory.unshift({
    type:      'single',
    name:      item.original_name || item.filename,
    size:      cleanData.cleaned_size,
    bytesSaved: cleanData.bytes_saved || 0,
    risk:      item.risk || {},
    preview:   cleanData.cleaned_preview_b64 || '',
    blobUrl,
    filename:  cleanData.cleaned_filename,
    timestamp: Date.now(),
  });

  setProgress(100, 'Done!');
  renderSingleResult(item, cleanData, blobUrl);
  renderHistory();
}

async function processBulk(items, quality, doCompress) {
  setProgress(50, `Cleaning ${items.length} images…`);
  const validItems = items.filter(i => !i.error);
  const zipRes = await fetch('/bulk-clean', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({
      files: validItems.map(i => ({uid: i.uid, filename: i.filename})),
      mode: cleanMode, quality, compress: doCompress
    })
  });
  const zipData = await zipRes.json();
  if (zipData.error) { showError(zipData.error); return; }

  // Fetch zip blob into memory
  setProgress(85, 'Saving to session…');
  const zipBlobRes = await fetch('/download-zip/' + encodeURIComponent(zipData.zip_filename));
  const zipBlob    = await zipBlobRes.blob();
  const zipBlobUrl = URL.createObjectURL(zipBlob);

  sessionHistory.unshift({
    type:      'bulk',
    name:      `Batch — ${validItems.length} image${validItems.length !== 1 ? 's' : ''}`,
    size:      zipBlob.size,
    bytesSaved: 0,
    risk:      {},
    preview:   '',
    blobUrl:   zipBlobUrl,
    filename:  zipData.zip_filename,
    timestamp: Date.now(),
  });

  setProgress(100, 'Done!');
  renderBulkResult(items, zipBlobUrl);
  renderHistory();
}

/* ── Render Single ──────────────────────────────── */
function renderSingleResult(item, cleanData, blobUrl) {
  const risk     = item.risk || {};
  const meta     = item.metadata || {};
  const afterMeta= cleanData.after_metadata || {};
  const gps      = item.gps;

  const metaKeys     = Object.keys(meta).filter(k => k !== 'image_info' && k !== '_error');
  const metaCount    = metaKeys.length;
  const afterCount   = Object.keys(afterMeta).filter(k => k !== 'image_info' && k !== '_error').length;
  const removedCount = Math.max(0, metaCount - afterCount);
  const bytesSaved   = cleanData.bytes_saved || 0;

  const riskBarColor = risk.level === 'HIGH' ? '#ef4444' : risk.level === 'MEDIUM' ? '#f59e0b' : '#10b981';

  let gpsHtml = '';
  if (gps) {
    gpsHtml = `
      <div class="card">
        <div class="map-section">
          <h3>📍 GPS Location Detected</h3>
          <p class="map-coords">Lat: ${gps.lat}, Lon: ${gps.lon}</p>
          ${item.address ? `<div class="map-address">📌 ${escHtml(item.address)}</div>` : ''}
          <iframe class="map-frame"
            src="https://maps.google.com/maps?q=${gps.lat},${gps.lon}&z=14&output=embed"
            allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>
          ${cleanMode === 'all' ? '<p class="mt-4 text-success" style="font-size:.85rem">✅ GPS data will be removed</p>' :
            '<p class="mt-4 text-success" style="font-size:.85rem">✅ GPS-only mode selected</p>'}
        </div>
      </div>`;
  }

  let metaHtml = '';
  if (metaKeys.length === 0) {
    metaHtml = '<p class="meta-empty">✅ No metadata found in this image</p>';
  } else {
    const rows = metaKeys.map(k => {
      const isGps     = k.startsWith('GPS:');
      const isRemoved = cleanMode === 'all' || (cleanMode === 'gps' && isGps);
      return `<tr>
        <td class="${isGps ? 'tag-gps' : ''}">${escHtml(k.replace(/^\w+:/,''))}</td>
        <td class="${isRemoved ? 'tag-removed' : ''}">${escHtml(meta[k])}</td>
        <td>${isRemoved ? '🗑️ Removed' : '✅ Kept'}</td>
      </tr>`;
    }).join('');
    metaHtml = `<table class="meta-table">
      <thead><tr><th>Field</th><th>Value</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  const origSrc    = item.preview_b64 || '';
  const cleanedSrc = cleanData.cleaned_preview_b64 || '';

  resultsArea.innerHTML = `
    <div class="result-card">
      <div class="card">
        <div class="result-header">
          <div>
            <div class="result-title">🎉 ${escHtml(item.original_name || item.filename)}</div>
            <div class="result-sub">${fmtBytes(item.original_size)} → ${fmtBytes(cleanData.cleaned_size)}</div>
          </div>
          <span class="risk-badge risk-${risk.level || 'LOW'}">${risk.badge || ''} ${risk.level || 'LOW'} Risk</span>
        </div>
        <div class="risk-bar-wrap">
          <div class="risk-bar"><div class="risk-bar-fill" style="width:${risk.score||0}%;background:${riskBarColor}"></div></div>
          <p class="risk-desc mt-4">${escHtml(risk.description || '')}</p>
          ${risk.factors && risk.factors.length ? `<div class="risk-factors">${risk.factors.map(f=>`<span class="risk-factor">⚠️ ${escHtml(f)}</span>`).join('')}</div>` : ''}
        </div>
        <div class="savings-row mt-4">
          <div class="saving-item"><span class="saving-val">${removedCount}</span><span class="saving-lbl">Fields Removed</span></div>
          <div class="saving-item"><span class="saving-val">${bytesSaved >= 0 ? '+' : ''}${fmtBytes(Math.abs(bytesSaved))}</span><span class="saving-lbl">${bytesSaved >= 0 ? 'Bytes Saved' : 'Size Change'}</span></div>
          <div class="saving-item"><span class="saving-val">${cleanMode === 'all' ? '100%' : 'GPS'}</span><span class="saving-lbl">Metadata Cleared</span></div>
        </div>
        <div class="actions-row mt-4">
          <a class="btn btn-success" href="${blobUrl}" download="${escHtml(cleanData.cleaned_filename)}">⬇️ Download Clean Image</a>
          <span class="countdown-badge">📋 Saved to <strong>session history</strong> below</span>
        </div>
      </div>
      ${gpsHtml}
      <div class="card">
        <div class="compare-section">
          <h3>🔍 Before vs After</h3>
          <p class="compare-hint">← Drag the handle to reveal original vs cleaned →</p>
          <div class="compare-slider" id="compareSlider">
            <img class="cs-after" src="${cleanedSrc}" alt="Cleaned" draggable="false">
            <div class="cs-before-wrap" id="csBefore">
              <img class="cs-before" id="csBeforeImg" src="${origSrc}" alt="Original" draggable="false">
            </div>
            <div class="cs-handle" id="csHandle"><div class="cs-knob">⟺</div></div>
            <span class="cs-label cs-label-left">Original</span>
            <span class="cs-label cs-label-right">Cleaned</span>
          </div>
          <div class="compare-stats">
            <span>Original: <strong>${fmtBytes(item.original_size)}</strong> · ${metaCount} metadata fields</span>
            <span>Cleaned: <strong>${fmtBytes(cleanData.cleaned_size)}</strong> · ${afterCount} fields</span>
            ${bytesSaved > 0 ? `<span>Saved: <strong class="text-success">${fmtBytes(bytesSaved)}</strong></span>` : ''}
          </div>
        </div>
      </div>
      <div class="card">
        <div class="meta-section">
          <h3>📋 Metadata Details (${metaCount} fields detected)</h3>
          ${metaHtml}
        </div>
      </div>
    </div>`;

  initCompareSlider();
}

/* ── Compare Slider ──────────────────────────────── */
function initCompareSlider() {
  const slider    = document.getElementById('compareSlider');
  const before    = document.getElementById('csBefore');
  const beforeImg = document.getElementById('csBeforeImg');
  const handle    = document.getElementById('csHandle');
  if (!slider || !before || !handle) return;

  let dragging = false;

  function setPosition(clientX) {
    const rect = slider.getBoundingClientRect();
    let pct = (clientX - rect.left) / rect.width;
    pct = Math.max(0.02, Math.min(0.98, pct));
    const pctPx = (pct * 100).toFixed(2) + '%';
    before.style.width = pctPx;
    beforeImg.style.width = rect.width + 'px';
    handle.style.left = pctPx;
  }

  requestAnimationFrame(() => {
    const rect = slider.getBoundingClientRect();
    beforeImg.style.width = rect.width + 'px';
  });

  slider.addEventListener('mousedown', e => { dragging = true; setPosition(e.clientX); });
  window.addEventListener('mousemove', e => { if (dragging) setPosition(e.clientX); });
  window.addEventListener('mouseup',   () => { dragging = false; });

  slider.addEventListener('touchstart', e => { dragging = true; setPosition(e.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchmove',  e => { if (dragging) setPosition(e.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchend',   () => { dragging = false; });

  window.addEventListener('resize', () => {
    const rect = slider.getBoundingClientRect();
    beforeImg.style.width = rect.width + 'px';
  });
}

/* ── Render Bulk ─────────────────────────────────── */
function renderBulkResult(items, zipBlobUrl) {
  const validCount  = items.filter(i => !i.error).length;
  const failedCount = items.filter(i =>  i.error).length;

  const rows = items.map(item => {
    if (item.error) {
      return `<div class="file-item"><span>❌</span><span class="file-name">${escHtml(item.original_name || '?')}</span><span class="text-danger">${escHtml(item.error)}</span></div>`;
    }
    const risk = item.risk || {};
    return `<div class="file-item">
      <span>🖼️</span>
      <span class="file-name">${escHtml(item.original_name || item.filename)}</span>
      <span class="risk-badge risk-${risk.level||'LOW'}" style="font-size:.75rem;padding:3px 10px;">${risk.badge||''} ${risk.level||'LOW'}</span>
      <span class="file-size">${fmtBytes(item.original_size)}</span>
    </div>`;
  }).join('');

  resultsArea.innerHTML = `
    <div class="card result-card">
      <div class="result-header">
        <div>
          <div class="result-title">🎉 Bulk Processing Complete</div>
          <div class="result-sub">${validCount} images cleaned${failedCount ? `, ${failedCount} failed` : ''}</div>
        </div>
      </div>
      <div class="bulk-summary">
        <div class="bulk-stat">Processed: <strong>${validCount}</strong></div>
        ${failedCount ? `<div class="bulk-stat text-danger">Failed: <strong>${failedCount}</strong></div>` : ''}
        <a class="btn btn-success" href="${zipBlobUrl}" download="cleaned_batch.zip">⬇️ Download All (ZIP)</a>
      </div>
      <div class="file-queue" style="display:flex;flex-direction:column;gap:8px;">${rows}</div>
      <p class="history-saved-note">📋 Saved to <strong>session history</strong> below</p>
    </div>`;
}

/* ── Session History ─────────────────────────────── */
function renderHistory() {
  const histSec  = historySection  || document.getElementById('historySection');
  const histList = historyList     || document.getElementById('historyList');
  if (!histSec || !histList) return;

  if (!sessionHistory.length) {
    histSec.classList.add('hidden');
    return;
  }

  histSec.classList.remove('hidden');

  histList.innerHTML = sessionHistory.map((entry, i) => {
    const riskLevel = entry.risk.level || 'LOW';
    const isBulk    = entry.type === 'bulk';

    const thumb = entry.preview
      ? `<img class="hist-thumb" src="${entry.preview}" alt="preview">`
      : `<div class="hist-thumb hist-thumb-bulk">🗜️</div>`;

    const badge = !isBulk
      ? `<span class="risk-badge risk-${riskLevel}" style="font-size:.72rem;padding:3px 10px;">${entry.risk.badge || ''} ${riskLevel}</span>`
      : `<span class="hist-bulk-badge">ZIP</span>`;

    const savings = entry.bytesSaved > 0
      ? `<span class="hist-saved">+${fmtBytes(entry.bytesSaved)} saved</span>`
      : '';

    return `
      <div class="hist-item">
        ${thumb}
        <div class="hist-info">
          <div class="hist-name">${escHtml(entry.name)}</div>
          <div class="hist-meta">
            ${fmtBytes(entry.size)} ${savings}
            <span class="hist-time">🕐 ${fmtTime(entry.timestamp)}</span>
          </div>
          <div class="hist-badges">${badge}</div>
        </div>
        <a class="btn btn-ghost hist-dl-btn" href="${entry.blobUrl}" download="${escHtml(entry.filename)}">⬇️ Re-download</a>
        <button class="hist-remove" onclick="removeHistory(${i})" title="Remove from history">✕</button>
      </div>`;
  }).join('');
}

window.removeHistory = function(i) {
  if (sessionHistory[i]) URL.revokeObjectURL(sessionHistory[i].blobUrl);
  sessionHistory.splice(i, 1);
  renderHistory();
};

window.clearHistory = function() {
  sessionHistory.forEach(e => URL.revokeObjectURL(e.blobUrl));
  sessionHistory = [];
  renderHistory();
};

/* ── Error ───────────────────────────────────────── */
function showError(msg) {
  resultsArea.innerHTML = `<div class="card error-box">❌ ${escHtml(msg)}</div>`;
}

/* ── PWA ─────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

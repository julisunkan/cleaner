'use strict';

/* ── State ─────────────────────────────────────── */
let selectedFiles      = [];
let uploadedResults    = [];
let cleanMode          = 'all';
let outputFormat       = 'same';
let doResize           = false;
let resizeMaxW         = 1920;
let sessionHistory     = [];
let pendingCustomItems = [];
let pendingOriginals   = [];
let _lastSingleMeta    = null;
let _batchLeafletMap   = null;

/* ── DOM refs ──────────────────────────────────── */
const dropZone          = document.getElementById('dropZone');
const fileInput         = document.getElementById('fileInput');
const fileQueue         = document.getElementById('fileQueue');
const optionsRow        = document.getElementById('optionsRow');
const processBtn        = document.getElementById('processBtn');
const progressWrap      = document.getElementById('progressBar');
const progressFill      = document.getElementById('progressFill');
const progressLabel     = document.getElementById('progressLabel');
const resultsArea       = document.getElementById('resultsArea');
const compressCheck     = document.getElementById('compressCheck');
const qualityGroup      = document.getElementById('qualityGroup');
const qualitySlider     = document.getElementById('qualitySlider');
const qualityVal        = document.getElementById('qualityVal');
const historySection    = document.getElementById('historySection');
const historyList       = document.getElementById('historyList');
const formatSelect      = document.getElementById('formatSelect');
const resizeCheck       = document.getElementById('resizeCheck');
const resizeGroup       = document.getElementById('resizeGroup');
const resizeWidthInput  = document.getElementById('resizeWidth');
const batchMapWrap      = document.getElementById('batchMapWrap');
const privacyChartEl    = document.getElementById('privacyChart');

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

/* ── Clipboard Paste ────────────────────────────── */
window.addEventListener('paste', e => {
  const items = [...(e.clipboardData?.items || [])];
  const files = items
    .filter(i => i.type.startsWith('image/'))
    .map(i => i.getAsFile())
    .filter(Boolean);
  if (files.length) {
    addFiles(files);
  }
});

function addFiles(newFiles) {
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
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

/* ── Format / Resize ────────────────────────────── */
formatSelect.addEventListener('change', () => {
  outputFormat = formatSelect.value;
});

resizeCheck.addEventListener('change', () => {
  doResize = resizeCheck.checked;
  resizeGroup.classList.toggle('hidden', !doResize);
});

resizeWidthInput.addEventListener('input', () => {
  resizeMaxW = parseInt(resizeWidthInput.value) || 1920;
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

  // Capture original file blobs BEFORE any processing (for undo feature)
  const originals = selectedFiles.map(f => ({
    blobUrl: URL.createObjectURL(f),
    name: f.name,
  }));

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
      originals.forEach(o => URL.revokeObjectURL(o.blobUrl));
      showError(uploadData.error);
      return;
    } else {
      items = [uploadData];
    }

    uploadedResults = items;

    const quality    = parseInt(qualitySlider.value);
    const doCompress = compressCheck.checked;

    // Custom mode: show editor before cleaning
    if (cleanMode === 'custom') {
      pendingCustomItems = items;
      pendingOriginals   = originals;
      showCustomEditor(items);
      return; // finally block still runs (re-enables btn, hides progress, clears queue)
    }

    if (items.length > 1) {
      await processBulk(items, quality, doCompress, originals);
    } else {
      await processSingle(items[0], quality, doCompress, originals[0]);
    }

  } catch (err) {
    originals.forEach(o => URL.revokeObjectURL(o.blobUrl));
    showError('Network error: ' + err.message);
  } finally {
    processBtn.disabled = false;
    showProgress(false);
    selectedFiles = [];
    renderQueue();
  }
}

async function processSingle(item, quality, doCompress, original = null, fieldsToRemove = null) {
  if (item.error) { showError(item.error); return; }

  const activeMode = fieldsToRemove !== null ? 'custom' : cleanMode;

  setProgress(55, 'Removing metadata…');
  const cleanRes = await fetch('/clean', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      uid:              item.uid,
      filename:         item.filename,
      mode:             activeMode,
      quality,
      compress:         doCompress,
      output_format:    outputFormat,
      max_width:        doResize ? resizeMaxW : null,
      fields_to_remove: fieldsToRemove || [],
    })
  });
  const cleanData = await cleanRes.json();
  if (cleanData.error) { showError(cleanData.error); return; }

  setProgress(80, 'Saving to session…');
  const blobRes = await fetch('/download/' + encodeURIComponent(cleanData.cleaned_filename));
  const blob    = await blobRes.blob();
  const blobUrl = URL.createObjectURL(blob);

  sessionHistory.unshift({
    type:             'single',
    name:             item.original_name || item.filename,
    size:             cleanData.cleaned_size,
    bytesSaved:       cleanData.bytes_saved || 0,
    risk:             item.risk || {},
    preview:          cleanData.cleaned_preview_b64 || '',
    blobUrl,
    filename:         cleanData.cleaned_filename,
    timestamp:        Date.now(),
    originalBlobUrl:  original?.blobUrl  || null,
    originalFilename: original?.name     || null,
    mode:             activeMode,
  });

  // Store for CSV export
  _lastSingleMeta = {
    meta:           item.metadata || {},
    afterMeta:      cleanData.after_metadata || {},
    mode:           activeMode,
    fieldsToRemove: fieldsToRemove || [],
    filename:       item.original_name || item.filename,
  };

  setProgress(100, 'Done!');
  renderSingleResult(item, cleanData, blobUrl, original, fieldsToRemove);
  renderHistory();
}

async function processBulk(items, quality, doCompress, originals = [], fieldsToRemove = null) {
  setProgress(50, `Cleaning ${items.length} images…`);
  const validItems = items.filter(i => !i.error);
  const activeMode = fieldsToRemove !== null ? 'custom' : cleanMode;

  const zipRes = await fetch('/bulk-clean', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files:            validItems.map(i => ({ uid: i.uid, filename: i.filename })),
      mode:             activeMode,
      quality,
      compress:         doCompress,
      output_format:    outputFormat,
      max_width:        doResize ? resizeMaxW : null,
      fields_to_remove: fieldsToRemove || [],
    })
  });
  const zipData = await zipRes.json();
  if (zipData.error) { showError(zipData.error); return; }

  setProgress(85, 'Saving to session…');
  const zipBlobRes = await fetch('/download-zip/' + encodeURIComponent(zipData.zip_filename));
  const zipBlob    = await zipBlobRes.blob();
  const zipBlobUrl = URL.createObjectURL(zipBlob);

  // Revoke original blobs (not stored for bulk)
  originals.forEach(o => URL.revokeObjectURL(o.blobUrl));

  sessionHistory.unshift({
    type:             'bulk',
    name:             `Batch — ${validItems.length} image${validItems.length !== 1 ? 's' : ''}`,
    size:             zipBlob.size,
    bytesSaved:       0,
    risk:             {},
    preview:          '',
    blobUrl:          zipBlobUrl,
    filename:         zipData.zip_filename,
    timestamp:        Date.now(),
    originalBlobUrl:  null,
    originalFilename: null,
  });

  setProgress(100, 'Done!');
  renderBulkResult(items, zipBlobUrl);
  renderHistory();
}

/* ── Custom Editor ──────────────────────────────── */
function showCustomEditor(items) {
  const item   = items[0];
  const fields = item.metadata_fields || [];

  if (!fields.length) {
    resultsArea.innerHTML = `<div class="card error-box">ℹ️ No editable EXIF fields found in this image. Switching to Remove All mode.</div>`;
    return;
  }

  // Group fields by IFD
  const groups = {};
  for (const f of fields) {
    const ifd = f.key.split(':')[0];
    if (!groups[ifd]) groups[ifd] = [];
    groups[ifd].push(f);
  }

  const ifdLabels = {
    '0th':  '📷 Basic Info',
    'Exif': '🔬 Camera Details',
    'GPS':  '📍 GPS Location',
    '1st':  '🖼️ Thumbnail',
  };

  const groupHtml = Object.entries(groups).map(([ifd, flds], gi) => {
    const label    = ifdLabels[ifd] || ifd;
    const fieldRows = flds.map((f, fi) => {
      const cbId = `cf_${gi}_${fi}`;
      return `<div class="editor-field">
        <input type="checkbox" id="${cbId}" data-key="${escHtml(f.key)}" checked>
        <label for="${cbId}" class="editor-field-label ${f.is_gps ? 'is-gps' : ''}">${escHtml(f.label)}</label>
        <span class="editor-field-value" title="${escHtml(f.value)}">${escHtml(f.value)}</span>
      </div>`;
    }).join('');
    return `<div class="editor-section-header">${label}</div>${fieldRows}`;
  }).join('');

  const multiNote = items.length > 1
    ? `<p style="color:var(--warning);font-size:.82rem;margin-bottom:12px;">⚠️ Field selections will apply to all ${items.length} images in the batch.</p>`
    : '';

  resultsArea.innerHTML = `
    <div class="card custom-editor-wrap">
      <h3>✏️ Custom Field Editor</h3>
      <p>Check the fields you want to <strong>remove</strong>. Unchecked fields will be kept intact.</p>
      ${multiNote}
      <div class="editor-toolbar">
        <button class="btn btn-ghost btn-sm" onclick="selectAllEditorFields(true)">☑ Select All</button>
        <button class="btn btn-ghost btn-sm" onclick="selectAllEditorFields(false)">☐ Deselect All</button>
        <button class="btn btn-ghost btn-sm" onclick="selectGpsEditorFields()">📍 GPS Only</button>
        <span style="margin-left:auto;color:var(--muted);font-size:.8rem;">${fields.length} fields found</span>
      </div>
      <div class="editor-fields" id="editorFields">${groupHtml}</div>
      <div class="actions-row mt-4">
        <button class="btn btn-success btn-lg" onclick="applyCustomClean()">🧹 Apply Custom Clean</button>
      </div>
    </div>`;
}

window.selectAllEditorFields = function(checked) {
  document.querySelectorAll('#editorFields input[type=checkbox]').forEach(cb => cb.checked = checked);
};

window.selectGpsEditorFields = function() {
  document.querySelectorAll('#editorFields input[type=checkbox]').forEach(cb => {
    cb.checked = (cb.dataset.key || '').startsWith('GPS:');
  });
};

window.applyCustomClean = async function() {
  const checkboxes    = document.querySelectorAll('#editorFields input[type=checkbox]');
  const fieldsToRemove = [...checkboxes].filter(cb => cb.checked).map(cb => cb.dataset.key);

  const quality    = parseInt(qualitySlider.value);
  const doCompress = compressCheck.checked;
  const items      = pendingCustomItems;
  const originals  = pendingOriginals;

  processBtn.disabled = true;
  showProgress(true);
  setProgress(50, 'Applying custom clean…');

  try {
    if (items.length > 1) {
      await processBulk(items, quality, doCompress, originals, fieldsToRemove);
    } else {
      await processSingle(items[0], quality, doCompress, originals[0], fieldsToRemove);
    }
  } catch (err) {
    showError('Error applying custom clean: ' + err.message);
    originals.forEach(o => URL.revokeObjectURL(o.blobUrl));
  } finally {
    processBtn.disabled = false;
    showProgress(false);
    selectedFiles      = [];
    pendingCustomItems = [];
    pendingOriginals   = [];
    renderQueue();
  }
};

/* ── Render Single ──────────────────────────────── */
function renderSingleResult(item, cleanData, blobUrl, original = null, fieldsToRemove = null) {
  const activeMode   = fieldsToRemove !== null ? 'custom' : cleanMode;
  const risk         = item.risk || {};
  const meta         = item.metadata || {};
  const afterMeta    = cleanData.after_metadata || {};
  const gps          = item.gps;

  const metaKeys     = Object.keys(meta).filter(k => k !== 'image_info' && k !== '_error');
  const metaCount    = metaKeys.length;
  const afterCount   = Object.keys(afterMeta).filter(k => k !== 'image_info' && k !== '_error').length;
  const removedCount = Math.max(0, metaCount - afterCount);
  const bytesSaved   = cleanData.bytes_saved || 0;

  const riskBarColor = risk.level === 'HIGH' ? '#ef4444' : risk.level === 'MEDIUM' ? '#f59e0b' : '#10b981';
  const modeLabels   = { all: 'All Metadata', gps: 'GPS Only', custom: 'Custom Fields' };
  const modeLabel    = modeLabels[activeMode] || activeMode;

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
        </div>
      </div>`;
  }

  const origSrc    = item.preview_b64 || '';
  const cleanedSrc = cleanData.cleaned_preview_b64 || '';
  const diffHtml   = renderDiffTable(meta, afterMeta, activeMode, fieldsToRemove || []);

  resultsArea.innerHTML = `
    <div class="result-card">
      <div class="card">
        <div class="result-header">
          <div>
            <div class="result-title">🎉 ${escHtml(item.original_name || item.filename)}</div>
            <div class="result-sub">${fmtBytes(item.original_size)} → ${fmtBytes(cleanData.cleaned_size)} · Mode: ${modeLabel}</div>
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
          <div class="saving-item"><span class="saving-val">${modeLabel}</span><span class="saving-lbl">Clean Mode</span></div>
        </div>
        <div class="actions-row mt-4">
          <a class="btn btn-success" href="${blobUrl}" download="${escHtml(cleanData.cleaned_filename)}">⬇️ Download Clean Image</a>
          ${original?.blobUrl ? `<a class="btn btn-ghost" href="${original.blobUrl}" download="${escHtml(original.name || 'original')}">↩️ Get Original</a>` : ''}
          <button class="btn btn-ghost" onclick="exportCSV()">📊 Export CSV</button>
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
          <h3>📋 Metadata Diff — ${metaCount} fields detected</h3>
          ${diffHtml}
        </div>
      </div>
    </div>`;

  initCompareSlider();
}

/* ── Side-by-Side Diff Table ───────────────────── */
function renderDiffTable(meta, afterMeta, mode, fieldsToRemove) {
  const metaKeys = Object.keys(meta).filter(k => k !== 'image_info' && k !== '_error');
  if (!metaKeys.length) return '<p class="meta-empty">✅ No metadata found in this image</p>';

  function isRemoved(k) {
    if (mode === 'all') return true;
    if (mode === 'gps') return k.startsWith('GPS:');
    // custom: check if field is absent from afterMeta
    return !(k in afterMeta);
  }

  const rows = metaKeys.map(k => {
    const isGps    = k.startsWith('GPS:');
    const removed  = isRemoved(k);
    const field    = k.replace(/^\w+:/, '');
    return `<tr>
      <td class="${isGps ? 'tag-gps' : ''}">${escHtml(field)}</td>
      <td class="diff-before">${escHtml(meta[k])}</td>
      <td class="${removed ? 'diff-removed' : 'diff-kept'}">${removed ? '🗑️ Removed' : '✅ Kept'}</td>
    </tr>`;
  }).join('');

  return `<table class="meta-table">
    <thead>
      <tr>
        <th>Field</th>
        <th class="diff-col-before">Before</th>
        <th class="diff-col-after">After</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>`;
}

/* ── CSV Export ─────────────────────────────────── */
window.exportCSV = function() {
  if (!_lastSingleMeta) return;
  const { meta, afterMeta, mode, filename } = _lastSingleMeta;
  const metaKeys = Object.keys(meta).filter(k => k !== 'image_info' && k !== '_error');

  function isRemoved(k) {
    if (mode === 'all') return true;
    if (mode === 'gps') return k.startsWith('GPS:');
    return !(k in afterMeta);
  }

  const rows = [['Field', 'Value', 'Status', 'Category']];

  // Image info block
  const info = meta.image_info || {};
  for (const [k, v] of Object.entries(info)) {
    rows.push([k, String(v), 'Kept (basic info)', 'Image Info']);
  }

  // EXIF fields
  for (const k of metaKeys) {
    const removed  = isRemoved(k);
    const category = k.startsWith('GPS:') ? 'GPS' : k.split(':')[0];
    const field    = k.replace(/^\w+:/, '');
    rows.push([field, String(meta[k]), removed ? 'Removed' : 'Kept', category]);
  }

  const csv   = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob  = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement('a');
  a.href      = url;
  a.download  = filename.replace(/\.[^.]+$/, '') + '_metadata.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

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

  // Show batch GPS map if any images have GPS coordinates
  const gpsPoints = items
    .filter(i => !i.error && i.gps)
    .map(i => ({ lat: i.gps.lat, lon: i.gps.lon, name: i.original_name || i.filename }));

  if (gpsPoints.length > 0) {
    batchMapWrap.classList.remove('hidden');
    // Delay to let DOM render before Leaflet initializes
    setTimeout(() => initBatchMap('batchLeafletMap', gpsPoints), 80);
  } else {
    batchMapWrap.classList.add('hidden');
  }
}

/* ── Batch GPS Map (Leaflet) ────────────────────── */
function initBatchMap(containerId, points) {
  if (!points.length) return;
  if (typeof L === 'undefined') {
    console.warn('Leaflet not loaded — batch GPS map unavailable');
    return;
  }

  // Destroy previous instance
  if (_batchLeafletMap) {
    _batchLeafletMap.remove();
    _batchLeafletMap = null;
  }

  const centerLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const centerLon = points.reduce((s, p) => s + p.lon, 0) / points.length;

  const map = L.map(containerId, { scrollWheelZoom: false })
    .setView([centerLat, centerLon], points.length === 1 ? 14 : 8);
  _batchLeafletMap = map;

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  points.forEach(p => {
    L.marker([p.lat, p.lon])
      .addTo(map)
      .bindPopup(`<strong>${escHtml(p.name)}</strong><br><code style="font-size:.78rem">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</code>`);
  });

  if (points.length > 1) {
    const bounds = L.latLngBounds(points.map(p => [p.lat, p.lon]));
    map.fitBounds(bounds, { padding: [30, 30] });
  }
}

/* ── Session History ─────────────────────────────── */
function renderHistory() {
  if (!historySection || !historyList) return;

  if (!sessionHistory.length) {
    historySection.classList.add('hidden');
    return;
  }

  historySection.classList.remove('hidden');
  renderPrivacyChart();

  historyList.innerHTML = sessionHistory.map((entry, i) => {
    const riskLevel = entry.risk?.level || 'LOW';
    const isBulk    = entry.type === 'bulk';

    const thumb = entry.preview
      ? `<img class="hist-thumb" src="${entry.preview}" alt="preview">`
      : `<div class="hist-thumb hist-thumb-bulk">🗜️</div>`;

    const badge = !isBulk
      ? `<span class="risk-badge risk-${riskLevel}" style="font-size:.72rem;padding:3px 10px;">${entry.risk?.badge || ''} ${riskLevel}</span>`
      : `<span class="hist-bulk-badge">ZIP</span>`;

    const savings = entry.bytesSaved > 0
      ? `<span class="hist-saved">+${fmtBytes(entry.bytesSaved)} saved</span>`
      : '';

    const originalBtn = entry.originalBlobUrl
      ? `<a class="btn btn-ghost hist-dl-btn" href="${entry.originalBlobUrl}" download="${escHtml(entry.originalFilename || 'original')}" title="Download uncleaned original">↩️ Original</a>`
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
        <div class="hist-actions">
          <a class="btn btn-ghost hist-dl-btn" href="${entry.blobUrl}" download="${escHtml(entry.filename)}">⬇️ Re-download</a>
          ${originalBtn}
          <button class="hist-remove" onclick="removeHistory(${i})" title="Remove from history">✕</button>
        </div>
      </div>`;
  }).join('');
}

/* ── Privacy Score Chart ─────────────────────────── */
function renderPrivacyChart() {
  if (!privacyChartEl) return;
  const singles = sessionHistory.filter(e => e.type === 'single' && e.risk?.score !== undefined);
  if (!singles.length) {
    privacyChartEl.innerHTML = '';
    return;
  }

  const bars = [...singles].reverse().map(e => {
    const score = e.risk.score || 0;
    const level = e.risk.level || 'LOW';
    const h     = Math.max(4, Math.round((score / 100) * 56));
    const name  = (e.name || '').replace(/\.[^.]+$/, '').slice(0, 8);
    return `<div class="chart-col">
      <div class="chart-bar-wrap">
        <div class="chart-bar-${level}" style="height:${h}px" title="${escHtml(e.name)}: ${score}/100"></div>
      </div>
      <div class="chart-score">${score}</div>
    </div>`;
  }).join('');

  privacyChartEl.innerHTML = `
    <div class="privacy-chart">
      <div class="chart-title">Session Risk Scores &nbsp;(oldest → newest)</div>
      <div class="chart-bars">${bars}</div>
    </div>`;
}

window.removeHistory = function(i) {
  const entry = sessionHistory[i];
  if (entry) {
    if (entry.blobUrl)         URL.revokeObjectURL(entry.blobUrl);
    if (entry.originalBlobUrl) URL.revokeObjectURL(entry.originalBlobUrl);
  }
  sessionHistory.splice(i, 1);
  renderHistory();
};

window.clearHistory = function() {
  sessionHistory.forEach(e => {
    if (e.blobUrl)         URL.revokeObjectURL(e.blobUrl);
    if (e.originalBlobUrl) URL.revokeObjectURL(e.originalBlobUrl);
  });
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

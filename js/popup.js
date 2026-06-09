// popup.js
(async function () {
  'use strict';

  const body = document.getElementById('body');
  const toast = document.getElementById('toast');

  function showToast(msg, color = '#27ae60') {
    toast.textContent = msg;
    toast.style.background = color;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
  }

  function renderEmpty(msg = 'No se detectaron videos de Vimeo.') {
    body.innerHTML = `
      <div class="state-empty">
        <div class="icon">🎬</div>
        <p>${msg}<br>Navega a una página con un video de Vimeo y vuelve a abrir la extensión.</p>
      </div>
      <div class="actions">
        <button class="btn-action" id="btn-reload">🔄 Reescanear</button>
      </div>
    `;
    document.getElementById('btn-reload')?.addEventListener('click', () => {
      triggerRescan();
    });
  }

  function formatQuality(v) {
    if (v.type === 'hls') return 'HLS';
    if (v.type === 'dash') return 'DASH';
    if (v.height) return v.height + 'p';
    return v.quality || '?';
  }

  function renderVideos(data) {
    const { videos, title } = data;
    const mp4 = videos.filter(v => v.type === 'mp4' || (!v.type && v.url.includes('.mp4')));
    const adaptive = videos.filter(v => v.type === 'hls' || v.type === 'dash');
    const other = videos.filter(v => !mp4.includes(v) && !adaptive.includes(v));
    const all = [...mp4, ...other, ...adaptive];

    body.innerHTML = `
      ${title ? `<div class="video-title" title="${escHtml(title)}">🎬 ${escHtml(title)}</div>` : ''}
      <div class="section-title">Videos detectados (${all.length})</div>
      <div class="video-list" id="video-list"></div>
      <div class="actions">
        <button class="btn-action" id="btn-reload">🔄 Reescanear</button>
        <button class="btn-action danger" id="btn-clear">🗑 Limpiar</button>
      </div>
    `;

    const list = document.getElementById('video-list');
    all.forEach((v, i) => {
      const q = formatQuality(v);
      const isAdaptive = v.type === 'hls' || v.type === 'dash';
      const badgeClass = v.type === 'hls' ? 'hls' : v.type === 'dash' ? 'dash' : '';
      const meta = v.width && v.height ? `${v.width}×${v.height}` : (isAdaptive ? 'Streaming' : '');
      const item = document.createElement('div');
      item.className = 'video-item';
      item.innerHTML = `
        <div class="video-info">
          <span class="quality-badge ${badgeClass}">${escHtml(q)}</span>
          <span class="video-meta">${meta}</span>
        </div>
        <div style="display:flex;gap:4px">
          <button class="btn-download copy" data-idx="${i}" title="Copiar URL">📋</button>
          ${!isAdaptive ? `<a class="btn-download" href="${escAttr(v.url)}" download target="_blank" title="Descargar">⬇ Descargar</a>` : `<a class="btn-download" href="${escAttr(v.url)}" target="_blank" title="Abrir">▶ Abrir</a>`}
        </div>
      `;
      list.appendChild(item);
    });

    // Copiar URL
    list.querySelectorAll('.copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = +btn.dataset.idx;
        navigator.clipboard.writeText(all[idx].url)
          .then(() => showToast('✅ URL copiada'))
          .catch(() => showToast('❌ Error al copiar', '#e74c3c'));
      });
    });

    document.getElementById('btn-reload')?.addEventListener('click', triggerRescan);
    document.getElementById('btn-clear')?.addEventListener('click', clearVideos);
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function escAttr(s) {
    return String(s).replace(/"/g, '%22');
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function triggerRescan() {
    body.innerHTML = '<div class="state-loading"><div class="spinner"></div><span>Rescaneando...</span></div>';
    const tab = await getActiveTab();
    if (!tab) return renderEmpty();
    try {
      // Reinyectar inject.js
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        files: ['js/inject.js']
      });
    } catch (e) {}
    // Esperar un momento y luego consultar
    await new Promise(r => setTimeout(r, 1500));
    loadVideos();
  }

  async function clearVideos() {
    const tab = await getActiveTab();
    if (!tab) return;
    await chrome.runtime.sendMessage({ action: 'CLEAR_VIDEOS' }).catch(() => {});
    renderEmpty('Videos limpiados.');
  }

  async function loadVideos() {
    const tab = await getActiveTab();
    if (!tab) {
      renderEmpty('No hay pestaña activa.');
      return;
    }

    // Verificar si estamos en una página de Vimeo o con embed
    const url = tab.url || '';
    const isVimeoPage = url.includes('vimeo.com') || url.includes('vimeocdn');

    try {
      const data = await chrome.runtime.sendMessage({ action: 'GET_VIDEOS' });
      if (data && data.videos && data.videos.length > 0) {
        renderVideos(data);
      } else {
        // Si no hay videos pero estamos en Vimeo, intentar rescan
        if (isVimeoPage) {
          body.innerHTML = '<div class="state-loading"><div class="spinner"></div><span>Detectando video...</span></div>';
          await triggerRescan();
        } else {
          renderEmpty();
        }
      }
    } catch (e) {
      renderEmpty('Error al comunicar con la página.');
    }
  }

  // Iniciar
  loadVideos();

})();

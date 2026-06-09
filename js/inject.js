// inject.js - Se ejecuta en el contexto de la página (acceso total a window/XHR)
(function () {
  'use strict';

  // Evitar inyección doble
  if (window.__vimeoInjected) return;
  window.__vimeoInjected = true;

  const VIMEO_CONFIG_PATTERNS = [
    /player\.vimeo\.com\/video\/\d+/,
    /vimeo\.com\/api\/v2/,
    /fresnel\.vimeocdn\.com/,
    /api\.vimeo\.com/
  ];

  // ── 1. Interceptar XHR ──────────────────────────────────────────────────
  const _origOpen = XMLHttpRequest.prototype.open;
  const _origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this._url = url;
    return _origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        const url = this._url || '';
        if (!VIMEO_CONFIG_PATTERNS.some(p => p.test(url))) return;
        const data = JSON.parse(this.responseText);
        processVimeoConfig(data, url);
      } catch (e) {}
    });
    return _origSend.apply(this, arguments);
  };

  // ── 2. Interceptar fetch ─────────────────────────────────────────────────
  const _origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = (typeof input === 'string') ? input : (input && input.url) || '';
    const promise = _origFetch.apply(this, arguments);
    if (VIMEO_CONFIG_PATTERNS.some(p => p.test(url))) {
      promise.then(res => {
        const cloned = res.clone();
        cloned.json().then(data => processVimeoConfig(data, url)).catch(() => {});
      }).catch(() => {});
    }
    return promise;
  };

  // ── 3. Escanear window.vimeo y playerConfig ──────────────────────────────
  function scanWindowObjects() {
    try {
      // vimeo player config en window
      const candidates = [
        window?.vimeo?.clip_id && window.vimeo,
        window?.playerConfig,
        window?.vimeo_config,
        window?.Vimeo?.Player,
      ];
      candidates.forEach(obj => {
        if (obj && typeof obj === 'object') processVimeoConfig(obj, location.href);
      });

      // Buscar en scripts embebidos
      document.querySelectorAll('script').forEach(s => {
        const t = s.textContent;
        if (!t) return;
        // JSON de configuración inline
        const m = t.match(/var\s+config\s*=\s*(\{.+?\})\s*;/s) ||
                  t.match(/playerConfig\s*=\s*(\{.+?\})\s*[;,)]/s) ||
                  t.match(/"config":\s*(\{.+?"request":.+?\})/s);
        if (m) {
          try {
            processVimeoConfig(JSON.parse(m[1]), location.href);
          } catch (e) {}
        }

        // URL directa de config en scripts
        const urlMatch = t.match(/https:\/\/player\.vimeo\.com\/video\/\d+\?[^"'\s]+/);
        if (urlMatch) {
          window.postMessage({ type: 'VIMEO_CONFIG_URL', url: urlMatch[0] }, '*');
        }
      });
    } catch (e) {}
  }

  // ── 4. Procesar config y extraer videos ──────────────────────────────────
  function processVimeoConfig(data, sourceUrl) {
    if (!data || typeof data !== 'object') return;

    let files = null;
    let title = '';

    // Formato 1: config de player estándar
    if (data.request?.files) {
      files = data.request.files;
      title = data.video?.title || data.clip?.title || '';
    }
    // Formato 2: respuesta de API pública
    else if (data.progressive || data.hls || data.dash) {
      files = data;
      title = data.title || '';
    }
    // Formato 3: config anidada
    else if (data.config?.request?.files) {
      files = data.config.request.files;
      title = data.config?.video?.title || '';
    }
    // Formato 4: videos directos en respuesta
    else if (Array.isArray(data) && data[0]?.link) {
      const videos = data.filter(v => v.link && v.width).map(v => ({
        quality: v.quality || (v.width + 'p'),
        url: v.link,
        width: v.width || 0,
        height: v.height || 0
      }));
      if (videos.length > 0) {
        dispatchVideos(videos, data[0]?.name || 'video', sourceUrl);
        return;
      }
    }

    if (!files) return;

    const videos = [];

    // Progressive (MP4 directo)
    if (Array.isArray(files.progressive)) {
      files.progressive.forEach(v => {
        if (v.url) {
          videos.push({
            quality: v.quality || v.height + 'p',
            url: v.url,
            width: v.width || 0,
            height: v.height || 0,
            type: 'mp4'
          });
        }
      });
    }

    // HLS
    if (files.hls?.url) {
      videos.push({
        quality: 'HLS (Adaptativo)',
        url: files.hls.url,
        type: 'hls'
      });
    }

    // DASH
    if (files.dash?.url) {
      videos.push({
        quality: 'DASH (Adaptativo)',
        url: files.dash.url,
        type: 'dash'
      });
    }

    if (videos.length > 0) {
      // Ordenar por calidad descendente
      videos.sort((a, b) => (b.height || 0) - (a.height || 0));
      dispatchVideos(videos, title, sourceUrl);
    }
  }

  function dispatchVideos(videos, title, sourceUrl) {
    window.postMessage({
      type: 'VIMEO_VIDEOS_FOUND',
      videos,
      title,
      sourceUrl
    }, '*');
  }

  // ── 5. Observer para iframes y cambios dinámicos ─────────────────────────
  const observer = new MutationObserver(() => {
    scanWindowObjects();
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true });
      scanWindowObjects();
    });
  }

  // Escaneo inicial con delay para dejar que Vimeo inicialice
  setTimeout(scanWindowObjects, 500);
  setTimeout(scanWindowObjects, 2000);
  setTimeout(scanWindowObjects, 5000);

})();

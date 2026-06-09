// content.js - Content script (contexto aislado)
(function () {
  'use strict';

  // Inyectar inject.js en el contexto de la página
  function injectScript() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('js/inject.js');
    script.onload = function () { this.remove(); };
    (document.head || document.documentElement).appendChild(script);
  }

  injectScript();

  // Escuchar mensajes desde inject.js
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || !msg.type) return;

    if (msg.type === 'VIMEO_VIDEOS_FOUND') {
      // Enviar al background/popup
      chrome.runtime.sendMessage({
        action: 'VIDEOS_FOUND',
        videos: msg.videos,
        title: msg.title,
        pageUrl: location.href
      }).catch(() => {});
    }

    if (msg.type === 'VIMEO_CONFIG_URL') {
      chrome.runtime.sendMessage({
        action: 'CONFIG_URL',
        url: msg.url,
        pageUrl: location.href
      }).catch(() => {});
    }
  });

  // También detectar el video element de Vimeo player embebido
  function checkForVideoElements() {
    document.querySelectorAll('video').forEach(video => {
      const src = video.src || video.currentSrc;
      if (src && (src.includes('vimeocdn') || src.includes('vimeo'))) {
        chrome.runtime.sendMessage({
          action: 'VIDEO_ELEMENT_FOUND',
          url: src,
          pageUrl: location.href
        }).catch(() => {});
      }
    });
  }

  // Observer para <video> dinámicos
  const videoObserver = new MutationObserver(() => checkForVideoElements());
  const startObserver = () => {
    if (document.body) {
      videoObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] });
      checkForVideoElements();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }

})();

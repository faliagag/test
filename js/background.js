// background.js - Service Worker

// Almacén de videos por tab
const videoStore = {};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  if (msg.action === 'VIDEOS_FOUND') {
    if (!videoStore[tabId]) videoStore[tabId] = { videos: [], title: '', pageUrl: '' };
    const store = videoStore[tabId];
    store.title = msg.title || store.title;
    store.pageUrl = msg.pageUrl || store.pageUrl;

    // Agregar solo videos nuevos (sin duplicados por URL)
    const existingUrls = new Set(store.videos.map(v => v.url));
    msg.videos.forEach(v => {
      if (!existingUrls.has(v.url)) {
        store.videos.push(v);
        existingUrls.add(v.url);
      }
    });

    // Actualizar badge
    const count = store.videos.filter(v => v.type === 'mp4' || !v.type).length || store.videos.length;
    chrome.action.setBadgeText({ text: String(count), tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#1ab7ea', tabId });
    sendResponse({ ok: true });
  }

  if (msg.action === 'VIDEO_ELEMENT_FOUND') {
    if (!videoStore[tabId]) videoStore[tabId] = { videos: [], title: '', pageUrl: '' };
    const store = videoStore[tabId];
    const existingUrls = new Set(store.videos.map(v => v.url));
    if (!existingUrls.has(msg.url)) {
      store.videos.push({ url: msg.url, quality: 'Detectado', type: 'mp4' });
      chrome.action.setBadgeText({ text: String(store.videos.length), tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#1ab7ea', tabId });
    }
    sendResponse({ ok: true });
  }

  if (msg.action === 'GET_VIDEOS') {
    const store = videoStore[tabId] || { videos: [], title: '', pageUrl: '' };
    sendResponse(store);
    return true; // async
  }

  if (msg.action === 'CLEAR_VIDEOS') {
    delete videoStore[tabId];
    chrome.action.setBadgeText({ text: '', tabId });
    sendResponse({ ok: true });
  }

  return true;
});

// Limpiar al cambiar de URL
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && changeInfo.url) {
    delete videoStore[tabId];
    chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  delete videoStore[tabId];
});

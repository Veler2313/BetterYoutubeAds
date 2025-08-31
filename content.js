// --------------------
// Full script: video overlay (unchanged) + improved thumbnail blocking (fixes remaining gaps)
// --------------------

let lastMuteState = null;
let overlay = null;

const getVideo = () => document.querySelector('video');
const isAdPlaying = () => document.querySelector('.ad-showing') !== null;
const getAdTitle = () => 'Advertisement';

const createOverlay = (text) => {
  if (overlay) return;

  overlay = document.createElement('div');
  overlay.style.position = 'absolute';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = 'black';
  overlay.style.color = 'white';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = '10';
  overlay.style.fontSize = '24px';
  overlay.style.pointerEvents = 'none';
  overlay.style.textAlign = 'center';
  overlay.innerText = text || 'Advertisement';

  const player = document.querySelector('.html5-video-player');
  const controls = document.querySelector('.ytp-chrome-bottom');
  if (player && controls) {
    player.insertBefore(overlay, controls);
  } else if (player) {
    player.appendChild(overlay);
  }
};

const removeOverlay = () => {
  if (overlay?.parentNode) overlay.parentNode.removeChild(overlay);
  overlay = null;
};

const checkAdState = () => {
  const vid = getVideo();
  if (!vid) return;

  const ad = isAdPlaying();

  if (ad && !overlay) {
    lastMuteState = vid.muted;
    vid.muted = true;
    createOverlay(getAdTitle());
  } else if (ad && overlay) {
    vid.muted = true;
  } else if (!ad && overlay) {
    vid.muted = lastMuteState ?? false;
    lastMuteState = null;
    removeOverlay();
  }
};

// --------------------
// Thumbnail blocker: robust + fixes remaining gap edge-cases
// --------------------

const OVERLAY_CLASS = '__yt_ad_blocker_overlay_v3';
const INJECTED_FLAG = '__yt_ad_blocker_injected_v3';

const badgeSelectors = [
  'ytd-badge-supported-renderer',
  '.badge-shape-wiz__text',
  '.yt-badge',
  'span.badge',
  '[aria-label*="Sponsored" i]',
  '[title*="Sponsored" i]',
  '[aria-label*="Ad" i]',
  '[title*="Ad" i]'
];

const cardSelectors = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-rich-grid-media',
  'ytd-shelf-renderer',
  'ytd-rich-section-renderer'
];

const maxBadgesPerRun = 60; // safety cap per cycle

const detectAdText = (node) => {
  try {
    const txt = (node.innerText || node.textContent || '').trim();
    if (/\b(?:Sponsored|Sponsored content|Promoted|Promo|Ad|Advertisement)\b/i.test(txt)) return true;
    const attrs = ['aria-label','title','alt'];
    for (const a of attrs) {
      const v = node.getAttribute && node.getAttribute(a);
      if (v && /\b(?:Sponsored|Promoted|Ad|Advertisement|Promo)\b/i.test(v)) return true;
    }
  } catch (e) { /* ignore */ }
  return false;
};

const findCardRoot = (node) => {
  if (!node) return null;
  for (const sel of cardSelectors) {
    const c = node.closest(sel);
    if (c) return c;
  }
  return null;
};

const findThumbnailContainerInCard = (card) => {
  if (!card) return null;
  const preferred = card.querySelector('ytd-thumbnail, a#thumbnail, #thumbnail, .ytd-thumbnail, .thumbnail');
  if (preferred) return preferred;

  // fallback: find an <img> and return its closest clickable/div wrapper inside the card
  const img = card.querySelector('img');
  if (img) {
    const candidate = img.closest('a, div, ytd-thumbnail') || img.parentElement || img;
    return candidate;
  }
  return null;
};

const isReasonableThumbnail = (el) => {
  if (!el || typeof el.getBoundingClientRect !== 'function') return false;
  const r = el.getBoundingClientRect();
  if (r.width < 20 || r.height < 10) return false;
  if (r.height > window.innerHeight * 0.85) return false;
  return true;
};

const ancestorHasInjection = (el) => {
  let cur = el;
  while (cur && cur !== document.body) {
    if (cur.dataset && cur.dataset[INJECTED_FLAG] === 'true') return true;
    cur = cur.parentElement;
  }
  return false;
};

const hideThumbnailImages = (thumb) => {
  try {
    const imgs = thumb.querySelectorAll('img');
    imgs.forEach((img) => {
      if (!img) return;
      if (img.dataset?.originalVisibility == null) {
        img.dataset.originalVisibility = img.style.visibility || '';
      }
      img.style.visibility = 'hidden';
      img.dataset[INJECTED_FLAG + '_img'] = '1';
    });
  } catch (e) {}
};

// Hide simple background-images on immediate children (common YouTube thumbnail wrappers)
const hideChildBackgroundImages = (thumb) => {
  try {
    const children = Array.from(thumb.children || []);
    children.forEach((ch) => {
      const cs = window.getComputedStyle(ch);
      if (cs && cs.backgroundImage && cs.backgroundImage !== 'none') {
        if (ch.dataset?.originalBgImage == null) {
          ch.dataset.originalBgImage = ch.style.backgroundImage || '';
        }
        ch.style.backgroundImage = 'none';
      }
    });
    // also remove inline background-image on thumb itself if present
    const selfCs = window.getComputedStyle(thumb);
    if (selfCs && selfCs.backgroundImage && selfCs.backgroundImage !== 'none') {
      if (thumb.dataset?.originalBgImage == null) thumb.dataset.originalBgImage = thumb.style.backgroundImage || '';
      thumb.style.backgroundImage = 'none';
    }
  } catch (e) {}
};

// find highest numeric z-index among descendants (returns -Infinity if none)
const getHighestZIndex = (el) => {
  try {
    let maxZ = -Infinity;
    const nodes = el.querySelectorAll('*');
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const cs = window.getComputedStyle(n);
      if (!cs) continue;
      const z = cs.zIndex;
      if (!z || z === 'auto') continue;
      const zi = parseInt(z, 10);
      if (!Number.isNaN(zi)) {
        if (zi > maxZ) maxZ = zi;
      }
    }
    // also check direct children and thumb itself
    const csThumb = window.getComputedStyle(el);
    if (csThumb) {
      const zt = csThumb.zIndex;
      if (zt && zt !== 'auto') {
        const zti = parseInt(zt, 10);
        if (!Number.isNaN(zti) && zti > maxZ) maxZ = zti;
      }
    }
    return maxZ;
  } catch (e) {
    return -Infinity;
  }
};

const injectBlockerOn = (thumb) => {
  if (!thumb) return;
  if (thumb.dataset[INJECTED_FLAG] === 'true') return;
  if (ancestorHasInjection(thumb)) return;

  const card = findCardRoot(thumb);
  if (!card) return;
  if (!isReasonableThumbnail(thumb)) return;

  try {
    // conservative marking to avoid races
    try { thumb.dataset[INJECTED_FLAG] = 'true'; } catch (_) {}

    // ensure thumbnail container itself has black background so padding gaps become black
    try { thumb.dataset.originalBgColor = thumb.style.backgroundColor || ''; } catch (_) {}
    thumb.style.backgroundColor = 'black';

    // hide underlying images and simple background-images to prevent gray edges
    hideThumbnailImages(thumb);
    hideChildBackgroundImages(thumb);

    // compute highest z-index inside this thumbnail and place blocker above it
    const highest = getHighestZIndex(thumb);
    const blocker = document.createElement('div');
    blocker.className = OVERLAY_CLASS;
    blocker.style.position = 'absolute';
    blocker.style.inset = '0';
    blocker.style.margin = '0';
    blocker.style.padding = '0';
    blocker.style.boxSizing = 'border-box';
    blocker.style.width = '100%';
    blocker.style.height = '100%';
    blocker.style.backgroundColor = 'black';
    blocker.style.display = 'flex';
    blocker.style.alignItems = 'center';
    blocker.style.justifyContent = 'center';
    blocker.style.fontSize = '14px';
    // choose a z-index that is higher than any child; keep it bounded to avoid interfering with global UI
    const safeZ = Number.isFinite(highest) ? Math.min(highest + 10, 2147483640) : 999999;
    blocker.style.zIndex = String(safeZ);
    blocker.style.pointerEvents = 'none';
    blocker.style.textAlign = 'center';
    blocker.style.lineHeight = '1';
    blocker.style.userSelect = 'none';
    blocker.style.transform = 'translateZ(0)';

    const label = document.createElement('span');
    label.style.display = 'inline-block';
    label.style.maxWidth = '90%';
    label.style.wordBreak = 'break-word';
    label.style.textAlign = 'center';
    label.style.color = 'white';
    label.style.fontWeight = '500';
    label.textContent = 'Advertisement';
    blocker.appendChild(label);

    const computed = window.getComputedStyle(thumb);
    if (!computed || computed.position === 'static') {
      thumb.style.position = 'relative';
    }
    thumb.style.overflow = 'hidden';

    thumb.appendChild(blocker);
  } catch (e) {
    try { delete thumb.dataset[INJECTED_FLAG]; } catch (_) {}
  }
};

const injectSponsoredBannerOverlay = () => {
  try {
    let processed = 0;

    for (const sel of badgeSelectors) {
      if (processed >= maxBadgesPerRun) break;
      const nodes = document.querySelectorAll(sel);
      for (let i = 0; i < nodes.length && processed < maxBadgesPerRun; i++) {
        const node = nodes[i];
        if (!node || node.dataset && node.dataset._adOverlayChecked) continue;
        try { node.dataset._adOverlayChecked = '1'; } catch (e) {}
        if (detectAdText(node)) {
          const card = findCardRoot(node);
          if (!card) { processed++; continue; }
          const thumb = findThumbnailContainerInCard(card);
          if (thumb) injectBlockerOn(thumb);
        }
        processed++;
      }
    }

    if (processed < maxBadgesPerRun) {
      const cardCandidates = document.querySelectorAll(cardSelectors.join(','));
      for (let i = 0; i < cardCandidates.length && processed < maxBadgesPerRun; i++) {
        const card = cardCandidates[i];
        if (!card || card.dataset && card.dataset._cardAdChecked) continue;
        try { card.dataset._cardAdChecked = '1'; } catch (e) {}
        const snap = (card.innerText || card.textContent || '').slice(0, 300);
        if (/\b(?:Sponsored|Promoted|Ad|Advertisement|Promo)\b/i.test(snap)) {
          const thumb = findThumbnailContainerInCard(card);
          if (thumb) injectBlockerOn(thumb);
        }
        processed++;
      }
    }
  } catch (err) {
    // swallow
  }
};

// ---------- scheduling & observer (debounced, idle-friendly) ----------
let overlayScheduled = false;
let observerTimeout = null;

const scheduleOverlayCheck = () => {
  if (overlayScheduled) return;
  overlayScheduled = true;

  const run = () => {
    overlayScheduled = false;
    if (typeof window.requestIdleCallback === 'function') {
      try {
        requestIdleCallback(() => {
          try { injectSponsoredBannerOverlay(); } catch (e) {}
        }, {timeout: 1000});
      } catch (e) {
        setTimeout(() => { try { injectSponsoredBannerOverlay(); } catch (e) {} }, 250);
      }
    } else {
      setTimeout(() => { try { injectSponsoredBannerOverlay(); } catch (e) {} }, 250);
    }
  };

  clearTimeout(observerTimeout);
  observerTimeout = setTimeout(run, 150);
};

const startObservers = () => {
  const observer = new MutationObserver(() => {
    try { scheduleOverlayCheck(); } catch (e) {}
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // backup periodic scan (infrequent)
  setInterval(() => {
    try { injectSponsoredBannerOverlay(); } catch (e) {}
  }, 4000);

  // keep the original video ad detection intact and frequent
  setInterval(checkAdState, 500);
  checkAdState();
  injectSponsoredBannerOverlay();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObservers);
} else {
  startObservers();
}

// --------------------
// Reload-at-current-time button + hotkey + cached time (5 Hz when no ad)
// --------------------
(function() {
  let lastMainVideoSeconds = 0;
  let timePoller = null;

  function pollMainTime() {
    // Only record time when NOT in an ad
    const adNow = (typeof isAdPlaying === 'function')
      ? isAdPlaying()
      : (document.querySelector('.ad-showing') !== null);

    if (adNow) return;

    const v = document.querySelector('video');
    if (v && !Number.isNaN(v.currentTime)) {
      lastMainVideoSeconds = Math.floor(v.currentTime);
    } else if (window.ytplayer && ytplayer.getCurrentTime) {
      // Fallback to YT API if <video> missing
      lastMainVideoSeconds = Math.floor(ytplayer.getCurrentTime());
    }
  }

  function ensureTimePoller() {
    if (timePoller) return;
    timePoller = setInterval(pollMainTime, 200); // 5 times/sec
  }

  function reloadAtCachedTime() {
    const seconds = lastMainVideoSeconds | 0;
    const url = new URL(window.location.href);
    url.searchParams.set('t', seconds + 's');
    window.location.href = url.toString();
  }

  function addReloadButton() {
    if (document.getElementById('yt-reload-btn')) return;

    const rightControls = document.querySelector('.ytp-right-controls');
    if (!rightControls) return;

    const btn = document.createElement('button');
    btn.id = 'yt-reload-btn';
    btn.className = 'ytp-button';
    btn.title = 'Reload at current time';
    btn.innerHTML = '⟳';

    btn.addEventListener('click', reloadAtCachedTime);
    rightControls.insertBefore(btn, rightControls.firstChild);
  }

  // Keep button present across SPA updates, and keep poller alive
  const observer = new MutationObserver(() => {
    addReloadButton();
    ensureTimePoller();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial kick
  addReloadButton();
  ensureTimePoller();
  pollMainTime();

  // Hotkey: numpad *
  document.addEventListener('keydown', (e) => {
    if (e.code === 'NumpadMultiply') {
      e.preventDefault();
      reloadAtCachedTime();
    }
  });

  // Resume polling when tab becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ensureTimePoller();
  });
})();

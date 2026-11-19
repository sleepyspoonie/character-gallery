/* Character Gallery — a static site that keeps its pictures and data in its own GitHub repository.
 *
 * Anyone can view it. Whoever has a GitHub token with write access to the repo can sign in
 * (the token is stored only in that browser) and upload, edit, delete and feature pictures.
 * Every change is one commit that touches data/gallery.json and, for uploads/deletes, images/.
 */
(function () {
  'use strict';

  const SETTINGS_KEY = 'characterGallery.settings.v1';
  const DATA_PATH = 'data/gallery.json';
  const IMAGE_DIR = 'images';
  const API = 'https://api.github.com';
  const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
  const MAX_BYTES = 25 * 1024 * 1024;
  const TIERS = [
    { id: 'major', label: 'Major', heading: 'Major characters' },
    { id: 'minor', label: 'Minor', heading: 'Minor characters' },
    { id: 'background', label: 'Background', heading: 'Background characters' }
  ];
  const TIER_IDS = TIERS.map((t) => t.id);
  const SORTS = [
    { id: 'tier', label: 'Tier', long: 'By character tier — major, then minor, then background' },
    { id: 'newest', label: 'Most recent', long: 'Most recently updated first' },
    { id: 'oldest', label: 'Least recent', long: 'Least recently updated first' },
    { id: 'az', label: 'A–Z', long: 'Alphabetical' }
  ];
  const SORT_IDS = SORTS.map((s) => s.id);
  const FILTERS = TIERS.map((t) => ({ id: t.id, label: t.label })).concat([{ id: 'none', label: 'No tier' }]);

  const app = document.getElementById('app');
  const topbarActions = document.getElementById('topbar-actions');
  const modalRoot = document.getElementById('modal-root');
  const toastEl = document.getElementById('toast');

  const state = {
    data: { version: 1, pictures: [], featured: {} },
    loaded: false,
    loadError: null,
    settings: loadSettings(),
    sort: null,               // homepage order picked this visit; null = use the saved default
    tierFilter: null,         // Set of tiers shown this visit; null = use the saved default
    query: '',
    open: new Set(),          // picture ids whose details are expanded
    localImages: {},          // id -> object URL for pictures uploaded this session
    pendingAdd: null,         // picture sent over by the Picrew button, waiting for the upload form
    quickAdd: false,          // this window was opened by the Picrew button
    busy: false
  };

  /* ------------------------------------------------------------------ utils */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function slugify(s) {
    return String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'character';
  }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function randomId(len) {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    const bytes = new Uint8Array(len);
    crypto.getRandomValues(bytes);
    let out = '';
    for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
    return out;
  }
  function stamp(d) {
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  }
  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '—';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function isHttpUrl(s) {
    try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch (e) { return false; }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function sameName(a, b) { return a.trim().toLowerCase() === b.trim().toLowerCase(); }

  const ICON = {
    plus: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>',
    chevron: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    close: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    ext: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
    image: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    key: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="M10.8 12.2L20 3M16 7l3 3M14 9l2 2"/></svg>',
    gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
  };

  function toast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', !!isError);
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), isError ? 7000 : 3500);
  }

  /* --------------------------------------------------------------- settings */

  function detectRepo() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!m) return { owner: '', repo: '' };
    const owner = m[1];
    const first = location.pathname.split('/').filter(Boolean)[0];
    const repo = first && !/\.html?$/i.test(first) ? first : owner + '.github.io';
    return { owner: owner, repo: repo };
  }
  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (e) { saved = {}; }
    const guess = detectRepo();
    return {
      token: saved.token || '',
      owner: saved.owner || guess.owner,
      repo: saved.repo || guess.repo,
      branch: saved.branch || ''
    };
  }
  function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* private mode etc. */ }
  }
  function clearSettings() {
    try { localStorage.removeItem(SETTINGS_KEY); } catch (e) { /* ignore */ }
  }
  function signedIn() {
    const s = state.settings;
    return !!(s.token && s.owner && s.repo && s.branch);
  }

  /* ------------------------------------------------------------- GitHub API */

  function repoBase(s) {
    s = s || state.settings;
    return '/repos/' + encodeURIComponent(s.owner) + '/' + encodeURIComponent(s.repo);
  }
  function branchPath(b) { return b.split('/').map(encodeURIComponent).join('/'); }

  async function gh(path, opts) {
    opts = opts || {};
    const s = opts.settings || state.settings;
    const headers = Object.assign({
      'Accept': 'application/vnd.github+json',
      'Authorization': 'Bearer ' + s.token,
      'X-GitHub-Api-Version': '2022-11-28'
    }, opts.body ? { 'Content-Type': 'application/json' } : {}, opts.headers || {});
    const res = await fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store'
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).message || ''; } catch (e) { /* not json */ }
      const err = new Error(detail || ('GitHub said ' + res.status));
      err.status = res.status;
      throw err;
    }
    if (opts.raw) return res;
    if (res.status === 204) return null;
    return res.json();
  }

  async function ghReadData(ref) {
    const res = await gh(repoBase() + '/contents/' + DATA_PATH + '?ref=' + encodeURIComponent(ref), {
      headers: { 'Accept': 'application/vnd.github.raw+json' }, raw: true
    });
    return normalize(JSON.parse(await res.text()));
  }

  /* Make one commit. `mutate` gets a fresh copy of gallery.json as it is on the branch right now
   * and returns the new version; on a race with another device we re-read and try again. */
  async function commitChange(message, mutate, extra) {
    extra = extra || {};
    const base = repoBase();
    const branch = branchPath(state.settings.branch);
    const added = [];
    for (const f of (extra.add || [])) {
      const blob = await gh(base + '/git/blobs', { method: 'POST', body: { content: f.base64, encoding: 'base64' } });
      added.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const ref = await gh(base + '/git/ref/heads/' + branch);
      const headSha = ref.object.sha;
      const head = await gh(base + '/git/commits/' + headSha);
      const current = await ghReadData(headSha);
      const next = normalize(mutate(clone(current)));
      const jsonBlob = await gh(base + '/git/blobs', {
        method: 'POST', body: { content: JSON.stringify(next, null, 2) + '\n', encoding: 'utf-8' }
      });
      const removals = (extra.remove || []).filter(Boolean).map((p) => ({ path: p, mode: '100644', type: 'blob', sha: null }));
      const tree = await gh(base + '/git/trees', {
        method: 'POST',
        body: { base_tree: head.tree.sha, tree: added.concat([{ path: DATA_PATH, mode: '100644', type: 'blob', sha: jsonBlob.sha }], removals) }
      });
      const commit = await gh(base + '/git/commits', {
        method: 'POST', body: { message: message, tree: tree.sha, parents: [headSha] }
      });
      try {
        await gh(base + '/git/refs/heads/' + branch, { method: 'PATCH', body: { sha: commit.sha, force: false } });
        state.data = next;
        return next;
      } catch (e) {
        if (e.status === 422 && attempt < 2) continue;
        throw e;
      }
    }
    throw new Error('Could not save after several tries.');
  }

  function explainError(e) {
    if (e.status === 401) return 'GitHub didn’t accept your key. It may have expired — sign in again with a new one.';
    if (e.status === 403) return 'Your key can’t write to this repository. Check it has “Contents: Read and write”.';
    if (e.status === 404) return 'GitHub couldn’t find that repository or branch. Check the names in Settings.';
    return e.message || 'Something went wrong.';
  }

  /* ------------------------------------------------------------------- data */

  function normalize(d) {
    d = d && typeof d === 'object' ? d : {};
    const pictures = Array.isArray(d.pictures) ? d.pictures : [];
    return {
      version: 1,
      pictures: pictures.filter((p) => p && p.id && p.file).map((p) => ({
        id: String(p.id),
        file: String(p.file),
        originalName: p.originalName || '',
        characters: Array.isArray(p.characters) ? p.characters.filter(Boolean).map(String) : [],
        tags: Array.isArray(p.tags) ? p.tags.filter(Boolean).map(String) : [],
        source: { label: (p.source && p.source.label) || '', url: (p.source && p.source.url) || '' },
        madeBy: p.madeBy || '',
        notes: p.notes || '',
        added: p.added || ''
      })),
      featured: d.featured && typeof d.featured === 'object' ? Object.assign({}, d.featured) : {},
      characterInfo: normalizeCharacterInfo(d.characterInfo),
      settings: {
        defaultSort: d.settings && SORT_IDS.indexOf(d.settings.defaultSort) !== -1 ? d.settings.defaultSort : 'tier',
        hideBackground: !!(d.settings && d.settings.hideBackground)
      }
    };
  }
  // Per-character settings (not per picture), keyed by character name. Right now: { tier }.
  function normalizeCharacterInfo(info) {
    const out = {};
    if (!info || typeof info !== 'object') return out;
    Object.keys(info).forEach((name) => {
      const v = info[name];
      if (v && typeof v === 'object' && TIER_IDS.indexOf(v.tier) !== -1) out[name] = { tier: v.tier };
    });
    return out;
  }
  function infoKey(name) {
    const keys = Object.keys(state.data.characterInfo);
    return keys.find((k) => k === name) || keys.find((k) => sameName(k, name)) || null;
  }
  function tierOf(name) {
    const k = infoKey(name);
    return k ? state.data.characterInfo[k].tier : '';
  }
  function currentSort() { return state.sort || state.data.settings.defaultSort || 'tier'; }
  function shownTiers() {
    if (state.tierFilter) return state.tierFilter;
    const all = new Set(FILTERS.map((f) => f.id));
    if (state.data.settings.hideBackground) all.delete('background');
    return all;
  }
  function tierKey(c) { return c.tier || 'none'; }

  async function loadData() {
    let data = null;
    if (signedIn()) {
      try { data = await ghReadData(state.settings.branch); }
      catch (e) { console.warn('Reading from GitHub failed, falling back to the site copy.', e); }
    }
    if (!data) {
      const res = await fetch(DATA_PATH + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('Couldn’t load ' + DATA_PATH + ' (' + res.status + ').');
      data = normalize(await res.json());
    }
    state.data = data;
  }

  function newestFirst(a, b) {
    if (a.added === b.added) return a.id < b.id ? 1 : -1;
    return a.added < b.added ? 1 : -1;
  }

  /* Build one entry per character from the tags on the pictures. */
  function characters() {
    const map = new Map();
    for (const p of state.data.pictures) {
      for (const name of p.characters) {
        const key = name.trim().toLowerCase();
        if (!map.has(key)) map.set(key, { name: name.trim(), pictures: [] });
        map.get(key).pictures.push(p);
      }
    }
    const list = [];
    for (const c of map.values()) {
      c.pictures.sort(newestFirst);
      const featId = state.data.featured[c.name];
      const featured = featId ? c.pictures.find((p) => p.id === featId) : null;
      c.featuredId = featured ? featured.id : null;
      c.cover = featured || c.pictures[0];
      c.slug = slugify(c.name);
      c.latest = c.pictures[0].added;
      c.tier = tierOf(c.name);
      list.push(c);
    }
    return list;
  }
  function knownNames() { return characters().map((c) => c.name); }
  function canonicalName(raw) {
    const v = raw.trim().replace(/\s+/g, ' ');
    const hit = knownNames().find((n) => sameName(n, v));
    return hit || v;
  }

  function imageUrl(p) { return state.localImages[p.id] || p.file; }

  // A picture that was just committed may not be on the published site yet (Pages takes a minute
  // to rebuild). If an image fails to load, fetch it straight from the repository instead.
  document.addEventListener('error', async function (e) {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || !img.dataset.file || img.dataset.retried) return;
    img.dataset.retried = '1';
    const s = state.settings;
    if (!s.owner || !s.repo) return;
    try {
      if (s.token && s.branch) {
        const res = await gh(repoBase() + '/contents/' + img.dataset.file.split('/').map(encodeURIComponent).join('/') +
          '?ref=' + encodeURIComponent(s.branch), { headers: { 'Accept': 'application/vnd.github.raw+json' }, raw: true });
        img.src = URL.createObjectURL(await res.blob());
      } else {
        img.src = 'https://raw.githubusercontent.com/' + encodeURIComponent(s.owner) + '/' + encodeURIComponent(s.repo) +
          '/HEAD/' + img.dataset.file;
      }
    } catch (err) { /* leave it broken */ }
  }, true);

  function imgTag(p, alt, extraAttrs) {
    return '<img src="' + esc(imageUrl(p)) + '" data-file="' + esc(p.file) + '" alt="' + esc(alt || '') + '" loading="lazy"' + (extraAttrs || '') + '>';
  }

  /* ------------------------------------------------------------------ tabs */

  function renderTabs(view) {
    const nav = document.getElementById('tabs');
    if (!nav) return;
    const onPicrews = view === 'picrews' || view === 'picrew';
    nav.innerHTML =
      '<a class="tab" href="#/"' + (onPicrews ? '' : ' aria-current="page"') + '>Characters</a>' +
      '<a class="tab" href="#/picrews"' + (onPicrews ? ' aria-current="page"' : '') + '>Picrews</a>';
  }

  /* --------------------------------------------------------------- picrews */

  // Pictures are grouped by the Picrew's own number (picrew.me/…/image_maker/<number>), so a Picrew
  // still counts as one even if its pictures were labelled differently.
  function picrewId(url) {
    const m = String(url || '').match(/^https?:\/\/(?:www\.)?picrew\.me\/(?:[a-z-]+\/)?image_maker\/(\d+)/i);
    return m ? m[1] : null;
  }
  function picrews() {
    const map = new Map();
    for (const p of state.data.pictures) {
      const id = picrewId(p.source.url);
      if (!id) continue;
      if (!map.has(id)) map.set(id, { id: id, pictures: [] });
      map.get(id).pictures.push(p);
    }
    return Array.from(map.values()).map((g) => {
      g.pictures.sort(newestFirst);
      const labelled = g.pictures.find((p) => p.source.label);
      g.name = labelled ? labelled.source.label : 'Picrew ' + g.id;
      g.url = 'https://picrew.me/en/image_maker/' + g.id;
      g.lastUsed = g.pictures[0].added;
      const seen = [];
      g.pictures.forEach((p) => p.characters.forEach((n) => { if (!seen.some((x) => sameName(x, n))) seen.push(n); }));
      g.characters = seen;
      const labels = new Set(g.pictures.map((p) => p.source.label).filter(Boolean));
      g.mixedNames = labels.size > 1;
      return g;
    });
  }

  function renderPicrews() {
    document.title = 'Picrews · Character Gallery';
    const list = picrews();
    const editable = signedIn();
    const sort = state.picrewSort || 'used';
    if (sort === 'az') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'recent') list.sort((a, b) => (a.lastUsed < b.lastUsed ? 1 : a.lastUsed > b.lastUsed ? -1 : 0));
    else list.sort((a, b) => b.pictures.length - a.pictures.length || a.name.localeCompare(b.name));
    const used = state.data.pictures.filter((p) => picrewId(p.source.url)).length;

    const rows = list.map((g) => {
      const thumbs = g.pictures.slice(0, 3).map((p) => imgTag(p, '')).join('');
      const shown = g.characters.slice(0, 3).map((n) =>
        '<a class="chip-link small" href="#/c/' + esc(encodeURIComponent(slugify(n))) + '">' + esc(n) + '</a>').join('');
      const more = g.characters.length > 3 ? '<span class="muted" style="font-size:13px">+' + (g.characters.length - 3) + ' more</span>' : '';
      return '<li class="picrew-row">' +
        '<a class="picrew-thumbs" href="#/picrews/' + esc(g.id) + '" aria-hidden="true" tabindex="-1">' + thumbs + '</a>' +
        '<div class="picrew-main">' +
          '<a class="picrew-name" href="#/picrews/' + esc(g.id) + '">' + esc(g.name) + '</a>' +
          '<span class="picrew-meta">' + esc(plural(g.pictures.length, 'picture') + ' · last used ' + fmtDate(g.lastUsed)) + '</span>' +
        '</div>' +
        '<div class="picrew-chars">' + shown + more + '</div>' +
        '<div class="picrew-actions">' +
          '<a class="btn btn-small" href="' + esc(g.url) + '" target="_blank" rel="noopener noreferrer">Open Picrew' + ICON.ext + '</a>' +
          (editable ? '<button type="button" class="btn btn-small" data-rename="' + esc(g.id) + '">Rename</button>' : '') +
        '</div>' +
      '</li>';
    }).join('');

    app.innerHTML =
      '<div class="page-head">' +
        '<div><h1 class="page-title">Picrews</h1>' +
        '<p class="page-sub">' + esc(plural(list.length, 'Picrew') + ' · ' + plural(used, 'picture')) + '</p></div>' +
        (list.length > 1
          ? '<div class="segmented" role="group" aria-label="Order Picrews by">' +
              [['used', 'Most used'], ['recent', 'Recently used'], ['az', 'A–Z']].map((o) =>
                '<button type="button" data-psort="' + o[0] + '" aria-pressed="' + (sort === o[0]) + '">' + o[1] + '</button>').join('') +
            '</div>'
          : '') +
      '</div>' +
      (list.length
        ? '<ul class="picrew-list">' + rows + '</ul>'
        : '<div class="empty">No Picrews yet. Pictures whose link points to a Picrew show up here.</div>');

    app.querySelectorAll('[data-psort]').forEach((b) => b.addEventListener('click', () => { state.picrewSort = b.dataset.psort; render(); }));
    app.querySelectorAll('[data-rename]').forEach((b) => b.addEventListener('click', () => {
      const g = picrews().find((x) => x.id === b.dataset.rename);
      if (g) openRenamePicrew(g);
    }));
  }

  function renderPicrew(id) {
    const g = picrews().find((x) => x.id === id);
    if (!g) {
      document.title = 'Not found · Character Gallery';
      app.innerHTML = '<a class="back-link" href="#/picrews">' + ICON.back + 'All Picrews</a>' +
        '<div class="empty" style="margin-top:16px">No pictures use this Picrew any more.</div>';
      return;
    }
    document.title = g.name + ' · Character Gallery';
    const editable = signedIn();
    app.innerHTML =
      '<a class="back-link" href="#/picrews">' + ICON.back + 'All Picrews</a>' +
      '<div class="char-head">' + imgTag(g.pictures[0], '') +
        '<div class="char-head-text"><h1 class="page-title">' + esc(g.name) + '</h1>' +
        '<p class="page-sub">' + esc(plural(g.pictures.length, 'picture') + ' of ' + plural(g.characters.length, 'character') + ' · last used ' + fmtDate(g.lastUsed)) + '</p>' +
        '<div class="pic-actions" style="margin-top:12px">' +
          '<a class="btn btn-small" href="' + esc(g.url) + '" target="_blank" rel="noopener noreferrer">Open Picrew' + ICON.ext + '</a>' +
          (editable ? '<button type="button" class="btn btn-small" id="rename-picrew">Rename</button>' : '') +
        '</div>' +
        (g.mixedNames && editable ? '<p class="hint" style="margin:10px 0 0">Some pictures call this Picrew by a different name. Renaming sets the same name on all of them.</p>' : '') +
        '</div>' +
      '</div>' +
      '<div class="pictures">' + g.pictures.map((p) => pictureCard(p, null, editable)).join('') + '</div>';
    wirePictureCards({ picrewId: g.id });
    const rn = document.getElementById('rename-picrew');
    if (rn) rn.addEventListener('click', () => openRenamePicrew(g));
  }

  function openRenamePicrew(g) {
    const m = openModal(
      '<div class="dialog narrow" role="dialog" aria-modal="true" aria-labelledby="rn-title">' +
        '<div class="dialog-head"><h2 id="rn-title">Rename Picrew</h2>' +
          '<button type="button" class="icon-btn" aria-label="Close" data-close>' + ICON.close + '</button></div>' +
        '<form class="dialog-body single" id="rn-form" novalidate>' +
          '<div class="field"><label for="rn-name">Name</label>' +
            '<input class="input" id="rn-name" autocomplete="off" value="' + esc(g.name) + '"></div>' +
          '<p class="hint" style="margin:0">Changes the “Where it’s from” name on all ' + esc(plural(g.pictures.length, 'picture')) + ' made with this Picrew.</p>' +
          '<p class="form-error" id="rn-error" role="alert" hidden></p>' +
        '</form>' +
        '<div class="dialog-foot">' +
          '<button type="button" class="btn" data-close>Cancel</button>' +
          '<button type="submit" form="rn-form" class="btn btn-primary" id="rn-save">Rename</button>' +
        '</div>' +
      '</div>');
    const d = m.dialog;
    const input = d.querySelector('#rn-name');
    input.focus();
    input.select();
    d.querySelector('#rn-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = input.value.trim().replace(/\s+/g, ' ');
      const err = d.querySelector('#rn-error');
      if (!name) { err.textContent = 'Give it a name.'; err.hidden = false; return; }
      if (state.busy) return;
      const btn = d.querySelector('#rn-save');
      btn.disabled = true;
      btn.textContent = 'Renaming…';
      state.busy = true;
      try {
        let n = 0;
        await commitChange('Rename Picrew ' + g.id + ' to ' + name, (data) => {
          data.pictures.forEach((p) => { if (picrewId(p.source.url) === g.id) { p.source.label = name; n++; } });
          return data;
        });
        state.busy = false;
        m.close();
        toast('Renamed on ' + plural(n, 'picture') + '.');
        render();
      } catch (ex) {
        state.busy = false;
        btn.disabled = false;
        btn.textContent = 'Rename';
        err.textContent = explainError(ex);
        err.hidden = false;
      }
    });
  }

  /* ---------------------------------------------------------------- top bar */

  function renderTopbar() {
    if (signedIn()) {
      topbarActions.innerHTML =
        '<button type="button" class="icon-btn" id="settings-btn" aria-label="Settings">' + ICON.gear + '</button>' +
        '<button type="button" class="btn btn-primary" id="upload-btn">' + ICON.plus + 'Upload picture</button>';
      document.getElementById('upload-btn').addEventListener('click', () => {
        const route = parseRoute();
        const c = route.slug ? characters().find((x) => x.slug === route.slug) : null;
        openPictureForm({ mode: 'upload', presetCharacters: c ? [c.name] : [] });
      });
    } else {
      topbarActions.innerHTML =
        '<button type="button" class="btn btn-quiet" id="settings-btn">' + ICON.key + 'Sign in</button>';
    }
    document.getElementById('settings-btn').addEventListener('click', openSettings);
  }

  /* ----------------------------------------------------------------- routes */

  function parseRoute() {
    const h = location.hash.replace(/^#\/?/, '');
    const qAt = h.indexOf('?');
    const parts = (qAt === -1 ? h : h.slice(0, qAt)).split('/').filter(Boolean);
    if (parts[0] === 'add') return { view: 'add', params: new URLSearchParams(qAt === -1 ? '' : h.slice(qAt + 1)) };
    if (parts[0] === 'c' && parts[1]) return { view: 'character', slug: decodeURIComponent(parts[1]) };
    if (parts[0] === 'picrews' && parts[1]) return { view: 'picrew', id: decodeURIComponent(parts[1]) };
    if (parts[0] === 'picrews') return { view: 'picrews' };
    return { view: 'gallery' };
  }

  function render(opts) {
    opts = opts || {};
    captureQuickAdd();
    renderTopbar();
    if (!state.loaded) {
      app.innerHTML = state.loadError
        ? '<div class="empty"><p><strong>The gallery couldn’t load.</strong></p><p>' + esc(state.loadError) + '</p></div>'
        : '<p class="muted">Loading…</p>';
      return;
    }
    const route = parseRoute();
    if (route.view === 'character') renderCharacter(route.slug);
    else if (route.view === 'picrews') renderPicrews();
    else if (route.view === 'picrew') renderPicrew(route.id);
    else renderGallery();
    renderTabs(route.view);
    if (opts.focus) app.focus({ preventScroll: true });
    openPendingAdd();
  }

  /* ------------------------------------------------- Picrew button hand-off */

  // The Picrew button opens this site at #/add?img=…&title=…&url=…  — remember it, tidy the address bar.
  function captureQuickAdd() {
    const route = parseRoute();
    if (route.view !== 'add') return;
    const p = route.params;
    const img = p.get('img') || '';
    const url = p.get('url') || '';
    state.pendingAdd = {
      img: /^https:\/\//.test(img) ? img : '',
      url: isHttpUrl(url) ? url : '',
      title: (p.get('title') || '').slice(0, 120),
      askedSignIn: false
    };
    state.quickAdd = !!window.opener;
    history.replaceState(null, '', location.pathname + location.search + '#/');
  }

  function openPendingAdd() {
    const pa = state.pendingAdd;
    if (!pa || !state.loaded || document.querySelector('.overlay')) return;
    if (!signedIn()) {
      if (pa.askedSignIn) return;
      pa.askedSignIn = true;
      toast('Sign in first — the Picrew picture will be waiting for you.');
      openSettings();
      return;
    }
    state.pendingAdd = null;
    openPictureForm({
      mode: 'upload',
      prefill: { sourceLabel: picrewLabel(pa.url, pa.title), sourceUrl: pa.url, remoteImage: pa.img }
    });
  }

  // Reuse the label you've already given this Picrew, if any; otherwise "Picrew - <its title>".
  // Older labels written as "Picrew · …" come back with the dash too.
  function picrewLabel(url, title) {
    const id = (url.match(/image_maker\/(\d+)/) || [])[1];
    if (id) {
      const re = new RegExp('image_maker/' + id + '(?!\\d)');
      const hit = state.data.pictures.slice().sort(newestFirst).find((p) => p.source.label && re.test(p.source.url));
      if (hit) return hit.source.label.replace(/^Picrew\s*·\s*/, 'Picrew - ');
    }
    return title ? 'Picrew - ' + title : 'Picrew';
  }

  function bookmarkletCode() {
    const gallery = location.origin + location.pathname;
    const code = "(function(){var G=" + JSON.stringify(gallery) + ";" +
      "if(!/(^|\\.)picrew\\.me$/i.test(location.hostname)){alert('Use this on a Picrew page, the one that shows your finished picture.');return;}" +
      "var all=Array.prototype.slice.call(document.images);" +
      "var img=all.filter(function(i){return /\\/shareImg\\//.test(i.src);})[0];" +
      "if(!img){img=all.filter(function(i){return /^https:\\/\\/cdn\\.picrew\\.me\\//.test(i.src)&&i.naturalWidth>=300;})" +
        ".sort(function(a,b){return b.naturalWidth*b.naturalHeight-a.naturalWidth*a.naturalHeight;})[0];}" +
      "if(!img){alert('No finished picture found. Finish your picture in the Picrew first, then click this on the page that shows it.');return;}" +
      "var m=location.pathname.match(/image_maker\\/(\\d+)/);" +
      "var og=document.querySelector('meta[property=\"og:title\"]');" +
      "var t=((og&&og.content)||document.title||'').replace(/\\s*[|\uff5c]\\s*Picrew.*$/i,'').trim();" +
      "var q='img='+encodeURIComponent(img.src)+'&title='+encodeURIComponent(t)+'&url='+encodeURIComponent(m?'https://picrew.me/en/image_maker/'+m[1]:location.href.split('?')[0]);" +
      "var w=window.open(G+'#/add?'+q,'characterGalleryAdd','popup,width=780,height=920');" +
      "if(!w){alert('Your browser blocked the popup. Allow popups for picrew.me, then click this again.');}" +
      "})();";
    return 'javascript:' + encodeURIComponent(code);
  }

  window.addEventListener('hashchange', () => {
    state.open.clear();
    render({ focus: true });
    window.scrollTo(0, 0);
  });

  /* ---------------------------------------------------------------- gallery */

  function renderGallery() {
    document.title = 'Character Gallery';
    const all = characters();
    app.innerHTML =
      '<div class="page-head">' +
        '<div><h1 class="page-title">Everyone</h1>' +
        '<p class="page-sub">' + esc(plural(all.length, 'character') + ' · ' + plural(state.data.pictures.length, 'picture')) + '</p></div>' +
        '<div class="controls">' +
          '<label class="search">' + ICON.search +
            '<span class="visually-hidden">Search characters</span>' +
            '<input type="search" id="search" placeholder="Search characters" value="' + esc(state.query) + '">' +
          '</label>' +
          '<div class="segmented" role="group" aria-label="Order characters by">' +
            SORTS.map((s) => '<button type="button" data-sort="' + s.id + '" aria-pressed="' + (currentSort() === s.id) + '">' + esc(s.label) + '</button>').join('') +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="filter-row" role="group" aria-labelledby="filter-label">' +
        '<span class="filter-label" id="filter-label">Show</span>' +
        FILTERS.map((f) => {
          const n = all.filter((c) => tierKey(c) === f.id).length;
          return '<button type="button" class="filter-chip" data-filter="' + f.id + '" aria-pressed="' + shownTiers().has(f.id) + '">' +
            '<span class="filter-check" aria-hidden="true">' + ICON.check + '</span>' + esc(f.label) +
            '<span class="filter-count">' + n + '</span></button>';
        }).join('') +
      '</div>' +
      '<div id="grid"></div>';

    app.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => {
      const next = new Set(shownTiers());
      if (next.has(b.dataset.filter)) next.delete(b.dataset.filter); else next.add(b.dataset.filter);
      state.tierFilter = next;
      syncFilterButtons();
      renderGrid();
    }));
    document.getElementById('search').addEventListener('input', (e) => { state.query = e.target.value; renderGrid(); });
    app.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
      state.sort = b.dataset.sort;
      app.querySelectorAll('[data-sort]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderGrid();
    }));
    renderGrid();
  }

  function syncFilterButtons() {
    const shown = shownTiers();
    app.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', String(shown.has(x.dataset.filter))));
  }

  function renderGrid() {
    const grid = document.getElementById('grid');
    let list = characters();
    if (!list.length) {
      grid.innerHTML = '<div class="empty">No pictures yet.' + (signedIn() ? ' Use “Upload picture” to add the first one.' : '') + '</div>';
      return;
    }
    const q = state.query.trim().toLowerCase();
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q));
    if (!list.length) { grid.innerHTML = '<p class="muted">No characters match that search.</p>'; return; }
    const shown = shownTiers();
    const hidden = list.filter((c) => !shown.has(tierKey(c)));
    list = list.filter((c) => shown.has(tierKey(c)));
    const hiddenNote = hidden.length
      ? '<p class="hidden-note">' + esc((hidden.length === 1
          ? '1 ' + (q ? 'matching ' : '') + 'character is'
          : hidden.length + ' ' + (q ? 'matching ' : '') + 'characters are') + ' hidden by the Show filter.') +
        ' <button type="button" class="link-btn" id="show-all">Show everyone</button></p>'
      : '';
    if (!list.length) {
      grid.innerHTML = hiddenNote || '<p class="muted">Nothing to show.</p>';
      wireShowAll();
      return;
    }

    const newest = (a, b) => (a.latest === b.latest ? a.name.localeCompare(b.name) : (a.latest < b.latest ? 1 : -1));
    const sort = currentSort();
    if (sort === 'az') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'oldest') list.sort((a, b) => -newest(a, b));
    else list.sort(newest);

    if (sort === 'tier') {
      // One section per tier, most recently updated first inside each; untiered characters go last.
      const sections = TIERS.map((t) => ({ heading: t.heading, items: list.filter((c) => c.tier === t.id) }))
        .concat([{ heading: 'No tier yet', items: list.filter((c) => !c.tier) }])
        .filter((s) => s.items.length);
      grid.innerHTML = sections.map((s) =>
        '<section class="tier-section"><h2 class="tier-heading">' + esc(s.heading) +
        '<span class="tier-count">' + s.items.length + '</span></h2>' + cardGrid(s.items) + '</section>').join('') + hiddenNote;
    } else {
      grid.innerHTML = cardGrid(list) + hiddenNote;
    }
    wireShowAll();
  }

  function wireShowAll() {
    const btn = document.getElementById('show-all');
    if (btn) btn.addEventListener('click', () => {
      state.tierFilter = new Set(FILTERS.map((f) => f.id));
      syncFilterButtons();
      renderGrid();
    });
  }

  function cardGrid(list) {
    return '<div class="gallery">' + list.map((c) => {
      const others = c.pictures.filter((p) => p.id !== c.cover.id);
      const layers =
        (others[1] ? '<span class="stack-layer back" aria-hidden="true">' + imgTag(others[1], '') + '</span>' : '') +
        (others[0] ? '<span class="stack-layer mid" aria-hidden="true">' + imgTag(others[0], '') + '</span>' : '');
      return '<a class="char-card" href="#/c/' + esc(encodeURIComponent(c.slug)) + '">' +
        '<span class="stack">' + layers + '<span class="stack-top">' + imgTag(c.cover, '') + '</span></span>' +
        '<span class="char-meta"><span class="char-name">' + esc(c.name) + '</span>' +
        '<span class="char-count">' + esc(plural(c.pictures.length, 'picture')) + '</span></span>' +
      '</a>';
    }).join('') + '</div>';
  }

  /* -------------------------------------------------------- character page */

  function renderCharacter(slug) {
    const c = characters().find((x) => x.slug === slug);
    if (!c) {
      document.title = 'Not found · Character Gallery';
      app.innerHTML = '<a class="back-link" href="#/">' + ICON.back + 'All characters</a>' +
        '<div class="empty" style="margin-top:16px">There’s no character here any more.</div>';
      return;
    }
    document.title = c.name + ' · Character Gallery';
    const editable = signedIn();
    const coverNote = c.featuredId ? 'gallery picture chosen by you' : 'the newest one is the gallery picture';

    app.innerHTML =
      '<a class="back-link" href="#/">' + ICON.back + 'All characters</a>' +
      '<div class="char-head">' + imgTag(c.cover, '') +
        '<div class="char-head-text"><h1 class="page-title">' + esc(c.name) + '</h1>' +
        '<p class="page-sub">' + esc(plural(c.pictures.length, 'picture') + ' · ' + coverNote) + '</p>' +
        tierControl(c, editable) + '</div>' +
      '</div>' +
      '<div class="pictures">' + c.pictures.map((p) => pictureCard(p, c, editable)).join('') + '</div>';

    wirePictureCards({ character: c });
    app.querySelectorAll('[data-tier]').forEach((b) => b.addEventListener('click', () => setTier(c, b.dataset.tier)));
  }

  // Details toggles, feature boxes, edit and delete on a page of picture cards.
  function wirePictureCards(ctx) {
    app.querySelectorAll('.details-toggle').forEach((btn) => btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const panel = document.getElementById('details-' + id);
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
      if (open) state.open.add(id); else state.open.delete(id);
    }));
    if (ctx.character) app.querySelectorAll('.feature-input').forEach((box) => box.addEventListener('change', () => setFeatured(box, ctx.character)));
    app.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => {
      const p = state.data.pictures.find((x) => x.id === b.dataset.edit);
      if (p) openPictureForm({ mode: 'edit', picture: p });
    }));
    app.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', () => deletePicture(b.dataset.delete, ctx)));
  }

  function tierControl(c, editable) {
    if (!editable) {
      const t = TIERS.find((x) => x.id === c.tier);
      return t ? '<p class="tier-pill">' + esc(t.label) + ' character</p>' : '';
    }
    const opts = TIERS.map((t) => ({ id: t.id, label: t.label })).concat([{ id: '', label: 'Not set' }]);
    return '<div class="tier-picker"><span class="tier-picker-label" id="tier-label">Tier</span>' +
      '<div class="segmented" role="group" aria-labelledby="tier-label">' +
      opts.map((o) => '<button type="button" data-tier="' + o.id + '" aria-pressed="' + (c.tier === o.id) + '">' + esc(o.label) + '</button>').join('') +
      '</div></div>';
  }

  async function setTier(c, tier) {
    if (state.busy || c.tier === tier) return;
    state.busy = true;
    app.querySelectorAll('[data-tier]').forEach((b) => { b.disabled = true; });
    try {
      await commitChange('Set ' + c.name + ' tier to ' + (tier || 'none'), (d) => {
        const keys = Object.keys(d.characterInfo);
        const key = keys.find((k) => k === c.name) || keys.find((k) => sameName(k, c.name)) || c.name;
        if (tier) d.characterInfo[key] = Object.assign({}, d.characterInfo[key], { tier: tier });
        else delete d.characterInfo[key];
        return d;
      });
      const t = TIERS.find((x) => x.id === tier);
      toast(t ? c.name + ' is now a ' + t.label.toLowerCase() + ' character.' : c.name + ' has no tier now.');
    } catch (e) {
      toast(explainError(e), true);
    } finally {
      state.busy = false;
      render();
    }
  }

  function pictureCard(p, c, editable) {
    const open = state.open.has(p.id);
    const isCover = !!c && p.id === c.cover.id;
    const isFeatured = !!c && p.id === c.featuredId;
    const caption = p.tags.length ? p.tags.join(' · ') : 'No tags yet';
    const alt = p.characters.join(' and ') + (p.tags.length ? ' — ' + p.tags.join(', ') : '');

    const charChips = p.characters.map((n) =>
      '<a class="chip-link" href="#/c/' + esc(encodeURIComponent(slugify(n))) + '">' + esc(n) + '</a>').join('');
    const tagChips = p.tags.length
      ? p.tags.map((t) => '<span class="tag">' + esc(t) + '</span>').join('')
      : '<span class="muted">None yet</span>';
    let source;
    if (p.source.url && isHttpUrl(p.source.url)) {
      source = '<a class="ext-link" href="' + esc(p.source.url) + '" target="_blank" rel="noopener noreferrer">' +
        esc(p.source.label || p.source.url.replace(/^https?:\/\//, '')) + ICON.ext + '</a>';
    } else {
      source = p.source.label ? esc(p.source.label) : '<span class="muted">Not recorded</span>';
    }

    const feature = editable && c
      ? '<label class="feature-toggle"><input type="checkbox" class="feature-input" data-id="' + esc(p.id) + '"' + (isFeatured ? ' checked' : '') + '>' +
        '<span>Use as ' + esc(c.name) + '’s gallery picture</span></label>'
      : '';
    const actions = editable
      ? '<div class="pic-actions">' +
          '<button type="button" class="btn btn-small" data-edit="' + esc(p.id) + '">Edit details</button>' +
          '<button type="button" class="btn btn-small btn-danger" data-delete="' + esc(p.id) + '">Delete</button>' +
        '</div>'
      : '';

    return '<article class="pic">' +
      '<a class="pic-img" href="' + esc(imageUrl(p)) + '" target="_blank" rel="noopener" aria-label="Open full size">' + imgTag(p, alt) +
        (isCover ? '<span class="badge">' + (isFeatured ? 'Featured' : 'Gallery picture') + '</span>' : '') +
      '</a>' +
      '<div class="pic-bar"><span class="pic-caption">' + esc(caption) + '</span>' +
        '<button type="button" class="details-toggle" data-id="' + esc(p.id) + '" aria-expanded="' + open + '" aria-controls="details-' + esc(p.id) + '">Details' + ICON.chevron + '</button>' +
      '</div>' +
      '<div class="details" id="details-' + esc(p.id) + '"' + (open ? '' : ' hidden') + '>' +
        '<dl class="facts">' +
          '<dt>Characters</dt><dd class="chips">' + charChips + '</dd>' +
          '<dt>Tags</dt><dd class="chips">' + tagChips + '</dd>' +
          '<dt>Source</dt><dd>' + source + '</dd>' +
          '<dt>Made by</dt><dd>' + (p.madeBy ? esc(p.madeBy) : '<span class="muted">Not recorded</span>') + '</dd>' +
          '<dt>Added</dt><dd>' + esc(fmtDate(p.added)) + '</dd>' +
          (p.originalName ? '<dt>Original file</dt><dd class="muted">' + esc(p.originalName) + '</dd>' : '') +
          (p.notes ? '<dt>Notes</dt><dd style="white-space:pre-line">' + esc(p.notes) + '</dd>' : '') +
        '</dl>' + feature + actions +
      '</div>' +
    '</article>';
  }

  async function setFeatured(box, c) {
    if (state.busy) { box.checked = !box.checked; return; }
    const id = box.dataset.id;
    const on = box.checked;
    const name = c.name;
    const label = box.closest('.feature-toggle');
    state.busy = true;
    app.querySelectorAll('.feature-input').forEach((b) => { b.disabled = true; });
    label.classList.add('is-busy');
    try {
      await commitChange((on ? 'Feature' : 'Unfeature') + ' picture for ' + name, (d) => {
        if (on) d.featured[name] = id;
        else if (d.featured[name] === id) delete d.featured[name];
        return d;
      });
      state.open.add(id);
      toast(on ? 'That’s now ' + name + '’s gallery picture.' : name + '’s gallery picture is back to the newest one.');
    } catch (e) {
      toast(explainError(e), true);
    } finally {
      state.busy = false;
      render();
    }
  }

  async function deletePicture(id, ctx) {
    const p = state.data.pictures.find((x) => x.id === id);
    if (!p || state.busy) return;
    const c = ctx.character;
    const others = c ? p.characters.filter((n) => !sameName(n, c.name)) : p.characters.slice(1);
    const msg = 'Delete this picture of ' + p.characters.join(' and ') + '?' +
      (others.length ? '\n\nIt will be removed from every character it’s tagged with.' : '') +
      '\n\nThis can’t be undone from the site.';
    if (!window.confirm(msg)) return;
    state.busy = true;
    toast('Deleting…');
    try {
      await commitChange('Delete picture ' + p.file, (d) => {
        d.pictures = d.pictures.filter((x) => x.id !== id);
        Object.keys(d.featured).forEach((k) => { if (d.featured[k] === id) delete d.featured[k]; });
        return d;
      }, { remove: [p.file] });
      toast('Picture deleted.');
      state.busy = false;
      if (c && !characters().some((x) => x.slug === c.slug)) location.hash = '#/';
      else if (ctx.picrewId && !picrews().some((x) => x.id === ctx.picrewId)) location.hash = '#/picrews';
      else render();
    } catch (e) {
      state.busy = false;
      toast(explainError(e), true);
    }
  }

  /* ----------------------------------------------------------------- modals */

  let lastFocus = null;
  function openModal(html, onClose) {
    lastFocus = document.activeElement;
    modalRoot.innerHTML = '<div class="overlay">' + html + '</div>';
    const overlay = modalRoot.firstElementChild;
    const dialog = overlay.querySelector('[role="dialog"]');
    function close() {
      modalRoot.innerHTML = '';
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {   // keep focus inside the dialog
        const f = Array.from(dialog.querySelectorAll('button, [href], input, textarea, select'))
          .filter((el) => !el.disabled && el.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
    dialog.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    return { dialog: dialog, close: close };
  }

  /* --------------------------------------------------------------- settings */

  function openSettings() {
    const s = state.settings;
    const wasSignedIn = signedIn();
    const savedSort = state.data.settings.defaultSort;
    const sortSection = wasSignedIn
      ? '<fieldset class="settings-group divided">' +
          '<legend class="settings-legend">Homepage</legend>' +
          '<p class="hint" style="margin:0 0 8px">How characters are ordered when anyone opens the gallery. The buttons on the homepage still switch it for that visit.</p>' +
          SORTS.map((o) => '<label class="radio-row"><input type="radio" name="s-sort" value="' + o.id + '"' + (savedSort === o.id ? ' checked' : '') + '>' +
            '<span>' + esc(o.long) + '</span></label>').join('') +
          '<p class="hint" style="margin:8px 0 0">Set each character’s tier on their own page. Characters without one go at the bottom.</p>' +
          '<label class="radio-row check-row"><input type="checkbox" id="s-hide-bg"' + (state.data.settings.hideBackground ? ' checked' : '') + '>' +
            '<span>Hide background characters by default<span class="hint" style="display:block">The Show filter on the homepage can still bring them back for a visit.</span></span></label>' +
        '</fieldset>'
      : '';
    const m = openModal(
      '<div class="dialog narrow" role="dialog" aria-modal="true" aria-labelledby="settings-title">' +
        '<div class="dialog-head"><h2 id="settings-title">' + (wasSignedIn ? 'Settings' : 'Sign in to upload') + '</h2>' +
          '<button type="button" class="icon-btn" aria-label="Close" data-close>' + ICON.close + '</button></div>' +
        '<form class="dialog-body single" id="settings-form" novalidate>' +
          sortSection +
          (wasSignedIn
            ? '<fieldset class="settings-group divided">' +
                '<legend class="settings-legend">Picrew button</legend>' +
                '<p class="hint" style="margin:0">Drag this button onto your bookmarks toolbar. On a Picrew page that shows your finished picture, click it to open this gallery’s upload form with the picture, the Picrew’s name and its link already filled in.</p>' +
                '<p style="margin:0"><a class="btn bookmarklet" id="s-bookmarklet" href="' + esc(bookmarkletCode()) + '">' + ICON.plus + 'Send to Character Gallery</a></p>' +
                '<p class="hint" style="margin:0">Can’t see a bookmarks toolbar in Firefox? Press Ctrl+Shift+B (⌘⇧B on a Mac).</p>' +
              '</fieldset>'
            : '') +
          '<fieldset class="settings-group">' +
          (wasSignedIn ? '<legend class="settings-legend">GitHub connection</legend>' : '') +
          '<p class="hint" style="margin:0">Paste a GitHub key that can write to this site’s repository. It’s saved only in this browser, on this device.</p>' +
          '<div class="field"><label for="s-token">GitHub key</label>' +
            '<input class="input" id="s-token" type="password" autocomplete="off" spellcheck="false" value="' + esc(s.token) + '" placeholder="github_pat_…"></div>' +
          '<div class="field-row">' +
            '<div class="field"><label for="s-owner">GitHub username</label><input class="input" id="s-owner" autocomplete="off" spellcheck="false" value="' + esc(s.owner) + '"></div>' +
            '<div class="field"><label for="s-repo">Repository</label><input class="input" id="s-repo" autocomplete="off" spellcheck="false" value="' + esc(s.repo) + '"></div>' +
          '</div>' +
          '<div class="field"><label for="s-branch">Branch <span class="optional">(leave blank for the default)</span></label>' +
            '<input class="input" id="s-branch" autocomplete="off" spellcheck="false" value="' + esc(s.branch) + '"></div>' +
          '</fieldset>' +
          '<p class="form-error" id="s-error" hidden></p>' +
        '</form>' +
        '<div class="dialog-foot">' +
          (wasSignedIn ? '<button type="button" class="btn btn-danger" id="s-signout" style="margin-right:auto">Sign out on this device</button>' : '') +
          '<button type="button" class="btn" data-close>Cancel</button>' +
          '<button type="submit" form="settings-form" class="btn btn-primary" id="s-save">' + (wasSignedIn ? 'Save' : 'Sign in') + '</button>' +
        '</div>' +
      '</div>');
    const d = m.dialog;
    const err = d.querySelector('#s-error');
    const firstFocus = d.querySelector('input[name="s-sort"]:checked') || d.querySelector(s.token ? '#s-owner' : '#s-token');
    firstFocus.focus();

    const bm = d.querySelector('#s-bookmarklet');
    if (bm) bm.addEventListener('click', (e) => { e.preventDefault(); toast('Drag this button onto your bookmarks toolbar instead of clicking it.'); });

    const signout = d.querySelector('#s-signout');
    if (signout) signout.addEventListener('click', () => {
      clearSettings();
      state.settings = loadSettings();
      m.close();
      toast('Signed out on this device.');
      render();
    });

    d.querySelector('#settings-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (state.busy) return;
      const next = {
        token: d.querySelector('#s-token').value.trim(),
        owner: d.querySelector('#s-owner').value.trim(),
        repo: d.querySelector('#s-repo').value.trim(),
        branch: d.querySelector('#s-branch').value.trim()
      };
      const picked = d.querySelector('input[name="s-sort"]:checked');
      const newSort = picked ? picked.value : savedSort;
      const hideBox = d.querySelector('#s-hide-bg');
      const savedHide = state.data.settings.hideBackground;
      const newHide = hideBox ? hideBox.checked : savedHide;
      err.hidden = true;
      if (!next.token || !next.owner || !next.repo) {
        err.textContent = 'Fill in the key, your username and the repository name.';
        err.hidden = false;
        return;
      }
      const connectionChanged = !wasSignedIn || next.token !== s.token || next.owner !== s.owner ||
        next.repo !== s.repo || next.branch !== s.branch;
      const btn = d.querySelector('#s-save');
      btn.disabled = true;
      state.busy = true;
      try {
        if (connectionChanged) {
          btn.textContent = 'Checking…';
          const info = await gh(repoBase(next), { settings: next });
          if (info.permissions && !info.permissions.push) throw Object.assign(new Error(''), { status: 403 });
          if (!next.branch) next.branch = info.default_branch || 'main';
          await gh(repoBase(next) + '/git/ref/heads/' + branchPath(next.branch), { settings: next });
          state.settings = next;
          saveSettings(next);
        }
        if (wasSignedIn && (newSort !== savedSort || newHide !== savedHide)) {
          btn.textContent = 'Saving…';
          const parts = [];
          if (newSort !== savedSort) parts.push('order: ' + SORTS.find((o) => o.id === newSort).label);
          if (newHide !== savedHide) parts.push(newHide ? 'hide background characters' : 'show background characters');
          await commitChange('Homepage settings — ' + parts.join(', '), (data) => {
            data.settings.defaultSort = newSort;
            data.settings.hideBackground = newHide;
            return data;
          });
          state.sort = null;        // show the new defaults straight away
          state.tierFilter = null;
        }
        state.busy = false;
        m.close();
        if (connectionChanged) {
          toast(wasSignedIn ? 'Settings saved.' : 'Signed in. You can upload now.');
          await refresh();
        } else {
          toast('Settings saved.');
          render();
        }
      } catch (ex) {
        state.busy = false;
        err.textContent = explainError(ex);
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = wasSignedIn ? 'Save' : 'Sign in';
      }
    });
  }

  /* ------------------------------------------------- upload / edit form */

  function readAsBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function knownSources() {
    const seen = new Map();
    state.data.pictures.slice().sort(newestFirst).forEach((p) => {
      if (p.source.label && !seen.has(p.source.label.toLowerCase())) seen.set(p.source.label.toLowerCase(), p.source);
    });
    return Array.from(seen.values());
  }
  function knownTags() {
    const s = new Set();
    state.data.pictures.forEach((p) => p.tags.forEach((t) => s.add(t)));
    return Array.from(s).sort();
  }

  function lastMaker() {
    const withMaker = state.data.pictures.filter((p) => p.madeBy).sort(newestFirst);
    return withMaker.length ? withMaker[0].madeBy : '';
  }

  function openPictureForm(opts) {
    const editing = opts.mode === 'edit';
    const pic = opts.picture;
    const form = {
      file: null,
      preview: editing ? imageUrl(pic) : '',
      chars: editing ? pic.characters.slice() : (opts.presetCharacters || []).slice(),
      tags: editing ? pic.tags.slice() : []
    };
    const sources = knownSources();
    const pre = opts.prefill || {};
    let onPaste = null;

    const m = openModal(
      '<div class="dialog" role="dialog" aria-modal="true" aria-labelledby="pf-title">' +
        '<div class="dialog-head"><h2 id="pf-title">' + (editing ? 'Edit details' : 'Upload a picture') + '</h2>' +
          '<button type="button" class="icon-btn" aria-label="Close" data-close>' + ICON.close + '</button></div>' +
        '<form id="pf" novalidate>' +
        '<div class="dialog-body">' +
          '<div class="dropzone-col">' +
            (editing
              ? '<div class="dropzone" style="cursor:default; border-style:solid">' + imgTag(pic, 'The picture being edited') + '</div>'
              : '<label class="dropzone" id="pf-drop"><input type="file" id="pf-file" accept="image/png,image/jpeg,image/gif,image/webp">' +
                  '<span id="pf-drop-empty" style="display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--muted)">' + ICON.image +
                  '<span id="pf-drop-title" style="font-weight:600;color:var(--text)">Choose an image</span><span id="pf-drop-sub" style="font-size:13px">or drop or paste it here</span></span>' +
                '</label>' +
                '<span class="dropzone-hint" id="pf-drop-hint">PNG, JPG, GIF or WebP. It’s renamed automatically.</span>') +
          '</div>' +
          '<div class="fields">' +
            '<div class="field"><label for="pf-char-input">Characters</label>' +
              '<div class="chip-input" id="pf-chars"><input id="pf-char-input" type="text" autocomplete="off" placeholder="Type a name…" aria-describedby="pf-char-hint"></div>' +
              '<div class="suggestions" id="pf-suggest" hidden></div>' +
              '<span class="hint" id="pf-char-hint">Each character gets a spot in the gallery. A name that isn’t there yet gets a new spot.</span>' +
            '</div>' +
            '<div class="field"><label for="pf-tag-input">Tags</label>' +
              '<div class="chip-input" id="pf-tags"><input id="pf-tag-input" type="text" autocomplete="off" list="pf-tag-list" placeholder="Outfit, era, AU…" aria-describedby="pf-tag-hint"></div>' +
              '<datalist id="pf-tag-list">' + knownTags().map((t) => '<option value="' + esc(t) + '">').join('') + '</datalist>' +
              '<span class="hint" id="pf-tag-hint">Press Enter after each tag.</span>' +
            '</div>' +
            '<div class="field-row">' +
              '<div class="field"><label for="pf-src">Where it’s from</label>' +
                '<input class="input" id="pf-src" list="pf-src-list" autocomplete="off" placeholder="e.g. Picrew - ummmmmandy" value="' + esc(editing ? pic.source.label : (pre.sourceLabel || '')) + '">' +
                '<datalist id="pf-src-list">' + sources.map((s) => '<option value="' + esc(s.label) + '">').join('') + '</datalist></div>' +
              '<div class="field"><label for="pf-url">Link</label>' +
                '<input class="input" id="pf-url" type="url" autocomplete="off" placeholder="https://picrew.me/…" value="' + esc(editing ? pic.source.url : (pre.sourceUrl || '')) + '"></div>' +
            '</div>' +
            '<div class="field"><label for="pf-made">Made by</label>' +
              '<input class="input" id="pf-made" autocomplete="off" placeholder="Who put it together" value="' + esc(editing ? pic.madeBy : lastMaker()) + '"></div>' +
            '<div class="field"><label for="pf-notes">Notes <span class="optional">(optional)</span></label>' +
              '<textarea class="input" id="pf-notes" rows="3" placeholder="Anything worth remembering about this one">' + esc(editing ? pic.notes : '') + '</textarea></div>' +
            '<p class="form-error" id="pf-error" role="alert" hidden></p>' +
          '</div>' +
        '</div>' +
        '</form>' +
        '<div class="dialog-foot">' +
          '<button type="button" class="btn" data-close>Cancel</button>' +
          '<button type="submit" form="pf" class="btn btn-primary" id="pf-save">' + (editing ? 'Save changes' : 'Add to gallery') + '</button>' +
        '</div>' +
      '</div>',
      () => {
        if (form.preview && form.file) URL.revokeObjectURL(form.preview);
        if (onPaste) document.removeEventListener('paste', onPaste);
      });
    const d = m.dialog;

    const charBox = d.querySelector('#pf-chars');
    const charInput = d.querySelector('#pf-char-input');
    const suggest = d.querySelector('#pf-suggest');
    const tagBox = d.querySelector('#pf-tags');
    const tagInput = d.querySelector('#pf-tag-input');
    const errEl = d.querySelector('#pf-error');
    const srcInput = d.querySelector('#pf-src');
    const urlInput = d.querySelector('#pf-url');
    const names = knownNames();
    const covers = {};
    characters().forEach((c) => { covers[c.name] = c.cover; });

    function renderChips() {
      charBox.querySelectorAll('.chip').forEach((el) => el.remove());
      form.chars.forEach((n) => {
        const isNew = !names.some((k) => sameName(k, n));
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.innerHTML = esc(n) + (isNew ? '<span class="new-badge">NEW</span>' : '') +
          '<button type="button" aria-label="Remove ' + esc(n) + '">' + ICON.x + '</button>';
        chip.querySelector('button').addEventListener('click', () => {
          form.chars = form.chars.filter((x) => x !== n);
          renderChips(); charInput.focus();
        });
        charBox.insertBefore(chip, charInput);
      });
      tagBox.querySelectorAll('.chip').forEach((el) => el.remove());
      form.tags.forEach((t) => {
        const chip = document.createElement('span');
        chip.className = 'chip tagchip';
        chip.innerHTML = esc(t) + '<button type="button" aria-label="Remove tag ' + esc(t) + '">' + ICON.x + '</button>';
        chip.querySelector('button').addEventListener('click', () => {
          form.tags = form.tags.filter((x) => x !== t);
          renderChips(); tagInput.focus();
        });
        tagBox.insertBefore(chip, tagInput);
      });
    }
    function addChar(raw) {
      const v = canonicalName(raw || '');
      if (v && !form.chars.some((x) => sameName(x, v))) form.chars.push(v);
      charInput.value = '';
      renderSuggestions();
      renderChips();
    }
    function addTag(raw) {
      const v = (raw || '').trim().replace(/,+$/, '').trim().toLowerCase();
      if (v && form.tags.indexOf(v) === -1) form.tags.push(v);
      tagInput.value = '';
      renderChips();
    }
    function renderSuggestions() {
      const q = charInput.value.trim();
      if (!q) { suggest.hidden = true; suggest.innerHTML = ''; return; }
      const ql = q.toLowerCase();
      const hits = names.filter((n) => n.toLowerCase().includes(ql) && !form.chars.some((x) => sameName(x, n))).slice(0, 5);
      const exact = names.some((n) => sameName(n, q)) || form.chars.some((x) => sameName(x, q));
      let html = hits.map((n) => '<button type="button" class="suggestion" data-name="' + esc(n) + '">' +
        (covers[n] ? imgTag(covers[n], '') : '') + esc(n) + '</button>').join('');
      if (!exact) html += '<button type="button" class="suggestion new" data-name="' + esc(q) + '">' +
        '<span class="plus" aria-hidden="true">' + ICON.plus + '</span>Add “' + esc(q) + '” as a new character</button>';
      suggest.innerHTML = html;
      suggest.hidden = !html;
      suggest.querySelectorAll('.suggestion').forEach((b) => b.addEventListener('click', () => { addChar(b.dataset.name); charInput.focus(); }));
    }

    charBox.addEventListener('click', (e) => { if (e.target === charBox) charInput.focus(); });
    tagBox.addEventListener('click', (e) => { if (e.target === tagBox) tagInput.focus(); });
    charInput.addEventListener('input', renderSuggestions);
    charInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addChar(charInput.value); }
      else if (e.key === 'Backspace' && !charInput.value && form.chars.length) { form.chars.pop(); renderChips(); }
      else if (e.key === 'ArrowDown') { const f = suggest.querySelector('.suggestion'); if (f) { e.preventDefault(); f.focus(); } }
    });
    tagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagInput.value); }
      else if (e.key === 'Backspace' && !tagInput.value && form.tags.length) { form.tags.pop(); renderChips(); }
    });
    srcInput.addEventListener('change', () => {
      const hit = sources.find((s) => s.label.toLowerCase() === srcInput.value.trim().toLowerCase());
      if (hit && hit.url && !urlInput.value.trim()) urlInput.value = hit.url;
    });

    // ----- image picking (upload only)
    function setFile(file) {
      if (!file) return;
      if (!IMAGE_TYPES[file.type]) { showError('That file isn’t a PNG, JPG, GIF or WebP image.'); return; }
      if (file.size > MAX_BYTES) { showError('That image is over 25 MB. Try a smaller copy.'); return; }
      errEl.hidden = true;
      if (form.preview && form.file) URL.revokeObjectURL(form.preview);
      form.file = file;
      form.preview = URL.createObjectURL(file);
      const drop = d.querySelector('#pf-drop');
      let img = drop.querySelector('img');
      if (!img) { img = document.createElement('img'); drop.appendChild(img); }
      img.src = form.preview;
      img.alt = 'Preview of the picture to upload';
      img.classList.remove('ref');
      d.querySelector('#pf-drop-empty').style.visibility = 'hidden';
      d.querySelector('#pf-drop-hint').textContent = 'Click the image to choose a different one.';
    }
    if (!editing) {
      const drop = d.querySelector('#pf-drop');
      d.querySelector('#pf-file').addEventListener('change', (e) => setFile(e.target.files && e.target.files[0]));
      ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('is-over'); }));
      ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, () => drop.classList.remove('is-over')));
      drop.addEventListener('drop', (e) => { e.preventDefault(); setFile(e.dataTransfer.files && e.dataTransfer.files[0]); });
      onPaste = (e) => {
        const item = Array.from((e.clipboardData && e.clipboardData.items) || []).find((i) => i.kind === 'file' && IMAGE_TYPES[i.type]);
        if (item) { e.preventDefault(); setFile(item.getAsFile()); }
      };
      document.addEventListener('paste', onPaste);
      if (pre.remoteImage) fetchRemote(pre.remoteImage);
    }

    // Picrew button: try to download the finished picture straight from Picrew's server.
    async function fetchRemote(url) {
      const drop = d.querySelector('#pf-drop');
      const title = d.querySelector('#pf-drop-title');
      const sub = d.querySelector('#pf-drop-sub');
      const hint = d.querySelector('#pf-drop-hint');
      title.textContent = 'Getting the picture…';
      sub.textContent = 'from Picrew';
      const name = decodeURIComponent((url.split('?')[0].split('/').pop() || 'picrew.png'));
      try {
        const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (!res.ok) throw new Error('status ' + res.status);
        const blob = await res.blob();
        const ext = (name.match(/\.(png|jpe?g|gif|webp)$/i) || [])[1];
        const type = IMAGE_TYPES[blob.type] ? blob.type
          : ext ? Object.keys(IMAGE_TYPES).find((k) => IMAGE_TYPES[k] === ext.toLowerCase().replace('jpeg', 'jpg')) : '';
        if (!type) throw new Error('not an image');
        if (form.file) return;   // already pasted something meanwhile
        setFile(new File([blob], name, { type: type }));
        hint.textContent = 'Picture fetched from Picrew. Click it to choose a different one.';
      } catch (err) {
        if (form.file) return;
        // Show it as a faded reference so it's clear which picture to copy.
        const ref = document.createElement('img');
        ref.className = 'ref';
        ref.alt = '';
        ref.src = url;
        drop.appendChild(ref);
        title.textContent = 'Paste the picture here';
        sub.textContent = 'Ctrl+V (⌘V on a Mac)';
        hint.textContent = 'Picrew wouldn’t hand the picture over directly. On the Picrew tab, right-click the picture and choose Copy Image, then come back and paste.';
      }
    }

    function showError(msg) { errEl.textContent = msg; errEl.hidden = false; }

    renderChips();
    (editing || pre.remoteImage ? charInput : d.querySelector('#pf-file')).focus();

    d.querySelector('#pf').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (charInput.value.trim()) addChar(charInput.value);
      if (tagInput.value.trim()) addTag(tagInput.value);
      const fields = {
        characters: form.chars.slice(),
        tags: form.tags.slice(),
        source: { label: srcInput.value.trim(), url: urlInput.value.trim() },
        madeBy: d.querySelector('#pf-made').value.trim(),
        notes: d.querySelector('#pf-notes').value.trim()
      };
      if (!editing && !form.file) return showError('Choose an image first.');
      if (!fields.characters.length) return showError('Add at least one character.');
      if (fields.source.url && !isHttpUrl(fields.source.url)) return showError('The link should start with https://');
      if (state.busy) return;

      const save = d.querySelector('#pf-save');
      save.disabled = true;
      save.textContent = editing ? 'Saving…' : 'Uploading…';
      state.busy = true;
      try {
        if (editing) {
          await commitChange('Edit details for ' + pic.file, (data) => {
            const p = data.pictures.find((x) => x.id === pic.id);
            if (!p) throw new Error('That picture was deleted somewhere else.');
            Object.assign(p, fields);
            Object.keys(data.featured).forEach((k) => {
              if (data.featured[k] === p.id && !p.characters.some((n) => sameName(n, k))) delete data.featured[k];
            });
            return data;
          });
          toast('Details saved.');
        } else {
          const now = new Date();
          const rand = randomId(6);
          const ext = IMAGE_TYPES[form.file.type];
          const fileName = slugify(fields.characters[0]).slice(0, 40) + '-' + stamp(now) + '-' + rand + '.' + ext;
          const path = IMAGE_DIR + '/' + fileName;
          const id = 'p-' + stamp(now) + '-' + rand;
          const base64 = await readAsBase64(form.file);
          const entry = Object.assign({ id: id, file: path, originalName: form.file.name || '', added: now.toISOString() }, fields);
          await commitChange('Add ' + fileName + ' (' + fields.characters.join(', ') + ')', (data) => {
            data.pictures.push(entry);
            return data;
          }, { add: [{ path: path, base64: base64 }] });
          state.localImages[id] = form.preview;
          form.file = null;   // keep the object URL alive for display
          toast(state.quickAdd ? 'Added to the gallery. Closing this window…' : 'Added. The public site will show it in about a minute.');
        }
        state.busy = false;
        m.close();
        render();
        if (!editing && state.quickAdd) setTimeout(() => window.close(), 1600);
      } catch (ex) {
        state.busy = false;
        save.disabled = false;
        save.textContent = editing ? 'Save changes' : 'Add to gallery';
        showError(explainError(ex));
      }
    });
  }

  /* ------------------------------------------------------------------ start */

  async function refresh() {
    try {
      await loadData();
      state.loaded = true;
      state.loadError = null;
    } catch (e) {
      state.loadError = e.message;
    }
    render();
  }

  render();
  refresh();
})();

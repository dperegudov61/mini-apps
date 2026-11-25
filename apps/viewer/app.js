/* HTML viewer (Подсмотрщик) — Mini Apps. Без библиотек и без сборки. */
(function () {
  'use strict';

  var OWN = 'miniapps.viewer.links';   // мои ссылки — только в этом браузере
  var MANIFEST = 'data/links.json';    // страницы и ссылки, лежащие в репозитории

  var files = [];      // {name, file}
  var links = [];      // {name, url}
  var own = [];        // {name, url, at}

  var form, input, listEl, viewEl, vName, vFrame, vExt;

  function t(k, en) { return (window.UI && window.UI.t) ? window.UI.t(k, en) : en; }

  /* ── свои ссылки ── */

  function loadOwn() {
    try {
      var raw = JSON.parse(localStorage.getItem(OWN) || '[]');
      own = Array.isArray(raw) ? raw.filter(function (x) { return x && x.url; }) : [];
    } catch (e) { own = []; }
  }

  function saveOwn() {
    try { localStorage.setItem(OWN, JSON.stringify(own.slice(0, 100))); } catch (e) {}
  }

  /* ── разбор адреса ── */

  function normalize(v) {
    var s = String(v || '').trim();
    if (!s) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;          // уже со схемой (http, blob, data…)
    if (s.indexOf('//') === 0) return 'https:' + s;
    // «example.com/page» — домен, «data/proto/x.html» — путь внутри приложения
    var head = s.split('/')[0];
    if (head.indexOf('.') > 0) return 'https://' + s;
    return s;
  }

  function nameOf(u) {
    var s = String(u).replace(/^(https?:)?\/\//i, '');
    var q = s.indexOf('?');
    if (q >= 0) s = s.slice(0, q);
    if (s.charAt(s.length - 1) === '/') s = s.slice(0, -1);
    var parts = s.split('/').filter(Boolean);
    var last = parts.length ? parts[parts.length - 1] : u;
    try { last = decodeURIComponent(last); } catch (e) {}
    last = last.replace(/\.html?$/i, '');
    if (!last) last = parts[0] || u;
    return last.length > 42 ? last.slice(0, 42) + '…' : last;
  }

  function same(a, b) {
    return String(a).replace(/\/+$/, '').toLowerCase() === String(b).replace(/\/+$/, '').toLowerCase();
  }

  function linkOf(entry) {
    return entry.file ? entry.file : entry.url;
  }

  /* ── список ── */

  function render() {
    listEl.innerHTML = '';

    section(t('viewer.sec.files', 'Pages in data'), files, 'file');
    section(t('viewer.sec.links', 'Saved links'), links, 'link');
    section(t('viewer.sec.mine', 'My links'), own, 'own');

    if (!files.length && !links.length && !own.length) {
      var p = document.createElement('p');
      p.className = 'empty';
      p.textContent = t('viewer.empty', 'Nothing here yet — type an address above.');
      listEl.appendChild(p);
    }
  }

  function section(title, items, kind) {
    if (!items.length) return;

    var h = document.createElement('p');
    h.className = 'sec';
    h.textContent = title + ' · ' + items.length;
    listEl.appendChild(h);

    var box = document.createElement('div');
    box.className = 'items';
    for (var i = 0; i < items.length; i++) box.appendChild(row(items[i], kind, i));
    listEl.appendChild(box);
  }

  function row(entry, kind, index) {
    var el = document.createElement('div');
    el.className = 'item';

    var open = document.createElement('button');
    open.type = 'button';
    open.className = 'op';
    open.dataset.kind = kind;
    open.dataset.index = String(index);

    var ico = document.createElement('span');
    ico.className = 'ico';
    ico.textContent = entry.file ? '📄' : '🔗';

    var txt = document.createElement('span');
    txt.className = 'txt';

    var name = document.createElement('b');
    name.textContent = entry.name || nameOf(linkOf(entry));

    var sub = document.createElement('small');
    sub.textContent = entry.file ? entry.file : entry.url;

    txt.appendChild(name);
    txt.appendChild(sub);
    open.appendChild(ico);
    open.appendChild(txt);
    el.appendChild(open);

    var ext = document.createElement('a');
    ext.className = 'act';
    ext.href = linkOf(entry);
    ext.target = '_blank';
    ext.rel = 'noopener';
    ext.textContent = '↗';
    ext.title = t('viewer.newtab', 'Open in a new tab');
    ext.setAttribute('aria-label', ext.title);
    el.appendChild(ext);

    if (kind === 'own') {
      var del = document.createElement('button');
      del.type = 'button';
      del.className = 'act del';
      del.dataset.del = String(index);
      del.textContent = '✕';
      del.title = t('viewer.remove', 'Remove from the list');
      del.setAttribute('aria-label', del.title);
      el.appendChild(del);
    }

    return el;
  }

  /* ── просмотр ── */

  function showViewer(entry) {
    var src = linkOf(entry);
    vName.textContent = entry.name || nameOf(src);
    vFrame.src = src;
    vExt.href = src;
    document.title = (entry.name || nameOf(src)) + ' — ' + t('viewer.name', 'HTML viewer');
    viewEl.hidden = false;
    document.body.classList.add('viewing');
  }

  function closeViewer() {
    viewEl.hidden = true;
    vFrame.src = 'about:blank';
    document.body.classList.remove('viewing');
    document.title = t('viewer.title', 'HTML viewer — Mini Apps');
  }

  function pick(list, i) { return list[Number(i)] || null; }

  /* ── события ── */

  function onSubmit(e) {
    if (e && e.preventDefault) e.preventDefault();
    var full = normalize(input.value);
    if (!full) { input.focus(); return; }

    var entry = null, i;
    // уже есть в списке — не плодим строку
    for (i = 0; i < links.length; i++) if (links[i].url && same(links[i].url, full)) entry = links[i];
    for (i = 0; i < files.length; i++) if (files[i].file && same(files[i].file, full)) entry = files[i];
    for (i = 0; i < own.length; i++) if (same(own[i].url, full)) entry = own[i];

    if (!entry) {
      entry = { name: nameOf(full), url: full, at: Date.now() };
      own.unshift(entry);
      saveOwn();
      render();
    }

    input.value = '';
    input.blur();
    showViewer(entry);
  }

  function onListClick(e) {
    var del = e.target.closest ? e.target.closest('[data-del]') : null;
    if (del) {
      own.splice(Number(del.dataset.del), 1);
      saveOwn();
      render();
      return;
    }

    var op = e.target.closest ? e.target.closest('.op') : null;
    if (!op) return;
    var kind = op.dataset.kind, index = Number(op.dataset.index);
    var entry = kind === 'file' ? pick(files, index) : kind === 'link' ? pick(links, index) : pick(own, index);
    if (entry) showViewer(entry);
  }

  /* ── старт ── */

  function loadManifest() {
    if (!window.fetch) return Promise.resolve();
    return fetch(MANIFEST, { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !Array.isArray(data.items)) return;
        files = data.items.filter(function (x) { return x && x.file; });
        links = data.items.filter(function (x) { return x && x.url; });
        render();
      })
      .catch(function () {});
  }

  function boot() {
    form = document.getElementById('addForm');
    input = document.getElementById('urlInput');
    listEl = document.getElementById('list');
    viewEl = document.getElementById('view');
    vName = document.getElementById('vName');
    vFrame = document.getElementById('vFrame');
    vExt = document.getElementById('vExt');

    loadOwn();
    render();

    form.addEventListener('submit', onSubmit);
    listEl.addEventListener('click', onListClick);
    document.getElementById('vBack').addEventListener('click', closeViewer);
    document.getElementById('vReload').addEventListener('click', function () {
      if (vFrame.src) vFrame.src = vFrame.getAttribute('src');
    });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !viewEl.hidden) closeViewer();
    });

    loadManifest();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

/* theme.js — тема, язык и таблица надписей для страниц AI and Human Messenger.
 *
 * Файл лежит в ТРЁХ репозиториях и должен оставаться одинаковым:
 *   site\theme.js        → главная (/), вход (/accounts/), аккаунт (/account/)
 *   messenger\theme.js   → страница чата и админка
 *   mini-apps\theme.js   → «Змейка» и страница ошибки 404
 * Правки вносить во все три и сверять: Get-FileHash site\theme.js,messenger\theme.js,mini-apps\theme.js
 *
 * ЧТО ДЕЛАЕТ
 *   * тема: тёмная / светлая / системная — атрибут data-theme на <html>, цвета страниц
 *     берутся только из переменных CSS (:root — тёмные, html[data-theme="light"] — светлые);
 *   * язык: переключатель + словарь. Надписи страницы написаны по-английски прямо в файле
 *     (язык по умолчанию), а ключом (индексом) помечены: data-i18n / data-i18n-ph /
 *     data-i18n-title / data-i18n-aria. Если таблица не загрузилась — видно английский текст;
 *   * таблица рядом со страницей: strings.tsv, столбцы «индекс, en, ru, …» (первая строка —
 *     заголовок со кодами языков). Сколько столбцов — столько языков в меню;
 *   * в самом коде надписи собираются через t('ключ', 'English fallback');
 *   * значок 🏠 — ссылка на главную (https://dperegudov61.github.io/).
 *
 * ГДЕ ХРАНИТСЯ ВЫБОР
 *   * localStorage `ui.theme` | `ui.lang` — кеш устройства: страница встаёт в нужной теме
 *     до первой отрисовки и работает без входа;
 *   * data\users\<id>\prefs.json на сервере — настройки человека (GET|POST /__prefs),
 *     при входе серверные значения перекрывают кеш.
 *
 * ПОДКЛЮЧЕНИЕ (страница)
 *   1. в <head>, ДО <style>:
 *        <script src="theme.js" data-i18n="strings.tsv"></script>
 *   2. в разметке рядом с профилем: <span class="ui-sw" data-ui="switch"></span>
 *      (data-home="0" — если значок 🏠 не нужен)
 *   3. когда страница нашла сервер и токен: UI.sync(base, tok)
 *
 * САМОПРОВЕРКИ: tools\theme_test.js (логика без браузера), tools\i18n_test.js
 * (все ключи разметки есть в таблице, все строки таблицы заполнены).
 */
(function () {
'use strict';

var THEMES = ['dark', 'light', 'auto'];
var KTH = 'ui.theme', KLG = 'ui.lang', KRELOAD = 'ui.lang.reload';
var HOME = 'https://dperegudov61.github.io/';
var DEF_LANG = 'en';
var root = document.documentElement;
var mqL = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
var srv = { base: '', tok: '' };

var tbl = { langs: [], col: {}, rows: 0, ready: false, failed: false };
var appliedLang = '';
var reloaded = false;

function ls(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
function lss(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsd(k) { try { localStorage.removeItem(k); } catch (e) {} }
function pick(v, list, def) {
  for (var i = 0; i < list.length; i++) if (list[i] === v) return v;
  return def;
}

// ---------- тема ----------
function sysTheme() { return mqL && mqL.matches ? 'light' : 'dark'; }
function theme() { return pick(ls(KTH), THEMES, 'auto'); }
function resolved() { var t = theme(); return t === 'auto' ? sysTheme() : t; }

// ---------- язык ----------
function sysLang() {
  var v = (navigator.languages && navigator.languages[0]) || navigator.language || '';
  return String(v).toLowerCase().slice(0, 2);
}
function langNow() {
  var v = ls(KLG);
  if (!v) return DEF_LANG;
  if (v === 'auto') {                       // старое значение: «как в системе»
    var s = sysLang();
    return pick(s, tbl.langs, DEF_LANG);
  }
  return pick(v, tbl.langs.length ? tbl.langs : [DEF_LANG], DEF_LANG);
}
// t('chat.send', 'Send') — надпись по ключу; без таблицы остаётся английский текст
function t(key, fallback) {
  var c = tbl.col[langNow()];
  var v = c ? c[key] : null;
  if (v === undefined || v === null || v === '') v = null;
  if (v === null) { var e = tbl.col[DEF_LANG]; v = e ? e[key] : null; }
  if (v === undefined || v === null || v === '') v = null;
  return v !== null ? v : (fallback !== undefined && fallback !== null ? fallback : key);
}

// ---------- применение ----------
function apply() {
  var th = resolved();
  if (root.getAttribute('data-theme') !== th) root.setAttribute('data-theme', th);
  root.setAttribute('data-theme-pref', theme());
  root.setAttribute('lang', langNow());
  var mc = document.querySelector('meta[name="theme-color"]');
  if (mc) {
    var c = '';
    try { c = window.getComputedStyle(root).getPropertyValue('--mtc'); } catch (e) {}
    c = String(c || '').replace(/\s+/g, '');
    if (c) mc.setAttribute('content', c);
  }
  syncControls();
}

// ---------- таблица надписей ----------
function parseTable(text) {
  var lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  var langs = [], col = {}, rows = 0, head = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line || /^\s*#/.test(line)) continue;
    var cells = line.split('\t');
    if (!head) { head = cells; langs = cells.slice(1).map(function (x) { return x.trim().toLowerCase(); }); continue; }
    var key = (cells[0] || '').trim();
    if (!key) continue;
    rows++;
    for (var c = 0; c < langs.length; c++) {
      var v = cells[c + 1];
      if (v === undefined) continue;
      if (!col[langs[c]]) col[langs[c]] = {};
      col[langs[c]][key] = v.replace(/\\n/g, '\n');
    }
  }
  return { langs: langs, col: col, rows: rows };
}

function tableUrl() {
  var cur = document.currentScript;
  var rel = cur && cur.getAttribute ? cur.getAttribute('data-i18n') : '';
  if (rel) return rel;
  var s = document.querySelector('script[data-i18n]');
  return s ? s.getAttribute('data-i18n') : 'strings.tsv';
}

function localize() {
  // исходный английский текст запоминаем при первом проходе: если таблица не загрузилась,
  // пользователь всё равно видит надписи, а не индексы
  function src(elm, attr, store) {
    if (!elm.getAttribute(store)) {
      var v = attr ? (elm.getAttribute(attr) || '') : (elm.textContent || '');
      elm.setAttribute(store, v.trim());
    }
    return elm.getAttribute(store);
  }
  var i, els;
  els = document.querySelectorAll('[data-i18n]');
  for (i = 0; i < els.length; i++) {
    var k = els[i].getAttribute('data-i18n');
    var v = t(k, src(els[i], '', 'data-i18n-src'));
    if (els[i].textContent !== v) els[i].textContent = v;
  }
  els = document.querySelectorAll('[data-i18n-ph]');
  for (i = 0; i < els.length; i++)
    els[i].setAttribute('placeholder', t(els[i].getAttribute('data-i18n-ph'), src(els[i], 'placeholder', 'data-i18n-ph-src')));
  els = document.querySelectorAll('[data-i18n-title]');
  for (i = 0; i < els.length; i++)
    els[i].setAttribute('title', t(els[i].getAttribute('data-i18n-title'), src(els[i], 'title', 'data-i18n-title-src')));
  els = document.querySelectorAll('[data-i18n-aria]');
  for (i = 0; i < els.length; i++)
    els[i].setAttribute('aria-label', t(els[i].getAttribute('data-i18n-aria'), src(els[i], 'aria-label', 'data-i18n-aria-src')));
  var tt = document.querySelector('title[data-i18n]');
  if (tt) document.title = t(tt.getAttribute('data-i18n'), tt.getAttribute('data-i18n-src') || document.title);
}

// ---------- сервер: у человека настройки главнее кеша ----------
function getPrefs() {
  if (!srv.base || !srv.tok || !window.fetch) return Promise.resolve(null);
  return fetch(srv.base + '/__prefs', {
    cache: 'no-store',
    headers: { 'Authorization': 'Bearer ' + srv.tok }
  }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
}

function putPrefs() {
  if (!srv.base || !srv.tok || !window.fetch) return Promise.resolve(false);
  return fetch(srv.base + '/__prefs', {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Authorization': 'Bearer ' + srv.tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme: theme(), lang: langNow() })
  }).then(function (r) { return !!r.ok; }).catch(function () { return false; });
}

function sync(base, tok) {
  if (!base || !tok) return Promise.resolve(false);
  srv.base = String(base).replace(/\/+$/, '');
  srv.tok = tok;
  return getPrefs().then(function (j) {
    if (!j || !j.ok) return false;
    if (j.set) {
      var th = pick(j.theme, THEMES, 'auto');
      var lg = pick(j.lang, tbl.langs.length ? tbl.langs : [DEF_LANG], '');
      if (th !== ls(KTH)) lss(KTH, th);
      if (lg && lg !== ls(KLG)) lss(KLG, lg);
      apply();
      // язык сервера другой — нужна перерисовка целиком (надписи в разметке)
      if (lg && lg !== appliedLang && !reloaded) { reloaded = true; lss(KRELOAD, lg); location.reload(); }
      return true;
    }
    return putPrefs();
  });
}

// ---------- выбор ----------
function setTheme(v) {
  lss(KTH, pick(v, THEMES, 'auto'));
  apply();
  putPrefs();
  if (UI.onChange) { try { UI.onChange({ theme: theme(), lang: langNow() }); } catch (e) {} }
}

function setLang(v) {
  if (!pick(v, tbl.langs.length ? tbl.langs : [DEF_LANG], '')) return;
  lss(KLG, v);
  putPrefs().then(function () { lss(KRELOAD, v); location.reload(); },
                  function () { lss(KRELOAD, v); location.reload(); });
}

// ---------- вид переключателя ----------
function injectCss() {
  if (document.getElementById('ui-sw-css')) return;
  var st = document.createElement('style');
  st.id = 'ui-sw-css';
  st.textContent =
    '.ui-sw{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;line-height:1}' +
    '.ui-sel{font:inherit;font-size:12px;line-height:1.2;padding:5px 6px;border-radius:9px;cursor:pointer;' +
      'background:var(--area,#1d242c);color:var(--tx2,#b9c4d0);border:1px solid var(--line2,#303a46);' +
      '-webkit-appearance:none;appearance:none;padding-right:16px;' +
      'background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);' +
      'background-position:calc(100% - 10px) 50%,calc(100% - 6px) 50%;background-size:4px 4px,4px 4px;background-repeat:no-repeat}' +
    '.ui-sel:hover{color:var(--tx,#e6e9ee);border-color:var(--line3,#33506e)}' +
    '.ui-sel:focus{outline:none;border-color:var(--acc,#2f6fb5)}' +
    '.ui-home{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9px;' +
      'text-decoration:none;font-size:14px;line-height:1;background:var(--area,#1d242c);' +
      'border:1px solid var(--line2,#303a46)}' +
    '.ui-home:hover{border-color:var(--line3,#33506e)}' +
    '@media (pointer:coarse){.ui-sel{font-size:13px;padding:7px 8px;padding-right:18px}.ui-home{width:30px;height:30px}}';
  (document.head || document.getElementsByTagName('head')[0]).appendChild(st);
}
injectCss();

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function themeSel() {
  var s = el('select', 'ui-sel');
  s.setAttribute('data-ui-theme', '1');
  s.setAttribute('aria-label', t('ui.theme', 'Theme'));
  s.title = t('ui.theme', 'Theme');
  var items = [['dark', t('ui.theme.dark', 'Dark')],
               ['light', t('ui.theme.light', 'Light')],
               ['auto', t('ui.theme.auto', 'System')]];
  for (var i = 0; i < items.length; i++) {
    var o = el('option', '', items[i][1]);
    o.value = items[i][0];
    s.appendChild(o);
  }
  s.value = theme();
  s.onchange = function () { setTheme(s.value); };
  return s;
}

function langSel() {
  var s = el('select', 'ui-sel');
  s.setAttribute('data-ui-lang', '1');
  s.setAttribute('aria-label', t('ui.lang', 'Language'));
  s.title = t('ui.lang', 'Language');
  var list = tbl.langs.length ? tbl.langs : [langNow()];
  for (var i = 0; i < list.length; i++) {
    var o = el('option', '', t('lang.' + list[i], list[i].toUpperCase()));
    o.value = list[i];
    s.appendChild(o);
  }
  s.value = langNow();
  s.onchange = function () { setLang(s.value); };
  return s;
}

function homeLink() {
  var a = el('a', 'ui-home', '🏠');
  a.href = HOME;
  a.title = t('ui.home', 'Home page');
  a.setAttribute('aria-label', t('ui.home', 'Home page'));
  a.setAttribute('rel', 'noopener');
  return a;
}

function mount(box) {
  if (!box || box.getAttribute('data-ui-done')) return;
  box.setAttribute('data-ui-done', '1');
  if ((' ' + box.className + ' ').indexOf(' ui-sw ') < 0) box.className += ' ui-sw';
  box.innerHTML = '';
  box.appendChild(themeSel());
  box.appendChild(langSel());
  if (box.getAttribute('data-home') !== '0') box.appendChild(homeLink());
}

// после загрузки таблицы пересобрать списки (в них теперь названия языков)
function syncControls() {
  var boxes = document.querySelectorAll('[data-ui="switch"]');
  for (var i = 0; i < boxes.length; i++) {
    var b = boxes[i];
    if (!b.getAttribute('data-ui-done')) continue;
    var ts = b.querySelector('select[data-ui-theme]');
    var ls2 = b.querySelector('select[data-ui-lang]');
    if (ts) ts.value = theme();
    if (ls2) ls2.value = langNow();
  }
}

function rebuildAll() {
  var boxes = document.querySelectorAll('[data-ui="switch"]');
  for (var i = 0; i < boxes.length; i++) { boxes[i].removeAttribute('data-ui-done'); mount(boxes[i]); }
}

// ---------- старт ----------
apply();   // тема должна стоять до разбора CSS ниже по странице

document.addEventListener('DOMContentLoaded', function () {
  appliedLang = langNow();
  var boxes = document.querySelectorAll('[data-ui="switch"]');
  for (var i = 0; i < boxes.length; i++) mount(boxes[i]);
  localize();
  apply();

  // таблица надписей: без неё остаётся английский текст из файла страницы
  if (window.fetch) {
    fetch(tableUrl(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (txt) {
      var p = parseTable(txt);
      if (!p.langs.length || !p.rows) throw new Error('empty');
      tbl.langs = p.langs; tbl.col = p.col; tbl.rows = p.rows; tbl.ready = true;
      if (tbl.langs.indexOf(ls(KLG)) < 0 && ls(KLG) !== 'auto' && ls(KLG) !== '') lss(KLG, DEF_LANG);
      localize();
      rebuildAll();
      apply();
      if (window.UI.onLang) { try { UI.onLang(langNow()); } catch (e) {} }
    }).catch(function () { tbl.failed = true; });
  }
});

// система переключила тему — если выбрано «как в системе», меняемся следом
function onSys() { if (theme() === 'auto') apply(); }
if (mqL) {
  if (mqL.addEventListener) mqL.addEventListener('change', onSys);
  else if (mqL.addListener) mqL.addListener(onSys);
}

window.UI = {
  theme: theme, lang: langNow, langs: function () { return tbl.langs.slice(); },
  resolved: resolved, setTheme: setTheme, setLang: setLang,
  t: t, apply: apply, sync: sync, localize: localize,
  ready: function () { return tbl.ready; },
  onChange: null, onLang: null
};
window.t = t;   // чтобы код страниц мог писать t('ключ', 'English fallback')
})();

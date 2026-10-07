/* The landing exists at one path per language. The root follows the language this visitor chose before
   in either playground or the browser's language; a language path someone linked to stays put. */
var LANDING_PATHS = { 'zh-Hans': '/zh-hans/', 'zh-Hant': '/zh-hant/', ja: '/ja/', ko: '/ko/', en: '/', es: '/es/' };
// The live playground saves the language as room-toy-language; the source playground as move-demo:language.
var LANGUAGE_KEYS = ['room-toy-language', 'move-demo:language'];

// Same mapping as normalizeLocale in i18n.mjs.
function landingLocale(value) {
  var v = String(value || '').toLowerCase();
  if (v.indexOf('zh') === 0) return v.indexOf('hans') >= 0 ? 'zh-Hans' : /hant|tw|hk|mo/.test(v) ? 'zh-Hant' : 'zh-Hans';
  var codes = ['ja', 'ko', 'en', 'es'];
  for (var i = 0; i < codes.length; i++) if (v === codes[i] || v.indexOf(codes[i] + '-') === 0) return codes[i];
  return 'en';
}

if (location.pathname === '/' && location.hash.indexOf('#layout=') === 0) {
  location.replace('/play/' + location.search + location.hash);
} else if (location.pathname === '/') {
  var savedLanguage = null;
  try {
    for (var k = 0; k < LANGUAGE_KEYS.length && !savedLanguage; k++) savedLanguage = localStorage.getItem(LANGUAGE_KEYS[k]);
  } catch (e) { savedLanguage = null; }
  var browserLanguage = (navigator.languages && navigator.languages[0]) || navigator.language;
  var landingLanguage = landingLocale(savedLanguage || browserLanguage);
  if (landingLanguage !== 'en') location.replace(LANDING_PATHS[landingLanguage] + location.search + location.hash);
}

/* Move landing: copy-to-clipboard, setup guide URL, film source and language menu. */
(function () {
  'use strict';

  var NARROW_FILM = '(max-width: 600px)';

  var root = document.documentElement;
  root.classList.remove('no-js');
  root.classList.add('js');

  function selectElementText(el) {
    var selection = window.getSelection();
    if (!selection) return;
    var range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function legacyCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.left = '0';
    area.style.width = '1px';
    area.style.height = '1px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);

    var ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (e) {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyCopy(text); }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  var statusTimers = {};

  function showStatus(statusEl, message, clearAfter) {
    if (!statusEl) return;
    clearTimeout(statusTimers[statusEl.id]);
    statusEl.textContent = message;
    if (clearAfter) {
      statusTimers[statusEl.id] = setTimeout(function () {
        statusEl.textContent = '';
      }, clearAfter);
    }
  }

  function handleCopy(event) {
    var button = event.currentTarget;
    var source = document.getElementById(button.getAttribute('data-copy-target'));
    var statusEl = document.getElementById(button.getAttribute('data-copy-status'));
    if (!source) return;

    var text = source.textContent.trim();
    copyText(text).then(function (ok) {
      button.focus({ preventScroll: true });
      if (ok) {
        showStatus(statusEl, button.getAttribute('data-copied') || 'Copied', 2500);
      } else {
        selectElementText(source);
        showStatus(statusEl, button.getAttribute('data-copy-fallback') || 'Select and copy the command', 0);
      }
    });
  }

  // The agent instruction names this site's own origin, so a local preview points at the local guide.
  function fillSetupUrl() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    var spots = document.querySelectorAll('[data-setup-url]');
    for (var i = 0; i < spots.length; i++) {
      spots[i].textContent = location.origin + '/setup.md';
    }
  }

  function prepareFilm() {
    if (!window.matchMedia) return;
    var media = window.matchMedia(NARROW_FILM);
    var videos = document.querySelectorAll('.film video');
    for (var i = 0; i < videos.length; i++) {
      (function (video) {
        var revision = 0, switching = false, position = 0, resume = false;
        function selectFilm(initial) {
          var portrait = media.matches;
          video.poster = portrait ? video.dataset.posterPortrait : video.dataset.posterLandscape;
          // The source media attribute selects the initial file before this script runs.
          if (initial) return;
          if (!switching) {
            position = video.currentTime || 0;
            resume = !video.paused && !video.ended;
          }
          switching = true;
          var selectedRevision = ++revision;
          video.pause();
          video.addEventListener('loadedmetadata', function restore() {
            if (selectedRevision !== revision) return;
            video.currentTime = Math.min(position, Math.max(0, video.duration - 0.001));
            switching = false;
            if (resume) video.play().catch(function () {});
          }, { once: true });
          video.src = portrait ? video.dataset.filmPortrait : video.dataset.filmLandscape;
          video.load();
        }
        selectFilm(true);
        if (media.addEventListener) media.addEventListener('change', function () { selectFilm(false); });
        else media.addListener(function () { selectFilm(false); });
      })(videos[i]);
    }
  }

  // Choosing a language saves it for the landing and both playgrounds, then opens that language's page.
  function prepareLanguageMenu() {
    var select = document.querySelector('[data-lang-select]');
    if (!select) return;
    select.addEventListener('change', function () {
      var path = LANDING_PATHS[select.value];
      if (!path) return;
      try {
        for (var i = 0; i < LANGUAGE_KEYS.length; i++) localStorage.setItem(LANGUAGE_KEYS[i], select.value);
      } catch (e) { /* The page still changes language. */ }
      location.href = path + location.hash;
    });
  }

  function init() {
    fillSetupUrl();
    prepareLanguageMenu();

    var copyButtons = document.querySelectorAll('[data-copy-target]');
    for (var i = 0; i < copyButtons.length; i++) {
      copyButtons[i].addEventListener('click', handleCopy);
    }

    prepareFilm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

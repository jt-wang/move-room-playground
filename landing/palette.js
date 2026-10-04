/* Shared palette preview for the Move landing page and playground.
   Load in <head> so the palette applies before first paint. Choice order: ?palette= in the URL,
   then localStorage, then A. Fills [data-palette-toolbar], keeps [data-palette-link] hrefs carrying
   the choice, and dispatches "move-palette-change" on window. */
(function () {
  'use strict';

  var STORAGE_KEY = 'move-preview-palette';
  var PARAM = 'palette';
  var PALETTES = {
    a: { name: 'Mint & chalk', mood: 'closest to the live room' },
    b: { name: 'Neutral & graphite', mood: 'quietest and most restrained' },
    c: { name: 'Mist & blue', mood: 'cooler and more technical' }
  };
  var ORDER = ['a', 'b', 'c'];
  var root = document.documentElement;

  function isPalette(id) {
    return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PALETTES, id);
  }

  function fromUrl() {
    try {
      var id = new URLSearchParams(window.location.search).get(PARAM);
      return isPalette(id) ? id : null;
    } catch (e) {
      return null;
    }
  }

  function fromStorage() {
    try {
      var id = window.localStorage.getItem(STORAGE_KEY);
      return isPalette(id) ? id : null;
    } catch (e) {
      return null;
    }
  }

  function store(id) {
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch (e) {
      /* Storage unavailable: links and the URL still carry the choice. */
    }
  }

  // Back/forward navigation restores an old address; the stored choice is newer.
  function isHistoryVisit() {
    try {
      var nav = window.performance.getEntriesByType('navigation')[0];
      return !!nav && nav.type === 'back_forward';
    } catch (e) {
      return false;
    }
  }

  var urlChoice = isHistoryVisit() ? null : fromUrl();
  var current = urlChoice || fromStorage() || fromUrl() || 'a';
  if (urlChoice) store(urlChoice);
  root.setAttribute('data-palette', current);

  function withPalette(href, id) {
    try {
      var url = new URL(href, window.location.href);
      if (url.origin !== window.location.origin) return href;
      url.searchParams.set(PARAM, id);
      return url.href;
    } catch (e) {
      return href;
    }
  }

  function syncLinks(id) {
    var links = document.querySelectorAll('a[data-palette-link]');
    for (var i = 0; i < links.length; i++) {
      links[i].href = withPalette(links[i].getAttribute('href'), id);
    }
  }

  // Only rewrite the address when it already names a palette, so a reload keeps the latest choice.
  function syncAddress(id) {
    if (!fromUrl() || !window.history || !window.history.replaceState) return;
    try {
      window.history.replaceState(window.history.state, '', withPalette(window.location.href, id));
    } catch (e) {
      /* Leave the address unchanged. */
    }
  }

  function syncToolbar(id) {
    var buttons = document.querySelectorAll('[data-palette-choice]');
    for (var i = 0; i < buttons.length; i++) {
      var pressed = buttons[i].getAttribute('data-palette-choice') === id;
      buttons[i].setAttribute('aria-pressed', pressed ? 'true' : 'false');
    }
    var moods = document.querySelectorAll('[data-palette-mood]');
    for (var j = 0; j < moods.length; j++) {
      var name = document.createElement('span');
      name.className = 'mp-mood-name';
      name.textContent = PALETTES[id].name;
      var note = document.createElement('span');
      note.className = 'mp-mood-note';
      note.textContent = ' · ' + PALETTES[id].mood;
      moods[j].replaceChildren(name, note);
    }
  }

  function apply(id, options) {
    if (!isPalette(id)) return;
    var changed = id !== current;
    current = id;
    root.setAttribute('data-palette', id);
    if (options.persist) store(id);
    if (options.address) syncAddress(id);
    syncToolbar(id);
    syncLinks(id);
    if (changed) {
      var event;
      try {
        event = new CustomEvent('move-palette-change', { detail: { palette: id } });
      } catch (e) {
        event = document.createEvent('CustomEvent');
        event.initCustomEvent('move-palette-change', false, false, { palette: id });
      }
      window.dispatchEvent(event);
    }
  }

  function buildToolbar(container) {
    if (container.querySelector('[data-palette-choice]')) return;
    var labelId = 'mp-palette-label';
    container.setAttribute('role', 'group');
    container.setAttribute('aria-labelledby', labelId);

    var label = document.createElement('span');
    label.id = labelId;
    label.className = 'mp-label';
    label.textContent = 'Palette';
    container.appendChild(label);

    ORDER.forEach(function (id) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'mp-palette-btn';
      button.setAttribute('data-palette-choice', id);
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-label', id.toUpperCase() + ', ' + PALETTES[id].name.replace('&', 'and'));
      var swatch = document.createElement('span');
      swatch.className = 'mp-swatch mp-swatch-' + id;
      swatch.setAttribute('aria-hidden', 'true');
      button.appendChild(swatch);
      button.appendChild(document.createTextNode(id.toUpperCase()));
      button.addEventListener('click', function () {
        apply(id, { persist: true, address: true });
      });
      container.appendChild(button);
    });

    var mood = document.createElement('span');
    mood.className = 'mp-mood';
    mood.setAttribute('data-palette-mood', '');
    mood.setAttribute('aria-live', 'polite');
    container.parentNode.insertBefore(mood, container.nextSibling);
  }

  function init() {
    var containers = document.querySelectorAll('[data-palette-toolbar]');
    for (var i = 0; i < containers.length; i++) buildToolbar(containers[i]);
    syncAddress(current);
    syncToolbar(current);
    syncLinks(current);
  }

  // Another tab on the same origin changed the palette.
  window.addEventListener('storage', function (event) {
    if (event.key === STORAGE_KEY && isPalette(event.newValue)) {
      apply(event.newValue, { persist: false, address: true });
    }
  });

  // Returning through the back/forward cache: the stored choice is newer than the page.
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    var id = fromStorage();
    if (id) apply(id, { persist: false, address: true });
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

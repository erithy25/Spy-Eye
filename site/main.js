/*
 * Sicht — website behaviour. No dependencies, no network requests.
 *
 *   1. language switch (German is the original in index.html, English comes from i18n.js)
 *   2. contact link, screenshot frames, section menu, scroll reveal
 *   3. the hero map: drawn on a canvas from OpenStreetMap vector data and contour lines
 *      (assets/map/hero.js), with a scan sweep, reticles and a live grid reference
 */
(function () {
  'use strict';

  var doc = document;
  var root = doc.documentElement;
  var reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // ------------------------------------------------------------------ language

  var EN = window.SICHT_EN || {};
  var originals = new Map();
  var originalAttrs = new Map();
  var originalTitle = doc.title;
  var metaDescription = doc.querySelector('meta[name="description"]');
  var originalDescription = metaDescription ? metaDescription.getAttribute('content') : '';
  var lang = 'de';
  var onLanguage = [];

  function translateAttr(name) {
    var nodes = doc.querySelectorAll('[data-i18n-' + name + ']');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = el.getAttribute('data-i18n-' + name);
      var store = originalAttrs.get(el);
      if (!store) {
        store = {};
        originalAttrs.set(el, store);
      }
      if (!(name in store)) store[name] = el.getAttribute(name) || '';
      var value = lang === 'en' && typeof EN[key] === 'string' ? EN[key] : store[name];
      if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    }
  }

  function applyLanguage(next) {
    lang = next === 'en' ? 'en' : 'de';
    root.lang = lang;
    var nodes = doc.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!originals.has(el)) originals.set(el, el.innerHTML);
      var key = el.getAttribute('data-i18n');
      var html = lang === 'en' && typeof EN[key] === 'string' ? EN[key] : originals.get(el);
      if (el.innerHTML !== html) el.innerHTML = html;
    }
    translateAttr('aria-label');
    translateAttr('alt');
    doc.title = lang === 'en' && EN['doc.title'] ? EN['doc.title'] : originalTitle;
    if (metaDescription) {
      metaDescription.setAttribute('content', lang === 'en' && EN['doc.description'] ? EN['doc.description'] : originalDescription);
    }
    var buttons = doc.querySelectorAll('.lang button');
    for (var b = 0; b < buttons.length; b++) {
      buttons[b].setAttribute('aria-pressed', buttons[b].getAttribute('data-lang') === lang ? 'true' : 'false');
    }
    try {
      window.localStorage.setItem('sicht.lang', lang);
    } catch (err) {
      // storage may be unavailable (private mode, sandboxed frame); the choice then lasts for this visit
    }
    for (var n = 0; n < onLanguage.length; n++) onLanguage[n](lang);
  }

  function initialLanguage() {
    var fromQuery = /[?&]lang=(de|en)\b/.exec(window.location.search);
    if (fromQuery) return fromQuery[1];
    try {
      var stored = window.localStorage.getItem('sicht.lang');
      if (stored === 'de' || stored === 'en') return stored;
    } catch (err) {
      // see above
    }
    return 'de';
  }

  var langButtons = doc.querySelectorAll('.lang button');
  for (var lb = 0; lb < langButtons.length; lb++) {
    langButtons[lb].addEventListener('click', function (event) {
      applyLanguage(event.currentTarget.getAttribute('data-lang'));
    });
  }

  // ------------------------------------------------------------------ contact link

  // Set data-contact on <body> to an e-mail address or an https:// address to show the call to action.
  (function () {
    var target = (doc.body.getAttribute('data-contact') || '').trim();
    var href = '';
    if (/^[^@\s<>"']+@[^@\s<>"']+\.[^@\s<>"']+$/.test(target)) href = 'mailto:' + target;
    else if (/^https?:\/\/[^\s<>"']+$/i.test(target)) href = target;
    if (!href) return;
    var links = doc.querySelectorAll('[data-contact-link]');
    for (var i = 0; i < links.length; i++) {
      links[i].setAttribute('href', href);
      if (href.indexOf('mailto:') !== 0) links[i].setAttribute('rel', 'noopener noreferrer');
      links[i].hidden = false;
    }
  })();

  // ------------------------------------------------------------------ screenshot frames

  // A frame shows its registration mark until the picture has really loaded; a missing file leaves the mark.
  (function () {
    var shots = doc.querySelectorAll('.shot');
    for (var i = 0; i < shots.length; i++) {
      (function (figure) {
        var img = figure.querySelector('img');
        if (!img) return;
        var loaded = function () {
          if (img.naturalWidth > 0) figure.classList.add('is-loaded');
        };
        var failed = function () {
          figure.classList.add('is-empty');
          if (img.parentNode) img.parentNode.removeChild(img);
        };
        if (img.complete && img.getAttribute('src')) {
          if (img.naturalWidth > 0) loaded();
          else if (img.loading !== 'lazy') failed();
        }
        img.addEventListener('load', loaded);
        img.addEventListener('error', failed);
      })(shots[i]);
    }
  })();

  // ------------------------------------------------------------------ section menu (narrow screens)

  (function () {
    var menu = doc.querySelector('.bar-menu');
    if (!menu) return;
    menu.addEventListener('click', function (event) {
      var link = event.target && event.target.closest ? event.target.closest('a') : null;
      if (link) menu.open = false;
    });
    doc.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menu.open) {
        menu.open = false;
        var summary = menu.querySelector('summary');
        if (summary) summary.focus();
      }
    });
    doc.addEventListener('click', function (event) {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
  })();

  // ------------------------------------------------------------------ current section, scroll reveal

  (function () {
    if (!('IntersectionObserver' in window)) return;

    var links = doc.querySelectorAll('.bar-nav a');
    var byId = {};
    for (var i = 0; i < links.length; i++) byId[links[i].getAttribute('href').slice(1)] = links[i];
    var sections = doc.querySelectorAll('main > section[id]');
    var current = new IntersectionObserver(
      function (entries) {
        for (var e = 0; e < entries.length; e++) {
          if (!entries[e].isIntersecting) continue;
          var id = entries[e].target.id;
          for (var key in byId) {
            if (key === id) byId[key].setAttribute('aria-current', 'true');
            else byId[key].removeAttribute('aria-current');
          }
        }
      },
      { rootMargin: '-45% 0px -54% 0px' },
    );
    for (var s = 0; s < sections.length; s++) current.observe(sections[s]);

    if (reduceMotion.matches) return;
    var blocks = doc.querySelectorAll('.reveal');
    var reveal = new IntersectionObserver(
      function (entries) {
        for (var e = 0; e < entries.length; e++) {
          if (!entries[e].isIntersecting) continue;
          entries[e].target.classList.remove('is-pending');
          reveal.unobserve(entries[e].target);
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    var fold = window.innerHeight;
    for (var b = 0; b < blocks.length; b++) {
      // Only what is still below the fold waits; nothing visible is ever hidden.
      if (blocks[b].getBoundingClientRect().top > fold) {
        blocks[b].classList.add('is-pending');
        reveal.observe(blocks[b]);
      }
    }
  })();

  // ------------------------------------------------------------------ reading position

  (function () {
    var line = doc.querySelector('.bar-progress');
    if (!line) return;
    var queued = false;
    var update = function () {
      queued = false;
      var span = root.scrollHeight - window.innerHeight;
      var done = span > 0 ? Math.min(1, Math.max(0, window.scrollY / span)) : 0;
      line.style.setProperty('--read', done.toFixed(4));
    };
    var request = function () {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(update);
    };
    window.addEventListener('scroll', request, { passive: true });
    window.addEventListener('resize', request);
    update();
  })();

  // ------------------------------------------------------------------ geodesy (same method as the console)

  function rad(deg) {
    return (deg * Math.PI) / 180;
  }

  /** Transverse Mercator forward projection, Krüger series. */
  function toUtm(lat, lon) {
    var a = 6378137;
    var f = 1 / 298.257223563;
    var k0 = 0.9996;
    var zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
    var lambda0 = rad((zone - 1) * 6 - 180 + 3);
    var e2 = f * (2 - f);
    var n = f / (2 - f);
    var A = (a / (1 + n)) * (1 + Math.pow(n, 2) / 4 + Math.pow(n, 4) / 64);
    var alpha = [
      n / 2 - (2 / 3) * Math.pow(n, 2) + (5 / 16) * Math.pow(n, 3),
      (13 / 48) * Math.pow(n, 2) - (3 / 5) * Math.pow(n, 3),
      (61 / 240) * Math.pow(n, 3),
    ];
    var phi = rad(lat);
    var lambda = rad(lon) - lambda0;
    var e = Math.sqrt(e2);
    var t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
    var xi = Math.atan2(t, Math.cos(lambda));
    var eta = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));
    var x = eta;
    var y = xi;
    for (var j = 1; j <= 3; j++) {
      x += alpha[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
      y += alpha[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    }
    var bands = 'CDEFGHJKLMNPQRSTUVWXX';
    return {
      zone: zone,
      band: bands.charAt(Math.min(20, Math.max(0, Math.floor((lat + 80) / 8)))),
      easting: 500000 + k0 * A * x,
      northing: k0 * A * y + (lat < 0 ? 10000000 : 0),
    };
  }

  /** MGRS / UTMREF with 10 m precision, e.g. "32U MA 0087 8009". */
  function toMgrs(lat, lon) {
    if (lat < -80 || lat > 84) return '—';
    var utm = toUtm(lat, lon);
    var columns = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'][(utm.zone - 1) % 3];
    var rows = ['ABCDEFGHJKLMNPQRSTUV', 'FGHJKLMNPQRSTUVABCDE'][(utm.zone - 1) % 2];
    var col = columns.charAt(Math.floor(utm.easting / 100000) - 1) || '?';
    var row = rows.charAt(Math.floor(utm.northing / 100000) % 20) || '?';
    var pad = function (v) {
      return ('0000' + Math.floor(v)).slice(-4);
    };
    return utm.zone + utm.band + ' ' + col + row + ' ' + pad((utm.easting % 100000) / 10) + ' ' + pad((utm.northing % 100000) / 10);
  }

  // ------------------------------------------------------------------ hero map

  var BG = '#050505';
  var FG = '#ededed';
  var MID = '#8a8a8a';
  var FONT = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  /** Greys of the resting map and of the strip the sweep has just passed. */
  var TONE_REST = {
    contour: '#1c1c1c', contourMajor: '#292929', water: '#080808', hatch: '#181818', shore: '#484848',
    n: '#222222', e: '#303030', s: '#3a3a3a', p: '#4c4c4c', t: '#585858', m: '#666666', r: '#3e3e3e',
    bound: '#2a2a2a', city: '#a8a8a8', town: '#707070', village: '#4c4c4c', river: '#5c5c5c', frame: '#4c4c4c',
  };
  var TONE_LIT = {
    contour: '#2c2c2c', contourMajor: '#444444', water: '#0c0c0c', hatch: '#2c2c2c', shore: '#a6a6a6',
    n: '#4c4c4c', e: '#6c6c6c', s: '#838383', p: '#a2a2a2', t: '#bababa', m: '#d6d6d6', r: '#8c8c8c',
    bound: '#5a5a5a', city: '#ededed', town: '#c2c2c2', village: '#8a8a8a', river: '#a0a0a0', frame: '#8a8a8a',
  };

  /** Focus of the view: the confluence of Rhine and Moselle. */
  var FOCUS = { lat: 50.3646, lon: 7.6063 };

  /** Exercise markers. Generic wording, fixed coordinates; `t` and `s` index the texts in i18n.js. */
  var TARGETS = [
    { lat: 50.3628, lon: 7.5952, t: 0, s: 0, wideOnly: false },
    { lat: 50.3527, lon: 7.6058, t: 1, s: 1, wideOnly: true },
    { lat: 50.3852, lon: 7.6212, t: 2, s: 2, wideOnly: false },
    { lat: 50.3418, lon: 7.6128, t: 3, s: 3, wideOnly: true },
  ];

  /** Where the river names sit (nearest point of the river's centre line is used). */
  var RIVER_LABELS = [
    { name: 'Rhein', lat: 50.3318, lon: 7.5985 },
    { name: 'Rhein', lat: 50.4032, lon: 7.6035 },
    { name: 'Mosel', lat: 50.3395, lon: 7.5565 },
    { name: 'Lahn', lat: 50.3063, lon: 7.6165 },
  ];

  var CYCLE = 16; // seconds for one sweep and its rest
  var SWEEP = 11; // seconds the sweep line travels
  var HOLD = 13.6; // seconds a marker stays after it was found

  function initHero() {
    var hero = doc.querySelector('.hero');
    var canvas = doc.querySelector('.hero-map');
    var data = window.SICHT_MAP;
    var readout = doc.querySelector('[data-mgrs]');
    if (!hero || !canvas || !data || typeof canvas.getContext !== 'function') return null;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;

    var UNIT = data.unit;
    var WORLD = Math.pow(2, data.z);

    function toUnits(lat, lon) {
      var x = ((lon + 180) / 360) * WORLD;
      var r = rad(lat);
      var y = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * WORLD;
      return [(x - data.x0) * UNIT, (y - data.y0) * UNIT];
    }

    function toGeo(ux, uy) {
      var x = data.x0 + ux / UNIT;
      var y = data.y0 + uy / UNIT;
      var n = Math.PI - (2 * Math.PI * y) / WORLD;
      return [(180 / Math.PI) * Math.atan(Math.sinh(n)), (x / WORLD) * 360 - 180];
    }

    /** Delta-encoded path -> absolute coordinates with a bounding box. */
    function unpack(packed) {
      var pts = new Float32Array(packed.length);
      var x = 0;
      var y = 0;
      var minX = Infinity;
      var minY = Infinity;
      var maxX = -Infinity;
      var maxY = -Infinity;
      for (var i = 0; i < packed.length; i += 2) {
        x += packed[i];
        y += packed[i + 1];
        pts[i] = x;
        pts[i + 1] = y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      return { pts: pts, minX: minX, minY: minY, maxX: maxX, maxY: maxY };
    }

    function unpackAll(list) {
      var out = new Array(list.length);
      for (var i = 0; i < list.length; i++) out[i] = unpack(list[i]);
      return out;
    }

    var layers = {
      water: unpackAll(data.water),
      shore: unpackAll(data.shore),
      contours: unpackAll(data.contours),
      contoursMajor: unpackAll(data.contoursMajor),
      bridges: unpackAll(data.bridges),
      bounds: unpackAll(data.bounds),
      roads: {},
      rivers: [],
    };
    for (var cls in data.roads) layers.roads[cls] = unpackAll(data.roads[cls]);
    for (var r = 0; r < data.rivers.length; r++) {
      var river = unpack(data.rivers[r].l);
      river.name = data.rivers[r].n;
      layers.rivers.push(river);
    }
    var streams = layers.rivers.filter(function (item) {
      return item.name !== 'Rhein' && item.name !== 'Mosel' && item.name !== 'Lahn';
    });

    var targets = TARGETS.map(function (target) {
      var u = toUnits(target.lat, target.lon);
      return { ux: u[0], uy: u[1], t: target.t, s: target.s, wideOnly: target.wideOnly, mgrs: toMgrs(target.lat, target.lon), x: 0, y: 0, lockAt: 0 };
    });

    var view = { W: 0, H: 0, dpr: 1, k: 1, ox: 0, oy: 0, narrow: false, compact: false, tilePx: 0, zone: 0, mapBottom: 0, text: null };
    var rest = doc.createElement('canvas');
    var lit = doc.createElement('canvas');
    var pointer = { x: 0, y: 0, active: false };
    var texts = (window.SICHT_MAP_TEXT || {})[lang] || { alert: '', targets: [], sources: [], rivers: {} };
    var kicker = hero.querySelector('.hero-kicker');

    function computeView() {
      var rect = hero.getBoundingClientRect();
      var W = Math.max(1, Math.round(rect.width));
      var H = Math.max(1, Math.round(rect.height));
      // Below 1100 px the map owns the strip above the text and ends there; above, it runs behind the text.
      // (The same width switches the layout in styles.css.)
      var narrow = W < 1100;
      var compact = W < 520;
      var textTop = kicker ? kicker.getBoundingClientRect().top - rect.top : H * 0.4;
      var zone = narrow ? Math.max(160, textTop - 10) : H;
      var mapBottom = narrow ? Math.min(H, zone + 60) : H;
      var focus = toUnits(FOCUS.lat, FOCUS.lon);
      var ax = narrow ? (compact ? 0.5 : 0.56) : 0.74;
      var ayPx = narrow ? zone * 0.56 : H * 0.44;
      var tilePx = narrow ? Math.max(W / (compact ? 1.5 : 2.4), zone / 1.3) : W / 2.5;
      // the block of text, so that nothing on the map is set underneath it
      var text = null;
      var blocks = hero.querySelectorAll('.hero-kicker, h1, .hero-lede, .hero-actions');
      var range = doc.createRange ? doc.createRange() : null;
      for (var b = 0; b < blocks.length; b++) {
        // the extent of the set lines, not of the block (which may be as wide as the page)
        var r;
        if (range) {
          range.selectNodeContents(blocks[b]);
          r = range.getBoundingClientRect();
        } else r = blocks[b].getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        var box = [r.left - rect.left - 14, r.top - rect.top - 10, r.right - rect.left + 14, r.bottom - rect.top + 10];
        text = text ? [Math.min(text[0], box[0]), Math.min(text[1], box[1]), Math.max(text[2], box[2]), Math.max(text[3], box[3])] : box;
      }
      // never look past the edge of the data
      var left = focus[0] / UNIT - 0.03;
      var right = data.cols - focus[0] / UNIT - 0.03;
      var top = focus[1] / UNIT - 0.03;
      var bottom = data.rows - focus[1] / UNIT - 0.03;
      tilePx = Math.max(tilePx, (ax * W) / left, ((1 - ax) * W) / right, ayPx / top, (mapBottom - ayPx) / bottom);
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var budget = 7.5e6; // device pixels per layer
      if (W * H * dpr * dpr > budget) dpr = Math.sqrt(budget / (W * H));
      view.W = W;
      view.H = H;
      view.dpr = dpr;
      view.narrow = narrow;
      view.compact = compact;
      view.text = text;
      view.zone = zone;
      view.mapBottom = mapBottom;
      view.tilePx = tilePx;
      view.k = tilePx / UNIT;
      view.ox = ax * W - focus[0] * view.k;
      view.oy = ayPx - focus[1] * view.k;
      for (var i = 0; i < targets.length; i++) {
        targets[i].x = targets[i].ux * view.k + view.ox;
        targets[i].y = targets[i].uy * view.k + view.oy;
        targets[i].lockAt = SWEEP * ((targets[i].x / W + 0.04) / 1.08);
      }
    }

    function overText(box) {
      var t = view.text;
      return !!t && box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1];
    }

    /** Markers that fit the current layout. */
    function shown(target) {
      if (view.compact && target.wideOnly) return false;
      if (target.x < 24 || target.x > view.W - 24 || target.y < 24 || target.y > (view.narrow ? view.zone - 30 : view.H - 24)) return false;
      return !overText([target.x - 20, target.y - 20, target.x + 20, target.y + 20]);
    }

    function visible(item) {
      var k = view.k;
      return !(
        item.maxX * k + view.ox < -6 ||
        item.minX * k + view.ox > view.W + 6 ||
        item.maxY * k + view.oy < -6 ||
        item.minY * k + view.oy > view.H + 6
      );
    }

    function trace(g, list) {
      var k = view.k;
      var ox = view.ox;
      var oy = view.oy;
      g.beginPath();
      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        if (!visible(item)) continue;
        var p = item.pts;
        g.moveTo(p[0] * k + ox, p[1] * k + oy);
        for (var j = 2; j < p.length; j += 2) g.lineTo(p[j] * k + ox, p[j + 1] * k + oy);
      }
    }

    function stroke(g, list, color, width, dash) {
      trace(g, list);
      g.strokeStyle = color;
      g.lineWidth = width;
      g.setLineDash(dash || []);
      g.stroke();
    }

    /** Text with fixed letter spacing, drawn glyph by glyph so every browser sets it the same way. */
    function spaced(g, text, x, y, spacing) {
      var advance = g.measureText('M').width + spacing;
      for (var i = 0; i < text.length; i++) g.fillText(text.charAt(i), x + i * advance, y);
      return text.length * advance - spacing;
    }

    function spacedWidth(g, text, spacing) {
      return text.length * (g.measureText('M').width + spacing) - spacing;
    }

    function clashes(box, taken) {
      for (var b = 0; b < taken.length; b++) {
        var other = taken[b];
        if (box[0] < other[2] && box[2] > other[0] && box[1] < other[3] && box[3] > other[1]) return true;
      }
      return false;
    }

    function drawPlaces(g, tone) {
      // Markers and their labels come first; a place name never runs under them.
      var taken = [];
      if (view.text && !view.narrow) taken.push(view.text);
      for (var t = 0; t < targets.length; t++) {
        if (!shown(targets[t])) continue;
        taken.push([targets[t].x - 24, targets[t].y - 24, targets[t].x + 24, targets[t].y + 24]);
        var spot = labelBox(g, targets[t], 15);
        if (spot) taken.push([spot.x - 10, spot.y - 8, spot.x + spot.width + 10, spot.y + spot.height + 8]);
      }
      var order = { city: 0, town: 1, village: 2 };
      var places = data.places.slice().sort(function (a, b) {
        return order[a.c] - order[b.c];
      });
      g.textBaseline = 'alphabetic';
      for (var i = 0; i < places.length; i++) {
        var place = places[i];
        if (place.c === 'village' && view.tilePx < 430) continue;
        var x = place.x * view.k + view.ox;
        var y = place.y * view.k + view.oy;
        if (x < 10 || x > view.W - 10 || y < 20 || y > view.mapBottom - 10) continue;
        var size = place.c === 'city' ? 12 : place.c === 'town' ? 10.5 : 9.5;
        var spacing = place.c === 'city' ? 3.2 : 1.4;
        g.font = (place.c === 'city' ? '500 ' : '400 ') + size + 'px ' + FONT;
        var text = place.n.toUpperCase();
        var width = spacedWidth(g, text, spacing);
        var toRight = [x - 6, y - size - 2, x + 10 + width, y + 5];
        var toLeft = [x - 10 - width, y - size - 2, x + 6, y + 5];
        var box = null;
        var textX = 0;
        if (toRight[2] <= view.W - 8 && !clashes(toRight, taken)) {
          box = toRight;
          textX = x + 9;
        } else if (toLeft[0] >= 8 && !clashes(toLeft, taken)) {
          box = toLeft;
          textX = x - 9 - width;
        }
        if (!box) continue;
        taken.push(box);
        g.fillStyle = tone[place.c];
        g.fillRect(Math.round(x) - 1.5, Math.round(y) - 1.5, 3, 3);
        spaced(g, text, textX, y + 4, spacing);
      }
    }

    /** Minutes of arc along the top and the right edge, as on the frame of a printed map. */
    function drawFrame(g, tone) {
      if (view.narrow) return;
      var topLeft = toGeo(-view.ox / view.k, -view.oy / view.k);
      var bottomRight = toGeo((view.W - view.ox) / view.k, (view.H - view.oy) / view.k);
      g.font = '400 9px ' + FONT;
      g.textBaseline = 'alphabetic';
      g.fillStyle = tone.frame;
      var dm = function (value) {
        var deg = Math.floor(value + 1e-9);
        var min = Math.round((value - deg) * 60);
        return deg + '°' + (min < 10 ? '0' : '') + min + '′';
      };
      for (var m = Math.ceil(topLeft[1] * 60); m <= Math.floor(bottomRight[1] * 60); m++) {
        var x = toUnits(FOCUS.lat, m / 60)[0] * view.k + view.ox;
        if (x < view.W * 0.3 || x > view.W - 80) continue;
        g.fillRect(Math.round(x), 0, 1, 7);
        spaced(g, dm(m / 60) + 'E', Math.round(x) + 5, 12, 0.6);
      }
      for (var n = Math.floor(topLeft[0] * 60); n >= Math.ceil(bottomRight[0] * 60); n--) {
        var y = toUnits(n / 60, FOCUS.lon)[1] * view.k + view.oy;
        if (y < 30 || y > view.H * 0.8) continue;
        g.fillRect(view.W - 7, Math.round(y), 7, 1);
        var text = dm(n / 60) + 'N';
        spaced(g, text, view.W - 10 - spacedWidth(g, text, 0.6), Math.round(y) - 5, 0.6);
      }
    }

    function drawRiverNames(g, tone) {
      var names = texts.rivers || {};
      g.font = '400 10px ' + FONT;
      g.textBaseline = 'middle';
      g.fillStyle = tone.river;
      for (var i = 0; i < RIVER_LABELS.length; i++) {
        var label = RIVER_LABELS[i];
        var text = names[label.name];
        if (!text) continue;
        var want = toUnits(label.lat, label.lon);
        var best = null;
        for (var r = 0; r < layers.rivers.length; r++) {
          var line = layers.rivers[r];
          if (line.name !== label.name) continue;
          var p = line.pts;
          for (var j = 0; j < p.length; j += 2) {
            var d = (p[j] - want[0]) * (p[j] - want[0]) + (p[j + 1] - want[1]) * (p[j + 1] - want[1]);
            if (!best || d < best.d) best = { d: d, line: line, j: j };
          }
        }
        if (!best) continue;
        var pts = best.line.pts;
        var from = Math.max(0, best.j - 4);
        var to = Math.min(pts.length - 2, best.j + 4);
        if (from === to) continue;
        var angle = Math.atan2(pts[to + 1] - pts[from + 1], pts[to] - pts[from]);
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
        var x = pts[best.j] * view.k + view.ox;
        var y = pts[best.j + 1] * view.k + view.oy;
        if (x < 30 || x > view.W - 30 || y < 30 || y > view.mapBottom - 30) continue;
        var spacing = 5;
        var width = spacedWidth(g, text, spacing);
        g.save();
        g.translate(x, y);
        g.rotate(angle);
        spaced(g, text, -width / 2, 0.5, spacing);
        g.restore();
      }
    }

    function paint(target, tone) {
      var W = view.W;
      var H = view.H;
      var dpr = view.dpr;
      target.width = Math.round(W * dpr);
      target.height = Math.round(H * dpr);
      var g = target.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = BG;
      g.fillRect(0, 0, W, H);
      g.lineJoin = 'round';
      g.lineCap = 'butt';

      stroke(g, layers.contours, tone.contour, 0.8);
      stroke(g, layers.contoursMajor, tone.contourMajor, 0.9);

      // water: flat ground, fine horizontal hatching, a hairline shore
      trace(g, layers.water);
      g.fillStyle = tone.water;
      g.fill('nonzero');
      g.save();
      g.clip('nonzero');
      g.fillStyle = tone.hatch;
      for (var y = 0.5; y < H; y += 4) g.fillRect(0, Math.round(y), W, 1);
      g.restore();
      stroke(g, layers.shore, tone.shore, 1);
      stroke(g, streams, tone.shore, 0.7);

      stroke(g, layers.bounds, tone.bound, 0.8, [1, 4]);
      var roads = layers.roads;
      if (view.tilePx >= 330) stroke(g, roads.n || [], tone.n, 0.7);
      stroke(g, roads.e || [], tone.e, 0.9);
      stroke(g, roads.s || [], tone.s, 1);
      stroke(g, roads.r || [], tone.r, 0.9, [5, 4]);
      stroke(g, roads.p || [], tone.p, 1.15);
      stroke(g, roads.t || [], tone.t, 1.3);
      stroke(g, roads.m || [], tone.m, 1.5);
      g.setLineDash([]);

      drawRiverNames(g, tone);
      drawPlaces(g, tone);
      drawFrame(g, tone);

      // The map steps back where the text stands.
      var shade;
      if (view.narrow) {
        shade = g.createLinearGradient(0, view.zone - 80, 0, view.mapBottom);
        shade.addColorStop(0, 'rgba(5,5,5,0)');
        shade.addColorStop(1, 'rgba(5,5,5,1)');
        g.fillStyle = shade;
        g.fillRect(0, view.zone - 80, W, H - view.zone + 80);
      } else {
        shade = g.createLinearGradient(0, 0, W * 0.64, 0);
        shade.addColorStop(0, 'rgba(5,5,5,0.9)');
        shade.addColorStop(0.5, 'rgba(5,5,5,0.72)');
        shade.addColorStop(1, 'rgba(5,5,5,0)');
        g.fillStyle = shade;
        g.fillRect(0, 0, W, H);
        shade = g.createLinearGradient(0, H * 0.7, 0, H);
        shade.addColorStop(0, 'rgba(5,5,5,0)');
        shade.addColorStop(1, 'rgba(5,5,5,0.8)');
        g.fillStyle = shade;
        g.fillRect(0, 0, W, H);
      }
    }

    function render() {
      computeView();
      canvas.width = Math.round(view.W * view.dpr);
      canvas.height = Math.round(view.H * view.dpr);
      paint(rest, TONE_REST);
      paint(lit, TONE_LIT);
      draw(clock);
    }

    function corners(x, y, half, arm, alpha) {
      var a = Math.round(x - half) + 0.5;
      var b = Math.round(y - half) + 0.5;
      var c = Math.round(x + half) + 0.5;
      var d = Math.round(y + half) + 0.5;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = FG;
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(a, b + arm);
      ctx.lineTo(a, b);
      ctx.lineTo(a + arm, b);
      ctx.moveTo(c - arm, b);
      ctx.lineTo(c, b);
      ctx.lineTo(c, b + arm);
      ctx.moveTo(c, d - arm);
      ctx.lineTo(c, d);
      ctx.lineTo(c - arm, d);
      ctx.moveTo(a + arm, d);
      ctx.lineTo(a, d);
      ctx.lineTo(a, d - arm);
      ctx.stroke();
      ctx.fillStyle = FG;
      ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    }

    function labelLines(target) {
      var first = (texts.alert ? texts.alert + ' · ' : '') + (texts.targets[target.t] || '');
      var second = view.compact ? '' : target.mgrs + ' · ' + (texts.sources[target.s] || '');
      return [first, second];
    }

    /**
     * Where the label of a marker goes: to the right, to the left, underneath or above — the first place
     * that lies inside the picture and clear of the text. Null when there is none; the marker then stands alone.
     */
    function labelBox(g, target, half) {
      var size = view.compact ? 10 : 11;
      var spacing = view.compact ? 0.8 : 1.3;
      var lines = labelLines(target);
      g.font = '500 ' + size + 'px ' + FONT;
      var width = Math.max(spacedWidth(g, lines[0], spacing), lines[1] ? spacedWidth(g, lines[1], spacing) : 0);
      var height = lines[1] ? 32 : 16;
      var gap = 16;
      var edge = view.narrow ? 12 : 74; // the right edge carries the frame labels
      var floor = view.narrow ? view.zone - 12 : view.H - 12;
      var centred = Math.min(Math.max(10, target.x - width / 2), view.W - width - 10);
      var options = [
        { x: target.x + half + gap, y: target.y - half - 1, side: 1 },
        { x: target.x - half - gap - width, y: target.y - half - 1, side: -1 },
        { x: centred, y: target.y + half + 12, side: 0 },
        { x: centred, y: target.y - half - 14 - height, side: 0 },
      ];
      for (var i = 0; i < options.length; i++) {
        var o = options[i];
        if (o.x < 10 || o.x + width + (o.side > 0 ? edge : 10) > view.W) continue;
        if (o.y < 14 || o.y + height > floor) continue;
        if (overText([o.x - 8, o.y - 6, o.x + width + 8, o.y + height + 6])) continue;
        return { x: o.x, y: o.y, width: width, height: height, side: o.side, size: size, spacing: spacing, lines: lines };
      }
      return null;
    }

    function label(target, half, typed, alpha) {
      var box = labelBox(ctx, target, half);
      if (!box) return;
      var x = box.x;
      var y = box.y;
      ctx.font = '500 ' + box.size + 'px ' + FONT;
      // Beside or under the marker the plate grows with the text; on the left it is laid out at once,
      // so the line keeps its place while it is being set.
      var advance = ctx.measureText('M').width + box.spacing;
      var typedSecond = Math.max(0, typed - box.lines[0].length);
      var plate = box.width;
      var plateHeight = box.height;
      if (box.side >= 0) {
        plate = Math.min(box.width, Math.max(Math.min(typed, box.lines[0].length), Math.min(typedSecond, box.lines[1].length)) * advance);
        plateHeight = typedSecond > 0 ? box.height : 16;
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = BG;
      ctx.fillRect(Math.round(x) - 6, Math.round(y) - 4, Math.round(plate) + 12, plateHeight + 6);
      if (box.side !== 0) {
        ctx.strokeStyle = FG;
        ctx.lineWidth = 1;
        ctx.beginPath();
        var ly = Math.round(target.y - half) + 0.5;
        if (box.side > 0) {
          ctx.moveTo(Math.round(target.x + half) + 0.5, ly);
          ctx.lineTo(Math.round(x) - 6, ly);
        } else {
          ctx.moveTo(Math.round(target.x - half) + 0.5, ly);
          ctx.lineTo(Math.round(x + box.width) + 6, ly);
        }
        ctx.stroke();
      }
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = FG;
      spaced(ctx, box.lines[0].slice(0, typed), Math.round(x), Math.round(y) + box.size, box.spacing);
      if (box.lines[1] && typedSecond > 0) {
        ctx.font = '400 ' + box.size + 'px ' + FONT;
        ctx.fillStyle = MID;
        spaced(ctx, box.lines[1].slice(0, typedSecond), Math.round(x), Math.round(y) + box.size + 15, box.spacing);
      }
    }

    /** One frame. `time` is null for the still picture shown when motion is reduced. */
    function draw(time) {
      var W = view.W;
      var H = view.H;
      var dpr = view.dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.drawImage(rest, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      var still = time === null;
      var phase = still ? 0 : time % CYCLE;

      if (!still && phase < SWEEP) {
        var sx = (phase / SWEEP) * 1.08 * W - 0.04 * W;
        var slices = 14;
        var slice = Math.max(8, Math.round(W / 110));
        for (var i = 0; i < slices; i++) {
          var x0 = sx - (i + 1) * slice;
          var x1 = x0 + slice;
          if (x1 <= 0 || x0 >= W) continue;
          var cx = Math.max(0, x0);
          var cw = Math.min(W, x1) - cx;
          ctx.globalAlpha = 0.95 * Math.pow(1 - i / slices, 1.6);
          ctx.drawImage(lit, cx * dpr, 0, cw * dpr, H * dpr, cx, 0, cw, H);
        }
        if (sx >= 0 && sx <= W) {
          ctx.globalAlpha = 0.5;
          ctx.fillStyle = FG;
          ctx.fillRect(Math.round(sx), 0, 1, view.mapBottom);
        }
      }

      if (pointer.active) {
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = FG;
        ctx.fillRect(0, Math.round(pointer.y), W, 1);
        ctx.fillRect(Math.round(pointer.x), 0, 1, H);
      }

      for (var n = 0; n < targets.length; n++) {
        var target = targets[n];
        if (!shown(target)) continue;
        var age;
        if (still) age = HOLD / 2;
        else {
          if (time < target.lockAt) continue;
          age = (((time - target.lockAt) % CYCLE) + CYCLE) % CYCLE;
          if (age > HOLD) continue;
        }
        var settle = Math.min(1, age / 0.55);
        var eased = 1 - Math.pow(1 - settle, 3);
        var half = 38 - 23 * eased;
        var alpha = Math.min(1, age / 0.12) * Math.min(1, (HOLD - age) / 0.6);
        corners(target.x, target.y, half, 7, alpha);
        var typed = still ? 999 : Math.floor((age - 0.4) / 0.02);
        if (typed > 0) label(target, 15, typed, alpha);
      }
      ctx.globalAlpha = 1;
    }

    // ---- clock: runs only while the hero is on screen and the tab is visible

    var clock = reduceMotion.matches ? null : 0;
    var last = 0;
    var frame = 0;
    var onScreen = true;

    function tick(now) {
      frame = 0;
      if (clock === null) return;
      if (last) clock += Math.min(0.1, (now - last) / 1000);
      last = now;
      draw(clock);
      schedule();
    }

    function schedule() {
      if (frame || clock === null || !onScreen || doc.hidden) return;
      frame = window.requestAnimationFrame(tick);
    }

    function pause() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    }

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        onScreen = entries[entries.length - 1].isIntersecting;
        if (onScreen) schedule();
        else pause();
      }).observe(hero);
    }
    doc.addEventListener('visibilitychange', function () {
      if (doc.hidden) pause();
      else schedule();
    });

    var onMotionChange = function () {
      pause();
      clock = reduceMotion.matches ? null : 0;
      draw(clock);
      schedule();
    };
    if (reduceMotion.addEventListener) reduceMotion.addEventListener('change', onMotionChange);
    else if (reduceMotion.addListener) reduceMotion.addListener(onMotionChange);

    // ---- size

    var resizeTimer = 0;
    function onResize() {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(function () {
        var rect = hero.getBoundingClientRect();
        if (Math.round(rect.width) === view.W && Math.round(rect.height) === view.H) return;
        render();
      }, 120);
    }
    if ('ResizeObserver' in window) new ResizeObserver(onResize).observe(hero);
    else window.addEventListener('resize', onResize);

    // ---- grid reference under the pointer

    var home = toMgrs(FOCUS.lat, FOCUS.lon);
    if (readout) readout.textContent = home;

    hero.addEventListener('pointermove', function (event) {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      var rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left;
      pointer.y = event.clientY - rect.top;
      pointer.active = true;
      if (readout) {
        var geo = toGeo((pointer.x - view.ox) / view.k, (pointer.y - view.oy) / view.k);
        readout.textContent = toMgrs(geo[0], geo[1]);
      }
      if (clock === null) draw(null);
    });
    hero.addEventListener('pointerleave', function () {
      pointer.active = false;
      if (readout) readout.textContent = home;
      if (clock === null) draw(null);
    });

    render();
    schedule();
    if (doc.fonts && doc.fonts.load) {
      Promise.all([doc.fonts.load('500 11px "JetBrains Mono"'), doc.fonts.load('400 11px "JetBrains Mono"')]).then(render, function () {});
    }

    return {
      setLanguage: function (next) {
        texts = (window.SICHT_MAP_TEXT || {})[next] || texts;
        render();
      },
    };
  }

  var heroMap = initHero();
  if (heroMap) onLanguage.push(heroMap.setLanguage);

  var first = initialLanguage();
  if (first !== 'de') applyLanguage(first);
})();

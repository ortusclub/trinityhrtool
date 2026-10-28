/* =========================================================================
   sync.js — keeps the payroll in TrinityHR's database so every admin sees
   and edits the same data. Loads the shared copy into this browser's
   storage, then starts app.js; afterwards every save is sent back.

   The first browser to open Payroll after the switch uploads what it has.
   Timesheets are stored one person per cutoff, so two admins editing
   different people never overwrite each other. Someone else's changes show
   after a reload.
   ========================================================================= */
(function (global) {
  'use strict';

  var API = '/api/payroll/state';
  var KEYS = global.PayrollData.Store.KEYS;
  var WHOLE = {};   // storage key → server key, saved as one value
  WHOLE[KEYS.employees] = 'employees';
  WHOLE[KEYS.settings] = 'settings';
  WHOLE[KEYS.holidays] = 'holidays';
  var DTR_KEY = /^[^|]{1,40}\|[^|]{1,100}$/;

  var shared = false;
  var sent = {};      // server key → JSON last saved
  var pending = {};   // storage key → value waiting to be sent
  var timer = null, busy = false, failedOnce = false;

  /* ------------------------------ badge ------------------------------ */
  var badge = document.createElement('div');
  badge.id = 'syncStatus';
  badge.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:9999;padding:6px 12px;' +
    'border-radius:999px;font:12px/1.4 system-ui,sans-serif;box-shadow:0 1px 4px rgba(0,0,0,.15);' +
    'background:#eef2ff;color:#3730a3;max-width:420px';
  function status(text, bad) {
    badge.textContent = text;
    badge.style.background = bad ? '#fee2e2' : '#eef2ff';
    badge.style.color = bad ? '#991b1b' : '#3730a3';
    if (!badge.parentNode && document.body) document.body.appendChild(badge);
  }

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function write(key, value) {
    if (value === undefined || value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  }

  /* Server rows for one storage value, plus the rows it no longer has. */
  function diff(storageKey, value) {
    var set = {}, remove = [];
    if (WHOLE[storageKey]) {
      var k = WHOLE[storageKey], json = JSON.stringify(value);
      if (sent[k] !== json) set[k] = value;
    } else if (storageKey === KEYS.dtr) {
      var dtr = value || {}, seen = {};
      Object.keys(dtr).forEach(function (id) {
        if (!DTR_KEY.test(id)) return;
        var sk = 'dtr|' + id;
        seen[sk] = true;
        if (sent[sk] !== JSON.stringify(dtr[id])) set[sk] = dtr[id];
      });
      Object.keys(sent).forEach(function (sk) {
        if (sk.indexOf('dtr|') === 0 && !seen[sk]) remove.push(sk);
      });
    }
    return { set: set, remove: remove };
  }

  /* Sends in pieces well under the 4.5 MB request limit. */
  function put(set, remove, seed) {
    var batches = [], cur = {}, size = 0;
    Object.keys(set).forEach(function (k) {
      var n = JSON.stringify(set[k]).length + k.length;
      if (size && size + n > 1500000) { batches.push(cur); cur = {}; size = 0; }
      cur[k] = set[k]; size += n;
    });
    batches.push(cur);
    return batches.reduce(function (p, b, i) {
      return p.then(function () {
        return fetch(API, {
          method: 'PUT', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ set: b, remove: i === 0 ? remove : [], seed: !!seed })
        }).then(function (r) {
          if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) {
            throw new Error(j.error || ('HTTP ' + r.status));
          });
          Object.keys(b).forEach(function (k) { sent[k] = JSON.stringify(b[k]); });
          if (i === 0) remove.forEach(function (k) { delete sent[k]; });
        });
      });
    }, Promise.resolve());
  }

  function flush() {
    timer = null;
    if (busy) { schedule(); return; }
    var keys = Object.keys(pending);
    if (!keys.length) return;
    var set = {}, remove = [];
    keys.forEach(function (sk) {
      var d = diff(sk, pending[sk]);
      Object.keys(d.set).forEach(function (k) { set[k] = d.set[k]; });
      remove = remove.concat(d.remove);
    });
    pending = {};
    if (!Object.keys(set).length && !remove.length) return;
    busy = true;
    status('Saving…');
    put(set, remove).then(function () {
      busy = false; failedOnce = false;
      status('Saved for all admins');
    }, function (e) {
      busy = false; failedOnce = true;
      // Try again with whatever is in storage now.
      keys.forEach(function (sk) { if (!(sk in pending)) pending[sk] = read(sk); });
      status('Not saved for other admins yet (' + e.message + '). Retrying…', true);
      timer = setTimeout(flush, 10000);
    });
  }
  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, failedOnce ? 10000 : 700);
  }

  /* Called by data.js after every save to this browser's storage. */
  function changed(storageKey, value) {
    if (!shared || !(WHOLE[storageKey] || storageKey === KEYS.dtr)) return;
    pending[storageKey] = value;
    schedule();
  }

  function startApp() {
    var s = document.createElement('script');
    s.src = 'app.js';
    document.body.appendChild(s);
  }

  function load() {
    return fetch(API, { credentials: 'same-origin', cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  /* Everything this browser has, as server rows — for the first upload. */
  function localRows() {
    var set = {};
    Object.keys(WHOLE).forEach(function (sk) {
      var v = read(sk);
      if (v !== null) set[WHOLE[sk]] = v;
    });
    var dtr = read(KEYS.dtr) || {};
    Object.keys(dtr).forEach(function (id) { if (DTR_KEY.test(id)) set['dtr|' + id] = dtr[id]; });
    return set;
  }

  function adopt(rows) {
    var dtr = {};
    Object.keys(rows).forEach(function (k) {
      sent[k] = JSON.stringify(rows[k]);
      if (k.indexOf('dtr|') === 0) dtr[k.slice(4)] = rows[k];
    });
    Object.keys(WHOLE).forEach(function (sk) { write(sk, rows[WHOLE[sk]]); });
    write(KEYS.dtr, dtr);
  }

  function boot() {
    status('Loading the shared payroll…');
    load().then(function (res) {
      if (res.disabled) {
        status('Shared saving is not switched on yet — this payroll is only in this browser.', true);
        return;
      }
      if (res.rows && res.rows.employees) return res.rows;
      var mine = localRows();
      if (!mine.employees) return res.rows || {};
      status('Uploading this browser\'s payroll for all admins…');
      return put(mine, [], true).then(load).then(function (again) { return again.rows || {}; });
    }).then(function (rows) {
      if (rows) {
        adopt(rows);
        shared = true;
        status('Shared with all admins');
      }
    }, function (e) {
      status('Could not load the shared payroll (' + e.message + '). Reload to try again; ' +
        'until then this shows only what is in this browser and changes are not shared.', true);
    }).then(startApp);
  }

  // A last try at sending edits when the page is closed.
  global.addEventListener('pagehide', function () {
    if (!shared || !Object.keys(pending).length) return;
    var set = {}, remove = [];
    Object.keys(pending).forEach(function (sk) {
      var d = diff(sk, pending[sk]);
      Object.keys(d.set).forEach(function (k) { set[k] = d.set[k]; });
      remove = remove.concat(d.remove);
    });
    var body = JSON.stringify({ set: set, remove: remove });
    if (body.length < 60000) {
      fetch(API, { method: 'PUT', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body: body });
    }
  });

  global.PayrollSync = { changed: changed };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);

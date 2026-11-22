/* =========================================================================
   nonph.js — the Non-PH payroll (Kosovo, Italy, the US, the UAE, South
   Korea … and Non-Trinity staff based in the Philippines).

   Shares the roster, storage and payslip uploads with app.js (through
   window.PayrollApp) but never its figures: each person's Non-PH rate,
   currency and rules live under emp.np, the month's entries under
   state.dtr['NP-YYYY-MM|<id>'], and the rules under settings.nonph.

   Monthly, paid on the 25th (the Friday before when that is a weekend).
   XK (Kosovo): 5% + 5% pension and Kosovo withholding tax, in EUR, as the
   XK payslip template. No-Tax (everyone else): no deductions, in the
   person's currency, as the No-Tax template.
   ========================================================================= */
(function () {
  'use strict';

  var P = window.PayrollApp;
  if (!P) return;
  var state = P.state, E = P.E, Store = P.Store, $ = P.$, $$ = P.$$, esc = P.esc, plain = P.plain;
  var MONTHS = P.MONTHS;

  var COUNTRY = { XK: 'Kosovo', IT: 'Italy', AE: 'UAE', US: 'United States', KR: 'South Korea', PH: 'Philippines' };
  var HOLIDAY_COUNTRIES = ['XK', 'IT', 'AE', 'US', 'KR', 'PH'];
  var DEFAULTS = {
    pensionEE: 5, pensionER: 5, band1: 250, band2: 450, rate2: 8, rate3: 10, secondaryRate: 10,
    payoutDay: 25, companyKosovo: 'Ortus Strategy Kosovo Branch', companyOther: 'Ortus Strategy Pte Ltd', address: '',
    paid: {}, holidays: {}
  };

  function cfg() {
    var s = state.settings.nonph = state.settings.nonph || {};
    Object.keys(DEFAULTS).forEach(function (k) {
      if (s[k] === undefined || s[k] === null || s[k] === '') s[k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
    });
    return s;
  }
  function saveCfg() { Store.saveSettings(state.settings); }
  function saveEmps() { Store.saveEmployees(state.employees); }
  function saveDtr() { Store.saveDtr(state.dtr); }

  var r2 = function (n) { return E.r2(n); };
  var num = function (v) { return E.num(v); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function amount(v) { var t = String(v === undefined || v === null ? '' : v).replace(/[^0-9.\-]/g, ''); return t === '' ? 0 : r2(num(t)); }
  function money(n, cur) { return P.psMoney(n || 0, cur || 'EUR'); }
  function nameOf(e) { return (e.lastName || '') + ', ' + (e.firstName || ''); }

  /* ------------------------------ the people ------------------------------ */
  var accountCountry = {};   // work email → country code from TrinityHR
  var countriesLoaded = false;
  function loadCountries() {
    if (countriesLoaded) return;
    countriesLoaded = 'loading';
    P.psApi('countries').then(function (d) {
      (d.people || []).forEach(function (p) { accountCountry[p.email] = p.country; });
      countriesLoaded = true;
      render();
    }, function () { countriesLoaded = true; });
  }

  function np(emp) { return emp.np || {}; }
  function setNp(emp, key, value) {
    emp.np = emp.np || {};
    if (value === '' || value === null || value === undefined) delete emp.np[key];
    else emp.np[key] = value;
  }
  function countryOf(emp) {
    return np(emp).country || accountCountry[String(emp.email || '').trim().toLowerCase()] || '';
  }
  /* Set per person; else as their latest upload was paid (so someone paid
     No-Tax keeps being paid No-Tax); else Kosovo → XK, anyone else No-Tax. */
  function ruleOf(emp) { return np(emp).rule || lastKind[emp.id] || (countryOf(emp) === 'XK' ? 'xk' : 'notax'); }
  function currencyOf(emp) {
    if (ruleOf(emp) === 'xk') return 'EUR';
    var c = np(emp).currency;
    if (c) return c;
    var k = countryOf(emp);
    return k === 'PH' ? 'PHP' : k === 'US' ? 'USD' : k === 'XK' || k === 'IT' ? 'EUR' : '';
  }
  function people() { return state.employees.filter(function (e) { return !P.isPhPayroll(e); }); }

  /* ------------------------------ the month ------------------------------ */
  var view = { year: state.year, month: new Date().getMonth(), tab: 'run' };
  function monthId(y, m) { return 'NP-' + y + '-' + pad(m + 1); }
  function monthRange(y, m) {
    return { start: y + '-' + pad(m + 1) + '-01', end: y + '-' + pad(m + 1) + '-' + pad(new Date(y, m + 1, 0).getDate()) };
  }
  function payoutOf(y, m) {
    var day = Math.min(Math.max(1, num(cfg().payoutDay) || 25), new Date(y, m + 1, 0).getDate());
    var d = new Date(y, m, day);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return ymd(d);
  }
  function entry(id, y, m) { return state.dtr[monthId(y, m) + '|' + id] || {}; }
  function setEntry(id, y, m, key, value) {
    var k = monthId(y, m) + '|' + id, d = state.dtr[k] || {};
    if (value === '' || value === 0 || value === null || value === undefined || value === false) delete d[key];
    else d[key] = value;
    if (Object.keys(d).length) state.dtr[k] = d; else delete state.dtr[k];
    saveDtr();
  }
  function isPaid(y, m) { return !!cfg().paid[monthId(y, m)]; }

  /* ------------------------------ holidays ------------------------------ */
  var holSync = { done: {}, error: '' };
  function holidays(y) { return cfg().holidays[y] || []; }
  function syncHolidays(y) {
    if (holSync.done[y]) return;
    holSync.done[y] = 'loading';
    P.psApi('holidays?year=' + y + '&country=' + HOLIDAY_COUNTRIES.join(',')).then(function (d) {
      holSync.done[y] = true; holSync.error = '';
      var list = (d.holidays || []).map(function (h) { return { date: h.date, name: h.name, country: h.country }; });
      if (JSON.stringify(list) !== JSON.stringify(holidays(y))) { cfg().holidays[y] = list; saveCfg(); }
      render();
    }, function (e) { holSync.done[y] = false; holSync.error = e.message; render(); });
  }
  function holidaySet(y, country) {
    var s = {};
    holidays(y).forEach(function (h) { if (h.country === country) s[h.date] = h.name; });
    return s;
  }
  /** Weekdays of the month that are not the country's holidays. */
  function workingDays(y, m, country) {
    var hol = holidaySet(y, country), out = [], last = new Date(y, m + 1, 0).getDate();
    for (var d = 1; d <= last; d++) {
      var dt = new Date(y, m, d), day = dt.getDay();
      if (day !== 0 && day !== 6 && !hol[ymd(dt)]) out.push(ymd(dt));
    }
    return out;
  }

  /* ------------------------------ the maths ------------------------------ */
  function onStaffMonth(emp, y, m) {
    var r = monthRange(y, m), hired = String(emp.dateHired || ''), left = String(emp.endDate || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(hired) && hired > r.end) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(left) && left < r.start) return false;
    return true;
  }

  function kosovoTax(base, secondary) {
    var c = cfg();
    if (base <= 0) return 0;
    if (secondary) return r2(base * num(c.secondaryRate) / 100);
    var b1 = num(c.band1), b2 = num(c.band2);
    if (base <= b1) return 0;
    if (base <= b2) return r2((base - b1) * num(c.rate2) / 100);
    return r2((b2 - b1) * num(c.rate2) / 100 + (base - b2) * num(c.rate3) / 100);
  }

  function compute(emp, y, m) {
    var c = cfg(), n = np(emp), en = entry(emp.id, y, m);
    var rate = num(n.rate), country = countryOf(emp), rule = ruleOf(emp), cur = currencyOf(emp);
    var wd = workingDays(y, m, country);
    var hired = String(emp.dateHired || ''), left = String(emp.endDate || '');
    var staff = wd.filter(function (d) { return !(hired && d < hired) && !(left && d > left); }).length;
    var full = staff === wd.length;
    var basic = en.gross !== undefined ? num(en.gross) : P.isPhPayroll(emp) ? 0 : full ? rate : wd.length ? r2(rate * staff / wd.length) : 0;
    var comm = num(en.commission), bonus = num(en.bonus), leave = num(en.leavePay), reimb = num(en.reimb), ded = num(en.deduction);
    var tg = r2(basic + comm + bonus + leave - ded);
    var x = { emp: emp, rate: rate, country: country, rule: rule, currency: cur, workDays: wd.length, staffDays: staff,
      prorated: !full && en.gross === undefined, basic: basic, commission: comm, bonus: bonus, leavePay: leave,
      reimb: reimb, deduction: ded, totalGross: tg, ee: 0, er: 0, taxable: tg, tax: 0, entry: en };
    if (rule === 'xk') {
      var foreign = n.taxStatus === 'Foreign';
      x.ee = foreign ? 0 : r2(tg * num(c.pensionEE) / 100);
      x.er = foreign ? 0 : r2(tg * num(c.pensionER) / 100);
      x.taxable = r2(tg - x.ee);
      x.tax = kosovoTax(x.taxable, n.employer === 'Secondary');
    }
    x.net = r2(tg - x.ee - x.tax + reimb);
    x.cost = r2(tg + x.er + reimb);
    return x;
  }

  /* ---------------- months already paid through an upload ----------------
     The No-Tax / XK batches on the Payslip tab are the record of what was
     paid: a month with one shows those payslips, as paid, and only the
     people in them — like an imported PH cutoff. A blank Non-PH rate or
     currency is filled from the latest one. */
  var imp = { loaded: {}, months: {}, error: '' };
  function batchMonth(b) {
    var lm = String(b.label || '').match(/^([A-Za-z]+) (\d{4})$/), mi = lm ? MONTHS.indexOf(lm[1]) : -1;
    if (mi >= 0) return { y: +lm[2], m: mi };
    var p = String(b.payout_date || '');
    return /^\d{4}-\d{2}/.test(p) ? { y: +p.slice(0, 4), m: +p.slice(5, 7) - 1 } : null;
  }
  var key = function (v) {
    return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  };
  function matchEmp(slip) {
    var em = String(slip.email || '').trim().toLowerCase(), code = String(slip.code || '').trim(), nk = key(slip.name);
    var all = state.employees;
    return all.filter(function (e) { return em && String(e.email || '').trim().toLowerCase() === em; })[0] ||
      all.filter(function (e) { return code && String(e.id).trim() === code; })[0] ||
      all.filter(function (e) {
        return nk && (key((e.firstName || '') + ' ' + (e.lastName || '')) === nk || key((e.preferredName || '') + ' ' + (e.lastName || '')) === nk);
      })[0] || null;
  }
  function fromSlip(emp, slip, kind, batch) {
    var x = { emp: emp, rate: num(np(emp).rate), country: countryOf(emp), rule: kind, currency: slip.currency || 'EUR',
      workDays: 0, staffDays: 0, prorated: false, basic: 0, commission: 0, bonus: 0, leavePay: 0, reimb: 0, deduction: 0,
      ee: 0, er: 0, tax: 0, entry: {}, imported: batch };
    var bonusDesc = [], commDesc = [], dedDesc = [];
    (slip.earnings || []).forEach(function (l) {
      var a = num(l.amount), lab = String(l.label || '');
      if (l.kind === 'sub') { commDesc.push(lab); return; }
      if (/^(gross )?salary\b/i.test(lab)) x.basic = r2(x.basic + a);
      else if (/^commission/i.test(lab)) x.commission = r2(x.commission + a);
      else if (/reimburse/i.test(lab)) x.reimb = r2(x.reimb + a);
      else { x.bonus = r2(x.bonus + a); bonusDesc.push(lab.replace(/^Bonus\s*–\s*/, '')); }
    });
    (slip.deductions || []).forEach(function (l) {
      var a = num(l.amount), lab = String(l.label || '');
      if (/pension/i.test(lab)) x.ee = r2(x.ee + a);
      else if (/withholding tax/i.test(lab)) x.tax = r2(x.tax + a);
      else { x.deduction = r2(x.deduction + a); dedDesc.push(lab); }
    });
    if (kind === 'xk') x.er = x.ee;
    x.entry = { commissionDetails: commDesc.join('; '), bonusDesc: bonusDesc.join('; '), deductionDesc: dedDesc.join('; ') };
    x.totalGross = r2(x.basic + x.commission + x.bonus - x.deduction);
    x.taxable = r2(x.totalGross - x.ee);
    x.net = num(slip.net_pay);
    x.cost = r2(x.totalGross + x.er + x.reimb);
    return x;
  }
  function loadImported(y) {
    if (imp.loaded[y]) return;
    imp.loaded[y] = 'loading';
    P.psApi('payslips').then(function (d) {
      var bs = (d.batches || []).filter(function (b) {
        var bm = /^(notax|xk)-/.test(b.id) ? batchMonth(b) : null;
        return bm && bm.y === y;
      });
      return Promise.all(bs.map(function (b) {
        return P.psApi('payslips?batch=' + encodeURIComponent(b.id)).then(function (r) { return { b: b, r: r }; });
      }));
    }).then(function (list) {
      Object.keys(imp.months).forEach(function (k) { if (k.indexOf('NP-' + y + '-') === 0) delete imp.months[k]; });
      list.forEach(function (it) {
        var bm = batchMonth(it.b), id = monthId(bm.y, bm.m), kind = it.b.id.indexOf('xk-') === 0 ? 'xk' : 'notax';
        var mo = imp.months[id] = imp.months[id] || { batches: [], slips: [], payout: it.b.payout_date };
        mo.batches.push({ id: it.b.id, published: !!it.b.published_at, count: it.r.payslips.length });
        (it.r.payslips || []).forEach(function (sl) { mo.slips.push({ slip: sl, kind: kind, batch: it.b.id }); });
      });
      imp.loaded[y] = true;
      imp.error = '';
      fillFromImports();
      render();
    }, function (e) { imp.loaded[y] = false; imp.error = e.message; render(); });
  }
  /** Blank Non-PH rates and currencies from the newest uploaded month. */
  var filledNotice = [], lastKind = {};
  /* PH staff (salary through Trinity) whose commission is paid here: in the
     newest upload with no salary. They stay PH and show on the Non-PH run
     as commission-only rows. */
  var commissionOnly = {};
  function fillFromImports() {
    var ids = Object.keys(imp.months).sort(), seen = {}, changed = false;
    ids.reverse().forEach(function (id) {
      imp.months[id].slips.forEach(function (it) {
        var e = matchEmp(it.slip);
        if (!e || seen[e.id]) return;
        seen[e.id] = true;
        lastKind[e.id] = it.kind;
        var x = fromSlip(e, it.slip, it.kind, it.batch);
        if (P.isPhPayroll(e)) {
          if (!x.basic) {
            commissionOnly[e.id] = true;
            if (!np(e).currency && x.currency) { setNp(e, 'currency', x.currency); changed = true; }
          }
          return;
        }
        if (!(num(np(e).rate) > 0) && x.basic > 0) {
          setNp(e, 'rate', x.basic); changed = true;
          filledNotice.push(nameOf(e) + ': ' + plain(x.basic) + ' ' + x.currency + ' (' + it.batch + ')');
        }
        if (!np(e).currency && x.currency && it.kind !== 'xk') { setNp(e, 'currency', x.currency); changed = true; }
      });
    });
    if (changed) saveEmps();
  }
  function importedMonth(y, m) { return imp.months[monthId(y, m)] || null; }

  function runFor(y, m) {
    var mo = importedMonth(y, m);
    if (mo) {
      var rows = [], unmatched = [], phSide = [];
      mo.slips.forEach(function (it) {
        var e = matchEmp(it.slip);
        if (!e) { unmatched.push(it.slip.name || it.slip.email); return; }
        var x = fromSlip(e, it.slip, it.kind, it.batch);
        if (P.isPhPayroll(e)) { x.commissionOnly = !x.basic; if (x.basic) phSide.push(nameOf(e)); }
        rows.push(x);
      });
      rows.sort(function (a, b) { return nameOf(a.emp).localeCompare(nameOf(b.emp)); });
      return { rows: rows, noRate: [], imported: mo, unmatched: unmatched, phSide: phSide };
    }
    var on = people().filter(function (e) { return onStaffMonth(e, y, m); });
    var comm = state.employees.filter(function (e) { return commissionOnly[e.id] && P.isPhPayroll(e) && onStaffMonth(e, y, m); })
      .map(function (e) { var x = compute(e, y, m); x.commissionOnly = true; return x; });
    return {
      rows: on.filter(function (e) { return num(np(e).rate) > 0; }).map(function (e) { return compute(e, y, m); }).concat(comm)
        .sort(function (a, b) { return nameOf(a.emp).localeCompare(nameOf(b.emp)); }),
      noRate: on.filter(function (e) { return !(num(np(e).rate) > 0); })
    };
  }

  function byCurrency(rows, key) {
    var t = {};
    rows.forEach(function (x) { var c = x.currency || '?'; t[c] = r2((t[c] || 0) + x[key]); });
    return Object.keys(t).sort().map(function (c) { return c === '?' ? plain(t[c]) + ' (no currency)' : money(t[c], c); }).join(' · ') || '—';
  }

  /* ------------------------------ scope + tabs ------------------------------ */
  var scope = 'ph', phTab = 'run';
  var movedHome = null;   // where the shared payslip cards sit on the PH side
  function setScope(next) {
    scope = next === 'nonph' ? 'nonph' : 'ph';
    try { localStorage.setItem('phpayroll.scope', scope); } catch { /* private window */ }
    $$('#scopeBar .scope').forEach(function (b) { b.classList.toggle('active', b.dataset.scope === scope); });
    $('#tabs').classList.toggle('hidden', scope !== 'ph');
    $('#npTabs').classList.toggle('hidden', scope !== 'nonph');
    $('#scopeSub').textContent = scope === 'ph'
      ? 'Philippine semi-monthly payroll · paid every 10th & 25th'
      : 'Non-PH monthly payroll · Kosovo, Italy, US, UAE, South Korea · paid on the 25th';
    if (scope === 'ph') {
      $$('.np-panel').forEach(function (p) { p.classList.add('hidden'); });
      putCardsBack();
      P.switchTab(phTab);
    } else {
      $$('main > section.panel:not(.np-panel)').forEach(function (p) { p.classList.add('hidden'); });
      showTab(view.tab);
    }
  }
  function showTab(name) {
    view.tab = name;
    $$('#npTabs .tab').forEach(function (t) { t.classList.toggle('active', t.dataset.npTab === name); });
    $$('.np-panel').forEach(function (p) { p.classList.toggle('hidden', p.id !== 'np-' + name); });
    if (name === 'payslip') pullCardsIn(); else putCardsBack();
    render();
  }
  function pullCardsIn() {
    var box = $('#npPsMoved');
    ['#psBatchesCard', '#psUploadCard', '#psWiseCard'].forEach(function (s) { box.appendChild($(s)); });
    P.wiseShowSummary();
    P.psLoadBatches();
  }
  function putCardsBack() {
    if (!movedHome || $('#psUploadCard').parentNode === movedHome.parent) return;
    movedHome.parent.insertBefore($('#psUploadCard'), movedHome.next);
    movedHome.parent.insertBefore($('#psWiseCard'), movedHome.next);
    movedHome.parent.insertBefore($('#psBatchesCard'), movedHome.next);
  }

  function render() {
    if (scope !== 'nonph') return;
    loadCountries();
    syncHolidays(view.year);
    loadImported(view.year);
    ({ run: renderRun, finalpay: renderFinal, employees: renderEmployees, holidays: renderHolidays,
       contrib: renderContrib, payslip: renderPayslip, settings: renderSettings, process: function () {} })[view.tab]();
  }

  function fillMonthSelect(sel, value) {
    sel.innerHTML = MONTHS.map(function (n, i) { return '<option value="' + i + '">' + n + ' ' + view.year + '</option>'; }).join('');
    sel.value = String(value);
  }

  /* ------------------------------ Payroll Run ------------------------------ */
  function stat(k, v, n, cls) {
    return '<div class="stat ' + (cls || '') + '"><div class="k">' + esc(k) + '</div><div class="v" style="font-size:17px">' + v +
      '</div><div class="n">' + esc(n) + '</div></div>';
  }

  function renderRun() {
    var y = view.year, m = view.month, run = runFor(y, m), paid = isPaid(y, m) || !!run.imported;
    var payout = run.imported ? run.imported.payout : payoutOf(y, m);
    fillMonthSelect($('#npMonth'), m);
    var r = monthRange(y, m);
    $('#npMeta').innerHTML = esc(MONTHS[m] + ' ' + y) + ' &middot; Payout <strong>' + esc(P.psDay(payout)) + '</strong> &middot; ' +
      run.rows.length + ' on the run &nbsp; ' +
      (run.imported
        ? '<span class="pill processed">Imported — paid</span>'
        : paid
        ? '<span class="pill processed">Paid ' + esc(cfg().paid[monthId(y, m)]) + '</span> <button class="btn ghost tiny" data-np-paid="undo" type="button">Undo</button>'
        : '<span class="muted">Not processed</span> <button class="btn tiny" data-np-paid="mark" type="button">Mark as paid</button>');
    var rows = run.rows, xk = rows.filter(function (x) { return x.rule === 'xk'; });
    var sum = function (list, k) { return r2(list.reduce(function (t, x) { return t + x[k]; }, 0)); };
    $('#npStats').innerHTML =
      stat('Employees', String(rows.length), xk.length + ' XK · ' + (rows.length - xk.length) + ' No-Tax') +
      stat('Gross pay', byCurrency(rows, 'totalGross'), 'salary, commission, bonus, leave − deductions', 'accent') +
      stat('Pension (Trust)', money(sum(xk, 'ee') + sum(xk, 'er'), 'EUR'), money(sum(xk, 'ee'), 'EUR') + ' employee · ' + money(sum(xk, 'er'), 'EUR') + ' employer') +
      stat('Withholding tax', money(sum(xk, 'tax'), 'EUR'), 'Kosovo, XK staff') +
      stat('Net pay', byCurrency(rows, 'net'), 'total payout on ' + P.psDay(payout), 'green') +
      stat('Cost to company', byCurrency(rows, 'cost'), 'gross + employer pension + reimbursements');

    var html = '';
    if (imp.loaded[y] === 'loading') html += '<p class="hint" style="margin:0 0 12px">Reading the uploaded No-Tax / XK payslips…</p>';
    if (imp.error) html += '<div class="notice warn">Could not read the uploaded payslips (' + esc(imp.error) + ').</div>';
    if (run.imported) {
      html += '<div class="notice info"><strong>Imported payroll.</strong> ' + run.rows.length + ' payslip(s) from ' +
        run.imported.batches.map(function (b) { return esc(b.id) + (b.published ? '' : ' (draft)'); }).join(', ') +
        ' (Payslip tab), as paid; their cells are locked. Only the people in the upload are on this month.' +
        (run.unmatched.length ? '<br>Not on the roster (' + run.unmatched.length + '): ' + esc(run.unmatched.join(', ')) + '.' : '') +
        (run.rows.some(function (x) { return x.commissionOnly; }) ? '<br>Commission only (salary on the PH payroll): ' +
          esc(run.rows.filter(function (x) { return x.commissionOnly; }).map(function (x) { return nameOf(x.emp); }).join(', ')) + '.' : '') +
        (run.phSide.length ? '<br>On the PH side but paid a salary here — move them to Non-PH on the Employees tab? ' + esc(run.phSide.join(', ')) + '.' : '') +
        '</div>';
    }
    if (filledNotice.length) {
      html += '<div class="notice info note-card"><strong>' + filledNotice.length + ' monthly rate(s) filled</strong> from the latest uploaded ' +
        'payslip\'s gross salary (they were blank).<ul>' + filledNotice.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
    }
    if (run.noRate.length) {
      html += '<div class="notice warn"><strong>' + run.noRate.length + ' employee' + (run.noRate.length === 1 ? ' has' : 's have') +
        ' no monthly rate</strong> and ' + (run.noRate.length === 1 ? 'is' : 'are') + ' left off this month. Type it on the ' +
        'Non-PH Employees tab, or import rates there.<ul>' +
        run.noRate.map(function (e) {
          return '<li>' + esc(e.id) + ' — ' + esc(nameOf(e)) + ' <span class="muted">' + esc(e.company || '') +
            (countryOf(e) ? ', ' + esc(COUNTRY[countryOf(e)] || countryOf(e)) : '') +
            (e.dateHired ? ', started ' + esc(e.dateHired) : '') + '</span></li>';
        }).join('') + '</ul></div>';
    }
    var noCur = rows.filter(function (x) { return !x.currency; });
    if (noCur.length) {
      html += '<div class="notice warn"><strong>No currency</strong> for ' + noCur.map(function (x) { return esc(nameOf(x.emp)); }).join(', ') +
        ' — set it on the Employees tab.</div>';
    }
    var noCountry = rows.filter(function (x) { return !x.country && !x.commissionOnly; });
    if (noCountry.length && countriesLoaded === true) {
      html += '<div class="notice info"><strong>No country</strong> for ' + noCountry.map(function (x) { return esc(nameOf(x.emp)); }).join(', ') +
        ' — no TrinityHR account with their email. Without one no holidays apply and the rule is No-Tax; set it on the Employees tab.</div>';
    }
    var used = {};
    rows.forEach(function (x) { if (x.country) used[x.country] = true; });
    var hols = holidays(y).filter(function (h) { return used[h.country] && h.date >= r.start && h.date <= r.end; });
    if (hols.length) {
      html += '<div class="notice info"><strong>Holidays this month</strong> — not counted as working days when prorating.<ul>' +
        hols.map(function (h) {
          return '<li>' + esc(E.fmtLong(E.parseYmd(h.date))) + ' — ' + esc(h.name) + ' <span class="pill rf">' + esc(COUNTRY[h.country] || h.country) + '</span></li>';
        }).join('') + '</ul></div>';
    }
    var leavers = rows.filter(function (x) { return x.emp.endDate && x.emp.endDate >= r.start && x.emp.endDate <= r.end; });
    var joiners = rows.filter(function (x) { return x.emp.dateHired && x.emp.dateHired > r.start && x.emp.dateHired <= r.end; });
    if (leavers.length || joiners.length) {
      html += '<div class="notice info"><strong>Prorated this month</strong><ul>' +
        joiners.map(function (x) { return '<li>' + esc(nameOf(x.emp)) + ' <span class="muted">started ' + esc(x.emp.dateHired) + '</span></li>'; }).join('') +
        leavers.map(function (x) { return '<li>' + esc(nameOf(x.emp)) + ' <span class="muted">last day ' + esc(x.emp.endDate) + '</span></li>'; }).join('') +
        '</ul></div>';
    }
    $('#npNotice').innerHTML = html;

    var dis = paid ? ' disabled' : '';
    var FIELD = { commission: 'commission', bonus: 'bonus', reimb: 'reimb', deduction: 'deduction' };
    var inp = function (x, key, text) {
      var v = x.imported && FIELD[key] ? x[FIELD[key]] : x.entry[key];
      return '<td' + (text ? '' : ' class="num"') + '><input type="text" class="' + (text ? 'np-text' : 'np-in') + '" data-np-entry="' + esc(x.emp.id) +
        '" data-key="' + key + '" value="' + esc(text ? (v || '') : (v ? plain(num(v)) : '')) + '"' + (dis || (x.imported ? ' disabled' : '')) + '></td>';
    };
    var cell = function (v) { return '<td class="num' + (v ? '' : ' zero') + '">' + plain(v) + '</td>'; };
    $('#npRunTable').innerHTML =
      '<thead><tr><th class="sticky-col">Employee</th><th>Country</th><th>Rule</th><th>Cur.</th><th class="num">Monthly rate</th>' +
      '<th class="num">Days</th><th class="num">Gross salary</th><th class="num">Commission</th><th>Commission details</th>' +
      '<th class="num">Bonus</th><th>Bonus description</th><th class="num">Unused leave</th><th class="num">Reimbursement</th>' +
      '<th class="num">Deduction</th><th>Deduction description</th><th class="num">Pension 5%</th><th class="num">Tax</th>' +
      '<th class="num">Net pay</th><th class="num">Employer pension</th><th class="num">Cost</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (x) {
        return '<tr><td class="sticky-col"><strong>' + esc(nameOf(x.emp)) + '</strong> <span class="muted">' + esc(x.emp.id) + '</span></td>' +
          '<td>' + esc(COUNTRY[x.country] || x.country || '—') + '</td>' +
          '<td>' + (x.rule === 'xk' ? 'XK' + (np(x.emp).taxStatus === 'Foreign' ? ' <span class="muted">Foreign</span>' : '') : 'No-Tax') + '</td>' +
          '<td>' + esc(x.currency || '—') + '</td>' +
          (x.commissionOnly ? '<td class="num"><span class="muted" title="Salary on the PH payroll">commission only</span></td>' : cell(x.rate)) +
          '<td class="num">' + (x.imported ? '<span class="muted">file</span>' : x.staffDays + '/' + x.workDays) + '</td>' +
          '<td class="num"><input type="text" class="np-in" data-np-entry="' + esc(x.emp.id) + '" data-key="gross" value="' + esc(plain(x.basic)) + '"' +
            ' title="' + (x.prorated ? 'Prorated: ' + x.staffDays + ' of ' + x.workDays + ' working days. ' : '') + 'Type to override; clear to recompute."' + dis + '></td>' +
          inp(x, 'commission') + inp(x, 'commissionDetails', true) + inp(x, 'bonus') + inp(x, 'bonusDesc', true) +
          cell(x.leavePay) + inp(x, 'reimb') + inp(x, 'deduction') + inp(x, 'deductionDesc', true) +
          cell(x.ee) + cell(x.tax) + '<td class="num"><strong>' + plain(x.net) + '</strong></td>' + cell(x.er) + cell(x.cost) + '</tr>';
      }).join('') : '<tr><td colspan="20" class="muted" style="padding:18px">Nobody on the Non-PH payroll has a monthly rate for this month yet.</td></tr>') +
      '</tbody>';
  }

  function exportRun() {
    var X = window.XlsxWriter, S = X.S, y = view.year, m = view.month, run = runFor(y, m);
    var head = ['ID', 'Employee', 'Email', 'Country', 'Rule', 'Tax status', 'Currency', 'Monthly rate', 'Working days', 'Days on staff',
      'Gross salary', 'Commission', 'Commission details', 'Bonus', 'Bonus description', 'Unused leave', 'Reimbursement', 'Deduction',
      'Deduction description', 'Total gross', 'Pension employee', 'Taxable base', 'Withholding tax', 'Net pay', 'Pension employer', 'Cost'];
    var t = function (v) { return { v: v === undefined || v === null ? '' : String(v), t: 's' }; };
    var n = function (v) { return { v: v || 0, t: 'n', s: S.NUM }; };
    var rows = [[{ v: 'Non-PH payroll — ' + MONTHS[m] + ' ' + y + ' — payout ' + payoutOf(y, m), t: 's', s: S.TITLE }], [],
      head.map(function (h) { return { v: h, t: 's', s: S.HEAD }; })];
    run.rows.forEach(function (x) {
      var e = x.emp, en = x.entry;
      rows.push([t(e.id), t(nameOf(e)), t(e.email), t(COUNTRY[x.country] || x.country), t(x.rule === 'xk' ? 'XK' : 'No-Tax'),
        t(x.rule === 'xk' ? np(e).taxStatus || 'Local' : ''), t(x.currency), n(x.rate), n(x.workDays), n(x.staffDays), n(x.basic),
        n(x.commission), t(en.commissionDetails), n(x.bonus), t(en.bonusDesc), n(x.leavePay), n(x.reimb), n(x.deduction),
        t(en.deductionDesc), n(x.totalGross), n(x.ee), n(x.taxable), n(x.tax), n(x.net), n(x.er), n(x.cost)]);
    });
    X.download(X.build([{ name: 'Non-PH ' + MONTHS[m].slice(0, 3) + ' ' + y, rows: rows, cols: head.map(function () { return 14; }), freeze: { x: 2, y: 3 } }]),
      'Non-PH Payroll Summary — ' + MONTHS[m] + ' ' + y + '.xlsx');
  }

  /* ------------------------------ Final Pay ------------------------------ */
  var leaveByEmail = null;
  function dailyRate(emp) { return r2(num(np(emp).rate) * 12 / 261); }
  function renderFinal() {
    if (!leaveByEmail) P.leave(function (b) { leaveByEmail = b; render(); });
    var y = view.year;
    var list = people().filter(function (e) { return /^\d{4}/.test(String(e.endDate || '')) && String(e.endDate).slice(0, 4) === String(y); })
      .sort(function (a, b) { return String(b.endDate).localeCompare(String(a.endDate)); });
    $('#npFinalTable').innerHTML = '<thead><tr><th class="sticky-col">Employee</th><th>Last day</th><th>Final month</th><th>Cur.</th>' +
      '<th class="num">Monthly rate</th><th class="num">Daily rate</th><th class="num">Leave left (TrinityHR)</th><th class="num">Days to pay</th>' +
      '<th class="num">Leave pay</th><th>Pay leave</th><th class="num">Final month net</th></tr></thead><tbody>' +
      (list.length ? list.map(function (e) {
        var m = parseInt(e.endDate.slice(5, 7), 10) - 1, en = entry(e.id, y, m);
        var bal = leaveByEmail ? leaveByEmail[String(e.email || '').trim().toLowerCase()] : null;
        var left = bal ? num(bal.remaining) : null;
        var days = en.leaveDays !== undefined ? num(en.leaveDays) : Math.max(0, left || 0);
        var pay = r2(days * dailyRate(e));
        var x = num(np(e).rate) > 0 ? compute(e, y, m) : null, locked = isPaid(y, m) ? ' disabled' : '';
        return '<tr><td class="sticky-col"><strong>' + esc(nameOf(e)) + '</strong> <span class="muted">' + esc(e.id) + '</span></td>' +
          '<td>' + esc(e.endDate) + '</td><td>' + esc(MONTHS[m] + ' ' + y) + '</td><td>' + esc(currencyOf(e) || '—') + '</td>' +
          '<td class="num">' + plain(num(np(e).rate)) + '</td><td class="num">' + plain(dailyRate(e)) + '</td>' +
          '<td class="num">' + (left === null ? '<span class="muted">' + (leaveByEmail ? 'no account' : 'loading…') + '</span>' : plain(left)) + '</td>' +
          '<td class="num"><input type="text" class="np-in" data-np-fp-days="' + esc(e.id) + '" value="' + esc(plain(days)) + '"' + locked + '></td>' +
          '<td class="num">' + plain(pay) + '</td>' +
          '<td><input type="checkbox" data-np-fp-pay="' + esc(e.id) + '"' + (en.leavePay ? ' checked' : '') + locked + '></td>' +
          '<td class="num">' + (x ? plain(x.net) + ' ' + esc(x.currency) : '<span class="muted">no rate</span>') + '</td></tr>';
      }).join('') : '<tr><td colspan="11" class="muted" style="padding:18px">No Non-PH staff have a last day in ' + y + '.</td></tr>') + '</tbody>';
  }
  function setLeave(id, payIt, days) {
    var e = state.employees.filter(function (x) { return x.id === id; })[0];
    if (!e || !e.endDate) return;
    var y = parseInt(e.endDate.slice(0, 4), 10), m = parseInt(e.endDate.slice(5, 7), 10) - 1;
    if (days !== undefined) setEntry(id, y, m, 'leaveDays', days);
    var d = entry(id, y, m), useDays = d.leaveDays !== undefined ? num(d.leaveDays) : null;
    if (useDays === null) {
      var bal = leaveByEmail ? leaveByEmail[String(e.email || '').trim().toLowerCase()] : null;
      useDays = Math.max(0, bal ? num(bal.remaining) : 0);
    }
    var on = payIt === undefined ? !!d.leavePay : payIt;
    setEntry(id, y, m, 'leavePay', on ? r2(useDays * dailyRate(e)) : 0);
  }

  /* ------------------------------ Employees ------------------------------ */
  function renderEmployees() {
    var q = String($('#npEmpSearch').value || '').toLowerCase().split(/\s+/).filter(Boolean);
    var list = people().filter(function (e) {
      var text = [e.id, e.lastName, e.firstName, e.email, e.company, COUNTRY[countryOf(e)]].join(' ').toLowerCase();
      return q.every(function (w) { return text.indexOf(w) !== -1; });
    }).sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b)); });
    var ph = state.employees.filter(function (e) { return P.isPhPayroll(e); }).sort(function (a, b) { return nameOf(a).localeCompare(nameOf(b)); });
    $('#npMoveIn').innerHTML = '<option value="">Choose a PH employee…</option>' + ph.map(function (e) {
      return '<option value="' + esc(e.id) + '">' + esc(nameOf(e) + ' (' + e.id + ')') + '</option>';
    }).join('');
    var opt = function (v, label, cur) { return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(label) + '</option>'; };
    $('#npEmpTable').innerHTML = '<thead><tr><th class="sticky-col">Employee</th><th>Company</th><th>Country</th><th>Rule</th>' +
      '<th>Tax status</th><th>Employer</th><th>Currency</th><th class="num">Monthly rate</th><th>Started</th><th>Last day</th>' +
      '<th>Email</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map(function (e) {
        var n = np(e), acct = accountCountry[String(e.email || '').trim().toLowerCase()], xk = ruleOf(e) === 'xk';
        var id = esc(e.id);
        return '<tr><td class="sticky-col"><strong>' + esc(nameOf(e)) + '</strong> <span class="muted">' + id + '</span></td>' +
          '<td class="muted">' + esc(e.company || '') + '</td>' +
          '<td><select class="np-sel" data-np-emp="' + id + '" data-key="country">' +
            opt('', acct ? 'TrinityHR: ' + (COUNTRY[acct] || acct) : 'No account', n.country || '') +
            Object.keys(COUNTRY).map(function (k) { return opt(k, COUNTRY[k], n.country || ''); }).join('') + '</select></td>' +
          '<td><select class="np-sel" data-np-emp="' + id + '" data-key="rule">' + opt('', 'Auto (' + (ruleOf(Object.assign({}, e, { np: {} })) === 'xk' ? 'XK' : 'No-Tax') + (lastKind[e.id] ? ', as last paid' : '') + ')', n.rule || '') +
            opt('xk', 'XK', n.rule || '') + opt('notax', 'No-Tax', n.rule || '') + '</select></td>' +
          '<td>' + (xk ? '<select class="np-sel" data-np-emp="' + id + '" data-key="taxStatus">' + opt('', 'Local', n.taxStatus || '') +
            opt('Foreign', 'Foreign', n.taxStatus || '') + '</select>' : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (xk ? '<select class="np-sel" data-np-emp="' + id + '" data-key="employer">' + opt('', 'Primary', n.employer || '') +
            opt('Secondary', 'Secondary', n.employer || '') + '</select>' : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (xk ? 'EUR' : '<input type="text" maxlength="3" style="width:60px;text-transform:uppercase" data-np-emp="' + id +
            '" data-key="currency" value="' + esc(n.currency || '') + '" placeholder="' + esc(currencyOf(e)) + '">') + '</td>' +
          '<td class="num"><input type="text" class="np-in' + (num(n.rate) ? '' : ' missing') + '" data-np-emp="' + id + '" data-key="rate" value="' +
            esc(num(n.rate) ? plain(num(n.rate)) : '') + '"></td>' +
          '<td>' + esc(e.dateHired || '') + '</td><td>' + esc(e.endDate || '') + '</td><td class="muted">' + esc(e.email || '') + '</td>' +
          '<td><button class="btn ghost tiny" data-np-move-out="' + id + '" type="button">Move to PH</button></td></tr>';
      }).join('') : '<tr><td colspan="12" class="muted" style="padding:18px">Nobody on the Non-PH payroll' + (q.length ? ' matches the search' : '') + '.</td></tr>') +
      '</tbody>';
  }

  function importRates(file) {
    var msg = $('#npEmpMsg');
    window.XlsxWriter.read(file).then(function (sheets) {
      var rows = sheets[Object.keys(sheets)[0]] || [], hi = -1, head = [];
      for (var i = 0; i < Math.min(rows.length, 20); i++) {
        head = (rows[i] || []).map(function (h) { return String(h || '').trim().toLowerCase(); });
        if (head.indexOf('monthly rate') !== -1 && (head.indexOf('id') !== -1 || head.indexOf('email') !== -1)) { hi = i; break; }
      }
      if (hi < 0) throw new Error('No header row with "Monthly rate" and "ID" or "Email".');
      var at = function (n) { return head.indexOf(n); };
      var byId = {}, byEmail = {}, changed = [], missed = [];
      people().forEach(function (e) { byId[String(e.id).trim()] = e; if (e.email) byEmail[String(e.email).trim().toLowerCase()] = e; });
      rows.slice(hi + 1).forEach(function (r) {
        if (!r || !r.some(function (c) { return String(c || '').trim(); })) return;
        var id = at('id') !== -1 ? String(r[at('id')] || '').trim() : '';
        var em = at('email') !== -1 ? String(r[at('email')] || '').trim().toLowerCase() : '';
        var e = byId[id] || byEmail[em];
        if (!e) { missed.push(id || em); return; }
        var rate = amount(r[at('monthly rate')]);
        if (rate > 0) setNp(e, 'rate', rate);
        if (at('currency') !== -1 && /^[A-Za-z]{3}$/.test(String(r[at('currency')] || '').trim())) setNp(e, 'currency', String(r[at('currency')]).trim().toUpperCase());
        changed.push(nameOf(e));
      });
      saveEmps();
      msg.innerHTML = '<div class="notice info"><strong>' + changed.length + ' rate(s) set.</strong>' +
        (missed.length ? ' Not on the Non-PH payroll: ' + esc(missed.join(', ')) + '.' : '') + '</div>';
      render();
    }).catch(function (e) { msg.innerHTML = '<div class="notice warn">' + esc(e.message) + '</div>'; });
  }

  /* ------------------------------ Holidays ------------------------------ */
  function renderHolidays() {
    var y = view.year;
    $('#npHolYear').textContent = '— ' + y;
    var src = holSync.done[y] === 'loading' ? 'Loading from Manage Holidays…'
      : holSync.error ? 'Could not load Manage Holidays (' + holSync.error + ') — showing the last copy.' : '';
    if (src) $('#npHolSource').textContent = src;
    var list = holidays(y).filter(function (h) { return h.country !== 'PH'; });
    var staffIn = {};
    people().forEach(function (e) { var c = countryOf(e); if (c) staffIn[c] = (staffIn[c] || 0) + 1; });
    var DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    $('#npHolTable').innerHTML = '<thead><tr><th>Date</th><th>Day</th><th>Holiday</th><th>Country</th><th>Weekday</th></tr></thead><tbody>' +
      (list.length ? list.map(function (h) {
        var d = E.parseYmd(h.date), wk = d.getDay() !== 0 && d.getDay() !== 6;
        return '<tr><td>' + esc(E.fmtLong(d)) + '</td><td>' + DAY[d.getDay()] + '</td><td>' + esc(h.name) + '</td>' +
          '<td>' + esc(COUNTRY[h.country] || h.country) + ' <span class="muted">' + (staffIn[h.country] || 0) + ' staff</span></td>' +
          '<td>' + (wk ? 'Yes' : '<span class="muted">No — weekend</span>') + '</td></tr>';
      }).join('') : '<tr><td colspan="5" class="muted" style="padding:18px">No holidays for ' + y + ' in Manage Holidays yet.</td></tr>') + '</tbody>';
  }

  /* ------------------------------ Contributions ------------------------------ */
  var ct = { from: new Date().getMonth(), to: new Date().getMonth() };
  function contribRows() {
    var out = [];
    for (var m = ct.from; m <= ct.to; m++) {
      runFor(view.year, m).rows.forEach(function (x) { if (x.rule === 'xk' && (x.ee || x.er)) out.push({ m: m, x: x }); });
    }
    return out;
  }
  function renderContrib() {
    fillMonthSelect($('#npCtFrom'), ct.from);
    fillMonthSelect($('#npCtTo'), ct.to);
    var list = contribRows(), t = { g: 0, ee: 0, er: 0 };
    $('#npCtTable').innerHTML = '<thead><tr><th>Month</th><th class="sticky-col">Employee</th><th>Tax status</th><th class="num">Total gross (EUR)</th>' +
      '<th class="num">Employee 5%</th><th class="num">Employer 5%</th><th class="num">Total to the Trust</th></tr></thead><tbody>' +
      (list.length ? list.map(function (r) {
        t.g += r.x.totalGross; t.ee += r.x.ee; t.er += r.x.er;
        return '<tr><td>' + esc(MONTHS[r.m]) + '</td><td class="sticky-col">' + esc(nameOf(r.x.emp)) + '</td><td>' + esc(np(r.x.emp).taxStatus || 'Local') + '</td>' +
          '<td class="num">' + plain(r.x.totalGross) + '</td><td class="num">' + plain(r.x.ee) + '</td><td class="num">' + plain(r.x.er) + '</td>' +
          '<td class="num"><strong>' + plain(r2(r.x.ee + r.x.er)) + '</strong></td></tr>';
      }).join('') : '<tr><td colspan="7" class="muted" style="padding:18px">No pension contributions in these months.</td></tr>') +
      '</tbody>' + (list.length ? '<tfoot><tr><td>TOTAL</td><td></td><td></td><td class="num">' + plain(r2(t.g)) + '</td><td class="num">' + plain(r2(t.ee)) +
        '</td><td class="num">' + plain(r2(t.er)) + '</td><td class="num">' + plain(r2(t.ee + t.er)) + '</td></tr></tfoot>' : '');
  }
  function exportContrib() {
    var X = window.XlsxWriter, S = X.S, list = contribRows();
    var head = ['Month', 'ID', 'Employee', 'Tax status', 'Total gross (EUR)', 'Employee 5%', 'Employer 5%', 'Total'];
    var rows = [[{ v: 'Kosovo pension (Trust) — ' + MONTHS[ct.from] + ' to ' + MONTHS[ct.to] + ' ' + view.year, t: 's', s: S.TITLE }], [],
      head.map(function (h) { return { v: h, t: 's', s: S.HEAD }; })];
    list.forEach(function (r) {
      rows.push([{ v: MONTHS[r.m], t: 's' }, { v: String(r.x.emp.id), t: 's' }, { v: nameOf(r.x.emp), t: 's' }, { v: np(r.x.emp).taxStatus || 'Local', t: 's' },
        { v: r.x.totalGross, t: 'n', s: S.NUM }, { v: r.x.ee, t: 'n', s: S.NUM }, { v: r.x.er, t: 'n', s: S.NUM }, { v: r2(r.x.ee + r.x.er), t: 'n', s: S.NUM }]);
    });
    X.download(X.build([{ name: 'Pension', rows: rows, cols: head.map(function () { return 16; }), freeze: { x: 3, y: 3 } }]),
      'Kosovo pension — ' + MONTHS[ct.from] + ' to ' + MONTHS[ct.to] + ' ' + view.year + '.xlsx');
  }

  /* ------------------------------ Payslip ------------------------------ */
  var psMonth = null;
  function renderPayslip() {
    if (psMonth === null) psMonth = view.month;
    fillMonthSelect($('#npPsMonth'), psMonth);
    var run = runFor(view.year, psMonth), xk = run.rows.filter(function (x) { return x.rule === 'xk'; });
    var noEmail = run.imported ? [] : run.rows.filter(function (x) { return !x.emp.email; });
    $('#npPsSummary').innerHTML = '<p style="margin:4px 0;font-size:13px">' + esc(MONTHS[psMonth] + ' ' + view.year) + ' · payout ' +
      esc(P.psDay(payoutOf(view.year, psMonth))) + ' · ' + xk.length + ' XK and ' + (run.rows.length - xk.length) + ' No-Tax payslip(s)' +
      (noEmail.length ? ' · <span style="color:var(--amber)">' + noEmail.length + ' without an email will be skipped</span>' : '') + '</p>' +
      (run.imported ? '<div class="notice info">Already uploaded: ' + run.imported.batches.map(function (b) { return esc(b.id); }).join(', ') +
        '. Its payslips are in the list below.</div>' : '');
  }

  /** The month's run as the XK / No-Tax template rows, so the payslips read exactly like uploaded ones. */
  function templateRows(kind, list, y, m) {
    var payout = payoutOf(y, m), label = MONTHS[m] + ' ' + y;
    var head = kind === 'xk'
      ? ['No', 'Employee', 'Tax status', 'Bank country', 'Bank / receiving account', 'Email', 'Employer', 'Net', 'Gross salary', 'Commission',
         'Commission details', 'Bonus', 'Bonus description', 'Reimbursement, non-taxable', 'Deduction / adjustment', 'Deduction description',
         'Total gross', 'Employee contribution 5%', 'Employer contribution 5%', 'Taxable base', 'Withholding tax', 'Cost to employer',
         'Reference', 'Notes', 'Position', 'Employee Code', 'Personal No.', 'Payroll Period', 'Payout Date']
      : ['No', 'Employee', 'Currency', 'Bank country', 'Bank / receiving account', 'Email', 'Net', 'Gross salary', 'Commission',
         'Commission details', 'Bonus', 'Bonus description', 'Reimbursement', 'Deduction / adjustment', 'Deduction description',
         'Reference', 'Notes', 'Position', 'Employee Code', 'Personal No.', 'Payroll Period', 'Payout Date'];
    var rows = [[kind === 'xk' ? 'PAYROLL LIST (EUR)' : 'NO-TAX PAYROLL'], [], [], [], head];
    list.forEach(function (x, i) {
      var e = x.emp, en = x.entry, n = np(e);
      var bonusDesc = [en.bonusDesc, x.leavePay ? 'Unused leave' : ''].filter(Boolean).join('; ');
      var v = {
        'No': String(i + 1), 'Employee': ((e.firstName || '') + ' ' + (e.lastName || '')).trim(), 'Tax status': n.taxStatus || 'Local',
        'Currency': x.currency, 'Bank country': e.bankCountry || '', 'Bank / receiving account': e.bankAccountNo || '', 'Email': e.email || '',
        'Employer': n.employer || 'Primary', 'Net': x.net, 'Gross salary': x.basic, 'Commission': x.commission,
        'Commission details': en.commissionDetails || '', 'Bonus': r2(x.bonus + x.leavePay), 'Bonus description': bonusDesc,
        'Reimbursement, non-taxable': x.reimb, 'Reimbursement': x.reimb, 'Deduction / adjustment': x.deduction,
        'Deduction description': en.deductionDesc || '', 'Total gross': x.totalGross, 'Employee contribution 5%': x.ee,
        'Employer contribution 5%': x.er, 'Taxable base': x.taxable, 'Withholding tax': x.tax, 'Cost to employer': x.cost,
        'Reference': '', 'Notes': '', 'Position': e.position || '', 'Employee Code': String(e.id), 'Personal No.': '',
        'Payroll Period': label, 'Payout Date': payout
      };
      rows.push(head.map(function (h) { return v[h]; }));
    });
    return rows;
  }

  function preparePayslips() {
    var y = view.year, m = psMonth, run = runFor(y, m), c = cfg(), btn = $('#npPsPrepare');
    if (run.imported) {
      alert(MONTHS[m] + ' ' + y + ' was already uploaded (' + run.imported.batches.map(function (b) { return b.id; }).join(', ') +
        '). Replace it from the Upload card below, or delete that batch first.');
      return;
    }
    var noCur = run.rows.filter(function (x) { return !x.currency; });
    if (noCur.length) {
      alert('Set a currency first (Non-PH Employees tab) for: ' + noCur.map(function (x) { return nameOf(x.emp); }).join(', ') + '.');
      return;
    }
    var groups = [['xk', run.rows.filter(function (x) { return x.rule === 'xk'; })],
                  ['notax', run.rows.filter(function (x) { return x.rule !== 'xk'; })]].filter(function (g) { return g[1].length; });
    if (!groups.length) { alert('Nobody on the Non-PH run for ' + MONTHS[m] + ' ' + y + '.'); return; }
    var ups, problems = [];
    try {
      ups = groups.map(function (g) {
        var up = P.readPayslipRows(templateRows(g[0], g[1], y, m), { company: c.companyOther, address: c.address, currency: 'EUR' });
        problems = problems.concat(up.problems);
        return up;
      });
    } catch (e) { alert('Could not build the payslips.\n\n' + e.message); return; }
    btn.disabled = true; btn.textContent = 'Preparing…';
    P.psApi('payslips').then(function (d) {
      var published = (d.batches || []).filter(function (b) {
        return b.published_at && ups.some(function (u) { return u.id === b.id; });
      });
      if (published.length && !confirm('Already published: ' + published.map(function (b) { return b.id; }).join(', ') +
          '.\n\nPreparing replaces what employees see. Continue?')) return null;
      return ups.reduce(function (p, up) {
        return p.then(function (missed) {
          return P.psApi('payslips', 'PUT', {
            batch: { id: up.id, label: up.label, payout_date: up.payout, cutoff_start: up.start, cutoff_end: up.end },
            payslips: up.payslips,
            company_by_country: { kosovo: c.companyKosovo, other: c.companyOther }
          }).then(function (r) { return missed.concat(r.unmatched, r.invalid); });
        });
      }, Promise.resolve([]));
    }).then(function (missed) {
      if (missed === null) return;
      P.psShowMissed($('#npPsUnmatched'), missed);
      $('#npPsSummary').innerHTML = '<div class="notice info"><strong>Prepared as drafts</strong> — ' +
        ups.map(function (u) { return u.payslips.length + ' ' + (u.kind === 'xk' ? 'XK' : 'No-Tax') + ' (' + esc(u.id) + ')'; }).join(', ') +
        '. Check them in the list below, then Publish.' +
        (problems.length ? '<ul>' + problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') + '</div>';
      return P.psLoadBatches(ups[0].id);
    }).catch(function (e) { alert('Could not prepare.\n\n' + e.message); })
      .then(function () { btn.disabled = false; btn.textContent = 'Prepare payslips'; });
  }

  /* ------------------------------ Settings ------------------------------ */
  function renderSettings() {
    var c = cfg();
    $$('[data-np-setting]').forEach(function (el) { el.value = c[el.dataset.npSetting]; });
  }

  /* ------------------------------ wiring ------------------------------ */
  function findEmp(id) { return state.employees.filter(function (e) { return e.id === id; })[0]; }

  function wire() {
    var batches = $('#psBatchesCard');
    movedHome = { parent: batches.parentNode, next: batches.nextSibling };

    $('#scopeBar').addEventListener('click', function (ev) {
      var b = ev.target.closest('.scope');
      if (b) setScope(b.dataset.scope);
    });
    $('#tabs').addEventListener('click', function (ev) {
      var t = ev.target.closest('.tab');
      if (t) phTab = t.dataset.tab;
    });
    $('#npTabs').addEventListener('click', function (ev) {
      var t = ev.target.closest('.tab');
      if (t) showTab(t.dataset.npTab);
    });

    var years = [];
    for (var yy = 2025; yy <= new Date().getFullYear() + 1; yy++) years.push(yy);
    $('#npYear').innerHTML = years.map(function (yy) { return '<option value="' + yy + '">' + yy + '</option>'; }).join('');
    $('#npYear').value = String(view.year);
    $('#npYear').addEventListener('change', function () { view.year = parseInt(this.value, 10); render(); });
    $('#npMonth').addEventListener('change', function () { view.month = parseInt(this.value, 10); render(); });
    $('#npExport').addEventListener('click', exportRun);
    $('#npToPayslips').addEventListener('click', function () { psMonth = view.month; showTab('payslip'); });

    $('#npMeta').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-np-paid]');
      if (!b) return;
      var id = monthId(view.year, view.month);
      if (b.dataset.npPaid === 'mark') cfg().paid[id] = ymd(new Date());
      else if (confirm('Mark ' + MONTHS[view.month] + ' ' + view.year + ' as not paid? Its cells unlock.')) delete cfg().paid[id];
      saveCfg();
      render();
    });

    $('#npRunTable').addEventListener('change', function (ev) {
      var el = ev.target.closest('[data-np-entry]');
      if (!el) return;
      var key = el.dataset.key, text = /Details|Desc$/.test(key);
      var v = text ? el.value.trim() : el.value.trim() === '' ? '' : amount(el.value);
      if (key === 'gross') {
        var e = findEmp(el.dataset.npEntry);
        // Back to the computed salary when cleared or typed as it already is.
        var auto = e ? compute(e, view.year, view.month) : null;
        if (v === '' || (auto && !auto.entry.hasOwnProperty('gross') && v === auto.basic)) v = '';
        var k = monthId(view.year, view.month) + '|' + el.dataset.npEntry, d = state.dtr[k] || {};
        if (v === '') delete d.gross; else d.gross = v;
        if (Object.keys(d).length) state.dtr[k] = d; else delete state.dtr[k];
        saveDtr();
      } else {
        setEntry(el.dataset.npEntry, view.year, view.month, key, v);
      }
      render();
    });

    $('#npFinalTable').addEventListener('change', function (ev) {
      var d = ev.target.closest('[data-np-fp-days]'), p = ev.target.closest('[data-np-fp-pay]');
      if (d) setLeave(d.dataset.npFpDays, undefined, Math.max(0, amount(d.value)));
      if (p) setLeave(p.dataset.npFpPay, p.checked);
      render();
    });

    $('#npEmpSearch').addEventListener('input', render);
    $('#npEmpTable').addEventListener('change', function (ev) {
      var el = ev.target.closest('[data-np-emp]');
      if (!el) return;
      var e = findEmp(el.dataset.npEmp), key = el.dataset.key;
      if (!e) return;
      var v = key === 'rate' ? (amount(el.value) > 0 ? amount(el.value) : '') : key === 'currency' ? el.value.trim().toUpperCase() : el.value;
      setNp(e, key, v);
      saveEmps();
      render();
    });
    $('#npEmpTable').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-np-move-out]');
      if (!b) return;
      var e = findEmp(b.dataset.npMoveOut);
      if (!e || !confirm('Move ' + nameOf(e) + ' to the PH payroll? They then need a PH monthly rate there.')) return;
      e.payrollGroup = 'ph';
      saveEmps();
      P.refreshPh();
      render();
    });
    $('#npMoveIn').addEventListener('change', function () {
      var e = findEmp(this.value);
      if (!e) return;
      if (!confirm('Move ' + nameOf(e) + ' to the Non-PH payroll? They leave the PH run from cutoffs not yet imported from a payroll file.')) { this.value = ''; return; }
      e.payrollGroup = 'nonph';
      saveEmps();
      P.refreshPh();
      render();
    });
    $('#npRateFile').addEventListener('change', function () { if (this.files[0]) importRates(this.files[0]); this.value = ''; });

    $('#npCtFrom').addEventListener('change', function () { ct.from = parseInt(this.value, 10); if (ct.to < ct.from) ct.to = ct.from; render(); });
    $('#npCtTo').addEventListener('change', function () { ct.to = parseInt(this.value, 10); if (ct.from > ct.to) ct.from = ct.to; render(); });
    $('#npCtExport').addEventListener('click', exportContrib);

    $('#npPsMonth').addEventListener('change', function () { psMonth = parseInt(this.value, 10); render(); });
    $('#npPsPrepare').addEventListener('click', preparePayslips);

    $('#npSettingsForm').addEventListener('change', function (ev) {
      var el = ev.target.closest('[data-np-setting]');
      if (!el) return;
      cfg()[el.dataset.npSetting] = el.type === 'number' ? num(el.value) : el.value.trim();
      saveCfg();
    });
  }

  wire();
  var saved = 'ph';
  try { saved = localStorage.getItem('phpayroll.scope') || 'ph'; } catch { /* private window */ }
  if (saved === 'nonph') setScope('nonph');
})();

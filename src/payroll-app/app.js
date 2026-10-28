/* =========================================================================
   app.js — UI wiring for the payroll site
   ========================================================================= */
(function () {
  'use strict';

  var E = window.PayrollEngine;
  var Store = window.PayrollData.Store;

  /* ------------------------------ state ------------------------------ */
  var state = {
    settings: Store.loadSettings(),
    employees: Store.loadEmployees(),
    dtr: Store.loadDtr(),
    year: new Date().getFullYear(),
    holidays: [],
    periods: [],
    period: null,
    run: null
  };

  /* ---------------------------- utilities ---------------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function peso(n) {
    var v = (typeof n === 'number' && isFinite(n)) ? n : 0;
    return '₱' + v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function plain(n) {
    var v = (typeof n === 'number' && isFinite(n)) ? n : 0;
    return v.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // Amount fields display a grouped figure (150,000.00), so the separators and
  // any pasted peso sign come off before parsing — parseFloat('150,000.00') is 150.
  function stripAmount(v) {
    return String(v === undefined || v === null ? '' : v).replace(/[^0-9.\-]/g, '');
  }
  function parseAmount(v) { return Math.max(0, E.num(stripAmount(v))); }
  // Salary adjustments are the one amount that may legitimately be negative —
  // a decrease — so this one keeps the sign.
  function parseSigned(v) { return E.num(stripAmount(v)); }
  // Same, but an empty field stays empty rather than becoming 0.00 — a blank
  // de minimis means "auto-compute" and a blank override means "use the default".
  function amountValue(v) {
    if (v === undefined || v === null || v === '') return '';
    return plain(typeof v === 'number' ? v : parseAmount(v));
  }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) {
    return '<td class="num' + (n ? '' : ' zero') + '">' + plain(n) + '</td>';
  }
  function getPath(obj, path) {
    return path.split('.').reduce(function (o, k) { return (o || {})[k]; }, obj);
  }
  function setPath(obj, path, value) {
    var keys = path.split('.'), last = keys.pop();
    var target = keys.reduce(function (o, k) { if (!o[k]) o[k] = {}; return o[k]; }, obj);
    target[last] = value;
  }

  function persist() {
    Store.saveSettings(state.settings);
    Store.saveEmployees(state.employees);
    Store.saveDtr(state.dtr);
  }

  function dtrKey(emp) { return state.period.id + '|' + emp.id; }
  function dtrFor(emp) {
    var k = dtrKey(emp);
    if (!state.dtr[k]) state.dtr[k] = {};
    return state.dtr[k];
  }

  /* =====================================================================
     PERIOD SELECTION
     ===================================================================== */
  function refreshPeriods(keepId) {
    state.periods = E.buildPeriods(state.year);
    state.holidays = Store.loadHolidays(state.year);

    var sel = $('#periodSelect');
    sel.innerHTML = state.periods.map(function (p) {
      // Named by the cutoff, as the payroll files are: "January 1 - 15, 2026".
      return '<option value="' + p.id + '">' + esc(window.PayrollTemplate.cutoffTitle(p)) + '</option>';
    }).join('');

    var target = keepId && state.periods.some(function (p) { return p.id === keepId; })
      ? keepId : nearestPeriodId();
    sel.value = target;
    state.period = state.periods.filter(function (p) { return p.id === target; })[0];
  }

  /** The payout period closest to today (defaults to the first of the year). */
  function nearestPeriodId() {
    var today = E.ymd(new Date());
    var candidates = state.periods.filter(function (p) { return p.payoutDate >= today; });
    if (candidates.length) return candidates[0].id;
    return state.periods[state.periods.length - 1].id;
  }

  function buildYearSelect() {
    var now = new Date().getFullYear();
    var years = [];
    for (var y = now - 2; y <= now + 2; y++) years.push(y);
    $('#yearSelect').innerHTML = years.map(function (y) {
      return '<option value="' + y + '"' + (y === state.year ? ' selected' : '') + '>' + y + '</option>';
    }).join('');
  }

  /* =====================================================================
     PAYROLL RUN TAB
     ===================================================================== */
  /**
   * An increase shows as a separate adjustment for the cutoff it lands in, and
   * from the next cutoff onward it IS the rate. Once the effectivity date sits
   * on or before this cutoff opens there is nothing left to prorate, so the
   * amount is folded into the base rate and the adjustment cleared.
   *
   * Folding does not change any figure for this cutoff — base+adjustment and
   * the folded rate compute identically once the split no longer applies. It
   * exists so a later increase adds to the raised rate instead of replacing
   * the earlier one, which is what a single adjustment field would otherwise do.
   */
  function foldMaturedAdjustments() {
    var folded = [];
    state.employees.forEach(function (emp) {
      var adj = E.num(emp.salaryAdjustment);
      var eff = String(emp.salaryAdjustmentEffective || '');
      if (!adj || !/^\d{4}-\d{2}-\d{2}$/.test(eff)) return;
      if (eff > state.period.start) return;   // still straddling, or not yet in force
      var was = E.num(emp.monthlyRate);
      emp.monthlyRate = E.r2(was + adj);
      emp.salaryAdjustment = 0;
      emp.salaryAdjustmentEffective = null;
      folded.push({ name: emp.lastName + ', ' + emp.firstName, from: was, to: emp.monthlyRate, eff: eff });
    });
    if (folded.length) persist();
    return folded;
  }

  function renderRun() {
    var folded = foldMaturedAdjustments();
    if (folded.length) state.foldNotice = folded;
    renderFoldNotice();
    /* A cutoff loaded from a payroll file is the record of who was paid:
       only the people in it. Otherwise everyone on staff with a rate. */
    var postedHere = E.isPostedPeriod(state.dtr, state.period.id);
    state.runEmployees = state.employees.filter(function (e) {
      var d = state.dtr[state.period.id + '|' + e.id];
      if (d && d.posted) return true;
      // Final pay can land in a cutoff after the last day; they're on it then.
      var finalHere = e.finalPay && e.finalPay.periodId === state.period.id;
      return !postedHere && (onStaff(e, state.period) || finalHere) && E.num(e.monthlyRate) > 0;
    });
    state.run = E.computeRun(state.runEmployees, state.period, state.dtr, state.settings);
    renderPeriodMeta();
    renderRosterNotice();
    renderStats();
    renderHolidayNotice();
    renderRunTable();
    renderEmployerTable();
    renderLoanLedger();
  }

  /* On the payroll for a cutoff unless they started after it closed or left
     before it opened. Someone with no start date is assumed on staff. */
  function onStaff(emp, period) {
    var hired = String(emp.dateHired || ''), left = String(emp.endDate || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(hired) && hired > period.end) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(left) && left < period.start) return false;
    return true;
  }

  /* An empty roster, missing rates and people leaving mid-cutoff all need
     someone to act, so they are said above the run rather than discovered
     in it. */
  function renderRosterNotice() {
    var el = $('#rosterNotice');
    if (!state.employees.length) {
      el.innerHTML = '<div class="notice info"><strong>No employees yet.</strong> ' +
        'Go to the Employees tab and import the 201 File, then import salaries.</div>';
      return;
    }
    var html = '';
    if (state.refiled) {
      html += '<div class="notice info"><strong>Fixed a misfiled import.</strong> ' +
        (state.refiled.moved ? state.refiled.moved + ' imported row(s) had been filed under the wrong year\'s cutoff ' +
          '(the January 2026 register\'s title says 2025) and were moved to the cutoff their file is for. ' : '') +
        (state.refiled.dropped ? state.refiled.dropped + ' misfiled duplicate row(s) were removed — the right cutoff already had them.' : '') +
        '</div>';
    }
    var inRun = {};
    state.runEmployees.forEach(function (e) { inRun[e.id] = true; });
    var postedHere = E.isPostedPeriod(state.dtr, state.period.id);
    var noRate = postedHere ? [] : state.employees.filter(function (e) {
      return !inRun[e.id] && onStaff(e, state.period) && !E.num(e.monthlyRate);
    });
    var posted = state.run.slips.filter(function (s) { return s.posted; }).length;
    if (posted) {
      html += '<div class="notice info"><strong>Imported payroll.</strong> ' + posted + ' of ' +
        state.run.slips.length + ' employee' + (state.run.slips.length === 1 ? '' : 's') +
        ' on this cutoff show the figures from the payroll file, as paid; their cells are locked. ' +
        'Only the people in the file are on this cutoff. ' +
        '<button class="btn ghost tiny" id="btnUnpost" type="button">Recalculate this cutoff instead</button></div>';
    }
    if (noRate.length) {
      html += '<div class="notice warn note-card"><strong>' + noRate.length + ' employee' +
        (noRate.length === 1 ? ' has' : 's have') + ' no monthly rate</strong> and ' +
        (noRate.length === 1 ? 'is' : 'are') + ' left off this cutoff. Import salaries on the ' +
        'Employees tab, or import a payroll file — a blank rate is filled from it.<ul>' + noRate.slice(0, 12).map(function (e) {
          return '<li>' + esc(e.id) + ' — ' + esc((e.lastName || '') + ', ' + (e.firstName || '')) + '</li>';
        }).join('') + (noRate.length > 12 ? '<li>…and ' + (noRate.length - 12) + ' more</li>' : '') +
        '</ul></div>';
    }
    var p = state.period;
    var leaving = state.runEmployees.filter(function (e) {
      return e.endDate && e.endDate >= p.start && e.endDate < p.end;
    });
    var joining = state.runEmployees.filter(function (e) {
      return e.dateHired && e.dateHired > p.start && e.dateHired <= p.end;
    });
    if (leaving.length) {
      html += '<div class="notice info note-card"><strong>Last day of work inside this cutoff</strong> — ' +
        'basic pay and de minimis are prorated to the days on staff.<ul>' +
        leaving.map(function (e) {
          return '<li>' + esc((e.lastName || '') + ', ' + (e.firstName || '')) +
            ' <span class="muted">last day ' + esc(e.endDate) + '</span></li>';
        }).join('') + '</ul></div>';
    }
    if (joining.length) {
      html += '<div class="notice info note-card"><strong>Started inside this cutoff</strong> — ' +
        'basic pay and de minimis are prorated to the days on staff.<ul>' +
        joining.map(function (e) {
          return '<li>' + esc((e.lastName || '') + ', ' + (e.firstName || '')) +
            ' <span class="muted">started ' + esc(e.dateHired) + '</span></li>';
        }).join('') + '</ul></div>';
    }
    var off = state.employees.length - state.runEmployees.length - noRate.length;
    if (off && postedHere) {
      html += '<p class="hint" style="margin:0 0 12px">' + off + ' employee' +
        (off === 1 ? ' is' : 's are') + ' on the roster but not in this cutoff\'s payroll file.</p>';
    } else if (off) {
      html += '<p class="hint" style="margin:0 0 12px">' + off + ' employee' +
        (off === 1 ? ' is' : 's are') + ' not on this cutoff (started after it or left before it).</p>';
    }
    el.innerHTML = html;
    var un = $('#btnUnpost');
    if (un) un.onclick = function () {
      if (!confirm('Drop the imported figures for this cutoff and recalculate it from the rates and ' +
          'timesheet instead? Importing the file again brings them back.')) return;
      state.employees.forEach(function (e) {
        var d = state.dtr[state.period.id + '|' + e.id];
        if (d && d.posted) delete d.posted;
      });
      Store.saveDtr(state.dtr);
      renderRun();
    };
  }

  /* Folding rewrites a stored rate, so it says so rather than doing it silently. */
  function renderFoldNotice() {
    var el = $('#foldNotice');
    if (!el) return;
    var f = state.foldNotice;
    if (!f || !f.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="notice info"><strong>' + f.length + ' salary increase' +
      (f.length === 1 ? '' : 's') + ' now part of the base rate.</strong> ' +
      'Fully in force as of this cutoff, so the amount moved into Rate and the ' +
      'adjustment was cleared — a later increase now adds on top of it.' +
      '<ul>' + f.map(function (x) {
        return '<li>' + esc(x.name) + ' — ' + plain(x.from) + ' → ' + plain(x.to) +
          ' <span class="muted">effective ' + esc(x.eff) + '</span></li>';
      }).join('') + '</ul></div>';
  }

  function renderPeriodMeta() {
    var wd = E.workingDaysInPeriod(state.period, state.settings);
    var halfLabel = 'Pay period ' + state.period.payPeriodNo;
    $('#periodMeta').innerHTML =
      'Cutoff <strong>' + esc(state.period.cutoffLabel) + '</strong> &nbsp;·&nbsp; ' +
      'Payout <strong>' + esc(state.period.payoutLabel) + '</strong> &nbsp;·&nbsp; ' +
      '<strong>' + wd + '</strong> working days &nbsp;·&nbsp; ' + halfLabel +
      (function () {
        var sent = (Store.loadTrinity().sent || {})[state.period.id];
        return sent ? ' &nbsp;·&nbsp; <span class="pill rf" title="' + esc(sent.saved + ' payslips') + '">Sent to TrinityHR ' +
          esc(E.fmtShort(new Date(sent.at))) + '</span>' : '';
      })();
  }

  function renderStats() {
    var t = state.run.totals;
    var mgr = state.runEmployees.filter(function (e) { return e.employmentClass === 'manager'; }).length;
    var rf = state.runEmployees.length - mgr;
    var due = [];
    if (t.sss) due.push('SSS');
    if (t.philhealth) due.push('PhilHealth');
    if (t.pagibig) due.push('HDMF');

    $('#statRow').innerHTML = [
      stat('Employees', state.runEmployees.length, mgr + ' managers · ' + rf + ' rank-and-file'),
      stat('Gross pay', peso(t.grossPay), 'incl. OT, ND, holiday & allowances', 'accent'),
      stat('OT + night diff.', peso(t.otPay + t.ndPay), peso(t.otPay) + ' OT · ' + peso(t.ndPay) + ' ND'),
      stat('Gov’t contributions', peso(t.sss + t.philhealth + t.pagibig),
        due.length ? 'employee share — ' + due.join(', ') + ' due this payout' : 'none due on this payout'),
      stat('Withholding tax', peso(t.tax), 'BIR semi-monthly table'),
      stat('Net pay', peso(t.netPay), 'total payout on ' + E.fmtShort(E.parseYmd(state.period.payoutDate)), 'green'),
      stat('Cost to company', peso(t.costToCompany), 'gross + employer share')
    ].join('');
  }

  function stat(k, v, n, cls) {
    return '<div class="stat ' + (cls || '') + '"><div class="k">' + esc(k) + '</div>' +
      '<div class="v">' + (typeof v === 'string' ? v : esc(v)) + '</div>' +
      '<div class="n">' + esc(n) + '</div></div>';
  }

  function renderHolidayNotice() {
    var hols = E.holidaysInPeriod(state.period, state.holidays, state.settings);
    var box = $('#holidayNotice');
    if (!hols.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<div class="notice info"><strong>Holidays in this cutoff</strong> — ' +
      'tick the days actually worked in the <em>Hol R / S</em> column to add the premium.<ul>' +
      hols.map(function (h) {
        return '<li>' + esc(h.display) + ' — ' + esc(h.name) +
          ' <span class="pill ' + (h.type === 'regular' ? 'reg' : 'spc') + '">' +
          (h.type === 'regular' ? 'Regular' : 'Special non-working') + '</span>' +
          (h.onWorkday ? '' : ' <span class="muted">(falls on a rest day)</span>') + '</li>';
      }).join('') + '</ul></div>';
  }

  /* `money` grouped-formats the value; leave it off for hour and day counts,
     which are small and read better bare. */
  function dtrInput(emp, field, disabled, width, money) {
    var d = dtrFor(emp);
    var raw = d[field];
    if (d.posted) {
      disabled = 'posted';
      // Locked cells show what the payroll file says, not the timesheet.
      var POSTED_KEY = { transportationAllowance: 'travel', tendoPay: 'tendo', otherDeduction: 'other' };
      raw = d.posted[POSTED_KEY[field] || field];
    }
    var val = money ? amountValue(raw) : (raw === undefined || raw === null ? '' : raw);
    return '<input ' + (money ? 'type="text" inputmode="decimal" ' : 'type="number" step="0.01" min="0" ') +
      'data-emp="' + esc(emp.id) + '" data-field="' + esc(field) + '"' +
      (disabled === 'posted' ? ' disabled title="Imported payroll — the file\'s figures stand"'
        : disabled ? ' disabled title="Managers are exempt under Art. 82"' : '') +
      ' value="' + esc(val) + '" placeholder="0"' +
      ' style="width:' + (width || 56) + 'px">';
  }

  function remarksInput(emp) {
    var d = dtrFor(emp);
    var v = d.posted ? d.posted.remarks : d.remarks;
    return '<input type="text" data-emp="' + esc(emp.id) + '" data-field="remarks" value="' +
      esc(v || '') + '"' + (d.posted ? ' disabled' : '') + ' style="width:160px">';
  }

  /** What the quarterly bonus is for; printed under it on the payslip. */
  function bonusDetailsInput(emp) {
    var d = dtrFor(emp);
    var v = d.posted ? d.posted.bonusDetails : d.bonusDetails;
    return '<input type="text" data-emp="' + esc(emp.id) + '" data-field="bonusDetails" value="' +
      esc(v || '') + '"' + (d.posted ? ' disabled' : '') + ' placeholder="details" style="width:120px;margin-top:4px">';
  }

  function cellIn(cls, html) { return '<td class="' + cls + '">' + html + '</td>'; }

  /**
   * The salary adjustment column. Three states worth distinguishing:
   *
   *   in force   the raised rate drives this cutoff; shows the working-day
   *              split when the effectivity date lands inside it
   *   pending    encoded, but effective a later cutoff — shown greyed rather
   *              than omitted, so a raise that is on file but not yet paid
   *              does not read as a missing raise
   *   none       nothing encoded
   *
   * Read-only: the amount and its date come from the template import, which
   * is the only place they can be set.
   */
  function adjCell(s, emp) {
    var a = s.adjustment;
    var amt = E.num(emp.salaryAdjustment);
    var eff = String(emp.salaryAdjustmentEffective || '');
    var dated = /^\d{4}-\d{2}-\d{2}$/.test(eff);

    /* Say what the engine is doing with these two fields, because several of
       the outcomes are silent otherwise — an amount with no date, or a date so
       late in the cutoff that no working day falls on it, are both ignored. */
    var note = '', cls = '';
    if (a && a.applies) {
      note = a.prorated
        ? 'in force · ' + a.workDaysAtNew + '/' + a.workDaysTotal + ' days'
        : 'in force all cutoff';
    } else if (amt && !dated) {
      note = 'needs a date';
      cls = ' warn';
    } else if (amt && dated && eff > state.period.end) {
      note = 'takes effect ' + esc(E.fmtShort(E.parseYmd(eff)));
      cls = ' pending';
    } else if (amt && dated) {
      note = 'starts next cutoff';
      cls = ' pending';
    }

    return '<td class="num adj' + cls + '">' +
      '<input type="text" inputmode="decimal" data-adj-emp="' + esc(emp.id) + '"' +
        ' value="' + esc(amt ? plain(amt) : '') + '" placeholder="0.00"' +
        ' title="Increase added to the monthly rate from its effectivity date. Use a negative for a decrease.">' +
      '<input type="date" data-adjeff-emp="' + esc(emp.id) + '"' +
        ' value="' + esc(dated ? eff : '') + '" title="Effective date — the adjustment applies from here onward.">' +
      (note ? '<div class="muted" style="font-size:11px">' + note + '</div>' : '') +
      '</td>';
  }

  /** Amount added on top of a manually typed cell (loan amortisation, recurring items). */
  function autoNote(amount, label) {
    if (!amount) return '';
    return '<div class="auto-note">+' + plain(amount) + ' ' + esc(label) + '</div>';
  }

  function renderRunTable() {
    var body = state.run.slips.map(function (s) {
      var emp = s.employee;
      var mgr = emp.employmentClass === 'manager';
      var e = s.earnings, c = s.contributions, t = s.tax;

      return '<tr' + sortAttrs(emp, s) + '>' +
        // ---- employee ----
        '<td class="sticky-col"><strong>' + esc(emp.lastName + ', ' + emp.firstName) + '</strong>' +
          '<div class="muted" style="font-size:11.5px">' + esc(emp.id) + ' · ' + esc(emp.position) + '</div></td>' +
        '<td class="num rate"><input type="text" inputmode="decimal" data-rate-emp="' + esc(emp.id) + '"' +
          (s.posted ? ' disabled' : '') +
          ' value="' + esc(plain(emp.monthlyRate)) + '" title="Monthly basic rate — edit to recompute everything">' +
          '<div class="muted" style="font-size:11px">' + plain(s.rates.daily) + '/day · ' +
          plain(s.rates.hourly) + '/hr</div></td>' +
        adjCell(s, emp) +

        // ---- timesheet ----
        cellIn('dtr', dtrInput(emp, 'absentDays')) +
        cellIn('dtr', dtrInput(emp, 'ptoDays')) +
        cellIn('dtr', dtrInput(emp, 'lateMinutes')) +
        cellIn('dtr', dtrInput(emp, 'undertimeMinutes')) +
        cellIn('dtr', dtrInput(emp, 'otHours', mgr)) +
        cellIn('dtr', dtrInput(emp, 'otRestSpecialHours', mgr)) +
        cellIn('dtr', dtrInput(emp, 'otRegHolidayHours', mgr)) +
        cellIn('dtr', dtrInput(emp, 'ndHours', mgr)) +
        cellIn('dtr', dtrInput(emp, 'restDayHours', mgr)) +
        cellIn('dtr', '<div class="pair">' + dtrInput(emp, 'regHolidayDays', mgr, 42) +
          dtrInput(emp, 'specialHolidayDays', mgr, 42) + '</div>') +

        // ---- allowances ----
        cellIn('alw', dtrInput(emp, 'transportationAllowance', false, 92, true)) +
        cellIn('alw', dtrInput(emp, 'travelDeduction', false, 92, true)) +
        cellIn('alw', dtrInput(emp, 'exMilestones', false, 92, true)) +
        // Computed, never typed: the standard amount, prorated by working days
        // when the start date lands inside the cutoff.
        '<td class="num' + (e.deMinimis ? '' : ' zero') + '">' + plain(e.deMinimis) +
          (e.deMinimisProrated
            ? '<div class="auto-note">' + e.deMinimisAuto.workDaysOnStaff + '/' +
              e.deMinimisAuto.workDaysTotal + ' days of ' + plain(e.deMinimisAuto.full) + '</div>'
            : '') + '</td>' +
        cellIn('alw', dtrInput(emp, 'quarterlyBonus', false, 92, true) + bonusDetailsInput(emp)) +

        // ---- earnings ----
        '<td class="num' + (e.regularPay ? '' : ' zero') + '">' + plain(e.regularPay) +
          (e.prorationDeduction ? '<div class="auto-note">−' + plain(e.prorationDeduction) + ' ' +
            e.staffDays.onStaff + '/' + e.staffDays.total + ' days on staff</div>' : '') + '</td>' +
        money(e.otPay) +
        money(e.ndPay) +
        money(e.holidayPay + e.restDayPay) +
        money(e.transportationAllowance) +
        '<td class="num strong">' + plain(e.grossPay) + '</td>' +

        // ---- mandatories ----
        money(c.sss) + money(c.philhealth) + money(c.pagibig) +
        '<td class="num">' + plain(t.incomeAfterMandatories) + '</td>' +
        '<td class="num">' + plain(t.taxableIncome) + '</td>' +

        // ---- tax & deductions ----
        money(t.withholding) +
        cellIn('dedin', dtrInput(emp, 'tendoPay', false, 88, true)) +
        cellIn('dedin', dtrInput(emp, 'sssLoan', false, 88, true) + autoNote(s.postTax.sssLoanAuto, 'loan')) +
        cellIn('dedin', dtrInput(emp, 'hmo', false, 88, true)) +
        cellIn('dedin', dtrInput(emp, 'classPass', false, 88, true)) +
        cellIn('dedin', dtrInput(emp, 'otherDeduction', false, 88, true) +
          autoNote(s.postTax.otherLoanAuto + s.totalOtherDeductions, 'auto')) +
        cellIn('dedin', dtrInput(emp, 'reimbursement', false, 88, true)) +

        // ---- net ----
        '<td class="num net">' + plain(s.totals.netPay) + '</td>' +
        '<td>' + remarksInput(emp) + '</td>' +
        '<td><button class="btn ghost tiny" data-payslip="' + esc(emp.id) + '" type="button">Payslip</button></td>' +
        '</tr>';
    }).join('');

    $('#runBody').innerHTML = body;
    applySort('run');

    var sum = {};
    ['regularPay','otPay','ndPay','holRest','travel','gross','sss','phic','hdmf',
     'afterMand','netTaxable','tax','tendo','sssLoan','hmo','classPass','other','reimb','net']
      .forEach(function (k) { sum[k] = 0; });

    state.run.slips.forEach(function (s) {
      var e = s.earnings, c = s.contributions, t = s.tax, p = s.postTax;
      sum.regularPay += e.regularPay; sum.otPay += e.otPay; sum.ndPay += e.ndPay;
      sum.holRest += e.holidayPay + e.restDayPay; sum.travel += e.transportationAllowance;
      sum.gross += e.grossPay;
      sum.sss += c.sss; sum.phic += c.philhealth; sum.hdmf += c.pagibig;
      sum.afterMand += t.incomeAfterMandatories; sum.netTaxable += t.taxableIncome;
      sum.tax += t.withholding;
      sum.tendo += p.tendoPay; sum.sssLoan += p.sssLoan; sum.hmo += p.hmo; sum.classPass += p.classPass;
      sum.other += p.otherDeduction + s.totalOtherDeductions; sum.reimb += p.reimbursement;
      sum.net += s.totals.netPay;
    });

    $('#runFoot').innerHTML = '<tr>' +
      '<td colspan="18">TOTAL — ' + state.runEmployees.length + ' employees</td>' +
      '<td class="num">' + plain(sum.regularPay) + '</td>' +
      '<td class="num">' + plain(sum.otPay) + '</td>' +
      '<td class="num">' + plain(sum.ndPay) + '</td>' +
      '<td class="num">' + plain(sum.holRest) + '</td>' +
      '<td class="num">' + plain(sum.travel) + '</td>' +
      '<td class="num">' + plain(sum.gross) + '</td>' +
      '<td class="num">' + plain(sum.sss) + '</td>' +
      '<td class="num">' + plain(sum.phic) + '</td>' +
      '<td class="num">' + plain(sum.hdmf) + '</td>' +
      '<td class="num">' + plain(sum.afterMand) + '</td>' +
      '<td class="num">' + plain(sum.netTaxable) + '</td>' +
      '<td class="num">' + plain(sum.tax) + '</td>' +
      '<td class="num">' + plain(sum.tendo) + '</td>' +
      '<td class="num">' + plain(sum.sssLoan) + '</td>' +
      '<td class="num">' + plain(sum.hmo) + '</td>' +
      '<td class="num">' + plain(sum.classPass) + '</td>' +
      '<td class="num">' + plain(sum.other) + '</td>' +
      '<td class="num">' + plain(sum.reimb) + '</td>' +
      '<td class="num net">' + plain(sum.net) + '</td>' +
      '<td></td><td></td></tr>';
  }

  function renderEmployerTable() {
    $('#employerBody').innerHTML = state.run.slips.map(function (s) {
      var er = s.contributions.employer;
      return '<tr>' +
        '<td class="sticky-col">' + esc(s.employee.lastName + ', ' + s.employee.firstName) + '</td>' +
        money(er.sss) + money(er.sssEC) + money(er.philhealth) + money(er.pagibig) +
        money(s.totalEmployerCost) +
        '<td class="num">' + plain(s.totals.employerShare) + '</td>' +
        '<td class="num strong">' + plain(s.totals.costToCompany) + '</td>' +
        '</tr>';
    }).join('');

    var sum = { sss: 0, ec: 0, phic: 0, hdmf: 0, other: 0, share: 0, cost: 0 };
    state.run.slips.forEach(function (s) {
      var er = s.contributions.employer;
      sum.sss += er.sss; sum.ec += er.sssEC; sum.phic += er.philhealth; sum.hdmf += er.pagibig;
      sum.other += s.totalEmployerCost; sum.share += s.totals.employerShare; sum.cost += s.totals.costToCompany;
    });

    $('#employerFoot').innerHTML = '<tr><td>TOTAL</td>' +
      '<td class="num">' + plain(sum.sss) + '</td>' +
      '<td class="num">' + plain(sum.ec) + '</td>' +
      '<td class="num">' + plain(sum.phic) + '</td>' +
      '<td class="num">' + plain(sum.hdmf) + '</td>' +
      '<td class="num">' + plain(sum.other) + '</td>' +
      '<td class="num">' + plain(sum.share) + '</td>' +
      '<td class="num">' + plain(sum.cost) + '</td></tr>';
  }

  /* ---------------------- timesheet input handling ---------------------- */
  function onDtrInput(ev) {
    var el = ev.target;
    if (!el.matches) return;

    // Monthly rate edited straight from the payroll run — every downstream
    // figure (daily, hourly, OT, SSS/PhilHealth/HDMF, tax) recomputes.
    if (el.matches('input[data-rate-emp]')) {
      var target = state.employees.filter(function (e) { return e.id === el.dataset.rateEmp; })[0];
      if (!target) return;
      target.monthlyRate = parseAmount(el.value);
      persist();
      renderRun();
      return;
    }

    // Salary adjustment — amount and effectivity date, both stored on the
    // employee so they keep applying to later cutoffs without re-encoding.
    if (el.matches('input[data-adj-emp]') || el.matches('input[data-adjeff-emp]')) {
      var id = el.dataset.adjEmp || el.dataset.adjeffEmp;
      var who = state.employees.filter(function (e) { return e.id === id; })[0];
      if (!who) return;
      if (el.dataset.adjEmp !== undefined) {
        who.salaryAdjustment = parseSigned(el.value);
      } else {
        var v = String(el.value).trim();
        who.salaryAdjustmentEffective = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
      }
      persist();
      renderRun();
      return;
    }

    if (!el.matches('input[data-emp][data-field]')) return;

    var emp = state.employees.filter(function (e) { return e.id === el.dataset.emp; })[0];
    if (!emp) return;
    var d = dtrFor(emp);
    var field = el.dataset.field;
    var typed = String(el.value).trim();
    var raw = typed === '' ? null : field === 'remarks' || field === 'bonusDetails' ? typed : parseAmount(typed);
    d[field] = raw;

    // Overtime after 7PM: the first 3 hours are OT only, anything past 10PM is
    // also night differential. Auto-suggest ND until the user overrides it.
    if (field === 'otHours' && !d.ndManual) {
      d.ndHours = raw === null ? null : E.suggestNdHours(raw, state.settings) || null;
    }
    if (field === 'ndHours') d.ndManual = true;

    Store.saveDtr(state.dtr);
    renderRun();
  }

  function clearDtr() {
    if (!confirm('Clear all timesheet entries for this cutoff?')) return;
    state.employees.forEach(function (e) { delete state.dtr[dtrKey(e)]; });
    Store.saveDtr(state.dtr);
    renderRun();
  }

  /* ----------------------------- CSV export ----------------------------- */
  function exportCsv() {
    var cols = window.PayrollTemplate.COLUMNS;
    var head = cols.map(function (c) { return c.head; });
    var rows = state.run.slips.map(function (s, i) {
      var e = s.earnings, c = s.contributions, er = c.employer, d = s.dtr, t = s.tax, p = s.postTax;
      var v = {
        no: i + 1, id: s.employee.id, name: s.employee.lastName + ', ' + s.employee.firstName,
        position: s.employee.position, department: s.employee.department,
        rate: s.rates.monthly, payPeriod: s.period.payPeriodNo,
        regularPay: s.rates.semiMonthly, otHours: d.otHours, otPay: e.otPay,
        ndHours: d.ndHours, ndPay: e.ndPay,
        deMinimis: E.r2(e.deMinimis + e.deMinimisDeduction), quarterlyBonus: e.quarterlyBonus,
        bonusDetails: e.quarterlyBonusDetails || '', sssLoan: p.sssLoan, classPass: p.classPass,
        travel: e.transportationGiven, absentDays: d.absentDays + d.unpaidLeaveDays,
        absenceDeduction: e.absenceDeduction, lateMinutes: d.lateMinutes,
        lateDeduction: e.lateDeduction, undertimeMinutes: d.undertimeMinutes,
        undertimeDeduction: e.undertimeDeduction, prorationDeduction: e.prorationDeduction,
        dmDeduction: e.deMinimisDeduction, travelDeduction: e.travelDeduction,
        gross: e.grossPay, sss: c.sss, phic: c.philhealth, hdmf: c.pagibig,
        afterMandatories: t.incomeAfterMandatories, netTaxable: t.taxableIncome, tax: t.withholding,
        tendo: p.tendoPay, hmo: p.hmo,
        other: E.r2(p.otherDeduction + s.totalOtherDeductions - p.reimbursement),
        net: s.totals.netPay, sssER: er.sss, hdmfER: er.pagibig, phicER: er.philhealth, ec: er.sssEC,
        remarks: s.remarks || ''
      };
      return cols.map(function (c) { return v[c.key]; });
    });

    var meta = [
      ['Company Name: ' + state.settings.company.name],
      ['Payroll | ' + window.PayrollTemplate.cutoffTitle(state.period)]
    ];

    var csv = meta.concat([head]).concat(rows).map(function (r) {
      return r.map(function (cell) {
        var v = cell === null || cell === undefined ? '' : String(cell);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\n');

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'payroll-summary-' + state.period.id + '.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }


  /* ------------------------- BPI bank file (.xls) -------------------------
     BPI BizLink's "Pay BPI Accounts — Lumpsum" upload: an H row with the
     totals and the funding account, a header row, then one D row per
     person: BPI account, net pay, remarks, and the name in H. Everyone with
     net pay goes in, even without a 10-digit BPI account; those rows are
     listed after the download to fix in the file before uploading. */
  function isBpi(emp) {
    return /\bbpi\b|philippine island/i.test(emp.bankName || '');
  }
  function exportBpi() {
    var funding = String(state.settings.company.bpiFundingAccount || '').replace(/\D/g, '');
    if (!funding) {
      alert('Add the BPI funding account first: Settings & Rules \u2192 Company \u2192 BPI funding account.');
      return;
    }
    var remarks = 'Salary ' + window.PayrollTemplate.cutoffTitle(state.period);
    var rows = [], check = [];
    state.run.slips.forEach(function (s) {
      var emp = s.employee, who = emp.lastName + ', ' + emp.firstName;
      var acct = String(emp.bankAccountNo || '').replace(/\D/g, ''), net = E.r2(s.totals.netPay);
      if (!(net > 0)) {
        // Deductions bigger than pay: nothing can be sent, but say so.
        if (net < 0) check.push(who + ' \u2014 net pay is negative (' + peso(net) + '), not in the file');
        return;
      }
      if (isBpi(emp) && acct.length === 9) acct = '0' + acct;   // leading 0 lost when the 201 sheet stored it as a number
      if (!isBpi(emp)) check.push(who + ' \u2014 ' + (emp.bankName || 'no bank') + ', ' + peso(net));
      else if (acct.length !== 10) check.push(who + ' \u2014 BPI account number is not 10 digits, ' + peso(net));
      rows.push({ acct: acct, net: net, name: who });
    });
    if (!rows.length) { alert('Nobody on this cutoff has net pay to send.'); return; }

    window.XlsxWriter.loadSheetJs().then(function (XL) {
      var total = E.r2(rows.reduce(function (t, r) { return t + r.net; }, 0));
      var str = function (v) { return { t: 's', v: v }; };
      var ws = {
        A1: str('H'), B1: str('Total Amount:'),
        C1: { t: 'n', v: total, f: 'SUM(C3:C9993)', z: '#,##0.00' },
        D1: str('Total Count:'), E1: { t: 'n', v: rows.length, f: 'COUNTA(C3:C9993)' },
        F1: str('FUNDING ACCOUNT'), G1: str(funding),
        A2: str('DETAIL CONSTANT'), B2: str('BENEFICIARY ACCOUNT'), C2: str('AMOUNT'), D2: str('REMARKS'),
        H2: str('NAME')
      };
      rows.forEach(function (r, i) {
        var n = i + 3;
        ws['A' + n] = str('D');
        ws['B' + n] = str(r.acct);   // text, so leading zeros stay
        ws['C' + n] = { t: 'n', v: r.net, z: '#,##0.00' };
        ws['D' + n] = str(remarks);
        ws['H' + n] = str(r.name);   // for checking only; past the columns BizLink reads
      });
      ws['!ref'] = 'A1:H' + (rows.length + 2);
      ws['!cols'] = [20.5, 21.8, 20.4, 20.4, 20.4, 20.5, 20.4, 30].map(function (w) { return { wch: w }; });
      var wb = XL.utils.book_new();
      XL.utils.book_append_sheet(wb, ws, 'Sheet1');
      var out = XL.write(wb, { bookType: 'biff8', type: 'array' });
      window.XlsxWriter.download(new Blob([out], { type: 'application/vnd.ms-excel' }),
        'BizLink_Pay BPI Accounts Lumpsum - ' + state.period.id + '.xls');
      if (check.length) {
        alert(rows.length + ' people, ' + peso(total) + ', are in the file.\n\nCheck these rows before uploading \u2014 ' +
          'BizLink may reject them (' + check.length + '):\n  ' + check.join('\n  '));
      }
    }).catch(function (err) { alert('Could not make the BPI file.\n\n' + err.message); });
  }


  /* =====================================================================
     TEMPLATE — download and re-import
     ===================================================================== */
  function downloadTemplate() {
    var blob = window.PayrollTemplate.build(
      state.runEmployees, state.period, state.dtr, state.settings, state.run);
    var name = 'Payroll Template — ' + state.settings.company.name + ' — ' +
      state.period.id + '.xlsx';
    window.XlsxWriter.download(blob, name.replace(/[\\/:*?"<>|]/g, '-'));
  }

  /** The cutoff that opens on `start` (YYYY-MM-DD), from any nearby year. */
  function periodStarting(start) {
    var y = parseInt(start.slice(0, 4), 10), hit = null;
    [y, y + 1, y - 1].forEach(function (yy) {
      if (hit) return;
      hit = E.buildPeriods(yy).filter(function (p) { return p.start === start; })[0] || null;
    });
    return hit;
  }

  /** The cutoff paid on `payout` (YYYY-MM-DD). */
  function periodPaidOn(payout) {
    return E.buildPeriods(parseInt(payout.slice(0, 4), 10))
      .filter(function (p) { return p.payoutDate === payout; })[0] || null;
  }

  /* A payroll file names people in full — "Jamie Liane Sandoval Aclan" —
     where the roster has first and last name only. Someone matches when
     every word of their roster name is in the file's name, and only one
     person on the roster does. */
  function findByName(fileName) {
    var have = {};
    nameTokens(fileName).split(' ').forEach(function (w) { if (w) have[w] = true; });
    var hits = state.employees.filter(function (e) {
      var words = nameTokens((e.firstName || '') + ' ' + (e.lastName || '')).split(' ').filter(Boolean);
      return words.length >= 2 && words.every(function (w) { return have[w]; });
    });
    return hits.length === 1 ? hits[0] : null;
  }

  /* "Jamie Liane Sandoval Aclan" → first "Jamie Liane Sandoval", last
     "Aclan". Particles stay with the surname (Dela Cruz, De Los Santos) and
     suffixes with the word before them (Babasa II). */
  function personFromPayroll(row) {
    var words = String(row.name).trim().split(/\s+/);
    var lastStart = words.length - 1;
    if (lastStart > 0 && /^(jr\.?|sr\.?|i{1,3}|iv|v)$/i.test(words[lastStart])) lastStart--;
    while (lastStart > 1 && /^(de|del|dela|della|delos|de los|la|las|los|san|sta\.?|santa|van|von|da|di|du|le)$/i.test(words[lastStart - 1])) lastStart--;
    if (lastStart < 1) lastStart = words.length > 1 ? words.length - 1 : 0;
    return {
      id: String(row.id).trim(),
      hrEmployeeId: String(row.id).trim(),
      firstName: words.slice(0, lastStart).join(' '),
      lastName: words.slice(lastStart).join(' '),
      position: row.position || '', department: row.department || '',
      employmentClass: 'rank_file', monthlyRate: 0, items: [], loans: [],
      addedFromPayroll: true
    };
  }

  function nameTokens(s) {
    return String(s || '').toLowerCase().replace(/[^a-zñ\s]/g, ' ').split(/\s+/)
      .filter(function (w) { return w.length > 1; }).sort().join(' ');
  }

  /* Payroll files, the downloaded template among them, one or many at once.
     For a cutoff whose payout date has passed, the file is the record of
     what was paid and its figures are kept as they are. For an upcoming
     cutoff the typed columns are taken and the site computes the rest. */
  function importPayroll(files) {
    var T = window.PayrollTemplate;
    Promise.all(files.map(function (f) {
      return T.parse(f).then(function (r) { return { file: f.name, r: r }; },
        function (err) { return { file: f.name, err: err }; });
    })).then(function (results) {
      var plan = planPayroll(results);
      if (!plan.ops.length) {
        alert('Nothing to import.\n\n' + plan.problems.slice(0, 8).join('\n'));
        return;
      }
      askPayroll(plan, function () { applyPayroll(plan, results.length); });
    });
  }

  /* Works out everything an import would do — which cutoff each sheet
     fills, who is matched or new — without changing anything, so it can
     be shown and confirmed first. */
  function planPayroll(results) {
    var T = window.PayrollTemplate;
    var byId = {}, byName = {};
    state.employees.forEach(function (e) {
      byId[String(e.id).toLowerCase()] = e;
      byName[nameTokens((e.firstName || '') + ' ' + (e.lastName || ''))] = e;
      if (e.hrEmployeeId) byId[String(e.hrEmployeeId).toLowerCase()] = e;
    });
    var today = E.ymd(new Date());
    var plan = { ops: [], problems: [], unmatched: {}, added: [], cutoffs: {} };

    results.forEach(function (res) {
      if (res.err) { plan.problems.push(res.file + ': ' + (res.err.message || res.err)); return; }
      res.r.warnings.forEach(function (w) { plan.problems.push(res.file + ' — ' + w); });
      res.r.sheets.forEach(function (sh) {
        var where = res.file + (res.r.sheets.length > 1 ? ' [' + sh.sheet + ']' : '');
        var cutoff = sh.cutoff;
        if (cutoff && cutoff.payout) {
          var byPayout = periodPaidOn(cutoff.payout);
          if (cutoff.titled && cutoff.titled.start && byPayout && cutoff.titled.start !== byPayout.start) {
            plan.problems.push(where + ': the title says ' + sh.title.replace(/^.*?:\s*/, '') +
              ', but the file name is for the ' + E.fmtShort(E.parseYmd(cutoff.payout)) + ' ' +
              cutoff.payout.slice(0, 4) + ' payout — read as ' + T.cutoffTitle(byPayout) + '.');
          }
          cutoff = byPayout ? { start: byPayout.start } : cutoff.titled;
        }
        if (!cutoff) {
          plan.problems.push(where + ': could not tell which cutoff it is — row 2 should read like ' +
            '"Payroll | January 1 - 15, 2026", or the file name should carry the payout date ' +
            '("… 2026 0125 …"). Skipped.');
          return;
        }
        sh.rows.forEach(function (row) {
          var start = cutoff.start;
          if (!start) {
            var pp = row.values.payPeriod;
            if (pp !== 1 && pp !== 2) {
              plan.problems.push(where + ' row ' + row.line + ': title gives only the month and PAY PERIOD is blank. Skipped.');
              return;
            }
            start = cutoff.year + '-' + ('0' + cutoff.month).slice(-2) + (pp === 2 ? '-01' : '-16');
          }
          var period = periodStarting(start);
          if (!period) { plan.problems.push(where + ': no cutoff starts on ' + start + '. Skipped.'); return; }

          var emp = byId[String(row.id || '').toLowerCase()] || byName[nameTokens(row.name)] ||
            findByName(row.name);
          /* Someone in Trinity's payroll register is on Trinity's payroll,
             whatever the roster says — the 201 import may simply not have
             ticked their company. They are added from the file; a later
             201 import matches them by Employee ID and corrects the rest. */
          if (!emp && row.id && row.name) {
            emp = personFromPayroll(row);
            byId[String(emp.id).toLowerCase()] = emp;
            plan.added.push(emp);
          }
          if (!emp) { plan.unmatched[(row.id || '?') + ' — ' + (row.name || '')] = true; return; }

          var v = row.values;
          var posted = period.payoutDate <= today && v.gross !== undefined && v.net !== undefined;
          var c = plan.cutoffs[period.id] = plan.cutoffs[period.id] ||
            { period: period, sources: {}, people: {}, posted: false };
          c.sources[where] = true;
          c.people[emp.id] = true;
          if (posted) c.posted = true;
          plan.ops.push({ period: period, emp: emp, row: row, posted: posted, where: where });
        });
      });
    });
    return plan;
  }

  /* The preview: every cutoff the files fill, and what is there now. */
  function askPayroll(plan, done) {
    var T = window.PayrollTemplate;
    var ids = Object.keys(plan.cutoffs).sort();
    var lines = ids.map(function (id) {
      var c = plan.cutoffs[id], n = Object.keys(c.people).length;
      var prefix = id + '|', had = {}, hadSource = {};
      Object.keys(state.dtr).forEach(function (k) {
        if (k.lastIndexOf(prefix, 0) !== 0) return;
        var d = state.dtr[k];
        if (d && d.posted) { had[k.slice(prefix.length)] = true; hadSource[d.posted.source || 'an earlier import'] = true; }
      });
      var hadN = Object.keys(had).length;
      var gone = Object.keys(had).filter(function (eid) { return !c.people[eid]; }).length;
      var what = !c.posted ? 'upcoming — the typed columns are taken, the rest is computed'
        : hadN ? '<strong>replaces</strong> the import from ' + esc(Object.keys(hadSource).join(', ')) +
          ' (' + hadN + ' people)' + (gone ? ' — <strong>' + gone + ' no longer in the file are removed from this cutoff</strong>' : '')
        : 'new';
      return '<li><strong>' + esc(T.cutoffTitle(c.period)) + '</strong> — ' + n + ' people from ' +
        esc(Object.keys(c.sources).join(', ')) + '<br><span class="muted">' + what + '</span></li>';
    });
    var um = Object.keys(plan.unmatched);
    $('#importModeTitle').textContent = 'Import payroll';
    $('#importModeBody').innerHTML =
      '<p class="hint" style="display:block;margin-bottom:10px">Only these cutoffs change. Every other cutoff stays exactly as it is.</p>' +
      '<ul style="margin:0 0 14px;padding-left:20px;font-size:13px;line-height:1.5">' + lines.join('') + '</ul>' +
      (plan.added.length ? '<p class="hint" style="display:block;margin-bottom:10px">' + plan.added.length +
        ' people in the files are not on the roster and will be added: ' +
        esc(plan.added.slice(0, 8).map(function (e) { return e.lastName + ', ' + e.firstName; }).join('; ')) +
        (plan.added.length > 8 ? ' …' : '') + '</p>' : '') +
      (um.length ? '<p class="hint" style="display:block;margin-bottom:10px">' + um.length + ' rows cannot be matched and will be skipped.</p>' : '') +
      (plan.problems.length ? '<div class="notice warn" style="margin-bottom:14px"><ul style="margin:0">' +
        plan.problems.slice(0, 6).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') +
        (plan.problems.length > 6 ? '<li>…and ' + (plan.problems.length - 6) + ' more</li>' : '') + '</ul></div>' : '') +
      '<button class="btn" data-go type="button">Import</button>';
    var modal = $('#importModeModal'), body = $('#importModeBody');
    modal.classList.remove('hidden');
    var close = function () {
      modal.classList.add('hidden');
      body.onclick = null;
      $('#importModeTitle').textContent = 'Import masterlist';
    };
    body.onclick = function (ev) {
      if (!ev.target.closest('[data-go]')) return;
      close();
      done();
    };
    $('#btnCancelImport').onclick = close;
  }

  function applyPayroll(plan, fileCount) {
    var T = window.PayrollTemplate;
    var perPeriod = {}, ratesFilled = [], rateChanges = [], latestRate = {};
    var postedRows = 0, inputRows = 0, removedRows = 0, lastSeen = {}, latestCutoff = null;

    plan.added.forEach(function (e) { state.employees.push(e); });

    /* A cutoff imported from a payroll file is replaced as a whole: anyone
       the earlier import of it had but this file does not is taken out of
       it, so a corrected file leaves nothing stale behind. No other cutoff
       is touched. */
    Object.keys(plan.cutoffs).forEach(function (id) {
      var c = plan.cutoffs[id];
      if (!c.posted) return;
      var prefix = id + '|';
      Object.keys(state.dtr).forEach(function (k) {
        if (k.lastIndexOf(prefix, 0) === 0 && state.dtr[k] && state.dtr[k].posted &&
            !c.people[k.slice(prefix.length)]) {
          delete state.dtr[k];
          removedRows++;
        }
      });
    });

    plan.ops.forEach(function (op) {
      var period = op.period, emp = op.emp, row = op.row, v = row.values;
      var key = period.id + '|' + emp.id;
      var d = state.dtr[key] || {};
      if (!lastSeen[emp.id] || lastSeen[emp.id] < period.end) lastSeen[emp.id] = period.end;
      if (!latestCutoff || latestCutoff < period.end) latestCutoff = period.end;

      if (op.posted) {
        var P = {};
        Object.keys(v).forEach(function (k) { P[k] = v[k]; });
        if (P.rate === undefined) P.rate = E.num(emp.monthlyRate);
        P.remarks = row.remarks || '';
        P.bonusDetails = row.bonusDetails || '';
        P.source = op.where;
        d = { posted: P };
        postedRows++;
      } else {
        delete d.posted;
        T.COLUMNS.forEach(function (c) {
          if (!c.input || c.input === 'remarks' || c.input === 'bonusDetails' || c.input === 'otherDeduction') return;
          if (v[c.key] === undefined) delete d[c.input];
          else d[c.input] = v[c.key];
        });
        delete d.lateHours;   // now counted in minutes
        d.remarks = row.remarks || null;
        d.bonusDetails = row.bonusDetails || null;
        // SSS LOAN and OTHER DEDUCTION were written out with the loan ledger
        // and recurring deductions in them; take those back out to leave
        // what was typed. A file without SSS LOAN has it inside OTHER.
        if (v.other !== undefined || v.sssLoan !== undefined) {
          if (v.sssLoan !== undefined) d.sssLoan = null;
          d.otherDeduction = null;
          var probe = E.computePayslip(emp, period, d, state.settings);
          var sssAuto = v.sssLoan !== undefined ? probe.postTax.sssLoanAuto : probe.postTax.sssLoan;
          if (v.sssLoan !== undefined) d.sssLoan = Math.max(0, E.r2(v.sssLoan - sssAuto)) || null;
          if (v.other !== undefined) {
            var auto = (v.sssLoan !== undefined ? 0 : sssAuto) + probe.postTax.otherLoanAuto + probe.totalOtherDeductions;
            d.otherDeduction = Math.max(0, E.r2(v.other - auto)) || null;
          }
        }
        if (v.ndHours !== undefined) d.ndManual = true;
        if (v.rate && v.rate !== E.num(emp.monthlyRate) && E.num(emp.monthlyRate)) {
          rateChanges.push((emp.lastName || '') + ', ' + (emp.firstName || '') + ': ' +
            plain(E.num(emp.monthlyRate)) + ' → ' + plain(v.rate));
          emp.monthlyRate = v.rate;
        }
        inputRows++;
      }
      state.dtr[key] = d;
      perPeriod[period.id] = (perPeriod[period.id] || 0) + 1;
      if (v.rate && (!latestRate[emp.id] || latestRate[emp.id].payout < period.payoutDate)) {
        latestRate[emp.id] = { payout: period.payoutDate, rate: v.rate };
      }
    });

    /* A last day the site worked out from earlier files gives way as soon as
       a later cutoff shows the person was still paid. */
    var reopened = [];
    state.employees.forEach(function (e) {
      if (e.endDateFromPayroll && lastSeen[e.id] && lastSeen[e.id] > e.endDate) {
        e.endDate = '';
        e.endDateFromPayroll = false;
        reopened.push(e);
      }
    });
    /* Added from these files with no 201 record: if they stop appearing
       before the latest cutoff imported, they left — the end of the last
       cutoff they were paid in stands as their last day until the 201
       File, or a later payroll file, says otherwise. */
    var leftByFiles = [];
    plan.added.forEach(function (e) {
      if (lastSeen[e.id] && latestCutoff && lastSeen[e.id] < latestCutoff) {
        e.endDate = lastSeen[e.id];
        e.endDateFromPayroll = true;
        leftByFiles.push(e);
      }
    });

    /* The current rate follows the newest payroll file: when this import
       holds someone's latest cutoff on file, their rate becomes that
       cutoff's rate, so a salary change carries forward. An older file
       never moves it. */
    state.employees.forEach(function (e) {
      var lr = latestRate[e.id];
      if (!lr) return;
      var newest = true, suffix = '|' + e.id;
      Object.keys(state.dtr).forEach(function (k) {
        if (k.slice(-suffix.length) !== suffix || !state.dtr[k] || !state.dtr[k].posted) return;
        var pid = k.slice(0, -suffix.length);
        var p = E.buildPeriods(parseInt(pid.slice(0, 4), 10)).filter(function (x) { return x.id === pid; })[0];
        if (p && p.payoutDate > lr.payout) newest = false;
      });
      if (!newest || Math.abs(E.num(e.monthlyRate) - lr.rate) < 0.005) return;
      if (!E.num(e.monthlyRate)) ratesFilled.push(e.id);
      else rateChanges.push((e.lastName || '') + ', ' + (e.firstName || '') + ': ' +
        plain(E.num(e.monthlyRate)) + ' → ' + plain(lr.rate) + ' (latest payroll file)');
      e.monthlyRate = lr.rate;
    });

    var ids = Object.keys(perPeriod).sort();
    if (ids.length) {
      var main = ids[ids.length - 1];
      var y = parseInt(main.slice(0, 4), 10);
      if (y !== state.year) { state.year = y; $('#yearSelect').value = String(y); refreshPeriods(main); }
      else {
        state.period = state.periods.filter(function (p) { return p.id === main; })[0] || state.period;
        $('#periodSelect').value = state.period.id;
      }
    }
    persist();
    renderRun();
    switchTab('run');

    var msg = ['Payroll import — ' + fileCount + ' file' + (fileCount === 1 ? '' : 's') + '. Only these cutoffs changed:'];
    ids.forEach(function (id) {
      msg.push('  ' + T.cutoffTitle(plan.cutoffs[id].period) + ' — ' + perPeriod[id] + ' employee(s)');
    });
    if (postedRows) msg.push('\n' + postedRows + ' row(s) from past payouts kept exactly as in the file.');
    if (removedRows) msg.push(removedRows + ' row(s) from an earlier import of these cutoffs were removed — those people are not in the new file.');
    if (inputRows) msg.push(inputRows + ' row(s) for upcoming payouts: the typed columns were taken and the site computed the rest.');
    if (ratesFilled.length) msg.push('\nMonthly rate filled in for ' + ratesFilled.length +
      ' employee(s) who had none, from their latest cutoff in the files.');
    if (rateChanges.length) msg.push('\nCurrent monthly rate changed for ' + rateChanges.length + ':\n  ' +
      rateChanges.slice(0, 8).join('\n  ') + (rateChanges.length > 8 ? '\n  …' : ''));
    if (plan.added.length) msg.push('\nAdded ' + plan.added.length + ' employee(s) who are in the payroll ' +
      'files but were not on the roster' + (leftByFiles.length ? ' (' + leftByFiles.length +
      ' of them stop appearing before the latest cutoff, so their last day was set to the end of their last cutoff)' : '') +
      ':\n  ' + plan.added.slice(0, 12).map(function (e) {
        return e.id + ' — ' + e.lastName + ', ' + e.firstName;
      }).join('\n  ') + (plan.added.length > 12 ? '\n  …' : '') +
      '\nImporting the 201 File with their company ticked fills in the rest of their details.');
    if (reopened.length) msg.push('\n' + reopened.length + ' employee(s) had a last day worked out from earlier files ' +
      'but are paid in a later cutoff here, so it was cleared.');
    var um = Object.keys(plan.unmatched);
    if (um.length) msg.push('\nNot matched, so skipped (' + um.length + ') — check the EMPLOYEE ID:\n  ' +
      um.slice(0, 10).join('\n  ') + (um.length > 10 ? '\n  …' : ''));
    if (plan.problems.length) msg.push('\n' + plan.problems.slice(0, 8).join('\n') +
      (plan.problems.length > 8 ? '\n…and ' + (plan.problems.length - 8) + ' more.' : ''));
    alert(msg.join('\n'));
  }

  /* =====================================================================
     TRINITYHR — send the cutoff's payslips to each person's account
     ===================================================================== */
  function trinityPayload(slip) {
    var L = payslipLines(slip), emp = slip.employee, co = state.settings.company, per = slip.period;
    var line = function (r) { return { label: r.label, amount: r.amount === null ? null : E.r2(r.amount), kind: r.cls || null }; };
    return {
      email: String(emp.email || '').trim(),
      period_id: per.id,
      cutoff_start: per.start,
      cutoff_end: per.end,
      payout_date: per.payoutDate,
      lines: {
        earnings: L.earn.map(line),
        deductions: L.ded.map(line),
        net_taxable: E.r2(slip.tax.taxableIncome),
        company: { name: co.name, address: co.address, tin: co.tin },
        employee: { code: emp.id, position: emp.position || '', branch: co.branch }
      },
      gross_pay: L.totalEarnings,
      total_deductions: L.totalDeductions,
      net_pay: L.netPay,
      remarks: slip.remarks || null
    };
  }

  function sendToTrinity() {
    var cfg = Store.loadTrinity();
    var url = String(cfg.url || '').replace(/\/+$/, '');
    if (!url || !cfg.key) {
      alert('Set the TrinityHR address and payslip key under Settings & Rules first.');
      return;
    }
    var slips = state.run.slips;
    var noEmail = slips.filter(function (s) { return !/@/.test(String(s.employee.email || '')); });
    var sending = slips.filter(function (s) { return noEmail.indexOf(s) === -1; });
    var cut = window.PayrollTemplate.cutoffTitle(state.period);
    if (!sending.length) { alert('No one on ' + cut + ' has a work email, so there is nothing to send.'); return; }
    var prev = (cfg.sent || {})[state.period.id];
    if (!confirm('Send ' + sending.length + ' payslip' + (sending.length === 1 ? '' : 's') + ' for ' + cut +
        ' to TrinityHR?\n\nEach goes to the account with the same work email, under My Payslips.' +
        (prev ? '\nThis cutoff was sent on ' + prev.at.slice(0, 10) + ' — sending again replaces those payslips.' : '') +
        (noEmail.length ? '\n\n' + noEmail.length + ' without a work email will be skipped:\n  ' +
          noEmail.slice(0, 10).map(function (s) { return s.employee.lastName + ', ' + s.employee.firstName; }).join('\n  ') +
          (noEmail.length > 10 ? '\n  …' : '') : ''))) return;

    var btn = $('#btnSendTrinity');
    btn.disabled = true; btn.textContent = 'Sending…';
    var payslips = sending.map(trinityPayload);
    var chunks = [];
    for (var i = 0; i < payslips.length; i += 500) chunks.push(payslips.slice(i, i + 500));
    var total = { saved: 0, unmatched: [], invalid: [] };

    chunks.reduce(function (chain, chunk) {
      return chain.then(function () {
        return fetch(url + '/api/payslips/import', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + cfg.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ payslips: chunk })
        }).then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            if (!res.ok) throw new Error(res.status === 401 ? 'TrinityHR did not accept the payslip key.' : (body.error || 'TrinityHR answered ' + res.status));
            total.saved += body.saved || 0;
            total.unmatched = total.unmatched.concat(body.unmatched || []);
            total.invalid = total.invalid.concat(body.invalid || []);
          });
        });
      });
    }, Promise.resolve()).then(function () {
      cfg.sent = cfg.sent || {};
      cfg.sent[state.period.id] = { at: new Date().toISOString(), saved: total.saved };
      Store.saveTrinity(cfg);
      renderPeriodMeta();
      var msg = ['Sent to TrinityHR — ' + cut + '.', '\n' + total.saved + ' payslip(s) saved to employee accounts.'];
      if (total.unmatched.length) msg.push('\nNo TrinityHR account with these work emails (' + total.unmatched.length + '), so not saved:\n  ' +
        total.unmatched.slice(0, 15).join('\n  ') + (total.unmatched.length > 15 ? '\n  …' : ''));
      if (total.invalid.length) msg.push('\nRejected (' + total.invalid.length + '): ' +
        total.invalid.slice(0, 5).map(function (x) { return (x.email || '?') + ' — ' + x.reason; }).join('; '));
      if (noEmail.length) msg.push('\nSkipped ' + noEmail.length + ' without a work email.');
      alert(msg.join('\n'));
    }).catch(function (err) {
      alert('Could not send to TrinityHR.\n\n' + (err && err.message ? err.message : err) +
        (total.saved ? '\n\n' + total.saved + ' payslip(s) were saved before it stopped; sending again is safe.' : '') +
        (/fetch|network/i.test(String(err && err.message)) ? '\n\nCheck the TrinityHR address, and that TrinityHR allows this site (PAYSLIP_IMPORT_ORIGINS).' : ''));
    }).then(function () {
      btn.disabled = false; btn.textContent = 'Send to TrinityHR';
    });
  }

  /* =====================================================================
     PAYSLIP
     ===================================================================== */
  /* A payslip row. `amount` is signed for display; pass a negative to render
     a deduction. Zero prints as a plain 0.00 rather than -0.00. */
  function psRow(label, amount, cls) {
    var txt = amount === 0 ? plain(0) : (amount < 0 ? '-' + plain(-amount) : plain(amount));
    return '<div class="ps-line ' + (cls || '') + '"><span class="lbl">' + esc(label) +
      '</span><span class="amt">' + txt + '</span></div>';
  }

  function psMetaRow(cls, cells) {
    return '<div class="ps-meta-row ' + cls + '">' +
      cells.map(function (c) { return '<div>' + esc(c === null || c === undefined || c === '' ? '—' : c) + '</div>'; }).join('') +
      '</div>';
  }

  /* The lines of one payslip — what the payslip window prints and what is
     sent to TrinityHR, so the two never disagree. Deduction amounts are
     positive; null amounts are headings and notes. */
  function payslipLines(slip) {
    var emp = slip.employee, e = slip.earnings, c = slip.contributions,
        p = slip.postTax, co = state.settings.company;

    /* ---------------------------------------------------------------- *
     * Earnings and deductions are collected as {label, amount} so the
     * two totals are the sum of what is actually printed. Absences and
     * late are shown as DEDUCTIONS here (matching the reference layout),
     * so Basic Pay is the full semi-monthly rate rather than the engine's
     * already-net regularPay. Net pay is unaffected: the same two amounts
     * are added back into earnings and taken out again below.
     * ---------------------------------------------------------------- */
    var earn = [], ded = [];
    var add = function (list, label, amount, cls) {
      list.push({ label: label, amount: amount, cls: cls || '' });
    };

    // A cutoff after the last day carries only final pay: no basic to show, nor its proration.
    var allOff = e.prorationDeduction && E.r2(e.prorationDeduction - slip.rates.semiMonthly) === 0;
    if (!allOff) add(earn, 'Basic Pay', slip.rates.semiMonthly);
    if (slip.dtr.ptoDays) {
      add(earn, 'includes ' + slip.dtr.ptoDays + ' day/s paid time off', 0, 'sub');
    }
    if (e.otPayRegular) add(earn, 'Overtime 1.25× — ' + slip.dtr.otHours + ' hr', e.otPayRegular);
    if (e.otPayRestSpecial) add(earn, 'OT rest day / special 1.69× — ' + slip.dtr.otRestSpecialHours + ' hr', e.otPayRestSpecial);
    if (e.otPayRegHoliday) add(earn, 'OT regular holiday 2.60× — ' + slip.dtr.otRegHolidayHours + ' hr', e.otPayRegHoliday);
    if (e.ndPay) add(earn, 'Night Differential — ' + slip.dtr.ndHours + ' hr', e.ndPay);
    if (e.restDayPay) add(earn, 'Rest Day Work — ' + slip.dtr.restDayHours + ' hr', e.restDayPay);
    if (e.regHolidayPay) add(earn, 'Regular Holiday Premium — ' + slip.dtr.regHolidayDays + ' day/s', e.regHolidayPay);
    if (e.specialHolidayPay) add(earn, 'Special Holiday Premium — ' + slip.dtr.specialHolidayDays + ' day/s', e.specialHolidayPay);
    if (e.quarterlyBonus) {
      add(earn, 'Quarterly Bonus (taxable)', e.quarterlyBonus);
      String(e.quarterlyBonusDetails || '').split(/\n|;/).forEach(function (t) {
        if (t.trim()) add(earn, t.trim(), null, 'sub');
      });
    }
    if (e.thirteenthMonth) add(earn, slip.finalPay ? '13th Month Pay (pro rata, final pay)' : '13th Month Pay', e.thirteenthMonth);
    if (e.deMinimis) add(earn, 'De Minimis', e.deMinimis);
    if (slip.posted && e.holidayPay) add(earn, 'Holiday / Rest Day Pay', e.holidayPay);
    if (e.postedGrossAdjustment) add(earn, 'Adjustment (per payroll file)', e.postedGrossAdjustment);

    // Allowances and one-off pay are grouped under a heading, as in the reference.
    var adhoc = [];
    if (e.transportationAllowance) adhoc.push({ label: 'Transportation Allowance', amount: e.transportationAllowance });
    e.taxableAllowances.forEach(function (a) { adhoc.push({ label: a.label, amount: a.amount }); });
    e.nonTaxAllowances.forEach(function (a) { adhoc.push({ label: a.label, amount: a.amount }); });
    if (p.reimbursement) adhoc.push({ label: 'Reimbursement', amount: p.reimbursement });
    if (adhoc.length) {
      add(earn, 'Adhoc Payment', null, 'head');
      adhoc.forEach(function (a) { add(earn, a.label, a.amount, 'sub'); });
    }

    /* Only the contributions actually withheld this payout may appear, or the
       column stops adding up. `mandatoriesApplied` is what the engine really
       subtracted — under replicateSheetFormula that excludes SSS. */
    var phic = c.philhealth, hdmf = c.pagibig;
    var sssApplied = E.r2(c.mandatoriesApplied - phic - hdmf);

    add(ded, 'Days Absent Deduction', e.absenceDeduction);
    if (e.lateDeduction) add(ded, 'Late Deduction — ' + slip.dtr.lateMinutes + ' min', e.lateDeduction);
    if (e.undertimeDeduction) add(ded, 'Undertime Deduction — ' + slip.dtr.undertimeMinutes + ' min', e.undertimeDeduction);
    if (e.prorationDeduction && !allOff) add(ded, 'Basic Adjustment (start / last day)', e.prorationDeduction);
    add(ded, 'SSS EE Contribution', sssApplied);
    add(ded, 'PhilHealth EE Contribution', phic);
    add(ded, 'HDMF EE Contribution', hdmf);
    add(ded, 'Tax Withheld', slip.tax.withholding);
    if (p.tendoPay) add(ded, 'Tendo Pay', p.tendoPay);
    if (p.sssLoan) add(ded, 'SSS Loan', p.sssLoan);
    if (p.hmo) add(ded, 'HMO', p.hmo);
    if (p.classPass) add(ded, 'Class Pass', p.classPass);
    if (p.otherDeduction) add(ded, 'Other Loan / Deduction', p.otherDeduction);
    if (slip.postedNetAdjustment) add(ded, 'Adjustment (per payroll file)', -slip.postedNetAdjustment);
    /* Installment detail only. The engine already folds each loan's due amount
       into sssLoan / otherDeduction above, so these rows carry no amount of
       their own — listing one would deduct the same peso twice. */
    (slip.loans.rows || []).forEach(function (d) {
      if (!d.due) return;
      add(ded, loanTypeLabel(d.loan.type) + (d.loan.reference ? ' ' + d.loan.reference : '') +
        ' — installment ' + d.installmentNo + ' of ' + d.totalInstallments +
        ', balance ' + plain(d.balanceAfter), null, 'sub');
    });
    slip.otherDeductions.forEach(function (d) { add(ded, d.label, d.amount); });
    // A refund reduces what is withheld, so it belongs here as a negative.
    if (p.taxRefund) {
      add(ded, p.taxRefund > 0 ? 'Tax Refund (annualisation)' : 'Additional Tax Due (annualisation)',
        -p.taxRefund);
    }

    var sum = function (rows) {
      return E.r2(rows.reduce(function (t, r) { return t + (r.amount || 0); }, 0));
    };
    var totalEarnings = sum(earn), totalDeductions = sum(ded);
    var netPay = E.r2(totalEarnings - totalDeductions);
    return { earn: earn, ded: ded, totalEarnings: totalEarnings, totalDeductions: totalDeductions, netPay: netPay };
  }

  function openPayslip(empId) {
    var slip = state.run.slips.filter(function (s) { return s.employee.id === empId; })[0];
    if (!slip) return;

    var emp = slip.employee, co = state.settings.company;
    var L = payslipLines(slip);
    var earn = L.earn, ded = L.ded, totalEarnings = L.totalEarnings,
        totalDeductions = L.totalDeductions, netPay = L.netPay;

    var render = function (rows) {
      return rows.map(function (r) {
        return r.amount === null
          ? '<div class="ps-line ' + r.cls + '"><span class="lbl">' + esc(r.label) + '</span><span class="amt"></span></div>'
          : psRow(r.label, r.amount, r.cls);
      }).join('');
    };

    $('#payslipBody').innerHTML =
      '<div class="payslip">' +
        '<div class="ps-head">' +
          '<div><h3>' + esc(co.name) + '</h3>' +
            '<div class="co">' + esc(co.address) + ' &middot; TIN ' + esc(co.tin) + '</div></div>' +
          '<div class="ps-title">Payslip</div>' +
        '</div>' +

        '<div class="ps-meta">' +
          psMetaRow('lbl', ['Employee Name', 'Position', 'Payout Date']) +
          psMetaRow('val', [emp.firstName + ' ' + emp.lastName, emp.position, slip.period.payoutLabel]) +
          psMetaRow('lbl', ['Payroll Period', 'Branch', 'Employee Code']) +
          psMetaRow('val', [slip.period.cutoffLabel, co.branch, emp.id]) +
        '</div>' +

        '<div class="ps-cols">' +
          '<div class="ps-box"><h4>Earning</h4>' +
            '<div class="ps-body">' + render(earn) + '</div>' +
            psRow('Total Earnings', totalEarnings, 'total') +
          '</div>' +
          '<div class="ps-box"><h4>Deduction</h4>' +
            '<div class="ps-body">' + render(ded.map(function (r) {
              return { label: r.label, amount: r.amount === null ? null : -r.amount, cls: r.cls };
            })) + '</div>' +
            psRow('Total Deductions', -totalDeductions, 'total') +
          '</div>' +
        '</div>' +

        '<div class="ps-totals">' +
          '<h4>Total Payments</h4>' +
          psRow('Total Earnings', totalEarnings) +
          psRow('Total Deductions', -totalDeductions) +
          psRow('Net Pay', netPay, 'grand') +
        '</div>' +

        '<div class="ps-foot">' +
          'Net taxable amount: ' + peso(slip.tax.taxableIncome) + '. ' +
          'This payslip is system-generated.' +
        '</div>' +
      '</div>';

    $('#payslipModal').classList.remove('hidden');
  }

  /* =====================================================================
     EMPLOYEES TAB
     ===================================================================== */
  /* =====================================================================
     SORTING — the run and employee tables
     A "Sort by" menu offers the fields people look things up by, some of
     them not shown as columns (ID, start date); clicking a column header
     sorts by what that column shows, and again reverses it. Rows are
     reordered after each render, so edits and imports keep the order.
     ===================================================================== */
  var SORT_KEY = 'phpayroll.sort.v1';
  var SORT_BODY = { run: '#runBody', emp: '#empBody' };
  var SORT_FIELDS = {
    run: [['name', 'Name'], ['id', 'Employee ID'], ['start', 'Start date'], ['dept', 'Department'],
      ['position', 'Position'], ['rate', 'Monthly rate'], ['gross', 'Gross pay'], ['net', 'Net pay']],
    emp: [['name', 'Name'], ['id', 'Employee ID'], ['start', 'Start date'], ['end', 'Last day'],
      ['company', 'Company'], ['dept', 'Department'], ['position', 'Position'], ['rate', 'Monthly rate']]
  };
  var sortState = (function () {
    try { return JSON.parse(localStorage.getItem(SORT_KEY)) || {}; } catch (e) { return {}; }
  })();
  function saveSort() {
    try { localStorage.setItem(SORT_KEY, JSON.stringify(sortState)); } catch (e) { /* not kept */ }
  }

  function sortAttrs(emp, slip) {
    var a = {
      name: (emp.lastName || '') + ', ' + (emp.firstName || ''), id: emp.id,
      start: emp.dateHired || '', end: emp.endDate || '', company: emp.company || '',
      dept: emp.department || '', position: emp.position || '',
      rate: slip ? slip.rates.monthly : E.num(emp.monthlyRate),
      gross: slip ? slip.earnings.grossPay : '', net: slip ? slip.totals.netPay : ''
    };
    return Object.keys(a).map(function (k) { return ' data-s-' + k + '="' + esc(a[k]) + '"'; }).join('');
  }

  /* What a cell shows: an input's value, else its first line of text (the
     notes under a figure are not what it is sorted by). */
  function cellValue(td) {
    if (!td) return '';
    var input = td.querySelector('input, select');
    var v = input ? (input.tagName === 'SELECT' ? input.options[input.selectedIndex].text : input.value)
      : (td.innerText || td.textContent || '').split('\n')[0];
    return String(v).trim();
  }
  function asNumber(v) {
    var s = String(v).replace(/[₱,\s]/g, '').replace('−', '-');
    return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : null;
  }
  function compareValues(a, b) {
    var na = asNumber(a), nb = asNumber(b);
    if (na !== null && nb !== null) return na - nb;
    // Blanks last whichever way round, so missing start dates do not lead.
    if (a === '' && b !== '') return 1;
    if (b === '' && a !== '') return -1;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  function applySort(table) {
    var st = sortState[table];
    var body = $(SORT_BODY[table]);
    if (!body) return;
    var tableEl = body.closest('table');
    var heads = tableEl.querySelectorAll('thead tr:last-child th');
    Array.prototype.forEach.call(heads, function (th, i) {
      th.classList.add('sortable');
      th.dataset.sortCol = i;
      th.removeAttribute('data-dir');
      if (st && st.col === i) th.setAttribute('data-dir', st.dir);
    });
    var sel = $('#sort-' + table);
    if (sel) sel.value = st && st.field ? st.field + ':' + st.dir : '';
    if (!st) return;
    var rows = Array.prototype.slice.call(body.querySelectorAll(':scope > tr'));
    if (rows.length < 2 || !rows[0].dataset.sId) return;
    var key = function (tr) {
      return st.field ? (tr.dataset['s' + st.field.charAt(0).toUpperCase() + st.field.slice(1)] || '')
        : cellValue(tr.children[st.col]);
    };
    var sign = st.dir === 'desc' ? -1 : 1;
    rows.map(function (tr, i) { return { tr: tr, k: key(tr), i: i }; })
      .sort(function (x, y) {
        var c = compareValues(x.k, y.k);
        if (x.k === '' || y.k === '') return c || x.i - y.i;   // blanks stay last
        return c * sign || x.i - y.i;
      })
      .forEach(function (r) { body.appendChild(r.tr); });
  }

  function wireSort(table) {
    var body = $(SORT_BODY[table]);
    var tableEl = body.closest('table');
    tableEl.querySelector('thead').addEventListener('click', function (ev) {
      var th = ev.target.closest('th[data-sort-col]');
      if (!th) return;
      var col = +th.dataset.sortCol, cur = sortState[table];
      // The first column holds the employee: sort it by name, not by its text.
      var field = col === 0 ? (table === 'emp' ? 'id' : 'name') : null;
      var same = cur && (field ? cur.field === field : cur.col === col);
      sortState[table] = { col: col, field: field, dir: same && cur.dir === 'asc' ? 'desc' : 'asc' };
      saveSort();
      applySort(table);
    });
    var sel = $('#sort-' + table);
    sel.innerHTML = '<option value="">Sort by…</option>' + SORT_FIELDS[table].map(function (f) {
      return '<option value="' + f[0] + ':asc">' + f[1] + ' ↑</option>' +
        '<option value="' + f[0] + ':desc">' + f[1] + ' ↓</option>';
    }).join('');
    sel.addEventListener('change', function () {
      if (!this.value) { delete sortState[table]; saveSort(); renderAll(); return; }
      var parts = this.value.split(':');
      sortState[table] = { field: parts[0], dir: parts[1], col: -1 };
      saveSort();
      applySort(table);
    });
  }
  function renderAll() { renderRun(); renderEmployees(); }

  /* =====================================================================
     FINAL PAY — the leaver's last pay, set up per person (emp.finalPay:
     periodId, parts switched off as false, leaveDays typed, clearance
     [{label, amount}]). The engine's finalPayFor works it out; computeRun
     adds it to that cutoff.
     ===================================================================== */
  function fpCutoffs(emp) {
    // The cutoff holding the last day, and the few after it.
    var end = emp.endDate, y = parseInt(end.slice(0, 4), 10);
    return E.buildPeriods(y).concat(E.buildPeriods(y + 1)).filter(function (p) { return p.end >= end; }).slice(0, 4);
  }
  function renderFinalPay() {
    var isDate = function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); };
    var from = (state.year - 1) + '-12-01';
    var people = state.employees.filter(function (e) {
      return (isDate(e.endDate) && e.endDate >= from) || (e.finalPay && e.finalPay.periodId);
    }).sort(function (a, b) { return String(b.endDate).localeCompare(String(a.endDate)); });
    if (!people.length) {
      $('#fpBody').innerHTML = '<tr><td colspan="9" class="muted" style="padding:18px">Nobody has a last day of work set. ' +
        'Set it on the Employees tab, and they show here.</td></tr>';
      return;
    }
    var box = function (emp, key) {
      var cfg = emp.finalPay || {};
      return '<input type="checkbox" data-fp-flag="' + key + '" data-fp-emp="' + esc(emp.id) + '"' +
        (cfg[key] === false ? '' : ' checked') + ' title="Include in the final pay"> ';
    };
    $('#fpBody').innerHTML = people.map(function (emp) {
      var cfg = emp.finalPay || {}, id = esc(emp.id);
      var cutoffs = isDate(emp.endDate) ? fpCutoffs(emp) : [];
      if (cfg.periodId && !cutoffs.some(function (p) { return p.id === cfg.periodId; })) {
        var cur = E.periodById(cfg.periodId);
        if (cur) cutoffs.unshift(cur);
      }
      var sel = '<select data-fp-period="' + id + '"><option value="">\u2014 not set up \u2014</option>' +
        cutoffs.map(function (p) {
          return '<option value="' + esc(p.id) + '"' + (p.id === cfg.periodId ? ' selected' : '') + '>' +
            esc(window.PayrollTemplate.cutoffTitle(p)) + ' (paid ' + esc(E.fmtShort(E.parseYmd(p.payoutDate))) + ')</option>';
        }).join('') + '</select>';
      var head = '<td class="sticky-col"><strong>' + esc(emp.lastName + ', ' + emp.firstName) + '</strong>' +
        '<div class="muted" style="font-size:11.5px">' + id + '</div></td>' +
        '<td>' + esc(emp.endDate || '\u2014') + '</td><td>' + sel + '</td>';
      var fp = cfg.periodId ? E.finalPayFor(emp, state.dtr, state.settings) : null;
      if (!fp) return '<tr>' + head + '<td colspan="6" class="muted">Choose the cutoff to work out their final pay.</td></tr>';

      var d = state.dtr[fp.period.id + '|' + emp.id];
      var posted = E.isPostedPeriod(state.dtr, fp.period.id);
      var slip = E.computeRun([emp], fp.period, state.dtr, state.settings).slips[0];
      var row = '<tr>' + head +
        '<td class="num">' + box(emp, 'thirteenth') + plain(fp.thirteenth) +
          '<div class="auto-note">' + (fp.thirteenthPaid ? plain(fp.thirteenthPaid) + ' paid already' : 'none paid yet') + '</div></td>' +
        '<td class="num">' + box(emp, 'leave') +
          '<input type="text" inputmode="decimal" data-fp-leave="' + id + '" value="' +
          esc(cfg.leaveDays === undefined || cfg.leaveDays === null ? '' : cfg.leaveDays) + '" placeholder="' +
          esc(plain(fp.leaveSuggested)) + '" style="width:56px" title="Days to convert; blank = the monetizable days"> days' +
          '<div class="auto-note">' + plain(fp.leaveAmount) + ' at ' + plain(fp.dailyRate) + '/day' +
          (fp.leaveTaxable ? ', ' + plain(fp.leaveTaxable) + ' taxable' : '') + '</div></td>' +
        '<td class="num">' + box(emp, 'tax') + plain(fp.taxAdjustment) +
          '<div class="auto-note">' + (fp.taxAdjustment >= 0 ? 'refund' : 'tax still due') + ' \u2014 due ' + plain(fp.annualTaxDue) +
          ' on ' + plain(fp.annualTaxable) + ', withheld ' + plain(fp.ytdWithheld) + '</div></td>' +
        '<td class="num">' + box(emp, 'loans') + plain(fp.loanBalance) + '</td>' +
        '<td class="num">' + plain(fp.clearanceTotal) + '</td>' +
        '<td class="num strong">' + (posted && d && d.posted ? '<span class="muted">from the payroll file</span>' : plain(slip.totals.netPay)) + '</td></tr>';
      var notes = posted
        ? '<div class="notice warn" style="margin:0 0 8px">This cutoff came from an imported payroll file, so the final pay ' +
          'is not added to it. Choose a later cutoff, or use Recalculate this cutoff instead on Payroll Run.</div>' : '';
      var clear = (cfg.clearance || []).map(function (c, i) {
        return '<div style="display:flex;gap:6px;margin-bottom:4px">' +
          '<input type="text" data-fp-cl-label="' + i + '" data-fp-emp="' + id + '" value="' + esc(c.label || '') +
          '" placeholder="e.g. Laptop not returned" style="width:240px">' +
          '<input type="text" inputmode="decimal" data-fp-cl-amount="' + i + '" data-fp-emp="' + id + '" value="' +
          esc(amountValue(c.amount)) + '" placeholder="0.00" style="width:110px;text-align:right">' +
          '<button class="btn ghost tiny danger" data-fp-cl-del="' + i + '" data-fp-emp="' + id + '" type="button">Remove</button></div>';
      }).join('');
      return row + '<tr class="fp-detail"><td></td><td colspan="8">' + notes +
        '<strong style="font-size:12.5px">Clearance deductions</strong>' +
        '<div style="margin-top:6px">' + clear + '</div>' +
        '<button class="btn ghost tiny" data-fp-cl-add="' + id + '" type="button">+ Add clearance deduction</button></td></tr>';
    }).join('');
  }

  function fpChanged() {
    Store.saveEmployees(state.employees);
    renderFinalPay();
    renderRun();
  }
  function fpEmp(id) { return state.employees.filter(function (e) { return e.id === id; })[0]; }
  function wireFinalPay() {
    var body = $('#fpBody');
    body.addEventListener('change', function (ev) {
      var el = ev.target, emp, cfg;
      if (el.dataset.fpPeriod !== undefined) {
        emp = fpEmp(el.dataset.fpPeriod);
        if (!el.value) delete emp.finalPay;
        else { emp.finalPay = emp.finalPay || {}; emp.finalPay.periodId = el.value; }
        return fpChanged();
      }
      emp = fpEmp(el.dataset.fpEmp || el.dataset.fpLeave);
      if (!emp || !emp.finalPay) return;
      cfg = emp.finalPay;
      if (el.dataset.fpFlag) {
        if (el.checked) delete cfg[el.dataset.fpFlag]; else cfg[el.dataset.fpFlag] = false;
      } else if (el.dataset.fpLeave !== undefined) {
        cfg.leaveDays = String(el.value).trim() === '' ? null : parseAmount(el.value);
      } else if (el.dataset.fpClLabel !== undefined) {
        cfg.clearance[+el.dataset.fpClLabel].label = String(el.value).trim();
      } else if (el.dataset.fpClAmount !== undefined) {
        cfg.clearance[+el.dataset.fpClAmount].amount = parseAmount(el.value);
      } else return;
      fpChanged();
    });
    body.addEventListener('click', function (ev) {
      var b = ev.target.closest('button');
      if (!b) return;
      var emp = fpEmp(b.dataset.fpEmp || b.dataset.fpClAdd);
      if (!emp || !emp.finalPay) return;
      var cfg = emp.finalPay;
      cfg.clearance = cfg.clearance || [];
      if (b.dataset.fpClAdd !== undefined) cfg.clearance.push({ label: '', amount: 0 });
      else if (b.dataset.fpClDel !== undefined) cfg.clearance.splice(+b.dataset.fpClDel, 1);
      else return;
      fpChanged();
    });
  }

  function statusPill(emp) {
    var today = E.ymd(new Date());
    if (emp.endDate && emp.endDate < today) return '<span class="pill left">Left ' + esc(emp.endDate) + '</span>';
    if (emp.endDate) return '<span class="pill spc">Leaving ' + esc(emp.endDate) + '</span>';
    if (emp.dateHired && emp.dateHired > today) return '<span class="pill spc">Starts ' + esc(emp.dateHired) + '</span>';
    return '<span class="pill rf">Active</span>';
  }

  function renderEmployees() {
    if (!state.employees.length) {
      $('#empBody').innerHTML = '<tr><td colspan="16" class="muted" style="padding:18px">' +
        'No employees yet. Import the 201 File to load the roster.</td></tr>';
      return;
    }
    $('#empBody').innerHTML = state.employees.map(function (emp, i) {
      var r = E.rateSet(emp, state.settings);
      var itemCount = (emp.items || []).length;
      return '<tr' + sortAttrs(emp) + '>' +
        '<td class="sticky-col"><input type="text" data-emp-idx="' + i + '" data-key="id" value="' + esc(emp.id) + '" style="width:100px"></td>' +
        '<td><input type="text" data-emp-idx="' + i + '" data-key="lastName" value="' + esc(emp.lastName) + '" style="width:130px"></td>' +
        '<td><input type="text" data-emp-idx="' + i + '" data-key="firstName" value="' + esc(emp.firstName) + '" style="width:130px"></td>' +
        '<td>' + statusPill(emp) + '</td>' +
        '<td class="muted">' + esc(emp.company || '') + '</td>' +
        '<td><input type="date" data-emp-idx="' + i + '" data-key="dateHired" value="' + esc(emp.dateHired || '') + '"></td>' +
        '<td><input type="date" data-emp-idx="' + i + '" data-key="endDate" value="' + esc(emp.endDate || '') + '"></td>' +
        '<td><input type="text" data-emp-idx="' + i + '" data-key="email" value="' + esc(emp.email || '') + '" style="width:200px"></td>' +
        '<td><input type="text" data-emp-idx="' + i + '" data-key="position" value="' + esc(emp.position) + '" style="width:200px"></td>' +
        '<td><input type="text" data-emp-idx="' + i + '" data-key="department" value="' + esc(emp.department) + '" style="width:150px"></td>' +
        '<td><select data-emp-idx="' + i + '" data-key="employmentClass">' +
          '<option value="rank_file"' + (emp.employmentClass === 'rank_file' ? ' selected' : '') + '>Rank and file</option>' +
          '<option value="manager"' + (emp.employmentClass === 'manager' ? ' selected' : '') + '>Manager (exempt)</option>' +
        '</select></td>' +
        '<td class="num"><input type="text" inputmode="decimal" data-emp-idx="' + i + '" data-key="monthlyRate" value="' + esc(plain(emp.monthlyRate)) + '"' +
          (E.num(emp.monthlyRate) ? '' : ' class="missing" title="No rate — import salaries"') +
          ' style="width:110px;text-align:right"></td>' +
        '<td class="num">' + plain(E.r2(r.daily)) + '</td>' +
        '<td class="num">' + plain(E.r2(r.hourly)) + '</td>' +
        '<td>' + itemCount + ' item' + (itemCount === 1 ? '' : 's') + '</td>' +
        '<td><button class="btn ghost tiny danger" data-del-emp="' + i + '" type="button">Remove</button></td>' +
        '</tr>';
    }).join('');
    applySort('emp');
    filterEmployees();
  }

  /* The search box above the roster: hides rows that don't contain every
     word typed, looking at what each row shows (ID, names, email, company,
     position, department), so edits are found without a re-render. */
  function filterEmployees() {
    var input = $('#empSearch'), body = $('#empBody');
    if (!input || !body) return;
    var words = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    var none = body.querySelector('tr.no-match');
    if (none) none.remove();
    var rows = body.querySelectorAll(':scope > tr[data-s-id]'), shown = 0;
    Array.prototype.forEach.call(rows, function (tr) {
      var text = Array.prototype.map.call(tr.children, cellValue).join(' ').toLowerCase();
      var hit = words.every(function (w) { return text.indexOf(w) !== -1; });
      tr.style.display = hit ? '' : 'none';
      if (hit) shown++;
    });
    if (rows.length && !shown) {
      body.insertAdjacentHTML('beforeend', '<tr class="no-match"><td colspan="16" class="muted" style="padding:18px">' +
        'No employees match \u201c' + esc(input.value.trim()) + '\u201d.</td></tr>');
    }
  }

  var ITEM_KINDS = [
    { v: 'deduction', t: 'Deduction (from net pay)' },
    { v: 'allowance_tax', t: 'Allowance — taxable' },
    { v: 'allowance_nontax', t: 'Allowance — non-taxable' },
    { v: 'employer_cost', t: 'Company-paid cost (not deducted)' }
  ];
  var ITEM_FREQ = [
    { v: 'every', t: 'Every payout' },
    { v: '1', t: 'Pay period 1 — paid the 10th' },
    { v: '2', t: 'Pay period 2 — paid the 25th' }
  ];

  function renderItemsEditor() {
    $('#itemsEditor').innerHTML = state.employees.map(function (emp, ei) {
      var rows = (emp.items || []).map(function (it, ii) {
        return '<div class="item-row">' +
          '<input type="text" data-item="' + ei + ':' + ii + '" data-key="label" value="' + esc(it.label) + '" placeholder="e.g. Maxicare HMO">' +
          '<select data-item="' + ei + ':' + ii + '" data-key="kind">' +
            ITEM_KINDS.map(function (k) {
              return '<option value="' + k.v + '"' + (it.kind === k.v ? ' selected' : '') + '>' + k.t + '</option>';
            }).join('') +
          '</select>' +
          '<select data-item="' + ei + ':' + ii + '" data-key="frequency">' +
            ITEM_FREQ.map(function (f) {
              var cur = it.frequency === 'first' ? '2' : it.frequency === 'second' ? '1'
                : String(it.frequency || 'every');
              return '<option value="' + f.v + '"' + (cur === f.v ? ' selected' : '') + '>' + f.t + '</option>';
            }).join('') +
          '</select>' +
          '<input type="text" inputmode="decimal" data-item="' + ei + ':' + ii + '" data-key="amount" value="' + esc(amountValue(it.amount)) + '">' +
          '<button class="btn ghost tiny danger" data-del-item="' + ei + ':' + ii + '" type="button">Remove</button>' +
          '</div>';
      }).join('');

      return '<div class="item-block">' +
        '<h3>' + esc(emp.lastName + ', ' + emp.firstName) +
          ' <span class="muted">— ' + esc(emp.position) + '</span></h3>' +
        rows +
        '<button class="btn ghost tiny" data-add-item="' + ei + '" type="button">+ Add item</button>' +
        '</div>';
    }).join('');
  }


  /* =====================================================================
     LOANS
     ===================================================================== */
  var LOAN_TYPES = [
    { v: 'sss', t: 'SSS salary loan' },
    { v: 'pagibig', t: 'HDMF / MPL' },
    { v: 'company', t: 'Company loan' }
  ];
  var LOAN_SCHED = [
    { v: '1', t: 'Pay period 1 — the 10th' },
    { v: '2', t: 'Pay period 2 — the 25th' },
    { v: 'split', t: 'Both payouts' }
  ];
  function loanTypeLabel(v) {
    var m = LOAN_TYPES.filter(function (x) { return x.v === v; })[0];
    return m ? m.t : v;
  }

  function renderLoanLedger() {
    var rows = [];
    var totalDue = 0, totalBalance = 0;

    state.run.slips.forEach(function (s) {
      (s.loans.rows || []).forEach(function (d) {
        var l = d.loan;
        totalDue += d.due;
        totalBalance += d.balanceAfter;
        rows.push('<tr>' +
          '<td class="sticky-col">' + esc(s.employee.lastName + ', ' + s.employee.firstName) + '</td>' +
          '<td><span class="pill ' + (l.type === 'sss' ? 'reg' : 'spc') + '">' + esc(loanTypeLabel(l.type)) + '</span></td>' +
          '<td class="muted">' + esc(l.reference || '—') + '</td>' +
          '<td class="num">' + plain(E.num(l.principal)) + '</td>' +
          '<td class="num">' + plain(E.num(l.amortization)) + '</td>' +
          '<td>' + (l.schedule === 'split' ? 'Both payouts' : 'Period ' + l.schedule) + '</td>' +
          '<td class="muted">' + esc(l.startDate) + '</td>' +
          '<td class="num">' + (d.installmentNo ? d.installmentNo + ' of ' + d.totalInstallments : '<span class="zero">—</span>') + '</td>' +
          '<td class="num' + (d.due ? ' strong' : ' zero') + '">' + plain(d.due) + '</td>' +
          '<td class="num">' + plain(d.balanceAfter) + '</td>' +
          '<td>' + (d.settled ? '<span class="pill rf">Settled</span>'
            : d.due ? '<span class="pill mgr">Deducted</span>'
            : '<span class="muted">Not due this payout</span>') + '</td>' +
          '</tr>');
      });
    });

    $('#loanBody').innerHTML = rows.length ? rows.join('') :
      '<tr><td colspan="11" class="muted">No loans recorded. Add them in the Employees tab.</td></tr>';
    $('#loanFoot').innerHTML = rows.length ? '<tr><td colspan="8">TOTAL</td>' +
      '<td class="num">' + plain(E.r2(totalDue)) + '</td>' +
      '<td class="num">' + plain(E.r2(totalBalance)) + '</td><td></td></tr>' : '';
  }

  function renderLoansEditor() {
    $('#loansEditor').innerHTML = state.employees.map(function (emp, ei) {
      var rows = (emp.loans || []).map(function (l, li) {
        return '<div class="item-row">' +
          '<select data-loan="' + ei + ':' + li + '" data-key="type">' +
            LOAN_TYPES.map(function (k) {
              return '<option value="' + k.v + '"' + (l.type === k.v ? ' selected' : '') + '>' + k.t + '</option>';
            }).join('') + '</select>' +
          '<input type="text" data-loan="' + ei + ':' + li + '" data-key="reference" value="' + esc(l.reference || '') + '" placeholder="Loan reference" style="flex:0 1 160px">' +
          '<input type="text" inputmode="decimal" data-loan="' + ei + ':' + li + '" data-key="principal" value="' + esc(amountValue(l.principal)) + '" title="Principal">' +
          '<input type="text" inputmode="decimal" data-loan="' + ei + ':' + li + '" data-key="amortization" value="' + esc(amountValue(l.amortization)) + '" title="Amount per payout">' +
          '<input type="date" data-loan="' + ei + ':' + li + '" data-key="startDate" value="' + esc(l.startDate) + '" title="First deduction on or after this date">' +
          '<select data-loan="' + ei + ':' + li + '" data-key="schedule">' +
            LOAN_SCHED.map(function (k) {
              return '<option value="' + k.v + '"' + (String(l.schedule) === k.v ? ' selected' : '') + '>' + k.t + '</option>';
            }).join('') + '</select>' +
          '<button class="btn ghost tiny danger" data-del-loan="' + ei + ':' + li + '" type="button">Remove</button>' +
          '</div>';
      }).join('');

      return '<div class="item-block">' +
        '<h3>' + esc(emp.lastName + ', ' + emp.firstName) +
          ' <span class="muted">— ' + esc(emp.position) + '</span></h3>' +
        (rows || '<p class="hint" style="margin:0 0 7px">No loans.</p>') +
        '<button class="btn ghost tiny" data-add-loan="' + ei + '" type="button">+ Add loan</button>' +
        '</div>';
    }).join('');
  }


  /* =====================================================================
     201 FILE AND SALARIES — see hr201.js
     ===================================================================== */
  function refreshAll() {
    persist();
    renderEmployees(); renderItemsEditor(); renderLoansEditor(); renderRun();
    if (!$('#tab-yearend').classList.contains('hidden')) renderYearEnd();
  }

  function import201(file) {
    var H = window.PayrollHr201;
    H.parse201(file).then(function (parsed) {
      if (!parsed.rows.length) {
        alert('That 201 File has the right headings but no employee rows, so nothing was changed.' +
          (parsed.warnings.length ? '\n\n' + parsed.warnings.slice(0, 8).join('\n') : ''));
        return;
      }
      var companies = {};
      parsed.rows.forEach(function (r) {
        var c = r.company || '';
        companies[c] = (companies[c] || 0) + 1;
      });
      ask201(parsed, companies);
    }).catch(function (err) {
      alert('Could not read that 201 File.\n\n' + (err && err.message ? err.message : err));
    });
  }

  /* The export can span several companies; the choice of which ones belong
     on this payroll is made here, with the counts recomputed as boxes are
     ticked. A company starts ticked if someone on the roster is already in
     it; on a first import, if its name shares the first word of this
     payroll's company name ("Trinity …"); failing both, every one is. */
  function ask201(parsed, companies) {
    var H = window.PayrollHr201;
    var names = Object.keys(companies).sort();
    var onRoster = {};
    state.employees.forEach(function (e) { if (e.company) onRoster[e.company] = true; });
    var anyOnRoster = Object.keys(onRoster).length > 0;
    var own = String(state.settings.company.name || '').trim().split(/\s+/)[0].toLowerCase();
    var named = names.filter(function (c) { return own && c.toLowerCase().indexOf(own) !== -1; });
    var picked = {};
    names.forEach(function (c) {
      picked[c] = anyOnRoster ? !!onRoster[c] : named.length ? named.indexOf(c) !== -1 : true;
    });

    var modal = $('#importModeModal');
    var body = $('#importModeBody');
    $('#importModeTitle').textContent = 'Import 201 File';

    function draw() {
      var p = H.plan(parsed, state.employees, picked);
      var leaving = p.update.concat(p.create).filter(function (x) { return x.row.endDate; }).length;
      body.innerHTML =
        '<p class="hint" style="display:block;margin-bottom:8px">The file has <strong>' +
          parsed.rows.length + '</strong> employee row' + (parsed.rows.length === 1 ? '' : 's') +
          '. Companies to include on this payroll:</p>' +
        '<div class="import-companies">' + names.map(function (c, i) {
          return '<label><input type="checkbox" data-co="' + i + '"' + (picked[c] ? ' checked' : '') + '> ' +
            esc(c || '(no company)') + ' <span class="muted">' + companies[c] + '</span></label>';
        }).join('') + '</div>' +
        '<ul style="margin:0 0 16px;padding-left:20px;font-size:13px">' +
          '<li><strong>' + p.create.length + '</strong> new — added with no rate until salaries are imported</li>' +
          '<li><strong>' + p.update.length + '</strong> already here — details updated from the file</li>' +
          (leaving ? '<li><strong>' + leaving + '</strong> with a last day of work — kept, but off the payroll after that day</li>' : '') +
          (p.skipped.length ? '<li><strong>' + p.skipped.length + '</strong> in companies not ticked — ignored</li>' : '') +
          '<li>Nobody is removed. Rates, items, loans and timesheets are not touched.</li>' +
        '</ul>' +
        '<button class="btn" data-go type="button"' + (p.create.length + p.update.length ? '' : ' disabled') +
          '>Import</button>';
      return p;
    }
    var current = draw();
    modal.classList.remove('hidden');

    var close = function () {
      modal.classList.add('hidden');
      body.onclick = null; body.onchange = null;
      $('#importModeTitle').textContent = 'Import masterlist';
    };
    body.onchange = function (ev) {
      var i = ev.target.dataset && ev.target.dataset.co;
      if (i === undefined) return;
      picked[names[+i]] = ev.target.checked;
      current = draw();
    };
    body.onclick = function (ev) {
      if (!ev.target.closest('[data-go]')) return;
      close();
      var res = H.apply(current, state.employees);
      refreshAll();
      var msg = ['201 File imported.'];
      msg.push('\nAdded ' + res.created.length + (res.created.length ? ': ' + res.created.slice(0, 10).map(function (e) {
        return (e.lastName || '') + ', ' + (e.firstName || '');
      }).join('; ') + (res.created.length > 10 ? ' …' : '') : '') + '.');
      msg.push('Updated ' + res.changed.length + ' of ' + current.update.length + ' already here' +
        (current.update.length - res.changed.length ? ' (the rest had no changes)' : '') + '.');
      var noRate = state.employees.filter(function (e) { return !E.num(e.monthlyRate); }).length;
      if (noRate) msg.push('\n' + noRate + ' employee(s) have no monthly rate yet — use Download salary sheet, ' +
        'fill in the rates and Import salaries.');
      if (parsed.warnings.length) msg.push('\n' + parsed.warnings.slice(0, 8).join('\n') +
        (parsed.warnings.length > 8 ? '\n…and ' + (parsed.warnings.length - 8) + ' more.' : ''));
      alert(msg.join('\n'));
    };
    $('#btnCancelImport').onclick = close;
  }

  function downloadSalaries() {
    var list = state.employees.slice().sort(function (a, b) {
      return ((a.company || '') + (a.lastName || '')).localeCompare((b.company || '') + (b.lastName || ''));
    });
    var blob = window.PayrollHr201.buildSalarySheet(list);
    window.XlsxWriter.download(blob, 'Salaries - ' + state.settings.company.name.replace(/[\\/:*?"<>|]/g, '-') + '.xlsx');
  }

  function importSalaries(file) {
    window.PayrollHr201.parseSalaries(file).then(function (parsed) {
      var byId = {};
      state.employees.forEach(function (e) { byId[e.id] = e; });
      var changed = [], unknown = [], same = 0;
      parsed.rows.forEach(function (r) {
        var emp = byId[r.id];
        if (!emp) { unknown.push(r.id); return; }
        var diff = false;
        if (r.rate !== null && E.num(emp.monthlyRate) !== r.rate) {
          changed.push(r.id + ': ' + plain(E.num(emp.monthlyRate)) + ' → ' + plain(r.rate));
          emp.monthlyRate = r.rate;
          diff = true;
        }
        if (r.employmentClass && emp.employmentClass !== r.employmentClass) {
          emp.employmentClass = r.employmentClass;
          if (!diff) changed.push(r.id + ': classification ' + (r.employmentClass === 'manager' ? 'Manager' : 'Rank and file'));
          diff = true;
        }
        if (!diff) same++;
      });
      refreshAll();
      var msg = ['Salaries imported — ' + parsed.rows.length + ' row(s) read.',
        '\nChanged ' + changed.length + (changed.length ? ':\n  ' + changed.slice(0, 15).join('\n  ') +
          (changed.length > 15 ? '\n  …' : '') : '.'),
        'Unchanged ' + same + '.'];
      if (unknown.length) msg.push('\nNot on the roster (import the 201 File first): ' +
        unknown.slice(0, 10).join(', ') + (unknown.length > 10 ? ' …' : ''));
      var noRate = state.employees.filter(function (e) { return !E.num(e.monthlyRate); }).length;
      if (noRate) msg.push('\nStill without a rate: ' + noRate + '.');
      if (parsed.warnings.length) msg.push('\n' + parsed.warnings.slice(0, 8).join('\n'));
      alert(msg.join('\n'));
    }).catch(function (err) {
      alert('Could not read that salary file.\n\n' + (err && err.message ? err.message : err));
    });
  }

  /* =====================================================================
     MASTERLIST — export and import
     ===================================================================== */
  function exportMasterlist() {
    var blob = window.PayrollMasterlist.build(state.employees, state.settings);
    var name = 'Employee Masterlist - ' + state.settings.company.name + '.xlsx';
    window.XlsxWriter.download(blob, name.replace(/[\\/:*?"<>|]/g, '-'));
  }

  /* Two ways to bring a masterlist in:
       replace  the file IS the roster — overwrite everyone, remove anyone absent
       add      only create employees the roster does not have, touch nothing else
     The choice is made after parsing so the counts shown are the real ones. */
  function importMasterlist(file) {
    window.PayrollMasterlist.parse(file).then(function (parsed) {
      if (!parsed.employees.length) {
        alert('No employee rows were found in that file, so nothing was changed.\n\n' +
          'The Masterlist sheet needs a header row starting with "First Name", and each ' +
          'employee row needs at least a first or last name.\n\n' +
          (parsed.warnings.length ? parsed.warnings.slice(0, 8).join('\n') : ''));
        return;
      }
      assignMissingIds(parsed);

      var have = {}, byName = {};
      state.employees.forEach(function (e) {
        have[e.id] = true;
        byName[nameKey(e)] = e.id;
      });
      var fresh = parsed.employees.filter(function (r) { return !have[r.id]; });
      var over = parsed.employees.length - fresh.length;
      var absent = state.employees.filter(function (e) {
        return !parsed.employees.some(function (r) { return r.id === e.id; });
      });
      // In add-only mode a row whose NAME already exists is a duplicate, not a
      // new hire — an HR extract pasted without IDs would otherwise clone the
      // entire roster.
      var dupes = fresh.filter(function (r) { return byName[nameKey(r)]; });

      askImportMode({
        rows: parsed.employees.length, fresh: fresh.length - dupes.length,
        over: over, absent: absent.length, dupes: dupes.length
      }, function (mode) {
        applyMasterlist(parsed, mode, byName);
      });
    }).catch(function (err) {
      alert('Could not read that masterlist.\n\n' + (err && err.message ? err.message : err));
    });
  }

  function nameKey(e) {
    return String((e.lastName || '') + '|' + (e.firstName || '')).trim().toLowerCase();
  }

  /* Rows pasted in from an HR sheet arrive without an Employee ID. Give each
     one the next free ID rather than dropping it. */
  function assignMissingIds(parsed) {
    var usedIds = {};
    state.employees.forEach(function (e) { usedIds[e.id] = true; });
    parsed.employees.forEach(function (r) { if (r.id) usedIds[r.id] = true; });
    var seq = 0;
    parsed.assignedIds = 0;
    parsed.employees.forEach(function (r) {
      if (r.id) return;
      var id;
      do {
        seq++;
        id = 'EMP-' + (seq < 1000 ? ('00' + seq).slice(-3) : String(seq));
      } while (usedIds[id]);
      usedIds[id] = true;
      r.id = id;
      parsed.assignedIds++;
    });
  }

  function askImportMode(n, done) {
    var modal = $('#importModeModal');
    $('#importModeBody').innerHTML =
      '<p class="hint" style="display:block;margin-bottom:14px">The file has <strong>' + n.rows +
        '</strong> employee row' + (n.rows === 1 ? '' : 's') + '. How should it be applied?</p>' +
      '<div class="import-choice">' +
        '<button class="btn" data-import-mode="replace" type="button">Replace the whole roster</button>' +
        '<p>The file becomes the roster. ' + n.over + ' existing employee' + (n.over === 1 ? '' : 's') +
          ' overwritten column by column and a blank cell clears the field' +
          (n.absent ? ', and <strong>' + n.absent + ' not in the file are REMOVED</strong> with their ' +
            'items, loans and timesheets' : '') +
          '. Recurring items and loans come wholly from the file.</p>' +
      '</div>' +
      '<div class="import-choice">' +
        '<button class="btn ghost" data-import-mode="add" type="button">Add new employees only</button>' +
        '<p>Creates <strong>' + n.fresh + '</strong> new employee' + (n.fresh === 1 ? '' : 's') +
          '. Nobody is overwritten and nobody is removed' +
          (n.dupes ? '. ' + n.dupes + ' row' + (n.dupes === 1 ? '' : 's') +
            ' already match someone by name and will be skipped' : '') + '.</p>' +
      '</div>';
    modal.classList.remove('hidden');

    var body = $('#importModeBody');
    var close = function () {
      modal.classList.add('hidden');
      body.onclick = null;
    };
    body.onclick = function (ev) {
      var b = ev.target.closest('[data-import-mode]');
      if (!b) return;
      var mode = b.dataset.importMode;
      close();
      done(mode);
    };
    $('#btnCancelImport').onclick = close;
  }

  function applyMasterlist(parsed, mode, byName) {
    var replace = (mode === 'replace');
    var known = {};
    state.employees.forEach(function (e) { known[e.id] = e; });

    /* In replace mode the masterlist is the source of truth: every column it
       carries is overwritten from the file, a blank cell CLEARS the field, and
       anyone absent from the file is removed. Fields the sheet does not carry
       (salary adjustment, stored age) are left alone either way — there is
       nothing in the file to replace them with. */
    var TEXT_FIELDS = ['firstName', 'middleName', 'lastName', 'preferredName',
      'countryRegion', 'subdepartment', 'department', 'directManagers', 'position',
      'portraitsLink', 'hubspotLink', 'rr', 'performanceSheet', 'contracts',
      'birthDate', 'email', 'dateHired', 'endDate', 'phone', 'presentAddress',
      'nationality', 'linkedin', 'skype', 'discord', 'regularizationDate',
      'referredBy', 'referralPaid', 'hrLeadStatus', 'gender', 'currency',
      'sssNo', 'philhealthNo', 'pagibigNo', 'tin'];

    var inFile = {};
    parsed.employees.forEach(function (row) { inFile[row.id] = true; });

    if (replace) {
      var removing = state.employees.filter(function (e) { return !inFile[e.id]; });
      if (removing.length) {
        var names = removing.map(function (e) {
          return '  ' + e.id + ' \u2014 ' + (e.lastName || '') + ', ' + (e.firstName || '');
        });
        if (!confirm('This import replaces the roster with the file.\n\n' +
            removing.length + ' employee(s) are not in it and will be REMOVED, along with ' +
            'their recurring items, loans and timesheet entries:\n\n' +
            names.slice(0, 15).join('\n') +
            (names.length > 15 ? '\n  ...and ' + (names.length - 15) + ' more' : '') +
            '\n\nThis cannot be undone. Continue?')) {
          return;
        }
      }
    }

    var created = [], updated = [], skipped = [], touched = {};

    parsed.employees.forEach(function (row) {
      var emp = known[row.id];
      var isNew = !emp;

      // Add-only: leave everyone already on the roster exactly as they are.
      if (!replace && !isNew) { skipped.push(row.id + ' (already on the roster)'); return; }
      if (!replace && isNew && byName[nameKey(row)]) {
        skipped.push(row.id + ' (same name as ' + byName[nameKey(row)] + ')');
        delete inFile[row.id];
        return;
      }

      if (isNew) {
        if (!row.lastName && !row.firstName) {
          parsed.warnings.push('New employee ' + row.id + ' has no name - skipped.');
          delete inFile[row.id];
          return;
        }
        emp = { id: row.id, items: [], loans: [] };
        state.employees.push(emp);
        known[emp.id] = emp;
        created.push(row.id);
      } else {
        updated.push(row.id);
      }
      touched[row.id] = true;

      TEXT_FIELDS.forEach(function (k) { emp[k] = row[k] === null ? '' : row[k]; });
      emp.monthlyRate = row.monthlyRate === null ? 0 : row.monthlyRate;
      // null falls back to the company default annual credits.
      emp.leaveCredits = row.leaveCredits;
      emp.employmentClass = row.employmentClass || 'rank_file';
      emp.sssExempt = !!row.sssExempt;
    });

    /* Items and loans come wholly from the file — an employee with no rows on
       those sheets ends up with none, rather than keeping stale ones. In
       add-only mode this reaches the newly created employees alone, so nobody
       else loses their items. */
    var itemCount = 0, loanCount = 0;
    Object.keys(touched).forEach(function (id) {
      if (!known[id]) return;
      known[id].items = (parsed.items && parsed.items[id]) || [];
      known[id].loans = (parsed.loans && parsed.loans[id]) || [];
      itemCount += known[id].items.length;
      loanCount += known[id].loans.length;
    });

    var removed = [];
    if (replace) {
      // Drop everyone the file left out, and their timesheet entries with them,
      // so no orphaned DTR rows survive under a reused Employee ID.
      removed = state.employees.filter(function (e) { return !inFile[e.id]; })
        .map(function (e) { return e.id + ' \u2014 ' + (e.lastName || '') + ', ' + (e.firstName || ''); });
      var gone = {};
      state.employees.forEach(function (e) { if (!inFile[e.id]) gone[e.id] = true; });
      state.employees = state.employees.filter(function (e) { return inFile[e.id]; });
      Object.keys(state.dtr).forEach(function (k) {
        if (gone[k.split('|')[1]]) delete state.dtr[k];
      });
    }

    persist();
    renderEmployees(); renderItemsEditor(); renderLoansEditor(); renderRun();

    var msg = ['Masterlist imported - ' + parsed.employees.length + ' row(s) read. ' +
      (replace ? 'The file replaced the roster.' : 'New employees only - nothing else was changed.')];
    if (created.length) msg.push('\nCreated ' + created.length + ': ' +
      created.slice(0, 10).join(', ') + (created.length > 10 ? ' ...' : ''));
    if (parsed.assignedIds) msg.push('\n' + parsed.assignedIds + ' row(s) arrived without an Employee ID ' +
      'and were given one. Export a fresh masterlist so the IDs are on file.');
    if (updated.length) msg.push('\nOverwritten ' + updated.length + ': ' +
      updated.slice(0, 10).join(', ') + (updated.length > 10 ? ' ...' : ''));
    if (skipped.length) msg.push('\nLeft untouched ' + skipped.length + ':\n  ' +
      skipped.slice(0, 10).join('\n  ') + (skipped.length > 10 ? '\n  ...' : ''));
    msg.push('\nRecurring items now on file: ' + itemCount + '. Loans: ' + loanCount + '.');
    if (removed.length) msg.push('\nREMOVED ' + removed.length + ' not in the file:\n  ' +
      removed.slice(0, 10).join('\n  ') + (removed.length > 10 ? '\n  ...' : ''));
    if (parsed.warnings.length) msg.push('\n' + parsed.warnings.slice(0, 8).join('\n') +
      (parsed.warnings.length > 8 ? '\n...and ' + (parsed.warnings.length - 8) + ' more.' : ''));
    alert(msg.join('\n'));
  }

  /* One employee's 13th month, cutoff by cutoff (engine thirteenthDetail). */
  function openThirteenth(empId) {
    var emp = state.employees.filter(function (e) { return e.id === empId; })[0];
    if (!emp) return;
    var T = window.PayrollTemplate;
    var det = E.thirteenthDetail(emp, state.year, state.dtr, state.settings, E.ymd(new Date()));
    var y = det.yearEnd, ceiling = state.settings.yearEnd.thirteenthMonthExemption;
    var inc = det.rows.filter(function (r) { return r.included; });
    var changes = inc.filter(function (r) { return r.rateChange; });
    var bySource = {};
    inc.forEach(function (r) { bySource[r.source] = (bySource[r.source] || 0) + 1; });
    var postId = state.settings.yearEnd.thirteenthMonthPeriodId;
    var postP = postId && E.buildPeriods(state.year).concat(E.buildPeriods(state.year + 1))
      .filter(function (p) { return p.id === postId; })[0];
    var sumOf = function (k) { return E.r2(inc.reduce(function (t, r) { return t + (r[k] || 0); }, 0)); };

    var rowsHtml = det.rows.map(function (r) {
      var cut = esc(T.cutoffTitle(r.period));
      var pay = esc(E.fmtShort(E.parseYmd(r.period.payoutDate)));
      if (!r.included) {
        return '<tr class="muted"><td>' + cut + '<div class="auto-note">paid ' + pay + '</div></td>' +
          '<td colspan="12">' + esc(r.note) + ' — nothing earned</td></tr>';
      }
      var est = r.source !== 'Payroll file' && r.source !== 'Entered on the site';
      return '<tr' + (r.rateChange ? ' class="rate-change"' : '') + '>' +
        '<td>' + cut + '<div class="auto-note">paid ' + pay + '</div></td>' +
        '<td><span class="pill ' + (r.source === 'Payroll file' ? 'rf' : est ? 'spc' : 'mgr') + '">' +
          esc(r.source) + '</span></td>' +
        '<td class="num">' + plain(r.rate) +
          (r.rateChange ? '<div class="auto-note">' + (r.rateChange.to > r.rateChange.from ? '▲' : '▼') +
            ' from ' + plain(r.rateChange.from) + '</div>' : '') +
          (r.note ? '<div class="auto-note">' + esc(r.note) + '</div>' : '') + '</td>' +
        money(r.basic) +
        '<td class="num' + (r.offStaff ? '' : ' zero') + '">' + (r.offStaff ? '−' : '') + plain(r.offStaff) +
          (r.share < 1 ? '<div class="auto-note">' + Math.round(r.share * 100) + '% of the cutoff on staff</div>' : '') + '</td>' +
        money(r.adjustments) +
        '<td class="num strong">' + plain(r.earned) + '</td>' +
        '<td class="num">' + plain(r.accrued) + '</td>' +
        '<td class="num">' + plain(r.running) + '</td>' +
        '<td class="num muted">' + (r.notCounted ? plain(r.notCounted) : '') + '</td>' +
        money(r.paid13) + money(r.transport) + money(r.bonus) +
        '</tr>';
    }).join('');

    var line = function (k, v, cls) {
      return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + k + '</td><td class="num">' + v + '</td></tr>';
    };
    var html =
      '<div class="stat-row" style="margin-bottom:16px">' +
        stat('13th month for ' + state.year, peso(y.thirteenthMonth), 'gross basic ' + plain(y.ytd.basicEarned) + ' ÷ ' + det.divisor, 'accent') +
        stat('Paid so far', peso(y.thirteenthPaid), 'instalments in the payroll files') +
        stat('Expected at the 13th month payout', peso(E.r2(y.thirteenthBalance + y.yearEndBonus)),
          plain(y.thirteenthBalance) + ' 13th month + ' + plain(y.yearEndBonus) + ' year-end bonus · ' +
          (postP ? 'posted on the ' + E.fmtShort(E.parseYmd(postP.payoutDate)) + ' payout' : 'payout not chosen yet — set it under Posting'), 'green') +
        stat('Salary changes', changes.length, changes.length ? changes.map(function (r) {
          return plain(r.rateChange.from) + ' → ' + plain(r.rateChange.to) + ' from ' + T.cutoffTitle(r.period);
        }).join('; ') : 'same rate all year') +
      '</div>' +
      (bySource['Estimated — no payroll file'] || bySource['Projected from the rate']
        ? '<div class="notice warn" style="margin-bottom:14px">' +
          (bySource['Estimated — no payroll file'] ? bySource['Estimated — no payroll file'] + ' past cutoff(s) have no payroll file and are estimated from the rate. ' : '') +
          (bySource['Projected from the rate'] ? bySource['Projected from the rate'] + ' upcoming cutoff(s) are projected from the current rate. ' : '') +
          'The 13th month firms up as their payroll is imported or entered.</div>' : '') +
      '<div class="table-scroll" style="max-height:none"><table class="grid compact detail-13">' +
        '<thead><tr><th>Cutoff</th><th>Figures from</th><th class="num">Monthly rate</th>' +
        '<th class="num">Basic for cutoff</th><th class="num" title="Days before the start date or after the last day">Less days off staff</th>' +
        '<th class="num" title="Basic / salary adjustments">Adjustments</th><th class="num" title="Basic before absences, late and undertime">Gross basic</th>' +
        '<th class="num">13th month (÷ ' + det.divisor + ')</th><th class="num">Running total</th>' +
        '<th class="num" title="Absences, late and undertime in the cutoff — not taken off the 13th month">Absences / late (not counted)</th>' +
        '<th class="num">13th paid</th><th class="num">Transport allow.</th><th class="num">Ex milestones</th></tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
        '<tfoot><tr><td colspan="3">TOTAL — ' + inc.length + ' cutoff' + (inc.length === 1 ? '' : 's') + '</td>' +
          '<td class="num">' + plain(sumOf('basic')) + '</td><td class="num">' + (sumOf('offStaff') ? '−' : '') + plain(sumOf('offStaff')) + '</td>' +
          '<td class="num">' + plain(sumOf('adjustments')) + '</td><td class="num">' + plain(y.ytd.basicEarned) + '</td>' +
          '<td class="num">' + plain(y.thirteenthMonth) + '</td><td class="num">' + plain(y.thirteenthMonth) + '</td>' +
          '<td class="num muted">' + plain(sumOf('notCounted')) + '</td>' +
          '<td class="num">' + plain(y.thirteenthPaid) + '</td>' +
          '<td class="num">' + plain(y.transport) + '</td>' +
          '<td class="num">' + plain(y.companyBonus) + '</td></tr></tfoot>' +
      '</table></div>' +
      '<h3 style="margin:18px 0 6px">How it adds up</h3>' +
      '<table class="grid compact calc-summary"><tbody>' +
        line('Gross basic salary in ' + state.year + ' (before absences, late, undertime)', plain(y.ytd.basicEarned)) +
        line('÷ ' + det.divisor + ' = 13th month', plain(y.thirteenthMonth), 'strong') +
        line('Less 13th month already paid', (y.thirteenthPaid ? '−' : '') + plain(y.thirteenthPaid)) +
        line('13th month still to pay' +
          (y.thirteenthBalanceTaxable ? ' <span class="muted">— ' + plain(y.thirteenthBalanceTaxable) + ' of it taxable</span>' : ''),
          plain(y.thirteenthBalance)) +
        line('Year-end non-taxable bonus: ' + plain(state.settings.yearEnd.yearEndBonus) + ' × ' + y.monthsWorked +
          ' month' + (y.monthsWorked === 1 ? '' : 's') + ' worked ÷ 12', plain(y.yearEndBonus)) +
        line('<strong>Expected at the 13th month payout</strong>', '<strong>' + plain(E.r2(y.thirteenthBalance + y.yearEndBonus)) + '</strong>', 'net') +
        line('<em>Exempt ceiling — shared (the year-end bonus is outside it)</em>', '') +
        line('Transportation allowance this year', plain(y.transport)) +
        line('Ex milestones (company bonus) this year', plain(y.companyBonus)) +
        line('13th month', plain(y.thirteenthMonth)) +
        line('Total', plain(y.benefits), 'strong') +
        line('Less the ceiling', '−' + plain(ceiling)) +
        line('Excess over the ceiling', plain(y.thirteenthTaxable), 'strong') +
        line('<em>Taken off the 13th month</em>', '') +
        line('13th month, tax-exempt', plain(y.thirteenthExemptPart)) +
        line('13th month, taxable (the excess)', plain(y.thirteenthTaxablePart)) +
        (y.thirteenthTaxable > y.thirteenthTaxablePart
          ? line('Excess beyond the 13th month itself, also taxable', plain(E.r2(y.thirteenthTaxable - y.thirteenthTaxablePart))) : '') +
        line('Added to annual taxable income', plain(y.thirteenthTaxable)) +
      '</tbody></table>' +
      '<p class="hint" style="display:block;margin-top:10px">The 13th month counts the cutoffs worked from January 1 to ' +
        'December 31, ' + state.year + ', by their dates — December 16 - 31 is paid the next January 10 but belongs to this year. ' +
        'A cutoff with no payroll file uses the rate of the latest file before it, so a salary change holds until the next one. ' +
        'Each cutoff adds a ' + det.divisor + 'th of its gross basic — the basic for the cutoff before absences, late ' +
        'and undertime, less only days before a start date or after a last day, plus basic or salary adjustments. ' +
        'Overtime, holiday pay, allowances and bonuses do not count. Months worked are the working days on staff ' +
        'in the year\'s cutoffs, two cutoffs to a month.</p>';

    $('#thirteenthTitle').textContent = '13th month — ' + (emp.lastName || '') + ', ' + (emp.firstName || '') + ' · ' + state.year;
    $('#thirteenthBody').innerHTML = html;
    $('#thirteenthModal').classList.remove('hidden');
  }

  /* =====================================================================
     HOLIDAYS TAB
     ===================================================================== */
  var DAYNAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  function renderHolidays() {
    $('#holidayYearLabel').textContent = '— ' + state.year;
    var wd = state.settings.schedule.workDays;
    var sorted = state.holidays.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    state.holidays = sorted;

    $('#holBody').innerHTML = sorted.map(function (h, i) {
      var d = E.parseYmd(h.date);
      var isWork = wd.indexOf(d.getDay()) !== -1;
      return '<tr>' +
        '<td><input type="date" data-hol="' + i + '" data-key="date" value="' + esc(h.date) + '"></td>' +
        '<td>' + DAYNAMES[d.getDay()] + '</td>' +
        '<td><input type="text" data-hol="' + i + '" data-key="name" value="' + esc(h.name) + '" style="width:260px"></td>' +
        '<td><select data-hol="' + i + '" data-key="type">' +
          '<option value="regular"' + (h.type === 'regular' ? ' selected' : '') + '>Regular holiday</option>' +
          '<option value="special"' + (h.type === 'special' ? ' selected' : '') + '>Special non-working</option>' +
        '</select></td>' +
        '<td>' + (isWork ? 'Yes' : '<span class="muted">No — rest day</span>') + '</td>' +
        '<td><button class="btn ghost tiny danger" data-del-hol="' + i + '" type="button">Remove</button></td>' +
        '</tr>';
    }).join('');
  }

  /* =====================================================================
     YEAR-END TAB
     ===================================================================== */
  function renderYearEnd() {
    $('#yearEndYear').textContent = '\u2014 ' + state.year;

    var opts = '<option value="">Do not post \u2014 report only</option>' +
      state.periods.map(function (p) {
        return '<option value="' + esc(p.id) + '">' + esc(p.label) + '</option>';
      }).join('');
    $('#sel13th').innerHTML = opts;
    $('#sel13th').value = state.settings.yearEnd.thirteenthMonthPeriodId || '';
    $('#selRefund').innerHTML = opts;
    $('#selRefund').value = state.settings.yearEnd.taxRefundPeriodId || '';

    var calcs = state.employees.map(function (emp) {
      return { emp: emp, ye: E.yearEndFor(emp, state.year, state.dtr, state.settings) };
    });

    var sum = { basic: 0, thirteenth: 0, paid13: 0, balance13: 0, bonus: 0, transport: 0, dm: 0, exempt: 0, taxable: 0, ytdTaxable: 0,
                annualTaxable: 0, due: 0, withheld: 0, adj: 0 };

    $('#yearEndBody').innerHTML = calcs.map(function (c) {
      var y = c.ye;
      sum.basic += y.ytd.basicEarned; sum.thirteenth += y.thirteenthMonth;
      sum.paid13 += y.thirteenthPaid; sum.balance13 += y.thirteenthBalance; sum.bonus += y.companyBonus;
      sum.transport += y.transport; sum.dm += y.yearEndBonus;
      sum.exempt += y.thirteenthExempt; sum.taxable += y.thirteenthTaxable;
      sum.ytdTaxable += y.ytd.taxableIncome; sum.annualTaxable += y.annualTaxableIncome;
      sum.due += y.annualTaxDue; sum.withheld += y.taxWithheld; sum.adj += y.adjustment;

      return '<tr class="clickable" data-ye-emp="' + esc(c.emp.id) + '" title="See how the 13th month was worked out">' +
        '<td class="sticky-col"><button class="link-btn" type="button">' +
          esc(c.emp.lastName + ', ' + c.emp.firstName) + '</button></td>' +
        '<td class="num">' + plain(c.emp.monthlyRate) + '</td>' +
        '<td class="num">' + y.ytd.periods + '</td>' +
        '<td class="num">' + plain(y.ytd.basicEarned) + '</td>' +
        '<td class="num">' + plain(y.thirteenthMonth) + '</td>' +
        money(y.thirteenthPaid) +
        '<td class="num strong">' + plain(y.thirteenthBalance) + '</td>' +
        money(y.yearEndBonus) +
        money(y.transport) +
        money(y.companyBonus) +
        money(y.thirteenthExempt) + money(y.thirteenthTaxable) +
        '<td class="num">' + plain(y.ytd.taxableIncome) + '</td>' +
        '<td class="num">' + plain(y.annualTaxableIncome) + '</td>' +
        '<td class="num">' + plain(y.annualTaxDue) + '</td>' +
        '<td class="num">' + plain(y.taxWithheld) + '</td>' +
        '<td class="num ' + (y.adjustment >= 0 ? 'net' : '') + '">' +
          (y.adjustment >= 0 ? plain(y.adjustment) : '(' + plain(Math.abs(y.adjustment)) + ')') +
        '</td></tr>';
    }).join('');

    $('#yearEndFoot').innerHTML = '<tr><td>TOTAL</td><td></td><td></td>' +
      '<td class="num">' + plain(E.r2(sum.basic)) + '</td>' +
      '<td class="num">' + plain(E.r2(sum.thirteenth)) + '</td>' +
      '<td class="num">' + plain(E.r2(sum.paid13)) + '</td>' +
      '<td class="num">' + plain(E.r2(sum.balance13)) + '</td>' +
      '<td class="num">' + plain(E.r2(sum.dm)) + '</td>' +
      '<td class="num">' + plain(E.r2(sum.transport)) + '</td>' +
      '<td class="num">' + plain(E.r2(sum.bonus)) + '</td>' +
      '<td class="num">' + plain(E.r2(sum.exempt)) + '</td>' +
      '<td class="num">' + plain(E.r2(sum.taxable)) + '</td>' +
      '<td class="num">' + plain(E.r2(sum.ytdTaxable)) + '</td>' +
      '<td class="num">' + plain(E.r2(sum.annualTaxable)) + '</td>' +
      '<td class="num">' + plain(E.r2(sum.due)) + '</td>' +
      '<td class="num">' + plain(E.r2(sum.withheld)) + '</td>' +
      '<td class="num net">' + plain(E.r2(sum.adj)) + '</td></tr>';

    var refunds = calcs.filter(function (c) { return c.ye.adjustment > 0; }).length;
    var dues = calcs.filter(function (c) { return c.ye.adjustment < 0; }).length;
    $('#yearEndStats').innerHTML = [
      stat('13th month still to pay', peso(E.r2(sum.balance13)), peso(E.r2(sum.thirteenth)) + ' for the year − ' +
        peso(E.r2(sum.paid13)) + ' already paid', 'accent'),
      stat('Tax-exempt portion', peso(E.r2(sum.exempt)),
        '13th month + transport + ex milestones, ceiling ' + peso(state.settings.yearEnd.thirteenthMonthExemption) + ' each'),
      stat('Taxable portion', peso(E.r2(sum.taxable)), 'added to annual taxable income'),
      stat('Net tax adjustment', peso(E.r2(sum.adj)), refunds + ' refundable \u00b7 ' + dues + ' still due',
        sum.adj >= 0 ? 'green' : '')
    ].join('');

    $('#leaveBody').innerHTML = calcs.map(function (c) {
      var l = c.ye.leave;
      var hired = c.emp.dateHired
        ? '<span title="' + esc(c.emp.dateHired) + '">' + esc(String(l.monetizeHireYear)) + '</span>'
        : '<span class="pill reg" title="No hire date on file — defaults to the lower cap">—</span>';
      return '<tr>' +
        '<td class="sticky-col">' + esc(c.emp.lastName + ', ' + c.emp.firstName) + '</td>' +
        '<td class="num">' + hired + '</td>' +
        '<td class="num">' + plain(l.credits) + '</td>' +
        '<td class="num">' + plain(l.usedThisYear) + '</td>' +
        '<td class="num strong">' + plain(l.remaining) + '</td>' +
        '<td class="num">' + plain(l.monetizeMaxDays) +
          (l.monetizeTenured ? ' <span class="pill rf">tenured</span>' : '') + '</td>' +
        '<td class="num strong">' + plain(l.monetizableDays) + '</td>' +
        '<td class="num">' + peso(l.monetizableAmount) + '</td>' +
        '<td>' + (l.overdrawn ? '<span class="pill reg">Overdrawn</span>'
          : l.remaining === 0 ? '<span class="pill spc">Fully used</span>'
          : l.monetizeCappedByRule
            ? '<span class="pill spc">' + plain(l.remaining) + ' left, capped at ' +
              plain(l.monetizeMaxDays) + '</span>'
          : '<span class="pill rf">' + plain(l.remaining) + ' day/s left</span>') + '</td>' +
        '</tr>';
    }).join('');
  }

  /* =====================================================================
     SETTINGS TAB
     ===================================================================== */
  function renderSettings() {
    $$('[data-setting]').forEach(function (el) {
      var val = getPath(state.settings, el.dataset.setting);
      if (el.type === 'checkbox') el.checked = !!val;
      else if (el.dataset.money !== undefined) el.value = amountValue(val);
      else el.value = val === undefined || val === null ? '' : val;
    });

    $('#taxBody').innerHTML = state.settings.taxTable.map(function (b, i) {
      var next = state.settings.taxTable[i + 1];
      var range = i === 0
        ? 'Not over ' + peso(state.settings.taxTable[1].min)
        : next ? 'Over ' + peso(b.min) + ' but not over ' + peso(next.min) : 'Over ' + peso(b.min);
      return '<tr><td>' + range + '</td><td class="num">' + plain(b.base) + '</td>' +
        '<td class="num">' + (b.rate * 100).toFixed(0) + '%</td></tr>';
    }).join('');

    renderContribPreview();
    $('#companyName').textContent = state.settings.company.name;
  }

  function renderContribPreview() {
    var rows = state.employees.map(function (emp) {
      var s = E.sssContribution(emp.monthlyRate, state.settings);
      var p = E.philhealthContribution(emp.monthlyRate, state.settings);
      var h = E.pagibigContribution(emp.monthlyRate, state.settings);
      return '<tr><td>' + esc(emp.lastName + ', ' + emp.firstName) + '</td>' +
        '<td class="num">' + plain(emp.monthlyRate) + '</td>' +
        '<td class="num">' + plain(s.eeRegular) + '</td>' +
        '<td class="num">' + plain(s.eeMPF) + '</td>' +
        '<td class="num">' + plain(s.ee) + '</td>' +
        '<td class="num">' + plain(p.ee) + '</td>' +
        '<td class="num">' + plain(h.ee) + '</td>' +
        '<td class="num strong">' + plain(E.r2(s.ee + p.ee + h.ee)) + '</td></tr>';
    }).join('');

    $('#contribPreview').innerHTML =
      '<p class="hint" style="margin:0 0 8px">Monthly employee contributions from the 2026 SSS table ' +
      'and the PhilHealth / HDMF rates above:</p>' +
      '<div class="table-scroll"><table class="grid compact"><thead><tr>' +
      '<th>Employee</th><th class="num">Monthly rate</th><th class="num">SSS regular EE</th>' +
      '<th class="num">SSS MPF EE</th><th class="num">SSS EE total</th>' +
      '<th class="num">PhilHealth EE</th><th class="num">HDMF EE</th>' +
      '<th class="num">Total / month</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* =====================================================================
     PAYSLIP — release payslips to TrinityHR accounts and set what they show
     The app runs inside TrinityHR, so these calls carry the admin's session.
     A batch is one payroll cutoff ("2026-11-P10") or one uploaded
     Non-Trinity file ("notax-2026-10-23", "xk-2026-10-23").
     ===================================================================== */
  var ps = { settings: null, status: null, batches: [], upload: null };
  var KIND_NAME = { trinity: 'Trinity payroll', notax: 'No-Tax payroll', xk: 'XK payroll' };

  function psApi(path, method, body) {
    return fetch('/api/payroll/' + path, {
      method: method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.error || 'TrinityHR answered ' + res.status);
        return data;
      });
    });
  }

  function psWhen(t) { return new Date(t).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' }); }
  function psDay(d) { return E.fmtShort(E.parseYmd(d)) + ' ' + d.slice(0, 4); }
  function psMoney(n, cur) {
    try { return Number(n).toLocaleString('en-PH', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }); }
    catch (e) { return cur + ' ' + plain(n); }
  }
  function trinityBatch(per) { return per.id; }

  function renderPayslipTab() {
    wiseShowSummary();
    $('#psYear').textContent = state.year;
    $('#psPeriod').innerHTML = state.periods.map(function (p) {
      return '<option value="' + p.id + '">' + esc(window.PayrollTemplate.cutoffTitle(p)) +
        ' (paid ' + esc(E.fmtShort(E.parseYmd(p.payoutDate))) + ')</option>';
    }).join('');
    $('#psPeriod').value = state.period.id;
    psLoadStatus();
    psLoadBatches();
    if (!ps.settings) {
      psApi('payslip-settings').then(function (d) { ps.settings = d.settings; psRenderSettings(); },
        function (err) { $('#psSettingsMsg').textContent = 'Could not load: ' + err.message; });
    }
  }

  /* ---- Trinity cutoff ---- */
  function psLoadStatus() {
    var id = trinityBatch(state.period);
    $('#psStatus').textContent = 'Checking TrinityHR…';
    $('#psUnmatched').classList.add('hidden');
    return psApi('payslips?batch=' + encodeURIComponent(id)).then(function (d) {
      if (trinityBatch(state.period) !== id) return;
      ps.status = d;
      var n = d.payslips.length;
      $('#psStatus').innerHTML = !n
        ? 'Not prepared yet — ' + state.run.slips.length + ' payslip(s) on this cutoff here.'
        : n + ' payslip(s) prepared ' + esc(psWhen(d.prepared_at)) + ' · ' +
          (d.published_at
            ? '<span class="pill rf">Published ' + esc(psWhen(d.published_at)) + '</span> employees can see them.'
            : '<span class="pill spc">Not published</span> employees can’t see them yet.');
      $('#psPublish').disabled = !n || !!d.published_at;
      $('#psUnpublish').disabled = !d.published_at;
    }, function (err) {
      $('#psStatus').textContent = 'Could not reach TrinityHR: ' + err.message;
    });
  }

  function psShowMissed(box, missed) {
    box.innerHTML = missed.length
      ? '<strong>' + missed.length + ' not saved</strong> — no TrinityHR account with that work email, or the row could not be read:' +
        '<ul>' + missed.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>'
      : '';
    box.classList.toggle('hidden', !missed.length);
  }

  function psPrepare() {
    var per = state.period, slips = state.run.slips;
    if (!slips.length) { alert('There are no payslips on this cutoff.'); return; }
    var cut = window.PayrollTemplate.cutoffTitle(per);
    if (ps.status && ps.status.published_at &&
        !confirm(cut + ' is already published.\n\nPreparing it again replaces what employees see with the figures here now. Continue?')) return;
    var noEmail = slips.filter(function (s) { return !String(s.employee.email || '').trim(); });
    var byEmail = {};
    slips.forEach(function (s) {
      var e = String(s.employee.email || '').trim().toLowerCase();
      if (e) byEmail[e] = s.employee.lastName + ', ' + s.employee.firstName;
    });
    var btn = $('#psPrepare');
    btn.disabled = true; btn.textContent = 'Preparing…';
    psApi('payslips', 'PUT', {
      batch: { id: trinityBatch(per), label: cut, payout_date: per.payoutDate, cutoff_start: per.start, cutoff_end: per.end },
      payslips: slips.filter(function (s) { return String(s.employee.email || '').trim(); }).map(function (s) {
        var p = trinityPayload(s);
        p.currency = 'PHP';
        return p;
      })
    }).then(function (r) {
      var missed = r.unmatched.concat(r.invalid).map(function (e) { return (byEmail[e] || e) + ' — ' + e; })
        .concat(noEmail.map(function (s) { return s.employee.lastName + ', ' + s.employee.firstName + ' — no email on file'; }));
      return Promise.all([psLoadStatus(), psLoadBatches(trinityBatch(per))]).then(function () {
        psShowMissed($('#psUnmatched'), missed);
      });
    }).catch(function (err) {
      alert('Could not prepare payslips.\n\n' + err.message);
    }).then(function () {
      btn.disabled = false; btn.textContent = 'Prepare payslips';
    });
  }

  function psRelease(id, label, count, publish) {
    if (!confirm(publish
      ? 'Publish ' + count + ' payslip(s) for ' + label + '?\n\nEach person will see their own under My Workspace → Payslips.'
      : 'Unpublish ' + label + '?\n\nEmployees will no longer see these payslips.')) return;
    psApi('payslips/release', 'POST', { batch_id: id, published: publish })
      .then(function () { return Promise.all([psLoadStatus(), psLoadBatches()]); },
        function (err) { alert('Could not ' + (publish ? 'publish' : 'unpublish') + '.\n\n' + err.message); });
  }

  /* ---- all batches + preview ---- */
  function psLoadBatches(select) {
    return psApi('payslips').then(function (d) {
      ps.batches = d.batches;
      var t = $('#psBatches');
      t.innerHTML = !d.batches.length
        ? '<tbody><tr><td class="muted">Nothing prepared or uploaded yet.</td></tr></tbody>'
        : '<thead><tr><th>Payroll</th><th>Period</th><th>Payout</th><th class="num">Payslips</th><th>Status</th><th></th></tr></thead><tbody>' +
          d.batches.map(function (b, i) {
            return '<tr><td>' + esc(KIND_NAME[b.kind] || b.kind) + '</td><td>' + esc(b.label) + '</td><td>' + esc(psDay(b.payout_date)) +
              '</td><td class="num">' + b.count + '</td><td>' +
              (b.published_at ? '<span class="pill rf">Published</span>' : '<span class="pill spc">Draft</span>') +
              '</td><td style="white-space:nowrap">' +
              '<button class="btn ghost tiny" data-bview="' + i + '" type="button">Preview</button> ' +
              (b.kind === 'notax' ? '<button class="btn ghost tiny" data-bwise="' + i + '" type="button">Wise CSV</button> ' : '') +
              (b.published_at
                ? '<button class="btn ghost tiny" data-bunpub="' + i + '" type="button">Unpublish</button> '
                : '<button class="btn tiny" data-bpub="' + i + '" type="button"' + (b.count ? '' : ' disabled') + '>Publish</button> ') +
              '<button class="btn ghost danger tiny" data-bdel="' + i + '" type="button">Delete</button></td></tr>';
          }).join('') + '</tbody>';
      var sel = $('#psPreviewBatch'), keep = select || sel.value || trinityBatch(state.period);
      sel.innerHTML = d.batches.length
        ? d.batches.map(function (b) {
            return '<option value="' + esc(b.id) + '">' + esc(KIND_NAME[b.kind] + ' · ' + b.label + ' · paid ' + psDay(b.payout_date)) + '</option>';
          }).join('')
        : '<option value="">—</option>';
      if (d.batches.some(function (b) { return b.id === keep; })) sel.value = keep;
      return psLoadPreviewPeople();
    }, function (err) {
      $('#psBatches').innerHTML = '<tbody><tr><td>Could not reach TrinityHR: ' + esc(err.message) + '</td></tr></tbody>';
    });
  }

  function psLoadPreviewPeople() {
    var id = $('#psPreviewBatch').value, sel = $('#psEmployee');
    if (!id) { sel.innerHTML = '<option value="">—</option>'; psPreview(); return Promise.resolve(); }
    return psApi('payslips?batch=' + encodeURIComponent(id)).then(function (d) {
      var keep = sel.value;
      sel.innerHTML = d.payslips.length
        ? d.payslips.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }).map(function (x) {
            return '<option value="' + esc(x.id) + '">' + esc(x.name) + ' — ' + esc(psMoney(x.net_pay, x.currency)) + '</option>';
          }).join('')
        : '<option value="">—</option>';
      if (keep && d.payslips.some(function (x) { return x.id === keep; })) sel.value = keep;
      psPreview();
    });
  }

  function psPreview() {
    var batch = $('#psPreviewBatch').value, user = $('#psEmployee').value, frame = $('#psPreview');
    frame.classList.toggle('hidden', !(batch && user));
    if (batch && user) frame.src = '/payslip-preview/' + encodeURIComponent(batch) + '/' + encodeURIComponent(user) + '?t=' + Date.now();
  }

  function psBatchClick(ev) {
    var t = ev.target.closest('button');
    if (!t) return;
    var b;
    if (t.dataset.bview !== undefined) {
      b = ps.batches[+t.dataset.bview];
      $('#psPreviewBatch').value = b.id;
      psLoadPreviewPeople().then(function () { $('#psPreview').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    } else if (t.dataset.bwise !== undefined) {
      wiseExport(ps.batches[+t.dataset.bwise]);
    } else if (t.dataset.bpub !== undefined) {
      b = ps.batches[+t.dataset.bpub];
      psRelease(b.id, KIND_NAME[b.kind] + ' · ' + b.label, b.count, true);
    } else if (t.dataset.bunpub !== undefined) {
      b = ps.batches[+t.dataset.bunpub];
      psRelease(b.id, KIND_NAME[b.kind] + ' · ' + b.label, b.count, false);
    } else if (t.dataset.bdel !== undefined) {
      b = ps.batches[+t.dataset.bdel];
      if (!confirm('Delete ' + KIND_NAME[b.kind] + ' · ' + b.label + ' (' + b.count + ' payslips)?' +
        (b.published_at ? '\n\nIt is published — employees will lose these payslips.' : ''))) return;
      psApi('payslips?batch=' + encodeURIComponent(b.id), 'DELETE')
        .then(function () { return Promise.all([psLoadStatus(), psLoadBatches()]); },
          function (err) { alert('Could not delete.\n\n' + err.message); });
    }
  }

  /* ---- Wise bulk payments for Non-Trinity batches ----
     Wise's bulk CSV pays existing recipients by ID, which TrinityHR doesn't
     have, so they're remembered from a Wise CSV already used (by email, in
     the shared settings). Two files, as Wise is paid: EUR, and every other
     currency together ("PHP USD"); anyone with
     no remembered recipient still gets a row, listed to fill in. The
     reference is initials + the payroll's MMYYYY, as in past Wise files.

     Some people are paid into two accounts. A Wise CSV with a note in the
     column after receiverType sets that up: rows with the same email are
     one person's accounts, and each note says what that account gets —
     "gross salary", "half of gross salary" / "other half", "commission and
     other payments" (what's left of net pay; with no such account, the
     first half account gets it), or the salary "converted" (to that
     account's currency at OANDA's rate for the payout date). */
  var WISE_HEAD = ['recipientId', 'name', 'recipientEmail', 'recipientDetail', 'sourceCurrency', 'targetCurrency',
    'amountCurrency', 'amount', 'paymentReference', 'referenceNumber', 'receiverType'];
  function wiseKey(v) {
    return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  }
  function wiseRecipients() { return state.settings.wise.recipients || {}; }
  function wiseSplits() { return state.settings.wise.splits || {}; }
  function wiseShowSummary() {
    var n = Object.keys(wiseRecipients()).length, sp = Object.keys(wiseSplits()).length;
    $('#wiseSummary').textContent = (n ? n + ' Wise recipient(s) remembered.' : 'No Wise recipients remembered yet.') +
      (sp ? ' ' + sp + ' paid into more than one account.' : '');
  }
  /** A split row's note → what that account gets. */
  function wisePart(note) {
    if (/convert/i.test(note)) return 'salarySource';
    if (/half/i.test(note)) return 'half';
    if (/commission|other/i.test(note)) return 'rest';
    if (/salary/i.test(note)) return 'salary';
    return 'rest';
  }
  function wiseLoad() {
    var f = $('#wiseFile').files[0];
    if (!f) return;
    window.XlsxWriter.read(f).then(function (sheets) {
      var rows = sheets[Object.keys(sheets)[0]] || [];
      var head = (rows[0] || []).map(function (h) { return String(h || '').trim(); });
      var col = function (r, name) { var i = head.indexOf(name); return i === -1 ? '' : String(r[i] === null || r[i] === undefined ? '' : r[i]).trim(); };
      if (head.indexOf('recipientId') === -1 || head.indexOf('recipientEmail') === -1) {
        throw new Error('Not a Wise bulk CSV: it needs recipientId and recipientEmail columns.');
      }
      var found = {}, splits = {}, noteAt = head.indexOf('receiverType') + 1;
      rows.slice(1).forEach(function (r) {
        var email = col(r, 'recipientEmail').toLowerCase(), id = col(r, 'recipientId');
        if (!email || !id) return;
        var note = noteAt > 0 ? String(r[noteAt] === null || r[noteAt] === undefined ? '' : r[noteAt]).trim() : '';
        if (note) {
          (splits[email] = splits[email] || []).push({ id: id, name: col(r, 'name'), detail: col(r, 'recipientDetail'),
            type: col(r, 'receiverType') || 'PERSON', currency: col(r, 'targetCurrency').toUpperCase(), part: wisePart(note) });
          return;
        }
        // Someone with two recipients: keep the one their salary went to.
        var salary = /^[A-Z]+\d+ - Salary$/i.test(col(r, 'paymentReference'));
        if (found[email] && !(salary && !found[email].salary)) return;
        // "AG102026 - Salary" → AG, the letters their payment references start with
        var initials = (col(r, 'paymentReference').match(/^([A-Z]+)\d+ - Salary$/i) || [])[1] || '';
        found[email] = { id: id, name: col(r, 'name'), detail: col(r, 'recipientDetail'),
          type: col(r, 'receiverType') || 'PERSON', initials: initials.toUpperCase(), salary: salary };
      });
      var emails = Object.keys(found), splitEmails = Object.keys(splits);
      if (!emails.length && !splitEmails.length) throw new Error('No rows with both a recipientId and a recipientEmail.');
      var all = wiseRecipients(), allSplits = wiseSplits();
      emails.forEach(function (e) {
        delete found[e].salary;
        if (!found[e].initials && all[e]) found[e].initials = all[e].initials;   // a file without references keeps them
        all[e] = found[e];
      });
      // A split file replaces that person's accounts; one row alone isn't a split.
      splitEmails.forEach(function (e) { if (splits[e].length > 1) allSplits[e] = splits[e]; });
      state.settings.wise.recipients = all;
      state.settings.wise.splits = allSplits;
      Store.saveSettings(state.settings);
      wiseShowSummary();
      $('#wiseSummary').textContent += ' Loaded ' + (emails.length ? emails.length + ' recipient(s)' : '') +
        (emails.length && splitEmails.length ? ' and ' : '') +
        (splitEmails.length ? splitEmails.length + ' split(s)' : '') + ' from ' + f.name + '.';
    }).catch(function (err) {
      $('#wiseSummary').textContent = err.message;
    }).then(function () { $('#wiseFile').value = ''; });
  }
  /** OANDA rates for salaries a split sends in another currency, on the payout date: { 'USDPHP': 63.38 }. */
  function wiseRates(d, b) {
    var to = {}, from = {}, rates = {};
    Object.keys(wiseSplits()).forEach(function (e) {
      wiseSplits()[e].forEach(function (a) { if (a.part === 'salarySource' && a.currency) to[a.currency] = 1; });
    });
    d.payslips.forEach(function (p) { from[p.currency] = 1; });
    var pairs = [];
    Object.keys(from).forEach(function (f) { Object.keys(to).forEach(function (t) { if (f !== t) pairs.push([f, t]); }); });
    return Promise.all(pairs.map(function (pr) {
      return psApi('fx?base=' + pr[0] + '&quote=' + pr[1] + '&date=' + b.payout_date)
        .then(function (r) { rates[pr[0] + pr[1]] = r.rate; }, function () { /* listed as missing */ });
    })).then(function () { return rates; });
  }
  function wiseExport(b) {
    psApi('payslips?batch=' + encodeURIComponent(b.id)).then(function (d) {
      return wiseRates(d, b).then(function (rates) { return { d: d, rates: rates }; });
    }).then(function (x) {
      var d = x.d, rates = x.rates;
      // Wise often has someone's personal email, so after the work email try
      // the roster's personal email, then first + last name.
      var rec = wiseRecipients(), byName = {}, byFirstLast = {};
      var firstLast = function (name) { var w = wiseKey(name).split(' '); return w[0] + ' ' + w[w.length - 1]; };
      Object.keys(rec).forEach(function (e) {
        byName[wiseKey(rec[e].name)] = e;
        var k = firstLast(rec[e].name);
        byFirstLast[k] = byFirstLast[k] && byFirstLast[k] !== e ? null : e;   // two people: neither
      });
      var roster = {};
      state.employees.forEach(function (emp) { if (emp.email) roster[String(emp.email).trim().toLowerCase()] = emp; });
      // Remembered recipients know their email, for finding a split.
      Object.keys(rec).forEach(function (e) { rec[e].email = e; });
      var splits = wiseSplits();
      var recipientOf = function (p) {
        var email = (p.email || '').toLowerCase(), emp = roster[email];
        if (splits[email]) return { email: email, id: splits[email][0].id, name: splits[email][0].name };
        if (emp && emp.personalEmail && splits[String(emp.personalEmail).trim().toLowerCase()]) {
          return { email: String(emp.personalEmail).trim().toLowerCase() };
        }
        return rec[email] ||
          (emp && emp.personalEmail && rec[String(emp.personalEmail).trim().toLowerCase()]) ||
          rec[byName[wiseKey(p.name)]] ||
          (emp && rec[byFirstLast[firstLast(emp.firstName + ' ' + emp.lastName)]]) ||
          rec[byFirstLast[firstLast(p.name)]];
      };
      var source = String(state.settings.wise.sourceCurrency || 'USD').trim().toUpperCase();
      // Reference: initials + the payroll's month and year, "AG102026 - Salary".
      var lm = String(b.label).match(/^([A-Za-z]+) (\d{4})$/), mi = lm ? MONTHS.indexOf(lm[1]) : -1;
      var when = mi >= 0 ? ('0' + (mi + 1)).slice(-2) + lm[2] : b.payout_date.slice(5, 7) + b.payout_date.slice(0, 4);
      var initials = function (p, r) {
        return (r && r.initials) || (String(p.code).match(/^[A-Za-z]+/) || [''])[0].toUpperCase() ||
          wiseKey(p.name).split(' ').map(function (w) { return w.charAt(0); }).join('').toUpperCase();
      };
      var files = {}, missing = [], viaBpi = [], split = [], used = {};
      d.payslips.slice().sort(function (x, y) { return x.name.localeCompare(y.name); }).forEach(function (p) {
        var r = recipientOf(p), emp = roster[(p.email || '').toLowerCase()];
        // PHP with no Wise recipient but a BPI account is paid through BPI.
        if (!r && p.currency === 'PHP' && emp && isBpi(emp)) { viaBpi.push(p.name + ', ' + psMoney(p.net_pay, 'PHP')); return; }
        if (!r) missing.push(p.name + ' (' + p.currency + ')');
        var add = function (a, currency, amountCurrency, amount) {
          var file = currency === 'EUR' ? 'EUR' : 'other';
          (files[file] = files[file] || []).push([
            a ? a.id : '', a ? a.name : p.name, p.email || '', a ? a.detail : '', source, currency,
            amountCurrency, String(E.r2(amount)), initials(p, r && rec[r.email]) + when + ' - Salary', '', a ? a.type : 'PERSON'
          ]);
        };
        var parts = r && splits[r.email], salary = E.r2(p.salary || 0), net = E.r2(p.net_pay);
        if (!parts || !(salary > 0) || salary > net) {
          if (parts) split.push(p.name + ': no salary line to split by, so all of it went to one account');
          add(parts ? parts[0] : r, p.currency, 'target', net);
          return;
        }
        // The salary parts first, then whatever is left of net pay: to the
        // "commission and other payments" account, else the first half account.
        // amt counts against net pay; sent is what goes in the file, in the account's currency.
        var halves = 0, given = 0, out = [], restAt = -1, firstHalf = -1;
        parts.forEach(function (a) {
          var amt, currency = a.currency || p.currency, sent = null;
          if (a.part === 'salary') amt = salary;
          else if (a.part === 'half') {
            if (firstHalf === -1) firstHalf = out.length;
            amt = halves++ ? E.r2(salary - E.r2(salary / 2)) : E.r2(salary / 2);   // the second takes the odd cent
          } else if (a.part === 'salarySource') {
            // The salary, converted to this account's currency at OANDA's rate.
            amt = salary;
            if (currency !== p.currency) {
              var rate = rates[p.currency + currency];
              if (rate) { sent = E.r2(salary * rate); used[p.currency + currency] = rate; }
              else { split.push(p.name + ': no ' + p.currency + '\u2192' + currency + ' rate, so ' + a.name + '\u2019s row is in ' + p.currency); currency = p.currency; }
            }
          } else { if (restAt === -1) restAt = out.length; amt = 0; }
          out.push({ a: a, currency: currency, amt: amt, sent: sent });
          given += amt;
        });
        var left = E.r2(net - given), to = restAt !== -1 ? restAt : firstHalf;
        if (left && to !== -1) out[to].amt = E.r2(out[to].amt + left);
        else if (left) split.push(p.name + ': ' + psMoney(left, p.currency) + ' beyond the salary has no account for it \u2014 add it to a row');
        out.forEach(function (o) {
          if (o.amt > 0) add(o.a, o.currency, 'target', o.sent === null ? o.amt : o.sent);   // nothing to pay: no row
        });
      });
      // The non-EUR file is named by what's in it, "PHP USD".
      var nameOf = function (f) {
        if (f === 'EUR') return 'EUR';
        var seen = {};
        files.other.forEach(function (r) { seen[r[5]] = 1; });
        return Object.keys(seen).sort().join(' ');
      };
      var curs = ['EUR', 'other'].filter(function (f) { return files[f]; });
      if (!curs.length) { alert('This batch has no payslips.'); return; }
      curs.forEach(function (cur, i) {
        var csv = [WISE_HEAD].concat(files[cur]).map(function (r) {
          return r.map(function (v) { return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
        }).join('\n');
        // A moment apart, or the browser keeps only the first download.
        setTimeout(function () {
          window.XlsxWriter.download(new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
            'Bulk Uploads - ' + b.label + ' ' + nameOf(cur) + '.csv');
        }, i * 600);
      });
      var msg = [curs.map(function (c) { return files[c].length + ' in ' + nameOf(c); }).join(', ') + ' \u2014 one Wise CSV each.'];
      Object.keys(used).forEach(function (k) {
        msg.push('Converted at OANDA ' + k.slice(0, 3) + '\u2192' + k.slice(3) + ' ' + used[k] + ' (for ' + psDay(b.payout_date) + ').');
      });
      if (split.length) msg.push('\nSplit pay to check:\n  ' + split.join('\n  '));
      if (viaBpi.length) msg.push('\nNot in Wise \u2014 PHP to their BPI account (' + viaBpi.length + '):\n  ' + viaBpi.join('\n  '));
      if (missing.length) msg.push('\nNo Wise recipient remembered for these, so their recipientId is blank \u2014 fill it in, ' +
        'or load a Wise CSV that has them (' + missing.length + '):\n  ' + missing.join('\n  '));
      alert(msg.join('\n'));
    }, function (err) { alert('Could not read the batch.\n\n' + err.message); });
  }

  /* ---- Non-Trinity uploads (Payslip Generator CSV, or the templates below) ---- */
  function csvNum(v) {
    var t = String(v || '').replace(/[,\s]/g, '');
    if (!t || t === '—' || t === '-') return 0;
    var n = parseFloat(t);
    return isFinite(n) ? E.r2(n) : NaN;
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /** A date as YYYY-MM-DD: from an Excel date number, "10/23/2026" or as is. */
  function csvDate(v) {
    var t = String(window.XlsxWriter.toYmd(v) || '').trim(), m;
    if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
    return t;
  }

  /** "October 2026" as is; a date ("10/1/2026", "2026-10-01", Excel's) as "October 2026". */
  function csvPeriod(v) {
    var t = csvDate(v), m;
    if ((m = t.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/))) return MONTHS[+m[1] - 1] + ' ' + m[2];
    if ((m = t.match(/^(\d{4})-(\d{2})-\d{2}$/))) return MONTHS[+m[2] - 1] + ' ' + m[1];
    return t;
  }

  /* Mirrors the Payslip Generator sheets (payslip-sheet/NoTax.gs and
     kosovo/SetupKosovo.gs): the same lines, labels and footer. */
  function readPayslipRows(rows, opts) {
    var hi = -1;
    rows = rows.map(function (r) { return (r || []).map(function (c) { return c === null || c === undefined ? '' : c; }); });
    for (var r = 0; r < Math.min(rows.length, 20); r++) {
      if (String(rows[r][0] || '').trim() === 'No' && rows[r].indexOf('Email') !== -1) { hi = r; break; }
    }
    if (hi < 0) throw new Error('No header row starting with "No" … "Email" — use a template above, or the Payslip Generator\u2019s CSV.');
    var head = rows[hi].map(function (h) { return String(h).replace(/\s*\([A-Z]{3}\)\s*$/, '').trim().toLowerCase(); });
    var kind = head.indexOf('tax status') !== -1 ? 'xk' : head.indexOf('currency') !== -1 ? 'notax' : null;
    if (!kind) throw new Error('Neither a No-Tax payroll (Currency column) nor an XK payroll (Tax status column).');
    var title = String(rows[0][0] || ''), cur = (title.match(/\(([A-Z]{3})\)/) || [])[1] || 'EUR';
    var col = function (row, name) { var i = head.indexOf(name); return i === -1 ? '' : String(row[i] || '').trim(); };

    var out = { kind: kind, payslips: [], problems: [], payouts: {}, periods: {}, currencies: {}, defaulted: 0 };
    rows.slice(hi + 1).forEach(function (row, k) {
      if (!row.some(function (c) { return String(c).trim(); })) return;
      var line = hi + k + 2, who = col(row, 'employee') || ('row ' + line);
      var email = col(row, 'email');
      var v = {}, bad = [];
      ['net', 'gross salary', 'commission', 'bonus', 'deduction / adjustment',
        kind === 'xk' ? 'reimbursement, non-taxable' : 'reimbursement',
        'employee contribution 5%', 'employer contribution 5%', 'taxable base', 'withholding tax'].forEach(function (c) {
        v[c] = csvNum(col(row, c));
        if (isNaN(v[c])) bad.push(c);
      });
      if (bad.length) { out.problems.push(who + ' (row ' + line + '): not a number under ' + bad.join(', ') + ' — skipped.'); return; }
      if (!email) { out.problems.push(who + ' (row ' + line + '): no email — skipped.'); return; }

      var reimb = v[kind === 'xk' ? 'reimbursement, non-taxable' : 'reimbursement'];
      var earn = [{ label: 'Gross Salary', amount: v['gross salary'] }];
      if (v.commission) {
        earn.push({ label: 'Commission', amount: v.commission });
        col(row, 'commission details').split(/\n|;/).forEach(function (d) {
          d = d.trim();
          if (d) earn.push({ label: d, amount: null, kind: 'sub' });
        });
      }
      if (v.bonus) {
        var bd = col(row, 'bonus description');
        earn.push({ label: 'Bonus' + (bd ? ' – ' + bd : ''), amount: v.bonus });
      }
      if (reimb) earn.push({ label: kind === 'xk' ? 'Reimbursement (non-taxable)' : 'Reimbursement', amount: reimb });
      var ded = [];
      if (v['deduction / adjustment']) {
        ded.push({ label: col(row, 'deduction description') || 'Salary / Commission Adjustment', amount: v['deduction / adjustment'] });
      }
      var info = [];
      if (kind === 'xk') {
        ded.push({ label: 'Pension Contribution, Employee 5% (Trust)', amount: v['employee contribution 5%'] });
        ded.push({ label: 'Withholding Tax', amount: v['withholding tax'] });
        info.push({ label: 'Taxable base', value: psMoney(v['taxable base'], cur) });
        info.push({ label: 'Employer pension contribution', value: psMoney(v['employer contribution 5%'], cur) });
        var ts = col(row, 'tax status'), emp = col(row, 'employer');
        if (ts || emp) info.push({ label: 'Tax status', value: [ts, emp ? emp.toLowerCase() + ' employer' : ''].filter(Boolean).join(', ') });
      }
      if (col(row, 'reference')) info.push({ label: 'Reference', value: col(row, 'reference') });

      var sum = function (ls) { return E.r2(ls.reduce(function (t, l) { return t + (l.amount || 0); }, 0)); };
      var gross = sum(earn), totalDed = sum(ded), net = E.r2(gross - totalDed);
      if (Math.abs(net - v.net) > 0.005) {
        out.problems.push(who + ' (row ' + line + '): earnings − deductions = ' + plain(net) + ' but Net says ' + plain(v.net) + ' — skipped.');
        return;
      }
      var currency = kind === 'xk' ? cur : col(row, 'currency').toUpperCase();
      if (!currency) { currency = opts.currency; out.defaulted++; }
      if (!/^[A-Z]{3}$/.test(currency)) { out.problems.push(who + ' (row ' + line + '): currency "' + currency + '" — skipped.'); return; }

      var payout = csvDate(col(row, 'payout date'));
      out.payouts[payout] = (out.payouts[payout] || 0) + 1;
      out.periods[csvPeriod(col(row, 'payroll period'))] = true;
      out.currencies[currency] = (out.currencies[currency] || 0) + 1;
      out.payslips.push({
        name: who,
        email: email,
        currency: currency,
        lines: {
          earnings: earn,
          deductions: ded,
          company: { name: opts.company, address: opts.address },
          employee: { code: col(row, 'employee code') || col(row, 'no'), position: col(row, 'position'),
            personal_no: col(row, 'personal no.') },
          info: info
        },
        gross_pay: gross,
        total_deductions: totalDed,
        net_pay: net,
        remarks: col(row, 'notes') || null
      });
    });
    var payouts = Object.keys(out.payouts), periods = Object.keys(out.periods);
    if (payouts.length !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(payouts[0])) {
      throw new Error('Every row needs the same Payout Date as YYYY-MM-DD; found ' + (payouts.join(', ') || 'none') + '.');
    }
    out.payout = payouts[0];
    out.label = periods.length === 1 && periods[0] ? periods[0] : csvPeriod(out.payout);
    out.id = kind + '-' + out.payout;
    // The month the label names ("October 2026"), else the payout's month.
    var lm = out.label.match(/^([A-Za-z]+) (\d{4})$/), mi = lm ? MONTHS.indexOf(lm[1]) : -1;
    var y = mi >= 0 ? +lm[2] : +out.payout.slice(0, 4), mo = mi >= 0 ? mi : +out.payout.slice(5, 7) - 1;
    var pad2 = function (n) { return (n < 10 ? '0' : '') + n; };
    out.start = y + '-' + pad2(mo + 1) + '-01';
    out.end = y + '-' + pad2(mo + 1) + '-' + pad2(new Date(y, mo + 1, 0).getDate());
    return out;
  }

  function upRead() {
    var f = $('#upFile').files[0];
    ps.upload = null;
    $('#upSave').disabled = true;
    $('#upUnmatched').classList.add('hidden');
    if (!f) { $('#upSummary').innerHTML = ''; return; }
    window.XlsxWriter.read(f).then(function (sheets) {
      var cur = $('#upCurrency').value.trim().toUpperCase() || 'EUR';
      var opts = { company: $('#upCompany').value.trim(), address: $('#upAddress').value.trim(), currency: cur };
      // The first sheet with the header row: a template's, or the CSV's only one.
      var up = null, err = null;
      Object.keys(sheets).some(function (n) {
        try { up = readPayslipRows(sheets[n], opts); return true; } catch (e) { err = err || e; return false; }
      });
      if (!up) throw err || new Error('The file is empty.');
      ps.upload = up;
      var existing = ps.batches.filter(function (b) { return b.id === up.id; })[0];
      $('#upSummary').innerHTML = '<div class="notice info">' +
        '<strong>' + esc(KIND_NAME[up.kind]) + ' · ' + esc(up.label) + ' · paid ' + esc(psDay(up.payout)) + '</strong> — ' +
        up.payslips.length + ' payslip(s): ' +
        Object.keys(up.currencies).map(function (c) { return up.currencies[c] + ' in ' + c; }).join(', ') +
        (up.defaulted ? ' (' + up.defaulted + ' with no currency, read as ' + esc(cur) + ')' : '') + '.' +
        (existing ? '<br>This replaces the ' + (existing.published_at ? '<strong>published</strong> ' : '') +
          'batch already uploaded for that payout (' + existing.count + ' payslips).' : '') +
        (up.problems.length ? '<ul>' + up.problems.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '') +
        '</div>';
      $('#upSave').disabled = !up.payslips.length;
    }).catch(function (err) {
      $('#upSummary').innerHTML = '<div class="notice warn">' + esc(err.message) + '</div>';
    });
  }

  function upSave() {
    var up = ps.upload;
    if (!up) return;
    var existing = ps.batches.filter(function (b) { return b.id === up.id; })[0];
    if (existing && existing.published_at &&
        !confirm('That payroll is already published.\n\nUploading replaces what employees see. Continue?')) return;
    var names = {};
    up.payslips.forEach(function (p) { names[p.email.toLowerCase()] = p.name; });
    var btn = $('#upSave');
    btn.disabled = true; btn.textContent = 'Uploading…';
    psApi('payslips', 'PUT', {
      batch: { id: up.id, label: up.label, payout_date: up.payout, cutoff_start: up.start, cutoff_end: up.end },
      payslips: up.payslips,
      // TrinityHR picks each payslip's company from the person's country.
      company_by_country: { kosovo: $('#upCompany').value.trim(), other: $('#upCompanyOther').value.trim() }
    }).then(function (r) {
      var missed = r.unmatched.concat(r.invalid).map(function (e) { return (names[e] || e) + ' — ' + e; });
      psShowMissed($('#upUnmatched'), missed);
      $('#upSummary').innerHTML = '<div class="notice info"><strong>Uploaded as a draft</strong> — ' + r.saved +
        ' payslip(s) saved. Preview them below, then Publish in the list.</div>';
      $('#upFile').value = '';
      ps.upload = null;
      return psLoadBatches(up.id);
    }).catch(function (err) {
      alert('Could not upload.\n\n' + err.message);
      btn.disabled = false;
    }).then(function () { btn.textContent = 'Upload as draft'; });
  }

  /* Templates for the uploads above: the Payslip Generator's columns, with
     the sheets' formulas (payslip-sheet/NoTax.gs, kosovo/SetupKosovo.gs) so
     Net — and for XK the pension and tax — fill themselves in. */
  var TEMPLATE_ROWS = 200;
  function downloadPayslipTemplate(kind) {
    var X = window.XlsxWriter, S = X.S, xk = kind === 'xk';
    var head = xk
      ? ['No', 'Employee', 'Tax status', 'Bank country', 'Bank / receiving account', 'Email', 'Employer', 'Net (EUR)',
         'Gross salary (EUR)', 'Commission (EUR)', 'Commission details', 'Bonus (EUR)', 'Bonus description',
         'Reimbursement, non-taxable (EUR)', 'Deduction / adjustment (EUR)', 'Deduction description', 'Total gross (EUR)',
         'Employee contribution 5% (EUR)', 'Employer contribution 5% (EUR)', 'Taxable base (EUR)', 'Withholding tax (EUR)',
         'Cost to employer (EUR)', 'Reference', 'Notes', 'Position', 'Employee Code', 'Personal No.', 'Payroll Period', 'Payout Date']
      : ['No', 'Employee', 'Currency', 'Bank country', 'Bank / receiving account', 'Email', 'Net', 'Gross salary', 'Commission',
         'Commission details', 'Bonus', 'Bonus description', 'Reimbursement', 'Deduction / adjustment', 'Deduction description',
         'Reference', 'Notes', 'Position', 'Employee Code', 'Personal No.', 'Payroll Period', 'Payout Date'];
    var C = {};
    head.forEach(function (h, i) { C[h.replace(/ \(EUR\)$/, '')] = X.colName(i + 1); });
    var calc = xk
      ? ['Net', 'Total gross', 'Employee contribution 5%', 'Employer contribution 5%', 'Taxable base', 'Withholding tax',
         'Cost to employer', 'Payroll Period', 'Payout Date']
      : ['Net', 'Payroll Period', 'Payout Date'];
    var formulas = function (r) {
      var L = function (h) { return C[h] + r; };
      var on = xk ? L('Gross salary') : L('Employee');
      var blank = function (f) { return 'IF(' + on + '="","",' + f + ')'; };
      var f = { 'Payroll Period': blank('$B$2'), 'Payout Date': blank('$E$2') };
      if (!xk) {
        f.Net = blank('ROUND(N(' + L('Gross salary') + ')+N(' + L('Commission') + ')+N(' + L('Bonus') + ')+N(' +
          L('Reimbursement') + ')-N(' + L('Deduction / adjustment') + '),2)');
        return f;
      }
      var TG = L('Total gross'), EE = L('Employee contribution 5%'), ER = L('Employer contribution 5%'),
          TB = L('Taxable base'), TAX = L('Withholding tax'), RE = 'N(' + L('Reimbursement, non-taxable') + ')';
      f['Total gross'] = blank('ROUND(N(' + L('Gross salary') + ')+N(' + L('Commission') + ')+N(' + L('Bonus') +
        ')-N(' + L('Deduction / adjustment') + '),2)');
      f['Employee contribution 5%'] = blank('IF(' + L('Tax status') + '="Foreign",0,ROUND(' + TG + '*0.05,2))');
      f['Employer contribution 5%'] = blank('IF(' + L('Tax status') + '="Foreign",0,ROUND(' + TG + '*0.05,2))');
      f['Taxable base'] = blank('ROUND(' + TG + '-' + EE + ',2)');
      f['Withholding tax'] = blank('IF(' + L('Employer') + '="Secondary",ROUND(' + TB + '*0.1,2),IF(' + TB + '<=250,0,' +
        'IF(' + TB + '<=450,ROUND((' + TB + '-250)*0.08,2),ROUND(16+(' + TB + '-450)*0.1,2))))');
      f.Net = blank('ROUND(' + TG + '-' + EE + '-' + TAX + '+' + RE + ',2)');
      f['Cost to employer'] = blank('ROUND(' + TG + '+' + ER + '+' + RE + ',2)');
      return f;
    };
    var cell = function (v, s) { return { v: v, t: 's', s: s }; };
    var rows = [
      [cell(xk ? 'PAYROLL LIST (EUR)' : 'NO-TAX PAYROLL', S.TITLE)],
      [cell('Payroll Period', S.BOLD), cell('', S.INPUT), cell(''), cell('Payout Date', S.BOLD), cell('', S.INPUT)],
      [cell(xk
        ? 'Fill in B2 (e.g. October 2026), E2 (YYYY-MM-DD) and the yellow columns, one row per person. Tax status: Local or ' +
          'Foreign. Employer: Primary or Secondary. Grey columns calculate: 5% pension each side (none for Foreign); tax on ' +
          'the taxable base — Secondary 10%, otherwise 0% to €250, 8% to €450, 10% above. Email must be the person\u2019s ' +
          'TrinityHR login. Upload this file on Payroll → Payslip.'
        : 'Fill in B2 (e.g. October 2026), E2 (YYYY-MM-DD) and the yellow columns, one row per person. Currency: EUR, PHP, ' +
          'USD… (blank = the default chosen at upload). Net = gross + commission + bonus + reimbursement − deduction. ' +
          'Commission details: one item per line. Email must be the person\u2019s TrinityHR login. Upload this file on ' +
          'Payroll → Payslip.', S.NOTE)],
      [],
      head.map(function (h) {
        var k = h.replace(/ \(EUR\)$/, '');
        return cell(h, calc.indexOf(k) !== -1 ? S.HEAD_CALC : S.HEAD_INPUT);
      })
    ];
    for (var r = 6; r < 6 + TEMPLATE_ROWS; r++) {
      var f = formulas(r);
      rows.push(head.map(function (h) {
        var k = h.replace(/ \(EUR\)$/, '');
        return f[k] ? { v: f[k], t: 'f', s: S.CALC } : cell('', S.INPUT);
      }));
    }
    var widths = head.map(function (h) { return /details|description|Notes|Bank \/|Email|Employee$/.test(h) ? 28 : 14; });
    var blob = X.build([{ name: xk ? 'XK Payroll' : 'No-Tax Payroll', cols: widths, rows: rows, freeze: { x: 2, y: 5 } }]);
    X.download(blob, (xk ? 'XK Payroll' : 'No-Tax Payroll') + ' template.xlsx');
  }

  /* ---- settings ---- */
  function psRenderSettings() {
    $$('[data-ps]').forEach(function (cb) { cb.checked = !!ps.settings[cb.dataset.ps]; });
    $('#psNote').value = ps.settings.note || '';
  }

  function psSaveSettings() {
    var next = { note: $('#psNote').value };
    $$('[data-ps]').forEach(function (cb) { next[cb.dataset.ps] = cb.checked; });
    var msg = $('#psSettingsMsg');
    msg.textContent = 'Saving…';
    psApi('payslip-settings', 'PUT', next).then(function (d) {
      ps.settings = d.settings;
      msg.textContent = 'Saved — every payslip now shows this.';
      psPreview();
    }, function (err) { msg.textContent = 'Not saved: ' + err.message; });
  }

  /* =====================================================================
     EVENT WIRING
     ===================================================================== */
  function switchTab(name) {
    $$('#tabs .tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === name); });
    ['run', 'finalpay', 'employees', 'holidays', 'yearend', 'payslip', 'settings'].forEach(function (n) {
      $('#tab-' + n).classList.toggle('hidden', n !== name);
    });
    if (name === 'finalpay') renderFinalPay();
    if (name === 'employees') { renderEmployees(); renderItemsEditor(); renderLoansEditor(); }
    if (name === 'holidays') renderHolidays();
    if (name === 'yearend') renderYearEnd();
    if (name === 'payslip') renderPayslipTab();
    if (name === 'settings') renderSettings();
  }

  function wire() {
    $('#tabs').addEventListener('click', function (ev) {
      var t = ev.target.closest('.tab');
      if (t) switchTab(t.dataset.tab);
    });

    /* ---- period bar ---- */
    $('#periodSelect').addEventListener('change', function () {
      var id = this.value;
      state.period = state.periods.filter(function (p) { return p.id === id; })[0];
      state.foldNotice = null;   // belongs to the cutoff that triggered it
      renderRun();
    });
    $('#yearSelect').addEventListener('change', function () {
      state.year = parseInt(this.value, 10);
      refreshPeriods();
      renderRun();
      renderHolidays();
    });
    $('#btnClearDtr').addEventListener('click', clearDtr);
    $('#btnExportCsv').addEventListener('click', exportCsv);
    $('#btnExportBpi').addEventListener('click', exportBpi);
    $('#btnSendTrinity').addEventListener('click', sendToTrinity);
    $('#psPeriod').addEventListener('change', function () {
      var id = this.value;
      state.period = state.periods.filter(function (p) { return p.id === id; })[0];
      $('#periodSelect').value = id;
      state.foldNotice = null;
      renderRun();
      psLoadStatus();
    });
    $('#psPrepare').addEventListener('click', psPrepare);
    var trinityRelease = function (publish) {
      var per = state.period, n = ps.status ? ps.status.payslips.length : 0;
      psRelease(trinityBatch(per), window.PayrollTemplate.cutoffTitle(per), n, publish);
    };
    $('#psPublish').addEventListener('click', function () { trinityRelease(true); });
    $('#psUnpublish').addEventListener('click', function () { trinityRelease(false); });
    $('#psBatches').addEventListener('click', psBatchClick);
    $('#psPreviewBatch').addEventListener('change', psLoadPreviewPeople);
    $('#psEmployee').addEventListener('change', psPreview);
    wireFinalPay();
    $('#upFile').addEventListener('change', upRead);
    $('#wiseFile').addEventListener('change', wiseLoad);
    ['#upCompany', '#upCompanyOther', '#upAddress', '#upCurrency'].forEach(function (id) { $(id).addEventListener('change', upRead); });
    $('#upSave').addEventListener('click', upSave);
    $('#upTplNoTax').addEventListener('click', function () { downloadPayslipTemplate('notax'); });
    $('#upTplXk').addEventListener('click', function () { downloadPayslipTemplate('xk'); });
    $('#psSaveSettings').addEventListener('click', psSaveSettings);
    (function () {
      var cfg = Store.loadTrinity();
      $('#trinityUrl').value = cfg.url || '';
      $('#trinityKey').value = cfg.key || '';
      var keep = function () {
        var c = Store.loadTrinity();
        c.url = $('#trinityUrl').value.trim();
        c.key = $('#trinityKey').value.trim();
        Store.saveTrinity(c);
      };
      $('#trinityUrl').addEventListener('change', keep);
      $('#trinityKey').addEventListener('change', keep);
    })();
    $('#btnDownloadTemplate').addEventListener('click', downloadTemplate);
    $('#btnImportTemplate').addEventListener('click', function () { $('#templateFile').click(); });
    $('#templateFile').addEventListener('change', function () {
      if (this.files && this.files.length) importPayroll(Array.prototype.slice.call(this.files));
      this.value = '';
    });

    /* ---- run table ---- */
    $('#runBody').addEventListener('change', onDtrInput);
    $('#runBody').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-payslip]');
      if (b) openPayslip(b.dataset.payslip);
    });

    /* ---- payslip modal ---- */
    $('#btnClosePayslip').addEventListener('click', function () { $('#payslipModal').classList.add('hidden'); });
    $('#btnPrintPayslip').addEventListener('click', function () { window.print(); });
    $('#payslipModal').addEventListener('click', function (ev) {
      if (ev.target === this) this.classList.add('hidden');
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') $('#payslipModal').classList.add('hidden');
    });

    /* ---- employees ---- */
    $('#empBody').addEventListener('change', function (ev) {
      var el = ev.target;
      if (!el.dataset || el.dataset.empIdx === undefined) return;
      var emp = state.employees[parseInt(el.dataset.empIdx, 10)];
      var key = el.dataset.key;
      emp[key] = key === 'monthlyRate' ? parseAmount(el.value) : el.value;
      persist();
      renderEmployees();
      renderItemsEditor();
      renderRun();
    });
    $('#empBody').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-del-emp]');
      if (!b) return;
      var i = parseInt(b.dataset.delEmp, 10);
      if (!confirm('Remove ' + state.employees[i].firstName + ' ' + state.employees[i].lastName + '?')) return;
      state.employees.splice(i, 1);
      persist();
      renderEmployees(); renderItemsEditor(); renderRun();
    });
    $('#btnImport201').addEventListener('click', function () { $('#file201').click(); });
    $('#file201').addEventListener('change', function () {
      if (this.files && this.files[0]) import201(this.files[0]);
      this.value = '';
    });
    $('#btnDownloadSalaries').addEventListener('click', downloadSalaries);
    $('#btnImportSalaries').addEventListener('click', function () { $('#salaryFile').click(); });
    $('#salaryFile').addEventListener('change', function () {
      if (this.files && this.files[0]) importSalaries(this.files[0]);
      this.value = '';
    });
    $('#btnExportMaster').addEventListener('click', exportMasterlist);
    $('#btnImportMaster').addEventListener('click', function () { $('#masterFile').click(); });
    $('#masterFile').addEventListener('change', function () {
      if (this.files && this.files[0]) importMasterlist(this.files[0]);
      this.value = '';
    });
    $('#btnAddEmployee').addEventListener('click', function () {
      var n = state.employees.length, id;
      do { id = 'EMP-' + String(++n).padStart(3, '0'); }
      while (state.employees.some(function (e) { return e.id === id; }));
      state.employees.push({
        id: id,
        firstName: '', lastName: '', position: '', department: '',
        employmentClass: 'rank_file', monthlyRate: 0, dateHired: E.ymd(new Date()),
        sssNo: '', philhealthNo: '', pagibigNo: '', tin: '', items: []
      });
      persist();
      renderEmployees(); renderItemsEditor(); renderRun();
    });

    /* ---- other items ---- */
    $('#itemsEditor').addEventListener('change', function (ev) {
      var el = ev.target;
      if (!el.dataset || !el.dataset.item) return;
      var parts = el.dataset.item.split(':');
      var item = state.employees[+parts[0]].items[+parts[1]];
      item[el.dataset.key] = el.dataset.key === 'amount' ? parseAmount(el.value)
        : (el.dataset.key === 'frequency' && /^\d+$/.test(el.value)) ? parseInt(el.value, 10)
        : el.value;
      persist();
      renderItemsEditor();
      renderRun();
    });
    $('#itemsEditor').addEventListener('click', function (ev) {
      var add = ev.target.closest('[data-add-item]');
      if (add) {
        var emp = state.employees[+add.dataset.addItem];
        if (!emp.items) emp.items = [];
        emp.items.push({ label: 'Maxicare HMO', kind: 'deduction', amount: 0, frequency: 'every' });
        persist(); renderItemsEditor(); renderEmployees(); renderRun();
        return;
      }
      var del = ev.target.closest('[data-del-item]');
      if (del) {
        var p = del.dataset.delItem.split(':');
        state.employees[+p[0]].items.splice(+p[1], 1);
        persist(); renderItemsEditor(); renderEmployees(); renderRun();
      }
    });

    /* ---- loans ---- */
    $('#loansEditor').addEventListener('change', function (ev) {
      var el = ev.target;
      if (!el.dataset || !el.dataset.loan) return;
      var parts = el.dataset.loan.split(':');
      var loan = state.employees[+parts[0]].loans[+parts[1]];
      var key = el.dataset.key;
      loan[key] = (key === 'principal' || key === 'amortization') ? parseAmount(el.value) : el.value;
      persist();
      renderLoansEditor();
      renderRun();
    });
    $('#loansEditor').addEventListener('click', function (ev) {
      var add = ev.target.closest('[data-add-loan]');
      if (add) {
        var emp = state.employees[+add.dataset.addLoan];
        if (!emp.loans) emp.loans = [];
        emp.loans.push({ type: 'sss', reference: '', principal: 0, amortization: 0,
          startDate: E.ymd(new Date()), schedule: 2 });
        persist(); renderLoansEditor(); renderRun();
        return;
      }
      var del = ev.target.closest('[data-del-loan]');
      if (del) {
        var p = del.dataset.delLoan.split(':');
        state.employees[+p[0]].loans.splice(+p[1], 1);
        persist(); renderLoansEditor(); renderRun();
      }
    });

    /* ---- holidays ---- */
    $('#holBody').addEventListener('change', function (ev) {
      var el = ev.target;
      if (!el.dataset || el.dataset.hol === undefined) return;
      state.holidays[+el.dataset.hol][el.dataset.key] = el.value;
      Store.saveHolidays(state.year, state.holidays);
      renderHolidays(); renderRun();
    });
    $('#holBody').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-del-hol]');
      if (!b) return;
      state.holidays.splice(+b.dataset.delHol, 1);
      Store.saveHolidays(state.year, state.holidays);
      renderHolidays(); renderRun();
    });
    $('#btnAddHoliday').addEventListener('click', function () {
      state.holidays.push({ date: state.year + '-01-01', name: 'New holiday', type: 'regular' });
      Store.saveHolidays(state.year, state.holidays);
      renderHolidays(); renderRun();
    });

    /* ---- settings ---- */
    document.addEventListener('change', function (ev) {
      var el = ev.target;
      if (!el.dataset || !el.dataset.setting) return;
      var path = el.dataset.setting;
      var value;
      if (el.type === 'checkbox') value = el.checked;
      else if (el.dataset.money !== undefined) value = parseAmount(el.value);
      else if (el.type === 'number') value = E.num(el.value);
      else if (el.dataset.text === undefined && /^\d+$/.test(el.value)) value = parseInt(el.value, 10);   // data-text keeps leading zeros
      else value = el.value;
      setPath(state.settings, path, value);
      Store.saveSettings(state.settings);
      renderSettings();
      renderRun();
    });

    /* ---- 13th month detail ---- */
    $('#yearEndBody').addEventListener('click', function (ev) {
      var tr = ev.target.closest('tr[data-ye-emp]');
      if (tr) openThirteenth(tr.dataset.yeEmp);
    });
    $('#btnCloseThirteenth').addEventListener('click', function () { $('#thirteenthModal').classList.add('hidden'); });
    $('#btnPrintThirteenth').addEventListener('click', function () { window.print(); });
    $('#thirteenthModal').addEventListener('click', function (ev) {
      if (ev.target === this) this.classList.add('hidden');
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') $('#thirteenthModal').classList.add('hidden');
    });

    /* ---- notes ---- */
    $('#btnToggleNotes').addEventListener('click', function () {
      applyNotesVisible(!document.body.classList.contains('notes-on'));
    });

    /* ---- reset ---- */
  }

  /* Explanatory notes default to hidden so the tables lead. */
  function applyNotesVisible(on, skipSave) {
    document.body.classList.toggle('notes-on', !!on);
    var btn = $('#btnToggleNotes');
    btn.textContent = on ? 'Hide notes' : 'Show notes';
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (!skipSave) Store.saveNotesVisible(on);
  }

  /* =====================================================================
     BOOT
     ===================================================================== */
  /* A second horizontal scrollbar above each wide table, kept in step with
     the one at the bottom, so the columns can be moved from either end. It
     sizes itself to the table and hides when there is nothing to scroll. */
  function addTopScrollbars() {
    $$('.table-scroll').forEach(function (box) {
      var bar = document.createElement('div');
      bar.className = 'top-scroll';
      var inner = document.createElement('div');
      bar.appendChild(inner);
      box.parentNode.insertBefore(bar, box);

      var size = function () {
        inner.style.width = box.scrollWidth + 'px';
        bar.style.width = box.clientWidth + 'px';
        bar.classList.toggle('hidden', box.scrollWidth <= box.clientWidth + 1);
      };
      // Only write when they differ, so the two cannot echo each other.
      bar.addEventListener('scroll', function () {
        if (box.scrollLeft !== bar.scrollLeft) box.scrollLeft = bar.scrollLeft;
      });
      box.addEventListener('scroll', function () {
        if (bar.scrollLeft !== box.scrollLeft) bar.scrollLeft = box.scrollLeft;
      });
      if (window.ResizeObserver) {
        var ro = new ResizeObserver(size);
        ro.observe(box);
        if (box.firstElementChild) ro.observe(box.firstElementChild);
      }
      window.addEventListener('resize', size);
      size();
    });
  }

  /* Before payout dates were read from file names, a payroll file was
     filed by its title — and the January 2026 register's title says 2025.
     A cutoff whose figures came from a file naming a different payout is
     moved to the cutoff that file is for (unless that one already holds
     imported figures, in which case the misfiled copy is dropped). */
  function refileMisfiledCutoffs() {
    var T = window.PayrollTemplate, moved = 0, dropped = 0, cache = {};
    var periodOf = function (pid) {
      if (cache[pid] !== undefined) return cache[pid];
      var y = parseInt(pid.slice(0, 4), 10), p = null;
      [y, y - 1, y + 1].forEach(function (yy) {
        if (!p) p = E.buildPeriods(yy).filter(function (x) { return x.id === pid; })[0] || null;
      });
      return (cache[pid] = p);
    };
    Object.keys(state.dtr).forEach(function (k) {
      var d = state.dtr[k];
      if (!d || !d.posted || !d.posted.source) return;
      var payout = T.payoutFromFileName(String(d.posted.source).replace(/ \[.*\]$/, ''));
      var bar = k.indexOf('|'), pid = k.slice(0, bar), eid = k.slice(bar + 1);
      var p = periodOf(pid);
      if (!payout || !p || p.payoutDate === payout) return;
      var right = periodPaidOn(payout);
      if (!right) return;
      var target = right.id + '|' + eid;
      if (!(state.dtr[target] && state.dtr[target].posted)) { state.dtr[target] = d; moved++; }
      else dropped++;
      delete state.dtr[k];
    });
    if (moved || dropped) {
      Store.saveDtr(state.dtr);
      state.refiled = { moved: moved, dropped: dropped };
    }
  }

  function init() {
    refileMisfiledCutoffs();
    buildYearSelect();
    refreshPeriods();
    wire();
    applyNotesVisible(Store.loadNotesVisible(), true);
    renderSettings();
    renderRun();
    addTopScrollbars();
    wireSort('run');
    wireSort('emp');
    $('#empSearch').addEventListener('input', filterEmployees);
    applySort('run');
  }

  // Started by sync.js once the shared payroll is loaded.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

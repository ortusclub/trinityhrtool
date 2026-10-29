/* =========================================================================
   engine.js — payroll computation engine (pure functions, no DOM)
   ========================================================================= */
(function (global) {
  'use strict';

  /* --------------------------- small helpers --------------------------- */
  function r2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
  function clamp(n, lo, hi) { return Math.min(Math.max(n, lo), hi); }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseYmd(s) {
    var p = String(s).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function daysInMonth(year, monthIdx) { return new Date(year, monthIdx + 1, 0).getDate(); }
  function minutesOf(hhmm) {
    var p = String(hhmm).split(':');
    return (+p[0]) * 60 + (+p[1] || 0);
  }

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function fmtShort(d) { return MONTHS[d.getMonth()].slice(0, 3) + ' ' + d.getDate(); }
  function fmtLong(d) { return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }

  /* =======================================================================
     PAY PERIODS

     Payout on the 25th  -> cutoff  1  to 15  of the SAME month
     Payout on the 10th  -> cutoff  16 to end of the PREVIOUS month
     ======================================================================= */
  function buildPeriods(year) {
    var periods = [];
    for (var m = 0; m < 12; m++) {
      // Payout on the 10th — covers 16th to end of the previous month
      var prevMonth = m === 0 ? 11 : m - 1;
      var prevYear = m === 0 ? year - 1 : year;
      periods.push({
        id: year + '-' + pad(m + 1) + '-P10',
        half: 'second',                       // cutoff covers 16 - EOM
        payPeriodNo: 1,                       // PAY PERIOD 1 — paid on the 10th
        payoutDate: ymd(new Date(year, m, 10)),
        start: ymd(new Date(prevYear, prevMonth, 16)),
        end: ymd(new Date(prevYear, prevMonth, daysInMonth(prevYear, prevMonth))),
        contribMonth: prevYear + '-' + pad(prevMonth + 1)
      });

      // Payout on the 25th — covers the 1st to the 15th of the same month
      periods.push({
        id: year + '-' + pad(m + 1) + '-P25',
        half: 'first',                        // cutoff covers 1 - 15
        payPeriodNo: 2,                       // PAY PERIOD 2 — paid on the 25th
        payoutDate: ymd(new Date(year, m, 25)),
        start: ymd(new Date(year, m, 1)),
        end: ymd(new Date(year, m, 15)),
        contribMonth: year + '-' + pad(m + 1)
      });
    }

    periods.sort(function (a, b) { return a.payoutDate < b.payoutDate ? -1 : 1; });

    periods.forEach(function (p) {
      var s = parseYmd(p.start), e = parseYmd(p.end), pay = parseYmd(p.payoutDate);
      p.label = 'Period ' + p.payPeriodNo + ' · cutoff ' + fmtShort(s) + ' – ' + fmtShort(e) +
        '  →  paid ' + fmtShort(pay) + ' ' + pay.getFullYear();
      p.cutoffLabel = fmtLong(s) + ' – ' + fmtLong(e);
      p.payoutLabel = fmtLong(pay);
    });

    return periods;
  }

  /** Working days (Mon-Fri by default) inside a cutoff. */
  function workingDaysInPeriod(period, settings) {
    var wd = settings.schedule.workDays;
    var d = parseYmd(period.start), end = parseYmd(period.end), count = 0;
    while (d <= end) {
      if (wd.indexOf(d.getDay()) !== -1) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  }

  /** Holidays that fall inside a cutoff, tagged with whether it's a workday. */
  function holidaysInPeriod(period, holidays, settings) {
    var wd = settings.schedule.workDays;
    return (holidays || []).filter(function (h) {
      return h.date >= period.start && h.date <= period.end;
    }).map(function (h) {
      var d = parseYmd(h.date);
      return {
        date: h.date, name: h.name, type: h.type,
        onWorkday: wd.indexOf(d.getDay()) !== -1,
        display: fmtLong(d)
      };
    }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  }

  /** Age from a birth date, as at `asOf` (defaults to today). */
  function ageFrom(birthDate, asOf) {
    if (!birthDate) return null;
    var b = parseYmd(birthDate);
    if (isNaN(b.getTime())) return null;
    var d = asOf ? parseYmd(asOf) : new Date();
    var age = d.getFullYear() - b.getFullYear();
    var m = d.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && d.getDate() < b.getDate())) age--;
    return age >= 0 && age < 130 ? age : null;
  }

  /** Stored age, or one derived from the birth date when we have it. */
  function employeeAge(emp) {
    var derived = ageFrom(emp.birthDate);
    if (derived !== null) return derived;
    var a = parseFloat(emp.age);
    return isFinite(a) ? a : null;
  }

  /* =======================================================================
     RATES
     ======================================================================= */
  function rateSetFor(monthlyRate, settings) {
    var daily = monthlyRate * 12 / settings.dayFactor;
    var hourly = daily / settings.schedule.hoursPerDay;
    return { daily: daily, hourly: hourly, semiMonthly: monthlyRate / 2 };
  }
  function rateSet(emp, settings) {
    return rateSetFor(num(emp.monthlyRate), settings);
  }

  /**
   * De minimis for one cutoff. It is a flat amount per cutoff, but somebody
   * who started partway through only earns the share of the cutoff they were
   * actually on staff for, counted in working days. A start date on or before
   * the cutoff opens gets the full amount; one after it closes gets nothing.
   */
  function deMinimisFor(emp, period, settings) {
    var full = num(settings.defaultDeMinimis);
    var st = staffDays(emp, period, settings);
    if (!st.partial) {
      return { amount: r2(full), full: r2(full), prorated: false,
               factor: 1, workDaysOnStaff: 0, workDaysTotal: 0 };
    }
    var factor = st.total ? st.onStaff / st.total : 0;
    return {
      amount: r2(full * factor), full: r2(full), prorated: true,
      factor: factor, workDaysOnStaff: st.onStaff, workDaysTotal: st.total
    };
  }

  /**
   * Working days of a cutoff the employee was on staff for, from the start
   * date and last day of work (both from the 201 File). `partial` is true
   * when either date cuts into the cutoff. Basic pay and de minimis are both
   * prorated from this — the "ADHOC PAYMENT - BASIC ADJ DEDUCTIONS" and
   * "DE MINIMIS (DM) DEDUCTIONS" columns of the payroll template.
   */
  function staffDays(emp, period, settings) {
    var isDate = function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(v); };
    var hired = String(emp.dateHired || '').trim(), left = String(emp.endDate || '').trim();
    var from = isDate(hired) && hired > period.start ? hired : period.start;
    var to = isDate(left) && left < period.end ? left : period.end;
    var wd = settings.schedule.workDays;
    var d = parseYmd(period.start), end = parseYmd(period.end);
    var total = 0, onStaff = 0;
    while (d <= end) {
      if (wd.indexOf(d.getDay()) !== -1) {
        total++;
        var k = ymd(d);
        if (k >= from && k <= to) onStaff++;
      }
      d.setDate(d.getDate() + 1);
    }
    return { partial: from > period.start || to < period.end, onStaff: onStaff,
             total: total, offDays: total - onStaff };
  }

  /**
   * A salary adjustment is an INCREASE added to the monthly rate from its
   * effectivity date onward. This resolves what applies to one cutoff:
   *
   *   applies   the adjustment is in force by the end of the cutoff, so the
   *             raised rate drives contributions, tax, OT and premiums
   *   prorated  the effectivity date falls inside the cutoff
   *   factor    share of the cutoff's working days paid at the raised rate
   *             (0..1) — 1 when the increase predates the cutoff entirely
   *
   * Basic pay for a straddling cutoff is old_semi x (1 - factor) +
   * new_semi x factor, which keeps the no-adjustment case exactly equal to
   * the plain semi-monthly rate.
   */
  function salaryAdjustment(emp, period, settings) {
    var base = num(emp.monthlyRate);
    var adj = num(emp.salaryAdjustment);
    var eff = emp.salaryAdjustmentEffective
      ? String(emp.salaryAdjustmentEffective).trim() : '';
    var none = {
      applies: false, prorated: false, base: base, monthly: base,
      adjustment: 0, effectiveDate: null, factor: 0, workDaysAtNew: 0, workDaysTotal: 0
    };
    if (!adj || !/^\d{4}-\d{2}-\d{2}$/.test(eff)) return none;
    if (eff > period.end) return none;                 // not in force yet

    var monthly = r2(base + adj);
    var wd = settings.schedule.workDays;
    var d = parseYmd(period.start), end = parseYmd(period.end);
    var total = 0, atNew = 0;
    while (d <= end) {
      if (wd.indexOf(d.getDay()) !== -1) { total++; if (ymd(d) >= eff) atNew++; }
      d.setDate(d.getDate() + 1);
    }
    var whole = eff <= period.start;
    /* No working day in this cutoff falls on or after the effectivity date —
       e.g. an increase effective on a Saturday that closes the cutoff. Nothing
       here is paid at the raised rate, so the adjustment must not touch this
       cutoff at all: raising the contribution bracket alone would push net pay
       BELOW the unadjusted figure. It takes effect in full next cutoff. */
    if (!whole && atNew === 0) return none;

    return {
      applies: true,
      prorated: !whole,
      base: base,
      monthly: monthly,
      adjustment: r2(adj),
      effectiveDate: eff,
      factor: whole ? 1 : (total ? atNew / total : 0),
      workDaysAtNew: whole ? total : atNew,
      workDaysTotal: total
    };
  }

  /**
   * OT hours that fall BEFORE the night-differential window.
   * Shift ends 7:00PM and ND starts 10:00PM, so the first 3 OT hours are
   * overtime only; anything past that is overtime AND night differential.
   */
  function otHoursBeforeNd(settings) {
    var end = minutesOf(settings.schedule.shiftEnd);
    var nd = minutesOf(settings.schedule.ndStart);
    var gap = (nd - end) / 60;
    return gap > 0 ? gap : 0;
  }

  /** Suggested ND hours given total OT hours worked from shift end onward. */
  function suggestNdHours(otHours, settings) {
    return Math.max(0, r2(num(otHours) - otHoursBeforeNd(settings)));
  }

  /* =======================================================================
     STATUTORY CONTRIBUTIONS (computed on the MONTHLY basic rate)
     ======================================================================= */
  function sssContribution(monthlyRate, settings) {
    var t = settings.sss.sssTable || [];
    var row = t[t.length - 1];
    for (var i = 0; i < t.length; i++) {
      if (monthlyRate >= t[i][0] && monthlyRate <= t[i][1]) { row = t[i]; break; }
    }
    if (!row) return { msc: 0, ee: 0, er: 0, ec: 0, total: 0 };
    // [from, to, erRegular, eeRegular, erMPF, eeMPF, ec]
    var ee = r2(row[3] + row[5]);   // Regular EE + MPF EE
    var er = r2(row[2] + row[4]);   // Regular ER + MPF ER
    var ec = row[6];
    return {
      msc: row[1] === Infinity ? row[0] : row[1],
      eeRegular: row[3], eeMPF: row[5],
      erRegular: row[2], erMPF: row[4],
      ee: ee, er: er, ec: ec, total: r2(ee + er + ec)
    };
  }

  function philhealthContribution(monthlyRate, settings) {
    var p = settings.phic;
    var base = clamp(monthlyRate, p.floor, p.ceiling);
    var ee = r2(base * p.eeRate);
    var er = r2(base * p.erRate);
    return { base: base, ee: ee, er: er, total: r2(ee + er) };
  }

  function pagibigContribution(monthlyRate, settings) {
    var h = settings.hdmf;
    return { base: monthlyRate, ee: r2(h.flatEE), er: r2(h.flatER) };
  }

  /**
   * How much of a MONTHLY contribution is taken on this particular payout.
   * Each contribution is scheduled independently, because they do not all
   * fall on the same payout:
   *   SSS       -> pay period 2 (paid on the 25th, cutoff 1-15)
   *   PhilHealth-> pay period 1 (paid on the 10th, cutoff 16-EOM)
   *   HDMF  -> pay period 1
   * A value of 'split' halves the contribution across both payouts instead.
   */
  function contributionShare(period, settings, which) {
    var mode = (settings.contributionSchedule || {})[which];
    if (mode === 'split') return 0.5;
    return period.payPeriodNo === Number(mode) ? 1 : 0;
  }

  /* =======================================================================
     WITHHOLDING TAX — BIR semi-monthly table (TRAIN law)
     ======================================================================= */
  function withholdingTax(taxableIncome, settings) {
    if (!settings.applyWithholdingTax || taxableIncome <= 0) return 0;
    var table = settings.taxTable;
    var bracket = table[0];
    for (var i = 0; i < table.length; i++) {
      if (taxableIncome >= table[i].min) bracket = table[i];
    }
    return r2(bracket.base + (taxableIncome - bracket.excessOver) * bracket.rate);
  }

  /* =======================================================================
     LOANS — SSS salary loan, HDMF MPL, company loans

     A loan is entered once (principal, amortisation, start date, which payout
     it comes out of) and then amortises itself. Nothing is stored per period:
     the installment number is derived by counting the qualifying payouts from
     the start date, so the balance is always reproducible and a corrected
     start date reflows the whole schedule.
     ======================================================================= */

  /** Qualifying payout dates for a loan, from its start date up to `uptoYmd`. */
  function loanPayoutDates(loan, uptoYmd) {
    var start = parseYmd(loan.startDate);
    var end = parseYmd(uptoYmd);
    var out = [];
    var y = start.getFullYear(), m = start.getMonth();
    var guard = 0;
    while ((y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) && guard++ < 600) {
      [[10, 1], [25, 2]].forEach(function (pair) {
        var d = ymd(new Date(y, m, pair[0]));
        if (d < loan.startDate || d > uptoYmd) return;
        if (loan.schedule === 'split' || Number(loan.schedule) === pair[1]) out.push(d);
      });
      m++; if (m > 11) { m = 0; y++; }
    }
    return out;
  }

  /**
   * What this loan takes on this payout, plus where it sits in its schedule.
   * Returns due = 0 when the payout is not a deduction date for the loan, or
   * when the loan is already fully paid.
   */
  function loanDeduction(loan, period) {
    var principal = num(loan.principal);
    var amort = num(loan.amortization);
    if (principal <= 0 || amort <= 0) return null;

    var dates = loanPayoutDates(loan, period.payoutDate);
    var isDeductionPayout = dates.length > 0 && dates[dates.length - 1] === period.payoutDate;
    var priorCount = isDeductionPayout ? dates.length - 1 : dates.length;
    var paidBefore = Math.min(principal, priorCount * amort);
    var balanceBefore = r2(principal - paidBefore);
    var due = (isDeductionPayout && balanceBefore > 0) ? r2(Math.min(amort, balanceBefore)) : 0;

    return {
      loan: loan,
      due: due,
      isDeductionPayout: isDeductionPayout,
      installmentNo: isDeductionPayout && due > 0 ? dates.length : null,
      totalInstallments: Math.ceil(principal / amort),
      balanceBefore: balanceBefore,
      balanceAfter: r2(balanceBefore - due),
      settled: balanceBefore <= 0
    };
  }

  /** All of an employee's loans resolved against one period. */
  function collectLoans(emp, period) {
    var out = { sss: 0, other: 0, rows: [] };
    (emp.loans || []).forEach(function (loan) {
      var d = loanDeduction(loan, period);
      if (!d) return;
      out.rows.push(d);
      if (loan.type === 'sss') out.sss = r2(out.sss + d.due);
      else out.other = r2(out.other + d.due);
    });
    return out;
  }

  /* =======================================================================
     CUSTOM ITEMS (Maxicare, allowances, loans, ...)
     kind: 'deduction' | 'allowance_tax' | 'allowance_nontax' | 'employer_cost'
     frequency: 'every' | 'first' | 'second'
     ======================================================================= */
  /**
   * frequency: 'every' | 1 | 2 — the pay period the item lands on.
   * Legacy values 'first'/'second' referred to which HALF OF THE MONTH the
   * cutoff covered, which is the reverse numbering, so they are mapped here
   * rather than silently landing on the wrong payout.
   */
  function itemAppliesToPeriod(item, period) {
    var f = item.frequency;
    if (!f || f === 'every') return true;
    if (f === 'first') f = 2;        // cutoff 1-15  -> paid the 25th -> period 2
    else if (f === 'second') f = 1;  // cutoff 16-EOM -> paid the 10th -> period 1
    return Number(f) === period.payPeriodNo;
  }

  function collectItems(emp, period) {
    var out = {
      deductions: [], taxableAllowances: [], nonTaxAllowances: [], employerCosts: [],
      totalDeductions: 0, totalTaxableAllowance: 0, totalNonTaxAllowance: 0, totalEmployerCost: 0
    };
    (emp.items || []).forEach(function (it) {
      if (!itemAppliesToPeriod(it, period)) return;
      var row = { label: it.label, amount: r2(num(it.amount)) };
      if (it.kind === 'deduction') { out.deductions.push(row); out.totalDeductions += row.amount; }
      else if (it.kind === 'allowance_tax') { out.taxableAllowances.push(row); out.totalTaxableAllowance += row.amount; }
      else if (it.kind === 'allowance_nontax') { out.nonTaxAllowances.push(row); out.totalNonTaxAllowance += row.amount; }
      else if (it.kind === 'employer_cost') { out.employerCosts.push(row); out.totalEmployerCost += row.amount; }
    });
    out.totalDeductions = r2(out.totalDeductions);
    out.totalTaxableAllowance = r2(out.totalTaxableAllowance);
    out.totalNonTaxAllowance = r2(out.totalNonTaxAllowance);
    out.totalEmployerCost = r2(out.totalEmployerCost);
    return out;
  }

  /* =======================================================================
     MAIN COMPUTATION — one employee, one pay period
     ======================================================================= */
  function computePayslip(emp, period, dtr, settings, extra) {
    dtr = dtr || {};
    extra = extra || {};
    var isRankFile = emp.employmentClass === 'rank_file';
    /* Every rate below is driven by the ADJUSTED monthly rate, so government
       contributions and withholding tax are computed after the increase. */
    var adjustment = salaryAdjustment(emp, period, settings);
    var rates = rateSetFor(adjustment.monthly, settings);
    var prem = settings.premium;
    var rf = function (v) { return isRankFile ? num(v) : 0; };

    /* ------------- REGULAR PAY (col J) and absences (R, S) -------------
       PTO days are paid leave: they are recorded for the leave ledger but
       never deducted. Only absences and unpaid leave reduce basic pay. */
    var ptoDays = num(dtr.ptoDays);
    var absentDays = num(dtr.absentDays) + num(dtr.unpaidLeaveDays);
    // Late and undertime are counted in minutes. lateHours is what earlier
    // versions stored; it still counts so nothing typed before is lost.
    var lateMinutes = r2(num(dtr.lateMinutes) + num(dtr.lateHours) * 60);
    var undertimeMinutes = num(dtr.undertimeMinutes);
    var lateHours = r2(lateMinutes / 60);
    var absenceDeduction = r2(rates.daily * absentDays);
    var lateDeduction = r2(rates.hourly * lateMinutes / 60);
    var undertimeDeduction = r2(rates.hourly * undertimeMinutes / 60);
    /* When the increase lands mid-cutoff, basic pay is split by working days
       between the old and the raised rate. Otherwise this is just semiMonthly. */
    var basicForPeriod = adjustment.prorated
      ? r2((adjustment.base / 2) * (1 - adjustment.factor) +
           (adjustment.monthly / 2) * adjustment.factor)
      : rates.semiMonthly;
    /* Started or left inside the cutoff: the working days off staff come off
       basic pay at the daily rate, never more than the cutoff's basic. */
    var staff = staffDays(emp, period, settings);
    var prorationDeduction = staff.partial
      ? r2(Math.min(basicForPeriod, rates.daily * staff.offDays)) : 0;
    var regularPay = r2(basicForPeriod - absenceDeduction - lateDeduction -
      undertimeDeduction - prorationDeduction);

    /* --------------- OVERTIME (cols K, L) — three rates ---------------- */
    var otHours = rf(dtr.otHours);
    var otRestSpecialHours = rf(dtr.otRestSpecialHours);
    var otRegHolidayHours = rf(dtr.otRegHolidayHours);

    var otPayRegular = r2(rates.hourly * prem.ot * otHours);
    var otPayRestSpecial = r2(rates.hourly * prem.otRestDaySpecial * otRestSpecialHours);
    var otPayRegHoliday = r2(rates.hourly * prem.otRegHoliday * otRegHolidayHours);
    var otPay = r2(otPayRegular + otPayRestSpecial + otPayRegHoliday);
    var totalOtHours = r2(otHours + otRestSpecialHours + otRegHolidayHours);

    /* ---------- NIGHT DIFFERENTIAL (cols M, N) — plain hourly ----------
       Payroll Process.xlsx: "Hourly Rate x 10% x Number of night hours
       worked." The 10% is on the BASE hourly rate, not the overtime rate. */
    var ndHours = rf(dtr.ndHours);
    var ndPay = r2(rates.hourly * prem.nd * ndHours);

    /* ------------------- rest day & holiday premiums ------------------- */
    var restDayHours = rf(dtr.restDayHours);
    var restDayPay = r2(rates.hourly * prem.restDay * restDayHours);
    var regHolidayDays = rf(dtr.regHolidayDays);
    var splHolidayDays = rf(dtr.specialHolidayDays);
    var regHolidayPay = r2(rates.daily * prem.regHolidayWorkedExtra * regHolidayDays);
    var splHolidayPay = r2(rates.daily * prem.specialHolidayWorkedExtra * splHolidayDays);
    var holidayPay = r2(regHolidayPay + splHolidayPay);

    /* ---------------- allowances (cols O, P) ---------------------------
       Transportation allowance is entered directly as an amount. De minimis
       is not entered at all: it is always the standard amount, prorated by
       working days when the start date falls inside the cutoff. Any value
       left in a stored timesheet by an earlier version is ignored on
       purpose — there is no longer a way to set one, so honouring an old one
       would freeze an amount nobody can see or clear. Both are non-taxable. */
    var transportationGiven = num(dtr.transportationAllowance);
    var travelDeduction = Math.min(transportationGiven, num(dtr.travelDeduction));
    var transportationAllowance = r2(transportationGiven - travelDeduction);
    var dmAuto = deMinimisFor(emp, period, settings);
    var deMinimis = dmAuto.amount;
    var quarterlyBonus = num(dtr.quarterlyBonus);

    /* 13th month pay — posted only on the payout it is scheduled for. It is
       tax-exempt up to the statutory ceiling; anything above is taxable. */
    var thirteenthMonth = r2(num(extra.thirteenthMonth));
    var thirteenthTaxable = r2(Math.min(thirteenthMonth, num(extra.thirteenthMonthTaxable)));
    var thirteenthExempt = r2(thirteenthMonth - thirteenthTaxable);

    /* ------------------------- custom items ---------------------------- */
    var items = collectItems(emp, period);
    /* Ex milestones — the company bonus — is typed per cutoff. Non-taxable
       in the cutoff, as the payroll files treat it; at year-end it shares
       the exempt ceiling with 13th month and transport (yearEndFor). */
    if (num(extra.yearEndBonus)) {
      items.nonTaxAllowances.push({ label: 'Year-end non-taxable bonus', amount: r2(num(extra.yearEndBonus)) });
      items.totalNonTaxAllowance = r2(items.totalNonTaxAllowance + num(extra.yearEndBonus));
    }
    /* Final pay (finalPayFor): unused leave is paid as an allowance, kept out
       of this cutoff's withholding — the annual tax adjustment taxes what is
       taxable of it — and the loan balance and clearance items come off. */
    /* Back pay of a salary change effective before this cutoff (backPayFor),
       labelled as a salary adjustment so the 13th month counts it. */
    var bp = emp.backPay;
    if (bp && bp.periodId === period.id && num(bp.amount)) {
      items.taxableAllowances.push({ label: 'Salary adjustment \u2014 back pay (' + fmtShort(parseYmd(bp.from)) +
        ' \u2013 ' + fmtShort(parseYmd(bp.to)) + ')', amount: r2(num(bp.amount)) });
      items.totalTaxableAllowance = r2(items.totalTaxableAllowance + num(bp.amount));
    }
    var fp = extra.finalPay;
    if (fp) {
      if (fp.leaveAmount) {
        items.nonTaxAllowances.push({ label: 'Unused leave conversion \u2014 ' + fp.leaveDays + ' day/s', amount: fp.leaveAmount });
        items.totalNonTaxAllowance = r2(items.totalNonTaxAllowance + fp.leaveAmount);
      }
      fp.loanRows.forEach(function (l) {
        items.deductions.push({ label: l.label, amount: l.amount });
        items.totalDeductions = r2(items.totalDeductions + l.amount);
      });
      fp.clearance.forEach(function (c) {
        items.deductions.push({ label: c.label, amount: c.amount });
        items.totalDeductions = r2(items.totalDeductions + c.amount);
      });
    }
    var exMilestones = num(dtr.exMilestones);
    if (exMilestones) {
      items.nonTaxAllowances.push({ label: 'Ex Milestones (company bonus)', amount: exMilestones });
      items.totalNonTaxAllowance = r2(items.totalNonTaxAllowance + exMilestones);
    }

    /* ----------------------- GROSS PAY (col T) ------------------------- */
    var grossPay = r2(regularPay + otPay + ndPay + restDayPay + holidayPay +
      deMinimis + quarterlyBonus + transportationAllowance + thirteenthMonth +
      items.totalTaxableAllowance + items.totalNonTaxAllowance);

    /* ------------- statutory contributions (cols U, V, W) -------------- */
    // A cutoff they were never on staff for (only final pay lands there) owes none.
    var offStaff = staff.total > 0 && staff.onStaff === 0;
    var sssShare = offStaff ? 0 : contributionShare(period, settings, 'sss');
    var phicShare = offStaff ? 0 : contributionShare(period, settings, 'phic');
    var hdmfShare = offStaff ? 0 : contributionShare(period, settings, 'hdmf');
    // Contribution brackets read the ADJUSTED monthly rate, not emp.monthlyRate.
    var sssM = sssContribution(adjustment.monthly, settings);
    var phicM = philhealthContribution(adjustment.monthly, settings);
    var hdmfM = pagibigContribution(adjustment.monthly, settings);

    var sssEE = emp.sssExempt ? 0 : r2(sssM.ee * sssShare);
    var phicEE = r2(phicM.ee * phicShare);
    var hdmfEE = r2(hdmfM.ee * hdmfShare);
    var totalContribEE = r2(sssEE + phicEE + hdmfEE);

    var sssER = emp.sssExempt ? 0 : r2(sssM.er * sssShare);
    var sssEC = emp.sssExempt ? 0 : r2(sssM.ec * sssShare);
    var phicER = r2(phicM.er * phicShare);
    var hdmfER = r2(hdmfM.er * hdmfShare);
    var totalContribER = r2(sssER + sssEC + phicER + hdmfER);

    /* --------- INCOME AFTER MANDATORIES (col X) and TAX (Y, Z) ---------
       The source workbook computes X as T-(PHIC+HDMF), leaving SSS EE out.
       That understates the deduction for anyone with a non-zero SSS share,
       so by default SSS is subtracted too. Set settings.replicateSheetFormula
       to true to reproduce the workbook exactly instead. */
    var mandatories = settings.replicateSheetFormula
      ? r2(phicEE + hdmfEE)
      : totalContribEE;
    var incomeAfterMandatories = r2(grossPay - mandatories);

    // Non-taxable pay is stripped out to reach the taxable base (col Y).
    var nonTaxable = r2(transportationAllowance + deMinimis + items.totalNonTaxAllowance +
      thirteenthExempt);
    var netTaxable = r2(Math.max(0, incomeAfterMandatories - nonTaxable));
    var tax = withholdingTax(netTaxable, settings);

    /* ------------- post-tax deductions (cols AA - AE) ------------------ */
    var loans = collectLoans(emp, period);
    var tendoPay = num(dtr.tendoPay);
    var sssLoan = r2(num(dtr.sssLoan) + loans.sss);
    var hmo = num(dtr.hmo);
    var classPass = num(dtr.classPass);
    var otherDeduction = r2(num(dtr.otherDeduction) + loans.other);
    var reimbursement = num(dtr.reimbursement);
    // Positive = over-withheld and refunded to the employee; negative = tax
    // still due, collected on this payout.
    var taxRefund = r2(num(extra.taxRefund));

    var postTaxDeductions = r2(tendoPay + sssLoan + hmo + classPass + otherDeduction +
      items.totalDeductions);

    /* ------------------------ NET PAY (col AF) ------------------------- */
    var netPay = r2(incomeAfterMandatories - (tax + postTaxDeductions) + reimbursement + taxRefund);
    var totalDeductions = r2(mandatories + tax + postTaxDeductions);

    var slip = {
      employee: emp,
      period: period,
      rates: {
        monthly: r2(adjustment.monthly),     // the rate actually paid this cutoff
        baseMonthly: r2(adjustment.base),
        semiMonthly: r2(basicForPeriod),
        daily: r2(rates.daily),
        hourly: r2(rates.hourly),
        otHourly: r2(rates.hourly * prem.ot),
        ndHourly: r2(rates.hourly * prem.nd)
      },
      adjustment: adjustment,
      dtr: {
        absentDays: num(dtr.absentDays), unpaidLeaveDays: num(dtr.unpaidLeaveDays),
        lateHours: lateHours, lateMinutes: lateMinutes, undertimeMinutes: undertimeMinutes,
        otHours: otHours,
        otRestSpecialHours: otRestSpecialHours, otRegHolidayHours: otRegHolidayHours,
        totalOtHours: totalOtHours, ndHours: ndHours, restDayHours: restDayHours,
        regHolidayDays: regHolidayDays, specialHolidayDays: splHolidayDays,
        ptoDays: ptoDays
      },
      earnings: {
        regularPay: regularPay,
        basicPay: regularPay,
        absenceDeduction: absenceDeduction,
        lateDeduction: lateDeduction,
        undertimeDeduction: undertimeDeduction,
        prorationDeduction: prorationDeduction,
        staffDays: staff,
        deMinimisDeduction: r2(dmAuto.full - deMinimis),
        transportationGiven: transportationGiven,
        companyBonus: exMilestones,
        travelDeduction: travelDeduction,
        otPayRegular: otPayRegular,
        otPayRestSpecial: otPayRestSpecial,
        otPayRegHoliday: otPayRegHoliday,
        otPay: otPay,
        ndPay: ndPay,
        restDayPay: restDayPay,
        regHolidayPay: regHolidayPay,
        specialHolidayPay: splHolidayPay,
        holidayPay: holidayPay,
        deMinimis: deMinimis,
        deMinimisDefaulted: deMinimis > 0,
        deMinimisAuto: dmAuto,
        deMinimisProrated: dmAuto.prorated,
        thirteenthMonth: thirteenthMonth,
        thirteenthExempt: thirteenthExempt,
        thirteenthTaxable: thirteenthTaxable,
        quarterlyBonus: quarterlyBonus,
        quarterlyBonusDetails: dtr.bonusDetails || '',
        transportationAllowance: transportationAllowance,
        taxableAllowances: items.taxableAllowances,
        nonTaxAllowances: items.nonTaxAllowances,
        totalTaxableAllowance: items.totalTaxableAllowance,
        totalNonTaxAllowance: items.totalNonTaxAllowance,
        nonTaxable: nonTaxable,
        grossTaxable: netTaxable,
        grossPay: grossPay
      },
      contributions: {
        share: { sss: sssShare, phic: phicShare, hdmf: hdmfShare },
        sss: sssEE, philhealth: phicEE, pagibig: hdmfEE, total: totalContribEE,
        mandatoriesApplied: mandatories,
        monthly: { sss: sssM, philhealth: phicM, pagibig: hdmfM },
        employer: {
          sss: sssER, sssEC: sssEC, philhealth: phicER, pagibig: hdmfER,
          total: totalContribER
        }
      },
      tax: {
        incomeAfterMandatories: incomeAfterMandatories,
        taxableIncome: netTaxable,
        withholding: tax
      },
      loans: loans,
      postTax: {
        tendoPay: tendoPay, sssLoan: sssLoan, hmo: hmo, classPass: classPass,
        sssLoanManual: num(dtr.sssLoan), sssLoanAuto: loans.sss,
        otherDeductionManual: num(dtr.otherDeduction), otherLoanAuto: loans.other,
        otherDeduction: otherDeduction, reimbursement: reimbursement, taxRefund: taxRefund,
        customDeductions: items.deductions, total: postTaxDeductions
      },
      finalPay: fp || null,
      otherDeductions: items.deductions,
      totalOtherDeductions: items.totalDeductions,
      employerCosts: items.employerCosts,
      totalEmployerCost: items.totalEmployerCost,
      totals: {
        totalDeductions: totalDeductions,
        netPay: netPay,
        employerShare: r2(totalContribER + items.totalEmployerCost),
        costToCompany: r2(grossPay + totalContribER + items.totalEmployerCost)
      }
    };
    slip.remarks = dtr.remarks || '';
    return dtr.posted ? postedSlip(slip, dtr.posted, settings) : slip;
  }

  /**
   * A cutoff loaded from a payroll file whose payout has already happened
   * keeps that file's figures — what was actually paid — rather than a
   * recomputation from today's rates and rules. The slip computed above
   * supplies the shape; every amount the file carries replaces it. Regular
   * pay is what is left of gross after the other earnings, so the slip
   * still adds up. Deduction columns are read as amounts whichever sign the
   * file wrote them with.
   */
  function postedSlip(slip, P, settings) {
    var a = function (k) { return r2(Math.abs(num(P[k]))); };
    var v = function (k) { return r2(num(P[k])); };
    var e = slip.earnings, c = slip.contributions, er = c.employer;
    var rs = rateSetFor(num(P.rate), settings);

    slip.posted = true;
    slip.remarks = P.remarks || slip.remarks || '';
    slip.rates.monthly = r2(num(P.rate));
    slip.rates.baseMonthly = slip.rates.monthly;
    slip.rates.semiMonthly = v('regularPay');
    slip.rates.daily = r2(rs.daily);
    slip.rates.hourly = r2(rs.hourly);
    slip.adjustment = { applies: false, prorated: false, monthly: slip.rates.monthly };

    slip.dtr.otHours = v('otHours'); slip.dtr.totalOtHours = v('otHours');
    slip.dtr.otRestSpecialHours = 0; slip.dtr.otRegHolidayHours = 0;
    slip.dtr.ndHours = v('ndHours'); slip.dtr.absentDays = v('absentDays');
    slip.dtr.unpaidLeaveDays = 0; slip.dtr.restDayHours = 0;
    slip.dtr.regHolidayDays = 0; slip.dtr.specialHolidayDays = 0;
    slip.dtr.lateMinutes = v('lateMinutes'); slip.dtr.lateHours = r2(v('lateMinutes') / 60);
    slip.dtr.undertimeMinutes = v('undertimeMinutes');

    e.otPayRegular = v('otPay'); e.otPayRestSpecial = 0; e.otPayRegHoliday = 0;
    e.otPay = v('otPay'); e.ndPay = v('ndPay');
    e.restDayPay = 0; e.regHolidayPay = 0; e.specialHolidayPay = 0;
    e.holidayPay = v('holidayPay');
    e.deMinimisDeduction = a('dmDeduction');
    e.deMinimis = r2(v('deMinimis') - e.deMinimisDeduction);
    e.deMinimisProrated = false;
    e.quarterlyBonus = v('quarterlyBonus');
    e.quarterlyBonusDetails = P.bonusDetails || '';
    e.transportationGiven = v('travel');
    e.travelDeduction = a('travelDeduction');
    e.transportationAllowance = r2(e.transportationGiven - e.travelDeduction);
    e.absenceDeduction = a('absenceDeduction');
    e.lateDeduction = a('lateDeduction');
    e.undertimeDeduction = a('undertimeDeduction');
    e.prorationDeduction = a('prorationDeduction');
    e.thirteenthMonth = v('thirteenth');
    e.thirteenthTaxable = r2(Math.min(e.thirteenthMonth, v('thirteenthTaxable')));
    e.thirteenthExempt = r2(e.thirteenthMonth - e.thirteenthTaxable);
    // Basic / salary adjustments are taxable. Ex milestones is the company
    // bonus: exempt, within the same yearly ceiling as 13th month (yearEndFor).
    e.taxableAllowances = [['Basic Adjustment', 'basicAdj'], ['Salary Adjustment', 'salaryAdj']]
      .filter(function (x) { return v(x[1]); })
      .map(function (x) { return { label: x[0], amount: v(x[1]) }; });
    e.nonTaxAllowances = v('exMilestones') ? [{ label: 'Ex Milestones (company bonus)', amount: v('exMilestones') }] : [];
    e.totalTaxableAllowance = r2(v('basicAdj') + v('salaryAdj'));
    e.totalNonTaxAllowance = v('exMilestones');
    e.companyBonus = v('exMilestones');
    e.grossPay = v('gross');
    /* Basic actually earned — what 13th month is a twelfth of: the cutoff's
       basic less absences, late, undertime and start/end proration, plus any
       basic or salary adjustment (back pay of basic). */
    e.regularPay = e.basicPay = P.regularPay === undefined
      ? r2(e.grossPay - e.otPay - e.ndPay - e.deMinimis - e.quarterlyBonus -
          e.transportationAllowance - e.holidayPay - e.thirteenthMonth - e.totalTaxableAllowance -
          e.totalNonTaxAllowance)
      : r2(v('regularPay') - e.absenceDeduction - e.lateDeduction - e.undertimeDeduction -
          e.prorationDeduction + v('basicAdj') + v('salaryAdj'));

    c.sss = a('sss'); c.philhealth = a('phic'); c.pagibig = a('hdmf');
    c.total = c.mandatoriesApplied = r2(c.sss + c.philhealth + c.pagibig);
    er.sss = a('sssER'); er.sssEC = a('ec'); er.philhealth = a('phicER'); er.pagibig = a('hdmfER');
    er.total = r2(er.sss + er.sssEC + er.philhealth + er.pagibig);

    slip.tax.incomeAfterMandatories = P.afterMandatories === undefined
      ? r2(e.grossPay - c.total) : v('afterMandatories');
    slip.tax.taxableIncome = v('netTaxable');
    slip.tax.withholding = a('tax');
    e.grossTaxable = slip.tax.taxableIncome;
    e.nonTaxable = r2(e.deMinimis + e.transportationAllowance + e.thirteenthExempt + e.companyBonus);

    var pt = slip.postTax;
    pt.tendoPay = a('tendo'); pt.hmo = a('hmo'); pt.otherDeduction = a('other');
    pt.sssLoan = a('sssLoan'); pt.sssLoanManual = pt.sssLoan; pt.sssLoanAuto = 0;
    pt.classPass = a('classPass');
    pt.otherDeductionManual = pt.otherDeduction; pt.otherLoanAuto = 0;
    pt.reimbursement = v('reimbursement'); pt.taxRefund = v('taxRefund'); pt.customDeductions = [];
    pt.total = r2(pt.tendoPay + pt.hmo + pt.otherDeduction + pt.sssLoan + pt.classPass);
    slip.otherDeductions = []; slip.totalOtherDeductions = 0;
    slip.employerCosts = []; slip.totalEmployerCost = 0;

    slip.totals.netPay = v('net');

    /* What the file's own GROSS PAY and NET PAY carry beyond the columns
       here — a figure typed over a formula, a column this layout lacks. The
       payslip prints it as one line so it lands on the net actually paid. */
    e.postedGrossAdjustment = P.regularPay === undefined ? 0 : r2(e.grossPay - (slip.rates.semiMonthly +
      e.otPay + e.ndPay + e.deMinimis + e.quarterlyBonus + e.transportationAllowance +
      e.holidayPay + e.thirteenthMonth + e.totalTaxableAllowance + e.totalNonTaxAllowance - e.absenceDeduction -
      e.lateDeduction - e.undertimeDeduction - e.prorationDeduction));
    slip.postedNetAdjustment = r2(slip.totals.netPay - (e.grossPay - c.mandatoriesApplied -
      slip.tax.withholding - pt.total + pt.reimbursement + pt.taxRefund));
    slip.totals.totalDeductions = r2(c.total + slip.tax.withholding + pt.total);
    slip.totals.employerShare = er.total;
    slip.totals.costToCompany = r2(e.grossPay + er.total);
    return slip;
  }

  /* =======================================================================
     YEAR-END — leave ledger, 13th month pay, annualised tax

     All three need figures across the whole year, so they are computed from
     the DTR map rather than from a single period. computePayslip is always
     called here WITHOUT extras, so a year-end posting can never feed back
     into the year-to-date figures it was derived from.
     ======================================================================= */

  /** Periods of `year`, by payout date. */
  function periodsOfYear(year) {
    return buildPeriods(year).filter(function (p) {
      return parseYmd(p.payoutDate).getFullYear() === year;
    });
  }

  /**
   * How many unused leave days an employee is allowed to monetize.
   * Hired before settings.leave.monetizeCutoffYear -> the tenured cap;
   * hired in that year or later -> the regular cap. A missing or unparseable
   * dateHired cannot prove tenure, so it takes the lower cap.
   */
  function monetizationCap(emp, settings) {
    var lv = settings.leave;
    var hired = emp.dateHired ? parseYmd(emp.dateHired) : null;
    var hireYear = (hired && isFinite(hired.getFullYear())) ? hired.getFullYear() : null;
    var tenured = hireYear !== null && hireYear < num(lv.monetizeCutoffYear);
    return {
      tenured: tenured,
      hireYear: hireYear,
      maxDays: tenured ? num(lv.monetizeMaxDaysTenured) : num(lv.monetizeMaxDaysRegular)
    };
  }

  /** PTO taken so far this year, what remains, and what may be monetized. */
  function leaveLedger(emp, year, dtrMap, settings, uptoPayoutDate) {
    var credits = (emp.leaveCredits === undefined || emp.leaveCredits === null)
      ? settings.leave.annualCredits : num(emp.leaveCredits);
    var used = 0, usedToDate = 0;
    periodsOfYear(year).forEach(function (p) {
      var d = (dtrMap || {})[p.id + '|' + emp.id];
      var days = d ? num(d.ptoDays) : 0;
      used += days;
      if (!uptoPayoutDate || p.payoutDate <= uptoPayoutDate) usedToDate += days;
    });

    // Only unused credits can be converted, and never more than the cap, so
    // an overdrawn balance monetizes nothing rather than going negative.
    var remaining = credits - usedToDate;
    var cap = monetizationCap(emp, settings);
    var monetizableDays = Math.max(0, Math.min(remaining, cap.maxDays));
    var dailyRate = rateSet(emp, settings).daily;

    return {
      credits: r2(credits),
      usedThisYear: r2(used),
      usedToDate: r2(usedToDate),
      remaining: r2(remaining),
      overdrawn: remaining < 0,
      monetizeMaxDays: r2(cap.maxDays),
      monetizeTenured: cap.tenured,
      monetizeHireYear: cap.hireYear,
      monetizableDays: r2(monetizableDays),
      monetizableAmount: r2(monetizableDays * dailyRate),
      monetizeCappedByRule: remaining > cap.maxDays
    };
  }

  /** Year-to-date basic earned, taxable income and tax withheld. */
  /** Cutoffs WORKED in `year` — January 1 to December 31 by their dates,
      whatever year they are paid in. 13th month counts these. */
  function cutoffsOfYear(year) {
    return buildPeriods(year).concat(buildPeriods(year + 1)).filter(function (p) {
      return parseInt(p.start.slice(0, 4), 10) === year;
    });
  }

  /**
   * The rate a cutoff without a payroll file is worked out at. A salary
   * change seen in the files holds until the next one: the rate of the
   * latest imported cutoff before this one; before the first file, the
   * earliest rate on file; after the last file, the employee's current
   * rate (which the import keeps at the latest file's rate, unless a salary
   * sheet changed it since).
   */
  function carriedRate(emp, period, dtrMap) {
    var suffix = '|' + emp.id, before = null, after = null, lastEnd = null;
    Object.keys(dtrMap || {}).forEach(function (k) {
      if (k.slice(-suffix.length) !== suffix) return;
      var d = dtrMap[k];
      if (!d || !d.posted || !num(d.posted.rate)) return;
      var pid = k.slice(0, -suffix.length);
      var y = parseInt(pid.slice(0, 4), 10), p = null;
      [y, y - 1, y + 1].forEach(function (yy) {
        if (!p) p = buildPeriods(yy).filter(function (x) { return x.id === pid; })[0] || null;
      });
      if (!p) return;
      if (!lastEnd || p.end > lastEnd) lastEnd = p.end;
      if (p.end < period.start && (!before || p.end > before.end)) before = { end: p.end, rate: num(d.posted.rate) };
      if (p.start > period.end && (!after || p.start < after.start)) after = { start: p.start, rate: num(d.posted.rate) };
    });
    if (lastEnd && lastEnd < period.start) return null;       // after the last file: current rate
    if (before) return before.rate;
    if (after) return after.rate;
    return null;
  }
  function withCarriedRate(emp, period, dtrMap) {
    var d = (dtrMap || {})[period.id + '|' + emp.id];
    if (d && d.posted) return emp;
    var r = carriedRate(emp, period, dtrMap);
    if (r === null || Math.abs(r - num(emp.monthlyRate)) < 0.005) return emp;
    var copy = {};
    Object.keys(emp).forEach(function (k) { copy[k] = emp[k]; });
    copy.monthlyRate = r;
    copy.salaryAdjustment = 0;      // the carried rate is the rate then
    return copy;
  }

  /**
   * What a cutoff counts toward the 13th month: the basic salary BEFORE
   * absences, late and undertime (the company's rule, 23 Oct 2026) — less
   * only the days before a start date or after a last day, plus any basic
   * or salary adjustment.
   */
  function grossBasic(slip) {
    var e = slip.earnings;
    var adj = (e.taxableAllowances || []).reduce(function (t, a) {
      return /adjustment/i.test(a.label) ? t + a.amount : t;
    }, 0);
    return r2(slip.rates.semiMonthly - (e.prorationDeduction || 0) + adj);
  }
  /** The share of a cutoff someone was on staff for, in working days. A
      cutoff a payroll file paid them for counts whole when their dates are
      not on file. */
  function staffShare(emp, period, settings, posted) {
    var st = staffDays(emp, period, settings);
    if (!st.total) return 0;
    var f = st.onStaff / st.total;
    return posted && f === 0 ? 1 : f;
  }

  /** Whether any employee's figures for this cutoff came from a payroll file. */
  function isPostedPeriod(dtrMap, periodId) {
    var prefix = periodId + '|';
    for (var k in dtrMap) {
      if (k.lastIndexOf(prefix, 0) === 0 && dtrMap[k] && dtrMap[k].posted) return true;
    }
    return false;
  }

  /**
   * Year-to-date figures. Tax follows the money: cutoffs PAID in `year`.
   * 13th month follows the work: basic earned in cutoffs WORKED in `year`
   * (January 1 to December 31), with the 13th month already paid, the
   * company bonus and transport that share its exempt ceiling.
   */
  function yearToDate(emp, year, dtrMap, settings, uptoPayoutDate) {
    var basic = 0, taxable = 0, withheld = 0, gross = 0, periods = 0, paid13 = 0, paid13Taxable = 0, bonus = 0, transport = 0, dm = 0, halves = 0;
    var seen = {};
    periodsOfYear(year).concat(cutoffsOfYear(year)).forEach(function (p) {
      if (seen[p.id]) return;
      seen[p.id] = true;
      if (uptoPayoutDate && p.payoutDate > uptoPayoutDate) return;
      var d = (dtrMap || {})[p.id + '|' + emp.id];
      // Cutoffs before the start date or after the last day earn nothing,
      // unless a payroll file says otherwise.
      if (!(d && d.posted) && staffDays(emp, p, settings).onStaff === 0) return;
      // A cutoff with an imported payroll file paid only the people in it.
      if (!(d && d.posted) && isPostedPeriod(dtrMap, p.id)) return;
      var slip = computePayslip(withCarriedRate(emp, p, dtrMap), p, d, settings, null);
      if (parseYmd(p.payoutDate).getFullYear() === year) {
        taxable += slip.tax.taxableIncome;
        withheld += slip.tax.withholding;
        gross += slip.earnings.grossPay;
        periods++;
      }
      if (parseInt(p.start.slice(0, 4), 10) === year) {
        basic += grossBasic(slip);
        halves += staffShare(emp, p, settings, d && d.posted);
        paid13 += slip.earnings.thirteenthMonth;
        paid13Taxable += slip.earnings.thirteenthTaxable;
        bonus += slip.earnings.companyBonus || 0;
        transport += slip.earnings.transportationAllowance || 0;
        dm += slip.earnings.deMinimis || 0;
      }
    });
    return {
      basicEarned: r2(basic), taxableIncome: r2(taxable),
      taxWithheld: r2(withheld), grossPay: r2(gross), periods: periods,
      thirteenthPaid: r2(paid13), thirteenthTaxedPaid: r2(paid13Taxable), companyBonus: r2(bonus), transport: r2(transport), deMinimis: r2(dm),
      monthsWorked: Math.min(12, Math.round(halves / 2 * 100) / 100)
    };
  }

  /**
   * The 13th month for one employee, cutoff by cutoff — what yearEndFor
   * sums, laid out so it can be checked: the rate paid, when it changed,
   * the basic earned and the twelfth of it each cutoff adds. Rows follow
   * yearToDate's rules exactly (a cutoff off staff, or one whose payroll
   * file does not list them, earns nothing), so the totals agree.
   */
  function thirteenthDetail(emp, year, dtrMap, settings, today) {
    var div = settings.yearEnd.thirteenthMonthDivisor || 12;
    var rows = [], earnedSoFar = 0, lastRate = null;
    cutoffsOfYear(year).forEach(function (p) {
      var d = (dtrMap || {})[p.id + '|' + emp.id];
      var posted = !!(d && d.posted);
      var row = { period: p, included: true, source: '', note: '' };
      if (!posted && staffDays(emp, p, settings).onStaff === 0) {
        row.included = false;
        row.note = emp.dateHired && emp.dateHired > p.end ? 'Before start date' : 'After last day';
      } else if (!posted && isPostedPeriod(dtrMap, p.id)) {
        row.included = false;
        row.note = 'Not in this cutoff\'s payroll file';
      }
      if (!row.included) { rows.push(row); return; }

      var slip = computePayslip(withCarriedRate(emp, p, dtrMap), p, d, settings, null);
      var e = slip.earnings;
      var hasInput = d && Object.keys(d).some(function (k) { return k !== 'ndManual' && d[k] !== null && d[k] !== ''; });
      row.source = posted ? 'Payroll file' : hasInput ? 'Entered on the site'
        : (p.payoutDate <= today ? 'Estimated — no payroll file' : 'Projected from the rate');
      row.rate = slip.rates.monthly;
      row.estimated = !posted && !hasInput;
      /* A salary change is read only between cutoffs whose figures are real
         (a payroll file, or entered here): an estimate uses today's rate,
         which would show as a change that never happened. */
      row.rateChange = !row.estimated && lastRate !== null && Math.abs(row.rate - lastRate) > 0.005
        ? { from: lastRate, to: row.rate } : null;
      if (row.estimated) {
        row.note = row.note || (carriedRate(emp, p, dtrMap) !== null ? 'rate carried from the payroll files' : 'at the current rate');
      }
      if (slip.adjustment && slip.adjustment.prorated) {
        row.note = 'Salary change effective ' + emp.salaryAdjustmentEffective + ', prorated by working days';
      }
      if (!row.estimated) lastRate = row.rate;
      row.basic = slip.rates.semiMonthly;
      row.deductions = r2(e.absenceDeduction + e.lateDeduction + e.undertimeDeduction + e.prorationDeduction);
      row.adjustments = r2(e.taxableAllowances.reduce(function (t, a) {
        return /adjustment/i.test(a.label) ? t + a.amount : t;
      }, 0));
      row.offStaff = e.prorationDeduction || 0;
      row.notCounted = r2(e.absenceDeduction + e.lateDeduction + e.undertimeDeduction);
      row.earned = grossBasic(slip);
      row.share = staffShare(emp, p, settings, posted);
      row.accrued = r2(row.earned / div);
      // The running total is of the basic, then divided, so it lands exactly
      // on the year's 13th month rather than drifting by rounded pieces.
      earnedSoFar += row.earned;
      row.running = r2(earnedSoFar / div);
      row.paid13 = e.thirteenthMonth;
      row.bonus = e.companyBonus || 0;
      row.transport = e.transportationAllowance || 0;
      row.deMinimis = e.deMinimis || 0;
      rows.push(row);
    });
    return { rows: rows, divisor: div, yearEnd: yearEndFor(emp, year, dtrMap, settings) };
  }

  /** BIR annual table. */
  function annualTax(taxableIncome, settings) {
    if (taxableIncome <= 0) return 0;
    var table = settings.annualTaxTable;
    var bracket = table[0];
    for (var i = 0; i < table.length; i++) {
      if (taxableIncome >= table[i].min) bracket = table[i];
    }
    return r2(bracket.base + (taxableIncome - bracket.excessOver) * bracket.rate);
  }

  /**
   * 13th month pay and the year-end tax adjustment for one employee.
   *   thirteenthMonth = basic salary earned in the year / 12
   *   exempt up to the statutory ceiling; the excess is taxable
   *   adjustment = tax withheld during the year - tax due on the annualised
   *                income. Positive means a refund to the employee.
   */
  /** A previous employer's figures for `year`, from the 2316 a new hire brings (emp.bir). */
  function previousEmployer(emp, year) {
    var b = emp.bir || {};
    if (String(b.prevYear || '') !== String(year)) return { taxable: 0, withheld: 0 };
    return { taxable: r2(num(b.prevTaxable)), withheld: r2(num(b.prevWithheld)) };
  }

  function yearEndFor(emp, year, dtrMap, settings) {
    var ye = settings.yearEnd;
    var ytd = yearToDate(emp, year, dtrMap, settings, null);
    var thirteenth = r2(ytd.basicEarned / (ye.thirteenthMonthDivisor || 12));
    /* 13th month, transportation allowance and the company bonus (ex
       milestones) share one yearly exempt ceiling — the company's rule
       (Japheth, 23 Oct 2026). Transport and the bonus go untaxed in each
       cutoff, so whatever the three together pass the ceiling by is taken
       off the 13th month: that much of it is taxable. Only if the excess is
       larger than the 13th month itself does the rest come from the others. */
    var benefits = r2(thirteenth + ytd.companyBonus + ytd.transport);
    /* The year-end non-taxable bonus is paid with the 13th month: the full
       amount for a full year, pro rata by months worked otherwise. It is
       outside the ceiling and never taxed. */
    var yearEndBonus = r2(num(ye.yearEndBonus) * ytd.monthsWorked / 12);
    var taxableBenefits = r2(Math.max(0, benefits - ye.thirteenthMonthExemption));
    var taxableThirteenth = r2(Math.min(thirteenth, taxableBenefits));
    /* Instalments already paid during the year (the payroll files carry
       them) come off what is still owed. Their taxable part is already in
       YTD taxable income, so only the rest of the taxable share is added. */
    var balance = r2(Math.max(0, thirteenth - ytd.thirteenthPaid));
    var addTaxable = r2(Math.max(0, taxableBenefits - ytd.thirteenthTaxedPaid));
    var taxableBalance = r2(Math.min(balance, addTaxable));
    /* A previous employer this year (new hire): their taxable pay joins the
       annual income, and the tax they withheld counts toward what is due. */
    var prev = previousEmployer(emp, year);
    var annualTaxable = r2(ytd.taxableIncome + addTaxable + prev.taxable);
    var due = annualTax(annualTaxable, settings);
    var adjustment = r2(ytd.taxWithheld + prev.withheld - due);
    return {
      ytd: ytd,
      thirteenthMonth: thirteenth,
      companyBonus: ytd.companyBonus,
      transport: ytd.transport,
      deMinimis: ytd.deMinimis,
      benefits: benefits,
      monthsWorked: ytd.monthsWorked,
      yearEndBonus: yearEndBonus,
      thirteenthTaxablePart: taxableThirteenth,
      thirteenthExemptPart: r2(thirteenth - taxableThirteenth),
      thirteenthExempt: r2(benefits - taxableBenefits),
      thirteenthTaxable: taxableBenefits,
      thirteenthPaid: ytd.thirteenthPaid,
      thirteenthBalance: balance,
      thirteenthBalanceTaxable: taxableBalance,
      annualTaxableIncome: annualTaxable,
      previousTaxable: prev.taxable,
      previousWithheld: prev.withheld,
      annualTaxDue: due,
      taxWithheld: ytd.taxWithheld,
      adjustment: adjustment,
      isRefund: adjustment > 0,
      leave: leaveLedger(emp, year, dtrMap, settings, null)
    };
  }

  /**
   * Back pay of a salary change effective before `period`: for every
   * earlier cutoff from the effective date on, half the monthly difference
   * times the share of its working days on or after that date (and on
   * staff) — the same working-day split a change inside a cutoff gets.
   * Paid in `period` as a taxable salary adjustment, so it counts toward
   * the 13th month.
   */
  function backPayFor(emp, effective, oldRate, newRate, period, settings) {
    var diff = r2(num(newRate) - num(oldRate)), rows = [], total = 0;
    var wd = settings.schedule.workDays;
    var y = parseInt(effective.slice(0, 4), 10), py = parseInt(period.start.slice(0, 4), 10);
    var cutoffs = [];
    for (var yy = y - 1; yy <= py; yy++) cutoffs = cutoffs.concat(buildPeriods(yy));
    var seen = {};
    cutoffs.forEach(function (p) {
      if (seen[p.id] || p.end < effective || p.start >= period.start) return;
      seen[p.id] = true;
      var st = staffDays(emp, p, settings), from = effective > p.start ? effective : p.start;
      var d = parseYmd(p.start), end = parseYmd(p.end), all = 0, owed = 0;
      var hired = String(emp.dateHired || ''), left = String(emp.endDate || '');
      while (d <= end) {
        if (wd.indexOf(d.getDay()) !== -1) {
          all++;
          var k = ymd(d);
          if (k >= from && !(hired && k < hired) && !(left && k > left)) owed++;
        }
        d.setDate(d.getDate() + 1);
      }
      if (!all || !owed || !st.onStaff) return;
      var amount = r2(diff / 2 * owed / all);
      rows.push({ periodId: p.id, days: owed, of: all, amount: amount });
      total += amount;
    });
    var last = new Date(parseYmd(period.start).getTime() - 86400000);
    return { amount: r2(total), rows: rows, from: effective, to: ymd(last), oldRate: r2(num(oldRate)), newRate: r2(num(newRate)) };
  }

  /**
   * BIR Form 2316 (Certificate of Compensation Payment / Tax Withheld) for
   * one employee and year: the cutoffs PAID in the year, as yearToDate counts
   * them, plus the year's 13th month and benefits (yearEndFor). Item numbers
   * follow the September 2021 (ENCS) form. Taxable basic is what is left of
   * the year's taxable income once overtime, other taxable pay and the taxed
   * 13th month already paid are taken out — basic net of the contributions,
   * which the form lists as non-taxable — so Taxable (52), plus a previous
   * employer's (22), equals the
   * annual taxable income the year-end tax is worked out on.
   */
  function bir2316For(emp, year, dtrMap, settings) {
    var ot = 0, others = 0, mand = 0, worked = [];
    var seen = {};
    periodsOfYear(year).forEach(function (p) {
      if (seen[p.id]) return;
      seen[p.id] = true;
      var d = (dtrMap || {})[p.id + '|' + emp.id];
      if (!(d && d.posted) && staffDays(emp, p, settings).onStaff === 0) return;
      if (!(d && d.posted) && isPostedPeriod(dtrMap, p.id)) return;
      // Not in a payroll file and no rate here: not on this payroll.
      if (!(d && d.posted) && !(num(withCarriedRate(emp, p, dtrMap).monthlyRate) > 0)) return;
      var slip = computePayslip(withCarriedRate(emp, p, dtrMap), p, d, settings, null);
      if (!slip.earnings.grossPay) return;
      var e = slip.earnings;
      worked.push(p);
      ot += (e.otPay || 0) + (e.ndPay || 0) + (e.holidayPay || 0) + (e.restDayPay || 0);
      others += (e.quarterlyBonus || 0) + (e.taxableAllowances || []).reduce(function (t, a) {
        return /adjustment/i.test(a.label) ? t : t + a.amount;   // salary adjustments are basic
      }, 0);
      mand += slip.contributions.mandatoriesApplied || 0;
    });
    var ye = yearEndFor(emp, year, dtrMap, settings);
    var ytd = ye.ytd;
    /* Items as the September 2021 (ENCS) form numbers them, filled the way
       the company's certificates are: transport sits with de minimis (35),
       34 is the 13th month and other benefits left tax-free, 25A is the tax
       withheld as adjusted at year-end (= tax due). */
    var i48 = r2(ye.thirteenthTaxable), i50 = r2(ot), i51a = r2(others);
    var i39 = r2(ytd.taxableIncome - i50 - i51a - ytd.thirteenthTaxedPaid);
    var i52 = r2(i39 + i48 + i50 + i51a);
    var i34 = r2(Math.max(0, ye.thirteenthExempt - ytd.transport));
    var i35 = r2(ytd.deMinimis + (ye.thirteenthExempt - i34));
    var i36 = r2(mand), i37 = r2(ye.yearEndBonus);
    var i38 = r2(i34 + i35 + i36 + i37);
    var isDate = function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); };
    var from = year + '-01-01', to = year + '-12-31';
    if (isDate(emp.dateHired) && emp.dateHired > from) from = emp.dateHired;
    if (isDate(emp.endDate) && emp.endDate < to) to = emp.endDate;
    return {
      year: year, periodFrom: from, periodTo: to, cutoffs: worked.length,
      items: {
        i34: i34, i35: i35, i36: i36, i37: i37, i38: i38,
        i39: i39, i48: i48, i50: i50, i51a: i51a, i52: i52,
        i19: r2(i38 + i52), i20: i38, i21: i52, i22: ye.previousTaxable, i23: r2(i52 + ye.previousTaxable),
        i24: ye.annualTaxDue, i25a: r2(ye.annualTaxDue - ye.previousWithheld), i25b: ye.previousWithheld,
        i26: ye.annualTaxDue, i27: 0, i28: ye.annualTaxDue
      },
      withheld: ye.taxWithheld,
      adjustment: ye.adjustment
    };
  }

  /** A cutoff by its id ("2026-11-P10"), from the year it names or either side. */
  function periodById(id) {
    var y = parseInt(String(id).slice(0, 4), 10), hit = null;
    [y, y - 1, y + 1].forEach(function (yy) {
      if (!hit && yy) hit = buildPeriods(yy).filter(function (p) { return p.id === id; })[0] || null;
    });
    return hit;
  }

  /**
   * Final pay for someone leaving, paid in the cutoff emp.finalPay.periodId:
   *   13th month   the year's 13th month not yet paid (pro rata, yearEndFor)
   *   leave        unused leave × daily rate: the year's credits prorated to
   *                the months worked, less the leave taken — unless typed
   *                (leaveDays); tax-free up to finalPay.leaveExemptDays
   *   loans        every loan's balance left after that cutoff's instalment
   *   clearance    deductions typed for the clearance (laptop, advances …)
   *   tax          the annual adjustment: tax withheld to date (that cutoff
   *                included) less the tax due on the year's taxable income
   *                plus the taxable part of the 13th month and the leave.
   *                Positive is a refund. The 13th month and the leave are
   *                kept out of that cutoff's own withholding so the tax on
   *                them is counted once, here.
   * Each part can be switched off (thirteenth/leave/tax/loans === false).
   */
  function finalPayFor(emp, dtrMap, settings) {
    var cfg = emp.finalPay;
    var period = cfg && cfg.periodId ? periodById(cfg.periodId) : null;
    if (!period) return null;
    var on = function (k) { return cfg[k] !== false; };
    var workYear = parseInt(period.start.slice(0, 4), 10);
    var taxYear = parseYmd(period.payoutDate).getFullYear();

    var ye = yearEndFor(emp, workYear, dtrMap, settings);
    var thirteenth = on('thirteenth') ? ye.thirteenthBalance : 0;
    var thirteenthTaxable = on('thirteenth') ? ye.thirteenthBalanceTaxable : 0;

    var leave = ye.leave, daily = rateSet(emp, settings).daily;
    var leaveEarned = r2(leave.credits * ye.monthsWorked / 12);
    var leaveUnused = r2(Math.max(0, leaveEarned - leave.usedThisYear));
    var typed = cfg.leaveDays !== undefined && cfg.leaveDays !== null && cfg.leaveDays !== '';
    var leaveDays = on('leave') ? r2(Math.max(0, typed ? num(cfg.leaveDays) : leaveUnused)) : 0;
    var leaveAmount = r2(leaveDays * daily);
    var exemptDays = num(((settings.finalPay || {}).leaveExemptDays));
    var leaveTaxable = r2(Math.max(0, leaveDays - exemptDays) * daily);

    var loanRows = [];
    if (on('loans')) {
      (emp.loans || []).forEach(function (loan) {
        var d = loanDeduction(loan, period);
        var left = d ? d.balanceAfter : 0;
        if (left > 0) {
          loanRows.push({ label: 'Loan balance \u2014 ' + (loan.type === 'sss' ? 'SSS' : 'loan') +
            (loan.reference ? ' ' + loan.reference : '') + ' (final pay)', amount: r2(left) });
        }
      });
    }
    var clearance = (cfg.clearance || []).filter(function (c) { return num(c.amount) && String(c.label || '').trim(); })
      .map(function (c) { return { label: String(c.label).trim(), amount: r2(num(c.amount)) }; });

    var ytd = yearToDate(emp, taxYear, dtrMap, settings, period.payoutDate);
    var prev = previousEmployer(emp, taxYear);
    var annualTaxable = r2(ytd.taxableIncome + thirteenthTaxable + leaveTaxable + prev.taxable);
    var due = annualTax(annualTaxable, settings);
    var taxAdjustment = on('tax') ? r2(ytd.taxWithheld + prev.withheld - due) : 0;

    return {
      period: period,
      thirteenth: thirteenth, thirteenthTaxable: thirteenthTaxable, thirteenthPaid: ye.thirteenthPaid,
      leaveDays: leaveDays, leaveSuggested: leaveUnused, leaveEarned: leaveEarned, leaveCredits: leave.credits,
      leaveUsed: leave.usedThisYear, monthsWorked: ye.monthsWorked,
      leaveAmount: leaveAmount, leaveTaxable: leaveTaxable, dailyRate: r2(daily),
      loanRows: loanRows, loanBalance: r2(loanRows.reduce(function (t, l) { return t + l.amount; }, 0)),
      clearance: clearance, clearanceTotal: r2(clearance.reduce(function (t, c) { return t + c.amount; }, 0)),
      ytdTaxable: ytd.taxableIncome, ytdWithheld: ytd.taxWithheld,
      annualTaxable: annualTaxable, annualTaxDue: due, taxAdjustment: taxAdjustment
    };
  }

  /** Run the whole company for one period. */
  function computeRun(employees, period, dtrMap, settings) {
    var ye = settings.yearEnd || {};
    var post13th = ye.thirteenthMonthPeriodId === period.id;
    var postRefund = ye.taxRefundPeriodId === period.id;
    var year = parseYmd(period.payoutDate).getFullYear();

    var slips = employees.map(function (emp) {
      var key = period.id + '|' + emp.id;
      var extra = null;
      var fp = emp.finalPay && emp.finalPay.periodId === period.id ? finalPayFor(emp, dtrMap, settings) : null;
      // Someone paid their final pay already had their 13th month and tax settled then.
      var settled = emp.finalPay && emp.finalPay.periodId && periodById(emp.finalPay.periodId) &&
        periodById(emp.finalPay.periodId).payoutDate < period.payoutDate;
      if (fp) {
        extra = { thirteenthMonth: fp.thirteenth, thirteenthMonthTaxable: 0, taxRefund: fp.taxAdjustment, finalPay: fp };
      } else if ((post13th || postRefund) && !settled) {
        var calc = yearEndFor(emp, year, dtrMap, settings);
        extra = {
          thirteenthMonth: post13th ? calc.thirteenthBalance : 0,
          thirteenthMonthTaxable: post13th ? calc.thirteenthBalanceTaxable : 0,
          yearEndBonus: post13th ? calc.yearEndBonus : 0,
          taxRefund: postRefund ? calc.adjustment : 0
        };
      }
      return computePayslip(withCarriedRate(emp, period, dtrMap), period, (dtrMap || {})[key], settings, extra);
    });

    var totals = {
      basicPay: 0, otPay: 0, ndPay: 0, restDayPay: 0, holidayPay: 0,
      thirteenthMonth: 0, taxRefund: 0,
      allowances: 0, grossPay: 0,
      sss: 0, philhealth: 0, pagibig: 0, tax: 0, otherDeductions: 0,
      totalDeductions: 0, netPay: 0, employerShare: 0, costToCompany: 0
    };

    slips.forEach(function (s) {
      totals.basicPay += s.earnings.regularPay;
      totals.otPay += s.earnings.otPay;
      totals.ndPay += s.earnings.ndPay;
      totals.restDayPay += s.earnings.restDayPay;
      totals.holidayPay += s.earnings.holidayPay;
      totals.thirteenthMonth += s.earnings.thirteenthMonth;
      totals.taxRefund += s.postTax.taxRefund;
      totals.allowances += s.earnings.totalTaxableAllowance + s.earnings.totalNonTaxAllowance +
        s.earnings.deMinimis + s.earnings.quarterlyBonus + s.earnings.transportationAllowance;
      totals.grossPay += s.earnings.grossPay;
      totals.sss += s.contributions.sss;
      totals.philhealth += s.contributions.philhealth;
      totals.pagibig += s.contributions.pagibig;
      totals.tax += s.tax.withholding;
      totals.otherDeductions += s.postTax.total;
      totals.totalDeductions += s.totals.totalDeductions;
      totals.netPay += s.totals.netPay;
      totals.employerShare += s.totals.employerShare;
      totals.costToCompany += s.totals.costToCompany;
    });

    Object.keys(totals).forEach(function (k) { totals[k] = r2(totals[k]); });
    return { period: period, slips: slips, totals: totals };
  }

  global.PayrollEngine = {
    bir2316For: bir2316For,
    backPayFor: backPayFor,
    finalPayFor: finalPayFor,
    periodById: periodById,
    r2: r2,
    num: num,
    ymd: ymd,
    parseYmd: parseYmd,
    fmtLong: fmtLong,
    fmtShort: fmtShort,
    buildPeriods: buildPeriods,
    workingDaysInPeriod: workingDaysInPeriod,
    holidaysInPeriod: holidaysInPeriod,
    ageFrom: ageFrom,
    employeeAge: employeeAge,
    rateSet: rateSet,
    rateSetFor: rateSetFor,
    salaryAdjustment: salaryAdjustment,
    deMinimisFor: deMinimisFor,
    otHoursBeforeNd: otHoursBeforeNd,
    suggestNdHours: suggestNdHours,
    sssContribution: sssContribution,
    philhealthContribution: philhealthContribution,
    pagibigContribution: pagibigContribution,
    withholdingTax: withholdingTax,
    loanDeduction: loanDeduction,
    collectLoans: collectLoans,
    periodsOfYear: periodsOfYear,
    monetizationCap: monetizationCap,
    leaveLedger: leaveLedger,
    yearToDate: yearToDate,
    annualTax: annualTax,
    yearEndFor: yearEndFor,
    itemAppliesToPeriod: itemAppliesToPeriod,
    computePayslip: computePayslip,
    computeRun: computeRun,
    staffDays: staffDays,
    carriedRate: carriedRate,
    cutoffsOfYear: cutoffsOfYear,
    thirteenthDetail: thirteenthDetail,
    isPostedPeriod: isPostedPeriod
  };
})(window);

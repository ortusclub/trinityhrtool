/* =========================================================================
   template.js — the payroll workbook, in the Ortus payroll summary format

   Sheet 1 "Payroll" follows the company's own payroll file: company name on
   row 1, "Payroll | January 1 - 15, 2026" on row 2, then one header row.
   It is both the template that is downloaded, filled and imported back, and
   the layout of the past payroll files (January onward) loaded into the
   site. Columns are found by their header NAME, so a file whose columns are
   in a different order still reads; the cutoff comes from the row-2 title.

   The downloaded sheet is live: pay columns are formulas over the rate and
   the typed hours, days and amounts, so totals move as it is filled in.
   SSS, PhilHealth, HDMF and the de minimis and start/end proration figures
   are written as values — they follow the rate and dates, not the inputs.

   The other sheets are reference: the roster, the SSS and tax tables, and
   the rate rules.
   ========================================================================= */
(function (global) {
  'use strict';

  var X = global.XlsxWriter;
  var S = X.S;

  /* `key` is where the value lives in a posted cutoff (engine postedSlip)
     or the timesheet. `input` columns are typed and read back for an
     upcoming cutoff; for a payout already made every column is the record.
     `alias` lists other spellings older files used. */
  var PAYROLL_COLUMNS = [
    { head: 'NO', key: 'no', width: 6 },
    { head: 'EMPLOYEE ID', key: 'id', width: 13 },
    { head: 'EMPLOYEE NAME', key: 'name', width: 28 },
    { head: 'POSITION', key: 'position', width: 24 },
    { head: 'DEPARTMENT', key: 'department', width: 18 },
    { head: 'EMPLOYEE RATE', key: 'rate', width: 13 },
    // A salary change: the new monthly rate and the date it takes effect.
    { head: 'NEW RATE', key: 'newRate', input: 'newRate', width: 13 },
    { head: 'NEW RATE EFFECTIVE DATE', key: 'newRateDate', input: 'newRateDate', width: 14 },
    { head: 'PAY PERIOD', key: 'payPeriod', width: 8 },
    { head: 'REGULAR PAY', key: 'regularPay', width: 13, alias: ['BASIC PAY'] },
    { head: 'REGULAR OVERTIME', key: 'otHours', input: 'otHours', width: 11,
      alias: ['REGULAR OVERTIME HOURS'] },
    { head: 'REGULAR OVERTIME PAY', key: 'otPay', width: 12 },
    { head: 'NIGHT DIFFERENTIAL HOURS', key: 'ndHours', input: 'ndHours', width: 12 },
    { head: 'NIGHT DIFFERENTIAL PAY', key: 'ndPay', width: 12 },
    { head: 'DE MINIMIS (DM)', key: 'deMinimis', width: 11 },
    { head: 'QUARTERLY BONUS TAXABLE', key: 'quarterlyBonus', input: 'quarterlyBonus', width: 12 },
    // What the bonus is for, printed under it on the payslip.
    { head: 'QUARTERLY BONUS DETAILS', key: 'bonusDetails', input: 'bonusDetails', width: 28 },
    // Back pay of a backdated raise (worked out on the site from the new rate
    // and its date); older files' salary adjustment column reads into it.
    { head: 'SALARY ADJ (BACK PAY)', key: 'salaryAdj', width: 13,
      alias: ['ADHOC PAYMENT - SALARY ADJ', 'ADHOC PAYMENT - SALARY ADJUSTMENT', 'SALARY ADJ', 'SALARY ADJUSTMENT'] },
    { head: 'TRAVEL ALLOWANCE', key: 'travel', input: 'transportationAllowance', width: 12,
      alias: ['TRANSPORTATION ALLOWANCE'] },
    { head: 'DAYS ABSENT', key: 'absentDays', input: 'absentDays', width: 9 },
    { head: 'DAYS ABSENT DEDUCTION', key: 'absenceDeduction', width: 12, alias: ['ABSENT DEDUCTION'] },
    { head: 'LATE MINUTES', key: 'lateMinutes', input: 'lateMinutes', width: 9 },
    { head: 'LATE DEDUCTION', key: 'lateDeduction', width: 11 },
    { head: 'UNDERTIME MINUTES', key: 'undertimeMinutes', input: 'undertimeMinutes', width: 11 },
    { head: 'UNDERTIME DEDUCTION', key: 'undertimeDeduction', width: 12 },
    { head: 'ADHOC PAYMENT - BASIC ADJ DEDUCTIONS', key: 'prorationDeduction', width: 14,
      alias: ['ADHOC PAYMENT - BASIC ADJ DEDUCTION'] },
    // A file that labels both de minimis columns "DE MINIMIS (DM)" still
    // reads: the second one found is the deduction. Same for travel.
    { head: 'DE MINIMIS (DM) DEDUCTIONS', key: 'dmDeduction', width: 12,
      alias: ['DE MINIMIS (DM) DEDUCTION', 'DE MINIMIS DEDUCTIONS'], second: 'DE MINIMIS (DM)' },
    { head: 'TRAVEL ALLOWANCE DEDUCTIONS', key: 'travelDeduction', input: 'travelDeduction', width: 12,
      alias: ['TRAVEL ALLOWANCE DEDUCTION'], second: 'TRAVEL ALLOWANCE' },
    { head: 'GROSS PAY', key: 'gross', width: 13 },
    { head: 'SSS EE CONTRIBUTION', key: 'sss', width: 12 },
    { head: 'PHIC EE CONTRIBUTION', key: 'phic', width: 12 },
    { head: 'HDMF EE CONTRIBUTION', key: 'hdmf', width: 12 },
    { head: 'INCOME AFTER MANDATORIES', key: 'afterMandatories', width: 13 },
    { head: 'NET TAXABLE AMOUNT', key: 'netTaxable', width: 13 },
    { head: 'TAX', key: 'tax', width: 11 },
    { head: 'TENDO PAY', key: 'tendo', input: 'tendoPay', width: 11 },
    { head: 'HMO', key: 'hmo', input: 'hmo', width: 10 },
    { head: 'SSS LOAN', key: 'sssLoan', input: 'sssLoan', width: 11 },
    { head: 'CLASS PASS DEDUCTION', key: 'classPass', input: 'classPass', width: 12, alias: ['CLASS PASS'] },
    { head: 'OTHER DEDUCTION', key: 'other', input: 'otherDeduction', width: 12, alias: ['OTHER DEDUCTIONS'] },
    { head: 'NET PAY', key: 'net', width: 13 },
    { head: 'SSS ER CONTRIBUTION', key: 'sssER', width: 12 },
    { head: 'HDMF ER CONTRIBUTION', key: 'hdmfER', width: 12 },
    { head: 'PHIC ER CONTRIBUTION', key: 'phicER', width: 12 },
    { head: 'EC', key: 'ec', width: 8 },
    { head: 'Remarks', key: 'remarks', input: 'remarks', width: 30 }
  ];
  /* The format of each column to fill in, written in row 2 above its header.
     No month names: the importer reads the cutoff from the title rows. */
  var FORMAT_HINTS = {
    newRate: 'monthly, e.g. 45,000.00', newRateDate: 'date, e.g. 2026-09-15',
    otHours: 'hours, e.g. 2.5', ndHours: 'hours, e.g. 1.5',
    quarterlyBonus: 'amount, e.g. 5,000.00', bonusDetails: 'text; ";" between items',
    travel: 'amount, e.g. 800.00', absentDays: 'days, e.g. 1 or 0.5',
    lateMinutes: 'minutes, e.g. 15', undertimeMinutes: 'minutes, e.g. 30',
    travelDeduction: 'amount, e.g. 200.00', tendo: 'amount, e.g. 1,000.00', hmo: 'amount, e.g. 1,000.00',
    sssLoan: 'amount, e.g. 1,000.00', classPass: 'amount, e.g. 1,000.00', other: 'amount, e.g. 500.00',
    remarks: 'text'
  };
  var TEXT_KEYS = { id: 1, name: 1, position: 1, department: 1, remarks: 1, bonusDetails: 1, newRateDate: 1 };

  /* Columns the company's payroll files have carried at one time or another
     that this layout does not: read from past files so the record is whole,
     never written. Several headings may feed one figure (they are summed). */
  var EXTRA_COLUMNS = [
    { key: 'holidayPay', test: /^(LEGAL|SPECIAL) HOLIDAY( OT)? PAY$|^RESTDAY.*PAY$|^REST DAY.*PAY$|^HOLIDAY PAY$/ },
    { key: 'thirteenth', test: /^(ADHOC PAYMENT - )?13TH MONTH( PAY)?( (NON )?TAXABLE)?$/ },
    { key: 'thirteenthTaxable', test: /^(ADHOC PAYMENT - )?13TH MONTH( PAY)? TAXABLE$/ },
    { key: 'exMilestones', test: /^EX MILESTONES?$/ },
    { key: 'basicAdj', test: /^(ADHOC PAYMENT - )?BASIC ADJ(USTMENT)?$/ },
    { key: 'taxRefund', test: /^TAX REFUND/ },
    { key: 'reimbursement', test: /^REIMBURSEMENTS?$/ }
  ];

  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  /** "January 1 - 15, 2026" — the cutoff as the Ortus file writes it. */
  function cutoffTitle(period) {
    var a = global.PayrollEngine.parseYmd(period.start), b = global.PayrollEngine.parseYmd(period.end);
    return MONTH_NAMES[a.getMonth()] + ' ' + a.getDate() + ' - ' + b.getDate() + ', ' + a.getFullYear();
  }

  /* ---------------------------------------------------------------------
     SHEET 1 — Payroll
     --------------------------------------------------------------------- */
  function payrollSheet(run, period, settings) {
    var rows = [];
    rows.push([{ v: 'Company Name: ' + settings.company.name, t: 's', s: S.BOLD }]);
    // Row 2: the title, then above each column to fill in, what goes there.
    var title = [{ v: 'Payroll | ' + cutoffTitle(period), t: 's', s: S.BOLD }];
    PAYROLL_COLUMNS.forEach(function (c, i) {
      if (FORMAT_HINTS[c.key]) title[i] = { v: FORMAT_HINTS[c.key], t: 's', s: S.NOTE };
    });
    rows.push(title);
    rows.push(PAYROLL_COLUMNS.map(function (c) { return { v: c.head, t: 's', s: S.HEAD_TAN }; }));

    var at = {};
    PAYROLL_COLUMNS.forEach(function (c, i) { at[c.key] = X.colName(i + 1); });

    var factor = settings.dayFactor, hpd = settings.schedule.hoursPerDay, prem = settings.premium;
    run.slips.forEach(function (s, i) {
      var r = i + 4;
      var C = function (k) { return at[k] + r; };
      var daily = '(' + C('rate') + '*12/' + factor + ')';
      var hourly = '(' + daily + '/' + hpd + ')';
      var e = s.earnings, c = s.contributions, er = c.employer, d = s.dtr, p = s.postTax;
      var rf = s.employee.employmentClass !== 'manager';
      // A salary change on file: pending or splitting this cutoff, or the back pay it carries.
      var em = s.employee, pending = null;
      if (Number(em.salaryAdjustment) && em.salaryAdjustmentEffective) {
        pending = { rate: E2(Number(em.monthlyRate) + Number(em.salaryAdjustment)), date: em.salaryAdjustmentEffective };
      } else if (em.backPay && em.backPay.periodId === period.id) {
        pending = { rate: em.backPay.newRate, date: em.backPay.from };
      }
      var n = function (v) { return { v: Number(v) || 0, t: 'n', s: S.NUM }; };
      var inp = function (v) {
        return v ? { v: Number(v), t: 'n', s: S.INPUT } : { v: '', t: 's', s: S.INPUT };
      };
      var f = function (expr) { return { v: expr, t: 'f', s: S.NUM }; };

      /* What the site adds that has no column here — rest-day and holiday
         premiums, recurring allowances, 13th month, reimbursements — rides
         inside the formulas as a constant so GROSS and NET PAY still agree
         with the site. SSS loan amortisations sit in SSS LOAN; other loans
         and recurring deductions in OTHER DEDUCTION. The import takes
         both back out. */
      var backPay = E2((e.taxableAllowances || []).reduce(function (t, a) {
        return /back pay|^salary adjustment$/i.test(a.label) ? t + a.amount : t;
      }, 0));
      var extraGross = E2(e.otPayRestSpecial + e.otPayRegHoliday + e.restDayPay + e.holidayPay +
        e.thirteenthMonth + e.totalTaxableAllowance - backPay + e.totalNonTaxAllowance);
      var extraNonTax = E2(e.totalNonTaxAllowance + e.thirteenthExempt);
      var extraNet = E2(p.reimbursement + p.taxRefund);
      var autoOther = E2(p.otherLoanAuto + s.totalOtherDeductions);
      var mand = settings.replicateSheetFormula
        ? C('phic') + '+' + C('hdmf') : C('sss') + '+' + C('phic') + '+' + C('hdmf');

      var cells = {
        no: { v: i + 1, t: 'n', s: S.INT },
        id: { v: s.employee.id, t: 's' },
        name: { v: (s.employee.lastName || '') + ', ' + (s.employee.firstName || ''), t: 's' },
        position: { v: s.employee.position || '', t: 's' },
        department: { v: s.employee.department || '', t: 's' },
        // The rate on file; a change shows in NEW RATE with its date.
        rate: n(s.rates.baseMonthly),
        newRate: pending ? inp(pending.rate) : inp(0),
        newRateDate: { v: pending ? pending.date : '', t: 's', s: S.INPUT },
        payPeriod: { v: period.payPeriodNo, t: 'n', s: S.INT },
        // A raise that lands mid-cutoff splits basic by days — a value then.
        regularPay: s.adjustment && s.adjustment.prorated ? n(s.rates.semiMonthly)
          : f('ROUND(' + C('rate') + '/2,2)'),
        otHours: inp(d.otHours),
        otPay: rf ? f('ROUND(' + hourly + '*' + prem.ot + '*' + C('otHours') + ',2)') : n(0),
        ndHours: inp(d.ndHours),
        ndPay: rf ? f('ROUND(' + hourly + '*' + prem.nd + '*' + C('ndHours') + ',2)') : n(0),
        deMinimis: n(e.deMinimisAuto.full),
        quarterlyBonus: inp(e.quarterlyBonus),
        bonusDetails: { v: e.quarterlyBonusDetails || '', t: 's', s: S.INPUT },
        salaryAdj: n(backPay),
        travel: inp(e.transportationGiven),
        absentDays: inp(d.absentDays + d.unpaidLeaveDays),
        absenceDeduction: f('ROUND(' + daily + '*' + C('absentDays') + ',2)'),
        lateMinutes: inp(d.lateMinutes),
        lateDeduction: f('ROUND(' + hourly + '*' + C('lateMinutes') + '/60,2)'),
        undertimeMinutes: inp(d.undertimeMinutes),
        undertimeDeduction: f('ROUND(' + hourly + '*' + C('undertimeMinutes') + '/60,2)'),
        prorationDeduction: n(e.prorationDeduction),
        dmDeduction: n(e.deMinimisDeduction),
        travelDeduction: inp(e.travelDeduction),
        gross: f(C('regularPay') + '+' + C('otPay') + '+' + C('ndPay') + '+' + C('deMinimis') + '+' +
          C('quarterlyBonus') + '+' + C('salaryAdj') + '+' + C('travel') + '-' + C('absenceDeduction') + '-' +
          C('lateDeduction') + '-' + C('undertimeDeduction') + '-' + C('prorationDeduction') + '-' +
          C('dmDeduction') + '-' + C('travelDeduction') + (extraGross ? '+' + extraGross : '')),
        sss: n(c.sss), phic: n(c.philhealth), hdmf: n(c.pagibig),
        afterMandatories: f(C('gross') + '-(' + mand + ')'),
        netTaxable: f('MAX(0,' + C('afterMandatories') + '-(' + C('deMinimis') + '-' + C('dmDeduction') +
          ')-(' + C('travel') + '-' + C('travelDeduction') + ')' + (extraNonTax ? '-' + extraNonTax : '') + ')'),
        tax: settings.applyWithholdingTax ? f(taxFormula(C('netTaxable'), settings.taxTable)) : n(0),
        tendo: inp(p.tendoPay),
        hmo: inp(p.hmo),
        sssLoan: inp(p.sssLoan),
        classPass: inp(p.classPass),
        other: inp(E2(p.otherDeductionManual + autoOther)),
        net: f(C('afterMandatories') + '-(' + C('tax') + '+' + C('tendo') + '+' + C('hmo') + '+' +
          C('sssLoan') + '+' + C('classPass') + '+' + C('other') + ')' + (extraNet ? '+' + extraNet : '')),
        sssER: n(er.sss), hdmfER: n(er.pagibig), phicER: n(er.philhealth), ec: n(er.sssEC),
        remarks: { v: s.remarks || '', t: 's', s: S.INPUT }
      };
      rows.push(PAYROLL_COLUMNS.map(function (col) { return cells[col.key]; }));
    });

    var last = X.colName(PAYROLL_COLUMNS.length);
    return {
      name: 'Payroll',
      cols: PAYROLL_COLUMNS.map(function (c) { return c.width; }),
      rows: rows,
      rowHeights: { 2: 46 },
      freeze: { x: 3, y: 3 },
      autoFilter: 'A3:' + last + Math.max(3, rows.length)
    };
  }

  function E2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

  /* BIR semi-monthly withholding as one nested IF, the same brackets the
     engine uses: the highest bracket whose floor the income reaches. */
  function taxFormula(x, table) {
    var expr = '0';
    table.forEach(function (b) {
      expr = 'IF(' + x + '>=' + b.min + ',' + b.base + '+(' + x + '-' + b.excessOver + ')*' + b.rate +
        ',' + expr + ')';
    });
    return 'IF(' + x + '<=0,0,ROUND(' + expr + ',2))';
  }

  /* ---------------------------------------------------------------------
     Reference sheets
     --------------------------------------------------------------------- */
  function employeesSheet(employees, settings) {
    var rows = [[{ v: 'Employee Masterfile', t: 's', s: S.TITLE }], []];
    rows.push(['Employee ID', 'Last Name', 'First Name', 'Position', 'Department',
      'Classification', 'Monthly Rate', 'Daily Rate', 'Hourly Rate', 'Date Hired',
      'SSS No.', 'PhilHealth No.', 'HDMF No.', 'TIN']
      .map(function (h) { return { v: h, t: 's', s: S.HEAD }; }));

    employees.forEach(function (emp) {
      var r = global.PayrollEngine.rateSet(emp, settings);
      rows.push([
        { v: emp.id, t: 's' }, { v: emp.lastName, t: 's' }, { v: emp.firstName, t: 's' },
        { v: emp.position, t: 's' }, { v: emp.department, t: 's' },
        { v: emp.employmentClass === 'manager' ? 'Manager (Art. 82 exempt)' : 'Rank and file', t: 's' },
        { v: emp.monthlyRate, t: 'n', s: S.NUM },
        { v: Math.round(r.daily * 100) / 100, t: 'n', s: S.NUM },
        { v: Math.round(r.hourly * 100) / 100, t: 'n', s: S.NUM },
        { v: emp.dateHired || '', t: 's' },
        { v: emp.sssNo || '', t: 's' }, { v: emp.philhealthNo || '', t: 's' },
        { v: emp.pagibigNo || '', t: 's' }, { v: emp.tin || '', t: 's' }
      ]);
    });
    return { name: 'Employees', cols: [13, 16, 16, 24, 18, 22, 13, 12, 12, 12, 16, 17, 16, 16],
             rows: rows, freeze: { x: 1, y: 3 } };
  }

  function sssSheet(settings) {
    var rows = [[{ v: 'SSS Contribution Table 2026', t: 's', s: S.TITLE }],
      [{ v: X.unhideHint(1, [2]), t: 's', s: S.NOTE }],
      [{ v: 'Employee share = Regular EE + MPF EE. Source: SSS Circular 2024-006.', t: 's', s: S.NOTE }], []];
    rows.push(['Range From', 'Range To', 'Regular ER', 'Regular EE', 'MPF ER', 'MPF EE',
      'ECC', 'Total EE', 'Total ER']
      .map(function (h) { return { v: h, t: 's', s: S.HEAD }; }));

    (settings.sss.sssTable || []).forEach(function (b) {
      rows.push([
        { v: b[0], t: 'n', s: S.NUM },
        { v: isFinite(b[1]) ? b[1] : 'and above', t: isFinite(b[1]) ? 'n' : 's', s: isFinite(b[1]) ? S.NUM : S.DEFAULT },
        { v: b[2], t: 'n', s: S.NUM }, { v: b[3], t: 'n', s: S.NUM },
        { v: b[4], t: 'n', s: S.NUM }, { v: b[5], t: 'n', s: S.NUM },
        { v: b[6], t: 'n', s: S.NUM },
        { v: b[3] + b[5], t: 'n', s: S.TOTAL }, { v: b[2] + b[4], t: 'n', s: S.TOTAL }
      ]);
    });
    return { name: 'SSS Table', hiddenRows: [2], cols: [13, 13, 12, 12, 11, 11, 9, 12, 12], rows: rows, freeze: { y: 5 } };
  }

  function taxSheet(settings) {
    var rows = [[{ v: 'BIR Withholding Tax — Semi-Monthly (TRAIN)', t: 's', s: S.TITLE }], []];
    rows.push(['Bracket', 'Taxable income from', 'up to', 'Fixed tax', 'Rate on excess', 'Excess over']
      .map(function (h) { return { v: h, t: 's', s: S.HEAD }; }));
    settings.taxTable.forEach(function (b, i) {
      var next = settings.taxTable[i + 1];
      rows.push([
        { v: i + 1, t: 'n', s: S.INT },
        { v: b.min, t: 'n', s: S.NUM },
        next ? { v: next.min, t: 'n', s: S.NUM } : { v: 'and above', t: 's' },
        { v: b.base, t: 'n', s: S.NUM },
        { v: (b.rate * 100) + '%', t: 's' },
        { v: b.excessOver, t: 'n', s: S.NUM }
      ]);
    });
    return { name: 'Tax Semi-Monthly', cols: [9, 20, 16, 14, 15, 14], rows: rows };
  }

  function rulesSheet(settings, period) {
    var p = settings.premium;
    var rows = [[{ v: 'Rates & Rules', t: 's', s: S.TITLE }], []];
    var section = function (t) { rows.push([{ v: t, t: 's', s: S.BOLD }]); };
    var pair = function (k, v) { rows.push([{ v: k, t: 's' }, { v: v, t: 's' }]); };

    section('Overtime');
    pair('Regular workday', p.ot + 'x hourly rate');
    pair('Rest day / special non-working', p.otRestDaySpecial + 'x hourly rate (130% base x 130% OT)');
    pair('Regular holiday', p.otRegHoliday + 'x hourly rate (200% base x 130% OT)');
    rows.push([]);
    section('Night differential');
    pair('Window', settings.schedule.ndStart + ' to ' + settings.schedule.ndEnd);
    pair('Rate', 'Hourly rate x ' + (p.nd * 100) + '% x night hours worked');
    rows.push([]);
    section('Holiday pay');
    pair('Regular holiday worked', 'Daily rate x 200% (additional ' + (p.regHolidayWorkedExtra * 100) + '%)');
    pair('Special holiday worked', 'Daily rate x 130% (additional ' + (p.specialHolidayWorkedExtra * 100) + '%)');
    rows.push([]);
    section('Allowances');
    pair('Transportation allowance', 'Entered directly as an amount per cutoff (non-taxable)');
    pair('Travel allowance deductions', 'Typed as an amount; comes off the travel allowance (non-taxable)');
    pair('De minimis', 'Automatic — ' + Number(settings.defaultDeMinimis).toFixed(2) +
      ' PHP per cutoff, non-taxable.');
    rows.push([]);
    section('Starting or leaving inside a cutoff');
    pair('ADHOC PAYMENT - BASIC ADJ DEDUCTIONS', 'Automatic from the 201 File start date and last ' +
      'day of work: daily rate x working days in the cutoff before the start date or after the last day.');
    pair('DE MINIMIS (DM) DEDUCTIONS', 'Automatic: the de minimis for those same working days, ' +
      'standard amount x (days off staff / working days in the cutoff).');
    rows.push([]);
    section('Late and undertime');
    pair('LATE / UNDERTIME DEDUCTION', 'Hourly rate x minutes / 60');
    rows.push([]);
    section('Government contributions');
    pair('SSS', 'Per the SSS Table sheet; employee share = Regular EE + MPF EE');
    pair('PhilHealth', (settings.phic.eeRate * 100) + '% employee, ' + (settings.phic.erRate * 100) + '% employer');
    pair('HDMF', settings.hdmf.flatEE.toFixed(2) + ' employee, ' + settings.hdmf.flatER.toFixed(2) + ' employer');
    var when = { 1: 'pay period 1 (paid the 10th)', 2: 'pay period 2 (paid the 25th)', split: 'split across both payouts' };
    pair('SSS deducted on', when[settings.contributionSchedule.sss]);
    pair('PhilHealth deducted on', when[settings.contributionSchedule.phic]);
    pair('HDMF deducted on', when[settings.contributionSchedule.hdmf]);
    rows.push([]);
    section('Schedule & rate basis');
    pair('Working days', 'Monday to Friday');
    pair('Shift', settings.schedule.shiftStart + ' to ' + settings.schedule.shiftEnd +
      ', ' + settings.schedule.breakHours + 'h unpaid break, ' + settings.schedule.hoursPerDay + ' paid hours');
    pair('Overtime accrues after', settings.schedule.otStart);
    pair('Daily rate', 'Monthly x 12 / ' + settings.dayFactor + ' days');
    pair('Hourly rate', 'Daily rate / ' + settings.schedule.hoursPerDay);
    rows.push([]);
    section('Pay periods');
    pair('Pay period 1', 'Paid the 10th — covers the 16th to end of the previous month');
    pair('Pay period 2', 'Paid the 25th — covers the 1st to the 15th');

    return { name: 'Rules & Rates', cols: [34, 62], rows: rows, gridLines: false };
  }

  /* ---------------------------------------------------------------------
     PUBLIC — build and download
     --------------------------------------------------------------------- */
  function buildWorkbook(employees, period, dtrMap, settings, run) {
    return X.build([
      payrollSheet(run, period, settings),
      employeesSheet(employees, settings),
      sssSheet(settings),
      taxSheet(settings),
      rulesSheet(settings, period)
    ]);
  }

  /* ---------------------------------------------------------------------
     PUBLIC — read payroll files back

     Every sheet of the workbook with an "EMPLOYEE ID" + "NET PAY" header
     row is read, so a monthly file holding both cutoffs on two tabs loads
     both. Each sheet's cutoff comes from the title above the header
     ("Payroll | January 1 - 15, 2026"), or failing that its tab name. A
     title naming only a month ("Payroll | January 2026") is resolved per
     row from PAY PERIOD: 2 is the 1st–15th, 1 the 16th to month end.
     --------------------------------------------------------------------- */
  function normHead(h) {
    return String(h === undefined || h === null ? '' : h).replace(/\s+/g, ' ').trim().toUpperCase();
  }

  var MONTHS = {};
  MONTH_NAMES.forEach(function (m, i) { MONTHS[m.slice(0, 3).toLowerCase()] = i + 1; });
  function monthOf(word) { return MONTHS[String(word || '').slice(0, 3).toLowerCase()] || 0; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

  /** { start, end } or { year, month } from a title, or null. */
  function readCutoff(text) {
    var t = String(text || '');
    var m = t.match(/([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s*(\d{4})\s*(?:-|–|—|to)\s*([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s*(\d{4})/i);
    if (m && monthOf(m[1]) && monthOf(m[4])) {
      return { start: ymd(+m[3], monthOf(m[1]), +m[2]), end: ymd(+m[6], monthOf(m[4]), +m[5]) };
    }
    m = t.match(/([A-Za-z]{3,})\.?\s+(\d{1,2})\s*(?:-|–|—|to)\s*(?:([A-Za-z]{3,})\.?\s+)?(\d{1,2})\s*,?\s*(\d{4})/i);
    if (m && monthOf(m[1]) && (!m[3] || monthOf(m[3]))) {
      return { start: ymd(+m[5], monthOf(m[1]), +m[2]), end: ymd(+m[5], monthOf(m[3] || m[1]), +m[4]) };
    }
    m = t.match(/([A-Za-z]{3,})\.?,?\s+(\d{4})/);
    if (m && monthOf(m[1])) return { year: +m[2], month: monthOf(m[1]) };
    return null;
  }

  function numberOf(v) {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'number') return v;
    var s = String(v).trim();
    if (s === '' || s === '-' || s === '–') return 0;
    var neg = /^\(.*\)$/.test(s);
    var n = parseFloat(s.replace(/[(),\s₱]|PHP/gi, ''));
    if (!isFinite(n)) return NaN;
    return neg ? -n : n;
  }

  /* "Ortus Payroll 2026 0125 SUMMARY" — the payout date the file is for. */
  function payoutFromFileName(name) {
    var m = String(name || '').match(/(20\d{2})[\s_-]*(\d{2})(\d{2})(?!\d)/);
    if (!m) return null;
    var mo = +m[2], d = +m[3];
    return mo >= 1 && mo <= 12 && (d === 10 || d === 25) ? ymd(+m[1], mo, d) : null;
  }

  function parseWorkbook(file) {
    return X.read(file).then(function (sheets) {
      var out = [], warnings = [];
      var names = Object.keys(sheets);
      // A file with a "Payroll Register" tab is read from that tab alone;
      // the "Final Pay …" tabs beside it recap a leaver's whole year and
      // would overwrite the register if read as cutoffs.
      var register = names.filter(function (n) { return /payroll\s*register/i.test(n); });
      if (register.length) names = register;
      names = names.filter(function (n) { return !/^\s*final\s*pay/i.test(n); });
      var payout = payoutFromFileName(file && file.name);
      names.forEach(function (name) {
        var grid = sheets[name] || [];
        var hr = -1, head = null;
        for (var r = 0; r < Math.min(grid.length, 30); r++) {
          var h = (grid[r] || []).map(normHead);
          if (h.indexOf('EMPLOYEE ID') !== -1 && h.indexOf('NET PAY') !== -1) { hr = r; head = h; break; }
        }
        if (hr < 0) return;

        // Column by header name; an alias, then a repeated heading, as fallbacks.
        var at = {}, taken = {};
        PAYROLL_COLUMNS.forEach(function (c) {
          var names = [c.head].concat(c.alias || []).map(normHead);
          for (var k = 0; k < names.length && at[c.key] === undefined; k++) {
            var i = head.indexOf(names[k]);
            if (i !== -1 && !taken[i]) { at[c.key] = i; taken[i] = true; }
          }
        });
        PAYROLL_COLUMNS.forEach(function (c) {
          if (at[c.key] !== undefined || !c.second) return;
          var first = head.indexOf(normHead(c.second));
          var again = first === -1 ? -1 : head.indexOf(normHead(c.second), first + 1);
          if (again !== -1 && !taken[again]) { at[c.key] = again; taken[again] = true; }
        });
        var missing = PAYROLL_COLUMNS.filter(function (c) { return at[c.key] === undefined && c.key !== 'no'; })
          .map(function (c) { return c.head; });

        var title = '';
        for (var t = 0; t < hr; t++) title += ' ' + (grid[t] || []).filter(function (x) { return x !== null && x !== undefined; }).join(' ');
        var titled = readCutoff(title) || readCutoff(name);
        var cutoff = payout ? { payout: payout, titled: titled } : titled;

        var rows = [];
        for (var i = hr + 1; i < grid.length; i++) {
          var line = grid[i] || [];
          var id = line[at.id] === undefined || line[at.id] === null ? '' : String(line[at.id]).trim();
          var nm = at.name === undefined ? '' : String(line[at.name] || '').trim();
          if (!id && !nm) continue;
          if (/^total/i.test(id) || /^total/i.test(nm)) continue;
          var row = { line: i + 1, values: {} };
          PAYROLL_COLUMNS.forEach(function (c) {
            if (at[c.key] === undefined || c.key === 'no') return;
            var raw = line[at[c.key]];
            if (TEXT_KEYS[c.key]) { row[c.key] = raw === undefined || raw === null ? '' : String(raw).trim(); return; }
            var n = numberOf(raw);
            if (n === null) return;
            if (isNaN(n)) {
              warnings.push(name + ' row ' + (i + 1) + ' (' + (id || nm) + '): "' + raw + '" under ' +
                c.head + ' is not a number — ignored.');
              return;
            }
            row.values[c.key] = n;
          });
          head.forEach(function (h, ci) {
            if (taken[ci]) return;
            EXTRA_COLUMNS.forEach(function (x) {
              if (!x.test.test(h)) return;
              var n = numberOf(line[ci]);
              if (n === null || isNaN(n)) return;
              row.values[x.key] = Math.round(((row.values[x.key] || 0) + n) * 100) / 100;
            });
          });
          rows.push(row);
        }
        out.push({ sheet: name, title: title.trim(), cutoff: cutoff, rows: rows, missing: missing });
      });
      if (!out.length) {
        throw new Error('No sheet with an "EMPLOYEE ID" and a "NET PAY" header was found.');
      }
      return { sheets: out, warnings: warnings };
    });
  }

  /* The "Final Pay <name>" tabs beside a payroll register: one leaver's
     year, cutoff by cutoff, then a "Final Pay" row — what their final pay
     cutoff paid. The cutoff is the file's (its name or register title). */
  function finalPayDate(v) {
    var t = String(X.toYmd(v) || '').trim(), m;
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
    if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return ymd(+m[3], +m[1], +m[2]);
    if ((m = t.match(/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s*(\d{4})$/)) && monthOf(m[1])) return ymd(+m[3], monthOf(m[1]), +m[2]);
    return '';
  }
  function parseFinalPay(file) {
    return X.read(file).then(function (sheets) {
      var names = Object.keys(sheets);
      var register = names.filter(function (n) { return /payroll\s*register/i.test(n); })[0];
      var title = register ? (sheets[register] || []).slice(0, 4).map(function (r) {
        return (r || []).filter(function (x) { return x !== null && x !== undefined; }).join(' ');
      }).join(' ') : '';
      var cutoff = readCutoff(file && file.name) || readCutoff(title);
      var people = [], problems = [];
      names.filter(function (n) { return /final\s*pay/i.test(n); }).forEach(function (name) {
        var grid = sheets[name] || [];
        var hr = -1;
        for (var r = 0; r < Math.min(grid.length, 15); r++) {
          if ((grid[r] || []).some(function (c) { return normHead(c) === 'EMPLOYEE ID'; })) { hr = r; break; }
        }
        var row = grid.filter(function (r) { return r && /^final pay$/i.test(String(r[0] || '').trim()); })[0];
        if (hr < 0 || !row) { problems.push(name + ': no "Final Pay" row'); return; }
        var head = grid[hr].map(normHead), end = '';
        grid.slice(0, hr).forEach(function (r) {
          (r || []).forEach(function (c, i) { if (/^end date$/i.test(String(c || '').trim())) end = finalPayDate(r[i + 1]); });
        });
        var sum = function (re) {
          var t = 0;
          head.forEach(function (h, i) { if (re.test(h)) { var n = numberOf(row[i]); if (n && !isNaN(n)) t += n; } });
          return Math.round(t * 100) / 100;
        };
        people.push({
          sheet: name,
          id: String(row[head.indexOf('EMPLOYEE ID')] || '').trim(),
          name: String(row[head.indexOf('EMPLOYEE NAME')] || '').trim(),
          end: end,
          thirteenth: sum(/^13TH MONTH PAY( TAXABLE)?$/),
          taxRefund: sum(/^TAX REFUND$/),
          net: sum(/^NET PAY$/)
        });
      });
      return { cutoff: cutoff, people: people, problems: problems };
    });
  }

  global.PayrollTemplate = {
    parseFinalPay: parseFinalPay,
    toDate: finalPayDate,
    build: buildWorkbook,
    parse: parseWorkbook,
    readCutoff: readCutoff,
    payoutFromFileName: payoutFromFileName,
    cutoffTitle: cutoffTitle,
    COLUMNS: PAYROLL_COLUMNS
  };
})(window);

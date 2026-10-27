/* =========================================================================
   masterlist.js — exportable / importable employee masterlist

   Three sheets, all read back on import and all keyed by Employee ID:

     Employee Masterlist  one row per employee — the roster itself
     Recurring Items      HMO, allowances, loans-as-deductions, etc.
     Loans                amortising loans with their schedules

   Import rules, stated plainly because the whole thing is destructive:
   THE FILE REPLACES THE ROSTER. It is the source of truth, not a patch.
     - An unknown Employee ID creates that employee.
     - A known one is overwritten column by column, and a BLANK CELL CLEARS
       the field rather than leaving the old value in place.
     - Items and Loans come wholly from their sheets; an employee with no
       rows there ends up with none.
     - An employee ABSENT from the Masterlist sheet is DELETED, along with
       their items, loans and timesheet entries. The app asks for
       confirmation and names them before doing it.
     - Columns the sheet does not carry (salary adjustment and its
       effectivity date) are left alone — there is nothing here to replace
       them with.
   ========================================================================= */
(function (global) {
  'use strict';

  var X = global.XlsxWriter;
  var S = X.S;

  /* HR masterlist columns first, in the order HR keeps them, then the fields
     payroll cannot run without. Employee ID sits near the end rather than the
     front because the HR layout leads with names, but it is still the import
     key — see the note rows written above the header. */
  var EMP_HEAD = [
    'First Name', 'Middle Name', 'Last Name', 'Preferred Name', 'Country/Region',
    'Subdepartment', 'Department', 'Direct Managers', 'Current Role',
    'Portraits Drive Link', 'Hubspot Link', 'R&R', 'Performance Sheet', 'Contract(s)',
    'Date of birth', 'Email', 'Start Date', 'End Date', 'Phone', 'Present Address',
    'Nationality', 'LinkedIn Bio', 'Skype', 'Discord', 'Regularization Date',
    'Referred By', 'Referral Paid', 'HR Lead Status', 'Gender', 'Current Salary',
    'Currency',
    'SSS No.', 'PhilHealth No.', 'HDMF No.', 'TIN',
    'Employee ID', 'Classification', 'Leave Credits (days)', 'SSS Exempt'
  ];

  var EMP_COLS = [16, 16, 18, 16, 16, 18, 18, 22, 26, 24, 24, 14, 22, 20, 14, 30, 13, 13,
    18, 34, 14, 24, 16, 16, 19, 18, 13, 16, 10, 14, 10, 16, 18, 17, 17, 13, 16, 18, 12];

  var ITEM_HEAD = ['Employee ID', 'Label', 'Type', 'Applies To', 'Amount'];
  var LOAN_HEAD = ['Employee ID', 'Loan Type', 'Reference', 'Principal',
    'Amount Per Payout', 'Start Date', 'Deducted On'];

  var ITEM_KIND_OUT = {
    deduction: 'Deduction',
    allowance_tax: 'Allowance - taxable',
    allowance_nontax: 'Allowance - non-taxable',
    employer_cost: 'Company-paid cost'
  };
  var LOAN_TYPE_OUT = { sss: 'SSS salary loan', pagibig: 'HDMF / MPL', company: 'Company loan' };

  function freqOut(f) {
    if (f === 'first') f = 2;
    else if (f === 'second') f = 1;
    if (f === 1 || f === '1') return 'Pay period 1 - paid the 10th';
    if (f === 2 || f === '2') return 'Pay period 2 - paid the 25th';
    return 'Every payout';
  }
  function schedOut(s) {
    if (String(s) === '1') return 'Pay period 1 - paid the 10th';
    if (String(s) === '2') return 'Pay period 2 - paid the 25th';
    return 'Both payouts';
  }

  /* --------------------------- lenient parsing --------------------------- */
  function txt(v) {
    if (v === undefined || v === null) return null;
    var s = String(v).trim();
    return s === '' ? null : s;
  }
  function numOf(v) {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'number') return v;
    var n = parseFloat(String(v).replace(/[,\s₱]/g, ''));
    return isFinite(n) ? n : null;
  }
  function freqIn(v) {
    var s = (txt(v) || '').toLowerCase();
    if (!s) return null;
    if (s.indexOf('every') !== -1 || s.indexOf('both') !== -1) return 'every';
    if (s.indexOf('1') !== -1 || s.indexOf('10th') !== -1) return 1;
    if (s.indexOf('2') !== -1 || s.indexOf('25th') !== -1) return 2;
    return null;
  }
  function schedIn(v) {
    var s = (txt(v) || '').toLowerCase();
    if (!s) return null;
    if (s.indexOf('both') !== -1 || s.indexOf('split') !== -1) return 'split';
    if (s.indexOf('1') !== -1 || s.indexOf('10th') !== -1) return 1;
    if (s.indexOf('2') !== -1 || s.indexOf('25th') !== -1) return 2;
    return null;
  }
  function kindIn(v) {
    var s = (txt(v) || '').toLowerCase();
    if (!s) return null;
    if (s.indexOf('company') !== -1 || s.indexOf('employer') !== -1) return 'employer_cost';
    if (s.indexOf('non-tax') !== -1 || s.indexOf('nontax') !== -1 || s.indexOf('non tax') !== -1) return 'allowance_nontax';
    if (s.indexOf('allowance') !== -1) return 'allowance_tax';
    if (s.indexOf('deduct') !== -1) return 'deduction';
    return null;
  }
  function loanTypeIn(v) {
    var s = (txt(v) || '').toLowerCase();
    if (!s) return null;
    if (s.indexOf('sss') !== -1) return 'sss';
    if (s.indexOf('pag') !== -1 || s.indexOf('mpl') !== -1 || s.indexOf('hdmf') !== -1) return 'pagibig';
    if (s.indexOf('company') !== -1) return 'company';
    return null;
  }
  function yesNo(v) {
    var s = (txt(v) || '').toLowerCase();
    if (!s) return null;
    return (s === 'yes' || s === 'y' || s === 'true' || s === '1');
  }

  /* ------------------------------- BUILD ------------------------------- */
  function tagged(headings, manualAll) {
    return [
      headings.map(function () {
        return { v: manualAll ? 'MANUAL' : 'MANUAL', t: 's', s: S.HEAD_INPUT };
      }),
      headings.map(function (h) { return { v: h, t: 's', s: S.HEAD }; })
    ];
  }

  function build(employees, settings) {
    /* ---- sheet 1: the roster ---- */
    var rows = [
      [{ v: 'EMPLOYEE MASTERLIST', t: 's', s: S.TITLE }],
      [{ v: settings.company.name, t: 's', s: S.BOLD }],
      [{ v: 'THIS FILE REPLACES THE ROSTER ON IMPORT. Employee ID is the key and sits after ' +
        'TIN. An ID not already in the system creates that employee; a blank cell CLEARS the ' +
        'field; and anyone missing from this sheet is DELETED with their items, loans and ' +
        'timesheets. Export a fresh copy and edit that — never a filtered extract.',
        t: 's', s: S.NOTE }],
      [{ v: X.unhideHint(3, [4, 5]), t: 's', s: S.NOTE }],
      [{ v: 'Classification must read "Manager" or "Rank and file" — it decides who is exempt ' +
        'from overtime, night differential and holiday premium. Dates are YYYY-MM-DD. ' +
        'SSS Exempt takes Yes or No. Current Salary is the monthly rate.', t: 's', s: S.NOTE }],
      [{ v: 'HR Lead Status takes Hired, Resigned or Offboarded. Age is no longer a column — ' +
        'it is derived from Date of birth wherever one is on file.', t: 's', s: S.NOTE }],
      []
    ];
    tagged(EMP_HEAD).forEach(function (r) { rows.push(r); });

    employees.forEach(function (emp) {
      var s = function (v) { return { v: v || '', t: 's' }; };
      rows.push([
        s(emp.firstName), s(emp.middleName), s(emp.lastName), s(emp.preferredName),
        s(emp.countryRegion), s(emp.subdepartment), s(emp.department), s(emp.directManagers),
        s(emp.position),                        // "Current Role" is the position field
        s(emp.portraitsLink), s(emp.hubspotLink), s(emp.rr), s(emp.performanceSheet),
        s(emp.contracts),
        s(emp.birthDate), s(emp.email), s(emp.dateHired),   // Start Date is dateHired
        s(emp.endDate), s(emp.phone), s(emp.presentAddress), s(emp.nationality),
        s(emp.linkedin), s(emp.skype), s(emp.discord), s(emp.regularizationDate),
        s(emp.referredBy), s(emp.referralPaid), s(emp.hrLeadStatus), s(emp.gender),
        { v: emp.monthlyRate, t: 'n', s: S.NUM },           // Current Salary
        s(emp.currency || 'PHP'),
        s(emp.sssNo), s(emp.philhealthNo), s(emp.pagibigNo), s(emp.tin),
        s(emp.id),
        { v: emp.employmentClass === 'manager' ? 'Manager' : 'Rank and file', t: 's' },
        { v: emp.leaveCredits === undefined || emp.leaveCredits === null
             ? settings.leave.annualCredits : emp.leaveCredits, t: 'n', s: S.INT },
        { v: emp.sssExempt ? 'Yes' : 'No', t: 's' }
      ]);
    });

    var empSheet = {
      name: 'Employee Masterlist',
      cols: EMP_COLS,
      // Rows 4 and 5 are the descriptive legends and ship hidden, with the
      // pointer to them on row 3. Row 2 — the one saying this file REPLACES the
      // roster and deletes anyone missing — deliberately stays visible; it is a
      // warning, not a note.
      rows: rows, rowHeights: { 7: 18, 8: 30 }, hiddenRows: [4, 5], freeze: { x: 3, y: 9 }
    };

    /* ---- sheet 2: recurring items ---- */
    var irows = [
      [{ v: 'RECURRING ITEMS', t: 's', s: S.TITLE }],
      [{ v: 'HMO shares, allowances, standing deductions and company-paid costs. On import ' +
        'these REPLACE the items of every employee listed on the Masterlist sheet, so deleting ' +
        'a row here removes that item.', t: 's', s: S.NOTE }],
      [{ v: X.unhideHint(2, [3]), t: 's', s: S.NOTE }],
      [{ v: 'Type: Deduction | Allowance - taxable | Allowance - non-taxable | Company-paid cost',
        t: 's', s: S.NOTE }],
      []
    ];
    tagged(ITEM_HEAD).forEach(function (r) { irows.push(r); });
    employees.forEach(function (emp) {
      (emp.items || []).forEach(function (it) {
        irows.push([
          { v: emp.id, t: 's' },
          { v: it.label || '', t: 's' },
          { v: ITEM_KIND_OUT[it.kind] || 'Deduction', t: 's' },
          { v: freqOut(it.frequency), t: 's' },
          { v: Number(it.amount) || 0, t: 'n', s: S.NUM }
        ]);
      });
    });
    var itemSheet = { name: 'Recurring Items', cols: [13, 34, 26, 30, 13],
      rows: irows, rowHeights: { 5: 18, 6: 30 }, hiddenRows: [3], freeze: { y: 7 } };

    /* ---- sheet 3: loans ---- */
    var lrows = [
      [{ v: 'LOANS', t: 's', s: S.TITLE }],
      [{ v: 'Amortising loans. Same replace-on-import rule as Recurring Items. A loan stops ' +
        'automatically once the principal is fully paid.', t: 's', s: S.NOTE }],
      [{ v: X.unhideHint(2, [3]), t: 's', s: S.NOTE }],
      [{ v: 'Loan Type: SSS salary loan | HDMF / MPL | Company loan', t: 's', s: S.NOTE }],
      []
    ];
    tagged(LOAN_HEAD).forEach(function (r) { lrows.push(r); });
    employees.forEach(function (emp) {
      (emp.loans || []).forEach(function (l) {
        lrows.push([
          { v: emp.id, t: 's' },
          { v: LOAN_TYPE_OUT[l.type] || 'Company loan', t: 's' },
          { v: l.reference || '', t: 's' },
          { v: Number(l.principal) || 0, t: 'n', s: S.NUM },
          { v: Number(l.amortization) || 0, t: 'n', s: S.NUM },
          { v: l.startDate || '', t: 's' },
          { v: schedOut(l.schedule), t: 's' }
        ]);
      });
    });
    var loanSheet = { name: 'Loans', cols: [13, 22, 20, 14, 17, 14, 30],
      rows: lrows, rowHeights: { 5: 18, 6: 30 }, hiddenRows: [3], freeze: { y: 7 } };

    return X.build([empSheet, itemSheet, loanSheet]);
  }

  /* ------------------------------- PARSE ------------------------------- */
  function findHeader(grid, marker) {
    for (var r = 0; r < grid.length; r++) {
      if (grid[r] && txt(grid[r][0]) === marker) return r;
    }
    return -1;
  }

  function parse(file) {
    return X.read(file).then(function (sheets) {
      var grid = sheets['Employee Masterlist'];
      if (!grid) {
        throw new Error('No "Employee Masterlist" sheet in that file. Export a fresh masterlist ' +
          'and edit that.');
      }

      var warnings = [];
      // findHeader matches on column A, which now leads with First Name.
      var hr = findHeader(grid, 'First Name');
      if (hr < 0) throw new Error('Could not find the header row on the Masterlist sheet.');

      var head = grid[hr].map(function (h) { return txt(h) || ''; });
      var at = {};
      // Headers that were renamed, so files exported before the change still read.
      var LEGACY_HEAD = { 'HDMF No.': ['Pag-IBIG No.'] };
      EMP_HEAD.forEach(function (h) {
        var i = head.indexOf(h);
        if (i === -1) {
          (LEGACY_HEAD[h] || []).forEach(function (old) {
            if (i === -1) i = head.indexOf(old);
          });
        }
        if (i === -1) warnings.push('Masterlist column "' + h + '" was not found — skipped.');
        at[h] = i;
      });

      var employees = [], seen = {}, needIds = 0;
      for (var r = hr + 1; r < grid.length; r++) {
        var row = grid[r] || [];
        var id = at['Employee ID'] === -1 ? null : txt(row[at['Employee ID']]);
        if (id && id.toUpperCase() === 'TOTAL') continue;

        /* A row pasted in from an HR sheet usually has no Employee ID. Keep it
           as long as it names somebody — the app assigns an ID — and skip only
           rows that are genuinely empty. Dropping named rows silently is how a
           105-row file reads as zero. */
        var hasName = !!(txt(row[at['First Name']]) || txt(row[at['Last Name']]));
        if (!id && !hasName) continue;

        if (id) {
          if (seen[id]) {
            warnings.push('Employee ID ' + id + ' appears more than once — the last row wins.');
          }
          seen[id] = true;
        } else {
          needIds++;
        }

        var cls = txt(row[at.Classification]);
        var employmentClass = null;
        if (cls) {
          var c = cls.toLowerCase();
          if (c.indexOf('manager') !== -1) employmentClass = 'manager';
          else if (c.indexOf('rank') !== -1 || c.indexOf('file') !== -1) employmentClass = 'rank_file';
          else warnings.push('Row ' + (r + 1) + ' (' + id + '): classification "' + cls +
            '" not understood — left unchanged.');
        }

        employees.push({
          id: id,
          firstName: txt(row[at['First Name']]),
          middleName: txt(row[at['Middle Name']]),
          lastName: txt(row[at['Last Name']]),
          preferredName: txt(row[at['Preferred Name']]),
          countryRegion: txt(row[at['Country/Region']]),
          subdepartment: txt(row[at.Subdepartment]),
          department: txt(row[at.Department]),
          directManagers: txt(row[at['Direct Managers']]),
          position: txt(row[at['Current Role']]),
          portraitsLink: txt(row[at['Portraits Drive Link']]),
          hubspotLink: txt(row[at['Hubspot Link']]),
          rr: txt(row[at['R&R']]),
          performanceSheet: txt(row[at['Performance Sheet']]),
          contracts: txt(row[at['Contract(s)']]),
          birthDate: X.toYmd(txt(row[at['Date of birth']])),
          email: txt(row[at.Email]),
          dateHired: X.toYmd(txt(row[at['Start Date']])),
          endDate: X.toYmd(txt(row[at['End Date']])),
          phone: txt(row[at.Phone]),
          presentAddress: txt(row[at['Present Address']]),
          nationality: txt(row[at.Nationality]),
          linkedin: txt(row[at['LinkedIn Bio']]),
          skype: txt(row[at.Skype]),
          discord: txt(row[at.Discord]),
          regularizationDate: X.toYmd(txt(row[at['Regularization Date']])),
          referredBy: txt(row[at['Referred By']]),
          referralPaid: txt(row[at['Referral Paid']]),
          hrLeadStatus: txt(row[at['HR Lead Status']]),
          gender: txt(row[at.Gender]),
          monthlyRate: numOf(row[at['Current Salary']]),
          currency: txt(row[at.Currency]),
          sssNo: txt(row[at['SSS No.']]),
          philhealthNo: txt(row[at['PhilHealth No.']]),
          pagibigNo: txt(row[at['HDMF No.']]),
          tin: txt(row[at.TIN]),
          employmentClass: employmentClass,
          leaveCredits: numOf(row[at['Leave Credits (days)']]),
          sssExempt: yesNo(row[at['SSS Exempt']])
        });
      }

      /* ---- items ---- */
      var items = null;
      var ig = sheets['Recurring Items'];
      if (ig) {
        var ihr = findHeader(ig, 'Employee ID');
        if (ihr < 0) warnings.push('The Recurring Items sheet has no header row — it was ignored.');
        else {
          items = {};
          var ihead = ig[ihr].map(function (h) { return txt(h) || ''; });
          var ii = {}; ITEM_HEAD.forEach(function (h) { ii[h] = ihead.indexOf(h); });
          for (var a = ihr + 1; a < ig.length; a++) {
            var irow = ig[a] || [];
            var iid = txt(irow[ii['Employee ID']]);
            if (!iid) continue;
            var label = txt(irow[ii.Label]);
            var amount = numOf(irow[ii.Amount]);
            if (!label || amount === null) {
              warnings.push('Recurring Items row ' + (a + 1) + ' (' + iid +
                '): needs both a Label and an Amount — skipped.');
              continue;
            }
            (items[iid] = items[iid] || []).push({
              label: label,
              kind: kindIn(irow[ii.Type]) || 'deduction',
              frequency: freqIn(irow[ii['Applies To']]) || 'every',
              amount: amount
            });
          }
        }
      }

      /* ---- loans ---- */
      var loans = null;
      var lg = sheets.Loans;
      if (lg) {
        var lhr = findHeader(lg, 'Employee ID');
        if (lhr < 0) warnings.push('The Loans sheet has no header row — it was ignored.');
        else {
          loans = {};
          var lhead = lg[lhr].map(function (h) { return txt(h) || ''; });
          var li = {}; LOAN_HEAD.forEach(function (h) { li[h] = lhead.indexOf(h); });
          for (var b = lhr + 1; b < lg.length; b++) {
            var lrow = lg[b] || [];
            var lid = txt(lrow[li['Employee ID']]);
            if (!lid) continue;
            var principal = numOf(lrow[li.Principal]);
            var amort = numOf(lrow[li['Amount Per Payout']]);
            var start = X.toYmd(txt(lrow[li['Start Date']]));
            if (principal === null || amort === null || !start) {
              warnings.push('Loans row ' + (b + 1) + ' (' + lid +
                '): needs Principal, Amount Per Payout and Start Date — skipped.');
              continue;
            }
            if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
              var d = new Date(start);
              if (isNaN(d.getTime())) {
                warnings.push('Loans row ' + (b + 1) + ' (' + lid + '): start date "' + start +
                  '" is not a date — skipped.');
                continue;
              }
              start = global.PayrollEngine.ymd(d);
            }
            (loans[lid] = loans[lid] || []).push({
              type: loanTypeIn(lrow[li['Loan Type']]) || 'company',
              reference: txt(lrow[li.Reference]) || '',
              principal: principal,
              amortization: amort,
              startDate: start,
              schedule: schedIn(lrow[li['Deducted On']]) || 2
            });
          }
        }
      }

      if (needIds) {
        warnings.push(needIds + ' row(s) had no Employee ID — a new ID was assigned to each. ' +
          'Export a fresh masterlist afterwards so the IDs are on file.');
      }
      return { employees: employees, items: items, loans: loans, warnings: warnings };
    });
  }

  global.PayrollMasterlist = { build: build, parse: parse };
})(window);

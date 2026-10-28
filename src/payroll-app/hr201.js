/* =========================================================================
   hr201.js — the HR system's "201 File Payroll" export, and salaries

   201 FILE
   The export has a few report lines (title, generated on, filter) above a
   header row that starts with "System ID". Columns are found by heading, so
   a reordered export still reads.

   It is the source of truth for who people are — names, emails, phones,
   start and last day, company, department, position, bank, TIN, SSS,
   PhilHealth, HDMF — and nothing else. Importing it:
     - matches each row to the roster by System ID, then Employee ID, then
       name, so an employee whose ID changes in HR is still the same person;
     - adds anyone new;
     - overwrites the fields the file carries (a blank cell clears it, so a
       rehire whose last day was removed in HR comes back);
     - NEVER deletes anybody, and never touches rates, classification,
       recurring items, loans, leave or timesheets. Someone with a last day
       of work simply drops out of payroll runs after that date.

   SALARIES
   The 201 file carries no pay, so rates come from a second, small workbook:
   Employee ID, Monthly Rate, and optionally Classification. "Download
   salary sheet" writes one pre-filled with the roster to edit and import.
   ========================================================================= */
(function (global) {
  'use strict';

  var X = global.XlsxWriter;
  var S = X.S;

  /* Site field <- 201 heading. */
  var COLUMNS = {
    systemId: 'System ID',
    firstName: 'First name',
    middleName: 'Middle name',
    lastName: 'Last name',
    preferredName: 'Preferred name',
    fullLegalName: 'Full legal name',
    hrEmployeeId: 'Employee ID',
    email: 'Email (Work)',
    personalEmail: 'Email (Personal)',
    workPhone: 'Phone (Work)',
    phone: 'Phone (Personal)',
    dateHired: 'Start date',
    endDate: 'Last day of work',
    effectiveDate: 'Effective Date',
    company: 'Company',
    department: 'Department',
    position: 'Position',
    bankCountry: 'Bank country',
    bankName: 'Bank name',
    bankCode: 'Bank code',
    bankBranchCode: 'Bank branch code',
    swiftCode: 'Swift code',
    bankAccountNo: 'Bank account number',
    bankAccountName: 'Bank account holder name',
    tin: 'Tax Identification Number (TIN)',
    sssNo: 'SSS Number',
    philhealthNo: 'PhilHealth Number',
    pagibigNo: 'HDMF (Pag-Ibig) Number'
  };
  var DATE_FIELDS = { dateHired: 1, endDate: 1, effectiveDate: 1 };

  /* The fields an import writes. Everything else on an employee is the
     site's own and survives every re-import. */
  var FIELDS = Object.keys(COLUMNS);

  var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

  function txt(v) {
    if (v === undefined || v === null) return null;
    var s = String(v).trim();
    return s === '' ? null : s;
  }
  function norm(h) { return String(h || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* The export writes days first — "23/10/2026 03:25:51 PM" — so a slashed
     date is read as DD/MM/YYYY. Excel serials and ISO dates pass through
     toYmd; "23 Oct 2026" and "Oct 23, 2026" are read by month name. Anything
     else is returned as null with a warning rather than stored as junk. */
  function dateOf(v) {
    var s = txt(v);
    if (!s) return null;
    var ymd = X.toYmd(s);
    if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
    var m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
    if (m) return valid(+m[3], +m[2], +m[1]);
    m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-],?\s*(\d{4})/);
    if (m && MONTHS[m[2].toLowerCase()]) return valid(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    m = s.match(/^([A-Za-z]{3})[A-Za-z]*\s+(\d{1,2}),?\s+(\d{4})/);
    if (m && MONTHS[m[1].toLowerCase()]) return valid(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    m = s.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
    if (m) return valid(+m[1], +m[2], +m[3]);
    return undefined;
  }
  function valid(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1) return undefined;
    return y + '-' + pad(mo) + '-' + pad(d);
  }

  /** First sheet with a row whose column A reads "System ID". */
  function findSheet(sheets) {
    var names = Object.keys(sheets);
    for (var i = 0; i < names.length; i++) {
      var grid = sheets[names[i]] || [];
      for (var r = 0; r < Math.min(grid.length, 40); r++) {
        if (grid[r] && norm(grid[r][0]) === 'system id') return { grid: grid, header: r };
      }
    }
    return null;
  }

  function parse201(file) {
    return X.read(file).then(function (sheets) {
      var found = findSheet(sheets);
      if (!found) {
        throw new Error('This does not look like a 201 File export: no header row starting ' +
          'with "System ID" was found.');
      }
      var grid = found.grid, hr = found.header;
      var head = grid[hr].map(norm);
      var at = {}, warnings = [];
      FIELDS.forEach(function (f) {
        at[f] = head.indexOf(norm(COLUMNS[f]));
        if (at[f] === -1) warnings.push('Column "' + COLUMNS[f] + '" was not in the file — that field was left as it was.');
      });

      var rows = [];
      for (var r = hr + 1; r < grid.length; r++) {
        var line = grid[r] || [];
        var row = { present: {} };
        FIELDS.forEach(function (f) {
          if (at[f] === -1) return;
          row.present[f] = true;
          var raw = line[at[f]];
          if (DATE_FIELDS[f]) {
            var d = dateOf(raw);
            if (d === undefined) {
              warnings.push('Row ' + (r + 1) + ': ' + COLUMNS[f] + ' "' + txt(raw) + '" is not a date — left blank.');
              d = null;
            }
            row[f] = d;
          } else {
            row[f] = txt(raw);
          }
        });
        // BPI accounts are 10 digits; one saved as a number in the sheet has
        // lost its leading 0.
        if (/\bbpi\b|philippine island/i.test(row.bankName || '') && /^\d{9}$/.test(row.bankAccountNo || '')) {
          row.bankAccountNo = '0' + row.bankAccountNo;
        }
        // A row needs a name or an ID to be anybody.
        if (!row.systemId && !row.hrEmployeeId && !row.firstName && !row.lastName) continue;
        row.line = r + 1;
        rows.push(row);
      }
      return { rows: rows, warnings: warnings };
    });
  }

  function nameKey(e) {
    return String((e.lastName || '') + '|' + (e.firstName || '')).trim().toLowerCase();
  }

  /**
   * Works out what an import would do, without doing it, so the counts can
   * be shown before anything changes. `companies` limits it to those
   * companies; null means every row.
   */
  function plan(parsed, employees, companies) {
    var bySys = {}, byId = {}, byName = {};
    employees.forEach(function (e) {
      if (e.systemId) bySys[String(e.systemId)] = e;
      byId[e.id] = e;
      byName[nameKey(e)] = e;
    });
    var used = {};
    employees.forEach(function (e) { used[e.id] = true; });

    var out = { create: [], update: [], skipped: [], claimed: {} };
    parsed.rows.forEach(function (row) {
      if (companies && !companies[row.company || '']) { out.skipped.push(row); return; }
      var emp = (row.systemId && bySys[row.systemId]) ||
        (row.hrEmployeeId && byId[row.hrEmployeeId]) ||
        byName[nameKey(row)] || null;
      // Two rows landing on one person: the second becomes its own employee.
      if (emp && out.claimed[emp.id]) emp = null;
      if (emp) {
        out.claimed[emp.id] = true;
        out.update.push({ row: row, emp: emp });
        return;
      }
      var id = row.hrEmployeeId || row.systemId;
      if (!id || used[id]) {
        var base = id || 'EMP', n = 1;
        do { id = base + '-' + (++n); } while (used[id]);
      }
      used[id] = true;
      out.create.push({ row: row, id: id });
    });
    return out;
  }

  /** Applies a plan to the roster in place. Returns what changed. */
  function apply(p, employees) {
    var changed = [];
    p.update.forEach(function (u) {
      var diff = [];
      FIELDS.forEach(function (f) {
        if (!u.row.present[f]) return;
        var was = u.emp[f] || '', now = u.row[f] || '';
        if (String(was) !== String(now)) diff.push(f);
        u.emp[f] = now;
      });
      if (diff.length) changed.push({ emp: u.emp, fields: diff });
    });
    var created = p.create.map(function (c) {
      var emp = { id: c.id, employmentClass: 'rank_file', monthlyRate: 0, items: [], loans: [] };
      FIELDS.forEach(function (f) { if (c.row.present[f]) emp[f] = c.row[f] || ''; });
      employees.push(emp);
      return emp;
    });
    return { created: created, changed: changed };
  }

  /* ------------------------------ salaries ------------------------------ */
  var SAL_HEAD = ['Employee ID', 'Last Name', 'First Name', 'Company', 'Position',
    'Monthly Rate', 'Classification'];

  function buildSalarySheet(employees) {
    var rows = [[{ v: 'Salaries', t: 's', s: S.TITLE }],
      [{ v: 'Fill in Monthly Rate (and Classification: Rank and file or Manager) and import it ' +
        'on the Employees tab. Only Employee ID, Monthly Rate and Classification are read; ' +
        'a blank rate leaves the current one.', t: 's', s: S.NOTE }]];
    rows.push(SAL_HEAD.map(function (h, i) {
      return { v: h, t: 's', s: i >= 5 ? S.HEAD_INPUT : S.HEAD };
    }));
    employees.forEach(function (emp) {
      rows.push([
        { v: emp.id, t: 's' }, { v: emp.lastName || '', t: 's' }, { v: emp.firstName || '', t: 's' },
        { v: emp.company || '', t: 's' }, { v: emp.position || '', t: 's' },
        emp.monthlyRate ? { v: emp.monthlyRate, t: 'n', s: S.INPUT } : { v: '', t: 's', s: S.INPUT },
        { v: emp.employmentClass === 'manager' ? 'Manager' : 'Rank and file', t: 's', s: S.INPUT }
      ]);
    });
    return X.build([{ name: 'Salaries', cols: [14, 18, 18, 26, 28, 14, 16], rows: rows, freeze: { x: 3, y: 3 } }]);
  }

  function amountOf(v) {
    var s = txt(v);
    if (!s) return null;
    var n = parseFloat(s.replace(/[,\s₱]|PHP/gi, ''));
    return isFinite(n) ? n : NaN;
  }

  /* Reads any sheet with an "Employee ID" heading and a rate heading
     ("Monthly Rate", "Monthly Salary", "Salary", "Basic"…). */
  function parseSalaries(file) {
    return X.read(file).then(function (sheets) {
      var names = Object.keys(sheets);
      for (var i = 0; i < names.length; i++) {
        var grid = sheets[names[i]] || [];
        for (var r = 0; r < Math.min(grid.length, 40); r++) {
          var head = (grid[r] || []).map(norm);
          var idCol = head.indexOf('employee id');
          var rateCol = -1;
          head.forEach(function (h, c) {
            if (rateCol === -1 && /monthly rate|monthly salary|basic|^salary$|^rate$|current salary/.test(h)) rateCol = c;
          });
          if (idCol === -1 || rateCol === -1) continue;
          var clsCol = head.indexOf('classification');
          var rows = [], warnings = [];
          for (var k = r + 1; k < grid.length; k++) {
            var line = grid[k] || [];
            var id = txt(line[idCol]);
            if (!id) continue;
            var rate = amountOf(line[rateCol]);
            if (rate !== null && (isNaN(rate) || rate < 0)) {
              warnings.push('Row ' + (k + 1) + ' (' + id + '): rate "' + txt(line[rateCol]) + '" is not an amount — skipped.');
              rate = null;
            }
            var cls = clsCol === -1 ? null : (txt(line[clsCol]) || '').toLowerCase();
            rows.push({
              id: id, rate: rate, line: k + 1,
              employmentClass: !cls ? null : cls.indexOf('manager') !== -1 ? 'manager'
                : (cls.indexOf('rank') !== -1 || cls.indexOf('file') !== -1) ? 'rank_file' : null
            });
          }
          return { rows: rows, warnings: warnings };
        }
      }
      throw new Error('No sheet with an "Employee ID" column and a "Monthly Rate" column was found. ' +
        'Download the salary sheet from this page and fill that in.');
    });
  }

  global.PayrollHr201 = {
    COLUMNS: COLUMNS,
    parse201: parse201,
    plan: plan,
    apply: apply,
    buildSalarySheet: buildSalarySheet,
    parseSalaries: parseSalaries,
    dateOf: dateOf
  };
})(window);

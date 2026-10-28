/* =========================================================================
   data.js — seed data, defaults, and persistence
   Philippine semi-monthly payroll (payout every 10th and 25th)
   ========================================================================= */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------------
     DEFAULT SETTINGS
     All statutory rates are editable in the Settings tab so you can update
     them when SSS / PhilHealth / HDMF issue new circulars.
     --------------------------------------------------------------------- */
  var DEFAULT_SETTINGS = {
    company: {
      name: 'Trinity Outsourcing Solutions Inc.',
      address: 'Unit 1203, Ortigas Center, Pasig City, Metro Manila',
      tin: '000-000-000-00000',
      branch: 'Philippines'      // shown on the payslip
    },

    // Wise bulk payments for Non-Trinity payslips: the currency paid from,
    // and each person's Wise recipient, remembered from a Wise CSV by email.
    wise: {
      sourceCurrency: 'USD',
      recipients: {},            // email → { id, name, detail, type, initials }
      splits: {}                 // email → [{ id, name, detail, type, currency, part }], pay over several accounts
    },

    // Work schedule: Mon-Fri, 10:00AM - 7:00PM (1 hour unpaid meal break)
    schedule: {
      shiftStart: '10:00',
      shiftEnd: '19:00',
      breakHours: 1,
      hoursPerDay: 8,
      otStart: '19:00',      // OT accrues after the 8-hour shift ends (7:00PM)
      ndStart: '22:00',      // night differential window (Labor Code): 10PM-6AM
      ndEnd: '06:00',
      workDays: [1, 2, 3, 4, 5] // Mon=1 ... Fri=5
    },

    // Monthly rate -> daily rate divisor.
    // 261 = Mon-Fri working days in a year (regular holidays paid).
    dayFactor: 261,

    // Premium multipliers — from the "Payroll" tab of Payroll Process.xlsx
    premium: {
      ot: 1.25,                       // regular workday OT: hourly x 125%
      otRestDaySpecial: 1.69,         // rest day / special non-working: 130% x 130%
      otRegHoliday: 2.60,             // regular holiday OT: 200% x 130%
      nd: 0.10,                       // night differential: hourly x 10% x ND hours
      restDay: 1.30,                  // rest day work, first 8 hrs
      regHolidayWorkedExtra: 1.00,    // ADDITIONAL 100% of daily rate (200% total)
      specialHolidayWorkedExtra: 0.30 // ADDITIONAL 30% of daily rate (130% total)
    },

    // De minimis benefits — standard amount applied when the cell is left
    // blank. Enter an explicit 0 to give someone none.
    defaultDeMinimis: 1500,

    // Paid time off. PTO days are PAID, so unlike absences they carry no
    // deduction; they draw down the employee's credits instead.
    leave: {
      annualCredits: 15,        // default when an employee has none set
      allowNegative: false,     // warn once credits are exhausted

      // Monetization: unused credits an employee may convert to cash at
      // year-end. Longer-tenured staff — hired before monetizeCutoffYear —
      // may convert more. The cap is a ceiling on UNUSED days, so someone
      // with 3 days left monetizes 3, not the full cap. An employee with no
      // dateHired on file falls to the lower cap.
      monetizeCutoffYear: 2023,
      monetizeMaxDaysTenured: 10,   // hired before the cutoff year
      monetizeMaxDaysRegular: 5     // hired in the cutoff year or later
    },

    // Year-end: 13th month pay and the annualised tax adjustment.
    yearEnd: {
      // 13th month = total basic salary earned in the year / 12.
      thirteenthMonthDivisor: 12,
      // Tax-exempt ceiling for 13th month + other benefits (NIRC as amended).
      thirteenthMonthExemption: 90000,
      // Year-end non-taxable bonus paid with the 13th month — full for a
      // full year, pro rata by months worked otherwise. Outside the ceiling.
      yearEndBonus: 3000,
      // Payout these are posted on. '' = do not post, just report.
      thirteenthMonthPeriodId: '',
      taxRefundPeriodId: ''
    },

    // BIR annual income tax table (TRAIN), used for the year-end annualisation.
    annualTaxTable: [
      { min: 0,       base: 0,         rate: 0.00, excessOver: 0 },
      { min: 250000,  base: 0,         rate: 0.15, excessOver: 250000 },
      { min: 400000,  base: 22500,     rate: 0.20, excessOver: 400000 },
      { min: 800000,  base: 102500,    rate: 0.25, excessOver: 800000 },
      { min: 2000000, base: 402500,    rate: 0.30, excessOver: 2000000 },
      { min: 8000000, base: 2202500,   rate: 0.35, excessOver: 8000000 }
    ],

    // SSS — real 2026 schedule. Employee share = Regular EE + MPF EE.
    sss: {
      useTable: true,
  // SSS Contribution Table for 2026 (SSS Circular 2024-006), transcribed
  // directly from the 'SSS Table' tab of Payroll Process.xlsx.
  // [from, to, erRegular, eeRegular, erMPF, eeMPF, ec]
  sssTable: [
    [0, 5249, 500, 250, 0, 0, 10],
    [5250, 5749.99, 550, 275, 0, 0, 10],
    [5750, 6249.99, 600, 300, 0, 0, 10],
    [6250, 6749.99, 650, 325, 0, 0, 10],
    [6750, 7249.99, 700, 350, 0, 0, 10],
    [7250, 7749.99, 750, 375, 0, 0, 10],
    [7750, 8249.99, 800, 400, 0, 0, 10],
    [8250, 8749.99, 850, 425, 0, 0, 10],
    [8750, 9249.99, 900, 450, 0, 0, 10],
    [9250, 9749.99, 950, 475, 0, 0, 10],
    [9750, 10249.99, 1000, 500, 0, 0, 10],
    [10250, 10749.99, 1050, 525, 0, 0, 10],
    [10750, 11249.99, 1100, 550, 0, 0, 10],
    [11250, 11749.99, 1150, 575, 0, 0, 10],
    [11750, 12249.99, 1200, 600, 0, 0, 10],
    [12250, 12749.99, 1250, 625, 0, 0, 10],
    [12750, 13249.99, 1300, 650, 0, 0, 10],
    [13250, 13749.99, 1350, 675, 0, 0, 10],
    [13750, 14249.99, 1400, 700, 0, 0, 10],
    [14250, 14749.99, 1450, 725, 0, 0, 10],
    [14750, 15249.99, 1500, 750, 0, 0, 30],
    [15250, 15749.99, 1550, 775, 0, 0, 30],
    [15750, 16249.99, 1600, 800, 0, 0, 30],
    [16250, 16749.99, 1650, 825, 0, 0, 30],
    [16750, 17249.99, 1700, 850, 0, 0, 30],
    [17250, 17749.99, 1750, 875, 0, 0, 30],
    [17750, 18249.99, 1800, 900, 0, 0, 30],
    [18250, 18749.99, 1850, 925, 0, 0, 30],
    [18750, 19249.99, 1900, 950, 0, 0, 30],
    [19250, 19749.99, 1950, 975, 0, 0, 30],
    [19750, 20249.99, 2000, 1000, 0, 0, 30],
    [20250, 20749.99, 2000, 1000, 50, 25, 30],
    [20750, 21249.99, 2000, 1000, 100, 50, 30],
    [21250, 21749.99, 2000, 1000, 150, 75, 30],
    [21750, 22249.99, 2000, 1000, 200, 100, 30],
    [22250, 22749.99, 2000, 1000, 250, 125, 30],
    [22750, 23249.99, 2000, 1000, 300, 150, 30],
    [23250, 23749.99, 2000, 1000, 350, 175, 30],
    [23750, 24249.99, 2000, 1000, 400, 200, 30],
    [24250, 24749.99, 2000, 1000, 450, 225, 30],
    [24750, 25249.99, 2000, 1000, 500, 250, 30],
    [25250, 25749.99, 2000, 1000, 550, 275, 30],
    [25750, 26249.99, 2000, 1000, 600, 300, 30],
    [26250, 26749.99, 2000, 1000, 650, 325, 30],
    [26750, 27249.99, 2000, 1000, 700, 350, 30],
    [27250, 27749.99, 2000, 1000, 750, 375, 30],
    [27750, 28249.99, 2000, 1000, 800, 400, 30],
    [28250, 28749.99, 2000, 1000, 850, 425, 30],
    [28750, 29249.99, 2000, 1000, 900, 450, 30],
    [29250, 29749.99, 2000, 1000, 950, 475, 30],
    [29750, 30249.99, 2000, 1000, 1000, 500, 30],
    [30250, 30749.99, 2000, 1000, 1050, 525, 30],
    [30750, 31249.99, 2000, 1000, 1100, 550, 30],
    [31250, 31749.99, 2000, 1000, 1150, 575, 30],
    [31750, 32249.99, 2000, 1000, 1200, 600, 30],
    [32250, 32749.99, 2000, 1000, 1250, 625, 30],
    [32750, 33249.99, 2000, 1000, 1300, 650, 30],
    [33250, 33749.99, 2000, 1000, 1350, 675, 30],
    [33750, 34249.99, 2000, 1000, 1400, 700, 30],
    [34250, 34749.99, 2000, 1000, 1450, 725, 30],
    [34750, Infinity, 2000, 1000, 1500, 750, 30],
  ],
    },

    // PhilHealth — 2.5% employee, 2.5% employer
    phic: {
      eeRate: 0.025,
      erRate: 0.025,
      floor: 10000,
      ceiling: 100000
    },

    // HDMF / HDMF — flat PHP 200 employee, PHP 200 employer
    hdmf: {
      flatEE: 200,
      flatER: 200
    },

    // Which payout each monthly contribution is deducted on.
    //   1 = paid on the 10th (cutoff 16-EOM)   2 = paid on the 25th (cutoff 1-15)
    //   'split' = half on each payout
    // Per Trinity's process: SSS lands on the 25th, PhilHealth and HDMF on the 10th.
    contributionSchedule: {
      sss: 2,
      phic: 1,
      hdmf: 1
    },

    // Reproduce the source workbook's X = T-(PHIC+HDMF), which omits SSS EE.
    replicateSheetFormula: false,

    // BIR withholding tax — TRAIN law, semi-monthly table (2023 onwards)
    taxTable: [
      { min: 0,      base: 0,        rate: 0.00, excessOver: 0 },
      { min: 10417,  base: 0,        rate: 0.15, excessOver: 10417 },
      { min: 16667,  base: 937.50,   rate: 0.20, excessOver: 16667 },
      { min: 33333,  base: 4270.70,  rate: 0.25, excessOver: 33333 },
      { min: 83333,  base: 16770.70, rate: 0.30, excessOver: 83333 },
      { min: 333333, base: 91770.70, rate: 0.35, excessOver: 333333 }
    ],
    applyWithholdingTax: true
  };

  /* The roster starts empty and is filled by importing the 201 File. The
     demo employees this site once shipped with all had @trinity.example
     emails; loadEmployees drops any still sitting in a browser, with their
     timesheet entries. */
  var SEED_EMPLOYEES = [];
  function isDemo(e) { return /@trinity\.example$/i.test(String((e && e.email) || '')); }

  /* ---------------------------------------------------------------------
     HOLIDAYS
     Only the holidays fixed by law (RA 9492 et al.) are pre-loaded. Movable
     ones — Holy Week, Eid'l Fitr, Eid'l Adha, National Heroes Day, and any
     special days added by proclamation — must be added each year in the
     Holidays tab once Malacanang releases the proclamation.
     --------------------------------------------------------------------- */
  function fixedHolidays(year) {
    return [
      { date: year + '-01-01', name: "New Year's Day",       type: 'regular' },
      { date: year + '-04-09', name: 'Araw ng Kagitingan',   type: 'regular' },
      { date: year + '-05-01', name: 'Labor Day',            type: 'regular' },
      { date: year + '-06-12', name: 'Independence Day',     type: 'regular' },
      { date: year + '-11-30', name: 'Bonifacio Day',        type: 'regular' },
      { date: year + '-12-25', name: 'Christmas Day',        type: 'regular' },
      { date: year + '-12-30', name: 'Rizal Day',            type: 'regular' },
      { date: year + '-11-01', name: "All Saints' Day",      type: 'special' },
      { date: year + '-12-08', name: 'Immaculate Conception', type: 'special' },
      { date: year + '-12-31', name: "Last Day of the Year", type: 'special' }
    ];
  }

  /* ---------------------------------------------------------------------
     PERSISTENCE (localStorage)
     --------------------------------------------------------------------- */
  var KEYS = {
    employees: 'phpayroll.employees.v1',
    settings: 'phpayroll.settings.v1',
    dtr: 'phpayroll.dtr.v1',
    holidays: 'phpayroll.holidays.v1',
    notes: 'phpayroll.notes.v1',
    trinity: 'phpayroll.trinityhr.v1'
  };

  function deepMerge(base, override) {
    if (override === null || override === undefined) return base;
    if (typeof base !== 'object' || base === null || Array.isArray(base)) return override;
    var out = {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    Object.keys(override).forEach(function (k) {
      out[k] = (k in base) ? deepMerge(base[k], override[k]) : override[k];
    });
    return out;
  }

  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Could not read ' + key, e);
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('Could not save ' + key, e);
    }
    // Shared with the other admins through TrinityHR (sync.js).
    if (global.PayrollSync) global.PayrollSync.changed(key, value);
  }

  var Store = {
    KEYS: KEYS,
    loadSettings: function () {
      return deepMerge(DEFAULT_SETTINGS, load(KEYS.settings, {}));
    },
    saveSettings: function (s) { save(KEYS.settings, s); },

    loadEmployees: function () {
      var list = load(KEYS.employees, []);
      var demo = {};
      list.forEach(function (e) { if (isDemo(e)) demo[e.id] = true; });
      if (!Object.keys(demo).length) return list;
      list = list.filter(function (e) { return !demo[e.id]; });
      save(KEYS.employees, list);
      var dtr = load(KEYS.dtr, {});
      Object.keys(dtr).forEach(function (k) { if (demo[k.split('|')[1]]) delete dtr[k]; });
      save(KEYS.dtr, dtr);
      return list;
    },
    saveEmployees: function (e) { save(KEYS.employees, e); },

    // Late used to be stored in hours; the payroll file counts minutes.
    loadDtr: function () {
      var dtr = load(KEYS.dtr, {});
      Object.keys(dtr).forEach(function (k) {
        var d = dtr[k];
        if (d && d.lateHours) {
          d.lateMinutes = Math.round((Number(d.lateMinutes) || 0) + Number(d.lateHours) * 60 * 100) / 100;
          delete d.lateHours;
        }
      });
      return dtr;
    },
    saveDtr: function (d) { save(KEYS.dtr, d); },

    // Explanatory notes start hidden; the header toggle remembers the choice.
    // TrinityHR address, key and what was sent when. Its own key in storage
    // so the payslip key never rides along in a backup or export.
    loadTrinity: function () { return load(KEYS.trinity, { url: 'https://trinityhr.vercel.app', key: '', sent: {} }); },
    saveTrinity: function (t) { save(KEYS.trinity, t); },

    loadNotesVisible: function () { return load(KEYS.notes, false) === true; },
    saveNotesVisible: function (v) { save(KEYS.notes, !!v); },

    loadHolidays: function (year) {
      var all = load(KEYS.holidays, null);
      if (all && all[year]) return all[year];
      return fixedHolidays(year);
    },
    saveHolidays: function (year, list) {
      var all = load(KEYS.holidays, {}) || {};
      all[year] = list;
      save(KEYS.holidays, all);
    },

    resetAll: function () {
      Object.keys(KEYS).forEach(function (k) { localStorage.removeItem(KEYS[k]); });
    }
  };

  global.PayrollData = {
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    SEED_EMPLOYEES: SEED_EMPLOYEES,
    fixedHolidays: fixedHolidays,
    Store: Store
  };
})(window);

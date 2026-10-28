/* =========================================================================
   xlsx.js — minimal .xlsx writer (no dependencies)

   Writes a genuine Office Open XML workbook: a ZIP (stored, uncompressed)
   containing the handful of parts Excel needs. Supports multiple sheets,
   inline strings, numbers, formulas, a small style palette, column widths,
   frozen panes and merged cells — which is everything the payroll template
   needs and nothing more.

   Cell shorthand used by the builders below:
     's:Text'   string        'n:1234.5'  number
     'f:SUM(A1:A2)'           formula (numeric result)
     {v: value, t: 's'|'n'|'f', s: styleIndex}
   ========================================================================= */
(function (global) {
  'use strict';

  /* ----------------------------- CRC32 ----------------------------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  var enc = new TextEncoder();

  /* ------------------------- ZIP (store only) ------------------------- */
  function zip(files) {
    // files: [{name, data: Uint8Array}]
    var chunks = [], central = [], offset = 0;
    // Fixed DOS timestamp (2026-01-01 00:00) keeps output byte-stable.
    var dosTime = 0, dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;

    files.forEach(function (f) {
      var nameBytes = enc.encode(f.name);
      var crc = crc32(f.data);
      var size = f.data.length;

      var local = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);           // version needed
      lv.setUint16(6, 0x0800, true);       // UTF-8 name flag
      lv.setUint16(8, 0, true);            // method: stored
      lv.setUint16(10, dosTime, true);
      lv.setUint16(12, dosDate, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      chunks.push(local, f.data);

      var cd = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length + size;
    });

    var cdSize = central.reduce(function (a, c) { return a + c.length; }, 0);
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);

    return new Blob(chunks.concat(central, [end]), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  /* --------------------------- XML helpers --------------------------- */
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      // strip control characters Excel rejects
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  function colName(n) {                     // 1 -> A, 27 -> AA
    var s = '';
    while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; }
    return s;
  }

  /* ------------------------------ STYLES ------------------------------
     Index | meaning
       0   | default
       1   | bold
       2   | number  #,##0.00
       3   | bold number (totals, top border)
       4   | title (bold, 13pt)
       5   | header band — white on dark, wrapped, centred
       6   | header band, computed columns (white on green)
       7   | header band, input columns (white on amber)
       8   | input cell (amber tint) number
       9   | computed cell (grey tint) number
      10   | muted / note text
      11   | integer #,##0
      12   | date
     ------------------------------------------------------------------ */
  var STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3">' +
      '<numFmt numFmtId="164" formatCode="#,##0.00"/>' +
      '<numFmt numFmtId="165" formatCode="#,##0"/>' +
      // Date inputs display in the same shape the importer expects, so what is
      // on screen is what has to be typed.
      '<numFmt numFmtId="166" formatCode="yyyy\\-mm\\-dd"/>' +
    '</numFmts>' +
    '<fonts count="6">' +
      '<font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="13"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '<font><sz val="10"/><color rgb="FF6B7280"/><i/><name val="Calibri"/></font>' +
      '<font><sz val="11"/><color rgb="FF1F2937"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="7">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF12557A"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF0F7B52"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFB45309"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFDF6E3"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE6B9A0"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="3">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top style="thin"><color rgb="FF9CA3AF"/></top><bottom style="double"><color rgb="FF9CA3AF"/></bottom><diagonal/></border>' +
      '<border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="15">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                        // 0
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/>' +                                        // 1
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +                // 2
      '<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +// 3
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0"/>' +                                        // 4
      '<xf numFmtId="0" fontId="3" fillId="2" borderId="2" xfId="0" applyFill="1" applyBorder="1">' +
        '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +                                // 5
      '<xf numFmtId="0" fontId="3" fillId="3" borderId="2" xfId="0" applyFill="1" applyBorder="1">' +
        '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +                                // 6
      '<xf numFmtId="0" fontId="3" fillId="4" borderId="2" xfId="0" applyFill="1" applyBorder="1">' +
        '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +                                // 7
      '<xf numFmtId="164" fontId="0" fillId="5" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>' + // 8
      '<xf numFmtId="164" fontId="5" fillId="0" borderId="2" xfId="0" applyNumberFormat="1" applyBorder="1"/>' +// 9
      '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0"><alignment wrapText="1" vertical="top"/></xf>' + // 10
      '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +                // 11
      '<xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +                 // 12
      // An input cell that is a date: same fill and border as INPUT, but shown
      // as yyyy-mm-dd rather than as a 2-decimal number.
      '<xf numFmtId="166" fontId="0" fillId="5" borderId="2" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>' + // 13
      // The payroll summary's own header: bold black on tan, as in the Ortus file.
      '<xf numFmtId="0" fontId="1" fillId="6" borderId="2" xfId="0" applyFill="1" applyBorder="1">' +
        '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +                                // 14
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  /* --------------------------- sheet builder --------------------------- */
  function normaliseCell(cell) {
    if (cell === null || cell === undefined || cell === '') return null;
    if (typeof cell === 'object') return cell;
    if (typeof cell === 'number') return { v: cell, t: 'n' };
    var str = String(cell);
    var pfx = str.slice(0, 2);
    if (pfx === 's:') return { v: str.slice(2), t: 's' };
    if (pfx === 'n:') return { v: parseFloat(str.slice(2)), t: 'n' };
    if (pfx === 'f:') return { v: str.slice(2), t: 'f' };
    return { v: str, t: 's' };
  }

  function sheetXml(sheet) {
    var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';

    if (sheet.freeze) {
      xml += '<sheetViews><sheetView workbookViewId="0" showGridLines="' +
        (sheet.gridLines === false ? '0' : '1') + '">' +
        '<pane xSplit="' + (sheet.freeze.x || 0) + '" ySplit="' + (sheet.freeze.y || 0) + '" ' +
        'topLeftCell="' + colName((sheet.freeze.x || 0) + 1) + ((sheet.freeze.y || 0) + 1) + '" ' +
        'activePane="bottomRight" state="frozen"/></sheetView></sheetViews>';
    }

    xml += '<sheetFormatPr defaultRowHeight="15"/>';

    if (sheet.cols && sheet.cols.length) {
      xml += '<cols>';
      sheet.cols.forEach(function (w, i) {
        xml += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
      });
      xml += '</cols>';
    }

    xml += '<sheetData>';
    (sheet.rows || []).forEach(function (row, r) {
      if (!row || !row.length) return;
      var cells = '', any = false;
      row.forEach(function (raw, c) {
        var cell = normaliseCell(raw);
        if (!cell) return;
        any = true;
        var ref = colName(c + 1) + (r + 1);
        var s = cell.s ? ' s="' + cell.s + '"' : '';
        if (cell.t === 'f') {
          cells += '<c r="' + ref + '"' + s + '><f>' + esc(cell.v) + '</f></c>';
        } else if (cell.t === 'n') {
          var num = Number(cell.v);
          cells += '<c r="' + ref + '"' + s + '><v>' + (isFinite(num) ? num : 0) + '</v></c>';
        } else if (cell.v === '' || cell.v === null || cell.v === undefined) {
          // Truly empty, not an empty string: a formula reading a blank
          // input cell must see zero, and "" * 1.25 is #VALUE! in Excel.
          if (s) cells += '<c r="' + ref + '"' + s + '/>';
        } else {
          cells += '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' +
            esc(cell.v) + '</t></is></c>';
        }
      });
      if (any) {
        var ht = (sheet.rowHeights && sheet.rowHeights[r])
          ? ' ht="' + sheet.rowHeights[r] + '" customHeight="1"' : '';
        // Hidden rows are still written out in full — Excel just collapses them,
        // so anything reading the file back still sees every row.
        var hid = (sheet.hiddenRows && sheet.hiddenRows.indexOf(r) !== -1)
          ? ' hidden="1" customFormat="1"' : '';
        xml += '<row r="' + (r + 1) + '"' + ht + hid + '>' + cells + '</row>';
      }
    });
    xml += '</sheetData>';
    if (sheet.autoFilter) xml += '<autoFilter ref="' + sheet.autoFilter + '"/>';

    if (sheet.merges && sheet.merges.length) {
      xml += '<mergeCells count="' + sheet.merges.length + '">' +
        sheet.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') +
        '</mergeCells>';
    }

    xml += '</worksheet>';
    return xml;
  }

  /* ------------------------------ workbook ------------------------------ */
  function build(sheets) {
    var files = [];
    var add = function (name, str) { files.push({ name: name, data: enc.encode(str) }); };

    var sheetRefs = sheets.map(function (s, i) {
      return '<sheet name="' + esc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    }).join('');

    add('[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets.map(function (s, i) {
        return '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
          '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
      }).join('') +
      '</Types>');

    add('_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>');

    add('xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + sheetRefs + '</sheets>' +
      '<calcPr calcId="0" fullCalcOnLoad="1"/></workbook>');

    add('xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map(function (s, i) {
        return '<Relationship Id="rId' + (i + 1) +
          '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
          (i + 1) + '.xml"/>';
      }).join('') +
      '<Relationship Id="rId' + (sheets.length + 1) +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>');

    add('xl/styles.xml', STYLES_XML);
    sheets.forEach(function (s, i) { add('xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s)); });

    return zip(files);
  }

  function download(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }


  /* =====================================================================
     READER — parse a filled-in .xlsx back into rows

     Excel saves its parts DEFLATE-compressed, so this leans on the browser's
     built-in DecompressionStream('deflate-raw') rather than shipping an
     inflate implementation. Entries we wrote ourselves are stored, and are
     handled without decompression.
     ===================================================================== */
  var dec = new TextDecoder();

  function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      return Promise.reject(new Error(
        'This browser cannot decompress .xlsx files. Use a current Chrome, Edge, Safari or Firefox.'));
    }
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }

  /** Read a ZIP into { filename: Uint8Array }. */
  function unzip(arrayBuffer) {
    var buf = new Uint8Array(arrayBuffer);
    var view = new DataView(arrayBuffer);

    // locate End Of Central Directory (scan back over the optional comment)
    var eocd = -1;
    for (var i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return Promise.reject(new Error('Not a valid .xlsx file (no ZIP directory found).'));

    var count = view.getUint16(eocd + 10, true);
    var cdOffset = view.getUint32(eocd + 16, true);

    var entries = [], p = cdOffset;
    for (var n = 0; n < count; n++) {
      if (view.getUint32(p, true) !== 0x02014b50) break;
      var method = view.getUint16(p + 10, true);
      var compSize = view.getUint32(p + 20, true);
      var nameLen = view.getUint16(p + 28, true);
      var extraLen = view.getUint16(p + 30, true);
      var commentLen = view.getUint16(p + 32, true);
      var localOffset = view.getUint32(p + 42, true);
      var name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));

      // local header tells us where the data actually starts
      var lNameLen = view.getUint16(localOffset + 26, true);
      var lExtraLen = view.getUint16(localOffset + 28, true);
      var dataStart = localOffset + 30 + lNameLen + lExtraLen;

      entries.push({ name: name, method: method, data: buf.subarray(dataStart, dataStart + compSize) });
      p += 46 + nameLen + extraLen + commentLen;
    }

    var out = {};
    return entries.reduce(function (chain, e) {
      return chain.then(function () {
        if (e.method === 0) { out[e.name] = e.data; return; }
        if (e.method !== 8) throw new Error('Unsupported compression in ' + e.name);
        return inflateRaw(e.data).then(function (d) { out[e.name] = d; });
      });
    }, Promise.resolve()).then(function () { return out; });
  }

  function parseXml(bytes) {
    return new DOMParser().parseFromString(dec.decode(bytes), 'application/xml');
  }

  function colIndex(ref) {                   // 'BC12' -> 54
    var m = /^([A-Z]+)/.exec(ref || '');
    if (!m) return 0;
    var n = 0;
    for (var i = 0; i < m[1].length; i++) n = n * 26 + (m[1].charCodeAt(i) - 64);
    return n - 1;
  }

  function sheetRows(doc, shared) {
    var rows = [];
    var rowEls = doc.getElementsByTagName('row');
    for (var r = 0; r < rowEls.length; r++) {
      var rowEl = rowEls[r];
      var idx = parseInt(rowEl.getAttribute('r'), 10) - 1;
      var arr = rows[idx] = rows[idx] || [];
      var cs = rowEl.getElementsByTagName('c');
      for (var c = 0; c < cs.length; c++) {
        var cell = cs[c];
        var ci = colIndex(cell.getAttribute('r'));
        var t = cell.getAttribute('t');
        var value = null;
        if (t === 'inlineStr') {
          var isEl = cell.getElementsByTagName('t');
          value = isEl.length ? isEl[0].textContent : '';
        } else {
          var v = cell.getElementsByTagName('v');
          var raw = v.length ? v[0].textContent : null;
          if (raw === null) value = null;
          else if (t === 's') value = shared[parseInt(raw, 10)] !== undefined ? shared[parseInt(raw, 10)] : '';
          else if (t === 'str' || t === 'e') value = raw;
          else { var f = parseFloat(raw); value = isFinite(f) ? f : raw; }
        }
        arr[ci] = value;
      }
    }
    for (var k = 0; k < rows.length; k++) if (!rows[k]) rows[k] = [];
    return rows;
  }

  /** Read an .xlsx File/Blob/ArrayBuffer into { sheetName: rows[][] }. */
  function read(input) {
    // Duck-typed rather than `instanceof ArrayBuffer`, which fails across realms.
    var toBuffer = (input && typeof input.arrayBuffer === 'function')
      ? input.arrayBuffer()
      : Promise.resolve(input);

    var fileName = input && input.name ? String(input.name) : '';
    return toBuffer.then(function (buf) {
      // D0 CF 11 E0: the older Excel 97–2003 (.xls) format, whatever the
      // file is named. Payroll files saved by older Excel come this way.
      var head = new Uint8Array(buf, 0, 4);
      if (head[0] === 0xD0 && head[1] === 0xCF && head[2] === 0x11 && head[3] === 0xE0) return readLegacy(buf);
      // PK: a real .xlsx. Anything else is read as CSV text — one sheet,
      // as Google Sheets' "Download → .csv" gives it.
      if (head[0] === 0x50 && head[1] === 0x4B) return unzip(buf).then(readZipped);
      return readCsv(buf, fileName);
    });
  }

  /* Google names a one-sheet download "<workbook> - <sheet>.csv", so the
     sheet keeps its name ("Payroll Register") and the workbook part keeps
     the payout date the importer reads from the name. */
  function readCsv(buf, fileName) {
    var text = new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, '');
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') q = false;
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    var base = fileName.replace(/\.csv$/i, '');
    var m = base.match(/ - ([^-]+)$/);
    var out = {};
    out[m ? m[1].trim() : 'Sheet1'] = rows.map(function (r) {
      return r.map(function (v) { return v === '' ? null : v; });
    });
    return Promise.resolve(out);
  }

  /* Old-format workbooks are read with SheetJS, loaded only when one turns
     up (it is large), into the same { sheet: rows[][] } shape. */
  var legacyLib = null;
  function loadLegacyLib() {
    if (global.XLSX) return Promise.resolve(global.XLSX);
    if (legacyLib) return legacyLib;
    legacyLib = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = 'vendor/xlsx.full.min.js';
      sc.onload = function () { resolve(global.XLSX); };
      sc.onerror = function () { legacyLib = null; reject(new Error('Could not load the reader for older Excel files.')); };
      document.head.appendChild(sc);
    });
    return legacyLib;
  }
  function readLegacy(buf) {
    return loadLegacyLib().then(function (XL) {
      var wb = XL.read(new Uint8Array(buf), { type: 'array' });
      var out = {};
      wb.SheetNames.forEach(function (name) {
        var ws = wb.Sheets[name];
        if (!ws || !ws['!ref']) { out[name] = []; return; }
        var range = XL.utils.decode_range(ws['!ref']);
        var rows = XL.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
        // Keep row and column numbers where Excel has them.
        var lead = [];
        for (var r = 0; r < range.s.r; r++) lead.push([]);
        out[name] = lead.concat(rows.map(function (row) {
          var pad = [];
          for (var c = 0; c < range.s.c; c++) pad.push(null);
          return pad.concat(row);
        }));
      });
      return out;
    });
  }

  function readZipped(files) {
      var shared = [];
      if (files['xl/sharedStrings.xml']) {
        var sdoc = parseXml(files['xl/sharedStrings.xml']);
        var sis = sdoc.getElementsByTagName('si');
        for (var i = 0; i < sis.length; i++) {
          var ts = sis[i].getElementsByTagName('t');
          var s = '';
          for (var j = 0; j < ts.length; j++) s += ts[j].textContent;
          shared.push(s);
        }
      }

      // map sheet name -> part, via workbook.xml + its rels
      var wb = parseXml(files['xl/workbook.xml']);
      var rels = parseXml(files['xl/_rels/workbook.xml.rels']);
      var relMap = {};
      var rEls = rels.getElementsByTagName('Relationship');
      for (var a = 0; a < rEls.length; a++) {
        relMap[rEls[a].getAttribute('Id')] = rEls[a].getAttribute('Target').replace(/^\/?xl\//, '');
      }

      var out = {};
      var sheetEls = wb.getElementsByTagName('sheet');
      for (var b = 0; b < sheetEls.length; b++) {
        var name = sheetEls[b].getAttribute('name');
        var rid = sheetEls[b].getAttribute('r:id') ||
                  sheetEls[b].getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        var target = relMap[rid] || ('worksheets/sheet' + (b + 1) + '.xml');
        var part = files['xl/' + target];
        if (part) out[name] = sheetRows(parseXml(part), shared);
      }
      return out;
  }

  /* Excel stores a typed date as a serial number, so a date column reads back as
     46204 rather than "2026-07-01" and every downstream YYYY-MM-DD check fails.
     Decode that. Anything not a plain number in a plausible date window is
     returned untouched, so a genuinely malformed entry still gets reported by
     the caller rather than silently becoming a date. */
  function toYmd(v) {
    if (v === undefined || v === null) return v;
    var s = String(v).trim();
    if (s === '' || /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (!/^\d+(\.\d+)?$/.test(s)) return s;
    var n = parseFloat(s);
    // 20000–80000 spans 1954 to 2119. Outside that it is far likelier to be a
    // typo or an amount pasted into the wrong column than a date.
    if (n < 20000 || n > 80000) return s;
    var d = new Date(Math.round((n - 25569) * 86400000));
    if (!isFinite(d.getTime())) return s;
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
  }

  /* One visible line telling the reader that hidden note rows exist and how to
     open them — a spreadsheet has no toggle button, so without this the notes
     read as missing rather than collapsed. All indices in are 0-based; the
     numbers quoted to the user are 1-based, the way Excel labels rows. */
  function unhideHint(pointerIdx, hiddenIdx) {
    var first = Math.min.apply(null, hiddenIdx) + 1;
    var last = Math.max.apply(null, hiddenIdx) + 1;
    var span = first === last ? 'row ' + first : 'rows ' + first + '–' + last;
    return 'Notes and instructions are in hidden ' + span + '. Select rows ' +
      (pointerIdx + 1) + ' to ' + (last + 1) + ', right-click and choose Unhide to read them.';
  }

  global.XlsxWriter = {
    build: build,
    unhideHint: unhideHint,
    toYmd: toYmd,
    download: download,
    colName: colName,
    read: read,
    unzip: unzip,
    loadSheetJs: loadLegacyLib,
    S: { DEFAULT: 0, BOLD: 1, NUM: 2, TOTAL: 3, TITLE: 4,
         HEAD: 5, HEAD_CALC: 6, HEAD_INPUT: 7, INPUT: 8, CALC: 9, NOTE: 10, INT: 11, DATE: 12,
         INPUT_DATE: 13, HEAD_TAN: 14 }
  };
})(window);

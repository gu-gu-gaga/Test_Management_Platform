/* ================================================================================
   极简 xlsx 读写（无外部依赖）
   · write(sheets)   ：生成 Excel 工作簿（.xlsx），单元格统一按文本写入，避免日期 / 数字被自动改写
   · read(arrayBuffer)：解析 Excel 工作簿，返回 [{ name, rows }]（rows 为二维数组，空单元格为 ''）
   支持：多工作表导出；导入支持 Excel / WPS 保存的标准 xlsx（含共享字符串表、deflate 压缩）
   ================================================================================ */
window.XLSX_LITE = (function () {
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8');

  /* ---------- CRC32 ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- 字符串 / XML 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&apos;')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }
  function wholeRowWithText(s, limit) {
    /* 避免 Excel 单格文本超长（32767 上限），超长按 limit 截断 */
    const t = String(s == null ? '' : s);
    return t.length > limit ? t.slice(0, limit) : t;
  }

  /* ---------- ZIP 打包 ---------- */
  function dosTime(d) {
    const t = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xFFFF;
    const dt = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    return { t, dt };
  }
  async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const cs = new CompressionStream('deflate-raw');
      const stream = new Blob([bytes]).stream().pipeThrough(cs);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }
  }
  async function zip(files) {
    /* files: [{ name, data: Uint8Array }] */
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const { t, dt } = dosTime(now);
    for (const f of files) {
      const nameBytes = enc.encode(f.name);
      const crc = crc32(f.data);
      let method = 0, payload = f.data;
      const packed = await deflateRaw(f.data);
      if (packed && packed.length < f.data.length) { method = 8; payload = packed; }
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, method, true);
      lv.setUint16(10, t, true);
      lv.setUint16(12, dt, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, payload.length, true);
      lv.setUint32(22, f.data.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);
      chunks.push(local, payload);
      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, method, true);
      cv.setUint16(12, t, true);
      cv.setUint16(14, dt, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, payload.length, true);
      cv.setUint32(24, f.data.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);
      offset += local.length + payload.length;
    }
    const cdSize = central.reduce((n, c) => n + c.length, 0);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, offset, true);
    return new Blob(chunks.concat(central, [eocd]), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  /* ---------- 工作表 XML ---------- */
  function colName(i) {
    let s = '';
    i += 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function sheetXml(rows) {
    const body = rows.map((row, ri) => {
      const cells = (row || []).map((v, ci) => {
        const text = wholeRowWithText(v, 30000);
        if (text === '') return '';
        return `<c r="${colName(ci)}${ri + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
      }).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  }

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="等线"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;

  async function write(sheets) {
    const list = (sheets || []).filter(s => s && s.rows);
    const sheetFiles = list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s.rows)) }));
    const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${list.map((s, i) => `<sheet name="${esc(s.name || ('Sheet' + (i + 1)))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`;
    const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${list.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
    const files = [
      { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
      { name: '_rels/.rels', data: enc.encode(rootRels) },
      { name: 'xl/workbook.xml', data: enc.encode(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
      { name: 'xl/styles.xml', data: enc.encode(STYLES) }
    ].concat(sheetFiles);
    return zip(files);
  }

  /* ---------- ZIP 解析 ---------- */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器不支持解压（需要 DecompressionStream）');
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function unzip(buffer) {
    const u8 = new Uint8Array(buffer);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    /* 从尾部定位 EOCD */
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 Excel 文件（未找到 zip 目录）');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = {};
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const usize = dv.getUint32(p + 24, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      const lo = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      /* 读取 local header 拿到数据起点 */
      const lNameLen = dv.getUint16(lo + 26, true);
      const lExtraLen = dv.getUint16(lo + 28, true);
      const start = lo + 30 + lNameLen + lExtraLen;
      const raw = u8.subarray(start, start + csize);
      if (method === 0) out[name] = raw.slice();
      else if (method === 8) out[name] = await inflateRaw(raw);
      p += 46 + nameLen + extraLen + cmtLen;
      if (usize === 0 && csize === 0) out[name] = new Uint8Array(0);
    }
    return out;
  }

  /* ---------- 工作表解析 ---------- */
  function colIndex(ref) {
    const m = String(ref).match(/^([A-Z]+)/i);
    if (!m) return 0;
    let n = 0;
    for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }
  function cellText(c, shared) {
    const t = c.getAttribute('t');
    if (t === 'inlineStr') {
      const is = c.getElementsByTagName('is')[0];
      return is ? Array.from(is.getElementsByTagName('t')).map(x => x.textContent).join('') : '';
    }
    const v = c.getElementsByTagName('v')[0];
    const raw = v ? v.textContent : '';
    if (t === 's') return shared[Number(raw)] != null ? shared[Number(raw)] : '';
    return raw;
  }
  function parseSheet(xmlText, shared) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    const rows = [];
    const rowEls = doc.getElementsByTagName('row');
    for (let i = 0; i < rowEls.length; i++) {
      const rowEl = rowEls[i];
      const rIdx = rowEl.getAttribute('r') ? Number(rowEl.getAttribute('r')) - 1 : rows.length;
      const cells = [];
      const cEls = rowEl.getElementsByTagName('c');
      for (let j = 0; j < cEls.length; j++) {
        const c = cEls[j];
        const ci = c.getAttribute('r') ? colIndex(c.getAttribute('r')) : cells.length;
        const val = cellText(c, shared);
        while (cells.length < ci) cells.push('');
        cells[ci] = String(val == null ? '' : val).trim();
      }
      while (rows.length < rIdx) rows.push([]);
      rows[rIdx] = cells;
    }
    return rows;
  }
  function parseShared(xmlText) {
    if (!xmlText) return [];
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    return Array.from(doc.getElementsByTagName('si')).map(si =>
      Array.from(si.getElementsByTagName('t')).map(t => t.textContent).join(''));
  }

  async function read(buffer) {
    const files = await unzip(buffer);
    const shared = parseShared(files['xl/sharedStrings.xml'] ? dec.decode(files['xl/sharedStrings.xml']) : null);
    /* 工作表顺序与名称：优先按 workbook.xml 的 r:id → rels 映射，失败则回退 sheetN.xml */
    let list = [];
    try {
      const wbDoc = new DOMParser().parseFromString(dec.decode(files['xl/workbook.xml']), 'application/xml');
      const relDoc = new DOMParser().parseFromString(dec.decode(files['xl/_rels/workbook.xml.rels']), 'application/xml');
      const relMap = {};
      Array.from(relDoc.getElementsByTagName('Relationship')).forEach(r => { relMap[r.getAttribute('Id')] = r.getAttribute('Target'); });
      list = Array.from(wbDoc.getElementsByTagName('sheet')).map(s => {
        const target = relMap[s.getAttribute('r:id')] || '';
        const path = target ? ('xl/' + target.replace(/^\/?xl\//, '').replace(/^\//, '')) : '';
        return { name: s.getAttribute('name') || 'Sheet', path };
      }).filter(x => x.path);
    } catch (e) { list = []; }
    if (!list.length) {
      list = Object.keys(files).filter(k => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()
        .map(p => ({ name: 'Sheet' + ((p.match(/sheet(\d+)/) || [])[1] || '1'), path: p }));
    }
    const sheets = [];
    for (const item of list) {
      if (!files[item.path]) continue;
      sheets.push({ name: item.name, rows: parseSheet(dec.decode(files[item.path]), shared) });
    }
    return sheets;
  }

  return { write, read };
})();

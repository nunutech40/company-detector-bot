'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const HEADERS = [
  'Tanggal Masuk',
  'Prioritas',
  'Status Follow Up',
  'Nama Prospect',
  'Email',
  'No HP',
  'Brand / Toko',
  'Kategori',
  'Kota / Area',
  'Marketplace',
  'Sosial Media',
  'Website',
  'Sumber Data',
  'PIC Sales',
  'Jadwal Follow Up',
  'Catatan Sales',
  'Detail Lengkap',
];

const OPTION_ROWS = [
  ['Priority', 'Sales Status', 'Source Register'],
  ['Hot prospect', 'New', 'platform_register'],
  ['Warm prospect', 'Contacted', 'webhook'],
  ['', 'Follow up later', 'manual_test'],
  ['', 'Not fit', 'queue_simulation'],
  ['', 'Won', ''],
  ['', 'Lost', ''],
];

const WIDTHS = [24, 16, 18, 26, 30, 18, 22, 20, 18, 46, 46, 30, 18, 18, 20, 36, 46];
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function writeSalesSheetXlsx(outputPath, prospects, options = {}) {
  const rows = prospects.map((job) => prospectRow(job, options));
  const rowHeights = {
    1: 30,
    2: 34,
    3: 8,
    4: 28,
  };
  rows.forEach((row, idx) => {
    const lineCount = Math.max(
      countLines(row[9]),
      countLines(row[10]),
      countLines(row[15]),
      1
    );
    rowHeights[idx + 5] = Math.max(36, 22 + lineCount * 17);
  });

  const sheets = [
    {
      name: 'Sales Pipeline',
      rows: [
        wideRow('Sales Prospect Pipeline', HEADERS.length),
        wideRow('Prospect siap follow up dari Company Detector. Update status, PIC, jadwal, dan catatan follow up di sheet ini.', HEADERS.length),
        wideRow('', HEADERS.length),
        HEADERS,
        ...rows,
      ],
      widths: WIDTHS,
      freezeRows: 4,
      headerRow: 4,
      titleRows: [1],
      subtitleRows: [2],
      rowHeights,
      mergeCells: ['A1:Q1', 'A2:Q2'],
      filter: `A4:Q${Math.max(200, rows.length + 4)}`,
      dataValidations: [
        { range: 'B5:B500', formula: "'Options'!$A$2:$A$3" },
        { range: 'C5:C500', formula: "'Options'!$B$2:$B$7" },
      ],
    },
    {
      name: 'Options',
      rows: OPTION_ROWS,
      widths: [18, 20, 20],
      freezeRows: 1,
      headerRow: 1,
      filter: `A1:C${OPTION_ROWS.length}`,
    },
  ];

  const files = new Map();
  addFile(files, '[Content_Types].xml', contentTypesXml(sheets.length));
  addFile(files, '_rels/.rels', rootRelsXml());
  addFile(files, 'docProps/core.xml', coreXml());
  addFile(files, 'docProps/app.xml', appXml(sheets));
  addFile(files, 'xl/workbook.xml', workbookXml(sheets));
  addFile(files, 'xl/_rels/workbook.xml.rels', workbookRelsXml(sheets.length));
  addFile(files, 'xl/styles.xml', stylesXml());
  for (let i = 0; i < sheets.length; i += 1) {
    addFile(files, `xl/worksheets/sheet${i + 1}.xml`, worksheetXml(sheets[i]));
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  writeZip(outputPath, files);
  return outputPath;
}

function prospectRow(job, options) {
  return [
    formatJakarta(job.finished_at || job.created_at || new Date()),
    prospectTier(job.confidence_score),
    'New',
    displayName(job),
    job.email || '',
    extractPhone(job),
    job.brand_name || cleanBusinessName(job.business_name) || '',
    job.business_industry || '',
    job.business_city || '',
    formatChannels(job.marketplace_json, { maxItems: 8, multiline: true }),
    formatChannels(job.social_media_json, { maxItems: 8, multiline: true }),
    job.business_website || '',
    sourceLabel(job.source || job.register_source),
    '',
    '',
    '',
    options.dashboardBaseUrl && job.id ? `${options.dashboardBaseUrl.replace(/\/+$/, '')}/jobs/${job.id}` : '',
  ];
}

function extractPhone(job) {
  if (job.no_hp_masked) return job.no_hp_masked;
  const payload = parseJsonObject(job.payload_json);
  return payload.no_hp || payload.phone || payload.phone_number || payload.mobile || '';
}

function sourceLabel(value) {
  const text = String(value || '').trim();
  if (!text) return 'Register platform';
  if (text === 'platform_register' || text === 'webhook') return 'Register platform';
  if (text === 'telegram') return 'Telegram';
  return text.replace(/_/g, ' ');
}

function displayName(job) {
  const candidates = [
    job.brand_name,
    cleanBusinessName(job.business_name),
    job.full_name,
    job.email,
  ];
  return candidates.find(Boolean) || job.email || '';
}

function cleanBusinessName(value) {
  const text = String(value || '')
    .replace(/\*\*/g, '')
    .replace(/^nama:\s*/i, '')
    .trim();
  if (!text) return '';
  if (text.length > 60) return '';
  if (/alat:|web_search|web_fetch|location:|education:/i.test(text)) return '';
  return text;
}

function prospectTier(confidence) {
  const score = Number(confidence || 0);
  return score >= 75 ? 'Hot prospect' : 'Warm prospect';
}

function formatChannels(value, options = {}) {
  const items = parseJsonList(value);
  const maxItems = options.maxItems || 8;
  const separator = options.multiline ? '\n' : '; ';
  const seen = new Set();
  const formatted = [];

  for (const item of items) {
    const url = cleanUrl(item.url || item.link || '');
    if (!url) continue;
    if (!isUsefulUrl(url)) continue;
    const normalized = normalizeUrl(url);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const platform = cleanPlatform(item.platform || detectPlatform(url));
    formatted.push(`${platform}: ${url}`);
    if (formatted.length >= maxItems) break;
  }

  return formatted.join(separator);
}

function parseJsonList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return [value];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object') return [parsed];
  } catch (_err) {
    return [];
  }
  return [];
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function cleanUrl(value) {
  return String(value || '').trim().replace(/[.,;:!?]+$/, '');
}

function normalizeUrl(value) {
  return cleanUrl(value)
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

function isUsefulUrl(value) {
  const text = normalizeUrl(value);
  if (!text) return false;
  if (/linkedin\.com\/in\/?$/.test(text)) return false;
  if (/instagram\.com\/?$/.test(text)) return false;
  if (/tiktok\.com\/@?$/.test(text)) return false;
  if (/facebook\.com\/?$/.test(text)) return false;
  return true;
}

function cleanPlatform(value) {
  const text = String(value || '').trim();
  if (!text) return 'Link';
  const normalized = text.toLowerCase().replace(/[_\s-]+/g, '');
  const labels = {
    tokopedia: 'Tokopedia',
    shopee: 'Shopee',
    instagram: 'Instagram',
    tiktok: 'TikTok',
    linkedin: 'LinkedIn',
    facebook: 'Facebook',
    youtube: 'YouTube',
    pinterest: 'Pinterest',
    flickr: 'Flickr',
  };
  if (labels[normalized]) return labels[normalized];
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/_/g, ' ');
}

function detectPlatform(url) {
  const text = String(url || '').toLowerCase();
  if (text.includes('tokopedia.')) return 'tokopedia';
  if (text.includes('shopee.')) return 'shopee';
  if (text.includes('instagram.')) return 'instagram';
  if (text.includes('tiktok.')) return 'tiktok';
  if (text.includes('linkedin.')) return 'linkedin';
  if (text.includes('facebook.')) return 'facebook';
  if (text.includes('youtube.')) return 'youtube';
  return 'link';
}

function formatJakarta(value) {
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: 'long',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value)).replace(/\./g, ':') + ' WIB';
}

function countLines(value) {
  return String(value || '').split('\n').length;
}

function addFile(files, name, content) {
  files.set(name, Buffer.from(content, 'utf8'));
}

function wideRow(value, width) {
  return [value, ...Array.from({ length: width - 1 }, () => '')];
}

function worksheetXml(sheet) {
  const rowsXml = sheet.rows.map((row, rIdx) => {
    const rowNumber = rIdx + 1;
    const cells = row.map((value, cIdx) => cellXml(cIdx, rIdx, value, styleForCell(sheet, rowNumber))).join('');
    const height = sheet.rowHeights && sheet.rowHeights[rowNumber];
    const heightAttrs = height ? ` ht="${height}" customHeight="1"` : '';
    return `<row r="${rowNumber}"${heightAttrs}>${cells}</row>`;
  }).join('');

  const colsXml = sheet.widths.map((width, idx) => {
    const col = idx + 1;
    return `<col min="${col}" max="${col}" width="${width}" customWidth="1"/>`;
  }).join('');

  const freezeXml = sheet.freezeRows ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : '';
  const filterXml = sheet.filter ? `<autoFilter ref="${sheet.filter}"/>` : '';
  const validationsXml = dataValidationsXml(sheet.dataValidations || []);
  const mergeCellsXml = mergeCellsXmlFor(sheet.mergeCells || []);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${freezeXml}
  <cols>${colsXml}</cols>
  <sheetData>${rowsXml}</sheetData>
  ${filterXml}
  ${mergeCellsXml}
  ${validationsXml}
</worksheet>`;
}

function styleForCell(sheet, rowNumber) {
  if ((sheet.titleRows || []).includes(rowNumber)) return 2;
  if ((sheet.subtitleRows || []).includes(rowNumber)) return 3;
  if (rowNumber === (sheet.headerRow || 1)) return 1;
  return 0;
}

function mergeCellsXmlFor(mergeCells) {
  if (!mergeCells.length) return '';
  const items = mergeCells.map((ref) => `<mergeCell ref="${ref}"/>`).join('');
  return `<mergeCells count="${mergeCells.length}">${items}</mergeCells>`;
}

function dataValidationsXml(validations) {
  if (!validations.length) return '';
  const items = validations.map((validation) => (
    `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${validation.range}"><formula1>${escapeXml(validation.formula)}</formula1></dataValidation>`
  )).join('');
  return `<dataValidations count="${validations.length}">${items}</dataValidations>`;
}

function cellXml(cIdx, rIdx, value, style) {
  const ref = `${columnName(cIdx + 1)}${rIdx + 1}`;
  if (value === null || value === undefined || value === '') return `<c r="${ref}" s="${style}"/>`;
  if (typeof value === 'number') return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

function workbookXml(sheetDefs) {
  const sheetXml = sheetDefs.map((sheet, idx) => (
    `<sheet name="${escapeXml(sheet.name)}" sheetId="${idx + 1}" r:id="rId${idx + 1}"/>`
  )).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetXml}</sheets>
</workbook>`;
}

function workbookRelsXml(count) {
  const sheetRels = Array.from({ length: count }, (_, idx) => (
    `<Relationship Id="rId${idx + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${idx + 1}.xml"/>`
  )).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheetRels}
  <Relationship Id="rId${count + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function contentTypesXml(count) {
  const sheetsXml = Array.from({ length: count }, (_, idx) => (
    `<Override PartName="/xl/worksheets/sheet${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
  )).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheetsXml}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

function rootRelsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><b/><sz val="16"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
    <font><sz val="11"/><color rgb="FF334155"/><name val="Calibri"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF0F172A"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFEFF6FF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFE5E7EB"/></left><right style="thin"><color rgb="FFE5E7EB"/></right><top style="thin"><color rgb="FFE5E7EB"/></top><bottom style="thin"><color rgb="FFE5E7EB"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="4">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function coreXml() {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Company Detector Sales Prospect Sheet</dc:title>
  <dc:creator>Company Detector Bot</dc:creator>
  <cp:lastModifiedBy>Company Detector Bot</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function appXml(sheetDefs) {
  const names = sheetDefs.map((sheet) => `<vt:lpstr>${escapeXml(sheet.name)}</vt:lpstr>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Company Detector Bot</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetDefs.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="${sheetDefs.length}" baseType="lpstr">${names}</vt:vector></TitlesOfParts>
</Properties>`;
}

function columnName(num) {
  let name = '';
  while (num > 0) {
    const rem = (num - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    num = Math.floor((num - 1) / 26);
  }
  return name;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function writeZip(outputPath, files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, data] of files.entries()) {
    const nameBuf = Buffer.from(name, 'utf8');
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralStart = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.size, 8);
  end.writeUInt16LE(files.size, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(outputPath, Buffer.concat([...localParts, ...centralParts, end]));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

module.exports = {
  writeSalesSheetXlsx,
  formatChannels,
};

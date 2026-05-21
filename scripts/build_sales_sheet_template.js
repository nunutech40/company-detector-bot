#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const outputPath = process.argv[2] || path.resolve('docs/templates/company_detector_sales_sheet_template.xlsx');
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

const pipelineHeaders = [
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

const sampleRows = [
  [
    '21 Mei 2026, 09:00 WIB',
    'Hot prospect',
    'New',
    'Baggos Media',
    'bagusmediajogja@gmail.com',
    '856288676410',
    'jenang gemi',
    'Media / e-commerce',
    'Yogyakarta',
    'Tokopedia: https://tokopedia.com/example',
    'Instagram: https://instagram.com/example',
    '',
    'Register platform',
    '',
    '',
    '',
    'http://103.226.139.107:3001/jobs/example-job-id',
  ],
  [
    '21 Mei 2026, 09:00 WIB',
    'Warm prospect',
    'New',
    'Falasik',
    'falasik@gmail.com',
    '08512895768',
    'Falasik',
    '',
    '',
    '',
    '',
    '',
    'Register platform',
    '',
    '',
    '',
    'http://103.226.139.107:3001/jobs/example-job-id-2',
  ],
];

const optionRows = [
  ['Priority', 'Sales Status', 'Source Register'],
  ['Hot prospect', 'New', 'platform_register'],
  ['Warm prospect', 'Contacted', 'webhook'],
  ['', 'Follow up later', 'manual_test'],
  ['', 'Not fit', 'queue_simulation'],
  ['', 'Won', ''],
  ['', 'Lost', ''],
];

const sheets = [
  {
    name: 'Sales Pipeline',
    rows: [pipelineHeaders, ...sampleRows],
    widths: [24, 16, 18, 26, 30, 18, 22, 20, 18, 42, 42, 30, 18, 18, 20, 36, 46],
    freeze: true,
    filter: `A1:Q${Math.max(200, sampleRows.length + 1)}`,
    dataValidations: [
      { range: 'B2:B500', formula: "'Options'!$A$2:$A$3" },
      { range: 'C2:C500', formula: "'Options'!$B$2:$B$7" },
    ],
  },
  {
    name: 'Options',
    rows: optionRows,
    widths: [18, 20, 20],
    freeze: true,
    filter: `A1:C${optionRows.length}`,
  },
];

const files = new Map();
addFile('[Content_Types].xml', contentTypesXml(sheets.length));
addFile('_rels/.rels', rootRelsXml());
addFile('docProps/core.xml', coreXml());
addFile('docProps/app.xml', appXml(sheets));
addFile('xl/workbook.xml', workbookXml(sheets));
addFile('xl/_rels/workbook.xml.rels', workbookRelsXml(sheets.length));
addFile('xl/styles.xml', stylesXml());
for (let i = 0; i < sheets.length; i += 1) {
  addFile(`xl/worksheets/sheet${i + 1}.xml`, worksheetXml(sheets[i]));
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
writeZip(outputPath, files);
console.log(outputPath);

function addFile(name, content) {
  files.set(name, Buffer.from(content, 'utf8'));
}

function worksheetXml(sheet) {
  const rowsXml = sheet.rows.map((row, rIdx) => {
    const cells = row.map((value, cIdx) => cellXml(cIdx, rIdx, value, rIdx === 0 ? 1 : 0)).join('');
    return `<row r="${rIdx + 1}">${cells}</row>`;
  }).join('');

  const colsXml = sheet.widths.map((width, idx) => {
    const col = idx + 1;
    return `<col min="${col}" max="${col}" width="${width}" customWidth="1"/>`;
  }).join('');

  const freezeXml = sheet.freeze ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
  const filterXml = sheet.filter ? `<autoFilter ref="${sheet.filter}"/>` : '';
  const validationsXml = dataValidationsXml(sheet.dataValidations || []);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${freezeXml}
  <cols>${colsXml}</cols>
  <sheetData>${rowsXml}</sheetData>
  ${filterXml}
  ${validationsXml}
</worksheet>`;
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
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${escapeXml(String(value))}</t></is></c>`;
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
  <fonts count="2">
    <font><sz val="11"/><color rgb="FF111827"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F2937"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FFE5E7EB"/></left><right style="thin"><color rgb="FFE5E7EB"/></right><top style="thin"><color rgb="FFE5E7EB"/></top><bottom style="thin"><color rgb="FFE5E7EB"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function coreXml() {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Company Detector Sales Prospect Sheet Template</dc:title>
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
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheetDefs.length}</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="${sheetDefs.length}" baseType="lpstr">${names}</vt:vector></TitlesOfParts>
</Properties>`;
}

function writeZip(targetPath, fileMap) {
  const entries = [];
  let offset = 0;
  const localParts = [];
  const centralParts = [];

  for (const [name, data] of fileMap.entries()) {
    const compressed = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    localParts.push(local, compressed);

    entries.push({ nameBuf, crc, compressedSize: compressed.length, size: data.length, offset });
    offset += local.length + compressed.length;
  }

  const centralStart = offset;
  for (const entry of entries) {
    const central = Buffer.alloc(46 + entry.nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.compressedSize, 20);
    central.writeUInt32LE(entry.size, 24);
    central.writeUInt16LE(entry.nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(entry.offset, 42);
    entry.nameBuf.copy(central, 46);
    centralParts.push(central);
    offset += central.length;
  }

  const centralSize = offset - centralStart;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(targetPath, Buffer.concat([...localParts, ...centralParts, end]));
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function columnName(n) {
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
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

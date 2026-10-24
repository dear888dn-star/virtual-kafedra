import { strToU8, zipSync } from 'fflate';
import { parseMarkdown, type Block, type Inline } from '../shared/markdown';

// Minimal .docx: Markdown daraxtidan to'g'ridan-to'g'ri OOXML yasaydi (faqat fflate zip uchun).

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** XML uchun belgilarni almashtiradi va XML'da taqiqlangan boshqaruv belgilarini olib tashlaydi. */
export function xmlEscape(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface RunProps {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

function runs(nodes: Inline[], p: RunProps = {}): string {
  return nodes
    .map((n): string => {
      switch (n.t) {
        case 'text':
          return run(n.v, p);
        case 'code':
          return run(n.v, { ...p, code: true });
        case 'strong':
          return runs(n.c, { ...p, bold: true });
        case 'em':
          return runs(n.c, { ...p, italic: true });
        case 'link':
          return runs(n.c, p) + run(` (${n.href})`, { ...p, italic: true });
      }
    })
    .join('');
}

function run(text: string, p: RunProps): string {
  if (!text) return '';
  const props =
    (p.bold ? '<w:b/>' : '') +
    (p.italic ? '<w:i/>' : '') +
    (p.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:sz w:val="20"/>' : '');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

const para = (inner: string, style?: string, indent = 0): string =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${indent ? `<w:ind w:left="${indent}"/>` : ''}</w:pPr>${inner}</w:p>`;

function block(b: Block, indent = 0): string {
  switch (b.t) {
    case 'h':
      return para(runs(b.c), `Heading${Math.min(b.level, 3)}`);
    case 'p':
      return para(runs(b.c), undefined, indent);
    case 'list':
      return b.items
        .map((it, i) => para(run(b.ordered ? `${i + 1}. ` : '• ', {}) + runs(it), undefined, indent + 360))
        .join('');
    case 'code':
      return b.v
        .split('\n')
        .map((l) => para(run(l, { code: true }), undefined, indent + 240))
        .join('');
    case 'quote':
      return b.c.map((x) => block(x, indent + 480)).join('');
    case 'hr':
      return '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr></w:pPr></w:p>';
    case 'table': {
      const cell = (c: Inline[], bold: boolean) =>
        `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${para(runs(c, { bold }))}</w:tc>`;
      const row = (cells: Inline[][], bold: boolean) => `<w:tr>${cells.map((c) => cell(c, bold)).join('')}</w:tr>`;
      const border = (n: string) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`;
      return (
        `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders></w:tblPr>` +
        row(b.head, true) +
        b.rows.map((r) => row(r, false)).join('') +
        '</w:tbl>' +
        para('')
      );
    }
  }
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

/** Markdown matnidan .docx fayl baytlarini yasaydi. */
export function markdownToDocx(md: string): Uint8Array {
  const body = parseMarkdown(md).map((b) => block(b)).join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(ROOT_RELS),
    'word/document.xml': strToU8(doc),
    'word/styles.xml': strToU8(STYLES),
    'word/_rels/document.xml.rels': strToU8(DOC_RELS),
  });
}

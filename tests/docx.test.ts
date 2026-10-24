import assert from 'node:assert/strict';
import { test } from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { markdownToDocx, xmlEscape } from '../src/export/docx';

const MD = `# Sarlavha & "tirnoq"

Matn **qalin**, *kursiv*, \`kod\` va [havola](https://example.com).

- bir <b>
- ikki

| A | B |
|---|---|
| 1 | 2 |

\`\`\`
x < y
\`\`\`
`;

test('docx: to\'g\'ri zip tuzilmasi va XML belgilari escape qilinadi', () => {
  const files = unzipSync(markdownToDocx(MD));
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml']);
  const doc = strFromU8(files['word/document.xml']!);
  assert.match(doc, /Sarlavha &amp; &quot;tirnoq&quot;/);
  assert.match(doc, /bir &lt;b&gt;/);
  assert.match(doc, /<w:b\/>/);
  assert.match(doc, /<w:tbl>/);
  assert.match(doc, /x &lt; y/);
  assert.match(doc, /https:\/\/example\.com/);
  assert.ok(!/<b>/.test(doc), 'xom HTML qolmasligi kerak');
});

test('docx: boshqaruv belgilari olib tashlanadi, bo\'sh matn ham ishlaydi', () => {
  assert.equal(xmlEscape('a\u0000b\u0008c'), 'abc');
  const files = unzipSync(markdownToDocx(''));
  assert.match(strFromU8(files['word/document.xml']!), /<w:body>/);
});

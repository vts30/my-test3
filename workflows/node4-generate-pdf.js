// Reads ALL articles from previous node and generates one combined PDF
const articles = $input.all().map(item => item.json);

// ── CP1252 encoding ───────────────────────────────────────────────────────────
function toCP1252(str) {
  const extra = {
    0x20AC:0x80, 0x201A:0x82, 0x0192:0x83, 0x201E:0x84, 0x2026:0x85,
    0x2020:0x86, 0x2021:0x87, 0x02C6:0x88, 0x2030:0x89, 0x0160:0x8A,
    0x2039:0x8B, 0x0152:0x8C, 0x017D:0x8E, 0x2018:0x91, 0x2019:0x92,
    0x201C:0x93, 0x201D:0x94, 0x2022:0x95, 0x2013:0x96, 0x2014:0x97,
    0x02DC:0x98, 0x2122:0x99, 0x0161:0x9A, 0x203A:0x9B, 0x0153:0x9C,
    0x017E:0x9E, 0x0178:0x9F,
  };
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (extra[c] !== undefined) bytes.push(extra[c]);
    else if (c <= 0xFF) bytes.push(c);
    else bytes.push(63);
  }
  return bytes;
}

function pdfStr(str) {
  const bytes = toCP1252(str);
  let s = '(';
  for (const b of bytes) {
    if (b === 40) s += '\\(';
    else if (b === 41) s += '\\)';
    else if (b === 92) s += '\\\\';
    else if (b > 127) s += '\\' + b.toString(8).padStart(3, '0');
    else s += String.fromCharCode(b);
  }
  return s + ')';
}

// ── Text measurement ──────────────────────────────────────────────────────────
const HW = {
  ' ':278,'!':278,'"':355,'#':556,'$':556,'%':889,'&':667,"'":222,
  '(':333,')':333,'*':389,'+':584,',':278,'-':333,'.':278,'/':278,
  '0':556,'1':556,'2':556,'3':556,'4':556,'5':556,'6':556,'7':556,
  '8':556,'9':556,':':278,';':278,'<':584,'=':584,'>':584,'?':556,
  '@':1015,'A':667,'B':667,'C':722,'D':722,'E':667,'F':611,'G':778,
  'H':722,'I':278,'J':500,'K':667,'L':556,'M':833,'N':722,'O':778,
  'P':667,'Q':778,'R':722,'S':667,'T':611,'U':722,'V':667,'W':944,
  'X':667,'Y':667,'Z':611,'[':278,'\\':278,']':278,'^':469,'_':556,
  '`':333,'a':556,'b':556,'c':500,'d':556,'e':556,'f':278,'g':556,
  'h':556,'i':222,'j':222,'k':500,'l':222,'m':833,'n':556,'o':556,
  'p':556,'q':556,'r':333,'s':500,'t':278,'u':556,'v':500,'w':722,
  'x':500,'y':500,'z':500,
};

function textWidth(str, size) {
  let w = 0;
  for (const c of str) w += (HW[c] || 556) * size / 1000;
  return w;
}

function wrapLines(str, size, maxW) {
  const result = [];
  for (const para of (str || '').split('\n')) {
    if (!para.trim()) { result.push(''); continue; }
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (line && textWidth(test, size) > maxW) { result.push(line); line = word; }
      else line = test;
    }
    if (line) result.push(line);
  }
  return result;
}

// ── Layout ────────────────────────────────────────────────────────────────────
const W = 595, H = 842, ML = 50, MT = 50, MB = 50;
const TW = W - ML - 50;

const items = [];
const addLine = (text, bold, size, r, g, b, spaceAfter = 0) =>
  items.push({ text, bold, size, r, g, b, spaceAfter });

for (let idx = 0; idx < articles.length; idx++) {
  const { title, teaser, topic, source, author, published } = articles[idx];

  // Separator line between articles (except before the first)
  if (idx > 0) {
    addLine('────────────────────────────────────────────────────', false, 9, 0.8, 0.8, 0.8, 8);
  }

  if (topic) addLine(topic.toUpperCase(), false, 9, 0.0, 0.4, 0.8, 4);

  for (const l of wrapLines(title || 'Untitled', 15, TW))
    addLine(l, true, 15, 0.1, 0.1, 0.1, 2);

  const meta = [source, author ? '| '+author : null, published ? '| '+published : null]
    .filter(Boolean).join('  ');
  if (meta) addLine(meta, false, 8, 0.5, 0.5, 0.5, 6);

  for (const l of wrapLines(teaser, 11, TW))
    addLine(l, false, 11, 0.15, 0.15, 0.15, 0);

  addLine('', false, 6, 0, 0, 0, 8);
}

// ── Paginate ──────────────────────────────────────────────────────────────────
const pages = [[]];
let curY = H - MT;

for (const item of items) {
  const lineH = item.size * 1.3 + item.spaceAfter;
  if (!item.text) { curY -= lineH; continue; }
  if (curY - item.size * 1.3 < MB) { pages.push([]); curY = H - MT; }
  pages[pages.length - 1].push({ ...item, y: curY });
  curY -= lineH;
}

// ── Content streams ───────────────────────────────────────────────────────────
const streams = pages.map(pageItems => {
  let s = '';
  for (const item of pageItems) {
    const font = item.bold ? 'F2' : 'F1';
    s += `${item.r.toFixed(3)} ${item.g.toFixed(3)} ${item.b.toFixed(3)} rg\n`;
    s += `BT /${font} ${item.size} Tf ${ML} ${Math.round(item.y)} Td ${pdfStr(item.text)} Tj ET\n`;
  }
  return s;
});

// ── Assemble PDF ──────────────────────────────────────────────────────────────
const N = pages.length;
const streamBase = 5, pageBase = 5 + N;
let pdf = '%PDF-1.4\n';
const offsets = {};

const addObj = (n, body) => {
  offsets[n] = pdf.length;
  pdf += `${n} 0 obj\n${body}\nendobj\n`;
};

addObj(1, '<< /Type /Catalog /Pages 2 0 R >>');
addObj(2, `<< /Type /Pages /Kids [${Array.from({length:N},(_,i)=>`${pageBase+i} 0 R`).join(' ')}] /Count ${N} >>`);
addObj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
addObj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

for (let i = 0; i < N; i++) {
  const s = streams[i];
  addObj(streamBase + i, `<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
}
for (let i = 0; i < N; i++) {
  addObj(pageBase + i,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
    `/Contents ${streamBase+i} 0 R ` +
    `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`);
}

const xrefPos = pdf.length;
const total = pageBase + N;
pdf += `xref\n0 ${total+1}\n0000000000 65535 f \n`;
for (let i = 1; i <= total; i++)
  pdf += String(offsets[i]||0).padStart(10,'0') + ' 00000 n \n';
pdf += `trailer\n<< /Size ${total+1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

const buf = Buffer.from(pdf, 'latin1');
const today = new Date().toISOString().split('T')[0];
const fileName = `briefing_${today}.pdf`;
const binaryData = await this.helpers.prepareBinaryData(buf, fileName, 'application/pdf');

return [{ binary: { data: binaryData } }];

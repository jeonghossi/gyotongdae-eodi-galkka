// 엑셀(…_데이터.xlsx)을 읽어 public/data/places.json 을 다시 만든다.
// 사용: node tools/update-data.js "엑셀 파일 경로"
// 읽는 시트: 맛집_카테고리, 숨은장소, 생활꿀팁, 자유  (시트 이름과 머리글을 바꾸면 안 됨)

const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');

const N = '확인 안 됨';
const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('엑셀 파일을 찾지 못했어요: ' + (file || '(경로 없음)')); process.exit(1); }

const text = v => {
  if (v == null) return '';
  if (typeof v === 'object') v = v.text ?? v.hyperlink ?? v.result ?? (v.richText ? v.richText.map(r => r.text).join('') : '');
  const s = String(v).trim();
  return s === N ? '' : s;
};

function rows(ws) {
  const head = ws.getRow(1).values.slice(1).map(h => String(h).trim());
  const out = [];
  ws.eachRow((row, i) => {
    if (i === 1) return;
    const o = {};
    // 같은 머리글이 두 번 있으면 왼쪽 것만 씀 (맛집_카테고리 시트 오른쪽의 '가게 수' 표 무시)
    head.forEach((h, k) => { if (h && !(h in o)) o[h] = row.getCell(k + 1).value; });
    if (text(o['이름'])) out.push(o);
  });
  return out;
}

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheet = name => { const ws = wb.getWorksheet(name); if (!ws) throw new Error(`"${name}" 시트가 없어요`); return rows(ws); };

  const food = sheet('맛집_카테고리').map(r => {
    const p = r['1인 가격(원)'];
    return { n: text(r['이름']), c: text(r['카테고리']) || '기타', m: text(r['대표메뉴']), p: typeof p === 'number' ? p : null,
      s: ['O', 'X'].includes(text(r['혼밥'])) ? text(r['혼밥']) : '', l: text(r['위치']), u: text(r['지도']), r: Number(r['추천 수']) || 1 };
  });
  const spot = sheet('숨은장소').map(r => ({ n: text(r['이름']), a: text(r['권역']) || N, g: text(r['용도']) || '기타', h: text(r['이용 시간']),
    k: text(r['이용 조건']), l: text(r['위치']), u: text(r['지도']), r: Number(r['추천 수']) || 1 }));
  const tip = name => sheet(name).map(r => ({ n: text(r['이름']), t: text(r['주제']) || '기타', g: text(r['핵심 내용']), q: text(r['필요한 것']),
    w: text(r['언제']), l: text(r['위치']), u: text(r['지도']), r: Number(r['추천 수']) || 1 }));

  const data = { food, cats: [...new Set(food.map(f => f.c))], spot, tip: tip('생활꿀팁'), free: tip('자유') };
  const out = path.join(__dirname, '..', 'public', 'data', 'places.json');
  fs.writeFileSync(out, JSON.stringify(data));
  console.log(`완료: 맛집 ${food.length} · 숨은장소 ${spot.length} · 생활꿀팁 ${data.tip.length} · 자유 ${data.free.length}`);
})().catch(e => { console.error('실패: ' + e.message); process.exit(1); });

// 엑셀에서 같은 내용이 두 번 들어간 것을 하나로 합침 (제출한 과제 엑셀은 그대로 두고, 사이트 데이터에서만)
// update-data.js 가 엑셀을 읽은 뒤 자동으로 씀. 따로 실행하면 지금 places.json 에 바로 적용:
//   node tools/merge-duplicates.js
// 합칠 때: drop 쪽 줄은 빼고, 추천 수는 keep 쪽에 더하고, set 의 값으로 내용을 고쳐 씀
const MERGES = [
  { keep: ['tip', '모바일 학생증 쓰는 법'], drop: ['free', '모바일 학생증 쓰는 법'],
    set: { g: '스마트모바일 앱 → 모바일학생증(스마트신분증). 도서관 출입·대출·좌석예약에 쓴다' } },
  { keep: ['tip', '국가근로장학금'], drop: ['free', '국가근로장학금 신청'],
    set: { g: '한국장학재단에 신청하고 희망근로지도 꼭 신청(1순위 우선 선발). 교내 시급 10,320원' } },
  { keep: ['tip', '교내 와이파이 연결'], drop: ['free', '교내 와이파이 (KNUT_5G·eduroam)'],
    set: { g: 'WI_KNUT 접속 후 무선 등록 페이지에 학교 아이디·비밀번호 입력. 일부 건물은 KNUT_5G, 다른 대학에선 eduroam' } },
  { keep: ['tip', '충주 버스는 카카오맵으로'], drop: ['free', '버스는 카카오맵으로'],
    set: { g: '버스 시간은 카카오맵 실시간이 정확하다(네이버지도는 잘 안 맞음). 금·일 서울↔충주 버스는 일주일 전 매진' } },
  { keep: ['spot', '휴스퀘어관'], drop: ['spot', '휴스퀘어동'],
    set: { l: '충북 충주시 대소원면 대학로 50 (W5)' } },
  { keep: ['spot', '인문사회관 소극장'], drop: ['spot', '인문사회예술대학(인사대)'],
    set: { l: '충북 충주시 대소원면 대학로 50 (E14, 인문사회예술대학)' } },
];

function mergeDuplicates(data, log = () => {}) {
  for (const m of MERGES) {
    const keep = (data[m.keep[0]] || []).find(x => x.n === m.keep[1]);
    const i = (data[m.drop[0]] || []).findIndex(x => x.n === m.drop[1]);
    if (!keep || i < 0) continue; // 엑셀에서 이미 고쳤으면 건너뜀
    keep.r += data[m.drop[0]][i].r;
    Object.assign(keep, m.set);
    data[m.drop[0]].splice(i, 1);
    log(`  합침: ${m.drop[1]} → ${m.keep[1]}`);
  }
  return data;
}

module.exports = { mergeDuplicates, MERGES };

if (require.main === module) {
  const fs = require('fs'), path = require('path');
  const file = path.join(__dirname, '..', 'public', 'data', 'places.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  mergeDuplicates(data, console.log);
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(`완료: 맛집 ${data.food.length} · 숨은장소 ${data.spot.length} · 생활꿀팁 ${data.tip.length} · 자유 ${data.free.length}`);
}

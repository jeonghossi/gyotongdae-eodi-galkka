// 관리자 키 정하기 → admin-key.local.json (저장소에 올리지 않음)
// 실행: node tools/set-admin-key.js  → 키를 입력하면 키 자체는 저장하지 않고 변환한 값(해시)만 저장
// 키는 띄어쓰기를 포함해도 되고, 대소문자는 구분하지 않음. 바꾼 뒤에는 서버를 다시 켜야 적용됨
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const OUT = path.join(__dirname, '..', 'admin-key.local.json');
const fnv = s => { let h = 0x811c9dc5; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('관리자 키 (8자 이상): ', answer => {
  rl.close();
  const key = answer.trim().toLowerCase();
  if (key.length < 8) { console.log('8자 이상으로 정해 주세요.'); process.exit(1); }
  const sha = crypto.createHash('sha256').update('kd-admin:' + key).digest('hex');
  fs.writeFileSync(OUT, JSON.stringify({ sha, fnv: fnv(key), len: [...key].length }, null, 1) + '\n');
  console.log('저장했어요: ' + OUT + '\n서버를 다시 켜면 새 키로 들어갈 수 있어요.');
});

// 교통대 어디 갈까 — 로컬 서버
// public/ 폴더의 웹페이지를 보여주고,
//  - 실시간 수다(채팅): 접속한 사람끼리 전달만 하고 저장하지 않는다.
//  - 리뷰(댓글)·추천/비추천: storage/reviews.json 에 저장하고, 바뀌면 모두에게 알린다.
// 실행: node server.js  (또는 실행하기.bat 더블클릭)

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const ai = require('./ai');          // AI 도우미 (로컬 LLM: Ollama)

const PORT = Number(process.env.PORT) || 3100; // 3000번은 다른 프로젝트와 겹칠 때가 많아서 3100 사용
const ROOT = path.join(__dirname, 'public');
const STORE = path.join(__dirname, 'storage', 'reviews.json');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

const clients = new Set();          // 지금 연결된 브라우저들 (채팅·리뷰 알림)
const lastChat = new Map();         // 도배 방지: IP별 마지막 채팅 시각
const lastComment = new Map();      // 도배 방지: IP별 마지막 리뷰 시각

// ---------- 공통 ----------
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
const sendCount = () => broadcast('count', String(clients.size));
const reply = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const ipOf = req => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
// 디시 유동닉처럼 IP 앞 두 자리만 보여줌. 내 PC에서 쓴 글은 "내 PC"
const ipLabel = ip => (ip === '127.0.0.1' || ip === '::1') ? '내 PC' : (/^\d+\.\d+\./.test(ip) ? ip.split('.').slice(0, 2).join('.') : '외부');

function readBody(req, max = 4000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > max) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } });
  });
}

// ---------- 리뷰 저장소 ----------
let db = { items: {} };
try { db = JSON.parse(fs.readFileSync(STORE, 'utf8')); } catch (e) { /* 처음 실행: 빈 저장소 */ }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    const tmp = STORE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, STORE);
  }, 200);
}
// 리뷰를 달 수 있는 곳 = places.json 에 있는 이름들 (엑셀을 갱신하면 다시 읽음)
let validKeys = new Set();
function loadKeys() {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'places.json'), 'utf8'));
    validKeys = new Set(['food', 'spot', 'tip', 'free'].flatMap(t => (d[t] || []).map(x => `${t}:${x.n}`)));
  } catch (e) { validKeys = new Set(); }
}
loadKeys();
const isValid = key => validKeys.has(key) || (loadKeys(), validKeys.has(key));
const item = key => (db.items[key] ||= { up: 0, down: 0, voters: {}, ips: {}, comments: [] });
const summaryOf = key => { const it = db.items[key]; return { key, up: it ? it.up : 0, down: it ? it.down : 0, n: it ? it.comments.length : 0 }; };
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');
const publicComments = it => it.comments.map(c => ({ id: c.id, name: c.name, ip: c.ipLabel, text: c.text, at: c.at }));

async function api(req, res, url) {
  const p = url.pathname;
  if (req.method === 'GET' && p === '/api/reviews/summary') {
    const out = {};
    for (const k of Object.keys(db.items)) out[k] = summaryOf(k);
    return reply(res, 200, out);
  }
  if (req.method === 'GET' && p === '/api/reviews') {
    const key = url.searchParams.get('key') || '';
    if (!isValid(key)) return reply(res, 404, { error: '없는 장소예요' });
    const it = db.items[key], token = url.searchParams.get('token') || '', ip = ipOf(req);
    const my = it ? (it.voters[token] || it.ips[ip] || null) : null;
    return reply(res, 200, { ...summaryOf(key), my, comments: it ? publicComments(it) : [] });
  }
  if (req.method !== 'POST') return reply(res, 405, { error: '지원하지 않는 요청이에요' });

  let m;
  try { m = await readBody(req); } catch (e) { return reply(res, 400, { error: '잘못된 요청이에요' }); }
  const key = String(m.key || '');
  if (!isValid(key)) return reply(res, 404, { error: '없는 장소예요' });
  const ip = ipOf(req);

  if (p === '/api/vote') {
    const dir = m.dir === 'up' ? 'up' : m.dir === 'down' ? 'down' : null;
    const token = clean(m.token, 40);
    if (!dir || !token) return reply(res, 400, { error: '잘못된 요청이에요' });
    const it = item(key);
    const done = it.voters[token] || it.ips[ip];
    if (done) return reply(res, 409, { error: done === 'up' ? '이미 추천했어요.' : '이미 비추천했어요.', ...summaryOf(key), my: done });
    it[dir] += 1; it.voters[token] = dir; it.ips[ip] = dir;
    save(); broadcast('review', summaryOf(key));
    return reply(res, 200, { ...summaryOf(key), my: dir });
  }

  if (p === '/api/comment') {
    const name = clean(m.name, 12) || 'ㅇㅇ';
    const pw = String(m.pw || '');
    const text = String(m.text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 300);
    if (!text) return reply(res, 400, { error: '내용을 입력해 주세요.' });
    if (pw.length < 4 || pw.length > 20) return reply(res, 400, { error: '비밀번호는 4~20자로 정해 주세요. 지울 때 필요해요.' });
    const now = Date.now();
    if (now - (lastComment.get(ip) || 0) < 5000) return reply(res, 429, { error: '리뷰는 5초에 한 번만 쓸 수 있어요.' });
    lastComment.set(ip, now);
    const it = item(key);
    if (it.comments.length >= 500) return reply(res, 400, { error: '이 장소는 리뷰가 꽉 찼어요.' });
    const salt = crypto.randomBytes(8).toString('hex');
    it.comments.push({ id: crypto.randomBytes(6).toString('hex'), name, ipLabel: ipLabel(ip), text, at: now, salt, pw: hash(pw, salt) });
    save(); broadcast('review', summaryOf(key));
    return reply(res, 200, { ...summaryOf(key), comments: publicComments(it) });
  }

  if (p === '/api/comment/delete') {
    const it = db.items[key];
    const c = it && it.comments.find(x => x.id === m.id);
    if (!c) return reply(res, 404, { error: '이미 지워진 리뷰예요.' });
    if (hash(String(m.pw || ''), c.salt) !== c.pw) return reply(res, 403, { error: '비밀번호가 맞지 않아요.' });
    it.comments = it.comments.filter(x => x !== c);
    save(); broadcast('review', summaryOf(key));
    return reply(res, 200, { ...summaryOf(key), comments: publicComments(it) });
  }
  return reply(res, 404, { error: '없는 요청이에요' });
}

// ---------- 정보 제보 (storage/reports.json) ----------
// 누구나 제보할 수 있고, 목록 보기·처리는 이 서버를 켠 PC(내 PC)에서만 가능
const REPORTS = path.join(__dirname, 'storage', 'reports.json');
const lastReport = new Map();       // 도배 방지: IP별 마지막 제보 시각
let reports = [];
try { reports = JSON.parse(fs.readFileSync(REPORTS, 'utf8')); } catch (e) { /* 처음 실행 */ }
function saveReports() {
  fs.mkdirSync(path.dirname(REPORTS), { recursive: true });
  fs.writeFileSync(REPORTS + '.tmp', JSON.stringify(reports, null, 1));
  fs.renameSync(REPORTS + '.tmp', REPORTS);
}
const isLocal = req => ['127.0.0.1', '::1'].includes(ipOf(req));
// 관리자 출입증: 관리자 키를 맞히면 쿠키(kd_admin)를 줌. 서버를 끄면 출입증도 사라짐
// 키의 해시는 저장소에 올리지 않는 admin-key.local.json 에만 둠 (없으면 관리자 기능 꺼짐)
// 만들기: node tools/set-admin-key.js
let ADMIN = null;
try { ADMIN = JSON.parse(fs.readFileSync(path.join(__dirname, 'admin-key.local.json'), 'utf8')); } catch (e) {}
const adminHint = (req, res) => ADMIN && isLocal(req) ? reply(res, 200, { fnv: ADMIN.fnv, len: ADMIN.len }) : reply(res, 404, { error: '없는 요청이에요' });
const ADMIN_TTL = 12 * 60 * 60 * 1000;   // 12시간
const adminSessions = new Map();         // 출입증 → 만료 시각
const adminTries = new Map();            // IP → 최근 시도 시각들 (1분에 5번까지)
const cookieOf = (req, name) => (String(req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(name + '=')) || '').slice(name.length + 1);
const isAdmin = req => {
  if (!isLocal(req)) return false;
  const t = cookieOf(req, 'kd_admin'), exp = adminSessions.get(t);
  if (!exp) return false;
  if (exp < Date.now()) { adminSessions.delete(t); return false; }
  return true;
};
async function adminEnter(req, res) {
  if (!isLocal(req) || !ADMIN) return reply(res, 404, { error: '없는 요청이에요' });
  const ip = ipOf(req), now = Date.now();
  const tries = (adminTries.get(ip) || []).filter(t => now - t < 60000);
  if (tries.length >= 5) return reply(res, 429, { error: '잠시 후 다시 시도해 주세요.' });
  tries.push(now); adminTries.set(ip, tries);
  let m;
  try { m = await readBody(req, 500); } catch (e) { return reply(res, 400, { error: '잘못된 요청이에요' }); }
  const sha = crypto.createHash('sha256').update('kd-admin:' + String(m.key || '').toLowerCase()).digest('hex');
  if (sha !== ADMIN.sha) return reply(res, 403, { error: '키가 맞지 않아요.' });
  const token = crypto.randomBytes(24).toString('hex');
  adminSessions.set(token, now + ADMIN_TTL);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Set-Cookie': `kd_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ADMIN_TTL / 1000}` });
  res.end(JSON.stringify({ ok: true }));
}
function adminLeave(req, res) {
  adminSessions.delete(cookieOf(req, 'kd_admin'));
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Set-Cookie': 'kd_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  res.end(JSON.stringify({ ok: true }));
}
function notFound(res) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('없는 파일이에요'); }
const KINDS = ['정보 수정', '새 장소 추천', '폐업·이전', '기타'];
const CATS = ['맛집', '숨은장소', '생활꿀팁', '자유', '모름'];

async function reportApi(req, res, url) {
  const p = url.pathname;
  if (req.method === 'POST' && p === '/api/report') {
    let m;
    try { m = await readBody(req, 6000); } catch (e) { return reply(res, 400, { error: '잘못된 요청이에요' }); }
    const kind = KINDS.includes(m.kind) ? m.kind : '기타';
    const cat = CATS.includes(m.cat) ? m.cat : '모름';
    const target = clean(m.target, 60);
    const text = String(m.text || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1000);
    const contact = clean(m.contact, 60);
    if (text.length < 5) return reply(res, 400, { error: '내용을 5자 이상 적어 주세요.' });
    const ip = ipOf(req), now = Date.now();
    if (now - (lastReport.get(ip) || 0) < 30000) return reply(res, 429, { error: '제보는 30초에 한 번만 보낼 수 있어요.' });
    lastReport.set(ip, now);
    if (reports.length >= 2000) return reply(res, 400, { error: '제보함이 꽉 찼어요. 관리자에게 알려 주세요.' });
    reports.push({ id: crypto.randomBytes(6).toString('hex'), kind, cat, target, text, contact, from: ipLabel(ip), at: now, done: false });
    saveReports();
    console.log(`  📮 새 제보 도착 [${kind}] ${target || cat} — ${new Date(now).toLocaleTimeString('ko-KR')}  (확인: http://localhost:${PORT}/admin.html)`);
    broadcast('report', String(reports.filter(r => !r.done).length));
    return reply(res, 200, { ok: true });
  }
  if (!isAdmin(req)) return reply(res, 403, { error: '관리자만 볼 수 있어요.' });
  if (req.method === 'GET' && p === '/api/reports') return reply(res, 200, reports.slice().reverse());
  if (req.method === 'POST' && p === '/api/report/update') {
    let m;
    try { m = await readBody(req); } catch (e) { return reply(res, 400, { error: '잘못된 요청이에요' }); }
    const r = reports.find(x => x.id === m.id);
    if (!r) return reply(res, 404, { error: '없는 제보예요' });
    if (m.action === 'delete') reports = reports.filter(x => x !== r);
    else r.done = !!m.done;
    saveReports();
    return reply(res, 200, { ok: true });
  }
  return reply(res, 404, { error: '없는 요청이에요' });
}

// ---------- 관리자 (내 PC에서만) ----------
const nameOf = key => key.slice(key.indexOf(':') + 1);
const tabOf = key => key.slice(0, key.indexOf(':'));
async function adminApi(req, res, url) {
  if (!isAdmin(req)) return reply(res, 403, { error: '관리자만 쓸 수 있어요.' });
  const p = url.pathname;
  const entries = Object.entries(db.items);
  if (req.method === 'GET' && p === '/api/admin/overview') {
    const rows = entries.map(([key, it]) => ({ key, tab: tabOf(key), name: nameOf(key), up: it.up, down: it.down, n: it.comments.length }));
    return reply(res, 200, {
      online: clients.size,
      reportsTodo: reports.filter(r => !r.done).length,
      reportsTotal: reports.length,
      reviews: rows.reduce((a, r) => a + r.n, 0),
      ups: rows.reduce((a, r) => a + r.up, 0),
      downs: rows.reduce((a, r) => a + r.down, 0),
      topUp: rows.filter(r => r.up > 0).sort((a, b) => b.up - a.up || a.down - b.down).slice(0, 5),
      topReview: rows.filter(r => r.n > 0).sort((a, b) => b.n - a.n).slice(0, 5),
      topDown: rows.filter(r => r.down > 0).sort((a, b) => b.down - a.down).slice(0, 5),
    });
  }
  if (req.method === 'GET' && p === '/api/admin/reviews') {
    const list = entries.flatMap(([key, it]) => it.comments.map(c => ({ key, tab: tabOf(key), place: nameOf(key), id: c.id, name: c.name, ip: c.ipLabel, text: c.text, at: c.at })));
    return reply(res, 200, list.sort((a, b) => b.at - a.at));
  }
  if (req.method === 'GET' && p === '/api/admin/votes') {
    const list = entries.filter(([, it]) => it.up || it.down).map(([key, it]) => ({ key, tab: tabOf(key), name: nameOf(key), up: it.up, down: it.down, voters: Object.keys(it.voters).length }));
    return reply(res, 200, list.sort((a, b) => (b.up + b.down) - (a.up + a.down)));
  }
  if (req.method !== 'POST') return reply(res, 404, { error: '없는 요청이에요' });
  let m;
  try { m = await readBody(req); } catch (e) { return reply(res, 400, { error: '잘못된 요청이에요' }); }
  const it = db.items[m.key];
  if (!it) return reply(res, 404, { error: '없는 장소예요' });
  if (p === '/api/admin/review/delete') {   // 비밀번호 없이 관리자가 삭제
    const before = it.comments.length;
    it.comments = it.comments.filter(c => c.id !== m.id);
    if (it.comments.length === before) return reply(res, 404, { error: '이미 지워진 리뷰예요.' });
    save(); broadcast('review', summaryOf(m.key));
    return reply(res, 200, { ok: true });
  }
  if (p === '/api/admin/votes/reset') {     // 추천·비추천 0으로 (다시 누를 수 있게 기록도 지움)
    it.up = 0; it.down = 0; it.voters = {}; it.ips = {};
    save(); broadcast('review', summaryOf(m.key));
    return reply(res, 200, { ok: true });
  }
  return reply(res, 404, { error: '없는 요청이에요' });
}

// ---------- 채팅 (저장 안 함) ----------
async function onChat(req, res) {
  let m;
  try { m = await readBody(req, 2000); } catch (e) { return reply(res, 400, { error: '잘못된 요청이에요' }); }
  const text = clean(m.text, 80), id = clean(m.id, 16); // 익명 채팅: 이름은 받지도 보내지도 않음
  if (!text) return reply(res, 400, { error: '내용을 입력해 주세요' });
  const ip = ipOf(req), now = Date.now();
  if (now - (lastChat.get(ip) || 0) < 1000) return reply(res, 429, { error: '조금 천천히 보내 주세요.' });
  lastChat.set(ip, now);
  broadcast('chat', { id, text });
  reply(res, 200, { ok: true });
}

// ---------- 파일·알림 ----------
function serveFile(req, res, url) {
  const urlPath = decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('없는 파일이에요'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}

function onEvents(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('retry: 3000\n\n');
  clients.add(res);
  sendCount();
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); sendCount(); });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/events') return onEvents(req, res);
  if (req.method === 'POST' && url.pathname === '/chat') return onChat(req, res);
  if (req.method === 'POST' && url.pathname === '/api/ai') return readBody(req, 8000).then(b => ai.handle(req, res, b, ipOf(req)), () => reply(res, 400, { error: '잘못된 요청이에요' }));
  if (req.method === 'POST' && url.pathname === '/api/admin/enter') return adminEnter(req, res).catch(e => { console.error(e); reply(res, 500, { error: '서버 오류가 났어요' }); });
  if (req.method === 'POST' && url.pathname === '/api/admin/leave') return adminLeave(req, res);
  if (req.method === 'GET' && url.pathname === '/api/admin/hint') return adminHint(req, res);
  if (url.pathname.startsWith('/api/admin/')) return adminApi(req, res, url).catch(e => { console.error(e); reply(res, 500, { error: '서버 오류가 났어요' }); });
  if (url.pathname.startsWith('/api/report')) return reportApi(req, res, url).catch(e => { console.error(e); reply(res, 500, { error: '서버 오류가 났어요' }); });
  if (url.pathname === '/admin.html' && !isAdmin(req)) return notFound(res); // 키로 들어온 관리자만, 아니면 '없는 파일'
  if (url.pathname.startsWith('/api/')) return api(req, res, url).catch(e => { console.error(e); reply(res, 500, { error: '서버 오류가 났어요' }); });
  if (req.method === 'GET') return serveFile(req, res, url);
  res.writeHead(405); res.end();
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.log(`
  [실행 실패] ${PORT}번 포트를 다른 프로그램이 쓰고 있어요.
  그 프로그램을 끄거나, 이미 이 사이트가 켜져 있다면 http://localhost:${PORT} 로 들어가세요.
`);
  else console.log('  [실행 실패] ' + e.message);
  process.exit(1);
});
server.listen(PORT, () => {
  // 서버가 켜진 뒤에 브라우저 열기 (실행하기.bat 에서 OPEN_BROWSER=1 로 실행)
  if (process.env.OPEN_BROWSER) require('child_process').exec(`start "" http://localhost:${PORT}`);
  const lan = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
  console.log('');
  console.log('  교통대 어디 갈까 — 실행 중');
  console.log(`  내 PC에서:        http://localhost:${PORT}`);
  lan.forEach(ip => console.log(`  같은 와이파이에서: http://${ip}:${PORT}`));
  console.log('');
  console.log('  리뷰·추천 저장 위치: storage\\reviews.json');
  console.log(`  관리자 페이지:     http://localhost:${PORT}/admin.html  (이 PC에서만 열림)`);
  console.log(`  AI 도우미 모델:    ${ai.MODEL}  (Ollama 가 켜져 있어야 함)`);
  console.log('  끄려면 이 창을 닫거나 Ctrl + C 를 누르세요.');
});

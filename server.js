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
  console.log('  끄려면 이 창을 닫거나 Ctrl + C 를 누르세요.');
});

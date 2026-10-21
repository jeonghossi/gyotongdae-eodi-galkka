// 교통대 어디 갈까 — AI 도우미 (로컬 LLM: Ollama)
// 1) 질문에서 조건(가격·카테고리·학교 앞)과 낱말을 뽑아 우리 데이터에서 후보를 최대 8곳 고름
// 2) 그 후보만 LLM 에게 보여 주고 "이 안에서만 답하라"고 지시 → 없는 가게·가격을 지어내지 않게
// 모델은 환경변수 AI_MODEL 로 바꿀 수 있음 (기본: exaone3.5:2.4b)

const fs = require('fs');
const path = require('path');

const OLLAMA = process.env.OLLAMA_URL || 'http://localhost:11434';
const MODEL = process.env.AI_MODEL || 'exaone3.5:2.4b';
const DATA_FILE = path.join(__dirname, 'public', 'data', 'places.json');
const TAB = { food: '맛집', spot: '숨은장소', tip: '생활꿀팁', free: '자유' };

let data = null, dataMtime = 0;
function getData() {
  try {
    const m = fs.statSync(DATA_FILE).mtimeMs;
    if (!data || m !== dataMtime) { data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); dataMtime = m; }
  } catch (e) { data = data || { food: [], spot: [], tip: [], free: [] }; }
  return data;
}

// 낱말 → 맛집 카테고리 (카테고리 이름 일부로 맞춤)
const CAT_WORDS = [
  [/학식|학생식당|교직원식당/, '학식'], [/한식|백반|쌈밥|칼국수|국수|막국수|비빔밥|묵밥/, '한식'],
  [/국밥|찌개|탕|찜|해장|감자탕|순대국|부대/, '찜·탕·국밥'], [/고기|삼겹|구이|닭갈비|막창|대패/, '고기·구이'],
  [/중식|중국|짜장|짬뽕|탕수육/, '중국집'], [/돈까스|돈가스|일식|초밥|스시|우동|카츠|규카츠|회\b/, '돈까스·회·일식'],
  [/양식|파스타|스테이크|바베큐|포케|샐러드/, '양식'], [/버거|햄버거|부리또|토스트|밥버거|패스트/, '패스트푸드'],
  [/분식|떡볶이|김밥|쫄면|라면/, '분식'], [/치킨|통닭/, '치킨'], [/마라|마라탕|아시안/, '아시안'],
  [/도시락|덮밥|컵밥/, '도시락·덮밥'], [/족발|보쌈/, '족발·보쌈'],
  [/카페|커피|디저트|빵|케이크|빙수|밀크티|와플|스타벅스|스벅|투썸|이디야|메가|컴포즈|빽다방|아메리카노|라떼/, '카페·디저트'], [/술|술집|주점|맥주|소주|안주/, '술집'],
];
const FOOD_HINT = /먹|밥|메뉴|맛집|점심|저녁|아침|배고|야식|식당|가게|음식|원\b|원 이하|만원|천원/;
const STOP = new Set(['추천', '알려줘', '알려', '어디', '있어', '있나요', '어때', '좋은', '좋아', '근처', '교통대', '학교', '해줘', '뭐가', '무엇', '가고', '싶어', '하는', '곳', '데', '좀']);

function parsePrice(q) {
  let m = q.match(/(\d+(?:\.\d+)?)\s*만\s*원?/); if (m) return Math.round(parseFloat(m[1]) * 10000);
  m = q.match(/(\d+)\s*천\s*원?/); if (m) return parseInt(m[1], 10) * 1000;
  m = q.match(/(\d{4,6})\s*원/); if (m) return parseInt(m[1], 10);
  if (/만원|만 원/.test(q)) return 10000;
  return null;
}

function retrieve(question) {
  const D = getData(), q = question.toLowerCase();
  const words = (q.match(/[가-힣a-z0-9]{2,}/g) || []).filter(w => !STOP.has(w));
  const cats = CAT_WORDS.filter(([re]) => re.test(q)).map(([, c]) => c);
  const maxPrice = parsePrice(q);
  const near = /학교\s*앞|대학로|걸어서|가까운|근처/.test(q);
  const isFood = cats.length > 0 || FOOD_HINT.test(q) || maxPrice !== null;
  const hit = (text, w) => String(text || '').toLowerCase().includes(w);

  const scored = [];
  if (isFood) {
    for (const f of D.food) {
      if (maxPrice !== null && f.p !== null && f.p > maxPrice) continue;
      if (cats.length && !cats.some(c => f.c.includes(c))) continue;
      if (!cats.some(c => /카페|술집/.test(c)) && /카페|술집/.test(f.c)) continue;  // 밥 질문에 카페·술집 빼기
      let s = f.r * 0.5;
      if (maxPrice !== null && f.p !== null) s += 3;               // 가격이 확인된 곳 우선
      if (near && /대소원면/.test(f.l)) s += 2;
      for (const w of words) if (hit(f.n, w) || hit(f.m, w)) s += 3;
      scored.push({ s, tab: 'food', x: f });
    }
  } else {
    for (const tab of ['spot', 'tip', 'free']) for (const x of D[tab]) {
      let s = 0;
      for (const w of words) {
        if (hit(x.n, w)) s += 4;
        if (hit(x.g, w) || hit(x.t, w) || hit(x.a, w)) s += 2;
        if (hit(x.q, w) || hit(x.w, w) || hit(x.l, w)) s += 1;
      }
      if (/공부|시험/.test(q) && (x.g === '공부' || /공부|시험|열람/.test(x.n))) s += 3;
      if (/산책|운동|러닝|걷/.test(q) && x.g === '산책·운동') s += 3;
      if (/쉬|공강|휴식/.test(q) && x.g === '휴식') s += 3;
      if (/버스|택시|기차|터미널|교통/.test(q) && x.t === '교통') s += 3;
      if (s > 0) scored.push({ s: s + (x.r || 1) * 0.2, tab, x });
    }
  }
  return { isFood, items: scored.sort((a, b) => b.s - a.s).slice(0, 8), cond: { cats, maxPrice, near } };
}

const won = p => p.toLocaleString('ko-KR') + '원';
function describe({ tab, x }) {
  if (tab === 'food') return `- ${x.n} (${x.c}) | 대표메뉴: ${x.m || '정보 없음'} | 1인 가격: ${x.p !== null ? won(x.p) + '부터' : '정보 없음'} | 학생 추천 ${x.r}명 | 위치: ${x.l || '정보 없음'}`;
  if (tab === 'spot') return `- ${x.n} (숨은장소·${x.g}) | 권역: ${x.a} | 이용 시간: ${x.h || '정보 없음'} | 이용 조건: ${x.k || '정보 없음'}`;
  return `- ${x.n} (${TAB[tab]}·${x.t}) | 내용: ${x.g} | 필요한 것: ${x.q || '정보 없음'} | 언제: ${x.w || '정보 없음'}`;
}

// 카드에 보여 줄 사실: AI 가 아니라 데이터에서 그대로 만듦
function facts({ tab, x }) {
  if (tab === 'food') return [x.c, x.m && `대표메뉴 ${x.m}`, x.p !== null ? `1인 ${won(x.p)}부터` : '가격 정보 없음', `학생 추천 ${x.r}명`].filter(Boolean);
  if (tab === 'spot') return [`${x.g} · ${x.a}`, x.h ? `이용 시간 ${x.h}` : '', x.k ? `조건: ${x.k}` : ''].filter(Boolean);
  return [x.g, x.q ? `필요한 것: ${x.q}` : '', x.w ? `언제: ${x.w}` : ''].filter(Boolean);
}
const card = it => ({ key: it.tab + ':' + it.x.n, tab: it.tab, name: it.x.n, facts: facts(it) });

// "스타벅스 있어?"처럼 특정 이름을 찾는데 후보 이름·메뉴에 그 낱말이 없으면 → 사이트에 없는 곳
const GENERIC = /^(혼밥|밥집|맛집|식당|가게|카페|커피|근처|추천|이하|이상|가격|저렴|싼|메뉴|점심|저녁|아침|오늘|내일|학교|교통대|대학로|있어|있나|있니|있나요|어디|어딨어|어디야|알려줘|가고|싶어|먹고|공부|장소|곳|좋은|맛있는|되는|하는|만원|천원)/;
function missingName(question, items) {
  if (!/있어|있나|있니|있을까|어디야|어딨|파는\s*곳|어디서/.test(question)) return null;
  const words = (question.match(/[가-힣a-zA-Z]{2,}/g) || []).filter(w => !GENERIC.test(w) && !STOP.has(w) && !CAT_WORDS.some(([re]) => re.test(w) && !/스타벅스|스벅|투썸|이디야|메가|컴포즈|빽다방/.test(w)));
  const hay = items.map(({ x }) => `${x.n} ${x.m || ''} ${x.g || ''}`).join(' ').toLowerCase();
  const miss = words.filter(w => !hay.includes(w.toLowerCase()));
  return miss.length ? miss[0] : null;
}

const SYSTEM_PICK = [
  '너는 한국교통대학교 충주캠퍼스 "교통대 어디 갈까" 사이트의 AI 도우미야.',
  '사용자 질문과 [후보] 목록을 보고 JSON 으로만 답해.',
  '- picks: 질문에 가장 잘 맞는 후보 번호 1~3개 (목록에 있는 번호만).',
  '- intro: 질문에 공감하는 짧은 한두 문장, 친근한 한국어 존댓말. 가게 이름·가격·시간·숫자·특징은 절대 쓰지 마 (그건 화면에 따로 나와).',
].join('\n');
const SYSTEM_CHAT = [
  '너는 한국교통대학교 충주캠퍼스 "교통대 어디 갈까" 사이트의 AI 도우미야. 친근한 존댓말로 2~3문장만 답해.',
  '항상 한국어로만 답해. 영어 문장을 섞지 마.',
  '가게·장소·가격·버스 시간 같은 구체적인 정보는 절대 말하지 마 (지어낼 수 있으니까).',
  '공감하고 응원해 주고, 필요하면 "8천 원 이하 밥집", "공강 때 쉴 곳", "시내 가는 버스"처럼 물어보면 사이트 정보로 찾아 준다고 알려 줘.',
  '숙제 대신 해 주기, 위험하거나 부적절한 요청은 정중히 거절해.',
].join('\n');

async function ollama(messages, { format, signal, onDelta } = {}) {
  const r = await fetch(OLLAMA + '/api/chat', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, stream: !!onDelta, messages, format, keep_alive: '30m', options: { temperature: 0.2, num_ctx: 4096, num_predict: 300 } }),
  });
  if (!r.ok) throw new Error(r.status === 404 ? `모델 "${MODEL}"이 없어요. "ollama pull ${MODEL}"로 받아 주세요.` : `AI 오류 (${r.status})`);
  if (!onDelta) return (await r.json()).message.content;
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', all = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      const j = JSON.parse(line);
      if (j.error) throw new Error(j.error);
      if (j.message && j.message.content) { all += j.message.content; onDelta(j.message.content); }
    }
  }
  return all;
}
const historyMsgs = history => history.slice(-6)
  .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
  .map(m => ({ role: m.role, content: m.content.slice(0, 400) }));

// 서버(server.js)에서 부름. SSE 로 보냄:
//  answer {intro, cards[]}  — 장소·정보 질문 (사실은 cards 에, AI 는 intro 와 고르기만)
//  delta {text} … done      — 그냥 대화
//  error {message}
const busy = new Set();      // IP별 동시에 하나만
async function handle(req, res, body, ip) {
  const send = (ev, d) => res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`);
  const question = String(body.question || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const history = Array.isArray(body.history) ? body.history : [];
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  if (!question) { send('error', { message: '질문을 입력해 주세요.' }); return res.end(); }
  if (busy.has(ip)) { send('error', { message: '앞 질문의 답을 쓰는 중이에요. 잠시만 기다려 주세요.' }); return res.end(); }
  busy.add(ip);
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());   // '멈추기'나 창 닫기 → 생성 중단

  try {
    // 감정·잡담("시험 망쳤어", "심심해")은 정보 질문이 아니면 대화 모드로
    const asksInfo = /어디|있어|있나|알려|추천|방법|어떻게|가는 법|몇 시|언제|먹고 싶|먹을|갈 만한|가볼|찾아/.test(question);
    const feeling = /우울|힘들|망했|망쳤|슬퍼|심심|외로|피곤|짜증|스트레스|불안|지쳤|고마워|감사|안녕|반가|ㅋㅋ|ㅎㅎ|ㅠ|ㅜ/.test(question);
    const r = (feeling && !asksInfo) ? { isFood: false, items: [] } : retrieve(question);
    const looksLikeInfo = !feeling && (r.isFood || asksInfo);

    if (!r.items.length) {
      if (looksLikeInfo) {   // 정보를 물었는데 찾은 게 없음 → AI 를 부르지 않고 정해진 답
        send('answer', { intro: r.isFood
          ? '말씀하신 조건에 맞는 곳을 사이트 정보에서 찾지 못했어요. 가격이나 카테고리 조건을 조금 풀어서 다시 물어봐 주세요.'
          : '그 내용은 사이트 정보에서 찾지 못했어요. 저는 교통대 학생들이 추천한 맛집·숨은장소·생활꿀팁 안에서만 찾아 드릴 수 있어요.', cards: [] });
      } else {               // 그냥 대화 → 자유롭게, 단 구체 정보는 말하지 않게
        await ollama([{ role: 'system', content: SYSTEM_CHAT }, ...historyMsgs(history), { role: 'user', content: question }],
          { signal: ctrl.signal, onDelta: text => send('delta', { text }) });
        // 많이 힘들어 보이면 사이트에 있는 상담 꿀팁을 함께 (AI 가 아니라 데이터에서)
        if (/우울|힘들|스트레스|불안|지쳤|외로/.test(question)) {
          const D = getData(), t = D.tip.find(x => x.n === '무료 심리상담 받기');
          if (t) send('answer', { intro: '', cards: [card({ tab: 'tip', x: t })] });
        }
        send('done', {});
      }
      return;
    }

    const miss = missingName(question, r.items);
    const list = r.items.map((it, i) => `${i + 1}. ${describe(it).slice(2)}`).join('\n');
    const raw = await ollama([{ role: 'system', content: SYSTEM_PICK }, { role: 'user', content: `질문: ${question}\n\n[후보]\n${list}` }], {
      signal: ctrl.signal,
      format: { type: 'object', properties: { intro: { type: 'string' }, picks: { type: 'array', items: { type: 'integer' } } }, required: ['intro', 'picks'] },
    });
    let out = {}; try { out = JSON.parse(raw); } catch (e) {}
    let picks = [...new Set((out.picks || []).map(Number).filter(n => n >= 1 && n <= r.items.length))].slice(0, 3);
    if (!picks.length) picks = r.items.slice(0, 3).map((_, i) => i + 1);
    let intro = String(out.intro || '').trim();
    // 공감 문장에 숫자·가격이 들어가거나 비었으면 안전한 문장으로
    if (!intro || /\d|원|시간/.test(intro) || intro.length > 120) intro = r.isFood ? '조건에 맞는 곳을 골라 봤어요.' : '도움이 될 만한 곳을 찾아봤어요.';
    if (miss) intro = `"${miss}"은(는) 사이트 정보에서 찾지 못했어요. 대신 학생들이 추천한 곳을 알려 드릴게요.`;
    send('answer', { intro, cards: picks.map(n => card(r.items[n - 1])) });
  } catch (e) {
    if (e.name !== 'AbortError') {
      const msg = /ECONNREFUSED|fetch failed/.test(String(e.cause || e.message)) ? 'AI가 꺼져 있어요. 이 PC에서 Ollama를 실행해 주세요.' : e.message;
      send('error', { message: msg });
    }
  } finally {
    busy.delete(ip);   // 도배 방지: 한 사람(IP)당 동시에 질문 하나만
    res.end();
  }
}

module.exports = { handle, retrieve, missingName, MODEL };

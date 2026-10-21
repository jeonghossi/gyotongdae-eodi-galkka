// 교통대 어디 갈까 — 데이터(data/*.json)를 불러온 뒤 화면을 그림
// 서버 알림(채팅·리뷰 변경)은 연결 하나로 같이 받음
// 보기 전용판: GitHub Pages(서버 없음)나 파일을 직접 연 경우 → 리뷰·추천·채팅을 숨김
window.KD_STATIC = location.protocol === 'file:' || /.github.io$/.test(location.hostname);
document.documentElement.classList.toggle('static', window.KD_STATIC);
window.KD_ES = window.KD_STATIC ? null : new EventSource('/events');
(async () => {
let D, COORDS;
try {
  const get = f => fetch(f).then(r => { if (!r.ok) throw new Error(f); return r.json(); });
  [D, COORDS] = await Promise.all([get('data/places.json'), get('data/coords.json')]);
} catch (e) {
  document.getElementById('view').innerHTML = '<p class="empty">데이터를 불러오지 못했어요.<br>폴더의 "실행하기.bat"을 더블클릭해서 열어 주세요.</p>';
  return;
}
const STATIC = window.KD_STATIC;
if (STATIC) document.getElementById('staticNote').hidden = false;
// 관리자 페이지 숨은 입구: 화면 어디서든(또는 검색창에) 정해 둔 키를 치면 admin.html 로 이동
// 키를 변환한 값(FNV-1a)은 코드에 적지 않고, 서버가 '내 PC'에서 연 화면에만 알려 줌
const HINT = STATIC ? null : await fetch('/api/admin/hint').then(r => r.ok ? r.json() : null).catch(() => null);
if (HINT) {
  const KEY_LEN = HINT.len; // 띄어쓰기 포함 전체가 하나의 키
  const fnv = s => { let h = 0x811c9dc5; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16); };
  const hit = s => s.length >= KEY_LEN && fnv(s.slice(-KEY_LEN).toLowerCase()) === HINT.fnv;
  // 키가 맞으면 서버에 확인받아 관리자 출입증(쿠키)을 받은 뒤 이동. 다른 기기·틀린 키면 아무 일도 없음
  const goAdmin = async key => {
    try { const r = await fetch('/api/admin/enter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) }); if (r.ok) location.href = 'admin.html'; } catch (e) {}
  };
  let typed = '';
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    typed = (typed + e.key).slice(-KEY_LEN);
    if (hit(typed)) goAdmin(typed.toLowerCase());
  });
  document.getElementById('q').addEventListener('input', e => { const v = e.target.value.trim(); if (hit(v)) { e.target.value = ''; goAdmin(v.slice(-KEY_LEN).toLowerCase()); } });
}
// 보기 전용판 안내 팝업: 접속하면 뜸 ('오늘 하루 보지 않기'를 고르면 그날은 안 뜸)
if (STATIC) {
  const intro = document.getElementById('intro'), today = new Date().toDateString();
  let skip = false; try { skip = localStorage.getItem('kd-intro-skip') === today; } catch (e) {}
  const closeIntro = () => {
    if (document.getElementById('introSkip').checked) { try { localStorage.setItem('kd-intro-skip', today); } catch (e) {} }
    intro.hidden = true; document.body.style.overflow = '';
  };
  if (!skip) { intro.hidden = false; document.body.style.overflow = 'hidden'; document.getElementById('introOk').focus(); }
  document.getElementById('introOk').addEventListener('click', closeIntro);
  document.getElementById('introClose').addEventListener('click', closeIntro);
  intro.addEventListener('click', e => { if (e.target === intro) closeIntro(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !intro.hidden) closeIntro(); });
}
let SUM = {};
if (!STATIC) try { SUM = await fetch('/api/reviews/summary').then(r => r.ok ? r.json() : {}); } catch (e) {}
const TABS = [
  { id: 'food', label: '맛집', n: D.food.length },
  { id: 'spot', label: '숨은장소', n: D.spot.length },
  { id: 'tip', label: '생활꿀팁', n: D.tip.length },
  { id: 'free', label: '자유', n: D.free.length },
];
const st = { tab: 'food', q: '', cat: '', cheap: false, sort: 'rec', area: '', use: '', topic: '', view: 'list' };
try { const s = JSON.parse(localStorage.getItem('kd-tab') || 'null'); if (s && TABS.some(t => t.id === s)) st.tab = s; } catch (e) {}
const h = location.hash.slice(1); if (TABS.some(t => t.id === h)) st.tab = h;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const won = p => p.toLocaleString('ko-KR') + '원';
const has = (o, q) => !q || Object.values(o).some(v => String(v).toLowerCase().includes(q));
const unk = '<span class="unk">확인 안 됨</span>';
const mapLink = u => u ? `<a class="map" href="${esc(u)}" target="_blank" rel="noopener">지도 보기 →</a>` : '';
const chips = (label, key, values) => `<span class="lbl">${label}</span>` + ['', ...values].map(v =>
  `<button class="chip" data-k="${key}" data-v="${esc(v)}" aria-pressed="${st[key] === v}">${v || '전체'}</button>`).join('');
const uniq = (arr, k) => [...new Set(arr.map(x => x[k]))];
const BEST = 5; // 추천이 이만큼 넘으면 '개념' 표시
const keyOf = (tab, x) => tab + ':' + x.n;
const vbarInner = key => { const v = SUM[key] || { up: 0, down: 0, n: 0 };
  return `${v.up >= BEST ? '<span class="best">개념</span>' : ''}<span class="vu">추천 <b>${v.up}</b></span><span class="vd">비추천 <b>${v.down}</b></span><span class="vc">리뷰 <b>${v.n}</b></span>`; };
const vbar = key => STATIC ? '' : `<div class="vbar"><span class="vnums" data-vk="${esc(key)}">${vbarInner(key)}</span><button type="button" class="open-rv" data-open="${esc(key)}">리뷰·추천 →</button></div>`;

function renderTabs() {
  document.getElementById('tabs').innerHTML = TABS.map(t =>
    `<button role="tab" data-tab="${t.id}" aria-selected="${st.tab === t.id}">${t.label}<small>${t.n}</small></button>`).join('');
}

function foodView(q) {
  const split = c => { const i = c.indexOf(' '); return [c.slice(0, i), c.slice(i + 1)]; };
  const tiles = `<div class="tiles">` + D.cats.map(c => {
    const [ic, nm] = split(c);
    return `<button class="tile" data-cat="${esc(c)}" aria-pressed="${st.cat === c}"><span class="ic" aria-hidden="true">${ic}</span><span class="nm">${esc(nm)}</span><span class="ct">${D.food.filter(f => f.c === c).length}곳</span></button>`;
  }).join('') + `</div>`;
  const filters = `<div class="filters">
    <button class="chip" data-toggle="cheap" aria-pressed="${st.cheap}">1인 8천 원 이하</button>
    <label class="sort"><span class="lbl">정렬</span> <select id="sort">
      <option value="rec"${st.sort === 'rec' ? ' selected' : ''}>학생 추천순</option>
      <option value="price"${st.sort === 'price' ? ' selected' : ''}>가격 낮은 순</option>
      ${STATIC ? '' : `<option value="vote"${st.sort === 'vote' ? ' selected' : ''}>추천 많은 순</option>`}</select></label></div>`;
  let rows = D.food.filter(f => (!st.cat || f.c === st.cat) && (!st.cheap || (f.p !== null && f.p <= 8000)) && has(f, q));
  const up = f => (SUM[keyOf('food', f)] || {}).up || 0;
  rows.sort(st.sort === 'price' ? (a, b) => (a.p ?? 1e9) - (b.p ?? 1e9) || b.r - a.r : st.sort === 'vote' ? (a, b) => up(b) - up(a) || b.r - a.r : (a, b) => b.r - a.r);
  const cards = rows.map(f => `<article data-card class="card">
      <div class="top"><h2>${esc(f.n)}</h2><span class="rec">학생 추천 ${f.r}</span></div>
      <div class="meta"><span class="tag">${esc(f.c)}</span>${f.m ? `<span>${esc(f.m)}</span>` : ''}
        ${f.p !== null ? `<span class="price">${won(f.p)}~</span>` : '<span class="unk">가격 확인 안 됨</span>'}</div>
      ${f.l ? `<div class="addr">${esc(f.l)}</div>` : ''}${mapLink(f.u)}${vbar(keyOf('food', f))}</article>`);
  const cta = `<button type="button" class="pick-cta" data-pick><span class="pick-q">뭐 먹을지 모르겠다면?</span><span class="pick-btn">골라줘 →</span></button>`;
  const title = st.cat ? st.cat : '전체 맛집';
  return cta + tiles + filters + (st.view === 'map' ? mapBlock('food', rows, title) : list(rows.length, cards, title, true));
}

// 용도별 그림 표지 (360x128). 색은 .art[data-u] 의 CSS 변수에서 가져옴
const ART = {
  '공부': '<rect x="70" y="92" width="220" height="8" rx="2" style="fill:var(--obj)"/><rect x="88" y="100" width="6" height="28" style="fill:var(--obj)"/><rect x="266" y="100" width="6" height="28" style="fill:var(--obj)"/><path d="M130 90 L180 80 L230 90 L230 72 L180 62 L130 72 Z" fill="#fff"/><path d="M180 62 V80" style="stroke:var(--near)" stroke-width="2"/><path d="M250 92 V54 L232 40" style="stroke:var(--obj)" stroke-width="4" fill="none"/><path d="M218 30 L248 30 L240 46 L226 46 Z" style="fill:var(--hi)"/>',
  '휴식': '<circle cx="250" cy="52" r="34" style="fill:var(--near)"/><circle cx="222" cy="66" r="24" style="fill:var(--far)"/><rect x="246" y="72" width="8" height="40" style="fill:var(--obj)"/><rect x="0" y="110" width="360" height="18" style="fill:var(--far)"/><rect x="96" y="86" width="110" height="7" rx="2" style="fill:var(--obj)"/><rect x="96" y="98" width="110" height="6" rx="2" style="fill:var(--obj)"/><rect x="104" y="104" width="5" height="10" style="fill:var(--obj)"/><rect x="193" y="104" width="5" height="10" style="fill:var(--obj)"/><circle cx="70" cy="34" r="12" style="fill:var(--hi)"/>',
  '산책·운동': '<path d="M0 82 Q90 60 180 78 T360 70 V128 H0Z" style="fill:var(--far)"/><path d="M150 128 C170 110 210 104 205 92 C200 82 230 78 250 74" stroke="#fff" stroke-width="14" fill="none" stroke-linecap="round"/><g style="fill:var(--near)"><path d="M60 96 l14 -34 l14 34z"/><path d="M92 100 l11 -26 l11 26z"/><path d="M290 90 l14 -36 l14 36z"/></g><g style="fill:var(--obj)"><rect x="72" y="96" width="4" height="10"/><rect x="101" y="100" width="4" height="8"/><rect x="302" y="90" width="4" height="10"/></g>',
  '경치·사진': '<circle cx="230" cy="74" r="26" style="fill:var(--hi)"/><path d="M0 90 L70 52 L130 84 L200 46 L280 86 L360 58 V128 H0Z" style="fill:var(--far)"/><path d="M0 108 Q90 86 180 104 T360 96 V128 H0Z" style="fill:var(--near)"/><rect x="58" y="22" width="42" height="28" rx="5" style="fill:var(--obj)"/><circle cx="79" cy="36" r="8" fill="#fff"/><rect x="66" y="17" width="12" height="6" rx="2" style="fill:var(--obj)"/>',
  '카페·식사': '<rect x="0" y="104" width="360" height="24" style="fill:var(--far)"/><path d="M146 58 H214 V88 Q214 104 196 104 H164 Q146 104 146 88Z" style="fill:var(--obj)"/><path d="M214 66 Q234 66 230 80 Q226 92 212 90" style="stroke:var(--obj)" stroke-width="6" fill="none"/><ellipse cx="180" cy="106" rx="50" ry="5" style="fill:var(--near)"/><g style="stroke:var(--near)" stroke-width="4" fill="none" stroke-linecap="round"><path d="M166 50 q-6 -10 0 -20 q6 -10 0 -18"/><path d="M182 48 q-6 -10 0 -20 q6 -10 0 -18"/><path d="M198 50 q-6 -10 0 -20 q6 -10 0 -18"/></g>',
  '놀거리': '<g style="fill:var(--far)"><circle cx="60" cy="40" r="5"/><circle cx="300" cy="30" r="6"/><circle cx="120" cy="100" r="4"/><circle cx="250" cy="104" r="5"/></g><path d="M180 22 l9 20 l22 2 l-17 14 l6 22 l-20 -12 l-20 12 l6 -22 l-17 -14 l22 -2z" style="fill:var(--hi)"/><path d="M100 70 v-30 l26 -6 v30" style="stroke:var(--obj)" stroke-width="4" fill="none"/><circle cx="94" cy="72" r="7" style="fill:var(--obj)"/><circle cx="120" cy="66" r="7" style="fill:var(--obj)"/><circle cx="268" cy="72" r="18" style="fill:var(--near)"/><path d="M252 66 h32 M268 54 v36" stroke="#fff" stroke-width="3"/>',
  '편의시설': '<rect x="0" y="112" width="360" height="16" style="fill:var(--far)"/><rect x="118" y="34" width="124" height="78" style="fill:var(--obj)"/><g style="fill:var(--hi)"><rect x="132" y="46" width="20" height="14"/><rect x="170" y="46" width="20" height="14"/><rect x="208" y="46" width="20" height="14"/><rect x="132" y="70" width="20" height="14"/><rect x="208" y="70" width="20" height="14"/></g><rect x="168" y="80" width="24" height="32" style="fill:var(--near)"/>',
  '기타': '<rect x="0" y="108" width="360" height="20" style="fill:var(--far)"/><path d="M180 104 C164 82 156 70 156 56 a24 24 0 0 1 48 0 C204 70 196 82 180 104Z" style="fill:var(--obj)"/><circle cx="180" cy="56" r="9" fill="#fff"/><ellipse cx="180" cy="106" rx="18" ry="4" style="fill:var(--near)"/>',
};
const cover = s => {
  // 용도별 그림 표지 (학생 캡처 사진은 어색해서 안 씀. 파일은 public/images 에 남아 있음)
  const u = ART[s.g] ? s.g : '기타';
  return `<div class="cover art" data-u="${esc(u)}" aria-hidden="true"><svg viewBox="0 0 360 128" preserveAspectRatio="xMidYMid slice"><rect width="360" height="128" style="fill:var(--sky)"/>${ART[u]}</svg></div>`;
};
const roadview = s => {
  const c = COORDS[s.n];
  return c ? `<a class="map" href="https://map.kakao.com/link/roadview/${c[0]},${c[1]}" target="_blank" rel="noopener">로드뷰 보기 →</a>` : '';
};

function spotView(q) {
  const filters = `<div class="filters">${chips('권역', 'area', uniq(D.spot, 'a'))}</div><div class="filters">${chips('용도', 'use', uniq(D.spot, 'g'))}</div>`;
  const rows = D.spot.filter(s => (!st.area || s.a === st.area) && (!st.use || s.g === st.use) && has(s, q)).sort((a, b) => b.r - a.r);
  const cards = rows.map(s => `<article data-card class="card spot">${cover(s)}<div class="body">
      <div class="top"><h2>${esc(s.n)}</h2><span class="rec">학생 추천 ${s.r}</span></div>
      <div class="meta"><span class="tag">${esc(s.g)}</span><span class="tag">${esc(s.a)}</span></div>
      <dl class="rows"><dt>이용 시간</dt><dd>${s.h ? esc(s.h) : unk}</dd><dt>이용 조건</dt><dd>${s.k ? esc(s.k) : unk}</dd></dl>
      ${s.l ? `<div class="addr">${esc(s.l)}</div>` : ''}<div class="links">${mapLink(s.u)}${roadview(s)}</div>${vbar(keyOf('spot', s))}</div></article>`);
  return filters + (st.view === 'map' ? mapBlock('spot', rows, '숨은장소') : list(rows.length, cards, '숨은장소', true));
}

function tipView(q, src, title) {
  const filters = `<div class="filters">${chips('주제', 'topic', uniq(src, 't'))}</div>`;
  const rows = src.filter(t => (!st.topic || t.t === st.topic) && has(t, q)).sort((a, b) => b.r - a.r);
  const cards = rows.map(t => `<article data-card class="card">
      <div class="top"><h2>${esc(t.n)}</h2><span class="rec">학생 추천 ${t.r}</span></div>
      <div class="meta"><span class="tag">${esc(t.t)}</span></div>
      <p class="gist">${esc(t.g)}</p>
      <dl class="rows"><dt>필요한 것</dt><dd>${t.q ? esc(t.q) : unk}</dd><dt>언제</dt><dd>${t.w ? esc(t.w) : unk}</dd></dl>
      ${t.l ? `<div class="addr">${esc(t.l)}</div>` : ''}${mapLink(t.u)}${vbar(keyOf(st.tab, t))}</article>`);
  return filters + list(rows.length, cards, title);
}

// 목록 ↔ 지도 전환 버튼 (맛집·숨은장소)
const viewSwitch = () => `<div class="vswitch" role="group" aria-label="보기 방식">
    <button type="button" data-view="list" aria-pressed="${st.view === 'list'}">목록</button>
    <button type="button" data-view="map" aria-pressed="${st.view === 'map'}">지도</button></div>`;
const countRow = (title, n, sw) => `<div class="count-row"><p class="count"><b>${esc(title)}</b> · ${n}개</p>${sw ? viewSwitch() : ''}</div>`;

function list(n, cards, title, sw) {
  return countRow(title, n, sw) +
    (n ? `<div class="list">${cards.join('')}</div>` : `<p class="empty">조건에 맞는 결과가 없어요. 필터를 하나 풀어 보세요.</p>`);
}

// ---- 지도로 보기: 지금 필터에 맞는 곳을 지도 핀으로 (좌표는 학생들이 올린 네이버 지도 링크에서 뽑음) ----
// 지도 그림(Leaflet + OpenStreetMap)은 인터넷이 있어야 보임. 처음 '지도'를 누를 때만 불러옴
const USE_IC = { '공부': '📚', '휴식': '🛋️', '산책·운동': '🌳', '경치·사진': '📷', '카페·식사': '☕', '놀거리': '🎮', '편의시설': '🏪', '기타': '📍' };
const pinIcon = (tab, x) => tab === 'food' ? x.c.slice(0, x.c.indexOf(' ')) : (USE_IC[x.g] || '📍');
const MAP = { tab: null, rows: [], map: null };
function mapBlock(tab, rows, title) {
  MAP.tab = tab; MAP.rows = rows;
  const off = rows.filter(x => !COORDS[x.n]);
  const offList = off.length ? `<details class="map-off"><summary>지도에 위치가 없는 곳 ${off.length}곳</summary><div class="map-off-list">${off.map(x =>
    `<button type="button" class="chip" data-open="${esc(keyOf(tab, x))}"${STATIC ? ' disabled' : ''}>${esc(x.n)}</button>`).join('')}</div></details>` : '';
  return countRow(title, rows.length, true) + (rows.length
    ? `<div class="map-wrap"><div class="map-zoom" role="group" aria-label="지도 범위"><button type="button" data-zoom="near" aria-pressed="true">학교 앞</button><button type="button" data-zoom="all" aria-pressed="false">충주 전체</button></div><div id="map" class="map-box" role="region" aria-label="${esc(title)} 지도"><p class="map-msg">지도를 불러오는 중…</p></div></div>${offList}`
    : `<p class="empty">조건에 맞는 결과가 없어요. 필터를 하나 풀어 보세요.</p>`);
}
let leafletReady = null;
const loadLeaflet = () => leafletReady || (leafletReady = new Promise((ok, no) => {
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.append(css);
  const js = document.createElement('script'); js.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
  js.onload = () => ok(window.L); js.onerror = () => { leafletReady = null; no(new Error('leaflet')); }; document.head.append(js);
}));
const CAMPUS = [36.9688, 127.8702]; // 교통대 충주캠퍼스 (중앙도서관 근처)
async function mountMap() {
  const box = document.getElementById('map'); if (!box) return;
  let L; try { L = await loadLeaflet(); } catch (e) { box.innerHTML = '<p class="map-msg">지도를 불러오지 못했어요. 지도는 인터넷이 연결되어 있어야 보여요.</p>'; return; }
  if (!document.contains(box)) return; // 그새 다른 화면으로 바뀜
  if (MAP.map) { MAP.map.remove(); MAP.map = null; }
  box.textContent = '';
  const map = MAP.map = L.map(box, { scrollWheelZoom: false, zoomControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
  L.marker(CAMPUS, { icon: L.divIcon({ className: 'pin-campus', html: '<span>🏫 교통대</span>', iconSize: null }), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
  const pts = [];
  for (const x of MAP.rows) {
    const c = COORDS[x.n]; if (!c) continue;
    pts.push(c);
    const key = keyOf(MAP.tab, x);
    const meta = MAP.tab === 'food'
      ? [x.c, x.m, x.p !== null ? won(x.p) + '~' : ''].filter(Boolean).join(' · ')
      : [x.g, x.a, x.h].filter(Boolean).join(' · ');
    const pop = `<div class="pop"><b>${esc(x.n)}</b><span class="pop-meta">${esc(meta)}</span><span class="pop-rec">학생 추천 ${x.r}</span>
      <div class="pop-act">${STATIC ? '' : `<button type="button" data-open="${esc(key)}">리뷰·추천 →</button>`}${x.u ? `<a href="${esc(x.u)}" target="_blank" rel="noopener">네이버 지도 →</a>` : ''}</div></div>`;
    L.marker(c, { icon: L.divIcon({ className: 'pin', html: `<span>${pinIcon(MAP.tab, x)}</span>`, iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -14] }), title: x.n, alt: x.n })
      .bindPopup(pop, { maxWidth: 260 }).addTo(map);
  }
  // 처음엔 '학교 앞'(캠퍼스에서 2.5km 안)만 보이게. 위 버튼으로 '충주 전체'와 전환
  const near = pts.filter(c => map.distance(c, CAMPUS) < 2500);
  const fit = which => {
    const set = which === 'near' && near.length ? near : pts;
    if (set.length) map.fitBounds(L.latLngBounds(set.concat([CAMPUS])), { padding: [36, 36], maxZoom: 16 }); else map.setView(CAMPUS, 15);
    box.parentNode.querySelectorAll('[data-zoom]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.zoom === which)));
  };
  fit(near.length ? 'near' : 'all');
  box.parentNode.querySelector('.map-zoom').onclick = e => { const b = e.target.closest('[data-zoom]'); if (b) fit(b.dataset.zoom); };
  // 말풍선 안 클릭은 바깥으로 안 전해져서, '리뷰·추천' 버튼은 여기서 직접 연결
  map.on('popupopen', e => { const b = e.popup.getElement().querySelector('[data-open]'); if (b) b.onclick = () => openReview(b.dataset.open, b); });
  map.once('focus', () => map.scrollWheelZoom.enable()); // 지도를 한 번 누른 뒤에만 휠 확대 (페이지 스크롤 방해 안 함)
  box.addEventListener('click', () => map.scrollWheelZoom.enable(), { once: true });
}

function render() {
  renderTabs();
  const q = st.q.trim().toLowerCase();
  const v = st.tab === 'food' ? foodView(q) : st.tab === 'spot' ? spotView(q) : st.tab === 'tip' ? tipView(q, D.tip, '생활꿀팁')
    : tipView(q, D.free, '자유');
  if (MAP.map) { MAP.map.remove(); MAP.map = null; }
  if (location.hash.slice(1) !== st.tab) try { history.replaceState(null, '', '#' + st.tab); } catch (e) {}
  document.getElementById('view').innerHTML = v;
  mountMap();
}

document.getElementById('tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  st.tab = b.dataset.tab; st.topic = '';
  try { localStorage.setItem('kd-tab', JSON.stringify(st.tab)); } catch (err) {}
  render(); window.scrollTo({ top: 0 });
});
document.getElementById('view').addEventListener('click', e => {
  const t = e.target.closest('[data-cat]'); if (t) { st.cat = st.cat === t.dataset.cat ? '' : t.dataset.cat; return render(); }
  const g = e.target.closest('[data-toggle]'); if (g) { st[g.dataset.toggle] = !st[g.dataset.toggle]; return render(); }
  const c = e.target.closest('[data-k]'); if (c) { st[c.dataset.k] = c.dataset.v; return render(); }
  const pk = e.target.closest('[data-pick]'); if (pk) return openPick(pk);
  const vw = e.target.closest('[data-view]'); if (vw) { st.view = vw.dataset.view; return render(); }
  if (e.target.closest('a')) return; // 지도·로드뷰 링크는 그대로
  const o = e.target.closest('[data-open]') || e.target.closest('[data-card]')?.querySelector('[data-open]');
  if (o) openReview(o.dataset.open, o);
});
// 주소 끝 #food, #spot 등으로 바로 그 탭 열기
window.addEventListener('hashchange', () => { const t = location.hash.slice(1); if (TABS.some(x => x.id === t) && t !== st.tab) { st.tab = t; st.topic = ''; render(); } });
document.getElementById('view').addEventListener('change', e => { if (e.target.id === 'sort') { st.sort = e.target.value; render(); } });
document.getElementById('q').addEventListener('input', e => { st.q = e.target.value; render(); });
// ---- 리뷰·추천/비추천 창 ----
const RV = { key: null, from: null };
const $id = id => document.getElementById(id);
let TOKEN = '';
try { TOKEN = localStorage.getItem('kd-token') || ''; } catch (e) {}
if (!TOKEN) { TOKEN = Math.random().toString(36).slice(2) + Date.now().toString(36); try { localStorage.setItem('kd-token', TOKEN); } catch (e) {} }
try { $id('rvName').value = localStorage.getItem('kd-nick') || ''; } catch (e) {}

const itemOf = key => { const i = key.indexOf(':'), tab = key.slice(0, i), n = key.slice(i + 1); return { tab, x: (D[tab] || []).find(v => v.n === n) }; };
const when = t => { const d = new Date(t), p = v => String(v).padStart(2, '0'); return `${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || '요청이 실패했어요'); e.data = j; throw e; } return j; });

function paintVotes(v) {
  $id('rvUp').textContent = v.up; $id('rvDown').textContent = v.down;
  $id('rvUpBtn').setAttribute('aria-pressed', String(v.my === 'up'));
  $id('rvDownBtn').setAttribute('aria-pressed', String(v.my === 'down'));
  $id('rvBest').hidden = v.up < BEST;
}
function paintComments(list) {
  $id('rvCount').textContent = list.length;
  const ul = $id('rvList'); ul.textContent = '';
  if (!list.length) { const li = document.createElement('li'); li.className = 'rv-none'; li.textContent = '아직 리뷰가 없어요. 첫 리뷰를 남겨 보세요.'; ul.append(li); return; }
  for (const c of list) {
    const li = document.createElement('li'); li.className = 'rv-item';
    const head = document.createElement('div'); head.className = 'rv-meta';
    const nm = document.createElement('b'); nm.textContent = c.name;
    const ip = document.createElement('span'); ip.className = 'rv-ip'; ip.textContent = `(${c.ip})`;
    const tm = document.createElement('span'); tm.className = 'rv-time'; tm.textContent = when(c.at);
    const del = document.createElement('button'); del.type = 'button'; del.className = 'rv-del'; del.textContent = '삭제'; del.dataset.del = c.id;
    head.append(nm, ip, tm, del);
    const body = document.createElement('p'); body.className = 'rv-text'; body.textContent = c.text;
    li.append(head, body); ul.append(li);
  }
}
function syncSummary(v) {
  SUM[v.key] = { up: v.up, down: v.down, n: v.n };
  document.querySelectorAll('[data-vk]').forEach(el => { if (el.dataset.vk === v.key) el.innerHTML = vbarInner(v.key); });
}
async function loadReview() {
  const key = RV.key;
  try {
    const v = await fetch(`/api/reviews?key=${encodeURIComponent(key)}&token=${encodeURIComponent(TOKEN)}`).then(r => r.json());
    if (RV.key !== key) return;
    paintVotes(v); paintComments(v.comments || []); syncSummary(v);
  } catch (e) { $id('rvNote').textContent = '리뷰를 불러오지 못했어요. "실행하기.bat"으로 열었는지 확인해 주세요.'; }
}
function openReview(key, from) {
  const { tab, x } = itemOf(key); if (!x) return;
  RV.key = key; RV.from = from;
  $id('rvTitle').textContent = x.n;
  $id('rvTag').textContent = ({ food: x.c, spot: x.g, tip: x.t, free: x.t })[tab] || '';
  $id('rvRec').textContent = `학생 추천 ${x.r}`;
  $id('rvNote').textContent = '';
  paintVotes({ up: 0, down: 0, my: null, ...(SUM[key] || {}) }); paintComments([]);
  $id('rv').hidden = false; document.body.style.overflow = 'hidden';
  $id('rvClose').focus();
  loadReview();
}
function closeReview() {
  $id('rv').hidden = true; document.body.style.overflow = ''; RV.key = null;
  if (RV.from && document.contains(RV.from)) RV.from.focus();
}
$id('rvClose').addEventListener('click', closeReview);
$id('rv').addEventListener('click', e => { if (e.target === $id('rv')) closeReview(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$id('rv').hidden) closeReview(); });

async function vote(dir) {
  try { const v = await post('/api/vote', { key: RV.key, dir, token: TOKEN }); paintVotes(v); syncSummary(v); $id('rvNote').textContent = dir === 'up' ? '추천했어요.' : '비추천했어요.'; }
  catch (e) { $id('rvNote').textContent = e.message; if (e.data && e.data.key) paintVotes(e.data); }
}
$id('rvUpBtn').addEventListener('click', () => vote('up'));
$id('rvDownBtn').addEventListener('click', () => vote('down'));

$id('rvForm').addEventListener('submit', async e => {
  e.preventDefault();
  const name = $id('rvName').value.trim(), pw = $id('rvPw').value, text = $id('rvText').value.trim();
  if (!text) { $id('rvNote').textContent = '내용을 입력해 주세요.'; return; }
  if (pw.length < 4) { $id('rvNote').textContent = '비밀번호를 4자 이상 정해 주세요. 리뷰를 지울 때 필요해요.'; $id('rvPw').focus(); return; }
  try {
    const v = await post('/api/comment', { key: RV.key, name, pw, text });
    try { if (name) localStorage.setItem('kd-nick', name); } catch (err) {}
    $id('rvText').value = ''; $id('rvNote').textContent = '리뷰를 남겼어요.';
    paintComments(v.comments); syncSummary(v);
  } catch (err) { $id('rvNote').textContent = err.message; }
});

// 삭제: 삭제 → 비밀번호 칸 → 확인
$id('rvList').addEventListener('click', async e => {
  const d = e.target.closest('[data-del]');
  if (d) {
    const li = d.closest('li'); if (li.querySelector('.rv-delform')) return;
    const f = document.createElement('form'); f.className = 'rv-delform';
    f.innerHTML = '<input type="password" maxlength="20" placeholder="비밀번호" aria-label="삭제 비밀번호"><button type="submit">지우기</button><button type="button" data-cancel>취소</button>';
    f.dataset.id = d.dataset.del; li.append(f); f.querySelector('input').focus(); return;
  }
  const c = e.target.closest('[data-cancel]'); if (c) c.closest('form').remove();
});
$id('rvList').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target; if (!f.classList.contains('rv-delform')) return;
  try { const v = await post('/api/comment/delete', { key: RV.key, id: f.dataset.id, pw: f.querySelector('input').value }); paintComments(v.comments); syncSummary(v); $id('rvNote').textContent = '리뷰를 지웠어요.'; }
  catch (err) { $id('rvNote').textContent = err.message; }
});

// 다른 사람이 추천·리뷰하면 바로 반영
if (window.KD_ES) window.KD_ES.addEventListener('review', e => {
  let v; try { v = JSON.parse(e.data); } catch (err) { return; }
  syncSummary(v);
  if (RV.key === v.key) loadReview();
});

// ---- 뭐 먹지? 골라주기 ----
// 후보: 조건에 맞는 맛집. 뽑힐 확률: 1 + 학생 추천 수 + (추천 - 비추천, 0 아래면 0)
const PK = { opts: { meal: true, cheap: false, near: false, cat: false }, spinning: false, last: null, from: null };
const isMeal = f => !/카페|술집/.test(f.c);
const isNear = f => /대소원면/.test(f.l);
const weightOf = f => { const v = SUM[keyOf('food', f)] || {}; return 1 + f.r + Math.max(0, (v.up || 0) - (v.down || 0)); };
function candidates() {
  const o = PK.opts;
  return D.food.filter(f => (!o.meal || isMeal(f)) && (!o.cheap || (f.p !== null && f.p <= 8000))
    && (!o.near || isNear(f)) && (!o.cat || f.c === st.cat));
}
function pickWeighted(list) {
  const pool = list.length > 1 && PK.last ? list.filter(f => f.n !== PK.last) : list; // 방금 나온 곳은 한 번 쉼
  let r = Math.random() * pool.reduce((a, f) => a + weightOf(f), 0);
  for (const f of pool) { r -= weightOf(f); if (r <= 0) return f; }
  return pool[pool.length - 1];
}
function paintPickOpts() {
  document.querySelectorAll('#pickOpts [data-opt]').forEach(b => b.setAttribute('aria-pressed', String(PK.opts[b.dataset.opt])));
  const chip = $id('pickCatChip');
  chip.hidden = !st.cat; if (st.cat) chip.textContent = st.cat + '만';
  if (!st.cat) PK.opts.cat = false;
  const n = candidates().length;
  $id('pickCount').textContent = n ? `후보 ${n}곳 · 추천 많이 받은 곳이 조금 더 잘 나와요` : '조건에 맞는 곳이 없어요. 조건을 하나 풀어 보세요.';
  $id('pickGo').disabled = !n || PK.spinning;
}
function openPick(from) {
  PK.from = from; PK.opts.cat = !!st.cat;
  $id('pickResult').hidden = true; $id('pickName').textContent = '?'; $id('pickSub').textContent = '버튼을 누르면 골라 드려요';
  $id('pickGo').textContent = '돌리기';
  paintPickOpts();
  $id('pick').hidden = false; document.body.style.overflow = 'hidden';
  $id('pickGo').focus();
}
function closePick() {
  if (PK.spinning) return;
  $id('pick').hidden = true; document.body.style.overflow = '';
  if (PK.from && document.contains(PK.from)) PK.from.focus();
}
function showResult(f) {
  const v = SUM[keyOf('food', f)] || { up: 0, down: 0, n: 0 };
  $id('pickName').textContent = f.n;
  $id('pickSub').textContent = [f.c, f.m].filter(Boolean).join(' · ');
  const box = $id('pickResult');
  box.innerHTML = `<div class="meta">${f.p !== null ? `<span class="price">${won(f.p)}~</span>` : '<span class="unk">가격 확인 안 됨</span>'}
      <span class="tag">학생 추천 ${f.r}</span>${STATIC ? '' : `<span class="tag">추천 ${v.up} · 비추천 ${v.down}</span>`}</div>
    ${f.l ? `<div class="addr">${esc(f.l)}</div>` : ''}
    <div class="pick-actions">${STATIC ? '' : `<button type="button" class="chip" data-pickrv="${esc(keyOf('food', f))}">리뷰 ${v.n}개 보기</button>`}${f.u ? `<a class="chip" href="${esc(f.u)}" target="_blank" rel="noopener">지도 보기 →</a>` : ''}</div>`;
  box.hidden = false;
}
function spin() {
  const list = candidates(); if (!list.length || PK.spinning) return;
  const winner = pickWeighted(list);
  PK.last = winner.n; PK.spinning = true;
  $id('pickResult').hidden = true; $id('pickGo').disabled = true;
  const slot = $id('pickSlot'), name = $id('pickName'), sub = $id('pickSub');
  slot.classList.add('spinning'); sub.textContent = '고르는 중…';
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const steps = reduce ? 0 : 22;
  let i = 0;
  const tick = () => {
    if (i < steps) {
      name.textContent = list[Math.floor(Math.random() * list.length)].n;
      i++; setTimeout(tick, 40 + i * i * 0.9); // 점점 느려짐
      return;
    }
    slot.classList.remove('spinning'); slot.classList.add('landed');
    setTimeout(() => slot.classList.remove('landed'), 600);
    PK.spinning = false; showResult(winner);
    $id('pickGo').textContent = '다시 뽑기'; paintPickOpts();
  };
  tick();
}
$id('pickGo').addEventListener('click', spin);
$id('pickClose').addEventListener('click', closePick);
$id('pick').addEventListener('click', e => {
  if (e.target === $id('pick')) return closePick();
  const o = e.target.closest('[data-opt]');
  if (o && !PK.spinning) { PK.opts[o.dataset.opt] = !PK.opts[o.dataset.opt]; return paintPickOpts(); }
  const r = e.target.closest('[data-pickrv]');
  if (r) { const from = PK.from; closePick(); openReview(r.dataset.pickrv, from); }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$id('pick').hidden) closePick(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $id('pick').hidden && $id('rv').hidden && !$id('aiPanel').hidden) $id('aiClose').click(); });

// ---- 게임식 꿀팁 카드: 10초마다 무작위로 바뀜 (진행 막대가 다 차면 다음 팁, 마우스를 올리면 멈춤) ----
let TIPS = [];
try { TIPS = await fetch('data/tips-qa.json').then(r => r.ok ? r.json() : []); } catch (e) {}
const TIP_TAB = { tip: '생활꿀팁', free: '자유' };
let tipIdx = -1, tipCur = null;
function nextTip() {
  if (!TIPS.length) return;
  let i; do { i = Math.floor(Math.random() * TIPS.length); } while (TIPS.length > 1 && i === tipIdx);
  tipIdx = i; tipCur = TIPS[i];
  $id('tipQ').textContent = tipCur.q;
  $id('tipA').textContent = tipCur.a;
  $id('tipTag').textContent = TIP_TAB[tipCur.tab] || '';
  $id('tipMore').hidden = false;
  const body = $id('tipBody'), bar = $id('tipBar');
  body.classList.remove('in'); bar.classList.remove('run');
  void body.offsetWidth; // 애니메이션 다시 시작
  body.classList.add('in'); bar.classList.add('run');
}
$id('tipBar').addEventListener('animationend', nextTip);
$id('tipNext').addEventListener('click', nextTip);
$id('tipMore').addEventListener('click', () => {
  if (!tipCur) return;
  st.tab = tipCur.tab; st.topic = ''; st.q = tipCur.src; $id('q').value = tipCur.src;
  render();
  $id('tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
nextTip();

// ---- 정보 제보 (내 PC 실행판에서만: 서버의 storage/reports.json 에 저장) ----
const RP = { from: null };
const CAT_TAB = { 맛집: 'food', 숨은장소: 'spot', 생활꿀팁: 'tip', 자유: 'free' };
function fillNames() {
  const tab = CAT_TAB[$id('reportCat').value];
  const names = tab ? D[tab].map(x => x.n) : ['food', 'spot', 'tip', 'free'].flatMap(t => D[t].map(x => x.n));
  $id('reportNames').innerHTML = names.map(n => `<option value="${esc(n)}"></option>`).join('');
}
function openReport(from, preset) {
  RP.from = from;
  $id('reportForm').reset(); $id('reportNote').textContent = ''; $id('reportSend').disabled = false;
  if (preset) { $id('reportCat').value = preset.cat; $id('reportTarget').value = preset.target; }
  fillNames();
  $id('report').hidden = false; document.body.style.overflow = 'hidden';
  (preset ? $id('reportText') : $id('reportTarget')).focus();
}
function closeReport() {
  $id('report').hidden = true; document.body.style.overflow = '';
  if (RP.from && document.contains(RP.from)) RP.from.focus();
}
if (!STATIC) {
  $id('reportOpen').hidden = false; $id('rvReport').hidden = false;
  $id('reportOpen').addEventListener('click', e => openReport(e.currentTarget));
  $id('rvReport').addEventListener('click', () => {
    const { tab, x } = itemOf(RV.key); const from = RV.from;
    closeReview();
    openReport(from, { cat: Object.keys(CAT_TAB).find(k => CAT_TAB[k] === tab), target: x.n });
  });
  $id('reportCat').addEventListener('change', fillNames);
  $id('reportClose').addEventListener('click', closeReport);
  $id('report').addEventListener('click', e => { if (e.target === $id('report')) closeReport(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$id('report').hidden) closeReport(); });
  $id('reportForm').addEventListener('submit', async e => {
    e.preventDefault();
    const text = $id('reportText').value.trim();
    if (text.length < 5) { $id('reportNote').textContent = '내용을 5자 이상 적어 주세요.'; $id('reportText').focus(); return; }
    $id('reportSend').disabled = true;
    try {
      await post('/api/report', { kind: new FormData($id('reportForm')).get('kind'), cat: $id('reportCat').value, target: $id('reportTarget').value.trim(), text, contact: $id('reportContact').value.trim() });
      $id('reportNote').textContent = '제보 고마워요! 확인 후 사이트에 반영할게요.';
      setTimeout(() => { if (!$id('report').hidden) closeReport(); }, 1600);
    } catch (err) { $id('reportNote').textContent = err.message; $id('reportSend').disabled = false; }
  });
}

// ---- AI 도우미 (내 PC 실행판에서만: 서버가 Ollama 의 EXAONE 에게 물어봄) ----
// 장소·정보 질문: 서버가 데이터에서 고른 '카드'(사실)와 AI 의 짧은 공감 문장을 보냄. 그냥 대화: AI 답을 글자 단위로 받음
if (!STATIC) {
  const AI = { history: [], ctrl: null };
  const aiPanel = $id('aiPanel'), aiLog = $id('aiLog'), aiInput = $id('aiInput'), aiSend = $id('aiSend');
  $id('aiFab').hidden = false;
  const openAI = () => { aiPanel.hidden = false; $id('aiFab').setAttribute('aria-expanded', 'true'); const c = $id('chat'); if (c) c.hidden = true; aiInput.focus(); };
  const closeAI = () => { if (AI.ctrl) AI.ctrl.abort(); aiPanel.hidden = true; $id('aiFab').setAttribute('aria-expanded', 'false'); };
  $id('aiFab').addEventListener('click', () => aiPanel.hidden ? openAI() : closeAI());
  $id('aiClose').addEventListener('click', closeAI);
  $id('fab').addEventListener('click', () => { if (!aiPanel.hidden) closeAI(); });   // 실시간 수다를 열면 AI 창은 닫음
  const bubble = (who, text) => {
    const d = document.createElement('div'); d.className = 'ai-msg ' + who;
    const p = document.createElement('p'); p.textContent = text; d.append(p);
    aiLog.append(d); aiLog.scrollTop = aiLog.scrollHeight; return d;
  };
  const addCards = (box, cards) => {
    if (!cards.length) return;
    const wrap = document.createElement('div'); wrap.className = 'ai-cards';
    for (const c of cards) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'ai-card'; b.dataset.open = c.key;
      const n = document.createElement('b'); n.textContent = c.name;
      const f = document.createElement('span'); f.textContent = c.facts.join(' · ');
      const g = document.createElement('em'); g.textContent = '리뷰·자세히 →';
      b.append(n, f, g); wrap.append(b);
    }
    box.append(wrap); aiLog.scrollTop = aiLog.scrollHeight;
  };
  aiLog.addEventListener('click', e => {
    const s = e.target.closest('[data-q]'); if (s) { aiInput.value = s.dataset.q; return ask(); }
    const c = e.target.closest('[data-open]'); if (c) openReview(c.dataset.open, c);
  });
  async function ask() {
    const q = aiInput.value.trim();
    if (!q || AI.ctrl) return;
    const sugg = $id('aiSugg'); if (sugg) sugg.remove();
    bubble('me', q); aiInput.value = '';
    const box = bubble('bot', ''), p = box.querySelector('p');
    box.classList.add('typing'); p.textContent = '생각하는 중…';
    aiSend.textContent = '멈추기'; AI.ctrl = new AbortController();
    let answer = '', started = false;
    try {
      const r = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: q, history: AI.history }), signal: AI.ctrl.signal });
      const reader = r.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const blk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (blk.match(/^event: (\w+)/m) || [])[1], data = JSON.parse((blk.match(/^data: (.*)$/m) || [, '{}'])[1]);
          if (ev === 'delta') { if (!started) { p.textContent = ''; started = true; box.classList.remove('typing'); } answer += data.text; p.textContent = answer; aiLog.scrollTop = aiLog.scrollHeight; }
          if (ev === 'answer') {
            box.classList.remove('typing');
            if (data.intro) { answer = data.intro; p.textContent = answer; } else if (!started) p.remove();
            addCards(box, data.cards);
            if (data.cards.length) answer += ' (추천: ' + data.cards.map(c => c.name).join(', ') + ')';
          }
          if (ev === 'error') { box.classList.remove('typing'); box.classList.add('err'); p.textContent = data.message; answer = ''; }
        }
      }
    } catch (e) {
      box.classList.remove('typing');
      if (e.name === 'AbortError') { p.textContent = (answer || '') + (answer ? ' …' : '답변을 멈췄어요.'); }
      else { box.classList.add('err'); p.textContent = 'AI에 연결하지 못했어요. "실행하기.bat"으로 연 사이트인지, Ollama가 켜져 있는지 확인해 주세요.'; }
    }
    if (answer) AI.history.push({ role: 'user', content: q }, { role: 'assistant', content: answer.slice(0, 400) });
    AI.history = AI.history.slice(-8);
    AI.ctrl = null; aiSend.textContent = '보내기'; aiInput.focus();
  }
  $id('aiForm').addEventListener('submit', e => { e.preventDefault(); if (AI.ctrl) { AI.ctrl.abort(); return; } ask(); });
}

render();
})();

// ---- 실시간 수다: 내 PC 서버(server.js)를 거쳐 접속한 사람끼리 주고받고, 20초 뒤 사라짐 (저장 안 함) ----
(() => {
  const LIFE = 20000, $ = id => document.getElementById(id);
  const chat = $('chat'), stage = $('stage'), hint = $('stageHint'), input = $('chatInput'), send = $('chatSend'), note = $('chatNote'), status = $('chatStatus');
  const me = Math.random().toString(36).slice(2, 10);
  let lastText = '', lastAt = 0, repeat = 0, mutedUntil = 0, online = false;

  $('fab').addEventListener('click', () => { chat.hidden = !chat.hidden; $('fab').setAttribute('aria-expanded', String(!chat.hidden)); if (!chat.hidden && !input.disabled) input.focus(); });
  $('chatClose').addEventListener('click', () => { chat.hidden = true; $('fab').setAttribute('aria-expanded', 'false'); });

  function puff(text, who, mine) {
    hint.hidden = true;
    const el = document.createElement('div');
    el.className = 'puff' + (mine ? ' me' : '');
    const w = document.createElement('span'); w.className = 'who'; w.textContent = mine ? '나' : who;
    const t = document.createElement('span'); t.className = 'txt'; t.textContent = text;
    el.append(w, t); stage.append(el);
    setTimeout(() => { el.remove(); if (!stage.querySelector('.puff')) hint.hidden = false; }, LIFE);
    const all = stage.querySelectorAll('.puff'); if (all.length > 30) all[0].remove();
  }
  function setOnline(on) { online = on; input.disabled = send.disabled = !on; $('fabDot').classList.toggle('on', on); }

  $('chatForm').addEventListener('submit', async e => {
    e.preventDefault();
    const text = input.value.replace(/\s+/g, ' ').trim();
    if (!text || !online) return;
    const now = Date.now();
    if (now < mutedUntil) { note.textContent = `같은 말을 반복해서 ${Math.ceil((mutedUntil - now) / 1000)}초 동안 쉬어 가요.`; return; }
    if (now - lastAt < 1500) { note.textContent = '조금 천천히 보내 주세요.'; return; }
    repeat = text === lastText ? repeat + 1 : 0;
    if (repeat >= 2) { mutedUntil = now + 10000; note.textContent = '같은 말을 반복해서 10초 동안 쉬어 가요.'; return; }
    lastText = text; lastAt = now;
    try {
      const r = await fetch('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: me, text }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '보내지 못했어요');
      input.value = ''; note.textContent = '';
    } catch (err) { note.textContent = err.message || '메시지를 보내지 못했어요. 다시 시도해 주세요.'; }
  });

  if (window.KD_STATIC) { $('fab').hidden = true; chat.hidden = true; return; } // 보기 전용판: 채팅 숨김
  const es = window.KD_ES;
  es.addEventListener('open', () => { setOnline(true); note.textContent = ''; });
  es.addEventListener('error', () => { setOnline(false); status.textContent = '서버와 연결이 끊겼어요 · 다시 연결 중…'; });
  es.addEventListener('count', e => {
    const n = Number(e.data) || 0;
    status.textContent = `지금 ${n}명 접속 중 · 20초 뒤 사라짐`;
    $('fabTxt').textContent = `실시간 수다 · ${n}명`;
  });
  es.addEventListener('chat', e => {
    let m; try { m = JSON.parse(e.data); } catch (err) { return; }
    if (typeof m.text !== 'string') return;
    puff(m.text.slice(0, 80), '익명', m.id === me);
  });
})();

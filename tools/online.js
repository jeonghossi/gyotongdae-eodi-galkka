// 온라인으로 켜기: 서버 + Cloudflare 터널을 켜고, 터널 주소를 GitHub 저장소 live 가지의 server.json 에 적음
// → GitHub 주소(보기 전용판)가 그 주소로 실시간 수다·AI 도우미를 씀. 리뷰·관리자 등은 터널로 열리지 않음 (server.js 의 ONLINE_PATHS)
// 실행: 온라인으로-켜기.bat (또는 node tools/online.js). 끌 때 Ctrl + C → server.json 을 '꺼짐'으로 바꾸고 끝냄
// 필요: cloudflared(터널), gh(GitHub 로그인). live 가지는 Pages 배포와 상관없음 (배포는 main 만)
const { spawn, execFile } = require('child_process');
const http = require('http');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 3100;
const REPO = 'jeonghossi/gyotongdae-eodi-galkka', BRANCH = 'live', FILE = 'server.json';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const gh = args => new Promise((ok, no) => execFile('gh', args, { windowsHide: true }, (e, out, err) => e ? no(new Error(err || e.message)) : ok(out)));
async function publish(url) {
  try { await gh(['api', `repos/${REPO}/git/ref/heads/${BRANCH}`]); }
  catch (e) { // live 가지가 없으면 main 에서 만듦
    const main = JSON.parse(await gh(['api', `repos/${REPO}/git/ref/heads/main`])).object.sha;
    await gh(['api', '-X', 'POST', `repos/${REPO}/git/refs`, '-f', `ref=refs/heads/${BRANCH}`, '-f', `sha=${main}`]);
  }
  let sha = '';
  try { sha = JSON.parse(await gh(['api', `repos/${REPO}/contents/${FILE}?ref=${BRANCH}`])).sha; } catch (e) {}
  const content = Buffer.from(JSON.stringify({ url, at: new Date().toISOString() }) + '\n').toString('base64');
  const args = ['api', '-X', 'PUT', `repos/${REPO}/contents/${FILE}`, '-f', `message=${url ? '서버 켜짐' : '서버 꺼짐'}`, '-f', `content=${content}`, '-f', `branch=${BRANCH}`];
  if (sha) args.push('-f', `sha=${sha}`);
  await gh(args);
}
const healthy = url => new Promise(ok => {
  const lib = url.startsWith('https') ? require('https') : http;
  const req = lib.get(url + '/health', { timeout: 5000 }, r => { r.resume(); ok(r.statusCode === 200); });
  req.on('error', () => ok(false)); req.on('timeout', () => { req.destroy(); ok(false); });
});

let server, tunnel, closing = false;
async function shutdown() {
  if (closing) return; closing = true;
  console.log('\n  끄는 중… GitHub 주소에 "꺼짐"을 알리는 중');
  try { await publish(null); } catch (e) { console.log('  (꺼짐 알리기 실패: ' + e.message.trim() + ')'); }
  for (const p of [tunnel, server]) try { p && p.kill(); } catch (e) {}
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
  // 1) 서버 켜기 (창에 서버 안내가 그대로 나옴). 새 버전 서버가 이미 켜져 있으면 그걸 씀
  if (await healthy(`http://localhost:${PORT}`)) console.log(`  이미 켜져 있는 서버(포트 ${PORT})를 씁니다.`);
  else {
    server = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, PORT: String(PORT) } });
    server.on('exit', code => {
      if (closing) return;
      console.log(code === 1 ? `\n  → "실행하기.bat"으로 켠 서버 창이 열려 있으면 그 창을 닫고, 이 파일을 다시 실행해 주세요.` : '  서버가 꺼졌어요 (코드 ' + code + ')');
      shutdown();
    });
    for (let i = 0; i < 40 && !(await healthy(`http://localhost:${PORT}`)); i++) await sleep(250);
  }

  // 2) 터널 켜기 → 주소 받기
  console.log('  인터넷 연결(Cloudflare 터널) 여는 중…');
  tunnel = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`, '--no-autoupdate'], { windowsHide: true });
  const url = await new Promise((ok, no) => {
    const seen = d => { const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/); if (m) ok(m[0]); };
    tunnel.stdout.on('data', seen); tunnel.stderr.on('data', seen);
    tunnel.on('error', () => no(new Error('cloudflared 를 찾지 못했어요')));
    tunnel.on('exit', () => no(new Error('터널이 꺼졌어요')));
    setTimeout(() => no(new Error('터널 주소를 받지 못했어요 (인터넷 연결 확인)')), 60000);
  }).catch(e => { console.log('  [실패] ' + e.message); shutdown(); });
  if (!url) return;

  // 3) 터널이 실제로 열릴 때까지 기다린 뒤 GitHub 에 주소 알리기
  for (let i = 0; i < 30 && !(await healthy(url)); i++) await sleep(2000);
  try { await publish(url); }
  catch (e) { console.log('  [실패] GitHub 에 주소를 알리지 못했어요: ' + e.message.trim() + '\n  (gh auth login 으로 로그인했는지 확인)'); }
  console.log('');
  console.log('  ✅ 온라인으로 켜졌어요');
  console.log('  GitHub 주소에서도 실시간 수다 · AI 도우미가 돼요: https://jeonghossi.github.io/gyotongdae-eodi-galkka/');
  console.log('  (리뷰·추천·제보·관리자는 터널로 열리지 않아요)');
  console.log('  끄려면 Ctrl + C (창을 그냥 닫아도 사이트는 곧 "꺼짐"으로 보여요)');
})();

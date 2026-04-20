const { spawn } = require('child_process');
const { Tunnel, TryCloudflareHandler, bin, install } = require('cloudflared');
const fs = require('fs');

async function main() {
  // cloudflared 바이너리 없으면 자동 설치
  if (!fs.existsSync(bin)) {
    console.log('☁️  cloudflared 설치 중... (최초 1회)');
    await install(bin);
    console.log('✅  설치 완료\n');
  }

  // 게임 서버 먼저 시작
  console.log('🃏  원카드 서버 시작 중...');
  const srv = spawn(process.execPath, ['server.js'], { stdio: 'inherit' });
  srv.on('exit', () => process.exit());

  await new Promise(r => setTimeout(r, 1500));

  // Cloudflare Quick Tunnel 시작
  console.log('\n☁️  Cloudflare 터널 연결 중...\n');
  const t = new Tunnel(['tunnel', '--url', 'http://localhost:3000']);
  new TryCloudflareHandler(t);

  t.once('url', url => {
    console.log('='.repeat(58));
    console.log('🌍  공개 접속 주소 (인터넷 어디서나):');
    console.log('');
    console.log('    ' + url);
    console.log('');
    console.log('📱  이 주소를 카톡/문자로 공유하세요!');
    console.log('    (서버 끄면 주소도 사라집니다)');
    console.log('='.repeat(58) + '\n');
  });

  t.on('error', err => console.error('터널 오류:', err));

  process.on('SIGINT', () => { t.stop(); srv.kill(); process.exit(); });
  process.on('SIGTERM', () => { t.stop(); srv.kill(); process.exit(); });
}

main().catch(err => {
  console.error('오류:', err.message);
  process.exit(1);
});

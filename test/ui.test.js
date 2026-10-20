import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('앱 화면은 실물책 등록·검색·백업 기능을 제공한다', async () => {
  const html = await source('index.html');
  for (const id of ['book-form', 'isbn', 'scan-isbn', 'scan-photo', 'barcode-photo', 'barcode-camera-photo', 'scanner-photo', 'scanner-camera-photo', 'lookup-isbn', 'search', 'disposition-filter', 'bookshelf', 'export-csv', 'drive-backup', 'drive-restore', 'import-json', 'next-two-years', 'refocus-camera', 'toggle-torch', 'camera-zoom']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test('갤러리 업로드와 휴대폰 기본 카메라 촬영을 모두 지원한다', async () => {
  const html = await source('index.html');
  const app = await source('src/app.js');
  assert.match(html, /🖼️ 사진 올려 판독/);
  assert.match(html, /id=["']barcode-photo["'][^>]*accept=["']image\/\*["']/);
  assert.doesNotMatch(html, /id=["']barcode-photo["'][^>]*capture=/);
  assert.match(html, /id=["']barcode-camera-photo["'][^>]*capture=["']environment["']/);
  assert.match(html, /id=["']scanner-camera-photo["'][^>]*capture=["']environment["']/);
  assert.match(app, /scanner-camera-photo/);
});

test('책을 찾으면 저장 전에도 표지 미리보기를 보여준다', async () => {
  const html = await source('index.html');
  const app = await source('src/app.js');
  assert.match(html, /id=["']cover-preview["']/);
  assert.match(html, /id=["']cover-preview-image["']/);
  assert.match(app, /renderCoverPreview/);
});

test('책 검색 직후 큰 대체 자료 안내 카드를 인라인으로 보여준다', async () => {
  const html = await source('index.html');
  const app = await source('src/app.js');
  const css = await source('styles.css');
  assert.match(html, /id=["']availability-alert["']/);
  assert.match(html, /id=["']availability-title["']/);
  assert.match(app, /renderAvailabilityAlert/);
  assert.match(app, /📄 PDF 있음/);
  assert.match(app, /📱 밀리에 있음/);
  assert.match(app, /👯 실물책 한 권 더 있음/);
  assert.match(css, /\.availability-alert/);
  assert.match(css, /\.availability-alert h3[^}]*font-size:\s*1\.55rem/);
});

test('대체 자료 없음 기준은 안내 카드 바로 아래에 작게 표시한다', async () => {
  const html = await source('index.html');
  const app = await source('src/app.js');
  const css = await source('styles.css');
  for (const text of ['✨ 상태 좋음', '💰🎁 대전 판매/기증', '📚 내용 좋음', '📤 스캔', '❤️ 소장 원함', '🏠 서울 보관', '🚫 필요 없음', '♻️ 폐기']) {
    assert.match(html, new RegExp(text));
  }
  assert.ok(html.indexOf('id="no-alternative-rules"') > html.indexOf('id="availability-alert"'));
  assert.doesNotMatch(html, /class="sorting-flow"/);
  assert.match(app, /noAlternativeRules\.hidden = availability\.any/);
  assert.match(css, /\.compact-rules h3[^}]*font-size:\s*16px/);
});

test('실물 상태와 최종 목적지는 한 번에 보이는 라디오 버튼이다', async () => {
  const html = await source('index.html');
  for (const name of ['nextTwoYears', 'condition', 'disposition']) {
    assert.doesNotMatch(html, new RegExp(`<select[^>]+name=["']${name}["']`));
    assert.match(html, new RegExp(`type=["']radio["'][^>]+name=["']${name}["']`));
  }
  for (const label of ['❔ 상태 확인 필요', '❤️ 소장 원함 → 🏠 서울 보관', '📚 내용 좋음 → 📤 스캔', '✨ 상태 좋음 → 💰🎁 대전 판매/기증', '🎁 기증', '🚫 필요 없음 → ♻️ 폐기']) {
    assert.match(html, new RegExp(label));
  }
});

test('대체 자료 카탈로그는 실물책장과 분리해 마이그레이션한다', async () => {
  const app = await source('src/app.js');
  assert.match(app, /migratePhysicalBooks/);
  assert.match(app, /physical-books-v6/);
  assert.doesNotMatch(app, /mergeVerifiedMillieCatalog\(loaded\)/);
  assert.doesNotMatch(app, /mergePdfCatalog\(mergeVerifiedMillieCatalog/);
});

test('스캔 완료 버튼은 PDF 있음과 폐기로 동시에 전환한다', async () => {
  const app = await source('src/app.js');
  assert.match(app, /✅ 스캔 완료 → 폐기/);
  assert.match(app, /pdfOwned: true, disposition: 'recycle'/);
});

test('책장 필터와 상단 요약은 새 실물 목적지만 보여준다', async () => {
  const html = await source('index.html');
  const app = await source('src/app.js');
  for (const option of ['❔ 상태 확인 필요', '🏠 서울 보관', '📤 스캔', '💰🎁 대전 판매/기증', '🎁 기증', '♻️ 폐기']) {
    assert.match(html, new RegExp(`<option[^>]*>${option}</option>`));
  }
  for (const label of ['📚 실물책', '❔ 확인 필요', '🏠 서울', '📤 스캔', '💰🎁 대전 판매/기증', '🎁 기증', '♻️ 폐기']) {
    assert.match(app, new RegExp(`summaryItem\\('${label}'`));
  }
});

test('새 화면과 이전 CSS가 섞이지 않도록 정적 파일 버전을 고정한다', async () => {
  const html = await source('index.html');
  const worker = await source('sw.js');
  assert.match(html, /styles\.css\?v=0\.4\.18/);
  assert.match(html, /src\/app\.js\?v=0\.4\.18/);
  assert.match(worker, /styles\.css\?v=0\.4\.18/);
  assert.match(worker, /src\/app\.js\?v=0\.4\.18/);
  assert.match(worker, /src\/pdf-catalog\.js/);
  assert.match(worker, /book-galpi-v24/);
});

test('바코드 폴리필 자산을 앱 자체에서 불러온다', async () => {
  const html = await source('index.html');
  assert.match(html, /vendor\/zbar-wasm\.js/);
  assert.match(html, /vendor\/barcode-detector-polyfill\.js/);
});

test('PWA 매니페스트와 서비스워커가 연결되어 있다', async () => {
  const html = await source('index.html');
  const manifest = JSON.parse(await source('manifest.webmanifest'));
  const app = await source('src/app.js');
  const worker = await source('sw.js');
  assert.match(html, /manifest\.webmanifest/);
  assert.equal(manifest.display, 'standalone');
  assert.match(app, /serviceWorker\.register/);
  assert.match(worker, /event\.request\.mode === 'navigate'/);
  assert.match(worker, /networkResponse\.clone\(\)/);
});

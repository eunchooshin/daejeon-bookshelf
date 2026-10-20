import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('앱 화면은 등록 폼, 검색, 책장, 데이터 백업 기능을 제공한다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const id of ['book-form', 'isbn', 'scan-isbn', 'scan-photo', 'barcode-photo', 'barcode-camera-photo', 'scanner-photo', 'scanner-camera-photo', 'lookup-isbn', 'search-millie', 'search', 'disposition-filter', 'bookshelf', 'export-csv', 'drive-backup', 'drive-restore', 'import-json', 'next-two-years', 'refocus-camera', 'toggle-torch', 'camera-zoom']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test('카메라 대신 갤러리의 바코드 사진을 올릴 수 있다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /🖼️ 사진 올려 판독/);
  assert.match(html, /id=["']barcode-photo["'][^>]*type=["']file["'][^>]*accept=["']image\/\*["']/);
  assert.doesNotMatch(html, /id=["']barcode-photo["'][^>]*capture=/);
});

test('휴대폰 기본 카메라로 바코드 사진을 찍어 판독할 수 있다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const app = await readFile(new URL('src/app.js', root), 'utf8');
  assert.match(html, /📷 바코드 사진 찍기/);
  assert.match(html, /id=["']barcode-camera-photo["'][^>]*capture=["']environment["']/);
  assert.match(html, /id=["']scanner-camera-photo["'][^>]*capture=["']environment["']/);
  assert.match(html, /id=["']scanner-photo["'][^>]*accept=["']image\/\*["']/);
  assert.match(app, /scanner-camera-photo/);
  assert.match(app, /scanner-photo/);
});

test('책을 찾으면 저장 전에도 표지 미리보기를 보여준다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const app = await readFile(new URL('src/app.js', root), 'utf8');
  assert.match(html, /id=["']cover-preview["']/);
  assert.match(html, /id=["']cover-preview-image["']/);
  assert.match(app, /renderCoverPreview/);
});

test('책 카드와 상단 요약에 PDF 소장 상태를 표시한다', async () => {
  const app = await readFile(new URL('src/app.js', root), 'utf8');
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(app, /📄 PDF 소장/);
  assert.match(app, /book\.pdfOwned/);
  assert.match(html, /📄 PDF 소장 → 🎁 기증/);
  assert.match(html, /📄 PDF 소장 → ♻️ 폐기/);
});

test('정리 선택지는 빠르게 구분할 수 있는 이모지를 포함한다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const label of ['📌 자주 참고함', '✍️ 메모·필기 있음', '💎 절판·희귀본', '🤔 판단이 안 됨', '✨ 양호', '📱 완전판 있음', '🏠 보관 · 서울']) {
    assert.match(html, new RegExp(label));
  }
});

test('정리 선택지는 드롭다운 대신 한 번에 보이는 라디오 버튼이다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const name of ['nextTwoYears', 'condition', 'millieStatus', 'disposition']) {
    assert.doesNotMatch(html, new RegExp(`<select[^>]+name=["']${name}["']`));
    assert.match(html, new RegExp(`type=["']radio["'][^>]+name=["']${name}["']`));
  }
  assert.match(html, /class=["'][^"']*choice-grid/);
});

test('최종 결정 기준을 눌러서 펼쳐 볼 수 있다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /<details class=["']criteria-guide["']/);
  assert.match(html, /🧭 최종 결정 기준 보기/);
  assert.match(html, /보류 상자 1개에만 보관/);
});

test('검수된 밀리 목록을 내 책장에 넣고 자동 표시한다고 안내한다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const app = await readFile(new URL('src/app.js', root), 'utf8');
  assert.match(html, /노션 표지를 붙인 밀리 보유 도서 121권을 내 책장에 넣고/);
  assert.match(app, /isVerifiedMillieTitle/);
  assert.match(app, /setFormChoice\('millieStatus', 'full'\)/);
  assert.match(app, /mergeVerifiedMillieCatalog/);
  assert.match(app, /daejeon-bookshelf\.millie-catalog-2026-10-08/);
  assert.match(app, /cls-121-pdf-67-v5/);
  assert.match(app, /📱 밀리에도 있음/);
});

test('책장 필터 드롭다운에도 결정별 이모지를 표시한다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const option of ['🏠 보관 · 서울', '🏡 보관 · 대전', '👯 중복 → 🎁 기증', '👯 중복 → ♻️ 폐기', '📱 밀리 → 🎁 기증', '📱 밀리 → ♻️ 폐기', '💰 중고 판매 · 상태 좋음']) {
    assert.match(html, new RegExp(`<option[^>]*>${option}</option>`));
  }
  assert.doesNotMatch(html, /온라인 읽은 책/);
});

test('상단 요약은 보관·스캔·중복·밀리·판매 체계를 이모지와 함께 보여준다', async () => {
  const app = await readFile(new URL('src/app.js', root), 'utf8');
  for (const label of ['📚 전체', '🏠 서울 보관', '🏡 대전 보관', '📄 스캔', '👯 중복 정리', '📱 밀리 대체', '💰 중고 판매', '📦 보류']) {
    assert.match(app, new RegExp(`summaryItem\\('${label}'`));
  }
  assert.doesNotMatch(app, /summaryItem\('온라인 읽은 책'/);
});

test('새 화면과 이전 CSS가 섞이지 않도록 정적 파일 버전을 고정한다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const worker = await readFile(new URL('sw.js', root), 'utf8');
  assert.match(html, /styles\.css\?v=0\.4\.15/);
  assert.match(html, /src\/app\.js\?v=0\.4\.15/);
  assert.match(worker, /styles\.css\?v=0\.4\.15/);
  assert.match(worker, /src\/app\.js\?v=0\.4\.15/);
  assert.match(worker, /src\/millie-covers\.js/);
  assert.match(worker, /book-galpi-v21/);
});

test('바코드 폴리필 자산을 앱 자체에서 불러온다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /vendor\/zbar-wasm\.js/);
  assert.match(html, /vendor\/barcode-detector-polyfill\.js/);
});

test('PWA 매니페스트와 서비스워커가 연결되어 있다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
  const app = await readFile(new URL('src/app.js', root), 'utf8');
  const worker = await readFile(new URL('sw.js', root), 'utf8');
  assert.match(html, /manifest\.webmanifest/);
  assert.equal(manifest.display, 'standalone');
  assert.match(app, /serviceWorker\.register/);
  assert.match(worker, /event\.request\.mode === 'navigate'/);
  assert.match(worker, /networkResponse\.clone\(\)/);
});

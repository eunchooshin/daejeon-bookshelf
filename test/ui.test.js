import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('앱 화면은 등록 폼, 검색, 책장, 데이터 백업 기능을 제공한다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const id of ['book-form', 'isbn', 'scan-isbn', 'scan-photo', 'barcode-photo', 'lookup-isbn', 'search-millie', 'search', 'disposition-filter', 'bookshelf', 'export-csv', 'drive-backup', 'drive-restore', 'import-json', 'next-two-years', 'refocus-camera', 'toggle-torch', 'camera-zoom']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test('책을 찾으면 저장 전에도 표지 미리보기를 보여준다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const app = await readFile(new URL('src/app.js', root), 'utf8');
  assert.match(html, /id=["']cover-preview["']/);
  assert.match(html, /id=["']cover-preview-image["']/);
  assert.match(app, /renderCoverPreview/);
});

test('정리 선택지는 빠르게 구분할 수 있는 이모지를 포함한다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const label of ['📌 자주 참고함', '✍️ 메모·필기 있음', '💎 절판·희귀본', '🤔 판단이 안 됨', '✨ 양호', '📱 완전판 있음', '🚚 서울행']) {
    assert.match(html, new RegExp(label));
  }
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

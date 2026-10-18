import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('앱 화면은 등록 폼, 검색, 책장, 데이터 백업 기능을 제공한다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const id of ['book-form', 'isbn', 'scan-isbn', 'lookup-isbn', 'search-millie', 'search', 'disposition-filter', 'bookshelf', 'export-csv', 'drive-backup', 'drive-restore', 'import-json', 'next-two-years', 'refocus-camera', 'toggle-torch', 'camera-zoom']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test('PWA 매니페스트와 서비스워커가 연결되어 있다', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
  const app = await readFile(new URL('src/app.js', root), 'utf8');
  assert.match(html, /manifest\.webmanifest/);
  assert.equal(manifest.display, 'standalone');
  assert.match(app, /serviceWorker\.register/);
});

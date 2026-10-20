import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './worker.js';

const ORIGIN = 'https://eunchooshin.github.io';

function request(path, options = {}) {
  return new Request(`https://book-galpi-api.example${path}`, {
    headers: { Origin: ORIGIN, ...(options.headers || {}) },
    method: options.method || 'GET',
  });
}

test('상태 확인은 인증키 없이 성공한다', async () => {
  const response = await handleRequest(request('/health'), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'book-galpi-api' });
});

test('잘못된 ISBN은 외부 API를 호출하지 않고 거부한다', async () => {
  const response = await handleRequest(request('/book?isbn=123'), { NLK_API_KEY: 'secret' }, async () => {
    throw new Error('호출되면 안 됨');
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'INVALID_ISBN');
});

test('국립중앙도서관에서 ISBN 일치 도서와 HTTPS 표지를 반환한다', async () => {
  let upstreamUrl = '';
  const response = await handleRequest(
    request('/book?isbn=979-11-88102-05-1'),
    { NLK_API_KEY: 'secret' },
    async (url) => {
      upstreamUrl = String(url);
      return Response.json({
        TOTAL_COUNT: '2',
        docs: [
          { TITLE: '다른 책', EA_ISBN: '9790000000000' },
          {
            TITLE: '더 시스템',
            AUTHOR: '스콧 애덤스',
            PUBLISHER: '베리북',
            EA_ISBN: '9791188102051',
            TITLE_URL: 'http://example.com/cover.jpg',
            PUBLISH_PREDATE: '20240101',
          },
        ],
      });
    },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  assert.match(upstreamUrl, /isbn=9791188102051/);
  assert.match(upstreamUrl, /cert_key=secret/);
  assert.deepEqual(await response.json(), {
    isbn: '9791188102051',
    title: '더 시스템',
    author: '스콧 애덤스',
    publisher: '베리북',
    coverUrl: 'https://example.com/cover.jpg',
    publishedDate: '20240101',
    source: '국립중앙도서관',
  });
});

test('검색 결과가 없으면 404를 반환한다', async () => {
  const response = await handleRequest(
    request('/book?isbn=9791188102051'),
    { NLK_API_KEY: 'secret' },
    async () => Response.json({ TOTAL_COUNT: '0', docs: [] }),
  );
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error, 'BOOK_NOT_FOUND');
});

test('허용하지 않은 사이트 요청에는 CORS 허용 헤더를 주지 않는다', async () => {
  const response = await handleRequest(new Request('https://book-galpi-api.example/health', {
    headers: { Origin: 'https://evil.example' },
  }), {});
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

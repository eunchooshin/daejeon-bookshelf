import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCameraConstraints,
  googleBookToMetadata,
  millieSearchUrl,
} from '../src/integrations.js';

test('후면 카메라를 고해상도 연속 초점으로 요청한다', () => {
  const constraints = buildCameraConstraints();
  assert.equal(constraints.video.facingMode.ideal, 'environment');
  assert.equal(constraints.video.width.ideal, 1920);
  assert.equal(constraints.video.height.ideal, 1080);
  assert.match(JSON.stringify(constraints.video), /continuous/);
});

test('Google Books ISBN 결과를 책 메타데이터로 변환한다', () => {
  const data = {
    items: [{ volumeInfo: {
      title: '테스트 책',
      authors: ['홍길동'],
      publisher: '테스트 출판사',
      imageLinks: { thumbnail: 'http://books.google.com/cover.jpg' },
      industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781234567890' }],
    } }],
  };
  assert.deepEqual(googleBookToMetadata(data, '9781234567890'), {
    title: '테스트 책',
    author: '홍길동',
    publisher: '테스트 출판사',
    coverUrl: 'https://books.google.com/cover.jpg',
  });
});

test('밀리 검색은 ISBN 대신 확인된 정확한 제목을 공식 검색 경로로 연다', () => {
  const url = millieSearchUrl({ title: '테스트 책', author: '홍길동', isbn: '9781234567890' });
  assert.equal(url, 'https://www.millie.co.kr/v3/search/result/%ED%85%8C%EC%8A%A4%ED%8A%B8%20%EC%B1%85');
});

test('제목을 못 찾았을 때만 ISBN을 밀리 검색어로 사용한다', () => {
  assert.equal(millieSearchUrl({ isbn: '9781234567890' }), 'https://www.millie.co.kr/v3/search/result/9781234567890');
});

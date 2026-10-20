import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCameraConstraints,
  googleBookToMetadata,
  googleBooksJsonpUrl,
  localBookMetadata,
  mergeBookMetadata,
  millieSearchUrl,
  nlkBookToMetadata,
  nlkWorkerToMetadata,
  nlkWorkerUrl,
  openLibraryJsonpUrl,
  pickBarcodeDetector,
} from '../src/integrations.js';

test('후면 카메라를 고해상도 연속 초점으로 요청한다', () => {
  const constraints = buildCameraConstraints();
  assert.equal(constraints.video.facingMode.ideal, 'environment');
  assert.equal(constraints.video.width.ideal, 1920);
  assert.equal(constraints.video.height.ideal, 1080);
  assert.match(JSON.stringify(constraints.video), /continuous/);
});

test('기본 바코드 API가 없는 브라우저에서는 내장 폴리필을 사용한다', () => {
  class PolyfillDetector {}
  assert.equal(pickBarcodeDetector(undefined, PolyfillDetector), PolyfillDetector);
});

test('Google Books JSONP 주소는 CORS 없이 ISBN을 조회할 수 있게 만든다', () => {
  assert.equal(
    googleBooksJsonpUrl('9788936434120', 'bookCallback'),
    'https://www.googleapis.com/books/v1/volumes?q=isbn%3A9788936434120&maxResults=5&callback=bookCallback',
  );
});

test('Open Library JSONP 주소도 CORS 없이 ISBN을 조회할 수 있게 만든다', () => {
  assert.equal(
    openLibraryJsonpUrl('9788936434120', 'bookCallback'),
    'https://openlibrary.org/api/books?bibkeys=ISBN%3A9788936434120&jscmd=data&format=json&callback=bookCallback',
  );
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

test('책갈피 Worker 주소는 정규화한 ISBN만 전달한다', () => {
  assert.equal(
    nlkWorkerUrl('979-11-88102-05-1'),
    'https://book-galpi-api.eunchooshin.workers.dev/book?isbn=9791188102051',
  );
});

test('책갈피 Worker 응답을 표지 포함 메타데이터로 변환한다', () => {
  assert.deepEqual(nlkWorkerToMetadata({
    isbn: '9791188102051',
    title: '더 시스템',
    author: '스콧 애덤스',
    publisher: '베리북',
    coverUrl: 'http://example.com/cover.jpg',
  }), {
    title: '더 시스템',
    author: '스콧 애덤스',
    publisher: '베리북',
    coverUrl: 'https://example.com/cover.jpg',
  });
});

test('국립중앙도서관에 표지가 없으면 검수된 보조 표지만 합친다', () => {
  assert.deepEqual(mergeBookMetadata({
    title: '더 시스템',
    author: '지은이: 스콧 애덤스 ;옮긴이: 김인수',
    publisher: '베리북',
    coverUrl: '',
  }, {
    title: '다른 제목',
    author: '다른 저자',
    publisher: '다른 출판사',
    coverUrl: 'https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/9791188102051.jpg',
  }), {
    title: '더 시스템',
    author: '지은이: 스콧 애덤스 ;옮긴이: 김인수',
    publisher: '베리북',
    coverUrl: 'https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/9791188102051.jpg',
  });
});

test('국립중앙도서관 응답에서 정확한 ISBN과 표지를 추출한다', () => {
  const data = {
    TOTAL_COUNT: '1',
    docs: [{
      TITLE: '표지가 있는 책',
      AUTHOR: '홍길동 지음',
      PUBLISHER: '테스트출판사',
      EA_ISBN: '9791188102051',
      TITLE_URL: 'http://example.com/cover.jpg',
    }],
  };
  assert.deepEqual(nlkBookToMetadata(data, '979-11-88102-05-1'), {
    title: '표지가 있는 책',
    author: '홍길동 지음',
    publisher: '테스트출판사',
    coverUrl: 'https://example.com/cover.jpg',
  });
});

test('외부 도서 DB에 없는 검수 완료 국내 ISBN은 내장 목록에서 찾는다', () => {
  assert.deepEqual(localBookMetadata('9791188102051'), {
    title: '더 시스템',
    author: '스콧 애덤스',
    publisher: '베리북',
    coverUrl: 'https://contents.kyobobook.co.kr/sih/fit-in/458x0/pdt/9791188102051.jpg',
  });
});

test('밀리 검색은 ISBN 대신 확인된 정확한 제목을 공식 검색 경로로 연다', () => {
  const url = millieSearchUrl({ title: '테스트 책', author: '홍길동', isbn: '9781234567890' });
  assert.equal(url, 'https://www.millie.co.kr/v3/search/result/%ED%85%8C%EC%8A%A4%ED%8A%B8%20%EC%B1%85');
});

test('제목을 못 찾았을 때만 ISBN을 밀리 검색어로 사용한다', () => {
  assert.equal(millieSearchUrl({ isbn: '9781234567890' }), 'https://www.millie.co.kr/v3/search/result/9781234567890');
});

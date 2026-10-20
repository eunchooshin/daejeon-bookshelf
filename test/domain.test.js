import test from 'node:test';
import assert from 'node:assert/strict';
import {
  recommendDisposition,
  normalizeIsbn,
  booksToCsv,
  createBook,
  upsertBook,
  removeBook,
  filterBooks,
  isOutbound,
  assignDeferredBox,
  buildBackup,
  parseBackup,
  mergeVerifiedMillieCatalog,
} from '../src/domain.js';

test('1~2년 안에 확실히 읽거나 자주 참고할 책은 서울행을 권한다', () => {
  assert.equal(recommendDisposition({ nextTwoYears: 'yes' }), 'seoul');
  assert.equal(recommendDisposition({ frequentReference: true }), 'seoul');
});

test('절판·전문자료·메모가 있는 대체 불가 책은 보관을 권한다', () => {
  assert.equal(recommendDisposition({ rare: true }), 'keep');
  assert.equal(recommendDisposition({ professional: true }), 'keep');
  assert.equal(recommendDisposition({ annotated: true }), 'keep');
});

test('서울 집에 같은 책이 있으면 중복 정리를 권한다', () => {
  assert.equal(recommendDisposition({ duplicateInSeoul: true, nextTwoYears: 'yes' }), 'duplicate');
});

test('쉽게 다시 구할 수 있고 읽을 시점이 불분명하면 판매 또는 기부를 권한다', () => {
  assert.equal(recommendDisposition({ easyToReplace: true, nextTwoYears: 'unsure', resaleValue: true }), 'sell');
  assert.equal(recommendDisposition({ easyToReplace: true, nextTwoYears: 'no', resaleValue: false }), 'donate');
});

test('이미 읽은 참고용 책은 온라인 나의 읽은 책으로 보낸다', () => {
  assert.equal(recommendDisposition({ alreadyRead: true, referenceBook: true }), 'read_archive');
});

test('판단 근거가 부족하면 보류 상자로 보내고 상자는 하나로 고정한다', () => {
  assert.equal(recommendDisposition({ nextTwoYears: 'unsure' }), 'defer');
  assert.equal(assignDeferredBox({ disposition: 'defer', box: '' }).box, '보류 상자 1');
  assert.equal(assignDeferredBox({ disposition: 'defer', box: '보류 상자 2' }).box, '보류 상자 1');
});

test('밀리 완전판이고 1~2년 안에 읽지 않을 책은 밀리 대체를 권한다', () => {
  assert.equal(recommendDisposition({ millieStatus: 'full', nextTwoYears: 'no' }), 'millie');
});

test('상태가 나쁜 책은 폐기를 권한다', () => {
  assert.equal(recommendDisposition({ condition: 'worn', nextTwoYears: 'no' }), 'recycle');
});

test('ISBN에서 하이픈과 공백을 제거하고 유효 길이만 허용한다', () => {
  assert.equal(normalizeIsbn('978-89-1234-567-8'), '9788912345678');
  assert.equal(normalizeIsbn(' 0-306-40615-2 '), '0306406152');
  assert.equal(normalizeIsbn('1234'), '');
});

test('CSV 내보내기는 쉼표와 따옴표를 안전하게 이스케이프한다', () => {
  const csv = booksToCsv([{ title: '책, 하나', author: '김"추츄', disposition: 'keep' }]);
  assert.match(csv, /"책, 하나"/);
  assert.match(csv, /"김""추츄"/);
  assert.match(csv, /대체 불가 보관/);
});

test('새 책은 새 기준의 기본값과 추천 결정을 포함한다', () => {
  const book = createBook({ id: 'fixed', title: '정리할 책', nextTwoYears: 'yes' });
  assert.equal(book.id, 'fixed');
  assert.equal(book.disposition, 'seoul');
  assert.equal(book.nextTwoYears, 'yes');
  assert.equal(createBook({ id: 'default', title: '미정 책' }).nextTwoYears, 'unsure');
  assert.equal(book.millieStatus, 'unchecked');
});

test('검수된 제목의 책은 기존 수동 선택을 해치지 않고 밀리 완전판으로 표시한다', () => {
  assert.equal(createBook({ id: 'millie', title: '세이노의 가르침' }).millieStatus, 'full');
  assert.equal(createBook({ id: 'manual', title: '세이노의 가르침', millieStatus: 'not_found' }).millieStatus, 'not_found');
});

test('검수된 밀리 도서 121권을 내 책장에 중복 없이 추가한다', () => {
  const existing = createBook({ id: 'manual', title: '세이노의 가르침', millieStatus: 'not_found' });
  const imported = mergeVerifiedMillieCatalog([existing], '2026-10-20T00:00:00.000Z');
  assert.equal(imported.length, 121);
  assert.equal(imported.find((book) => book.id === 'manual').millieStatus, 'not_found');
  assert.equal(imported.find((book) => book.title === '습관의 힘').millieStatus, 'full');
  assert.equal(imported.find((book) => book.title === '습관의 힘').source, 'cls-millie-catalog-2026-10-08');
  assert.equal(mergeVerifiedMillieCatalog(imported).length, 121);
});

test('책장은 추가와 수정 시 기존 순서를 안전하게 유지한다', () => {
  const first = createBook({ id: '1', title: '첫 책' });
  const second = createBook({ id: '2', title: '둘째 책' });
  const added = upsertBook([first], second);
  const updated = upsertBook(added, { ...first, title: '수정된 첫 책' });
  assert.deepEqual(updated.map((book) => book.title), ['수정된 첫 책', '둘째 책']);
});

test('책장에서 지정한 책만 삭제한다', () => {
  assert.deepEqual(removeBook([{ id: '1' }, { id: '2' }], '1'), [{ id: '2' }]);
});

test('제목 검색과 정리 결정 필터를 함께 적용한다', () => {
  const books = [
    { title: '영어 공부', author: '추츄', disposition: 'keep' },
    { title: '개발 공부', author: '슈퍼할미', disposition: 'scan' },
  ];
  assert.equal(filterBooks(books, { query: '개발', disposition: 'scan' }).length, 1);
  assert.equal(filterBooks(books, { query: '추츄', disposition: 'all' }).length, 1);
});

test('서울행과 온라인 읽은 책을 포함해 대전 집에서 나갈 책을 센다', () => {
  for (const disposition of ['seoul', 'read_archive', 'duplicate', 'scan', 'millie', 'sell', 'donate', 'recycle']) {
    assert.equal(isOutbound({ disposition }), true);
  }
  assert.equal(isOutbound({ disposition: 'keep' }), false);
  assert.equal(isOutbound({ disposition: 'defer' }), false);
});

test('Google Drive 백업은 버전 정보와 책 목록을 담고 다시 복원된다', () => {
  const source = [createBook({ id: 'drive-1', title: '드라이브 책', nextTwoYears: 'yes' })];
  const backup = buildBackup(source, '2026-10-18T00:00:00.000Z');
  assert.equal(backup.app, '책갈피');
  assert.equal(backup.version, 2);
  assert.equal(backup.exportedAt, '2026-10-18T00:00:00.000Z');
  assert.equal(parseBackup(JSON.stringify(backup))[0].title, '드라이브 책');
});

test('이전 배열 백업도 복원하고 잘못된 백업은 거부한다', () => {
  assert.equal(parseBackup(JSON.stringify([{ id: 'old', title: '옛 백업' }]))[0].title, '옛 백업');
  assert.throws(() => parseBackup('{"wrong":true}'), /올바른/);
});

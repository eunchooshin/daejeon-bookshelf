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
} from '../src/domain.js';

test('애장본이나 희귀본은 실물 보관을 권한다', () => {
  assert.equal(recommendDisposition({ favorite: true }), 'keep');
  assert.equal(recommendDisposition({ rare: true }), 'keep');
});

test('업무 참고서는 보존용 스캔을 권한다', () => {
  assert.equal(recommendDisposition({ workReference: true }), 'scan');
});

test('밀리 완전판이 있고 다시 읽을 가능성이 낮으면 밀리 대체를 권한다', () => {
  assert.equal(recommendDisposition({ millieStatus: 'full', reread: 'low' }), 'millie');
});

test('양호하고 중고가치가 있으면 판매, 없으면 기증을 권한다', () => {
  assert.equal(recommendDisposition({ condition: 'good', resaleValue: true }), 'sell');
  assert.equal(recommendDisposition({ condition: 'good', resaleValue: false }), 'donate');
});

test('상태가 나쁘면 폐기를 권한다', () => {
  assert.equal(recommendDisposition({ condition: 'worn' }), 'recycle');
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
  assert.match(csv, /실물 보관/);
});

test('새 책은 기본값과 추천 결정을 포함한다', () => {
  const book = createBook({ id: 'fixed', title: '정리할 책', workReference: true });
  assert.equal(book.id, 'fixed');
  assert.equal(book.disposition, 'scan');
  assert.equal(book.millieStatus, 'unchecked');
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

test('자가 스캔을 포함해 실물 보관 외 결정은 집에서 내보낼 책으로 센다', () => {
  for (const disposition of ['scan', 'millie', 'sell', 'donate', 'recycle']) {
    assert.equal(isOutbound({ disposition }), true);
  }
  assert.equal(isOutbound({ disposition: 'keep' }), false);
});

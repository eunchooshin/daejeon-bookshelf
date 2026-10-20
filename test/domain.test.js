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
  buildBackup,
  parseBackup,
  migratePhysicalBooks,
  availabilityForTitle,
  buildBookshelfView,
  dispositionLabels,
} from '../src/domain.js';

test('대체 자료가 없고 자주 볼 책은 서울 보관을 권한다', () => {
  assert.equal(recommendDisposition({ condition: 'good', nextTwoYears: 'yes' }), 'keep_seoul');
  assert.equal(recommendDisposition({ condition: 'good', frequentReference: true }), 'keep_seoul');
});

test('대체 자료가 없고 내용 가치가 있는 책은 스캔을 권한다', () => {
  assert.equal(recommendDisposition({ condition: 'good', rare: true }), 'scan_pending');
  assert.equal(recommendDisposition({ condition: 'good', professional: true }), 'scan_pending');
  assert.equal(recommendDisposition({ condition: 'good', annotated: true }), 'scan_pending');
});

test('PDF·밀리·실물 중복은 상태가 좋으면 판매, 훼손되면 폐기를 권한다', () => {
  assert.equal(recommendDisposition({ duplicateInSeoul: true, condition: 'good' }), 'sell');
  assert.equal(recommendDisposition({ duplicateInSeoul: true, condition: 'worn' }), 'recycle');
  assert.equal(recommendDisposition({ millieStatus: 'full', condition: 'good' }), 'sell');
  assert.equal(recommendDisposition({ pdfOwned: true, condition: 'worn' }), 'recycle');
});

test('상태를 확인하지 않은 책은 상태 확인 필요로 둔다', () => {
  assert.equal(recommendDisposition({ condition: 'unknown', millieStatus: 'full' }), 'review');
  assert.equal(createBook({ title: '미정 책' }).disposition, 'review');
});

test('대체 자료가 없고 필요 없는 책은 폐기하되 내용이 좋으면 스캔을 권한다', () => {
  assert.equal(recommendDisposition({ condition: 'worn', nextTwoYears: 'no' }), 'recycle');
  assert.equal(recommendDisposition({ condition: 'worn', referenceBook: true }), 'scan_pending');
});

test('상태가 좋지 않은 책을 판매로 강제 지정하지 못한다', () => {
  assert.equal(createBook({ title: '훼손 책', disposition: 'sell', condition: 'worn' }).disposition, 'review');
});

test('ISBN에서 하이픈과 공백을 제거하고 유효 길이만 허용한다', () => {
  assert.equal(normalizeIsbn('978-89-1234-567-8'), '9788912345678');
  assert.equal(normalizeIsbn(' 0-306-40615-2 '), '0306406152');
  assert.equal(normalizeIsbn('1234'), '');
});

test('CSV 내보내기는 쉼표와 따옴표를 안전하게 이스케이프한다', () => {
  const csv = booksToCsv([{ title: '책, 하나', author: '김"추츄', disposition: 'keep_seoul' }]);
  assert.match(csv, /"책, 하나"/);
  assert.match(csv, /"김""추츄"/);
  assert.match(csv, /서울 보관/);
});

test('검수된 제목은 자동으로 밀리·PDF 대체 상태를 붙인다', () => {
  const millie = createBook({ id: 'millie', title: '세이노의 가르침' });
  const both = createBook({ id: 'both', title: '아웃풋 트레이닝' });
  assert.equal(millie.millieStatus, 'full');
  assert.equal(both.millieStatus, 'full');
  assert.equal(both.pdfOwned, true);
});

test('대체 자료 카탈로그는 실물책장에서 제거하고 사용자가 등록한 실물책만 보존한다', () => {
  const migrated = migratePhysicalBooks([
    createBook({ id: 'millie-auto', title: '자동 밀리', source: 'cls-millie-catalog-2026-10-08' }),
    createBook({ id: 'pdf-auto', title: '자동 PDF', source: 'cls-google-drive-pdf-2026-10-20' }),
    createBook({ id: 'physical', title: '실물책', notes: '기존 메모' }),
  ]);
  assert.deepEqual(migrated.map((book) => book.id), ['physical']);
  assert.equal(migrated[0].notes, '기존 메모');
});

test('검색 제목에 PDF와 밀리가 모두 있으면 두 대체 자료를 함께 알려준다', () => {
  assert.deepEqual(availabilityForTitle('아웃풋 트레이닝'), {
    pdf: true,
    millie: true,
    duplicate: false,
    any: true,
  });
});

test('스캔 완료로 기록한 실물책도 다음 검색에서 PDF 있음으로 알려준다', () => {
  const physical = [createBook({ title: '나만의 스캔 책', pdfOwned: true })];
  assert.equal(availabilityForTitle('나만의 스캔 책', physical).pdf, true);
});

test('대체 자료가 없으면 명확히 없음으로 반환한다', () => {
  assert.deepEqual(availabilityForTitle('등록되지 않은 실물책'), {
    pdf: false,
    millie: false,
    duplicate: false,
    any: false,
  });
});

test('대체 자료 카탈로그 187종은 내 책장에 보이고 실물책과 제목으로 합쳐진다', () => {
  const catalogOnly = buildBookshelfView([]);
  assert.equal(catalogOnly.length, 187);
  assert.equal(catalogOnly.every((book) => book.referenceOnly), true);

  const knownPhysical = createBook({ title: '아웃풋 트레이닝', notes: '실물 확인', processedAt: '2026-10-20T12:00:00.000Z' });
  const merged = buildBookshelfView([knownPhysical]);
  assert.equal(merged.length, 187);
  assert.equal(merged[0].title, '아웃풋 트레이닝');
  assert.equal(merged[0].referenceOnly, false);
  assert.equal(merged[0].notes, '실물 확인');
});

test('새로 처리한 실물책은 내 책장 가장 위에 쌓이고 처리일을 보존한다', () => {
  const processedAt = '2026-10-20T13:14:15.000Z';
  const view = buildBookshelfView([createBook({ title: '새 실물책', processedAt })]);
  assert.equal(view.length, 188);
  assert.equal(view[0].title, '새 실물책');
  assert.equal(view[0].processedAt, processedAt);
});

test('실물 목적지 드롭다운에는 새 원칙의 이모지 라벨만 제공한다', () => {
  assert.deepEqual(Object.keys(dispositionLabels), ['review', 'keep_seoul', 'scan_pending', 'sell', 'donate', 'recycle']);
  assert.equal(dispositionLabels.sell, '💰🎁 대전 판매/기증 · 상태 좋음');
  assert.equal(dispositionLabels.donate, '🎁 기증');
  assert.equal(dispositionLabels.recycle, '♻️ 폐기 · 필요 없음');
});

test('책장은 추가와 수정 시 기존 순서를 안전하게 유지한다', () => {
  const first = createBook({ id: '1', title: '첫 책' });
  const second = createBook({ id: '2', title: '둘째 책' });
  const updated = upsertBook(upsertBook([first], second), { ...first, title: '수정된 첫 책' });
  assert.deepEqual(updated.map((book) => book.title), ['수정된 첫 책', '둘째 책']);
});

test('책장에서 지정한 책만 삭제한다', () => {
  assert.deepEqual(removeBook([{ id: '1' }, { id: '2' }], '1'), [{ id: '2' }]);
});

test('제목 검색과 실물 목적지 필터를 함께 적용한다', () => {
  const books = [
    { title: '영어 공부', author: '추츄', disposition: 'keep_seoul' },
    { title: '개발 공부', author: '슈퍼할미', disposition: 'scan_pending' },
  ];
  assert.equal(filterBooks(books, { query: '개발', disposition: 'scan_pending' }).length, 1);
  assert.equal(filterBooks(books, { query: '추츄', disposition: 'all' }).length, 1);
});

test('실물책이 정리 상자나 폐기로 이동하는 목적지만 외부 이동으로 센다', () => {
  for (const disposition of ['scan_pending', 'sell', 'donate', 'recycle']) {
    assert.equal(isOutbound({ disposition }), true);
  }
  for (const disposition of ['review', 'keep_seoul']) {
    assert.equal(isOutbound({ disposition }), false);
  }
});

test('Google Drive 백업은 버전 정보와 책 목록을 담고 다시 복원된다', () => {
  const source = [createBook({ id: 'drive-1', title: '드라이브 책', condition: 'good', nextTwoYears: 'yes' })];
  const backup = buildBackup(source, '2026-10-20T00:00:00.000Z');
  assert.equal(backup.app, '책갈피');
  assert.equal(backup.version, 2);
  assert.equal(parseBackup(JSON.stringify(backup))[0].title, '드라이브 책');
});

test('이전 배열 백업도 복원하고 잘못된 백업은 거부한다', () => {
  assert.equal(parseBackup(JSON.stringify([{ id: 'old', title: '옛 백업' }]))[0].title, '옛 백업');
  assert.throws(() => parseBackup('{"wrong":true}'), /올바른/);
});

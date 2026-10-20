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
  mergePdfCatalog,
  dispositionLabels,
} from '../src/domain.js';

test('1~2년 안에 확실히 읽거나 자주 참고할 책은 서울행을 권한다', () => {
  assert.equal(recommendDisposition({ nextTwoYears: 'yes' }), 'keep_seoul');
  assert.equal(recommendDisposition({ frequentReference: true }), 'keep_seoul');
});

test('절판·전문자료·메모가 있는 대체 불가 책은 보관을 권한다', () => {
  assert.equal(recommendDisposition({ rare: true }), 'keep_daejeon');
  assert.equal(recommendDisposition({ professional: true }), 'keep_daejeon');
  assert.equal(recommendDisposition({ annotated: true }), 'keep_daejeon');
});

test('중복 책은 상태에 따라 기증 또는 폐기를 권한다', () => {
  assert.equal(recommendDisposition({ duplicateInSeoul: true, condition: 'good' }), 'duplicate_donate');
  assert.equal(recommendDisposition({ duplicateInSeoul: true, condition: 'worn' }), 'duplicate_recycle');
});

test('중고 판매는 상태가 좋은 책에만 권한다', () => {
  assert.equal(recommendDisposition({ easyToReplace: true, nextTwoYears: 'unsure', resaleValue: true, condition: 'good' }), 'sell');
  assert.equal(recommendDisposition({ easyToReplace: true, nextTwoYears: 'no', resaleValue: true, condition: 'worn' }), 'defer');
  assert.equal(createBook({ title: '훼손 책', disposition: 'sell', condition: 'worn' }).disposition, 'defer');
});

test('이미 읽은 책도 별도 온라인 분류 없이 다른 정리 기준을 따른다', () => {
  assert.equal(recommendDisposition({ alreadyRead: true, referenceBook: true }), 'defer');
});

test('판단 근거가 부족하면 보류 상자로 보내고 상자는 하나로 고정한다', () => {
  assert.equal(recommendDisposition({ nextTwoYears: 'unsure' }), 'defer');
  assert.equal(assignDeferredBox({ disposition: 'defer', box: '' }).box, '보류 상자 1');
  assert.equal(assignDeferredBox({ disposition: 'defer', box: '보류 상자 2' }).box, '보류 상자 1');
});

test('밀리 완전판이고 1~2년 안에 읽지 않을 책은 밀리 대체를 권한다', () => {
  assert.equal(recommendDisposition({ millieStatus: 'full', nextTwoYears: 'no', condition: 'good' }), 'millie_donate');
  assert.equal(recommendDisposition({ millieStatus: 'full', nextTwoYears: 'no', condition: 'worn' }), 'millie_recycle');
});

test('중복이나 밀리 근거가 없는 훼손 책은 자동 폐기하지 않고 보류한다', () => {
  assert.equal(recommendDisposition({ condition: 'worn', nextTwoYears: 'no' }), 'defer');
});

test('ISBN에서 하이픈과 공백을 제거하고 유효 길이만 허용한다', () => {
  assert.equal(normalizeIsbn('978-89-1234-567-8'), '9788912345678');
  assert.equal(normalizeIsbn(' 0-306-40615-2 '), '0306406152');
  assert.equal(normalizeIsbn('1234'), '');
});

test('CSV 내보내기는 쉼표와 따옴표를 안전하게 이스케이프한다', () => {
  const csv = booksToCsv([{ title: '책, 하나', author: '김"추츄', disposition: 'keep_daejeon' }]);
  assert.match(csv, /"책, 하나"/);
  assert.match(csv, /"김""추츄"/);
  assert.match(csv, /보관 · 대전/);
});

test('새 책은 새 기준의 기본값과 추천 결정을 포함한다', () => {
  const book = createBook({ id: 'fixed', title: '정리할 책', nextTwoYears: 'yes' });
  assert.equal(book.id, 'fixed');
  assert.equal(book.disposition, 'keep_seoul');
  assert.equal(book.nextTwoYears, 'yes');
  assert.equal(createBook({ id: 'default', title: '미정 책' }).nextTwoYears, 'unsure');
  assert.equal(book.millieStatus, 'unchecked');
});

test('검수된 제목의 책은 기존 수동 선택을 해치지 않고 밀리 완전판으로 표시한다', () => {
  assert.equal(createBook({ id: 'millie', title: '세이노의 가르침' }).millieStatus, 'full');
  assert.equal(createBook({ id: 'manual', title: '세이노의 가르침', millieStatus: 'not_found' }).millieStatus, 'not_found');
});

test('검수된 밀리 도서 121권을 내 책장에 중복 없이 추가한다', () => {
  const existing = createBook({ id: 'manual', title: '세이노의 가르침', millieStatus: 'not_found', disposition: 'keep_daejeon', notes: '기존 메모' });
  const imported = mergeVerifiedMillieCatalog([existing], '2026-10-20T00:00:00.000Z');
  assert.equal(imported.length, 121);
  assert.equal(imported.find((book) => book.id === 'manual').millieStatus, 'full');
  assert.equal(imported.find((book) => book.id === 'manual').disposition, 'millie_donate');
  assert.equal(imported.find((book) => book.id === 'manual').notes, '기존 메모');
  assert.equal(imported.find((book) => book.title === '습관의 힘').millieStatus, 'full');
  assert.equal(imported.find((book) => book.title === '습관의 힘').disposition, 'millie_donate');
  assert.match(imported.find((book) => book.title === '습관의 힘').coverUrl, /^assets\/covers\/millie\//);
  assert.equal(imported.find((book) => book.title === '습관의 힘').source, 'cls-millie-catalog-2026-10-08');
  assert.equal(mergeVerifiedMillieCatalog(imported).length, 121);
});

test('기존 책의 사용자 표지는 보존하고 빈 표지만 노션 그림으로 채운다', () => {
  const custom = createBook({ id: 'custom', title: '세이노의 가르침', coverUrl: 'https://example.com/custom.jpg' });
  const blank = createBook({ id: 'blank', title: '습관의 힘' });
  const merged = mergeVerifiedMillieCatalog([custom, blank]);
  assert.equal(merged.find((book) => book.id === 'custom').coverUrl, 'https://example.com/custom.jpg');
  assert.match(merged.find((book) => book.id === 'blank').coverUrl, /^assets\/covers\/millie\//);
});

test('Drive PDF 67종을 중복 없이 합치고 밀리 중복 책은 두 소장 상태를 모두 보존한다', () => {
  const millie = mergeVerifiedMillieCatalog([], '2026-10-20T00:00:00.000Z');
  const merged = mergePdfCatalog(millie, '2026-10-20T00:00:00.000Z');
  assert.equal(merged.length, 187);
  const overlap = merged.find((book) => book.title === '아웃풋 트레이닝');
  assert.equal(overlap.pdfOwned, true);
  assert.equal(overlap.millieStatus, 'full');
  assert.equal(overlap.disposition, 'pdf_donate');
  assert.equal(mergePdfCatalog(merged).length, 187);
});

test('책 카드 드롭다운에 정리 결정 이모지가 포함된다', () => {
  assert.equal(dispositionLabels.millie_donate, '📱 밀리 → 🎁 기증');
  assert.equal(dispositionLabels.keep_daejeon, '🏡 보관 · 대전');
  assert.equal(dispositionLabels.sell, '💰 중고 판매 · 상태 좋음');
  assert.equal(dispositionLabels.pdf_donate, '📄 PDF 소장 → 🎁 기증');
  assert.equal(dispositionLabels.pdf_recycle, '📄 PDF 소장 → ♻️ 폐기');
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
    { title: '영어 공부', author: '추츄', disposition: 'keep_daejeon' },
    { title: '개발 공부', author: '슈퍼할미', disposition: 'scan' },
  ];
  assert.equal(filterBooks(books, { query: '개발', disposition: 'scan' }).length, 1);
  assert.equal(filterBooks(books, { query: '추츄', disposition: 'all' }).length, 1);
});

test('실물책 정리 대상으로 대전 집에서 나갈 책을 센다', () => {
  for (const disposition of ['scan', 'duplicate_donate', 'duplicate_recycle', 'millie_donate', 'millie_recycle', 'pdf_donate', 'pdf_recycle', 'sell']) {
    assert.equal(isOutbound({ disposition }), true);
  }
  assert.equal(isOutbound({ disposition: 'read_archive' }), false);
  assert.equal(isOutbound({ disposition: 'keep_seoul' }), false);
  assert.equal(isOutbound({ disposition: 'keep_daejeon' }), false);
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

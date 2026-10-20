import test from 'node:test';
import assert from 'node:assert/strict';
import { PDF_CATALOG, pdfFileCountForTitle } from '../src/pdf-catalog.js';

test('CLS Drive 하위 폴더까지 조사한 PDF는 중복 제거 후 67종이다', () => {
  assert.equal(PDF_CATALOG.length, 67);
  assert.equal(new Set(PDF_CATALOG.map((entry) => entry.title)).size, 67);
});

test('중복 PDF 파일 수와 밀리 중복 제목을 보존한다', () => {
  assert.equal(pdfFileCountForTitle('나는 이불 속에서 콘텐츠로 월급 번다'), 2);
  assert.equal(pdfFileCountForTitle('아웃풋 트레이닝'), 1);
});

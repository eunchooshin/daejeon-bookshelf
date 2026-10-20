import {
  applyVerifiedMillieStatus,
  isVerifiedMillieTitle,
  MILLIE_VERIFIED_TITLES,
  normalizeBookTitle,
} from './millie-catalog.js';
import { millieCoverForTitle } from './millie-covers.js';

export function recommendDisposition(book = {}) {
  if (book.duplicateInSeoul) return 'duplicate';
  if (book.alreadyRead && book.referenceBook) return 'read_archive';
  if (book.nextTwoYears === 'yes' || book.frequentReference) return 'seoul';
  if (book.favorite || book.rare || book.professional || book.annotated) return 'keep';
  if (book.millieStatus === 'full' && book.nextTwoYears === 'no') return 'millie';
  if (book.easyToReplace && book.nextTwoYears !== 'yes') return book.resaleValue ? 'sell' : 'donate';
  if (book.condition === 'worn' && book.nextTwoYears === 'no') return 'recycle';
  return 'defer';
}

export function normalizeIsbn(value = '') {
  const cleaned = String(value).replace(/[^0-9X]/gi, '').toUpperCase();
  return cleaned.length === 10 || cleaned.length === 13 ? cleaned : '';
}

export const dispositionLabels = {
  undecided: '❔ 미결정',
  seoul: '🚚 서울행',
  keep: '🔐 대체 불가 보관',
  read_archive: '📚 온라인 읽은 책',
  duplicate: '👯 중복 정리',
  defer: '📦 보류 상자',
  scan: '📄 자가 스캔',
  millie: '📱 밀리로 대체',
  sell: '💰 중고 판매',
  donate: '🎁 기증',
  recycle: '♻️ 폐기',
};

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function booksToCsv(books = []) {
  const fields = ['title', 'author', 'isbn', 'publisher', 'nextTwoYears', 'millieStatus', 'disposition', 'box', 'notes'];
  const header = ['제목', '저자', 'ISBN', '출판사', '1~2년 내 활용', '밀리 상태', '정리 결정', '박스/위치', '메모'];
  const lines = books.map((book) => fields.map((field) => {
    const value = field === 'disposition' ? dispositionLabels[book[field]] ?? book[field] : book[field];
    return csvCell(value);
  }).join(','));
  return `\uFEFF${header.join(',')}\n${lines.join('\n')}`;
}

export function buildBackup(books = [], exportedAt = new Date().toISOString()) {
  return { app: '책갈피', version: 2, exportedAt, books };
}

export function parseBackup(text) {
  const parsed = JSON.parse(text);
  const books = Array.isArray(parsed) ? parsed : parsed?.app === '책갈피' && Array.isArray(parsed.books) ? parsed.books : null;
  if (!books || books.some((book) => !book || typeof book.title !== 'string')) {
    throw new Error('올바른 책갈피 백업 파일이 아닙니다.');
  }
  return books;
}

export function createBook(input = {}) {
  const base = {
    id: input.id || crypto.randomUUID(),
    title: '',
    author: '',
    isbn: '',
    publisher: '',
    coverUrl: '',
    millieStatus: 'unchecked',
    disposition: 'undecided',
    box: '',
    notes: '',
    favorite: false,
    rare: false,
    annotated: false,
    professional: false,
    frequentReference: false,
    alreadyRead: false,
    referenceBook: false,
    duplicateInSeoul: false,
    easyToReplace: false,
    nextTwoYears: 'unsure',
    condition: 'good',
    resaleValue: false,
    createdAt: new Date().toISOString(),
  };
  const book = { ...base, ...input, isbn: normalizeIsbn(input.isbn) };
  book.millieStatus = applyVerifiedMillieStatus(book);
  book.disposition = input.disposition || recommendDisposition(book);
  return assignDeferredBox(book);
}

export function mergeVerifiedMillieCatalog(books = [], createdAt = new Date().toISOString()) {
  const merged = books.map((book) => {
    const normalized = createBook(book);
    if (!isVerifiedMillieTitle(normalized.title)) return normalized;
    return {
      ...normalized,
      coverUrl: normalized.coverUrl || millieCoverForTitle(normalized.title),
      millieStatus: 'full',
      disposition: 'millie',
    };
  });
  const existingTitles = new Set(merged.map((book) => normalizeBookTitle(book.title)));

  MILLIE_VERIFIED_TITLES.forEach((title, index) => {
    const normalizedTitle = normalizeBookTitle(title);
    if (!normalizedTitle || existingTitles.has(normalizedTitle)) return;
    merged.push(createBook({
      id: `millie-verified-${String(index + 1).padStart(3, '0')}`,
      title,
      coverUrl: millieCoverForTitle(title),
      millieStatus: 'full',
      disposition: 'millie',
      source: 'cls-millie-catalog-2026-10-08',
      createdAt,
    }));
    existingTitles.add(normalizedTitle);
  });

  return merged;
}

export function assignDeferredBox(book = {}) {
  return book.disposition === 'defer' ? { ...book, box: '보류 상자 1' } : book;
}

export function upsertBook(books = [], book) {
  const index = books.findIndex((candidate) => candidate.id === book.id);
  if (index < 0) return [...books, book];
  return books.map((candidate) => candidate.id === book.id ? book : candidate);
}

export function removeBook(books = [], id) {
  return books.filter((book) => book.id !== id);
}

export function isOutbound(book = {}) {
  return ['seoul', 'read_archive', 'duplicate', 'scan', 'millie', 'sell', 'donate', 'recycle'].includes(book.disposition);
}

export function filterBooks(books = [], { query = '', disposition = 'all' } = {}) {
  const needle = query.trim().toLocaleLowerCase('ko');
  return books.filter((book) => {
    const matchesText = !needle || [book.title, book.author, book.isbn, book.publisher, book.box]
      .some((value) => String(value || '').toLocaleLowerCase('ko').includes(needle));
    const matchesDisposition = disposition === 'all' || book.disposition === disposition;
    return matchesText && matchesDisposition;
  });
}

export function recommendDisposition(book = {}) {
  if (book.favorite || book.rare || book.annotated) return 'keep';
  if (book.workReference || book.reread === 'high') return 'scan';
  if (book.millieStatus === 'full' && book.reread === 'low') return 'millie';
  if (book.condition === 'good') return book.resaleValue ? 'sell' : 'donate';
  return 'recycle';
}

export function normalizeIsbn(value = '') {
  const cleaned = String(value).replace(/[^0-9X]/gi, '').toUpperCase();
  return cleaned.length === 10 || cleaned.length === 13 ? cleaned : '';
}

export const dispositionLabels = {
  undecided: '미결정',
  keep: '실물 보관',
  scan: '자가 스캔',
  millie: '밀리로 대체',
  sell: '중고 판매',
  donate: '기증',
  recycle: '폐기',
};

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function booksToCsv(books = []) {
  const fields = ['title', 'author', 'isbn', 'publisher', 'millieStatus', 'disposition', 'box', 'notes'];
  const header = ['제목', '저자', 'ISBN', '출판사', '밀리 상태', '정리 결정', '박스/위치', '메모'];
  const lines = books.map((book) => fields.map((field) => {
    const value = field === 'disposition' ? dispositionLabels[book[field]] ?? book[field] : book[field];
    return csvCell(value);
  }).join(','));
  return `\uFEFF${header.join(',')}\n${lines.join('\n')}`;
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
    workReference: false,
    reread: 'medium',
    condition: 'good',
    resaleValue: false,
    createdAt: new Date().toISOString(),
  };
  const book = { ...base, ...input, isbn: normalizeIsbn(input.isbn) };
  book.disposition = input.disposition || recommendDisposition(book);
  return book;
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
  return ['scan', 'millie', 'sell', 'donate', 'recycle'].includes(book.disposition);
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

export function buildCameraConstraints() {
  return {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920, min: 1280 },
      height: { ideal: 1080, min: 720 },
      frameRate: { ideal: 30 },
      focusMode: { ideal: 'continuous' },
      advanced: [{ focusMode: 'continuous' }],
    },
    audio: false,
  };
}

export function pickBarcodeDetector(nativeDetector, polyfillDetector) {
  return nativeDetector || polyfillDetector || null;
}

export function googleBooksJsonpUrl(isbn, callbackName) {
  const query = encodeURIComponent(`isbn:${String(isbn).trim()}`);
  return `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=5&callback=${encodeURIComponent(callbackName)}`;
}

export function openLibraryJsonpUrl(isbn, callbackName) {
  const bibkey = encodeURIComponent(`ISBN:${String(isbn).trim()}`);
  return `https://openlibrary.org/api/books?bibkeys=${bibkey}&jscmd=data&format=json&callback=${encodeURIComponent(callbackName)}`;
}

const VERIFIED_KOREAN_BOOKS = {
  '9791188102051': {
    title: '더 시스템',
    author: '스콧 애덤스',
    publisher: '베리북',
    coverUrl: '',
  },
};

export function localBookMetadata(isbn) {
  return VERIFIED_KOREAN_BOOKS[String(isbn).replace(/[^0-9X]/gi, '').toUpperCase()] || null;
}

export function googleBookToMetadata(data, isbn = '') {
  const items = Array.isArray(data?.items) ? data.items : [];
  const clean = String(isbn).replace(/[^0-9X]/gi, '').toUpperCase();
  const item = items.find(({ volumeInfo = {} }) =>
    (volumeInfo.industryIdentifiers || []).some(({ identifier }) =>
      String(identifier).replace(/[^0-9X]/gi, '').toUpperCase() === clean)) || items[0];
  if (!item?.volumeInfo) return null;
  const info = item.volumeInfo;
  return {
    title: info.title || '',
    author: (info.authors || []).join(', '),
    publisher: info.publisher || '',
    coverUrl: String(info.imageLinks?.thumbnail || info.imageLinks?.smallThumbnail || '').replace(/^http:/, 'https:'),
  };
}

export function millieSearchUrl({ title = '', isbn = '' } = {}) {
  const query = title.trim() || String(isbn).trim();
  return query ? `https://www.millie.co.kr/v3/search/result/${encodeURIComponent(query)}` : '';
}

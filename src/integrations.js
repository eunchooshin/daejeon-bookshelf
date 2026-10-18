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

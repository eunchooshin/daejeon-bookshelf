const ALLOWED_ORIGIN = 'https://eunchooshin.github.io';
const NLK_ENDPOINT = 'https://www.nl.go.kr/seoji/SearchApi.do';

function corsHeaders(request) {
  const origin = request.headers.get('Origin');
  return origin === ALLOWED_ORIGIN
    ? {
        'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        Vary: 'Origin',
      }
    : {};
}

function json(request, body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(request),
      'Cache-Control': status === 200 ? 'public, max-age=86400' : 'no-store',
    },
  });
}

function normalizeIsbn(value) {
  const isbn = String(value || '').replace(/[^0-9X]/gi, '').toUpperCase();
  return /^(?:\d{13}|\d{9}[\dX])$/.test(isbn) ? isbn : '';
}

function normalizeBook(payload, isbn) {
  const docs = Array.isArray(payload?.docs) ? payload.docs : [];
  const exact = docs.find(
    (book) => normalizeIsbn(book?.EA_ISBN) === isbn,
  );
  const book = exact || docs[0];
  if (!book?.TITLE) return null;

  return {
    isbn: normalizeIsbn(book.EA_ISBN) || isbn,
    title: String(book.TITLE || '').trim(),
    author: String(book.AUTHOR || '').trim(),
    publisher: String(book.PUBLISHER || '').trim(),
    coverUrl: String(book.TITLE_URL || '').trim().replace(/^http:/, 'https:'),
    publishedDate: String(book.REAL_PUBLISH_DATE || book.PUBLISH_PREDATE || '').trim(),
    source: '국립중앙도서관',
  };
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== 'GET') {
    return json(request, { error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const url = new URL(request.url);
  if (url.pathname === '/' || url.pathname === '/health') {
    return json(request, { ok: true, service: 'book-galpi-api' });
  }

  if (url.pathname !== '/book') {
    return json(request, { error: 'NOT_FOUND' }, 404);
  }

  const isbn = normalizeIsbn(url.searchParams.get('isbn'));
  if (!isbn) {
    return json(request, { error: 'INVALID_ISBN' }, 400);
  }

  if (!env?.NLK_API_KEY) {
    return json(request, { error: 'API_KEY_NOT_CONFIGURED' }, 503);
  }

  const upstreamUrl = new URL(NLK_ENDPOINT);
  upstreamUrl.searchParams.set('cert_key', env.NLK_API_KEY);
  upstreamUrl.searchParams.set('result_style', 'json');
  upstreamUrl.searchParams.set('page_no', '1');
  upstreamUrl.searchParams.set('page_size', '10');
  upstreamUrl.searchParams.set('isbn', isbn);

  try {
    const upstream = await fetchImpl(upstreamUrl.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (!upstream.ok) {
      return json(request, { error: 'UPSTREAM_ERROR' }, 502);
    }

    const payload = await upstream.json();
    const book = normalizeBook(payload, isbn);
    if (!book) {
      return json(request, { error: 'BOOK_NOT_FOUND' }, 404);
    }

    return json(request, book);
  } catch {
    return json(request, { error: 'UPSTREAM_ERROR' }, 502);
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};

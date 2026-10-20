import {
  buildBackup,
  booksToCsv,
  createBook,
  migratePhysicalBooks,
  availabilityForTitle,
  buildBookshelfView,
  dispositionLabels,
  filterBooks,
  isOutbound,
  normalizeIsbn,
  parseBackup,
  removeBook,
  upsertBook,
} from './domain.js';
import {
  buildCameraConstraints,
  googleBookToMetadata,
  googleBooksJsonpUrl,
  localBookMetadata,
  mergeBookMetadata,
  millieSearchUrl,
  nlkWorkerToMetadata,
  nlkWorkerUrl,
  openLibraryJsonpUrl,
  pickBarcodeDetector,
} from './integrations.js';
import { isVerifiedMillieTitle } from './millie-catalog.js';

const STORAGE_KEY = 'daejeon-bookshelf.v1';
const MILLIE_IMPORT_KEY = 'daejeon-bookshelf.millie-catalog-2026-10-08';
const CATALOG_IMPORT_MARKER = 'physical-books-v6';
const millieLabels = { unchecked: '밀리 확인 전', full: '📱 밀리에도 있음', partial: '밀리 일부·요약', not_found: '밀리 없음' };
const $ = (selector) => document.querySelector(selector);

const elements = {
  form: $('#book-form'),
  panel: $('#form-panel'),
  shelf: $('#bookshelf'),
  summary: $('#summary'),
  search: $('#search'),
  filter: $('#disposition-filter'),
  formTitle: $('#form-title'),
  lookupStatus: $('#lookup-status'),
  scannerDialog: $('#scanner-dialog'),
  scannerVideo: $('#scanner-video'),
  scannerStatus: $('#scanner-status'),
  toast: $('#toast'),
  availabilityAlert: $('#availability-alert'),
  availabilityTitle: $('#availability-title'),
  availabilityBadges: $('#availability-badges'),
  availabilityMessage: $('#availability-message'),
  noAlternativeRules: $('#no-alternative-rules'),
};

let books = loadBooks();
let draftCoverUrl = '';
let scannerStream = null;
let scannerTrack = null;
let scannerTimer = null;
let torchOn = false;

function loadBooks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    const stored = Array.isArray(parsed) ? parsed : [];
    const physical = migratePhysicalBooks(stored);
    if (localStorage.getItem(MILLIE_IMPORT_KEY) !== CATALOG_IMPORT_MARKER || physical.length !== stored.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(physical));
      localStorage.setItem(MILLIE_IMPORT_KEY, CATALOG_IMPORT_MARKER);
    }
    return physical;
  } catch {
    localStorage.setItem(STORAGE_KEY, '[]');
    localStorage.setItem(MILLIE_IMPORT_KEY, CATALOG_IMPORT_MARKER);
    return [];
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove('show'), 2400);
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function addText(parent, tag, text, className = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function summaryItem(label, value) {
  const item = document.createElement('div');
  item.className = 'summary-item';
  addText(item, 'span', label);
  addText(item, 'strong', String(value));
  return item;
}

function renderSummary(view) {
  elements.summary.replaceChildren(
    summaryItem('📚 내 책장', view.length),
    summaryItem('📦 처리한 실물책', books.length),
    summaryItem('❔ 확인 필요', books.filter((book) => book.disposition === 'review').length),
    summaryItem('🏠 서울', books.filter((book) => book.disposition === 'keep_seoul').length),
    summaryItem('📤 스캔', books.filter((book) => book.disposition === 'scan_pending').length),
    summaryItem('💰🎁 대전 판매/기증', books.filter((book) => book.disposition === 'sell').length),
    summaryItem('🎁 기증', books.filter((book) => book.disposition === 'donate').length),
    summaryItem('♻️ 폐기', books.filter((book) => book.disposition === 'recycle').length),
  );
}

function bookCover(book) {
  const cover = document.createElement('div');
  cover.className = 'book-cover';
  if (book.coverUrl) {
    const image = document.createElement('img');
    image.src = book.coverUrl;
    image.alt = `${book.title} 표지`;
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => {
      cover.replaceChildren();
      cover.textContent = book.title.slice(0, 4);
    }, { once: true });
    cover.append(image);
  } else {
    cover.textContent = book.title.slice(0, 4) || '책';
  }
  return cover;
}

function tag(text, className = '') {
  const node = document.createElement('span');
  node.className = `tag ${className}`.trim();
  node.textContent = text;
  return node;
}

function formatProcessedDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' }).format(date);
}

function dispositionSelect(book) {
  const select = document.createElement('select');
  select.className = 'disposition-select';
  select.setAttribute('aria-label', `${book.title} 정리 결정`);
  Object.entries(dispositionLabels).filter(([key]) => key !== 'undecided').forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    option.selected = book.disposition === value;
    select.append(option);
  });
  select.addEventListener('change', () => {
    books = upsertBook(books, { ...book, disposition: select.value, processedAt: new Date().toISOString(), referenceOnly: undefined });
    persist();
    render();
    showToast('정리 결정을 바꿨어요.');
  });
  return select;
}

function renderBook(book) {
  const card = document.createElement('article');
  card.className = 'book-card';
  card.dataset.id = book.id;
  card.append(bookCover(book));

  const main = document.createElement('div');
  main.className = 'book-main';
  addText(main, 'h3', book.title);
  const meta = [book.author, book.publisher, book.isbn].filter(Boolean).join(' · ');
  addText(main, 'div', meta || '저자·출판사 정보 없음', 'book-meta');
  if (book.box) addText(main, 'div', `위치: ${book.box}`, 'book-meta');
  if (book.processedAt) addText(main, 'div', `처리일 · ${formatProcessedDate(book.processedAt)}`, 'processed-date');
  const tags = document.createElement('div');
  tags.className = 'book-tags';
  if (book.referenceOnly) tags.append(tag('📚 대체 자료', 'reference'));
  else tags.append(tag(dispositionLabels[book.disposition] || '❔ 상태 확인 필요'));
  if (book.millieStatus === 'full') tags.append(tag('📱 밀리에 있음', 'millie'));
  if (book.pdfOwned) tags.append(tag(`📄 PDF 있음${book.pdfFileCount > 1 ? ` · ${book.pdfFileCount}개 파일` : ''}`, 'pdf'));
  if (book.duplicateInSeoul) tags.append(tag('👯 실물책 한 권 더 있음', 'duplicate'));
  if (book.millieStatus !== 'full' && !book.pdfOwned && !book.duplicateInSeoul) tags.append(tag('🚫 대체 자료 없음', 'no-alternative'));
  if (book.annotated) tags.append(tag('필기 있음'));
  if (book.rare) tags.append(tag('희귀·절판'));
  if (book.favorite) tags.append(tag('애장본'));
  main.append(tags);
  card.append(main);

  const actions = document.createElement('div');
  actions.className = 'book-actions';
  if (book.referenceOnly) {
    const processBook = addText(actions, 'button', '실물책 처리', 'button ghost');
    processBook.type = 'button';
    processBook.addEventListener('click', () => processReferenceBook(book));
    card.append(actions);
    return card;
  }
  actions.append(dispositionSelect(book));
  if (book.disposition === 'scan_pending') {
    const completeScan = addText(actions, 'button', '✅ 스캔 완료 → 폐기', 'button scan-complete');
    completeScan.type = 'button';
    completeScan.addEventListener('click', () => {
      books = upsertBook(books, { ...book, pdfOwned: true, disposition: 'recycle', processedAt: new Date().toISOString(), referenceOnly: undefined });
      persist();
      render();
      showToast('📄 PDF 있음으로 기록하고 실물책은 폐기로 옮겼어요.');
    });
  }
  const edit = addText(actions, 'button', '수정', 'link-button');
  edit.type = 'button';
  edit.addEventListener('click', () => editBook(book));
  const remove = addText(actions, 'button', '삭제', 'link-button delete-button');
  remove.type = 'button';
  remove.addEventListener('click', () => {
    if (!window.confirm(`「${book.title}」을 내 책장에서 삭제할까요?`)) return;
    books = removeBook(books, book.id);
    persist();
    render();
    showToast('책장에서 삭제했어요.');
  });
  card.append(actions);
  return card;
}

function render() {
  const view = buildBookshelfView(books);
  renderSummary(view);
  const visible = filterBooks(view, { query: elements.search.value, disposition: elements.filter.value });
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    addText(empty, 'h3', '조건에 맞는 책이 없어요.');
    addText(empty, 'p', '검색어나 필터를 바꿔보세요.');
    const button = addText(empty, 'button', '첫 책 등록하기', 'button primary');
    button.type = 'button';
    button.addEventListener('click', openForm);
    elements.shelf.replaceChildren(empty);
    return;
  }
  elements.shelf.replaceChildren(...visible.map(renderBook));
}

function openForm() {
  elements.panel.hidden = false;
  elements.panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#isbn').focus();
}

function setFormChoice(name, value) {
  const choices = elements.form.querySelectorAll(`input[type="radio"][name="${name}"]`);
  choices.forEach((choice) => { choice.checked = choice.value === value; });
}

function renderAvailabilityAlert() {
  const title = $('#title').value.trim();
  if (!title) {
    elements.availabilityAlert.hidden = true;
    elements.noAlternativeRules.hidden = true;
    return;
  }
  const duplicate = Boolean(elements.form.elements.namedItem('duplicateInSeoul')?.checked);
  const availability = availabilityForTitle(title, books, duplicate);
  elements.availabilityAlert.hidden = false;
  elements.noAlternativeRules.hidden = availability.any;
  elements.availabilityAlert.classList.toggle('has-alternative', availability.any);
  elements.availabilityAlert.classList.toggle('no-alternative', !availability.any);
  elements.availabilityTitle.textContent = availability.any ? '✅ 대체 자료가 있어요!' : '⚠️ 대체 자료가 없어요';
  const badges = [];
  if (availability.pdf) badges.push(tag('📄 PDF 있음', 'pdf'));
  if (availability.millie) badges.push(tag('📱 밀리에 있음', 'millie'));
  if (availability.duplicate) badges.push(tag('👯 실물책 한 권 더 있음', 'duplicate'));
  if (!availability.any) badges.push(tag('🚫 대체 자료 없음', 'no-alternative'));
  elements.availabilityBadges.replaceChildren(...badges);
  elements.availabilityMessage.textContent = availability.any
    ? '실물책은 상태가 좋으면 판매하고, 안 팔리면 기증하세요. 훼손됐으면 폐기해도 돼요.'
    : '아래 기준으로 실물책의 목적지를 골라주세요.';
}

function resetForm() {
  elements.form.reset();
  $('#book-id').value = '';
  setFormChoice('nextTwoYears', 'unsure');
  setFormChoice('condition', 'unknown');
  setFormChoice('disposition', 'auto');
  draftCoverUrl = '';
  renderCoverPreview('', '');
  renderAvailabilityAlert();
  elements.formTitle.textContent = '새 책 등록';
  elements.lookupStatus.textContent = '바코드를 촬영하거나 ISBN을 입력하세요.';
}

function processReferenceBook(book) {
  resetForm();
  for (const key of ['title', 'author', 'isbn', 'publisher']) {
    const field = elements.form.elements.namedItem(key);
    if (field) field.value = book[key] || '';
  }
  draftCoverUrl = book.coverUrl || '';
  renderCoverPreview(book.title, draftCoverUrl);
  renderAvailabilityAlert();
  elements.formTitle.textContent = '실물책 처리';
  openForm();
}

function editBook(book) {
  resetForm();
  for (const [key, value] of Object.entries(book)) {
    const field = elements.form.elements.namedItem(key);
    if (!field) continue;
    if (typeof field.length === 'number' && field[0]?.type === 'radio') setFormChoice(key, value);
    else if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value ?? '';
  }
  setFormChoice('disposition', book.disposition);
  draftCoverUrl = book.coverUrl || '';
  renderCoverPreview(book.title, draftCoverUrl);
  renderAvailabilityAlert();
  elements.formTitle.textContent = '책 정보 수정';
  openForm();
}

function formBook() {
  const data = new FormData(elements.form);
  const input = Object.fromEntries(data.entries());
  for (const key of ['favorite', 'annotated', 'rare', 'professional', 'frequentReference', 'alreadyRead', 'referenceBook', 'duplicateInSeoul', 'easyToReplace', 'resaleValue']) {
    input[key] = data.has(key);
  }
  if (input.disposition === 'auto') delete input.disposition;
  input.coverUrl = draftCoverUrl;
  input.processedAt = new Date().toISOString();
  const existing = books.find((book) => book.id === input.id);
  if (existing) return createBook({ ...existing, ...input, createdAt: existing.createdAt });
  delete input.id;
  return createBook(input);
}

function barcodeDetectorClass() {
  return pickBarcodeDetector(window.BarcodeDetector, window.BookBarcodeDetector);
}

function lookupJsonp(urlBuilder, isbn, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const callbackName = `__bookGalpi_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const finish = (data = null) => {
      window.clearTimeout(timer);
      script.remove();
      delete window[callbackName];
      resolve(data);
    };
    const timer = window.setTimeout(() => finish(), timeoutMs);
    window[callbackName] = (data) => finish(data);
    script.onerror = () => finish();
    script.src = urlBuilder(isbn, callbackName);
    document.head.append(script);
  });
}

function renderCoverPreview(title = '', coverUrl = '') {
  const preview = $('#cover-preview');
  const image = $('#cover-preview-image');
  if (!coverUrl) {
    preview.hidden = true;
    image.removeAttribute('src');
    return;
  }
  $('#cover-preview-title').textContent = title || '찾은 책 표지';
  image.alt = `${title || '검색한 책'} 표지`;
  image.onerror = () => {
    preview.hidden = true;
    image.removeAttribute('src');
  };
  image.src = coverUrl;
  preview.hidden = false;
}

function applyBookMetadata(metadata) {
  if (!metadata) return false;
  $('#title').value = metadata.title || '';
  $('#author').value = metadata.author || '';
  $('#publisher').value = metadata.publisher || '';
  draftCoverUrl = metadata.coverUrl || '';
  renderCoverPreview(metadata.title, draftCoverUrl);
  renderAvailabilityAlert();
  return Boolean(metadata.title);
}

async function lookupIsbn() {
  const isbn = normalizeIsbn($('#isbn').value);
  if (!isbn) {
    elements.lookupStatus.textContent = 'ISBN 10자리 또는 13자리를 확인해주세요.';
    return false;
  }
  $('#isbn').value = isbn;
  elements.lookupStatus.textContent = '국립중앙도서관에서 책과 표지를 찾는 중…';
  let preferredMetadata = null;
  try {
    const workerResponse = await fetch(nlkWorkerUrl(isbn));
    const workerMetadata = workerResponse.ok
      ? nlkWorkerToMetadata(await workerResponse.json())
      : null;
    preferredMetadata = mergeBookMetadata(workerMetadata, localBookMetadata(isbn));
    if (preferredMetadata?.coverUrl && applyBookMetadata(preferredMetadata)) {
      elements.lookupStatus.textContent = '국립중앙도서관에서 책과 표지 정보를 불러왔어요.';
      return true;
    }
  } catch {
    // Worker가 아직 설정되지 않았거나 일시적으로 실패하면 기존 검색 경로를 계속 사용한다.
  }

  const verifiedMetadata = localBookMetadata(isbn);
  preferredMetadata = mergeBookMetadata(preferredMetadata, verifiedMetadata);
  if (preferredMetadata?.coverUrl) {
    applyBookMetadata(preferredMetadata);
    elements.lookupStatus.textContent = '검수 완료된 국내 도서 정보를 불러왔어요.';
    return true;
  }
  elements.lookupStatus.textContent = '다른 국내외 도서 정보도 찾는 중…';
  try {
    const [googleResult, openLibraryResult] = await Promise.allSettled([
      fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`isbn:${isbn}`)}&maxResults=5`).then((response) => response.ok ? response.json() : null),
      fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&jscmd=data&format=json`).then((response) => response.ok ? response.json() : null),
    ]);
    let googleMetadata = googleResult.status === 'fulfilled' ? googleBookToMetadata(googleResult.value, isbn) : null;
    const openItem = openLibraryResult.status === 'fulfilled' ? openLibraryResult.value?.[`ISBN:${isbn}`] : null;
    const openMetadata = openItem ? {
      title: openItem.title || '',
      author: (openItem.authors || []).map((author) => author.name).join(', '),
      publisher: (openItem.publishers || []).map((publisher) => publisher.name).join(', '),
      coverUrl: openItem.cover?.medium || openItem.cover?.small || '',
    } : null;
    let jsonpMetadata = null;
    if (!googleMetadata && !openMetadata) {
      const [googleJsonp, openJsonp] = await Promise.all([
        lookupJsonp(googleBooksJsonpUrl, isbn),
        lookupJsonp(openLibraryJsonpUrl, isbn),
      ]);
      googleMetadata = googleBookToMetadata(googleJsonp, isbn);
      const jsonpItem = openJsonp?.[`ISBN:${isbn}`];
      if (jsonpItem) {
        jsonpMetadata = {
          title: jsonpItem.title || '',
          author: (jsonpItem.authors || []).map((author) => author.name).join(', '),
          publisher: (jsonpItem.publishers || []).map((publisher) => publisher.name).join(', '),
          coverUrl: jsonpItem.cover?.medium || jsonpItem.cover?.small || '',
        };
      }
    }
    const found = applyBookMetadata(mergeBookMetadata(
      preferredMetadata,
      googleMetadata || openMetadata || jsonpMetadata,
    ));
    elements.lookupStatus.textContent = found
      ? '책 정보를 불러왔어요. 이제 밀리에서 제목으로 확인할 수 있어요.'
      : '책 정보를 찾지 못했어요. 제목을 직접 입력하면 밀리 검색이 됩니다.';
    return found;
  } catch {
    elements.lookupStatus.textContent = '인터넷 연결을 확인하거나 제목을 직접 입력해주세요.';
    return false;
  }
}

async function searchMillie() {
  const isbn = normalizeIsbn($('#isbn').value);
  const pendingTab = window.open('about:blank', '_blank');
  if (!$('#title').value.trim() && isbn) await lookupIsbn();
  const url = millieSearchUrl({
    title: $('#title').value,
    author: $('#author').value,
    isbn,
  });
  if (!url) {
    pendingTab?.close();
    showToast('먼저 ISBN이나 책 제목을 입력해주세요.');
    return;
  }
  if (pendingTab) pendingTab.location.href = url;
  else window.location.href = url;
  showToast('밀리 공식 검색을 열었어요. 로그인이 필요할 수 있어요.');
}

function stopScanner() {
  window.clearTimeout(scannerTimer);
  scannerTimer = null;
  scannerStream?.getTracks().forEach((track) => track.stop());
  scannerStream = null;
  scannerTrack = null;
  torchOn = false;
  elements.scannerVideo.srcObject = null;
  $('#toggle-torch').hidden = true;
  $('#zoom-control').hidden = true;
  if (elements.scannerDialog.open) elements.scannerDialog.close();
}

function trackCapabilities() {
  try {
    return scannerTrack?.getCapabilities?.() || {};
  } catch {
    return {};
  }
}

async function applyTrackAdvanced(advanced) {
  if (!scannerTrack || !Object.keys(advanced).length) return;
  try {
    await scannerTrack.applyConstraints({ advanced: [advanced] });
  } catch {
    // 일부 모바일 브라우저는 기능 지원을 잘못 보고하므로 실패한 옵션만 건너뜁니다.
  }
}

async function configureCameraTrack() {
  const capabilities = trackCapabilities();
  const focusModes = Array.isArray(capabilities.focusMode) ? capabilities.focusMode : [];
  const advanced = {};
  if (focusModes.includes('continuous')) advanced.focusMode = 'continuous';

  const zoomInput = $('#camera-zoom');
  if (capabilities.zoom) {
    const min = Number(capabilities.zoom.min ?? 1);
    const max = Number(capabilities.zoom.max ?? min);
    const step = Number(capabilities.zoom.step ?? 0.1);
    const initial = Math.min(max, Math.max(min, 1.5));
    zoomInput.min = String(min);
    zoomInput.max = String(max);
    zoomInput.step = String(step || 0.1);
    zoomInput.value = String(initial);
    $('#zoom-control').hidden = false;
    advanced.zoom = initial;
  } else {
    $('#zoom-control').hidden = true;
  }

  $('#toggle-torch').hidden = !capabilities.torch;
  await applyTrackAdvanced(advanced);
  const settings = scannerTrack?.getSettings?.() || {};
  const resolution = settings.width && settings.height ? ` · ${settings.width}×${settings.height}` : '';
  elements.scannerStatus.textContent = `자동 초점 적용${resolution}. 15~25cm 떨어져 바코드를 네모 안에 맞춰주세요.`;
}

async function refocusCamera() {
  const focusModes = Array.isArray(trackCapabilities().focusMode) ? trackCapabilities().focusMode : [];
  if (focusModes.includes('single-shot')) {
    await applyTrackAdvanced({ focusMode: 'single-shot' });
    window.setTimeout(() => applyTrackAdvanced(focusModes.includes('continuous') ? { focusMode: 'continuous' } : {}), 700);
    elements.scannerStatus.textContent = '초점을 다시 맞췄어요. 휴대폰을 잠깐 멈춰주세요.';
  } else if (focusModes.includes('continuous')) {
    await applyTrackAdvanced({ focusMode: 'continuous' });
    elements.scannerStatus.textContent = '연속 자동 초점을 다시 적용했어요.';
  } else {
    elements.scannerStatus.textContent = '이 기기는 수동 초점을 지원하지 않아요. 15~25cm 떨어져 촬영해주세요.';
  }
}

async function toggleTorch() {
  torchOn = !torchOn;
  await applyTrackAdvanced({ torch: torchOn });
  $('#toggle-torch').textContent = torchOn ? '조명 끄기' : '조명 켜기';
}

async function scanFrame(detector) {
  if (!scannerStream) return;
  try {
    const results = await detector.detect(elements.scannerVideo);
    const isbnResult = results.find((result) => normalizeIsbn(result.rawValue));
    if (isbnResult) {
      $('#isbn').value = normalizeIsbn(isbnResult.rawValue);
      stopScanner();
      await lookupIsbn();
      showToast('바코드를 인식했어요.');
      return;
    }
  } catch {
    elements.scannerStatus.textContent = '초점을 맞추는 중이에요. 바코드를 네모 안에 크게 맞춰주세요.';
  }
  scannerTimer = window.setTimeout(() => scanFrame(detector), 180);
}

async function startScanner() {
  const Detector = barcodeDetectorClass();
  if (!Detector || !navigator.mediaDevices?.getUserMedia) {
    showToast('실시간 카메라를 열 수 없어요. 바로 옆의 사진 올리기를 이용해주세요.');
    return;
  }
  try {
    const formats = await Detector.getSupportedFormats();
    const desired = ['ean_13', 'ean_8', 'isbn_13', 'isbn_10', 'upc_a', 'upc_e'].filter((format) => formats.includes(format));
    const detector = new Detector({ formats: desired.length ? desired : formats });
    elements.scannerDialog.showModal();
    elements.scannerStatus.textContent = '고해상도 후면 카메라를 준비하는 중…';
    try {
      scannerStream = await navigator.mediaDevices.getUserMedia(buildCameraConstraints());
    } catch (error) {
      if (error?.name !== 'OverconstrainedError') throw error;
      scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    }
    scannerTrack = scannerStream.getVideoTracks()[0] || null;
    elements.scannerVideo.srcObject = scannerStream;
    await elements.scannerVideo.play();
    await configureCameraTrack();
    scanFrame(detector);
  } catch (error) {
    stopScanner();
    showToast(error?.name === 'NotAllowedError' ? '카메라 권한을 허용해주세요.' : '카메라를 열지 못했어요. Chrome에서 다시 시도해주세요.');
  }
}

async function scanBarcodePhoto(file) {
  const Detector = window.BookBarcodeDetectorPolyfill || barcodeDetectorClass();
  if (!Detector) {
    showToast('사진 바코드 판독기를 불러오지 못했어요.');
    return;
  }
  elements.lookupStatus.textContent = '사진에서 바코드를 읽는 중…';
  try {
    const formats = await Detector.getSupportedFormats();
    const desired = ['ean_13', 'ean_8', 'isbn_13', 'isbn_10', 'upc_a', 'upc_e'].filter((format) => formats.includes(format));
    const detector = new Detector({ formats: desired.length ? desired : formats });
    const results = await detector.detect(file);
    const found = results.find((result) => normalizeIsbn(result.rawValue));
    if (!found) {
      elements.lookupStatus.textContent = '사진에서 ISBN을 찾지 못했어요. 바코드가 크게 나온 사진을 골라주세요.';
      return;
    }
    $('#isbn').value = normalizeIsbn(found.rawValue);
    await lookupIsbn();
    showToast('사진에서 ISBN을 인식했어요.');
  } catch {
    elements.lookupStatus.textContent = '사진을 읽지 못했어요. 바코드가 밝고 선명한 사진을 골라주세요.';
  }
}

async function importBackup(file) {
  try {
    books = migratePhysicalBooks(parseBackup(await file.text()));
    persist();
    render();
    showToast(`실물책 ${books.length}권을 복원했어요.`);
  } catch {
    showToast('올바른 책갈피 백업 파일이 아니에요.');
  }
}

async function backupToDrive() {
  const content = JSON.stringify(buildBackup(books), null, 2);
  const file = new File([content], '책갈피-내책장-백업.json', { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: '책갈피 내 책장 백업',
        text: '공유 대상에서 Google Drive를 선택해 저장하세요.',
      });
      showToast('Google Drive 공유를 완료했어요.');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  download(file.name, content, 'application/json');
  showToast('백업 파일을 내려받았어요. Google Drive에 업로드해주세요.');
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const book = formBook();
  books = upsertBook(books, book);
  persist();
  render();
  resetForm();
  showToast('내 책장에 저장했어요.');
});

$('#lookup-isbn').addEventListener('click', lookupIsbn);
$('#scan-isbn').addEventListener('click', startScanner);
for (const inputId of ['barcode-photo', 'barcode-camera-photo', 'scanner-photo', 'scanner-camera-photo']) {
  $(`#${inputId}`).addEventListener('change', async (event) => {
    const [file] = event.target.files;
    if (inputId.startsWith('scanner-')) stopScanner();
    if (file) await scanBarcodePhoto(file);
    event.target.value = '';
  });
}
$('#title').addEventListener('input', renderAvailabilityAlert);
elements.form.elements.namedItem('duplicateInSeoul').addEventListener('change', renderAvailabilityAlert);
$('#close-scanner').addEventListener('click', stopScanner);
$('#refocus-camera').addEventListener('click', refocusCamera);
$('#toggle-torch').addEventListener('click', toggleTorch);
$('#camera-zoom').addEventListener('input', (event) => applyTrackAdvanced({ zoom: Number(event.target.value) }));
elements.scannerVideo.addEventListener('click', refocusCamera);
elements.scannerDialog.addEventListener('cancel', (event) => { event.preventDefault(); stopScanner(); });
$('#add-book-top').addEventListener('click', openForm);
$('#close-form').addEventListener('click', () => { elements.panel.hidden = true; });
$('#cancel-edit').addEventListener('click', resetForm);
elements.search.addEventListener('input', render);
elements.filter.addEventListener('change', render);
$('#export-csv').addEventListener('click', () => download('대전-책장.csv', booksToCsv(books), 'text/csv;charset=utf-8'));
$('#drive-backup').addEventListener('click', backupToDrive);
$('#import-json').addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (file) importBackup(file);
  event.target.value = '';
});

render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

import {
  buildBackup,
  booksToCsv,
  createBook,
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

const STORAGE_KEY = 'daejeon-bookshelf.v1';
const millieLabels = { unchecked: '밀리 확인 전', full: '밀리 완전판', partial: '밀리 일부·요약', not_found: '밀리 없음' };
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
    return Array.isArray(parsed) ? parsed.map((book) => createBook(book)) : [];
  } catch {
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

function renderSummary() {
  elements.summary.replaceChildren(
    summaryItem('내 책장', books.length),
    summaryItem('서울행', books.filter((book) => book.disposition === 'seoul').length),
    summaryItem('온라인 읽은 책', books.filter((book) => book.disposition === 'read_archive').length),
    summaryItem('대전에서 나갈 책', books.filter(isOutbound).length),
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
    books = upsertBook(books, { ...book, disposition: select.value });
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
  const tags = document.createElement('div');
  tags.className = 'book-tags';
  tags.append(tag(dispositionLabels[book.disposition] || '미결정'));
  tags.append(tag(millieLabels[book.millieStatus] || millieLabels.unchecked, 'millie'));
  if (book.annotated) tags.append(tag('필기 있음'));
  if (book.rare) tags.append(tag('희귀·절판'));
  if (book.favorite) tags.append(tag('애장본'));
  main.append(tags);
  card.append(main);

  const actions = document.createElement('div');
  actions.className = 'book-actions';
  actions.append(dispositionSelect(book));
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
  renderSummary();
  const visible = filterBooks(books, { query: elements.search.value, disposition: elements.filter.value });
  if (!visible.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    addText(empty, 'h3', books.length ? '조건에 맞는 책이 없어요.' : '아직 등록한 책이 없어요.');
    addText(empty, 'p', books.length ? '검색어나 필터를 바꿔보세요.' : '첫 책의 ISBN을 입력하거나 카메라로 촬영해보세요.');
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

function resetForm() {
  elements.form.reset();
  $('#book-id').value = '';
  setFormChoice('nextTwoYears', 'unsure');
  setFormChoice('condition', 'good');
  setFormChoice('millieStatus', 'unchecked');
  setFormChoice('disposition', 'auto');
  draftCoverUrl = '';
  renderCoverPreview('', '');
  elements.formTitle.textContent = '새 책 등록';
  elements.lookupStatus.textContent = '바코드를 촬영하거나 ISBN을 입력하세요.';
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
    showToast('실시간 카메라를 열 수 없어요. 바로 옆의 사진 촬영을 이용해주세요.');
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
      elements.lookupStatus.textContent = '사진에서 ISBN을 찾지 못했어요. 바코드만 크게 다시 촬영해주세요.';
      return;
    }
    $('#isbn').value = normalizeIsbn(found.rawValue);
    await lookupIsbn();
    showToast('사진에서 ISBN을 인식했어요.');
  } catch {
    elements.lookupStatus.textContent = '사진을 읽지 못했어요. 바코드를 밝고 선명하게 다시 촬영해주세요.';
  }
}

async function importBackup(file) {
  try {
    books = parseBackup(await file.text()).map((book) => createBook(book));
    persist();
    render();
    showToast(`${books.length}권을 복원했어요.`);
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
$('#barcode-photo').addEventListener('change', async (event) => {
  const [file] = event.target.files;
  if (file) await scanBarcodePhoto(file);
  event.target.value = '';
});
$('#search-millie').addEventListener('click', searchMillie);
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

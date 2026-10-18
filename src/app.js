import {
  booksToCsv,
  createBook,
  dispositionLabels,
  filterBooks,
  isOutbound,
  normalizeIsbn,
  removeBook,
  upsertBook,
} from './domain.js';

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
let scannerTimer = null;

function loadBooks() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
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
  const actionCount = books.filter(isOutbound).length;
  elements.summary.replaceChildren(
    summaryItem('내 책장', books.length),
    summaryItem('실물 보관', books.filter((book) => book.disposition === 'keep').length),
    summaryItem('집에서 내보낼 책', actionCount),
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

function resetForm() {
  elements.form.reset();
  $('#book-id').value = '';
  $('#reread').value = 'medium';
  $('#condition').value = 'good';
  $('#millie-status').value = 'unchecked';
  $('#disposition').value = 'auto';
  draftCoverUrl = '';
  elements.formTitle.textContent = '새 책 등록';
  elements.lookupStatus.textContent = '바코드를 촬영하거나 ISBN을 입력하세요.';
}

function editBook(book) {
  resetForm();
  for (const [key, value] of Object.entries(book)) {
    const field = elements.form.elements.namedItem(key);
    if (!field) continue;
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value ?? '';
  }
  $('#disposition').value = book.disposition;
  draftCoverUrl = book.coverUrl || '';
  elements.formTitle.textContent = '책 정보 수정';
  openForm();
}

function formBook() {
  const data = new FormData(elements.form);
  const input = Object.fromEntries(data.entries());
  for (const key of ['favorite', 'annotated', 'rare', 'workReference', 'resaleValue']) {
    input[key] = data.has(key);
  }
  if (input.disposition === 'auto') delete input.disposition;
  input.coverUrl = draftCoverUrl;
  const existing = books.find((book) => book.id === input.id);
  if (existing) return createBook({ ...existing, ...input, createdAt: existing.createdAt });
  delete input.id;
  return createBook(input);
}

async function lookupIsbn() {
  const isbn = normalizeIsbn($('#isbn').value);
  if (!isbn) {
    elements.lookupStatus.textContent = 'ISBN 10자리 또는 13자리를 확인해주세요.';
    return;
  }
  $('#isbn').value = isbn;
  elements.lookupStatus.textContent = '책 정보를 찾는 중…';
  try {
    const response = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&jscmd=data&format=json`);
    if (!response.ok) throw new Error('lookup failed');
    const data = await response.json();
    const item = data[`ISBN:${isbn}`];
    if (!item) {
      elements.lookupStatus.textContent = '자동으로 찾지 못했어요. 제목을 직접 입력해주세요.';
      return;
    }
    $('#title').value = item.title || '';
    $('#author').value = (item.authors || []).map((author) => author.name).join(', ');
    $('#publisher').value = (item.publishers || []).map((publisher) => publisher.name).join(', ');
    draftCoverUrl = item.cover?.medium || item.cover?.small || '';
    elements.lookupStatus.textContent = '책 정보를 불러왔어요. 내용을 확인해주세요.';
  } catch {
    elements.lookupStatus.textContent = '인터넷 연결을 확인하거나 정보를 직접 입력해주세요.';
  }
}

function searchMillie() {
  const query = $('#title').value.trim() || $('#isbn').value.trim();
  if (!query) {
    showToast('먼저 책 제목이나 ISBN을 입력해주세요.');
    return;
  }
  const url = `https://www.google.com/search?q=${encodeURIComponent(`site:millie.co.kr ${query}`)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
  showToast('검색 결과를 확인한 뒤 밀리 상태를 선택하세요.');
}

function stopScanner() {
  window.clearTimeout(scannerTimer);
  scannerTimer = null;
  scannerStream?.getTracks().forEach((track) => track.stop());
  scannerStream = null;
  elements.scannerVideo.srcObject = null;
  if (elements.scannerDialog.open) elements.scannerDialog.close();
}

async function scanFrame(detector, deadline) {
  if (!scannerStream || Date.now() > deadline) {
    elements.scannerStatus.textContent = '시간이 초과됐어요. ISBN을 직접 입력해도 됩니다.';
    return;
  }
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
    elements.scannerStatus.textContent = '바코드를 읽는 중입니다. 카메라를 고정해주세요.';
  }
  scannerTimer = window.setTimeout(() => scanFrame(detector, deadline), 450);
}

async function startScanner() {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
    showToast('이 브라우저는 바코드 촬영을 지원하지 않아요. ISBN을 직접 입력해주세요.');
    return;
  }
  try {
    const formats = await BarcodeDetector.getSupportedFormats();
    const desired = ['ean_13', 'ean_8'].filter((format) => formats.includes(format));
    const detector = new BarcodeDetector({ formats: desired.length ? desired : formats });
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    elements.scannerVideo.srcObject = scannerStream;
    elements.scannerDialog.showModal();
    elements.scannerStatus.textContent = '책 뒤표지 바코드를 화면 중앙에 맞춰주세요.';
    await elements.scannerVideo.play();
    scanFrame(detector, Date.now() + 30000);
  } catch {
    stopScanner();
    showToast('카메라 권한을 확인해주세요.');
  }
}

async function importBackup(file) {
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed) || parsed.some((book) => !book || typeof book.title !== 'string')) throw new Error('invalid');
    books = parsed.map((book) => createBook(book));
    persist();
    render();
    showToast(`${books.length}권을 복원했어요.`);
  } catch {
    showToast('올바른 책갈피 백업 파일이 아니에요.');
  }
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
$('#search-millie').addEventListener('click', searchMillie);
$('#close-scanner').addEventListener('click', stopScanner);
elements.scannerDialog.addEventListener('cancel', (event) => { event.preventDefault(); stopScanner(); });
$('#add-book-top').addEventListener('click', openForm);
$('#close-form').addEventListener('click', () => { elements.panel.hidden = true; });
$('#cancel-edit').addEventListener('click', resetForm);
elements.search.addEventListener('input', render);
elements.filter.addEventListener('change', render);
$('#export-csv').addEventListener('click', () => download('대전-책장.csv', booksToCsv(books), 'text/csv;charset=utf-8'));
$('#export-json').addEventListener('click', () => download('대전-책장-백업.json', JSON.stringify(books, null, 2), 'application/json'));
$('#import-json').addEventListener('change', (event) => {
  const [file] = event.target.files;
  if (file) importBackup(file);
  event.target.value = '';
});

render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

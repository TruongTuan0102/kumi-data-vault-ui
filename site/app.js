(() => {
  'use strict';

  const CONFIG = Object.freeze({
    owner: 'TruongTuan0102',
    repo: 'kumi-data-vault',
    branch: 'vault-data',
    vaultPath: 'data/vault.json',
    apiBase: 'https://api.github.com',
    tokenKey: 'kumiVaultToken'
  });

  const LANGUAGE_LABELS = Object.freeze({
    routeros: 'RouterOS',
    powershell: 'PowerShell',
    python: 'Python',
    batch: 'CMD / Batch',
    bash: 'Bash / Shell',
    javascript: 'JavaScript',
    json: 'JSON',
    markup: 'HTML / XML',
    css: 'CSS',
    text: 'Text'
  });

  const state = {
    token: sessionStorage.getItem(CONFIG.tokenKey) || '',
    connected: false,
    items: [],
    vaultSha: '',
    fuse: null,
    editingId: null,
    deletingId: null,
    openIds: new Set(),
    saving: false
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    cards: $('cards'),
    emptyState: $('emptyState'),
    searchInput: $('searchInput'),
    clearSearchBtn: $('clearSearchBtn'),
    languageFilter: $('languageFilter'),
    resultSummary: $('resultSummary'),
    suggestionBar: $('suggestionBar'),
    addBtn: $('addBtn'),
    lockBtn: $('lockBtn'),
    themeBtn: $('themeBtn'),
    repoBadge: $('repoBadge'),
    authModal: $('authModal'),
    tokenInput: $('tokenInput'),
    authConnectBtn: $('authConnectBtn'),
    authError: $('authError'),
    editorModal: $('editorModal'),
    editorForm: $('editorForm'),
    editorTitle: $('editorTitle'),
    editorCloseBtn: $('editorCloseBtn'),
    cancelEditorBtn: $('cancelEditorBtn'),
    titleInput: $('titleInput'),
    languageInput: $('languageInput'),
    tagsInput: $('tagsInput'),
    contentInput: $('contentInput'),
    detectedLanguage: $('detectedLanguage'),
    editorError: $('editorError'),
    saveBtn: $('saveBtn'),
    confirmModal: $('confirmModal'),
    confirmText: $('confirmText'),
    cancelDeleteBtn: $('cancelDeleteBtn'),
    confirmDeleteBtn: $('confirmDeleteBtn'),
    toast: $('toast')
  };

  applySavedTheme();
  bindEvents();
  bootstrap();

  async function bootstrap() {
    render();
    if (!state.token) {
      showAuth();
      return;
    }
    try {
      await connectWithToken(state.token, false);
    } catch (error) {
      sessionStorage.removeItem(CONFIG.tokenKey);
      state.token = '';
      showAuth(error.message || 'Không thể kết nối GitHub.');
    }
  }

  function bindEvents() {
    els.searchInput.addEventListener('input', render);
    els.clearSearchBtn.addEventListener('click', () => {
      els.searchInput.value = '';
      els.searchInput.focus();
      render();
    });
    els.languageFilter.addEventListener('change', render);
    els.addBtn.addEventListener('click', () => {
      if (!state.connected) return showAuth();
      openEditor();
    });
    els.lockBtn.addEventListener('click', lockVault);
    els.themeBtn.addEventListener('click', toggleTheme);

    els.authConnectBtn.addEventListener('click', handleAuthConnect);
    els.tokenInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') handleAuthConnect();
    });

    els.editorCloseBtn.addEventListener('click', closeEditor);
    els.cancelEditorBtn.addEventListener('click', closeEditor);
    els.editorForm.addEventListener('submit', handleSave);
    els.contentInput.addEventListener('input', updateDetectedLanguage);
    els.languageInput.addEventListener('change', updateDetectedLanguage);

    els.cancelDeleteBtn.addEventListener('click', closeDeleteConfirm);
    els.confirmDeleteBtn.addEventListener('click', handleDeleteConfirmed);

    [els.editorModal, els.confirmModal].forEach((modal) => {
      modal.addEventListener('mousedown', (event) => {
        if (event.target === modal) {
          if (modal === els.editorModal) closeEditor();
          if (modal === els.confirmModal) closeDeleteConfirm();
        }
      });
    });

    document.addEventListener('keydown', (event) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault();
        els.searchInput.focus();
        els.searchInput.select();
      }
      if ((event.ctrlKey || event.metaKey) && key === 'n') {
        event.preventDefault();
        if (state.connected) openEditor();
      }
      if (event.key === 'Escape') {
        if (!els.editorModal.hidden) closeEditor();
        if (!els.confirmModal.hidden) closeDeleteConfirm();
      }
    });
  }

  async function handleAuthConnect() {
    const token = els.tokenInput.value.trim();
    if (!token) return showFormError(els.authError, 'Hãy nhập GitHub token.');
    setBusy(els.authConnectBtn, true, 'Đang kết nối...');
    hideFormError(els.authError);
    try {
      await connectWithToken(token, true);
      els.tokenInput.value = '';
      els.authModal.hidden = true;
      toast('Đã kết nối kho GitHub riêng tư.', 'success');
    } catch (error) {
      showFormError(els.authError, friendlyError(error));
    } finally {
      setBusy(els.authConnectBtn, false, 'Kết nối');
    }
  }

  async function connectWithToken(token, persist) {
    state.token = token;
    const repo = await githubApi(`/repos/${CONFIG.owner}/${CONFIG.repo}`);
    if (repo.private !== true) {
      throw new Error('Repository hiện không ở chế độ Private.');
    }
    const vault = await loadVault();
    state.items = Array.isArray(vault.items) ? vault.items.map(sanitizeLoadedItem) : [];
    state.vaultSha = vault.sha;
    state.connected = true;
    if (persist) sessionStorage.setItem(CONFIG.tokenKey, token);
    els.lockBtn.hidden = false;
    els.repoBadge.textContent = `${CONFIG.owner}/${CONFIG.repo} · Private`;
    els.repoBadge.classList.add('online');
    rebuildSearchIndex();
    rebuildLanguageFilter();
    render();
  }

  async function loadVault() {
    const encodedPath = CONFIG.vaultPath.split('/').map(encodeURIComponent).join('/');
    const payload = await githubApi(`/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${encodedPath}?ref=${encodeURIComponent(CONFIG.branch)}`);
    if (!payload.sha) throw new Error('Không đọc được SHA của vault.');

    let text = '';
    if (payload.content && payload.encoding === 'base64') {
      text = decodeBase64Utf8(payload.content);
    } else {
      const raw = await githubRaw(`/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${encodedPath}?ref=${encodeURIComponent(CONFIG.branch)}`);
      text = raw;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('File data/vault.json không phải JSON hợp lệ.');
    }
    return { items: parsed.items || [], sha: payload.sha };
  }

  async function persistVault(nextItems, commitMessage) {
    if (!state.vaultSha) throw new Error('Thiếu SHA của vault. Hãy tải lại trang.');
    const encodedPath = CONFIG.vaultPath.split('/').map(encodeURIComponent).join('/');
    const body = {
      message: commitMessage,
      content: encodeBase64Utf8(JSON.stringify({ version: 1, items: nextItems }, null, 2) + '\n'),
      sha: state.vaultSha,
      branch: CONFIG.branch
    };
    const result = await githubApi(`/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${encodedPath}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
    state.vaultSha = result?.content?.sha || state.vaultSha;
  }

  async function githubApi(path, options = {}) {
    if (!state.token) throw new Error('Chưa có GitHub token.');
    const response = await fetch(CONFIG.apiBase + path, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${state.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!response.ok) {
      const message = data?.message || `${response.status} ${response.statusText}`;
      throw new Error(message);
    }
    return data;
  }

  async function githubRaw(path) {
    const response = await fetch(CONFIG.apiBase + path, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        Authorization: `Bearer ${state.token}`,
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.text();
  }

  function sanitizeLoadedItem(item) {
    const now = new Date().toISOString();
    return {
      id: String(item.id || makeId()),
      title: String(item.title || 'Không tên'),
      language: LANGUAGE_LABELS[item.language] ? item.language : 'text',
      tags: Array.isArray(item.tags) ? item.tags.map(String).filter(Boolean) : [],
      content: String(item.content || ''),
      createdAt: item.createdAt || now,
      updatedAt: item.updatedAt || item.createdAt || now
    };
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function rebuildSearchIndex() {
    const docs = state.items.map((item) => ({
      ...item,
      titleSearch: normalizeText(item.title),
      tagsSearch: normalizeText(item.tags.join(' ')),
      contentSearch: normalizeText(item.content)
    }));

    state.fuse = null;
  }

  function rebuildLanguageFilter() {
    const current = els.languageFilter.value;
    const languages = [...new Set(state.items.map((item) => item.language))].sort((a, b) => languageLabel(a).localeCompare(languageLabel(b), 'vi'));
    els.languageFilter.replaceChildren();
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = 'Tất cả ngôn ngữ';
    els.languageFilter.appendChild(all);
    for (const lang of languages) {
      const option = document.createElement('option');
      option.value = lang;
      option.textContent = languageLabel(lang);
      els.languageFilter.appendChild(option);
    }
    els.languageFilter.value = languages.includes(current) ? current : 'all';
  }

  function getVisibleItems() {
    const query = normalizeText(els.searchInput.value);
    let results;
    if (!query) {
      results = state.items
        .slice()
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .map((item) => ({ item, score: null }));
    } else if (state.fuse) {
      results = state.fuse.search(query).map((result) => ({ item: result.item, score: result.score ?? 1 }));
    } else {
      results = rankFallback(query, state.items);
    }

    const lang = els.languageFilter.value;
    if (lang !== 'all') results = results.filter((entry) => entry.item.language === lang);
    return results;
  }

  function rankFallback(query, items) {
    return items
      .map((item) => {
        const fields = [normalizeText(item.title), normalizeText(item.tags.join(' ')), normalizeText(item.content)];
        let score = 1;
        for (const field of fields) {
          if (field.includes(query)) score = Math.min(score, 0.05);
          else score = Math.min(score, 1 - trigramSimilarity(query, field.slice(0, 2400)));
        }
        return { item, score };
      })
      .filter((entry) => entry.score < 0.62)
      .sort((a, b) => a.score - b.score);
  }

  function trigramSimilarity(a, b) {
    const trigrams = (s) => {
      const x = `  ${s} `;
      const set = new Set();
      for (let i = 0; i < x.length - 2; i++) set.add(x.slice(i, i + 3));
      return set;
    };
    const A = trigrams(a);
    const B = trigrams(b);
    if (!A.size || !B.size) return 0;
    let hit = 0;
    A.forEach((t) => { if (B.has(t)) hit += 1; });
    return (2 * hit) / (A.size + B.size);
  }

  function render() {
    const results = getVisibleItems();
    els.cards.replaceChildren();
    const query = normalizeText(els.searchInput.value);

    for (const entry of results) {
      els.cards.appendChild(buildCard(entry.item, entry.score, Boolean(query)));
    }

    els.resultSummary.textContent = `${results.length} / ${state.items.length} mục`;
    els.emptyState.hidden = results.length !== 0;
    renderSuggestions(results, query);
  }

  function buildCard(item, score, searching) {
    const card = document.createElement('article');
    card.className = 'data-card';
    card.dataset.id = item.id;
    const isOpen = state.openIds.has(item.id);
    if (isOpen) card.classList.add('open');

    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'card-summary';

    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = '›';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'card-title-wrap';
    const titleLine = document.createElement('div');
    titleLine.className = 'card-title-line';
    const title = document.createElement('span');
    title.className = 'card-title';
    title.textContent = item.title;
    titleLine.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    for (const tagText of item.tags.slice(0, 6)) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = `#${tagText}`;
      meta.appendChild(tag);
    }
    const updated = document.createElement('span');
    updated.textContent = `Cập nhật ${formatDate(item.updatedAt)}`;
    meta.appendChild(updated);
    titleWrap.append(titleLine, meta);

    const right = document.createElement('div');
    right.className = 'card-right';
    const lang = document.createElement('span');
    lang.className = 'lang-badge';
    lang.textContent = languageLabel(item.language);
    right.appendChild(lang);
    if (searching && Number.isFinite(score)) {
      const scoreEl = document.createElement('span');
      scoreEl.className = 'score-badge';
      scoreEl.textContent = `khớp ${Math.max(1, Math.round((1 - Math.min(score, 1)) * 100))}%`;
      right.appendChild(scoreEl);
    }

    summary.append(chevron, titleWrap, right);
    summary.addEventListener('click', () => {
      if (state.openIds.has(item.id)) state.openIds.delete(item.id);
      else state.openIds.add(item.id);
      render();
    });

    const details = document.createElement('div');
    details.className = 'card-details';
    const toolbar = document.createElement('div');
    toolbar.className = 'code-toolbar';
    const label = document.createElement('span');
    label.className = 'code-label';
    label.textContent = item.language;
    const actions = document.createElement('div');
    actions.className = 'code-actions';

    const copyBtn = codeButton('Copy', () => copyText(item.content));
    const editBtn = codeButton('Sửa', () => openEditor(item));
    const deleteBtn = codeButton('Xóa', () => openDeleteConfirm(item), true);
    actions.append(copyBtn, editBtn, deleteBtn);
    toolbar.append(label, actions);

    const pre = document.createElement('pre');
    const code = document.createElement('code');
    const prismLanguage = item.language === 'text' ? 'none' : item.language;
    if (prismLanguage !== 'none') code.className = `language-${prismLanguage}`;
    code.textContent = item.content;
    pre.appendChild(code);

    const foot = document.createElement('div');
    foot.className = 'card-foot';
    const created = document.createElement('span');
    created.textContent = `Tạo: ${formatDateTime(item.createdAt)}`;
    const chars = document.createElement('span');
    chars.textContent = `${item.content.length.toLocaleString('vi-VN')} ký tự`;
    foot.append(created, chars);

    details.append(toolbar, pre, foot);
    card.append(summary, details);

    return card;
  }

  function codeButton(text, handler, danger = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `code-btn${danger ? ' danger' : ''}`;
    button.textContent = text;
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      handler();
    });
    return button;
  }

  function renderSuggestions(results, query) {
    els.suggestionBar.replaceChildren();
    if (!query || !results.length) {
      els.suggestionBar.hidden = true;
      return;
    }
    const top = results.slice(0, 3);
    const hasDirect = top.some(({ item }) => normalizeText(item.title).includes(query));
    if (hasDirect) {
      els.suggestionBar.hidden = true;
      return;
    }
    const prefix = document.createElement('span');
    prefix.textContent = 'Có thể bạn đang tìm: ';
    els.suggestionBar.appendChild(prefix);
    top.forEach(({ item }, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = item.title;
      btn.addEventListener('click', () => {
        els.searchInput.value = item.title;
        render();
      });
      els.suggestionBar.appendChild(btn);
      if (index < top.length - 1) els.suggestionBar.appendChild(document.createTextNode(' · '));
    });
    els.suggestionBar.hidden = false;
  }

  function openEditor(item = null) {
    hideFormError(els.editorError);
    state.editingId = item?.id || null;
    els.editorTitle.textContent = item ? 'Sửa Data' : 'Thêm Data';
    els.titleInput.value = item?.title || '';
    els.languageInput.value = item?.language || 'auto';
    els.tagsInput.value = item?.tags?.join(', ') || '';
    els.contentInput.value = item?.content || '';
    updateDetectedLanguage();
    els.editorModal.hidden = false;
    setTimeout(() => els.titleInput.focus(), 30);
  }

  function closeEditor() {
    if (state.saving) return;
    els.editorModal.hidden = true;
    state.editingId = null;
    els.editorForm.reset();
    hideFormError(els.editorError);
  }

  async function handleSave(event) {
    event.preventDefault();
    if (!state.connected || state.saving) return;

    const title = els.titleInput.value.trim();
    const content = els.contentInput.value.replace(/\r\n/g, '\n');
    const tags = parseTags(els.tagsInput.value);
    const language = els.languageInput.value === 'auto' ? detectLanguage(content) : els.languageInput.value;
    if (!title) return showFormError(els.editorError, 'Tên không được để trống.');
    if (!content.trim()) return showFormError(els.editorError, 'Nội dung không được để trống.');

    state.saving = true;
    setBusy(els.saveBtn, true, 'Đang lưu...');
    hideFormError(els.editorError);
    try {
      const now = new Date().toISOString();
      const existing = state.items.find((item) => item.id === state.editingId);
      let nextItems;
      let message;
      if (existing) {
        const updated = { ...existing, title, content, tags, language, updatedAt: now };
        nextItems = state.items.map((item) => item.id === existing.id ? updated : item);
        message = `Update vault item: ${title}`;
      } else {
        const created = { id: makeId(), title, content, tags, language, createdAt: now, updatedAt: now };
        nextItems = [created, ...state.items];
        message = `Add vault item: ${title}`;
      }
      await persistVault(nextItems, message);
      state.items = nextItems;
      rebuildSearchIndex();
      rebuildLanguageFilter();
      closeEditorForced();
      render();
      toast(existing ? 'Đã cập nhật dữ liệu.' : 'Đã thêm dữ liệu.', 'success');
    } catch (error) {
      showFormError(els.editorError, friendlyError(error));
      if (/sha|conflict|does not match/i.test(error.message || '')) {
        toast('Vault đã thay đổi ở nơi khác. Hãy tải lại trang trước khi lưu tiếp.', 'error');
      }
    } finally {
      state.saving = false;
      setBusy(els.saveBtn, false, 'Lưu');
    }
  }

  function closeEditorForced() {
    els.editorModal.hidden = true;
    state.editingId = null;
    els.editorForm.reset();
    hideFormError(els.editorError);
  }

  function openDeleteConfirm(item) {
    state.deletingId = item.id;
    els.confirmText.textContent = `Xóa “${item.title}” khỏi kho dữ liệu? GitHub vẫn lưu lịch sử commit.`;
    els.confirmModal.hidden = false;
  }

  function closeDeleteConfirm() {
    els.confirmModal.hidden = true;
    state.deletingId = null;
  }

  async function handleDeleteConfirmed() {
    const item = state.items.find((entry) => entry.id === state.deletingId);
    if (!item) return closeDeleteConfirm();
    setBusy(els.confirmDeleteBtn, true, 'Đang xóa...');
    try {
      const nextItems = state.items.filter((entry) => entry.id !== item.id);
      await persistVault(nextItems, `Delete vault item: ${item.title}`);
      state.items = nextItems;
      state.openIds.delete(item.id);
      rebuildSearchIndex();
      rebuildLanguageFilter();
      closeDeleteConfirm();
      render();
      toast('Đã xóa mục khỏi vault.', 'success');
    } catch (error) {
      toast(friendlyError(error), 'error');
    } finally {
      setBusy(els.confirmDeleteBtn, false, 'Xóa');
    }
  }

  function updateDetectedLanguage() {
    const selected = els.languageInput.value;
    const detected = detectLanguage(els.contentInput.value);
    if (selected === 'auto') {
      els.detectedLanguage.textContent = `Tự động nhận diện: ${languageLabel(detected)}`;
    } else {
      els.detectedLanguage.textContent = `Đang dùng: ${languageLabel(selected)} · Tự động đoán: ${languageLabel(detected)}`;
    }
  }

  function detectLanguage(content) {
    const text = String(content || '').trim();
    if (!text) return 'text';

    const routerScore = score(text, [
      /(^|\n)\s*:local\b/m, /(^|\n)\s*:put\b/m, /(^|\n)\s*:for\b/m,
      /\/interface\//, /\/ip\//, /\/container\b/, /do=\{/, /on-error=\{/
    ]);
    if (routerScore >= 2) return 'routeros';

    const psScore = score(text, [
      /\bWrite-Host\b/i, /\bInvoke-RestMethod\b/i, /\bGet-[A-Z]/, /\bSet-[A-Z]/,
      /\$env:/i, /\$[A-Za-z_]\w*\s*=/, /\bparam\s*\(/i
    ]);
    if (psScore >= 2) return 'powershell';

    const pyScore = score(text, [
      /(^|\n)\s*(?:from\s+\S+\s+import|import\s+\S+)/m, /(^|\n)\s*def\s+\w+\s*\(/m,
      /(^|\n)\s*class\s+\w+/m, /\bprint\s*\(/, /if __name__\s*==\s*["']__main__["']/
    ]);
    if (pyScore >= 2) return 'python';

    if (/^\s*[\[{]/.test(text)) {
      try { JSON.parse(text); return 'json'; } catch { /* not json */ }
    }

    const batchScore = score(text, [/@echo\s+off/i, /(^|\n)\s*set\s+\w+=/im, /%[A-Za-z_]\w*%/, /(^|\n)\s*(?:rem\s|::)/im, /\b(?:cmd\.exe|pause|goto)\b/i]);
    if (batchScore >= 2) return 'batch';

    const bashScore = score(text, [/^#!.*\b(?:bash|sh)\b/m, /\b(?:sudo|chmod|chown|grep|awk|sed|apt|dnf|yum)\b/, /\$\{?[A-Za-z_]\w*\}?/, /(^|\n)\s*(?:if|for|while)\s+.*;?\s*(?:then|do)\b/m]);
    if (bashScore >= 2) return 'bash';

    const jsScore = score(text, [/\b(?:const|let|var)\s+\w+\s*=/, /=>\s*[{(]?/, /\bfunction\s+\w*\s*\(/, /\bconsole\.log\s*\(/, /\bdocument\./]);
    if (jsScore >= 2) return 'javascript';

    if (/<(?:!doctype\s+html|html|head|body|div|span|script|style)\b/i.test(text)) return 'markup';
    if (/\{\s*[\w-]+\s*:\s*[^}]+\}/m.test(text) && /(?:#|\.|:root|@media)\S*\s*\{/m.test(text)) return 'css';
    return 'text';
  }

  function score(text, patterns) {
    return patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
  }

  function parseTags(value) {
    const seen = new Set();
    return String(value || '')
      .split(/[,;\n]/)
      .map((tag) => tag.trim().replace(/^#/, ''))
      .filter(Boolean)
      .filter((tag) => {
        const key = normalizeText(tag);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 20);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Đã copy toàn bộ nội dung.', 'success');
    } catch {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
      toast('Đã copy toàn bộ nội dung.', 'success');
    }
  }

  function showAuth(error = '') {
    els.authModal.hidden = false;
    if (error) showFormError(els.authError, friendlyError(error));
    else hideFormError(els.authError);
    setTimeout(() => els.tokenInput.focus(), 30);
  }

  function lockVault() {
    sessionStorage.removeItem(CONFIG.tokenKey);
    state.token = '';
    state.connected = false;
    state.items = [];
    state.vaultSha = '';
    state.openIds.clear();
    state.fuse = null;
    els.lockBtn.hidden = true;
    els.repoBadge.textContent = 'Chưa kết nối GitHub';
    els.repoBadge.classList.remove('online');
    rebuildLanguageFilter();
    render();
    showAuth();
  }

  function showFormError(element, message) {
    element.textContent = String(message || 'Có lỗi xảy ra.');
    element.hidden = false;
  }
  function hideFormError(element) {
    element.textContent = '';
    element.hidden = true;
  }

  function friendlyError(error) {
    const raw = typeof error === 'string' ? error : (error?.message || 'Có lỗi xảy ra.');
    if (/bad credentials/i.test(raw)) return 'Token không hợp lệ hoặc đã hết hạn.';
    if (/not found/i.test(raw)) return 'Không tìm thấy repo/nhánh dữ liệu hoặc token chưa được cấp quyền.';
    if (/resource not accessible|forbidden/i.test(raw)) return 'Token chưa có quyền Contents: Read and write cho repo này.';
    return raw;
  }

  function setBusy(button, busy, label) {
    button.disabled = busy;
    button.textContent = label;
  }

  let toastTimer = null;
  function toast(message, type = '') {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.className = `toast ${type}`.trim();
    els.toast.hidden = false;
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 2600);
  }

  function languageLabel(language) {
    return LANGUAGE_LABELS[language] || language || 'Text';
  }

  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  }
  function formatDateTime(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  }

  function makeId() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    return `kumi-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function encodeBase64Utf8(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function decodeBase64Utf8(base64) {
    const cleaned = String(base64 || '').replace(/\s/g, '');
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function applySavedTheme() {
    const saved = localStorage.getItem('kumiVaultTheme');
    if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  }
  function toggleTheme() {
    const current = document.documentElement.dataset.theme || 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('kumiVaultTheme', next);
  }
})();
(() => {
  'use strict';

  const CONFIG = Object.freeze({
    owner: 'TruongTuan0102',
    repo: 'kumi-data-vault',
    branch: 'vault-data',
    vaultPath: 'data/vault.json',
    apiBase: 'https://api.github.com',
    tokenKey: 'kumiVaultToken',
    maxAttachmentBytes: (2 * 1024 * 1024 * 1024) - 1,
    releaseTag: 'kumi-vault-files',
    releaseName: 'Kumi Vault File Storage'
  });

  const LANGUAGE_LABELS = Object.freeze({
    routeros: 'RouterOS',
    powershell: 'PowerShell',
    python: 'Python',
    lua: 'Lua / AutoTouch',
    batch: 'CMD / Batch',
    bash: 'Bash / Shell',
    javascript: 'JavaScript',
    json: 'JSON',
    markup: 'HTML / XML',
    css: 'CSS',
    text: 'Text'
  });

  const state = {
    token: localStorage.getItem(CONFIG.tokenKey) || sessionStorage.getItem(CONFIG.tokenKey) || '',
    connected: false,
    items: [],
    vaultSha: '',
    fuse: null,
    editingId: null,
    deletingId: null,
    openIds: new Set(),
    saving: false,
    pendingFiles: [],
    removedAttachmentPaths: new Set(),
    fileRelease: null
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
    attachmentInput: $('attachmentInput'),
    attachmentList: $('attachmentList'),
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
      await connectWithToken(state.token);
      localStorage.setItem(CONFIG.tokenKey, state.token);
      sessionStorage.removeItem(CONFIG.tokenKey);
    } catch (error) {
      localStorage.removeItem(CONFIG.tokenKey);
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
    els.attachmentInput.addEventListener('change', handleAttachmentSelection);

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
      await connectWithToken(token);
      els.tokenInput.value = '';
      els.authModal.hidden = true;
      toast('Đã kết nối kho GitHub riêng tư.', 'success');
    } catch (error) {
      showFormError(els.authError, friendlyError(error));
    } finally {
      setBusy(els.authConnectBtn, false, 'Kết nối');
    }
  }

  async function connectWithToken(token) {
    state.token = token;
    const repo = await githubApi(`/repos/${CONFIG.owner}/${CONFIG.repo}`);
    if (repo.private !== true) {
      throw new Error('Repository hiện không ở chế độ Private.');
    }
    const vault = await loadVault();
    state.items = Array.isArray(vault.items) ? vault.items.map(sanitizeLoadedItem) : [];
    state.vaultSha = vault.sha;
    state.connected = true;
    localStorage.setItem(CONFIG.tokenKey, token);
    sessionStorage.removeItem(CONFIG.tokenKey);
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
      const error = new Error(message);
      error.status = response.status;
      throw error;
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
      attachments: Array.isArray(item.attachments) ? item.attachments.map((file) => ({
        name: String(file.name || 'file'),
        storage: String(file.storage || (file.assetId ? 'release' : 'git')),
        path: String(file.path || ''),
        size: Number(file.size || 0),
        type: String(file.type || ''),
        sha: String(file.sha || ''),
        assetId: Number(file.assetId || 0),
        assetName: String(file.assetName || ''),
        browserDownloadUrl: String(file.browserDownloadUrl || ''),
        digest: String(file.digest || '')
      })).filter((file) => file.path || file.assetId) : [],
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
      contentSearch: normalizeText(item.content),
      attachmentSearch: normalizeText((item.attachments || []).map((file) => file.name).join(' '))
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
        const fields = [normalizeText(item.title), normalizeText(item.tags.join(' ')), normalizeText(item.content), normalizeText((item.attachments || []).map((file) => file.name).join(' '))];
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
    if (item.attachments?.length) {
      const filesMeta = document.createElement('span');
      filesMeta.textContent = `📎 ${item.attachments.length} file`;
      meta.appendChild(filesMeta);
    }
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

    if (item.content) {
      actions.appendChild(codeButton('Copy', () => copyText(item.content)));
    }
    const editBtn = codeButton('Sửa', () => openEditor(item));
    const deleteBtn = codeButton('Xóa', () => openDeleteConfirm(item), true);
    actions.append(editBtn, deleteBtn);
    toolbar.append(label, actions);
    details.appendChild(toolbar);

    if (item.content) {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      const codeLanguage = item.language === 'text' ? 'none' : item.language;
      if (codeLanguage !== 'none') code.className = `language-${codeLanguage}`;
      code.textContent = item.content;
      pre.appendChild(code);
      details.appendChild(pre);
    }

    if (item.attachments?.length) {
      const attachmentBox = document.createElement('div');
      attachmentBox.className = 'attachment-box';
      const attachmentTitle = document.createElement('div');
      attachmentTitle.className = 'attachment-box-title';
      attachmentTitle.textContent = `File đính kèm (${item.attachments.length})`;
      attachmentBox.appendChild(attachmentTitle);

      for (const attachment of item.attachments) {
        const row = document.createElement('div');
        row.className = 'attachment-row';
        const info = document.createElement('div');
        info.className = 'attachment-info';
        const name = document.createElement('strong');
        name.textContent = attachment.name;
        const size = document.createElement('span');
        size.textContent = `${formatBytes(attachment.size)}${attachment.storage === 'release' ? ' · kho file' : ''}`;
        info.append(name, size);
        const downloadBtn = codeButton('Tải file', () => downloadAttachment(attachment));
        row.append(info, downloadBtn);
        attachmentBox.appendChild(row);
      }
      details.appendChild(attachmentBox);
    }

    const foot = document.createElement('div');
    foot.className = 'card-foot';
    const created = document.createElement('span');
    created.textContent = `Tạo: ${formatDateTime(item.createdAt)}`;
    const stats = document.createElement('span');
    stats.textContent = item.attachments?.length
      ? `${item.content.length.toLocaleString('vi-VN')} ký tự · ${item.attachments.length} file`
      : `${item.content.length.toLocaleString('vi-VN')} ký tự`;
    foot.append(created, stats);

    details.appendChild(foot);
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
    state.pendingFiles = [];
    state.removedAttachmentPaths = new Set();
    els.attachmentInput.value = '';
    renderAttachmentEditor(item?.attachments || []);
    updateDetectedLanguage();
    els.editorModal.hidden = false;
    setTimeout(() => els.titleInput.focus(), 30);
  }

  function closeEditor() {
    if (state.saving) return;
    els.editorModal.hidden = true;
    state.editingId = null;
    state.pendingFiles = [];
    state.removedAttachmentPaths = new Set();
    els.editorForm.reset();
    els.attachmentList.replaceChildren();
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

    const existing = state.items.find((item) => item.id === state.editingId);
    const keptAttachments = (existing?.attachments || []).filter((file) => !state.removedAttachmentPaths.has(attachmentKey(file)));
    if (!content.trim() && !keptAttachments.length && !state.pendingFiles.length) {
      return showFormError(els.editorError, 'Hãy nhập nội dung hoặc chọn ít nhất một file đính kèm.');
    }

    state.saving = true;
    setBusy(els.saveBtn, true, 'Đang lưu...');
    hideFormError(els.editorError);
    try {
      const now = new Date().toISOString();
      const itemId = existing?.id || makeId();
      const uploadedAttachments = [];

      for (let i = 0; i < state.pendingFiles.length; i += 1) {
        setBusy(els.saveBtn, true, `Đang tải file ${i + 1}/${state.pendingFiles.length}...`);
        uploadedAttachments.push(await uploadAttachment(itemId, state.pendingFiles[i]));
      }

      const attachments = [...keptAttachments, ...uploadedAttachments];
      let nextItems;
      let message;
      if (existing) {
        const updated = { ...existing, title, content, tags, language, attachments, updatedAt: now };
        nextItems = state.items.map((item) => item.id === existing.id ? updated : item);
        message = `Update vault item: ${title}`;
      } else {
        const created = { id: itemId, title, content, tags, language, attachments, createdAt: now, updatedAt: now };
        nextItems = [created, ...state.items];
        message = `Add vault item: ${title}`;
      }
      setBusy(els.saveBtn, true, 'Đang lưu...');
      await persistVault(nextItems, message);

      const removed = (existing?.attachments || []).filter((file) => state.removedAttachmentPaths.has(attachmentKey(file)));
      for (const attachment of removed) {
        try { await deleteAttachmentFile(attachment); } catch { /* keep orphan file in git if cleanup fails */ }
      }
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
    state.pendingFiles = [];
    state.removedAttachmentPaths = new Set();
    els.editorForm.reset();
    els.attachmentList.replaceChildren();
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
      for (const attachment of item.attachments || []) {
        try { await deleteAttachmentFile(attachment); } catch { /* history still keeps prior versions */ }
      }
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


  function handleAttachmentSelection() {
    const selected = Array.from(els.attachmentInput.files || []);
    for (const file of selected) {
      if (file.size > CONFIG.maxAttachmentBytes) {
        showFormError(els.editorError, `${file.name} quá lớn. Mỗi file phải dưới 2 GB.`);
        els.attachmentInput.value = '';
        return;
      }
    }
    state.pendingFiles = selected;
    const existing = state.items.find((item) => item.id === state.editingId);
    renderAttachmentEditor(existing?.attachments || []);
    hideFormError(els.editorError);
  }

  function renderAttachmentEditor(existingAttachments = []) {
    els.attachmentList.replaceChildren();

    for (const attachment of existingAttachments) {
      const key = attachmentKey(attachment);
      const removed = state.removedAttachmentPaths.has(key);
      const row = document.createElement('div');
      row.className = `attachment-edit-row${removed ? ' removed' : ''}`;
      const info = document.createElement('div');
      info.className = 'attachment-info';
      const name = document.createElement('strong');
      name.textContent = attachment.name;
      const size = document.createElement('span');
      size.textContent = `${formatBytes(attachment.size)} · đã lưu${attachment.storage === 'release' ? ' · kho file' : ''}`;
      info.append(name, size);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mini-btn';
      button.textContent = removed ? 'Hoàn tác' : 'Xóa';
      button.addEventListener('click', () => {
        if (removed) state.removedAttachmentPaths.delete(key);
        else state.removedAttachmentPaths.add(key);
        renderAttachmentEditor(existingAttachments);
      });
      row.append(info, button);
      els.attachmentList.appendChild(row);
    }

    state.pendingFiles.forEach((file, index) => {
      const row = document.createElement('div');
      row.className = 'attachment-edit-row pending';
      const info = document.createElement('div');
      info.className = 'attachment-info';
      const name = document.createElement('strong');
      name.textContent = file.name;
      const size = document.createElement('span');
      size.textContent = `${formatBytes(file.size)} · chờ tải lên kho file`;
      info.append(name, size);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mini-btn';
      button.textContent = 'Bỏ';
      button.addEventListener('click', () => {
        state.pendingFiles.splice(index, 1);
        els.attachmentInput.value = '';
        renderAttachmentEditor(existingAttachments);
      });
      row.append(info, button);
      els.attachmentList.appendChild(row);
    });
  }

  async function uploadAttachment(itemId, file) {
    if (file.size > CONFIG.maxAttachmentBytes) {
      throw new Error(`${file.name} quá lớn. Mỗi file phải dưới 2 GB.`);
    }
    return uploadReleaseAttachment(itemId, file);
  }

  async function getOrCreateFileRelease() {
    if (state.fileRelease?.id) return state.fileRelease;

    try {
      const release = await githubApi(
        `/repos/${CONFIG.owner}/${CONFIG.repo}/releases/tags/${encodeURIComponent(CONFIG.releaseTag)}`
      );
      state.fileRelease = release;
      return release;
    } catch (error) {
      if (error.status !== 404) throw error;
    }

    const release = await githubApi(`/repos/${CONFIG.owner}/${CONFIG.repo}/releases`, {
      method: 'POST',
      body: JSON.stringify({
        tag_name: CONFIG.releaseTag,
        target_commitish: CONFIG.branch,
        name: CONFIG.releaseName,
        body: 'Private attachment storage for Kumi Data Vault. Managed automatically by the vault UI.',
        draft: false,
        prerelease: false
      })
    });
    state.fileRelease = release;
    return release;
  }

  async function uploadReleaseAttachment(itemId, file) {
    const release = await getOrCreateFileRelease();
    const safeName = sanitizeFileName(file.name);
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const assetName = `${itemId}--${unique}--${safeName}`;
    const uploadUrl =
      `https://uploads.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`;

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${state.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': file.type || 'application/octet-stream'
      },
      body: file
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }

    if (!response.ok) {
      const message = data?.message || `${response.status} ${response.statusText}`;
      throw new Error(`Không tải được ${file.name}: ${message}`);
    }

    return {
      name: file.name,
      storage: 'release',
      path: '',
      size: Number(data?.size || file.size),
      type: String(data?.content_type || file.type || ''),
      sha: '',
      assetId: Number(data?.id || 0),
      assetName: String(data?.name || assetName),
      browserDownloadUrl: String(data?.browser_download_url || ''),
      digest: String(data?.digest || '')
    };
  }

  async function deleteAttachmentFile(attachment) {
    if (attachment.storage === 'release' || attachment.assetId) {
      if (!attachment.assetId) return;
      await githubApi(
        `/repos/${CONFIG.owner}/${CONFIG.repo}/releases/assets/${attachment.assetId}`,
        { method: 'DELETE' }
      );
      return;
    }

    if (!attachment.path) return;
    const encodedPath = attachment.path.split('/').map(encodeURIComponent).join('/');
    let sha = attachment.sha;
    if (!sha) {
      const info = await githubApi(
        `/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${encodedPath}?ref=${encodeURIComponent(CONFIG.branch)}`
      );
      sha = info.sha;
    }
    if (!sha) return;
    await githubApi(`/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${encodedPath}`, {
      method: 'DELETE',
      body: JSON.stringify({
        message: `Delete attachment: ${attachment.name}`,
        sha,
        branch: CONFIG.branch
      })
    });
  }

  async function downloadAttachment(attachment) {
    try {
      let response;

      if (attachment.storage === 'release' || attachment.assetId) {
        if (!attachment.assetId) throw new Error('Thiếu mã file trên GitHub Release.');
        response = await fetch(
          `${CONFIG.apiBase}/repos/${CONFIG.owner}/${CONFIG.repo}/releases/assets/${attachment.assetId}`,
          {
            headers: {
              Accept: 'application/octet-stream',
              Authorization: `Bearer ${state.token}`,
              'X-GitHub-Api-Version': '2022-11-28'
            }
          }
        );
      } else {
        if (!attachment.path) throw new Error('Thiếu đường dẫn file.');
        const encodedPath = attachment.path.split('/').map(encodeURIComponent).join('/');
        response = await fetch(
          `${CONFIG.apiBase}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${encodedPath}?ref=${encodeURIComponent(CONFIG.branch)}`,
          {
            headers: {
              Accept: 'application/vnd.github.raw+json',
              Authorization: `Bearer ${state.token}`,
              'X-GitHub-Api-Version': '2022-11-28'
            }
          }
        );
      }

      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = attachment.name || 'download';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
      toast(`Không tải được file: ${friendlyError(error)}`, 'error');
    }
  }

  function attachmentKey(attachment) {
    if (attachment?.assetId) return `release:${attachment.assetId}`;
    return `git:${attachment?.path || ''}`;
  }

  async function fileToBase64(file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function sanitizeFileName(name) {
    const cleaned = String(name || 'file')
      .replace(/[\\/:*?"<>|\x00-\x1F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned || 'file';
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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

    const luaScore = score(text, [
      /\b(?:touchDown|touchMove|touchUp|usleep|appRun|appKill|alert|toast)\s*\(/,
      /(^|\n)\s*local\s+[A-Za-z_]\w*\s*=/m,
      /(^|\n)\s*function\s+[A-Za-z_.:]?\w*\s*\(/m,
      /\brequire\s*\(?\s*["'][^"']+["']/,
      /\bend\s*$/m
    ]);
    if (luaScore >= 2) return 'lua';

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
    localStorage.removeItem(CONFIG.tokenKey);
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
/**
 * Personal Local Markdown Memo App
 * Core Application Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  lucide.createIcons();

  // Initialize Application State
  const state = {
    settings: null,
    currentTheme: 'dark',
    activeTab: 'weekday',
    loadedFileSha: null, // For weekend report saving
    loadedFileWeek: null, // The week date currently loaded in the weekend editor
    isDirty: false // Detect changes in editor
  };

  // Elements
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const themeIcon = document.getElementById('theme-icon');
  const navButtons = document.querySelectorAll('.nav-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  
  // Weekday Elements
  const weekdayTargetWeek = document.getElementById('weekday-target-week');
  const weekdayTargetFile = document.getElementById('weekday-target-file');
  const memoInput = document.getElementById('memo-input');
  const sendMemoBtn = document.getElementById('send-memo-btn');
  const refreshMemosBtn = document.getElementById('refresh-memos-btn');
  const memosHistoryList = document.getElementById('memos-history-list');

  // Weekend Elements
  const weekendWeekSelect = document.getElementById('weekend-week-select');
  const loadReportBtn = document.getElementById('load-report-btn');
  const saveReportBtn = document.getElementById('save-report-btn');
  const editorMemos = document.getElementById('editor-memos');
  const editorReview = document.getElementById('editor-review');
  const previewContent = document.getElementById('preview-content');
  const togglePreviewLayout = document.getElementById('toggle-preview-layout');
  const previewPane = document.querySelector('.preview-pane');
  const editorPane = document.querySelector('.editor-pane');
  const draftStatus = document.getElementById('draft-status');

  // Settings Elements
  const settingsForm = document.getElementById('settings-form');
  const settingPat = document.getElementById('setting-pat');
  const togglePatVisibility = document.getElementById('toggle-pat-visibility');
  const settingOwner = document.getElementById('setting-owner');
  const settingRepo = document.getElementById('setting-repo');
  const settingFolder = document.getElementById('setting-folder');
  const settingBranch = document.getElementById('setting-branch');
  const testConnectionBtn = document.getElementById('test-connection-btn');

  // Overlay Elements
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingMessage = document.getElementById('loading-message');
  const toastContainer = document.getElementById('toast-container');

  /* ==========================================================================
     Helper Functions
     ========================================================================== */

  // Base64 Encoding/Decoding supporting UTF-8
  function stringToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    const binString = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    return btoa(binString);
  }

  function base64ToString(base64) {
    const binString = atob(base64.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binString, (m) => m.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  // Toast System
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'error') iconName = 'alert-triangle';

    toast.innerHTML = `
      <i data-lucide="${iconName}"></i>
      <span>${message}</span>
    `;
    
    toastContainer.appendChild(toast);
    lucide.createIcons({ attrs: { class: 'toast-icon' } });

    // Fade out and remove
    setTimeout(() => {
      toast.classList.add('fade-out');
      toast.addEventListener('animationend', () => {
        toast.remove();
      });
    }, 4000);
  }

  // Loader Controls
  function showLoader(message = 'GitHubと通信中...') {
    loadingMessage.textContent = message;
    loadingOverlay.classList.add('visible');
  }

  function hideLoader() {
    loadingOverlay.classList.remove('visible');
  }

  /* ==========================================================================
     Date & Week Calculation
     ========================================================================== */

  // Get the Monday date of the week for a given date
  function getMonday(d) {
    const date = new Date(d);
    const day = date.getDay(); // 0: Sun, 1: Mon, ... 6: Sat
    // Calculate difference to Monday: Monday is diff=0, Sun is diff=6
    const diff = date.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(date.setDate(diff));
    monday.setHours(0, 0, 0, 0);
    return monday;
  }

  // Format Date to YYMMDD (e.g. 260525)
  function formatYYMMDD(date) {
    const y = String(date.getFullYear()).slice(-2);
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  // Format Date to User-friendly YYYY-MM-DD
  function formatDateYYYYMMDD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Update target dates on load
  function updateTargetDates() {
    const today = new Date();
    const monday = getMonday(today);
    const yymmdd = formatYYMMDD(monday);
    
    weekdayTargetWeek.textContent = `${formatDateYYYYMMDD(monday)} 週 (月曜日)`;
    weekdayTargetFile.textContent = `review-${yymmdd}.md`;
  }

  // Generate Week Selector Options for Weekend Tab (Current week + past 8 weeks)
  function populateWeekSelector() {
    weekendWeekSelect.innerHTML = '';
    const today = new Date();
    const currentMonday = getMonday(today);

    for (let i = 0; i < 9; i++) {
      const targetMonday = new Date(currentMonday.getTime());
      targetMonday.setDate(currentMonday.getDate() - (i * 7));
      
      const yymmdd = formatYYMMDD(targetMonday);
      const option = document.createElement('option');
      option.value = yymmdd;
      
      let label = `${formatDateYYYYMMDD(targetMonday)}の週 (review-${yymmdd}.md)`;
      if (i === 0) label = `【今週】 ${label}`;
      if (i === 1) label = `【先週】 ${label}`;
      
      option.textContent = label;
      weekendWeekSelect.appendChild(option);
    }
  }

  /* ==========================================================================
     GitHub API Client
     ========================================================================== */

  async function githubRequest(endpoint, options = {}) {
    if (!state.settings || !state.settings.pat) {
      throw new Error('GitHubの設定が未完了です。「設定」タブで設定を行ってください。');
    }

    const url = `https://api.github.com/repos/${state.settings.owner}/${state.settings.repo}${endpoint}`;
    
    const headers = {
      'Authorization': `token ${state.settings.pat}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    };

    const config = {
      ...options,
      headers: {
        ...headers,
        ...options.headers
      }
    };

    const response = await fetch(url, config);
    
    if (response.status === 404) {
      return null;
    }
    
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      const message = errData.message || `HTTPエラー ${response.status}`;
      throw new Error(message);
    }
    
    return await response.json();
  }

  // Get file content and SHA
  async function getFile(yymmdd) {
    const folder = state.settings.folder ? `${state.settings.folder.replace(/\/$/, '')}/` : '';
    const path = `${folder}review-${yymmdd}.md`;
    const data = await githubRequest(`/contents/${path}?ref=${state.settings.branch}`);
    
    if (!data) return null;

    return {
      sha: data.sha,
      content: base64ToString(data.content)
    };
  }

  // Write file content
  async function putFile(yymmdd, content, sha, commitMessage) {
    const folder = state.settings.folder ? `${state.settings.folder.replace(/\/$/, '')}/` : '';
    const path = `${folder}review-${yymmdd}.md`;
    
    const body = {
      message: commitMessage,
      content: stringToBase64(content),
      branch: state.settings.branch
    };
    
    if (sha) {
      body.sha = sha;
    }

    return await githubRequest(`/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  }

  /* ==========================================================================
     Markdown Parser & Merger
     ========================================================================== */

  const MEMO_HEADER = "## 今週の断片メモ";
  const REVIEW_HEADER = "## 週末の内省・雑記";

  // Parse whole markdown into title, memos, and review section
  function parseMarkdown(markdown, yymmdd) {
    // Generate date description from YYMMDD
    const year = '20' + yymmdd.substring(0, 2);
    const month = parseInt(yymmdd.substring(2, 4), 10);
    const day = parseInt(yymmdd.substring(4, 6), 10);
    
    const defaultTitle = `# ${year}年 ${month}月${day}日週 内省レポート`;
    
    let title = defaultTitle;
    let memos = "";
    let review = "";
    
    if (!markdown) {
      return { title, memos, review };
    }
    
    // Find Title (First line starting with #)
    const lines = markdown.split('\n');
    const titleLine = lines.find(line => line.trim().startsWith('# '));
    if (titleLine) {
      title = titleLine.trim();
    }
    
    const memoIndex = markdown.indexOf(MEMO_HEADER);
    const reviewIndex = markdown.indexOf(REVIEW_HEADER);
    
    if (memoIndex !== -1 && reviewIndex !== -1) {
      memos = markdown.substring(memoIndex + MEMO_HEADER.length, reviewIndex).trim();
      review = markdown.substring(reviewIndex + REVIEW_HEADER.length).trim();
    } else if (memoIndex !== -1) {
      memos = markdown.substring(memoIndex + MEMO_HEADER.length).trim();
    } else if (reviewIndex !== -1) {
      review = markdown.substring(reviewIndex + REVIEW_HEADER.length).trim();
    }
    
    return { title, memos, review };
  }

  // Merge sections into one markdown document
  function buildMarkdown(title, memos, review) {
    return `${title}

${MEMO_HEADER}
${memos.trim() ? memos.trim() : ""}

${REVIEW_HEADER}
${review.trim() ? review.trim() : ""}`;
  }

  // Format user input text as clean Markdown bullet points
  function formatAsBulletPoints(text) {
    return text
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.startsWith('-') ? line : `- ${line}`)
      .join('\n');
  }

  /* ==========================================================================
     Application Operations
     ========================================================================== */

  // Save Settings
  function saveSettings(e) {
    if (e) e.preventDefault();
    
    const settings = {
      pat: settingPat.value.trim(),
      owner: settingOwner.value.trim(),
      repo: settingRepo.value.trim(),
      folder: settingFolder.value.trim(),
      branch: settingBranch.value.trim() || 'main'
    };

    if (!settings.pat || !settings.owner || !settings.repo) {
      showToast('必須項目 (*) を入力してください。', 'error');
      return;
    }

    localStorage.setItem('github_memo_settings', JSON.stringify(settings));
    state.settings = settings;
    showToast('設定を保存しました。', 'success');
    
    // Update target dates and history
    updateTargetDates();
    fetchMemosHistory();
  }

  // Load Settings from LocalStorage
  function loadSettings() {
    const saved = localStorage.getItem('github_memo_settings');
    if (saved) {
      try {
        state.settings = JSON.parse(saved);
        settingPat.value = state.settings.pat || '';
        settingOwner.value = state.settings.owner || '';
        settingRepo.value = state.settings.repo || '';
        settingFolder.value = state.settings.folder || 'reviews';
        settingBranch.value = state.settings.branch || 'main';
        
        updateTargetDates();
        fetchMemosHistory();
      } catch (err) {
        console.error('Settings load error:', err);
        showToast('設定ファイルのロードに失敗しました。', 'error');
      }
    } else {
      // Prompt user to settings
      switchTab('settings');
      showToast('最初にGitHubの連携設定を行ってください。', 'info');
    }
  }

  // Test Connection
  async function testConnection() {
    const pat = settingPat.value.trim();
    const owner = settingOwner.value.trim();
    const repo = settingRepo.value.trim();

    if (!pat || !owner || !repo) {
      showToast('接続テストには、トークン、オーナー名、リポジトリ名が必要です。', 'error');
      return;
    }

    showLoader('GitHub接続テスト中...');
    
    try {
      const url = `https://api.github.com/repos/${owner}/${repo}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `token ${pat}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });

      if (response.ok) {
        showToast('接続に成功しました！リポジトリが見つかりました。', 'success');
      } else {
        const errData = await response.json().catch(() => ({}));
        showToast(`接続失敗: ${errData.message || response.statusText}`, 'error');
      }
    } catch (err) {
      showToast(`接続エラー: ${err.message}`, 'error');
    } finally {
      hideLoader();
    }
  }

  // Quick Memo Send (Weekday Tab)
  async function sendWeekdayMemo() {
    const text = memoInput.value.trim();
    if (!text) {
      showToast('メモ内容を入力してください。', 'error');
      return;
    }

    if (!state.settings) {
      showToast('先に設定タブでGitHub連携を完了してください。', 'error');
      return;
    }

    showLoader('メモを送信中...');
    
    try {
      const today = new Date();
      const monday = getMonday(today);
      const yymmdd = formatYYMMDD(monday);
      
      // Step 1: GET existing file to avoid conflict and get latest SHA
      const fileData = await getFile(yymmdd);
      
      let finalMarkdown = "";
      let sha = null;
      let title = "";
      let memos = "";
      let review = "";
      
      const newBullets = formatAsBulletPoints(text);

      if (fileData) {
        sha = fileData.sha;
        const parsed = parseMarkdown(fileData.content, yymmdd);
        title = parsed.title;
        memos = parsed.memos;
        review = parsed.review;
        
        const updatedMemos = memos ? `${memos}\n${newBullets}` : newBullets;
        finalMarkdown = buildMarkdown(title, updatedMemos, review);
      } else {
        // Create new report
        const year = '20' + yymmdd.substring(0, 2);
        const month = parseInt(yymmdd.substring(2, 4), 10);
        const day = parseInt(yymmdd.substring(4, 6), 10);
        title = `# ${year}年 ${month}月${day}日週 内省レポート`;
        memos = newBullets;
        finalMarkdown = buildMarkdown(title, memos, "");
      }

      // Step 2: PUT file
      await putFile(yymmdd, finalMarkdown, sha, "Add weekday memo via web app");
      
      showToast('メモを保存しました！', 'success');
      memoInput.value = '';
      
      // Refresh history list
      fetchMemosHistory();
    } catch (err) {
      showToast(`送信エラー: ${err.message}`, 'error');
    } finally {
      hideLoader();
    }
  }

  // Fetch current week's memos history list
  async function fetchMemosHistory() {
    if (!state.settings) return;
    
    const today = new Date();
    const monday = getMonday(today);
    const yymmdd = formatYYMMDD(monday);
    
    try {
      const fileData = await getFile(yymmdd);
      memosHistoryList.innerHTML = '';
      
      if (fileData) {
        const parsed = parseMarkdown(fileData.content, yymmdd);
        const bulletLines = parsed.memos.split('\n').filter(line => line.trim().startsWith('-'));
        
        if (bulletLines.length > 0) {
          bulletLines.reverse().forEach(bullet => {
            const cleanText = bullet.replace(/^-\s+/, '');
            const item = document.createElement('div');
            item.className = 'history-item';
            item.innerHTML = `
              <div class="history-content">${marked.parseInline(cleanText)}</div>
              <div class="history-time">記録済</div>
            `;
            memosHistoryList.appendChild(item);
          });
        } else {
          showEmptyHistory();
        }
      } else {
        showEmptyHistory("今週のレポートファイルはまだありません。メモを入力して送信すると作成されます。");
      }
    } catch (err) {
      console.error('History load error:', err);
      showEmptyHistory(`履歴の読み込みに失敗しました: ${err.message}`);
    }
  }

  function showEmptyHistory(msg = "今週記録された断片メモはまだありません。") {
    memosHistoryList.innerHTML = `
      <div class="empty-state">
        <i data-lucide="info"></i>
        <p>${msg}</p>
      </div>
    `;
    lucide.createIcons();
  }

  // Load Report (Weekend Tab)
  async function loadWeekendReport() {
    const yymmdd = weekendWeekSelect.value;
    if (!yymmdd) return;

    if (!state.settings) {
      showToast('先に設定タブでGitHub連携を完了してください。', 'error');
      return;
    }

    if (state.isDirty) {
      const confirmLeave = confirm('エディタに変更があります。保存せずに読み込みますか？');
      if (!confirmLeave) return;
    }

    showLoader('レポートを読み込み中...');
    
    try {
      const fileData = await getFile(yymmdd);
      
      state.loadedFileWeek = yymmdd;
      
      if (fileData) {
        state.loadedFileSha = fileData.sha;
        const parsed = parseMarkdown(fileData.content, yymmdd);
        
        editorMemos.value = parsed.memos;
        editorReview.value = parsed.review;
        showToast('レポートを読み込みました。', 'success');
      } else {
        // Clean start
        state.loadedFileSha = null;
        editorMemos.value = '';
        editorReview.value = '';
        showToast('該当週のレポートは存在しません。新規作成します。', 'info');
      }
      
      saveReportBtn.disabled = false;
      updatePreview();
      clearDraft();
      state.isDirty = false;
    } catch (err) {
      showToast(`読み込みエラー: ${err.message}`, 'error');
    } finally {
      hideLoader();
    }
  }

  // Save Report (Weekend Tab)
  async function saveWeekendReport() {
    const yymmdd = state.loadedFileWeek;
    if (!yymmdd) return;

    showLoader('レポートを保存中...');

    try {
      // Step 1: GET again to get the latest SHA (highly recommend to prevent collision)
      const fileData = await getFile(yymmdd);
      let sha = state.loadedFileSha;
      let existingTitle = "";
      
      if (fileData) {
        sha = fileData.sha;
        const parsed = parseMarkdown(fileData.content, yymmdd);
        existingTitle = parsed.title;
      } else {
        sha = null; // New file
        const year = '20' + yymmdd.substring(0, 2);
        const month = parseInt(yymmdd.substring(2, 4), 10);
        const day = parseInt(yymmdd.substring(4, 6), 10);
        existingTitle = `# ${year}年 ${month}月${day}日週 内省レポート`;
      }

      // Merge layout inputs
      const finalMarkdown = buildMarkdown(
        existingTitle,
        editorMemos.value,
        editorReview.value
      );

      // Step 2: PUT update
      const result = await putFile(yymmdd, finalMarkdown, sha, "Confirm and save weekly report");
      
      // Update loaded SHA
      state.loadedFileSha = result.content.sha;
      state.isDirty = false;
      clearDraft();
      showToast('レポートを確定保存しました！', 'success');
      
      // If saving current week, refresh weekday history list
      const today = new Date();
      const currentMonday = formatYYMMDD(getMonday(today));
      if (yymmdd === currentMonday) {
        fetchMemosHistory();
      }
    } catch (err) {
      showToast(`保存エラー: ${err.message}`, 'error');
    } finally {
      hideLoader();
    }
  }

  // Live Preview Builder
  function updatePreview() {
    const yymmdd = state.loadedFileWeek;
    if (!yymmdd) return;

    const year = '20' + yymmdd.substring(0, 2);
    const month = parseInt(yymmdd.substring(2, 4), 10);
    const day = parseInt(yymmdd.substring(4, 6), 10);
    const title = `# ${year}年 ${month}月${day}日週 内省レポート`;

    const finalMarkdown = buildMarkdown(
      title,
      editorMemos.value,
      editorReview.value
    );

    // Parse Markdown using marked.js
    if (window.marked) {
      previewContent.innerHTML = marked.parse(finalMarkdown);
    } else {
      previewContent.textContent = finalMarkdown;
    }
  }

  /* ==========================================================================
     Draft Management (LocalStorage)
     ========================================================================== */

  function saveDraft() {
    if (!state.loadedFileWeek) return;
    
    const draft = {
      week: state.loadedFileWeek,
      memos: editorMemos.value,
      review: editorReview.value,
      timestamp: Date.now()
    };
    
    localStorage.setItem('weekend_memo_draft', JSON.stringify(draft));
    draftStatus.classList.add('visible');
    state.isDirty = true;
  }

  function clearDraft() {
    localStorage.removeItem('weekend_memo_draft');
    draftStatus.classList.remove('visible');
  }

  function checkAndLoadDraft() {
    const saved = localStorage.getItem('weekend_memo_draft');
    if (saved) {
      try {
        const draft = JSON.parse(saved);
        // Only recover if the draft is relatively recent (within 48 hours)
        const elapsed = Date.now() - draft.timestamp;
        if (elapsed < 48 * 60 * 60 * 1000) {
          const loadDraft = confirm(`前回の書きかけデータ（下書き）が見つかりました。\n${draft.week}の週のデータを復元しますか？`);
          if (loadDraft) {
            state.loadedFileWeek = draft.week;
            
            // Set select option matching draft week
            weekendWeekSelect.value = draft.week;
            
            editorMemos.value = draft.memos;
            editorReview.value = draft.review;
            
            // Attempt to load SHA silently
            getFile(draft.week).then(file => {
              if (file) {
                state.loadedFileSha = file.sha;
              }
            });
            
            saveReportBtn.disabled = false;
            updatePreview();
            draftStatus.classList.add('visible');
            state.isDirty = true;
            showToast('下書きデータを復元しました。', 'info');
          } else {
            clearDraft();
          }
        }
      } catch (err) {
        console.error('Draft parsing error:', err);
      }
    }
  }

  /* ==========================================================================
     UI Navigation & Setup
     ========================================================================== */

  // Switch Tab
  function switchTab(tabId) {
    state.activeTab = tabId;
    
    navButtons.forEach(btn => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    tabContents.forEach(content => {
      if (content.id === `tab-${tabId}`) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });

    // Run actions on tab enter
    if (tabId === 'weekday') {
      updateTargetDates();
      fetchMemosHistory();
    } else if (tabId === 'weekend') {
      populateWeekSelector();
    }
  }

  // Toggle Theme
  function toggleTheme() {
    const isDark = document.body.classList.toggle('dark');
    state.currentTheme = isDark ? 'dark' : 'light';
    localStorage.setItem('app_theme', state.currentTheme);
    
    // Update icon
    if (isDark) {
      themeIcon.setAttribute('data-lucide', 'sun');
    } else {
      themeIcon.setAttribute('data-lucide', 'moon');
    }
    lucide.createIcons();
  }

  // Restore Theme on Startup
  function restoreTheme() {
    const savedTheme = localStorage.getItem('app_theme') || 'dark';
    state.currentTheme = savedTheme;
    
    if (savedTheme === 'dark') {
      document.body.classList.add('dark');
      themeIcon.setAttribute('data-lucide', 'sun');
    } else {
      document.body.classList.remove('dark');
      themeIcon.setAttribute('data-lucide', 'moon');
    }
    lucide.createIcons();
  }

  /* ==========================================================================
     Event Listeners Setup
     ========================================================================== */

  // Tab switcher
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchTab(tabId);
    });
  });

  // Theme switch button
  themeToggleBtn.addEventListener('click', toggleTheme);

  // Settings
  settingsForm.addEventListener('submit', saveSettings);
  testConnectionBtn.addEventListener('click', testConnection);
  
  togglePatVisibility.addEventListener('click', () => {
    const isPassword = settingPat.type === 'password';
    settingPat.type = isPassword ? 'text' : 'password';
    
    const iconName = isPassword ? 'eye-off' : 'eye';
    togglePatVisibility.querySelector('i').setAttribute('data-lucide', iconName);
    lucide.createIcons();
  });

  // Weekday Memo actions
  sendMemoBtn.addEventListener('click', sendWeekdayMemo);
  
  memoInput.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      sendWeekdayMemo();
    }
  });
  
  refreshMemosBtn.addEventListener('click', fetchMemosHistory);

  // Weekend Editor actions
  loadReportBtn.addEventListener('click', loadWeekendReport);
  saveReportBtn.addEventListener('click', saveWeekendReport);
  
  const editorInputHandler = () => {
    updatePreview();
    saveDraft();
  };
  editorMemos.addEventListener('input', editorInputHandler);
  editorReview.addEventListener('input', editorInputHandler);

  // Toggle Layout Preview
  togglePreviewLayout.addEventListener('click', () => {
    const isHidden = previewPane.classList.toggle('hidden');
    
    if (isHidden) {
      editorPane.classList.add('full-width');
      togglePreviewLayout.querySelector('i').setAttribute('data-lucide', 'columns-regular'); // Custom change indicator
    } else {
      editorPane.classList.remove('full-width');
      togglePreviewLayout.querySelector('i').setAttribute('data-lucide', 'columns');
    }
    lucide.createIcons();
  });

  // Prevent closing window if modifications are present
  window.addEventListener('beforeunload', (e) => {
    if (state.isDirty) {
      e.preventDefault();
      e.returnValue = '変更が保存されていません。移動しますか？';
    }
  });

  /* ==========================================================================
     Bootstrap Initialization
     ========================================================================== */
  restoreTheme();
  loadSettings();
  populateWeekSelector();
  checkAndLoadDraft();
  
  // Update weekday target UI once on startup
  updateTargetDates();
});

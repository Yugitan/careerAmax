const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const fillBtn = document.getElementById('fillBtn');
const captureBtn = document.getElementById('captureBtn');
const captureResult = document.getElementById('captureResult');
const serverUrlInput = document.getElementById('serverUrl');
const saveUrlBtn = document.getElementById('saveUrlBtn');
const settingsLink = document.getElementById('settingsLink');

let isConnected = false;
// 当前页面有没有申请表可填：null = 还没问到 / 问不到（如内容脚本不在），
// 这种情况下不拦着用户，保持和以前一样可点
let pageHasForm = null;

// Interface copy comes from the extension i18n module (i18n.js + locales).
// The language lives in chrome.storage.local and is independent from the web app.
function renderStaticCopy() {
  i18n.applyStatic(document);
  renderCaptureOutcome(lastCaptureOutcome);
  renderFillAvailability();
  document.querySelectorAll('#lang-switch .lang-option').forEach((btn) => {
    const isActive = btn.dataset.lang === i18n.getLanguage();
    btn.setAttribute('aria-pressed', String(isActive));
    btn.setAttribute('aria-label', t(btn.dataset.lang === 'zh-CN' ? 'nav.languageZhLabel' : 'nav.languageEnLabel'));
  });
}

// 「填写申请表」的颜色只认两个条件：服务连得上、页面上真的有表可填。
// 判据与页面上的常驻悬浮面板同源（content.js 的 detectForm 消息），
// 所以不会出现面板置灰、弹窗却亮蓝这种事。
async function probeActiveTabForm() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return null;
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'detectForm' });
    if (response && response.ok === true && typeof response.hasForm === 'boolean') {
      return response.hasForm;
    }
    return null;
  } catch {
    // 内容脚本不在这个标签页（chrome:// 页面、刚更新完还没刷新的页面）
    return null;
  }
}

function renderFillAvailability() {
  const blocked = pageHasForm === false;
  fillBtn.disabled = !isConnected || blocked;
  fillBtn.title = blocked ? t('overlay.panelNoForm') : '';
  const hint = document.getElementById('fillHint');
  if (hint) {
    hint.hidden = !blocked;
    hint.textContent = blocked ? t('overlay.panelNoForm') : '';
  }
}

async function init() {
  await i18n.init();
  i18n.watchStorage();
  renderStaticCopy();

  const { serverUrl } = await chrome.storage.local.get({ serverUrl: 'http://localhost:8085' });
  serverUrlInput.value = serverUrl;
  settingsLink.href = `${serverUrl}/#/settings`;

  document.querySelectorAll('#lang-switch .lang-option').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.lang === i18n.getLanguage()) return;
      i18n.setLanguage(btn.dataset.lang);
      renderStaticCopy();
      await checkConnection();
    });
  });

  i18n.onChange(() => {
    renderStaticCopy();
    checkConnection();
  });

  await checkConnection();
}

async function checkConnection() {
  statusDot.className = 'status-dot';
  statusText.textContent = t('status.checking');
  fillBtn.disabled = true;
  captureBtn.disabled = true;
  pageHasForm = null;

  try {
    const response = await chrome.runtime.sendMessage({ type: 'checkConnection' });
    if (response && response.ok) {
      statusDot.classList.add('connected');
      statusText.textContent = t('popup.connected');
      isConnected = true;
      captureBtn.disabled = captureInFlight;
      // 表单可用性是另一次异步问答（问内容脚本），不能让它拖住连接状态与抓取按钮；
      // 问出结果前「填写申请表」保持置灰，免得先亮蓝再变灰
      probeActiveTabForm().then((hasForm) => {
        pageHasForm = hasForm;
        renderFillAvailability();
      });
    } else {
      statusDot.classList.add('disconnected');
      statusText.textContent = response && response.error
        ? extErrorMessage(response)
        : t('errors.serverUnreachable');
      isConnected = false;
    }
  } catch (err) {
    statusDot.classList.add('disconnected');
    statusText.textContent = t('popup.extensionError');
    isConnected = false;
  }
}

fillBtn.addEventListener('click', async () => {
  if (!isConnected) return;

  fillBtn.disabled = true;
  fillBtn.textContent = t('popup.filling');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error(t('popup.noActiveTab'));
    await chrome.tabs.sendMessage(tab.id, { type: 'startFill' });
    window.close();
  } catch (err) {
    console.error('Fill error:', err);
    fillBtn.textContent = t('popup.fillApplication');
    fillBtn.disabled = false;
    statusText.textContent = t('popup.refreshRequired');
    statusDot.className = 'status-dot disconnected';
  }
});

// ─── 立即抓取（当前页面的职位列表）─────────────────────────────
// 采集由当前标签页里的内容脚本执行：弹窗只是触发器与回显，用户关掉弹窗
// 也不会中断已经开始的那一次采集（结果同时会在页面上以 toast 呈现）。

let captureInFlight = false;
let lastCaptureOutcome = null; // { summary } | { error } | { key }

function captureSummaryText(summary) {
  if (!summary || !summary.total) return t('popup.captureNothing');
  let text = t('popup.captureResult', { saved: summary.saved, skipped: summary.skipped });
  if (summary.failed) text += t('popup.captureFailedCount', { count: summary.failed });
  return text;
}

function captureOutcomeText(outcome) {
  if (!outcome) return '';
  if (outcome.summary) return captureSummaryText(outcome.summary);
  if (outcome.error) return extErrorMessage(outcome.error);
  return outcome.key ? t(outcome.key) : '';
}

function renderCaptureOutcome(outcome) {
  const text = captureOutcomeText(outcome);
  const tone = !text ? '' : (outcome.error ? ' error' : ' success');
  captureResult.hidden = !text;
  captureResult.textContent = text;
  captureResult.className = `capture-result${tone}`;
}

captureBtn.addEventListener('click', async () => {
  if (!isConnected || captureInFlight) return;

  captureInFlight = true;
  captureBtn.disabled = true;
  captureBtn.textContent = t('popup.capturing');
  lastCaptureOutcome = null;
  renderCaptureOutcome(null);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error(t('popup.noActiveTab'));
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'startCapture' });
    if (response && response.ok) lastCaptureOutcome = { summary: response.summary };
    else if (response) lastCaptureOutcome = { error: response };
    else lastCaptureOutcome = { key: 'popup.refreshRequired' };
  } catch {
    // 内容脚本不在这个标签页：chrome:// 页面、扩展刚更新完还没刷新的页面
    lastCaptureOutcome = { key: 'popup.refreshRequired' };
  } finally {
    captureInFlight = false;
    captureBtn.textContent = t('popup.captureNow');
    captureBtn.disabled = !isConnected;
    renderCaptureOutcome(lastCaptureOutcome);
  }
});

saveUrlBtn.addEventListener('click', async () => {
  let url = serverUrlInput.value.trim().replace(/\/+$/, '');
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = t('popup.invalidUrl');
    return;
  }
  await chrome.storage.local.set({ serverUrl: url });
  settingsLink.href = `${url}/#/settings`;
  await checkConnection();
});

settingsLink.addEventListener('click', async (e) => {
  e.preventDefault();
  const { serverUrl } = await chrome.storage.local.get({ serverUrl: 'http://localhost:8085' });
  chrome.tabs.create({ url: `${serverUrl}/#/settings` });
});

init();

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const fillBtn = document.getElementById('fillBtn');
const serverUrlInput = document.getElementById('serverUrl');
const saveUrlBtn = document.getElementById('saveUrlBtn');
const settingsLink = document.getElementById('settingsLink');

let isConnected = false;

// Interface copy comes from the extension i18n module (i18n.js + locales).
// The language lives in chrome.storage.local and is independent from the web app.
function renderStaticCopy() {
  i18n.applyStatic(document);
  document.querySelectorAll('#lang-switch .lang-option').forEach((btn) => {
    const isActive = btn.dataset.lang === i18n.getLanguage();
    btn.setAttribute('aria-pressed', String(isActive));
    btn.setAttribute('aria-label', t(btn.dataset.lang === 'zh-CN' ? 'nav.languageZhLabel' : 'nav.languageEnLabel'));
  });
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

  try {
    const response = await chrome.runtime.sendMessage({ type: 'checkConnection' });
    if (response && response.ok) {
      statusDot.classList.add('connected');
      statusText.textContent = t('popup.connected');
      fillBtn.disabled = false;
      isConnected = true;
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

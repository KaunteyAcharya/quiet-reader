// Opens Quiet's tiny save page in a small popup window. Quiet stores the link in your own browser storage.
chrome.action.onClicked.addListener(async (tab) => {
  const { base } = await chrome.storage.sync.get('base');
  if (!base) return chrome.runtime.openOptionsPage();
  if (!tab?.url || !/^https?:/.test(tab.url)) return;
  const url = `${base.replace(/\/$/, '')}/save.html?u=${encodeURIComponent(tab.url)}&t=${encodeURIComponent(tab.title || '')}`;
  chrome.windows.create({ url, type: 'popup', width: 420, height: 240 });
});

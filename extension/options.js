const b = document.getElementById('b');
chrome.storage.sync.get('base').then((v) => (b.value = v.base || ''));
document.getElementById('s').onclick = async () => {
  try {
    const u = new URL(b.value.trim());
    if (!/^https?:$/.test(u.protocol)) throw 0;
    await chrome.storage.sync.set({ base: u.origin });
    document.getElementById('m').textContent = 'Saved ✓';
  } catch { document.getElementById('m').textContent = 'Enter a full https:// address'; }
};

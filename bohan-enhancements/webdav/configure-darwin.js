'use strict';
const initial = JSON.parse(new URLSearchParams(location.search).get('initial') || '{}');
for (const key of ['endpoint','username']) document.getElementById(key).value = initial[key] || '';
document.getElementById('setup').addEventListener('submit', async event => {
  event.preventDefault();
  const button = document.getElementById('submit'); button.disabled = true;
  try {
    const value = Object.fromEntries(['endpoint','username','password'].map(key => [key, document.getElementById(key).value]));
    value.enable = document.getElementById('enable').checked;
    const result = await window.webdavSetup.save(value);
    if (result.ok) document.getElementById('password').value = '';
    document.getElementById('message').textContent = result.ok ? '配置已保存，请重新启动 GenOffice。' : result.message;
    if (!result.ok) button.disabled = false;
  } catch {document.getElementById('message').textContent = '配置未保存，请重试。';button.disabled = false;}
});

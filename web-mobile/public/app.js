const $ = id => document.getElementById(id);
let active = 1;
let accounts = [];
let token = sessionStorage.getItem('pkmobile-token') || localStorage.getItem('pkmobile-token') || '';
let poller = null;
let refreshing = false;

async function api(path, options = {}) {
  const response = await fetch('/api' + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(options.headers || {}) }
  });
  if (response.status === 401) { $('settingsDialog').showModal(); throw new Error('Token inválido ou ausente'); }
  if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.error || 'Falha na comunicação'); }
  return response.headers.get('content-type')?.includes('image/') ? response.blob() : response.json();
}
function current() { return accounts.find(a => a.id === active) || { id: active, running: false }; }
function render() {
  document.querySelectorAll('.account-tab').forEach(btn => {
    const id = Number(btn.dataset.account), item = accounts.find(a => a.id === id);
    btn.classList.toggle('active', id === active);
    btn.classList.toggle('running', !!item?.running);
    btn.querySelector('i').title = item?.running ? 'Sessão ativa' : 'Sessão parada';
  });
  const item = current();
  $('activeName').textContent = item.title || 'Conta ' + active;
  $('activeState').textContent = item.running ? 'Ativa' : 'Parada';
  document.querySelector('.live-dot').classList.toggle('on', !!item.running);
  $('placeholder').hidden = !!item.running;
  $('gameScreen').hidden = !item.running;
  $('start').textContent = 'Iniciar conta';
  $('stop').disabled = !item.running;
  $('statusText').textContent = accounts.filter(a => a.running).length + '/4 ativas';
  if (!item.running) stopPolling(); else startPolling();
}
async function refreshStatus() {
  try { const data = await api('/status'); accounts = data.accounts; render(); }
  catch (e) { $('statusText').textContent = e.message; }
}
function startPolling() {
  if (poller) return;
  poller = setInterval(capture, 1100);
  capture();
}
function stopPolling() { if (poller) clearInterval(poller); poller = null; }
async function capture() {
  if (refreshing || !current().running) return;
  refreshing = true;
  try {
    const blob = await api('/accounts/' + active + '/screenshot');
    const url = URL.createObjectURL(blob), img = $('gameScreen'), old = img.dataset.url;
    img.src = url; img.dataset.url = url;
    if (old) URL.revokeObjectURL(old);
  } catch (e) { $('activeState').textContent = e.message; }
  finally { refreshing = false; }
}
async function startAccount() {
  $('loading').hidden = false;
  try { await api('/accounts/' + active + '/start', { method: 'POST', body: '{}' }); await refreshStatus(); }
  catch (e) { alert(e.message); }
  finally { $('loading').hidden = true; }
}
async function sendInput(payload) {
  try { await api('/accounts/' + active + '/input', { method: 'POST', body: JSON.stringify(payload) }); }
  catch (e) { console.warn(e); }
}
document.querySelectorAll('.account-tab').forEach(btn => btn.addEventListener('click', async () => { active = Number(btn.dataset.account); await refreshStatus(); }));
$('start').addEventListener('click', startAccount);
$('stop').addEventListener('click', async () => { if (!confirm('Encerrar a sessão desta conta? O login salvo será mantido.')) return; await api('/accounts/' + active + '/stop', { method: 'POST', body: '{}' }); await refreshStatus(); });
$('reload').addEventListener('click', capture);
$('fullscreen').addEventListener('click', () => $('viewport').requestFullscreen?.());
$('settings').addEventListener('click', () => $('settingsDialog').showModal());
$('saveToken').addEventListener('click', () => { token = $('token').value.trim(); localStorage.setItem('pkmobile-token', token); });
$('token').value = token;
const screen = $('gameScreen');
screen.addEventListener('click', e => { const r = screen.getBoundingClientRect(); sendInput({ action: 'tap', x: (e.clientX-r.left)/r.width, y: (e.clientY-r.top)/r.height }); });
screen.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('keydown', e => {
  if (!current().running || ['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (['Enter','Escape','Tab','Backspace','Delete','ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) {
    e.preventDefault(); sendInput({ action: 'key', key: e.key });
  } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
    sendInput({ action: 'type', text: e.key });
  }
});
let touchY = 0;
$('viewport').addEventListener('touchstart', e => { touchY = e.touches[0].clientY; }, { passive: true });
$('viewport').addEventListener('touchend', e => { const dy = touchY-e.changedTouches[0].clientY; if (Math.abs(dy)>20) sendInput({ action:'scroll', delta:dy*2 }); }, { passive:true });
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
refreshStatus();

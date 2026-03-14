// ── Audio setup ───────────────────────────────────────────
const welcomeSound = new Audio('/resources/sounds/phasmophobia-welcome-back.mp3');
const djSound = new Audio('/resources/sounds/phasmophobia-dj-kraken.mp3');

// ── Read ?player= from URL ────────────────────────────────
const urlName = new URLSearchParams(location.search).get('player')?.trim() || null;
let playerName = null;

let ws = null;
let revealAfter = null;
let secsPerPhoto = 5;
let playbackVolume = 1;
let isMuted = false;
let allConnectedOnce = false;
let countdownInterval = null;
let waitingPhotos = [];
let waitingPhotoIndex = 0;
let carouselInterval = null;

const errorEl = document.getElementById('error-screen');
const errorMsg = document.getElementById('error-msg');
const lobbyEl = document.getElementById('lobby');
const waitingEl = document.getElementById('waiting');
const startEl = document.getElementById('start');
const mapNameEl = document.getElementById('map-name');
const lobbyMeta = document.getElementById('lobby-meta');
const playerList = document.getElementById('player-list');
const readyCount = document.getElementById('ready-count');
const logEl = document.getElementById('log');
const connBar = document.getElementById('conn-bar');
const playerInput = document.getElementById('player-input');
const countdownEl = document.getElementById('countdown');
const waitingPhotoEl = document.getElementById('waiting-photo');
const waitingTitleEl = document.getElementById('photo-title');
const volumeSlider = document.getElementById('volume-slider');
const muteButton = document.getElementById('mute-button');

function setAudioVolume(value) {
    playbackVolume = Math.max(0, Math.min(1, Number(value)));
    const effective = isMuted ? 0 : playbackVolume;
    [welcomeSound, djSound].forEach(sound => {
        if (sound && typeof sound.volume === 'number') {
            sound.volume = effective;
        }
    });
    if (volumeSlider) volumeSlider.value = String(playbackVolume);
    if (muteButton) muteButton.textContent = isMuted ? 'Unmute' : 'Mute';
}

function toggleMute() {
    isMuted = !isMuted;
    setAudioVolume(playbackVolume);
}

if (volumeSlider) {
    volumeSlider.addEventListener('input', event => {
        setAudioVolume(event.target.value);
        if (isMuted) {
            isMuted = false;
            if (muteButton) muteButton.textContent = 'Mute';
        }
    });
}

if (muteButton) {
    muteButton.addEventListener('click', () => {
        toggleMute();
    });
}

setAudioVolume(1);

function fetchWaitingPhotos() {
    fetch('/photos')
        .then(r => r.json())
        .then(list => {
            if (!Array.isArray(list) || !list.length) return;
            waitingPhotos = list;
            setWaitingPhoto(0);
        })
        .catch((err) => {
            console.error('Failed to fetch waiting photos:', err);
        });
}

// Load photos immediately so the carousel is ready when the waiting screen appears
fetchWaitingPhotos();

function formatPhotoTitle(url) {
    const name = url.split('/').pop().replace(/\.[^.]+$/, '');
    return name.replace(/[_-]+/g, ' ').replace(/photo\s*/i, 'Photo ').trim();
}

function setWaitingPhoto(idx) {
    if (!waitingPhotos.length) return;
    waitingPhotoIndex = ((idx % waitingPhotos.length) + waitingPhotos.length) % waitingPhotos.length;
    const url = waitingPhotos[waitingPhotoIndex];
    waitingPhotoEl.src = url;
    waitingTitleEl.textContent = formatPhotoTitle(url);

}

function startPhotoCarousel() {
    console.log('Starting photo carousel with', waitingPhotos.length, 'photos, changing every', secsPerPhoto, 'seconds');
    if (!waitingPhotos.length) return;
    setWaitingPhoto(0);
    carouselInterval = setInterval(() => setWaitingPhoto(waitingPhotoIndex + 1), secsPerPhoto * 1000);
    djSound.currentTime = 0;
    djSound.play().catch(() => {
        console.error('Failed to play song:', err);
    });
}

function stopPhotoCarousel() {
    if (carouselInterval) {
        clearInterval(carouselInterval);
        carouselInterval = null;
    }
}

function addLog(msg, type = '') {
    const line = document.createElement('div');
    line.className = 'log-line' + (type ? ` ${type}` : '');
    line.textContent = msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
}

function showError(msg) {
    errorMsg.textContent = msg;
    errorEl.style.display = 'flex';
}

// Initially show start screen
startEl.style.display = 'flex';

// Prefill player ID if provided in URL
if (urlName) {
    playerInput.value = urlName;
}

// Enter button click
const enterBtn = document.getElementById('enter-btn');
enterBtn.addEventListener('click', () => {
    playerName = urlName || playerInput.value.trim();

    if (!playerName) {
        showError('Enter your operative ID.');
        return;
    }

    // Keep the URL updated so refresh preserves the entered player ID
    const updatedUrl = new URL(location.href);
    updatedUrl.searchParams.set('player', playerName);
    history.replaceState(null, '', updatedUrl);

    startEl.style.display = 'none';
    // Proceed to boot
    fetch('/config')
        .then(r => r.json())
        .then(cfg => {
            mapNameEl.textContent = `${cfg.mapName} — ${cfg.difficulty}`;
            if (typeof cfg.secsPerPhoto === 'number' && cfg.secsPerPhoto > 0) {
                secsPerPhoto = cfg.secsPerPhoto;
            }

            // Validate name against server config before connecting
            if (!cfg.players.includes(playerName)) {
                showError(`Unknown operative: "${playerName}". Check your link.`);
                return;
            }

            lobbyEl.style.display = 'flex';
            addLog(`// Connecting as ${playerName}…`);
            connect();
            addLog("Welcome back! I've got some jobs ready for you.");
            welcomeSound.play();
        })
        .catch(() => showError('Could not reach the server. Try refreshing.'));
});

// Trigger enter button on Enter key inside input
playerInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        enterBtn.click();
    }
});

// ── Lobby render ──────────────────────────────────────────
function renderLobby({ players, allConnected }) {
    if (waitingEl.classList.contains('visible')) {
        hideWaiting();
    }

    const connN = players.filter(p => p.connected).length;
    const readyN = players.filter(p => p.ready).length;
    const total = players.length;

    readyCount.textContent = `${readyN} / ${total} ready`;
    lobbyMeta.textContent = allConnected
        ? 'All players connected — mark ready to proceed'
        : `${connN} / ${total} players connected — waiting…`;

    if (allConnected && !allConnectedOnce) {
        allConnectedOnce = true;
        addLog('// All operatives online. Mark yourself ready!');
    }

    playerList.innerHTML = '';
    for (const p of players) {
        const isMe = p.name === playerName;
        const row = document.createElement('div');
        row.className = 'player-row'
            + (p.connected ? ' connected' : '')
            + (p.ready ? ' ready-state' : '')
            + (isMe ? ' is-you' : '');

        const dot = document.createElement('div'); dot.className = 'player-dot';
        const name = document.createElement('div'); name.className = 'player-name'; name.textContent = p.name;
        const status = document.createElement('div'); status.className = 'player-status';
        status.textContent = !p.connected ? 'Offline' : p.ready ? 'Ready' : 'In lobby';

        row.append(dot, name);
        if (isMe) {
            const tag = document.createElement('span');
            tag.className = 'you-tag'; tag.textContent = 'YOU';
            row.appendChild(tag);
        }

        if (isMe) {
            const btn = document.createElement('button');
            btn.className = 'ready-btn' + (p.ready ? ' is-ready' : '') + ((!p.ready && allConnected) ? ' pulse' : '');
            btn.textContent = p.ready ? '✓ Ready' : 'Ready';
            btn.disabled = !allConnected || p.ready;
            if (!p.ready && allConnected) {
                btn.addEventListener('click', () => {
                    ws.send(JSON.stringify({ type: 'ready' }));
                    addLog('// You marked yourself ready.');
                });
            }
            row.append(status, btn);
        } else {
            row.append(status);
        }
        playerList.appendChild(row);
    }
}

// ── Waiting + countdown ───────────────────────────────────
function showWaiting() {
    addLog('// All ready. Operation window not yet open…', 'warn');

    setTimeout(() => {
        fadeOut(lobbyEl, () => {
            waitingEl.style.display = 'flex';
            raf2(() => {
                waitingEl.classList.add('visible');
                startPhotoCarousel();
            });
            startCountdown();
        });
    }, 600);
}

function hideWaiting() {
    addLog('// Something happened, back to lobby!', 'warn');

    stopPhotoCarousel();

    fadeOut(waitingEl, () => {
        waitingEl.classList.remove('visible');
        fadeIn(lobbyEl, raf2(() => { lobbyEl.style.display = 'flex'; lobbyEl.classList.add('visible'); }));
    });
}

function startCountdown() {
    function tick() {
        const diff = revealAfter - new Date();
        if (diff <= 0) {
            countdownEl.textContent = '00:00:00';
            clearInterval(countdownInterval);
            revealInvite();
            return;
        }
        const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
        const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
        countdownEl.textContent = `${h}:${m}:${s}`;
    }
    tick();
    countdownInterval = setInterval(tick, 1000);
}

// ── Invite reveal ─────────────────────────────────────────
function revealInvite() {
    clearInterval(countdownInterval);
    stopPhotoCarousel();

    const targetUrl = '/invite.html' + (playerName ? `?player=${encodeURIComponent(playerName)}` : '');
    window.location.href = targetUrl;
}

// ── Helpers ───────────────────────────────────────────────
function fadeOut(el, cb) {
    el.style.transition = 'opacity 0.4s ease';
    el.style.opacity = '0';
    setTimeout(() => { el.style.display = 'none'; cb(); }, 400);
}
function fadeIn(el, cb) {
    el.classList.add('visible');
    el.style.transition = 'opacity 0.4s ease';
    el.style.opacity = '1';

    setTimeout(() => cb(), 10);
}

function raf2(fn) { requestAnimationFrame(() => requestAnimationFrame(fn)); }

// ── WebSocket ─────────────────────────────────────────────
function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.onopen = () => {
        connBar.classList.remove('show');
        ws.send(JSON.stringify({ type: 'identify', name: playerName }));
    };

    ws.onmessage = ({ data }) => {
        let msg; try { msg = JSON.parse(data); } catch { return; }
        switch (msg.type) {
        case 'state': renderLobby(msg); break;
        case 'waiting': showWaiting(); break;
        case 'start': startCountdown(); break;
        case 'error': addLog(`// ERROR: ${msg.message}`, 'err'); break;
        case 'revealAfter': {
            revealAfter = new Date(msg.time);
            if (typeof msg.secsPerPhoto === 'number' && msg.secsPerPhoto > 0) {
                secsPerPhoto = msg.secsPerPhoto;
            }
            addLog(`// Operation window opens at ${revealAfter.toLocaleString()}.`, 'info');
            break;
        }
        case 'reload': {
            addLog('// Server requested reload due to config update.', 'info');
            setTimeout(() => location.reload(), 1000);
            break;
        }
        case 'config': {
            if (msg.config && typeof msg.config.secsPerPhoto === 'number' && msg.config.secsPerPhoto > 0) {
                secsPerPhoto = msg.config.secsPerPhoto;
            }
            addLog('// Server config changed. Reloading.', 'info');
            setTimeout(() => location.reload(), 1000);
            break;
        }
        }
    };

    ws.onclose = () => { connBar.classList.add('show'); setTimeout(connect, 3000); };
    ws.onerror = () => ws.close();
}
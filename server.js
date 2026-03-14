const express    = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const Database   = require('better-sqlite3');
const http       = require('http');
const path       = require('path');
const fs         = require('fs');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const BASEURL = process.env.BASEURL || `http://localhost:${PORT}`;
const resourcesDir = path.join(__dirname, 'public', 'resources');
const imgDir = path.join(resourcesDir, 'img');

const configPath = path.join(__dirname, 'config.json');

let cfg = loadConfig();
let REVEAL_AFTER = null;

function loadConfig() {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const players = Array.isArray(parsed.players) ? parsed.players.map(String) : [];

    return {
        mapName: String(parsed.mapName || 'unknown'),
        difficulty: String(parsed.difficulty || 'normal'),
        players,
        secsPerPhoto: Number(parsed.secsPerPhoto) || 7.5,
    };
}

const totalPhotoCount = () => {
    try {
        return fs.readdirSync(imgDir).filter(f => /.*\.(jpe?g|png)$/i.test(f)).length;
    } catch {
        return 0;
    }
};

console.log(`Map: ${cfg.mapName} (${cfg.difficulty})`);
console.log(`Players: ${cfg.players.join(', ')}`);
console.log(`Secs per photo: ${cfg.secsPerPhoto} seconds`);
// ─────────────────────────────────────────────────────────────────────────────

// ── LOBBY ─────────────────────────────────────────────────────────────────────
const db = new Database(':memory:');
db.exec(`CREATE TABLE players (
  name TEXT PRIMARY KEY, connected INTEGER DEFAULT 0, ready INTEGER DEFAULT 0
)`);

const insert = db.prepare('INSERT INTO players (name) VALUES (?)');
for (const name of cfg.players) insert.run(name);

const getPlayers   = db.prepare('SELECT * FROM players ORDER BY rowid');
const setConnected = db.prepare('UPDATE players SET connected = ? WHERE name = ?');
const setReady     = db.prepare('UPDATE players SET ready = 1 WHERE name = ?');
const resetPlayer  = db.prepare('UPDATE players SET connected = 0, ready = 0 WHERE name = ?');

function getLobbyState() {
    const rows         = getPlayers.all();
    const allConnected = rows.every(p => p.connected);
    const allReady     = rows.every(p => p.ready);
    return { players: rows, allConnected, allReady };
}

function isAfterReveal() {
    return new Date() >= new Date(REVEAL_AFTER);
}

// ── APP ───────────────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/resources', express.static(path.join(__dirname, 'public', 'resources')));
app.use(express.json());

// Frontend fetches this to get lobby config on load
app.get('/config', (_req, res) => {
    res.json({
        mapName: cfg.mapName,
        difficulty: cfg.difficulty,
        players: cfg.players,
        secsPerPhoto: cfg.secsPerPhoto,
        revealAfter: REVEAL_AFTER,
        photoCount: totalPhotoCount(),
    });
});

app.post('/config', (req, res) => {
    const next = req.body;
    if (!next || typeof next !== 'object') {
        return res.status(400).json({ error: 'Invalid config payload' });
    }

    const nextPlayers = Array.isArray(next.players) ? next.players.map(String) : null;
    const nextMap = typeof next.mapName === 'string' ? next.mapName : null;
    const nextDifficulty = typeof next.difficulty === 'string' ? next.difficulty : null;
    const nextSecsPerPhoto = Number.isFinite(Number(next.secsPerPhoto)) ? Number(next.secsPerPhoto) : null;

    if (!nextMap || !nextDifficulty || !Array.isArray(nextPlayers) || nextPlayers.length === 0 || nextSecsPerPhoto === null || nextSecsPerPhoto <= 0) {
        return res.status(400).json({ error: 'Must include mapName, difficulty, players (non-empty array), secsPerPhoto > 0' });
    }

    const prevPlayers = cfg.players;
    const playersChanged = prevPlayers.length !== nextPlayers.length
    || prevPlayers.some((p, i) => p !== nextPlayers[i])
    || nextPlayers.some((p, i) => p !== prevPlayers[i]);

    const secsChanged = cfg.secsPerPhoto !== nextSecsPerPhoto;

    cfg = {
        mapName: nextMap,
        difficulty: nextDifficulty,
        players: nextPlayers,
        secsPerPhoto: nextSecsPerPhoto,
    };

    console.log('Config updated via POST /config:', cfg);

    const shouldReload = playersChanged || secsChanged;
    if (shouldReload) {
        if (playersChanged) {
            // Refresh lobby data, clear and reset tracked players to avoid stale state.
            db.exec('DELETE FROM players');
            for (const name of cfg.players) {
                insert.run(name);
            }
        }
        REVEAL_AFTER = null;
        broadcast({ type: 'reload', message: 'Config updated, reload required' });
        return res.json({ status: 'ok', message: 'Config updated, clients reloading' });
    }

    broadcast({ type: 'config', config: { mapName: cfg.mapName, difficulty: cfg.difficulty, secsPerPhoto: cfg.secsPerPhoto } });
    return res.json({ status: 'ok', message: 'Config updated' });
});

// Provide photo list for the waiting carousel
app.get('/photos', (_req, res) => {
    try {
        const files = fs.readdirSync(imgDir)
            .filter(f => /.*\.(jpe?g|png)$/i.test(f))
            .sort();
        res.json(files.map(f => `/resources/img/${f}`));
    } catch {
        res.status(500).json({ error: 'Could not list photos.' });
    }
});

// Reset reveal timer
app.post('/reset-reveal', (_req, res) => {
    REVEAL_AFTER = null;
    console.log('Reveal timer reset manually.');
    res.send('Reveal timer reset.');
    broadcastState();
});

// ── WEBSOCKET ─────────────────────────────────────────────────────────────────
const connections = new Map(); // ws → playerName

const send      = (ws, d) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(d));
const broadcast = (d)     => wss.clients.forEach(c => send(c, d));

function broadcastState() {
    broadcast({ type: 'state', ...getLobbyState() });
}

function addSeconds(seconds, date = new Date()) {
    if (typeof seconds !== 'number') {
        throw new Error('Invalid "seconds" argument');
    }

    if (!(date instanceof Date)) {
        throw new Error('Invalid "date" argument');
    }

    date.setSeconds(date.getSeconds() + seconds);
    return date;
}


wss.on('connection', (ws, req) => {
    send(ws, { type: 'state', ...getLobbyState() });

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }

        switch (msg.type) {

        case 'identify': {
            const name = typeof msg.name === 'string' ? msg.name.trim() : null;
            if (!cfg.players.includes(name)) {
                send(ws, { type: 'error', message: 'Unknown operative.' });
                return;
            }
            // Block if slot is already held by another live connection
            for (const [otherWs, otherName] of connections) {
                if (otherName === name && otherWs !== ws && otherWs.readyState === WebSocket.OPEN) {
                    send(ws, { type: 'error', message: 'Slot already taken by another connection.' });
                    return;
                }
            }
            connections.set(ws, name);
            setConnected.run(1, name);
            broadcastState();
            break;
        }

        case 'ready': {
            const name = connections.get(ws);
            if (!name) return;

            const { allConnected } = getLobbyState();
            if (!allConnected) {
                send(ws, { type: 'error', message: 'Not all players connected yet.' });
                return;
            }

            setReady.run(name);
            broadcastState();

            if (getLobbyState().allReady) {
                if (REVEAL_AFTER === null) {
                    const photoCount = totalPhotoCount() || 1;
                    const revealDelaySeconds = cfg.secsPerPhoto * photoCount;
                    REVEAL_AFTER = addSeconds(revealDelaySeconds);
                    broadcast({
                        type: 'revealAfter',
                        time: REVEAL_AFTER,
                        secsPerPhoto: cfg.secsPerPhoto,
                        photoCount,
                        revealDelaySeconds,
                    });
                }

                // Delay slightly for drama, then tell everyone what phase to enter
                setTimeout(() => {
                    broadcast({ type: isAfterReveal() ? 'start' : 'waiting' });
                    if (isAfterReveal()) {
                        // revert to null after a while to allow for new connections and testing without restart
                        setTimeout(() => { REVEAL_AFTER = null; }, 500);
                    }
                }, 1200);
            }
            break;
        }
        }
    });

    ws.on('close', () => {
        const name = connections.get(ws);
        if (name) {
            connections.delete(ws);
            if (![...connections.values()].includes(name)) {
                resetPlayer.run(name);
                broadcastState();
            }
        }
    });

    ws.on('error', (err) => console.error('WS:', err.message));
});

server.listen(PORT, () => {
    console.log(`Server ready: ${BASEURL}`);
    console.log('Player URLs:');
    for (const name of cfg.players) {
        console.log(`${BASEURL}?player=${name}`);
    }
});

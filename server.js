const express    = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const Database   = require('better-sqlite3');
const http       = require('http');
const path       = require('path');
const fs         = require('fs');

// ── CONFIG ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const { mapName, difficulty, players } = cfg;
const REVEAL_AFTER = cfg.revealAfter; // ISO 8601 datetime string

console.log(`Map: ${mapName} (${difficulty})`);
console.log(`Players: ${players.join(', ')}`);
console.log(`Reveal after: ${REVEAL_AFTER}`);
// ─────────────────────────────────────────────────────────────────────────────

// ── LOBBY ─────────────────────────────────────────────────────────────────────
const db = new Database(':memory:');
db.exec(`CREATE TABLE players (
  name TEXT PRIMARY KEY, connected INTEGER DEFAULT 0, ready INTEGER DEFAULT 0
)`);

const insert = db.prepare('INSERT INTO players (name) VALUES (?)');
for (const name of players) insert.run(name);

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

// Frontend fetches this to get lobby config on load
app.get('/config', (_req, res) => {
  res.json({ mapName, difficulty, players, revealAfter: REVEAL_AFTER });
});

// ── WEBSOCKET ─────────────────────────────────────────────────────────────────
const connections = new Map(); // ws → playerName

const send      = (ws, d) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(d));
const broadcast = (d)     => wss.clients.forEach(c => send(c, d));

function broadcastState() {
  broadcast({ type: 'state', ...getLobbyState() });
}

wss.on('connection', (ws, req) => {
  send(ws, { type: 'state', ...getLobbyState() });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {

      case 'identify': {
        const name = msg.name?.trim();
        if (!players.includes(name)) {
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
          // Delay slightly for drama, then tell everyone what phase to enter
          setTimeout(() => {
            broadcast({ type: isAfterReveal() ? 'start' : 'waiting' });
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

server.listen(PORT, () => console.log(`http://localhost:${PORT}`));

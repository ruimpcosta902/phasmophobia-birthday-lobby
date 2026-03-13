# Birthday Lobby

## File structure

```
config.json       ← THE only file you need to edit before deploying
server.js         ← Backend (do not edit)
package.json
public/
  index.html      ← Frontend (edit invite section only)
```

## 1. Edit config.json

```json
{
  "mapName": "Willow Street House",
  "difficulty": "Amateur",
  "revealAfter": "2025-06-14T00:00:00",
  "players": [
    "Alice",
    "Bob",
    "Charlie",
    "TheBirthdayPerson"
  ]
}
```

- `revealAfter` — ISO 8601 datetime. Invite is locked until this moment (checked server-side).
- `players` — exact list of names. Each person gets a unique link containing their name.

## 2. Edit the invite (public/index.html)

Search for `<!-- EDIT -->` comments and fill in the birthday person's name, date, time, and location.

## 3. Share links

Each person gets their own URL:

```
https://your-app.onrender.com/?player=Alice
https://your-app.onrender.com/?player=Bob
https://your-app.onrender.com/?player=TheBirthdayPerson
```

- Opening a link with an unknown name shows an error screen.
- Opening a link with no `?player=` param shows an error screen.

## Run locally

```bash
npm install
npm start        # or: npm run dev  (auto-restarts on save)
```

## Deploy on Render (free)

1. Push this folder to a GitHub repo
2. render.com → New Web Service → connect repo
3. Build command: `npm install`
4. Start command: `node server.js`
5. Instance type: Free

> Free tier sleeps after 15 min idle. Open the URL ~30s before guests arrive to wake it up.

## Flow

| Phase | Condition | What happens |
|---|---|---|
| Error | `?player=` missing or not in config | Error screen shown, nothing else loads |
| Lobby | Player visits their link | Auto-joins, sees who else is connected |
| Waiting | All ready, before `revealAfter` | "Game unavailable" screen + live countdown |
| Reveal | Countdown hits zero OR all ready after `revealAfter` | Invite appears on every screen simultaneously |

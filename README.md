# Word Rush v1.9

Solo runs by opening index.html. Online requires the included Node.js server.

## Deploy to Render
1. Put index.html, server.js and package.json in a GitHub repository (same folder).
2. Create a Render Web Service from the repository (not a Static Site).
3. Runtime: Node. Build command: `npm install`. Start command: `npm start`.
4. Open the service URL. Public rooms appear in the multiplayer browser; private rooms require the six-character code. The host starts when at least two players join.

## Local test
Run `npm start` in this folder and open http://localhost:3000 in two different browser tabs. Each tab is a separate player.

Rooms are held in server memory, so they disappear when the server restarts. Use one server instance. No database required. Solo high scores and names remain on each device.

The host can remove another player from the waiting lobby using the X button. Kicked players return to the room browser. This is a kick, not a permanent ban.

Choose an animal profile picture using the pencil on the home screen. The preset is saved locally and shared with the lobby and match through the server.

Avatar backgrounds: select a preset or custom color using the home screen pencil. The color is saved locally and synchronized when joining or creating a room.

Player names are checked in the home and setup screens and by the multiplayer server. The filter catches common offensive terms and some spelling variations; it is not exhaustive. Invalid names are not saved.

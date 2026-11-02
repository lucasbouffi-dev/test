# Anubis Character Relay

Small, in-memory WebSocket relay for bundled Anubis character choices.

The relay forwards only a room hash, Minecraft player UUID, and allowlisted
built-in character ID. It does not store messages or transfer model files.

## Deploy on Render

1. Upload the files in this folder to the root of a new GitHub repository.
2. In Render, choose **New → Blueprint**, select that repository, and deploy
   the `render.yaml` blueprint.
3. Use the resulting service URL with `wss://<service-name>.onrender.com/ws`.
4. Open `https://<service-name>.onrender.com/health` to verify the service.

## Client protocol

Connect to `/ws`, then send:

```json
{"type":"join","room":"64-character-lowercase-hex-room-hash","player":"minecraft-player-uuid"}
```

The server replies with `joined` and the current `players` snapshot. Then send:

```json
{"type":"character","character":"sakura"}
```

Valid bundled IDs are `sakura`, `luna`, `mika`, `aoi`, `miku`, `cj`,
`neighbor`, `kim_jong_un`, `hitler`, `tung_tung_sahur`, and `tralalero`.

The client should hash the normalized multiplayer server address with SHA-256
before using it as the room ID. It should send `character` when the selected
model changes and handle `character` and `player_left` messages from the relay.

## Important

The model files are packaged in the compatible Anubis mod; this service sends
only their IDs and never uploads or distributes model files.

In the mod's **3D Character** settings, enable **Share Character** and set
**Relay URL** to `wss://anubis-character-relay.onrender.com/ws`. Each player needs the same
mod version containing the bundled character assets.

This relay is intentionally unauthenticated and is suitable only for testing a
cosmetic feature. A client can claim another player's UUID. Do not use it as
proof of identity or for permissions.

Render's free service may sleep when idle, so the first connection after a
period of inactivity can take time.

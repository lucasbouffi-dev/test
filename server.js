"use strict";

const http = require("node:http");
const { WebSocket, WebSocketServer } = require("ws");

const PORT = Number.parseInt(process.env.PORT ?? "10000", 10);
const MAX_CLIENTS = 1000;
const MAX_PLAYERS_PER_ROOM = 100;
const MAX_MESSAGES_PER_SECOND = 30;
const HEARTBEAT_MS = 30_000;
const CHARACTER_IDS = new Set([
  "sakura",
  "luna",
  "mika",
  "aoi",
  "miku",
  "cj",
  "neighbor",
  "kim_jong_un",
  "hitler",
  "tung_tung_sahur",
  "tralalero",
]);
const rooms = new Map();
const clients = new Set();

const server = http.createServer((request, response) => {
  if (request.method === "GET" && (request.url === "/" || request.url === "/health")) {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ service: "anubis-character-relay", status: "ok" }));
    return;
  }

  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

const webSockets = new WebSocketServer({
  noServer: true,
  maxPayload: 4096,
  perMessageDeflate: false,
});

server.on("upgrade", (request, socket, head) => {
  let pathname;
  try {
    pathname = new URL(request.url, "http://localhost").pathname;
  } catch {
    socket.destroy();
    return;
  }

  if (pathname !== "/ws") {
    socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  webSockets.handleUpgrade(request, socket, head, (webSocket) => {
    webSockets.emit("connection", webSocket, request);
  });
});

webSockets.on("connection", (webSocket) => {
  if (clients.size >= MAX_CLIENTS) {
    webSocket.close(1013, "Relay is full");
    return;
  }

  webSocket.isAlive = true;
  webSocket.messageWindowStarted = Date.now();
  webSocket.messageCount = 0;
  webSocket.roomId = null;
  webSocket.playerId = null;
  webSocket.characterId = null;
  clients.add(webSocket);

  webSocket.on("pong", () => {
    webSocket.isAlive = true;
  });

  webSocket.on("message", (data, isBinary) => {
    if (isBinary) {
      webSocket.close(1003, "Text messages only");
      return;
    }

    const now = Date.now();
    if (now - webSocket.messageWindowStarted >= 1000) {
      webSocket.messageWindowStarted = now;
      webSocket.messageCount = 0;
    }
    if (++webSocket.messageCount > MAX_MESSAGES_PER_SECOND) {
      webSocket.close(1008, "Rate limit exceeded");
      return;
    }

    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      send(webSocket, { type: "error", reason: "invalid_json" });
      return;
    }

    if (webSocket.roomId === null) {
      joinRoom(webSocket, message);
      return;
    }

    if (!isRecord(message) || message.type !== "character" || !CHARACTER_IDS.has(message.character)) {
      send(webSocket, { type: "error", reason: "invalid_message" });
      return;
    }

    webSocket.characterId = message.character;
    broadcast(webSocket.roomId, {
      type: "character",
      player: webSocket.playerId,
      character: webSocket.characterId,
    }, webSocket);
  });

  webSocket.on("close", () => leaveRoom(webSocket));
  webSocket.on("error", () => leaveRoom(webSocket));
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function joinRoom(webSocket, message) {
  if (
    !isRecord(message)
    || message.type !== "join"
    || typeof message.room !== "string"
    || !/^[a-f0-9]{64}$/.test(message.room)
    || typeof message.player !== "string"
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(message.player)
  ) {
    send(webSocket, { type: "error", reason: "invalid_join" });
    webSocket.close(1008, "Invalid join");
    return;
  }

  const playerId = message.player.toLowerCase();
  let room = rooms.get(message.room);
  if (room && !room.has(playerId) && room.size >= MAX_PLAYERS_PER_ROOM) {
    webSocket.close(1013, "Room is full");
    return;
  }

  if (!room) {
    room = new Map();
    rooms.set(message.room, room);
  }

  const previous = room.get(playerId);
  if (previous && previous !== webSocket) {
    previous.roomId = null;
    previous.playerId = null;
    previous.close(4001, "Replaced by a newer connection");
  }

  webSocket.roomId = message.room;
  webSocket.playerId = playerId;
  room.set(webSocket.playerId, webSocket);

  const players = [];
  for (const [playerId, peer] of room) {
    if (peer !== webSocket && peer.characterId !== null) {
      players.push({ player: playerId, character: peer.characterId });
    }
  }
  send(webSocket, { type: "joined", players });
  broadcast(message.room, { type: "player_joined", player: webSocket.playerId }, webSocket);
}

function leaveRoom(webSocket) {
  clients.delete(webSocket);
  if (webSocket.roomId === null || webSocket.playerId === null) {
    return;
  }

  const { roomId, playerId } = webSocket;
  webSocket.roomId = null;
  webSocket.playerId = null;
  const room = rooms.get(roomId);
  if (!room || room.get(playerId) !== webSocket) {
    return;
  }

  room.delete(playerId);
  broadcast(roomId, { type: "player_left", player: playerId });
  if (room.size === 0) {
    rooms.delete(roomId);
  }
}

function broadcast(roomId, message, except = null) {
  const room = rooms.get(roomId);
  if (!room) {
    return;
  }

  const payload = JSON.stringify(message);
  for (const peer of room.values()) {
    if (peer !== except && peer.readyState === WebSocket.OPEN) {
      peer.send(payload);
    }
  }
}

function send(webSocket, message) {
  if (webSocket.readyState === WebSocket.OPEN) {
    webSocket.send(JSON.stringify(message));
  }
}

const heartbeat = setInterval(() => {
  for (const webSocket of clients) {
    if (!webSocket.isAlive) {
      webSocket.terminate();
      continue;
    }
    webSocket.isAlive = false;
    webSocket.ping();
  }
}, HEARTBEAT_MS);

server.listen(PORT, "0.0.0.0");

function shutdown() {
  clearInterval(heartbeat);
  for (const webSocket of clients) {
    webSocket.close(1001, "Relay shutting down");
  }
  webSockets.close();
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

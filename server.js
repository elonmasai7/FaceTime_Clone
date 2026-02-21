const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const { ExpressPeerServer } = require('peer');

const MAX_PARTICIPANTS = 8;

function createFaceTimeServer(options = {}) {
  const app = express();
  const rooms = new Map();
  const requestedPort = Number(options.port || process.env.PORT || 3000);
  const useSsl = Boolean(options.ssl || (process.env.SSL_KEY_PATH && process.env.SSL_CERT_PATH));
  const host = options.host || process.env.HOST || '127.0.0.1';

  function createRoomId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = '';
    for (let i = 0; i < 6; i += 1) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  function normalizeRoomId(raw) {
    return String(raw || '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 12);
  }

  function getRoomMode(room) {
    if (!room) {
      return 'mesh';
    }
    return room.members.size < 4 ? 'mesh' : 'sfu-fallback';
  }

  function serializeParticipants(room) {
    return [...room.members].map((socketId) => room.participants.get(socketId));
  }

  function ensureRoom(roomId) {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, {
        id: roomId,
        createdAt: Date.now(),
        members: new Set(),
        participants: new Map()
      });
    }
    return rooms.get(roomId);
  }

  function cleanupRoomIfEmpty(roomId) {
    const room = rooms.get(roomId);
    if (room && room.members.size === 0) {
      rooms.delete(roomId);
    }
  }

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // Serve PeerJS client locally so the desktop app works without external CDNs.
  app.get('/vendor/peerjs.min.js', (_req, res) => {
    try {
      res.sendFile(require.resolve('peerjs/dist/peerjs.min.js'));
    } catch (_error) {
      res.redirect('https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js');
    }
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size, uptime: process.uptime() });
  });

  app.post('/api/rooms', (_req, res) => {
    let roomId = createRoomId();
    while (rooms.has(roomId)) {
      roomId = createRoomId();
    }
    ensureRoom(roomId);
    res.status(201).json({ roomId });
  });

  app.get('/api/rooms/:roomId', (req, res) => {
    const roomId = normalizeRoomId(req.params.roomId);
    if (!roomId) {
      return res.status(400).json({ error: 'Invalid room id' });
    }
    const room = rooms.get(roomId);
    return res.json({
      exists: Boolean(room),
      roomId,
      participants: room ? room.members.size : 0,
      capacity: MAX_PARTICIPANTS,
      mode: getRoomMode(room)
    });
  });

  function createServer() {
    const keyPath = options.sslKeyPath || process.env.SSL_KEY_PATH;
    const certPath = options.sslCertPath || process.env.SSL_CERT_PATH;

    if (useSsl) {
      if (!keyPath || !certPath || !fs.existsSync(keyPath) || !fs.existsSync(certPath)) {
        throw new Error('SSL enabled but key/cert file not found');
      }
      const tlsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
      };
      return https.createServer(tlsOptions, app);
    }
    return http.createServer(app);
  }

  const server = createServer();
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  const peerServer = ExpressPeerServer(server, {
    path: '/',
    allow_discovery: false,
    proxied: true,
    debug: false
  });

  app.use('/peerjs', peerServer);

  io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId: rawRoomId, peerId, displayName }) => {
    const roomId = normalizeRoomId(rawRoomId);
    const cleanPeerId = String(peerId || '').trim();
    const cleanName = String(displayName || 'Guest').trim().slice(0, 30) || 'Guest';

    if (!roomId || !cleanPeerId) {
      socket.emit('join-error', { message: 'Invalid room or peer id.' });
      return;
    }

    const room = ensureRoom(roomId);
    if (room.members.size >= MAX_PARTICIPANTS) {
      socket.emit('join-error', { message: 'Room is full (8 participants max).' });
      return;
    }

    room.members.add(socket.id);
    const participant = {
      socketId: socket.id,
      peerId: cleanPeerId,
      displayName: cleanName,
      joinedAt: Date.now(),
      mediaState: {
        micEnabled: true,
        camEnabled: true,
        screenSharing: false
      }
    };

    room.participants.set(socket.id, participant);

    socket.data.roomId = roomId;
    socket.data.peerId = cleanPeerId;
    socket.data.displayName = cleanName;

    socket.join(roomId);

    const participants = serializeParticipants(room);
    const mode = getRoomMode(room);

    socket.emit('room-state', {
      roomId,
      mode,
      maxParticipants: MAX_PARTICIPANTS,
      participants
    });

    socket.to(roomId).emit('peer-joined', {
      participant,
      mode
    });

    io.to(roomId).emit('participants-updated', {
      participants,
      mode
    });
  });

  socket.on('media-state-changed', ({ roomId: rawRoomId, mediaState }) => {
    const roomId = normalizeRoomId(rawRoomId);
    const room = rooms.get(roomId);
    if (!room || !room.participants.has(socket.id)) {
      return;
    }

    const participant = room.participants.get(socket.id);
    participant.mediaState = {
      ...participant.mediaState,
      ...mediaState
    };

    socket.to(roomId).emit('peer-media-updated', {
      socketId: socket.id,
      peerId: participant.peerId,
      mediaState: participant.mediaState
    });
  });

  socket.on('active-speaker', ({ roomId: rawRoomId, peerId }) => {
    const roomId = normalizeRoomId(rawRoomId);
    if (!rooms.has(roomId)) {
      return;
    }
    socket.to(roomId).emit('active-speaker', { peerId });
  });

  socket.on('chat-event', ({ roomId: rawRoomId, type, message }) => {
    const roomId = normalizeRoomId(rawRoomId);
    const room = rooms.get(roomId);
    if (!room || !room.participants.has(socket.id)) {
      return;
    }

    socket.to(roomId).emit('chat-event', {
      type,
      message,
      peerId: socket.data.peerId,
      displayName: socket.data.displayName,
      at: Date.now()
    });
  });

  socket.on('leave-room', ({ roomId: rawRoomId }) => {
    const roomId = normalizeRoomId(rawRoomId || socket.data.roomId);
    const room = rooms.get(roomId);
    if (!room) {
      return;
    }

    room.members.delete(socket.id);
    const participant = room.participants.get(socket.id);
    room.participants.delete(socket.id);
    socket.leave(roomId);

    const mode = getRoomMode(room);
    socket.to(roomId).emit('peer-left', {
      socketId: socket.id,
      peerId: participant ? participant.peerId : socket.data.peerId,
      mode
    });

    io.to(roomId).emit('participants-updated', {
      participants: serializeParticipants(room),
      mode
    });

    cleanupRoomIfEmpty(roomId);
  });

  socket.on('disconnect', () => {
    const roomId = normalizeRoomId(socket.data.roomId);
    if (!roomId || !rooms.has(roomId)) {
      return;
    }

    const room = rooms.get(roomId);
    room.members.delete(socket.id);
    const participant = room.participants.get(socket.id);
    room.participants.delete(socket.id);

    const mode = getRoomMode(room);
    socket.to(roomId).emit('peer-left', {
      socketId: socket.id,
      peerId: participant ? participant.peerId : socket.data.peerId,
      mode
    });

    io.to(roomId).emit('participants-updated', {
      participants: serializeParticipants(room),
      mode
    });

    cleanupRoomIfEmpty(roomId);
  });
  });

  function start() {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(requestedPort, host, () => {
        server.removeListener('error', reject);
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : requestedPort;
        const protocol = useSsl ? 'https' : 'http';
        resolve({
          protocol,
          host,
          port,
          url: `${protocol}://127.0.0.1:${port}`
        });
      });
    });
  }

  function stop() {
    return new Promise((resolve, reject) => {
      io.removeAllListeners();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  return { app, server, io, start, stop };
}

if (require.main === module) {
  const facetime = createFaceTimeServer();
  facetime
    .start()
    .then((info) => {
      console.log(`FaceTime clone server running on ${info.url}`);
    })
    .catch((error) => {
      console.error('Failed to start server:', error);
      process.exit(1);
    });
}

module.exports = { createFaceTimeServer };

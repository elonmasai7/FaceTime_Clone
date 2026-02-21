const socket = io();

const url = new URL(window.location.href);
const roomId = String(url.searchParams.get('room') || '').trim().toUpperCase();
const displayName = String(url.searchParams.get('name') || 'Guest').trim().slice(0, 30) || 'Guest';

const roomLabel = document.getElementById('roomLabel');
const modeLabel = document.getElementById('modeLabel');
const videoGrid = document.getElementById('videoGrid');
const participantsPanel = document.getElementById('participantsPanel');
const participantsList = document.getElementById('participantsList');
const toastContainer = document.getElementById('toastContainer');

const micBtn = document.getElementById('micBtn');
const camBtn = document.getElementById('camBtn');
const flipBtn = document.getElementById('flipBtn');
const shareBtn = document.getElementById('shareBtn');
const leaveBtn = document.getElementById('leaveBtn');
const participantsBtn = document.getElementById('participantsBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const copyLinkBtn = document.getElementById('copyLinkBtn');

if (!roomId) {
  window.location.href = '/';
}

roomLabel.textContent = `Room ${roomId}`;

const PEER_CONFIG = {
  host: window.location.hostname,
  port: Number(window.location.port || (window.location.protocol === 'https:' ? 443 : 80)),
  path: '/peerjs',
  secure: window.location.protocol === 'https:',
  config: {
    iceTransportPolicy: 'all',
    sdpSemantics: 'unified-plan',
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478?transport=udp' },
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ]
  }
};

const peer = new Peer(undefined, PEER_CONFIG);
const calls = new Map();
const participantState = new Map();

let localStream;
let localTile;
let screenStream;
let currentMode = 'mesh';
let localPeerId = '';
let reconnectAttempts = new Map();
let currentFacingMode = 'user';
const speakerMonitors = new Map();

const mediaState = {
  micEnabled: true,
  camEnabled: true,
  screenSharing: false
};

function showToast(message) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = message;
  toastContainer.appendChild(node);
  setTimeout(() => node.remove(), 2800);
}

function requestNotificationPermission() {
  if (window.Notification && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {
      // Ignore permission errors; app still works with toasts.
    });
  }
}

function notify(message) {
  showToast(message);
  if (window.Notification && Notification.permission === 'granted') {
    new Notification('FaceTime Clone', { body: message });
  }
}

function updateModeLabel(mode) {
  currentMode = mode;
  modeLabel.textContent =
    mode === 'mesh'
      ? 'Mode: Mesh (Low latency P2P)'
      : 'Mode: SFU Fallback Policy (Constrained mesh for 4+)';
}

function createVideoTile({ peerId, name, stream, muted = false, isLocal = false }) {
  const tile = document.createElement('article');
  tile.className = 'video-tile';
  tile.dataset.peerId = peerId;

  const video = document.createElement('video');
  video.playsInline = true;
  video.autoplay = true;
  video.muted = muted;
  video.srcObject = stream;

  const badge = document.createElement('div');
  badge.className = 'video-badge';

  const nameNode = document.createElement('span');
  nameNode.textContent = isLocal ? `${name} (You)` : name;

  const badges = document.createElement('span');
  badges.className = 'badges';
  badges.textContent = '🔒 DTLS/SRTP';

  badge.appendChild(nameNode);
  badge.appendChild(badges);

  tile.appendChild(video);
  tile.appendChild(badge);
  videoGrid.appendChild(tile);

  return { tile, video, badge: badges };
}

function removeTile(peerId) {
  const tile = videoGrid.querySelector(`.video-tile[data-peer-id="${CSS.escape(peerId)}"]`);
  if (tile) {
    tile.remove();
  }
}

function updateTileBadges(peerId) {
  const state = participantState.get(peerId);
  const tile = videoGrid.querySelector(`.video-tile[data-peer-id="${CSS.escape(peerId)}"]`);
  if (!tile) {
    return;
  }
  const badge = tile.querySelector('.badges');
  if (!badge) {
    return;
  }

  const chunks = ['🔒 DTLS/SRTP'];
  if (state && !state.mediaState.micEnabled) {
    chunks.push('🎤 Off');
  }
  if (state && !state.mediaState.camEnabled) {
    chunks.push('📷 Off');
  }
  if (state && state.mediaState.screenSharing) {
    chunks.push('🖥 Sharing');
  }

  badge.textContent = chunks.join(' | ');
}

function updateParticipantsUI() {
  participantsList.innerHTML = '';
  const participants = [...participantState.values()].sort((a, b) => a.joinedAt - b.joinedAt);

  participants.forEach((participant) => {
    const item = document.createElement('li');
    const { mediaState: ms } = participant;
    const flags = [];
    if (!ms.micEnabled) flags.push('mic off');
    if (!ms.camEnabled) flags.push('cam off');
    if (ms.screenSharing) flags.push('sharing');
    const suffix = flags.length ? ` (${flags.join(', ')})` : '';
    item.textContent = `${participant.displayName}${participant.peerId === localPeerId ? ' (You)' : ''}${suffix}`;
    participantsList.appendChild(item);
  });
}

function emitMediaState() {
  socket.emit('media-state-changed', {
    roomId,
    mediaState
  });
}

function setMicState(enabled) {
  if (!localStream) {
    return;
  }
  localStream.getAudioTracks().forEach((track) => {
    track.enabled = enabled;
  });
  mediaState.micEnabled = enabled;
  micBtn.classList.toggle('off', !enabled);
  micBtn.textContent = enabled ? 'Mute Mic' : 'Unmute Mic';
  emitMediaState();
}

function setCamState(enabled) {
  if (!localStream) {
    return;
  }
  localStream.getVideoTracks().forEach((track) => {
    track.enabled = enabled;
  });
  mediaState.camEnabled = enabled;
  camBtn.classList.toggle('off', !enabled);
  camBtn.textContent = enabled ? 'Stop Camera' : 'Start Camera';
  emitMediaState();
}

function buildOutboundStream(targetPeerId) {
  if (!localStream) {
    return null;
  }

  if (currentMode === 'mesh') {
    return localStream;
  }

  // In constrained mode, keep full video for up to 3 peers and audio-only for others.
  const peerIds = [...calls.keys(), targetPeerId].filter(Boolean);
  const uniquePeerIds = [...new Set(peerIds)].sort();
  const allowedVideoPeers = new Set(uniquePeerIds.slice(0, 3));

  if (allowedVideoPeers.has(targetPeerId)) {
    return localStream;
  }

  return new MediaStream(localStream.getAudioTracks());
}

function applyOutboundPolicy() {
  calls.forEach((entry, peerId) => {
    const call = entry.call;
    const pc = call.peerConnection;
    if (!pc) {
      return;
    }

    const outbound = buildOutboundStream(peerId);
    const nextVideoTrack = outbound.getVideoTracks()[0] || null;

    const sender = pc
      .getSenders()
      .find((s) => s.track && s.track.kind === 'video');

    if (sender) {
      sender.replaceTrack(nextVideoTrack).catch(() => {
        // Ignore replacement failures; renegotiation handled by reconnect logic.
      });
    }
  });
}

function preferVP8Codec(peerConnection) {
  if (!peerConnection || !window.RTCRtpSender || !RTCRtpSender.getCapabilities) {
    return;
  }
  const videoCaps = RTCRtpSender.getCapabilities('video');
  if (!videoCaps || !videoCaps.codecs) {
    return;
  }
  const vp8 = videoCaps.codecs.find((c) => (c.mimeType || '').toLowerCase() === 'video/vp8');
  if (!vp8) {
    return;
  }
  const others = videoCaps.codecs.filter((c) => c !== vp8);
  peerConnection.getTransceivers().forEach((t) => {
    if (t.sender && t.sender.track && t.sender.track.kind === 'video' && t.setCodecPreferences) {
      t.setCodecPreferences([vp8, ...others]);
    }
  });
}

function attachRemoteStream(peerId, stream) {
  const existing = calls.get(peerId);
  if (existing && existing.tile) {
    existing.video.srcObject = stream;
    return;
  }

  const state = participantState.get(peerId) || {
    peerId,
    displayName: 'Participant',
    mediaState: { micEnabled: true, camEnabled: true, screenSharing: false }
  };

  const tile = createVideoTile({
    peerId,
    name: state.displayName,
    stream,
    muted: false,
    isLocal: false
  });

  calls.set(peerId, {
    ...existing,
    ...tile,
    stream,
    retries: reconnectAttempts.get(peerId) || 0
  });

  updateTileBadges(peerId);
  setupAudioLevelMonitor(peerId, stream);
}

function cleanupCall(peerId) {
  const entry = calls.get(peerId);
  if (!entry) {
    return;
  }
  try {
    if (entry.call && entry.call.open) {
      entry.call.close();
    }
  } catch (error) {
    console.error('close call error', error);
  }

  removeTile(peerId);
  calls.delete(peerId);
  if (speakerMonitors.has(peerId)) {
    clearInterval(speakerMonitors.get(peerId));
    speakerMonitors.delete(peerId);
  }
}

function scheduleReconnect(peerId) {
  const retries = reconnectAttempts.get(peerId) || 0;
  if (retries >= 2 || !participantState.has(peerId)) {
    return;
  }
  reconnectAttempts.set(peerId, retries + 1);

  setTimeout(() => {
    const participant = participantState.get(peerId);
    if (!participant) {
      return;
    }
    connectToPeer(participant);
  }, 1200 * (retries + 1));
}

function connectToPeer(participant) {
  if (!participant || participant.peerId === localPeerId || calls.has(participant.peerId)) {
    return;
  }

  const outboundStream = buildOutboundStream(participant.peerId);
  if (!outboundStream) {
    return;
  }

  const call = peer.call(participant.peerId, outboundStream, {
    metadata: { displayName }
  });

  if (!call) {
    return;
  }

  calls.set(participant.peerId, {
    call,
    retries: reconnectAttempts.get(participant.peerId) || 0
  });
  preferVP8Codec(call.peerConnection);

  call.on('stream', (remoteStream) => {
    attachRemoteStream(participant.peerId, remoteStream);
  });

  call.on('close', () => {
    cleanupCall(participant.peerId);
  });

  call.on('error', () => {
    cleanupCall(participant.peerId);
    scheduleReconnect(participant.peerId);
  });
}

function handleIncomingCall(call) {
  const inboundPeerId = call.peer;
  const outboundStream = buildOutboundStream(inboundPeerId);
  call.answer(outboundStream);

  calls.set(inboundPeerId, {
    call,
    retries: reconnectAttempts.get(inboundPeerId) || 0
  });
  preferVP8Codec(call.peerConnection);

  call.on('stream', (remoteStream) => {
    attachRemoteStream(inboundPeerId, remoteStream);
  });

  call.on('close', () => {
    cleanupCall(inboundPeerId);
  });

  call.on('error', () => {
    cleanupCall(inboundPeerId);
    scheduleReconnect(inboundPeerId);
  });
}

function setParticipants(participants) {
  participants.forEach((participant) => {
    participantState.set(participant.peerId, participant);
  });

  [...participantState.keys()].forEach((peerId) => {
    if (!participants.find((p) => p.peerId === peerId)) {
      participantState.delete(peerId);
    }
  });

  updateParticipantsUI();
  [...participantState.keys()].forEach((peerId) => updateTileBadges(peerId));
}

async function setupLocalMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: {
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        frameRate: { ideal: 24, max: 30 }
      }
    });

    localTile = createVideoTile({
      peerId: 'local',
      name: displayName,
      stream: localStream,
      muted: true,
      isLocal: true
    });
  } catch (error) {
    console.error('media error', error);
    const audioOnly = window.confirm(
      'Camera/mic unavailable. Join audio-only mode? Click Cancel to return home.'
    );

    if (!audioOnly) {
      window.location.href = '/';
      return;
    }

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localTile = createVideoTile({
      peerId: 'local',
      name: displayName,
      stream: localStream,
      muted: true,
      isLocal: true
    });
    mediaState.camEnabled = false;
    camBtn.classList.add('off');
    camBtn.textContent = 'Start Camera';
  }
}

async function toggleScreenShare() {
  if (screenStream) {
    stopScreenShare();
    return;
  }

  try {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 15
        },
        audio: false
      });
    } catch (primaryError) {
      // Electron fallback path when browser-level getDisplayMedia is blocked.
      if (window.desktopApp && typeof window.desktopApp.getScreenSource === 'function') {
        const sourceInfo = await window.desktopApp.getScreenSource();
        if (!sourceInfo || !sourceInfo.ok || !sourceInfo.sourceId) {
          throw primaryError;
        }
        screenStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: sourceInfo.sourceId,
              maxWidth: 1920,
              maxHeight: 1080,
              maxFrameRate: 15
            }
          }
        });
      } else {
        throw primaryError;
      }
    }

    const track = screenStream.getVideoTracks()[0];
    if (!track) {
      return;
    }

    mediaState.screenSharing = true;
    shareBtn.classList.add('off');
    shareBtn.textContent = 'Stop Sharing';
    emitMediaState();

    if (localTile && localTile.video) {
      localTile.video.srcObject = screenStream;
    }

    calls.forEach((entry) => {
      const sender = entry.call.peerConnection
        ?.getSenders()
        .find((s) => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(track).catch(() => {
          // Ignore failures; fallback to renegotiation via reconnect if needed.
        });
      }
    });

    track.onended = () => {
      stopScreenShare();
    };
  } catch (error) {
    console.error('share error', error);
    showToast('Screen sharing failed or was blocked.');
  }
}

function stopScreenShare() {
  if (!screenStream) {
    return;
  }

  screenStream.getTracks().forEach((t) => t.stop());
  screenStream = null;

  mediaState.screenSharing = false;
  shareBtn.classList.remove('off');
  shareBtn.textContent = 'Share Screen';
  emitMediaState();

  if (localTile && localTile.video) {
    localTile.video.srcObject = localStream;
  }

  applyOutboundPolicy();
}

let audioContext;

function setupAudioLevelMonitor(peerId, stream) {
  if (!stream.getAudioTracks().length) {
    return;
  }

  if (!audioContext) {
    audioContext = new AudioContext();
  }

  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  if (speakerMonitors.has(peerId)) {
    clearInterval(speakerMonitors.get(peerId));
  }

  const sample = () => {
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      sum += data[i];
    }
    const avg = sum / data.length;
    if (avg > 32) {
      socket.emit('active-speaker', { roomId, peerId });
    }
  };

  const interval = setInterval(sample, 650);
  speakerMonitors.set(peerId, interval);
}

async function switchCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || screenStream) {
    showToast('Cannot flip camera while sharing screen.');
    return;
  }

  const nextFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  try {
    const fresh = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        frameRate: { ideal: 24, max: 30 },
        facingMode: { ideal: nextFacingMode }
      }
    });
    const nextVideoTrack = fresh.getVideoTracks()[0];
    if (!nextVideoTrack) {
      throw new Error('No replacement track');
    }

    const oldVideoTracks = localStream.getVideoTracks();
    oldVideoTracks.forEach((t) => {
      localStream.removeTrack(t);
      t.stop();
    });
    localStream.addTrack(nextVideoTrack);
    nextVideoTrack.enabled = mediaState.camEnabled;
    currentFacingMode = nextFacingMode;

    if (localTile && localTile.video) {
      localTile.video.srcObject = localStream;
    }
    applyOutboundPolicy();
    showToast(`Camera switched to ${nextFacingMode === 'user' ? 'front' : 'rear'} mode.`);
  } catch (_error) {
    showToast('Camera flip unavailable on this device/browser.');
  }
}

socket.on('room-state', ({ participants, mode, maxParticipants }) => {
  updateModeLabel(mode);
  setParticipants(participants);

  const self = participants.find((p) => p.peerId === localPeerId);
  if (self) {
    participantState.set(localPeerId, self);
    updateParticipantsUI();
  }

  if (participants.length >= maxParticipants) {
    notify('Room reached capacity.');
  }

  participants
    .filter((p) => p.peerId !== localPeerId)
    .forEach((participant) => connectToPeer(participant));
});

socket.on('participants-updated', ({ participants, mode }) => {
  updateModeLabel(mode);
  setParticipants(participants);
  applyOutboundPolicy();
});

socket.on('peer-joined', ({ participant, mode }) => {
  participantState.set(participant.peerId, participant);
  updateParticipantsUI();
  updateModeLabel(mode);
  notify(`${participant.displayName} joined`);
  connectToPeer(participant);
  applyOutboundPolicy();
});

socket.on('peer-left', ({ peerId, mode }) => {
  updateModeLabel(mode);
  const participant = participantState.get(peerId);
  if (participant) {
    notify(`${participant.displayName} left`);
  }
  participantState.delete(peerId);
  cleanupCall(peerId);
  updateParticipantsUI();
  applyOutboundPolicy();
});

socket.on('peer-media-updated', ({ peerId, mediaState: updatedState }) => {
  const participant = participantState.get(peerId);
  if (!participant) {
    return;
  }
  participant.mediaState = {
    ...participant.mediaState,
    ...updatedState
  };
  participantState.set(peerId, participant);
  updateParticipantsUI();
  updateTileBadges(peerId);
});

socket.on('active-speaker', ({ peerId }) => {
  [...videoGrid.querySelectorAll('.video-tile')].forEach((tile) => {
    tile.classList.toggle('active-speaker', tile.dataset.peerId === peerId);
  });
});

socket.on('join-error', ({ message }) => {
  alert(message || 'Unable to join this room.');
  window.location.href = '/';
});

peer.on('open', (id) => {
  localPeerId = id;
  participantState.set(id, {
    peerId: id,
    displayName,
    joinedAt: Date.now(),
    mediaState: { ...mediaState }
  });
  updateParticipantsUI();

  socket.emit('join-room', {
    roomId,
    peerId: id,
    displayName
  });
});

peer.on('call', handleIncomingCall);

peer.on('error', (error) => {
  console.error('peer error', error);
  notify('Connection hiccup detected. Retrying...');
});

peer.on('disconnected', () => {
  notify('Peer connection lost. Reconnecting...');
  peer.reconnect();
});

peer.on('close', () => {
  notify('Connection closed.');
});

function leaveCall() {
  socket.emit('leave-room', { roomId });
  calls.forEach((entry) => {
    if (entry.call) {
      entry.call.close();
    }
  });
  calls.clear();

  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
  }

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
  }

  if (peer && !peer.destroyed) {
    peer.destroy();
  }

  window.location.href = '/';
}

function attachControls() {
  micBtn.addEventListener('click', () => {
    setMicState(!mediaState.micEnabled);
  });

  camBtn.addEventListener('click', () => {
    setCamState(!mediaState.camEnabled);
  });

  shareBtn.addEventListener('click', toggleScreenShare);
  flipBtn.addEventListener('click', switchCamera);

  leaveBtn.addEventListener('click', leaveCall);

  participantsBtn.addEventListener('click', () => {
    participantsPanel.classList.toggle('open');
  });

  fullscreenBtn.addEventListener('click', async () => {
    if (window.desktopApp && typeof window.desktopApp.toggleFullscreen === 'function') {
      const state = await window.desktopApp.toggleFullscreen();
      if (!state || !state.ok) {
        showToast('Fullscreen failed.');
      }
      return;
    }

    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen().catch(() => {
        showToast('Fullscreen blocked by browser.');
      });
      return;
    }
    await document.exitFullscreen().catch(() => {
      // noop
    });
  });

  copyLinkBtn.addEventListener('click', async () => {
    const link = `${window.location.origin}/call.html?room=${encodeURIComponent(roomId)}`;
    try {
      await navigator.clipboard.writeText(link);
      showToast('Invite link copied.');
    } catch (error) {
      showToast(`Copy failed. Link: ${link}`);
    }
  });

  window.addEventListener('beforeunload', () => {
    socket.emit('leave-room', { roomId });
  });
}

async function start() {
  requestNotificationPermission();
  attachControls();
  await setupLocalMedia();
  emitMediaState();
}

start().catch((error) => {
  console.error(error);
  alert('Could not start call. Check camera/mic permissions and reload.');
  window.location.href = '/';
});

const statusEl = document.getElementById('status');
const displayNameEl = document.getElementById('displayName');
const roomInputEl = document.getElementById('roomInput');
const createRoomBtn = document.getElementById('createRoomBtn');
const joinRoomBtn = document.getElementById('joinRoomBtn');

function normalizeRoomId(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b43b3b' : '#176537';
}

function getDisplayName() {
  const name = String(displayNameEl.value || '').trim().slice(0, 30);
  return name || 'Guest';
}

function routeToRoom(roomId) {
  const params = new URLSearchParams({
    room: roomId,
    name: getDisplayName()
  });
  window.location.href = `/call.html?${params.toString()}`;
}

async function createRoom() {
  try {
    createRoomBtn.disabled = true;
    setStatus('Creating room...');

    const res = await fetch('/api/rooms', {
      method: 'POST'
    });

    if (!res.ok) {
      throw new Error('Could not create room');
    }

    const data = await res.json();
    routeToRoom(data.roomId);
  } catch (error) {
    setStatus(error.message || 'Failed to create room', true);
  } finally {
    createRoomBtn.disabled = false;
  }
}

async function joinRoom() {
  const roomId = normalizeRoomId(roomInputEl.value);
  if (!roomId) {
    setStatus('Enter a valid room code.', true);
    return;
  }

  try {
    joinRoomBtn.disabled = true;
    setStatus('Validating room...');

    const res = await fetch(`/api/rooms/${roomId}`);
    if (!res.ok) {
      throw new Error('Room validation failed');
    }

    const data = await res.json();
    if (!data.exists) {
      setStatus('Room does not exist yet. Ask host to create it first.', true);
      return;
    }

    if (data.participants >= data.capacity) {
      setStatus('Room is full.', true);
      return;
    }

    routeToRoom(roomId);
  } catch (error) {
    setStatus(error.message || 'Unable to join room', true);
  } finally {
    joinRoomBtn.disabled = false;
  }
}

createRoomBtn.addEventListener('click', createRoom);
joinRoomBtn.addEventListener('click', joinRoom);
roomInputEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    joinRoom();
  }
});

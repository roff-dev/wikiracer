// js/lobby.js — Room creation, joining, and ready-up logic

console.log('lobby.js loaded');
// ── Helpers ───────────────────────────────────────────────────────────


// Generate a 6-character alphanumeric room code
function generateRoomCode() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
  }
  
  
  function showStatus(message, isError = false) {
    const el = document.getElementById('status-message');
    el.textContent = message;
    el.style.color = isError ? 'red' : 'green';
  }
  
  
  // ── Create Room ───────────────────────────────────────────────────────
  
  
  async function createRoom() {
    showStatus('Fetching random Wikipedia pages...');
    const createBtn = document.getElementById('create-btn');
    createBtn.disabled = true;
  
  
    try {
      // Fetch two random pages for start and target
      const [startPage, targetPage] = await Promise.all([
        getRandomPage(),
        getRandomPage()
      ]);
  
  
      // Generate a unique room code (check for collisions)
      let roomCode = generateRoomCode();
      const existingRoom = await db.ref(`rooms/${roomCode}`).get();
      if (existingRoom.exists()) {
        roomCode = generateRoomCode(); // Simple re-roll — collision is rare
      }
  
  
      // Write initial room state to Firebase
      await db.ref(`rooms/${roomCode}`).set({
        state: 'lobby',
        createdAt: Date.now(),
        startPage,
        targetPage,
        players: {
          playerA: {
            id: 'playerA',
            name: 'Player A',
            ready: false,
            currentPage: startPage.url,
            clicks: 0,
            finished: false,
            finishedAt: null,
            elapsedMs: null,
            winner: false,
            connected: true
          }
        },
        gameStartedAt: null
      });
  
  
      // Store player identity in sessionStorage
      sessionStorage.setItem('playerId', 'playerA');
      sessionStorage.setItem('roomCode', roomCode);
  
  
      // Redirect to game page
      window.location.href = `game.html?room=${roomCode}&player=playerA`;
  
  
    } catch (err) {
      console.error('Error creating room:', err);
      showStatus('Failed to create room. Try again.', true);
      createBtn.disabled = false;
    }
  }
  
  
  // ── Join Room ─────────────────────────────────────────────────────────
  
  
  async function joinRoom() {
    const input = document.getElementById('room-code-input');
    const roomCode = input.value.trim().toUpperCase();
  
  
    if (roomCode.length !== 6) {
      showStatus('Room code must be 6 characters.', true);
      return;
    }
  
  
    showStatus('Joining room...');
    const joinBtn = document.getElementById('join-btn');
    joinBtn.disabled = true;
  
  
    try {
      // Check if room exists
      const roomSnapshot = await db.ref(`rooms/${roomCode}`).get();
      if (!roomSnapshot.exists()) {
        showStatus('Room not found. Check the code.', true);
        joinBtn.disabled = false;
        return;
      }
  
  
      const room = roomSnapshot.val();
  
  
      // Check if room already has two players
      if (room.players && room.players.playerB) {
        showStatus('Room is full.', true);
        joinBtn.disabled = false;
        return;
      }
  
  
      // Check room is still in lobby state
      if (room.state !== 'lobby') {
        showStatus('Game already started.', true);
        joinBtn.disabled = false;
        return;
      }
  
  
      // Write playerB initial state
      await db.ref(`rooms/${roomCode}/players/playerB`).set({
        id: 'playerB',
        name: 'Player B',
        ready: false,
        currentPage: room.startPage.url,
        clicks: 0,
        finished: false,
        finishedAt: null,
        elapsedMs: null,
        winner: false,
        connected: true
      });
  
  
      sessionStorage.setItem('playerId', 'playerB');
      sessionStorage.setItem('roomCode', roomCode);
      window.location.href = `game.html?room=${roomCode}&player=playerB`;
  
  
    } catch (err) {
      console.error('Error joining room:', err);
      showStatus('Failed to join room. Try again.', true);
      joinBtn.disabled = false;
    }
  }
  
  
  // ── Event Listeners ───────────────────────────────────────────────────
  
  
  document.getElementById('create-btn').addEventListener('click', createRoom);
  document.getElementById('join-btn').addEventListener('click', joinRoom);
  
  
  // Allow pressing Enter in the join input
  document.getElementById('room-code-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinRoom();
  });
  
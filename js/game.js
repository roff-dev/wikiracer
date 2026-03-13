// js/game.js — Core game engine


// ── State ─────────────────────────────────────────────────────────────


// Read URL params: ?room=ABC123&player=playerA
const params = new URLSearchParams(window.location.search);
const roomCode = params.get('room');
const playerId = params.get('player');


// Fallback to sessionStorage if URL params are missing (e.g. after refresh)
const storedRoomCode = roomCode || sessionStorage.getItem('roomCode');
const storedPlayerId = playerId || sessionStorage.getItem('playerId');


if (!storedRoomCode || !storedPlayerId) {
  // Missing state — redirect back to lobby
  window.location.href = 'index.html';
}


let currentRoom = null;      // Latest room snapshot from Firebase
let currentState = null;     // 'lobby' | 'countdown' | 'playing' | 'finished'
let playerHasFinished = false;
let countdownStarted = false; // Prevent countdown running twice
let gameRendered = false;     // Prevent re-rendering article on every Firebase update


const opponentId = storedPlayerId === 'playerA' ? 'playerB' : 'playerA';
const isHost = storedPlayerId === 'playerA'; // Only host triggers state transitions

// ── Panel Utilities ───────────────────────────────────────────────────


const panels = ['lobby-panel', 'countdown-panel', 'game-panel', 'results-panel'];


function showPanel(panelId) {
  panels.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', id !== panelId);
  });
}


// ── Lobby Rendering ───────────────────────────────────────────────────


function renderLobby(room) {
    showPanel('lobby-panel');
  
  
    document.getElementById('room-code-display').textContent =
      `Room Code: ${storedRoomCode}`;
    document.getElementById('pages-display').textContent =
      `Start: ${room.startPage.title} → Target: ${room.targetPage.title}`;
  
  
    const opponent = room.players[opponentId];
    const oppStatus = opponent ? 'Opponent joined!' : 'Waiting for opponent to join...';
    document.getElementById('opponent-status').textContent = oppStatus;
  
  
    const myPlayer = room.players[storedPlayerId];
    const readyBtn = document.getElementById('ready-btn');
    if (myPlayer && myPlayer.ready) {
      readyBtn.textContent = 'Waiting for opponent...';
      readyBtn.disabled = true;
    }
  
  
    // Host checks if both players are ready and kicks off countdown
    if (isHost && room.players.playerA && room.players.playerB) {
      if (room.players.playerA.ready && room.players.playerB.ready) {
        db.ref(`rooms/${storedRoomCode}/state`).set('countdown');
      }
    }
  }
  
  
  // Ready button handler
  document.getElementById('ready-btn').addEventListener('click', () => {
    db.ref(`rooms/${storedRoomCode}/players/${storedPlayerId}/ready`).set(true);
  });
  

  // ── Countdown ─────────────────────────────────────────────────────────


function renderCountdown(room) {
    if (countdownStarted) return; // Only run once
    countdownStarted = true;
    showPanel('countdown-panel');
  
  
    runCountdown(async () => {
      // Only the host writes gameStartedAt and transitions to 'playing'
      if (isHost) {
        await db.ref(`rooms/${storedRoomCode}`).update({
          state: 'playing',
          gameStartedAt: firebase.database.ServerValue.TIMESTAMP
        });
      }
      // Both players will react to state change via Firebase listener
    });
  }
  
  
  // ── Game Rendering ────────────────────────────────────────────────────
  
  
  function renderGame(room) {
    showPanel('game-panel');
  
  
    // Update target display
    document.getElementById('target-title').textContent = room.targetPage.title;
  
  
    // Update click counts from Firebase
    const myPlayer = room.players[storedPlayerId];
    const opponent = room.players[opponentId];
    if (myPlayer) document.getElementById('my-clicks').textContent = myPlayer.clicks;
    if (opponent) document.getElementById('opp-clicks').textContent = opponent.clicks;
  
  
    // Update opponent timer
    if (opponent && room.gameStartedAt) {
      updateOppTimer(opponent, room.gameStartedAt);
    }
  
  
    // Only load article and start timer once (not on every Firebase update)
    if (!gameRendered && room.gameStartedAt) {
      gameRendered = true;
      startMyTimer(room.gameStartedAt);
      loadArticle(room.startPage.url, navigateTo).then(canonical => {
        // If start page redirected, update Firebase (keeps normalisation working)
        if (normaliseTitle(canonical) !== normaliseTitle(room.startPage.url)) {
          db.ref(`rooms/${storedRoomCode}/players/${storedPlayerId}/currentPage`)
            .set(canonical);
        }
      });
    }
  }
  
  // ── Navigation ────────────────────────────────────────────────────────


async function navigateTo(pageTitle) {
    if (currentState !== 'playing') return;
    if (playerHasFinished) return;
  
  
    // Increment click count from current Firebase value
    const currentClicks = currentRoom.players[storedPlayerId].clicks || 0;
    const newClicks = currentClicks + 1;
  
  
    // Load article and get canonical title (handles Wikipedia redirects)
    const canonicalTitle = await loadArticle(pageTitle, navigateTo);
  
  
    // Write new position and clicks to Firebase
    await db.ref(`rooms/${storedRoomCode}/players/${storedPlayerId}`).update({
      currentPage: canonicalTitle,
      clicks: newClicks
    });
  
  
    // Update local click display immediately (don't wait for Firebase round-trip)
    document.getElementById('my-clicks').textContent = newClicks;
  
  
    // Check if this is the target page
    if (normaliseTitle(canonicalTitle) === normaliseTitle(currentRoom.targetPage.url)) {
      await handlePlayerFinished();
    }
  }
  
  
  // ── Win Detection ─────────────────────────────────────────────────────
  
  
  async function handlePlayerFinished() {
    const elapsedMs = Date.now() - currentRoom.gameStartedAt;
    playerHasFinished = true;
    stopMyTimer();
  
  
    // Write finished state to Firebase
    await db.ref(`rooms/${storedRoomCode}/players/${storedPlayerId}`).update({
      finished: true,
      finishedAt: firebase.database.ServerValue.TIMESTAMP,
      elapsedMs: elapsedMs
    });
  
  
    // Use a transaction to safely transition game state to 'finished'
    // This prevents both players writing simultaneously
    const roomSnapshot = await db.ref(`rooms/${storedRoomCode}`).get();
    const roomData = roomSnapshot.val();
    const allFinished = Object.values(roomData.players).every(p => p.finished);
  
  
    if (allFinished) {
      // Both done — end the game
      await db.ref(`rooms/${storedRoomCode}/state`).transaction((currentState) => {
        if (currentState === 'playing') return 'finished';
        return; // Abort transaction if state already changed
      });
    } else {
      // This player finished first — show waiting overlay
      document.getElementById('waiting-overlay').classList.remove('hidden');
    }
  }
  
  // ── Results ───────────────────────────────────────────────────────────


function renderResults(room) {
    showPanel('results-panel');
    stopMyTimer();
    stopOppTimer();
  
  
    const me = room.players[storedPlayerId];
    const opponent = room.players[opponentId];
  
  
    // Determine winner: fewest clicks wins; time is tiebreaker
    let headline = '';
    if (!opponent || !opponent.finished) {
      headline = 'You win! (Opponent did not finish)';
    } else if (me.clicks < opponent.clicks) {
      headline = 'You win! (Fewest clicks)';
    } else if (opponent.clicks < me.clicks) {
      headline = 'Opponent wins! (Fewest clicks)';
    } else if (me.elapsedMs <= opponent.elapsedMs) {
      headline = 'You win! (Tiebreak: faster time)';
    } else {
      headline = 'Opponent wins! (Tiebreak: faster time)';
    }
  
  
    document.getElementById('result-headline').textContent = headline;
  
  
    const detailsEl = document.getElementById('result-details');
    detailsEl.innerHTML = `
      <p>You: ${me.clicks} clicks in ${formatTime(me.elapsedMs || 0)}</p>
      ${opponent
        ? `<p>Opponent: ${opponent.clicks} clicks in ${formatTime(opponent.elapsedMs || 0)}</p>`
        : '<p>Opponent did not finish.</p>'
      }
      <p>Route: ${room.startPage.title} → ${room.targetPage.title}</p>
    `;
  }
  
  
  // Play Again — reset room to lobby with fresh pages
  document.getElementById('play-again-btn').addEventListener('click', async () => {
    if (!isHost) return; // Only host resets
    const [newStart, newTarget] = await Promise.all([getRandomPage(), getRandomPage()]);
    const resetPlayers = {};
    resetPlayers[storedPlayerId] = { ...currentRoom.players[storedPlayerId],
      ready: false, clicks: 0, finished: false,
      finishedAt: null, elapsedMs: null, winner: false,
      currentPage: newStart.url
    };
    if (currentRoom.players[opponentId]) {
      resetPlayers[opponentId] = { ...currentRoom.players[opponentId],
        ready: false, clicks: 0, finished: false,
        finishedAt: null, elapsedMs: null, winner: false,
        currentPage: newStart.url
      };
    }
    // Reset game state in Firebase
    await db.ref(`rooms/${storedRoomCode}`).update({
      state: 'lobby',
      startPage: newStart,
      targetPage: newTarget,
      gameStartedAt: null,
      players: resetPlayers
    });
    // Reset local state
    playerHasFinished = false;
    countdownStarted = false;
    gameRendered = false;
  });
  

  // ── Main Firebase Listener ────────────────────────────────────────────


const roomRef = db.ref(`rooms/${storedRoomCode}`);


roomRef.on('value', (snapshot) => {
  const room = snapshot.val();
  if (!room) {
    // Room was deleted or never existed
    alert('Room not found. Returning to lobby.');
    window.location.href = 'index.html';
    return;
  }


  currentRoom = room;
  currentState = room.state;


  switch (room.state) {
    case 'lobby':    renderLobby(room);    break;
    case 'countdown': renderCountdown(room); break;
    case 'playing':  renderGame(room);     break;
    case 'finished': renderResults(room);  break;
  }
});


// ── Disconnect Handling ───────────────────────────────────────────────


const myRef = db.ref(`rooms/${storedRoomCode}/players/${storedPlayerId}`);


// When this client disconnects, Firebase automatically sets connected=false
myRef.child('connected').onDisconnect().set(false);
myRef.update({ connected: true });

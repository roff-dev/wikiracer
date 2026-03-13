// js/timer.js — Countdown and in-game timer logic


let timerInterval = null;
let oppTimerInterval = null;


// Format milliseconds as MM:SS
function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}


// Start the player's own timer, ticking from gameStartedAt
function startMyTimer(gameStartedAt) {
  stopMyTimer();
  const display = document.getElementById('timer-display');
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - gameStartedAt;
    display.textContent = formatTime(elapsed);
  }, 100);
}


function stopMyTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}


// Update the opponent timer display (called from Firebase listener)
// If opponent has finished, show their final time frozen
// If not, show live elapsed time from gameStartedAt
function updateOppTimer(opponentData, gameStartedAt) {
  const display = document.getElementById('opp-timer');
  if (!display) return;
  if (opponentData.finished && opponentData.elapsedMs != null) {
    // Opponent finished — show frozen final time
    clearInterval(oppTimerInterval);
    display.textContent = formatTime(opponentData.elapsedMs);
  } else if (!oppTimerInterval && gameStartedAt) {
    // Start ticking for opponent
    oppTimerInterval = setInterval(() => {
      display.textContent = formatTime(Date.now() - gameStartedAt);
    }, 100);
  }
}


function stopOppTimer() {
  clearInterval(oppTimerInterval);
  oppTimerInterval = null;
}


// Run a 3-2-1 countdown, then call the callback
function runCountdown(callback) {
  let count = 3;
  const display = document.getElementById('countdown-number');
  display.textContent = count;
  const interval = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(interval);
      callback();
    } else {
      display.textContent = count;
    }
  }, 1000);
}

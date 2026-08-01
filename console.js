import { currentGameState, STATES, MAX_PLAYERS, gameState } from './gameState.js';
import { getLatencyMs } from './network.js';

// ============================================================================
// DOM ELEMENT CACHE — All the HTML elements the terminal UI needs
// ============================================================================
const uiCapsule = document.getElementById('ui-capsule');
const inputLine = document.querySelector('.input-line');
const modeIndicator = document.getElementById('mode-indicator');
const feedbackLog = document.getElementById('feedback-log');
const chatLog = document.getElementById('chat-log');
const lobbyStatus = document.getElementById('lobby-status');
const playerCount = document.getElementById('player-count');
const placeholderText = document.getElementById('placeholder-text');
const textLeft = document.getElementById('text-left');
const textRight = document.getElementById('text-right');
const customCaret = document.getElementById('custom-caret');
const pingIndicator = document.getElementById('ping-indicator');

// ============================================================================
// CONSOLE CONFIGURATION & LIMITS
// ============================================================================
const MAX_FEEDBACK_ENTRIES = 50;  // Maximum entries to keep in feedback log
const MAX_CHAT_ENTRIES = 100;     // Maximum entries to keep in chat log

// ============================================================================
// CONSOLE INTERNAL STATE
// ============================================================================
let currentMode = 'command';   // 'command' or 'chat'
let typedText = '';            // What the user has typed so far
let caretIndex = 0;            // Where the blinking cursor sits in typedText
let isFocused = false;         // Whether the terminal is accepting input

// ============================================================================
// PUBLIC GETTERS — Let other modules read state without direct access
// ============================================================================
export function getMode() { return currentMode; }
export function getTypedText() { return typedText; }
export function getIsFocused() { return isFocused; }

// ============================================================================
// RENDER — Re-draws the terminal text elements based on state variables
// ============================================================================
export function renderConsole() {
    if (typedText === '') {
        placeholderText.style.display = 'block';
        if (currentGameState === STATES.PLAYING) {
            placeholderText.innerText = currentMode === 'command' ? "Input battle system override..." : "Broadcast tactical comms...";
        } else {
            placeholderText.innerText = currentMode === 'command' ? "Execute system action..." : "Broadcast communications channel...";
        }
    } else {
        placeholderText.style.display = 'none';
    }

    textLeft.innerText = typedText.slice(0, caretIndex);
    textRight.innerText = typedText.slice(caretIndex);

    if (isFocused) {
        customCaret.style.display = 'inline-block';
        customCaret.style.animation = 'terminalBlink 1s infinite steps(1)';
        customCaret.scrollIntoView({ behavior: 'auto', inline: 'nearest', block: 'nearest' });
    } else {
        customCaret.style.display = 'none';
        customCaret.style.animation = 'none';
    }

    if (currentGameState === STATES.MAIN_MENU || currentGameState === STATES.BOOT) {
        lobbyStatus.style.display = 'none';
    } else {
        const activeCount = Object.keys(gameState?.players || {}).length;
        playerCount.innerText = `${activeCount}/${MAX_PLAYERS || 4}`;
        lobbyStatus.style.display = 'flex';
    }

    // --- PING INDICATOR UPDATE ---
    const latency = getLatencyMs();
    if (latency !== null && gameState.meta.isMultiplayer && !gameState.meta.isHost) {
        pingIndicator.textContent = `${latency}ms`;
        // Remove all color classes first
        pingIndicator.classList.remove('ping-good', 'ping-medium', 'ping-bad');
        // Apply color based on thresholds
        if (latency < 100) {
            pingIndicator.classList.add('ping-good');
        } else if (latency <= 250) {
            pingIndicator.classList.add('ping-medium');
        } else {
            pingIndicator.classList.add('ping-bad');
        }
    } else if (gameState.meta.isHost && gameState.meta.isMultiplayer) {
        pingIndicator.textContent = 'HOST';
        pingIndicator.classList.remove('ping-good', 'ping-medium', 'ping-bad');
        pingIndicator.classList.add('ping-good');
    } else {
        pingIndicator.textContent = '';
        pingIndicator.classList.remove('ping-good', 'ping-medium', 'ping-bad');
    }
}

// ============================================================================
// LOGGING — Create visual feedback and chat entries in the UI
// ============================================================================

/**
 * Trim excess entries from a log element to prevent DOM bloat
 * Removes oldest entries (last children) when limit is exceeded
 */
function trimLogEntries(logElement, maxEntries) {
    const entries = logElement.children;
    while (entries.length > maxEntries) {
        logElement.removeChild(logElement.lastChild);
    }
}

export function logToFeedback(text, isStatic = false) {
    const entry = document.createElement('div');
    entry.className = isStatic ? 'static-entry' : 'fading-entry';
    entry.style.color = '#555555';
    entry.innerHTML = text;

    entry.addEventListener('animationend', function() {
        entry.remove();
    });

    feedbackLog.appendChild(entry);
    
    // Prevent DOM from growing unbounded - trim to max entries
    trimLogEntries(feedbackLog, MAX_FEEDBACK_ENTRIES);
}

export function logToChat(text, sender = 'ALLY') {
    const entry = document.createElement('div');
    entry.className = 'fading-entry';

    const color = sender === 'YOU' ? '#a8dadc' : '#ffb703';
    entry.innerHTML = `<span style="color: ${color}; font-weight: 500;">[${sender}]:</span> ${text}`;

    entry.addEventListener('animationend', function() {
        entry.remove();
    });

    chatLog.prepend(entry);
    
    // Prevent DOM from growing unbounded - trim to max entries
    trimLogEntries(chatLog, MAX_CHAT_ENTRIES);
}

// Clear static feedback messages (make them fade out)
export function initiateSystemFadeout() {
    const staticElements = feedbackLog.querySelectorAll('.static-entry');
    staticElements.forEach(el => {
        el.className = 'fading-entry';
    });
}

// ============================================================================
// TEXT MANIPULATION — Used by the input system to modify what's typed
// ============================================================================
export function insertText(char) {
    typedText = typedText.slice(0, caretIndex) + char + typedText.slice(caretIndex);
    caretIndex++;
    renderConsole();
}

export function insertPastedText(text) {
    const sanitized = text.replace(/[\r\n\t]+/g, " ");
    if (sanitized.length > 0) {
        const left = typedText.slice(0, caretIndex);
        const right = typedText.slice(caretIndex);
        typedText = left + sanitized + right;
        caretIndex += sanitized.length;
        renderConsole();
    }
}

export function deleteBackward() {
    if (caretIndex > 0) {
        typedText = typedText.slice(0, caretIndex - 1) + typedText.slice(caretIndex);
        caretIndex--;
        renderConsole();
    }
}

export function deleteForward() {
    if (caretIndex < typedText.length) {
        typedText = typedText.slice(0, caretIndex) + typedText.slice(caretIndex + 1);
        renderConsole();
    }
}

export function moveCaretLeft() {
    caretIndex = Math.max(0, caretIndex - 1);
    renderConsole();
}

export function moveCaretRight() {
    caretIndex = Math.min(typedText.length, caretIndex + 1);
    renderConsole();
}

export function moveCaretHome() {
    caretIndex = 0;
    renderConsole();
}

export function moveCaretEnd() {
    caretIndex = typedText.length;
    renderConsole();
}

// Clear the input line and return what was typed
export function consumeInput() {
    const raw = typedText.trim();
    typedText = '';
    caretIndex = 0;
    renderConsole();
    return raw;
}

// ============================================================================
// FOCUS & MODE TOGGLING
// ============================================================================
export function focusConsole() {
    isFocused = true;
    uiCapsule.classList.add('focused');
    renderConsole();
}

export function unfocusConsole() {
    isFocused = false;
    uiCapsule.classList.remove('focused');
    renderConsole();
}

export function toggleMode() {
    if (typedText !== '') return; // Only toggle when input is empty

    if (currentMode === 'command') {
        currentMode = 'chat';
        modeIndicator.innerText = '@';
        modeIndicator.style.color = '#00ffff';
        customCaret.style.backgroundColor = '#00ffff';
    } else {
        currentMode = 'command';
        modeIndicator.innerText = '>';
        modeIndicator.style.color = '#555555';
        customCaret.style.backgroundColor = '#555555';
    }
    renderConsole();
}

export function setConsoleMode(mode) {
    if (mode === 'chat' && currentMode !== 'chat') {
        currentMode = 'chat';
        modeIndicator.innerText = '@';
        modeIndicator.style.color = '#00ffff';
        customCaret.style.backgroundColor = '#00ffff';
        renderConsole();
    } else if (mode === 'command' && currentMode !== 'command') {
        currentMode = 'command';
        modeIndicator.innerText = '>';
        modeIndicator.style.color = '#555555';
        customCaret.style.backgroundColor = '#555555';
        renderConsole();
    }
}

// ============================================================================
// UI PANEL DRAGGING — DISABLED FOR RETRO PIXELART AESTHETIC
// ============================================================================
function initDragging() {
    // Dragging functionality removed - console is no longer draggable
}

// ============================================================================
// CLIPBOARD PASTE HANDLER
// ============================================================================
function initPasteHandler() {
    window.addEventListener('paste', (e) => {
        if (!isFocused || currentGameState === STATES.BOOT) return;
        e.preventDefault();
        const pastedText = (e.clipboardData || window.clipboardData).getData('text');
        insertPastedText(pastedText);
    });
}

// ============================================================================
// INIT — Call once at startup to wire up console event listeners
// ============================================================================
export function initConsole() {
    initDragging();
    initPasteHandler();
    renderConsole();
}
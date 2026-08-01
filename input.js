import { STATES, currentGameState } from './gameState.js';
import {
    getIsFocused,
    getMode,
    focusConsole,
    unfocusConsole,
    toggleMode,
    consumeInput,
    insertText,
    deleteBackward,
    deleteForward,
    moveCaretLeft,
    moveCaretRight,
    moveCaretHome,
    moveCaretEnd
} from './console.js';
import { executeCommand, sendChatMessage } from './commands.js';
import { setMovementKey } from './movement.js';
import { gameCanvas } from './view3d.js';
import { localPlayerShip } from './fleetManager.js';
import { navigateShipSelection } from './ui/ShipSelector.js';

// ============================================================================
// POINTER LOCK — Lock once on gameplay entry, unlock when returning to menu
// ============================================================================
export function lockPointer() {
    if (!gameCanvas) return;
    if (document.pointerLockElement !== gameCanvas) {
        gameCanvas.requestPointerLock();
    }
}

export function unlockPointer() {
    if (document.pointerLockElement) {
        document.exitPointerLock();
    }
}

function isPointerLocked() {
    return document.pointerLockElement === gameCanvas;
}

// ============================================================================
// GLOBAL KEYBOARD ROUTING
// ============================================================================
function onKeyDown(event) {
    if (currentGameState === STATES.BOOT) return;

    // --- T KEY: Focus console (only when NOT focused) ---
    if (event.key.toLowerCase() === 't' && !getIsFocused()) {
        event.preventDefault();
        focusConsole();
        return;
    }

    // --- TAB: Toggle mode when console is focused ---
    if (event.key === 'Tab') {
        event.preventDefault();

        if (getIsFocused()) {
            toggleMode();
        }
        return;
    }

    // --- ESCAPE: Unfocus console (NEVER touches pointer lock) ---
    if (event.key === 'Escape') {
        if (getIsFocused()) {
            unfocusConsole();
        }
        return;
    }

    // --- ARROW KEYS: Ship selection in menu state (when console NOT focused) ---
    if (!getIsFocused() && currentGameState === STATES.MAIN_MENU) {
        if (event.key === 'ArrowLeft') {
            navigateShipSelection('left');
            return;
        }
        if (event.key === 'ArrowRight') {
            navigateShipSelection('right');
            return;
        }
    }

    // If the console is NOT focused, route movement keys to game engine
    if (!getIsFocused()) {
        // Re-lock if user pressed ESC earlier (browser unlocked) — user gesture allows re-lock
        if (currentGameState === STATES.PLAYING && !isPointerLocked()) {
            lockPointer();
        }
        
        // Block movement input if local player is dead
        if (localPlayerShip && localPlayerShip.userData && localPlayerShip.userData.isDead) {
            return;
        }
        
        if (event.key.length === 1 && !event.repeat) {
            setMovementKey(event.key, true);
        }
        if (['w', 'a', 's', 'd', 'q', 'e'].includes(event.key.toLowerCase())) {
            event.preventDefault();
        }
        return;
    }

    // ========================================================================
    // CONSOLE IS FOCUSED — Route keys to the terminal
    // ========================================================================

    if (event.key === 'ArrowLeft') { moveCaretLeft(); return; }
    if (event.key === 'ArrowRight') { moveCaretRight(); return; }
    if (event.key === 'Home') { moveCaretHome(); return; }
    if (event.key === 'End') { moveCaretEnd(); return; }

    if (event.key === 'Backspace') { deleteBackward(); return; }
    if (event.key === 'Delete') { deleteForward(); return; }

    if (event.key === 'Enter') {
        const rawInput = consumeInput();
        if (rawInput === '') return;
        if (getMode() === 'command') {
            executeCommand(rawInput);
        } else {
            sendChatMessage(rawInput);
        }
        return;
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        insertText(event.key);
    }
}

function onKeyUp(event) {
    if (currentGameState === STATES.BOOT) return;
    if (!getIsFocused()) {
        if (event.key.length === 1) {
            setMovementKey(event.key, false);
        }
    }
}

// ============================================================================
// MOUSE INPUT — Track left button for firing
// ============================================================================
let isMouseLeftDown = false;

export function getMouseLeftDown() {
    // Block firing if local player is dead
    if (localPlayerShip && localPlayerShip.userData && localPlayerShip.userData.isDead) {
        return false;
    }
    return isMouseLeftDown;
}

// ============================================================================
// CANVAS CLICK — Dismiss console & re-lock pointer during gameplay
// ============================================================================
function onCanvasMouseDown(e) {
    if (currentGameState !== STATES.PLAYING) return;

    const uiCapsule = document.getElementById('ui-capsule');
    if (uiCapsule && uiCapsule.contains(e.target)) return;

    // Track left mouse button for firing (but blocked if player is dead)
    if (e.button === 0) {
        const isPlayerDead = localPlayerShip && localPlayerShip.userData && localPlayerShip.userData.isDead;
        if (!isPlayerDead) {
            isMouseLeftDown = true;
            e.preventDefault();
        }
    }

    if (getIsFocused()) {
        unfocusConsole();
    }
    // Click is a user gesture — re-lock if the browser ESC unlocked it earlier
    if (!isPointerLocked()) {
        lockPointer();
    }
}

function onCanvasMouseUp(e) {
    if (e.button === 0) {
        isMouseLeftDown = false;
    }
}

// ============================================================================
// INIT — Call once at startup
// ============================================================================
export function initInput() {
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    const tryAttachCanvas = () => {
        if (gameCanvas) {
            gameCanvas.addEventListener('mousedown', onCanvasMouseDown);
            document.addEventListener('mouseup', onCanvasMouseUp);
        } else {
            setTimeout(tryAttachCanvas, 100);
        }
    };
    tryAttachCanvas();

    // Canvas cursor styling via pointer lock
    document.addEventListener('pointerlockchange', () => {
        if (isPointerLocked()) {
            gameCanvas?.setAttribute('data-pointer-locked', '');
        } else {
            gameCanvas?.removeAttribute('data-pointer-locked');
        }
    });
}

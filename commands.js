import { STATES, currentGameState, gameState, setGameState, startMultiplayerSession, purgeMultiplayerSession } from './gameState.js';
import { initHost, initClient, disconnectNetwork, connection, broadcastToAll, setGameplayScene } from './network.js';
import { logToFeedback, logToChat, initiateSystemFadeout, renderConsole, getMode } from './console.js';
import { transitionToGameplay, transitionToMainMenu } from './transitions.js';
import { gameplayScene } from './view3d.js';
import { clearAsteroidsFromScene, ensureAsteroidField, createAsteroidSnapshot } from './asteroidGenerator.js';

// ============================================================================
// COMMAND EXECUTION — Parses and runs text commands typed in the console
// ============================================================================
export function executeCommand(rawInput) {
    logToFeedback(`> ${rawInput}`);

    const parts = rawInput.split(' ');
    const command = parts[0].toLowerCase();
    const argument = parts[1];

    if (command === 'host') {
        handleHost();
    } else if (command === 'join') {
        handleJoin(argument);
    } else if (command === 'launch' || command === 'start') {
        handleLaunch();
    } else if (command === 'abort' || command === 'quit') {
        handleAbort();
    } else if (command === 'code' || command === 'room') {
        handleCode();
    } else {
        logToFeedback(`Engine prompt error: "${command}" is unmapped.`);
    }
}

// ============================================================================
// COMMAND HANDLERS
// ============================================================================

function handleHost() {
    if (currentGameState !== STATES.MAIN_MENU) {
        logToFeedback(`<span style="color: #ffaa00;">CRITICAL ERROR: Array hosting rejected.</span>`);
        return;
    }

    startMultiplayerSession(true, null);

    if (gameplayScene) {
        setGameplayScene(gameplayScene);
        clearAsteroidsFromScene(gameplayScene);
        gameState.meta.asteroidSeed = 'lobby-host-seed';
        void ensureAsteroidField(gameplayScene, undefined, gameState.meta.asteroidSeed).then(() => {
            broadcastToAll({
                type: 'ASTEROID_STATE_SYNC',
                asteroidState: createAsteroidSnapshot(),
                asteroidSeed: gameState.meta.asteroidSeed
            });
        });
    }

    initHost(logToFeedback, logToChat, () => {
        purgeMultiplayerSession(gameplayScene);
        setGameState(STATES.MAIN_MENU);
        initiateSystemFadeout();
        renderConsole();
    });

    setGameState(STATES.LOBBY_HOST);
    renderConsole();
    initiateSystemFadeout();
    logToFeedback('Contacting sub-space signaling array...');
}

function handleJoin(roomCode) {
    if (currentGameState !== STATES.MAIN_MENU) {
        logToFeedback(`<span style="color: #ffaa00;">CRITICAL ERROR: Link connection rejected.</span>`);
        return;
    }
    if (!roomCode) {
        logToFeedback('ERROR: Room token required. Usage: join [code]');
        return;
    }

    startMultiplayerSession(false, roomCode);

    if (gameplayScene) {
        setGameplayScene(gameplayScene);
    }

    initClient(roomCode, logToFeedback, logToChat, () => {
        purgeMultiplayerSession(gameplayScene);
        setGameState(STATES.MAIN_MENU);
        initiateSystemFadeout();
        renderConsole();
    });

    setGameState(STATES.LOBBY_JOIN);
    renderConsole();
    initiateSystemFadeout();
    logToFeedback(`Routing data bridge connection to channel: ${roomCode}...`);
}

function handleLaunch() {
    if (currentGameState !== STATES.LOBBY_HOST && currentGameState !== STATES.LOBBY_JOIN) {
        logToFeedback('ERROR: Invalid command. System array must be inside a stable lobby network to launch.');
        return;
    }

    // Only the host can start the game
    if (!gameState.meta.isHost) {
        logToFeedback('<span style="color: #ffb703;">ERROR: Launch authorization restricted. Awaiting command from Host Leader...</span>');
        return;
    }

    transitionToGameplay();
    initiateSystemFadeout();
    logToFeedback('<span style="color: #00ff88;">SYSTEM CRITICAL: Engine bounds decoupled. Entering battle airspace...</span>');

    // Tell all connected clients to start and synchronize the asteroid field
    broadcastToAll({
        type: 'GAME_START',
        asteroidState: Object.fromEntries(
            Object.entries(gameState.entities.asteroids).map(([id, asteroid]) => [id, { ...asteroid }])
        ),
        asteroidSeed: gameState.meta.asteroidSeed
    });
}

function handleAbort() {
    if (currentGameState === STATES.MAIN_MENU) {
        logToFeedback('System is already at base operating parameters.');
        return;
    }

    disconnectNetwork();
    transitionToMainMenu();
    initiateSystemFadeout();
    logToFeedback('Session terminated. Relocating system logic back to main menu loop...');
}

function handleCode() {
    if (!gameState.meta.isMultiplayer) {
        logToFeedback('ERROR: No active session. Room code is only available inside a lobby or match.');
        return;
    }

    const code = gameState.meta.currentRoomCode;
    if (!code) {
        logToFeedback('ERROR: Room code not yet available.');
        return;
    }

    logToFeedback(`ROOM CODE: <span style="color:#fff; font-weight:bold;">${code}</span>`);

    navigator.clipboard.writeText(code).then(() => {
        logToFeedback(`<span style="color:#00ff88; font-size:11px;">[SYSTEM]: Copied to clipboard!</span>`);
    }).catch(() => {
        logToFeedback(`<span style="color:#ffaa00; font-size:11px;">[SYSTEM]: Could not auto-copy. Select and copy manually.</span>`);
    });
}

// ============================================================================
// CHAT MESSAGE SENDING — Routes chat input to the network
// ============================================================================
export function sendChatMessage(rawInput) {
    if (gameState.meta.isMultiplayer) {
        // Find our local player tag
        const myLocalId = Object.keys(gameState.players).find(id => gameState.players[id].isLocal);
        const myAssignedTag = gameState.players[myLocalId]?.tag || 'YOU';

        logToChat(rawInput, 'YOU');

        if (gameState.meta.isHost) {
            // Host broadcasts to everyone
            broadcastToAll({ type: 'chat', text: rawInput, senderTag: myAssignedTag });
        } else if (connection && connection.open) {
            // Client sends to host
            connection.send({ type: 'chat', text: rawInput, senderTag: myAssignedTag });
        }
    } else {
        logToChat("Comms network offline. Bridging connection link required.", 'SYSTEM');
    }
}
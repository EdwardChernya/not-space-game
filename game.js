import { preloadAssets } from './modelsLoader.js';
import { init3D, animate3D } from './view3d.js';
import { STATES, setGameState } from './gameState.js';
import { initConsole, logToFeedback, initiateSystemFadeout } from './console.js';
import { initInput } from './input.js';

// ============================================================================
// CORE IGNITION SEQUENCE
// This is the main entry point. It wires up all modules and starts the game.
// ============================================================================

// 1. Initialize the console UI (dragging, paste handler, initial render)
initConsole();

// 2. Initialize keyboard input routing
initInput();

// 3. Load 3D assets, then start the rendering engine
preloadAssets().then(() => {
    console.log("3D models cached successfully. Initializing 3D engine...");

    setGameState(STATES.MAIN_MENU);

    init3D();
    animate3D();

    initiateSystemFadeout();
    logToFeedback(`
        Press T to focus, TAB to switch modes<br>
        Type <span style="color: #00ff88;">host</span> to create a lobby or <span style="color: #00ff88;">join</span> [code] to connect
`, true);

}).catch((error) => {
    console.error("Engine init Aborted. Asset Pipeline Error:", error);
    logToFeedback('<span style="color: #ff4444;">CRITICAL: Failed to load 3D assets.</span>', true);
});
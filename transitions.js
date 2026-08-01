import { STATES, setGameState, purgeMultiplayerSession, gameState } from './gameState.js';
import { gameplayScene } from './view3d.js';
import { spawnFleet } from './fleetManager.js';
import { unfocusConsole, setConsoleMode } from './console.js';
import { lockPointer, unlockPointer } from './input.js';
import { setGameplayScene } from './network.js';
import { destroyShipSelector, getSelectedShipType, initShipSelector } from './ui/ShipSelector.js';
import { cleanupReticle } from './reticleManager.js';
import { resetCamera } from './camera.js';
import { clearAsteroidsFromScene, generateAsteroidField } from './asteroidGenerator.js';

// ============================================================================
// SCENE TRANSITIONS — Shared by both commands.js and network.js
// This lives in its own file to prevent circular dependencies.
// ============================================================================

// Switch from lobby to the active gameplay scene
export function transitionToGameplay() {
    // Ensure the network layer has access to the gameplay scene
    setGameplayScene(gameplayScene);
    
    // Clean up ship selector UI before entering gameplay
    destroyShipSelector();

    if (gameState.meta.isMultiplayer && gameState.meta.isHost && Object.keys(gameState.entities.asteroids).length === 0) {
        clearAsteroidsFromScene(gameplayScene);
        generateAsteroidField(gameplayScene);
    }
    
    spawnFleet(gameplayScene);
    setGameState(STATES.PLAYING);
    document.getElementById('ui-capsule')?.classList.add('gameplay-mode');
    unfocusConsole(); // Auto-collapse console when entering gameplay
    setConsoleMode('chat'); // Switch to chat mode for gameplay
    lockPointer();     // Lock cursor on gameplay entry (within user gesture from "launch" command)
}

// Switch from gameplay back to the main menu
export function transitionToMainMenu() {
    // Clean up the reticle display
    cleanupReticle();
    
    // Purge all network players and entities from the gameplay scene
    purgeMultiplayerSession(gameplayScene);
    
    // Reset camera to menu position
    resetCamera();
    
    // Remove gameplay UI mode
    document.getElementById('ui-capsule')?.classList.remove('gameplay-mode');
    
    // Unlock pointer lock when returning to menu
    unlockPointer();
    
    // Recreate the ship selector UI for menu
    initShipSelector();
    
    // Set game state back to main menu
    setGameState(STATES.MAIN_MENU);
    
    console.log('[TRANSITIONS]: Returned to main menu');
}

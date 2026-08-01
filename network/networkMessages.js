// ============================================================================
// MESSAGE VALIDATION & ROUTING - Handle all network messages
// ============================================================================

import * as THREE from 'three';
import { gameState, STATES, registerPlayer } from '../gameState.js';
import { renderConsole, initiateSystemFadeout } from '../console.js';
import { transitionToGameplay } from '../transitions.js';
import { spawnSingleShip, despawnShip, respawnShip, remoteShips, localPlayerShip } from '../fleetManager.js';
import { spawnAsteroidsFromState } from '../asteroidGenerator.js';
import {
    getLastPongTime,
    setLastPongTime,
    getLastPongSentTime,
    setLastPongSentTime,
    setCurrentLatencyMs,
    getHeartbeatInterval,
    getHeartbeatTimeout,
    getClientLastPong,
    startClientHeartbeat
} from './networkHeartbeat.js';
import { setJoinOrder, getJoinOrder } from './networkMigration.js';

// Known valid message types for validation
const VALID_HOST_MESSAGES = ['chat', 'PONG', 'DAMAGE_TAKEN', 'PLAYER_MOVEMENT', 'BEAM_FIRED', 'KILL_FEEDBACK'];
const VALID_CLIENT_MESSAGES = [
    'chat', 'LOBBY_FULL_REJECTION', 'HANDSHAKE_ACCEPT', 'SYSTEM_ALERT',
    'ROSTER_UPDATE', 'SPAWN_SINGLE_PEER', 'DESPAWN_PEER', 'ASTEROID_STATE_SYNC', 'GAME_START',
    'PING', 'HOST_MIGRATE', 'PLAYER_RESPAWN', 'HEALTH_UPDATE', 'PLAYER_DIED', 'KILL_FEEDBACK', 'PLAYER_MOVEMENT', 'BEAM_FIRED'
];

// Dependencies
let broadcastToAllFn = null;
let logChatFn = null;
let logFeedbackFn = null;
let peerFn = null;
let connectionFn = null;
let disconnectNetworkFn = null;
let mergePlayerStateFn = null;
let gameplaySceneFn = null;
let beamPoolFn = null;
let sparkPoolFn = null;

export function setMessageDependencies(broadcastToAll, logChat, logFeedback, peer, connection, disconnectNetwork, mergePlayerState, gameplayScene, beamPool, sparkPool) {
    broadcastToAllFn = broadcastToAll;
    logChatFn = logChat;
    logFeedbackFn = logFeedback;
    peerFn = peer;
    connectionFn = connection;
    disconnectNetworkFn = disconnectNetwork;
    mergePlayerStateFn = mergePlayerState;
    gameplaySceneFn = gameplayScene;
    beamPoolFn = beamPool;
    sparkPoolFn = sparkPool;
}

export function isValidMessage(data, isHost) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.type !== 'string') return false;

    const validTypes = isHost ? VALID_HOST_MESSAGES : VALID_CLIENT_MESSAGES;
    return validTypes.includes(data.type);
}

export function mergePlayerState(incomingPlayers) {
    if (mergePlayerStateFn) {
        return mergePlayerStateFn(incomingPlayers);
    }

    const myPeerId = peerFn()?.id;
    const scene = gameplaySceneFn();

    // Add or update players from the incoming data
    Object.keys(incomingPlayers).forEach(id => {
        const incoming = incomingPlayers[id];
        if (gameState.players[id]) {
            // Update existing player - preserve local isLocal flag
            gameState.players[id] = {
                ...incoming,
                isLocal: (id === myPeerId)
            };
        } else {
            // New player
            gameState.players[id] = {
                ...incoming,
                isLocal: (id === myPeerId)
            };
        }
    });

    // Remove players that are no longer in the incoming data
    Object.keys(gameState.players).forEach(id => {
        if (!incomingPlayers[id]) {
            // Despawn their ship if in gameplay
            if (gameState.meta.gamePhase === STATES.PLAYING && scene) {
                despawnShip(id, scene);
            }
            delete gameState.players[id];
        }
    });
}

export function handleMessageData(conn, data) {
    // ---- MESSAGE VALIDATION ----
    if (!isValidMessage(data, gameState.meta.isHost)) {
        console.warn('[NETWORK]: Rejected invalid message:', data);
        return;
    }

    // ---- HEARTBEAT HANDLING ----
    if (data.type === 'PING') {
        // Client receives PING from host - respond with PONG
        if (!gameState.meta.isHost && connectionFn() && connectionFn().open) {
            // Measure RTT: time since we sent our last PONG
            const lastPongSentTime = getLastPongSentTime();
            if (lastPongSentTime > 0) {
                const latency = Date.now() - lastPongSentTime;
                setCurrentLatencyMs(latency);
                renderConsole();
            }
            setLastPongTime(Date.now()); // Reset our timeout
            setLastPongSentTime(Date.now());
            connectionFn().send({ type: 'PONG', peerId: peerFn().id });
        }
        return;
    }

    if (data.type === 'PONG') {
        // Host receives PONG from client - update their last-seen time
        if (gameState.meta.isHost && data.peerId) {
            getClientLastPong().set(data.peerId, Date.now());
        }
        return;
    }

    // ---- CHAT MESSAGE ROUTING ----
    if (data.type === 'chat') {
        if (gameState.meta.isHost) {
            logChatFn(data.text, data.senderTag || 'ALLY');
            broadcastToAllFn({ type: 'chat', text: data.text, senderTag: data.senderTag }, conn.peer);
        } else {
            logChatFn(data.text, data.senderTag || 'ALLY');
        }
        return;
    }

    // ---- HOST-SPECIFIC: DAMAGE HANDLING ----
    if (gameState.meta.isHost && data.type === 'DAMAGE_TAKEN') {
        const { shooterPeerId, targetPeerId, damageAmount } = data;
        const scene = gameplaySceneFn();

        // Check both remoteShips (other clients) and localPlayerShip (the host own ship)
        const targetShip = remoteShips[targetPeerId] ||
            (localPlayerShip && localPlayerShip.userData && localPlayerShip.userData.peerId === targetPeerId ? localPlayerShip : null);
        if (targetShip && targetShip.userData && targetShip.userData.hpManager) {
            const hpManager = targetShip.userData.hpManager;
            const targetPos = targetShip.position.clone();

            // Apply damage
            const damageResult = hpManager.takeDamage(damageAmount, targetPos);

            if (damageResult) {
                // Broadcast health update to all clients
                broadcastToAllFn({
                    type: 'HEALTH_UPDATE',
                    peerId: targetPeerId,
                    currentHP: hpManager.currentHP,
                    currentShield: hpManager.currentShield,
                    maxHP: hpManager.maxHP,
                    maxShield: hpManager.maxShield,
                    wasJustDamaged: true
                });

                // Check if player died
                if (damageResult.isDead) {
                    console.log(`[NETWORK]: Player ${targetPeerId} died from damage`);

                    // Broadcast player death and kill feedback to all clients
                    broadcastToAllFn({
                        type: 'PLAYER_DIED',
                        peerId: targetPeerId
                    });
                    broadcastToAllFn({
                        type: 'KILL_FEEDBACK',
                        shooterPeerId: shooterPeerId || null,
                        targetPeerId: targetPeerId
                    });

                    // Log feedback for the host if they are the one who died
                    if (targetPeerId === peerFn().id) {
                        logFeedbackFn('<span style="color: #ff4444;">YOU ARE DEAD! Respawning...</span>');
                    }

                    // Respawn is handled automatically by fleetManager
                }
            }
        }
        return;
    }

    // ---- PLAYER MOVEMENT SYNC (BOTH HOST AND CLIENT) ----
    if (data.type === 'PLAYER_MOVEMENT') {
        // Both host and client process movement updates
        const { peerId, x, y, z, rotationX, rotationY, rotationZ, throttle, deltaEulerX, deltaEulerY, deltaEulerZ } = data;
        
        if (gameState.players[peerId]) {
            // Update player state with new position, rotation, and visual data
            gameState.players[peerId].x = x;
            gameState.players[peerId].y = y;
            gameState.players[peerId].z = z;
            gameState.players[peerId].rotationX = rotationX;
            gameState.players[peerId].rotationY = rotationY;
            gameState.players[peerId].rotationZ = rotationZ;
            gameState.players[peerId].throttle = throttle;
            gameState.players[peerId].deltaEulerX = deltaEulerX;
            gameState.players[peerId].deltaEulerY = deltaEulerY;
            gameState.players[peerId].deltaEulerZ = deltaEulerZ;
        }
        
        // If we're the host, rebroadcast to all OTHER clients (except the sender)
        if (gameState.meta.isHost) {
            broadcastToAllFn({
                type: 'PLAYER_MOVEMENT',
                peerId,
                x,
                y,
                z,
                rotationX,
                rotationY,
                rotationZ,
                throttle,
                deltaEulerX,
                deltaEulerY,
                deltaEulerZ
            }, peerId); // Exclude the sender
        }
        return;
    }

    // ---- BEAM FIRED SYNC (BOTH HOST AND CLIENT) ----
    if (data.type === 'BEAM_FIRED') {
        // If we're the host, broadcast this client's beam to all OTHER clients
        if (gameState.meta.isHost) {
            broadcastToAllFn(data, data.shooterPeerId); // Exclude the shooter
        }
        // Both host and client render the received beam
        handleBeamFired(data);
        return;
    }

    // ---- CLIENT-SPECIFIC MULTIPLAYER STATE MANAGEMENT ----
    if (!gameState.meta.isHost) {
        handleClientMessage(data);
    }
}

function reconcileMissingShips(scene) {
    if (!scene || gameState.meta.gamePhase !== STATES.PLAYING) return;

    Object.keys(gameState.players).forEach(id => {
        const shipExists = (localPlayerShip && localPlayerShip.userData?.peerId === id) || remoteShips[id];
        if (!shipExists) {
            spawnSingleShip(id, scene);
        }
    });
}

function handleClientMessage(data) {
    const scene = gameplaySceneFn();

    if (data.type === 'LOBBY_FULL_REJECTION') {
        logFeedbackFn('<span style="color: #ff4444;">CONNECTION REJECTED: Squad roster is full (4/4).</span>');
        disconnectNetworkFn();
    } else if (data.type === 'HANDSHAKE_ACCEPT') {
        logFeedbackFn(`<span style="color: #00ffff;">Verified! Identity Confirmed: ${data.assignedTag}</span>`);

        // Store join order for host migration
        if (data.joinOrder) {
            setJoinOrder(data.joinOrder);
        }

        // ---- ASTEROID SYNCHRONIZATION ----
        if (data.asteroidSeed) {
            gameState.meta.asteroidSeed = data.asteroidSeed;
        }

        // Apply the host's asteroid snapshot immediately, even before the match starts.
        if (data.asteroidState && scene) {
            spawnAsteroidsFromState(data.asteroidState, scene);
        }

        if (data.isGameRunning) {
            // Late-joiner: Merge roster from host
            mergePlayerState(data.players);

            logFeedbackFn(`<span style="color: #ffb703;">WARPING INTO ACTIVE SESSION IN PROGRESS...</span>`);
            transitionToGameplay();
            reconcileMissingShips(gameplaySceneFn());
            initiateSystemFadeout?.();
        } else {
            // Normal join during lobby phase
            registerPlayer(peerFn().id, data.assignedTag, true);
            renderConsole();
        }
    } else if (data.type === 'SYSTEM_ALERT') {
        logFeedbackFn(data.text);
    } else if (data.type === 'ROSTER_UPDATE') {
        // Safe merge instead of wholesale replacement
        mergePlayerState(data.players);

        // Update join order for host migration
        if (data.joinOrder) {
            setJoinOrder(data.joinOrder);
        }

        renderConsole();

        // Reconciliation: If in gameplay, spawn anyone currently missing
        if (gameState.meta.gamePhase === STATES.PLAYING && scene) {
            reconcileMissingShips(scene);
        }
    } else if (data.type === 'SPAWN_SINGLE_PEER') {
        spawnSingleShip(data.peerId, scene);
    } else if (data.type === 'DESPAWN_PEER') {
        despawnShip(data.peerId, scene);
    } else if (data.type === 'ASTEROID_STATE_SYNC') {
        if (data.asteroidSeed) {
            gameState.meta.asteroidSeed = data.asteroidSeed;
        }
        if (data.asteroidState && scene) {
            void spawnAsteroidsFromState(data.asteroidState, scene);
        }
    } else if (data.type === 'GAME_START') {
        if (data.asteroidSeed) {
            gameState.meta.asteroidSeed = data.asteroidSeed;
        }
        if (data.asteroidState && scene) {
            spawnAsteroidsFromState(data.asteroidState, scene);
        }
        transitionToGameplay();
        initiateSystemFadeout?.();
    } else if (data.type === 'HOST_MIGRATE') {
        // New host is announcing themselves
        logFeedbackFn(`<span style="color: #00ff88;">HOST MIGRATION: New squad leader established.</span>`);
        if (data.joinOrder) setJoinOrder(data.joinOrder);
        mergePlayerState(data.players);
        renderConsole();
    } else if (data.type === 'PLAYER_RESPAWN') {
        // A player has respawned at a specific location (could be us or remote)
        const { peerId, x, y, z } = data;
        console.log(`[NETWORK]: Player ${peerId} respawned at (${x}, ${y}, ${z})`);

        // Use respawnShip() instead of spawnSingleShip() because the mesh may already exist (hidden)
        // respawnShip() handles both reusing hidden meshes and creating new ones if needed
        respawnShip(peerId, scene);

        // Position the ship at the broadcast location (works for both local and remote)
        let mesh = null;
        if (peerId === peerFn().id) {
            // It's our ship
            mesh = localPlayerShip;
        } else {
            // It's a remote ship
            mesh = remoteShips[peerId];
        }

        if (mesh) {
            mesh.position.set(x, y, z);
            console.log(`[NETWORK]: Positioned respawned ship for ${peerId} at broadcast location`);
        }
    } else if (data.type === 'HEALTH_UPDATE') {
        // Host has broadcast health update for a player
        const { peerId, currentHP, currentShield, maxHP, maxShield, wasJustDamaged } = data;

        // Update the player's HP manager state
        let targetShip = null;
        if (peerId === peerFn()?.id) {
            // Update our own ship
            targetShip = localPlayerShip;
        } else {
            // Update remote ship
            targetShip = remoteShips[peerId];
        }

        if (targetShip && targetShip.userData && targetShip.userData.hpManager) {
            const hpManager = targetShip.userData.hpManager;
            hpManager.currentHP = currentHP;
            hpManager.currentShield = currentShield;
            // If damage was just taken, record the damage time locally using this client's clock
            // This ensures the damage flash effect uses the client's own time reference
            if (wasJustDamaged) {
                hpManager.lastDamageTime = performance.now() / 1000;
            }
            // Note: maxHP and maxShield shouldn't change, but update if needed
            console.log(`[NETWORK]: Updated health for ${peerId}: HP ${currentHP}/${maxHP}, Shield ${currentShield}/${maxShield}`);
        }
    } else if (data.type === 'KILL_FEEDBACK') {
        const { shooterPeerId } = data;
        if (shooterPeerId && shooterPeerId === peerFn()?.id && localPlayerShip?.userData?.hpManager) {
            localPlayerShip.userData.hpManager.triggerKillFeedback();
        }
    } else if (data.type === 'PLAYER_DIED') {
        // Host has broadcast that a player died
        const { peerId } = data;
        console.log(`[NETWORK]: Player ${peerId} is dead`);

        if (peerId === peerFn().id) {
            // We died - despawn ourselves and wait for host respawn
            logFeedbackFn('<span style="color: #ff4444;">YOU ARE DEAD! Respawning...</span>');
            despawnShip(peerId, scene);
        } else {
            // Remote player died - despawn them
            despawnShip(peerId, scene);
        }
    } else if (data.type === 'BEAM_FIRED') {
        // Render a beam fired by another player
        handleBeamFired(data);
    }
}

function handleBeamFired(data) {
    const beamPool = beamPoolFn ? beamPoolFn() : null;
    if (!beamPool) return;

    const { shooterPeerId, targetPeerId, color, intensity, startPos, endPos, hasHit, impactPos } = data;

    // Always use transmitted startPos and endPos if available (priority on transmitted data)
    if (startPos && endPos) {
        // Use exact transmitted positions for accurate beam rendering
        const start = new THREE.Vector3(startPos[0], startPos[1], startPos[2]);
        const end = new THREE.Vector3(endPos[0], endPos[1], endPos[2]);
        // Network beam: isLocalBeam = false (keep hold phase for visibility)
        beamPool.get(start, end, color, intensity, false);
    }
    // Fallback: if no startPos/endPos transmitted, reconstruct targeted beam from ship positions
    else if (targetPeerId) {
        const shooterShip = shooterPeerId === peerFn()?.id
            ? localPlayerShip
            : remoteShips[shooterPeerId];
        
        const targetShip = targetPeerId === peerFn()?.id
            ? localPlayerShip
            : remoteShips[targetPeerId];

        if (shooterShip && targetShip) {
            const shooterPos = shooterShip.position.clone();
            const targetPos = targetShip.position.clone();
            
            // Create beam from shooter to target using local positions (fallback only)
            // Network beam: isLocalBeam = false (keep hold phase for visibility)
            beamPool.get(shooterPos, targetPos, color, intensity, false);
        }
    }

    // ---- SPAWN IMPACT PARTICLES IF BEAM HIT SOMETHING ----
    if (hasHit && impactPos) {
        const sparkPool = sparkPoolFn ? sparkPoolFn() : null;
        if (sparkPool) {
            // Convert impact position from array to Vector3
            const impact = new THREE.Vector3(impactPos[0], impactPos[1], impactPos[2]);
            
            // Spawn particles at impact position with matching beam color
            sparkPool.spawnBurst(
                impact,
                color,
                15,    // 15 particles per impact
                65     // Spread velocity
            );
        }
    }
}

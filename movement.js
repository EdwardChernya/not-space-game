import * as THREE from 'three';
import { camera } from './camera.js';
import { gameState } from './gameState.js';
import { localPlayerShip } from './fleetManager.js';
import { updateShipThrustVisuals, updateShipAuxVisuals } from './shipBuilder.js';

// Network movement sync state
let lastMovementSyncTime = 0;
const MOVEMENT_SYNC_INTERVAL = 50; 
let sendMovementFn = null;

export function setMovementSyncDependency(sendMovement) {
    sendMovementFn = sendMovement;
}

// --- TUNABLE CONSTANTS ---
const THRUST_ACCELERATION = 300;   
const REVERSE_ACCELERATION = 25;  
const DRAG_COEFFICIENT = 1.85;    
const MAX_SPEED = 1900;            

export let ROLL_SPEED = 3.0;
export const rotationRates = { yaw: 0.5, pitch: 5.0, roll: 5.0 };
export let pitchUpRate = 5.0;    
export let pitchDownRate = 2.0;  
export const cameraOffset = new THREE.Vector3(0, 1, 0);

// --- KEY STATE ---
const movementKeys = { w: false, a: false, s: false, d: false, q: false, e: false };

// --- PHYSICS STATE ---
export const velocity = new THREE.Vector3();
const currentQuaternion = new THREE.Quaternion();
const targetQuaternion = new THREE.Quaternion();

// --- CAMERA REFERENCE (lazy-init) ---
let _setCameraTarget = null;
let _applyCameraRoll = null;
let _importingCamera = false;

function _ensureCameraRefs() {
    if (_importingCamera) return;
    if (!_setCameraTarget || !_applyCameraRoll) {
        _importingCamera = true;
        import('./camera.js').then(({ setCameraTarget, applyCameraRoll }) => {
            _setCameraTarget = setCameraTarget;
            _applyCameraRoll = applyCameraRoll;
        });
    }
}

// ============================================================================
// ALLOCATION FREE SCRATCHPAD VARIABLES (Created once, reused forever)
// ============================================================================
const _forward = new THREE.Vector3();
const _cameraForward = new THREE.Vector3();
const _cameraRight = new THREE.Vector3();
const _cameraUp = new THREE.Vector3();
const _tempQuat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

// New scratchpads for zero-allocation performance:
const _localOffset = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _currentDeltaQuat = new THREE.Quaternion();
const _frameDeltaEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _zeroEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _rotMatrix = new THREE.Matrix4();
const _slerpTargetQuat = new THREE.Quaternion();
const _negatedForward = new THREE.Vector3();
const _reducedEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _reducedDelta = new THREE.Quaternion();

function _normalizeAngle(a) {
    const TWO_PI = Math.PI * 2;
    a = (a + Math.PI) % TWO_PI;
    if (a < 0) a += TWO_PI;
    return a - Math.PI;
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function setMovementKey(key, pressed) {
    key = key.toLowerCase();
    if (key in movementKeys) {
        movementKeys[key] = pressed;
    }
}

export function updateMovement(deltaTime, cam) {
    if (!localPlayerShip || !cam) return;

    const dt = Math.min(deltaTime, 0.1); 
    const peerId = localPlayerShip.userData.peerId;
    if (!peerId) return;

    if (currentQuaternion.x === 0 && currentQuaternion.y === 0 && currentQuaternion.z === 0 && currentQuaternion.w === 1) {
        currentQuaternion.copy(localPlayerShip.quaternion);
    } else {
        currentQuaternion.normalize();
    }

    computeTargetRotation(cam);
    handleRollInput(dt);
    handleThrust(dt);
    handleDrag(dt);
    clampSpeed();

    // Position updates
    localPlayerShip.position.addScaledVector(velocity, dt);

    applyPerAxisRotation(dt);

    // Visuals projection calculations
    _forward.set(0, 0, -1).applyQuaternion(localPlayerShip.quaternion).normalize();
    const forwardSpeed = Math.max(0, velocity.dot(_forward));
    
    let baseThrottle = movementKeys.w ? 0.3 + (forwardSpeed / MAX_SPEED) * 0.7 : 0.08;
    const throttle = Math.min(1.0, baseThrottle);

    updateShipThrustVisuals(localPlayerShip, throttle, deltaTime);

     // Reuse a single pre-allocated quaternion and euler for visuals
     _currentDeltaQuat.copy(currentQuaternion).invert().multiply(targetQuaternion);
     if (Math.abs(_currentDeltaQuat.w) < 0.9999) {
         // **CRITICAL FIX**: Canonicalize quaternion hemisphere before Euler decomposition
         if (_currentDeltaQuat.w < 0) {
             _currentDeltaQuat.x *= -1;
             _currentDeltaQuat.y *= -1;
             _currentDeltaQuat.z *= -1;
             _currentDeltaQuat.w *= -1;
         }
         
         _frameDeltaEuler.setFromQuaternion(_currentDeltaQuat, 'YXZ');
         _frameDeltaEuler.x = _normalizeAngle(_frameDeltaEuler.x);
         _frameDeltaEuler.y = _normalizeAngle(_frameDeltaEuler.y);
         _frameDeltaEuler.z = _normalizeAngle(_frameDeltaEuler.z);

         updateShipAuxVisuals(localPlayerShip, _frameDeltaEuler);
     } else {
         _frameDeltaEuler.set(0, 0, 0);
         updateShipAuxVisuals(localPlayerShip, _frameDeltaEuler);
     }
    
    // Write state back to gameState
    const player = gameState.players[peerId];
    if (player) {
        player.x = localPlayerShip.position.x;
        player.y = localPlayerShip.position.y;
        player.z = localPlayerShip.position.z;
        player.rotationX = localPlayerShip.rotation.x;
        player.rotationY = localPlayerShip.rotation.y;
        player.rotationZ = localPlayerShip.rotation.z;
        player.throttle = throttle; 
        player.deltaEulerX = _frameDeltaEuler.x; 
        player.deltaEulerY = _frameDeltaEuler.y; 
        player.deltaEulerZ = _frameDeltaEuler.z; 
    }

    if (gameState.meta.isMultiplayer && sendMovementFn) {
        const now = performance.now();
        if (now - lastMovementSyncTime >= MOVEMENT_SYNC_INTERVAL) {
            lastMovementSyncTime = now;
            sendMovementFn(
                peerId,
                localPlayerShip.position.x, player.y, player.z,
                localPlayerShip.rotation.x, localPlayerShip.rotation.y, localPlayerShip.rotation.z,
                throttle, _frameDeltaEuler.x, _frameDeltaEuler.y, _frameDeltaEuler.z
            );
        }
    }

    _ensureCameraRefs();
    if (_setCameraTarget) {
        // Safe mutations via pre-allocated scratch objects
        _localOffset.copy(cameraOffset).applyQuaternion(cam.quaternion);
        _targetPos.copy(localPlayerShip.position).add(_localOffset);
        _setCameraTarget(_targetPos);
    }
}

// ============================================================================
// INTERNAL PHYSICS (REFACTORED FOR ZERO ALLOCATION)
// ============================================================================

function computeTargetRotation(cam) {
    cam.getWorldDirection(_cameraForward);
    _forward.copy(_cameraForward).negate().normalize();
    _cameraUp.set(0, 1, 0).applyQuaternion(cam.quaternion).normalize();

    _cameraRight.crossVectors(_forward, _cameraUp).normalize();
    _cameraUp.crossVectors(_cameraRight, _forward).normalize();

    _negatedForward.copy(_forward).negate();
    _rotMatrix.makeBasis(_cameraRight, _cameraUp, _negatedForward);

    targetQuaternion.setFromRotationMatrix(_rotMatrix);

    const angleDiff = currentQuaternion.angleTo(targetQuaternion);
    const maxAngleDiff = (85 * Math.PI) / 180; 
    
    if (angleDiff > maxAngleDiff) {
        _slerpTargetQuat.setFromRotationMatrix(_rotMatrix);
        targetQuaternion.copy(currentQuaternion);
        targetQuaternion.slerp(_slerpTargetQuat, maxAngleDiff / angleDiff);
    }
}

function handleRollInput(dt) {
    let rollDelta = 0;
    if (movementKeys.q) rollDelta -= ROLL_SPEED * dt;
    if (movementKeys.e) rollDelta += ROLL_SPEED * dt;

    if (rollDelta !== 0) {
        _ensureCameraRefs();
        if (_applyCameraRoll) _applyCameraRoll(rollDelta);
    }
}

function handleThrust(dt) {
    if (!localPlayerShip) return;

    _forward.set(0, 0, -1).applyQuaternion(localPlayerShip.quaternion).normalize();

    let accel = 0;
    if (movementKeys.w) accel -= THRUST_ACCELERATION;   
    if (movementKeys.s) accel += REVERSE_ACCELERATION;  

    if (accel !== 0) {
        // Directly add scaled force to velocity with no extra object allocation
        velocity.addScaledVector(_forward, accel * dt);
    }
}

function handleDrag(dt) {
    const dragFactor = Math.max(0, 1 - DRAG_COEFFICIENT * dt);
    velocity.multiplyScalar(dragFactor);
}

function clampSpeed() {
    const speed = velocity.length();
    if (speed > MAX_SPEED) {
        velocity.normalize().multiplyScalar(MAX_SPEED);
    }
}

function applyPerAxisRotation(dt) {
    // Reuse static scratchpads in place
    _currentDeltaQuat.copy(currentQuaternion).invert().multiply(targetQuaternion);
    if (Math.abs(_currentDeltaQuat.w) > 0.99999) return;

    // **CRITICAL FIX**: Canonicalize quaternion hemisphere to ensure we decompose
    // via the shortest path. Prevents the Euler decomposition from picking a path
    // that's >180°, which would cause sudden ±π jumps in individual axes.
    if (_currentDeltaQuat.w < 0) {
        _currentDeltaQuat.x *= -1;
        _currentDeltaQuat.y *= -1;
        _currentDeltaQuat.z *= -1;
        _currentDeltaQuat.w *= -1;
    }

    _frameDeltaEuler.setFromQuaternion(_currentDeltaQuat, 'YXZ');

    _frameDeltaEuler.x = _normalizeAngle(_frameDeltaEuler.x);
    _frameDeltaEuler.y = _normalizeAngle(_frameDeltaEuler.y);
    _frameDeltaEuler.z = _normalizeAngle(_frameDeltaEuler.z);

    const pitchRate = _frameDeltaEuler.x > 0 ? pitchDownRate : pitchUpRate;
    const yawFactor = 1 - Math.exp(-rotationRates.yaw * dt);
    const pitchFactor = 1 - Math.exp(-pitchRate * dt);
    const rollFactor = 1 - Math.exp(-rotationRates.roll * dt);

    const maxFractionPerFrame = 0.25;
    const smoothYaw = _frameDeltaEuler.y * yawFactor;
    const smoothPitch = _frameDeltaEuler.x * pitchFactor;
    const smoothRoll = _frameDeltaEuler.z * rollFactor;

    const maxYawStep = Math.abs(_frameDeltaEuler.y) * maxFractionPerFrame;
    const maxPitchStep = Math.abs(_frameDeltaEuler.x) * maxFractionPerFrame;
    const maxRollStep = Math.abs(_frameDeltaEuler.z) * maxFractionPerFrame;

    const clampedYaw = Math.sign(smoothYaw) * Math.min(Math.abs(smoothYaw), maxYawStep);
    const clampedPitch = Math.sign(smoothPitch) * Math.min(Math.abs(smoothPitch), maxPitchStep);
    const clampedRoll = Math.sign(smoothRoll) * Math.min(Math.abs(smoothRoll), maxRollStep);

    _reducedEuler.set(clampedPitch, clampedYaw, clampedRoll, 'YXZ');
    _reducedDelta.setFromEuler(_reducedEuler);

    currentQuaternion.multiply(_reducedDelta).normalize();
    localPlayerShip.quaternion.copy(currentQuaternion);
}

// Clean tuning reset wrappers
export function setRotationRates({ yaw, pitch, roll } = {}) {
    if (typeof yaw === 'number') rotationRates.yaw = yaw;
    if (typeof pitch === 'number') rotationRates.pitch = pitch;
    if (typeof roll === 'number') rotationRates.roll = roll;
}
export function setYawRate(v) { if (typeof v === 'number') rotationRates.yaw = v; }
export function setPitchRate(v) { if (typeof v === 'number') rotationRates.pitch = v; }
export function setRollRate(v) { if (typeof v === 'number') rotationRates.roll = v; }
export function setPitchRates(upRate, downRate) {
    if (typeof upRate === 'number') pitchUpRate = upRate;
    if (typeof downRate === 'number') pitchDownRate = downRate;
}

export function resetMovement() {
    velocity.set(0, 0, 0);
    currentQuaternion.identity();
    targetQuaternion.identity();
    Object.keys(movementKeys).forEach(k => movementKeys[k] = false);
}
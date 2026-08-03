import * as THREE from 'three';
import { currentGameState, STATES } from './gameState.js';

export let camera;
export let enablePanning = false;

// --- CAMERA INTERNAL STATE ---
let isDragging = false;
let isPanning = false;
let previousMousePosition = { x: 0, y: 0 };
let _canvas = null;

const radius = 8.0;

// --- INPUT CLAMPING (prevents pointer-lock spikes from causing instant 180° flips) ---
const MAX_MOVEMENT_DELTA_PER_FRAME = 100; // px; anything larger is probably a spike
const MAX_ANGULAR_LAG = 0.6; // radians; keep orbitQuat & targetOrbitQuat within this arc
const MAX_DELTA_TIME = 0.05; // seconds; clamps GC hitches/tab switches

// Single quaternion combining pitch, yaw, and roll
const orbitQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(-0.3, 0, 0, 'YXZ')
);
const targetOrbitQuat = orbitQuat.clone();

const panTarget = new THREE.Vector3(0, 0, 0);
const targetPan = new THREE.Vector3(0, 0, 0);

export let PAN_SPEED = 33;    
export let ORBIT_SPEED = 22;  

export function setCameraSpeeds(panSpeed, orbitSpeed) {
    if (typeof panSpeed === 'number') PAN_SPEED = panSpeed;
    if (typeof orbitSpeed === 'number') ORBIT_SPEED = orbitSpeed;
}

function isPointerLocked() {
    return document.pointerLockElement === _canvas;
}

// ============================================================================
// ALLOCATION FREE SCRATCHPAD VARIABLES (Created once, reused forever)
// ============================================================================
const _localRight = new THREE.Vector3();
const _localUp = new THREE.Vector3();
const _localForward = new THREE.Vector3();

const _pitchQuat = new THREE.Quaternion();
const _yawQuat = new THREE.Quaternion();
const _rollQuat = new THREE.Quaternion();

const _cameraOffsetMat = new THREE.Vector3();
const _staticBaseEuler = new THREE.Euler(-0.3, 0, 0, 'YXZ');
const _scratchEuler = new THREE.Euler();

/**
 * Helper to smoothly rotate targetOrbitQuat around its OWN local axes (Zero Allocation)
 * Also clamps the lag between displayed and input-target quaternions to prevent
 * the slerp from ever taking a path >180°, which would cause sudden flips.
 */
function applyLocalRotation(pitch, yaw, roll) {
    // 1. Mutate directional axes in place instead of creating new instances
    _localRight.set(1, 0, 0).applyQuaternion(targetOrbitQuat);
    _localUp.set(0, 1, 0).applyQuaternion(targetOrbitQuat);
    _localForward.set(0, 0, -1).applyQuaternion(targetOrbitQuat);

    // 2. Configure pre-allocated quaternions
    _pitchQuat.setFromAxisAngle(_localRight, pitch);
    _yawQuat.setFromAxisAngle(_localUp, yaw);
    _rollQuat.setFromAxisAngle(_localForward, roll);

    // 3. Combine them via premultiplying safely
    targetOrbitQuat.premultiply(_pitchQuat);
    targetOrbitQuat.premultiply(_yawQuat);
    targetOrbitQuat.premultiply(_rollQuat);

    targetOrbitQuat.normalize();
    
    // 4. **CRITICAL FIX**: Clamp the angular distance between displayed and target
    //    to prevent the slerp interpolation from ever crossing the ambiguous π boundary.
    const angularGap = orbitQuat.angleTo(targetOrbitQuat);
    if (angularGap > MAX_ANGULAR_LAG) {
        // Pull targetOrbitQuat back toward orbitQuat so the gap is within the limit.
        // This prevents the lag from ever reaching the degenerate region where slerp
        // picks the opposite hemisphere (which reads as an instant 180° flip).
        _slerpTargetQuat.copy(targetOrbitQuat);
        targetOrbitQuat.copy(orbitQuat);
        targetOrbitQuat.slerp(_slerpTargetQuat, MAX_ANGULAR_LAG / angularGap);
    }
}

/**
 * Initializes the PerspectiveCamera and binds interaction hooks.
 */
export function initCamera(canvas) {
    _canvas = canvas;
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 3000);
    
    updateCameraPositionImmediate();

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousedown', (e) => {
        e.preventDefault();
        // Reset previousMousePosition on new drag to prevent stale state
        previousMousePosition = { x: e.clientX, y: e.clientY };
        if (e.button === 0) isDragging = true;
        else if (e.button === 2 && enablePanning) isPanning = true;
    });

    window.addEventListener('mousemove', (e) => {
        const inGameplay = currentGameState === STATES.PLAYING;
        const locked = isPointerLocked();

        if (inGameplay && locked) {
            // Clamp pointer-lock deltas to kill movement spikes (which can cause instant 180° flips)
            const dx = Math.max(-MAX_MOVEMENT_DELTA_PER_FRAME, Math.min(MAX_MOVEMENT_DELTA_PER_FRAME, e.movementX || 0));
            const dy = Math.max(-MAX_MOVEMENT_DELTA_PER_FRAME, Math.min(MAX_MOVEMENT_DELTA_PER_FRAME, e.movementY || 0));
            applyLocalRotation(-dy * 0.007, -dx * 0.007, 0);
            // IMPORTANT: Still update previousMousePosition even though we return
            previousMousePosition = { x: e.clientX, y: e.clientY };
            return;
        }

        if (!isDragging && !isPanning) {
            // Always update previousMousePosition to prevent stale position on next drag
            previousMousePosition = { x: e.clientX, y: e.clientY };
            return;
        }

        const deltaX = locked ? Math.max(-MAX_MOVEMENT_DELTA_PER_FRAME, Math.min(MAX_MOVEMENT_DELTA_PER_FRAME, e.movementX)) : (e.clientX - previousMousePosition.x);
        const deltaY = locked ? Math.max(-MAX_MOVEMENT_DELTA_PER_FRAME, Math.min(MAX_MOVEMENT_DELTA_PER_FRAME, e.movementY)) : (e.clientY - previousMousePosition.y);

        if (isDragging) {
            applyLocalRotation(-deltaY * 0.007, -deltaX * 0.007, 0);
        } else if (isPanning) {
            const factor = 0.0015 * radius;
            _localRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
            _localUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
            
            targetPan.addScaledVector(_localRight, -deltaX * factor);
            targetPan.addScaledVector(_localUp, deltaY * factor);
        }

        previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
        isPanning = false;
    });

    document.addEventListener('pointerlockchange', () => {
        if (!isPointerLocked()) {
            isDragging = false;
            isPanning = false;
            // Reset previousMousePosition when pointer lock is lost to prevent stale coordinate jump
            previousMousePosition = { x: 0, y: 0 };
        }
    });

    return camera;
}

function updateCameraPositionImmediate() {
    // Overwrite the scratch vector in-place rather than declaring `new THREE.Vector3`
    _cameraOffsetMat.set(0, 0, radius).applyQuaternion(orbitQuat);
    camera.position.copy(panTarget).add(_cameraOffsetMat);
    camera.quaternion.copy(orbitQuat);
}

export function updateCamera(deltaTime = 0.016) {
    if (!camera) return;
    
    // Clamp deltaTime to prevent massive jumps after GC pauses or tab switches
    const dt = Math.max(0, Math.min(deltaTime, MAX_DELTA_TIME));
    
    const panFactor = 1 - Math.exp(-PAN_SPEED * dt);
    const orbitFactor = 1 - Math.exp(-ORBIT_SPEED * dt);

    // **CRITICAL FIX**: Canonicalize quaternion hemisphere before slerp
    // Ensures we always interpolate via the shortest path and never flip suddenly.
    // q and -q represent the same rotation; we keep targetOrbitQuat in the same
    // hemisphere as orbitQuat so slerp doesn't accidentally negate and reverse direction.
    if (orbitQuat.dot(targetOrbitQuat) < 0) {
        targetOrbitQuat.x *= -1;
        targetOrbitQuat.y *= -1;
        targetOrbitQuat.z *= -1;
        targetOrbitQuat.w *= -1;
    }

    orbitQuat.slerp(targetOrbitQuat, orbitFactor).normalize();
    panTarget.lerp(targetPan, panFactor);
    updateCameraPositionImmediate();
}

export function resizeCamera() {
    if (!camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
}

export function setCameraPanning(allowed) {
    enablePanning = allowed;
}

export function setCameraTarget(pos) {
    targetPan.copy(pos);
}

export function applyCameraRoll(delta) {
    applyLocalRotation(0, 0, delta);
}

export function getCameraOrientation() {
    _scratchEuler.setFromQuaternion(orbitQuat, 'YXZ');
    return { theta: _scratchEuler.y, phi: Math.PI / 2 - _scratchEuler.x, roll: _scratchEuler.z };
}

export function resetCamera() {
    orbitQuat.setFromEuler(_staticBaseEuler);
    targetOrbitQuat.copy(orbitQuat);
    
    panTarget.set(0, 0, 0);
    targetPan.set(0, 0, 0);
    
    updateCameraPositionImmediate();
    console.log('[CAMERA]: Reset to menu state');
}
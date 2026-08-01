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
        previousMousePosition = { x: e.clientX, y: e.clientY };
        if (e.button === 0) isDragging = true;
        else if (e.button === 2 && enablePanning) isPanning = true;
    });

    window.addEventListener('mousemove', (e) => {
        const inGameplay = currentGameState === STATES.PLAYING;
        const locked = isPointerLocked();

        if (inGameplay && locked) {
            const dx = e.movementX || 0;
            const dy = e.movementY || 0;
            applyLocalRotation(-dy * 0.007, -dx * 0.007, 0);
            return;
        }

        if (!isDragging && !isPanning) return;

        const deltaX = locked ? e.movementX : (e.clientX - previousMousePosition.x);
        const deltaY = locked ? e.movementY : (e.clientY - previousMousePosition.y);

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
    const panFactor = 1 - Math.exp(-PAN_SPEED * deltaTime);
    const orbitFactor = 1 - Math.exp(-ORBIT_SPEED * deltaTime);

    orbitQuat.slerp(targetOrbitQuat, orbitFactor);
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
import * as THREE from 'three';

// ============================================================================
// VIKING1 RETICLE SYSTEM — Specialized reticle for Viking1 ship
// ============================================================================

const UNLOCK_RETICLE_SIZE = 75; // Size of the square corners in pixels (unlocked state)
const LOCK_RETICLE_SIZE = 55; // Size of the full square in pixels (locked state)
const CORNER_GAP_SIZE = 25; // Size of the gap in the middle of each side (unlocked state)
const LOCK_RETICLE_THICKNESS = 3; // Thickness of the outline
const LOCK_RETICLE_OPACITY = 0.4;

const GUN_INDICATOR_SIZE = 3; //  pixel squares
const GUN_INDICATOR_SPACING = 3; //  pixels between squares
const GUN_INDICATOR_OFFSET_TOP = 3; // pixels above reticle
const GUN_INDICATOR_OFFSET_LEFT = 2; // pixels from left edge
const RADAR_TARGET_INDICATOR_SIZE = 3; // Size of the radar-range alert square
const RADAR_TARGET_INDICATOR_OFFSET_RIGHT = 2; // Pixels from right edge of reticle
const HP_BAR_THICKNESS = 3; // thick line for HP bar
const HP_BAR_OFFSET = 4; // pixels from left edge of reticle square
const HP_BAR_MISSING_OPACITY = 0.5; // opacity for missing HP portion
const HP_FLASH_DURATION = 0.3; // Duration in seconds for damage flash effect
const HP_LOW_THRESHOLD = 0.3; // HP percentage threshold for permanent red color
const KILL_X_LENGTH = 20; // Length of each arm of the kill feedback X
const KILL_X_LINE_WIDTH = 4; // Thickness of the kill feedback X
const RADAR_RECTANGLE_SIZE = 30; // Size of radar target rectangles in pixels
const RADAR_RECTANGLE_OUTLINE = 3; // Outline thickness in pixels
const OFF_SCREEN_ARROW_SIZE = 26; // Size of V-shaped arrows for off-screen targets in pixels
const OFF_SCREEN_ARROW_LINE_WIDTH = 3; // Line width for V-shaped arrows
const OFF_SCREEN_ARROW_DISTANCE = 320; // Fixed distance from screen center for off-screen arrows

let viking1ReticleCanvas = null;
let viking1ReticleCtx = null;
let reticleCamera = null; // Reference to camera for world-to-screen projection

/**
 * Initialize the Viking1-specific reticle canvas overlay
 */
export function initViking1Reticle() {
    // Create canvas for the reticle
    viking1ReticleCanvas = document.createElement('canvas');
    viking1ReticleCanvas.style.position = 'fixed';
    viking1ReticleCanvas.style.top = '0';
    viking1ReticleCanvas.style.left = '0';
    viking1ReticleCanvas.style.zIndex = '10'; // Above the 3D canvas but below UI
    viking1ReticleCanvas.style.pointerEvents = 'none'; // Don't interfere with mouse events
    viking1ReticleCanvas.style.opacity = LOCK_RETICLE_OPACITY; // Apply opacity to entire canvas
    
    document.body.appendChild(viking1ReticleCanvas);
    viking1ReticleCtx = viking1ReticleCanvas.getContext('2d', { antialias: false });
    
    // Disable image smoothing for pixel-perfect rendering
    viking1ReticleCtx.imageSmoothingEnabled = false;
    
    // Set initial size
    resizeViking1Reticle();
}

/**
 * Set the camera reference for world-to-screen projection
 * @param {THREE.Camera} camera - The camera to use for projection
 */
export function setReticleCamera(camera) {
    reticleCamera = camera;
}

/**
 * Convert a 3D world position to 2D screen coordinates
 * @param {THREE.Vector3} worldPos - Position in world space
 * @param {THREE.Camera} camera - The camera to use for projection
 * @param {boolean} allowBehindCamera - If true, return position even if behind camera
 * @returns {Object|null} { x, y, behindCamera } in screen space or null if invalid
 */
export function projectWorldToScreen(worldPos, camera, allowBehindCamera = false) {
    if (!camera) return null;
    
    const vector = worldPos.clone();
    const widthHalf = viking1ReticleCanvas.width / 2;
    const heightHalf = viking1ReticleCanvas.height / 2;
    
    vector.project(camera);
    
    vector.x = (vector.x * widthHalf) + widthHalf;
    vector.y = -(vector.y * heightHalf) + heightHalf;
    
    const behindCamera = vector.z > 1;
    
    // If behind camera and not allowed, return null
    if (behindCamera && !allowBehindCamera) {
        return null;
    }
    
    return {
        x: Math.round(vector.x),
        y: Math.round(vector.y),
        behindCamera: behindCamera
    };
}

/**
 * Get a stable off-screen arrow direction from a world position.
 * Uses camera-space coordinates and avoids unstable projection near the camera plane.
 * @param {THREE.Vector3} worldPos - Target world position
 * @param {THREE.Camera} camera - Camera used for projection
 * @returns {Object|null} { dirX, dirY, angle } where dirX/dirY are normalized screen directions.
 */
function getArrowDirection(worldPos, camera) {
    if (!worldPos || !camera || !viking1ReticleCanvas) return null;

    const cameraSpacePos = worldPos.clone();
    camera.worldToLocal(cameraSpacePos);

    // In camera space, +Y is up. In screen space, +Y is down.
    let dirX = cameraSpacePos.x;
    let dirY = -cameraSpacePos.y;

    const length = Math.hypot(dirX, dirY);
    if (length === 0) {
        dirX = 0;
        dirY = -1;
    } else {
        dirX /= length;
        dirY /= length;
    }

    return {
        dirX,
        dirY,
        angle: Math.atan2(dirY, dirX)
    };
}

/**
 * Calculate the edge-clamped position and direction angle for an off-screen target.
 * @param {number} dirX - Normalized X direction in screen space
 * @param {number} dirY - Normalized Y direction in screen space
 * @returns {Object} { clampedX, clampedY, angle }
 */
function calculateOffScreenArrowPositionFromDirection(dirX, dirY) {
    const centerX = viking1ReticleCanvas.width / 2;
    const centerY = viking1ReticleCanvas.height / 2;

    const clampedX = centerX + dirX * OFF_SCREEN_ARROW_DISTANCE;
    const clampedY = centerY + dirY * OFF_SCREEN_ARROW_DISTANCE;

    return {
        clampedX: Math.max(0, Math.min(viking1ReticleCanvas.width, clampedX)),
        clampedY: Math.max(0, Math.min(viking1ReticleCanvas.height, clampedY)),
        angle: Math.atan2(dirY, dirX)
    };
}

/**
 * Resize the Viking1 reticle canvas to match window size
 */
export function resizeViking1Reticle() {
    if (!viking1ReticleCanvas) return;
    viking1ReticleCanvas.width = window.innerWidth;
    viking1ReticleCanvas.height = window.innerHeight;
}

/**
 * Clear the Viking1 reticle canvas without drawing anything
 */
export function clearViking1Reticle() {
    if (!viking1ReticleCtx || !viking1ReticleCanvas) return;
    viking1ReticleCtx.clearRect(0, 0, viking1ReticleCanvas.width, viking1ReticleCanvas.height);
}

/**
 * Draw the Viking1 reticle with target lock square and gun indicators
 * @param {boolean} cameraInLock - Whether a target is within camera's lock cone
 * @param {boolean} shipInLock - Whether a target is within ship's lock cone
 * @param {Array} weaponState - Array of weapon objects with canFire() method
 * @param {boolean} hasRadarTargetInRange - Whether any targetable enemy ship is within radar range
 * @param {number} hpPercent - Current HP as percentage (0-1), default 1.0
 * @param {number} lastDamageTime - Timestamp of last damage taken (in seconds), default -Infinity
 * @param {boolean} killFeedbackVisible - Whether the kill feedback X should be shown
 */
export function drawViking1Reticle(cameraInLock, shipInLock, weaponState = null, hasRadarTargetInRange = false, hpPercent = 1.0, lastDamageTime = -Infinity, killFeedbackVisible = false) {
    if (!viking1ReticleCtx || !viking1ReticleCanvas) return;
    
    // Clear canvas
    viking1ReticleCtx.clearRect(0, 0, viking1ReticleCanvas.width, viking1ReticleCanvas.height);
    
    // Calculate center of screen with pixel-perfect alignment
    const centerX = Math.round(viking1ReticleCanvas.width / 2);
    const centerY = Math.round(viking1ReticleCanvas.height / 2);
    
    // Determine lock state and color:
    // - If ship is locked (fully locked): red full square
    // - If camera is locked (targeting): red with corner gaps
    // - If neither locked: white with corner gaps
    const isFullyLocked = shipInLock;
    const isTargeting = cameraInLock;
    const reticleColor = (isTargeting || isFullyLocked) ? 'rgba(255, 0, 0, 1)' : 'rgba(138, 138, 138, 1)'; // Red if targeting/locked, gray if not
    
    // ========================================================================
    // DRAW MAIN RETICLE SQUARE
    // ========================================================================
    // Skip drawing reticle elements if kill feedback is visible
    if (!killFeedbackVisible) {
        viking1ReticleCtx.strokeStyle = reticleColor;
        viking1ReticleCtx.lineWidth = LOCK_RETICLE_THICKNESS;
        viking1ReticleCtx.lineCap = 'butt'; // Square caps
        viking1ReticleCtx.lineJoin = 'bevel'; // Bevel join to prevent miter artifacts
        
        if (isFullyLocked) {
        // LOCKED STATE: Draw a full square (smaller size)
        const halfSize = LOCK_RETICLE_SIZE / 2;
        // Offset by 0.5 to align lines to pixel grid and eliminate anti-aliasing
        const x1 = Math.round(centerX - halfSize) + 0.5;
        const y1 = Math.round(centerY - halfSize) + 0.5;
        const x2 = Math.round(centerX + halfSize) + 0.5;
        const y2 = Math.round(centerY + halfSize) + 0.5;
        
        // Extend lines only slightly to create clean corners without protruding
        const ext = LOCK_RETICLE_THICKNESS / 2;
        
        // Draw full square - top line
        viking1ReticleCtx.beginPath();
        viking1ReticleCtx.moveTo(x1 - ext, y1);
        viking1ReticleCtx.lineTo(x2 + ext, y1);
        viking1ReticleCtx.stroke();
        
        // Right line
        viking1ReticleCtx.beginPath();
        viking1ReticleCtx.moveTo(x2, y1 - ext);
        viking1ReticleCtx.lineTo(x2, y2 + ext);
        viking1ReticleCtx.stroke();
        
        // Bottom line
        viking1ReticleCtx.beginPath();
        viking1ReticleCtx.moveTo(x2 + ext, y2);
        viking1ReticleCtx.lineTo(x1 - ext, y2);
        viking1ReticleCtx.stroke();
        
        // Left line
        viking1ReticleCtx.beginPath();
        viking1ReticleCtx.moveTo(x1, y2 + ext);
        viking1ReticleCtx.lineTo(x1, y1 - ext);
        viking1ReticleCtx.stroke();
    } else {
        // UNLOCKED STATE: Draw four separate corners with gaps in the middle
        const halfSize = UNLOCK_RETICLE_SIZE / 2;
        // Offset by 0.5 to align lines to pixel grid and eliminate anti-aliasing
        const x1 = Math.round(centerX - halfSize) + 0.5;
        const y1 = Math.round(centerY - halfSize) + 0.5;
        const x2 = Math.round(centerX + halfSize) + 0.5;
        const y2 = Math.round(centerY + halfSize) + 0.5;
        
        // Calculate the start and end points for each line segment with gaps
        const gapHalf = CORNER_GAP_SIZE / 2 + 0.5;
        const midX = centerX;
        const midY = centerY;
        
        const ext = LOCK_RETICLE_THICKNESS / 2;
        
        // TOP LINE - Left segment and right segment with gap in middle
        viking1ReticleCtx.beginPath();
        viking1ReticleCtx.moveTo(x1 - ext, y1);
        viking1ReticleCtx.lineTo(midX - gapHalf, y1);
        viking1ReticleCtx.stroke();
        
        viking1ReticleCtx.beginPath();
        viking1ReticleCtx.moveTo(midX + gapHalf, y1);
        viking1ReticleCtx.lineTo(x2 + ext, y1);
        viking1ReticleCtx.stroke();
        
        // RIGHT LINE - Top segment and bottom segment with gap in middle
        viking1ReticleCtx.beginPath();
        viking1ReticleCtx.moveTo(x2, y1 - ext);
        viking1ReticleCtx.lineTo(x2, midY - gapHalf);
        viking1ReticleCtx.stroke();
        
        viking1ReticleCtx.beginPath();
        viking1ReticleCtx.moveTo(x2, midY + gapHalf);
        viking1ReticleCtx.lineTo(x2, y2 + ext);
        viking1ReticleCtx.stroke();
        
        // BOTTOM LINE - Right segment and left segment with gap in middle
        viking1ReticleCtx.beginPath();
        viking1ReticleCtx.moveTo(x2 + ext, y2);
        viking1ReticleCtx.lineTo(midX + gapHalf, y2);
        viking1ReticleCtx.stroke();
        
        viking1ReticleCtx.beginPath();
        viking1ReticleCtx.moveTo(midX - gapHalf, y2);
        viking1ReticleCtx.lineTo(x1 - ext, y2);
        viking1ReticleCtx.stroke();
        
        // LEFT LINE - Bottom segment and top segment with gap in middle
        viking1ReticleCtx.beginPath();
        viking1ReticleCtx.moveTo(x1, y2 + ext);
        viking1ReticleCtx.lineTo(x1, midY + gapHalf);
        viking1ReticleCtx.stroke();
        
        viking1ReticleCtx.beginPath();
        viking1ReticleCtx.moveTo(x1, midY - gapHalf);
        viking1ReticleCtx.lineTo(x1, y1 - ext);
        viking1ReticleCtx.stroke();
        }
    }

    // ========================================================================
    // DRAW KILL FEEDBACK X
    // ========================================================================
    if (killFeedbackVisible) {
        viking1ReticleCtx.save();
        viking1ReticleCtx.strokeStyle = 'rgba(255, 0, 0, 1)';
        viking1ReticleCtx.lineWidth = KILL_X_LINE_WIDTH;
        viking1ReticleCtx.lineCap = 'round';
        viking1ReticleCtx.beginPath();
        viking1ReticleCtx.moveTo(centerX - KILL_X_LENGTH, centerY - KILL_X_LENGTH);
        viking1ReticleCtx.lineTo(centerX + KILL_X_LENGTH, centerY + KILL_X_LENGTH);
        viking1ReticleCtx.moveTo(centerX + KILL_X_LENGTH, centerY - KILL_X_LENGTH);
        viking1ReticleCtx.lineTo(centerX - KILL_X_LENGTH, centerY + KILL_X_LENGTH);
        viking1ReticleCtx.stroke();
        viking1ReticleCtx.restore();
    }

    // ========================================================================
    // DRAW GUN INDICATOR SQUARES
    // ========================================================================
    if (!killFeedbackVisible && weaponState && Array.isArray(weaponState) && weaponState.length > 0) {
        // Calculate reticle position for gun indicators (based on unlocked size)
        const gunIndicatorHalfSize = isFullyLocked 
            ? LOCK_RETICLE_SIZE / 2 
            : UNLOCK_RETICLE_SIZE / 2;
        const gunIndicatorX1 = Math.round(centerX - gunIndicatorHalfSize) + 0.5;
        const gunIndicatorY1 = Math.round(centerY - gunIndicatorHalfSize) + 0.5;
        
        // Get the top-left corner of the main reticle
        const reticleTopLeftX = gunIndicatorX1 - 0.5;
        const reticleTopLeftY = gunIndicatorY1 - 1.5;
        
        // Calculate gun indicator positions
        const gunIndicatorY = reticleTopLeftY - GUN_INDICATOR_OFFSET_TOP*2;
        let gunIndicatorX = reticleTopLeftX + GUN_INDICATOR_OFFSET_LEFT;
        
        // Draw each gun indicator
        for (let i = 0; i < Math.min(weaponState.length, 2); i++) {
            const weapon = weaponState[i];
            const canFire = weapon.canFire(performance.now() / 1000);
            
            // Set opacity: 100% when ready, 50% when on cooldown
            const opacity = canFire ? 1.0 : 0.5;
            
            // Draw filled square for gun indicator
            viking1ReticleCtx.fillStyle = reticleColor.replace('1)', `${opacity})`);
            viking1ReticleCtx.fillRect(gunIndicatorX, gunIndicatorY, GUN_INDICATOR_SIZE, GUN_INDICATOR_SIZE);
            
            // Move to next gun position
            gunIndicatorX += GUN_INDICATOR_SIZE + GUN_INDICATOR_SPACING;
        }
    }

    // Draw the radar-range alert square at the top-right above the reticle.
    if (hasRadarTargetInRange) {
        const currentReticleSize = isFullyLocked ? LOCK_RETICLE_SIZE : UNLOCK_RETICLE_SIZE;
        const currentReticleHalfSize = currentReticleSize / 2;
        const reticleTopRightX = Math.round(centerX + currentReticleHalfSize);
        const reticleTopY = Math.round(centerY - currentReticleHalfSize) - 1.0;
        const targetIndicatorX = reticleTopRightX - RADAR_TARGET_INDICATOR_OFFSET_RIGHT - RADAR_TARGET_INDICATOR_SIZE;
        const targetIndicatorY = reticleTopY - GUN_INDICATOR_OFFSET_TOP * 2;

        viking1ReticleCtx.fillStyle = 'rgba(255, 0, 0, 1)';
        viking1ReticleCtx.fillRect(
            targetIndicatorX,
            targetIndicatorY,
            RADAR_TARGET_INDICATOR_SIZE,
            RADAR_TARGET_INDICATOR_SIZE
        );
    }

    // ========================================================================
    // DRAW HP INDICATOR BAR
    // ========================================================================
    // Skip drawing HP bar if kill feedback is visible
    if (!killFeedbackVisible) {
    // Calculate the current reticle size (changes between locked and unlocked states)
    const currentReticleSize = isFullyLocked ? LOCK_RETICLE_SIZE : UNLOCK_RETICLE_SIZE;
    const reticleHalfSize = currentReticleSize / 2;
    
    // Calculate reticle square boundaries
    const barReticleX1 = Math.round(centerX - reticleHalfSize);
    const barReticleY1 = Math.round(centerY - reticleHalfSize) +2;
    const barReticleY2 = Math.round(centerY + reticleHalfSize) -1;
    
    // Position HP bar to the left of the reticle square
    const barLeftX = barReticleX1 - HP_BAR_OFFSET - HP_BAR_THICKNESS;
    const barTopY = barReticleY1;
    const barBottomY = barReticleY2;
    const barFullHeight = barBottomY - barTopY;
    
    // Calculate how many pixels should be filled (present HP)
    const presentHpHeight = Math.round(barFullHeight * Math.max(0, Math.min(1, hpPercent)));
    const missingHpHeight = barFullHeight - presentHpHeight;
    
    // Determine HP bar color based on damage flash and low HP threshold
    const currentTime = performance.now() / 1000;
    const timeSinceDamage = currentTime - lastDamageTime;
    const isInDamageFlash = timeSinceDamage < HP_FLASH_DURATION;
    const isLowHP = hpPercent < HP_LOW_THRESHOLD;
    
    // HP bar should be red if: low HP (permanent) OR recently damaged (flash effect)
    const shouldBarBeRed = isLowHP || isInDamageFlash;
    const hpBarColor = shouldBarBeRed ? 'rgba(255, 0, 0, 1)' : reticleColor;
    
    // Draw present HP (full opacity, uses red if low HP or flash, otherwise reticle color)
    if (presentHpHeight > 0) {
        viking1ReticleCtx.fillStyle = hpBarColor.replace('1)', '1.0)'); // Full opacity
        viking1ReticleCtx.fillRect(
            barLeftX,
            barBottomY - presentHpHeight,  // Draw from bottom upward
            HP_BAR_THICKNESS,
            presentHpHeight
        );
    }
    
    // Draw missing HP (reduced opacity, same color as present HP)
    if (missingHpHeight > 0) {
        viking1ReticleCtx.fillStyle = hpBarColor.replace('1)', `${HP_BAR_MISSING_OPACITY})`);
        viking1ReticleCtx.fillRect(
            barLeftX,
            barTopY,
            HP_BAR_THICKNESS,
            missingHpHeight
        );
    }
    }
}

/**
 * Check if a screen position is within the screen bounds
 * @param {number} x - Screen X coordinate
 * @param {number} y - Screen Y coordinate
 * @returns {boolean} True if position is on-screen
 */
function isPositionOnScreen(x, y) {
    return x >= 0 && x <= viking1ReticleCanvas.width && y >= 0 && y <= viking1ReticleCanvas.height;
}

function drawCorneredRadarRectangle(x1, y1, x2, y2) {
    const cornerGap = 8;
    const sizeGrow = 4;
    x1 -= sizeGrow / 2;
    y1 -= sizeGrow / 2;
    x2 += sizeGrow / 2;
    y2 += sizeGrow / 2;

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    // Top segments
    viking1ReticleCtx.beginPath();
    viking1ReticleCtx.moveTo(x1, y1);
    viking1ReticleCtx.lineTo(midX - cornerGap, y1);
    viking1ReticleCtx.stroke();

    viking1ReticleCtx.beginPath();
    viking1ReticleCtx.moveTo(midX + cornerGap, y1);
    viking1ReticleCtx.lineTo(x2, y1);
    viking1ReticleCtx.stroke();

    // Right segments
    viking1ReticleCtx.beginPath();
    viking1ReticleCtx.moveTo(x2, y1);
    viking1ReticleCtx.lineTo(x2, midY - cornerGap);
    viking1ReticleCtx.stroke();

    viking1ReticleCtx.beginPath();
    viking1ReticleCtx.moveTo(x2, midY + cornerGap);
    viking1ReticleCtx.lineTo(x2, y2);
    viking1ReticleCtx.stroke();

    // Bottom segments
    viking1ReticleCtx.beginPath();
    viking1ReticleCtx.moveTo(x2, y2);
    viking1ReticleCtx.lineTo(midX + cornerGap, y2);
    viking1ReticleCtx.stroke();

    viking1ReticleCtx.beginPath();
    viking1ReticleCtx.moveTo(midX - cornerGap, y2);
    viking1ReticleCtx.lineTo(x1, y2);
    viking1ReticleCtx.stroke();

    // Left segments
    viking1ReticleCtx.beginPath();
    viking1ReticleCtx.moveTo(x1, y2);
    viking1ReticleCtx.lineTo(x1, midY + cornerGap);
    viking1ReticleCtx.stroke();

    viking1ReticleCtx.beginPath();
    viking1ReticleCtx.moveTo(x1, midY - cornerGap);
    viking1ReticleCtx.lineTo(x1, y1);
    viking1ReticleCtx.stroke();
}

/**
 * Calculate the edge-clamped position and direction angle for an off-screen target
 * @param {number} x - Original screen X coordinate
 * @param {number} y - Original screen Y coordinate
 * @returns {Object} { clampedX, clampedY, angle } representing edge position and direction
 */
function calculateOffScreenArrowPosition(x, y) {
    const centerX = viking1ReticleCanvas.width / 2;
    const centerY = viking1ReticleCanvas.height / 2;

    // Calculate normalized direction from screen center toward the target direction.
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.hypot(dx, dy);
    const dirX = distance > 0 ? dx / distance : 0;
    const dirY = distance > 0 ? dy / distance : -1;
    const angle = Math.atan2(dirY, dirX);

    const clampedX = centerX + dirX * OFF_SCREEN_ARROW_DISTANCE;
    const clampedY = centerY + dirY * OFF_SCREEN_ARROW_DISTANCE;

    return {
        clampedX: Math.max(0, Math.min(viking1ReticleCanvas.width, clampedX)),
        clampedY: Math.max(0, Math.min(viking1ReticleCanvas.height, clampedY)),
        angle
    };
}

/**
 * Draw an L-shaped arrow with a right angle pointing in a given direction
 * @param {number} x - Center X coordinate of arrow (at screen edge)
 * @param {number} y - Center Y coordinate of arrow (at screen edge)
 * @param {number} angle - Direction angle in radians (pointing toward target)
 */
function drawOffScreenArrow(x, y, angle) {
    // Draw a right-angled V shape with its vertex at the screen edge.
    // Reverse the angle so the V points away from the center toward the off-screen target.
    const armLength = OFF_SCREEN_ARROW_SIZE;
    const halfRightAngle = Math.PI / 4; // 45 degrees from the bisector for a 90° V
    const bisectorAngle = angle + Math.PI;

    const arm1Angle = bisectorAngle - halfRightAngle;
    const arm2Angle = bisectorAngle + halfRightAngle;

    const arm1X = x + Math.cos(arm1Angle) * armLength;
    const arm1Y = y + Math.sin(arm1Angle) * armLength;
    const arm2X = x + Math.cos(arm2Angle) * armLength;
    const arm2Y = y + Math.sin(arm2Angle) * armLength;

    viking1ReticleCtx.strokeStyle = 'rgba(255, 0, 0, 1)';
    viking1ReticleCtx.lineWidth = OFF_SCREEN_ARROW_LINE_WIDTH;
    viking1ReticleCtx.lineCap = 'square';
    viking1ReticleCtx.lineJoin = 'miter';

    viking1ReticleCtx.beginPath();
    viking1ReticleCtx.moveTo(x, y);
    viking1ReticleCtx.lineTo(arm1X, arm1Y);
    viking1ReticleCtx.moveTo(x, y);
    viking1ReticleCtx.lineTo(arm2X, arm2Y);
    viking1ReticleCtx.stroke();
}

/**
 * Draw radar target rectangles for all enemies within radar range
 * @param {Array} radarTargets - Array of objects with { screenPos: {x, y}, alive: boolean }
 */
export function drawRadarRectangles(radarTargets = []) {

    if (!viking1ReticleCtx || !viking1ReticleCanvas || !radarTargets || radarTargets.length === 0) {
        return;
    }
    
    // Save canvas context state to avoid affecting future draws
    viking1ReticleCtx.save();
    
    viking1ReticleCtx.strokeStyle = 'rgba(255, 0, 0, 1)'; // Red rectangles
    viking1ReticleCtx.lineWidth = RADAR_RECTANGLE_OUTLINE;
    viking1ReticleCtx.lineCap = 'square';
    viking1ReticleCtx.lineJoin = 'miter';
    
    const halfSize = RADAR_RECTANGLE_SIZE / 2;
    
    for (const target of radarTargets) {
        if (!target.screenPos) continue;
        
        const x = target.screenPos.x;
        const y = target.screenPos.y;
        const behindCamera = target.screenPos.behindCamera || false;
        const shouldUseArrow = !isPositionOnScreen(x, y) || behindCamera;
        
        if (!shouldUseArrow) {
            // Draw rectangle centered on the target position for on-screen, front-facing targets only
            const x1 = Math.round(x - halfSize) + 0.5;
            const y1 = Math.round(y - halfSize) + 0.5;
            const x2 = Math.round(x + halfSize) + 0.5;
            const y2 = Math.round(y + halfSize) + 0.5;
            const shouldDrawCornered = !target.hasLineOfSight || !target.isWithinWeaponRange;

            if (shouldDrawCornered) {
                drawCorneredRadarRectangle(x1, y1, x2, y2);
            } else {
                viking1ReticleCtx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            }
        } else {
            // Draw directional arrow for off-screen targets or behind-camera targets
            const arrowDirection = target.worldPosition && reticleCamera
                ? getArrowDirection(target.worldPosition, reticleCamera)
                : null;
            let arrowData;
            if (arrowDirection) {
                arrowData = calculateOffScreenArrowPositionFromDirection(arrowDirection.dirX, arrowDirection.dirY);
            } else {
                const dx = x - viking1ReticleCanvas.width / 2;
                const dy = y - viking1ReticleCanvas.height / 2;
                const distance = Math.hypot(dx, dy);
                const dirX = distance > 0 ? dx / distance : 0;
                const dirY = distance > 0 ? dy / distance : -1;
                arrowData = calculateOffScreenArrowPositionFromDirection(dirX, dirY);
            }
            drawOffScreenArrow(arrowData.clampedX, arrowData.clampedY, arrowData.angle);
        }
    }
    
    // Restore canvas context state
    viking1ReticleCtx.restore();
}

/**
 * Clean up and destroy the Viking1 reticle canvas
 */
export function destroyViking1Reticle() {
    if (viking1ReticleCanvas) {
        viking1ReticleCanvas.remove();
        viking1ReticleCanvas = null;
        viking1ReticleCtx = null;
    }
}

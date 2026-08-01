import { getAvailableShipTypes, getShipPreset } from '../core/shipPresets.js';
import { gameState } from '../gameState.js';

/**
 * Ship Selector UI
 * Manages the ship selection interface on the menu screen.
 * Displays ship name, stats, and navigation arrows.
 */

let currentShipIndex = 0;
let availableShips = [];
let shipSelectorContainer = null;
let shipNameElement = null;
let statsPanel = null;
let leftArrow = null;
let rightArrow = null;

export function initShipSelector() {
    availableShips = getAvailableShipTypes();
    currentShipIndex = 0;

    // Create the ship selector UI container
    createShipSelectorUI();
    
    // Store selected ship in gameState
    updateSelectedShip();
}

function createShipSelectorUI() {
    // Remove if already exists
    const existing = document.getElementById('ship-selector-container');
    if (existing) existing.remove();

    // Main container
    shipSelectorContainer = document.createElement('div');
    shipSelectorContainer.id = 'ship-selector-container';
    shipSelectorContainer.classList.add('ship-selector');

    // Left Arrow
    leftArrow = document.createElement('button');
    leftArrow.id = 'ship-selector-left';
    leftArrow.classList.add('ship-selector-arrow', 'ship-selector-arrow-left');
    leftArrow.textContent = '<';
    leftArrow.addEventListener('click', navigateToPreviousShip);
    leftArrow.addEventListener('mouseenter', () => { leftArrow.textContent = '<<'; });
    leftArrow.addEventListener('mouseleave', () => { leftArrow.textContent = '<'; });

    // Ship Name Display
    shipNameElement = document.createElement('div');
    shipNameElement.id = 'ship-selector-name';
    shipNameElement.classList.add('ship-selector-name');
    shipNameElement.textContent = getShipPreset(availableShips[currentShipIndex])?.displayName || 'Unknown Ship';

    // Right Arrow
    rightArrow = document.createElement('button');
    rightArrow.id = 'ship-selector-right';
    rightArrow.classList.add('ship-selector-arrow', 'ship-selector-arrow-right');
    rightArrow.textContent = '>';
    rightArrow.addEventListener('click', navigateToNextShip);
    rightArrow.addEventListener('mouseenter', () => { rightArrow.textContent = '>>'; });
    rightArrow.addEventListener('mouseleave', () => { rightArrow.textContent = '>'; });

    // Stats Panel
    statsPanel = document.createElement('div');
    statsPanel.id = 'ship-selector-stats';
    statsPanel.classList.add('ship-selector-stats');
    updateStatsPanel();

    // Assemble the container
    shipSelectorContainer.appendChild(leftArrow);
    shipSelectorContainer.appendChild(shipNameElement);
    shipSelectorContainer.appendChild(rightArrow);
    shipSelectorContainer.appendChild(statsPanel);

    // Add to the body
    document.body.appendChild(shipSelectorContainer);

    // Update arrow states
    updateArrowStates();
}

function updateStatsPanel() {
    if (!statsPanel) return;

    const currentShipType = availableShips[currentShipIndex];
    const shipPreset = getShipPreset(currentShipType);
    
    if (!shipPreset || !shipPreset.lore) {
        statsPanel.innerHTML = '<p>No lore available</p>';
        return;
    }

    const lore = shipPreset.lore;
    
    // Display lore as plain text
    statsPanel.innerHTML = lore;
}

function updateArrowStates() {
    if (!leftArrow || !rightArrow) return;

    const isOnlyOneShip = availableShips.length <= 1;
    
    if (isOnlyOneShip) {
        leftArrow.classList.add('disabled');
        rightArrow.classList.add('disabled');
        leftArrow.disabled = true;
        rightArrow.disabled = true;
    } else {
        leftArrow.classList.remove('disabled');
        rightArrow.classList.remove('disabled');
        leftArrow.disabled = false;
        rightArrow.disabled = false;
    }
}

function navigateToPreviousShip() {
    if (availableShips.length <= 1) return;
    currentShipIndex = (currentShipIndex - 1 + availableShips.length) % availableShips.length;
    updateDisplay();
}

function navigateToNextShip() {
    if (availableShips.length <= 1) return;
    currentShipIndex = (currentShipIndex + 1) % availableShips.length;
    updateDisplay();
}

function updateDisplay() {
    updateShipName();
    updateStatsPanel();
    updateSelectedShip();
}

function updateShipName() {
    if (!shipNameElement) return;
    const currentShipType = availableShips[currentShipIndex];
    shipNameElement.textContent = getShipPreset(currentShipType)?.displayName || 'Unknown Ship';
}

function updateSelectedShip() {
    const selectedShipType = availableShips[currentShipIndex];
    gameState.players = gameState.players || {};
    gameState.selectedShipType = selectedShipType;
    console.log(`[SHIP SELECTOR]: Selected ship: ${selectedShipType}`);
}

export function getSelectedShipType() {
    if (availableShips.length === 0) return 'viking1';
    return availableShips[currentShipIndex];
}

export function navigateShipSelection(direction) {
    if (direction === 'left') {
        navigateToPreviousShip();
    } else if (direction === 'right') {
        navigateToNextShip();
    }
}

export function destroyShipSelector() {
    if (shipSelectorContainer) {
        shipSelectorContainer.remove();
        shipSelectorContainer = null;
        shipNameElement = null;
        statsPanel = null;
        leftArrow = null;
        rightArrow = null;
    }
}

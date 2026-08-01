/**
 * Debug UI overlay for real-time control of scene parameters
 */

let debugPanel = null;
let isDebugVisible = false;

export function initDebugUI() {
    createDebugPanel();
    
    // Toggle debug panel with Ctrl+D
    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key === 'd') {
            toggleDebugPanel();
        }
    });

    console.log('[DEBUG UI]: Initialized. Press Ctrl+D to toggle.');
}

function createDebugPanel() {
    // Create container
    debugPanel = document.createElement('div');
    debugPanel.id = 'debug-panel';
    debugPanel.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        width: 300px;
        background: rgba(25, 25, 28, 0.75);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border-radius: 10px;
        padding: 15px;
        font-family: monospace;
        font-size: 12px;
        color: #00ff88;
        z-index: 1000;
        max-height: 600px;
        overflow-y: auto;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    `;

    // Title
    const title = document.createElement('div');
    title.style.cssText = `
        font-weight: bold;
        margin-bottom: 10px;
        border-bottom: 1px solid rgba(0, 255, 136, 0.3);
        padding-bottom: 5px;
        color: #00ff88;
    `;
    title.textContent = '⚙️ DEBUG PANEL (Ctrl+D)';
    debugPanel.appendChild(title);

    // Content container (will be populated by controller)
    const content = document.createElement('div');
    content.id = 'debug-content';
    debugPanel.appendChild(content);

    // Hide by default
    debugPanel.style.display = 'none';
    document.body.appendChild(debugPanel);
}

export function toggleDebugPanel() {
    isDebugVisible = !isDebugVisible;
    debugPanel.style.display = isDebugVisible ? 'block' : 'none';
}

export function addDebugDisplay(label, initialValue) {
    const content = document.getElementById('debug-content');
    
    const display = document.createElement('div');
    display.style.cssText = `
        margin-bottom: 12px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(0, 255, 136, 0.15);
    `;
    display.id = `debug-display-${label.replace(/\s+/g, '-')}`;

    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'margin-bottom: 5px; color: #00ff88;';
    labelEl.textContent = label + ':';
    display.appendChild(labelEl);

    const valueEl = document.createElement('div');
    valueEl.style.cssText = 'color: #00ff88; font-family: monospace; font-size: 14px;';
    valueEl.textContent = initialValue;
    valueEl.id = `debug-display-value-${label.replace(/\s+/g, '-')}`;
    display.appendChild(valueEl);

    content.appendChild(display);
    return valueEl;
}

export function updateDebugDisplay(label, value) {
    const valueEl = document.getElementById(`debug-display-value-${label.replace(/\s+/g, '-')}`);
    if (valueEl) {
        valueEl.textContent = value;
    }
}

export function addDebugControl(label, type, initialValue, onChange) {
    const content = document.getElementById('debug-content');
    
    const control = document.createElement('div');
    control.style.cssText = `
        margin-bottom: 12px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(0, 255, 136, 0.15);
    `;

    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'margin-bottom: 5px; color: #00ff88;';
    labelEl.textContent = label + ':';
    control.appendChild(labelEl);

    if (type === 'slider') {
        const sliderContainer = document.createElement('div');
        sliderContainer.style.cssText = 'display: flex; gap: 5px; align-items: center;';

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.min = initialValue.min;
        slider.max = initialValue.max;
        slider.step = initialValue.step || 0.01;
        slider.value = initialValue.value;
        slider.style.cssText = 'flex: 1; cursor: pointer; accent-color: #00ff88;';

        const valueDisplay = document.createElement('span');
        valueDisplay.style.cssText = 'min-width: 50px; text-align: right; color: #00ff88;';
        valueDisplay.textContent = parseFloat(slider.value).toFixed(2);

        slider.addEventListener('input', (e) => {
            valueDisplay.textContent = parseFloat(e.target.value).toFixed(2);
            onChange(parseFloat(e.target.value));
        });

        sliderContainer.appendChild(slider);
        sliderContainer.appendChild(valueDisplay);
        control.appendChild(sliderContainer);
    } else if (type === 'color') {
        const colorContainer = document.createElement('div');
        colorContainer.style.cssText = 'display: flex; gap: 5px; align-items: center;';

        const colorInput = document.createElement('input');
        colorInput.type = 'color';
        colorInput.value = initialValue;
        colorInput.style.cssText = 'width: 40px; height: 30px; cursor: pointer; border: 1px solid rgba(0, 255, 136, 0.3); border-radius: 5px;';

        const hexDisplay = document.createElement('span');
        hexDisplay.style.cssText = 'flex: 1; color: #00ff88; font-family: monospace;';
        hexDisplay.textContent = initialValue.toUpperCase();

        colorInput.addEventListener('input', (e) => {
            hexDisplay.textContent = e.target.value.toUpperCase();
            onChange(e.target.value);
        });

        colorContainer.appendChild(colorInput);
        colorContainer.appendChild(hexDisplay);
        control.appendChild(colorContainer);
    } else if (type === 'vector3') {
        const vectorContainer = document.createElement('div');
        vectorContainer.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 3px;';

        ['X', 'Y', 'Z'].forEach((axis, i) => {
            const input = document.createElement('input');
            input.type = 'number';
            input.step = 0.1;
            input.value = initialValue[i];
            input.placeholder = axis;
            input.style.cssText = `
                padding: 2px 3px;
                background: rgba(25, 25, 28, 0.5);
                border: 1px solid rgba(0, 255, 136, 0.3);
                color: #00ff88;
                border-radius: 5px;
                font-family: monospace;
                font-size: 12px;
                height: 22px;
                width: 12ch;
                text-align: center;
            `;

            input.addEventListener('input', (e) => {
                const values = [
                    parseFloat(vectorContainer.children[0].value),
                    parseFloat(vectorContainer.children[1].value),
                    parseFloat(vectorContainer.children[2].value)
                ];
                onChange(values);
            });

            vectorContainer.appendChild(input);
        });

        control.appendChild(vectorContainer);
    } else if (type === 'checkbox') {
        const checkboxContainer = document.createElement('div');
        checkboxContainer.style.cssText = 'display: flex; gap: 8px; align-items: center;';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = initialValue;
        checkbox.style.cssText = 'width: 16px; height: 16px; cursor: pointer; accent-color: #00ff88;';

        const statusDisplay = document.createElement('span');
        statusDisplay.style.cssText = 'color: #00ff88; font-size: 12px;';
        statusDisplay.textContent = initialValue ? 'ON' : 'OFF';

        checkbox.addEventListener('change', (e) => {
            statusDisplay.textContent = e.target.checked ? 'ON' : 'OFF';
            onChange(e.target.checked);
        });

        checkboxContainer.appendChild(checkbox);
        checkboxContainer.appendChild(statusDisplay);
        control.appendChild(checkboxContainer);
    }

    content.appendChild(control);
}

export function clearDebugControls() {
    const content = document.getElementById('debug-content');
    if (content) {
        content.innerHTML = '';
    }
}

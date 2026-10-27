/**
 * Main Application Orchestrator & State Machine Controller
 */
const KioskState = {
    INITIALIZING: 'INITIALIZING',
    WAITING_FOR_WASTE: 'WAITING_FOR_WASTE',
    WASTE_DETECTED: 'WASTE_DETECTED',
    IMAGE_CAPTURED: 'IMAGE_CAPTURED',
    CLASSIFYING: 'CLASSIFYING',
    AWAITING_VERIFICATION: 'AWAITING_VERIFICATION',
    VERIFICATION_PENDING: 'VERIFICATION_PENDING',
    WASTE_VERIFIED: 'WASTE_VERIFIED',
    SERVO_MOVING: 'SERVO_MOVING',
    CYCLE_COMPLETE: 'CYCLE_COMPLETE',
    ERROR: 'ERROR'
};

class KioskApp {
    constructor() {
        this.state = KioskState.INITIALIZING;
        this.camera = new CameraService('webcam-feed', 'capture-canvas');
        this.classifier = new ClassifierService();
        this.esp32 = new ESP32Service();

        // Anti-duplicate event guard & Debounce settings
        this.lastIrTimestamp = 0;
        this.irDebounceIntervalMs = 3000; // Minimum 3 sec delay between auto captures
        this.currentClassification = null;

        this.initDOM();
        this.initClock();
    }

    initDOM() {
        // UI Components
        this.elements = {
            stateBadge: document.getElementById('sys-state-badge'),
            camDot: document.getElementById('cam-dot'),
            camStatusText: document.getElementById('cam-status-text'),
            camOverlay: document.getElementById('camera-overlay'),
            espDot: document.getElementById('esp-dot'),
            espStatusText: document.getElementById('esp-status-text'),
            btnConnectEsp: document.getElementById('btn-connect-esp32'),
            mlDot: document.getElementById('ml-dot'),
            mlStatusText: document.getElementById('ml-status-text'),
            captureBadge: document.getElementById('capture-badge'),
            canvasPlaceholder: document.getElementById('canvas-placeholder'),
            resCategory: document.getElementById('res-category'),
            resConfidence: document.getElementById('res-confidence'),
            resTimestamp: document.getElementById('res-timestamp'),
            confidenceBar: document.getElementById('confidence-bar'),
            instructionBox: document.getElementById('instruction-box'),
            btnVerify: document.getElementById('btn-verify'),
            btnReset: document.getElementById('btn-reset-cycle'),
            btnClearLog: document.getElementById('btn-clear-log'),
            logContainer: document.getElementById('log-container')
        };

        // Event Binding
        this.elements.btnConnectEsp.addEventListener('click', () => this.connectESP32());
        this.elements.btnVerify.addEventListener('click', () => this.handleUserVerification());
        this.elements.btnReset.addEventListener('click', () => this.resetCycle());
        this.elements.btnClearLog.addEventListener('click', () => {
            this.elements.logContainer.innerHTML = '';
        });
    }

    async start() {
        this.log("sys", "Initializing Kiosk Hardware Subsystems...");
        
        // 1. Initialize Webcam
        try {
            await this.camera.init();
            this.elements.camDot.className = 'status-dot connected';
            this.elements.camStatusText.textContent = 'Active (640x480)';
            this.elements.camOverlay.style.display = 'none';
            this.log("sys", "Webcam initialized successfully.");
        } catch (err) {
            this.elements.camDot.className = 'status-dot disconnected';
            this.elements.camStatusText.textContent = 'Error / Denied';
            this.log("err", `Webcam Init Failure: ${err.message}`);
        }

        // 2. Initialize Classifier
        try {
            const mlStatus = await this.classifier.init();
            this.elements.mlDot.className = 'status-dot connected';
            this.elements.mlStatusText.textContent = mlStatus.mode;
            this.log("sys", `ML Engine ready: ${mlStatus.mode}`);
        } catch (err) {
            this.elements.mlDot.className = 'status-dot disconnected';
            this.elements.mlStatusText.textContent = 'Failed to load';
            this.log("err", `Classifier Error: ${err.message}`);
        }

        // 3. Register Serial Message Handler
        this.esp32.setMessageHandler((msg) => this.handleSerialMessage(msg));

        // Transition State
        this.transitionTo(KioskState.WAITING_FOR_WASTE);
    }

    transitionTo(newState) {
        this.state = newState;
        this.elements.stateBadge.textContent = newState;
        this.log("sys", `State changed -> ${newState}`);

        // Update UI Context per state
        switch (newState) {
            case KioskState.WAITING_FOR_WASTE:
                this.elements.instructionBox.textContent = "Waiting for waste object near IR sensor...";
                this.elements.captureBadge.className = "capture-trigger-badge";
                this.elements.captureBadge.textContent = "IR Trigger Idle";
                this.elements.btnVerify.disabled = true;
                break;

            case KioskState.WASTE_DETECTED:
                this.elements.captureBadge.className = "capture-trigger-badge active";
                this.elements.captureBadge.textContent = "IR DETECTED!";
                this.elements.instructionBox.textContent = "Object detected! Capturing frame...";
                break;

            case KioskState.CLASSIFYING:
                this.elements.instructionBox.textContent = "Executing Edge Impulse waste classification...";
                break;

            case KioskState.AWAITING_VERIFICATION:
                this.elements.instructionBox.textContent = "Waste categorized! Verify prediction to activate sorting bin.";
                this.elements.btnVerify.disabled = false;
                break;

            case KioskState.VERIFICATION_PENDING:
                this.elements.instructionBox.textContent = "Sending confirmation command to ESP32...";
                this.elements.btnVerify.disabled = true;
                break;

            case KioskState.SERVO_MOVING:
                this.elements.instructionBox.textContent = "ESP32 opening sorting bin servo motor...";
                break;

            case KioskState.CYCLE_COMPLETE:
                this.elements.instructionBox.textContent = "Recycling cycle completed! Thank you for sorting.";
                break;

            case KioskState.ERROR:
                this.elements.btnVerify.disabled = true;
                break;
        }
    }

    // Hardware Event Handler: Serial input from ESP32
    handleSerialMessage(message) {
        this.log("serial", `<-- ESP32: ${message}`);

        switch (message) {
            case "IR_DETECTED":
                this.onIrSensorTriggered();
                break;

            case "VERIFY_ACK":
                if (this.state === KioskState.VERIFICATION_PENDING) {
                    this.log("verify", "ESP32 Acknowledged Verification!");
                    this.transitionTo(KioskState.SERVO_MOVING);
                }
                break;

            case "SERVO_DONE":
                if (this.state === KioskState.SERVO_MOVING) {
                    this.log("sys", "Servo sorting operation reported complete by ESP32.");
                    this.transitionTo(KioskState.CYCLE_COMPLETE);
                    // Automatically re-arm system after short delay
                    setTimeout(() => this.resetCycle(), 2500);
                }
                break;

            case "ITEM_REMOVED":
                this.log("sys", "IR Sensor cleared. System ready for next item.");
                if (this.state === KioskState.CYCLE_COMPLETE) {
                    this.resetCycle();
                }
                break;

            default:
                if (message.startsWith("ERROR")) {
                    this.log("err", `Hardware Error Signal: ${message}`);
                    this.transitionTo(KioskState.ERROR);
                }
                break;
        }
    }

    // Triggered automatically on hardware IR serial command
    async onIrSensorTriggered() {
        const now = Date.now();
        
        // Guard 1: Prevent duplicate captures during active sorting cycles
        if (this.state !== KioskState.WAITING_FOR_WASTE) {
            this.log("sys", `Ignored IR event. Kiosk is currently in busy state: ${this.state}`);
            return;
        }

        // Guard 2: Debounce rapid consecutive triggers
        if (now - this.lastIrTimestamp < this.irDebounceIntervalMs) {
            this.log("sys", "Ignored duplicate IR event due to debounce limit.");
            return;
        }

        this.lastIrTimestamp = now;
        this.transitionTo(KioskState.WASTE_DETECTED);

        // Guard 3: Verify webcam readiness
        if (!this.camera.isReady) {
            this.log("err", "Automatic capture aborted: Webcam unavailable!");
            this.elements.instructionBox.textContent = "Error: Webcam unavailable for capture!";
            this.transitionTo(KioskState.ERROR);
            return;
        }

        // Capture snapshot from stream
        try {
            this.camera.captureFrame();
            this.elements.canvasPlaceholder.style.display = 'none';
            this.transitionTo(KioskState.IMAGE_CAPTURED);
            this.log("capture", "Webcam frame captured from live feed.");
            
            // Auto run classification pipeline
            await this.runClassification();
        } catch (err) {
            this.log("err", `Capture error: ${err.message}`);
            this.transitionTo(KioskState.ERROR);
        }
    }

    async runClassification() {
        this.transitionTo(KioskState.CLASSIFYING);
        
        try {
            const result = await this.classifier.classifyWaste(this.camera.canvas);
            this.currentClassification = result;

            // Render Results to UI
            const scorePct = Math.round(result.confidence * 100);
            const timestamp = new Date().toLocaleTimeString();

            this.elements.resTimestamp.textContent = timestamp;
            this.elements.resCategory.textContent = result.category + (result.isSimulated ? " (SIM)" : "");
            this.elements.resConfidence.textContent = `${scorePct}%`;
            this.elements.confidenceBar.style.width = `${scorePct}%`;

            if (result.isSimulated) {
                this.log("ml", `[SIMULATED] Category: ${result.category} (${scorePct}%)`);
            } else {
                this.log("ml", `[REAL MODEL] Category: ${result.category} (${scorePct}%)`);
            }

            // Check Confidence Threshold (e.g., 70%)
            if (!result.passedThreshold) {
                this.log("err", `Low confidence prediction (${scorePct}%). Verification blocked.`);
                this.elements.instructionBox.textContent = "Unable to confidently identify waste. Please reposition item.";
                this.elements.resCategory.style.color = "var(--status-amber)";
                this.transitionTo(KioskState.ERROR);
                return;
            }

            this.elements.resCategory.style.color = "var(--accent-emerald)";
            this.transitionTo(KioskState.AWAITING_VERIFICATION);

        } catch (err) {
            this.log("err", `Inference failure: ${err.message}`);
            this.transitionTo(KioskState.ERROR);
        }
    }

    async handleUserVerification() {
        if (this.state !== KioskState.AWAITING_VERIFICATION) return;

        this.transitionTo(KioskState.VERIFICATION_PENDING);
        this.log("verify", `User clicked WASTE VERIFIED. Sending 'WASTE_VERIFIED' command...`);

        if (this.esp32.isConnected) {
            try {
                await this.esp32.send("WASTE_VERIFIED");
                this.log("serial", "--> ESP32: WASTE_VERIFIED sent.");
            } catch (err) {
                this.log("err", `Serial send failed: ${err.message}`);
                this.transitionTo(KioskState.ERROR);
            }
        } else {
            // Development fallback mode if physical ESP32 is disconnected during tests
            this.log("sys", "ESP32 disconnected: Simulating hardware ACK in 1s...");
            setTimeout(() => this.handleSerialMessage("VERIFY_ACK"), 1000);
            setTimeout(() => this.handleSerialMessage("SERVO_DONE"), 2500);
        }
    }

    async connectESP32() {
        try {
            await this.esp32.connect();
            this.elements.espDot.className = "status-dot connected";
            this.elements.espStatusText.textContent = "Connected (115200)";
            this.elements.btnConnectEsp.style.display = "none";
            this.log("sys", "ESP32 Serial USB Port connected successfully.");
        } catch (err) {
            this.elements.espDot.className = "status-dot disconnected";
            this.elements.espStatusText.textContent = "Disconnected";
            this.log("err", err.message);
        }
    }

    resetCycle() {
        this.currentClassification = null;
        this.elements.resCategory.textContent = "---";
        this.elements.resConfidence.textContent = "0%";
        this.elements.resTimestamp.textContent = "--:--:--";
        this.elements.confidenceBar.style.width = "0%";
        this.elements.canvasPlaceholder.style.display = "flex";
        
        // Clear canvas
        const ctx = this.camera.canvas.getContext('2d');
        ctx.clearRect(0, 0, this.camera.canvas.width, this.camera.canvas.height);

        this.log("sys", "Frontend cycle state manually reset.");
        this.transitionTo(KioskState.WAITING_FOR_WASTE);
    }

    log(type, text) {
        const time = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[${time}] ${text}`;
        
        this.elements.logContainer.appendChild(entry);
        this.elements.logContainer.scrollTop = this.elements.logContainer.scrollHeight;
    }

    initClock() {
        const clockEl = document.getElementById('clock');
        setInterval(() => {
            clockEl.textContent = new Date().toLocaleTimeString();
        }, 1000);
    }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
    window.app = new KioskApp();
    window.app.start();
});
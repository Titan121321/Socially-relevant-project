const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { SerialPort, ReadlineParser } = require('serialport');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));

const SERIAL_PORT_PATH = 'COM3'; // Change to your ESP32's actual COM port
const BAUD_RATE = 115200;

let espPort = null;
let currentSensorState = "IDLE";
let clients = [];

function initSerial() {
    if (espPort && espPort.isOpen) return;
    
    try {
        espPort = new SerialPort({ path: SERIAL_PORT_PATH, baudRate: BAUD_RATE });
        const parser = espPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

        espPort.on('open', () => {
            console.log(`[Serial]: Connected to port ${SERIAL_PORT_PATH}`);
            broadcastToClients({ type: 'esp_status', connected: true });
        });

        parser.on('data', (data) => {
            data = data.trim();
            console.log(`[ESP32 Hardware]: ${data}`);
            if (data === "IDLE" || data === "READY" || data === "SORTING") {
                currentSensorState = data;
                broadcastToClients({ type: 'state', state: currentSensorState });
            }
        });

        espPort.on('error', (err) => {
            console.error("[Serial Error]:", err.message);
            broadcastToClients({ type: 'esp_status', connected: false });
        });

        espPort.on('close', () => {
            console.log("[Serial]: Port closed.");
            broadcastToClients({ type: 'esp_status', connected: false });
        });

    } catch (err) {
        console.error("Failed to initialize serial port:", err.message);
    }
}

// Try initial connection on startup
initSerial();

function broadcastToClients(data) {
    clients.forEach(client => client.write(`data: ${JSON.stringify(data)}\n\n`));
}

// Endpoint to manually trigger a reconnect from the frontend webpage button
app.post('/connect-serial', (req, res) => {
    try {
        if (!espPort || !espPort.isOpen) {
            initSerial();
        }
        const connected = espPort && espPort.isOpen;
        res.json({ success: true, connected, state: currentSensorState });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    clients.push(res);
    res.write(`data: ${JSON.stringify({ type: 'state', state: currentSensorState })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'esp_status', connected: (espPort && espPort.isOpen) })}\n\n`);

    req.on('close', () => {
        clients = clients.filter(client => client !== res);
    });
});

app.post('/classify', upload.array('image', 1), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No image uploaded' });
        }

        const filePath = path.join(__dirname, req.files[0].path);
        
        // Mock classification result (replace with actual Edge Impulse model call if configured)
        const possibleBins = ["plastic", "paper", "metal", "food"];
        const classification = possibleBins[Math.floor(Math.random() * possibleBins.length)];
        const confidence = 0.96;

        fs.unlinkSync(filePath);

        if (espPort && espPort.isOpen) {
            console.log(`Sending command to ESP32: SORT:${classification}`);
            espPort.write(`SORT:${classification}\n`);
        }

        res.json({ classification, confidence });
    } catch (err) {
        console.error("Inference Error:", err);
        res.status(500).json({ error: 'Model classification failed' });
    }
});

app.listen(3000, () => {
    console.log('Server running live at http://localhost:3000');
});
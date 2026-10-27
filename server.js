const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { SerialPort, ReadlineParser } = require('serialport');

// Import your Edge Impulse classifier runner 
// (Update the path if your files are structured differently)
// const classifier = require('./model/edge-impulse-standalone.js');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.static('public'));

// --- SERIAL CONFIGURATION WITH ESP32 ---
const SERIAL_PORT_PATH = 'COM3'; // Replace with your ESP32's actual COM port (e.g., 'COM3' or '/dev/ttyUSB0')
const BAUD_RATE = 115200;

let espPort;
let currentSensorState = "IDLE";
let clients = [];

try {
    espPort = new SerialPort({ path: SERIAL_PORT_PATH, baudRate: BAUD_RATE });
    const parser = espPort.pipe(new ReadlineParser({ delimiter: '\r\n' }));

    parser.on('data', (data) => {
        data = data.trim();
        console.log(`[ESP32 Hardware]: ${data}`);
        
        // Listen to states coming from ESP32 IR sensor
        if (data === "IDLE" || data === "READY" || data === "SORTING") {
            currentSensorState = data;
            broadcastToClients({ type: 'state', state: currentSensorState });
        }
    });
} catch (err) {
    console.error("Warning: Could not open serial port. Running in offline/simulation mode.", err.message);
}

// Broadcast hardware state changes to all connected browser clients
function broadcastToClients(data) {
    clients.forEach(client => client.write(`data: ${JSON.stringify(data)}\n\n`));
}

// SSE Endpoint to keep the browser updated with ESP32 status
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    clients.push(res);
    res.write(`data: ${JSON.stringify({ type: 'state', state: currentSensorState })}\n\n`);

    req.on('close', () => {
        clients = clients.filter(client => client !== res);
    });
});

// --- CLASSIFICATION & SORTING ENDPOINT ---
app.post('/classify', upload.array('image', 1), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No image uploaded' });
        }

        const filePath = path.join(__dirname, req.files[0].path);

        // --- RUN EDGE IMPULSE INFERENCE ---
        // const result = await classifier.classify(filePath);
        // const classification = result.classification; // e.g., 'plastic'
        // const confidence = result.confidence;

        // Simulated Classification (Replace above when your model runner is linked)
        const possibleBins = ["plastic", "paper", "metal", "food"];
        const classification = possibleBins[Math.floor(Math.random() * possibleBins.length)];
        const confidence = 0.96;

        // Clean up temporary uploaded image file
        fs.unlinkSync(filePath);

        // Send sorting command to ESP32 over USB Serial
        if (espPort && espPort.isOpen) {
            console.p(`Sending command to ESP32: SORT:${classification}`);
            espPort.write(`SORT:${classification}\n`);
        } else {
            console.log(`[Simulation] Would send: SORT:${classification}`);
        }

        // Return results back to the webpage
        res.json({
            classification,
            confidence
        });

    } catch (err) {
        console.error("Inference Error:", err);
        res.status(500).json({ error: 'Model classification failed' });
    }
});

app.listen(3000, () => {
    console.log('Server is running live at http://localhost:3000');
});
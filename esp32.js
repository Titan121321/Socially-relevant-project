/**
 * ESP32 Serial Service - Web Serial API interface for microcontroller communication
 */
class ESP32Service {
    constructor() {
        this.port = null;
        this.reader = null;
        this.writer = null;
        this.isConnected = false;
        this.baudRate = 115200;
        this.onMessageCallback = null;
        this.keepReading = false;
    }

    isSupported() {
        return 'serial' in navigator;
    }

    setMessageHandler(callback) {
        this.onMessageCallback = callback;
    }

    async connect() {
        if (!this.isSupported()) {
            throw new Error("Web Serial API is not supported in this browser. Please use Chrome or Edge.");
        }

        try {
            // Prompt user to select USB Serial port
            this.port = await navigator.serial.requestPort();
            await this.port.open({ baudRate: this.baudRate });

            this.isConnected = true;
            this.keepReading = true;

            // Start reading loop async
            this.readLoop();
            
            return true;
        } catch (err) {
            this.isConnected = false;
            throw new Error(`Serial connection failed: ${err.message}`);
        }
    }

    async readLoop() {
        const textDecoder = new TextDecoderStream();
        const readableStreamClosed = this.port.readable.pipeTo(textDecoder.writable);
        this.reader = textDecoder.readable.getReader();

        let buffer = "";

        try {
            while (this.keepReading) {
                const { value, done } = await this.reader.read();
                if (done) {
                    break;
                }
                if (value) {
                    buffer += value;
                    const lines = buffer.split('\n');
                    // Process complete line events
                    buffer = lines.pop(); // Keep incomplete tail in buffer

                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (trimmed.length > 0 && this.onMessageCallback) {
                            this.onMessageCallback(trimmed);
                        }
                    }
                }
            }
        } catch (error) {
            console.error("Serial read error:", error);
        } finally {
            this.reader.releaseLock();
        }
    }

    async send(message) {
        if (!this.isConnected || !this.port || !this.port.writable) {
            throw new Error("ESP32 serial port is not connected.");
        }

        const textEncoder = new TextEncoderStream();
        const writableStreamClosed = textEncoder.readable.pipeTo(this.port.writable);
        const writer = textEncoder.writable.getWriter();

        try {
            // Append newline delimiter as expected by ESP32 Serial.readStringUntil('\n')
            await writer.write(message + '\n');
        } finally {
            writer.releaseLock();
        }
    }

    async disconnect() {
        this.keepReading = false;
        if (this.reader) {
            await this.reader.cancel();
        }
        if (this.port) {
            await this.port.close();
        }
        this.isConnected = false;
    }
}

window.ESP32Service = ESP32Service;
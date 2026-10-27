/**
 * Camera Service - Handles Laptop Webcam via navigator.mediaDevices
 */
class CameraService {
    constructor(videoElementId, canvasElementId) {
        this.video = document.getElementById(videoElementId);
        this.canvas = document.getElementById(canvasElementId);
        this.ctx = this.canvas ? this.canvas.getContext('2d') : null;
        this.stream = null;
        this.isReady = false;
    }

    async init() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Webcam API (getUserMedia) not supported by browser.");
        }

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: "user"
                },
                audio: false
            });

            this.video.srcObject = this.stream;
            
            return new Promise((resolve) => {
                this.video.onloadedmetadata = () => {
                    this.isReady = true;
                    // Match canvas aspect ratio
                    this.canvas.width = 224;
                    this.canvas.height = 224;
                    resolve(true);
                };
            });
        } catch (err) {
            this.isReady = false;
            throw new Error(`Webcam access error: ${err.message}`);
        }
    }

    captureFrame() {
        if (!this.isReady || !this.video) {
            throw new Error("Cannot capture frame: Webcam is not ready.");
        }

        // Draw center crop of video stream onto 224x224 ML canvas
        const size = Math.min(this.video.videoWidth, this.video.videoHeight);
        const startX = (this.video.videoWidth - size) / 2;
        const startY = (this.video.videoHeight - size) / 2;

        this.ctx.drawImage(
            this.video,
            startX, startY, size, size,
            0, 0, this.canvas.width, this.canvas.height
        );

        return this.canvas;
    }

    stop() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.isReady = false;
        }
    }
}

window.CameraService = CameraService;
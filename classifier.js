/**
 * Classifier Service - Edge Impulse WebAssembly / Placeholder Integration
 */
class ClassifierService {
    constructor() {
        this.isModelLoaded = false;
        this.isPlaceholderMode = true;
        this.confidenceThreshold = 0.70; // 70% confidence requirement
        
        // Edge Impulse trained classes
        this.categories = ["Plastic", "Metal", "Cardboard", "Paper", "Other"];
    }

    async init() {
        // Check if actual Edge Impulse JS SDK is loaded globally
        if (window.EdgeImpulseClassifier) {
            try {
                this.classifier = new window.EdgeImpulseClassifier();
                await this.classifier.init();
                this.isModelLoaded = true;
                this.isPlaceholderMode = false;
                return { loaded: true, mode: "Edge Impulse WebAssembly Model" };
            } catch (err) {
                console.warn("Failed to load Edge Impulse WASM binary, switching to local placeholder.", err);
            }
        }

        // Placeholder mode fallback
        this.isModelLoaded = true;
        this.isPlaceholderMode = true;
        return { loaded: true, mode: "Placeholder Simulation Mode" };
    }

    async classifyWaste(canvasElement) {
        if (!this.isModelLoaded) {
            throw new Error("Classifier model is not initialized.");
        }

        // 1. Actual Model Execution Path
        if (!this.isPlaceholderMode && this.classifier) {
            const imgData = this.extractImageData(canvasElement);
            const result = await this.classifier.classify(imgData);
            
            // Map highest scoring label
            let topClass = result.results[0].label;
            let topScore = result.results[0].value;
            
            result.results.forEach(res => {
                if (res.value > topScore) {
                    topScore = res.value;
                    topClass = res.label;
                }
            });

            return {
                category: topClass,
                confidence: topScore,
                isSimulated: false,
                passedThreshold: topScore >= this.confidenceThreshold
            };
        }

        // 2. Simulated/Placeholder Path (Safe demonstration when model binary is absent)
        await new Promise(resolve => setTimeout(resolve, 800)); // Simulate inference latency

        const randomCategory = this.categories[Math.floor(Math.random() * (this.categories.length - 1))];
        const randomScore = parseFloat((0.72 + Math.random() * 0.26).toFixed(2)); // High confidence range for test

        return {
            category: randomCategory,
            confidence: randomScore,
            isSimulated: true,
            passedThreshold: randomScore >= this.confidenceThreshold
        };
    }

    extractImageData(canvas) {
        const ctx = canvas.getContext('2d');
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        // Convert RGBA to RGB array expected by Edge Impulse SDK
        const rgb = [];
        for (let i = 0; i < imgData.data.length; i += 4) {
            rgb.push((imgData.data[i] << 16) | (imgData.data[i+1] << 8) | imgData.data[i+2]);
        }
        return rgb;
    }
}

window.ClassifierService = ClassifierService;
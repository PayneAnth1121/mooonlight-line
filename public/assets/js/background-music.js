// public/assets/js/background-music.js - BACKGROUND MUSIC SYSTEM
class BackgroundMusicManager {
    constructor() {
        this.audio = null;
        this.isPlaying = false;
        this.volume = 0.05;
        this.userHasInteracted = false;
        this.controls = {
            playPauseBtn: null,
            playIcon: null,
            volumeSlider: null
        };
    }

    init() {
        console.log('🎵 Initializing background music...');
        this.createAudioElement();
        this.createControls();
        this.setupEventListeners();
        this.attemptAutoplay();
    }

    createAudioElement() {
        // Remove existing audio element if any
        const existingAudio = document.getElementById('background-audio');
        if (existingAudio) {
            existingAudio.remove();
        }

        // Create new audio element
        this.audio = document.createElement('audio');
        this.audio.id = 'background-audio';
        this.audio.loop = true;
        this.audio.preload = 'auto';
        this.audio.volume = this.volume;

        // Add audio sources
        const sources = [
            { src: '/assets/music/background-music.mp3', type: 'audio/mpeg' },
            { src: '/assets/music/background-music.ogg', type: 'audio/ogg' },
            { src: '/assets/music/background-music.wav', type: 'audio/wav' }
        ];

        sources.forEach(source => {
            const sourceElement = document.createElement('source');
            sourceElement.src = source.src;
            sourceElement.type = source.type;
            this.audio.appendChild(sourceElement);
        });

        document.body.appendChild(this.audio);
    }

    createControls() {
        // Remove existing controls if any
        const existingControls = document.querySelector('.audio-controls');
        if (existingControls) {
            existingControls.remove();
        }

        // Create controls container
        const controlsContainer = document.createElement('div');
        controlsContainer.className = 'audio-controls';
        controlsContainer.innerHTML = `
            <button class="audio-control" id="play-pause-btn" title="Play/Pause Music">
                <span id="play-icon">🔊</span>
            </button>
            <div class="volume-control">
                <span style="color: #00f0ff; font-size: 0.8rem;">🔉</span>
                <input type="range" min="0" max="100" value="${this.volume * 100}" class="volume-slider" id="volume-slider">
                <span style="color: #00f0ff; font-size: 0.8rem;">🔊</span>
            </div>
        `;

        document.body.appendChild(controlsContainer);

        // Store references
        this.controls.playPauseBtn = document.getElementById('play-pause-btn');
        this.controls.playIcon = document.getElementById('play-icon');
        this.controls.volumeSlider = document.getElementById('volume-slider');
    }

    setupEventListeners() {
        // Play/Pause button
        this.controls.playPauseBtn.addEventListener('click', () => {
            this.userHasInteracted = true;
            this.togglePlayPause();
        });

        // Volume slider
        this.controls.volumeSlider.addEventListener('input', (e) => {
            this.setVolume(e.target.value / 100);
        });

        // Audio events
        this.audio.addEventListener('play', () => {
            this.isPlaying = true;
            this.updatePlayIcon();
            console.log('🎵 Music started playing');
        });

        this.audio.addEventListener('pause', () => {
            this.isPlaying = false;
            this.updatePlayIcon();
            console.log('🎵 Music paused');
        });

        this.audio.addEventListener('error', (e) => {
            console.error('🎵 Audio error:', e);
            this.controls.playIcon.textContent = '❌';
        });

        // Backup interaction listener
        document.addEventListener('click', () => {
            if (!this.isPlaying && !this.userHasInteracted) {
                this.userHasInteracted = true;
                this.play();
            }
        }, { once: true });
    }

    async attemptAutoplay() {
        try {
            await this.audio.play();
            console.log('🎵 Autoplay successful!');
        } catch (error) {
            console.log('🎵 Autoplay blocked, waiting for user interaction');
            this.controls.playIcon.textContent = '🔇';
        }
    }

    async play() {
        try {
            await this.audio.play();
        } catch (error) {
            console.error('🎵 Play failed:', error);
        }
    }

    pause() {
        this.audio.pause();
    }

    togglePlayPause() {
        if (this.isPlaying) {
            this.pause();
        } else {
            this.play();
        }
    }

    setVolume(volume) {
        this.volume = Math.max(0, Math.min(1, volume));
        this.audio.volume = this.volume;
        this.updatePlayIcon();
    }

    updatePlayIcon() {
        if (!this.isPlaying) {
            this.controls.playIcon.textContent = '🔇';
        } else if (this.volume === 0) {
            this.controls.playIcon.textContent = '🔇';
        } else if (this.volume < 0.5) {
            this.controls.playIcon.textContent = '🔉';
        } else {
            this.controls.playIcon.textContent = '🔊';
        }
    }
}

// CSS para los controles
const musicCSS = `
    <style>
        .audio-controls {
            position: fixed;
            bottom: 20px;
            left: 20px;
            display: flex;
            gap: 10px;
            z-index: 1000;
        }
        
        .audio-control {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background-color: rgba(0, 0, 0, 0.7);
            border: 1px solid #00f0ff;
            color: #00f0ff;
            font-size: 1.2rem;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            box-shadow: 0 0 10px rgba(0, 240, 255, 0.5);
            transition: all 0.3s ease;
        }
        
        .audio-control:hover {
            transform: scale(1.1);
            box-shadow: 0 0 15px rgba(0, 240, 255, 0.7);
            background-color: rgba(0, 240, 255, 0.1);
        }
        
        .audio-control.active {
            background-color: rgba(0, 240, 255, 0.2);
            box-shadow: 0 0 20px rgba(0, 240, 255, 0.8);
        }
        
        .volume-control {
            display: flex;
            align-items: center;
            gap: 10px;
            background-color: rgba(0, 0, 0, 0.7);
            border: 1px solid #00f0ff;
            border-radius: 25px;
            padding: 10px 15px;
            box-shadow: 0 0 10px rgba(0, 240, 255, 0.5);
        }
        
        .volume-slider {
            -webkit-appearance: none;
            width: 100px;
            height: 5px;
            border-radius: 5px;
            background: rgba(0, 240, 255, 0.3);
            outline: none;
            opacity: 0.7;
            transition: opacity 0.2s;
        }
        
        .volume-slider:hover {
            opacity: 1;
        }
        
        .volume-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 15px;
            height: 15px;
            border-radius: 50%;
            background: #00f0ff;
            cursor: pointer;
            box-shadow: 0 0 5px rgba(0, 240, 255, 0.8);
        }
        
        .volume-slider::-moz-range-thumb {
            width: 15px;
            height: 15px;
            border-radius: 50%;
            background: #00f0ff;
            cursor: pointer;
            border: none;
            box-shadow: 0 0 5px rgba(0, 240, 255, 0.8);
        }
        
        /* Responsive */
        @media (max-width: 768px) {
            .volume-control {
                display: none;
            }
            
            .audio-controls {
                bottom: 80px;
                left: 10px;
            }
        }
    </style>
`;

// Inyectar CSS
document.head.insertAdjacentHTML('beforeend', musicCSS);

// Función global para inicializar
window.initBackgroundMusic = function() {
    const musicManager = new BackgroundMusicManager();
    musicManager.init();
    return musicManager;
};

console.log('🎵 Background music system loaded');
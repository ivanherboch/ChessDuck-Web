/** Retours sensoriels : son feutré de pièce en bois (wood_move.wav) + vibrations si disponibles. */
class FeedbackService {
    constructor() {
        this.hapticsEnabled = true;
        this.soundEnabled = true;
        this._ctx = null;
        this._buffer = null;
        this._loading = false;
        this._audioEl = null;
        this._unlocked = false;
    }

    unlock() {
        if (this._unlocked) return;
        this._unlocked = true;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (Ctx && !this._ctx) {
                this._ctx = new Ctx();
            }
            if (this._ctx && this._ctx.state === 'suspended') {
                this._ctx.resume().catch(() => {});
            }
            this._loadSound();
        } catch { /* ignore */ }
    }

    async _loadSound() {
        if (this._buffer || this._loading || !this._ctx) return;
        this._loading = true;
        try {
            const res = await fetch('./assets/wood_move.wav');
            if (!res.ok) return;
            const arr = await res.arrayBuffer();
            this._buffer = await new Promise((resolve, reject) => {
                const p = this._ctx.decodeAudioData(arr, resolve, reject);
                if (p && typeof p.then === 'function') p.then(resolve, reject);
            });
        } catch {
            // Fallback HTMLAudio if WebAudio decode unavailable
        } finally {
            this._loading = false;
        }
    }

    _canUseMedia() {
        if (!this._unlocked) return false;
        if (typeof navigator !== 'undefined' && navigator.userActivation && !navigator.userActivation.hasBeenActive) {
            return false;
        }
        return true;
    }

    _buzz(pattern) {
        if (!this.hapticsEnabled || !this._canUseMedia()) return;
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate(pattern);
            }
        } catch { /* unsupported on iOS Safari */ }
    }

    move() {
        if (this.soundEnabled && this._canUseMedia()) {
            if (this._ctx && this._buffer) {
                try {
                    if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
                    const src = this._ctx.createBufferSource();
                    src.buffer = this._buffer;
                    const gain = this._ctx.createGain();
                    gain.gain.value = 0.2;
                    src.connect(gain);
                    gain.connect(this._ctx.destination);
                    src.start(0);
                } catch { /* ignore */ }
            }
        }
        this._buzz(12);
    }

    key() { this._buzz(8); }
    error() { this._buzz([0, 35, 70, 35]); }
    success() { this._buzz(45); }
}

export const feedback = new FeedbackService();

if (typeof window !== 'undefined') {
    const onFirstGesture = () => {
        feedback.unlock();
        window.removeEventListener('pointerdown', onFirstGesture, true);
        window.removeEventListener('touchstart', onFirstGesture, true);
        window.removeEventListener('keydown', onFirstGesture, true);
    };
    window.addEventListener('pointerdown', onFirstGesture, true);
    window.addEventListener('touchstart', onFirstGesture, { capture: true, passive: true });
    window.addEventListener('keydown', onFirstGesture, true);
}

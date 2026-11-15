/** Retours sensoriels : son feutré de pièce en bois (wood_move.wav) + vibrations si disponibles. */
const MOVE_GAIN = 0.65;

export class FeedbackService {
    constructor() {
        this.hapticsEnabled = true;
        this.soundEnabled = true;
        this._ctx = null;
        this._buffer = null;
        this._rawPromise = null;
        this._loadPromise = null;
        this._unlocked = false;
        this._iosSilentPrimed = false;
    }

    _ensureCtx() {
        if (typeof window === 'undefined') return null;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx && !this._ctx) {
            this._ctx = new Ctx();
        }
        return this._ctx;
    }

    _primeSilent(ctx) {
        if (this._iosSilentPrimed || !ctx) return;
        try {
            const b = ctx.createBuffer(1, 1, 22050);
            const src = ctx.createBufferSource();
            src.buffer = b;
            src.connect(ctx.destination);
            src.start(0);
            if (ctx.state === 'running') this._iosSilentPrimed = true;
        } catch { /* ignore */ }
    }

    unlock() {
        this._unlocked = true;
        try {
            const ctx = this._ensureCtx();
            if (!ctx) return;
            if (ctx.state !== 'running') {
                const p = ctx.resume();
                if (p && typeof p.then === 'function') {
                    p.then(() => {
                        this._primeSilent(ctx);
                        this._loadSound();
                    }).catch(() => {});
                }
            }
            this._primeSilent(ctx);
            this._loadSound();
        } catch { /* ignore */ }
    }

    async _loadSound() {
        const ctx = this._ctx;
        if (this._buffer || !ctx) return this._buffer;
        if (this._loadPromise) return this._loadPromise;
        this._loadPromise = (async () => {
            try {
                if (!this._rawPromise) {
                    this._rawPromise = fetch('./assets/wood_move.wav')
                        .then((res) => (res.ok ? res.arrayBuffer() : null))
                        .catch(() => null);
                }
                const arr = await this._rawPromise;
                if (!arr) {
                    this._rawPromise = null;
                    return null;
                }
                // Copie car decodeAudioData détache l'ArrayBuffer transmis.
                const copy = arr.slice(0);
                this._buffer = await new Promise((resolve, reject) => {
                    const p = ctx.decodeAudioData(copy, resolve, reject);
                    if (p && typeof p.then === 'function') p.then(resolve, reject);
                });
                return this._buffer;
            } catch {
                // Un prochain geste retentera le décodage si l'AudioContext était encore suspendu.
                return null;
            } finally {
                this._loadPromise = null;
            }
        })();
        return this._loadPromise;
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

    _playBuffer(ctx, gainValue = MOVE_GAIN) {
        if (!ctx || !this._buffer) return;
        try {
            const src = ctx.createBufferSource();
            src.buffer = this._buffer;
            const gain = ctx.createGain();
            gain.gain.value = gainValue;
            src.connect(gain);
            gain.connect(ctx.destination);
            src.start(0);
        } catch { /* ignore */ }
    }

    _playAfterLoad(ctx, gainValue = MOVE_GAIN) {
        this._loadSound().then(() => {
            if (this.soundEnabled && this._ctx === ctx && ctx.state === 'running' && this._buffer) {
                this._playBuffer(ctx, gainValue);
            }
        }).catch(() => {});
    }

    move({ capture = false, check = false, promotion = false } = {}) {
        const gainValue = capture ? Math.min(1, MOVE_GAIN * 1.35) : MOVE_GAIN;
        if (this.soundEnabled && this._canUseMedia()) {
            const ctx = this._ensureCtx();
            if (ctx) {
                if (ctx.state !== 'running') {
                    try {
                        const p = ctx.resume();
                        if (p && typeof p.then === 'function') {
                            p.then(() => {
                                if (!this.soundEnabled || this._ctx !== ctx || ctx.state !== 'running') return;
                                if (this._buffer) this._playBuffer(ctx, gainValue);
                                else this._playAfterLoad(ctx, gainValue);
                            }).catch(() => {});
                        }
                    } catch { /* ignore */ }
                } else if (this._buffer) {
                    this._playBuffer(ctx, gainValue);
                } else {
                    this._playAfterLoad(ctx, gainValue);
                }
            }
        }
        this._buzz(promotion ? [12, 40, 18] : check ? [14, 50, 14] : capture ? 18 : 12);
    }

    key() { this._buzz(8); }
    error() { this._buzz([0, 35, 70, 35]); }
    success() { this._buzz(45); }
}

export const feedback = new FeedbackService();

if (typeof window !== 'undefined') {
    const onGesture = () => {
        if (!feedback._unlocked || !feedback._ctx || feedback._ctx.state !== 'running' || !feedback._buffer) {
            feedback.unlock();
        }
    };
    window.addEventListener('pointerdown', onGesture, { capture: true, passive: true });
    window.addEventListener('touchstart', onGesture, { capture: true, passive: true });
    window.addEventListener('pointerup', onGesture, { capture: true, passive: true });
    window.addEventListener('touchend', onGesture, { capture: true, passive: true });
    window.addEventListener('click', onGesture, { capture: true, passive: true });
    window.addEventListener('keydown', onGesture, { capture: true, passive: true });
}
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && feedback._unlocked && feedback._ctx && feedback._ctx.state !== 'running') {
            feedback._ctx.resume().catch(() => {});
        }
    });
}

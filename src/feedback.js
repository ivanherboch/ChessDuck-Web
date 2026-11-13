// Retours sensoriels : son de pièce en bois (Web Audio API déverrouillé pour iOS Safari) + vibrations optionnelles

export class FeedbackManager {
  constructor() {
    this.hapticsEnabled = true;
    this.soundEnabled = true;
    this._ctx = null;
    this._buffer = null;
    this._loading = false;
    this._unlocked = false;
    this._bindUnlock();
  }

  _bindUnlock() {
    const unlock = () => {
      if (this._unlocked) return;
      this._ensureContext();
      if (this._ctx && this._ctx.state === 'suspended') {
        this._ctx.resume().catch(() => {});
      }
      // Joue un buffer silencieux pour débloquer l'AudioContext sur iOS Safari
      if (this._ctx) {
        try {
          const b = this._ctx.createBuffer(1, 1, 22050);
          const s = this._ctx.createBufferSource();
          s.buffer = b;
          s.connect(this._ctx.destination);
          s.start(0);
          this._unlocked = true;
        } catch {}
      }
      this._loadWood();
    };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  _ensureContext() {
    if (!this._ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this._ctx = new AC();
    }
  }

  async _loadWood() {
    if (this._buffer || this._loading) return;
    this._ensureContext();
    if (!this._ctx) return;
    this._loading = true;
    try {
      const resp = await fetch('assets/wood_move.wav');
      const arr = await resp.arrayBuffer();
      this._buffer = await this._ctx.decodeAudioData(arr);
    } catch {
      this._loading = false;
    }
  }

  preload() {
    this._loadWood();
  }

  _vibrate(pattern) {
    if (!this.hapticsEnabled) return;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      try { navigator.vibrate(pattern); } catch {}
    }
  }

  move() {
    if (this.soundEnabled) {
      this._ensureContext();
      if (this._ctx) {
        if (this._ctx.state === 'suspended') this._ctx.resume().catch(() => {});
        if (this._buffer) {
          try {
            const src = this._ctx.createBufferSource();
            src.buffer = this._buffer;
            const gain = this._ctx.createGain();
            gain.gain.value = 0.25;
            src.connect(gain);
            gain.connect(this._ctx.destination);
            src.start(0);
          } catch {}
        } else {
          this._loadWood();
        }
      }
    }
    this._vibrate(12);
  }

  key() {
    this._vibrate(8);
  }

  error() {
    this._vibrate([35, 70, 35]);
  }

  success() {
    this._vibrate(45);
  }
}

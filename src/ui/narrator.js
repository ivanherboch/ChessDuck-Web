/**
 * Synthèse vocale Web (Web Speech API) pour la lecture à voix haute des leçons de l'Académie.
 * Optimisée pour fonctionner de manière fluide sur iPhone (iOS Safari / PWA) et Android (Chrome / WebView).
 */
class WebNarrator {
    constructor() {
        this._available = null;
        this._speaking = false;
        this._availSubs = new Set();
        this._speakSubs = new Set();
        this._seq = 0;
        this._voice = null;
        this._activeUtterance = null;
        this._pollTimer = null;
        this._startTimer = null;
        this._unlocked = false;

        this._initEvents();
    }

    get available() {
        return this._available;
    }

    get speaking() {
        return this._speaking;
    }

    subscribeAvailable(fn) {
        this._availSubs.add(fn);
        fn(this._available);
        return () => this._availSubs.delete(fn);
    }

    subscribeSpeaking(fn) {
        this._speakSubs.add(fn);
        fn(this._speaking);
        return () => this._speakSubs.delete(fn);
    }

    _setAvailable(val) {
        if (this._available === val) return;
        this._available = val;
        for (const fn of this._availSubs) fn(val);
    }

    _setSpeaking(val) {
        if (this._speaking === val) return;
        this._speaking = val;
        for (const fn of this._speakSubs) fn(val);
    }

    _synth() {
        if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance === 'undefined') {
            return null;
        }
        return window.speechSynthesis;
    }

    _initEvents() {
        if (typeof window === 'undefined') return;
        const synth = this._synth();
        if (!synth) {
            this._setAvailable(false);
            return;
        }

        const onVoicesChanged = () => {
            this._refreshVoices();
        };
        try {
            if (typeof synth.addEventListener === 'function') {
                synth.addEventListener('voiceschanged', onVoicesChanged);
            } else {
                synth.onvoiceschanged = onVoicesChanged;
            }
        } catch {
            synth.onvoiceschanged = onVoicesChanged;
        }

        // Déverrouillage iOS Safari au premier geste utilisateur
        const unlockOnGesture = () => {
            if (this._unlocked) return;
            this._unlocked = true;
            try {
                const s = this._synth();
                if (s && !s.speaking && !s.pending) {
                    const u = new window.SpeechSynthesisUtterance('');
                    u.volume = 0;
                    u.lang = 'fr-FR';
                    s.speak(u);
                }
            } catch { /* ignore */ }
        };
        window.addEventListener('touchend', unlockOnGesture, { passive: true, once: true });
        window.addEventListener('click', unlockOnGesture, { passive: true, once: true });

        // Silence automatique si l'application passe en arrière-plan (iPhone / Android)
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') this.stop();
            });
        }
        window.addEventListener('pagehide', () => this.stop());
    }

    _refreshVoices() {
        const synth = this._synth();
        if (!synth) {
            this._setAvailable(false);
            return;
        }
        let voices = [];
        try {
            voices = synth.getVoices() || [];
        } catch {
            voices = [];
        }
        const frVoices = voices.filter((v) => v && typeof v.lang === 'string' && /^fr([-_]|$)/i.test(v.lang));
        if (frVoices.length > 0) {
            frVoices.sort((a, b) => this._scoreVoice(b) - this._scoreVoice(a));
            this._voice = frVoices[0];
            this._setAvailable(true);
        } else {
            // Sur iOS Safari et Android Chrome, même si getVoices() est encore vide avant le 1er appel,
            // speechSynthesis prend en charge utter.lang = 'fr-FR' via le moteur système.
            this._setAvailable(true);
        }
    }

    _scoreVoice(v) {
        let score = 0;
        const lang = (v.lang || '').replace('_', '-').toLowerCase();
        const name = (v.name || '').toLowerCase();
        if (lang === 'fr-fr') score += 20;
        else if (lang.startsWith('fr')) score += 10;
        if (v.localService) score += 8;
        if (v.default) score += 4;
        if (/thomas|am[eé]lie|audrey|marie|aur[eé]lie|daniel|enhanced|premium|natural|siri|google/i.test(name)) {
            score += 5;
        }
        if (/compact|espeak/i.test(name)) score -= 5;
        return score;
    }

    /** Démarre le moteur pour connaître [available] (aucune lecture). */
    prepare() {
        const synth = this._synth();
        if (!synth) {
            this._setAvailable(false);
            return;
        }
        this._refreshVoices();
    }

    /** Lit [text] en interrompant la phrase en cours. */
    speak(text) {
        if (!text || this._available === false) return;
        const synth = this._synth();
        if (!synth) {
            this._setAvailable(false);
            return;
        }
        this._unlocked = true;
        if (!this._voice) this._refreshVoices();

        const id = ++this._seq;
        this._clearTimers();
        this._setSpeaking(true);

        const wasBusy = Boolean(synth.speaking || synth.pending);
        if (wasBusy) {
            try { synth.cancel(); } catch { /* ignore */ }
        }

        const launchUtterance = () => {
            if (id !== this._seq) return;
            try {
                if (synth.paused) synth.resume();
            } catch { /* ignore */ }

            const u = new window.SpeechSynthesisUtterance(text);
            this._activeUtterance = u;
            if (this._voice) {
                try { u.voice = this._voice; } catch { /* ignore */ }
                u.lang = (this._voice.lang || 'fr-FR').replace('_', '-');
            } else {
                u.lang = 'fr-FR';
            }
            u.rate = 1.0;
            u.pitch = 1.0;

            const finish = () => {
                if (id !== this._seq) return;
                this._clearTimers();
                this._activeUtterance = null;
                this._setSpeaking(false);
            };

            u.onend = finish;
            u.onerror = finish;

            try {
                synth.speak(u);
            } catch {
                finish();
                return;
            }

            // Surveillance de secours pour iOS Safari & Android Chrome (où onend peut parfois être omis
            // ou où speechSynthesis peut se mettre en pause lors d'une longue phrase).
            const startedAt = Date.now();
            const maxMs = Math.max(8000, Math.min(55000, text.length * 120));
            this._pollTimer = setInterval(() => {
                if (id !== this._seq) {
                    this._clearTimers();
                    return;
                }
                const elapsed = Date.now() - startedAt;
                if (elapsed > maxMs) {
                    finish();
                    return;
                }
                try {
                    if (synth.paused && synth.speaking) {
                        synth.resume();
                    }
                    if (elapsed > 450 && !synth.speaking && !synth.pending) {
                        finish();
                    }
                } catch {
                    finish();
                }
            }, 200);
        };

        // Sur Android Chrome et iOS Safari, si cancel() vient d'être appelé, un court délai (25 ms)
        // évite que cancel() n'annule aussi la nouvelle phrase ; sinon on lance immédiatement
        // dans le fil du geste utilisateur (requis par iOS Safari).
        if (wasBusy) {
            this._startTimer = setTimeout(launchUtterance, 25);
        } else {
            launchUtterance();
        }
    }

    stop() {
        this._seq++;
        this._clearTimers();
        this._activeUtterance = null;
        this._setSpeaking(false);
        const synth = this._synth();
        if (synth) {
            try { synth.cancel(); } catch { /* ignore */ }
        }
    }

    _clearTimers() {
        if (this._startTimer) {
            clearTimeout(this._startTimer);
            this._startTimer = null;
        }
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    /** Attend la fin de la phrase en cours (au plus une minute). */
    awaitIdle(timeoutMs = 60000) {
        if (!this._speaking) return Promise.resolve();
        return new Promise((resolve) => {
            let done = false;
            let unsub = null;
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                unsub?.();
                resolve();
            }, timeoutMs);
            unsub = this.subscribeSpeaking((speaking) => {
                if (!speaking && !done) {
                    done = true;
                    clearTimeout(timer);
                    unsub?.();
                    resolve();
                }
            });
        });
    }
}

export const narrator = new WebNarrator();

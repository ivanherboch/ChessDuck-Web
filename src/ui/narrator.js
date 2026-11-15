/**
 * Synthèse vocale Web (Web Speech API) pour la lecture à voix haute des leçons de l'Académie.
 * Optimisée pour iPhone (iOS Safari / PWA), Android (Chrome / WebView) et navigateurs de bureau.
 */
const MAX_CHUNK_CHARS = 180;
const START_GRACE_MS = 2200;
const PENDING_STALL_MS = 7000;
const CANCEL_RETRY_MS = 160;
const POLL_INTERVAL_MS = 200;
const IDLE_POLLS_REQUIRED = 3;

export class WebNarrator {
    constructor() {
        this._available = null;
        this._speaking = false;
        this._availSubs = new Set();
        this._speakSubs = new Set();
        this._seq = 0;
        this._voice = null;
        this._utterances = [];
        this._unlockUtterance = null;
        this._pollTimer = null;
        this._unlocked = false;
        this._gestureArmed = false;
        this._lastResult = { played: false, started: false, durationMs: 0, elapsedMs: 0 };

        this._onGesture = () => {
            if (this._unlocked || this._speaking) return;
            this.unlock();
        };

        this._initEvents();
    }

    get available() {
        return this._available;
    }

    get speaking() {
        return this._speaking;
    }

    get lastResult() {
        return this._lastResult;
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

    _armGestureUnlock() {
        if (typeof window === 'undefined' || this._gestureArmed) return;
        this._gestureArmed = true;
        window.addEventListener('click', this._onGesture, { passive: true });
        window.addEventListener('keydown', this._onGesture, { passive: true });
    }

    _disarmGestureUnlock() {
        if (typeof window === 'undefined' || !this._gestureArmed) return;
        this._gestureArmed = false;
        window.removeEventListener('click', this._onGesture);
        window.removeEventListener('keydown', this._onGesture);
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

        this._armGestureUnlock();

        const resetAudioSession = () => {
            this.stop();
            this._unlocked = false;
            this._armGestureUnlock();
        };

        // Silence automatique si l'application passe en arrière-plan (iPhone / Android)
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') resetAudioSession();
            });
        }
        window.addEventListener('pagehide', resetAudioSession);
    }

    /** Déverrouille l'audio WebKit (iOS Safari) de façon inaudible dans le fil d'un geste utilisateur. */
    unlock(force = false) {
        if (!force && this._unlocked) {
            this._disarmGestureUnlock();
            return false;
        }
        if (this._speaking || this._available === false) return false;
        const synth = this._synth();
        if (!synth) return false;
        try {
            if (synth.speaking || synth.pending) return false;
            // Une chaîne non vide (' ') est nécessaire sur iOS Safari pour activer AVSpeechSynthesizer.
            const u = new window.SpeechSynthesisUtterance(' ');
            u.volume = 0;
            u.rate = 2.0;
            u.pitch = 1.0;
            u.lang = 'fr-FR';
            this._unlockUtterance = u;
            const clearRef = () => {
                if (this._unlockUtterance === u) this._unlockUtterance = null;
            };
            u.onend = clearRef;
            u.onerror = clearRef;
            this._unlocked = true;
            this._disarmGestureUnlock();
            synth.speak(u);
            return true;
        } catch {
            return false;
        }
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
            const best = frVoices[0];
            const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
            this._voice = offline && best.localService === false ? null : best;
        } else {
            this._voice = null;
        }
        // Sur iOS Safari et Android Chrome, getVoices() peut rester vide avant la première lecture ;
        // utter.lang = 'fr-FR' sollicite alors directement la synthèse système.
        this._setAvailable(true);
    }

    _scoreVoice(v) {
        let score = 0;
        const lang = (v.lang || '').replace('_', '-').toLowerCase();
        const name = (v.name || '').toLowerCase();
        const uri = (v.voiceURI || '').toLowerCase();
        if (lang === 'fr-fr') score += 20;
        else if (lang === 'fr') score += 14;
        else if (lang.startsWith('fr')) score += 10;

        if (v.localService === true) score += 50;
        else if (v.localService === false) score -= 25;

        if (v.default) score += 4;

        if (!/online/i.test(name) && /thomas|am[eé]lie|audrey|aur[eé]lie|marie|nicolas|daniel|paul|julie|hortense|c[eé]line|l[eé]a|enhanced|premium|natural/i.test(name)) {
            score += 6;
        }
        // Sur iOS 16+, les voix Siri ne répondent pas toujours via Web Speech JS, et Eloquence est robotique.
        if (/siri/i.test(name) || /siri/i.test(uri)) score -= 12;
        if (/\b(eddy|flo|grandma|grandpa|jacques|reed|rocko|sandy|shelley)\b/i.test(name)) score -= 20;
        if (/compact|espeak/i.test(name)) score -= 8;
        if (/online/i.test(name)) score -= 15;
        return score;
    }

    /** Découpe un texte long en segments naturels (< 180 car.) pour éviter la coupure à 15 s sur Chrome. */
    _splitChunks(text, maxLen = MAX_CHUNK_CHARS) {
        const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
        if (!clean) return [];
        if (clean.length <= maxLen) return [clean];

        const rawSentences = clean.split(/(?<=[.!?…;:])\s+/);
        const pieces = [];
        for (const sent of rawSentences) {
            if (!sent) continue;
            if (sent.length <= maxLen) {
                pieces.push(sent);
                continue;
            }
            const clauses = sent.split(/(?<=,)\s+/);
            for (const clause of clauses) {
                if (!clause) continue;
                if (clause.length <= maxLen) {
                    pieces.push(clause);
                } else {
                    const words = clause.split(/\s+/);
                    let buf = '';
                    for (const w of words) {
                        if (!buf) buf = w;
                        else if (buf.length + 1 + w.length <= maxLen) buf += ` ${w}`;
                        else {
                            pieces.push(buf);
                            buf = w;
                        }
                    }
                    if (buf) pieces.push(buf);
                }
            }
        }

        const chunks = [];
        let current = '';
        for (const p of pieces) {
            if (!current) current = p;
            else if (current.length + 1 + p.length <= maxLen) current += ` ${p}`;
            else {
                chunks.push(current);
                current = p;
            }
        }
        if (current) chunks.push(current);
        return chunks;
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
        const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
        if (!clean || this._available === false) {
            this._lastResult = { played: false, started: false, durationMs: 0, elapsedMs: 0 };
            return;
        }
        const synth = this._synth();
        if (!synth) {
            this._setAvailable(false);
            this._lastResult = { played: false, started: false, durationMs: 0, elapsedMs: 0 };
            return;
        }

        this._unlocked = true;
        this._disarmGestureUnlock();
        this._refreshVoices();

        const chunks = this._splitChunks(clean);
        if (!chunks.length) return;

        const id = ++this._seq;
        this._clearTimers();
        this._utterances = [];
        this._unlockUtterance = null;
        const requestedAt = Date.now();
        this._lastResult = { played: false, started: false, durationMs: 0, elapsedMs: 0 };
        this._setSpeaking(true);

        const wasBusy = Boolean(synth.speaking || synth.pending);
        if (wasBusy) {
            try { synth.cancel(); } catch { /* ignore */ }
        }

        const maxMs = Math.max(15000, Math.min(75000, 5000 + clean.length * 160));
        let attempt = 0;
        let started = false;
        let sawSpeaking = false;
        let synthStartedAt = 0;
        let retriedCancel = false;
        let retriedWithoutVoice = false;

        const finish = (played) => {
            if (id !== this._seq) return;
            attempt += 1;
            this._clearTimers();
            this._utterances = [];
            const now = Date.now();
            this._lastResult = {
                played: Boolean(played),
                started,
                durationMs: synthStartedAt ? Math.max(0, now - synthStartedAt) : 0,
                elapsedMs: Math.max(0, now - requestedAt),
            };
            this._setSpeaking(false);
        };

        const launch = (useVoice) => {
            if (id !== this._seq) return;
            const myAttempt = ++attempt;
            this._clearTimers();

            try {
                if (synth.paused && synth.speaking) synth.resume();
            } catch { /* ignore */ }

            const launchAt = Date.now();
            let endedCount = 0;
            let erroredCount = 0;
            let idlePolls = 0;
            const total = chunks.length;

            const queue = chunks.map((chunk) => {
                const u = new window.SpeechSynthesisUtterance(chunk);
                if (useVoice && this._voice) {
                    try { u.voice = this._voice; } catch { /* ignore */ }
                    u.lang = (this._voice.lang || 'fr-FR').replace('_', '-');
                } else {
                    u.lang = 'fr-FR';
                }
                u.rate = 1.0;
                u.pitch = 1.0;

                const markStarted = () => {
                    if (id !== this._seq || myAttempt !== attempt) return;
                    started = true;
                    sawSpeaking = true;
                    if (!synthStartedAt) synthStartedAt = Date.now();
                    idlePolls = 0;
                };

                u.onstart = markStarted;
                u.onboundary = markStarted;

                u.onend = () => {
                    if (id !== this._seq || myAttempt !== attempt) return;
                    endedCount += 1;
                    if (endedCount + erroredCount >= total) {
                        const elapsedSinceLaunch = Date.now() - launchAt;
                        const genuinelySpoken = started || sawSpeaking || (erroredCount === 0 && elapsedSinceLaunch >= 250);
                        finish(genuinelySpoken);
                    }
                };

                u.onerror = () => {
                    if (id !== this._seq || myAttempt !== attempt) return;
                    // Certaines voix iOS/Android échouent quand u.voice est forcé : on retente sans voix explicite.
                    if (useVoice && this._voice && !retriedWithoutVoice && !started && !sawSpeaking && endedCount === 0 && erroredCount === 0) {
                        retriedWithoutVoice = true;
                        attempt += 1;
                        try {
                            if (synth.speaking || synth.pending) synth.cancel();
                        } catch { /* ignore */ }
                        launch(false);
                        return;
                    }
                    erroredCount += 1;
                    if (endedCount + erroredCount >= total) {
                        finish(started || sawSpeaking);
                    }
                };

                return u;
            });

            // Conserver toutes les utterances référencées pour éviter le ramasse-miettes sur mobile/Chrome.
            this._utterances = queue;

            try {
                for (const u of queue) {
                    if (id !== this._seq || myAttempt !== attempt) return;
                    synth.speak(u);
                }
            } catch {
                if (id !== this._seq || myAttempt !== attempt) return;
                if (useVoice && this._voice && !retriedWithoutVoice && !started && !sawSpeaking) {
                    retriedWithoutVoice = true;
                    launch(false);
                    return;
                }
                finish(false);
                return;
            }

            this._pollTimer = setInterval(() => {
                if (id !== this._seq || myAttempt !== attempt) {
                    this._clearTimers();
                    return;
                }
                const now = Date.now();
                const elapsed = now - launchAt;
                const totalElapsed = now - requestedAt;
                if (totalElapsed > maxMs) {
                    finish(started || sawSpeaking);
                    return;
                }

                let isSpeaking = false;
                let isPending = false;
                let isPaused = false;
                try {
                    isSpeaking = Boolean(synth.speaking);
                    isPending = Boolean(synth.pending);
                    isPaused = Boolean(synth.paused);
                    if (isPaused && isSpeaking) synth.resume();
                } catch {
                    finish(started || sawSpeaking);
                    return;
                }

                if (isSpeaking) {
                    sawSpeaking = true;
                    if (!synthStartedAt) synthStartedAt = now;
                    idlePolls = 0;
                    return;
                }

                if (isPending) {
                    idlePolls = 0;
                    if (!started && !sawSpeaking && elapsed > PENDING_STALL_MS) {
                        if (useVoice && this._voice && !retriedWithoutVoice) {
                            retriedWithoutVoice = true;
                            try { synth.cancel(); } catch { /* ignore */ }
                            launch(false);
                            return;
                        }
                        finish(false);
                    }
                    return;
                }

                // Safari < 27 : cancel() peut supprimer asynchrone­ment la phrase qui vient d'être mise en file.
                if (wasBusy && !retriedCancel && !started && !sawSpeaking && endedCount === 0 && erroredCount === 0 && elapsed >= CANCEL_RETRY_MS) {
                    retriedCancel = true;
                    launch(useVoice);
                    return;
                }

                if (!started && !sawSpeaking) {
                    if (elapsed >= START_GRACE_MS) {
                        finish(false);
                    }
                    return;
                }

                // Déjà démarré puis silence prolongé (onend parfois omis sur iOS/Android en file multi-segments).
                idlePolls += 1;
                if (idlePolls >= IDLE_POLLS_REQUIRED) {
                    finish(true);
                }
            }, POLL_INTERVAL_MS);
        };

        // Lancement synchrone dans le fil de l'appel pour préserver le geste utilisateur (iOS Safari).
        launch(true);
    }

    stop() {
        const wasActive = this._speaking || this._utterances.length > 0;
        this._seq++;
        this._clearTimers();
        this._utterances = [];
        this._setSpeaking(false);
        const synth = this._synth();
        if (synth) {
            let busy = false;
            try { busy = Boolean(synth.speaking || synth.pending); } catch { busy = false; }
            if (wasActive || busy) {
                try { synth.cancel(); } catch { /* ignore */ }
                this._unlocked = false;
                this._armGestureUnlock();
            }
        }
    }

    _clearTimers() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }

    /** Attend la fin de la phrase en cours et renvoie le résultat de lecture. */
    awaitIdle(timeoutMs = 75000) {
        if (!this._speaking) return Promise.resolve(this._lastResult);
        return new Promise((resolve) => {
            let done = false;
            let unsub = null;
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                unsub?.();
                resolve(this._lastResult);
            }, timeoutMs);
            unsub = this.subscribeSpeaking((speaking) => {
                if (!speaking && !done) {
                    done = true;
                    clearTimeout(timer);
                    unsub?.();
                    resolve(this._lastResult);
                }
            });
        });
    }
}

export const narrator = new WebNarrator();

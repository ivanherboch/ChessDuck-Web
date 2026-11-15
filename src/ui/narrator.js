/**
 * Synthèse vocale Web (Web Speech API) pour la lecture à voix haute des leçons de l'Académie.
 * Optimisée pour iPhone (iOS Safari / PWA), Android (Chrome / WebView) et navigateurs de bureau.
 */
const MAX_CHUNK_CHARS = 140;
const START_GRACE_MS = 2400;
const VOICE_FALLBACK_MS = 950;
const PENDING_FALLBACK_MS = 1600;
const PENDING_STALL_MS = 7000;
const CANCEL_RETRY_MS = 160;
const POST_CANCEL_DELAY_MS = 80;
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
        this._altVoice = null;
        this._utterances = [];
        this._unlockUtterance = null;
        this._pollTimer = null;
        this._deferTimer = null;
        this._lastCancelAt = 0;
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

    _isAppleWebKit() {
        if (typeof navigator === 'undefined') return false;
        const ua = navigator.userAgent || '';
        const platform = navigator.platform || '';
        const touchPts = navigator.maxTouchPoints || 0;
        if (/iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && touchPts > 1)) {
            return true;
        }
        return /Macintosh/i.test(ua)
            && /Safari/i.test(ua)
            && !/Chrome|Chromium|Edg|OPR|Firefox|SamsungBrowser|Android/i.test(ua);
    }

    _isAndroid() {
        if (typeof navigator === 'undefined') return false;
        return /Android/i.test(navigator.userAgent || '');
    }

    _prefersLangOnly() {
        return this._isAndroid();
    }

    _armGestureUnlock() {
        if (typeof window === 'undefined' || this._gestureArmed || !this._isAppleWebKit()) return;
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

    /** Déverrouille l'audio WebKit (iOS/macOS Safari) sans polluer la file Chrome/Android avec un blanc. */
    unlock(force = false) {
        if (!force && this._unlocked) {
            this._disarmGestureUnlock();
            return false;
        }
        if (this._speaking || this._available === false) return false;
        const synth = this._synth();
        if (!synth) return false;

        if (!this._isAppleWebKit()) {
            try {
                if (synth.paused) synth.resume();
            } catch { /* ignore */ }
            this._unlocked = true;
            this._disarmGestureUnlock();
            return false;
        }

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
            const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
            const usable = offline ? frVoices.filter((v) => v.localService !== false) : frVoices;
            this._voice = usable[0] || null;
            this._altVoice = usable[1] || null;
        } else {
            this._voice = null;
            this._altVoice = null;
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

    /** Découpe un texte long en segments naturels (< 140 car.) pour éviter la coupure à 15 s sur Chrome. */
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

        const appleWebKit = this._isAppleWebKit();
        const wasBusy = Boolean(synth.speaking || synth.pending);
        if (wasBusy) {
            this._lastCancelAt = requestedAt;
            try { synth.cancel(); } catch { /* ignore */ }
        }
        const sinceCancel = requestedAt - this._lastCancelAt;

        const candidates = [];
        const addCandidate = (c) => {
            if (!candidates.includes(c)) candidates.push(c);
        };
        if (this._prefersLangOnly()) {
            addCandidate(null);
            addCandidate(this._voice);
            addCandidate(this._altVoice);
        } else {
            addCandidate(this._voice);
            addCandidate(this._altVoice);
            addCandidate(null);
        }
        const maxMs = Math.max(15000, Math.min(75000, 5000 + clean.length * 160));
        let attempt = 0;
        let started = false;
        let sawSpeaking = false;
        let synthStartedAt = 0;
        let chunkIdx = 0;
        let chunkFinishedCount = 0;
        let erroredCount = 0;
        let retriedCancel = false;
        let candidateIdx = 0;

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

        const scheduleLaunch = (voiceCandidate, delayMs) => {
            if (id !== this._seq) return;
            this._clearTimers();
            if (delayMs > 0 && !appleWebKit) {
                this._deferTimer = setTimeout(() => {
                    this._deferTimer = null;
                    launch(voiceCandidate);
                }, delayMs);
            } else {
                launch(voiceCandidate);
            }
        };

        const retryAlternateVoice = () => {
            if (id !== this._seq || candidateIdx + 1 >= candidates.length) return false;
            candidateIdx += 1;
            const altVoice = candidates[candidateIdx];
            attempt += 1;
            chunkIdx = 0;
            chunkFinishedCount = 0;
            erroredCount = 0;
            try {
                if (synth.speaking || synth.pending) {
                    this._lastCancelAt = Date.now();
                    synth.cancel();
                }
            } catch { /* ignore */ }
            scheduleLaunch(altVoice, POST_CANCEL_DELAY_MS);
            return true;
        };

        const launch = (voiceCandidate) => {
            if (id !== this._seq) return;
            const myAttempt = ++attempt;
            this._clearTimers();

            try {
                if (synth.paused) synth.resume();
            } catch { /* ignore */ }

            const launchAt = Date.now();
            let idlePolls = 0;

            const speakCurrentChunk = () => {
                if (id !== this._seq || myAttempt !== attempt) return;
                if (chunkIdx >= chunks.length) {
                    const elapsedSinceLaunch = Date.now() - launchAt;
                    const genuinelySpoken = started || sawSpeaking || (erroredCount === 0 && elapsedSinceLaunch >= 250);
                    finish(genuinelySpoken);
                    return;
                }

                const u = new window.SpeechSynthesisUtterance(chunks[chunkIdx]);
                if (voiceCandidate) {
                    try { u.voice = voiceCandidate; } catch { /* ignore */ }
                    u.lang = (voiceCandidate.lang || 'fr-FR').replace('_', '-');
                } else {
                    u.lang = 'fr-FR';
                }
                u.rate = 1.0;
                u.pitch = 1.0;

                let chunkDone = false;

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
                    if (id !== this._seq || myAttempt !== attempt || chunkDone) return;
                    chunkDone = true;
                    chunkFinishedCount += 1;
                    idlePolls = 0;
                    if (chunkIdx + 1 < chunks.length) {
                        chunkIdx += 1;
                        speakCurrentChunk();
                    } else {
                        const elapsedSinceLaunch = Date.now() - launchAt;
                        const genuinelySpoken = started || sawSpeaking || (erroredCount === 0 && elapsedSinceLaunch >= 250);
                        finish(genuinelySpoken);
                    }
                };

                u.onerror = () => {
                    if (id !== this._seq || myAttempt !== attempt || chunkDone) return;
                    chunkDone = true;
                    // En cas d'échec avant démarrage, basculer entre u.voice explicite, voix alternative ou u.lang seul.
                    if (!started && !sawSpeaking && chunkFinishedCount === 0 && erroredCount === 0 && retryAlternateVoice(voiceCandidate)) {
                        return;
                    }
                    erroredCount += 1;
                    if (chunkIdx + 1 < chunks.length) {
                        chunkIdx += 1;
                        speakCurrentChunk();
                    } else {
                        finish(started || sawSpeaking);
                    }
                };

                // Conserver une référence forte pour éviter le ramasse-miettes sur mobile/Chrome.
                this._utterances = [u];

                try {
                    synth.speak(u);
                    if (synth.paused) synth.resume();
                } catch {
                    if (id !== this._seq || myAttempt !== attempt) return;
                    if (!started && !sawSpeaking && retryAlternateVoice(voiceCandidate)) return;
                    finish(false);
                }
            };

            speakCurrentChunk();

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
                try {
                    isSpeaking = Boolean(synth.speaking);
                    isPending = Boolean(synth.pending);
                    if (synth.paused) synth.resume();
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
                    if (!started && !sawSpeaking) {
                        if (elapsed >= PENDING_FALLBACK_MS && retryAlternateVoice(voiceCandidate)) {
                            return;
                        }
                        if (elapsed > PENDING_STALL_MS) {
                            finish(false);
                        }
                    }
                    return;
                }

                // Safari < 27 : cancel() peut supprimer asynchrone­ment la phrase qui vient d'être mise en file.
                if (appleWebKit && wasBusy && !retriedCancel && !started && !sawSpeaking && chunkFinishedCount === 0 && erroredCount === 0 && elapsed >= CANCEL_RETRY_MS) {
                    retriedCancel = true;
                    launch(voiceCandidate);
                    return;
                }

                // Sur Chrome Desktop/Android, une voix silencieusement bloquée (!speaking && !pending) doit retenter le mode alternatif.
                if (!started && !sawSpeaking) {
                    if (elapsed >= VOICE_FALLBACK_MS && retryAlternateVoice()) {
                        return;
                    }
                    const graceMs = candidateIdx === 0 ? START_GRACE_MS : 1300;
                    if (elapsed >= graceMs) {
                        finish(false);
                    }
                    return;
                }

                // Déjà démarré puis silence prolongé (onend parfois omis sur Chrome/Android/iOS).
                idlePolls += 1;
                if (idlePolls >= IDLE_POLLS_REQUIRED) {
                    idlePolls = 0;
                    if (chunkIdx + 1 < chunks.length) {
                        chunkIdx += 1;
                        speakCurrentChunk();
                    } else {
                        finish(true);
                    }
                }
            }, POLL_INTERVAL_MS);
        };

        // Chrome/Blink annule asynchrone­ment les voix : après un cancel(), attendre ~80 ms avant speak().
        if (!appleWebKit && (wasBusy || sinceCancel < POST_CANCEL_DELAY_MS)) {
            const delay = wasBusy ? POST_CANCEL_DELAY_MS : Math.max(20, POST_CANCEL_DELAY_MS - sinceCancel);
            scheduleLaunch(candidates[0], delay);
        } else {
            launch(candidates[0]);
        }
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
                this._lastCancelAt = Date.now();
                try { synth.cancel(); } catch { /* ignore */ }
                if (this._isAppleWebKit()) {
                    this._unlocked = false;
                    this._armGestureUnlock();
                }
            }
        }
    }

    _clearTimers() {
        if (this._deferTimer) {
            clearTimeout(this._deferTimer);
            this._deferTimer = null;
        }
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

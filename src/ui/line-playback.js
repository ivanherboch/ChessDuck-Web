import { fileOf } from '../core/chess.js';

let animCounter = 0;
export function nextAnimId() {
    animCounter += 1;
    return animCounter;
}

export function moveAnim(before, m) {
    const slides = [{ from: m.from, to: m.to }];
    if (before.isCastle(m)) {
        if (fileOf(m.to) === 6) slides.push({ from: m.to + 1, to: m.to - 1 });
        else slides.push({ from: m.to - 2, to: m.to + 1 });
    }
    return { id: nextAnimId(), slides, capture: before.isCapture(m), promotion: m.promo !== 0 };
}

export function undoAnim(before, m) {
    return { id: nextAnimId(), slides: moveAnim(before, m).slides.map((s) => ({ from: s.to, to: s.from })) };
}

/**
 * Navigation dans une suite de coups (Line) partagée par l'Académie et la revue de partie :
 * animation de transition de curseur et lecture automatique annulable.
 */
export class LinePlaybackController {
    constructor() {
        this._token = 0;
        this._timer = null;
    }

    cancel() {
        this._token += 1;
        if (this._timer !== null) {
            clearTimeout(this._timer);
            this._timer = null;
        }
    }

    launch(asyncFn) {
        this.cancel();
        const myToken = this._token;
        const isCancelled = () => myToken !== this._token;
        const wait = (ms) => new Promise((resolve) => {
            if (isCancelled()) { resolve(false); return; }
            this._timer = setTimeout(() => {
                this._timer = null;
                resolve(!isCancelled());
            }, ms);
        });
        asyncFn({ isCancelled, wait });
    }

    autoplay({ cursor, size, delayFor, checkBeforeDelay, awaitReady = async () => {}, advance, onEnd }) {
        this.launch(async ({ isCancelled, wait }) => {
            while (!isCancelled()) {
                const before = cursor();
                if (before === null || before === undefined) return;
                if (checkBeforeDelay && before >= size()) break;
                await awaitReady();
                if (isCancelled()) return;
                const ok = await wait(delayFor(before));
                if (!ok || isCancelled()) return;
                const now = cursor();
                if (now === null || now === undefined) return;
                if (!checkBeforeDelay && now >= size()) break;
                advance(now + 1);
            }
            if (!isCancelled()) onEnd();
        });
    }

    static transition(line, from, to) {
        if (to === from + 1) return moveAnim(line.positions[from], line.moves[from]);
        if (to === from - 1) return undoAnim(line.positions[to], line.moves[to]);
        return null;
    }
}

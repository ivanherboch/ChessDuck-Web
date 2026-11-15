import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
    BISHOP, BLACK, GameEnd, KING, KNIGHT, Line, Move, PAWN, Position, QUEEN, ROOK, START_FEN,
    pieceChar, pieceFromChar, pieceLetter, pieceType, sq, sqFromName, sqName,
} from '../src/core/chess.js';
import { Lessons, LessonCategory, CATEGORY_LABELS } from '../src/core/lessons.js';
import { PieceLexiconFr } from '../src/core/piece-fr.js';
import { PuzzleThemes } from '../src/core/puzzle-themes.js';
import { MATE, isMateScore, mateIn, winPercent } from '../src/core/stockfish.js';
import { normalizeForSearch } from '../src/core/text.js';
import { Analysis, GameLogic } from '../src/features/game-logic.js';
import { NotationLogic } from '../src/features/notation-logic.js';
import { ReviewComments, Voice } from '../src/features/review-comments.js';
import { ShareCard, ShareFormat, shareStyleFromSettings } from '../src/features/share-card.js';
import { BoardGeometry } from '../src/ui/board-geometry.js';
import { LinePlaybackController } from '../src/ui/line-playback.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function perft(pos, depth) {
    if (depth === 0) return 1;
    const moves = pos.legalMoves;
    if (depth === 1) return moves.length;
    let total = 0;
    for (const m of moves) total += perft(pos.play(m), depth - 1);
    return total;
}

test('Chess: start position FEN, perft(1..3), and Kiwipete perft(2)', () => {
    const start = Position.START;
    assert.equal(start.toFen(), START_FEN);
    assert.equal(start.legalMoves.length, 20);
    assert.equal(perft(start, 2), 400);
    assert.equal(perft(start, 3), 8902);

    const kiwipete = Position.fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    assert.equal(kiwipete.legalMoves.length, 48);
    assert.equal(perft(kiwipete, 2), 2039);
});

test('Chess: castling, en passant, promotion, SAN disambiguation & FEN ep canonicalization', () => {
    // En passant
    const l = Line.fromSan(START_FEN, ['e4', 'a6', 'e5', 'd5']);
    const epSq = l.last.ep;
    assert.equal(sqName(epSq), 'd6');
    const epMove = l.last.parseSan('exd6');
    assert.ok(epMove);
    assert.equal(l.last.isEnPassant(epMove), true);
    assert.equal(l.last.san(epMove), 'exd6');
    const afterEp = l.last.play(epMove);
    assert.equal(afterEp.at(sqFromName('d5')), 0);
    assert.equal(afterEp.at(sqFromName('d6')), PAWN);

    // En passant square in FEN must vanish when no legal ep capture exists
    const noEp = Position.fromFen(START_FEN).play(Move.fromUci('e2e4'));
    assert.equal(noEp.ep, sqFromName('e3'));
    assert.ok(noEp.toFen().includes(' - '));

    // Castling & castling rights updates
    const castlePos = Position.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    const oo = castlePos.parseSan('O-O');
    assert.ok(oo);
    assert.equal(castlePos.isCastle(oo), true);
    const afterOO = castlePos.play(oo);
    assert.equal(afterOO.at(sqFromName('g1')), KING);
    assert.equal(afterOO.at(sqFromName('f1')), ROOK);
    assert.equal(afterOO.at(sqFromName('h1')), 0);
    assert.equal(afterOO.castling & 3, 0);
    assert.equal(afterOO.castling & 12, 12);

    // Capturing enemy rook strips opponent castling right
    const rookCap = Position.fromFen('r3k2r/8/8/8/8/8/R7/4K3 w kq - 0 1');
    const rxa8 = rookCap.parseSan('Rxa8+');
    assert.ok(rxa8);
    assert.equal(rookCap.play(rxa8).castling, 4); // only 'k' remains

    // Promotion with mate
    const promoPos = Position.fromFen('6k1/4P3/6K1/8/8/8/8/8 w - - 0 1');
    const qPromo = promoPos.parseSan('e8=Q');
    assert.ok(qPromo);
    assert.equal(qPromo.promo, QUEEN);
    assert.equal(promoPos.san(qPromo), 'e8=Q#');

    // Disambiguation by file, rank, and square
    const fileDis = Position.fromFen('6k1/8/8/8/8/8/8/R3R1K1 w - - 0 1');
    assert.equal(fileDis.san(Move.fromUci('a1c1')), 'Rac1');
    assert.equal(fileDis.san(Move.fromUci('e1c1')), 'Rec1');

    const rankDis = Position.fromFen('6k1/8/8/R7/8/8/8/R5K1 w - - 0 1');
    assert.equal(rankDis.san(Move.fromUci('a1a3')), 'R1a3');
    assert.equal(rankDis.san(Move.fromUci('a5a3')), 'R5a3');

    const fullDis = Position.fromFen('6k1/8/8/8/Q7/8/8/Q2Q2K1 w - - 0 1');
    assert.equal(fullDis.san(Move.fromUci('a1d4')), 'Qa1d4');
});

test('Chess: GameEnd detection (checkmate, stalemate, insufficient material, 50-move, threefold repetition)', () => {
    // Fool's mate
    const fools = Line.fromSan(START_FEN, ['f3', 'e5', 'g4', 'Qh4#']);
    assert.equal(fools.end(), GameEnd.CHECKMATE);

    // Stalemate
    const stale = new Line('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    assert.equal(stale.end(), GameEnd.STALEMATE);

    // Insufficient material: K+B vs K has 1 minor
    assert.equal(new Line('4k3/8/8/8/8/8/4B3/4K3 w - - 0 1').end(), GameEnd.INSUFFICIENT);
    assert.equal(new Line('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1').end(), GameEnd.NONE);

    // 50-move rule
    assert.equal(new Line('4k3/8/8/8/8/8/4P3/4K3 w - - 100 60').end(), GameEnd.FIFTY_MOVES);

    // Threefold repetition
    const rep = Line.fromSan(START_FEN, ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']);
    assert.equal(rep.end(), GameEnd.REPETITION);
});

test('PieceLexiconFr & text utilities', () => {
    assert.equal(PieceLexiconFr.definite(QUEEN), 'la dame');
    assert.equal(PieceLexiconFr.definite(KNIGHT), 'le cavalier');
    assert.equal(PieceLexiconFr.definiteCapitalized(ROOK), 'La tour');
    assert.equal(PieceLexiconFr.indefinite(BISHOP), 'un fou');
    assert.equal(PieceLexiconFr.indefinite(QUEEN), 'une dame');
    assert.equal(PieceLexiconFr.possessive(ROOK, true), 'ta tour');
    assert.equal(PieceLexiconFr.possessive(KNIGHT, false), 'son cavalier');
    assert.equal(PieceLexiconFr.count(PAWN, 1), '1 pion');
    assert.equal(PieceLexiconFr.count(PAWN, 3), '3 pions');
    assert.equal(normalizeForSearch('Échec à la découverte !'), 'echec a la decouverte !');
});

test('NotationLogic: levels, pick, diagnose, hint, explain', () => {
    // Level classification
    const p1 = Position.START;
    assert.equal(NotationLogic.levelOf(p1, p1.parseSan('e4'), 'e4'), 1);

    const pCap = Position.fromFen('rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
    assert.equal(NotationLogic.levelOf(pCap, pCap.parseSan('exd5'), 'exd5'), 2);

    const pCastle = Position.fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    assert.equal(NotationLogic.levelOf(pCastle, pCastle.parseSan('O-O'), 'O-O'), 3);

    // Deterministic pick across fallback positions
    const fallbacks = NotationLogic.buildFallbackPositions();
    let seed = 42;
    const rnd = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const pickedLv3 = NotationLogic.pick(fallbacks, 3, rnd, 1); // castling
    assert.ok(pickedLv3);
    assert.ok(pickedLv3.san.startsWith('O-O'));

    // Pedagogical diagnostics should never mention Stockfish and should catch K/N swap, Pe4, missing +, wrong mat vs check
    const knightEx = {
        before: Position.START,
        move: Position.START.parseSan('Nf3'),
        san: 'Nf3',
        level: 1,
    };
    assert.match(NotationLogic.diagnose('Kf3', knightEx), /N = Knight/);
    assert.match(NotationLogic.diagnose('Pe4', { before: Position.START, move: Position.START.parseSan('e4'), san: 'e4', level: 1 }), /aucune|n'ont pas de lettre/);

    const promoPos = Position.fromFen('6k1/4P3/6K1/8/8/8/8/8 w - - 0 1');
    const mateEx = { before: promoPos, move: promoPos.parseSan('e8=Q'), san: 'e8=Q#', level: 3 };
    assert.match(NotationLogic.diagnose('e8=Q+', mateEx), /aucune parade.*#/);
    assert.equal(NotationLogic.hint(knightEx, 0).includes('Nf3'), false);
    assert.ok(NotationLogic.hint(knightEx, 2).includes('Nf3'));
    assert.equal(/stockfish/i.test(NotationLogic.explain(mateEx)), false);
});

test('Lessons asset: all 113 lessons in assets/lessons.json validate cleanly', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/lessons.json'), 'utf8'));
    assert.equal(raw.length, 113);
    const lessons = Lessons.initFromData(raw);
    const ids = new Set();
    for (const l of lessons) {
        assert.ok(!ids.has(l.id), `Duplicate lesson id: ${l.id}`);
        ids.add(l.id);
        assert.ok(Object.values(LessonCategory).includes(l.category), `Invalid category ${l.category}`);
        assert.ok(CATEGORY_LABELS[l.category]);
        assert.equal(typeof l.heroWhite, 'boolean');
        const line = l.line;
        assert.equal(l.texts.length, line.size, `Lesson ${l.id} (${l.title}) texts=${l.texts.length} line=${line.size}`);
        assert.ok(line.size >= 1, `Lesson ${l.id} has 0 moves`);
        assert.equal(/stockfish/i.test(l.summary + ' ' + l.texts.join(' ')), false);
    }
});

test('Puzzle assets & PuzzleThemes: meta.bin.gz, starter.tsv.gz, chunk_00.tsv.gz integrity', () => {
    assert.equal(PuzzleThemes.all.length, 50);
    assert.equal(PuzzleThemes.PRIORITY.length, 50);
    assert.equal(PuzzleThemes.primary('opening sacrifice fork').key, 'fork');
    assert.equal(PuzzleThemes.primary('unknownThemeXYZ').key, 'middlegame');

    const metaBuf = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'assets/puzzles/meta.bin.gz')));
    assert.equal(metaBuf.length, 150_000 * 8);

    const rowToId = new Array(150_000);
    const idToRow = new Map();
    for (let i = 0; i < 150_000; i++) {
        const o = i * 8;
        const id = String.fromCharCode(metaBuf[o], metaBuf[o + 1], metaBuf[o + 2], metaBuf[o + 3], metaBuf[o + 4]);
        assert.match(id, /^[0-9A-Za-z]{5}$/, `Bad puzzle id at row ${i}: ${id}`);
        const rating = metaBuf[o + 5] | (metaBuf[o + 6] << 8);
        assert.ok(rating >= 300 && rating <= 3600, `Unexpected rating ${rating} at row ${i}`);
        const themeIdx = metaBuf[o + 7] & 127;
        assert.ok(themeIdx < PuzzleThemes.all.length, `Out-of-range themeIdx ${themeIdx}`);
        rowToId[i] = id;
        idToRow.set(id, { i, rating, themeIdx });
    }

    const starterTxt = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'assets/puzzles/starter.tsv.gz'))).toString('utf8');
    const starterLines = starterTxt.trimEnd().split('\n');
    assert.ok(starterLines.length >= 200, `Expected rich starter set, got ${starterLines.length}`);
    for (const ln of starterLines) {
        const [rowStr, id, fen, moves, ratingStr, themes, primaryTheme] = ln.split('\t');
        const row = parseInt(rowStr, 10);
        const m = idToRow.get(id);
        assert.ok(m && m.i === row, `Starter puzzle ${id} row ${row} mismatches meta`);
        assert.equal(parseInt(ratingStr, 10), m.rating);
        assert.equal(primaryTheme, PuzzleThemes.primary(themes).key);
        const line = Line.fromUci(fen, moves);
        assert.ok(line.size >= 2);
    }

    const chunk0Txt = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'assets/puzzles/chunk_00.tsv.gz'))).toString('utf8');
    const c0Lines = chunk0Txt.trimEnd().split('\n');
    assert.equal(c0Lines.length, 5000);
    for (let r = 0; r < c0Lines.length; r++) {
        const [id, fen, moves, ratingStr, themes, primaryTheme] = c0Lines[r].split('\t');
        assert.equal(id, rowToId[r]);
        assert.equal(primaryTheme, PuzzleThemes.primary(themes).key);
        if (r < 50) {
            const line = Line.fromUci(fen, moves);
            assert.ok(line.size >= 2);
        }
        assert.ok(parseInt(ratingStr, 10) > 0);
    }
});

test('GameLogic, Stockfish helpers & ReviewComments', () => {
    // Stockfish math helpers
    assert.equal(isMateScore(MATE - 1), true);
    assert.equal(mateIn(MATE - 1), 1);
    assert.equal(mateIn(MATE - 3), 2);
    assert.equal(mateIn(-(MATE - 2)), -1);
    assert.equal(Math.round(winPercent(0)), 50);

    // ELO K=32
    assert.equal(GameLogic.newElo(1200, 1200, 1.0), 1216);
    assert.equal(GameLogic.newElo(1200, 1200, 0.5), 1200);
    assert.equal(GameLogic.newElo(1200, 1200, 0.0), 1184);

    // Analysis codec round-trip
    const encoded = Analysis.encodeAll([new Analysis(45, -10, 'e2e4'), null, new Analysis(MATE - 1, 200, 'd1h5')]);
    const decoded = Analysis.decodeAll(encoded, 3);
    assert.equal(decoded[0].eval, 45);
    assert.equal(decoded[0].second, -10);
    assert.equal(decoded[0].best, 'e2e4');
    assert.equal(decoded[1], null);
    assert.equal(decoded[2].eval, MATE - 1);

    // Annotations: ??, ?, ?!, !, !!, and missedMate
    const start = Position.START;
    const e4 = start.parseSan('e4');
    assert.equal(GameLogic.annotate(start, e4, new Analysis(30, 20, 'e2e4'), new Analysis(25, null, 'e7e5'), null), null);
    assert.equal(GameLogic.annotate(start, e4, new Analysis(300, 100, 'd2d4'), new Analysis(-250, null, 'e7e5'), null), '??');
    assert.equal(GameLogic.annotate(start, e4, new Analysis(50, -300, 'e2e4'), new Analysis(50, null, 'e7e5'), null), '!');

    // Sacrifice with !! (Nxf7 undefended, Black king attacks f7)
    const knightSacPos = Position.fromFen('r1bqk2r/pppp1ppp/2n2n2/2b1p1N1/4P3/8/PPPP1PPP/RNBQKB1R w KQkq - 0 5');
    const nf7 = knightSacPos.parseSan('Nxf7');
    assert.equal(
        GameLogic.annotate(knightSacPos, nf7, new Analysis(180, -120, nf7.uci), new Analysis(180, null, 'e8f7'), null),
        '!!',
    );

    assert.equal(GameLogic.missedMate(true, new Analysis(MATE - 1, 100, 'd1h5'), new Analysis(200, null, 'e7e5')), 1);
    assert.equal(GameLogic.missedMate(true, new Analysis(MATE - 3, 100, 'd1h5'), new Analysis(MATE - 2, null, 'e7e5')), null);

    // ReviewComments
    const game = { vsComputer: true, playerWhite: true, whiteName: 'Moi', blackName: '', result: '0-1', reason: 'échec et mat' };
    const line = Line.fromSan(START_FEN, ['f3', 'e5', 'g4', 'Qh4#']);
    const cMate = ReviewComments.comment(game, line, 3, []);
    assert.match(cMate.text, /Échec et mat ! L'ordinateur \(Noirs\) conclut/);
    assert.equal(/stockfish/i.test(cMate.text), false);

    const endMsg = ReviewComments.ending({ ...game, reason: 'échec et mat' });
    assert.equal(endMsg, "Fin de la partie : victoire de l'ordinateur (Noirs) par échec et mat.");
    assert.equal(new Voice('Moi', true, true).f('tu', 'il'), 'tu');
    assert.equal(new Voice("L'ordinateur", false, false).f('tu', 'il'), 'il');
});

test('WCAG 2.1 AA contrast across Day, Night and Kid palettes', async () => {
    const { DuckPalette, KidColors } = await import('../src/ui/theme.js');

    const parseColor = (str) => {
        if (str.startsWith('#')) {
            const h = str.slice(1);
            return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255, 1];
        }
        const m = str.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)/);
        return [parseFloat(m[1]) / 255, parseFloat(m[2]) / 255, parseFloat(m[3]) / 255, m[4] !== undefined ? parseFloat(m[4]) : 1];
    };
    const over = (fgStr, bgStr) => {
        const fg = parseColor(fgStr);
        const bg = parseColor(bgStr);
        const a = fg[3];
        return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)];
    };
    const relLum = ([r, g, b]) => {
        const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (fg, bg) => {
        const l1 = relLum(fg.length === 3 ? fg : parseColor(fg));
        const l2 = relLum(bg.length === 3 ? bg : parseColor(bg));
        const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
        return (hi + 0.05) / (lo + 0.05);
    };

    const failures = [];
    const check = (name, fg, bg, min = 4.5) => {
        const r = ratio(fg, bg);
        if (r < min) failures.push(`${name}: ${r.toFixed(2)} < ${min}`);
    };

    const allPalettes = [];
    for (const p of DuckPalette.entries) {
        assert.ok(typeof p.label === 'string' && p.label.length > 0, `Palette ${p.key} must have a label`);
        assert.ok(typeof p.description === 'string' && p.description.length > 0, `Palette ${p.key} must have a description`);
        allPalettes.push([`${p.label} Nuit`, p.night]);
        allPalettes.push([`${p.label} Jour`, p.day]);
    }
    allPalettes.push(['Enfant', KidColors]);

    for (const [tag, c] of allPalettes) {
        for (const [sn, s] of [['bg', c.bg], ['surface', c.surface], ['surfaceSubtle', c.surfaceSubtle], ['surfaceHi', c.surfaceHi]]) {
            check(`${tag} text/${sn}`, c.text, s);
            check(`${tag} muted/${sn}`, c.muted, s);
            check(`${tag} outlineStrong/${sn}`, c.outlineStrong, s, 3.0);
        }
        for (const [rn, role] of [['or', c.goldRole], ['vert', c.greenRole], ['bleu', c.blueRole], ['rouge', c.redRole]]) {
            for (const [sn, s] of [['bg', c.bg], ['surface', c.surface], ['surfaceSubtle', c.surfaceSubtle], ['surfaceHi', c.surfaceHi]]) {
                check(`${tag} accent ${rn}/${sn}`, role.text, s);
            }
            check(`${tag} ${rn} onFill/fill`, role.onFill, role.fill);
        }
        check(`${tag} coord/light`, c.coordInk, over(c.coordPill, c.squareLight));
        check(`${tag} coord/dark`, c.coordInk, over(c.coordPill, c.squareDark));
    }

    // Kid button faces vs white text
    for (const [name, hex] of [['blue', '#0369A1'], ['orange', '#C2410C'], ['coral', '#D93829'], ['green', '#237A36']]) {
        check(`Kid button ${name}`, '#FFFFFF', hex);
    }
    check('Kid button disabled', '#4A6785', '#DCEAF6');
    assert.deepEqual(failures, []);
});

test('ShareCard & BoardGeometry & LinePlaybackController', () => {
    const puzzle = {
        id: 'abcde',
        fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
        moves: 'e1e8',
        rating: 1100,
        themes: 'backRankMate mateIn1 oneMove',
    };
    const pos = Position.fromFen('6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1');
    const l = new Line(pos.toFen(), [pos.parseSan('Re8#')]);
    assert.equal(ShareCard.challenge(puzzle, l, true), 'Les Blancs jouent et font mat en 1');

    const desc = ShareCard.describe(pos, l.moves[0], l.sans[0]);
    assert.equal(desc, 'La tour va en e8 : échec et mat !');

    const style = shareStyleFromSettings({ shareFormat: 'SQUARE', shareLight: true, palette: 2 });
    assert.equal(style.format, ShareFormat.SQUARE);
    assert.equal(style.light, true);
    assert.equal(style.palette.ordinal, 2);

    // Knight L-arrow geometry
    const sqs = BoardGeometry.arrowSquares(sqFromName('g1'), sqFromName('f3'));
    assert.equal(sqs.length, 3);
    assert.equal(BoardGeometry.column(sqFromName('a1'), true), 7);
    assert.equal(BoardGeometry.row(sqFromName('a1'), true), 0);

    // LinePlaybackController step transition animations
    const animFwd = LinePlaybackController.transition(l, 0, 1);
    assert.equal(animFwd.slides.length, 1);
    const animBack = LinePlaybackController.transition(l, 1, 0);
    assert.equal(animBack.slides[0].from, l.moves[0].to);
});

test('Prefs: recentPuzzles and knownThemePuzzles tracking & pruning', async () => {
    const { prefs } = await import('../src/data/prefs.js');
    prefs._update({ recentPuzzles: [], knownThemePuzzles: [] });

    // Simulate opening puzzle p1 with category "Mat en 1" selected (themeVisible = true)
    prefs.pushRecentPuzzle('p1');
    prefs.markThemeKnown('p1');
    assert.deepEqual(prefs.current.recentPuzzles, ['p1']);
    assert.deepEqual(prefs.current.knownThemePuzzles, ['p1']);

    // Simulate clicking Random dice while still in "Mat en 1" -> p2 opened, p1 skipped
    prefs.pushRecentPuzzle('p2');
    prefs.markThemeKnown('p2');
    assert.deepEqual(prefs.current.recentPuzzles, ['p2', 'p1']);
    assert.ok(prefs.current.knownThemePuzzles.includes('p1'), 'Skipped puzzle p1 must keep known theme');
    assert.ok(prefs.current.knownThemePuzzles.includes('p2'));

    // Simulate switching to "Tous les problèmes" -> p3 opened without known theme
    prefs.pushRecentPuzzle('p3');
    assert.equal(prefs.current.knownThemePuzzles.includes('p3'), false);

    // Reveal theme on p3
    prefs.markThemeKnown('p3');
    assert.equal(prefs.current.knownThemePuzzles.includes('p3'), true);

    // Push 5 more puzzles so p1 drops out of the 6-item recentPuzzles list
    for (const id of ['p4', 'p5', 'p6', 'p7', 'p8']) {
        prefs.pushRecentPuzzle(id);
    }
    assert.equal(prefs.current.recentPuzzles.length, 6);
    assert.equal(prefs.current.recentPuzzles.includes('p1'), false);
    assert.equal(prefs.current.knownThemePuzzles.includes('p1'), false, 'knownThemePuzzles must prune IDs no longer in recentPuzzles');
    assert.equal(prefs.current.knownThemePuzzles.includes('p3'), true);
});

test('SpokenFr: SAN move translation and all 113 lesson texts free of English notation (v2.4.2)', async () => {
    const { SpokenFr } = await import('../src/core/spoken-fr.js');

    assert.equal(SpokenFr.move('e4'), 'e4');
    assert.equal(SpokenFr.move('Nf3'), 'cavalier f3');
    assert.equal(SpokenFr.move('Bxf7+'), 'fou prend f7, échec');
    assert.equal(SpokenFr.move('Qh7#'), 'dame h7, mat');
    assert.equal(SpokenFr.move('exd5'), 'e prend d5');
    assert.equal(SpokenFr.move('e8=Q+'), 'e8 promotion en dame, échec');
    assert.equal(SpokenFr.move('Rad1'), 'tour a d1');
    assert.equal(SpokenFr.move('R1e2'), 'tour 1 e2');
    assert.equal(SpokenFr.move('O-O'), 'petit roque');
    assert.equal(SpokenFr.move('O-O-O+'), 'grand roque, échec');
    assert.equal(SpokenFr.text('La variante 4.Ng5 attaque f7 avec 1.e4 e5.'), 'La variante cavalier g5 attaque f7 avec e4 e5.');

    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/lessons.json'), 'utf8'));
    const lessons = Lessons.initFromData(raw);
    const leftoverSan = /\b([KQRBN][a-h1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8]|O-O(-O)?)\b/;
    for (const l of lessons) {
        for (const s of [l.title, l.summary, ...l.texts]) {
            const spoken = SpokenFr.text(s);
            assert.equal(
                leftoverSan.test(spoken),
                false,
                `Leçon ${l.id} (${l.title}) contient encore de la notation brute après SpokenFr.text : "${spoken}"`,
            );
        }
        for (const san of l.line.sans) {
            const spokenMove = SpokenFr.move(san);
            assert.ok(spokenMove.length > 0);
            assert.equal(/[KQRBN+#=]/.test(spokenMove), false, `Coup non traduit : ${san} -> ${spokenMove}`);
        }
    }
});

test('v2.3.1..v2.4.2: mateFor, Analysis.decided, evalShort rounding & missedMate concordance', async () => {
    const { mateFor } = await import('../src/core/stockfish.js');
    const { evalShort } = await import('../src/ui/board.js');

    assert.equal(mateFor(MATE - 1, true), 1);
    assert.equal(mateFor(MATE - 1, false), null);
    assert.equal(mateFor(-(MATE - 3), false), 2);

    const matePos = Line.fromSan(START_FEN, ['f3', 'e5', 'g4', 'Qh4#']).last;
    assert.equal(Analysis.decided(matePos, GameEnd.CHECKMATE).eval, -MATE);
    assert.equal(Analysis.decided(Position.START, GameEnd.STALEMATE).eval, 0);

    assert.equal(evalShort(150), '+1.5');
    assert.equal(evalShort(-990), '−9.9');
    assert.equal(evalShort(1000), '+10');
    assert.equal(evalShort(-1240), '−12');

    // Missed mate in 1 where mate in 3 remains vs where mate is lost
    const g = { vsComputer: true, playerWhite: true, whiteName: 'Moi', blackName: '', result: '1-0', reason: 'échec et mat' };
    const line = Line.fromSan('6k1/5ppp/8/8/8/8/5PPP/3RR1K1 w - - 0 1', ['Kh1']);
    const cStillMate = ReviewComments.comment(g, line, 0, [
        new Analysis(MATE - 1, 500, 'e1e8'),
        new Analysis(MATE - 5, null, 'g8h8'),
    ]);
    assert.match(cStillMate.text, /il te faut encore 3 coups pour mater/);

    const cLostMate = ReviewComments.comment(g, line, 0, [
        new Analysis(MATE - 1, 500, 'e1e8'),
        new Analysis(300, null, 'g8h8'),
    ]);
    assert.match(cLostMate.text, /le mat n'est plus forcé/);
});

test('Prefs: sanitization and range clamping on corrupted storage and setters', async () => {
    const prevWin = globalThis.window;
    const store = new Map();
    store.set('chessduck_v2_settings', JSON.stringify({
        themeMode: 99,
        palette: -3,
        colorChoice: 8,
        puzzleBand: 'bad',
        notationLevel: 42,
        notationBest: -5,
        recentPuzzles: ['a', 123, '', null],
        knownThemePuzzles: ['a', false, ''],
    }));
    globalThis.window = {
        localStorage: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => { store.set(k, v); },
        },
    };
    try {
        const { prefs, DEFAULT_SETTINGS } = await import('../src/data/prefs.js?sanit=1');
        assert.equal(prefs.current.themeMode, DEFAULT_SETTINGS.themeMode);
        assert.equal(prefs.current.palette, DEFAULT_SETTINGS.palette);
        assert.equal(prefs.current.colorChoice, DEFAULT_SETTINGS.colorChoice);
        assert.equal(prefs.current.puzzleBand, DEFAULT_SETTINGS.puzzleBand);
        assert.equal(prefs.current.notationLevel, DEFAULT_SETTINGS.notationLevel);
        assert.equal(prefs.current.notationBest, 0);
        assert.deepEqual(prefs.current.recentPuzzles, ['a']);
        assert.deepEqual(prefs.current.knownThemePuzzles, ['a']);

        prefs.setPalette(99);
        assert.equal(prefs.current.palette, DEFAULT_SETTINGS.palette);
        prefs.setPalette(4);
        assert.equal(prefs.current.palette, 4);
        prefs.setThemeMode(-1);
        assert.equal(prefs.current.themeMode, DEFAULT_SETTINGS.themeMode);
        prefs.setPuzzleFilter(9, 456);
        assert.equal(prefs.current.puzzleBand, DEFAULT_SETTINGS.puzzleBand);
        assert.equal(prefs.current.puzzleTheme, '');
    } finally {
        if (prevWin === undefined) delete globalThis.window;
        else globalThis.window = prevWin;
    }
});

test('WebNarrator: prepare, speak, stop, subscriptions and iOS gesture listener', async () => {
    const prevWin = globalThis.window;
    const prevDoc = globalThis.document;
    const listeners = new Map();
    const spoken = [];
    let cancels = 0;

    class MockUtterance {
        constructor(text) {
            this.text = text;
            this.lang = '';
            this.voice = null;
            this.volume = 1;
            this.rate = 1;
            this.pitch = 1;
            this.onend = null;
            this.onerror = null;
        }
    }

    const mockSynth = {
        speaking: false,
        pending: false,
        paused: false,
        getVoices: () => [{ lang: 'fr-FR', name: 'Amélie', localService: true, default: true }],
        speak(u) {
            spoken.push(u);
            this.speaking = true;
        },
        cancel() {
            cancels += 1;
            this.speaking = false;
            this.pending = false;
        },
        resume() {},
        addEventListener() {},
    };

    globalThis.window = {
        SpeechSynthesisUtterance: MockUtterance,
        speechSynthesis: mockSynth,
        addEventListener(type, fn) { listeners.set(type, fn); },
        removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    };
    globalThis.document = {
        visibilityState: 'visible',
        addEventListener() {},
    };

    try {
        const { narrator } = await import('../src/ui/narrator.js?mock=1');
        assert.ok(listeners.has('click'));
        assert.ok(listeners.has('keydown'));
        assert.equal(listeners.has('touchend'), false);

        const availLog = [];
        const speakLog = [];
        const uAvail = narrator.subscribeAvailable((v) => availLog.push(v));
        const uSpeak = narrator.subscribeSpeaking((v) => speakLog.push(v));

        narrator.prepare();
        assert.equal(narrator.available, true);
        assert.ok(availLog.includes(true));

        narrator.speak('cavalier f3');
        assert.equal(spoken.length, 1);
        assert.equal(spoken[0].text, 'cavalier f3');
        assert.equal(spoken[0].lang, 'fr-FR');
        assert.equal(narrator.speaking, true);

        // Simulate utterance completion
        mockSynth.speaking = false;
        spoken[0].onend();
        assert.equal(narrator.speaking, false);
        assert.deepEqual(speakLog, [false, true, false]);

        // Cancel & stop
        narrator.speak('dame h7');
        assert.equal(narrator.speaking, true);
        narrator.stop();
        assert.equal(narrator.speaking, false);
        assert.ok(cancels >= 1);

        uAvail();
        uSpeak();
    } finally {
        if (prevWin === undefined) delete globalThis.window;
        else globalThis.window = prevWin;
        if (prevDoc === undefined) delete globalThis.document;
        else globalThis.document = prevDoc;
    }
});



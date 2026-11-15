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

async function withMockBrowserEnv({ ua, win, doc }, fn) {
    const prevWinDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const prevDocDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const prevNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: win });
    Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: doc });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { userAgent: ua, onLine: true } });
    try {
        return await fn();
    } finally {
        if (prevWinDesc) Object.defineProperty(globalThis, 'window', prevWinDesc);
        else delete globalThis.window;
        if (prevDocDesc) Object.defineProperty(globalThis, 'document', prevDocDesc);
        else delete globalThis.document;
        if (prevNavDesc) Object.defineProperty(globalThis, 'navigator', prevNavDesc);
        else delete globalThis.navigator;
    }
}

const IOS_SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CHROME_DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SAMSUNG_ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36';
const CHROME_ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';

test('WebNarrator: prepare, speak, stop, subscriptions and iOS gesture listener', async () => {
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

    const win = {
        SpeechSynthesisUtterance: MockUtterance,
        speechSynthesis: mockSynth,
        addEventListener(type, fn) { listeners.set(type, fn); },
        removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    };
    const doc = { visibilityState: 'visible', addEventListener() {} };

    await withMockBrowserEnv({ ua: IOS_SAFARI_UA, win, doc }, async () => {
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
    });
});

test('WebNarrator: iOS slow startup, sequential chunking, voice scoring, error fallback & Safari cancel retry', async () => {
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
            this.onstart = null;
            this.onboundary = null;
            this.onend = null;
            this.onerror = null;
        }
    }

    let speakMode = 'slow';
    const localFr = { lang: 'fr-FR', name: 'Thomas (Enhanced)', voiceURI: 'com.apple.voice.enhanced.fr-FR.Thomas', localService: true, default: false };
    const googleCloud = { lang: 'fr-FR', name: 'Google français', voiceURI: 'Google français', localService: false, default: true };
    const siriVoice = { lang: 'fr-FR', name: 'Siri Voix 1', voiceURI: 'com.apple.ttsbundle.siri', localService: true, default: false };
    const noveltyVoice = { lang: 'fr-FR', name: 'Jacques', voiceURI: 'com.apple.eloquence.fr-FR.Jacques', localService: true, default: false };

    const mockSynth = {
        speaking: false,
        pending: false,
        paused: false,
        getVoices: () => [googleCloud, siriVoice, noveltyVoice, localFr],
        speak(u) {
            spoken.push(u);
            if (u.text === ' ') {
                queueMicrotask(() => u.onend?.());
                return;
            }
            if (speakMode === 'voiceError' && u.voice !== null) {
                queueMicrotask(() => u.onerror?.({ error: 'synthesis-failed' }));
                return;
            }
            if (speakMode === 'dropOnce' && cancels > 0) {
                // Simulate Safari < 27 dropping first queued utterance after cancel(); switch back on retry.
                speakMode = 'instantSuccess';
                return;
            }
            if (speakMode === 'instantSuccess' || (speakMode === 'voiceError' && u.voice === null)) {
                this.speaking = true;
                setTimeout(() => {
                    u.onstart?.();
                    setTimeout(() => {
                        this.speaking = false;
                        u.onend?.();
                    }, 20);
                }, 10);
            }
        },
        cancel() {
            cancels += 1;
            this.speaking = false;
            this.pending = false;
        },
        resume() {},
        addEventListener() {},
    };

    const win = {
        SpeechSynthesisUtterance: MockUtterance,
        speechSynthesis: mockSynth,
        addEventListener() {},
        removeEventListener() {},
    };
    const doc = { visibilityState: 'visible', addEventListener() {} };

    await withMockBrowserEnv({ ua: IOS_SAFARI_UA, win, doc }, async () => {
        const { narrator } = await import('../src/ui/narrator.js?resilience=1');
        narrator.prepare();

        // Offline local fr-FR voice must strictly outscore Google cloud, Siri, and Eloquence novelty voices.
        assert.ok(narrator._scoreVoice(localFr) > narrator._scoreVoice(googleCloud));
        assert.ok(narrator._scoreVoice(localFr) > narrator._scoreVoice(siriVoice));
        assert.ok(narrator._scoreVoice(localFr) > narrator._scoreVoice(noveltyVoice));

        // Non-empty silent unlock gesture for iOS Safari
        assert.equal(narrator.unlock(true), true);
        const unlockU = spoken.pop();
        assert.equal(unlockU.text, ' ');
        assert.equal(unlockU.volume, 0);
        assert.equal(unlockU.lang, 'fr-FR');

        // 1) Slow cold startup (750ms before speaking = true / onstart) must NOT be aborted early
        speakMode = 'slow';
        narrator.speak('Grand roque et attaque sur le centre');
        const waitIdle = narrator.awaitIdle();
        await new Promise((r) => setTimeout(r, 750));
        assert.equal(narrator.speaking, true, 'TTS still starting at 750ms must not be killed early');
        mockSynth.speaking = true;
        spoken[spoken.length - 1].onstart();
        await new Promise((r) => setTimeout(r, 60));
        mockSynth.speaking = false;
        spoken[spoken.length - 1].onend();
        const slowRes = await waitIdle;
        assert.equal(slowRes.played, true);
        assert.equal(slowRes.started, true);

        // 2) Long lesson text splits cleanly (<=140 chars) and queues sequentially via onend
        spoken.length = 0;
        const longText = "Première phrase complète d'introduction sur le contrôle du centre. "
            + "Deuxième phrase expliquant pourquoi le cavalier se développe vers f3 en attaquant e5. "
            + "Troisième phrase concluant sur la mise en sécurité du roi par le petit roque.";
        speakMode = 'slow';
        narrator.speak(longText);
        assert.equal(spoken.length, 1, 'Sequential chunker must enqueue one utterance at a time');
        assert.ok(spoken[0].text.length <= 140);
        mockSynth.speaking = true;
        spoken[0].onstart();
        spoken[0].onend();
        assert.equal(spoken.length, 2, 'Finishing chunk 1 must enqueue chunk 2 immediately');
        assert.ok(spoken[1].text.length <= 140);
        assert.equal(narrator.speaking, true, 'Must remain speaking until final chunk finishes');
        while (mockSynth.speaking) {
            const cur = spoken[spoken.length - 1];
            const prevCount = spoken.length;
            cur.onstart?.();
            cur.onend?.();
            if (spoken.length === prevCount) {
                mockSynth.speaking = false;
            }
        }
        assert.equal(narrator.speaking, false);

        // 3) Explicit voice rejection automatically tries alt voice then u.voice = null and succeeds
        spoken.length = 0;
        speakMode = 'voiceError';
        narrator.speak('Coup de développement');
        const voiceRetryRes = await narrator.awaitIdle();
        assert.equal(voiceRetryRes.played, true);
        assert.ok(spoken.length >= 2);
        assert.equal(spoken[spoken.length - 1].voice, null);
        assert.equal(spoken[spoken.length - 1].lang, 'fr-FR');

        // 4) Pre-Safari-27 cancel() + speak() drop watchdog automatically retries once
        spoken.length = 0;
        cancels = 0;
        mockSynth.speaking = true;
        speakMode = 'dropOnce';
        narrator.speak('Interruption propre');
        const cancelRetryRes = await narrator.awaitIdle();
        assert.equal(cancelRetryRes.played, true);
        assert.ok(cancels >= 1);
        assert.ok(spoken.length >= 2, 'Watchdog should re-queue dropped utterance after cancel');

        // 5) Total silent failure resolves { played: false } after startup grace
        spoken.length = 0;
        mockSynth.speaking = false;
        mockSynth.pending = false;
        speakMode = 'silentDrop';
        narrator.speak('Aucun moteur actif');
        const silentRes = await narrator.awaitIdle(4000);
        assert.equal(silentRes.played, false);
        assert.equal(narrator.speaking, false);
    });
});

test('WebNarrator: Chrome Desktop & Android Chrome & Samsung Internet speech adaptations', async () => {
    class MockUtterance {
        constructor(text) {
            this.text = text;
            this.lang = '';
            this.voice = null;
            this.volume = 1;
            this.rate = 1;
            this.pitch = 1;
            this.onstart = null;
            this.onboundary = null;
            this.onend = null;
            this.onerror = null;
        }
    }

    // A) Desktop Chrome: no silent ' ' warmup, resumes paused synth, 80ms post-cancel delay, falls back to alt voice
    {
        const listeners = new Map();
        const spoken = [];
        let resumes = 0;
        let cancels = 0;
        let mode = 'pauseResume';
        const voicePrimary = { lang: 'fr-FR', name: 'Hortense', localService: true, default: false };
        const voiceBackup = { lang: 'fr-FR', name: 'Paul', localService: true, default: false };

        const mockSynth = {
            speaking: false,
            pending: false,
            paused: true,
            getVoices: () => [voicePrimary, voiceBackup],
            resume() { resumes += 1; this.paused = false; },
            cancel() { cancels += 1; this.speaking = false; this.pending = false; },
            speak(u) {
                spoken.push(u);
                if (mode === 'silentPrimary' && u.voice === voicePrimary) {
                    // Simulate silently broken primary voice (no speaking/pending) -> should auto-switch to voiceBackup at 950ms
                    return;
                }
                this.speaking = true;
                setTimeout(() => {
                    u.onstart?.();
                    setTimeout(() => {
                        this.speaking = false;
                        u.onend?.();
                    }, 15);
                }, 10);
            },
            addEventListener() {},
        };

        await withMockBrowserEnv({
            ua: CHROME_DESKTOP_UA,
            win: {
                SpeechSynthesisUtterance: MockUtterance,
                speechSynthesis: mockSynth,
                addEventListener: (t, fn) => listeners.set(t, fn),
                removeEventListener: (t) => listeners.delete(t),
            },
            doc: { visibilityState: 'visible', addEventListener() {} },
        }, async () => {
            const { narrator } = await import('../src/ui/narrator.js?chrome=1');
            assert.equal(listeners.has('click'), false, 'Chrome must NOT arm iOS gesture click listener');
            assert.equal(narrator.unlock(true), false, 'Chrome must NOT queue silent " " utterance');
            assert.ok(resumes >= 1, 'unlock() on non-WebKit should resume paused speechSynthesis');
            assert.equal(spoken.length, 0);

            narrator.prepare();
            narrator.speak('Coup normal');
            const firstRes = await narrator.awaitIdle();
            assert.equal(firstRes.played, true);
            assert.equal(spoken[0].voice, voicePrimary);

            // While synth.speaking is true, interrupting speech on Chrome waits ~80ms after cancel()
            spoken.length = 0;
            mockSynth.speaking = true;
            const startedAt = Date.now();
            narrator.speak('Deuxième coup');
            assert.ok(cancels >= 1);
            assert.equal(spoken.length, 0, 'Chrome must defer speak() ~80ms after cancel()');
            const secondRes = await narrator.awaitIdle();
            assert.equal(secondRes.played, true);
            assert.ok(Date.now() - startedAt >= 65);

            // Silent stall on primary voice switches to secondary French voice (even when primary.default === false)
            spoken.length = 0;
            mode = 'silentPrimary';
            narrator.speak('Repli sur seconde voix');
            const fbRes = await narrator.awaitIdle(4000);
            assert.equal(fbRes.played, true);
            assert.ok(spoken.some((u) => u.voice === voicePrimary));
            assert.equal(spoken[spoken.length - 1].voice, voiceBackup);
        });
    }

    // B) Android Chrome & Samsung Internet: prefers u.voice = null + lang='fr-FR' first, falls back to picked voice if error
    for (const [tag, ua] of [['android_chrome', CHROME_ANDROID_UA], ['samsung', SAMSUNG_ANDROID_UA]]) {
        const spoken = [];
        const androidFr = { lang: 'fr-FR', name: 'Samsung TTS fr', localService: true, default: true };
        let rejectNull = false;

        const mockSynth = {
            speaking: false,
            pending: false,
            paused: false,
            getVoices: () => [androidFr],
            resume() {},
            cancel() { this.speaking = false; this.pending = false; },
            speak(u) {
                spoken.push(u);
                if (rejectNull && u.voice === null) {
                    queueMicrotask(() => u.onerror?.({ error: 'language-unavailable' }));
                    return;
                }
                this.speaking = true;
                setTimeout(() => {
                    u.onstart?.();
                    setTimeout(() => {
                        this.speaking = false;
                        u.onend?.();
                    }, 15);
                }, 10);
            },
            addEventListener() {},
        };

        await withMockBrowserEnv({
            ua,
            win: {
                SpeechSynthesisUtterance: MockUtterance,
                speechSynthesis: mockSynth,
                addEventListener() {},
                removeEventListener() {},
            },
            doc: { visibilityState: 'visible', addEventListener() {} },
        }, async () => {
            const { narrator } = await import(`../src/ui/narrator.js?${tag}=1`);
            assert.equal(narrator.unlock(true), false, `${tag} must NOT queue silent " " utterance`);
            narrator.speak('Fou prend f7, échec');
            const resPrimary = await narrator.awaitIdle();
            assert.equal(resPrimary.played, true);
            assert.equal(spoken[0].voice, null, `${tag} must leave u.voice = null initially`);
            assert.equal(spoken[0].lang, 'fr-FR');

            spoken.length = 0;
            rejectNull = true;
            narrator.speak('Petit roque');
            const resFallback = await narrator.awaitIdle();
            assert.equal(resFallback.played, true);
            assert.equal(spoken[0].voice, null);
            assert.equal(spoken[spoken.length - 1].voice, androidFr);
        });
    }
});

test('Layout: isTwoPane width/aspect-ratio boundaries across mobile and tablet viewports', async () => {
    const { isTwoPane } = await import('../src/ui/theme.js');
    assert.equal(isTwoPane(360, 640), false);
    assert.equal(isTwoPane(390, 844), false);
    assert.equal(isTwoPane(539, 360), false);
    assert.equal(isTwoPane(540, 360), true);
    assert.equal(isTwoPane(640, 360), true);
    assert.equal(isTwoPane(844, 390), true);
    assert.equal(isTwoPane(768, 1024), false);
    assert.equal(isTwoPane(1024, 768), true);
    assert.equal(isTwoPane(1280, 800), true);
});

test('Academy: academyStepDelayMs waits post-speech pause or readable fallback when TTS fails', async () => {
    const prevWin = globalThis.window;
    const prevDoc = globalThis.document;
    globalThis.window = {};
    globalThis.document = { visibilityState: 'visible', addEventListener() {} };
    try {
        const { academyStepDelayMs, POST_SPEECH_PAUSE_MS } = await import('../src/features/academy.js');
        const sampleLesson = {
            title: 'Le clouage absolu',
            summary: 'Une pièce clouée devant son roi ne peut pas bouger.',
            line: { size: 4 },
            texts: [
                'Le fou attaque le cavalier qui protège le roi noir sur la diagonale.',
                'Court.',
                'Un commentaire beaucoup plus long expliquant toute la tactique qui suit avec précision et calme.',
                'Dernier coup.',
            ],
        };

        assert.equal(academyStepDelayMs(sampleLesson, 0, { narrationActive: false }), 700);
        assert.equal(academyStepDelayMs(sampleLesson, 1, { narrationActive: false }), 2600);

        assert.equal(
            academyStepDelayMs(sampleLesson, 1, { narrationActive: true, speechResult: { played: true, elapsedMs: 4200 } }),
            POST_SPEECH_PAUSE_MS,
        );

        // When TTS failed cleanly right away (elapsed 20ms), fallback must NOT race at 600ms
        const fallbackImmediate = academyStepDelayMs(sampleLesson, 1, {
            narrationActive: true,
            speechResult: { played: false, elapsedMs: 20 },
        });
        assert.ok(fallbackImmediate >= 3000, `Expected readable fallback >=3000ms, got ${fallbackImmediate}`);

        // Even after startup grace elapsed (2200ms), long steps keep readable buffer >= 900ms
        const fallbackLongAfterGrace = academyStepDelayMs(sampleLesson, 3, {
            narrationActive: true,
            speechResult: { played: false, elapsedMs: 2200 },
        });
        assert.ok(fallbackLongAfterGrace >= 2500, `Expected remaining reading time >=2500ms, got ${fallbackLongAfterGrace}`);
    } finally {
        if (prevWin === undefined) delete globalThis.window;
        else globalThis.window = prevWin;
        if (prevDoc === undefined) delete globalThis.document;
        else globalThis.document = prevDoc;
    }
});

test('v2.4.3: turnOf, moveLabel, stepTitle standard turn numbering & lesson renumbering', async () => {
    const { turnOf, moveLabel, stepTitle } = await import('../src/ui/common.js');
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/lessons.json'), 'utf8'));
    const lessons = Lessons.initFromData(raw);
    const enfilade = lessons.find((l) => l.title === "L'enfilade");
    assert.ok(enfilade, "La leçon L'enfilade doit exister");

    assert.equal(turnOf(enfilade.line, 0, 1), 1);
    assert.equal(moveLabel(1, false, 'Qxe5'), '1… Qxe5');
    assert.equal(stepTitle(enfilade.line, 1, { first: 1 }), '1… Qxe5 · coup 1 sur 3');
    assert.equal(stepTitle(enfilade.line, 2, { first: 1 }), '2. Bf4 · coup 2 sur 3');
    assert.equal(stepTitle(enfilade.line, 4, { first: 1 }), '3. Bxb8 · coup 3 sur 3');

    // Hors leçon (revue / partie libre) : vrais numéros de la partie + annotation optionnelle
    assert.equal(stepTitle(enfilade.line, 1), '16… Qxe5 · coup 16 sur 18');
    assert.equal(stepTitle(enfilade.line, 1, { note: '!!' }), '16… Qxe5 !! · coup 16 sur 18');
});

test('v2.4.4: SpokenFr pronunciation lexicon rewrites chess terms only for speech and covers all 113 lessons', async () => {
    const { SpokenFr } = await import('../src/core/spoken-fr.js');

    assert.equal(SpokenFr.text("C'est pat malgré une pièce de plus."), "C'est patte malgré une pièce de plus.");
    assert.equal(SpokenFr.text('le gambit Evans'), 'le gambitte Évanse');
    assert.equal(SpokenFr.text('échec et mat'), 'échec et matte');
    assert.equal(SpokenFr.text('Un zugzwang typique du fianchetto.'), 'Un zougtsvang typique du fianquétto.');
    assert.equal(SpokenFr.text(`${SpokenFr.move('Qh4#')}. Le coup final.`), 'dame h4, matte. Le coup final.');

    // Mots voisins intacts
    const nearby = 'Il faut mater sans perdre de matériel, avec patience.';
    assert.equal(SpokenFr.text(nearby), nearby);

    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/lessons.json'), 'utf8'));
    const lessons = Lessons.initFromData(raw);
    const hard = /(?<![\p{L}-])(pat|mat|gambit|fianchetto|zugzwang|Giuoco|Kieseritzky|Najdorf|Winawer|Tarrasch|Grünfeld)(?![\p{L}-])/iu;
    for (const l of lessons) {
        for (const t of [...l.texts, l.summary, l.title]) {
            const spoken = SpokenFr.text(t);
            assert.equal(hard.test(spoken), false, `Terme difficile encore présent dans leçon ${l.id}: "${spoken}"`);
        }
    }
});

test('v2.4.5: resumePoint and WebNarrator pause/resume at interrupted sentence start & stop clearing', async () => {
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
            this.onstart = null;
            this.onboundary = null;
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

    await withMockBrowserEnv({
        ua: CHROME_DESKTOP_UA,
        win: {
            SpeechSynthesisUtterance: MockUtterance,
            speechSynthesis: mockSynth,
            addEventListener() {},
            removeEventListener() {},
        },
        doc: { visibilityState: 'visible', addEventListener() {} },
    }, async () => {
        const { narrator, resumePoint } = await import('../src/ui/narrator.js?pause=1');

        const sample = 'Le fou sort. Il vise la case f7 : seul le roi la protège.';
        assert.equal(resumePoint(sample, 7), 0);
        assert.equal(resumePoint(sample, sample.indexOf('case')), sample.indexOf('Il vise'));
        assert.equal(resumePoint(sample, sample.indexOf('protège') + 3), sample.indexOf('seul'));

        narrator.prepare();
        narrator.speak(sample);
        assert.equal(spoken.length, 1);
        spoken[0].onstart?.();
        spoken[0].onboundary?.({ charIndex: sample.indexOf('case') });

        // Pause -> coupe la voix, retient la phrase interrompue
        narrator.pause();
        assert.equal(narrator.speaking, false);
        assert.ok(cancels >= 1);
        assert.equal(narrator.paused, 'Il vise la case f7 : seul le roi la protège.');

        // Resume -> reprend depuis le début de la phrase interrompue
        assert.equal(narrator.resume(), true);
        assert.equal(narrator.paused, null);
        assert.equal(narrator.speaking, true);
        const resumedRes = narrator.awaitIdle();
        await new Promise((r) => setTimeout(r, 95));
        assert.equal(spoken.length, 2);
        assert.equal(spoken[1].text, 'Il vise la case f7 : seul le roi la protège.');
        mockSynth.speaking = false;
        spoken[1].onstart?.();
        spoken[1].onend?.();
        const done = await resumedRes;
        assert.equal(done.played, true);

        // Multi-chunk pause during 2nd chunk preserves remaining text from interrupted sentence across chunk boundary
        spoken.length = 0;
        const multi = "Première phrase complète d'introduction sur l'ouverture italienne au centre. "
            + "Deuxième phrase expliquant comment le fou attaque le point faible f7 devant le roque noir. "
            + 'Troisième phrase finale pour conclure la leçon.';
        narrator.speak(multi);
        assert.equal(spoken.length, 1);
        spoken[0].onstart?.();
        spoken[0].onend?.();
        assert.equal(spoken.length, 2);
        spoken[1].onstart?.();
        spoken[1].onboundary?.({ charIndex: spoken[1].text.indexOf('faible') });
        narrator.pause();
        assert.ok(narrator.paused?.startsWith('Deuxième phrase expliquant'));
        assert.ok(narrator.paused?.endsWith('Troisième phrase finale pour conclure la leçon.'));

        // stop() clears paused remainder
        narrator.stop();
        assert.equal(narrator.paused, null);
        assert.equal(narrator.resume(), false);
    });
});

test('iPhone top-blur mitigation: status-bar meta, isIosDevice & computeIosTopGap matrix', async () => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    assert.match(html, /<meta\s+name="apple-mobile-web-app-status-bar-style"\s+content="default">/);
    assert.equal(/black-translucent/.test(html), false);

    const { isIosDevice, computeIosTopGap } = await import('../src/ui/theme.js');

    assert.equal(isIosDevice({ userAgent: IOS_SAFARI_UA, platform: 'iPhone', maxTouchPoints: 5 }), true);
    assert.equal(isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 5 }), true);
    assert.equal(isIosDevice({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0 }), false);
    assert.equal(isIosDevice({ userAgent: CHROME_ANDROID_UA, platform: 'Linux armv8l', maxTouchPoints: 5 }), false);
    assert.equal(isIosDevice({ userAgent: SAMSUNG_ANDROID_UA, platform: 'Linux armv8l', maxTouchPoints: 5 }), false);
    assert.equal(isIosDevice({ userAgent: CHROME_DESKTOP_UA, platform: 'Linux x86_64', maxTouchPoints: 0 }), false);

    // Non-iOS must stay untouched (0px)
    assert.equal(computeIosTopGap({ isIos: false, standalone: true, innerWidth: 390, innerHeight: 844, screenWidth: 390, screenHeight: 844, safeTop: 0 }), 0);

    // iPhone Safari (portrait)
    assert.equal(computeIosTopGap({ isIos: true, standalone: false, innerWidth: 390, innerHeight: 664, screenWidth: 390, screenHeight: 844, safeTop: 0 }), 20);

    // iPhone fresh `default` PWA (OS already reserved status bar so innerHeight < screenHeight)
    assert.equal(computeIosTopGap({ isIos: true, standalone: true, innerWidth: 390, innerHeight: 790, screenWidth: 390, screenHeight: 844, safeTop: 0 }), 20);

    // iPhone cached fullscreen `black-translucent` or iOS 27 PWA under status bar with valid safeTop
    assert.equal(computeIosTopGap({ isIos: true, standalone: true, innerWidth: 393, innerHeight: 852, screenWidth: 393, screenHeight: 852, safeTop: 59 }), 40);

    // iPhone cached fullscreen `black-translucent` with WebKit #301994 safeTop=0 bug
    assert.equal(computeIosTopGap({ isIos: true, standalone: true, innerWidth: 393, innerHeight: 852, screenWidth: 393, screenHeight: 852, safeTop: 0 }), 99);
    assert.equal(computeIosTopGap({ isIos: true, standalone: true, innerWidth: 390, innerHeight: 844, screenWidth: 390, screenHeight: 844, safeTop: 0 }), 87);
    assert.equal(computeIosTopGap({ isIos: true, standalone: true, innerWidth: 375, innerHeight: 667, screenWidth: 375, screenHeight: 667, safeTop: 0 }), 60);

    // iPad fullscreen standalone fallback
    assert.equal(computeIosTopGap({ isIos: true, standalone: true, innerWidth: 820, innerHeight: 1180, screenWidth: 820, screenHeight: 1180, safeTop: 0 }), 64);

    // Compact iPhone landscape keeps vertical budget tight
    assert.equal(computeIosTopGap({ isIos: true, standalone: true, innerWidth: 844, innerHeight: 390, screenWidth: 390, screenHeight: 844, safeTop: 0 }), 8);
});

test('v2.4.6..v2.4.7: kidNarration pref, version bump & Settings UI coherence', async () => {
    const prevWin = globalThis.window;
    const store = new Map();
    globalThis.window = {
        localStorage: {
            getItem: (k) => (store.has(k) ? store.get(k) : null),
            setItem: (k, v) => { store.set(k, v); },
        },
    };
    try {
        const { prefs, DEFAULT_SETTINGS } = await import('../src/data/prefs.js?kidnar=1');
        assert.equal(DEFAULT_SETTINGS.kidNarration, false);
        assert.equal(prefs.current.kidNarration, false);

        prefs.setKidNarration(true);
        assert.equal(prefs.current.kidNarration, true);
        assert.equal(JSON.parse(store.get('chessduck_v2_settings')).kidNarration, true);

        prefs.setKidNarration(false);
        assert.equal(prefs.current.kidNarration, false);
    } finally {
        if (prevWin === undefined) delete globalThis.window;
        else globalThis.window = prevWin;
    }

    const settingsSrc = fs.readFileSync(path.join(ROOT, 'src/features/settings-sheet.js'), 'utf8');
    assert.match(settingsSrc, /Voix en mode enfant/);
});

test('v2.4.8: version bump & Notation FIDE keyboard WCAG target dimensions', async () => {
    const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const settingsSrc = fs.readFileSync(path.join(ROOT, 'src/features/settings-sheet.js'), 'utf8');
    const cssSrc = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');
    const notationSrc = fs.readFileSync(path.join(ROOT, 'src/features/notation.js'), 'utf8');

    assert.match(swSrc, /chessduck-v2\.4\.8-/);
    assert.match(settingsSrc, /v2\.4\.8/);
    assert.match(cssSrc, /v2\.4\.8/);
    assert.match(notationSrc, /bottomMin:\s*298/);

    assert.match(cssSrc, /\.notation-input-box\s*\{[^}]*height:\s*48px/);
    assert.match(cssSrc, /\.notation-bs-btn\s*\{[^}]*width:\s*48px;[^}]*height:\s*48px/);
    assert.match(cssSrc, /\.notation-validate-btn\s*\{[^}]*min-height:\s*48px/);
    assert.match(cssSrc, /\.fide-row\.fide-row-compact\s*\{[^}]*gap:\s*3px/);
    assert.match(cssSrc, /\.fide-key\s*\{[^}]*height:\s*44px/);
    assert.match(cssSrc, /\.fide-key\.is-piece\s*\{[^}]*height:\s*52px/);
    assert.match(cssSrc, /\.fide-key\.is-piece \.fide-key-main\s*\{[^}]*line-height:\s*19px/);
    assert.match(cssSrc, /\.fide-key-sub,\s*[\s\S]*line-height:\s*12px|\.fide-key-sub\s*\{[^}]*line-height:\s*12px/);
});

test('v2.4.7: KidMode demoPhases written for oral speech & clean through SpokenFr', async () => {
    const { demoPhases, KID_LEGEND } = await import('../src/features/kid.js');
    const { SpokenFr } = await import('../src/core/spoken-fr.js');

    assert.equal(demoPhases(QUEEN).length, 2);
    assert.equal(demoPhases(PAWN).length, 3);
    for (const piece of KID_LEGEND) {
        assert.equal('text' in piece, false, `KID_LEGEND(${piece.name}) should delegate explanation text to demoPhases`);
        const phases = demoPhases(piece.type);
        assert.ok(phases.length >= 1, `${piece.name} must have >=1 demo phase`);
        for (const ph of phases) {
            assert.ok(typeof ph.say === 'string' && ph.say.length > 0);
            assert.equal(/[()]/.test(ph.say), false, `Parentheses forbidden in oral kid phase: "${ph.say}"`);
            assert.equal(/\d/.test(ph.say), false, `Raw digits forbidden in oral kid phase: "${ph.say}"`);
            const spoken = SpokenFr.text(ph.say);
            assert.equal(/\*\*|[()]|\d/.test(spoken), false, `Unexpected markup/digits after SpokenFr.text: "${spoken}"`);
        }
    }
});

test('v2.4.6..v2.4.7: KidVoiceController sync, single loop pass, 30s cooldown, piece switch & immediate stop', async () => {
    const { KidVoiceController, KID_REPEAT_COOLDOWN_MS } = await import('../src/features/kid.js');
    assert.equal(KID_REPEAT_COOLDOWN_MS, 30_000);

    let enabled = false;
    let now = 0;
    const spoken = [];
    let stops = 0;
    let waiters = [];
    const fakeNarrator = {
        speaking: false,
        speak(text) {
            spoken.push(text);
            this.speaking = true;
        },
        stop() {
            stops += 1;
            this.speaking = false;
            const pending = waiters.splice(0);
            pending.forEach((r) => r());
        },
        awaitIdle() {
            if (!this.speaking) return Promise.resolve({ played: true });
            return new Promise((resolve) => waiters.push(() => resolve({ played: true })));
        },
        finish() {
            this.speaking = false;
            const pending = waiters.splice(0);
            pending.forEach((r) => r());
        },
    };

    const ctrl = new KidVoiceController({
        getEnabled: () => enabled,
        narrator: fakeNarrator,
        clock: () => now,
    });

    // Voix désactivée par défaut : rien n'est dit et l'animation n'attend jamais.
    assert.equal(ctrl.pieceShown(QUEEN), false);
    ctrl.say(QUEEN, 'La **Dame** va **tout droit**.');
    await ctrl.awaitVoice(QUEEN);
    assert.deepEqual(spoken, []);

    // Voix activée : chaque étape est annoncée au début, et awaitVoice attend la fin de la phrase.
    enabled = true;
    assert.equal(ctrl.pieceShown(QUEEN), true);
    ctrl.say(QUEEN, 'La **Dame** va **tout droit**.');
    assert.deepEqual(spoken, ['La Dame va tout droit.']);
    let finished = false;
    const waitP = ctrl.awaitVoice(QUEEN).then(() => { finished = true; });
    await Promise.resolve();
    assert.equal(finished, false);
    fakeNarrator.finish();
    await waitP;
    assert.equal(finished, true);

    // Deuxième étape de la Dame lue au premier tour, puis silence aux tours suivants après voiceDone().
    ctrl.say(QUEEN, 'Elle va aussi **en diagonale**.');
    assert.equal(spoken.length, 2);
    fakeNarrator.finish();
    await ctrl.awaitVoice(QUEEN);
    ctrl.voiceDone(QUEEN);
    ctrl.say(QUEEN, 'La **Dame** va **tout droit**.');
    assert.equal(spoken.length, 2);

    // Même pièce rouverte avant 30 s : silencieuse ; fermer la fiche coupe la voix immédiatement.
    ctrl.pieceClosed();
    now += 10_000;
    assert.equal(ctrl.pieceShown(QUEEN), false);
    ctrl.say(QUEEN, 'La **Dame** va **tout droit**.');
    assert.equal(spoken.length, 2);

    // Une autre pièce est commentée ; ouvrir une troisième pièce pendant qu'elle parle coupe la précédente.
    assert.equal(ctrl.pieceShown(PAWN), true);
    ctrl.say(PAWN, 'Le **Pion** avance **tout droit**.');
    assert.equal(spoken.length, 3);
    assert.equal(fakeNarrator.speaking, true);
    const stopsBeforeSwitch = stops;
    assert.equal(ctrl.pieceShown(ROOK), true);
    assert.equal(stops, stopsBeforeSwitch + 1);
    ctrl.say(ROOK, 'La **Tour** va **tout droit**.');
    assert.equal(spoken.length, 4);

    // Retrait de l'accord parental en cours de lecture : coupe immédiatement.
    const stopsBeforeToggle = stops;
    enabled = false;
    ctrl.onEnabledChanged(false);
    assert.equal(stops, stopsBeforeToggle + 1);
    assert.equal(fakeNarrator.speaking, false);

    // Réactivation et délai de calme de 30 s écoulé : la Dame peut être commentée de nouveau.
    enabled = true;
    now += 30_000;
    assert.equal(ctrl.pieceShown(QUEEN), true);
    ctrl.say(QUEEN, 'La **Dame** va **tout droit**.');
    assert.equal(spoken.length, 5);
});

test('v2.4.7: measureEvalBarWidth grows for large font scaling without clipping −9.9 or M12', async () => {
    const { measureEvalBarWidth } = await import('../src/ui/board.js');

    assert.equal(measureEvalBarWidth({ measureFn: (s) => s.length * 4.5 }), 26);
    assert.equal(measureEvalBarWidth({ measureFn: (s) => s.length * 8.5 }), Math.ceil(4 * 8.5) + 8);
    assert.ok(measureEvalBarWidth({ measureFn: (s) => s.length * 10 }) >= 48);
});

test('Voice & sound mobile fixes: Android cold start, -network scoring, post-silence race (Android & iOS), chunk-2 slow start, not-allowed, FeedbackService', async () => {
    class MockUtterance {
        constructor(text) {
            this.text = text;
            this.lang = '';
            this.voice = null;
            this.volume = 1;
            this.rate = 1;
            this.pitch = 1;
            this.onstart = null;
            this.onboundary = null;
            this.onend = null;
            this.onerror = null;
        }
    }

    // 1) Android Chrome: -network deprioritized, 1350ms cold start & 1900ms pending tolerated, post-stop 130ms delay, slow chunk 2
    {
        const spoken = [];
        let cancels = 0;
        const netVoice = { lang: 'fr-FR', name: 'fr-fr-x-fra-network', voiceURI: 'fr-fr-x-fra-network', localService: true, default: false };
        const localVoice = { lang: 'fr-FR', name: 'fr-fr-x-frd-local', voiceURI: 'fr-fr-x-frd-local', localService: true, default: false };

        const mockSynth = {
            speaking: false,
            pending: false,
            paused: false,
            getVoices: () => [netVoice, localVoice],
            resume() { this.paused = false; },
            cancel() { cancels += 1; this.speaking = false; this.pending = false; },
            speak(u) { spoken.push(u); },
            addEventListener() {},
        };

        await withMockBrowserEnv({
            ua: CHROME_ANDROID_UA,
            nav: { userAgent: CHROME_ANDROID_UA, onLine: true },
            win: { SpeechSynthesisUtterance: MockUtterance, speechSynthesis: mockSynth, addEventListener() {}, removeEventListener() {} },
            doc: { visibilityState: 'visible', addEventListener() {} },
        }, async () => {
            const { narrator } = await import('../src/ui/narrator.js?androidfix=1');
            try {
                narrator.prepare();
                assert.ok(narrator._scoreVoice(localVoice) > narrator._scoreVoice(netVoice), 'Local Android voice must outscore -network voice');
                assert.equal(narrator._voice, localVoice);

                // Offline excludes -network voices even when Chromium erroneously flags localService = true
                globalThis.navigator.onLine = false;
                const onlyNetSynth = { ...mockSynth, getVoices: () => [netVoice] };
                globalThis.window.speechSynthesis = onlyNetSynth;
                narrator.prepare();
                assert.equal(narrator._voice, null, 'Offline must ignore -network Android voices');
                globalThis.navigator.onLine = true;
                globalThis.window.speechSynthesis = mockSynth;
                narrator.prepare();

                // 1a) Cold start 1350ms silently waiting (!speaking && !pending) on candidate 0 (voice = null) must NOT abort at 950ms
                spoken.length = 0;
                cancels = 0;
                narrator.speak('Le cavalier contrôle le centre.');
                assert.equal(spoken.length, 1);
                assert.equal(spoken[0].voice, null);
                assert.equal(spoken[0].volume, 1.0);
                const pCold = narrator.awaitIdle();
                await new Promise((r) => setTimeout(r, 1350));
                assert.equal(cancels, 0, 'Must NOT cancel candidate 0 (null) at 950ms during 1350ms Android cold start');
                assert.equal(narrator.speaking, true);
                mockSynth.speaking = true;
                spoken[0].onstart?.();
                await new Promise((r) => setTimeout(r, 40));
                mockSynth.speaking = false;
                spoken[0].onend?.();
                const coldRes = await pCold;
                assert.equal(coldRes.played, true);
                assert.equal(spoken.length, 1);

                // 1b) Pending state for 1900ms on candidate 0 (voice = null) must NOT abort at 1600ms
                spoken.length = 0;
                cancels = 0;
                const origSpeak = mockSynth.speak.bind(mockSynth);
                mockSynth.speak = (u) => {
                    mockSynth.pending = true;
                    origSpeak(u);
                };
                narrator.speak('Attente moteur Android.');
                mockSynth.speak = origSpeak;
                const pPend = narrator.awaitIdle();
                await new Promise((r) => setTimeout(r, 1900));
                assert.equal(cancels, 0, 'Must NOT abort pending voice=null at 1600ms');
                assert.equal(narrator.speaking, true);
                mockSynth.pending = false;
                mockSynth.speaking = true;
                spoken[0].onstart?.();
                mockSynth.speaking = false;
                spoken[0].onend?.();
                assert.equal((await pPend).played, true);

                // 1c) Immediate stop() -> speak() must honor >=110ms Android Binder post-cancel delay even when !synth.speaking
                spoken.length = 0;
                cancels = 0;
                narrator.speak('Première annonce');
                spoken[0].onstart?.();
                narrator.stop();
                const tSwitch = Date.now();
                narrator.speak('Deuxième annonce');
                assert.equal(spoken.length, 1, 'Speak right after stop() on Android must defer instead of colliding');
                await new Promise((r) => setTimeout(r, 160));
                assert.equal(spoken.length, 2);
                assert.ok(Date.now() - tSwitch >= 110, 'Deferred launch should wait ~130ms after stop()');
                spoken[1].onstart?.();
                spoken[1].onend?.();
                await narrator.awaitIdle();

                // 1d) Multi-chunk slow start (900ms before chunk 2 fires onstart) must NOT cut off chunk 2 prematurely
                spoken.length = 0;
                const twoChunks = "Première phrase assez longue pour dépasser cent quarante caractères une fois combinée avec la suite de cette leçon d'échecs. "
                    + 'Deuxième phrase tout aussi essentielle qui démarre lentement.';
                narrator.speak(twoChunks);
                const pMulti = narrator.awaitIdle();
                assert.equal(spoken.length, 1);
                spoken[0].onstart?.();
                spoken[0].onend?.();
                assert.equal(spoken.length, 2);
                await new Promise((r) => setTimeout(r, 900));
                assert.equal(narrator.speaking, true, 'Slow chunk 2 at 900ms must still be active and not cut off by idlePolls');
                assert.equal(spoken.length, 2);
                spoken[1].onstart?.();
                spoken[1].onend?.();
                assert.equal((await pMulti).played, true);
            } finally {
                narrator.stop();
            }
        });
    }

    // 2) iOS Safari: pause()->speak() cancel-drop recovery AND 'not-allowed' re-arming
    {
        const listeners = new Map();
        const spoken = [];
        let dropNext = false;
        let mode = 'normal';

        const mockSynth = {
            speaking: false,
            pending: false,
            paused: false,
            getVoices: () => [{ lang: 'fr-FR', name: 'Amélie', localService: true, default: true }],
            resume() {},
            cancel() { this.speaking = false; this.pending = false; },
            speak(u) {
                spoken.push(u);
                if (u.text === ' ') { queueMicrotask(() => u.onend?.()); return; }
                if (mode === 'notAllowed') {
                    queueMicrotask(() => u.onerror?.({ error: 'not-allowed' }));
                    return;
                }
                if (dropNext) {
                    dropNext = false;
                    return;
                }
                this.speaking = true;
                setTimeout(() => {
                    u.onstart?.();
                    setTimeout(() => {
                        this.speaking = false;
                        u.onend?.();
                    }, 15);
                }, 10);
            },
            addEventListener() {},
        };

        await withMockBrowserEnv({
            ua: IOS_SAFARI_UA,
            win: {
                SpeechSynthesisUtterance: MockUtterance,
                speechSynthesis: mockSynth,
                addEventListener: (t, fn) => listeners.set(t, fn),
                removeEventListener: (t) => listeners.delete(t),
            },
            doc: { visibilityState: 'visible', addEventListener() {} },
        }, async () => {
            const { narrator } = await import('../src/ui/narrator.js?iosfix=1');
            try {
                narrator.prepare();

                // 2a) pause() -> _silence() (sync clears mockSynth.speaking) -> immediate speak() dropped once recovers via CANCEL_RETRY_MS
                narrator.speak('Coup un en cours');
                await new Promise((r) => setTimeout(r, 20));
                narrator.pause();
                spoken.length = 0;
                dropNext = true;
                narrator.speak('Coup deux juste après');
                const iosRetry = await narrator.awaitIdle(2000);
                assert.equal(iosRetry.played, true, 'iOS speak() immediately after pause()/_silence() must recover from cancel drop');
                assert.ok(spoken.length >= 2);

                // 2b) onerror('not-allowed') aborts cleanly without burning fallback voices and re-arms click unlock
                listeners.clear();
                spoken.length = 0;
                mode = 'notAllowed';
                narrator.speak('Sans geste utilisateur');
                const naRes = await narrator.awaitIdle(2000);
                assert.equal(naRes.played, false);
                assert.equal(naRes.error, 'not-allowed');
                assert.equal(spoken.length, 1, 'not-allowed should not wastefully retry other voices');
                assert.ok(listeners.has('click'), 'not-allowed must re-arm gesture unlock on iOS');
            } finally {
                narrator.stop();
            }
        });
    }

    // 3) FeedbackService: suspended -> interrupted recovery, concurrent decode safety, and 0.65 audible wood move gain
    {
        const prevWinDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
        const prevDocDesc = Object.getOwnPropertyDescriptor(globalThis, 'document');
        const prevNavDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        const prevFetch = globalThis.fetch;

        let fetchCount = 0;
        const plays = [];
        let ctxInstance = null;

        class MockAudioContext {
            constructor() {
                this.state = 'suspended';
                this.destination = {};
                ctxInstance = this;
            }
            resume() {
                this.state = 'running';
                return Promise.resolve();
            }
            decodeAudioData(buf) {
                // Simulate mobile failure when decoding before context is running; test clone avoids detached ArrayBuffer!
                if (this.state !== 'running') {
                    return Promise.reject(new Error('EncodingError while suspended'));
                }
                return Promise.resolve({ duration: 0.14, byteLength: buf.byteLength });
            }
            createBuffer() {
                return {};
            }
            createBufferSource() {
                const src = {
                    buffer: null,
                    connect(node) { this._dest = node; },
                    start() {
                        if (this.buffer && this._dest?.gain) {
                            plays.push({ gain: this._dest.gain.value, duration: this.buffer.duration });
                        }
                    },
                };
                return src;
            }
            createGain() {
                return { gain: { value: 1 }, connect() {} };
            }
        }

        Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { AudioContext: MockAudioContext, addEventListener() {}, removeEventListener() {} } });
        Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: { visibilityState: 'visible', addEventListener() {} } });
        Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { userActivation: { hasBeenActive: true } } });
        globalThis.fetch = async () => {
            fetchCount += 1;
            return { ok: true, arrayBuffer: async () => new ArrayBuffer(12392) };
        };

        try {
            const { FeedbackService } = await import('../src/ui/feedback.js?fb=1');
            const svc = new FeedbackService();

            // Simulate first gesture + immediate first move while context resumes and sound decodes asynchronously
            svc.unlock();
            svc.move();
            await new Promise((r) => setTimeout(r, 30));
            assert.equal(fetchCount, 1, 'wood_move.wav should be fetched only once via cached _rawPromise');
            assert.ok(ctxInstance && ctxInstance.state === 'running');
            assert.equal(plays.length, 1, 'First move must play once async resume + decode complete');
            assert.equal(plays[0].gain, 0.65, 'Move gain must be raised to 0.65 for audible wood tap');

            // Simulate iOS audio interruption -> next move must resume cleanly and play
            ctxInstance.state = 'interrupted';
            svc.move();
            await new Promise((r) => setTimeout(r, 20));
            assert.equal(ctxInstance.state, 'running');
            assert.equal(plays.length, 2, 'Move after iOS interrupted state must auto-resume and play');
        } finally {
            if (prevWinDesc) Object.defineProperty(globalThis, 'window', prevWinDesc);
            else delete globalThis.window;
            if (prevDocDesc) Object.defineProperty(globalThis, 'document', prevDocDesc);
            else delete globalThis.document;
            if (prevNavDesc) Object.defineProperty(globalThis, 'navigator', prevNavDesc);
            else delete globalThis.navigator;
            if (prevFetch === undefined) delete globalThis.fetch;
            else globalThis.fetch = prevFetch;
        }
    }
});





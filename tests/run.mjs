import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GameEnd, Line, Move, Position, START_FEN, materialOf,
} from '../src/chess.js';
import {
  ALL_THEMES, G_MATE, THEME_GROUPS, primaryTheme,
} from '../src/themes.js';
import {
  GameLogic, MATE, ReviewComments, decodeAnalysis, encodeAnalysis,
} from '../src/review-comments.js';
import { NotationLogic } from '../src/features/notation.js';
import { PuzzleCatalog } from '../src/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function perft(p, d) {
  if (d === 0) return 1;
  let n = 0;
  for (const m of p.legalMoves) {
    n += perft(p.play(m), d - 1);
  }
  return n;
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('perftReferencePositions', () => {
  assert.equal(perft(Position.fromFen(START_FEN), 4), 197281);
  assert.equal(perft(Position.fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'), 3), 97862);
  assert.equal(perft(Position.fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'), 4), 43238);
  assert.equal(perft(Position.fromFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1'), 3), 9467);
  assert.equal(perft(Position.fromFen('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8'), 3), 62379);
});

test('sanAndFen', () => {
  const l = Line.fromSan(START_FEN, 'e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 O-O f6 d4 exd4 Nxd4 c5 Nb3 Qxd1 Rxd1'.split(' '));
  assert.equal(l.last.toFen(), 'r1b1kbnr/1pp3pp/p4p2/2p5/4P3/1N6/PPP2PPP/RNBR2K1 b kq - 0 9');

  const p = Position.fromFen('3r2k1/5ppp/8/8/8/8/5PPP/R2R2K1 w - - 0 1');
  assert.equal(p.san(Move.fromUci('d1d8')), 'Rxd8#');
  assert.equal(p.san(Move.fromUci('a1b1')), 'Rab1');

  const promo = Position.fromFen('8/4P1k1/8/8/8/8/1p4K1/8 w - - 0 1');
  assert.equal(promo.san(Move.fromUci('e7e8n')), 'e8=N+');
  assert.ok(Move.fromUci('e7e8q').equals(promo.parseSan('e8=Q')));

  const ep = Line.fromSan(START_FEN, 'e4 a6 e5 d5 exd6'.split(' '));
  assert.equal(ep.last.at(35), 0);

  const fool = Line.fromSan(START_FEN, 'f3 e5 g4 Qh4#'.split(' '));
  assert.equal(fool.end(), GameEnd.CHECKMATE);

  assert.equal(Position.fromFen('4k3/8/8/6N1/8/8/8/4K1N1 w - - 0 1').san(Move.fromUci('g5f3')), 'N5f3');
  assert.equal(Position.fromFen('4k3/8/8/8/4Q2Q/8/8/K6Q w - - 0 1').san(Move.fromUci('h4e1')), 'Qh4e1+');
});

test('notationDiagnostics', () => {
  const p = Position.fromFen('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
  const m = Move.fromUci('f3e5');
  const ex = { before: p, move: m, san: p.san(m), level: 2 };
  assert.equal(ex.san, 'Nxe5');
  assert.ok(NotationLogic.diagnose('Ne5', ex).includes('x'));
  assert.ok(NotationLogic.diagnose('Kxe5', ex).includes('Knight'));
  assert.ok(NotationLogic.diagnose('Nxe5+', ex).includes('échec'));

  const pawn = { before: p, move: Move.fromUci('d2d4'), san: 'd4', level: 1 };
  assert.ok(NotationLogic.diagnose('Pd4', pawn).includes('Pe4'));
  assert.equal(NotationLogic.levelOf(p, pawn.move, 'd4'), 1);
  assert.equal(NotationLogic.levelOf(p, m, 'Nxe5'), 2);
});

test('eloAndAnnotations', () => {
  assert.equal(GameLogic.newElo(1200, 1200, 1.0), 1216);
  assert.equal(GameLogic.newElo(1200, 1200, 0.0), 1184);
  assert.equal(GameLogic.newElo(1200, 1200, 0.5), 1200);

  const p = Position.fromFen(START_FEN);
  const m = Move.fromUci('e2e4');
  assert.equal(GameLogic.annotate(p, m, { eval: 30, second: 25, best: 'e2e4' }, { eval: 28, second: 20, best: 'e7e5' }, null), null);
  assert.equal(GameLogic.annotate(p, m, { eval: 30, second: 25, best: 'd2d4' }, { eval: -600, second: null, best: 'e7e5' }, null), '??');
  assert.equal(GameLogic.annotate(p, m, { eval: 150, second: -200, best: 'e2e4' }, { eval: 150, second: 0, best: 'e7e5' }, null), '!');

  const round = decodeAnalysis(encodeAnalysis([{ eval: 12, second: null, best: 'e2e4' }, null, { eval: -3, second: 4, best: '' }]), 3);
  assert.deepEqual(round[0], { eval: 12, second: null, best: 'e2e4' });
  assert.equal(round[1], null);
  assert.notEqual(round[2], null);
});

test('capturedMaterial', () => {
  const start = materialOf(Position.fromFen(START_FEN));
  assert.equal(start.diff, 0);
  assert.equal(start.blackLost.length, 0);
  assert.equal(start.whiteLost.length, 0);

  const m = materialOf(Position.fromFen('r1b1kb1r/pppppp2/8/8/8/8/PPPPPPPP/RNBQKBN1 w Qkq - 0 1'));
  assert.deepEqual(m.blackLost, [9, 9, 10, 10, 13]);
  assert.deepEqual(m.whiteLost, [4]);
  assert.equal(m.diff, 1 + 1 + 3 + 3 + 9 - 5);
});

test('missedMates', () => {
  const mate1 = { eval: MATE - 1, second: null, best: 'd1d8' };
  assert.equal(GameLogic.missedMate(true, mate1, { eval: 300, second: null, best: 'a7a6' }), 1);
  assert.equal(GameLogic.missedMate(true, mate1, { eval: MATE, second: null, best: '' }), null);

  const mate2 = { eval: -(MATE - 3), second: null, best: 'h4h2' };
  assert.equal(GameLogic.missedMate(false, mate2, { eval: -250, second: null, best: 'g1h1' }), 2);
  assert.equal(GameLogic.missedMate(false, mate2, { eval: -(MATE - 2), second: null, best: 'g1h1' }), null);
  assert.equal(GameLogic.missedMate(true, { eval: MATE - 5, second: null, best: 'x' }, { eval: 0, second: null, best: 'y' }), null);
});

test('reviewComments', () => {
  const record = (vsComputer, playerWhite, whiteName, blackName) => ({
    date: 0, opponent: '', vsComputer, playerWhite, result: '0-1', outcome: -1, reason: 'abandon',
    eloBefore: 1200, eloAfter: 1184, moves: '', whiteName, blackName, opponentElo: 1200,
  });

  const line = Line.fromSan(START_FEN, 'e4 e5 Qh5 Nc6 Qxf7+ Kxf7'.split(' '));
  const analysis = [
    { eval: 30, second: 20, best: 'e2e4' },
    { eval: 30, second: 20, best: 'e7e5' },
    { eval: 30, second: 25, best: 'g1f3' },
    { eval: -20, second: -30, best: 'b8c6' },
    { eval: 10, second: 0, best: 'f1c4' },
    { eval: -800, second: -900, best: 'e8f7' },
    { eval: -820, second: null, best: 'd2d4' },
  ];

  const [text, tone] = ReviewComments.comment(record(true, true, 'Ivan', '🤖 Ordinateur'), line, 4, analysis);
  assert.equal(tone, 'BAD');
  assert.ok(text.startsWith('Gaffe · Ivan (Blancs)'), text);
  assert.ok(text.includes('tu exposes ta dame') && text.includes('Kxf7'), text);
  assert.ok(text.includes("L'ordinateur (Noirs) a maintenant un avantage décisif"), text);
  assert.ok(!text.includes('Évaluation') && !text.includes('préférait'), text);

  const [cpuText] = ReviewComments.comment(record(true, false, '🤖 Ordinateur', 'Ivan'), line, 4, analysis);
  assert.ok(cpuText.startsWith("Gaffe · L'ordinateur (Blancs)"), cpuText);
  assert.ok(cpuText.includes('il expose sa dame'), cpuText);
  assert.ok(!cpuText.includes(' tu '), cpuText);

  const g = record(false, true, 'Ivan', 'Léa');
  const [reply, replyTone] = ReviewComments.comment(g, line, 5, analysis);
  assert.equal(replyTone, 'INFO');
  assert.ok(reply.startsWith('Léa (Noirs) reprend en capturant la dame en f7'), reply);
  const [plain] = ReviewComments.comment(g, line, 0, analysis);
  assert.ok(plain.startsWith('Ivan (Blancs) avance un pion au centre'), plain);
  assert.ok(ReviewComments.ending(g).includes('victoire de Léa (Noirs) par abandon'));

  const lCap = Line.fromSan('4k3/8/8/3q4/8/8/8/R2R2K1 w - - 0 1', ['Kf1']);
  const [capTxt] = ReviewComments.comment(record(false, true, 'Ivan', 'Léa'), lCap, 0, [
    { eval: 900, second: 0, best: 'd1d5' },
    { eval: -100, second: null, best: 'e8e7' },
  ]);
  assert.ok(capTxt.includes("manqué l'occasion de capturer la dame en d5 avec Rxd5"), capTxt);

  const lMate = Line.fromSan('6k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1', ['Kf2']);
  const [mateTxt, mateTone] = ReviewComments.comment(record(false, true, 'Ivan', 'Léa'), lMate, 0, [
    { eval: MATE - 1, second: null, best: 'd1d8' },
    { eval: 500, second: null, best: 'g7g6' },
  ]);
  assert.equal(mateTone, 'BAD');
  assert.ok(mateTxt.startsWith('⚠️ Mat en 1 manqué · Ivan (Blancs) : tu pouvais') && mateTxt.includes('Rd8#'), mateTxt);
  const [farTxt] = ReviewComments.comment(record(false, true, 'Ivan', 'Léa'), lMate, 0, [
    { eval: MATE - 5, second: null, best: 'd1d8' },
    { eval: 500, second: null, best: 'g7g6' },
  ]);
  assert.ok(!farTxt.includes('Mat en'), farTxt);
});

test('catalogueHas113LegalDistinctLessons', () => {
  const lessons = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/data/lessons.json'), 'utf8'));
  assert.equal(lessons.length, 113);
  assert.equal(lessons.filter((l) => l.category === 'OPENING').length, 37);
  assert.equal(lessons.filter((l) => l.category === 'MIDDLEGAME').length, 38);
  assert.equal(lessons.filter((l) => l.category === 'ENDGAME').length, 38);
  assert.equal(new Set(lessons.map((l) => l.title)).size, 113);
  assert.deepEqual(lessons.map((l) => l.id), Array.from({ length: 113 }, (_, i) => i + 1));
  for (const l of lessons) {
    const line = Line.fromMoves(l.fen, l.sans);
    assert.equal(line.size, l.texts.length, l.title);
    assert.ok(line.positions[0].legalMoves.length > 0, l.title);
    assert.ok(l.texts.every((t) => t.length > 5) && l.summary.length > 10, l.title);
    assert.ok(Array.from({ length: line.size }, (_, i) => i).some((i) => line.positions[i].whiteToMove === l.heroWhite), l.title);
  }
});

test('fiftyOfficialThemes', () => {
  assert.equal(ALL_THEMES.length, 50);
  assert.equal(new Set(ALL_THEMES.map((t) => t.key)).size, 50);
  assert.ok(ALL_THEMES.every((t) => t.tip.length > 30));
  assert.equal(primaryTheme(' crushing fork middlegame short ').key, 'fork');
  assert.equal(primaryTheme(' mate mateIn2 smotheredMate middlegame ').key, 'smotheredMate');
  assert.equal(primaryTheme(' attraction mate mateIn2 middlegame short ').key, 'mateIn2');
  assert.equal(THEME_GROUPS[0], G_MATE);
});

test('all50000PuzzlesAreLegalAndIndexed', () => {
  const hot = fs.readFileSync(path.join(ROOT, 'assets/data/puzzles_hot.tsv'), 'utf8');
  const rest = fs.readFileSync(path.join(ROOT, 'assets/data/puzzles_rest.tsv'), 'utf8');
  const mockDb = { solvedIds: new Set() };
  const catalog = new PuzzleCatalog(mockDb);
  catalog._ingestTsv(hot);
  assert.ok(catalog.puzzles.length > 1400, `hot=${catalog.puzzles.length}`);
  catalog._ingestTsv(rest);
  assert.equal(catalog.puzzles.length, 50000);

  for (const pz of catalog.puzzles) {
    const line = new Line(pz.fen);
    assert.ok(line.positions[0].legalMoves.length > 0, `Puzzle ${pz.id} initial pos finished`);
    for (const u of pz.moves.split(' ')) {
      const m = Move.fromUci(u);
      assert.ok(line.last.isLegal(m), `Puzzle ${pz.id}: illegal ${u}`);
      line.push(m);
    }
  }

  const byId = catalog.byIdIgnoreCase('0d1z6');
  assert.ok(byId && byId.id === '0D1Z6');
  const first = catalog.byIdIgnoreCase('0000d');
  assert.ok(first && first.id === '0000D');
  const counts = catalog.countsForBand(0);
  assert.equal(counts.get('').total, 50000);
  const search = catalog.search('0d1z');
  assert.ok(search.items.some((it) => it.id === '0D1Z6'));
});

let failed = 0;
const tAll = performance.now();
for (const { name, fn } of tests) {
  const t0 = performance.now();
  try {
    await fn();
    console.log(`PASS ${name} (${Math.round(performance.now() - t0)} ms)`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}:`, err);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} suites passed in ${Math.round(performance.now() - tAll)} ms.`);
if (failed > 0) process.exit(1);

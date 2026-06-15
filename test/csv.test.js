const test = require('node:test');
const assert = require('node:assert/strict');
const { csvCell } = require('../src/csv');

test('csvCell escapes commas, quotes, and newlines', () => {
  assert.equal(csvCell('gap,fade'), '"gap,fade"');
  assert.equal(csvCell('He said "buy"'), '"He said ""buy"""');
  assert.equal(csvCell('line one\nline two'), '"line one\nline two"');
});

test('csvCell neutralizes formula injection but preserves negative numbers', () => {
  assert.equal(csvCell('=SUM(A1:A9)'), '"\'=SUM(A1:A9)"');
  assert.equal(csvCell('+1+2'), '"\'+1+2"');
  assert.equal(csvCell('@cmd'), '"\'@cmd"');
  assert.equal(csvCell(-5), '"-5"');
  assert.equal(csvCell(-1.2), '"-1.2"');
});

test('csv row preserves column positions when values contain commas', () => {
  const row = ['2026-06-14', 'AAPL', 'long', 100, 105, 1, 5, 'gap,fade', 'neutral', 5, 1, 'comma test']
    .map(csvCell)
    .join(',');
  assert.equal(
    row,
    '"2026-06-14","AAPL","long","100","105","1","5","gap,fade","neutral","5","1","comma test"'
  );
});
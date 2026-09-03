const assert = require('node:assert/strict');
const test = require('node:test');
const { closeAllCards } = require('./card-manager.cjs');

test('closes every live desktop card even when close mutates the map', () => {
  const cards = new Map();
  const closed = [];
  for (const id of [1, 2, 3]) {
    cards.set(id, {
      isDestroyed: () => false,
      close: () => {
        closed.push(id);
        cards.delete(id);
      },
    });
  }

  assert.equal(closeAllCards(cards), 3);
  assert.deepEqual(closed, [1, 2, 3]);
  assert.equal(cards.size, 0);
});

test('ignores desktop card windows that are already destroyed', () => {
  let closeCalled = false;
  const cards = new Map([['old', {
    isDestroyed: () => true,
    close: () => { closeCalled = true; },
  }]]);

  assert.equal(closeAllCards(cards), 0);
  assert.equal(closeCalled, false);
});

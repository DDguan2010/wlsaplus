function closeAllCards(cards) {
  const windows = [...cards.values()];
  let closed = 0;
  for (const window of windows) {
    if (window.isDestroyed()) continue;
    window.close();
    closed += 1;
  }
  return closed;
}

module.exports = { closeAllCards };

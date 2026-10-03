// The wanted level: every hitchhiker you hit counts. 3 brings a cop car, 6 a second, 9 a third plus a
// helicopter overhead. Lose them (every cop > 300 m back for 10 s, or all wrecked) or get busted (touched,
// or sat still next to one for a second); either way the slate is wiped. Pure: main.js does the showing.
export const WANTED = [3, 6, 9], ESCAPE_GAP = 300, ESCAPE_T = 10, BUST_DIST = 4, BUST_SPEED = 3, BUST_T = 1;

export function makeChase() {
  const st = { kids: 0, cars: 0, heli: false };
  let loseT = 0, stillT = 0;
  function reset() { Object.assign(st, { kids: 0, cars: 0, heli: false }); loseT = 0; stillT = 0; }
  function hitKid() {
    st.kids++;
    const ev = [], want = WANTED.filter((k) => st.kids >= k).length;
    while (st.cars < want) { st.cars++; ev.push('spawn'); }
    if (st.kids >= WANTED[2] && !st.heli) { st.heli = true; ev.push('heli'); }
    return ev;
  }
  // cops: [{ gap: player s - cop s, dist: metres apart, contact: bodies touching }] for every cop on the road
  function update(dt, speed, cops) {
    if (!st.cars) return null;
    if (cops.some((c) => c.contact)) { reset(); return 'bust'; }
    stillT = speed < BUST_SPEED && cops.some((c) => c.dist < BUST_DIST) ? stillT + dt : 0;
    if (stillT >= BUST_T) { reset(); return 'bust'; }
    loseT = cops.every((c) => c.gap > ESCAPE_GAP) ? loseT + dt : 0;
    if (loseT >= ESCAPE_T) { reset(); return 'escape'; }
    return null;
  }
  return { st, hitKid, update, reset };
}

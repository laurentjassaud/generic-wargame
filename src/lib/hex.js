// Maths hexagonales — cohérentes avec le rendu flat-top de HexMap.vue :
// colonnes d'index IMPAIR décalées vers le bas (disposition "offset odd-q").
// col : 0-based (0 = première colonne). row : 1-based (cohérent avec hexId).

function offsetToCube(col, row) {
  const q = col
  const r = row - (col - (col & 1)) / 2
  return { q, r, s: -q - r }
}

/** Distance en nombre d'hexs entre deux cases {col,row}. */
export function hexDistance(a, b) {
  const A = offsetToCube(a.col, a.row)
  const B = offsetToCube(b.col, b.row)
  return (Math.abs(A.q - B.q) + Math.abs(A.r - B.r) + Math.abs(A.s - B.s)) / 2
}

const AXIAL_DIRS = [
  { dq: 1, dr: 0 }, { dq: 1, dr: -1 }, { dq: 0, dr: -1 },
  { dq: -1, dr: 0 }, { dq: -1, dr: 1 }, { dq: 0, dr: 1 },
]

function toAxial(col, row) {
  const { q, r } = offsetToCube(col, row)
  return { q, r }
}
function fromAxial(q, r) {
  return { col: q, row: r + (q - (q & 1)) / 2 }
}

/** Les 6 hexs voisins de (col,row). */
export function neighborsOf(col, row) {
  const { q, r } = toAxial(col, row)
  return AXIAL_DIRS.map((d) => fromAxial(q + d.dq, r + d.dr))
}

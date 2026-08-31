// Calibration de la grille hexagonale posée sur l'image de carte, en pixels
// natifs de l'image (pas en pixels écran — le zoom ne touche pas ces valeurs).
// Contrairement au reste des infos de carte (image, cols/rows, orientation),
// qui vivent dans le JSON du module (src/modules/*.json), la calibration
// reste ici : elle sert de réglage par défaut / de secours pour le panneau
// de calibration (CalibrationPanel.vue, bouton "réinitialiser défauts").
//
//  x0,y0    : centre du premier hex (colonne 0, ligne 1)
//  colStep  : pas horizontal entre deux colonnes adjacentes
//  a        : rayon horizontal de l'hex (centre -> sommet gauche/droite)  [largeur hex = 2a]
//  rowStep  : pas vertical entre deux lignes d'une même colonne          [= flat-to-flat]
//  -> demi-hauteur b = rowStep / 2 ; les colonnes impaires (index 1, 3, 5…)
//     sont décalées de +b vers le bas (disposition hex "flat-top", offset odd-q).
//
// Valeurs mesurées sur arnhem-map.jpg (3300×2550) — alignement vérifié du
// coin Eindhoven (haut-gauche) jusqu'au coin Arnhem/Oosterbeek (bas-droit),
// aucune dérive cumulative constatée.
export const DEFAULT_CALIBRATION = {
  x0: 100.5,
  y0: 122,
  colStep: 81,
  a: 55,
  rowStep: 93.25
}

/** Identifiant d'hex tel qu'imprimé sur la carte : "0101", "3907"…
 *  col/row sont 1-based (colonne 1 = "01", ligne 1 = "01"). */
export function hexId(col, row) {
  return String(col).padStart(2, '0') + String(row).padStart(2, '0')
}

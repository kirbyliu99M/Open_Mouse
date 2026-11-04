/**
 * Scan lab L10 (candidate 未拍板): the hand guides' shared wording (繁中).
 * Kirby 2026-11-02 (decision 3): the fingers are NATURAL: back of the hand
 * up, flat on the table, fingers naturally straight and naturally apart;
 * neither held together nor spread on purpose. Bent fingers are still
 * checked; how far apart they are is only recorded. No medical wording.
 * Every line here is candidate; a version may use its own lines too.
 */
export const GUIDE_COPY = {
  loading: "準備中…",
  noHand: "手背朝上，整隻手平放進畫面，手指朝上",
  steady: "拿穩，不要動",
  holdStill: "很好，保持不動",
  /** L13: the ok line of the guided versions (G-M2, G-LC); G0 keeps holdStill. */
  locked: "就是這樣，保持不動",
  shooting: "很好，拿穩，自動拍照中",
  fingersStraight: "手指自然放鬆、平貼桌面，不要彎",
  levelPhone: "手機放平",
  wholeHandIn: "整隻手放進畫面",
  paperCorners: "紙的四個角都要入鏡",
  handOnPaper: "把手放到紙上，手背朝上",
  /** L13: the overlay's zone labels; a newline breaks the line. */
  handZone: "手放這裡",
  cardZone: "卡片\n放這裡",
} as const;

/** The shared pre-shot steps (card reference); versions may add their own. */
export const CARD_STEPS: readonly string[] = [
  "① 卡片平放在小指那一側的桌上，不要拿在手上、不要墊高",
  "② 手背朝上，手掌和手腕整段貼桌；手指自然伸直、自然張開（不用併攏，也不用刻意張開）",
  "③ 手機直拿、在正上方放平，整隻手和卡片都入鏡",
];

/** The shared pre-shot steps (A4 reference). */
export const A4_STEPS: readonly string[] = [
  "① A4 直放在桌上，四個角都入鏡",
  "② 手背朝上放在紙上，手掌和手腕整段貼紙；手指自然伸直、自然張開",
  "③ 手機直拿、在正上方放平",
];

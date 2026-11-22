/**
 * Ingredient Health Warning Evaluator
 * Flags high sugar, high sodium, high saturated fat, high total fat,
 * and ultra-processed (NOVA 4) items across My Stock, Need to Buy,
 * Barcode Scanner, and AI Chef previews.
 */

export const HEALTH_THRESHOLDS = Object.freeze({
  sugarSolidG: 15,
  sugarDrinkG: 7.5,
  sodiumMg: 600,
  satFatG: 5,
  fatG: 17.5
});

function readNonNeg(val) {
  if (val === null || val === undefined || val === '' || typeof val === 'boolean') return null;
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function normalizeLevel(val) {
  const s = String(val || '').trim().toLowerCase();
  if (s === 'low' || s === 'moderate' || s === 'high') return s;
  return '';
}

export function normalizeHealthMeta(rawHealth, rawPer100g) {
  const src = (rawHealth && typeof rawHealth === 'object' && !Array.isArray(rawHealth)) ? rawHealth : {};
  const per = (rawPer100g && typeof rawPer100g === 'object' && !Array.isArray(rawPer100g)) ? rawPer100g : {};

  let sugars = readNonNeg(src.sugars !== undefined ? src.sugars : (src.sugars_100g !== undefined ? src.sugars_100g : per.sugars));
  if (sugars !== null) sugars = round1(clamp(sugars, 0, 100));

  let saturatedFat = readNonNeg(
    src.saturatedFat !== undefined
      ? src.saturatedFat
      : (src['saturated-fat_100g'] !== undefined ? src['saturated-fat_100g'] : per.saturatedFat)
  );
  if (saturatedFat !== null) saturatedFat = round1(clamp(saturatedFat, 0, 100));

  let sodiumMg = readNonNeg(
    src.sodiumMg !== undefined
      ? src.sodiumMg
      : (src.sodium_mg !== undefined ? src.sodium_mg : per.sodiumMg)
  );
  if (sodiumMg !== null) {
    sodiumMg = Math.round(clamp(sodiumMg, 0, 50000));
  } else {
    const sodiumRaw = readNonNeg(src.sodium !== undefined ? src.sodium : src.sodium_100g);
    if (sodiumRaw !== null) {
      sodiumMg = Math.round(clamp(sodiumRaw <= 20 ? sodiumRaw * 1000 : sodiumRaw, 0, 50000));
    } else {
      const saltRaw = readNonNeg(src.salt !== undefined ? src.salt : src.salt_100g);
      if (saltRaw !== null) {
        sodiumMg = Math.round(clamp(saltRaw * 400, 0, 50000));
      }
    }
  }

  const rawNova = readNonNeg(src.novaGroup !== undefined ? src.novaGroup : src.nova_group);
  const novaInt = rawNova !== null ? Math.round(rawNova) : null;
  const novaGroup = (novaInt !== null && novaInt >= 1 && novaInt <= 4) ? novaInt : null;

  const rawScore = String(src.nutriScore !== undefined ? src.nutriScore : (src.nutriscore_grade || '')).trim().toLowerCase();
  const nutriScore = /^[a-e]$/.test(rawScore) ? rawScore : '';

  const rawLevels = (src.nutrientLevels && typeof src.nutrientLevels === 'object')
    ? src.nutrientLevels
    : ((src.nutrient_levels && typeof src.nutrient_levels === 'object') ? src.nutrient_levels : {});
  const nutrientLevels = {
    fat: normalizeLevel(rawLevels.fat),
    saturatedFat: normalizeLevel(rawLevels.saturatedFat !== undefined ? rawLevels.saturatedFat : rawLevels['saturated-fat']),
    sugars: normalizeLevel(rawLevels.sugars),
    salt: normalizeLevel(rawLevels.salt)
  };
  const hasLevels = Boolean(nutrientLevels.fat || nutrientLevels.saturatedFat || nutrientLevels.sugars || nutrientLevels.salt);

  if (sugars === null && saturatedFat === null && sodiumMg === null && novaGroup === null && !nutriScore && !hasLevels) {
    return null;
  }

  return {
    sugars,
    saturatedFat,
    sodiumMg,
    novaGroup,
    nutriScore,
    nutrientLevels
  };
}

export function isPlainWholeFruit(name, aisle, novaGroup) {
  if (Number(novaGroup) === 4) return false;
  const txt = String(name || '').toLowerCase();
  if (!txt) return false;
  if (/\b(sweetened|syrup|sirop|jam|confiture|juice|jus|yogurt|yogourt|bar|candy|cereal|dried|sec|glazed|sauce|cake|cookie|muffin|pie|tarte|soda|compote|punch)\b/i.test(txt)) {
    return false;
  }
  const looksLikeFruit = /\b(bananas?|berries|berry|blueberr(?:y|ies)|strawberr(?:y|ies)|raspberr(?:y|ies)|blackberr(?:y|ies)|cranberr(?:y|ies)|apples?|oranges?|grapes?|mangos?|mangoes|pears?|peach(?:es)?|plums?|pineapples?|melons?|watermelons?|kiwis?|cherr(?:y|ies))\b/i.test(txt);
  if (!looksLikeFruit) return false;
  return !aisle || aisle === 'Produce' || aisle === 'Frozen';
}

function isLikelyBeverage(name) {
  const txt = String(name || '').toLowerCase();
  return /\b(juice|jus|soda|cola|pop|drink|boisson|milk|lait|smoothie|shake|coffee|tea|latte|kefir|broth)\b/i.test(txt);
}

/**
 * Evaluates an ingredient/product and returns an array of health warnings:
 * [{ code, label, detail, severity }]
 */
export function evaluateIngredientHealth(item) {
  if (!item || typeof item !== 'object') return [];

  const warnings = [];
  const name = String(item.name || '').trim();
  const aisle = String(item.aisle || '').trim();
  const per = (item.per100g && typeof item.per100g === 'object') ? item.per100g : {};
  const health = normalizeHealthMeta(item.health || item, per) || {
    sugars: null,
    saturatedFat: null,
    sodiumMg: null,
    novaGroup: null,
    nutriScore: '',
    nutrientLevels: {}
  };

  const fat = readNonNeg(per.fat !== undefined ? per.fat : item.fat);
  const sugars = health.sugars;
  const sodiumMg = health.sodiumMg;
  const saturatedFat = health.saturatedFat;
  const novaGroup = health.novaGroup;
  const nutriScore = health.nutriScore;
  const levels = health.nutrientLevels || {};

  const wholeFruit = isPlainWholeFruit(name, aisle, novaGroup);
  const sugarThreshold = isLikelyBeverage(name) ? HEALTH_THRESHOLDS.sugarDrinkG : HEALTH_THRESHOLDS.sugarSolidG;

  if (!wholeFruit && ((sugars !== null && sugars >= sugarThreshold) || levels.sugars === 'high')) {
    warnings.push({
      code: 'high_sugar',
      label: '\u26A0 High Sugar',
      detail: sugars !== null ? (round1(sugars) + 'g/100g') : 'High level',
      severity: 'high'
    });
  }

  if ((sodiumMg !== null && sodiumMg >= HEALTH_THRESHOLDS.sodiumMg) || levels.salt === 'high') {
    warnings.push({
      code: 'high_sodium',
      label: '\u26A0 High Sodium',
      detail: sodiumMg !== null ? (Math.round(sodiumMg) + 'mg/100g') : 'High level',
      severity: 'high'
    });
  }

  if ((saturatedFat !== null && saturatedFat >= HEALTH_THRESHOLDS.satFatG) || levels.saturatedFat === 'high') {
    warnings.push({
      code: 'high_sat_fat',
      label: '\u26A0 High Sat. Fat',
      detail: saturatedFat !== null ? (round1(saturatedFat) + 'g/100g') : 'High level',
      severity: 'high'
    });
  }

  if ((fat !== null && fat >= HEALTH_THRESHOLDS.fatG) || levels.fat === 'high') {
    warnings.push({
      code: 'high_fat',
      label: '\u26A0 High Fat',
      detail: fat !== null ? (round1(fat) + 'g/100g') : 'High level',
      severity: 'medium'
    });
  }

  if (Number(novaGroup) === 4) {
    warnings.push({
      code: 'ultra_processed',
      label: '\u26A0 Ultra-Processed',
      detail: 'NOVA 4',
      severity: 'medium'
    });
  }

  if (warnings.length === 0 && nutriScore === 'e') {
    warnings.push({
      code: 'low_nutriscore',
      label: '\u26A0 Nutri-Score E',
      detail: 'Grade E',
      severity: 'medium'
    });
  }

  if (sugars === null && sodiumMg === null && saturatedFat === null && name) {
    if (!warnings.some((w) => w.code === 'high_sodium') && /\b(bacon|sausage|saucisse|salami|pepperoni|bologna|hot\s*dog|deli\s*ham|soy\s*sauce|teriyaki|bbq\s*sauce|ketchup|ramen|instant\s*noodle|chips|croustille)s?\b/i.test(name)) {
      warnings.push({
        code: 'high_sodium',
        label: '\u26A0 High Sodium (est.)',
        detail: 'Typically high sodium',
        severity: 'medium'
      });
    }
    if (!warnings.some((w) => w.code === 'high_sugar') && !wholeFruit && /\b(candy|soda|cola|syrup|sirop|frosting|icing|glazed|sweetened)s?\b/i.test(name)) {
      warnings.push({
        code: 'high_sugar',
        label: '\u26A0 High Sugar (est.)',
        detail: 'Typically high sugar',
        severity: 'medium'
      });
    }
  }

  return warnings;
}

/**
 * Creates DOM warning badge elements inside a DocumentFragment for a given item.
 */
export function createHealthWarningBadges(item, createEl, { compact = false } = {}) {
  const frag = document.createDocumentFragment();
  const warnings = evaluateIngredientHealth(item);
  if (warnings.length === 0) return frag;

  const makeSpan = typeof createEl === 'function'
    ? createEl
    : (tag, cls, txt) => {
        const s = document.createElement(tag);
        if (cls) s.className = cls;
        if (txt !== undefined) s.textContent = txt;
        return s;
      };

  warnings.forEach((w) => {
    const text = compact || !w.detail ? w.label : (w.label + ' (' + w.detail + ')');
    const badge = makeSpan('span', 'badge health-warn-badge', text);
    badge.setAttribute('data-health-warn', w.code);
    if (w.detail) badge.setAttribute('title', w.label + ' — ' + w.detail);
    frag.appendChild(badge);
  });
  return frag;
}

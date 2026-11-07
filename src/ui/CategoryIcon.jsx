import React from 'react';

export const CATEGORY_EMOJI_MAP = {
  cat_food: '🍽',
  cat_groceries: '🛒',
  cat_fuel: '⛽',
  cat_travel: '✈️',
  cat_shopping: '🛍',
  cat_bills: '🧾',
  cat_entertainment: '🎬',
  cat_health: '💊',
  cat_emi: '💳',
  cat_cash: '💵',
  cat_insurance: '🛡',
  cat_other: '📦',
};

export const CATEGORY_EMOJI_BY_NAME = {
  food: '🍽',
  groceries: '🛒',
  fuel: '⛽',
  travel: '✈️',
  shopping: '🛍',
  'bills and utilities': '🧾',
  bills: '🧾',
  entertainment: '🎬',
  health: '💊',
  'emi and loans': '💳',
  emi: '💳',
  cash: '💵',
  insurance: '🛡',
  other: '📦',
};

/**
 * Renders category icon:
 * - Emoji from CATEGORY_EMOJI_MAP for standard categories
 * - Colored circle with first letter of name for user-created categories
 * - Sits in a fixed 40px box and never overlaps text
 */
export default function CategoryIcon({ category, size = 40 }) {
  const cat = category || {};
  const catId = cat.id || cat.categoryId || '';
  const normName = String(cat.name || '').toLowerCase().trim();

  const emoji = CATEGORY_EMOJI_MAP[catId] || CATEGORY_EMOJI_BY_NAME[normName];
  const firstLetter = (cat.name || '?').trim().charAt(0).toUpperCase();
  const circleColor = cat.color || '#3b82f6';

  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        minWidth: `${size}px`,
        minHeight: `${size}px`,
        maxWidth: `${size}px`,
        maxHeight: `${size}px`,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {emoji ? (
        <span
          style={{
            fontSize: `${Math.round(size * 0.55)}px`,
            lineHeight: 1,
            userSelect: 'none',
          }}
        >
          {emoji}
        </span>
      ) : (
        <span
          style={{
            width: `${Math.round(size * 0.85)}px`,
            height: `${Math.round(size * 0.85)}px`,
            borderRadius: '50%',
            backgroundColor: circleColor,
            color: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: `${Math.round(size * 0.45)}px`,
            userSelect: 'none',
          }}
        >
          {firstLetter}
        </span>
      )}
    </div>
  );
}


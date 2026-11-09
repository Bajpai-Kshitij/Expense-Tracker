import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, 'styles.css'), 'utf8');
const ruleFor = (selector) => {
  const start = css.indexOf(`${selector} {`);
  return start === -1 ? '' : css.slice(start, css.indexOf('}', start));
};

describe('bottom sheet layout', () => {
  it('limits a form inside the sheet, so the body scrolls and the footer stays visible', () => {
    const rule = ruleFor('.modal-sheet > form');
    expect(rule).toMatch(/display:\s*flex/);
    expect(rule).toMatch(/flex-direction:\s*column/);
    expect(rule).toMatch(/min-height:\s*0/);
    expect(ruleFor('.modal-body')).toMatch(/min-height:\s*0/);
  });
});

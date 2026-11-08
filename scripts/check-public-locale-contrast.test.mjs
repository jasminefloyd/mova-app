import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const tokensPath = new URL('../packages/design-tokens/src/tokens.css', import.meta.url);
const stylesPath = new URL('../apps/web/src/styles.css', import.meta.url);

function declarations(styles, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = styles.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing CSS selector ${selector}`);
  return Object.fromEntries(match[1].split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const separator = part.indexOf(':');
    return [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }));
}

function tokenValue(token, variables) {
  const match = token.match(/^var\((--[\w-]+)\)$/);
  assert.ok(match, `expected a design token reference, received ${token}`);
  const value = variables.get(match[1]);
  assert.ok(value, `missing design token ${match[1]}`);
  return value;
}

function linear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(color) {
  const match = color.match(/^#([\da-f]{6})$/i);
  assert.ok(match, `expected a six-digit hex token, received ${color}`);
  const channels = [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16));
  return 0.2126 * linear(channels[0]) + 0.7152 * linear(channels[1]) + 0.0722 * linear(channels[2]);
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('TC-F13-V1-04 public language toggle labels meet WCAG AA in both states', async () => {
  const [tokenCss, appCss] = await Promise.all([readFile(tokensPath, 'utf8'), readFile(stylesPath, 'utf8')]);
  const variables = new Map([...tokenCss.matchAll(/(--[\w-]+)\s*:\s*(#[\da-f]{6})/gi)].map((match) => [match[1], match[2]]));
  const group = declarations(appCss, '.mova-public-locale-toggle');
  const button = declarations(appCss, '.mova-public-locale-toggle button');
  const active = declarations(appCss, '.mova-public-locale-toggle button[aria-pressed="true"]');
  const inactiveRatio = contrast(tokenValue(button.color, variables), tokenValue(group.background, variables));
  const activeRatio = contrast(tokenValue(active.color, variables), tokenValue(active.background, variables));
  assert.ok(inactiveRatio >= 4.5, `inactive locale label contrast is ${inactiveRatio.toFixed(2)}:1`);
  assert.ok(activeRatio >= 4.5, `active locale label contrast is ${activeRatio.toFixed(2)}:1`);
});

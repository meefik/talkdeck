const NAMED = { white: '#ffffff', black: '#000000' };

/** '#rgb' | '#rrggbb' | 'rrggbb' | white | black -> '#rrggbb' (throws on anything else) */
export function parseColor(c) {
  let h = NAMED[String(c).toLowerCase()] ?? String(c);
  h = h.replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = [...h].map((x) => x + x).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`bad color "${c}" (use white, black, #rgb or #rrggbb)`);
  return `#${h.toLowerCase()}`;
}

export const invertColor = (c) =>
  '#' + [1, 3, 5].map((i) => (255 - parseInt(parseColor(c).slice(i, i + 2), 16)).toString(16).padStart(2, '0')).join('');

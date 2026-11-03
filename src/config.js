import { load } from 'js-yaml';
import { parseColor } from './avatar.js';

// service addresses depend on the machine, not on the deck: they come from the environment
const MOVED = { 'tts-url': 'DECK_TTS_URL', 'avatar-url': 'DECK_AVATAR_URL' };

export const POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];

/** The YAML front matter of slides.md (the "header") as an object. */
export function readFrontMatter(source) {
  const m = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  let data;
  try {
    data = load(m[1]);
  } catch (e) {
    throw new Error(`slides.md: invalid front matter: ${e.reason ?? e.message}`);
  }
  return data && typeof data === 'object' ? data : {};
}

function pick(front, key, fallback, check) {
  const v = front[key];
  if (v === undefined || v === null) return fallback;
  try {
    return check(v);
  } catch (e) {
    throw new Error(`slides.md: front matter "${key}": ${e.message}`);
  }
}

const number = (min, max) => (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`must be a number from ${min} to ${max}`);
  return v;
};
const text = (v) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error('must be a non-empty string');
  return v.trim();
};
const oneOf = (list) => (v) => {
  if (!list.includes(v)) throw new Error(`must be one of ${list.join(', ')}`);
  return v;
};
const color = (v) => {
  try {
    parseColor(v); // throws with a helpful message
  } catch (e) {
    // an unquoted 000000 is read by YAML as the number 0
    throw new Error(typeof v === 'number' ? `${e.message}; YAML read it as a number, so quote the value in slides.md` : e.message);
  }
  return String(v);
};

/**
 * Deck settings from the front matter (one voice and one face for the whole deck):
 *
 *   voice, tts-model, tts-speed              the voice-over
 *   silent-duration                                    seconds shown for slides without notes
 *   avatar, avatar-size, avatar-diameter,              the talking head and how the circle looks
 *   avatar-position, avatar-border, avatar-border-color
 *
 * The service addresses and the TTS key are not deck settings: DECK_TTS_URL, DECK_AVATAR_URL and
 * DECK_TTS_KEY in the environment.
 */
export function deckConfig(front) {
  for (const [key, name] of Object.entries(MOVED)) {
    if (front[key] !== undefined) throw new Error(`slides.md: front matter "${key}" is not a deck setting; set the ${name} environment variable instead`);
  }
  // `avatar-border-color: #ff0000` is a YAML comment, i.e. null: don't silently fall back to the default
  if (front['avatar-border-color'] === null) throw new Error('slides.md: front matter "avatar-border-color": empty value; quote a hex color ("#ff0000"), since an unquoted # starts a YAML comment');
  if (front['tts-seed'] !== undefined) throw new Error('slides.md: front matter "tts-seed" is not a deck setting; it is an option of "deck voice" (--tts-seed)');
  return {
    silentDuration: pick(front, 'silent-duration', 3, number(0.5, 60)),
    tts: {
      voice: pick(front, 'voice', undefined, text),
      model: pick(front, 'tts-model', 'qwen-tts', text),
      speed: pick(front, 'tts-speed', 1, number(0.25, 4)),
    },
    avatar: {
      name: pick(front, 'avatar', undefined, text),
      size: pick(front, 'avatar-size', 512, number(2, 1920)),
      diameter: pick(front, 'avatar-diameter', 0.26, number(0.05, 1)),
      position: pick(front, 'avatar-position', 'top-right', oneOf(POSITIONS)),
      border: pick(front, 'avatar-border', 6, number(0, 100)),
      borderColor: pick(front, 'avatar-border-color', 'black', color),
    },
  };
}

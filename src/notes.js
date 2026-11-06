// Speaker notes -> text that a TTS engine reads well.

const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function words(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${words(n % 100)}` : ''}`;
  if (n < 1e6) return `${words(Math.floor(n / 1000))} thousand${n % 1000 ? ` ${words(n % 1000)}` : ''}`;
  return String(n);
}

export function ttsSafe(text) {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*`]/g, '')
    .replace(/(^|[^\w])_+|_+(?=$|[^\w])/g, '$1') // markdown emphasis, but keep underscores inside words
    .replace(/\b\d{1,3}(?:,\d{3})+\b/g, (n) => n.replace(/,/g, '')) // 1,500 -> 1500
    .replace(/\b(\d+)\.x\b/g, (_, a) => `${words(+a)} point x`)
    .replace(/\b(\d+)\.(\d+)%/g, (_, a, b) => `${words(+a)} point ${[...b].map((d) => ONES[d]).join(' ')} percent`)
    .replace(/\b(\d+)\.(\d+)\b/g, (_, a, b) => `${words(+a)} point ${[...b].map((d) => ONES[d]).join(' ')}`)
    .replace(/\b(\d+)%/g, (_, a) => `${words(+a)} percent`)
    .replace(/\b\d+\b/g, (a) => words(+a))
    .replace(/[—–]/g, ' ')
    .replace(/§/g, ' section ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** notes: string[][] (per slide, one entry per comment) -> string[] of speech text. */
export const speechPerSlide = (notes) => notes.map((lines) => ttsSafe(lines.join(' ')));

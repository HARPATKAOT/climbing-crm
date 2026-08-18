import fs from 'fs';

const p = new URL('./customerIntent.js', import.meta.url);
let s = fs.readFileSync(p, 'utf8');
const nl = s.includes('\r\n') ? '\r\n' : '\n';
const j = (t) => t.split('\n').join(nl);

const from = `const CACHE_LIMIT = 200;
const cache = new Map();

function cacheKey(question, message) {
  return \`\${question} \${message}\`;
}

function remember(key, value) {
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return value;
}

function firstText(content) {`;
const to = `/**
 * No cache on purpose. It saves one short call and costs the ability to reason
 * about a turn on its own: the same sentence from two people, minutes apart,
 * would share one answer, and a stale entry would be invisible. Two calls per
 * turn at most is not a cost worth that.
 */
function firstText(content) {`;

if (!s.includes(j(from))) throw new Error('cache block not found');
s = s.replace(j(from), j(to));

s = s.replace(j(`  const key = cacheKey(question, text);
  if (cache.has(key)) return cache.get(key);

`), '');
s = s.replace(j(`    return remember(key, /^\\s*כן\\b/u.test(firstText(content)));`),
              j(`    return /^\\s*כן\\b/u.test(firstText(content));`));
s = s.replace(j(`
/** נוקה בין בדיקות, כדי שתשובה שנשמרה לא תדלוף לבדיקה הבאה. */
export function clearIntentCache() {
  cache.clear();
}
`), '');

fs.writeFileSync(p, s);
console.log('ok');

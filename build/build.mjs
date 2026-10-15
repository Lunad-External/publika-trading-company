// Builds the clean-URL GitHub Pages site into _site/ from the Claude Design source pages.
// Run: node build/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, '_site');
const BASE = '/publika-trading-company/';

// Lowercase, any run of non a-z0-9 characters becomes one hyphen, trim hyphens.
const slugify = s => String(s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---------- 1. Extract the product catalogue from Product.dc.html ----------
function extractCatalogue() {
  const html = read('Product.dc.html');
  const m = html.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('No dc script in Product.dc.html');
  let src = m[1];
  const hook = /(const catOf = [^\n]*\n)/;
  if (!hook.test(src)) throw new Error('catOf not found in Product.dc.html');
  src = src.replace(hook, '$1globalThis.__X = { CATS, subOf, catOf, ALL, slug };\n');
  const store = {};
  const sandbox = {
    DCLogic: class { constructor(p) { this.props = p || {}; } setState() {} },
    React: { createRef: () => ({ current: null }) },
    window: { innerWidth: 1280, location: { hash: '' }, addEventListener() {}, PUBLIKA_INDEX: [] },
    document: { addEventListener() {}, querySelector() { return null; } },
    localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    console, encodeURI, encodeURIComponent, JSON, Math, Object, Array, String, RegExp
  };
  vm.createContext(sandbox);
  vm.runInContext(src + '\nconst __c = new Component({}); __c.state.hash = ""; __c.renderVals();', sandbox);
  return sandbox.__X;
}

const X = extractCatalogue();
const { CATS, subOf, catOf, ALL, slug: dcSlug } = X;

// ---------- 2. Build the route table ----------
// routes: clean path ('' = home) -> { page: 'Category', hash: 'sanitary/wcs' }
// linkMap: legacy href key ('Category.dc.html#sanitary/wcs') -> clean path
const routes = new Map();
const linkMap = {};
const addRoute = (clean, page, hash, legacyKeys = []) => {
  if (routes.has(clean)) throw new Error('Duplicate route: ' + clean);
  routes.set(clean, { page, hash });
  for (const k of legacyKeys) linkMap[k] = clean;
};

const STATIC = [
  ['', 'Home', ['Home.dc.html', 'index.html']],
  ['about-us', 'About Us', ['About Us.dc.html']],
  ['products', 'Products', ['Products.dc.html']],
  ['projects', 'Projects', ['Projects.dc.html']],
  ['company-profile', 'Company Profile', ['Company Profile.dc.html']],
  ['blogs', 'Blogs', ['Blogs.dc.html']],
  ['contact-us', 'Contact Us', ['Contact Us.dc.html']],
  ['cart', 'Cart', ['Cart.dc.html']]
];
for (const [clean, page, keys] of STATIC) addRoute(clean, page, '', keys);

// Blog and project detail pages (slugs read from the source data).
const slugsIn = (file) => [...new Set([...read(file).matchAll(/"slug":"([^"]+)"/g)].map(m => m[1]))];
for (const s of slugsIn('Blogs.dc.html')) addRoute('blogs/' + slugify(s), 'Blogs', s, ['Blogs.dc.html#' + s]);
for (const s of slugsIn('Projects.dc.html')) addRoute('projects/' + slugify(s), 'Projects', s, ['Projects.dc.html#' + s]);

// Categories and sub-categories.
const catSlug = {};
for (const k of Object.keys(CATS)) {
  catSlug[k] = slugify(CATS[k].title);
  addRoute(catSlug[k], 'Category', k, ['Category.dc.html#' + k]);
  for (const sub of CATS[k].subs) {
    addRoute(catSlug[k] + '/' + slugify(sub), 'Category', k + '/' + dcSlug(sub), ['Category.dc.html#' + k + '/' + dcSlug(sub)]);
  }
}
linkMap['Category.dc.html'] = catSlug.sanitary;

// Products: /<category>/<sub-category>/<product-name>
const productPath = {};
for (const id of Object.keys(ALL)) {
  const ck = catOf(id);
  const sub = subOf(id);
  const subPath = catSlug[ck] + '/' + slugify(sub);
  if (!routes.has(subPath)) {
    // Sub-category not listed in the category sidebar: still give it a listing page.
    addRoute(subPath, 'Category', ck + '/' + dcSlug(sub), ['Category.dc.html#' + ck + '/' + dcSlug(sub)]);
  }
  const base = subPath + '/' + (slugify(ALL[id].name) || id);
  let p = base, n = 2;
  while (routes.has(p)) p = base + '-' + n++;
  addRoute(p, 'Product', id, ['Product.dc.html#' + id]);
  productPath[id] = p;
}
linkMap['Product.dc.html'] = productPath.s1;

// ---------- 3. Helpers to rewrite legacy links ----------
const cleanUrl = p => BASE + p;
const legacyToClean = raw => {
  let k = raw;
  try { k = decodeURIComponent(raw); } catch {}
  k = k.replace(/^\.\//, '');
  if (linkMap[k] !== undefined) return cleanUrl(linkMap[k]);
  const m = k.match(/^([A-Za-z ]+\.dc\.html)(#.*)?$/);
  if (m && linkMap[m[1]] !== undefined) return cleanUrl(linkMap[m[1]]);
  return null;
};

function transformPage(html, page, hash) {
  let out = html;
  // Base URL so every relative asset/script path resolves from the site root.
  const boot = `<base href="${BASE}">\n<link rel="stylesheet" href="mobile.css">\n<script>window.__PAGE=${JSON.stringify(page)};window.__HASH=${JSON.stringify(hash)};</script>\n<script src="routes.js"></script>`;
  out = out.replace(/<head>/i, '<head>\n' + boot);
  // Route from the clean path instead of location.hash.
  out = out.split('window.location.hash.slice(1)').join("(window.__HASH||'')");
  // Static hrefs in the template.
  out = out.replace(/href="([^"{}]*?\.dc\.html(?:#[^"]*)?)"/g, (all, h) => {
    const c = legacyToClean(h);
    return c ? `href="${c}"` : all;
  });
  // String literals in the page script ('Blogs.dc.html#x', 'Cart.dc.html', ...).
  // A bare 'X.dc.html#' is a prefix joined with an id at runtime; routes.js maps those.
  out = out.replace(/'((?:[A-Za-z]|%20| )+\.dc\.html(?:#[^']*)?)'/g, (all, h) => {
    if (h.endsWith('#')) return all;
    const c = legacyToClean(h);
    return c ? `'${c}'` : all;
  });
  // CSS hover selectors that keyed on the old URLs.
  out = out.split('a[href*="Blogs.dc.html#"]').join('a[href*="/blogs/"]');
  out = out.split('a[href*="Projects.dc.html#"]').join('a[href*="/projects/"]');
  return out;
}

// ---------- 4. Write the site ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const copy = (rel) => {
  const src = path.join(ROOT, rel), dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
};
// image-slot.js: images must not swallow touch gestures, or the page can't be
// scrolled with a thumb on a photo (touch-action is only needed in edit mode).
{
  const src = read('image-slot.js');
  const needle = "'  -webkit-user-drag:none;user-select:none;touch-action:none}' +";
  // Newer Claude Design exports already allow touch scrolling; only patch the old rule.
  fs.writeFileSync(path.join(OUT, 'image-slot.js'), src.includes(needle) ? src.replace(needle, "'  -webkit-user-drag:none;user-select:none}' +") : src);
}
fs.copyFileSync(path.join(ROOT, 'build', 'mobile.css'), path.join(OUT, 'mobile.css'));
for (const f of ['assets', 'support.js', 'image-manifest.json', 'ProductCard.dc.html', '.nojekyll']) {
  if (fs.existsSync(path.join(ROOT, f))) copy(f);
}

// Search index with clean URLs.
const si = read('search-index.js').replace(/"h":"([^"]*)"/g, (all, h) => {
  const c = legacyToClean(h);
  return c ? `"h":"${c}"` : all;
});
fs.writeFileSync(path.join(OUT, 'search-index.js'), si);

// Runtime: rewrites any legacy link the page renders dynamically.
const runtime = `/* generated by build/build.mjs */
(function(){
var B=${JSON.stringify(BASE)},M=${JSON.stringify(linkMap)};
function look(k){return M[k]!==undefined?B+M[k]:null;}
function clean(h){
  if(h==null||h==='')return h;
  if(/^(https?:|mailto:|tel:|javascript:|data:|\\/)/i.test(h))return h;
  var k=h;try{k=decodeURIComponent(h);}catch(e){}
  k=k.replace(/^\\.\\//,'');
  if(k.charAt(0)==='#'){
    if(k.length>1){var p=window.__PAGE||'';var r=look(p+'.dc.html'+k)||look('Category.dc.html'+k)||look('Product.dc.html'+k);if(r)return r;}
    return location.pathname+k;
  }
  var m=k.match(/^([A-Za-z ]+\\.dc\\.html)(#.*)?$/);
  if(m){return look(m[1]+(m[2]||''))||look(m[1])||h;}
  return h;
}
window.__cleanUrl=clean;
function fix(el){
  if(!el||el.nodeType!==1)return;
  if(el.tagName==='A'&&el.hasAttribute('href')){var v=el.getAttribute('href'),n=clean(v);if(n!==v)el.setAttribute('href',n);}
  if(el.hasAttribute('data-href')){var d=el.getAttribute('data-href'),e=clean(d);if(e!==d)el.setAttribute('data-href',e);}
}
function scan(n){if(!n||n.nodeType!==1)return;fix(n);n.querySelectorAll('a[href],[data-href]').forEach(fix);}
new MutationObserver(function(ms){ms.forEach(function(m){if(m.type==='attributes')fix(m.target);else m.addedNodes.forEach(scan);});})
  .observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['href','data-href']});
})();
`;
fs.writeFileSync(path.join(OUT, 'routes.js'), runtime);

// Pages. GitHub Pages serves /foo from foo.html, so URLs need no trailing slash.
const srcCache = {};
const srcOf = page => srcCache[page] ??= read(page + '.dc.html');
for (const [clean, { page, hash }] of routes) {
  const file = clean === '' ? 'index.html' : clean + '.html';
  const dst = path.join(OUT, file);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, transformPage(srcOf(page), page, hash));
}

// Old .dc.html URLs redirect to their clean equivalents.
const redirect = (page) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Redirecting…</title>
<script>(function(){var B=${JSON.stringify(BASE)},M=${JSON.stringify(linkMap)},p=${JSON.stringify(page + '.dc.html')},h=location.hash;
var t=M[p+h]!==undefined?M[p+h]:(M[p]!==undefined?M[p]:'');location.replace(B+t);})();</script>
<link rel="canonical" href="${BASE}${linkMap[page + '.dc.html'] ?? ''}"></head><body><a href="${BASE}${linkMap[page + '.dc.html'] ?? ''}">Continue</a></body></html>`;
for (const [, page] of STATIC) fs.writeFileSync(path.join(OUT, page + '.dc.html'), redirect(page));
for (const page of ['Category', 'Product']) fs.writeFileSync(path.join(OUT, page + '.dc.html'), redirect(page));

// 404 page sends visitors home.
fs.writeFileSync(path.join(OUT, '404.html'), `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Page not found</title><meta http-equiv="refresh" content="3; url=${BASE}"></head><body style="font-family:sans-serif;padding:40px">Page not found. <a href="${BASE}">Go to the home page</a>.</body></html>`);

// Sitemap.
const today = new Date().toISOString().slice(0, 10);
const urls = [...routes.keys()].filter(r => r !== 'cart').map(r => `  <url><loc>https://lunad-external.github.io${BASE}${r}</loc><lastmod>${today}</lastmod></url>`);
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);

// Route list for review.
fs.writeFileSync(path.join(OUT, 'routes.txt'), [...routes.entries()].map(([r, v]) => `${BASE}${r}\t${v.page}${v.hash ? ' #' + v.hash : ''}`).join('\n') + '\n');
console.log(`Built ${routes.size} pages into _site/`);

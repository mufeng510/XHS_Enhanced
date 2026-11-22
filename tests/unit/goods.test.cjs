'use strict';
// Unit tests for the goods-detail (商品详情页) HD image download feature.
// The bundle is vm-loaded like the other suites; pure helpers come from
// __XHS_ENHANCED_TEST_API__. DOM/panel behavior is covered by the browser
// harness (tests/browser/harness.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(pathname = '/goods-detail/685d0fe3c16548001691655c', extras) {
  const context = {
    console,
    location: { pathname, href: 'https://www.xiaohongshu.com' + pathname },
    __XHS_ENHANCED_TEST_MODE__: true,
    atob: value => Buffer.from(String(value), 'base64').toString('binary'),
    btoa: value => Buffer.from(String(value), 'binary').toString('base64'),
    TextEncoder,
    Uint8Array,
    ArrayBuffer,
    URL,
    URLSearchParams
  };
  if (extras) Object.assign(context, extras);
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync('extension/content.js', 'utf8'), context);
  return context.__XHS_ENHANCED_TEST_API__;
}

const IMG_A = 'https://sns-webpic-qc.xhscdn.com/20261113/tt/1040g2AAA000000000000000000000000000000001!nd_dft_wlteh_webp_3';
const IMG_B = 'https://fe-img-qc.xhscdn.com/20261113/tt/1040g2BBB000000000000000000000000000000002?imageView2/2/w/540/format/webp';
const IMG_B_HD = 'https://fe-img-qc.xhscdn.com/20261113/tt/1040g2BBB000000000000000000000000000000002?imageView2/2/w/1080/format/webp';

test('route predicate matches only goods-detail pages', () => {
  const api = load();
  assert.equal(api.isGoodsDetailRoute('/goods-detail/685d0fe3c16548001691655c'), true);
  assert.equal(api.isGoodsDetailRoute('https://www.xiaohongshu.com/goods-detail/685d0fe3c16548001691655c?xsec_token=abc'), true);
  assert.equal(api.isGoodsDetailRoute('/goods-detail/'), false);
  assert.equal(api.isGoodsDetailRoute('/goods-detail'), false);
  assert.equal(api.isGoodsDetailRoute('/explore/685d0fe3c16548001691655c'), false);
  assert.equal(api.isGoodsDetailRoute('/search_result'), false);
  assert.equal(api.isGoodsDetailRoute(''), false);
  assert.equal(api.getGoodsIdFromHref('/goods-detail/685d0fe3c16548001691655c?xsec_token=z'), '685d0fe3c16548001691655c');
  assert.equal(api.getGoodsIdFromHref('/goods-detail/'), '');
});

test('html text scan extracts CDN urls, unescapes \\u002F and trims punctuation', () => {
  const api = load();
  const html = '{"a":"https:\\u002F\\u002Fsns-webpic-qc.xhscdn.com\\u002F20261113\\u002Ftt\\u002F1040g2AAA000000000000000000000000000000001!nd_dft_wlteh_webp_3",'
    + '"b":"https://fe-img-qc.xhscdn.com/base/BBB?imageView2/2/w/540/format/webp,",'
    + '"c":"https://example.com/not-xhs.png",'
    + '"d":"notaurl"}';
  const urls = api.extractUrlsFromText(html);
  assert(urls.some(u => u.includes('sns-webpic-qc.xhscdn.com/20261113/tt/1040g2AAA')), 'escaped url unescaped and extracted');
  assert(urls.some(u => u === 'https://fe-img-qc.xhscdn.com/base/BBB?imageView2/2/w/540/format/webp'), 'trailing comma trimmed');
  assert(!urls.some(u => u.includes('example.com')) || urls.includes('https://example.com/not-xhs.png'), 'non-xhs url may appear in raw extraction but is filtered later');
  assert(!urls.some(u => u.includes('notaurl')), 'plain text is not a url');
});

test('goods image url filter rejects static assets, keeps images, honors decorations flag', () => {
  const api = load();
  assert.equal(api.looksLikeGoodsImageUrl(IMG_A), true);
  assert.equal(api.looksLikeGoodsImageUrl(IMG_B), true);
  assert.equal(api.looksLikeGoodsImageUrl('https://fe-static.xhscdn.com/formula-static/goods-detail/public/js/main.d4927ba.js'), false);
  assert.equal(api.looksLikeGoodsImageUrl('https://fe-static.xhscdn.com/formula-static/goods-detail/public/css/allStyle.css'), false);
  assert.equal(api.looksLikeGoodsImageUrl('https://fe-img-qc.xhscdn.com/base/font.woff2'), false);
  assert.equal(api.looksLikeGoodsImageUrl('https://sns-avatar-qc.xhscdn.com/avatar/1040g2AAA000000000000000000000000000000004'), false);
  assert.equal(api.looksLikeGoodsImageUrl('https://sns-avatar-qc.xhscdn.com/avatar/1040g2AAA000000000000000000000000000000004', { includeDecorations: true }), true);
  assert.equal(api.looksLikeGoodsImageUrl('https://example.com/image.png'), false);
  assert.equal(api.looksLikeGoodsImageUrl('http://sns-webpic-qc.xhscdn.com/base/AAA'), true); // http kept for completeness
  assert.equal(api.isXhsImageCdnUrl(IMG_A), true);
  assert.equal(api.isXhsImageCdnUrl('https://fe-static.xhscdn.com/x.js'), true); // host-level check only; asset filter lives in looksLikeGoodsImageUrl
  assert.equal(api.isXhsImageCdnUrl('https://example.com/x.png'), false);
});

test('canonical key collapses same-image variants; dedupe keeps highest quality', () => {
  const api = load();
  const k1 = api.canonicalGoodsImageKey(IMG_B);
  const k2 = api.canonicalGoodsImageKey(IMG_B_HD);
  assert.equal(k1, k2, 'same base with different imageView2 widths collapse');
  const deduped = api.dedupeGoodsImages([IMG_B, IMG_B_HD, IMG_A]);
  assert.equal(deduped.length, 2);
  assert(deduped.some(u => u === IMG_B_HD), 'wider imageView2 candidate wins');
  const master = 'https://sns-webpic-qc.xhscdn.com/20261113/tt/1040g2AAA000000000000000000000000000000001!nd_dft_wlteh_webp_3';
  const derivative = master + '?imageView2/2/w/540/format/webp';
  const deduped2 = api.dedupeGoodsImages([derivative, master]);
  assert(deduped2.includes(master), '!nd_ master wins over imageView2 derivative');
  assert(!api.dedupeGoodsImages(['https://example.com/a.png']).length, 'non-cdn urls are dropped');
});

test('toHDGoodsUrl rewrites query per mode and survives junk input', () => {
  const api = load();
  const src = 'https://sns-webpic-qc.xhscdn.com/tt/1040g2AAA!nd_dft_wlteh_webp_3?imageView2/2/w/540/format/webp&x=1';
  assert.equal(api.toHDGoodsUrl(src, 'png'), 'https://sns-webpic-qc.xhscdn.com/tt/1040g2AAA!nd_dft_wlteh_webp_3?imageView2/2/format/png');
  assert.equal(api.toHDGoodsUrl(src, 'jpeg'), 'https://sns-webpic-qc.xhscdn.com/tt/1040g2AAA!nd_dft_wlteh_webp_3?imageView2/2/format/jpeg/q/90');
  assert.equal(api.toHDGoodsUrl(src, 'original'), 'https://sns-webpic-qc.xhscdn.com/tt/1040g2AAA!nd_dft_wlteh_webp_3');
  assert.equal(api.toHDGoodsUrl('not a url', 'png'), 'not a url');
  assert.equal(api.toHDGoodsUrl('', 'png'), '');
});

test('collectGoodsImageEntries merges dom+text, filters, dedupes and keeps sections', () => {
  const api = load();
  const dom = [
    { url: IMG_B, section: 'main' },
    { url: 'https://fe-static.xhscdn.com/formula-static/goods-detail/public/css/allStyle.css', section: 'main' }
  ];
  const text = [IMG_A, IMG_B, 'https://sns-avatar-qc.xhscdn.com/avatar/1040g2AAA000000000000000000000000000000004'];
  const out = api.collectGoodsImageEntries(dom, text, {});
  assert.equal(out.length, 2, 'css and avatar dropped, duplicate base collapsed');
  const a = out.find(e => e.url === IMG_A);
  const b = out.find(e => e.url === IMG_B);
  assert(a && a.section === 'other', 'text-scanned url defaults to other section');
  assert(b && b.section === 'main', 'dom section preserved for the winning candidate');
  const withDecor = api.collectGoodsImageEntries(dom, text, { includeDecorations: true });
  assert.equal(withDecor.length, 3, 'avatar kept when decorations are included');
  // other → known section upgrade on merge
  const upgraded = api.collectGoodsImageEntries([{ url: IMG_A, section: 'detail' }], [IMG_A], {});
  assert.equal(upgraded[0].section, 'detail', 'other section upgrades to a known section');
  // classify by container class names (fake nodes: real DOM covered by harness)
  assert.equal(api.classifyGoodsSection(null), 'other');
  const fakeNode = (closestMap, doc) => ({ closest: sel => closestMap[sel] || null, compareDocumentPosition: () => 0, ownerDocument: doc });
  assert.equal(api.classifyGoodsSection(fakeNode({ '[class*="graphic-detail"]': {} })), 'detail');
  assert.equal(api.classifyGoodsSection(fakeNode({ '[class*="layout-swiper"], [class*="layout-slide"], [class*="swiper"], [class*="scroll-x"]': {} })), 'main');
  assert.equal(api.classifyGoodsSection(fakeNode({})), 'main', 'page without the graphic-detail boundary falls back to main');
  const counts = api.countGoodsSections([{ section: 'main' }, { section: 'main' }, { section: 'detail' }, { section: 'other' }, {}]);
  assert.equal(counts.main, 2);
  assert.equal(counts.detail, 1);
  assert.equal(counts.other, 2);
  assert.equal(api.normalizeGoodsSection('detail'), 'detail');
  assert.equal(api.normalizeGoodsSection('junk'), 'other');
  assert.deepEqual(api.GOODS_SECTION_LABELS.main, '主图');
});

test('zip naming, entry naming, info text and mime extension mapping', () => {
  const api = load();
  const name = api.buildGoodsZipFileName(new Date(2026, 10, 14, 15, 30), 12, '685d0fe3c16548001691655c');
  assert.equal(name, '小红书商品高清图_685d0fe3c16548001691655c_20261114_1530_12张.zip');
  const split = api.buildGoodsZipFileName(new Date(2026, 10, 14, 15, 30), 12, '685d0fe3c16548001691655c', 1, 2);
  assert.equal(split, '小红书商品高清图_685d0fe3c16548001691655c_20261114_1530_12张_part2.zip');
  const badDate = api.buildGoodsZipFileName('nope', 3, '');
  assert.match(badDate, /^小红书商品高清图_unknown_\d{8}_\d{4}_3张\.zip$/);
  assert.equal(api.buildGoodsImageFileName(0, 'PNG'), '01.png');
  assert.equal(api.buildGoodsImageFileName(11, '.jpeg!'), '12.jpeg');
  assert.equal(api.buildGoodsImageFileName(2, '***'), '03.png');
  assert.equal(api.buildGoodsImageFileName(0, 'png', 'main'), '主图_01.png');
  assert.equal(api.buildGoodsImageFileName(3, 'webp', 'detail'), '详情图_04.webp');
  assert.equal(api.buildGoodsImageFileName(1, 'png', 'other'), '其它_02.png');
  assert.equal(api.buildGoodsImageFileName(0, 'png', 'bogus'), '其它_01.png');
  assert.equal(api.extensionForMime('image/jpeg'), 'jpg');
  assert.equal(api.extensionForMime('IMAGE/PNG'), 'png');
  assert.equal(api.extensionForMime('image/webp; charset=binary'), 'webp');
  assert.equal(api.extensionForMime(''), 'png');
  assert.equal(api.extensionForMime('', 'jpg'), 'jpg');
  const info = api.buildGoodsInfoText({ pageUrl: 'https://www.xiaohongshu.com/goods-detail/abc', goodsId: 'abc', title: '某商品', scannedAt: '2026/11/14 15:30', count: 5, mode: 'png', sections: { main: 3, detail: 2, other: 0 } });
  assert(info.includes('某商品') && info.includes('https://www.xiaohongshu.com/goods-detail/abc') && info.includes('图片数量：5') && info.includes('高清 PNG'), 'info.txt carries product metadata');
  assert(info.includes('分区：主图 3 张，详情图 2 张'), 'info.txt carries section breakdown');
});

test('batch layout defaults to flat when unset; explicit notes round-trips', () => {
  const api = load();
  // Empty store (no BATCH_LAYOUT_KEY) -> default flat.
  assert.equal(api.readStoredBatchLayout({ getItem: () => null }), 'flat');
  // Unreadable storage -> default flat.
  assert.equal(api.readStoredBatchLayout({ getItem() { throw new Error('blocked'); } }), 'flat');
  // Explicit values round-trip.
  assert.equal(api.readStoredBatchLayout({ getItem: () => 'notes' }), 'notes');
  assert.equal(api.readStoredBatchLayout({ getItem: () => 'flat' }), 'flat');
  // Junk degrades to the flat default rather than notes.
  assert.equal(api.readStoredBatchLayout({ getItem: () => 'nonsense' }), 'flat');
});

test('SKU section helpers classify, count, dedupe and name per spec', () => {
  const api = load();
  assert.equal(api.normalizeGoodsSection('sku'), 'sku');
  assert.equal(api.normalizeGoodsSection('main'), 'main');
  assert.equal(api.normalizeGoodsSection('bogus'), 'other');
  assert.deepEqual(api.GOODS_SECTION_LABELS.sku, 'SKU 图');
  const counts = api.countGoodsSections([
    { section: 'main' }, { section: 'detail' }, { section: 'sku' }, { section: 'sku' }, { section: 'other' }
  ]);
  assert.equal(counts.main, 1);
  assert.equal(counts.detail, 1);
  assert.equal(counts.sku, 2);
  assert.equal(counts.other, 1);

  const skuA = 'https://mall-i1.xhscdn.com/arkgoods/1040g3ng326sbj0dkk4a05phq89shol8ue0tjuj8?imageView2/2/w/1080/format/webp/q/80';
  const skuB = 'https://mall-i1.xhscdn.com/arkgoods/1040g3ng3272jofqe6i705phq89shol8uid1b8og';
  const deduped = api.dedupeSkuEntries([
    { url: skuA, skuName: '原创红色小羊' },
    { url: skuA, skuName: '原创红色小羊' }, // 同规格同图 → 折叠
    { url: skuA + '&ap=3', skuName: '原创红色小羊' }, // query 不同仍折叠
    { url: skuB, skuName: '原创白色小羊' }, // 不同规格同主机 → 保留
    { url: 'https://fe-static.xhscdn.com/formula-static/goods-detail/public/js/main.js', skuName: 'x' },
    { url: skuA, skuName: '' }
  ]);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].section, 'sku');
  assert.equal(deduped[0].skuName, '原创红色小羊');
  assert.equal(deduped[1].skuName, '原创白色小羊');

  const n1 = api.buildGoodsSkuImageFileName('原创红色小羊', 0, 'jpg');
  assert.equal(n1, 'SKU_原创红色小羊_01.jpg');
  assert.equal(api.buildGoodsSkuImageFileName('原创红色小羊【新年限定】', 1, 'png'), 'SKU_原创红色小羊【新年限定】_02.png');
  assert.equal(api.buildGoodsSkuImageFileName('a/b?c*d', 0, 'jpeg'), 'SKU_a b c d_01.jpeg');
  assert.ok(api.buildGoodsSkuImageFileName('规格', 0, '').endsWith('_01.jpg'));
  const long = api.buildGoodsSkuImageFileName('x'.repeat(60), 0, 'jpg');
  assert.ok(long.startsWith('SKU_') && long.length < 60, 'spec name is truncated');

  const info = api.buildGoodsInfoText({
    pageUrl: 'u', goodsId: 'g', title: 't', scannedAt: 'now', count: 7, mode: 'png',
    sections: { main: 1, detail: 1, sku: 4, other: 1 },
    skus: [
      { name: '原创红色小羊', file: 'SKU_原创红色小羊_01.jpg' },
      { name: '原创白色小羊', file: 'SKU_原创白色小羊_01.jpg' }
    ]
  });
  assert(info.includes('SKU 图 4 张'), 'info.txt reports SKU count');
  assert(info.includes('SKU 规格：') && info.includes('原创红色小羊 → SKU_原创红色小羊_01.jpg'), 'info.txt maps spec → file');
});

test('detail-image slice planner and SKU compression limit', () => {
  const api = load();
  const MB = 1024 * 1024;
  assert.equal(api.shouldCompressGoodsImage('sku', 4 * MB, true), true, 'SKU images obey the same 3MB limit');
  assert.equal(api.shouldCompressGoodsImage('sku', 2 * MB, true), false);
  assert.equal(api.shouldCompressGoodsImage('detail', 4 * MB, true), false, 'detail images are not size-compressed');
  assert.equal(api.GOODS_DETAIL_SLICE_HEIGHT, 1500);

  const pairs = api.planDetailImageGroups([
    { section: 'main' },
    { section: 'detail', width: 2000, height: 1500 },
    { section: 'detail', width: 2000, height: 500 },
    { section: 'detail', width: 1320, height: 1500 },
    { section: 'detail', width: 1320, height: 175 },
    { section: 'sku' }
  ]);
  // vm 跨 realm 的数组不能用 deepStrictEqual 直接比；逐组检查下标。
  assert.equal(pairs.length, 4);
  assert.deepEqual(Array.from(pairs[0]), [0]);
  assert.deepEqual(Array.from(pairs[1]), [1, 2]);
  assert.deepEqual(Array.from(pairs[2]), [3, 4]);
  assert.deepEqual(Array.from(pairs[3]), [5]);
  // 宽度不同 / 第二段不是更短 / 非切片高度 → 不拼接
  const noPair = api.planDetailImageGroups([
    { section: 'detail', width: 2000, height: 1500 },
    { section: 'detail', width: 1800, height: 500 },
    { section: 'detail', width: 2000, height: 1500 },
    { section: 'detail', width: 2000, height: 1500 },
    { section: 'detail', width: 2000, height: 900 }
  ]);
  assert.equal(noPair.length, 4, 'only the genuine 1500+900 pair merges; width/equal-height pairs do not');
  assert.deepEqual(Array.from(noPair[3]), [3, 4]);

  const info = api.buildGoodsInfoText({
    pageUrl: 'u', goodsId: 'g', title: 't', scannedAt: 'now', count: 5, mode: 'png',
    stitched: 2,
    compressMain: { enabled: true, compressed: 1, failed: 0, oversize: 0 },
    compressSku: { enabled: true, compressed: 3, failed: 1, oversize: 1 }
  });
  assert(info.includes('SKU 图压缩：开启') && info.includes('已压缩 3 张'), 'info.txt reports SKU compression');
  assert(info.includes('详情图拼接：2 组'), 'info.txt reports stitched detail groups');
});

test('main-image compression planner respects toggle, section and size limit', () => {
  const api = load();
  const MB = 1024 * 1024;
  assert.equal(api.GOODS_COMPRESS_MAX_BYTES, 3 * MB);
  assert.deepEqual(Array.from(api.JPEG_QUALITY_LADDER), [0.85, 0.75, 0.65, 0.55, 0.45]);
  assert.equal(api.SCALE_DOWN_FACTOR, 0.85);
  assert.equal(api.SCALE_DOWN_MIN, 0.35);
  assert.equal(api.shouldCompressGoodsImage('main', 4 * MB, true), true);
  assert.equal(api.shouldCompressGoodsImage('main', 3 * MB, true), false, 'exactly 3MB is within the limit');
  assert.equal(api.shouldCompressGoodsImage('main', 2 * MB, true), false);
  assert.equal(api.shouldCompressGoodsImage('detail', 4 * MB, true), false, 'only main images are compressed');
  assert.equal(api.shouldCompressGoodsImage('other', 4 * MB, true), false);
  assert.equal(api.shouldCompressGoodsImage('main', 4 * MB, false), false, 'toggle off disables compression');
  assert.equal(api.shouldCompressGoodsImage('main', 0, true), false);
  assert.equal(api.shouldCompressGoodsImage('main', NaN, true), false);
  { const d = api.scaledDimensions(2000, 1000, 0.5); assert.equal(d.width, 1000); assert.equal(d.height, 500); }
  { const d = api.scaledDimensions(1, 1, 0.1); assert.equal(d.width, 1); assert.equal(d.height, 1); }
  { const d = api.scaledDimensions(2000, 1000, NaN); assert.equal(d.width, 2000); assert.equal(d.height, 1000); }
  const info = api.buildGoodsInfoText({ pageUrl: 'u', goodsId: 'g', title: 't', scannedAt: 'now', count: 3, mode: 'png', compressMain: { enabled: true, compressed: 2, failed: 1, oversize: 1 } });
  assert(info.includes('主图压缩：开启') && info.includes('已压缩 2 张') && info.includes('无法解码 1 张'), 'info.txt reports compression stats');
  const infoOff = api.buildGoodsInfoText({ pageUrl: 'u', goodsId: 'g', title: 't', scannedAt: 'now', count: 1, mode: 'png', compressMain: { enabled: false, compressed: 0, failed: 0, oversize: 0 } });
  assert(infoOff.includes('主图压缩：关闭'), 'info.txt shows disabled state');
});

test('goods title parser strips the 小红书 suffix/prefix', () => {
  const api = load();
  assert.equal(api.getGoodsTitleFromDocument({ title: '某品牌保温杯 - 小红书' }), '某品牌保温杯');
  assert.equal(api.getGoodsTitleFromDocument({ title: '小红书 - 某品牌保温杯' }), '某品牌保温杯');
  assert.equal(api.getGoodsTitleFromDocument({ title: '' }), '');
  assert.equal(api.getGoodsTitleFromDocument(null), '');
});

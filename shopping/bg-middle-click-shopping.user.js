// ==UserScript==
// @name         商品画像をホイールクリックでバックグラウンドタブへ (Amazon / SHEIN)
// @namespace    https://chatgpt.com/userscripts/
// @version      1.0.0
// @description  Amazon・SHEINの商品画像／商品カードをホイールクリックして、元のページを残したまま背景タブで開きます。
// @match        https://www.amazon.co.jp/*
// @match        https://amazon.co.jp/*
// @match        https://*.amazon.co.jp/*
// @match        https://*.shein.com/*
// @run-at       document-start
// @noframes
// @grant        GM_openInTab
// ==/UserScript==

(() => {
  'use strict';

  const host = location.hostname.toLowerCase();
  const isAmazon = host === 'amazon.co.jp' || host.endsWith('.amazon.co.jp');
  const isShein = host.endsWith('.shein.com');
  if (!isAmazon && !isShein) return;

  const EXCLUDE = 'button, input, select, textarea, [contenteditable="true"], [role="button"], [class*="wishlist"], [class*="favorite"], [class*="quick-add"], [class*="quickAdd"]';
  const SHEIN_CARD = [
    '.S-product-item', '.S-product-card', '.product-card', '.product-item',
    '[class*="product-card"]', '[class*="productCard"]',
    '[class*="product-item"]', '[class*="productItem"]',
    '[class*="goods-item"]', '[class*="goodsItem"]',
    '[data-goods-id]', '[data-goods_id]', '[data-goodsid]'
  ].join(',');
  const AMAZON_ASIN = /^[A-Z0-9]{10}$/i;
  const AMAZON_PRODUCT = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i;
  const SHEIN_PRODUCT = /-p-\d{4,}(?:\.html|[-/?#]|$)/i;

  function absoluteUrl(raw) {
    if (typeof raw !== 'string') return null;
    let value = raw.trim().replace(/&amp;/gi, '&');
    if (!value || /^(?:#|javascript:|data:|blob:)/i.test(value)) return null;
    if (/^https?%3a/i.test(value)) {
      try { value = decodeURIComponent(value); } catch (_) { return null; }
    }
    try {
      const url = new URL(value, location.href);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
      if (isAmazon && !(url.hostname === 'amazon.co.jp' || url.hostname.endsWith('.amazon.co.jp'))) return null;
      if (isShein && !url.hostname.endsWith('.shein.com')) return null;
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function productLink(raw, platform) {
    const url = absoluteUrl(raw);
    if (!url) return null;
    let parsed;
    try { parsed = new URL(url); } catch (_) { return null; }
    if (platform === 'amazon') return AMAZON_PRODUCT.test(parsed.pathname) ? url : null;
    return SHEIN_PRODUCT.test(parsed.pathname) ? url : null;
  }

  function ancestorLink(target) {
    const a = target.closest('a[href]');
    return a ? a.getAttribute('href') : null;
  }

  function amazonUrl(target) {
    const directHref = ancestorLink(target);
    const directProduct = productLink(directHref, 'amazon');
    if (directProduct) return directProduct;

    // A separate, valid link (e.g. store, review, category) must keep its native behavior.
    if (absoluteUrl(directHref)) return null;

    const card = target.closest('[data-asin], [data-component-type="s-search-result"]');
    if (!card) return null;

    const asin = (card.getAttribute('data-asin') || '').trim();
    if (!AMAZON_ASIN.test(asin)) return null;
    if (target.closest(EXCLUDE)) return null;

    // Only an image, a product-title, a card, or a click-enabled element.
    const isProductArea = !!target.closest('img, picture, a, h2, h3, [role="link"], [class*="image"], [class*="title"], [class*="product"]');
    if (!isProductArea && target !== card) return null;
    return `https://www.amazon.co.jp/dp/${asin.toUpperCase()}`;
  }

  function readSheinId(node, allowGenericId) {
    if (!(node instanceof Element)) return null;
    const names = [
      'data-goods-id', 'data-goods_id', 'data-goodsid',
      'data-product-id', 'data-product_id', 'data-productid'
    ];
    if (allowGenericId) names.push('data-id');
    for (const name of names) {
      const val = node.getAttribute(name);
      if (val && /^\d{4,15}$/.test(val.trim())) return val.trim();
    }
    return null;
  }

  function sheinUrl(target) {
    const directHref = ancestorLink(target);
    const directProduct = productLink(directHref, 'shein');
    if (directProduct) return directProduct;

    // Other real links (categories, promos, etc.) are not product links.
    if (absoluteUrl(directHref)) return null;
    if (target.closest(EXCLUDE)) return null;

    let card = target.closest(SHEIN_CARD);
    if (!card) {
      // Some SHEIN layouts place a goods ID on an unclassified parent.
      let cur = target;
      for (let depth = 0; cur && depth < 7; depth++, cur = cur.parentElement) {
        if (readSheinId(cur, false)) { card = cur; break; }
      }
    }
    if (!card) return null;

    // Prefer a real, complete product URL from the existing card.
    const links = card.querySelectorAll('a[href]');
    for (const anchor of links) {
      const match = productLink(anchor.getAttribute('href'), 'shein');
      if (match) return match;
    }

    const URL_ATTRIBUTES = [
      'data-url', 'data-href', 'data-link', 'data-product-url',
      'data-goods-url', 'data-goods_url', 'data-product-link'
    ];
    let node = target;
    while (node && card.contains(node)) {
      for (const attr of URL_ATTRIBUTES) {
        const match = productLink(node.getAttribute(attr), 'shein');
        if (match) return match;
      }
      if (node === card) break;
      node = node.parentElement;
    }
    for (const attr of URL_ATTRIBUTES) {
      const match = productLink(card.getAttribute(attr), 'shein');
      if (match) return match;
    }

    // SHEIN product URLs normally have the form .../Product-p-GOODS_ID.html.
    // Do NOT use a bare SKU or arbitrary ID from an unrelated element.
    let goodsId = readSheinId(card, true);
    if (!goodsId) {
      let el = target;
      while (el && card.contains(el)) {
        goodsId = readSheinId(el, false);
        if (goodsId || el === card) break;
        el = el.parentElement;
      }
    }
    if (!goodsId) return null;
    const sheinDomain = host === 'm.shein.com' ? 'jp.shein.com' : host;
    return `https://${sheinDomain}/Product-p-${goodsId}.html`;
  }

  function targetUrl(event) {
    if (event.button !== 1 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
    const target = event.target;
    if (!(target instanceof Element)) return null;
    return isAmazon ? amazonUrl(target) : sheinUrl(target);
  }

  // Catch the site's own middle-mouse handlers early without changing left/right clicks.
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    document.addEventListener(type, event => {
      if (!targetUrl(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  document.addEventListener('auxclick', event => {
    const url = targetUrl(event);
    if (!url) return;   // Leave unknown targets untouched.
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      GM_openInTab(url, { active: false, insert: true, setParent: true });
    } catch (error) {
      console.error('[BG Middle Click] Could not open a background tab:', error);
    }
  }, true);
})();

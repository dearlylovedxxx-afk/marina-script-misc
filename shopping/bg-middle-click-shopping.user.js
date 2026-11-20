// ==UserScript==
// @name         商品画像をホイールクリックでバックグラウンドタブへ (Amazon / SHEIN)
// @namespace    https://chatgpt.com/userscripts/
// @version      1.1.0
// @description  Amazon・SHEINの商品画像／商品カードをホイールクリックして、元のページを残したまま背景タブで開きます。
// @match        https://www.amazon.co.jp/*
// @match        https://amazon.co.jp/*
// @match        https://*.amazon.co.jp/*
// @match        https://*.shein.com/*
// @updateURL    https://raw.githubusercontent.com/dearlylovedxxx-afk/marina-script-misc/main/shopping/bg-middle-click-shopping.user.js
// @downloadURL  https://raw.githubusercontent.com/dearlylovedxxx-afk/marina-script-misc/main/shopping/bg-middle-click-shopping.user.js
// @run-at       document-start
// @noframes
// @grant        GM_openInTab
// ==/UserScript==

(() => {
  'use strict';

  const host = location.hostname.toLowerCase();
  const isAmazon = host === 'amazon.co.jp' || host.endsWith('.amazon.co.jp');
  const isShein = host === 'shein.com' || host.endsWith('.shein.com');
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
      if (isShein && !(url.hostname === 'shein.com' || url.hostname.endsWith('.shein.com'))) return null;
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
    // Ordinary links already support native middle-click; do not interfere.
    if (absoluteUrl(directHref)) return null;
    if (target.closest(EXCLUDE)) return null;

    // SHEIN uses <a href="javascript:void(0)" data-id="GOODS_ID" ...>
    // for image links. The data-id is on the ANCHOR, not necessarily the card.
    const clickedLink = target.closest('a[data-id], a[data-goods-id], a[data-goods_id], a[data-goodsid]');
    const looksLikeProduct = clickedLink && (
      clickedLink.matches('[data-spu], [data-sku], [data-title]') ||
      /(?:S-product-card|product-item-img|goods-item-img|goods-card|product-image)/i.test(clickedLink.className || '')
    );
    if (looksLikeProduct) {
      const id = readSheinId(clickedLink, true);
      if (id) return sheinProductUrl(id);
    }

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

    // The ID may live on an inner image anchor (common on SHEIN).
    const innerProductLink = card.querySelector(
      'a[data-id][data-spu], a[data-id][data-sku], a[data-id][class*="product-card"], a[data-goods-id], a[data-goods_id]'
    );
    let goodsId = readSheinId(innerProductLink, true) || readSheinId(card, true);
    if (!goodsId) {
      let el = target;
      while (el && card.contains(el)) {
        goodsId = readSheinId(el, true);
        if (goodsId || el === card) break;
        el = el.parentElement;
      }
    }
    return goodsId ? sheinProductUrl(goodsId) : null;
  }

  function sheinProductUrl(goodsId) {
    const domain = host === 'm.shein.com' ? 'jp.shein.com' : host;
    return `https://${domain}/Product-p-${goodsId}.html`;
  }

  function targetUrl(event) {
    if (event.button !== 1 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
    const target = event.target;
    if (!(target instanceof Element)) return null;
    return isAmazon ? amazonUrl(target) : sheinUrl(target);
  }

  // Open on mousedown: some sites intercept the later auxclick event.
  // Capturing on window runs before document-level page handlers.
  window.addEventListener('mousedown', event => {
    const url = targetUrl(event);
    if (!url) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      GM_openInTab(url, { active: false, insert: true, setParent: true });
    } catch (error) {
      console.error('[BG Middle Click] Failed to open a background tab:', error);
    }
  }, true);

  // Avoid native autoscroll and a duplicate site-initiated navigation.
  for (const type of ['mouseup', 'auxclick']) {
    window.addEventListener(type, event => {
      if (!targetUrl(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }
})();

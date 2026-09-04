/* assets/main-collection.js
   Consolidated script for sections/main-collection.liquid.

   This merges three files that used to be loaded separately:
     - main-collection.js   (shared mobile backdrop fixture)
     - collection-toolbar.js (tabs, sticky height, sort, mobile sort sheet)
     - collection-feed.js    (panel visibility, sub-collections carousel)
   into one file / one HTTP request. Each original module is kept in
   its own guarded block below so a missing element on the page still
   just skips that section, the same as when they were separate
   self-contained IIFEs.

   NOT merged: accordion.js and promo-carousel.js. Their contents
   haven't been shared yet, so their <script> tags in the section
   should stay as-is for now. Send those over and I'll fold them in
   too (or flag if either turns out to duplicate logic living here).

   One real behavior consolidation was made: the toolbar and the feed
   each had their own `popstate` listener independently re-reading the
   `?tab=` URL param to stay in sync. Those are merged below into a
   single popstate listener that updates the toolbar directly and
   dispatches the same `collection:tabchange` event the feed already
   listens for — one source of truth instead of two copies of the same
   URL-parsing logic. No other behavior changes were made.
*/

(function () {
  'use strict';

  // Hoisted so the single popstate listener at the bottom can reach it.
  var setActiveTab = null;

  /* ══════════════════════════════════════════════════════════
     SHARED BACKDROP
     Single overlay element used by both the mobile sort sheet
     (opened below) and the filter sidebar (opened from
     collection-filter.js). Only one overlay should ever exist in
     the DOM, so it's owned here rather than duplicated per-caller.

     Exposed as window.CollectionBackdrop = { open(onClose), close(caller) }.
     Both callers pass their own close function so open() can call it
     if a *different* caller ends up closing the backdrop first (e.g.
     clicking the backdrop itself, or opening the filter panel while
     the sort sheet is still open).
  ══════════════════════════════════════════════════════════ */
  var backdrop = document.querySelector('.collection-mobile-backdrop');

  if (backdrop) {
    (function () {
      function open(onClose) {
        backdrop.classList.add('is-visible');
        backdrop._onClose = onClose;
      }

      function close(caller) {
        backdrop.classList.remove('is-visible');
        if (typeof backdrop._onClose === 'function' && backdrop._onClose !== caller) {
          backdrop._onClose();
        }
        backdrop._onClose = null;
      }

      backdrop.addEventListener('click', function () {
        close(null);
      });

      window.CollectionBackdrop = { open: open, close: close };
    })();
  }

  /* ══════════════════════════════════════════════════════════
     TOOLBAR
     Tab switching, sticky height sync, sort dropdown, mobile
     sort sheet.
  ══════════════════════════════════════════════════════════ */
  var toolbar = document.getElementById('collection-toolbar');

  if (toolbar) {
    var collectionPage = document.querySelector('[data-collection-page]');

    var syncToolbarHeight = function () {
      document.documentElement.style.setProperty('--sticky-toolbar-height', toolbar.offsetHeight + 'px');
    };

    syncToolbarHeight();
    window.addEventListener('resize', syncToolbarHeight);

    if ('ResizeObserver' in window) {
      new ResizeObserver(syncToolbarHeight).observe(toolbar);
    }

    var tabs = toolbar.querySelectorAll('[data-tab]');

    setActiveTab = function (key) {
      tabs.forEach(function (t) {
        var on = t.dataset.tab === key;
        t.classList.toggle('tab-switcher__tab--active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
        t.setAttribute('tabindex', on ? '0' : '-1');
      });
      toolbar.dataset.activeTab = key;

      if (collectionPage) {
        collectionPage.dataset.activeTab = key;
      }
    };

    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () {
        var key = tab.dataset.tab;
        if (key === toolbar.dataset.activeTab) return;

        setActiveTab(key);

        var url = new URL(window.location.href);
        url.searchParams.set('tab', key);
        url.hash = '';
        history.pushState({ tab: key }, '', url.toString());

        document.dispatchEvent(new CustomEvent('collection:tabchange', { detail: { tab: key } }));
      });

      tab.addEventListener('keydown', function (e) {
        var next;
        if (e.key === 'ArrowRight') next = tabs[i + 1] || tabs[0];
        if (e.key === 'ArrowLeft')  next = tabs[i - 1] || tabs[tabs.length - 1];
        if (next) {
          next.focus();
          next.click();
        }
      });
    });

    var sortSelect = toolbar.querySelector('[data-sort]');
    if (sortSelect) {
      sortSelect.addEventListener('change', function () {
        var url = new URL(window.location.href);
        url.searchParams.set('sort_by', sortSelect.value);
        window.location.href = url.toString();
      });
    }

    // .collection-mobile-bar (which holds this button) is a sibling of
    // #collection-toolbar in the markup, not a descendant, so it must be
    // queried at the document level rather than scoped to `toolbar`.
    var mobileSortBtn = document.querySelector('[data-mobile-sort-toggle]');

    if (mobileSortBtn) {
      var sortSheet = null;
      var scrollY = 0;

      var buildSortSheet = function () {
        var sheet = document.createElement('div');
        sheet.className = 'mobile-sort-sheet';
        sheet.setAttribute('role', 'dialog');
        sheet.setAttribute('aria-modal', 'true');
        sheet.setAttribute('aria-label', 'Sort options');

        var inner = '<div class="mobile-sort-sheet__header">';
        inner += '<span class="mobile-sort-sheet__title">Sort by</span>';
        inner += '<button type="button" class="mobile-sort-sheet__close-btn" aria-label="Close sort options" data-sort-close>&times;</button>';
        inner += '</div>';
        inner += '<div class="mobile-sort-sheet__inner">';
        inner += '<ul class="mobile-sort-sheet__list">';

        if (sortSelect) {
          Array.from(sortSelect.options).forEach(function (opt) {
            var active = opt.selected ? ' mobile-sort-sheet__option--active' : '';
            inner +=
              '<li><button class="mobile-sort-sheet__option' + active + '" type="button" ' +
              'data-sort-value="' + opt.value + '">' + opt.text + '</button></li>';
          });
        }

        inner += '</ul></div>';
        sheet.innerHTML = inner;

        sheet.querySelectorAll('[data-sort-value]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var url = new URL(window.location.href);
            url.searchParams.set('sort_by', btn.dataset.sortValue);
            window.location.href = url.toString();
          });
        });

        var closeBtn = sheet.querySelector('[data-sort-close]');
        if (closeBtn) {
          closeBtn.addEventListener('click', function () {
            closeSortSheet();
            mobileSortBtn.focus();
          });
        }

        document.body.appendChild(sheet);
        return sheet;
      };

      // iOS Safari ignores `overflow: hidden` on the body while a touch
      // scroll is in progress underneath a fixed-position sheet, so the
      // page behind the sheet can still scroll. Pinning the body with
      // position: fixed (and restoring the scroll offset on close) is
      // the reliable cross-browser fix for that background-scroll leak.
      var lockBodyScroll = function () {
        scrollY = window.scrollY;
        document.body.style.position = 'fixed';
        document.body.style.top = -scrollY + 'px';
        document.body.style.left = '0';
        document.body.style.right = '0';
      };

      var unlockBodyScroll = function () {
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        window.scrollTo(0, scrollY);
      };

      var openSortSheet = function () {
        if (!sortSheet) sortSheet = buildSortSheet();
        sortSheet.getBoundingClientRect();
        sortSheet.classList.add('is-open');
        mobileSortBtn.setAttribute('aria-expanded', 'true');
        lockBodyScroll();
        if (window.CollectionBackdrop) window.CollectionBackdrop.open(closeSortSheet);
        document.addEventListener('keydown', onSortSheetKeydown);
      };

      var closeSortSheet = function () {
        if (!sortSheet) return;
        sortSheet.classList.remove('is-open');
        mobileSortBtn.setAttribute('aria-expanded', 'false');
        unlockBodyScroll();
        if (window.CollectionBackdrop) window.CollectionBackdrop.close(closeSortSheet);
        document.removeEventListener('keydown', onSortSheetKeydown);
      };

      var onSortSheetKeydown = function (e) {
        if (e.key === 'Escape') {
          closeSortSheet();
          mobileSortBtn.focus();
        }
      };

      mobileSortBtn.addEventListener('click', function () {
        sortSheet && sortSheet.classList.contains('is-open')
          ? closeSortSheet()
          : openSortSheet();
      });
    }
  }

  /* ══════════════════════════════════════════════════════════
     FEED
     Panel visibility (coordinates with the toolbar only through
     the `collection:tabchange` event and the `?tab=` URL param —
     never queries into the toolbar's DOM) and the sub-collections
     carousel.
  ══════════════════════════════════════════════════════════ */
  var feed = document.getElementById('collection-feed');

  if (feed) {
    var panels = feed.querySelectorAll('[data-panel]');

    var validKeys = Array.prototype.map.call(panels, function (p) {
      return p.dataset.panel;
    });

    var showPanel = function (key) {
      // Guard: ignore missing/unrecognized keys instead of hiding
      // every panel. Without this, an early or malformed
      // `collection:tabchange` dispatch (key undefined, empty, or a
      // typo) would fall through to the `else` branch below for
      // EVERY panel and hide panel-products (and its pagination)
      // even though nothing valid asked for that.
      if (!key || validKeys.indexOf(key) === -1) return;

      panels.forEach(function (p) {
        if (p.dataset.panel === key) {
          p.removeAttribute('hidden');
        } else {
          p.setAttribute('hidden', '');
        }
      });
    };

    document.addEventListener('collection:tabchange', function (e) {
      showPanel(e && e.detail && e.detail.tab);
    });

    // Sub-collections carousel — prev/next buttons scroll the track
    // by ~3 card widths.
    feed.querySelectorAll('[data-sub-collections]').forEach(function (carousel) {
      var track = carousel.querySelector('[data-sub-collections-track]');
      var prev  = carousel.querySelector('[data-sub-collections-prev]');
      var next  = carousel.querySelector('[data-sub-collections-next]');
      if (!track) return;

      var updateNavState = function () {
        if (prev) prev.disabled = track.scrollLeft <= 4;
        if (next) next.disabled =
          track.scrollLeft >= track.scrollWidth - track.clientWidth - 4;
      };

      var scrollByAmount = function (dir) {
        var cardWidth = track.firstElementChild
          ? track.firstElementChild.getBoundingClientRect().width
          : 120;
        track.scrollBy({ left: dir * (cardWidth * 3 + 32), behavior: 'smooth' });
      };

      if (prev) prev.addEventListener('click', function () { scrollByAmount(-1); });
      if (next) next.addEventListener('click', function () { scrollByAmount(1); });
      track.addEventListener('scroll', updateNavState);
      updateNavState();
    });
  }

  /* ══════════════════════════════════════════════════════════
     TAB STATE ⇄ URL SYNC (browser back/forward)
     Previously the toolbar and the feed each had their own
     `popstate` listener, independently re-reading `?tab=` to stay
     in sync with the other. Consolidated into one listener: it
     updates the toolbar directly and dispatches
     `collection:tabchange`, which the feed section above already
     listens for.
  ══════════════════════════════════════════════════════════ */
  window.addEventListener('popstate', function () {
    var key = new URL(window.location.href).searchParams.get('tab') || 'products';
    if (setActiveTab) setActiveTab(key);
    document.dispatchEvent(new CustomEvent('collection:tabchange', { detail: { tab: key } }));
  });

})();
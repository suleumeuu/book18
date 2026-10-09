(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('pdfCanvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const PDF_URL = new URL('assets/book.pdf', document.baseURI).href;
  let pdfDoc = null;
  let currentPage = 1;
  let zoom = 1;
  let renderTask = null;
  let queuedPage = null;
  let renderToken = 0;

  if (!window.pdfjsLib) {
    $('loading').textContent = 'PDF көру модулі жүктелмеді. Интернет байланысын тексеріңіз.';
    return;
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  function buildToc() {
    const list = $('tocList');
    list.replaceChildren();
    let activeGroup = '';
    const items = window.BOOK_CONTENTS || [];
    items.forEach((item, index) => {
      if (item.group !== activeGroup) {
        activeGroup = item.group;
        const firstInGroup = items.slice(index).find(entry => entry.group === activeGroup);
        const heading = document.createElement('a');
        heading.className = 'toc-group toc-group-link';
        heading.href = '#page=' + (firstInGroup ? firstInGroup.page : item.page);
        heading.dataset.page = String(firstInGroup ? firstInGroup.page : item.page);
        heading.textContent = activeGroup;
        heading.setAttribute('aria-label', `${activeGroup} бөліміне өту`);
        list.appendChild(heading);
      }
      const link = document.createElement('a');
      link.className = 'toc-link';
      link.href = '#page=' + item.page;
      link.dataset.page = String(item.page);
      link.setAttribute('aria-label', `${item.title}, ${item.page}-бет`);
      const title = document.createElement('span');
      title.className = 'toc-title';
      title.textContent = item.title;
      const pageNo = document.createElement('span');
      pageNo.className = 'toc-page';
      pageNo.textContent = item.page;
      link.append(title, pageNo);
      list.appendChild(link);
    });
  }

  async function renderPdfLinks(pdfPage, viewport) {
    const layer = $('pdfLinkLayer');
    layer.replaceChildren();
    layer.style.width = viewport.width + 'px';
    layer.style.height = viewport.height + 'px';
    try {
      const annotations = await pdfPage.getAnnotations({ intent: 'display' });
      for (const annotation of annotations) {
        if (annotation.subtype !== 'Link' || (!annotation.dest && !annotation.url)) continue;
        const rect = viewport.convertToViewportRectangle(annotation.rect);
        const left = Math.min(rect[0], rect[2]);
        const top = Math.min(rect[1], rect[3]);
        const width = Math.abs(rect[2] - rect[0]);
        const height = Math.abs(rect[3] - rect[1]);
        const anchor = document.createElement('a');
        anchor.style.left = left + 'px';
        anchor.style.top = top + 'px';
        anchor.style.width = width + 'px';
        anchor.style.height = height + 'px';
        anchor.title = 'Оқулықтың тиісті бетіне өту';
        if (annotation.url) {
          anchor.href = annotation.url;
          anchor.target = '_blank';
          anchor.rel = 'noopener noreferrer';
        } else {
          anchor.href = '#';
          anchor.addEventListener('click', async event => {
            event.preventDefault();
            try {
              let destination = annotation.dest;
              if (typeof destination === 'string') destination = await pdfDoc.getDestination(destination);
              if (Array.isArray(destination) && destination[0]) {
                const pageIndex = await pdfDoc.getPageIndex(destination[0]);
                goTo(pageIndex + 1);
              }
            } catch (error) { console.error('PDF link navigation error:', error); }
          });
        }
        layer.appendChild(anchor);
      }
    } catch (error) { console.warn('PDF link layer could not be created:', error); }
  }

  function updateControls() {
    $('pageNum').value = currentPage;
    $('bottomPage').value = currentPage;
    $('zoomLabel').textContent = Math.round(zoom * 100) + '%';
    document.querySelectorAll('.toc-link').forEach(link => {
      link.classList.toggle('active', Number(link.dataset.page) === currentPage);
    });
    const atStart = currentPage <= 1;
    const atEnd = currentPage >= pdfDoc.numPages;
    $('prevBtn').disabled = $('bottomPrev').disabled = atStart;
    $('nextBtn').disabled = $('bottomNext').disabled = atEnd;
  }

  async function renderPage(pageNumber) {
    if (!pdfDoc) return;
    const target = Math.max(1, Math.min(pdfDoc.numPages, Number.parseInt(pageNumber, 10) || 1));
    if (renderTask) {
      queuedPage = target;
      try { renderTask.cancel(); } catch (_) {}
      return;
    }
    currentPage = target;
    const token = ++renderToken;
    $('loading').classList.remove('hidden');
    try {
      const pdfPage = await pdfDoc.getPage(target);
      if (token !== renderToken) return;
      const stage = $('stage');
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const availableWidth = Math.max(260, stage.clientWidth - 48);
      const fitScale = Math.min(availableWidth / baseViewport.width, 1.6);
      const viewport = pdfPage.getViewport({ scale: fitScale * zoom });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, viewport.width, viewport.height);
      renderTask = pdfPage.render({ canvasContext: ctx, viewport });
      await renderTask.promise;
      await renderPdfLinks(pdfPage, viewport);
      currentPage = target;
      updateControls();
      $('stage').scrollTop = 0;
      if (location.hash !== '#page=' + target) history.replaceState(null, '', '#page=' + target);
    } catch (error) {
      if (error?.name !== 'RenderingCancelledException') console.error('Page render error:', error);
    } finally {
      renderTask = null;
      $('loading').classList.add('hidden');
      if (queuedPage !== null) {
        const next = queuedPage;
        queuedPage = null;
        renderPage(next);
      }
    }
  }

  function goTo(pageNumber) {
    const target = Math.max(1, Math.min(pdfDoc ? pdfDoc.numPages : 126, Number.parseInt(pageNumber, 10) || 1));
    if (renderTask) {
      queuedPage = target;
      try { renderTask.cancel(); } catch (_) {}
    } else {
      renderPage(target);
    }
  }

  function toggleSidebar(force) {
    const sidebar = $('sidebar');
    if (typeof force === 'boolean') sidebar.classList.toggle('open', force);
    else sidebar.classList.toggle('open');
  }

  $('tocList').addEventListener('click', event => {
    const link = event.target.closest('a.toc-link, a.toc-group-link');
    if (!link) return;
    event.preventDefault();
    goTo(link.dataset.page);
    if (window.innerWidth < 900) toggleSidebar(false);
  });
  $('menuToggle').addEventListener('click', () => toggleSidebar());
  $('contentsBtn').addEventListener('click', () => toggleSidebar());
  $('bottomContents').addEventListener('click', () => toggleSidebar());
  $('closeSidebar').addEventListener('click', () => toggleSidebar(false));
  $('prevBtn').addEventListener('click', () => goTo(currentPage - 1));
  $('bottomPrev').addEventListener('click', () => goTo(currentPage - 1));
  $('nextBtn').addEventListener('click', () => goTo(currentPage + 1));
  $('bottomNext').addEventListener('click', () => goTo(currentPage + 1));
  function bindPageInput(input) {
    input.addEventListener('change', () => goTo(input.value));
    input.addEventListener('keydown', event => { if (event.key === 'Enter') goTo(input.value); });
  }
  bindPageInput($('pageNum'));
  bindPageInput($('bottomPage'));
  $('zoomIn').addEventListener('click', () => { zoom = Math.min(2.5, zoom + .1); goTo(currentPage); });
  $('zoomOut').addEventListener('click', () => { zoom = Math.max(.5, zoom - .1); goTo(currentPage); });
  $('fitBtn').addEventListener('click', () => { zoom = 1; goTo(currentPage); });
  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }
  $('fullBtn').addEventListener('click', toggleFullscreen);
  $('bottomFull').addEventListener('click', toggleFullscreen);

  const themeBtn = $('themeBtn');
  function setTheme(dark) {
    document.body.classList.toggle('dark-theme', dark);
    themeBtn.textContent = dark ? '☀ Ашық режим' : '🌙 Қараңғы режим';
    themeBtn.setAttribute('aria-pressed', String(dark));
  }
  themeBtn.addEventListener('click', () => setTheme(!document.body.classList.contains('dark-theme')));
  setTheme(false);

  $('searchInput').addEventListener('input', event => {
    const query = event.target.value.trim().toLocaleLowerCase('kk');
    document.querySelectorAll('.toc-link').forEach(link => {
      const title = link.querySelector('.toc-title');
      link.classList.toggle('hidden', !!query && !title.textContent.toLocaleLowerCase('kk').includes(query));
    });
    document.querySelectorAll('.toc-group').forEach(group => {
      let node = group.nextElementSibling;
      let hasMatch = false;
      while (node && !node.classList.contains('toc-group')) {
        if (node.classList.contains('toc-link') && !node.classList.contains('hidden')) hasMatch = true;
        node = node.nextElementSibling;
      }
      group.classList.toggle('hidden', !!query && !hasMatch);
    });
  });

  document.addEventListener('keydown', event => {
    if (event.target.matches('input, textarea, select, button, [contenteditable="true"]')) return;
    if (event.code === 'Space') {
      event.preventDefault();
      goTo(currentPage + (event.shiftKey ? -1 : 1));
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'PageDown') goTo(currentPage + 1);
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') goTo(currentPage - 1);
    if (event.key === '+' || event.key === '=') { zoom = Math.min(2.5, zoom + .1); goTo(currentPage); }
    if (event.key === '-') { zoom = Math.max(.5, zoom - .1); goTo(currentPage); }
  });
  window.addEventListener('resize', () => goTo(currentPage));
  window.addEventListener('hashchange', () => {
    const match = location.hash.match(/page=(\d+)/);
    if (match && Number(match[1]) !== currentPage) goTo(match[1]);
  });

  buildToc();
  pdfjsLib.getDocument({ url: PDF_URL }).promise.then(document => {
    pdfDoc = document;
    $('pageCount').textContent = $('bottomCount').textContent = document.numPages;
    const match = location.hash.match(/page=(\d+)/);
    const initialPage = match ? Number(match[1]) : 1;
    if (window.innerWidth >= 1100) toggleSidebar(true);
    goTo(initialPage);
  }).catch(error => {
    $('loading').textContent = 'PDF файлы ашылмады. assets/book.pdf файлының бар екенін тексеріңіз.';
    console.error('PDF load error:', error);
  });
})();

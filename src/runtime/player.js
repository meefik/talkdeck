(() => {
  const slides = [...document.querySelectorAll('.marpit > svg')];
  const notes = JSON.parse(document.getElementById('deck-notes').textContent);
  const fragments = (i) => Number(slides[i].querySelector('section').dataset.marpitFragments || 0);

  let cur = 0;
  let step = 0;
  let presenter = null;
  let startedAt = 0;
  let noteScale = 1;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function reveal(svg, n) {
    svg.querySelectorAll('[data-marpit-fragment]').forEach((el) => {
      el.classList.toggle('pending', Number(el.dataset.marpitFragment) > n);
    });
  }

  function snapshot(i, n) {
    const svg = slides[i].cloneNode(true);
    svg.classList.add('active');
    reveal(svg, n);
    return svg;
  }

  function render() {
    slides.forEach((s, i) => s.classList.toggle('active', i === cur));
    reveal(slides[cur], step);
    const hash = `#${cur + 1}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
    updatePresenter();
  }

  function go(i, s = 0) {
    cur = clamp(i, 0, slides.length - 1);
    step = clamp(s, 0, fragments(cur));
    render();
  }

  const next = () => (step < fragments(cur) ? go(cur, step + 1) : go(cur + 1, 0));
  const prev = () => (step > 0 ? go(cur, step - 1) : go(cur - 1, Infinity));

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': case 'PageDown': case ' ': case 'Enter': next(); break;
      case 'ArrowLeft': case 'ArrowUp': case 'PageUp': case 'Backspace': prev(); break;
      case 'Home': go(0); break;
      case 'End': go(slides.length - 1, Infinity); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'p': case 'P': openPresenter(); break;
      case '+': case '=': setNoteScale(noteScale + 0.1); break;
      case '-': setNoteScale(noteScale - 0.1); break;
      default: return;
    }
    e.preventDefault();
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }

  // ---------- presenter window ----------

  function openPresenter() {
    if (presenter && !presenter.closed) return presenter.focus();
    presenter = window.open('', 'deck-presenter', 'width=1200,height=760');
    if (!presenter) return;
    const d = presenter.document;
    d.open();
    d.write('<!doctype html><html><head><meta charset="utf-8"><title>Presenter</title></head><body class="presenter"></body></html>');
    d.close();
    document.querySelectorAll('style').forEach((s) => d.head.appendChild(s.cloneNode(true)));
    d.body.innerHTML = `
      <div class="presenter-grid">
        <div class="pane"><div class="marpit" id="p-cur"></div></div>
        <div class="presenter-side">
          <div class="pane"><div class="marpit" id="p-next"></div></div>
          <div class="presenter-bar">
            <span id="p-page"></span><span id="p-time"></span>
            <span><button id="p-minus">−</button> <button id="p-plus">+</button></span>
          </div>
        </div>
        <div class="presenter-notes" id="p-notes"></div>
      </div>`;
    d.addEventListener('keydown', onKey);
    d.getElementById('p-plus').onclick = () => setNoteScale(noteScale + 0.1);
    d.getElementById('p-minus').onclick = () => setNoteScale(noteScale - 0.1);
    startedAt = Date.now();
    presenter.addEventListener('beforeunload', () => { presenter = null; });
    updatePresenter();
  }

  function setNoteScale(v) {
    noteScale = clamp(v, 0.6, 3);
    updatePresenter();
  }

  function updatePresenter() {
    if (!presenter || presenter.closed) return;
    const d = presenter.document;
    const $ = (id) => d.getElementById(id);
    $('p-cur').replaceChildren(snapshot(cur, step));
    const more = step < fragments(cur);
    const nextSlide = more ? [cur, step + 1] : [cur + 1, 0];
    $('p-next').replaceChildren(...(nextSlide[0] < slides.length ? [snapshot(...nextSlide)] : []));
    $('p-page').textContent = `${cur + 1} / ${slides.length}`;
    const notesEl = $('p-notes');
    notesEl.style.fontSize = `${noteScale * 100}%`;
    notesEl.replaceChildren(...(notes[cur] || []).map((line) => {
      const p = d.createElement('p');
      p.textContent = line;
      return p;
    }));
  }

  setInterval(() => {
    if (!presenter || presenter.closed) return;
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const t = presenter.document.getElementById('p-time');
    if (t) t.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);

  window.addEventListener('beforeunload', () => presenter && presenter.close());

  // ---------- input ----------

  document.addEventListener('keydown', onKey);
  document.addEventListener('click', (e) => (e.clientX < window.innerWidth * 0.25 ? prev() : next()));
  window.addEventListener('hashchange', () => go((parseInt(location.hash.slice(1), 10) || 1) - 1));

  // Exposed for the exporters (screenshots) and for scripting.
  window.deck = { go, next, prev, count: slides.length };

  go((parseInt(location.hash.slice(1), 10) || 1) - 1);
})();

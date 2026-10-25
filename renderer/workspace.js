// Shared splitters for the conversation/tool workspace. Content stays mounted
// while resizing, so an iframe or terminal input is never recreated by a drag.
(() => {
  window.createWorkspace = (main, store) => {
    const dock = main.querySelector('#rightCol');
    const columns = ['dockPrimary', 'dockSecondary'].map((id) => main.querySelector('#' + id));
    const outer = main.querySelector('#workspaceResize');
    const middle = main.querySelector('#columnsResize');
    const saved = store.get('pd_workspace', {});
    const layout = {
      width: Number.isFinite(saved?.width) ? saved.width : null,
      split: Number.isFinite(saved?.split) ? saved.split : .5,
      rows: saved?.rows && typeof saved.rows === 'object' ? saved.rows : {},
    };
    const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
    const persist = () => store.set('pd_workspace', layout);
    const visibleCards = (col) => [...col.children].filter((el) => el.classList.contains('card') && !el.hidden && !el.classList.contains('dock-suppressed'));
    let expanded = null, cancelDrag = null;

    function splitter(el, axis, label, controls, begin) {
      el.classList.add('pane-resize');
      el.setAttribute('role', 'separator');
      el.setAttribute('aria-orientation', axis === 'x' ? 'vertical' : 'horizontal');
      el.setAttribute('aria-label', label);
      el.setAttribute('aria-controls', controls);
      el.tabIndex = 0;
      el.onpointerdown = (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        cancelDrag?.();
        const resize = begin();
        const start = axis === 'x' ? e.clientX : e.clientY;
        const shield = document.createElement('div');
        shield.className = 'resize-shield';
        document.body.appendChild(shield);
        document.body.classList.add('workspace-resizing');
        document.body.classList.toggle('workspace-resizing-y', axis === 'y');
        el.classList.add('dragging');
        el.setPointerCapture(e.pointerId);
        const move = (ev) => {
          if (ev.pointerId === e.pointerId) resize((axis === 'x' ? ev.clientX : ev.clientY) - start);
        };
        const finish = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', finish);
          window.removeEventListener('pointercancel', finish);
          el.removeEventListener('lostpointercapture', finish);
          window.removeEventListener('blur', finish);
          if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
          shield.remove();
          el.classList.remove('dragging');
          document.body.classList.remove('workspace-resizing', 'workspace-resizing-y');
          cancelDrag = null;
          persist();
        };
        cancelDrag = finish;
        // Listen at window scope as a fallback for environments where pointer
        // capture is unavailable; a fast drag can otherwise leave the handle.
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', finish);
        window.addEventListener('pointercancel', finish);
        el.addEventListener('lostpointercapture', finish);
        window.addEventListener('blur', finish);
      };
      el.onkeydown = (e) => {
        const negative = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
        const positive = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (![negative, positive, 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        const delta = e.key === 'Home' ? -100000 : e.key === 'End' ? 100000 : (e.key === negative ? -1 : 1) * (e.shiftKey ? 40 : 10);
        begin()(delta);
        persist();
      };
    }

    function fit() {
      if (!main.classList.contains('rc-open') || !main.clientWidth) return;
      const active = columns.filter((col) => !col.hidden);
      const width = main.clientWidth;
      // A small desktop window shows the tools instead of overlaying/cropping
      // the conversation. Its full-width toolbar remains available above them.
      const only = width < 760 || !!expanded;
      main.classList.toggle('workspace-only', only);
      outer.hidden = only;
      const desired = layout.width ?? width * (active.length > 1 ? .7 : .52);
      main.style.setProperty('--workspace-width', `${clamp(desired, 300, Math.max(300, width - 308))}px`);
      outer.setAttribute('aria-valuemin', '0');
      outer.setAttribute('aria-valuemax', '100');
      outer.setAttribute('aria-valuenow', Math.round(dock.getBoundingClientRect().width / width * 100));
      columns.forEach((col, index) => { col.style.gridColumn = active.length > 1 ? (index ? '3' : '1') : '1'; });
      if (active.length > 1) {
        const available = Math.max(1, dock.clientWidth - 16);
        const min = Math.min(.45, 220 / available);
        const fraction = clamp(layout.split, min, 1 - min);
        dock.style.gridTemplateColumns = `minmax(0, ${fraction}fr) 8px minmax(0, ${1 - fraction}fr)`;
        middle.style.gridColumn = '2';
        middle.setAttribute('aria-valuemin', Math.round(min * 100));
        middle.setAttribute('aria-valuemax', Math.round((1 - min) * 100));
        middle.setAttribute('aria-valuenow', Math.round(fraction * 100));
      } else {
        dock.style.gridTemplateColumns = 'minmax(0, 1fr)';
        middle.style.gridColumn = '';
      }
    }

    splitter(outer, 'x', 'Resize conversation and tools', 'rightCol', () => {
      const start = dock.getBoundingClientRect().width;
      return (delta) => { layout.width = clamp(start - delta, 300, main.clientWidth - 308); fit(); };
    });
    outer.ondblclick = () => { layout.width = null; fit(); persist(); };
    splitter(middle, 'x', 'Resize tool columns', 'dockPrimary dockSecondary', () => {
      const total = columns.reduce((n, col) => n + col.clientWidth, 0);
      const start = columns[0].clientWidth;
      return (delta) => { layout.split = clamp((start + delta) / total, .05, .95); fit(); };
    });
    middle.ondblclick = () => { layout.split = .5; fit(); persist(); };

    function sync() {
      cancelDrag?.();
      if (expanded?.hidden) expanded = null;
      main.querySelectorAll('.card').forEach((card) => {
        card.classList.toggle('dock-suppressed', !!expanded && card !== expanded);
        card.querySelectorAll('[data-e], [data-t="expand"]').forEach((button) => {
          button.title = card === expanded ? 'Restore' : 'Expand';
          button.setAttribute('aria-pressed', String(card === expanded));
        });
      });
      columns.forEach((col) => {
        col.querySelectorAll('.row-resize').forEach((el) => el.remove());
        const cards = visibleCards(col);
        col.hidden = !cards.length;
        cards.forEach((card, i) => {
          const weight = layout.rows[card.id];
          card.style.flex = `${Number.isFinite(weight) && weight > 0 ? weight : 1} 1 0px`;
          if (!i) return;
          const previous = cards[i - 1];
          const handle = document.createElement('div');
          handle.className = 'row-resize';
          splitter(handle, 'y', 'Resize panel heights', `${previous.id} ${card.id}`, () => {
            const heights = cards.map((c) => c.getBoundingClientRect().height);
            const total = heights[i - 1] + heights[i];
            return (delta) => {
              const top = clamp(heights[i - 1] + delta, 80, total - 80);
              cards.forEach((c, index) => {
                const height = index === i - 1 ? top : index === i ? total - top : heights[index];
                layout.rows[c.id] = height / heights.reduce((sum, h) => sum + h, 0) * cards.length;
                c.style.flexGrow = layout.rows[c.id];
              });
              handle.setAttribute('aria-valuenow', Math.round(top / total * 100));
            };
          });
          handle.setAttribute('aria-valuemin', '0');
          handle.setAttribute('aria-valuemax', '100');
          handle.setAttribute('aria-valuenow', Math.round(previous.getBoundingClientRect().height / (previous.getBoundingClientRect().height + card.getBoundingClientRect().height) * 100) || 50);
          handle.ondblclick = () => { cards.forEach((c) => { delete layout.rows[c.id]; }); sync(); persist(); };
          card.before(handle);
        });
      });
      middle.hidden = columns.some((col) => col.hidden);
      fit();
    }
    new ResizeObserver(fit).observe(main);
    return {
      sync,
      reset() { expanded = null; main.classList.remove('workspace-only', 'rc-wide'); sync(); },
      expand(card) { expanded = expanded === card ? null : card; sync(); },
    };
  };
})();

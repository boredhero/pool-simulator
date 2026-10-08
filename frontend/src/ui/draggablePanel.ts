import './draggablePanel.css';

/** Floating game controls: header dragging plus equivalent click/keyboard controls. */
export function setupDraggablePanels(): void {
  for (const [panelId, openerId, title] of [
    ['settingspanel', 'settingsbtn', 'Settings'],
    ['onlinepanel', 'onlinebtn', 'Play online'],
  ]) {
    const panel = document.getElementById(panelId);
    const opener = document.getElementById(openerId);
    if (!panel || !opener || panel.dataset.draggable === 'true') continue;
    panel.dataset.draggable = 'true';
    panel.classList.add('floating-panel');
    opener.setAttribute('aria-controls', panelId);
    let header = panel.querySelector<HTMLElement>('.settings-header');
    if (!header) {
      header = document.createElement('header');
      header.className = 'settings-header';
      const heading = document.createElement('h2');
      heading.id = `${panelId}-title`;
      heading.textContent = title;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'panel-close';
      close.setAttribute('aria-label', `Close ${title.toLowerCase()}`);
      close.textContent = '×';
      close.classList.add('icon-close');
      header.append(heading, close);
      panel.prepend(header);
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-labelledby', heading.id);
      close.addEventListener('click', () => closePanel());
    }
    header.classList.add('panel-drag-handle');
    const move = document.createElement('button');
    move.type = 'button';
    move.className = 'panel-move';
    move.textContent = 'Move';
    move.setAttribute('aria-label', `Move ${title.toLowerCase()} panel`);
    move.setAttribute('aria-expanded', 'false');
    const controls = document.createElement('div');
    controls.className = 'panel-move-controls';
    controls.id = `${panelId}-move-controls`;
    controls.hidden = true;
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', `${title} panel position`);
    move.setAttribute('aria-controls', controls.id);
    header.insertBefore(move, header.lastElementChild);
    header.after(controls);
    const status = document.createElement('span');
    status.className = 'panel-position-status';
    status.setAttribute('role', 'status');
    controls.append(status);

    const isOpen = () => panel.classList.contains('open');
    let positioned = false;
    let dragging: { pointer: number; x: number; y: number; left: number; top: number; moved: boolean } | null = null;
    const bounds = () => {
      const v = window.visualViewport;
      return { left: (v?.offsetLeft ?? 0) + 8, top: (v?.offsetTop ?? 0) + 8,
        width: v?.width ?? innerWidth, height: v?.height ?? innerHeight };
    };
    const place = (left: number, top: number, announce = false) => {
      const box = panel.getBoundingClientRect(), view = bounds();
      if (!positioned) panel.style.width = `${box.width}px`;
      positioned = true;
      left = Math.max(view.left, Math.min(left, view.left + view.width - box.width - 16));
      top = Math.max(view.top, Math.min(top, view.top + view.height - box.height - 16));
      panel.style.left = `${Math.round(left)}px`;
      panel.style.top = `${Math.round(top)}px`;
      panel.style.right = 'auto';
      if (announce) status.textContent = `Panel position: ${Math.round(left)}, ${Math.round(top)}.`;
    };
    const clamp = () => {
      if (!isOpen() || !positioned) return;
      const box = panel.getBoundingClientRect();
      place(box.left, box.top);
    };
    const reset = () => {
      positioned = false;
      for (const property of ['left', 'top', 'right', 'width']) panel.style.removeProperty(property);
      status.textContent = 'Panel position reset.';
    };
    const shift = (x: number, y: number) => {
      const box = panel.getBoundingClientRect();
      place(box.left + x, box.top + y, true);
    };
    for (const [label, x, y] of [
      ['Left', -32, 0], ['Right', 32, 0], ['Up', 0, -32], ['Down', 0, 32],
    ] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.setAttribute('aria-label', `Move panel ${label.toLowerCase()}`);
      button.addEventListener('click', () => shift(x, y));
      controls.append(button);
    }
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.textContent = 'Reset position';
    resetButton.addEventListener('click', reset);
    controls.append(resetButton);
    move.addEventListener('click', () => {
      controls.hidden = !controls.hidden;
      move.setAttribute('aria-expanded', String(!controls.hidden));
      clamp();
    });
    // The focused Move button also supports arrows without altering the game's aim.
    move.addEventListener('keydown', event => {
      const delta = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[event.key];
      if (!delta) return;
      event.preventDefault();
      event.stopPropagation();
      shift(delta[0], delta[1]);
    });
    const finishDrag = () => {
      const pointer = dragging?.pointer;
      dragging = null;
      if (pointer !== undefined && header.hasPointerCapture(pointer)) header.releasePointerCapture(pointer);
      header.classList.remove('is-dragging');
    };
    function closePanel() {
      finishDrag();
      panel!.classList.remove('open');
      opener!.focus();
    }
    header.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest('button,input,select,textarea,a')) return;
      const box = panel.getBoundingClientRect();
      dragging = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: box.left, top: box.top, moved: false };
      header.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    header.addEventListener('pointermove', event => {
      if (!dragging || event.pointerId !== dragging.pointer) return;
      const dx = event.clientX - dragging.x, dy = event.clientY - dragging.y;
      if (!dragging.moved && Math.hypot(dx, dy) < 4) return;
      dragging.moved = true;
      header.classList.add('is-dragging');
      place(dragging.left + dx, dragging.top + dy);
    });
    header.addEventListener('pointerup', finishDrag);
    header.addEventListener('pointercancel', finishDrag);
    header.addEventListener('lostpointercapture', finishDrag);
    panel.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closePanel();
    });
    const sync = () => {
      opener.setAttribute('aria-expanded', String(isOpen()));
      if (isOpen()) clamp();
      else {
        finishDrag();
        controls.hidden = true;
        move.setAttribute('aria-expanded', 'false');
        if (panel.contains(document.activeElement)) opener.focus();
      }
    };
    new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['class'] });
    new ResizeObserver(clamp).observe(panel);
    window.addEventListener('resize', clamp);
    window.visualViewport?.addEventListener('resize', clamp);
    window.visualViewport?.addEventListener('scroll', clamp);
    sync();
  }
}

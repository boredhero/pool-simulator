type InputProfile = 'mouse' | 'trackpad';

/** In-game radio menu; the trigger keeps the selected value for preference sync. */
export function createInputProfilePicker() {
  const button = document.createElement('button');
  button.id = 'camera-input-profile';
  button.type = 'button';
  button.setAttribute('aria-label', 'Camera input mode');
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'camera-input-menu');
  const label = document.createElement('span');
  const chevron = document.createElement('span');
  chevron.className = 'input-profile-chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16"><path d="m4 10 4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  button.append(label, chevron);

  const menu = document.createElement('div');
  menu.id = 'camera-input-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Camera input mode');
  const options: HTMLButtonElement[] = [];
  const choices = [
    ['mouse', 'Mouse & Keyboard Mode', 'Right-drag to orbit · scroll to zoom'],
    ['trackpad', 'Trackpad Mode', 'Scroll to orbit · pinch to zoom'],
  ] as const;

  function setValue(value: InputProfile) {
    button.value = value;
    label.textContent = choices.find(choice => choice[0] === value)![1];
    for (const option of options) option.setAttribute('aria-checked', String(option.value === value));
  }
  function close(restoreFocus = false) {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (restoreFocus) button.focus();
  }
  function open() {
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    options.find(option => option.value === button.value)!.focus();
  }
  for (const [value, title, description] of choices) {
    const option = document.createElement('button');
    option.type = 'button';
    option.value = value;
    option.tabIndex = -1;
    option.setAttribute('role', 'menuitemradio');
    option.setAttribute('aria-label', title);
    const text = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = title;
    const hint = document.createElement('small');
    hint.textContent = description;
    text.append(name, hint);
    const check = document.createElement('span');
    check.className = 'input-profile-check';
    check.textContent = '✓';
    check.setAttribute('aria-hidden', 'true');
    option.append(text, check);
    option.addEventListener('click', () => {
      setValue(value);
      button.dispatchEvent(new Event('change', {bubbles: true}));
      close(true);
    });
    options.push(option);
    menu.append(option);
  }
  button.addEventListener('click', () => menu.hidden ? open() : close());
  button.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      open();
    }
  });
  menu.addEventListener('keydown', event => {
    // Camera and shot shortcuts must never act on menu navigation.
    event.stopPropagation();
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') close(true);
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
      options[next].focus();
    }
  });
  document.addEventListener('pointerdown', event => {
    if (!menu.contains(event.target as Node) && !button.contains(event.target as Node)) close();
  });
  document.addEventListener('focusin', event => {
    if (!menu.contains(event.target as Node) && event.target !== button) close();
  });
  window.addEventListener('blur', () => close());
  window.addEventListener('resize', () => close());
  setValue('mouse');
  return {button, menu, setValue};
}

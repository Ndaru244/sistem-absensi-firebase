/**
 * SearchableSelect — custom searchable dropdown pengganti <select> native.
 *
 * Panel di-render ke document.body (portal) agar tidak terpotong oleh
 * overflow/z-index container manapun.
 *
 * Penggunaan:
 *   const ss = new SearchableSelect(anchorEl, { placeholder, onChange });
 *   ss.setOptions([{ value, label, group }]);
 *   ss.setValue('7A');
 *   const val = ss.getValue();
 *   ss.destroy();
 */
export class SearchableSelect {
  constructor(anchor, opts = {}) {
    this._anchor = anchor;
    this._opts = {
      placeholder:       opts.placeholder       ?? '-- Pilih Kelas --',
      searchPlaceholder: opts.searchPlaceholder ?? 'Cari kelas...',
      onChange:          opts.onChange          ?? null,
      allowEmpty:        opts.allowEmpty        ?? true,
      emptyLabel:        opts.emptyLabel        ?? opts.placeholder ?? '-- Pilih Kelas --',
    };

    this._options = [];
    this._value   = '';
    this._open    = false;

    this._build();
    this._bindEvents();
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  setOptions(options) {
    this._options = options;
    this._value   = '';
    this._renderTrigger();
    if (this._open) this._renderList();
  }

  getValue() { return this._value; }

  setValue(val) {
    const found = this._options.find(o => o.value === val);
    this._value = found ? val : '';
    this._renderTrigger();
  }

  destroy() {
    this._panel.remove();
    this._wrapper.remove();
    this._anchor.style.display = '';
    document.removeEventListener('click',   this._outsideHandler);
    document.removeEventListener('keydown', this._keyHandler);
    window.removeEventListener('scroll',  this._repositionHandler, true);
    window.removeEventListener('resize',  this._repositionHandler);
  }

  // ─── Build DOM ─────────────────────────────────────────────────────────────

  _build() {
    const anchor = this._anchor;

    // ── Wrapper (trigger area) ───────────────────────────────────────────────
    const wrapper = document.createElement('div');
    wrapper.className = 'ss-wrapper';
    wrapper.setAttribute('role', 'combobox');
    wrapper.setAttribute('aria-haspopup', 'listbox');
    wrapper.setAttribute('aria-expanded', 'false');

    // Salin class lebar dari anchor (flex-1, sm:w-48, dll.)
    const anchorClasses = Array.from(anchor.classList).filter(c =>
      c.startsWith('flex') || c.startsWith('sm:') || c.startsWith('md:') ||
      c.startsWith('w-')   || c.startsWith('min-w') || c.startsWith('max-w')
    );
    if (anchorClasses.length) wrapper.classList.add(...anchorClasses);

    // Trigger button
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.setAttribute('aria-label', this._opts.placeholder);

    // Jika anchor berada di dalam .input-icon, tambah pl-9 agar tidak
    // tertimpa icon lucide yang ada di kiri
    const inInputIcon = anchor.closest('.input-icon');
    trigger.className = inInputIcon
      ? 'ss-trigger input pl-9'
      : 'ss-trigger input';

    const triggerText = document.createElement('span');
    triggerText.className = 'ss-trigger-text ss-placeholder';
    triggerText.textContent = this._opts.placeholder;

    const chevron = document.createElement('span');
    chevron.className = 'ss-chevron';
    chevron.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;

    trigger.appendChild(triggerText);
    trigger.appendChild(chevron);
    wrapper.appendChild(trigger);

    // Sisipkan wrapper sebelum anchor, sembunyikan anchor
    anchor.parentNode.insertBefore(wrapper, anchor);
    anchor.style.display = 'none';

    // ── Panel — diappend ke body (portal) ────────────────────────────────────
    const panel = document.createElement('div');
    panel.className = 'ss-panel hidden';
    panel.setAttribute('role', 'listbox');
    // Tandai agar outsideHandler bisa membedakan klik di panel
    panel.dataset.ssPortal = '1';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'ss-search-wrap';

    const searchIcon = document.createElement('span');
    searchIcon.className = 'ss-search-icon';
    searchIcon.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'ss-search';
    searchInput.placeholder = this._opts.searchPlaceholder;
    searchInput.setAttribute('autocomplete', 'off');
    searchInput.setAttribute('spellcheck', 'false');

    searchWrap.appendChild(searchIcon);
    searchWrap.appendChild(searchInput);

    const list = document.createElement('ul');
    list.className = 'ss-list custom-scrollbar';

    panel.appendChild(searchWrap);
    panel.appendChild(list);

    // Portal: append ke body bukan ke wrapper
    document.body.appendChild(panel);

    this._wrapper      = wrapper;
    this._trigger      = trigger;
    this._triggerText  = triggerText;
    this._panel        = panel;
    this._searchInput  = searchInput;
    this._list         = list;
  }

  // ─── Events ────────────────────────────────────────────────────────────────

  _bindEvents() {
    this._trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggle();
    });

    this._searchInput.addEventListener('input', () => {
      this._renderList(this._searchInput.value);
    });

    this._searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._close();
    });

    // Tutup saat klik di luar wrapper ATAU panel
    this._outsideHandler = (e) => {
      if (this._wrapper.contains(e.target)) return;
      if (this._panel.contains(e.target))   return;
      this._close();
    };
    document.addEventListener('click', this._outsideHandler);

    // Keyboard: Escape
    this._keyHandler = (e) => {
      if (e.key === 'Escape' && this._open) this._close();
    };
    document.addEventListener('keydown', this._keyHandler);

    // Reposisi saat scroll atau resize
    this._repositionHandler = () => {
      if (this._open) this._positionPanel();
    };
    window.addEventListener('scroll', this._repositionHandler, true);
    window.addEventListener('resize', this._repositionHandler);
  }

  // ─── Open / Close ──────────────────────────────────────────────────────────

  _toggle() {
    this._open ? this._close() : this._openPanel();
  }

  _openPanel() {
    // Tutup semua instance lain yang sedang terbuka
    document.querySelectorAll('.ss-panel:not(.hidden)').forEach(p => {
      if (p !== this._panel) p.classList.add('hidden');
    });
    document.querySelectorAll('.ss-wrapper.ss-open').forEach(w => {
      if (w !== this._wrapper) {
        w.classList.remove('ss-open');
        w.setAttribute('aria-expanded', 'false');
      }
    });

    this._open = true;
    this._panel.classList.remove('hidden');
    this._wrapper.setAttribute('aria-expanded', 'true');
    this._wrapper.classList.add('ss-open');
    this._searchInput.value = '';
    this._renderList();
    this._positionPanel();
    requestAnimationFrame(() => this._searchInput.focus());
  }

  _close() {
    this._open = false;
    this._panel.classList.add('hidden');
    this._wrapper.setAttribute('aria-expanded', 'false');
    this._wrapper.classList.remove('ss-open');
  }

  _positionPanel() {
    const rect   = this._wrapper.getBoundingClientRect();
    const panelH = 280; // estimasi tinggi panel
    const gap    = 4;

    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp     = spaceBelow < panelH && rect.top > panelH;

    const width = Math.max(rect.width, 200);

    Object.assign(this._panel.style, {
      position:  'fixed',
      width:     `${width}px`,
      left:      `${rect.left}px`,
      zIndex:    '9999',
    });

    if (openUp) {
      this._panel.style.top    = 'auto';
      this._panel.style.bottom = `${window.innerHeight - rect.top + gap}px`;
    } else {
      this._panel.style.bottom = 'auto';
      this._panel.style.top    = `${rect.bottom + gap}px`;
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  _renderTrigger() {
    const found = this._options.find(o => o.value === this._value);
    if (found) {
      this._triggerText.textContent = found.label;
      this._triggerText.classList.remove('ss-placeholder');
    } else {
      this._triggerText.textContent = this._opts.placeholder;
      this._triggerText.classList.add('ss-placeholder');
    }
  }

  _renderList(query = '') {
    const q    = query.toLowerCase().trim();
    const list = this._list;
    list.innerHTML = '';

    const filtered = q
      ? this._options.filter(o => o.label.toLowerCase().includes(q))
      : this._options;

    if (filtered.length === 0) {
      const li = document.createElement('li');
      li.className   = 'ss-empty';
      li.textContent = 'Tidak ditemukan';
      list.appendChild(li);
      return;
    }

    // Opsi kosong
    if (this._opts.allowEmpty && !q) {
      const li = document.createElement('li');
      li.className = 'ss-option ss-option-empty' + (this._value === '' ? ' ss-selected' : '');
      li.dataset.value = '';
      li.textContent   = this._opts.emptyLabel;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(this._value === ''));
      li.addEventListener('click', () => this._select('', this._opts.emptyLabel));
      list.appendChild(li);
    }

    // Kelompokkan berdasarkan group
    const groups = new Map();
    filtered.forEach(o => {
      const g = o.group || '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(o);
    });

    groups.forEach((items, groupName) => {
      if (groupName) {
        const header = document.createElement('li');
        header.className   = 'ss-group-label';
        header.textContent = groupName;
        list.appendChild(header);
      }
      items.forEach(o => {
        const li = document.createElement('li');
        li.className     = 'ss-option' + (o.value === this._value ? ' ss-selected' : '');
        li.dataset.value = o.value;
        li.textContent   = o.label;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(o.value === this._value));
        li.addEventListener('click', () => this._select(o.value, o.label));
        list.appendChild(li);
      });
    });

    // Setelah render ulang, sesuaikan posisi panel
    this._positionPanel();
  }

  _select(value, label) {
    this._value = value;
    this._renderTrigger();
    this._close();
    if (this._opts.onChange) this._opts.onChange(value, label);
  }
}

/**
 * Helper: konversi <select> dengan <optgroup> menjadi array options.
 */
export function optionsFromSelect(selectEl) {
  const result = [];
  Array.from(selectEl.children).forEach(node => {
    if (node.tagName === 'OPTGROUP') {
      Array.from(node.children).forEach(opt => {
        if (opt.value) result.push({ value: opt.value, label: opt.text, group: node.label });
      });
    } else if (node.tagName === 'OPTION' && node.value) {
      result.push({ value: node.value, label: node.text, group: '' });
    }
  });
  return result;
}

/**
 * Helper: bangun array options dari data kelas Firebase.
 */
export function optionsFromClasses(classes) {
  return classes.map(c => ({
    value: c.id,
    label: c.nama_kelas || c.id,
    group: c.is_khusus === true ? 'Kelas Khusus' : 'Kelas Biasa',
  }));
}

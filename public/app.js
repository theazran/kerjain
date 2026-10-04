// KERJAIN — skrip frontend ringan (tanpa framework).
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const localTime = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const MAX_MB = 10;
  const MAX_FILES = 10;
  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* abaikan */ } },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* abaikan */ } },
  };
  const fileSize = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
  const svg = (d, cls = 'h-5 w-5') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const ICON = {
    success: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12.5l2.7 2.5L16 9.5',
    error: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4.5M12 16h.01',
    warning: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 11v5M12 8h.01',
    close: 'M6 6l12 12M18 6 6 18',
  };

  // ── Bar loading tipis di atas layar ──
  const progress = (() => {
    const el = $('#topbar');
    let active = 0;
    let safety;
    const set = (width, transition, opacity = 1) => { if (!el) return; el.style.transition = transition; el.style.opacity = opacity; el.style.width = width; };
    return {
      start() {
        active += 1;
        clearTimeout(safety);
        safety = setTimeout(() => this.reset(), 20000);
        if (active > 1 || !el) return;
        set('0', 'none');
        void el.offsetWidth;
        set('85%', 'width 8s cubic-bezier(.1,.7,.2,1)');
      },
      done() {
        active = Math.max(0, active - 1);
        if (active) return;
        clearTimeout(safety);
        set('100%', 'width .2s ease, opacity .3s ease .2s', 0);
      },
      reset() { active = 1; this.done(); },
    };
  })();
  const go = (url) => { progress.start(); if (url) location.href = url; else location.reload(); };

  // ── Toast ──
  function toast(message, type = 'success', action, duration) {
    const box = $('#toasts');
    if (!box) return;
    type = { ok: 'success' }[type] || type;
    while (box.children.length >= 3) box.firstElementChild.remove();
    const el = document.createElement('div');
    el.className = `toast toast-${type} is-enter`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span class="toast-icon">${svg(ICON[type] || ICON.info)}</span>
      <div class="toast-body"><p>${esc(message)}</p>${action ? `<a class="toast-action" href="${esc(action.href)}">${esc(action.label)}</a>` : ''}</div>
      <button type="button" class="toast-close" aria-label="Tutup notifikasi">${svg(ICON.close, 'h-4 w-4')}</button>`;
    box.appendChild(el);
    requestAnimationFrame(() => el.classList.remove('is-enter'));
    const close = () => { el.classList.add('is-leave'); setTimeout(() => el.remove(), 200); };
    let timer = setTimeout(close, duration || (type === 'error' ? 7000 : 4500));
    // Jeda saat disentuh/diarahkan kursor agar pesan sempat dibaca.
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => { timer = setTimeout(close, 2500); });
    $('.toast-close', el).addEventListener('click', close);
  }
  function flash(message, type = 'success', link) {
    try { sessionStorage.setItem('kerjain:flash', JSON.stringify({ message, type, link })); } catch (e) { /* abaikan */ }
  }
  try {
    const f = JSON.parse(sessionStorage.getItem('kerjain:flash') || 'null');
    if (f) { sessionStorage.removeItem('kerjain:flash'); setTimeout(() => toast(f.message, f.type, f.link), 50); }
  } catch (e) { /* abaikan */ }

  // ── Status koneksi ──
  const offlineBar = $('#offline');
  const syncOnline = (notify) => {
    offlineBar?.classList.toggle('hidden', navigator.onLine);
    if (notify && navigator.onLine) toast('Koneksi kembali tersambung.', 'info');
  };
  window.addEventListener('online', () => syncOnline(true));
  window.addEventListener('offline', () => syncOnline(false));
  syncOnline(false);

  // ── Permintaan ke server ──
  const OFFLINE_MSG = 'Tidak ada koneksi internet. Periksa koneksi Anda lalu coba kembali.';
  function handleResponse(status, data) {
    if (status === 401 && data.login) { flash(data.message, 'warning'); go('/masuk'); throw new Error(data.message); }
    if (status >= 400 || data.ok === false) throw new Error(data.message || 'Data belum berhasil disimpan. Silakan coba kembali.');
    return data;
  }
  async function request(method, url, body) {
    if (!navigator.onLine) throw new Error(OFFLINE_MSG);
    const opts = { method, headers: { Accept: 'application/json' }, credentials: 'same-origin' };
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const track = method !== 'GET';
    if (track) progress.start();
    try {
      let res;
      try { res = await fetch(url, opts); } catch (e) { throw new Error(OFFLINE_MSG); }
      return handleResponse(res.status, await res.json().catch(() => ({})));
    } finally { if (track) progress.done(); }
  }
  // Upload memakai XHR agar persentase upload dapat ditampilkan.
  function uploadRequest(url, formData, onProgress) {
    if (!navigator.onLine) return Promise.reject(new Error(OFFLINE_MSG));
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* abaikan */ }
        try { resolve(handleResponse(xhr.status, data)); } catch (err) { reject(err); }
      };
      xhr.onerror = () => reject(new Error(OFFLINE_MSG));
      xhr.send(formData);
    });
  }

  // Tombol dengan spinner dan label proses, mencegah klik ganda.
  async function busy(btn, label, fn) {
    if (!btn) return fn();
    if (btn.disabled && btn.classList.contains('is-busy')) return undefined;
    const old = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('is-busy');
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = `<span class="spinner"></span> <span data-busy-label>${esc(label)}</span>`;
    try { return await fn(btn); } finally {
      btn.disabled = false;
      btn.classList.remove('is-busy');
      btn.removeAttribute('aria-busy');
      btn.innerHTML = old;
    }
  }
  const setBusyLabel = (btn, label) => { const el = btn && $('[data-busy-label]', btn); if (el) el.textContent = label; };

  const formObject = (form) => {
    const data = {};
    for (const [k, v] of new FormData(form)) {
      if (v instanceof File) continue;
      if (k in data) data[k] = [].concat(data[k], v); else data[k] = v;
    }
    return data;
  };

  // ── Dialog konfirmasi ──
  const confirmBox = $('#confirm');
  function confirmDialog({ title = 'Konfirmasi', message = '', ok = 'Hapus' } = {}) {
    if (!confirmBox) return Promise.resolve(window.confirm(message || title));
    $('[data-confirm-title]', confirmBox).textContent = title;
    $('[data-confirm-message]', confirmBox).textContent = message;
    $('[data-confirm-ok]', confirmBox).textContent = ok;
    confirmBox.showModal();
    $('[data-confirm-cancel]', confirmBox).focus();
    return new Promise((resolve) => {
      const done = (value) => () => { cleanup(); confirmBox.close(); resolve(value); };
      const yes = done(true);
      const no = done(false);
      const onCancel = (e) => { e.preventDefault(); no(); };
      const onBackdrop = (e) => { if (e.target === confirmBox) no(); };
      function cleanup() {
        $('[data-confirm-ok]', confirmBox).removeEventListener('click', yes);
        $('[data-confirm-cancel]', confirmBox).removeEventListener('click', no);
        confirmBox.removeEventListener('cancel', onCancel);
        confirmBox.removeEventListener('click', onBackdrop);
      }
      $('[data-confirm-ok]', confirmBox).addEventListener('click', yes);
      $('[data-confirm-cancel]', confirmBox).addEventListener('click', no);
      confirmBox.addEventListener('cancel', onCancel);
      confirmBox.addEventListener('click', onBackdrop);
    });
  }

  // ── Pesan error per kolom ──
  function fieldError(input, message) {
    if (!input) return;
    const box = input.closest('div');
    $('.field-error', box)?.remove();
    input.classList.toggle('input-error', !!message);
    input.toggleAttribute('aria-invalid', !!message);
    if (!message) return;
    const p = document.createElement('p');
    p.className = 'field-error';
    p.id = `${input.id || input.name}-error`;
    p.textContent = message;
    input.setAttribute('aria-describedby', p.id);
    input.insertAdjacentElement('afterend', p);
    input.focus();
  }
  document.addEventListener('input', (e) => { if (e.target.classList?.contains('input-error')) fieldError(e.target, ''); });

  // Penghitung karakter untuk kolom judul.
  $$('[data-counter]').forEach((input) => {
    const max = Number(input.maxLength) || 200;
    const el = document.createElement('p');
    el.className = 'counter';
    input.insertAdjacentElement('afterend', el);
    const sync = () => { el.textContent = `${input.value.length}/${max}`; el.classList.toggle('is-near', input.value.length > max * 0.85); el.hidden = !input.value.length; };
    input.addEventListener('input', sync);
    input._syncCounter = sync;
    sync();
  });

  // ── Kategori → Subkategori ──
  let kategoriMap = {};
  try { kategoriMap = JSON.parse($('#kategori-data')?.textContent || '{}'); } catch (e) { /* abaikan */ }
  $$('[data-kategori]').forEach((sel) => {
    const form = sel.form;
    const sub = $('[data-subkategori]', form);
    const fill = () => {
      const current = sub.value || sub.dataset.value;
      const subs = kategoriMap[sel.value] || [];
      sub.innerHTML = `<option value="">${subs.length ? 'Pilih subkategori' : 'Tidak ada subkategori'}</option>` + subs.map((s) => `<option${s === current ? ' selected' : ''}>${esc(s)}</option>`).join('');
      sub.disabled = !subs.length;
      if (sel.value === 'Bantuan Pegawai') $('[data-extra]', form)?.setAttribute('open', '');
    };
    sel.addEventListener('change', () => { sub.value = ''; sub.dataset.value = ''; fill(); });
    fill();
  });

  // Kolom Hasil hanya tampil bila status Selesai.
  $$('form').forEach((form) => {
    const box = $('[data-hasil]', form);
    if (!box || !form.elements.status) return;
    const sync = () => box.classList.toggle('hidden', form.elements.status.value !== 'Selesai');
    form.addEventListener('change', (e) => { if (e.target.name === 'status') sync(); });
    form._syncHasil = sync;
    sync();
  });

  // Isi tanggal/waktu dari perangkat pengguna, tombol "Sekarang", dan durasi.
  $$('[data-today="1"]').forEach((i) => { if (!i.value) i.value = localDate(); });
  $$('[data-now="1"]').forEach((i) => { if (!i.value) i.value = localTime(); });
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-now-for]');
    if (!btn) return;
    const input = document.getElementById(btn.dataset.nowFor);
    input.value = localTime();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  $$('[data-duration]').forEach((box) => {
    const [mulai, selesai] = $$('input[type=time]', box);
    const label = box.parentElement.querySelector('[data-duration-label]');
    const sync = () => {
      const [h1, m1] = mulai.value.split(':').map(Number);
      const [h2, m2] = selesai.value.split(':').map(Number);
      const menit = h2 * 60 + m2 - (h1 * 60 + m1);
      fieldError(selesai, '');
      if (!mulai.value || !selesai.value || Number.isNaN(menit)) { label.hidden = true; return; }
      label.hidden = false;
      if (menit <= 0) { label.querySelector('span').textContent = 'Waktu selesai lebih awal dari waktu mulai.'; label.classList.add('text-amber-600'); return; }
      label.classList.remove('text-amber-600');
      label.querySelector('span').textContent = `Durasi ${[Math.floor(menit / 60) ? `${Math.floor(menit / 60)} jam` : '', menit % 60 ? `${menit % 60} menit` : ''].filter(Boolean).join(' ')}`;
    };
    [mulai, selesai].forEach((i) => { i.addEventListener('input', sync); i.addEventListener('change', sync); });
    sync();
  });

  // ── Peringatan perubahan yang belum disimpan ──
  let leaving = false;
  const guarded = new Set();
  $$('[data-guard], [data-settings-form], [data-kb-form]').forEach((form) => {
    form.addEventListener('input', () => { form.dataset.dirty = '1'; guarded.add(form); });
    form.addEventListener('change', () => { form.dataset.dirty = '1'; guarded.add(form); });
    form.addEventListener('reset', () => { delete form.dataset.dirty; guarded.delete(form); });
  });
  const markSaved = (form) => { if (form) { delete form.dataset.dirty; guarded.delete(form); } leaving = true; };
  window.addEventListener('beforeunload', (e) => {
    if (leaving || ![...guarded].some((f) => f.dataset.dirty)) return;
    e.preventDefault();
    e.returnValue = '';
    progress.reset();
  });

  // Ctrl/Cmd + Enter menyimpan form dari kolom mana pun.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target.form) { e.preventDefault(); e.target.form.requestSubmit(); }
  });

  // ── Quick log (catat cepat) ──
  const quick = $('#quick');
  if (quick) {
    const form = $('#quick-form');
    const DRAFT = 'kerjain:quick-draft';
    const judul = form.elements.judul;
    const draftNote = $('[data-quick-draft]', form);
    let draftTimer;

    const open = () => {
      const now = new Date();
      $('[data-quick-when]', quick).textContent = `Hari ini, ${now.getDate()} ${BULAN[now.getMonth()]} ${now.getFullYear()} · ${localTime(now)}`;
      const draft = store.get(DRAFT);
      if (draft?.judul && !judul.value) {
        judul.value = draft.judul;
        if (kategoriMap[draft.kategori]) form.elements.kategori.value = draft.kategori;
        if (draft.status) form.elements.status.value = draft.status;
        form.elements.hasil.value = draft.hasil || '';
        draftNote.classList.remove('hidden');
      } else if (!judul.value) {
        const last = store.get('kerjain:kategori');
        if (last && kategoriMap[last]) form.elements.kategori.value = last;
      }
      form._syncHasil?.();
      judul._syncCounter?.();
      if (!quick.open) quick.showModal();
      setTimeout(() => judul.focus(), 60);
    };
    const clearDraft = () => { store.remove(DRAFT); draftNote.classList.add('hidden'); };

    document.addEventListener('click', (e) => { if (e.target.closest('[data-quick]')) { e.preventDefault(); open(); } });
    $('[data-close]', quick).addEventListener('click', () => quick.close());
    quick.addEventListener('click', (e) => { if (e.target === quick) quick.close(); });
    $('[data-quick-clear]', form).addEventListener('click', () => { form.reset(); clearDraft(); form._syncHasil?.(); judul._syncCounter?.(); fieldError(judul, ''); judul.focus(); });
    form.addEventListener('input', () => {
      clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        const d = formObject(form);
        if (d.judul.trim()) store.set(DRAFT, { judul: d.judul, kategori: d.kategori, status: d.status, hasil: d.hasil }); else store.remove(DRAFT);
      }, 300);
    });
    // Isi judul yang sudah diketik ikut terbawa ke form lengkap.
    $('[data-quick-full]', form).addEventListener('click', (e) => {
      if (!judul.value.trim()) return;
      e.preventDefault();
      go(`/pekerjaan/baru?judul=${encodeURIComponent(judul.value.trim())}&kategori=${encodeURIComponent(form.elements.kategori.value)}`);
    });

    // Pintasan /?catat=1 (dari ikon layar utama) langsung membuka form catat.
    if (new URLSearchParams(location.search).get('catat') === '1') {
      history.replaceState(null, '', location.pathname);
      open();
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = formObject(form);
      if (!data.judul.trim()) { fieldError(judul, 'Tuliskan pekerjaan yang dikerjakan.'); return; }
      data.tanggal = localDate();
      data.waktu_mulai = localTime();
      if (data.status === 'Selesai' && data.hasil) data.waktu_selesai = data.waktu_mulai;
      try {
        const res = await busy($('[type=submit]', form), 'Menyimpan...', () => request('POST', '/api/pekerjaan', data));
        store.set('kerjain:kategori', data.kategori);
        clearDraft();
        const action = { href: `/pekerjaan/${res.id}/edit`, label: 'Lengkapi detail →' };
        // Halaman yang menampilkan daftar dimuat ulang; halaman lain cukup diberi notifikasi.
        if (['/', '/pekerjaan', '/kalender'].includes(location.pathname)) { flash(res.message, 'success', action); go(); return; }
        form.reset();
        quick.close();
        toast(res.message, 'success', action);
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  // ── Kompresi foto & upload evidence ──
  const ALLOWED = /\.(jpe?g|png|webp|heic|heif|pdf|docx?|xlsx?|txt)$/i;
  const extOf = (name) => (name.split('.').pop() || '').toUpperCase().slice(0, 4);

  async function compressImage(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((ok) => canvas.toBlob(ok, 'image/jpeg', 0.82));
      if (!blob || blob.size >= file.size) return file;
      return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch (e) { return file; }
  }

  // Tiap area upload menyimpan daftar file yang dipilih beserta pratinjau.
  const pending = new WeakMap();
  const renderFiles = (box) => {
    const items = pending.get(box);
    $('[data-file-list]', box).innerHTML = items.map((it, i) => `
      <li class="file-item">
        <span class="file-thumb">${it.preview ? `<img src="${it.preview}" alt="">` : esc(extOf(it.file.name))}</span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-medium text-slate-800">${esc(it.file.name)}</span>
          <span class="text-xs text-slate-500">${fileSize(it.file.size)}${it.original > it.file.size ? ` · dikompresi dari ${fileSize(it.original)}` : ''}</span>
        </span>
        <button type="button" class="icon-btn h-8 w-8 text-slate-400 hover:text-red-600" data-remove="${i}" aria-label="Hapus ${esc(it.file.name)}">${svg(ICON.close, 'h-4 w-4')}</button>
      </li>`).join('');
    const submit = box.closest('form')?.querySelector('[data-upload-submit]');
    if (submit) {
      submit.disabled = !items.length;
      submit.lastChild.textContent = items.length ? ` Upload ${items.length} File` : ' Upload Evidence';
    }
  };
  async function addFiles(box, files) {
    const items = pending.get(box);
    for (const file of files) {
      if (items.length >= MAX_FILES) { toast(`Maksimal ${MAX_FILES} file sekali upload.`, 'warning'); break; }
      if (!ALLOWED.test(file.name)) { toast(`${file.name}: tipe file tidak didukung.`, 'error'); continue; }
      const ready = await compressImage(file);
      if (ready.size > MAX_MB * 1024 * 1024) { toast(`${file.name}: ukuran maksimal ${MAX_MB} MB.`, 'error'); continue; }
      items.push({ file: ready, original: file.size, preview: /^image\/(jpeg|png|webp|gif)$/.test(ready.type) ? URL.createObjectURL(ready) : '' });
    }
    renderFiles(box);
    box.closest('form')?.dispatchEvent(new Event('change'));
  }
  const clearFiles = (box) => { pending.get(box).forEach((it) => it.preview && URL.revokeObjectURL(it.preview)); pending.set(box, []); renderFiles(box); };

  $$('[data-upload]').forEach((box) => {
    pending.set(box, []);
    $('[data-file-list]', box).addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (!btn) return;
      const [it] = pending.get(box).splice(Number(btn.dataset.remove), 1);
      if (it?.preview) URL.revokeObjectURL(it.preview);
      renderFiles(box);
    });
    $$('[data-files]', box).forEach((input) => input.addEventListener('change', async () => { await addFiles(box, [...input.files]); input.value = ''; }));
    // Seret & lepas file (desktop).
    ['dragenter', 'dragover'].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); box.classList.add('is-drag'); }));
    ['dragleave', 'drop'].forEach((ev) => box.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'drop' || !box.contains(e.relatedTarget)) box.classList.remove('is-drag'); }));
    box.addEventListener('drop', (e) => addFiles(box, [...(e.dataTransfer?.files || [])]));
  });

  async function uploadEvidence(id, box, btn) {
    const items = pending.get(box) || [];
    if (!items.length) return null;
    const fd = new FormData();
    items.forEach((it) => fd.append('files', it.file, it.file.name));
    const wrap = $('[data-upload-progress]', box);
    const bar = $('[data-upload-bar]', box);
    const pct = $('[data-upload-pct]', box);
    $('[data-upload-label]', box).textContent = `Mengupload ${items.length} file ke Google Drive...`;
    wrap.classList.remove('hidden');
    bar.style.width = '0%';
    progress.start();
    try {
      const res = await uploadRequest(`/api/pekerjaan/${encodeURIComponent(id)}/evidence`, fd, (ratio) => {
        const value = Math.round(ratio * 100);
        bar.style.width = `${value}%`;
        pct.textContent = value >= 100 ? 'Memproses...' : `${value}%`;
        setBusyLabel(btn, value >= 100 ? 'Menyimpan ke Drive...' : `Mengupload ${value}%`);
      });
      clearFiles(box);
      return res;
    } finally {
      progress.done();
      wrap.classList.add('hidden');
    }
  }

  // ── Form pekerjaan lengkap ──
  const pForm = $('[data-form-pekerjaan]');
  if (pForm) {
    // Prefill dari quick log ("Isi form lengkap").
    const qp = new URLSearchParams(location.search);
    if (!pForm.dataset.id && qp.get('judul') && !pForm.elements.judul.value) {
      pForm.elements.judul.value = qp.get('judul').slice(0, 200);
      pForm.elements.judul._syncCounter?.();
      if (kategoriMap[qp.get('kategori')]) { pForm.elements.kategori.value = qp.get('kategori'); pForm.elements.kategori.dispatchEvent(new Event('change')); }
    }
    pForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = formObject(pForm);
      if (!data.judul.trim()) { fieldError(pForm.elements.judul, 'Judul pekerjaan wajib diisi.'); return; }
      if (data.waktu_mulai && data.waktu_selesai && data.waktu_selesai <= data.waktu_mulai) {
        fieldError(pForm.elements.waktu_selesai, 'Waktu selesai harus setelah waktu mulai.');
        return;
      }
      const id = pForm.dataset.id;
      const box = $('[data-upload]', pForm);
      await busy($('[type=submit]', pForm), 'Menyimpan...', async (btn) => {
        let res;
        try { res = await request(id ? 'PUT' : 'POST', id ? `/api/pekerjaan/${encodeURIComponent(id)}` : '/api/pekerjaan', data); } catch (err) { toast(err.message, 'error'); return; }
        markSaved(pForm);
        try {
          const up = await uploadEvidence(res.id, box, btn);
          flash(up ? `${res.message} Evidence berhasil diupload.` : res.message);
        } catch (err) {
          flash('Pekerjaan berhasil disimpan, tetapi evidence belum berhasil diupload.', 'warning');
        }
        go(`/pekerjaan/${encodeURIComponent(res.id)}`);
      });
    });
  }

  // ── Detail: daftar & upload evidence ──
  const evBox = $('[data-evidence]');
  if (evBox) {
    const id = evBox.dataset.evidence;
    const list = $('[data-evidence-list]', evBox);
    const formatTgl = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getDate()} ${BULAN[d.getMonth()]} ${d.getFullYear()}, ${localTime(d)}`; };
    const load = async () => {
      try {
        const res = await request('GET', `/api/pekerjaan/${encodeURIComponent(id)}/evidence`);
        $('[data-evidence-count]', evBox).textContent = res.files.length || '';
        if (res.url) { const link = $('[data-evidence-folder]', evBox); link.href = res.url; link.classList.remove('hidden'); }
        list.innerHTML = res.files.length ? res.files.map((f) => `
          <li><a href="${esc(f.url)}" target="_blank" rel="noopener">
            <span class="file-thumb ${f.image ? 'bg-blue-50 text-blue-600' : ''}">${f.image ? svg('M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15 9h.01', 'h-5 w-5') : esc(extOf(f.name))}</span>
            <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium text-slate-800">${esc(f.name)}</span>
            <span class="text-xs text-slate-500">${[f.size ? fileSize(f.size) : '', formatTgl(f.created)].filter(Boolean).join(' · ')}</span></span>
          </a></li>`).join('') : `<li class="empty py-5"><p class="text-sm text-slate-500">Belum ada evidence.</p></li>`;
      } catch (err) {
        list.innerHTML = `<li class="notice notice-warn">${esc(err.message)} <button type="button" class="font-medium underline" data-evidence-retry>Coba lagi</button></li>`;
      }
    };
    list.addEventListener('click', (e) => { if (e.target.closest('[data-evidence-retry]')) load(); });
    if (evBox.dataset.hasFolder) load();
    $('[data-upload-form]', evBox).addEventListener('submit', async (e) => {
      e.preventDefault();
      const box = $('[data-upload]', evBox);
      if (!(pending.get(box) || []).length) { toast('Pilih foto atau file terlebih dahulu.', 'warning'); return; }
      try {
        const res = await busy($('[type=submit]', e.target), 'Mengupload...', (btn) => uploadEvidence(id, box, btn));
        toast(res.message);
        list.innerHTML = '<li class="flex items-center gap-3 p-2"><span class="skeleton h-9 w-9"></span><span class="flex-1 space-y-1.5"><span class="skeleton block h-3 w-3/4"></span><span class="skeleton block h-2.5 w-1/3"></span></span></li>';
        load();
      } catch (err) {
        toast(/Evidence|Ukuran|Tipe|Pilih|Sesi|koneksi|Maksimal/i.test(err.message) ? err.message : 'Evidence belum berhasil disimpan. Silakan coba kembali.', 'error');
      } finally {
        renderFiles(box);
      }
    });
  }

  // Tombol pembuka dialog umum dan penutupnya.
  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-open]');
    if (opener) { const dlg = $(opener.dataset.open); dlg?.showModal(); setTimeout(() => $('textarea, input', dlg)?.focus(), 60); return; }
    const closer = e.target.closest('dialog [data-close]');
    if (closer && !closer.closest('#quick, #install-ios')) closer.closest('dialog').close();
  });
  $$('dialog.sheet').forEach((dlg) => dlg.addEventListener('click', (e) => { if (e.target === dlg && !['quick', 'install-ios'].includes(dlg.id)) dlg.close(); }));

  // Tandai pekerjaan selesai (hasil + waktu selesai).
  const selesaiForm = $('[data-selesai-form]');
  if (selesaiForm) {
    selesaiForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await busy($('[type=submit]', selesaiForm), 'Menyimpan...', () =>
          request('PATCH', `/api/pekerjaan/${encodeURIComponent(selesaiForm.dataset.selesaiForm)}/selesai`, formObject(selesaiForm)));
        flash(res.message);
        go();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  // Salin teks (misalnya ID pekerjaan).
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    try { await navigator.clipboard.writeText(btn.dataset.copy); toast('ID pekerjaan disalin.', 'info', null, 2000); } catch (err) { toast('Teks belum berhasil disalin.', 'error'); }
  });

  // ── Hapus dengan konfirmasi ──
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-delete]');
    if (!btn) return;
    const ok = await confirmDialog({ title: btn.dataset.confirmTitle || 'Hapus data?', message: btn.dataset.confirm || 'Data yang dihapus tidak dapat dikembalikan.', ok: 'Hapus' });
    if (!ok) return;
    try {
      const res = await busy(btn, 'Menghapus...', () => request('DELETE', btn.dataset.delete));
      flash(res.message);
      markSaved();
      go(btn.dataset.redirect);
    } catch (err) { toast(err.message, 'error'); }
  });

  // ── Pencarian dengan debounce & muat lagi ──
  const filterForm = $('#filter-form');
  if (filterForm) {
    const listEl = $('#list');
    const search = $('[data-search]', filterForm);
    const spin = $('[data-search-spin]', filterForm);
    const kbd = $('[data-search-kbd]', filterForm);
    let timer;
    let controller;
    const syncKbd = () => kbd?.classList.toggle('md:inline-flex', !search.value && document.activeElement !== search);
    const run = async () => {
      const params = new URLSearchParams(new FormData(filterForm));
      for (const [k, v] of [...params]) if (!v) params.delete(k);
      history.replaceState(null, '', `/pekerjaan${params.toString() ? '?' + params : ''}`);
      params.set('partial', '1');
      controller?.abort();
      controller = new AbortController();
      spin.classList.remove('hidden');
      kbd?.classList.remove('md:inline-flex');
      listEl.classList.add('is-loading');
      try {
        const res = await fetch(`/pekerjaan?${params}`, { signal: controller.signal, credentials: 'same-origin' });
        if (res.redirected && res.url.includes('/masuk')) { go('/masuk'); return; }
        listEl.innerHTML = await res.text();
      } catch (err) {
        if (err.name !== 'AbortError') toast(navigator.onLine ? 'Pencarian belum berhasil. Silakan coba kembali.' : OFFLINE_MSG, 'error');
      } finally {
        if (!controller.signal.aborted) { spin.classList.add('hidden'); listEl.classList.remove('is-loading'); syncKbd(); }
      }
    };
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 350); });
    search.addEventListener('keydown', (e) => { if (e.key === 'Escape' && search.value) { e.preventDefault(); search.value = ''; run(); } });
    search.addEventListener('focus', syncKbd);
    search.addEventListener('blur', syncKbd);
    $$('[data-filter]', filterForm).forEach((el) => el.addEventListener('change', run));
    filterForm.addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(timer); run(); search.blur(); });
    syncKbd();

    listEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-more]');
      if (!btn) return;
      await busy(btn, 'Memuat...', async () => {
        try {
          const html = await (await fetch(btn.dataset.more, { credentials: 'same-origin' })).text();
          const tpl = document.createElement('template');
          tpl.innerHTML = html;
          btn.remove();
          // Gabungkan grup tanggal yang sama dengan grup terakhir.
          const groups = $$('.day-group', listEl);
          const last = groups[groups.length - 1];
          const first = $('.day-group', tpl.content);
          if (last && first && first.dataset.date === last.dataset.date) {
            $('[data-items]', last).append(...$('[data-items]', first).children);
            first.remove();
          }
          listEl.append(tpl.content);
        } catch (err) { toast('Data belum berhasil dimuat.', 'error'); }
      });
    });
  }

  // ── Pekerjaan rutin ──
  const rutinForm = $('[data-rutin-form]');
  if (rutinForm && $('[data-rutin-submit]', rutinForm)) {
    const boxes = $$('input[name=ids]', rutinForm);
    const submit = $('[data-rutin-submit]', rutinForm);
    const allBtn = $('[data-rutin-all]', rutinForm);
    const sync = () => {
      const n = boxes.filter((b) => b.checked).length;
      $('[data-rutin-count]', rutinForm).textContent = n ? `${n} dari ${boxes.length} dipilih` : 'Belum ada yang dipilih';
      submit.disabled = !n;
      submit.textContent = n ? `Catat ${n} Pekerjaan` : 'Catat yang Dipilih';
      allBtn.textContent = n === boxes.length ? 'Batal pilih' : 'Pilih semua';
    };
    rutinForm.addEventListener('change', sync);
    allBtn.addEventListener('click', () => { const all = boxes.every((b) => b.checked); boxes.forEach((b) => { b.checked = !all; }); sync(); });
    rutinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = formObject(rutinForm);
      if (!data.ids) { toast('Pilih minimal satu pekerjaan rutin.', 'warning'); return; }
      try {
        const res = await busy(submit, 'Menyimpan...', () => request('POST', '/api/rutin/catat', data));
        flash(res.message);
        go('/');
      } catch (err) { toast(err.message, 'error'); }
    });
    sync();
  }

  // ── Form generik (pengaturan, rutin, knowledge) ──
  function bindForm(sel, method, url, validate, after) {
    const form = $(sel);
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = formObject(form);
      if (validate && !validate(form, data)) return;
      try {
        const res = await busy($('[type=submit]', form), 'Menyimpan...', () => request(method(data), url(data), data));
        flash(res.message);
        markSaved(form);
        go(after);
      } catch (err) { toast(err.message, 'error'); }
    });
  }
  bindForm('[data-settings-form]', () => 'POST', () => '/api/pengaturan', (form, d) => {
    if (d.tahun && !/^\d{4}$/.test(d.tahun)) { fieldError(form.elements.tahun, 'Tahun harus 4 digit angka.'); return false; }
    return true;
  });
  bindForm('[data-rutin-add]', () => 'POST', () => '/api/rutin', (form, d) => {
    if (!d.judul.trim()) { fieldError(form.elements.judul, 'Isi nama pekerjaan rutin.'); return false; }
    return true;
  });
  bindForm('[data-kb-form]', (d) => (d.id ? 'PUT' : 'POST'), (d) => (d.id ? `/api/knowledge/${encodeURIComponent(d.id)}` : '/api/knowledge'), (form, d) => {
    if (!d.judul.trim()) { fieldError(form.elements.judul, 'Judul artikel wajib diisi.'); return false; }
    if (d.evidence_url && !/^https:\/\//i.test(d.evidence_url)) { fieldError(form.elements.evidence_url, 'Link harus diawali https://'); return false; }
    return true;
  }, '/knowledge');

  const kbForm = $('[data-kb-form]');
  if (kbForm) {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-kb-edit]');
      if (!btn) return;
      const k = JSON.parse(btn.dataset.kbEdit);
      for (const name of ['id', 'kelompok', 'judul', 'masalah', 'penyebab', 'solusi', 'evidence_url']) kbForm.elements[name].value = k[name] || '';
      $('[data-kb-title]', kbForm).textContent = 'Edit Artikel';
      kbForm.scrollIntoView({ behavior: 'smooth' });
      kbForm.elements.judul.focus({ preventScroll: true });
    });
    kbForm.addEventListener('reset', () => { $('[data-kb-title]', kbForm).textContent = 'Tambah Artikel'; setTimeout(() => { kbForm.elements.id.value = ''; }); });
    if (kbForm.hasAttribute('data-open')) kbForm.elements.judul.focus();
  }

  // ── Cetak / Export PDF ──
  $$('[data-print]').forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.print === 'pdf') toast('Pilih "Simpan sebagai PDF" pada jendela cetak.', 'info');
    setTimeout(() => window.print(), btn.dataset.print === 'pdf' ? 600 : 0);
  }));

  // ── Grafik (Chart.js, satu warna biru, tanpa legenda) ──
  if (window.Chart) {
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.color = '#475569';
    $$('canvas[data-chart]').forEach((canvas) => {
      const rows = JSON.parse(canvas.dataset.chart);
      new Chart(canvas, {
        type: 'bar',
        data: { labels: rows.map((r) => r.label), datasets: [{ data: rows.map((r) => r.total), backgroundColor: '#2563EB', hoverBackgroundColor: '#1D4ED8', borderRadius: 4, borderSkipped: 'start', barThickness: 18 }] },
        options: {
          indexAxis: 'y', maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: { label: (c) => `${c.raw} pekerjaan` } } },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#F1F5F9' }, border: { display: false } },
            y: { grid: { display: false }, border: { color: '#E2E8F0' } },
          },
        },
      });
    });
  }

  // ── Kalender (FullCalendar) ──
  const calEl = $('#calendar');
  if (calEl && window.FullCalendar) {
    const panel = $('#day-panel');
    const skeleton = Array.from({ length: 3 }, () => '<div class="flex items-center gap-3 px-1 py-2.5"><span class="skeleton h-4 w-10"></span><span class="skeleton h-2.5 w-2.5 rounded-full"></span><span class="flex-1 space-y-1.5"><span class="skeleton block h-3 w-3/4"></span><span class="skeleton block h-2.5 w-1/3"></span></span></div>').join('');
    let current = 0;
    const showDay = async (date, scroll = true) => {
      const ticket = ++current;
      $$('.fc-day-selected', calEl).forEach((el) => el.classList.remove('fc-day-selected'));
      $(`.fc-daygrid-day[data-date="${date}"]`, calEl)?.classList.add('fc-day-selected');
      const listEl = $('[data-day-list]', panel);
      listEl.innerHTML = skeleton;
      $('[data-day-add]', panel).href = `/pekerjaan/baru?tanggal=${date}`;
      try {
        const res = await request('GET', `/api/hari/${date}`);
        if (ticket !== current) return;
        $('[data-day-label]', panel).textContent = res.label;
        $('[data-day-count]', panel).textContent = res.items.length ? `${res.items.length} pekerjaan` : 'Tidak ada pekerjaan';
        listEl.innerHTML = res.items.length ? res.items.map((p) => `
          <a href="/pekerjaan/${encodeURIComponent(p.id)}" class="tl-item">
            <div class="tl-time">${esc(p.waktu || '—')}</div>
            <div class="tl-dot ${p.status === 'Selesai' ? 'bg-green-600' : 'bg-amber-600'}"></div>
            <div class="min-w-0 flex-1"><div class="truncate font-medium text-slate-900">${esc(p.judul)}</div><div class="text-xs text-slate-500">${esc(p.kategori)}</div></div>
            <span class="badge ${p.status === 'Selesai' ? 'badge-ok' : 'badge-warn'}">${esc(p.status)}</span>
          </a>`).join('') : `<div class="empty py-6"><p class="text-sm text-slate-500">Belum ada pekerjaan pada tanggal ini.</p><a href="/pekerjaan/baru?tanggal=${date}" class="btn btn-outline btn-sm mt-3">+ Catat pada tanggal ini</a></div>`;
        if (scroll && window.innerWidth < 1024) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        if (ticket === current) listEl.innerHTML = `<p class="notice notice-warn">${esc(err.message)}</p>`;
      }
    };
    const cal = new FullCalendar.Calendar(calEl, {
      locale: 'id', initialView: 'dayGridMonth', firstDay: 1, height: 'auto', fixedWeekCount: false,
      headerToolbar: { left: 'title', center: '', right: 'prev,today,next' },
      buttonText: { today: 'Hari ini' }, dayMaxEvents: 3,
      loading: (isLoading) => calEl.classList.toggle('is-loading', isLoading),
      events: (info, ok, no) => request('GET', `/api/kalender?start=${info.startStr.slice(0, 10)}&end=${info.endStr.slice(0, 10)}`).then(ok).catch((e) => { toast(e.message, 'error'); no(e); }),
      dateClick: (info) => showDay(info.dateStr),
      eventClick: (info) => showDay(info.event.startStr.slice(0, 10)),
    });
    cal.render();
    setTimeout(() => showDay(panel.dataset.today, false), 0);
  }

  // ── Sapaan sesuai waktu perangkat ──
  const greet = $('[data-greeting]');
  if (greet) {
    const h = new Date().getHours();
    const waktu = h < 11 ? 'pagi' : h < 15 ? 'siang' : h < 18 ? 'sore' : 'malam';
    greet.textContent = `Selamat ${waktu}${greet.dataset.name ? `, ${greet.dataset.name}` : ''}`;
  }

  // ── Pasang aplikasi (PWA) ──
  // Android/desktop Chrome memakai prompt bawaan; iPhone/iPad menampilkan panduan langkah demi langkah.
  {
    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isIPad = /ipad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const inApp = /FBAN|FBAV|Instagram|Line\/|GSA\//i.test(ua);
    const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    const DISMISS_KEY = 'kerjain:install-dismissed';
    const banner = $('[data-install-banner]');
    const iosSheet = $('#install-ios');
    let deferred = null;

    const dismissedRecently = () => Date.now() - Number(store.get(DISMISS_KEY) || 0) < 14 * 24 * 60 * 60 * 1000;
    const refresh = () => {
      const canInstall = !standalone && (deferred || isIOS);
      banner?.classList.toggle('hidden', !canInstall || dismissedRecently());
      const status = $('[data-install-status]');
      if (status && standalone) {
        status.textContent = 'KERJAIN sudah terpasang dan sedang dibuka sebagai aplikasi.';
        $$('[data-install]').forEach((b) => b.classList.add('hidden'));
      }
    };

    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; refresh(); });
    window.addEventListener('appinstalled', () => { deferred = null; banner?.classList.add('hidden'); toast('KERJAIN berhasil dipasang di perangkat Anda.'); });

    document.addEventListener('click', async (e) => {
      if (e.target.closest('[data-install-dismiss]')) {
        store.set(DISMISS_KEY, Date.now());
        banner?.classList.add('hidden');
        toast('Anda dapat memasang KERJAIN kapan saja dari Pengaturan.', 'info');
        return;
      }
      if (!e.target.closest('[data-install]')) return;
      if (deferred) {
        deferred.prompt();
        const { outcome } = await deferred.userChoice.catch(() => ({}));
        deferred = null;
        if (outcome === 'accepted') banner?.classList.add('hidden');
      } else if (isIOS && iosSheet) {
        $('[data-install-inapp]', iosSheet).classList.toggle('hidden', !inApp);
        $('[data-install-where]', iosSheet).textContent = /CriOS|FxiOS|EdgiOS/.test(ua) ? 'di bilah alamat browser'
          : isIPad ? 'di kanan atas Safari' : 'di bilah bawah Safari';
        iosSheet.showModal();
      } else {
        toast('Buka menu browser, lalu pilih "Pasang aplikasi" atau "Tambahkan ke Layar Utama".', 'info');
      }
    });

    if (iosSheet) {
      $$('[data-close]', iosSheet).forEach((b) => b.addEventListener('click', () => iosSheet.close()));
      iosSheet.addEventListener('click', (e) => { if (e.target === iosSheet) iosSheet.close(); });
    }
    refresh();
  }

  // ── Bar loading saat pindah halaman ──
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('download') || a.getAttribute('href').startsWith('#')) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search && url.hash)) return;
    progress.start();
  });
  document.addEventListener('submit', (e) => {
    setTimeout(() => { if (!e.defaultPrevented && e.target.method === 'get') progress.start(); });
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) progress.reset(); });

  // ── Pintasan keyboard (desktop): C = catat, / = cari ──
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]') || $('dialog[open]')) return;
    if (e.key.toLowerCase() === 'c' && quick) { e.preventDefault(); $('[data-quick]')?.click(); }
    if (e.key === '/' && $('[data-search]')) { e.preventDefault(); $('[data-search]').focus(); }
  });

  // PWA: daftarkan service worker (butuh HTTPS atau localhost).
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // Jaga input tetap terlihat saat keyboard HP muncul.
  if (matchMedia('(max-width: 767px)').matches) {
    document.addEventListener('focusin', (e) => {
      if (e.target.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select')) {
        setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
      }
    });
  }
})();

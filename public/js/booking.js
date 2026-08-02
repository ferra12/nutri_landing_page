/* =========================================
   BOOKING WIDGET
   ========================================= */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const BW = {
    type:      'prima-visita',
    studio:    'studio-1',
    weekStart: null,

    init() {
      if (!$('bookingWidget')) return;

      // Calcola il lunedì della settimana corrente (o prossima se è weekend)
      const today = new Date();
      const monday = new Date(today);
      const dow = today.getDay(); // 0=Dom, 6=Sab
      if (dow === 0) {
        monday.setDate(today.getDate() + 1);       // domenica → lunedì prossimo
      } else if (dow === 6) {
        monday.setDate(today.getDate() + 2);       // sabato → lunedì prossimo
      } else {
        monday.setDate(today.getDate() - (dow - 1)); // lun–ven → lunedì corrente
      }
      monday.setHours(0, 0, 0, 0);
      this.weekStart = monday;

      // Bottoni studio
      document.querySelectorAll('.bw-studio-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.bw-studio-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.studio = btn.dataset.studio;
          this.loadSlots();
        });
      });

      // Bottoni tipo visita
      document.querySelectorAll('.bw-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.bw-type-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.type = btn.dataset.type;
          this.loadSlots();
        });
      });

      // Navigazione settimana
      $('bwPrevWeek').addEventListener('click', () => {
        const prev = new Date(this.weekStart);
        prev.setDate(prev.getDate() - 7);
        this.weekStart = prev;
        this.loadSlots();
      });

      $('bwNextWeek').addEventListener('click', () => {
        const next = new Date(this.weekStart);
        next.setDate(next.getDate() + 7);
        this.weekStart = next;
        this.loadSlots();
      });

      // Form step
      $('bwBackBtn').addEventListener('click', () => this.show('calendar'));
      $('bwForm').addEventListener('submit', e => this.submitBooking(e));
      $('bwNewBooking').addEventListener('click', () => { this.show('calendar'); this.loadSlots(); });

      // Rimuovi bordi rossi su input
      $('bwForm').querySelectorAll('input').forEach(el => {
        el.addEventListener('input', () => { el.style.borderColor = ''; });
      });

      this.loadSlots();
    },

    isoMonday() {
      const d = this.weekStart;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    },

    weekLabel() {
      const fri = new Date(this.weekStart);
      fri.setDate(fri.getDate() + 4);
      const opts = { day: 'numeric', month: 'short' };
      const lang = 'it-IT';
      return `${this.weekStart.toLocaleDateString(lang, opts)} – ${fri.toLocaleDateString(lang, opts)}`;
    },

    updatePrevBtn() {
      const today  = new Date();
      const curMon = new Date(today);
      const dow    = today.getDay();
      if (dow === 0) {
        curMon.setDate(today.getDate() + 1);
      } else if (dow === 6) {
        curMon.setDate(today.getDate() + 2);
      } else {
        curMon.setDate(today.getDate() - (dow - 1));
      }
      curMon.setHours(0, 0, 0, 0);
      $('bwPrevWeek').disabled = this.weekStart <= curMon;
    },

    async loadSlots() {
      $('bwWeekLabel').textContent = this.weekLabel();
      this.updatePrevBtn();

      $('bwLoading').hidden  = false;
      $('bwCalendar').hidden = true;
      $('bwLegend').hidden   = true;

      try {
        const res = await fetch(`/api/availability?week=${this.isoMonday()}&type=${this.type}&studio=${this.studio}`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        this.renderCalendar(data.slots);
        $('bwLegend').hidden = false;
      } catch {
        $('bwCalendar').innerHTML =
          '<p class="bw-cal-error">Impossibile caricare la disponibilità.<br>Riprova o <a href="https://calendar.app.google/3FhLrKz8Y5PcvyzR7" target="_blank" rel="noopener">prenota qui</a>.</p>';
      } finally {
        $('bwLoading').hidden  = false; // keep hidden — calendar takes its place
        $('bwLoading').hidden  = true;
        $('bwCalendar').hidden = false;
      }
    },

    renderCalendar(slots) {
      const cal = $('bwCalendar');
      cal.innerHTML = '';

      // Raggruppa per data
      const byDate = {};
      slots.forEach(s => (byDate[s.date] = byDate[s.date] || []).push(s));

      const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];

      for (let i = 0; i < 5; i++) {
        const day = new Date(this.weekStart);
        day.setDate(day.getDate() + i);
        const iso      = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,'0')}-${String(day.getDate()).padStart(2,'0')}`;
        const daySlots = byDate[iso] || [];

        const col = document.createElement('div');
        col.className = 'bw-col';

        // Intestazione giorno
        const hdr = document.createElement('div');
        hdr.className = 'bw-col-hdr';
        hdr.innerHTML =
          `<span class="bw-col-day">${DAY_NAMES[i]}</span>` +
          `<span class="bw-col-num">${day.getDate()}</span>`;
        col.appendChild(hdr);

        // Slot
        const wrap = document.createElement('div');
        wrap.className = 'bw-col-slots';

        if (daySlots.length === 0) {
          wrap.innerHTML = '<span class="bw-empty">—</span>';
        } else {
          daySlots.forEach(s => {
            const btn = document.createElement('button');
            btn.type      = 'button';
            btn.className = 'bw-slot-btn ' + (s.available ? 'bw-avail' : 'bw-taken');
            btn.textContent = s.time;
            btn.disabled    = !s.available;
            btn.setAttribute('aria-label',
              `${s.available ? 'Prenota' : 'Occupato'} ${DAY_NAMES[i]} ${day.getDate()} alle ${s.time}`);
            if (s.available) btn.addEventListener('click', () => this.selectSlot(s, day));
            wrap.appendChild(btn);
          });
        }

        col.appendChild(wrap);
        cal.appendChild(col);
      }
    },

    selectSlot(slot, day) {
      const typeLabel = this.type === 'prima-visita' ? 'Prima Visita Nutrizionale' : this.type === 'controllo-online' ? 'Visita di Controllo Online' : 'Visita di Controllo';
      const duration  = this.type === 'prima-visita' ? '60 min' : '30 min';
      const dateLabel = day.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });

      $('bwDate').value = slot.date;
      $('bwTime').value = slot.time;
      $('bwType').value = this.type;

      $('bwSlotInfo').innerHTML = `
        <div class="bw-recap-card">
          <span class="bw-recap-type">${typeLabel}</span>
          <div class="bw-recap-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
            </svg>
            <span>${dateLabel}</span>
          </div>
          <div class="bw-recap-row">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            <span>${slot.time} &middot; ${duration}</span>
          </div>
        </div>`;

      $('bwFormError').hidden = true;
      $('bwForm').reset();
      $('bwDate').value = slot.date;
      $('bwTime').value = slot.time;
      $('bwType').value = this.type;

      const btn = $('bwSubmitBtn');
      btn.disabled    = false;
      btn.textContent = 'Conferma prenotazione';

      this.show('form');
    },

    async submitBooking(e) {
      e.preventDefault();
      const form = e.target;

      // Validazione visiva
      let valid = true;
      form.querySelectorAll('[required]').forEach(f => {
        const bad = f.type === 'checkbox' ? !f.checked : !f.value.trim();
        f.style.borderColor = bad ? '#ef4444' : '';
        if (bad) valid = false;
      });
      if (!valid) {
        $('bwFormError').textContent = 'Compila tutti i campi obbligatori (*).';
        $('bwFormError').hidden = false;
        return;
      }

      const btn = $('bwSubmitBtn');
      btn.disabled    = true;
      btn.textContent = 'Prenotazione in corso…';

      const payload = {
        nome:     form.nome.value.trim(),
        cognome:  form.cognome.value.trim(),
        email:    form.email.value.trim(),
        telefono: form.telefono.value.trim(),
        type:     form.type.value,
        studio:   this.studio,
        date:     form.date.value,
        time:     form.time.value,
      };

      try {
        const res  = await fetch('/api/book', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify(payload),
        });
        const json = await res.json();

        if (res.ok && json.ok) {
          const typeLabel = payload.type === 'prima-visita' ? 'Prima Visita Nutrizionale' : payload.type === 'controllo-online' ? 'Visita di Controllo Online' : 'Visita di Controllo';
          const d         = new Date(payload.date + 'T00:00:00');
          const dateLabel = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
          $('bwSuccessDetails').innerHTML =
            `<strong>${typeLabel}</strong><br>${dateLabel} &middot; ${payload.time}`;
          this.show('success');
        } else {
          $('bwFormError').textContent = json.error || 'Errore. Riprova più tardi.';
          $('bwFormError').hidden = false;
          btn.disabled    = false;
          btn.textContent = 'Conferma prenotazione';
        }
      } catch {
        $('bwFormError').textContent = 'Errore di rete. Controlla la connessione e riprova.';
        $('bwFormError').hidden = false;
        btn.disabled    = false;
        btn.textContent = 'Conferma prenotazione';
      }
    },

    show(step) {
      $('bwStepCalendar').hidden = step !== 'calendar';
      $('bwStepForm').hidden     = step !== 'form';
      $('bwStepSuccess').hidden  = step !== 'success';
    },
  };

  document.addEventListener('DOMContentLoaded', () => BW.init());
})();

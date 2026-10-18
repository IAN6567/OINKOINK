/* ============================================================
   Moloiso Pig Farm — Application Logic
   Offline-first Pig Farm Management with Dexie.js
   ============================================================ */

   'use strict';

   /* ------------------------------------------------------------
      1. DATABASE SETUP (Dexie.js)
      ------------------------------------------------------------ */
   const db = new Dexie('PigFarmMasterDB');
   
   db.version(1).stores({
     pigs:     '++id, tagNumber, category, breed, penLocation, status, birthDate, weight, syncStatus',
     breeding: '++id, sowTag, boarTag, serviceDate, expectedFarrowDate, actualFarrowDate, totalBorn, bornAlive, stillBorn, weaningDate, pigletsWeaned',
     health:   '++id, pigTag, recordDate, treatmentType, dosage, notes',
     finances: '++id, recordDate, transactionType, category, amount, details',
     feed:     '++id, logDate, feedType, quantityKg, costPerKg'
   });
   
   /* ------------------------------------------------------------
      2. UTILITIES
      ------------------------------------------------------------ */
   const $  = (sel, root = document) => root.querySelector(sel);
   const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
   
   function escapeHtml(str) {
     if (str === null || str === undefined) return '';
     return String(str)
       .replace(/&/g, '&amp;')
       .replace(/</g, '&lt;')
       .replace(/>/g, '&gt;')
       .replace(/"/g, '&quot;')
       .replace(/'/g, '&#039;');
   }
   
   function formatDate(dateStr) {
     if (!dateStr) return '—';
     try {
       const d = new Date(dateStr + 'T00:00:00');
       if (isNaN(d.getTime())) return dateStr;
       return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
     } catch (e) { return dateStr; }
   }
   
   function todayISO() {
     const d = new Date();
     const off = d.getTimezoneOffset();
     const local = new Date(d.getTime() - off * 60000);
     return local.toISOString().slice(0, 10);
   }
   
   function addDays(isoDate, days) {
     if (!isoDate) return '';
     const d = new Date(isoDate + 'T00:00:00');
     if (isNaN(d.getTime())) return '';
     d.setDate(d.getDate() + days);
     const off = d.getTimezoneOffset();
     const local = new Date(d.getTime() - off * 60000);
     return local.toISOString().slice(0, 10);
   }
   
   function daysBetween(isoA, isoB) {
     const a = new Date(isoA + 'T00:00:00');
     const b = new Date(isoB + 'T00:00:00');
     return Math.round((b - a) / 86400000);
   }
   
   function formatMoney(n) {
     const num = Number(n) || 0;
     return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
   }
   
   let toastTimer = null;
   function showToast(message, type = 'success', duration = 2400) {
     const toast = $('#toast');
     toast.textContent = message;
     toast.className = 'toast show ' + type;
     clearTimeout(toastTimer);
     toastTimer = setTimeout(() => {
       toast.className = 'toast ' + type;
     }, duration);
   }
   
   /* ------------------------------------------------------------
      3. ONLINE / OFFLINE INDICATOR
      ------------------------------------------------------------ */
   function updateOnlineStatus() {
     const bar = $('#statusBar');
     const txt = $('#statusText');
     if (navigator.onLine) {
       bar.className = 'status-bar online';
       txt.textContent = '● Online — Moloiso Pig Farm · saved locally';
     } else {
       bar.className = 'status-bar offline';
       txt.textContent = '● Offline — Moloiso Pig Farm · local storage';
     }
   }
   
   window.addEventListener('online',  updateOnlineStatus);
   window.addEventListener('offline', updateOnlineStatus);
   
   /* ------------------------------------------------------------
      4. TAB NAVIGATION
      ------------------------------------------------------------ */
   function initTabs() {
     $$('.tab-btn').forEach(btn => {
       btn.addEventListener('click', () => {
         const target = btn.dataset.tab;
   
         $$('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
         $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + target));
   
         // Refresh data when switching tabs
         if (target === 'dashboard') refreshDashboard();
         if (target === 'herd')      renderHerdList();
         if (target === 'breeding')  renderBreedingList();
         if (target === 'health')    renderHealthList();
         if (target === 'finances')  renderFinanceList();
       });
     });
   }
   
   /* ------------------------------------------------------------
      5. DASHBOARD
      ------------------------------------------------------------ */
   async function refreshDashboard() {
     try {
       const allPigs = await db.pigs.toArray();
   
       const counts = { Sow: 0, Boar: 0, Weaner: 0, Finisher: 0 };
       allPigs.forEach(p => {
         if (p.status === 'Active' && counts[p.category] !== undefined) {
           counts[p.category]++;
         }
       });
   
       const totalActive = counts.Sow + counts.Boar + counts.Weaner + counts.Finisher;
   
       $('#statTotal').textContent     = totalActive;
       $('#statSows').textContent      = counts.Sow;
       $('#statBoars').textContent     = counts.Boar;
       $('#statWeaners').textContent   = counts.Weaner;
       $('#statFinishers').textContent = counts.Finisher;
   
       // ---- Monthly profit/loss ----
       const now = new Date();
       const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
       const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
   
       const allFin = await db.finances.toArray();
       let income = 0, expense = 0;
       allFin.forEach(f => {
         const d = new Date(f.recordDate + 'T00:00:00');
         if (d >= monthStart && d <= monthEnd) {
           if (f.transactionType === 'Income')  income  += Number(f.amount) || 0;
           if (f.transactionType === 'Expense') expense += Number(f.amount) || 0;
         }
       });
       const profit = income - expense;
       const profitEl = $('#statProfit');
       profitEl.textContent = (profit >= 0 ? '+' : '') + formatMoney(profit);
       profitEl.className = 'stat-value ' + (profit >= 0 ? 'positive' : 'negative');
   
       // ---- Farrowing alerts (114-day gestation) ----
       const allBreeding = await db.breeding.toArray();
       const today = todayISO();
       const upcoming = [];
   
       allBreeding.forEach(b => {
         if (!b.serviceDate || b.actualFarrowDate) return;
         const expected = b.expectedFarrowDate || addDays(b.serviceDate, 114);
         if (!expected) return;
         const days = daysBetween(today, expected);
         if (days <= 30) {
           upcoming.push({ ...b, expected, days });
         }
       });
   
       upcoming.sort((a, b) => a.days - b.days);
   
       const alertsDiv = $('#farrowingAlerts');
       if (upcoming.length === 0) {
         alertsDiv.innerHTML = '<p class="empty-msg">No upcoming farrowing events.</p>';
       } else {
         alertsDiv.innerHTML = upcoming.map(u => {
           const overdue = u.days < 0;
           const dayText = overdue
             ? `OVERDUE by ${Math.abs(u.days)} day(s)`
             : (u.days === 0 ? 'Due TODAY' : `In ${u.days} day(s)`);
           return `
             <div class="alert-item ${overdue ? 'overdue' : ''}">
               <span>🐷 Sow <span class="alert-tag">${escapeHtml(u.sowTag)}</span> × Boar ${escapeHtml(u.boarTag)}</span>
               <span>Expected: <strong>${formatDate(u.expected)}</strong></span>
               <span class="alert-days">${dayText}</span>
             </div>`;
         }).join('');
       }
   
       // ---- Quick summary ----
       const totalWeight = allPigs
         .filter(p => p.status === 'Active' && p.weight)
         .reduce((sum, p) => sum + Number(p.weight), 0);
   
       const totalSales = allFin
         .filter(f => f.transactionType === 'Income' && f.category === 'Sales')
         .reduce((sum, f) => sum + Number(f.amount), 0);
   
       $('#quickSummary').innerHTML = `
         <div class="summary-row"><span>Total live weight (active)</span><span>${formatMoney(totalWeight)} kg</span></div>
         <div class="summary-row"><span>All-time sales income</span><span>${formatMoney(totalSales)}</span></div>
         <div class="summary-row"><span>This month income</span><span>${formatMoney(income)}</span></div>
         <div class="summary-row"><span>This month expenses</span><span>${formatMoney(expense)}</span></div>
         <div class="summary-row"><span>Total pigs on record</span><span>${allPigs.length}</span></div>
       `;
     } catch (err) {
       console.error('Dashboard error:', err);
     }
   }
   
   /* ------------------------------------------------------------
      6. HERD MANAGEMENT (pigs)
      ------------------------------------------------------------ */
   function resetPigForm() {
     $('#pigId').value = '';
     $('#pigTag').value = '';
     $('#pigCategory').value = 'Sow';
     $('#pigBreed').value = '';
     $('#pigPen').value = '';
     $('#pigStatus').value = 'Active';
     $('#pigBirthDate').value = '';
     $('#pigWeight').value = '';
     $('#pigFormTitle').textContent = 'Add New Pig';
     $('#pigSubmitBtn').textContent = 'Save Pig';
     $('#pigCancelBtn').classList.add('hidden');
   }
   
   $('#pigForm').addEventListener('submit', async (e) => {
     e.preventDefault();
   
     const tag = $('#pigTag').value.trim();
     const category = $('#pigCategory').value;
     const status = $('#pigStatus').value;
   
     if (!tag) { showToast('Ear Tag is required', 'error'); return; }
     if (!category) { showToast('Category is required', 'error'); return; }
     if (!status) { showToast('Status is required', 'error'); return; }
   
     const data = {
       tagNumber: tag,
       category,
       breed: $('#pigBreed').value.trim(),
       penLocation: $('#pigPen').value.trim(),
       status,
       birthDate: $('#pigBirthDate').value || '',
       weight: $('#pigWeight').value ? Number($('#pigWeight').value) : null,
       syncStatus: 'pending'
     };
   
     try {
       const id = $('#pigId').value;
       if (id) {
         await db.pigs.update(Number(id), data);
         showToast('Pig updated ✓', 'success');
       } else {
         await db.pigs.add(data);
         showToast('Pig added ✓', 'success');
       }
       resetPigForm();
       await renderHerdList();
       await refreshDashboard();
     } catch (err) {
       console.error('Save pig error:', err);
       showToast('Failed to save pig', 'error');
     }
   });
   
   $('#pigCancelBtn').addEventListener('click', resetPigForm);
   
   async function renderHerdList() {
     const search = ($('#herdSearch').value || '').toLowerCase().trim();
     const filterCat = $('#herdFilter').value;
   
     let pigs = await db.pigs.toArray();
   
     if (filterCat) pigs = pigs.filter(p => p.category === filterCat);
     if (search) {
       pigs = pigs.filter(p =>
         (p.tagNumber || '').toLowerCase().includes(search) ||
         (p.breed || '').toLowerCase().includes(search) ||
         (p.penLocation || '').toLowerCase().includes(search)
       );
     }
   
     pigs.sort((a, b) => (a.tagNumber || '').localeCompare(b.tagNumber || '', undefined, { numeric: true }));
   
     const container = $('#herdList');
     if (pigs.length === 0) {
       container.innerHTML = '<p class="empty-msg">No pigs match your search.</p>';
       return;
     }
   
     container.innerHTML = pigs.map(p => `
       <div class="record-item" data-id="${p.id}">
         <div class="record-header">
           <span class="record-title">🏷️ ${escapeHtml(p.tagNumber)}</span>
           <span class="status-pill" data-status="${escapeHtml(p.status)}">${escapeHtml(p.status)}</span>
         </div>
         <div class="record-meta">
           <span>Category: <strong>${escapeHtml(p.category)}</strong></span>
           ${p.breed ? `<span>Breed: <strong>${escapeHtml(p.breed)}</strong></span>` : ''}
           ${p.penLocation ? `<span>Pen: <strong>${escapeHtml(p.penLocation)}</strong></span>` : ''}
           ${p.weight ? `<span>Weight: <strong>${escapeHtml(p.weight)} kg</strong></span>` : ''}
           ${p.birthDate ? `<span>Born: <strong>${formatDate(p.birthDate)}</strong></span>` : ''}
         </div>
         <div class="record-actions">
           <button class="btn-edit" data-action="edit-pig" data-id="${p.id}">✏️ Edit</button>
           <button class="btn-delete" data-action="delete-pig" data-id="${p.id}">🗑️ Delete</button>
         </div>
       </div>
     `).join('');
   
     // Bind actions
     container.querySelectorAll('button[data-action]').forEach(btn => {
       btn.addEventListener('click', handleHerdAction);
     });
   }
   
   async function handleHerdAction(e) {
     const btn = e.currentTarget;
     const id = Number(btn.dataset.id);
     const action = btn.dataset.action;
   
     if (action === 'edit-pig') {
       const pig = await db.pigs.get(id);
       if (!pig) return;
       $('#pigId').value = pig.id;
       $('#pigTag').value = pig.tagNumber || '';
       $('#pigCategory').value = pig.category || 'Sow';
       $('#pigBreed').value = pig.breed || '';
       $('#pigPen').value = pig.penLocation || '';
       $('#pigStatus').value = pig.status || 'Active';
       $('#pigBirthDate').value = pig.birthDate || '';
       $('#pigWeight').value = pig.weight || '';
       $('#pigFormTitle').textContent = 'Edit Pig #' + pig.tagNumber;
       $('#pigSubmitBtn').textContent = 'Update Pig';
       $('#pigCancelBtn').classList.remove('hidden');
       $('#pigForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
     }
   
     if (action === 'delete-pig') {
       if (!confirm('Delete this pig record permanently?')) return;
       await db.pigs.delete(id);
       showToast('Pig deleted', 'info');
       await renderHerdList();
       await refreshDashboard();
     }
   }
   
   $('#herdSearch').addEventListener('input', renderHerdList);
   $('#herdFilter').addEventListener('change', renderHerdList);
   
   /* ------------------------------------------------------------
      7. BREEDING
      ------------------------------------------------------------ */
   $('#breedServiceDate').addEventListener('change', () => {
     const service = $('#breedServiceDate').value;
     if (service) {
       $('#breedExpected').value = addDays(service, 114);
     } else {
       $('#breedExpected').value = '';
     }
   });
   
   function resetBreedForm() {
     $('#breedId').value = '';
     $('#breedSowTag').value = '';
     $('#breedBoarTag').value = '';
     $('#breedServiceDate').value = '';
     $('#breedExpected').value = '';
     $('#breedActual').value = '';
     $('#breedWeaningDate').value = '';
     $('#breedTotalBorn').value = '';
     $('#breedBornAlive').value = '';
     $('#breedStillBorn').value = '';
     $('#breedWeaned').value = '';
     $('#breedFormTitle').textContent = 'Add Breeding Record';
     $('#breedSubmitBtn').textContent = 'Save Record';
     $('#breedCancelBtn').classList.add('hidden');
   }
   
   $('#breedForm').addEventListener('submit', async (e) => {
     e.preventDefault();
   
     const sowTag = $('#breedSowTag').value.trim();
     const boarTag = $('#breedBoarTag').value.trim();
     const serviceDate = $('#breedServiceDate').value;
   
     if (!sowTag || !boarTag || !serviceDate) {
       showToast('Sow tag, Boar tag and Service date are required', 'error');
       return;
     }
   
     const data = {
       sowTag,
       boarTag,
       serviceDate,
       expectedFarrowDate: $('#breedExpected').value || addDays(serviceDate, 114),
       actualFarrowDate: $('#breedActual').value || '',
       totalBorn: $('#breedTotalBorn').value ? Number($('#breedTotalBorn').value) : 0,
       bornAlive: $('#breedBornAlive').value ? Number($('#breedBornAlive').value) : 0,
       stillBorn: $('#breedStillBorn').value ? Number($('#breedStillBorn').value) : 0,
       weaningDate: $('#breedWeaningDate').value || '',
       pigletsWeaned: $('#breedWeaned').value ? Number($('#breedWeaned').value) : 0
     };
   
     try {
       const id = $('#breedId').value;
       if (id) {
         await db.breeding.update(Number(id), data);
         showToast('Breeding record updated ✓', 'success');
       } else {
         await db.breeding.add(data);
         showToast('Breeding record saved ✓', 'success');
       }
       resetBreedForm();
       await renderBreedingList();
       await refreshDashboard();
     } catch (err) {
       console.error('Breeding save error:', err);
       showToast('Failed to save breeding record', 'error');
     }
   });
   
   $('#breedCancelBtn').addEventListener('click', resetBreedForm);
   
   async function renderBreedingList() {
     const records = await db.breeding.toArray();
     records.sort((a, b) => (b.serviceDate || '').localeCompare(a.serviceDate || ''));
   
     const container = $('#breedList');
     if (records.length === 0) {
       container.innerHTML = '<p class="empty-msg">No breeding records yet.</p>';
       return;
     }
   
     const today = todayISO();
   
     container.innerHTML = records.map(r => {
       const expected = r.expectedFarrowDate || addDays(r.serviceDate, 114);
       const daysToFarrow = expected ? daysBetween(today, expected) : null;
       let farrowBadge = '';
       if (!r.actualFarrowDate && expected) {
         if (daysToFarrow < 0) farrowBadge = `<span style="color:var(--danger);font-weight:700">Overdue ${Math.abs(daysToFarrow)}d</span>`;
         else if (daysToFarrow <= 30) farrowBadge = `<span style="color:var(--warn);font-weight:700">In ${daysToFarrow}d</span>`;
       }
   
       return `
         <div class="record-item" data-id="${r.id}">
           <div class="record-header">
             <span class="record-title">💞 ${escapeHtml(r.sowTag)} × ${escapeHtml(r.boarTag)}</span>
             ${r.actualFarrowDate ? '<span class="status-pill" data-status="Active">Farrowed</span>' : ''}
           </div>
           <div class="record-meta">
             <span>Service: <strong>${formatDate(r.serviceDate)}</strong></span>
             <span>Expected: <strong>${formatDate(expected)}</strong> ${farrowBadge}</span>
             ${r.actualFarrowDate ? `<span>Farrowed: <strong>${formatDate(r.actualFarrowDate)}</strong></span>` : ''}
           </div>
           <div class="record-meta">
             <span>Total Born: <strong>${r.totalBorn || 0}</strong></span>
             <span>Born Alive: <strong>${r.bornAlive || 0}</strong></span>
             <span>Still Born: <strong>${r.stillBorn || 0}</strong></span>
             <span>Weaned: <strong>${r.pigletsWeaned || 0}</strong></span>
           </div>
           <div class="record-actions">
             <button class="btn-edit" data-action="edit-breed" data-id="${r.id}">✏️ Edit</button>
             <button class="btn-delete" data-action="delete-breed" data-id="${r.id}">🗑️ Delete</button>
           </div>
         </div>
       `;
     }).join('');
   
     container.querySelectorAll('button[data-action]').forEach(btn => {
       btn.addEventListener('click', handleBreedAction);
     });
   }
   
   async function handleBreedAction(e) {
     const btn = e.currentTarget;
     const id = Number(btn.dataset.id);
     const action = btn.dataset.action;
   
     if (action === 'edit-breed') {
       const r = await db.breeding.get(id);
       if (!r) return;
       $('#breedId').value = r.id;
       $('#breedSowTag').value = r.sowTag || '';
       $('#breedBoarTag').value = r.boarTag || '';
       $('#breedServiceDate').value = r.serviceDate || '';
       $('#breedExpected').value = r.expectedFarrowDate || addDays(r.serviceDate, 114);
       $('#breedActual').value = r.actualFarrowDate || '';
       $('#breedWeaningDate').value = r.weaningDate || '';
       $('#breedTotalBorn').value = r.totalBorn || '';
       $('#breedBornAlive').value = r.bornAlive || '';
       $('#breedStillBorn').value = r.stillBorn || '';
       $('#breedWeaned').value = r.pigletsWeaned || '';
       $('#breedFormTitle').textContent = 'Edit Breeding Record';
       $('#breedSubmitBtn').textContent = 'Update Record';
       $('#breedCancelBtn').classList.remove('hidden');
       $('#breedForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
     }
   
     if (action === 'delete-breed') {
       if (!confirm('Delete this breeding record?')) return;
       await db.breeding.delete(id);
       showToast('Breeding record deleted', 'info');
       await renderBreedingList();
       await refreshDashboard();
     }
   }
   
   /* ------------------------------------------------------------
      8. HEALTH
      ------------------------------------------------------------ */
   function resetHealthForm() {
     $('#healthId').value = '';
     $('#healthPigTag').value = '';
     $('#healthDate').value = todayISO();
     $('#healthType').value = 'Vaccination';
     $('#healthDosage').value = '';
     $('#healthNotes').value = '';
     $('#healthFormTitle').textContent = 'Add Health Record';
     $('#healthSubmitBtn').textContent = 'Save Record';
     $('#healthCancelBtn').classList.add('hidden');
   }
   
   $('#healthForm').addEventListener('submit', async (e) => {
     e.preventDefault();
   
     const pigTag = $('#healthPigTag').value.trim();
     const recordDate = $('#healthDate').value;
     const treatmentType = $('#healthType').value;
   
     if (!pigTag || !recordDate || !treatmentType) {
       showToast('Pig tag, date and treatment type are required', 'error');
       return;
     }
   
     const data = {
       pigTag,
       recordDate,
       treatmentType,
       dosage: $('#healthDosage').value.trim(),
       notes: $('#healthNotes').value.trim()
     };
   
     try {
       const id = $('#healthId').value;
       if (id) {
         await db.health.update(Number(id), data);
         showToast('Health record updated ✓', 'success');
       } else {
         await db.health.add(data);
         showToast('Health record saved ✓', 'success');
       }
       resetHealthForm();
       await renderHealthList();
     } catch (err) {
       console.error('Health save error:', err);
       showToast('Failed to save health record', 'error');
     }
   });
   
   $('#healthCancelBtn').addEventListener('click', resetHealthForm);
   
   async function renderHealthList() {
     const records = await db.health.toArray();
     records.sort((a, b) => (b.recordDate || '').localeCompare(a.recordDate || ''));
   
     const container = $('#healthList');
     if (records.length === 0) {
       container.innerHTML = '<p class="empty-msg">No health records yet.</p>';
       return;
     }
   
     const typeColors = {
       Vaccination: 'var(--info-light)',
       Deworming: '#e8f5e9',
       Medication: 'var(--warn-light)'
     };
   
     container.innerHTML = records.map(r => `
       <div class="record-item" data-id="${r.id}">
         <div class="record-header">
           <span class="record-title">💊 ${escapeHtml(r.pigTag)}</span>
           <span class="status-pill" style="background:${typeColors[r.treatmentType] || '#eee'};color:#333">${escapeHtml(r.treatmentType)}</span>
         </div>
         <div class="record-meta">
           <span>Date: <strong>${formatDate(r.recordDate)}</strong></span>
           ${r.dosage ? `<span>Dosage: <strong>${escapeHtml(r.dosage)}</strong></span>` : ''}
         </div>
         ${r.notes ? `<div class="record-meta"><span>${escapeHtml(r.notes)}</span></div>` : ''}
         <div class="record-actions">
           <button class="btn-edit" data-action="edit-health" data-id="${r.id}">✏️ Edit</button>
           <button class="btn-delete" data-action="delete-health" data-id="${r.id}">🗑️ Delete</button>
         </div>
       </div>
     `).join('');
   
     container.querySelectorAll('button[data-action]').forEach(btn => {
       btn.addEventListener('click', handleHealthAction);
     });
   }
   
   async function handleHealthAction(e) {
     const btn = e.currentTarget;
     const id = Number(btn.dataset.id);
     const action = btn.dataset.action;
   
     if (action === 'edit-health') {
       const r = await db.health.get(id);
       if (!r) return;
       $('#healthId').value = r.id;
       $('#healthPigTag').value = r.pigTag || '';
       $('#healthDate').value = r.recordDate || '';
       $('#healthType').value = r.treatmentType || 'Vaccination';
       $('#healthDosage').value = r.dosage || '';
       $('#healthNotes').value = r.notes || '';
       $('#healthFormTitle').textContent = 'Edit Health Record';
       $('#healthSubmitBtn').textContent = 'Update Record';
       $('#healthCancelBtn').classList.remove('hidden');
       $('#healthForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
     }
   
     if (action === 'delete-health') {
       if (!confirm('Delete this health record?')) return;
       await db.health.delete(id);
       showToast('Health record deleted', 'info');
       await renderHealthList();
     }
   }
   
   /* ------------------------------------------------------------
      9. FINANCES
      ------------------------------------------------------------ */
   function resetFinForm() {
     $('#finId').value = '';
     $('#finDate').value = todayISO();
     $('#finType').value = 'Expense';
     $('#finCategory').value = 'Feed';
     $('#finAmount').value = '';
     $('#finDetails').value = '';
     $('#finFormTitle').textContent = 'Add Transaction';
     $('#finSubmitBtn').textContent = 'Save Transaction';
     $('#finCancelBtn').classList.add('hidden');
   }
   
   $('#finForm').addEventListener('submit', async (e) => {
     e.preventDefault();
   
     const recordDate = $('#finDate').value;
     const transactionType = $('#finType').value;
     const category = $('#finCategory').value;
     const amount = Number($('#finAmount').value);
   
     if (!recordDate || !transactionType || !category || isNaN(amount) || amount <= 0) {
       showToast('Please fill all required fields with a valid amount', 'error');
       return;
     }
   
     const data = {
       recordDate,
       transactionType,
       category,
       amount,
       details: $('#finDetails').value.trim()
     };
   
     try {
       const id = $('#finId').value;
       if (id) {
         await db.finances.update(Number(id), data);
         showToast('Transaction updated ✓', 'success');
       } else {
         await db.finances.add(data);
         showToast('Transaction saved ✓', 'success');
       }
       resetFinForm();
       await renderFinanceList();
       await refreshDashboard();
     } catch (err) {
       console.error('Finance save error:', err);
       showToast('Failed to save transaction', 'error');
     }
   });
   
   $('#finCancelBtn').addEventListener('click', resetFinForm);
   
   async function renderFinanceList() {
     const records = await db.finances.toArray();
     records.sort((a, b) => (b.recordDate || '').localeCompare(a.recordDate || ''));
   
     // Summary
     let income = 0, expense = 0;
     records.forEach(r => {
       if (r.transactionType === 'Income')  income  += Number(r.amount) || 0;
       if (r.transactionType === 'Expense') expense += Number(r.amount) || 0;
     });
     const net = income - expense;
   
     $('#finSummary').innerHTML = `
       <div class="stat-card"><span class="stat-label">Income</span><span class="stat-value" style="color:var(--primary-dark)">${formatMoney(income)}</span></div>
       <div class="stat-card"><span class="stat-label">Expenses</span><span class="stat-value" style="color:var(--danger)">${formatMoney(expense)}</span></div>
       <div class="stat-card"><span class="stat-label">Net</span><span class="stat-value" style="color:${net >= 0 ? 'var(--primary-dark)' : 'var(--danger)'}">${net >= 0 ? '+' : ''}${formatMoney(net)}</span></div>
     `;
   
     const container = $('#finList');
     if (records.length === 0) {
       container.innerHTML = '<p class="empty-msg">No transactions yet.</p>';
       return;
     }
   
     container.innerHTML = records.map(r => {
       const isIncome = r.transactionType === 'Income';
       return `
         <div class="record-item" data-id="${r.id}">
           <div class="record-header">
             <span class="record-title">${isIncome ? '📈' : '📉'} ${escapeHtml(r.category)}</span>
             <span class="${isIncome ? 'amount-income' : 'amount-expense'}">
               ${isIncome ? '+' : '−'}${formatMoney(r.amount)}
             </span>
           </div>
           <div class="record-meta">
             <span>Date: <strong>${formatDate(r.recordDate)}</strong></span>
             <span>Type: <strong>${escapeHtml(r.transactionType)}</strong></span>
           </div>
           ${r.details ? `<div class="record-meta"><span>${escapeHtml(r.details)}</span></div>` : ''}
           <div class="record-actions">
             <button class="btn-edit" data-action="edit-fin" data-id="${r.id}">✏️ Edit</button>
             <button class="btn-delete" data-action="delete-fin" data-id="${r.id}">🗑️ Delete</button>
           </div>
         </div>
       `;
     }).join('');
   
     container.querySelectorAll('button[data-action]').forEach(btn => {
       btn.addEventListener('click', handleFinAction);
     });
   }
   
   async function handleFinAction(e) {
     const btn = e.currentTarget;
     const id = Number(btn.dataset.id);
     const action = btn.dataset.action;
   
     if (action === 'edit-fin') {
       const r = await db.finances.get(id);
       if (!r) return;
       $('#finId').value = r.id;
       $('#finDate').value = r.recordDate || '';
       $('#finType').value = r.transactionType || 'Expense';
       $('#finCategory').value = r.category || 'Feed';
       $('#finAmount').value = r.amount || '';
       $('#finDetails').value = r.details || '';
       $('#finFormTitle').textContent = 'Edit Transaction';
       $('#finSubmitBtn').textContent = 'Update Transaction';
       $('#finCancelBtn').classList.remove('hidden');
       $('#finForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
     }
   
     if (action === 'delete-fin') {
       if (!confirm('Delete this transaction?')) return;
       await db.finances.delete(id);
       showToast('Transaction deleted', 'info');
       await renderFinanceList();
       await refreshDashboard();
     }
   }
   
   /* ------------------------------------------------------------
      10. DATA EXPORT & IMPORT (Backup)
      ------------------------------------------------------------ */
   $('#exportBtn').addEventListener('click', async () => {
     try {
       const data = {
         exportedAt: new Date().toISOString(),
         version: 1,
         farm: 'Moloiso Pig Farm',
         pigs:     await db.pigs.toArray(),
         breeding: await db.breeding.toArray(),
         health:   await db.health.toArray(),
         finances: await db.finances.toArray(),
         feed:     await db.feed.toArray()
       };
   
       const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
       const url = URL.createObjectURL(blob);
       const a = document.createElement('a');
       a.href = url;
       a.download = `moloiso-pigfarm-backup-${todayISO()}.json`;
       document.body.appendChild(a);
       a.click();
       document.body.removeChild(a);
       URL.revokeObjectURL(url);
   
       showToast('Backup exported ✓', 'success');
     } catch (err) {
       console.error('Export error:', err);
       showToast('Export failed', 'error');
     }
   });
   
   $('#importBtn').addEventListener('click', () => $('#importFile').click());
   
   $('#importFile').addEventListener('change', async (e) => {
     const file = e.target.files[0];
     if (!file) return;
   
     if (!confirm('Importing will REPLACE all current data. Continue?')) {
       e.target.value = '';
       return;
     }
   
     try {
       const text = await file.text();
       const data = JSON.parse(text);
   
       await db.transaction('rw', db.pigs, db.breeding, db.health, db.finances, db.feed, async () => {
         await db.pigs.clear();
         await db.breeding.clear();
         await db.health.clear();
         await db.finances.clear();
         await db.feed.clear();
   
         if (Array.isArray(data.pigs))     await db.pigs.bulkAdd(data.pigs);
         if (Array.isArray(data.breeding)) await db.breeding.bulkAdd(data.breeding);
         if (Array.isArray(data.health))   await db.health.bulkAdd(data.health);
         if (Array.isArray(data.finances)) await db.finances.bulkAdd(data.finances);
         if (Array.isArray(data.feed))     await db.feed.bulkAdd(data.feed);
       });
   
       showToast('Backup imported ✓', 'success');
   
       // Refresh current view
       await refreshDashboard();
       await renderHerdList();
       await renderBreedingList();
       await renderHealthList();
       await renderFinanceList();
     } catch (err) {
       console.error('Import error:', err);
       showToast('Import failed — invalid file', 'error');
     } finally {
       e.target.value = '';
     }
   });
   
   /* ------------------------------------------------------------
      11. SERVICE WORKER REGISTRATION (PWA)
      ------------------------------------------------------------ */
   function registerServiceWorker() {
     if (!('serviceWorker' in navigator)) {
       console.warn('Service Workers not supported in this browser.');
       return;
     }
   
     window.addEventListener('load', () => {
       navigator.serviceWorker.register('sw.js')
         .then(reg => {
           console.log('[SW] Registered. Scope:', reg.scope);
         })
         .catch(err => {
           console.warn('[SW] Registration failed:', err);
         });
     });
   }
   
   /* ------------------------------------------------------------
      12. APP INITIALIZATION
      ------------------------------------------------------------ */
   async function initApp() {
     updateOnlineStatus();
     initTabs();
     resetPigForm();
     resetBreedForm();
     resetHealthForm();
     resetFinForm();
   
     // Set default dates
     $('#healthDate').value = todayISO();
     $('#finDate').value = todayISO();
   
     // Initial render
     await refreshDashboard();
     await renderHerdList();
     await renderBreedingList();
     await renderHealthList();
     await renderFinanceList();
   
     // Register service worker for offline PWA support
     registerServiceWorker();
   
     console.log('🐖 Moloiso Pig Farm initialized.');
   }
   
   document.addEventListener('DOMContentLoaded', initApp);
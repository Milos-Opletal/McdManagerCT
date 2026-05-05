/**
 * CT Performance Page – Client-side logic
 * Fetches CT shift & verification data and renders the performance table.
 */

const czMonthNames = [
    'Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen',
    'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'
];

let isSyncing = false;

document.addEventListener('DOMContentLoaded', () => {
    setDefaultMonth();
    syncCTPerformance();

    // Ensure month picker fires reliably across all browsers
    const monthInput = document.getElementById('month-select');
    let debounceTimer = null;
    monthInput.addEventListener('input', () => {
        updateMonthLabel();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => syncCTPerformance(), 300);
    });
    monthInput.addEventListener('change', () => {
        updateMonthLabel();
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => syncCTPerformance(), 300);
    });
});

function setDefaultMonth() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const monthInput = document.getElementById('month-select');
    monthInput.value = `${year}-${month}`;
    updateMonthLabel();
}

function updateMonthLabel() {
    const val = document.getElementById('month-select').value;
    if (!val) return;
    const [year, month] = val.split('-').map(Number);
    const label = document.getElementById('month-label');
    label.textContent = `${czMonthNames[month - 1]} ${year}`;
}

function setLoadingState(isLoading) {
    const btnText = document.querySelector('#sync-btn .btn-text');
    const btnSpinner = document.querySelector('#sync-btn .spinner');
    const syncBtn = document.getElementById('sync-btn');
    const stateMessage = document.getElementById('state-message');
    const table = document.getElementById('ct-table');

    if (isLoading) {
        btnText.textContent = 'Synchronizuji...';
        btnSpinner.classList.remove('hidden');
        syncBtn.disabled = true;

        stateMessage.classList.remove('hidden');
        stateMessage.innerHTML = `
            <div class="big-spinner"></div>
            <p>Načítám data výkonu Crew Trenérů...</p>
            <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.5rem;">
                Tento proces může trvat až minutu.
            </p>
        `;
        table.classList.add('hidden');

        // Set stat cards to loading state
        ['stat-total-cts', 'stat-total-shifts', 'stat-total-verifs', 'stat-avg-pct'].forEach(id => {
            const el = document.getElementById(id);
            el.textContent = '...';
            el.classList.add('loading');
        });
    } else {
        btnText.textContent = 'Synchronizovat';
        btnSpinner.classList.add('hidden');
        syncBtn.disabled = false;
        stateMessage.classList.add('hidden');
        table.classList.remove('hidden');

        ['stat-total-cts', 'stat-total-shifts', 'stat-total-verifs', 'stat-avg-pct'].forEach(id => {
            document.getElementById(id).classList.remove('loading');
        });
    }
}

async function syncCTPerformance() {
    if (isSyncing) return;
    isSyncing = true;
    updateMonthLabel();
    setLoadingState(true);

    const monthVal = document.getElementById('month-select').value;
    if (!monthVal) {
        setLoadingState(false);
        isSyncing = false;
        return;
    }

    const [year, month] = monthVal.split('-').map(Number);

    try {
        const response = await fetch('/api/ct_performance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ year, month })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        renderData(data);

        const syncStatus = document.getElementById('last-sync-time');
        syncStatus.textContent = `Synchronizováno: ${new Date().toLocaleString('cs-CZ')}`;
    } catch (e) {
        console.error('Sync error:', e);
        const stateMessage = document.getElementById('state-message');
        stateMessage.classList.remove('hidden');
        stateMessage.innerHTML = `
            <p style="color: var(--accent-red); font-weight: 600;">Chyba při synchronizaci</p>
            <p style="font-size: 0.85rem; color: var(--text-secondary);">${escapeHtml(e.message)}</p>
        `;
        document.getElementById('ct-table').classList.add('hidden');
    } finally {
        setLoadingState(false);
        isSyncing = false;
    }
}

function renderData(data) {
    const performers = data.performers || [];
    const tbody = document.getElementById('ct-table-body');
    tbody.innerHTML = '';

    // Sort by percentage descending (best performers first)
    performers.sort((a, b) => b.percentage - a.percentage);

    // Update summary stats
    const totalShifts = performers.reduce((sum, p) => sum + p.shifts, 0);
    const totalVerifs = performers.reduce((sum, p) => sum + p.verifications, 0);
    const avgPct = performers.length > 0
        ? (performers.reduce((sum, p) => sum + p.percentage, 0) / performers.length)
        : 0;

    animateCounter('stat-total-cts', performers.length);
    animateCounter('stat-total-shifts', totalShifts);
    animateCounter('stat-total-verifs', totalVerifs);
    document.getElementById('stat-avg-pct').textContent = `${avgPct.toFixed(1)}%`;

    if (performers.length === 0) {
        const stateMessage = document.getElementById('state-message');
        stateMessage.classList.remove('hidden');
        stateMessage.innerHTML = `<p>Žádní Crew Trenéři nebyli nalezeni pro tento měsíc.</p>`;
        document.getElementById('ct-table').classList.add('hidden');
        return;
    }

    performers.forEach((p, index) => {
        const tr = document.createElement('tr');
        tr.style.animationDelay = `${index * 0.06}s`;

        const initials = getInitials(p.name);
        const perfClass = getPerformanceClass(p.percentage);

        const barWidth = Math.min(p.percentage, 100);

        tr.innerHTML = `
            <td>
                <div class="ct-name">
                    <div class="ct-avatar">${escapeHtml(initials)}</div>
                    <span class="ct-name-text">${escapeHtml(p.name)}</span>
                </div>
            </td>
            <td><span class="shift-count">${p.shifts}</span></td>
            <td><span class="hours-cell">${p.worked_hours.toFixed(1)} h</span></td>
            <td><span class="verif-count ${p.verifications > 0 ? 'has-verifs' : 'no-verifs'}">${p.verifications}</span></td>
            <td><span class="status-pill ${p.verifications > 0 ? 'status-success' : 'status-fail'}">${p.verifications > 0 ? 'Aktivní' : 'Neaktivní'}</span></td>
            <td>
                <div class="perf-bar-container">
                    <div class="perf-bar-track">
                        <div class="perf-bar-fill ${perfClass}" style="width: 0%;" data-width="${barWidth}"></div>
                    </div>
                    <span class="perf-pct ${perfClass}">${p.percentage.toFixed(1)}%</span>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Animate bars after a short delay
    requestAnimationFrame(() => {
        setTimeout(() => {
            document.querySelectorAll('.perf-bar-fill').forEach(bar => {
                bar.style.width = bar.dataset.width + '%';
            });
        }, 100);
    });
}

function getPerformanceClass(pct) {
    if (pct >= 50) return 'perf-excellent';
    if (pct >= 25) return 'perf-good';
    if (pct > 0) return 'perf-low';
    return 'perf-zero';
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
}

function animateCounter(elementId, target) {
    const el = document.getElementById(elementId);
    const duration = 600;
    const start = performance.now();
    const startVal = 0;

    function update(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        const current = Math.round(startVal + (target - startVal) * eased);
        el.textContent = current;
        if (progress < 1) {
            requestAnimationFrame(update);
        }
    }

    requestAnimationFrame(update);
}

function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return unsafe
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

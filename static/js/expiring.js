/**
 * Expiring Verifications Page – Client-side logic
 */

let isSyncing = false;

document.addEventListener('DOMContentLoaded', () => {
    setDefaultDate();
    syncExpiring();

    const dateInput = document.getElementById('date-select');
    let debounceTimer = null;
    
    dateInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => syncExpiring(), 300);
    });
    dateInput.addEventListener('change', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => syncExpiring(), 300);
    });
});

function setDefaultDate() {
    // Default to the end of next month
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0); // 0 gets the last day of previous month, so +2 gets end of next month
    
    const year = nextMonth.getFullYear();
    const month = String(nextMonth.getMonth() + 1).padStart(2, '0');
    const day = String(nextMonth.getDate()).padStart(2, '0');
    
    document.getElementById('date-select').value = `${year}-${month}-${day}`;
}

function setLoadingState(isLoading) {
    const btnText = document.querySelector('#sync-btn .btn-text');
    const btnSpinner = document.querySelector('#sync-btn .spinner');
    const syncBtn = document.getElementById('sync-btn');
    const stateMessage = document.getElementById('state-message');
    const table = document.getElementById('expiring-table');

    if (isLoading) {
        btnText.textContent = 'Synchronizuji...';
        btnSpinner.classList.remove('hidden');
        syncBtn.disabled = true;

        stateMessage.classList.remove('hidden');
        stateMessage.innerHTML = `
            <div class="big-spinner"></div>
            <p>Načítám končící verifikace...</p>
        `;
        table.classList.add('hidden');
    } else {
        btnText.textContent = 'Synchronizovat';
        btnSpinner.classList.add('hidden');
        syncBtn.disabled = false;
        stateMessage.classList.add('hidden');
        table.classList.remove('hidden');
    }
}

async function syncExpiring() {
    if (isSyncing) return;
    isSyncing = true;
    
    setLoadingState(true);

    const toDate = document.getElementById('date-select').value;
    
    try {
        const response = await fetch('/api/expiring_verifications', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to_date: toDate })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        
        // If API altered the date (e.g., initial empty load), update input
        if (data.to_date && !toDate) {
            document.getElementById('date-select').value = data.to_date;
        }
        
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
        document.getElementById('expiring-table').classList.add('hidden');
    } finally {
        setLoadingState(false);
        isSyncing = false;
    }
}

function renderData(data) {
    const expiring = data.expiring || [];
    const tbody = document.getElementById('expiring-table-body');
    tbody.innerHTML = '';

    if (expiring.length === 0) {
        const stateMessage = document.getElementById('state-message');
        stateMessage.classList.remove('hidden');
        stateMessage.innerHTML = `<p>V tomto období nekončí žádné verifikace.</p>`;
        document.getElementById('expiring-table').classList.add('hidden');
        return;
    }

    expiring.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.style.animationDelay = `${index * 0.05}s`;

        const initials = getInitials(item.employee_name);
        
        // Formatting date
        let dateStr = item.date_to;
        try {
            const dateObj = new Date(item.date_to);
            dateStr = dateObj.toLocaleDateString('cs-CZ');
        } catch(e) {}

        const statusClass = item.is_verified ? 'status-verified' : 'status-not-verified';
        const statusText = item.is_verified ? 'Verifikováno' : 'Chybí';
        const statusIcon = item.is_verified ? '✓' : '✗';

        tr.innerHTML = `
            <td>
                <div class="emp-name">
                    <div class="emp-avatar">${escapeHtml(initials)}</div>
                    <span class="emp-name-text">${escapeHtml(item.employee_name)}</span>
                </div>
            </td>
            <td><strong>${escapeHtml(item.verification_name)}</strong></td>
            <td>${escapeHtml(dateStr)}</td>
            <td><span class="status-pill ${statusClass}">${statusIcon} ${statusText}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
        return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].substring(0, 2).toUpperCase();
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

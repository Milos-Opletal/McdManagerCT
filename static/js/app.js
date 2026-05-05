let allVerifications = [];
const targetPositions = [2, 1, 16, 5];
const displayNames = {
    2: "Crew",
    1: "Crew v tréninku",
    16: "Lídr péče o hosty",
    5: "Crew Trenér"
};
// By default, show all of the target positions
let activeFilters = new Set(targetPositions);

document.addEventListener('DOMContentLoaded', () => {
    setDefaultDates();
    fetchData();
});

function setDefaultDates() {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    
    // Format to YYYY-MM-DD
    const formatDate = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');
    
    if (startDateInput) startDateInput.value = formatDate(startOfMonth);
    if (endDateInput) endDateInput.value = formatDate(today);
}

function setLoadingState(isLoading) {
    const btnText = document.querySelector('#sync-btn .btn-text');
    const btnSpinner = document.querySelector('#sync-btn .spinner');
    const syncBtn = document.getElementById('sync-btn');
    const stateMessage = document.getElementById('state-message');
    const tableContainer = document.getElementById('verifications-table');

    if (isLoading) {
        btnText.textContent = 'Synchronizuji...';
        btnSpinner.classList.remove('hidden');
        syncBtn.disabled = true;
        
        if (allVerifications.length === 0) {
            stateMessage.classList.remove('hidden');
            tableContainer.classList.add('hidden');
        }
    } else {
        btnText.textContent = 'Synchronizovat data';
        btnSpinner.classList.add('hidden');
        syncBtn.disabled = false;
        
        stateMessage.classList.add('hidden');
        tableContainer.classList.remove('hidden');
    }
}

function updateLastSync(timeString) {
    const el = document.getElementById('last-sync-time');
    if (!timeString) {
        el.textContent = 'Poslední synchronizace: Nikdy';
        return;
    }
    const date = new Date(timeString);
    el.textContent = `Poslední synchronizace: ${date.toLocaleString('cs-CZ')}`;
}

async function fetchData() {
    try {
        const response = await fetch('/api/data');
        const data = await response.json();
        
        setLoadingState(data.is_syncing);
        updateLastSync(data.last_sync);
        
        if (data.verifications && data.verifications.length > 0) {
            allVerifications = data.verifications;
            buildDashboard();
        } else if (!data.is_syncing) {
            // Auto sync if empty
            triggerSync();
        }
    } catch (e) {
        console.error("Error fetching data:", e);
    }
}

async function triggerSync() {
    setLoadingState(true);
    try {
        const response = await fetch('/api/sync', { method: 'POST' });
        const data = await response.json();
        
        updateLastSync(data.last_sync);
        if (data.verifications && data.verifications.length > 0) {
            allVerifications = data.verifications;
            buildDashboard();
        }
    } catch (e) {
        console.error("Error syncing data:", e);
    } finally {
        setLoadingState(false);
    }
}

function buildDashboard() {
    buildFilters();
    renderTable();
}

function buildFilters() {
    const filterContainer = document.getElementById('filter-container');
    filterContainer.innerHTML = '';
    
    targetPositions.forEach(pos => {
        const chip = document.createElement('div');
        chip.className = `chip ${activeFilters.has(pos) ? 'active' : ''}`;
        chip.textContent = displayNames[pos] || pos;
        chip.onclick = () => {
            if (activeFilters.has(pos)) {
                activeFilters.delete(pos);
                chip.classList.remove('active');
            } else {
                activeFilters.add(pos);
                chip.classList.add('active');
            }
            renderTable();
        };
        filterContainer.appendChild(chip);
    });
}

function renderTable() {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';
    
    const startDateInput = document.getElementById('start-date').value;
    const endDateInput = document.getElementById('end-date').value;

    // Filter
    let filtered = allVerifications.filter(v => {
        const posId = v.position_id;
        if (!activeFilters.has(posId)) return false;

        // Date filter
        if (v.verification_date && (startDateInput || endDateInput)) {
            const vDate = new Date(v.verification_date);
            vDate.setHours(0, 0, 0, 0);

            if (startDateInput) {
                const sDate = new Date(startDateInput);
                sDate.setHours(0, 0, 0, 0);
                if (vDate < sDate) return false;
            }

            if (endDateInput) {
                const eDate = new Date(endDateInput);
                eDate.setHours(0, 0, 0, 0);
                if (vDate > eDate) return false;
            }
        } else if (!v.verification_date && (startDateInput || endDateInput)) {
            // If filtering by date strictly, discard entries lacking proper dates
            return false;
        }

        return true;
    });
    
    // Update count
    document.getElementById('total-count').textContent = `${filtered.length} Záznamů`;
    
    // Sort logic (newest first based on verification_date)
    filtered.sort((a, b) => {
        let dateA = new Date(a.verification_date || 0);
        let dateB = new Date(b.verification_date || 0);
        return dateB - dateA;
    });
    
    filtered.forEach((v, index) => {
        const tr = document.createElement('tr');
        tr.style.animationDelay = `${Math.min(index * 0.02, 0.5)}s`; // Staggered animation
        
        const isSuccess = (v.status || '').toLowerCase().includes('verifik');
        const statusClass = isSuccess ? 'status-success' : 'status-fail';
        
        let scoreDisplay = '-';
        if (v.total_points !== null && v.max_points !== null) {
            scoreDisplay = `<span class="score">${v.total_points}/${v.max_points}</span>`;
        }
        
        let dateDisplay = 'N/A';
        if (v.verification_date) {
            dateDisplay = new Date(v.verification_date).toLocaleDateString();
        }

        const renderedPosition = displayNames[v.position_id] || v.position_name || 'Neznámá pozice';
        
        tr.innerHTML = `
            <td><strong>${escapeHtml(v.employee_name)}</strong></td>
            <td>${escapeHtml(renderedPosition)}</td>
            <td>${escapeHtml(v.verification_name)}</td>
            <td>${scoreDisplay}</td>
            <td>${dateDisplay}</td>
            <td>${escapeHtml(v.verified_by || '-')}</td>
            <td><span class="status-pill ${statusClass}">${escapeHtml(v.status || 'Nepřiřazeno')}</span></td>
        `;
        tbody.appendChild(tr);
    });
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

let allEmployees = [];
let tablesData = { cells: {}, hidden: [], nocni: [], auto: {} };

// Table Definitions
const CREW_COLS = [
    { group: 'KUCHYŇ', cols: ['INICIÁTOR (MFY)', 'ASSEMBLER(MFY)', 'FINISHER(MFY)', 'BATCHCOOKER GRILL', 'BATCHCOOKER FRITÉZA', 'HRANOLKY', 'SALÁTY A TEMPERACE'] },
    { group: 'SERVIS', cols: ['VÝDEJ', 'POKLADNA', 'BEVERAGE'] },
    { group: 'OSTATNÍ', cols: ['LOBBY', 'LPOH', 'NAVÁŽKA'] }
];

const NOCNI_COLS = [
    { group: 'ÚKLID', cols: ['LOBBY', 'KÁVOVARY', 'GRILL - PRAVÝ', 'GRILL - LEVÝ', 'FRITÉZA', 'NAVÁŽKA', 'DŽUSOVAČ', 'COMBO', 'STEAMERY', 'ODPADY', 'MULTIPLEX', 'PÁS'] }
];

// Mapping: table column name → API verification name(s)
// If ANY of the listed verifications is verified, the column gets a tick
const VERIFICATION_MAP = {
    'INICIÁTOR (MFY)':    ['3.2. MFY'],
    'ASSEMBLER(MFY)':     ['3.2. MFY'],
    'FINISHER(MFY)':      ['3.2. MFY'],
    'BATCHCOOKER GRILL':  ['3.6. Batch Cooker Grill'],
    'BATCHCOOKER FRITÉZA':['3.5. Batch Cooker Fritéza'],
    'HRANOLKY':           ['3.7. Hranolky & Hash browns'],
    'SALÁTY A TEMPERACE': ['3.1. Temperace & Příprava'],
    'VÝDEJ':              ['4.1. Kompletace & Prezentace'],
    'POKLADNA':           ['4.2. Objednávka & Platba'],
    'BEVERAGE':           ['3.8. Nápoje & Dezerty'],
    'LOBBY':              ['4.5. Lobby & Kiosek'],
    // LPOH handled by position, not verification
    // NAVÁŽKA has no verification - purely manual
};

// Position ID for Lídr péče o hosty
const LPOH_POSITION_ID = 16;

// Helper: loose ID match (handles string vs number)
function idMatch(a, b) { return String(a) === String(b); }
function idInList(list, id) { return list.some(x => String(x) === String(id)); }

document.addEventListener("DOMContentLoaded", async () => {
    await loadData();
    renderAll();
    initColumnHighlight();
});

// Crosshair column highlight via event delegation
function initColumnHighlight() {
    document.querySelectorAll('.tracker-table').forEach(table => {
        let prevColIdx = -1;

        table.addEventListener('mouseover', (e) => {
            const td = e.target.closest('td');
            if (!td) return;
            const tr = td.closest('tr');
            if (!tr) return;
            
            const colIdx = Array.from(tr.children).indexOf(td);
            if (colIdx === prevColIdx) return; // Same column, skip
            
            // Clear previous column highlight
            table.querySelectorAll('.col-highlight').forEach(el => el.classList.remove('col-highlight'));
            prevColIdx = colIdx;
            
            // Highlight all cells in this column (tbody rows only)
            table.querySelectorAll('tbody tr').forEach(row => {
                const cell = row.children[colIdx];
                if (cell) cell.classList.add('col-highlight');
            });
        });

        table.addEventListener('mouseleave', () => {
            table.querySelectorAll('.col-highlight').forEach(el => el.classList.remove('col-highlight'));
            prevColIdx = -1;
        });
    });
}

async function loadData() {
    try {
        const [empRes, dataRes] = await Promise.all([
            fetch('/api/employees_raw'),
            fetch('/api/tables_data')
        ]);
        allEmployees = await empRes.json();
        tablesData = await dataRes.json();

        // Ensure default structure
        if (!tablesData.cells) tablesData.cells = {};
        if (!tablesData.hidden) tablesData.hidden = [];
        if (!tablesData.nocni) tablesData.nocni = [];
        if (!tablesData.auto) tablesData.auto = {};

        allEmployees.sort((a, b) => {
            let nameA = (a.surname + " " + a.name).toLowerCase();
            let nameB = (b.surname + " " + b.name).toLowerCase();
            return nameA.localeCompare(nameB);
        });

        // Show last sync time if available
        updateLastSyncDisplay();

    } catch (err) {
        console.error("Failed to load data:", err);
    }
}

function updateLastSyncDisplay() {
    const el = document.getElementById('last-sync-time');
    if (!el) return;
    if (tablesData.lastSync) {
        const d = new Date(tablesData.lastSync);
        el.innerText = `Poslední sync: ${d.toLocaleDateString('cs-CZ')} ${d.toLocaleTimeString('cs-CZ', {hour:'2-digit', minute:'2-digit'})}`;
    } else {
        el.innerText = 'Zatím nesynchronizováno';
    }
}

async function saveData() {
    try {
        await fetch('/api/tables_data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tablesData)
        });
    } catch (err) {
        console.error("Failed to save data:", err);
    }
}

function switchTab(tabId) {
    document.querySelectorAll('.table-section').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('active');
    });
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    document.getElementById(tabId).classList.remove('hidden');
    document.getElementById(tabId).classList.add('active');
    
    // Find the button that called this (hacky but works based on onclick string)
    document.querySelector(`.tab-btn[onclick="switchTab('${tabId}')"]`).classList.add('active');

    // Show/Hide "Add to Nocni" button
    const nocniBtn = document.getElementById('add-to-nocni-btn');
    if (tabId === 'tab-nocni') {
        nocniBtn.classList.remove('hidden');
    } else {
        nocniBtn.classList.add('hidden');
    }
}

function cycleCellState(empId, colName, tableId) {
    // Build key with nocni prefix if applicable
    const key = tableId === 'table-nocni' ? `${empId}_NOCNI_${colName}` : `${empId}_${colName}`;
    const current = tablesData.cells[key] || '';
    
    // Block editing if cell is auto-verified (synced ✔)
    if (current === '✔' && tablesData.auto[key]) return;
    
    let next = '';
    if (current === '') next = '•';
    else if (current === '•') next = '✔';
    else next = '';

    tablesData.cells[key] = next;
    
    // Mark as manual (remove auto flag)
    delete tablesData.auto[key];
    
    saveData();
    // Re-render efficiently just this cell (by ID hook)
    const cellEl = document.getElementById(`cell-${key}`);
    if (cellEl) {
        cellEl.innerText = next;
        // Update yellow highlight for manual
        if (next) {
            cellEl.classList.add('manual-cell');
        } else {
            cellEl.classList.remove('manual-cell');
        }
    }
}

// ========= AUTO-FILL SYNC =========
async function syncVerifications() {
    const btn = document.getElementById('sync-verifs-btn');
    if (btn) {
        btn.disabled = true;
        btn.innerText = '⏳ Synchronizuji...';
    }

    try {
        const res = await fetch('/api/sync_verifications', { method: 'POST' });
        const verifMap = await res.json(); // { empId: [verifiedNames] }

        let changeCount = 0;

        allEmployees.forEach(emp => {
            const empVerifs = verifMap[String(emp.id)] || [];

            // Auto-fill CREW table columns based on verification mapping
            for (const [colName, apiNames] of Object.entries(VERIFICATION_MAP)) {
                const hasVerif = apiNames.some(name => empVerifs.includes(name));
                if (hasVerif) {
                    const key = `${emp.id}_${colName}`;
                    // Always override to ✔ and mark as auto (removes yellow)
                    if (tablesData.cells[key] !== '✔' || !tablesData.auto[key]) {
                        tablesData.cells[key] = '✔';
                        tablesData.auto[key] = true;
                        changeCount++;
                    }
                }
            }

            // Auto-fill LPOH based on position
            if (emp.positionId === LPOH_POSITION_ID) {
                const lpohKey = `${emp.id}_LPOH`;
                if (tablesData.cells[lpohKey] !== '✔') {
                    tablesData.cells[lpohKey] = '✔';
                    tablesData.auto[lpohKey] = true;
                    changeCount++;
                }
            }
        });

        // Save last sync timestamp
        tablesData.lastSync = new Date().toISOString();

        await saveData();
        renderAll();
        updateLastSyncDisplay();
        alert(`Synchronizace dokončena! Automaticky vyplněno ${changeCount} políček.`);
    } catch (err) {
        console.error('Sync failed:', err);
        alert('Chyba při synchronizaci verifikací.');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = '🔄 Synchronizovat verifikace';
        }
    }
}

function hideEmployee(empId, tableId) {
    if (String(empId).startsWith('cust_')) {
        // Completely remove custom employee
        tablesData.custom = (tablesData.custom || []).filter(e => e.id !== empId);
        
        // Cleanup their grid cell states
        Object.keys(tablesData.cells).forEach(key => {
            if (key.startsWith(empId + '_')) delete tablesData.cells[key];
        });
        
        saveData();
        renderAll();
        return;
    }

    // Coerce to number for consistent comparison with API IDs
    const numId = Number(empId);

    // On Noční table: remove from nocni list (don't hide globally)
    if (tableId === 'table-nocni') {
        tablesData.nocni = tablesData.nocni.filter(id => !idMatch(id, empId));
        saveData();
        renderAll();
        return;
    }

    // On other tables: hide globally
    if (!idInList(tablesData.hidden, empId)) {
        tablesData.hidden.push(empId);
        saveData();
        renderAll();
    }
}

function addCustomEmployee() {
    // Determine the currently active tab (to assign the custom employee correctly)
    const activeTab = document.querySelector('.table-section.active');
    if (!activeTab || activeTab.id === 'tab-hidden') {
        alert("Zvolte prosím nejdříve tabulku (Crew, Noční...), kam chcete zaměstnance přidat.");
        return;
    }
    const targetTableId = activeTab.id.replace('tab-', 'table-');

    const fullName = prompt('Zadejte křestní jméno a příjmení vlastního zaměstnance:\n(např. Novák Jan)');
    if (!fullName || !fullName.trim()) return;

    let parts = fullName.trim().split(' ');
    let surname = parts[0];
    let name = parts.length > 1 ? parts.slice(1).join(' ') : '';
    
    const newId = 'cust_' + Date.now();
    tablesData.custom = tablesData.custom || [];
    tablesData.custom.push({
        id: newId,
        surname: surname,
        name: name,
        targetTab: targetTableId
    });
    
    saveData();
    renderAll();
}

function unhideEmployee(empId) {
    tablesData.hidden = tablesData.hidden.filter(id => !idMatch(id, empId));
    saveData();
    renderAll();
}

function renderAll() {
    renderTable('table-crew-trenink', [1], CREW_COLS, 'PŘEHLED TRÉNINKU - CREW V TRÉNINKU', true); // 1 = Crew v Treninku
    renderTable('table-crew', [2, 16], CREW_COLS, 'PŘEHLED TRÉNINKU - CREW', true); // 2 = Crew, 16 = LPOH
    renderNocniTable();
    renderHiddenList();
    renderNocniModalList();
}

function renderTable(tableId, targetPositions, columnsDefinition, title, hasStanoviste) {
    const table = document.getElementById(tableId);
    if (!table) return;

    let html = buildTableHeader(columnsDefinition, title, hasStanoviste);
    
    const visibleEmployees = allEmployees.filter(e => 
        targetPositions.includes(e.positionId) && !idInList(tablesData.hidden, e.id)
    );
    
    const customs = (tablesData.custom || []).filter(c => c.targetTab === tableId);
    let combined = visibleEmployees.concat(customs);
    combined.sort((a,b) => a.surname.localeCompare(b.surname) || a.name.localeCompare(b.name));

    html += buildTableBody(combined, columnsDefinition, tableId);
    table.innerHTML = html;
}

function renderNocniTable() {
    const table = document.getElementById('table-nocni');
    if (!table) return;

    let html = buildTableHeader(NOCNI_COLS, 'PŘEHLED TRÉNINKU - NOČNÍ', false);
    
    const visibleEmployees = allEmployees.filter(e => 
        idInList(tablesData.nocni, e.id)
    );
    
    const customs = (tablesData.custom || []).filter(c => c.targetTab === 'table-nocni');
    let combined = visibleEmployees.concat(customs);
    combined.sort((a,b) => a.surname.localeCompare(b.surname) || a.name.localeCompare(b.name));

    html += buildTableBody(combined, NOCNI_COLS, 'table-nocni');
    table.innerHTML = html;
}

function buildTableHeader(columnsDef, title, hasStanoviste) {
    let totalCols = 0;
    columnsDef.forEach(g => totalCols += g.cols.length);

    let html = '<thead>';
    
    // Row 1: Title
    html += `<tr><th colspan="${totalCols + 2}" class="table-title-cell">${title}</th></tr>`;

    if (hasStanoviste) {
        html += `<tr>`;
        html += `<th rowspan="3" class="name-col">JMÉNO</th>`;
        html += `<th colspan="${totalCols}" class="group-header">STANOVIŠTĚ</th>`;
        html += `<th rowspan="3" class="actions-col no-print"></th>`;
        html += `</tr>`;
        
        html += `<tr>`;
        columnsDef.forEach((g, gi) => {
            const cls = gi === 0 ? 'group-header group-start' : 'group-header';
            html += `<th colspan="${g.cols.length}" class="${cls}">${g.group}</th>`;
        });
        html += `</tr>`;
    } else {
        html += `<tr>`;
        html += `<th rowspan="2" class="name-col">JMÉNO</th>`;
        columnsDef.forEach((g, gi) => {
            const cls = gi === 0 ? 'group-header group-start' : 'group-header';
            html += `<th colspan="${g.cols.length}" class="${cls}">${g.group}</th>`;
        });
        html += `<th rowspan="2" class="actions-col no-print"></th>`;
        html += `</tr>`;
    }

    html += `<tr>`;
    columnsDef.forEach(g => {
        g.cols.forEach((c, ci) => {
            const cls = ci === 0 ? 'vertical-header group-start' : 'vertical-header';
            html += `<th class="${cls}"><div class="vertical-text">${c}</div></th>`;
        });
    });
    html += `</tr></thead>`;
    return html;
}

function buildTableBody(employeesList, columnsDef, tableId) {
    window.cycleCellState = cycleCellState;
    let html = '';
    
    // Build flat array of columns
    let flatCols = [];
    columnsDef.forEach(g => flatCols = flatCols.concat(g.cols));

    // Build set of column names that start a new group (for thicker left border)
    let groupStartCols = new Set();
    columnsDef.forEach(g => { if (g.cols.length > 0) groupStartCols.add(g.cols[0]); });

    const ROWS_PER_PAGE = 30;

    for (let i = 0; i < employeesList.length; i += ROWS_PER_PAGE) {
        let chunk = employeesList.slice(i, i + ROWS_PER_PAGE);
        let isNotFirstTbody = i > 0;
        
        html += `<tbody class="page-chunk ${isNotFirstTbody ? 'split-tbody' : ''}">`;
        
        chunk.forEach(emp => {
            html += `<tr>`;
            // Strip "A-" prefix from surnames (agency workers)
            const displaySurname = (emp.surname || '').replace(/^A-/, '');
            html += `<td class="name-col">${displaySurname} ${emp.name}</td>`;
            
            flatCols.forEach(col => {
                // Nocni table uses prefixed keys to avoid collision with crew table
                const cellKey = tableId === 'table-nocni' ? `${emp.id}_NOCNI_${col}` : `${emp.id}_${col}`;
                const stateKey = cellKey; // for cycleCellState
                const state = tablesData.cells[cellKey] || '';
                const isManual = state && !tablesData.auto[cellKey];
                const manualClass = isManual ? 'manual-cell' : '';
                const groupClass = groupStartCols.has(col) ? 'group-start' : '';
                
                html += `<td class="state-cell ${manualClass} ${groupClass}" id="cell-${cellKey}" onclick="window.cycleCellState('${emp.id}', '${col}', '${tableId}')">${state}</td>`;
            });
            
            html += `<td class="actions-col no-print">
                        <button class="btn-hide" onclick="hideEmployee('${emp.id}', '${tableId}')" title="${tableId === 'table-nocni' ? 'Odebrat z Noční' : 'Skrýt zaměstnance'}">✕</button>
                     </td>`;
            html += `</tr>`;
        });
        
        html += `</tbody>`;
    }

    return html;
}

function renderHiddenList() {
    const ul = document.getElementById('hidden-list');
    const badge = document.getElementById('hidden-count');
    
    const hiddenEmps = allEmployees.filter(e => idInList(tablesData.hidden, e.id));
    badge.innerText = hiddenEmps.length;

    let html = '';
    if (hiddenEmps.length === 0) {
        html = '<li><i>Žádní skrytí zaměstnanci.</i></li>';
    } else {
        hiddenEmps.forEach(emp => {
            html += `<li>
                <span>${emp.surname} ${emp.name} (${emp.positionId === 1 ? 'Trainee' : 'Crew'})</span>
                <button class="btn" style="border: 1px solid #ccc; padding: 4px 8px;" onclick="unhideEmployee(${emp.id})">Obnovit ↺</button>
            </li>`;
        });
    }
    ul.innerHTML = html;
}

// Nocni Modal Logic
function toggleNocniModal() {
    const modal = document.getElementById('nocni-modal');
    modal.classList.toggle('hidden');
    if (!modal.classList.contains('hidden')) {
        document.getElementById('nocni-search-input').value = '';
        renderNocniModalList();
    }
}

function renderNocniModalList() {
    const list = document.getElementById('nocni-employee-list');
    const search = document.getElementById('nocni-search-input').value.toLowerCase();
    
    // Only show people not hidden, from positions 1, 2, 16, 5 (Crew Trainer)
    const eligible = allEmployees.filter(e => 
        [1, 2, 5, 16].includes(e.positionId) && 
        !idInList(tablesData.hidden, e.id)
    );

    let html = '';
    eligible.forEach(emp => {
        const fullName = `${emp.surname} ${emp.name}`;
        if (search && !fullName.toLowerCase().includes(search)) return;

        const isNocni = idInList(tablesData.nocni, emp.id);
        
        html += `<label>
            <input type="checkbox" onchange="toggleNocniStatus(${emp.id}, this.checked)" ${isNocni ? 'checked' : ''}>
            ${fullName}
        </label>`;
    });
    list.innerHTML = html;
}

function filterNocniList() {
    renderNocniModalList();
}

function toggleNocniStatus(empId, isChecked) {
    if (isChecked) {
        if (!tablesData.nocni.includes(empId)) tablesData.nocni.push(empId);
    } else {
        tablesData.nocni = tablesData.nocni.filter(id => id !== empId);
    }
    saveData();
    renderNocniTable();
}

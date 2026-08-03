// CONFIGURATION SUPABASE OFFICIELLE
const SUPABASE_URL = "https://ygvttaydgenzdmbsykfn.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_AzhjMaP1tzKYdyz01Tcmig_cUk44aNL";

// Initialisation du client Supabase
const supabase = window.supabase 
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) 
    : null;

// IDENTIFIANTS ADMINISTRATION
const ADMIN_CREDENTIALS = {
    username: "admin",
    password: "GameHub2026!"
};

const STORAGE_LIMIT_BYTES = 700 * 1024 * 1024; // 700 Mo
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;  // 20 Mo

let currentCategoryFilter = 'ALL';
let currentSearchTerm = '';
let currentTotalStorageBytes = 0;

// Exécution au chargement du DOM
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    initApp();
});

async function initApp() {
    if (!supabase) {
        console.error("GameHub : Impossible d'initialiser Supabase.");
        return;
    }
    try {
        await checkStorageCapacityAndAdjustForm();
        await fetchApprovedGames();
    } catch (err) {
        console.error("Erreur d'initialisation :", err);
    }
}

function setupEventListeners() {
    // 1. GESTION DES MODALES (Ouverture / Fermeture)
    const modalConfig = [
        { btnId: 'publishBtn', modalId: 'publishModal', action: () => checkStorageCapacityAndAdjustForm() },
        { btnId: 'settingsBtn', modalId: 'settingsModal' },
        { btnId: 'closePublish', modalId: 'publishModal', isClose: true },
        { btnId: 'closeSettings', modalId: 'settingsModal', isClose: true },
        { btnId: 'closeMoreInfo', modalId: 'moreInfoModal', isClose: true },
        { btnId: 'closeAdmin', modalId: 'adminModal', isClose: true }
    ];

    modalConfig.forEach(cfg => {
        const btn = document.getElementById(cfg.btnId);
        const modal = document.getElementById(cfg.modalId);
        if (btn && modal) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                if (cfg.isClose) {
                    modal.classList.remove('active');
                } else {
                    if (typeof cfg.action === 'function') cfg.action();
                    modal.classList.add('active');
                }
            });
        }
    });

    // Modales imbriquées
    const moreInfoBtn = document.getElementById('moreInfoBtn');
    if (moreInfoBtn) {
        moreInfoBtn.addEventListener('click', () => {
            document.getElementById('settingsModal').classList.remove('active');
            document.getElementById('moreInfoModal').classList.add('active');
        });
    }

    const devNavBtn = document.getElementById('devNavBtn');
    if (devNavBtn) {
        devNavBtn.addEventListener('click', () => {
            document.getElementById('moreInfoModal').classList.remove('active');
            document.getElementById('adminModal').classList.add('active');
        });
    }

    // 2. NETTOYAGE DU CACHE LOCAL
    const clearDataBtn = document.getElementById('clearDataBtn');
    if (clearDataBtn) {
        clearDataBtn.addEventListener('click', () => {
            if (confirm("Voulez-vous effacer le stockage temporaire du navigateur ?")) {
                localStorage.clear();
                sessionStorage.clear();
                showToast("Cache local nettoyé avec succès.");
            }
        });
    }

    // 3. AUTHENTIFICATION ADMIN
    const adminLoginForm = document.getElementById('adminLoginForm');
    if (adminLoginForm) {
        adminLoginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const userIn = document.getElementById('adminUsername').value.trim();
            const passIn = document.getElementById('adminPassword').value.trim();

            if (userIn === ADMIN_CREDENTIALS.username && passIn === ADMIN_CREDENTIALS.password) {
                showToast("Connexion réussie.");
                loadAdminDashboard();
            } else {
                showToast("Identifiants incorrects.", true);
            }
        });
    }

    const adminLogoutBtn = document.getElementById('adminLogoutBtn');
    if (adminLogoutBtn) {
        adminLogoutBtn.addEventListener('click', () => {
            document.getElementById('adminAuthSection').classList.remove('hidden');
            document.getElementById('adminDashboardSection').classList.add('hidden');
            document.getElementById('adminLoginForm').reset();
            showToast("Déconnexion effectuée.");
        });
    }

    // 4. FILTRES ET RECHERCHE
    document.querySelectorAll('.cat-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            currentCategoryFilter = e.target.dataset.category;
            fetchApprovedGames();
        });
    });

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearchTerm = e.target.value;
            fetchApprovedGames();
        });
    }

    // 5. ONGLETS ADMINISTRATION
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            if (e.target.id === 'adminLogoutBtn') return;
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            e.target.classList.add('active');
            const targetId = e.target.dataset.tab;
            const targetContent = document.getElementById(targetId);
            if (targetContent) targetContent.classList.add('active');
        });
    });

    // 6. SOUMISSION DU FORMULAIRE DE PUBLICATION
    const publishForm = document.getElementById('publishForm');
    if (publishForm) {
        publishForm.addEventListener('submit', handlePublishSubmit);
    }
}

async function calculateStorageMetrics() {
    if (!supabase) return { approvedSize: 0, pendingSize: 0, countApproved: 0, countPending: 0 };
    try {
        const { data: approved } = await supabase.from('games').select('file_size_bytes');
        const { data: pending } = await supabase.from('pending_games').select('file_size_bytes').eq('status', 'pending');

        const approvedSize = approved ? approved.reduce((acc, curr) => acc + (curr.file_size_bytes || 0), 0) : 0;
        const pendingSize = pending ? pending.reduce((acc, curr) => acc + (curr.file_size_bytes || 0), 0) : 0;

        currentTotalStorageBytes = approvedSize;
        return { approvedSize, pendingSize, countApproved: approved?.length || 0, countPending: pending?.length || 0 };
    } catch (e) {
        console.error("Erreur de calcul du stockage :", e);
        return { approvedSize: 0, pendingSize: 0, countApproved: 0, countPending: 0 };
    }
}

async function checkStorageCapacityAndAdjustForm() {
    const { approvedSize } = await calculateStorageMetrics();
    const fileGroup = document.getElementById('fileGroup');
    const linkGroup = document.getElementById('linkGroup');
    const gameFileInput = document.getElementById('gameFile');
    const gameLinkInput = document.getElementById('gameLink');

    if (!fileGroup || !linkGroup) return;

    if (approvedSize >= STORAGE_LIMIT_BYTES) {
        fileGroup.classList.add('hidden');
        linkGroup.classList.remove('hidden');
        if (gameFileInput) gameFileInput.removeAttribute('required');
        if (gameLinkInput) gameLinkInput.setAttribute('required', 'true');
    } else {
        fileGroup.classList.remove('hidden');
        linkGroup.classList.add('hidden');
        if (gameFileInput) gameFileInput.setAttribute('required', 'true');
        if (gameLinkInput) gameLinkInput.removeAttribute('required');
    }
}

async function fetchApprovedGames() {
    if (!supabase) return;
    try {
        let query = supabase.from('games').select('*').order('created_at', { ascending: false });

        if (currentCategoryFilter !== 'ALL') {
            query = query.eq('category', currentCategoryFilter);
        }

        const { data: games, error } = await query;

        if (error) {
            showToast("Erreur de chargement des jeux.", true);
            return;
        }

        const filtered = games ? games.filter(game => {
            const term = currentSearchTerm.toLowerCase();
            return game.title.toLowerCase().includes(term) ||
                   game.author_name.toLowerCase().includes(term) ||
                   game.category.toLowerCase().includes(term);
        }) : [];

        renderGames(filtered);
    } catch (e) {
        console.error("Erreur de récupération des jeux :", e);
    }
}

function renderGames(games) {
    const gamesGrid = document.getElementById('gamesGrid');
    if (!gamesGrid) return;
    
    gamesGrid.innerHTML = '';

    if (!games || games.length === 0) {
        gamesGrid.innerHTML = `<p class="help-text">Aucun jeu disponible.</p>`;
        return;
    }

    games.forEach(game => {
        const card = document.createElement('div');
        card.className = 'game-card';

        const sizeInMb = (game.file_size_bytes / (1024 * 1024)).toFixed(1);
        const playUrl = game.type === 'file' 
            ? supabase.storage.from('games').getPublicUrl(game.file_path).data.publicUrl
            : game.external_url;

        card.innerHTML = `
            <div class="card-img-wrapper">
                <img src="${game.image_url}" alt="${escapeHtml(game.title)}" loading="lazy">
            </div>
            <div class="card-content">
                <div class="card-title">${escapeHtml(game.title)}</div>
                <div class="card-author">Par ${escapeHtml(game.author_name)} (${game.category})</div>
                <div class="card-meta">
                    <span>${game.type === 'file' ? sizeInMb + ' Mo' : 'Lien Ext.'}</span>
                    <span>Téléchargements: ${game.downloads_count || 0}</span>
                </div>
                <div class="card-actions">
                    <a href="${playUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">Jouer</a>
                </div>
            </div>
        `;
        gamesGrid.appendChild(card);
    });
}

async function computeSHA256(file) {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function checkDuplicateHash(sha256) {
    if (!supabase) return false;
    const { data: existingApproved } = await supabase.from('games').select('id').eq('sha256_hash', sha256);
    if (existingApproved && existingApproved.length > 0) return true;

    const { data: existingPending } = await supabase.from('pending_games').select('id').eq('sha256_hash', sha256);
    return existingPending && existingPending.length > 0;
}

async function handlePublishSubmit(e) {
    e.preventDefault();
    if (!supabase) return;

    const submitBtn = document.getElementById('submitGameBtn');
    submitBtn.disabled = true;
    submitBtn.innerText = "Upload en cours...";

    try {
        const authorName = document.getElementById('authorName').value.trim();
        const authorEmail = document.getElementById('authorEmail').value.trim();
        const title = document.getElementById('gameTitle').value.trim();
        const category = document.getElementById('gameCategory').value;
        const description = document.getElementById('gameDesc').value.trim();
        const thumbFile = document.getElementById('gameThumb').files[0];

        if (!thumbFile) throw new Error("Miniature obligatoire.");

        // Upload de l'image de miniature
        const thumbPath = `thumbs/${Date.now()}_${thumbFile.name}`;
        const { error: thumbErr } = await supabase.storage.from('thumbnails').upload(thumbPath, thumbFile);
        if (thumbErr) throw new Error("Erreur lors de l'envoi de la miniature.");
        const thumbUrl = supabase.storage.from('thumbnails').getPublicUrl(thumbPath).data.publicUrl;

        const isFileMode = currentTotalStorageBytes < STORAGE_LIMIT_BYTES;
        let filePath = null;
        let externalUrl = null;
        let fileSizeBytes = 0;
        let sha256Hash = null;

        if (isFileMode) {
            const gameFile = document.getElementById('gameFile').files[0];
            if (!gameFile) throw new Error("Fichier HTML requis.");
            if (!gameFile.name.endsWith('.html')) throw new Error("Seuls les fichiers .html sont autorisés.");
            if (gameFile.size > MAX_FILE_SIZE_BYTES) throw new Error("Taille maximale dépassée (20 Mo).");

            fileSizeBytes = gameFile.size;
            sha256Hash = await computeSHA256(gameFile);

            const isDuplicate = await checkDuplicateHash(sha256Hash);
            if (isDuplicate) {
                showToast("Ce jeu a déjà été soumis sur la plateforme.", true);
                submitBtn.disabled = false;
                submitBtn.innerText = "Envoyer pour Validation";
                return;
            }

            filePath = `games_html/${Date.now()}_${gameFile.name}`;
            const { error: fileErr } = await supabase.storage.from('games').upload(filePath, gameFile);
            if (fileErr) throw new Error("Erreur lors de l'envoi du fichier du jeu.");

        } else {
            externalUrl = document.getElementById('gameLink').value.trim();
            if (!externalUrl) throw new Error("URL valide requise.");
        }

        const { error: insertErr } = await supabase.from('pending_games').insert([{
            title,
            author_name: authorName,
            author_email: authorEmail,
            description,
            category,
            type: isFileMode ? 'file' : 'link',
            file_path: filePath,
            external_url: externalUrl,
            image_url: thumbUrl,
            file_size_bytes: fileSizeBytes,
            sha256_hash: sha256Hash,
            status: 'pending'
        }]);

        if (insertErr) throw insertErr;

        showToast("Publication soumise avec succès !");
        document.getElementById('publishModal').classList.remove('active');
        document.getElementById('publishForm').reset();

    } catch (err) {
        showToast(err.message || "Erreur de publication", true);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = "Envoyer pour Validation";
    }
}

async function loadAdminDashboard() {
    document.getElementById('adminAuthSection').classList.add('hidden');
    document.getElementById('adminDashboardSection').classList.remove('hidden');

    await renderPendingRequests();
    await renderApprovedAdminList();
    await renderStorageAndStats();
    await renderLogs();
}

async function renderPendingRequests() {
    const container = document.getElementById('pendingListContainer');
    if (!container || !supabase) return;

    const { data: requests } = await supabase.from('pending_games').select('*').eq('status', 'pending');
    document.getElementById('pendingCountBadge').innerText = requests ? requests.length : 0;

    container.innerHTML = '';
    if (!requests || requests.length === 0) {
        container.innerHTML = '<p class="help-text">Aucune demande en attente.</p>';
        return;
    }

    requests.forEach(req => {
        const div = document.createElement('div');
        div.className = 'admin-item-card';
        const sizeMb = (req.file_size_bytes / (1024 * 1024)).toFixed(1);
        const openUrl = req.type === 'file' 
            ? supabase.storage.from('games').getPublicUrl(req.file_path).data.publicUrl
            : req.external_url;

        div.innerHTML = `
            <img src="${req.image_url}" class="admin-item-img" alt="${escapeHtml(req.title)}">
            <div class="admin-item-details">
                <h4>${escapeHtml(req.title)} (${req.category})</h4>
                <p><small>Auteur: ${escapeHtml(req.author_name)} (${escapeHtml(req.author_email)})</small></p>
                <p><small>Taille: ${req.type === 'file' ? sizeMb + ' Mo' : 'Lien Ext.'}</small></p>
            </div>
            <div class="admin-item-actions">
                <a href="${openUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Tester</a>
                <button type="button" class="btn btn-primary btn-sm" onclick="approveGame('${req.id}')">Valider</button>
                <button type="button" class="btn btn-danger btn-sm" onclick="rejectGame('${req.id}')">Refuser</button>
            </div>
        `;
        container.appendChild(div);
    });
}

window.approveGame = async function(requestId) {
    if (!supabase) return;
    const { data: req } = await supabase.from('pending_games').select('*').eq('id', requestId).single();
    if (!req) return;

    const { error: insErr } = await supabase.from('games').insert([{
        title: req.title,
        author_name: req.author_name,
        author_email: req.author_email,
        description: req.description,
        category: req.category,
        type: req.type,
        file_path: req.file_path,
        external_url: req.external_url,
        image_url: req.image_url,
        file_size_bytes: req.file_size_bytes,
        sha256_hash: req.sha256_hash
    }]);

    if (insErr) {
        showToast("Erreur d'approbation", true);
        return;
    }

    await supabase.from('pending_games').update({ status: 'approved' }).eq('id', requestId);
    await logAdminAction('AUTORISER_JEU', requestId, `Approuvé: ${req.title}`);

    showToast("Jeu validé et publié !");
    loadAdminDashboard();
    fetchApprovedGames();
};

window.rejectGame = async function(requestId) {
    if (!supabase) return;
    const { data: req } = await supabase.from('pending_games').select('*').eq('id', requestId).single();
    if (!req) return;

    await supabase.from('pending_games').update({ status: 'rejected' }).eq('id', requestId);
    await logAdminAction('REFUSER_JEU', requestId, `Refusé: ${req.title}`);

    showToast("Demande refusée.");
    loadAdminDashboard();
};

async function renderApprovedAdminList() {
    const container = document.getElementById('approvedListContainer');
    if (!container || !supabase) return;

    const { data: games } = await supabase.from('games').select('*').order('created_at', { ascending: false });
    container.innerHTML = '';

    if (!games || games.length === 0) {
        container.innerHTML = '<p class="help-text">Aucun jeu approuvé.</p>';
        return;
    }

    games.forEach(game => {
        const div = document.createElement('div');
        div.className = 'admin-item-card';
        div.innerHTML = `
            <img src="${game.image_url}" class="admin-item-img" alt="${escapeHtml(game.title)}">
            <div class="admin-item-details">
                <h4>${escapeHtml(game.title)}</h4>
                <p><small>Auteur: ${escapeHtml(game.author_name)}</small></p>
            </div>
            <div class="admin-item-actions">
                <button type="button" class="btn btn-danger btn-sm" onclick="deleteApprovedGame('${game.id}')">Supprimer</button>
            </div>
        `;
        container.appendChild(div);
    });
}

window.deleteApprovedGame = async function(gameId) {
    if (!supabase || !confirm("Confirmer la suppression définitive ?")) return;

    const { data: game } = await supabase.from('games').select('*').eq('id', gameId).single();
    if (!game) return;

    if (game.type === 'file' && game.file_path) {
        await supabase.storage.from('games').remove([game.file_path]);
    }

    await supabase.from('games').delete().eq('id', gameId);
    await logAdminAction('SUPPRIMER_JEU', gameId, `Supprimé: ${game.title}`);

    showToast("Jeu supprimé.");
    loadAdminDashboard();
    fetchApprovedGames();
};

async function renderStorageAndStats() {
    const metrics = await calculateStorageMetrics();
    
    const usedMb = (metrics.approvedSize / (1024 * 1024)).toFixed(2);
    const percent = Math.min(((metrics.approvedSize / STORAGE_LIMIT_BYTES) * 100), 100).toFixed(1);
    const remainingMb = ((STORAGE_LIMIT_BYTES - metrics.approvedSize) / (1024 * 1024)).toFixed(2);

    const bar = document.getElementById('storageProgressBar');
    if (bar) bar.style.width = `${percent}%`;

    if (document.getElementById('storageUsedText')) document.getElementById('storageUsedText').innerText = `${usedMb} Mo`;
    if (document.getElementById('storagePercentText')) document.getElementById('storagePercentText').innerText = `${percent}%`;
    if (document.getElementById('storageRemainingText')) document.getElementById('storageRemainingText').innerText = `${remainingMb} Mo`;

    if (document.getElementById('statApprovedGames')) document.getElementById('statApprovedGames').innerText = metrics.countApproved;
    if (document.getElementById('statPendingGames')) document.getElementById('statPendingGames').innerText = metrics.countPending;
    if (document.getElementById('statApprovedSize')) document.getElementById('statApprovedSize').innerText = `${usedMb} Mo`;
    if (document.getElementById('statPendingSize')) document.getElementById('statPendingSize').innerText = `${(metrics.pendingSize / (1024 * 1024)).toFixed(2)} Mo`;
}

async function logAdminAction(action, targetId, details) {
    if (!supabase) return;
    await supabase.from('admin_logs').insert([{ action, target_id: targetId, details }]);
}

async function renderLogs() {
    const container = document.getElementById('logsContainer');
    if (!container || !supabase) return;

    const { data: logs } = await supabase.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(50);
    container.innerHTML = '';

    if (!logs || logs.length === 0) {
        container.innerHTML = '<li>Aucun log système.</li>';
        return;
    }

    logs.forEach(log => {
        const li = document.createElement('li');
        li.innerText = `[${new Date(log.created_at).toLocaleString()}] ${log.action} - ${log.details}`;
        container.appendChild(li);
    });
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.innerText = message;
    toast.style.borderColor = isError ? 'var(--danger)' : 'var(--accent)';
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3500);
}

function escapeHtml(str) {
    return str ? str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : '';
}

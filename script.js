// CONFIGURATION SUPABASE (Remplacez par vos vraies clés quand vous serez prêt)
const SUPABASE_URL = "https://YOUR-SUPABASE-URL.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-SUPABASE-ANON-KEY";

// Vérification de la validité de la configuration Supabase
const isSupabaseConfigured = () => {
    return window.supabase 
        && SUPABASE_URL !== "https://YOUR-SUPABASE-URL.supabase.co" 
        && SUPABASE_ANON_KEY !== "YOUR-SUPABASE-ANON-KEY";
};

const supabase = isSupabaseConfigured() 
    ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) 
    : null;

// IDENTIFIANTS ADMINISTRATION
const ADMIN_CREDENTIALS = {
    username: "admin",
    password: "GameHub2026!"
};

const STORAGE_LIMIT_BYTES = 700 * 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

let currentCategoryFilter = 'ALL';
let currentSearchTerm = '';
let currentTotalStorageBytes = 0;

// Exécution garantie dès que le DOM est prêt
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    initApp();
});

async function initApp() {
    if (!supabase) {
        console.warn("GameHub: Supabase n'est pas configuré. Mode démonstration local actif.");
        return;
    }
    try {
        await checkStorageCapacityAndAdjustForm();
        await fetchApprovedGames();
    } catch (err) {
        console.error("Erreur lors de l'initialisation de Supabase :", err);
    }
}

function setupEventListeners() {
    // 1. GESTION DES MODALES
    const modalPairs = [
        { btnId: 'publishBtn', modalId: 'publishModal', closeId: 'closePublish', action: () => checkStorageCapacityAndAdjustForm() },
        { btnId: 'settingsBtn', modalId: 'settingsModal', closeId: 'closeSettings' },
        { btnId: 'closeMoreInfo', modalId: 'moreInfoModal', action: 'close' },
        { btnId: 'closeAdmin', modalId: 'adminModal', action: 'close' }
    ];

    // Attachement des ouvertures/fermetures de modales de base
    modalPairs.forEach(pair => {
        const btn = document.getElementById(pair.btnId);
        const modal = document.getElementById(pair.modalId);

        if (btn && modal) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                if (pair.action === 'close') {
                    modal.classList.remove('active');
                } else {
                    if (typeof pair.action === 'function') pair.action();
                    modal.classList.add('active');
                }
            });
        }
    });

    // Gestion spécifique des fermetures
    const closePublish = document.getElementById('closePublish');
    const closeSettings = document.getElementById('closeSettings');
    if (closePublish) closePublish.onclick = () => document.getElementById('publishModal').classList.remove('active');
    if (closeSettings) closeSettings.onclick = () => document.getElementById('settingsModal').classList.remove('active');

    // Navigation inter-modales
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
            if (confirm("Voulez-vous vraiment effacer les données locales stockées par votre navigateur ?")) {
                localStorage.clear();
                sessionStorage.clear();
                showToast("Données de sauvegarde du navigateur effacées.");
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
                showToast("Connexion au Panneau de Gestion réussie.");
                loadAdminDashboard();
            } else {
                showToast("Nom d'utilisateur ou mot de passe incorrect.", true);
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

    // 5. ONGLETS ADMIN
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            e.target.classList.add('active');
            const targetId = e.target.dataset.tab;
            const targetContent = document.getElementById(targetId);
            if (targetContent) targetContent.classList.add('active');
        });
    });

    // 6. FORMULAIRE DE PUBLICATION
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
        console.error("Erreur calcul stockage:", e);
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
            showToast("Erreur lors du chargement des jeux", true);
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
        console.error("Erreur chargement jeux:", e);
    }
}

function renderGames(games) {
    const gamesGrid = document.getElementById('gamesGrid');
    if (!gamesGrid) return;
    
    gamesGrid.innerHTML = '';

    if (!games || games.length === 0) {
        gamesGrid.innerHTML = `<p class="help-text">Aucun jeu ne correspond à votre recherche.</p>`;
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
                    <span>Taille: ${game.type === 'file' ? sizeInMb + ' Mo' : 'Lien Ext.'}</span>
                    <span>Téléchargements: ${game.downloads_count || 0}</span>
                </div>
                <div class="card-actions">
                    <a href="${playUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary play-btn">Jouer</a>
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
    if (!supabase) {
        showToast("Veuillez configurer Supabase dans script.js pour publier.", true);
        return;
    }

    const submitBtn = document.getElementById('submitGameBtn');
    submitBtn.disabled = true;
    submitBtn.innerText = "Traitement en cours...";

    try {
        const authorName = document.getElementById('authorName').value.trim();
        const authorEmail = document.getElementById('authorEmail').value.trim();
        const title = document.getElementById('gameTitle').value.trim();
        const category = document.getElementById('gameCategory').value;
        const description = document.getElementById('gameDesc').value.trim();
        const thumbFile = document.getElementById('gameThumb').files[0];

        if (!thumbFile) throw new Error("Miniature obligatoire.");

        const thumbPath = `thumbs/${Date.now()}_${thumbFile.name}`;
        const { error: thumbErr } = await supabase.storage.from('thumbnails').upload(thumbPath, thumbFile);
        if (thumbErr) throw new Error("Échec de l'upload de l'image.");
        const thumbUrl = supabase.storage.from('thumbnails').getPublicUrl(thumbPath).data.publicUrl;

        const isFileMode = currentTotalStorageBytes < STORAGE_LIMIT_BYTES;

        let filePath = null;
        let externalUrl = null;
        let fileSizeBytes = 0;
        let sha256Hash = null;

        if (isFileMode) {
            const gameFile = document.getElementById('gameFile').files[0];
            if (!gameFile) throw new Error("Fichier HTML requis.");
            if (!gameFile.name.endsWith('.html')) throw new Error("Seuls les fichiers .html sont acceptés.");
            if (gameFile.size > MAX_FILE_SIZE_BYTES) throw new Error("Le fichier dépasse la taille maximale autorisée (20 Mo).");

            fileSizeBytes = gameFile.size;
            sha256Hash = await computeSHA256(gameFile);

            const isDuplicate = await checkDuplicateHash(sha256Hash);
            if (isDuplicate) {
                showToast("Ce jeu existe déjà sur la plateforme.", true);
                submitBtn.disabled = false;
                submitBtn.innerText = "Envoyer pour Validation";
                return;
            }

            filePath = `games_html/${Date.now()}_${gameFile.name}`;
            const { error: fileErr } = await supabase.storage.from('games').upload(filePath, gameFile);
            if (fileErr) throw new Error("Échec de l'upload du fichier HTML.");

        } else {
            externalUrl = document.getElementById('gameLink').value.trim();
            if (!externalUrl) throw new Error("Lien externe requis.");
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

        showToast("Demande de publication envoyée avec succès !");
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
    if (!container) return;

    if (!supabase) {
        container.innerHTML = '<p class="help-text">Supabase non configuré.</p>';
        return;
    }

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
            <img src="${req.image_url}" class="admin-item-img" alt="Aperçu ${escapeHtml(req.title)}">
            <div class="admin-item-details">
                <h4>${escapeHtml(req.title)} (${req.category})</h4>
                <p><small>Auteur: ${escapeHtml(req.author_name)} (${escapeHtml(req.author_email)})</small></p>
                <p><small>Taille: ${req.type === 'file' ? sizeMb + ' Mo' : 'Lien Ext.'} | Date: ${new Date(req.created_at).toLocaleDateString()}</small></p>
                <p><small>${escapeHtml(req.description)}</small></p>
            </div>
            <div class="admin-item-actions">
                <a href="${openUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">Ouvrir</a>
                <button type="button" class="btn btn-primary btn-sm" onclick="approveGame('${req.id}')">Autoriser</button>
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
        showToast("Erreur lors de l'approbation", true);
        return;
    }

    await supabase.from('pending_games').update({ status: 'approved' }).eq('id', requestId);
    await logAdminAction('AUTORISER_JEU', requestId, `Jeu approuvé: ${req.title}`);

    showToast("Jeu approuvé et rendu public !");
    loadAdminDashboard();
    fetchApprovedGames();
};

window.rejectGame = async function(requestId) {
    if (!supabase) return;
    const { data: req } = await supabase.from('pending_games').select('*').eq('id', requestId).single();
    if (!req) return;

    await supabase.from('pending_games').update({ status: 'rejected' }).eq('id', requestId);
    await logAdminAction('REFUSER_JEU', requestId, `Demande refusée: ${req.title}`);

    showToast("Demande refusée.");
    loadAdminDashboard();
};

async function renderApprovedAdminList() {
    const container = document.getElementById('approvedListContainer');
    if (!container) return;

    if (!supabase) {
        container.innerHTML = '<p class="help-text">Supabase non configuré.</p>';
        return;
    }

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
            <img src="${game.image_url}" class="admin-item-img" alt="Aperçu ${escapeHtml(game.title)}">
            <div class="admin-item-details">
                <h4>${escapeHtml(game.title)}</h4>
                <p><small>Auteur: ${escapeHtml(game.author_name)}</small></p>
            </div>
            <div class="admin-item-actions">
                <button type="button" class="btn btn-danger btn-sm" onclick="deleteApprovedGame('${game.id}')">Supprimer Définitivement</button>
            </div>
        `;
        container.appendChild(div);
    });
}

window.deleteApprovedGame = async function(gameId) {
    if (!supabase) return;
    if (!confirm("Voulez-vous supprimer définitivement ce jeu ?")) return;

    const { data: game } = await supabase.from('games').select('*').eq('id', gameId).single();
    if (!game) return;

    if (game.type === 'file' && game.file_path) {
        await supabase.storage.from('games').remove([game.file_path]);
    }
    if (game.image_url) {
        const urlParts = game.image_url.split('/');
        const thumbFileName = urlParts[urlParts.length - 1];
        await supabase.storage.from('thumbnails').remove([`thumbs/${thumbFileName}`]);
    }

    await supabase.from('games').delete().eq('id', gameId);
    await logAdminAction('SUPPRIMER_JEU', gameId, `Jeu et assets supprimés: ${game.title}`);

    showToast("Jeu définitivement supprimé.");
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
    await supabase.from('admin_logs').insert([{
        admin_id: null,
        action,
        target_id: targetId,
        details
    }]);
}

async function renderLogs() {
    const container = document.getElementById('logsContainer');
    if (!container) return;

    if (!supabase) {
        container.innerHTML = '<li>Supabase non configuré.</li>';
        return;
    }

    const { data: logs } = await supabase.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(50);
    container.innerHTML = '';

    if (!logs || logs.length === 0) {
        container.innerHTML = '<li>Aucun log disponible.</li>';
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

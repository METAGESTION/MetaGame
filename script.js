/* ==========================================
   GAMEHUB - FULL LOGIC (SUPABASE & ADMIN)
   ========================================== */

// 1. CONFIGURATION SUPABASE
const SUPABASE_URL = "https://YOUR-SUPABASE-URL.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-SUPABASE-ANON-KEY";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Limits Configuration
const STORAGE_LIMIT_BYTES = 700 * 1024 * 1024; // 700 MB
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;  // 20 MB

// State
let currentCategoryFilter = 'ALL';
let currentSearchTerm = '';
let currentTotalStorageBytes = 0;

// DOM Elements
const gamesGrid = document.getElementById('gamesGrid');
const searchInput = document.getElementById('searchInput');
const publishModal = document.getElementById('publishModal');
const settingsModal = document.getElementById('settingsModal');
const adminModal = document.getElementById('adminModal');

// Init application
document.addEventListener('DOMContentLoaded', () => {
    initApp();
    setupEventListeners();
});

async function initApp() {
    await checkStorageCapacityAndAdjustForm();
    await fetchApprovedGames();
}

// 2. STORAGE METRICS CALCULATIONS
async function calculateStorageMetrics() {
    // Calculer le stockage cumulé des jeux approuvés
    const { data: approved, error: err1 } = await supabase.from('games').select('file_size_bytes');
    const { data: pending, error: err2 } = await supabase.from('pending_games').select('file_size_bytes').eq('status', 'pending');

    let approvedSize = 0;
    let pendingSize = 0;

    if (!err1 && approved) {
        approvedSize = approved.reduce((acc, curr) => acc + (curr.file_size_bytes || 0), 0);
    }
    if (!err2 && pending) {
        pendingSize = pending.reduce((acc, curr) => acc + (curr.file_size_bytes || 0), 0);
    }

    currentTotalStorageBytes = approvedSize;
    return { approvedSize, pendingSize, countApproved: approved?.length || 0, countPending: pending?.length || 0 };
}

async function checkStorageCapacityAndAdjustForm() {
    const { approvedSize } = await calculateStorageMetrics();
    const fileGroup = document.getElementById('fileGroup');
    const linkGroup = document.getElementById('linkGroup');
    const gameFileInput = document.getElementById('gameFile');
    const gameLinkInput = document.getElementById('gameLink');

    if (approvedSize >= STORAGE_LIMIT_BYTES) {
        // Basculement automatique : Mode Lien uniquement
        fileGroup.classList.add('hidden');
        linkGroup.classList.remove('hidden');
        gameFileInput.removeAttribute('required');
        gameLinkInput.setAttribute('required', 'true');
    } else {
        // Mode Fichier actif
        fileGroup.classList.remove('hidden');
        linkGroup.classList.add('hidden');
        gameFileInput.setAttribute('required', 'true');
        gameLinkInput.removeAttribute('required');
    }
}

// 3. FETCH AND DISPLAY APPROVED GAMES
async function fetchApprovedGames() {
    let query = supabase.from('games').select('*').order('created_at', { ascending: false });

    if (currentCategoryFilter !== 'ALL') {
        query = query.eq('category', currentCategoryFilter);
    }

    const { data: games, error } = await query;

    if (error) {
        showToast("Erreur lors du chargement des jeux", true);
        return;
    }

    // Filtre frontend sur la barre de recherche (Nom, Auteur, Catégorie)
    const filtered = games.filter(game => {
        const term = currentSearchTerm.toLowerCase();
        return game.title.toLowerCase().includes(term) ||
               game.author_name.toLowerCase().includes(term) ||
               game.category.toLowerCase().includes(term);
    });

    renderGames(filtered);
}

function renderGames(games) {
    gamesGrid.innerHTML = '';

    if (games.length === 0) {
        gamesGrid.innerHTML = `<p class="help-text">Aucun jeu approuvé ne correspond à la recherche.</p>`;
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
                <img src="${game.image_url}" alt="${game.title}" loading="lazy">
            </div>
            <div class="card-content">
                <div class="card-title">${escapeHtml(game.title)}</div>
                <div class="card-author">Par ${escapeHtml(game.author_name)} (${game.category})</div>
                <div class="card-meta">
                    <span>Taille: ${game.type === 'file' ? sizeInMb + ' Mo' : 'Lien Ext.'}</span>
                    <span>Téléchargements: ${game.downloads_count}</span>
                </div>
                <div class="card-actions">
                    <a href="${playUrl}" target="_blank" class="btn btn-primary play-btn" data-id="${game.id}">Jouer</a>
                </div>
            </div>
        `;
        gamesGrid.appendChild(card);
    });
}

// 4. SHA-256 HASH COMPUTATION
async function computeSHA256(file) {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 5. ANTI-DUPLICATE CHECK
async function checkDuplicateHash(sha256) {
    const { data: existingApproved } = await supabase.from('games').select('id').eq('sha256_hash', sha256);
    if (existingApproved && existingApproved.length > 0) return true;

    const { data: existingPending } = await supabase.from('pending_games').select('id').eq('sha256_hash', sha256);
    if (existingPending && existingPending.length > 0) return true;

    return false;
}

// 6. PUBLICATION FORM SUBMISSION
document.getElementById('publishForm').addEventListener('submit', async (e) => {
    e.preventDefault();
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

        // Upload Miniature
        const thumbPath = `thumbs/${Date.now()}_${thumbFile.name}`;
        const { error: thumbErr } = await supabase.storage.from('thumbnails').upload(thumbPath, thumbFile);
        if (thumbErr) throw new Error("Échec upload image.");
        const thumbUrl = supabase.storage.from('thumbnails').getPublicUrl(thumbPath).data.publicUrl;

        // Déterminer le mode (Fichier vs Link)
        const isFileMode = currentTotalStorageBytes < STORAGE_LIMIT_BYTES;

        let filePath = null;
        let externalUrl = null;
        let fileSizeBytes = 0;
        let sha256Hash = null;

        if (isFileMode) {
            const gameFile = document.getElementById('gameFile').files[0];
            if (!gameFile) throw new Error("Fichier HTML requis.");
            if (!gameFile.name.endsWith('.html')) throw new Error("Seuls les fichiers .html sont acceptés.");
            if (gameFile.size > MAX_FILE_SIZE_BYTES) throw new Error("Le fichier dépasse la taille maximale (20 Mo).");

            fileSizeBytes = gameFile.size;
            sha256Hash = await computeSHA256(gameFile);

            // Vérification Anti-Doublon
            const isDuplicate = await checkDuplicateHash(sha256Hash);
            if (isDuplicate) {
                showToast("Ce jeu existe déjà.", true);
                submitBtn.disabled = false;
                submitBtn.innerText = "Envoyer pour Validation";
                return;
            }

            // Upload HTML Storage
            filePath = `games_html/${Date.now()}_${gameFile.name}`;
            const { error: fileErr } = await supabase.storage.from('games').upload(filePath, gameFile);
            if (fileErr) throw new Error("Échec upload fichier HTML.");

        } else {
            externalUrl = document.getElementById('gameLink').value.trim();
            if (!externalUrl) throw new Error("Lien externe requis.");
        }

        // Insertion dans pending_games
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
        publishModal.classList.remove('active');
        document.getElementById('publishForm').reset();

    } catch (err) {
        showToast(err.message || "Erreur de publication", true);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = "Envoyer pour Validation";
    }
});

// 7. NAVIGATION ET CACHOTTERIE ADMIN (META SERVICE)
function setupEventListeners() {
    // Filtres
    document.querySelectorAll('.cat-chip').forEach(chip => {
        chip.addEventListener('click', (e) => {
            document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            currentCategoryFilter = e.target.dataset.category;
            fetchApprovedGames();
        });
    });

    // Recherche instantanée
    searchInput.addEventListener('input', (e) => {
        currentSearchTerm = e.target.value;
        fetchApprovedGames();
    });

    // Modales toggles
    document.getElementById('publishBtn').onclick = () => {
        checkStorageCapacityAndAdjustForm();
        publishModal.classList.add('active');
    };
    document.getElementById('closePublish').onclick = () => publishModal.classList.remove('active');

    document.getElementById('settingsBtn').onclick = () => settingsModal.classList.add('active');
    document.getElementById('closeSettings').onclick = () => settingsModal.classList.remove('active');

    // Menu Caché Admin: Paramètres -> En savoir plus -> Je suis développeur
    document.getElementById('learnMoreBtn').onclick = () => {
        document.getElementById('learnMoreSection').classList.toggle('show');
    };

    document.getElementById('devNavBtn').onclick = () => {
        settingsModal.classList.remove('active');
        adminModal.classList.add('active');
    };
    document.getElementById('closeAdmin').onclick = () => adminModal.classList.remove('active');

    // Navigation Onglets Admin
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            
            e.target.classList.add('active');
            document.getElementById(e.target.dataset.tab).classList.add('active');
        });
    });

    // Login Admin
    document.getElementById('adminLoginForm').onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('adminEmail').value;
        const password = document.getElementById('adminPassword').value;

        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            showToast("Identifiants administration invalides", true);
        } else {
            showToast("Connexion Meta Service réussie");
            loadAdminDashboard();
        }
    };

    document.getElementById('adminLogoutBtn').onclick = async () => {
        await supabase.auth.signOut();
        document.getElementById('adminAuthSection').classList.remove('hidden');
        document.getElementById('adminDashboardSection').classList.add('hidden');
    };
}

// 8. TABLEAU DE BORD ADMIN & ACTIONS
async function loadAdminDashboard() {
    document.getElementById('adminAuthSection').classList.add('hidden');
    document.getElementById('adminDashboardSection').classList.remove('hidden');

    await renderPendingRequests();
    await renderApprovedAdminList();
    await renderStorageAndStats();
    await renderLogs();
}

// Affichage des demandes
async function renderPendingRequests() {
    const { data: requests } = await supabase.from('pending_games').select('*').eq('status', 'pending');
    const container = document.getElementById('pendingListContainer');
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
            <img src="${req.image_url}" class="admin-item-img" alt="thumb">
            <div class="admin-item-details">
                <h4>${escapeHtml(req.title)} (${req.category})</h4>
                <p><small>Auteur: ${escapeHtml(req.author_name)} (${escapeHtml(req.author_email)})</small></p>
                <p><small>Taille: ${req.type === 'file' ? sizeMb + ' Mo' : 'Lien Ext.'} | Date: ${new Date(req.created_at).toLocaleDateString()}</small></p>
                <p><small>${escapeHtml(req.description)}</small></p>
            </div>
            <div class="admin-item-actions">
                <a href="${openUrl}" target="_blank" class="btn btn-secondary btn-sm">Ouvrir</a>
                <button class="btn btn-primary btn-sm" onclick="approveGame('${req.id}')">Autoriser</button>
                <button class="btn btn-danger btn-sm" onclick="rejectGame('${req.id}')">Refuser</button>
            </div>
        `;
        container.appendChild(div);
    });
}

// Action Autoriser
window.approveGame = async function(requestId) {
    const { data: req } = await supabase.from('pending_games').select('*').eq('id', requestId).single();
    if (!req) return;

    // 1. Inserer dans la table `games`
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

    // 2. Mettre à jour le statut dans `pending_games`
    await supabase.from('pending_games').update({ status: 'approved' }).eq('id', requestId);

    // 3. Logger l'action
    await logAdminAction('AUTORISER_JEU', requestId, `Jeu approuvé: ${req.title}`);

    showToast("Jeu approuvé et rendu public !");
    loadAdminDashboard();
    fetchApprovedGames();
};

// Action Refuser
window.rejectGame = async function(requestId) {
    const { data: req } = await supabase.from('pending_games').select('*').eq('id', requestId).single();
    if (!req) return;

    await supabase.from('pending_games').update({ status: 'rejected' }).eq('id', requestId);
    await logAdminAction('REFUSER_JEU', requestId, `Demande refusée: ${req.title}`);

    showToast("Demande refusée.");
    loadAdminDashboard();
};

// Affichage et Suppression des jeux acceptés
async function renderApprovedAdminList() {
    const { data: games } = await supabase.from('games').select('*').order('created_at', { ascending: false });
    const container = document.getElementById('approvedListContainer');
    container.innerHTML = '';

    if (!games || games.length === 0) {
        container.innerHTML = '<p class="help-text">Aucun jeu approuvé.</p>';
        return;
    }

    games.forEach(game => {
        const div = document.createElement('div');
        div.className = 'admin-item-card';
        div.innerHTML = `
            <img src="${game.image_url}" class="admin-item-img" alt="thumb">
            <div class="admin-item-details">
                <h4>${escapeHtml(game.title)}</h4>
                <p><small>Auteur: ${escapeHtml(game.author_name)}</small></p>
            </div>
            <div class="admin-item-actions">
                <button class="btn btn-danger btn-sm" onclick="deleteApprovedGame('${game.id}')">Supprimer Définitivement</button>
            </div>
        `;
        container.appendChild(div);
    });
}

// Action Supprimer définitivement
window.deleteApprovedGame = async function(gameId) {
    if (!confirm("Voulez-vous supprimer définitivement ce jeu (fichiers, images et données) ?")) return;

    const { data: game } = await supabase.from('games').select('*').eq('id', gameId).single();
    if (!game) return;

    // 1. Supprimer du Storage
    if (game.type === 'file' && game.file_path) {
        await supabase.storage.from('games').remove([game.file_path]);
    }
    if (game.image_url) {
        const urlParts = game.image_url.split('/');
        const thumbFileName = urlParts[urlParts.length - 1];
        await supabase.storage.from('thumbnails').remove([`thumbs/${thumbFileName}`]);
    }

    // 2. Supprimer la ligne SQL
    await supabase.from('games').delete().eq('id', gameId);

    // 3. Log
    await logAdminAction('SUPPRIMER_JEU', gameId, `Jeu et assets supprimés: ${game.title}`);

    showToast("Jeu définitivement supprimé.");
    loadAdminDashboard();
    fetchApprovedGames();
};

// Render des Métriques de Stockage
async function renderStorageAndStats() {
    const metrics = await calculateStorageMetrics();
    
    const usedMb = (metrics.approvedSize / (1024 * 1024)).toFixed(2);
    const percent = Math.min(((metrics.approvedSize / STORAGE_LIMIT_BYTES) * 100), 100).toFixed(1);
    const remainingMb = ((STORAGE_LIMIT_BYTES - metrics.approvedSize) / (1024 * 1024)).toFixed(2);

    document.getElementById('storageProgressBar').style.width = `${percent}%`;
    document.getElementById('storageUsedText').innerText = `${usedMb} Mo`;
    document.getElementById('storagePercentText').innerText = `${percent}%`;
    document.getElementById('storageRemainingText').innerText = `${remainingMb} Mo`;

    document.getElementById('statApprovedGames').innerText = metrics.countApproved;
    document.getElementById('statPendingGames').innerText = metrics.countPending;
    document.getElementById('statApprovedSize').innerText = `${usedMb} Mo`;
    document.getElementById('statPendingSize').innerText = `${(metrics.pendingSize / (1024 * 1024)).toFixed(2)} Mo`;
}

// Logger une action
async function logAdminAction(action, targetId, details) {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('admin_logs').insert([{
        admin_id: user ? user.id : null,
        action,
        target_id: targetId,
        details
    }]);
}

// Affichage des Logs
async function renderLogs() {
    const { data: logs } = await supabase.from('admin_logs').select('*').order('created_at', { ascending: false }).limit(50);
    const container = document.getElementById('logsContainer');
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

// Utility: Toast & Escaping
function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.innerText = message;
    toast.style.borderColor = isError ? 'var(--danger)' : 'var(--accent)';
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 3500);
}

function escapeHtml(str) {
    return str ? str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : '';
}

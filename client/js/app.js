let app, auth, db;
let currentUser = null;

/* ─── Initialize Firebase ─────────────────────────────────────────────────── */

async function initFirebase() {
  try {
    const res = await fetch("/api/firebase-config");
    if (!res.ok) throw new Error("Failed to load config");
    const cfg = await res.json();

    if (!firebase.apps.length) {
      app = firebase.initializeApp(cfg);
    } else {
      app = firebase.app();
    }

    auth = firebase.auth();
    db = firebase.firestore();

    auth.onAuthStateChanged(async (user) => {
      if (user) {
        currentUser = user;
        document.getElementById("loading-screen").classList.add("hidden");
        document.getElementById("app-layout").classList.remove("hidden");
        loadUserProfile();
        loadFiles();
      } else {
        window.location.href = "/auth";
      }
    });
  } catch (err) {
    console.error("Firebase init failed:", err);
    showToast("Failed to connect. Please refresh.", "error");
  }
}

/* ─── Auth Token ───────────────────────────────────────────────────────────── */

async function getAuthToken() {
  if (!currentUser) return null;
  return currentUser.getIdToken();
}

/* ─── API Helpers ──────────────────────────────────────────────────────────── */

function usersRef() {
  return db.collection("users").doc(currentUser.uid);
}

function filesRef() {
  return usersRef().collection("files");
}

function sharesRef() {
  return usersRef().collection("shares");
}

async function api(endpoint, options = {}) {
  const token = await getAuthToken();
  const headers = { ...options.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(endpoint, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/* ─── Toast ────────────────────────────────────────────────────────────────── */

function showToast(msg, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  document.getElementById("toast-container").appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

/* ─── Navigation ───────────────────────────────────────────────────────────── */

function initNav() {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      document.getElementById(`${view}-view`).classList.add("active");
      if (view === "shared") loadShares();
    });
  });

  document.getElementById("upload-btn").addEventListener("click", () => {
    document.querySelector('[data-view="upload"]').click();
  });

  document.getElementById("logout-btn").addEventListener("click", async () => {
    await auth.signOut();
    window.location.href = "/auth";
  });
}

/* ─── User Profile ─────────────────────────────────────────────────────────── */

async function loadUserProfile() {
  try {
    const doc = await usersRef().get();
    if (doc.exists) {
      const data = doc.data();
      document.getElementById("user-name").textContent = data.username || currentUser.email;
      document.getElementById("user-email").textContent = currentUser.email;
      document.getElementById("user-avatar").textContent = (data.username || currentUser.email).charAt(0).toUpperCase();
    } else {
      document.getElementById("user-name").textContent = currentUser.email;
      document.getElementById("user-email").textContent = currentUser.email;
      document.getElementById("user-avatar").textContent = currentUser.email.charAt(0).toUpperCase();
    }
  } catch {
    document.getElementById("user-name").textContent = currentUser.email;
    document.getElementById("user-email").textContent = currentUser.email;
    document.getElementById("user-avatar").textContent = currentUser.email.charAt(0).toUpperCase();
  }
}

/* ─── File Functions ───────────────────────────────────────────────────────── */

function formatSize(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDate(timestamp) {
  if (!timestamp) return "";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fileIcon(mime) {
  const icons = {
    image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>`,
    pdf: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`,
    video: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2"></rect></svg>`,
    audio: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>`,
    zip: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"></path></svg>`,
  };

  if (mime.startsWith("image/")) return icons.image;
  if (mime === "application/pdf") return icons.pdf;
  if (mime.startsWith("video/")) return icons.video;
  if (mime.startsWith("audio/")) return icons.audio;
  if (mime.includes("zip")) return icons.zip;
  return icons.pdf;
}

function escapeHtml(t) {
  const d = document.createElement("div");
  d.textContent = t;
  return d.innerHTML;
}

async function loadFiles() {
  const list = document.getElementById("file-list");

  try {
    const snapshot = await filesRef().orderBy("uploadedAt", "desc").get();
    const files = [];
    snapshot.forEach((doc) => files.push({ id: doc.id, ...doc.data() }));

    document.getElementById("file-count").textContent = files.length;

    if (!files.length) {
      list.innerHTML = `<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg><h3>No files yet</h3><p>Upload your first file to get started.</p><button class="btn btn-primary btn-sm" onclick="document.querySelector('[data-view=upload]').click()">Upload a file</button></div>`;
      return;
    }

    list.innerHTML = files.map((f) => `
      <div class="file-item" data-id="${f.id}">
        <div class="file-icon">${fileIcon(f.mimeType)}</div>
        <div class="file-info">
          <div class="file-name">${escapeHtml(f.originalName)}</div>
          <div class="file-meta">${formatSize(f.size)} · ${formatDate(f.uploadedAt)}</div>
        </div>
        <div class="file-actions">
          <button class="btn-icon btn-preview" data-id="${f.id}" title="Preview" aria-label="Preview">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          </button>
          <button class="btn-icon btn-download" data-id="${f.id}" title="Download" aria-label="Download">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          </button>
          <button class="btn-icon btn-share" data-id="${f.id}" title="Share" aria-label="Share">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
          </button>
          <button class="btn-icon danger btn-delete" data-id="${f.id}" title="Delete" aria-label="Delete">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
    `).join("");

    list.querySelectorAll(".btn-preview").forEach((b) => b.addEventListener("click", () => previewFile(b.dataset.id)));
    list.querySelectorAll(".btn-download").forEach((b) => b.addEventListener("click", () => downloadFile(b.dataset.id)));
    list.querySelectorAll(".btn-share").forEach((b) => b.addEventListener("click", () => openShareModal(b.dataset.id)));
    list.querySelectorAll(".btn-delete").forEach((b) => b.addEventListener("click", () => deleteFile(b.dataset.id)));
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function previewFile(id) {
  const modal = document.getElementById("preview-modal");
  const title = document.getElementById("preview-title");
  const body = document.getElementById("preview-body");

  try {
    const doc = await filesRef().doc(id).get();
    if (!doc.exists) throw new Error("File not found");
    const file = doc.data();

    title.textContent = file.originalName;
    body.innerHTML = '<p style="color:var(--gray-400)">Loading...</p>';
    modal.classList.remove("hidden");

    const token = await getAuthToken();
    const res = await fetch(`/api/files/preview?id=${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) throw new Error("Preview failed");

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    if (file.mimeType.startsWith("image/")) {
      body.innerHTML = `<img src="${url}" alt="${escapeHtml(file.originalName)}">`;
    } else if (file.mimeType === "application/pdf") {
      body.innerHTML = `<iframe src="${url}"></iframe>`;
    } else if (file.mimeType.startsWith("text/") || file.mimeType.includes("json") || file.mimeType.includes("javascript")) {
      body.innerHTML = `<pre>${escapeHtml(await blob.text())}</pre>`;
    } else {
      body.innerHTML = '<p style="color:var(--gray-400)">Preview not available. Download to view.</p>';
    }
  } catch (err) {
    body.innerHTML = `<p style="color:#dc2626">${err.message}</p>`;
    modal.classList.remove("hidden");
  }
}

async function downloadFile(id) {
  try {
    const doc = await filesRef().doc(id).get();
    if (!doc.exists) throw new Error("File not found");
    const file = doc.data();

    const token = await getAuthToken();
    const res = await fetch(`/api/files/download?id=${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) throw new Error("Download failed");

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.originalName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function deleteFile(id) {
  if (!confirm("Delete this file? This cannot be undone.")) return;

  try {
    // Delete from server
    await api(`/api/files/delete?id=${id}`, { method: "DELETE" });

    // Delete from Firestore
    await filesRef().doc(id).delete();

    // Delete associated shares
    const sharesSnapshot = await sharesRef().where("fileId", "==", id).get();
    const batch = db.batch();
    sharesSnapshot.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    loadFiles();
    showToast("File deleted");
  } catch (err) {
    showToast(err.message, "error");
  }
}

/* ─── Upload ───────────────────────────────────────────────────────────────── */

function initUpload() {
  const zone = document.getElementById("upload-zone");
  const input = document.getElementById("file-input");

  input.addEventListener("change", (e) => {
    if (e.target.files.length) uploadFiles(e.target.files);
  });

  ["dragenter", "dragover"].forEach((evt) => {
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.add("dragover");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
    });
  });

  zone.addEventListener("drop", (e) => {
    const files = e.dataTransfer.files;
    if (files.length) uploadFiles(files);
  });
}

async function uploadFiles(files) {
  const progress = document.getElementById("upload-progress");
  const fill = document.getElementById("progress-fill");
  const status = document.getElementById("upload-status");
  const complete = document.getElementById("upload-complete");

  progress.classList.remove("hidden");
  complete.classList.add("hidden");
  fill.style.width = "0%";
  status.textContent = `Uploading ${files.length} file(s)...`;

  const maxFileSize = 50 * 1024 * 1024;

  try {
    for (const file of files) {
      if (file.size > maxFileSize) {
        throw new Error(`${file.name} exceeds 50MB limit`);
      }

      const formData = new FormData();
      formData.append("file", file);

      const token = await getAuthToken();
      const res = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/files/upload");
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);

        xhr.upload.addEventListener("progress", (e) => {
          if (e.lengthComputable) {
            fill.style.width = `${Math.round((e.loaded / e.total) * 100)}%`;
            status.textContent = `Uploading ${file.name}... ${Math.round((e.loaded / e.total) * 100)}%`;
          }
        });

        xhr.addEventListener("load", () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            const data = JSON.parse(xhr.responseText);
            reject(new Error(data.error || "Upload failed"));
          }
        });

        xhr.addEventListener("error", () => reject(new Error("Upload failed")));
        xhr.send(formData);
      });

      // Save metadata to Firestore
      if (res.files && res.files.length > 0) {
        const f = res.files[0];
        await filesRef().doc(f.id).set({
          originalName: f.originalName,
          mimeType: f.mimeType,
          size: f.size,
          uploadedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    progress.classList.add("hidden");
    complete.classList.remove("hidden");
    loadFiles();
    showToast("Upload complete");
  } catch (err) {
    showToast(err.message, "error");
    progress.classList.add("hidden");
  }
}

/* ─── Share ────────────────────────────────────────────────────────────────── */

function openShareModal(fileId) {
  document.getElementById("share-file-id").value = fileId;
  document.getElementById("share-result").classList.add("hidden");
  document.getElementById("share-modal").classList.remove("hidden");
}

function initShare() {
  document.getElementById("share-close").addEventListener("click", () => {
    document.getElementById("share-modal").classList.add("hidden");
  });

  document.getElementById("preview-close").addEventListener("click", () => {
    document.getElementById("preview-modal").classList.add("hidden");
    document.getElementById("preview-body").innerHTML = "";
  });

  [document.getElementById("share-modal"), document.getElementById("preview-modal")].forEach((modal) => {
    modal.querySelector(".modal-overlay").addEventListener("click", () => {
      modal.classList.add("hidden");
      if (modal.id === "preview-modal") document.getElementById("preview-body").innerHTML = "";
    });
  });

  document.getElementById("share-form").addEventListener("submit", async (e) => {
    e.preventDefault();

    const fileId = document.getElementById("share-file-id").value;
    const accessLevel = document.getElementById("share-access").value;
    const expiresAt = document.getElementById("share-expiry").value || null;

    try {
      const doc = await filesRef().doc(fileId).get();
      if (!doc.exists) throw new Error("File not found");

      const shareId = crypto.randomUUID();
      const shareToken = crypto.randomUUID().replace(/-/g, "").slice(0, 12);

      await sharesRef().doc(shareId).set({
        fileId,
        token: shareToken,
        accessLevel,
        expiresAt: expiresAt || null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });

      const shareUrl = `${window.location.origin}/shared/${shareToken}`;
      document.getElementById("share-link-input").value = shareUrl;
      document.getElementById("share-result").classList.remove("hidden");
      showToast("Share link created");
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  document.getElementById("copy-link-btn").addEventListener("click", () => {
    const input = document.getElementById("share-link-input");
    input.select();
    document.execCommand("copy");
    showToast("Copied");
  });
}

async function loadShares() {
  const list = document.getElementById("share-list");

  try {
    const snapshot = await sharesRef().orderBy("createdAt", "desc").get();
    const shares = [];
    snapshot.forEach((doc) => shares.push({ id: doc.id, ...doc.data() }));

    if (!shares.length) {
      list.innerHTML = `<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg><h3>No shared files</h3><p>Share files from your vault to see them here.</p></div>`;
      return;
    }

    list.innerHTML = shares.map((s) => {
      const expired = s.expiresAt && new Date(s.expiresAt) < new Date();
      return `
        <div class="share-item">
          <div class="file-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
          </div>
          <div class="file-info">
            <div class="file-name">Share ${expired ? "(expired)" : ""}</div>
            <div class="file-meta">${formatDate(s.createdAt)}${s.expiresAt ? " · Expires " + new Date(s.expiresAt).toLocaleDateString() : ""}</div>
          </div>
          <span class="share-badge ${s.accessLevel === "edit" ? "edit" : ""}">${s.accessLevel}</span>
          <button class="btn-icon danger btn-revoke" data-id="${s.id}" title="Revoke" aria-label="Revoke share">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      `;
    }).join("");

    list.querySelectorAll(".btn-revoke").forEach((b) => {
      b.addEventListener("click", async () => {
        try {
          await sharesRef().doc(b.dataset.id).delete();
          loadShares();
          showToast("Share revoked");
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  } catch (err) {
    showToast(err.message, "error");
  }
}

/* ─── Init ─────────────────────────────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", () => {
  initFirebase();
  initNav();
  initUpload();
  initShare();
});

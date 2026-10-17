/**
 * Utilidades DOM, Escape XSS, Notificaciones Toast y Diálogos Modales — ElTransportador v1.0.1
 * Archivo: apps/desktop/src/controllers/renderers/dom-utils.js
 */
import { translate } from "../../lang/i18n.js";

export function escapeHtml(val) {
  if (val === undefined || val === null) return "";
  return String(val)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function escapeAttr(val) {
  return escapeHtml(val);
}

/**
 * Muestra una notificación flotante más visible y con mayor duración (6.5 segundos).
 */
export function showToast(message, variant = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `etp-toast ${variant === "warning" ? "warning" : variant === "danger" ? "danger" : ""}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 6500);
}

export function clearInputDialogError() {
  const errEl = document.getElementById("input-dialog-error");
  const field = document.getElementById("input-dialog-field");
  if (errEl) {
    errEl.textContent = "";
    errEl.style.display = "none";
  }
  if (field) {
    field.classList.remove("input-error");
  }
}

export function showInputDialogError(message) {
  const errEl = document.getElementById("input-dialog-error");
  const field = document.getElementById("input-dialog-field");
  if (errEl) {
    errEl.textContent = message;
    errEl.style.display = "block";
  }
  if (field) {
    field.classList.add("input-error");
    field.focus();
  }
}

let pendingInputDialogCallback = null;
export function openInputDialog({ title, label, initialValue = "", inputType = "text", placeholder = "", onConfirm }) {
  document.getElementById("input-dialog-title").textContent = title;
  document.getElementById("input-dialog-label").textContent = label;
  clearInputDialogError();
  const field = document.getElementById("input-dialog-field");
  field.type = inputType === "password" ? "password" : "text";
  field.placeholder = placeholder || "";
  field.value = initialValue;
  pendingInputDialogCallback = onConfirm;
  document.getElementById("modal-input-dialog").classList.add("open");
  setTimeout(() => field.focus(), 30);
}

export function closeInputDialog() {
  clearInputDialogError();
  const field = document.getElementById("input-dialog-field");
  if (field) {
    field.value = "";
    field.type = "text";
  }
  document.getElementById("modal-input-dialog").classList.remove("open");
  pendingInputDialogCallback = null;
}

export function confirmInputDialog() {
  const field = document.getElementById("input-dialog-field");
  const val = (field?.value || "").trim();
  if (val && typeof pendingInputDialogCallback === "function") {
    const res = pendingInputDialogCallback(val);
    if (res && res.keepOpen) {
      if (res.errorMessage) {
        showInputDialogError(res.errorMessage);
      }
      return;
    }
    closeInputDialog();
    return;
  }
  closeInputDialog();
}

let pendingDragMoveAction = null;
export function openConfirmMoveModal(message, onAccept, titleOverride = null, lang = "es", options = {}) {
  const titleEl = document.getElementById("confirm-move-title");
  if (titleEl) {
    titleEl.textContent = titleOverride || translate(lang, "modals.moveTitle");
  }
  const msgEl = document.getElementById("confirm-move-message");
  if (msgEl) {
    msgEl.textContent = message;
  }
  const acceptBtn = document.getElementById("btn-accept-confirm-move");
  if (acceptBtn) {
    acceptBtn.textContent = options.acceptLabel || translate(lang, "modals.btnAcceptMove");
    acceptBtn.classList.toggle("etp-btn-danger", Boolean(options.isDanger));
    acceptBtn.classList.toggle("etp-btn-primary", !options.isDanger);
  }
  pendingDragMoveAction = onAccept;
  document.getElementById("modal-confirm-move").classList.add("open");
}

export function closeConfirmMoveModal() {
  document.getElementById("modal-confirm-move").classList.remove("open");
  const acceptBtn = document.getElementById("btn-accept-confirm-move");
  if (acceptBtn) {
    acceptBtn.classList.remove("etp-btn-danger");
    acceptBtn.classList.add("etp-btn-primary");
  }
  pendingDragMoveAction = null;
}

export function acceptConfirmMoveModal() {
  if (typeof pendingDragMoveAction === "function") {
    const cb = pendingDragMoveAction;
    closeConfirmMoveModal();
    cb();
    return;
  }
  closeConfirmMoveModal();
}

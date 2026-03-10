// ─── Constants ────────────────────────────────────────────────────────────────

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg'])
export const VIDEO_EXTS = new Set(['mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi'])
export const AUDIO_EXTS = new Set(['mp3', 'wav', 'oga', 'flac', 'm4a', 'aac'])
export const MAX_HISTORY_ITEMS = 64

export const STATUS_COLOR = {
    running: 'var(--p-blue-500,#3b82f6)',
    pending: 'var(--p-surface-400,#6b7280)',
    completed: 'var(--p-green-500,#22c55e)',
    failed: 'var(--p-red-500,#ef4444)',
    cancelled: 'var(--p-orange-500,#f97316)',
}

// ─── Shared Styles ────────────────────────────────────────────────────────────

export const MUTED_ICON = 'font-size:2rem;color:var(--p-text-muted-color,#888)'
export const POPUP_BG =
    'background:var(--p-overlay-popover-background,var(--p-surface-800,#1e1e1e));' +
    'border:1px solid var(--p-overlay-popover-border-color,var(--p-surface-600,#444));' +
    'border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.4)'
export const MENU_BG =
    'background:var(--comfy-menu-bg,#1a1a1a);' +
    'border:1px solid var(--border-color,#444);border-radius:6px;' +
    'box-shadow:0 4px 16px rgba(0,0,0,.4);overflow:hidden;min-width:160px'
export const GALLERY_NAV_BTN =
    'position:fixed;top:50%;transform:translateY(-50%);' +
    'background:rgba(255,255,255,.1);border:none;color:rgba(255,255,255,.8);' +
    'font-size:2rem;padding:12px 18px;cursor:pointer;border-radius:6px'
export const TOOLBAR_BTN =
    'background:none;border:none;cursor:pointer;padding:6px;border-radius:4px;' +
    'color:var(--input-text,#eee);font-size:14px'

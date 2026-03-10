const COMFY_URL = 'http://127.0.0.1:8188'

/**
 * Check if ComfyUI is reachable.
 */
export async function isComfyReachable() {
  try {
    const res = await fetch(`${COMFY_URL}/system_stats`)
    return res.ok
  } catch {
    return false
  }
}

/**
 * Open the Queue Sidebar tab by clicking the pi-history icon.
 */
export async function openSidebar(page) {
  const tab = page.locator('.sidebar-icon-wrapper .pi-history').first()
  await tab.click()
  // Give the sidebar time to render its grid
  await page.locator('[data-status]').first().waitFor({ state: 'attached', timeout: 5000 })
    .catch(() => {}) // Grid may be empty — that's OK
}

/**
 * Get a workflow with a modified KSampler seed to force non-cached execution.
 * Tries the current graph first (app.graphToPrompt), then falls back to history.
 * Returns the prompt object or null.
 */
export async function getModifiedWorkflow(page) {
  return page.evaluate(async () => {
    // Try current graph first
    let prompt = null
    try {
      const result = await window.app.graphToPrompt()
      prompt = result?.output
    } catch {}

    // Fall back to last history entry
    if (!prompt) {
      const historyRes = await fetch('/history?max_items=1').then(r => r.json())
      const lastEntry = Object.values(historyRes)[0]
      prompt = lastEntry?.prompt?.[2]
    }

    if (!prompt) return null

    const copy = JSON.parse(JSON.stringify(prompt))
    let changed = false
    for (const [, node] of Object.entries(copy)) {
      if (node.class_type === 'KSampler' || node.class_type === 'KSamplerAdvanced') {
        node.inputs.seed = Math.floor(Math.random() * 2 ** 32)
        changed = true
      }
    }
    return changed ? copy : null
  })
}

/**
 * Queue a prompt via the /prompt API. Returns { prompt_id, number }.
 * Includes the WS client_id so ComfyUI sends execution_start / executing /
 * execution_success events to our session (without it only broadcast-level
 * status events are received).
 */
export async function queuePrompt(page, prompt) {
  return page.evaluate(async (p) => {
    const clientId = window.comfyAPI?.api?.api?.clientId ?? ''
    const res = await fetch('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: p, client_id: clientId }),
    })
    return res.json()
  }, prompt)
}

/**
 * Wait until the ComfyUI queue is empty (no running, no pending).
 */
export async function waitForQueueEmpty(page, timeout = 30_000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const q = await page.evaluate(async () => {
      const r = await fetch('/queue').then(res => res.json())
      return { running: r.queue_running?.length ?? 0, pending: r.queue_pending?.length ?? 0 }
    })
    if (q.running === 0 && q.pending === 0) return
    await page.waitForTimeout(500)
  }
  throw new Error(`Queue did not empty within ${timeout}ms`)
}

/**
 * Collect all task cards currently in the DOM.
 * Returns [{ id, status, index }].
 */
export async function getCards(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-id][data-status]')].map((el, i) => ({
      id: el.dataset.id,
      status: el.dataset.status,
      index: i,
    }))
  )
}

/**
 * Get the badge text content, or null if not present.
 */
export async function getBadgeText(page) {
  return page.evaluate(() => {
    const el = document.querySelector('.sidebar-icon-badge')
    return el?.textContent?.trim() || null
  })
}

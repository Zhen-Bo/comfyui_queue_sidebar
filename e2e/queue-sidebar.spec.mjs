import { test, expect } from 'playwright/test'
import {
  isComfyReachable,
  openSidebar,
  getModifiedWorkflow,
  queuePrompt,
  waitForQueueEmpty,
  getCards,
  getBadgeText,
} from './helpers.mjs'

test.describe('Queue Sidebar E2E', () => {
  test.beforeAll(async () => {
    const reachable = await isComfyReachable()
    if (!reachable) test.skip(true, 'ComfyUI is not running at 127.0.0.1:8188')
  })

  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle', timeout: 30_000 })
    await page.waitForTimeout(2000) // let extensions load
    await openSidebar(page)
  })

  // ── #1 — Cached state renders immediately when sidebar reopens ─────
  test('cached state renders immediately on reopen', async ({ page }) => {
    // First, ensure state has data by running a prompt to completion.
    const wf = await getModifiedWorkflow(page)
    test.skip(!wf, 'No workflow available')

    await queuePrompt(page, wf)
    await waitForQueueEmpty(page)
    // Wait for history refresh to populate cards
    await page.waitForTimeout(2000)

    // Verify cards exist now
    const cardsBefore = await getCards(page)
    test.skip(cardsBefore.length === 0, 'No cards rendered after prompt completion')

    // Close the sidebar tab.
    const tab = page.locator('.sidebar-icon-wrapper .pi-history').first()
    await tab.click()
    await page.waitForTimeout(300)

    // Intercept /queue and /history with a 3-second delay so we can prove
    // that cards come from cached in-memory state, not from a fresh fetch.
    await page.route('**/queue', async (route) => {
      await new Promise(r => setTimeout(r, 3000))
      await route.continue()
    })
    await page.route('**/history*', async (route) => {
      await new Promise(r => setTimeout(r, 3000))
      await route.continue()
    })

    // Reopen the sidebar
    await tab.click()

    // Cards should appear within 500ms (from cached state, not delayed API)
    await expect(page.locator('[data-id][data-status]').first())
      .toBeAttached({ timeout: 500 })

    await page.unroute('**/queue')
    await page.unroute('**/history*')
  })

  // ── #2 — Pending cards appear above running cards ──────────────────
  test('pending cards appear above running cards', async ({ page }) => {
    const wf = await getModifiedWorkflow(page)
    test.skip(!wf, 'No workflow available in history')

    // Queue two prompts with different seeds — the first starts running,
    // the second stays pending.
    await queuePrompt(page, wf)
    const wf2 = await getModifiedWorkflow(page)
    await queuePrompt(page, wf2)

    // Wait for at least one running AND one pending card to appear
    await expect(async () => {
      const cards = await getCards(page)
      const hasRunning = cards.some(c => c.status === 'running')
      const hasPending = cards.some(c => c.status === 'pending')
      expect(hasRunning && hasPending).toBe(true)
    }).toPass({ timeout: 15_000 })

    // Verify order: all pending indices < all running indices
    const cards = await getCards(page)
    const pendingIndices = cards.filter(c => c.status === 'pending').map(c => c.index)
    const runningIndices = cards.filter(c => c.status === 'running').map(c => c.index)
    const maxPending = Math.max(...pendingIndices)
    const minRunning = Math.min(...runningIndices)
    expect(maxPending).toBeLessThan(minRunning)

    await waitForQueueEmpty(page)
  })

  // ── #3 — No duplicate cards during pending→running transition ──────
  test('no duplicate cards during pending-to-running transition', async ({ page }) => {
    const wf = await getModifiedWorkflow(page)
    test.skip(!wf, 'No workflow available in history')

    await queuePrompt(page, wf)

    // Poll DOM rapidly, looking for duplicate data-id values
    let duplicateFound = false
    const start = Date.now()

    while (Date.now() - start < 15_000) {
      const ids = await page.evaluate(() =>
        [...document.querySelectorAll('[data-id]')].map(el => el.dataset.id)
      )
      const seen = new Set()
      for (const id of ids) {
        if (seen.has(id)) { duplicateFound = true; break }
        seen.add(id)
      }
      if (duplicateFound) break

      const q = await page.evaluate(async () => {
        const r = await fetch('/queue').then(res => res.json())
        return { running: r.queue_running?.length ?? 0, pending: r.queue_pending?.length ?? 0 }
      })
      if (q.running === 0 && q.pending === 0) break
      await page.waitForTimeout(100)
    }

    expect(duplicateFound).toBe(false)
  })

  // ── #4 — Badge and card appear instantly on execution_start ────────
  test('badge and running card appear on execution_start', async ({ page }) => {
    const wf = await getModifiedWorkflow(page)
    test.skip(!wf, 'No workflow available')

    // Block /api/queue so the API-poll path (refresh → fetchQueue → render)
    // can never deliver queue state. The ONLY way a running card can appear
    // is through the WS execution_start → onExecutionStart → render() path.
    const blocked = []
    await page.route('**/queue', async (route) => {
      blocked.push(route.request().url())
      await new Promise(r => setTimeout(r, 30_000))
      await route.continue()
    })

    await queuePrompt(page, wf)

    // If onExecutionStart works, the running card appears within seconds.
    // The 10s timeout is generous but still far shorter than the 30s block.
    await expect(page.locator('[data-status="running"]').first())
      .toBeAttached({ timeout: 10_000 })

    const badge = await getBadgeText(page)
    expect(badge).toBeTruthy()

    // Confirm the route actually blocked at least one /api/queue request,
    // proving the card did NOT come from the API-poll path.
    expect(blocked.length).toBeGreaterThanOrEqual(1)

    await page.unroute('**/queue')
    await waitForQueueEmpty(page)
  })

  // ── #5 — Running card preview reflects live execution previews ────
  test('running card preview shows img element during execution', async ({ page }) => {
    const wf = await getModifiedWorkflow(page)
    test.skip(!wf, 'No workflow available')

    await queuePrompt(page, wf)

    // Wait for a running card to appear
    await expect(page.locator('[data-status="running"]').first())
      .toBeAttached({ timeout: 10_000 })

    // Poll until we observe a running card with an <img> element, OR the
    // task finishes. Using a manual loop avoids a race where the card
    // transitions to completed between the two separate evaluate() calls
    // that toPass() would make.
    let sawRunningWithImg = false
    const pollStart = Date.now()
    while (Date.now() - pollStart < 60_000) {
      const result = await page.evaluate(() => {
        const card = document.querySelector('[data-status="running"]')
        if (!card) return 'completed'
        return card.querySelector('.task-preview img') ? 'has-img' : 'no-img'
      })
      if (result === 'has-img') { sawRunningWithImg = true; break }
      if (result === 'completed') break
      await page.waitForTimeout(200)
    }

    expect(sawRunningWithImg).toBe(true)
    await waitForQueueEmpty(page)
  })

  // ── #7 — Completed card shows preview; persists after reload ───────
  test('completed card shows preview image and persists after page reload', async ({ page }) => {
    const wf = await getModifiedWorkflow(page)
    test.skip(!wf, 'No workflow available')

    await queuePrompt(page, wf)
    await waitForQueueEmpty(page)
    await page.waitForTimeout(1500) // let render cycle complete

    // Completed card must have an <img> whose src contains /view?filename=
    const completedCard = page.locator('[data-status="completed"]').first()
    await expect(completedCard).toBeAttached({ timeout: 10_000 })

    // Wait for the img to be present before reading its src
    const imgLocator = completedCard.locator('.task-preview img').first()
    await expect(imgLocator).toBeAttached({ timeout: 5_000 })
    const imgSrc = await imgLocator.getAttribute('src')
    expect(imgSrc).toMatch(/\/view\?/)

    // Extract filename to verify it's the same image after reload (cache hit)
    const beforeFilename = new URLSearchParams(imgSrc.split('?')[1]).get('filename')
    expect(beforeFilename).toBeTruthy()

    // Reload and confirm the same card still shows the same image (localStorage cache hit)
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    await openSidebar(page)

    const reloadedImg = page.locator('[data-status="completed"] .task-preview img').first()
    await expect(reloadedImg).toBeAttached({ timeout: 5_000 })
    const reloadedSrc = await reloadedImg.getAttribute('src')
    expect(reloadedSrc).toMatch(/\/view\?/)

    // Same filename proves the preview came from localStorage cache, not a random re-fetch
    const afterFilename = new URLSearchParams(reloadedSrc.split('?')[1]).get('filename')
    expect(afterFilename).toBe(beforeFilename)
  })

  // ── #8 — localStorage cache is populated after execution ───────────
  test('localStorage cache is populated with output after execution', async ({ page }) => {
    const wf = await getModifiedWorkflow(page)
    test.skip(!wf, 'No workflow available')

    const queueResult = await queuePrompt(page, wf)
    const promptId = queueResult?.prompt_id
    test.skip(!promptId, 'Queue response did not include prompt_id')

    await waitForQueueEmpty(page)
    await page.waitForTimeout(1000)

    const cacheEntry = await page.evaluate((pid) => {
      try {
        const raw = localStorage.getItem('queueSidebar.lastOutput')
        if (!raw) return null
        const cache = JSON.parse(raw)
        return cache[pid] ?? null
      } catch {
        return null
      }
    }, promptId)

    expect(cacheEntry).not.toBeNull()
    expect(typeof cacheEntry.filename).toBe('string')
    expect(cacheEntry.filename.length).toBeGreaterThan(0)
  })

  // ── #6 — No [QueueSidebar] console.warn during normal operation ────
  test('no QueueSidebar console warnings during normal operation', async ({ page }) => {
    // Intercept console.warn at the JS level BEFORE page load so we capture
    // warnings emitted during extension initialisation (i18n fetch failures,
    // setup errors, etc.) — not just warnings emitted after test setup.
    await page.addInitScript(() => {
      window.__qsWarnings = []
      const origWarn = console.warn.bind(console)
      console.warn = (...args) => {
        const msg = args.map(a => (typeof a === 'string' ? a : String(a))).join(' ')
        if (msg.includes('[QueueSidebar]')) window.__qsWarnings.push(msg)
        origWarn(...args)
      }
    })

    // Navigate fresh so the init script runs before any extension code executes
    await page.goto('/', { waitUntil: 'networkidle', timeout: 30_000 })
    await page.waitForTimeout(2000) // let extensions load
    await openSidebar(page)

    const wf = await getModifiedWorkflow(page)
    if (wf) {
      await queuePrompt(page, wf)
      await waitForQueueEmpty(page)
    }

    await page.waitForTimeout(1000)

    const warnings = await page.evaluate(() => window.__qsWarnings)
    expect(warnings).toEqual([])
  })
})

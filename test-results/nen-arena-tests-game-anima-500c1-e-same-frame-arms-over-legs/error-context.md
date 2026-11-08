# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: nen-arena\tests\game.spec.ts >> animated bodies >> a body walks and strikes in the same frame, arms over legs
- Location: nen-arena\tests\game.spec.ts:380:3

# Error details

```
Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
Call log:
  - navigating to "/", waiting until "load"

```

# Test source

```ts
  1  | import { expect, type Page } from '@playwright/test';
  2  | import type { GameApi } from '../../src/api.ts';
  3  | 
  4  | declare global {
  5  |   interface Window {
  6  |     __game: GameApi;
  7  |   }
  8  | }
  9  | 
  10 | /**
  11 |  * Opens the arena and waits for the probe surface, failing with the browser's own complaint in
  12 |  * twenty seconds rather than hanging until the two minute test timeout. Every suite boots through
  13 |  * this, so a stale dev server reports the same thing wherever it is hit.
  14 |  */
  15 | export async function bootGame(page: Page): Promise<void> {
  16 |   const errors: string[] = [];
  17 |   page.on('pageerror', (error) => errors.push(error.message));
  18 |   const console: string[] = [];
  19 |   page.on('console', (message) => {
  20 |     if (message.type() === 'error') console.push(message.text());
  21 |   });
> 22 |   await page.goto('/');
     |              ^ Error: page.goto: Protocol error (Page.navigate): Cannot navigate to invalid URL
  23 |   try {
  24 |     await page.waitForFunction(() => window.__game?.ready === true, undefined, {
  25 |       timeout: 20_000,
  26 |     });
  27 |   } catch {
  28 |     throw new Error(
  29 |       `the arena never became ready; the dev server is probably stale or down. console: ${console.join(' | ') || '(silent)'}`,
  30 |     );
  31 |   }
  32 |   await page.evaluate(() => window.__game.setPaused(true));
  33 |   const collected = await page.evaluate(() => (window as unknown as { __errors?: string[] }).__errors ?? []);
  34 |   expect(collected).toEqual([]);
  35 |   expect(errors).toEqual([]);
  36 | }
  37 | 
  38 | /** Same as bootGame, but waits for the character bodies, which arrive asynchronously. */
  39 | export async function bootModels(page: Page): Promise<void> {
  40 |   await bootGame(page);
  41 |   await page.waitForFunction(() => window.__game.state().modelsReady === true, undefined, {
  42 |     timeout: 60_000,
  43 |   });
  44 | }
  45 | 
  46 | /** One animation frame, so an input press is consumed by the loop rather than buffered. */
  47 | export async function nextFrame(page: Page): Promise<void> {
  48 |   await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  49 | }
  50 | 
```
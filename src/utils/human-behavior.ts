/**
 * Human-like behavior utilities for stealth scraping
 */

import type { Page } from 'playwright-core';

/**
 * Random delay between min and max milliseconds
 */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Add human-like behavior to a Playwright page
 * Lightweight version - just sets viewport, no blocking delays
 */
export async function addHumanBehavior(page: Page): Promise<void> {
  // Use modest viewport sizes (not fullscreen)
  const viewports = [
    { width: 1280, height: 720 },
    { width: 1024, height: 768 },
    { width: 1200, height: 800 },
  ];

  const viewport = viewports[Math.floor(Math.random() * viewports.length)]!;
  await page.setViewportSize(viewport);
}

/**
 * Smooth mouse movement simulation
 */
export async function smoothMouseMove(page: Page, targetX: number, targetY: number, steps = 10): Promise<void> {
  const currentPos = await page.evaluate(() => ({
    x: Math.random() * (globalThis as any).innerWidth,
    y: Math.random() * (globalThis as any).innerHeight
  }));

  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const x = currentPos.x + (targetX - currentPos.x) * progress;
    const y = currentPos.y + (targetY - currentPos.y) * progress;

    await page.mouse.move(x, y);
    await randomDelay(10, 30);
  }
}

/**
 * Human-like scrolling
 */
export async function humanScroll(page: Page, direction: 'up' | 'down' = 'down', distance = 300): Promise<void> {
  const scrollAmount = direction === 'down' ? distance : -distance;

  await page.evaluate((amount: number) => {
    const scrollSteps = 10;
    const stepAmount = amount / scrollSteps;
    let currentStep = 0;

    const interval = setInterval(() => {
      if (currentStep >= scrollSteps) {
        clearInterval(interval);
        return;
      }

      (globalThis as any).scrollBy(0, stepAmount);
      currentStep++;
    }, 50 + Math.random() * 50);
  }, scrollAmount);

  await randomDelay(500, 1000);
}

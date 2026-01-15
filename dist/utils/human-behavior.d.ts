/**
 * Human-like behavior utilities for stealth scraping
 */
import type { Page } from 'playwright-core';
/**
 * Random delay between min and max milliseconds
 */
export declare function randomDelay(minMs: number, maxMs: number): Promise<void>;
/**
 * Add human-like behavior to a Playwright page
 * Lightweight version - just sets viewport, no blocking delays
 */
export declare function addHumanBehavior(page: Page): Promise<void>;
/**
 * Smooth mouse movement simulation
 */
export declare function smoothMouseMove(page: Page, targetX: number, targetY: number, steps?: number): Promise<void>;
/**
 * Human-like scrolling
 */
export declare function humanScroll(page: Page, direction?: 'up' | 'down', distance?: number): Promise<void>;
//# sourceMappingURL=human-behavior.d.ts.map
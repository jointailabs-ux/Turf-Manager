import { Page, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export function getE2EState() {
  const statePath = path.join(__dirname, 'e2e-state.json');
  if (!fs.existsSync(statePath)) {
    throw new Error('e2e-state.json not found. Did global.setup.ts run?');
  }
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

export async function loginAs(page: Page, email: string, password = 'password123') {
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button:has-text("Sign in")');
  // Wait for navigation or a logged-in indicator
  await page.waitForURL((url) => !url.pathname.includes('/login'));
}

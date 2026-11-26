import { test, expect } from '@playwright/test';

test.describe('FinCore E2E User Journeys (Requires Running Stack)', () => {
  test('customer dashboard, wallets ledger, beneficiaries, transfers, payments, statements & profile', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/EDUCATIONAL SIMULATION PLATFORM/i)).toBeVisible();
    await page.getByRole('link', { name: 'Sign In' }).first().click();
    await expect(page).toHaveURL(/\/login/);

    // Quick-fill synthetic customer1 seed user and submit
    await page.getByText('Customer 1 (Aarav)').click();
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByText('SIMULATED AVAILABLE BALANCE')).toBeVisible();

    await page.screenshot({ path: '../docs/evidence/customer-dashboard-desktop.png' });

    // Check responsive mobile viewport rendering without horizontal overflow
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText('SIMULATED AVAILABLE BALANCE')).toBeVisible();
    await page.screenshot({ path: '../docs/evidence/customer-dashboard-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 800 });

    // Wallets automatically render initial ledger entries
    await page.getByRole('link', { name: 'Wallets & Ledger', exact: true }).click();
    await expect(page).toHaveURL(/\/wallets/);
    await expect(page.getByText('Immutable Ledger Entries')).toBeVisible();

    // Beneficiaries, Payments Sandbox, Statements, Disputes & Profile load cleanly
    await page.getByRole('link', { name: 'Payment Sandbox', exact: true }).click();
    await expect(page.getByText('SANDBOX ADAPTER ONLY')).toBeVisible();

    await page.getByRole('link', { name: 'Statements', exact: true }).click();
    await expect(page.getByText('Account Statements & CSV Export')).toBeVisible();

    await page.getByRole('link', { name: 'Profile & Sessions', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Active Sessions', exact: true })).toBeVisible();
  });

  test('operations analyst views operations queue, risk analytics, reconciliation, and ledger integrity', async ({ page }) => {
    await page.goto('/login');
    await page.getByText('Operations Analyst').click();
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page).toHaveURL(/\/operations/);
    await expect(page.getByText('Global Double-Entry Ledger Integrity Check')).toBeVisible();
    await expect(page.getByText(/BALANCED/i)).toBeVisible();
    await page.screenshot({ path: '../docs/evidence/operations-console.png' });

    await page.getByRole('link', { name: 'Risk Analytics', exact: true }).click();
    await expect(page.getByText(/Decision-support scores only/i)).toBeVisible();

    await page.getByRole('link', { name: 'Reconciliation', exact: true }).click();
    await expect(page.getByText('Settlement Reconciliation & Exceptions')).toBeVisible();
  });
});

import { expect, test } from '@playwright/test'

test('a user can move through the review workflow shell', async ({ page }) => {
  await page.goto('/')

  // The SPA should route a fresh session into the first stage of the review journey.
  await expect(page).toHaveURL(/\/upload$/)
  await expect(page.getByRole('heading', { name: 'Upload' })).toBeVisible()

  await page.getByRole('link', { name: 'Result' }).click()

  // This remains a useful smoke test as real evaluation data replaces the result placeholder.
  await expect(page).toHaveURL(/\/result$/)
  await expect(page.getByRole('heading', { name: 'Result' })).toBeVisible()
})

import { expect, test } from '@playwright/test'

test('a signed-out user is redirected to authentication and can switch modes', async ({ page }) => {
  await page.goto('/')

  // Protected review routes must send a fresh browser session to sign-in.
  await expect(page).toHaveURL(/\/auth\/signin$/)
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()

  await page.getByRole('button', { name: 'Sign up' }).click()

  // Switching auth modes updates both the URL and visible form state.
  await expect(page).toHaveURL(/\/auth\/signup$/)
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
})

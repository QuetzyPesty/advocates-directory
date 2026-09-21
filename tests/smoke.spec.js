// Smoke tests for the shared static export (dist/index.html).
//
// The export is one self-contained file with an embedded dataset, hash routing
// and a canvas force layout. Everything here asserts on the DOM and on the
// embedded payload — never on pixels — and one context is shared across the
// file, since none of these tests mutate durable state.
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'parallel' });

const consoleErrors = page => {
  const errors = [];
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', e => errors.push(String(e)));
  return errors;
};

const dataset = page => page.evaluate(() =>
  JSON.parse(document.getElementById('dataset').textContent));

test('loads with no console errors and renders the hub', async ({ page }) => {
  const errors = consoleErrors(page);
  await page.goto('/index.html');
  await expect(page.locator('#app')).toContainText('A structured record of the Bar');
  await expect(page.locator('#app')).toContainText('people');
  expect(errors).toEqual([]);
});

test('the payload carries no private notes and no contact details', async ({ page }) => {
  await page.goto('/index.html');
  const d = await dataset(page);
  // The privacy boundary the whole export rests on. Chamber addresses, phone
  // numbers and emails are is_public:false and must never reach a shared file.
  expect(d.people.filter(p => (p.notes || []).length)).toHaveLength(0);
  expect(d.people.reduce((n, p) => n + (p.contacts || []).length, 0)).toBe(0);
});

test('every browse dimension opens and lists values', async ({ page }) => {
  const errors = consoleErrors(page);
  await page.goto('/index.html');
  const dims = await page.evaluate(() =>
    [...document.querySelectorAll('a[href^="#/browse/"]')].map(a => a.getAttribute('href')));
  expect(dims.length).toBeGreaterThan(5);
  for (const href of dims) {
    await page.goto('/index.html' + href);
    await expect(page.locator('#app')).toContainText(/values in use/i);
  }
  expect(errors).toEqual([]);
});

test('a filtered list and a profile render', async ({ page }) => {
  await page.goto('/index.html');
  const slug = await page.evaluate(() => {
    const d = JSON.parse(document.getElementById('dataset').textContent);
    return d.people.find(p => p.affiliations?.length)?.slug;
  });
  await page.goto(`/index.html#/person/${slug}`);
  await expect(page.locator('#app')).toContainText(/Network/i);
  await expect(page.locator('#app h1, #app h2').first()).not.toBeEmpty();
});

test('the force layout keeps running after the profile re-renders the DOM', async ({ page }) => {
  // Regression: the views rebuild #app with innerHTML. A graph started before
  // a re-render must not be left ticking against a detached canvas, and the
  // graph mounted after it must actually animate. This is the class of bug
  // where the page looks right and is frozen.
  const errors = consoleErrors(page);
  await page.goto('/index.html');
  const slug = await page.evaluate(() => {
    const d = JSON.parse(document.getElementById('dataset').textContent);
    const linked = new Set(d.relationships.flatMap(r => [r.from, r.to]));
    return [...linked][0];
  });
  await page.goto(`/index.html#/net/${slug}`);
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c ? c.width : 0;
  }), { timeout: 5000 }).toBeGreaterThan(0);

  const frame = () => page.evaluate(() => {
    const c = document.querySelector('canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 997) sum += d[i];
    return sum;
  });
  const first = await frame();
  expect(first).toBeGreaterThan(0);                 // something is drawn
  await expect.poll(frame, { timeout: 6000 }).not.toBe(first);   // and it moves
  expect(errors).toEqual([]);
});

test('hash routing survives a reload', async ({ page }) => {
  await page.goto('/index.html#/browse/chamber');
  await expect(page.locator('#app')).toContainText(/By chamber or firm/i);
  await page.reload();
  await expect(page.locator('#app')).toContainText(/By chamber or firm/i);
});

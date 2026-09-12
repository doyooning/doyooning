import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const repo = process.env.GITHUB_REPOSITORY || 'doyooning/doyooning';
const sha = process.env.VERIFY_SHA || '';
const readme = await readFile('README.md', 'utf8');
const expected = [...readme.matchAll(/<img\b[^>]*alt="([^"]+)"/g)].map(m => m[1]);
if (!expected.length) throw new Error('No named badges found in README');
await mkdir('verification-results', { recursive: true });
const browser = await chromium.launch();
const results = [];
let failed = false;
try {
  const targets = sha ? [['commit', `https://github.com/${repo}/blob/${sha}/README.md`]] : [];
  targets.push(['repository', `https://github.com/${repo}`], ['profile', `https://github.com/${repo.split('/')[0]}`]);
  for (const [target, url] of targets) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ colorScheme: theme, viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage();
      const row = { target, theme, url, badges: [], otherBrokenImages: [], error: null };
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.locator('article.markdown-body').first().waitFor({ timeout: 30000 });
        const scope = page.locator('article.markdown-body').first();
        // Scroll every image into view so lazy loading cannot produce a false failure.
        for (const image of await scope.locator('img').all()) await image.scrollIntoViewIfNeeded();
        try {
          await page.waitForFunction(() => [...document.querySelectorAll('article.markdown-body img')].every(i => i.complete), { }, { timeout: 30000 });
        } catch { /* Pending images are reported as failures below. */ }
        const images = await scope.locator('img').evaluateAll(imgs => imgs.map(i => ({
          alt: i.alt, loaded: i.complete && i.naturalWidth > 0 && i.naturalHeight > 0,
          width: i.naturalWidth, height: i.naturalHeight, source: i.currentSrc || i.src
        })));
        row.badges = expected.map(alt => ({ alt, images: images.filter(i => i.alt === alt),
          passed: images.some(i => i.alt === alt) && images.filter(i => i.alt === alt).every(i => i.loaded)
        }));
        row.otherBrokenImages = images.filter(i => !expected.includes(i.alt) && !i.loaded);
        await page.screenshot({ path: `verification-results/${target}-${theme}.png`, fullPage: true });
        // A loaded image alone cannot prove that its logo looks correct: review the screenshots.
        if (row.badges.some(b => !b.passed)) failed = true;
      } catch (error) {
        row.error = String(error);
        failed = true;
        await page.screenshot({ path: `verification-results/${target}-${theme}-error.png`, fullPage: true }).catch(() => {});
      } finally {
        results.push(row);
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  await writeFile('verification-results/results.json', JSON.stringify({ checkedAt: new Date().toISOString(), repo, sha, failed, visualReviewRequired: true, results }, null, 2));
  const summary = ['# README display verification', '', `Automatic badge loading: ${failed ? 'FAILED' : 'PASSED'}`, '', 'Logo appearance and readability require screenshot review.', ''];
  for (const r of results) {
    summary.push(`## ${r.target} / ${r.theme}`, '', r.error || `Failed badges: ${r.badges.filter(b => !b.passed).map(b => b.alt).join(', ') || 'none'}`, '', `Other broken images: ${r.otherBrokenImages.length}`, '');
  }
  await writeFile('verification-results/summary.md', summary.join('\n'));
}
if (failed) process.exitCode = 1;

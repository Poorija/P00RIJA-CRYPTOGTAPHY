const { spawn } = require('child_process');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const HOST = '127.0.0.1';
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}/`;

function waitForServer(processHandle) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out while waiting for the static dev server'));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      processHandle.stdout.off('data', onData);
      processHandle.stderr.off('data', onErrorData);
      processHandle.off('exit', onExit);
    }

    function onData(chunk) {
      const text = chunk.toString();
      if (text.includes('Tauri dev server ready')) {
        cleanup();
        resolve();
      }
    }

    function onErrorData(chunk) {
      const text = chunk.toString();
      if (text.trim()) {
        process.stderr.write(text);
      }
    }

    function onExit(code) {
      cleanup();
      reject(new Error(`Static dev server exited early with code ${code}`));
    }

    processHandle.stdout.on('data', onData);
    processHandle.stderr.on('data', onErrorData);
    processHandle.on('exit', onExit);
  });
}

async function run() {
  const server = spawn(process.execPath, ['scripts/static-dev-server.js'], {
    cwd: ROOT,
    env: { ...process.env, HOST, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let browser;
  try {
    await waitForServer(server);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      ...devices['iPhone 13'],
      locale: 'fa-IR',
    });

    const externalRequests = [];
    const page = await context.newPage();
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (requestUrl.origin !== `http://${HOST}:${PORT}` && requestUrl.protocol.startsWith('http')) {
        if (!requestUrl.pathname.includes('/chat-health')) {
          externalRequests.push(request.url());
        }
      }
    });

    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    const installGateVisible = await page.locator('#mobileInstallGate').isVisible();
    if (!installGateVisible) {
      throw new Error('Mobile install gate is not shown for mobile browsers');
    }
    await page.getByRole('button', { name: /ادامه در مرورگر/i }).click();
    await page.getByRole('button', { name: /فارسی/i }).click();
    await page.waitForSelector('#initialSetup', { state: 'visible' });

    const setupColumns = await page.evaluate(() => {
      const grid = document.querySelector('.setup-registration-grid');
      if (!grid) return null;
      return getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
    });
    if (setupColumns !== 1) {
      throw new Error(`Initial setup still uses ${setupColumns} columns on mobile`);
    }

    await page.fill('#setupPassword', 'P00rija!Secure123');
    await page.fill('#confirmPassword', 'P00rija!Secure123');
    await page.selectOption('#secQ1', '0');
    await page.fill('#secA1', 'alpha');
    await page.selectOption('#secQ2', '1');
    await page.fill('#secA2', 'beta');
    await page.selectOption('#secQ3', '2');
    await page.fill('#secA3', 'gamma');
    await page.check('#acceptTermsCheckbox');
    await page.click('#setupBtn');
    await page.waitForSelector('#mainApp:not(.hidden)', { timeout: 15000 });

    await page.click('#mobileNavToggle');
    const headerLangVisible = await page.locator('#langBtn').evaluate((el) => getComputedStyle(el).display !== 'none');
    const headerThemeVisible = await page.locator('#themeToggleBtn').evaluate((el) => getComputedStyle(el).display !== 'none');
    if (headerLangVisible || headerThemeVisible) {
      throw new Error('Language or theme toggle is still visible in the mobile header');
    }

    const sidebarLangVisible = await page.locator('#sidebarLangBtn').evaluate((el) => getComputedStyle(el).display !== 'none');
    const sidebarThemeVisible = await page.locator('#sidebarThemeBtn').evaluate((el) => getComputedStyle(el).display !== 'none');
    if (!sidebarLangVisible || !sidebarThemeVisible) {
      throw new Error('Language or theme toggle is missing from the mobile sidebar');
    }

    const headerBox = await page.locator('#appHeader').boundingBox();
    const sidebarBox = await page.locator('#appSidebar').boundingBox();
    if (!headerBox || !sidebarBox || sidebarBox.y < headerBox.y + headerBox.height - 1) {
      throw new Error('Mobile sidebar still overlaps the header');
    }

    await page.click('#tab-settings');
    await page.waitForSelector('#tabOrderList .tab-order-row');

    const mobileLayoutOk = await page.evaluate(() => {
      const widths = [
        document.documentElement.scrollWidth - window.innerWidth,
        document.body.scrollWidth - window.innerWidth,
      ];
      return widths.every((delta) => delta <= 2);
    });
    if (!mobileLayoutOk) {
      throw new Error('Mobile layout still overflows horizontally');
    }

    const footerHeight = await page.locator('#appFooter').evaluate((el) => el.getBoundingClientRect().height);
    if (footerHeight > 72) {
      throw new Error(`Mobile footer is still too tall (${footerHeight}px)`);
    }

    await page.click('#mobileNavToggle');
    await page.click('#tab-selfdestruct');
    await page.fill('#sdKey', 'P00rijaSelfDestructKey');
    await page.fill('#sdTextInput', 'secret-message');
    const bindChecked = await page.isChecked('#sdBindToDevice');
    if (!bindChecked) {
      throw new Error('Self-destruct trusted-installation binding is not enabled by default');
    }

    await page.evaluate(() => window.generateSelfDestructMessage());
    await page.waitForFunction(() => Boolean(document.getElementById('sdOutputText')?.value), null, { timeout: 15000 });
    const payload = await page.inputValue('#sdOutputText');
    if (!payload) {
      throw new Error('Self-destruct payload generation failed');
    }

    await page.fill('#sdInputToRead', payload);
    await page.fill('#sdReadKey', 'P00rijaSelfDestructKey');
    await page.evaluate(() => window.readSelfDestructMessage());
    await page.waitForFunction(() => document.getElementById('sdReadResultContent')?.textContent?.includes('secret-message'));

    await page.waitForFunction(() => navigator.serviceWorker?.controller || window.PoorijaApp?.state?.pwa?.swReady);
    await page.evaluate(async () => {
      const formData = new FormData();
      formData.set('title', 'Shared title');
      formData.set('text', 'Shared body from share target');
      formData.set('url', 'https://example.test/resource');
      await fetch('./index.html?share-target=1#share', {
        method: 'POST',
        body: formData,
      });
    });
    await page.waitForFunction(() => {
      const input = document.getElementById('shareTextInput');
      return input && input.value.includes('Shared body from share target');
    }, null, { timeout: 15000 });

    const badgeCount = await page.evaluate(() => window.PoorijaApp?.state?.pwa?.badgeCount || 0);
    if (badgeCount !== 0) {
      throw new Error(`PWA badge count should be cleared after consuming shared payload, got ${badgeCount}`);
    }

    if (externalRequests.length > 0) {
      throw new Error(`Unexpected external network requests detected: ${externalRequests.join(', ')}`);
    }

    console.log('Smoke test passed.');
  } finally {
    if (browser) {
      await browser.close();
    }
    server.kill('SIGTERM');
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

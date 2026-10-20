import { expect, type Page, test } from '@playwright/test';

/**
 * Official portraits on member records (DESIGN.md "Portraits", DECISIONS A72). The seed
 * members are fictional: avery-ashvale has a flat grey synthetic JPEG, dana-dunmere has none
 * (every fourth seed member has none), so both paths run here.
 */
const WITH = 'avery-ashvale';
const WITHOUT = 'dana-dunmere';

async function frame(page: Page) {
  const box = await page.locator('.member-portrait-frame').boundingBox();
  if (!box) throw new Error('portrait frame not rendered');
  return box;
}

test.describe('profile with a portrait', () => {
  test('shows a loaded, labelled 4:5 image with a credit, from our own origin only', async ({
    page,
    baseURL,
  }) => {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    await page.goto(`/people/${WITH}`);

    const figure = page.locator('.member-portrait');
    await expect(figure).toHaveAttribute('data-portrait', 'present');
    const image = figure.locator('img');
    await expect(image).toHaveAttribute('alt', 'Official portrait of Avery Ashvale');
    await expect(image).toHaveAttribute('width', '225');
    await expect(image).toHaveAttribute('height', '275');
    await expect(image).toHaveAttribute(
      'src',
      /^\/people\/avery-ashvale\/portrait\?size=225&v=[0-9a-f]{12}$/,
    );
    await expect(image).toHaveAttribute(
      'srcset',
      /\?size=225&v=[0-9a-f]{12} 1x, .*\?size=450&v=[0-9a-f]{12} 2x$/,
    );
    await expect(image).toHaveAttribute('loading', 'eager'); // above the fold: never lazy here
    await expect
      .poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
      .toBeGreaterThan(0);

    await expect(figure.locator('figcaption')).toHaveText(
      /^Official portrait · GPO Member Guide · public domain\d*$/,
    );
    const box = await frame(page);
    expect(box.width / box.height).toBeCloseTo(0.8, 2);
    expect(box.width).toBeCloseTo(168, 0);

    // Left of the name: the portrait ends before the heading text begins.
    const nameLeft = await page.locator('h1').evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getBoundingClientRect().left;
    });
    expect(box.x + box.width).toBeLessThanOrEqual(nameLeft);

    // Readers' browsers contact one host: ours.
    await page.waitForLoadState('networkidle');
    const origin = new URL(baseURL ?? '').origin;
    const foreign = requested.filter((url) => !url.startsWith(origin) && !url.startsWith('data:'));
    expect(foreign).toEqual([]);
    expect(requested.some((url) => url.includes('/portrait?size='))).toBe(true);
  });

  test('lists the portrait source with the other header sources', async ({ page }) => {
    await page.goto(`/people/${WITH}`);
    const mark = page.locator('.member-portrait figcaption sup a');
    await expect(mark).toBeVisible();
    await mark.click();
    await expect(page).toHaveURL(/#summary-source-\d+$/);
  });

  test('the page sends a Content-Security-Policy that allows images from our origin only', async ({
    request,
  }) => {
    const res = await request.get(`/people/${WITH}`);
    const csp = res.headers()['content-security-policy'] ?? '';
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).not.toMatch(/https?:\/\//);
  });
});

test.describe('profile without a portrait', () => {
  test('shows a neutral tile of the same size, with text and no image or initials', async ({
    page,
  }) => {
    await page.goto(`/people/${WITH}`);
    const withBox = await frame(page);

    await page.goto(`/people/${WITHOUT}`);
    const figure = page.locator('.member-portrait');
    await expect(figure).toHaveAttribute('data-portrait', 'missing');
    await expect(figure).toHaveText('No official portrait published yet');
    await expect(figure.locator('img, svg')).toHaveCount(0);
    const withoutBox = await frame(page);
    expect(withoutBox.width).toBeCloseTo(withBox.width, 0);
    expect(withoutBox.height).toBeCloseTo(withBox.height, 0);

    // Square corners, sunk paper surface, hairline border, no shadow.
    const style = await page.locator('.member-portrait-frame').evaluate((el) => {
      const css = getComputedStyle(el);
      return {
        radius: css.borderTopLeftRadius,
        shadow: css.boxShadow,
        background: css.backgroundColor,
        border: css.borderTopWidth,
      };
    });
    expect(style).toMatchObject({ radius: '0px', shadow: 'none', border: '1px' });
    const paper = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--surface-sunk').trim(),
    );
    expect(paper).not.toBe('');
  });
});

test.describe('portrait file route', () => {
  test('serves the JPEG with ETag = sha256, nosniff and a cache policy tied to the key', async ({
    request,
    page,
  }) => {
    await page.goto(`/people/${WITH}`);
    const src = (await page.locator('.member-portrait img').getAttribute('src')) ?? '';

    const keyed = await request.get(src);
    expect(keyed.status()).toBe(200);
    const headers = keyed.headers();
    expect(headers['content-type']).toBe('image/jpeg');
    expect(headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['cache-control']).toBe('public, max-age=31536000, immutable');
    const body = await keyed.body();
    expect([...body.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
    expect(Number(headers['content-length'])).toBe(body.length);

    const bare = await request.get(`/people/${WITH}/portrait?size=225`);
    expect(bare.status()).toBe(200);
    expect(bare.headers().etag).toBe(headers.etag);
    expect(bare.headers()['cache-control']).not.toContain('immutable');
    const stale = await request.get(`/people/${WITH}/portrait?size=225&v=00000000deadbeef`);
    expect(stale.headers()['cache-control']).not.toContain('immutable');

    const big = await request.get(`/people/${WITH}/portrait?size=450`);
    expect(big.status()).toBe(200);
    expect(big.headers().etag).not.toBe(headers.etag);
    expect((await big.body()).length).toBeGreaterThan(body.length);
  });

  test('answers 304 with no body to If-None-Match, and 200 to another validator', async ({
    request,
  }) => {
    const first = await request.get(`/people/${WITH}/portrait?size=225`);
    const etag = first.headers().etag ?? '';
    const again = await request.get(`/people/${WITH}/portrait?size=225`, {
      headers: { 'if-none-match': etag },
    });
    expect(again.status()).toBe(304);
    expect((await again.body()).length).toBe(0);
    expect(again.headers().etag).toBe(etag);
    const other = await request.get(`/people/${WITH}/portrait?size=225`, {
      headers: { 'if-none-match': '"not-the-hash"' },
    });
    expect(other.status()).toBe(200);
  });

  test('is 404 for an unknown member, a member without a portrait and an impossible slug', async ({
    request,
  }) => {
    for (const path of [
      '/people/nobody-by-this-name/portrait?size=225',
      `/people/${WITHOUT}/portrait?size=225`,
      '/people/Not%20A%20Slug/portrait',
    ]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
      expect(res.headers()['content-type'], path).toContain('application/json');
      expect(res.headers()['x-content-type-options'], path).toBe('nosniff');
    }
  });

  test('is 400 for an unsupported size, a malformed key or an unknown parameter', async ({
    request,
  }) => {
    for (const query of ['size=300', 'size=225&v=NOT-HEX', 'size=225&extra=1', 'slug=other']) {
      const res = await request.get(`/people/${WITH}/portrait?${query}`);
      expect(res.status(), query).toBe(400);
    }
  });

  test('is the same file as /api/v1/people.portrait, and people.get states it', async ({
    request,
  }) => {
    const web = await request.get(`/people/${WITH}/portrait?size=450`);
    const api = await request.get(`/api/v1/people.portrait?slug=${WITH}&size=450`);
    expect(api.status()).toBe(200);
    expect(api.headers().etag).toBe(web.headers().etag);
    expect((await api.body()).equals(await web.body())).toBe(true);

    const profile = (await (await request.get(`/api/v1/people.get?slug=${WITH}`)).json()) as {
      portrait: { url: string; credit: string; variants: Array<{ size: number; sha256: string }> };
    };
    expect(profile.portrait.credit).toBe('Official portrait · GPO Member Guide · public domain');
    expect(web.headers().etag).toBe(
      `"${profile.portrait.variants.find((v) => v.size === 450)?.sha256}"`,
    );
    const without = (await (await request.get(`/api/v1/people.get?slug=${WITHOUT}`)).json()) as {
      portrait: unknown;
    };
    expect(without.portrait).toBeNull();
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const slug of [WITH, WITHOUT]) {
    test(`${slug}: a smaller portrait, identity beside it, no sideways scroll`, async ({
      page,
    }) => {
      await page.goto(`/people/${slug}`);
      const box = await frame(page);
      expect(box.width).toBeCloseTo(104, 0);
      expect(box.width / box.height).toBeCloseTo(0.8, 2);
      const { scroll, client } = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      expect(scroll).toBeLessThanOrEqual(client);
      // The name still reads next to the portrait, not below a tall empty block.
      const h1 = await page.locator('h1').boundingBox();
      expect(h1?.y ?? Number.NaN).toBeLessThan(box.y + box.height);
    });
  }
});

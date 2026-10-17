import { expect, type Locator, type Page } from "@playwright/test";

const TURNSTILE_STUB = String.raw`
(() => {
  const state = window.__checkinTurnstile = { renders: [], widgets: new Map() };
  window.turnstile = {
    render(element, options) {
      const id = 'checkin-widget-' + (state.renders.length + 1);
      const input = document.createElement('input');
      // Tokens are single use, and widget ids restart on every page load.
      input.type = 'hidden'; input.name = 'cf-turnstile-response'; input.value = 'stub-token-' + id + '-' + Math.random().toString(36).slice(2); input.dataset.stubWidget = id;
      element.append(input); state.renders.push({ id, options }); state.widgets.set(id, input); options.callback?.(input.value);
      return id;
    },
    remove(id) { state.widgets.get(id)?.remove(); state.widgets.delete(id); },
  };
  state.expireLatest = () => state.renders.at(-1)?.options['expired-callback']?.();
  state.errorLatest = () => state.renders.at(-1)?.options['error-callback']?.();
})();`;

export async function installTurnstile(page: Page) {
  await page.addInitScript(TURNSTILE_STUB);
  await page.route("https://challenges.cloudflare.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/turnstile/v0/api.js") await route.fulfill({ contentType: "application/javascript", body: "" });
    else await route.abort();
  });
}

export async function choosePlatform(card: Locator, kind: RegExp | string) {
  await card.getByRole("button", { name: kind }).click();
  await card.getByRole("button", { name: "PC (Steam)", exact: true }).click();
  await expect(card.locator('.turnstile-widget input[name="cf-turnstile-response"]')).toHaveCount(1);
  await expect(card.getByRole("button", { name: "Save check-in", exact: true })).toBeEnabled();
}

import {test, expect} from './fixtures';
import {startLocalBridge} from '@canvas-one/agent-bridge/server';

test('a secure host pairs with loopback after granting local network permission', async ({page, context}) => {
  const origin = 'https://canvas-one-test.invalid';
  const bridge = await startLocalBridge({port: 0, allowedOrigins: [origin]});
  try {
    // Serve only this fixture locally; no hosted site or external request is used.
    await page.route(origin + '/**', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Secure bridge fixture</title>'}));
    await context.grantPermissions(['local-network-access'], {origin});
    await page.goto(origin + '/');
    const result = await page.evaluate(async ({url, code}) => {
      const paired = await fetch(url + '/pair', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({code})});
      const credentials = await paired.json();
      const requests = await fetch(url + '/browser/requests', {headers: {Authorization: 'Bearer ' + credentials.token}});
      await fetch(url + '/browser/disconnect', {method: 'POST', headers: {Authorization: 'Bearer ' + credentials.token}});
      return {secure: isSecureContext, paired: paired.status, role: credentials.participant.kind, requests: requests.status};
    }, {url: bridge.url, code: bridge.pairingCode});
    expect(result).toEqual({secure: true, paired: 200, role: 'agent', requests: 200});
  } finally {await bridge.close();}
});

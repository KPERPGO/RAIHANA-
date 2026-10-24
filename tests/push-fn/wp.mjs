// stand-in for web-push: records what would be sent; endpoint "gone" acts like a phone that removed the app, "bad" like a refused send
export const sent = [];
export default {generateVAPIDKeys: () => ({publicKey: 'PUB', privateKey: 'PRIV'}), setVapidDetails(){},
  async sendNotification(sub, payload){ if (sub.endpoint === 'gone') { const e = new Error('x'); e.statusCode = 410; throw e; }
    if (sub.endpoint === 'bad') { const e = new Error('x'); e.statusCode = 403; e.body = 'BadJwtToken'; throw e; } sent.push([sub.endpoint, JSON.parse(payload)]); }};

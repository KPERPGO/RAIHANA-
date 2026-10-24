// stand-in for web-push: records what would be sent; endpoint "gone" acts like a phone that removed the app
export const sent = [];
export default {generateVAPIDKeys: () => ({publicKey: 'PUB', privateKey: 'PRIV'}), setVapidDetails(){},
  async sendNotification(sub, payload){ if (sub.endpoint === 'gone') { const e = new Error('x'); e.statusCode = 410; throw e; } sent.push([sub.endpoint, JSON.parse(payload)]); }};

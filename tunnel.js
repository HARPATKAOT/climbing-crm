import localtunnel from 'localtunnel';
import fs from 'fs';

(async () => {
  try {
    const tunnel = await localtunnel({ port: 5000 });
    console.log('🔗 Tunnel started at:', tunnel.url);
    fs.writeFileSync('tunnel-url.txt', tunnel.url);

    tunnel.on('close', () => {
      console.log('Tunnel closed');
    });
  } catch (err) {
    console.error('Tunnel error:', err);
  }
})();

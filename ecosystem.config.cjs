// PM2 process manager for local development.
//
//   pm2 start ecosystem.config.cjs   הפעלה
//   pm2 status                        מצב
//   pm2 logs crm-api                  לוגים
//   pm2 restart all                   הפעלה מחדש
//
// שני התהליכים עולים אוטומטית בהדלקת המחשב וקמים לבד אחרי קריסה.
const path = require('path');

const root = __dirname;

module.exports = {
  apps: [
    {
      name: 'crm-api',
      cwd: path.join(root, 'server'),
      script: 'index.js',
      // השרת קורא ל-process.exit(1) כשה-DB לא זמין; PM2 מנסה שוב במקום להישאר מת
      autorestart: true,
      restart_delay: 4000,
      max_restarts: 50,
      // מחליף את nodemon: טעינה מחדש בשינוי קוד שרת
      watch: ['.'],
      ignore_watch: [
        'node_modules',
        'db.json',
        'db.json.tmp',
        'db.json.bak',
        'scripts',
        '.*\\.test\\.js$',
      ],
      watch_delay: 1500,
      env: { NODE_ENV: 'development' },
      out_file: path.join(root, 'logs', 'crm-api.out.log'),
      error_file: path.join(root, 'logs', 'crm-api.err.log'),
      time: true,
    },
    {
      name: 'crm-web',
      cwd: path.join(root, 'client'),
      script: path.join(root, 'client', 'node_modules', 'vite', 'bin', 'vite.js'),
      // ל-Vite יש HMR משלו — אין צורך ש-PM2 יעקוב אחרי קבצים
      watch: false,
      autorestart: true,
      restart_delay: 4000,
      max_restarts: 50,
      out_file: path.join(root, 'logs', 'crm-web.out.log'),
      error_file: path.join(root, 'logs', 'crm-web.err.log'),
      time: true,
    },
  ],
};

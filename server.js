require('dotenv').config();
const app = require('./app');
const bootstrap = require('./bootstrap');
const port = process.env.PORT || 4000;

bootstrap()
  .then(() => app.listen(port, () => console.log(`CMS D9 API listening on port ${port}`)))
  .catch((e) => { console.error('Startup failed:', e.message); process.exit(1); });

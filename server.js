const express = require('express');
const helmet = require('helmet'); // 引入头盔
const app = express();
const port = 3005;
const expressRateLimit = require('express-rate-limit');
const path = require('path');

app.use(helmet()); // 开启所有的默认安全防护头！

// limit one minute 100 num
const rateLimiter = expressRateLimit({
  windowMs: 1 * 60 * 1000, // ms
  max: 100, // limit num,
  message: 'wait time.', // tips
});
app.use(rateLimiter);

app.get('/', (req, res) => {
	 res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => {
	  console.log('server in run, port:', port);
});


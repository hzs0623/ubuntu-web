
  const express = require('express');                                                                                                                                                                       
  const router = express.Router();                                                                                                                    
  const http = require('http');                                                                                                                                                                           
  const os = require('os');                                                                                                                                                                                 
  const fs = require('fs');
  const { execSync } = require('child_process');                                                                                                                                                            
  const Database = require('better-sqlite3');                                                                                                                                                               
                                                        
  const db = new Database('/root/web/monitor.db');                                                                                                                                                          
  db.exec(`                                                                                                                                           
    CREATE TABLE IF NOT EXISTS metrics (                
      id  INTEGER PRIMARY KEY AUTOINCREMENT,                                                                                                                                                              
      ts  INTEGER NOT NULL,                                                                                                                                                                                 
      cpu REAL, mem REAL, rx REAL, tx REAL,
      hrx INTEGER DEFAULT 0, htx INTEGER DEFAULT 0                                                                                                                                                          
    );                                                                                                                                                                                                      
    CREATE INDEX IF NOT EXISTS idx_ts ON metrics(ts);                                                                                                                                                       
  `);                                                                                                                                                                                                       
                                                                                                                                                      
  let prevNet = null;                                                                                                                                                                                     
                                                                                                                                                                                                          
  function readNet() {
    try {
      const lines = fs.readFileSync('/proc/net/dev', 'utf8').split('\n');                                                                                                                                   
      const iface = lines.find(l => l.trim().startsWith('eth1')) || lines.find(l => l.trim().startsWith('eth0'));                                                                                           
      if (!iface) return null;                                                                                                                                                                              
      const p = iface.trim().split(/\s+/);                                                                                                                                                                  
      return { rx: +p[1], tx: +p[9], t: Date.now() };                                                                                                                                                       
    } catch(e) { return null; }                                                                                                                                                                             
  }                                                                                                                                                                                                         
                                                                                                                                                                                                            
  function netSpeed() {                                                                                                                                                                                     
    const cur = readNet();                                                                                                                            
    if (!cur || !prevNet) return { rx: 0, tx: 0 };                                                                                                                                                        
    const dt = (cur.t - prevNet.t) / 1000;                                                                                                                                                                  
    return { rx: Math.max(0, (cur.rx - prevNet.rx) / dt), tx: Math.max(0, (cur.tx - prevNet.tx) / dt) };
  }                                                                                                                                                                                                         
                                                                                                                                                      
  function fmtSpeed(b) {                                                                                                                                                                                    
    if (b < 1024) return b.toFixed(0) + ' B/s';                                                                                                                                                           
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB/s';                                                                                                                                                
    return (b / 1048576).toFixed(2) + ' MB/s';                                                                                                                                                            
  }                                                                                                                                                                                                         
                                                                                                                                                      
  function fmtTraffic(b) {                                                                                                                                                                                  
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';                                                                                                                                                
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';                                                                                                                                                             
  }
                                                                                                                                                                                                            
  function cmd(c) {                                                                                                                                   
    try { return execSync(c, { timeout: 2000 }).toString().trim(); }
    catch(e) { return ''; }                                                                                                                                                                                 
  }
                                                                                                                                                                                                            
  function hy2Api() {                                                                                                                                 
    return new Promise(resolve => {                     
      const req = http.request({ hostname: '127.0.0.1', port: 8388, path: '/traffic' }, res => {                                                                                                            
        let d = '';                                                                                                                                                                                         
        res.on('data', c => d += c);                                                                                                                                                                        
        res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });                                                                                                               
      });                                                                                                                                             
      req.on('error', () => resolve(null));                                                                                                                                                                 
      req.setTimeout(1000, () => { req.destroy(); resolve(null); });                                                                                                                                        
      req.end();                                        
    });                                                                                                                                                                                                     
  }                                                                                                                                                   
                                                        
  prevNet = readNet();                                                                                                                                                                                    
  setInterval(() => { prevNet = readNet(); }, 1000);
                                                                                                                                                                                                            
  async function collect() {
    try {                                                                                                                                                                                                   
      const spd = netSpeed();                                                                                                                         
      const tm = os.totalmem(), fm = os.freemem();      
      const hy2 = await hy2Api();                                                                                                                                                                           
      let hrx = 0, htx = 0;                                                                                                                                                                                 
      if (hy2 && hy2.user) { hrx = hy2.user.rx || 0; htx = hy2.user.tx || 0; }                                                                                                                              
      db.prepare('INSERT INTO metrics (ts,cpu,mem,rx,tx,hrx,htx) VALUES (?,?,?,?,?,?,?)').run(                                                                                                              
        Math.floor(Date.now() / 1000),                                                                                                                                                                      
        os.loadavg()[0],                                                                                                                                                                                    
        (tm - fm) / tm * 100,                                                                                                                                                                               
        spd.rx, spd.tx, hrx, htx                                                                                                                                                                            
      );                                                                                                                                                                                                    
      db.prepare('DELETE FROM metrics WHERE ts < ?').run(Math.floor(Date.now() / 1000) - 30 * 86400);                                                                                                     
    } catch(e) {}                                                                                                                                                                                           
  }                                                                                                                                                   
                                                                                                                                                                                                            
  collect();                                                                                                                                                                                              
  setInterval(collect, 60000);                          
                                                                                                                                                                                                          
  router.get('/api', async (req, res) => {                                                                                                                                                                  
    const spd = netSpeed();
    const up = os.uptime();                                                                                                                                                                                 
    const tm = os.totalmem(), fm = os.freemem();                                                                                                      
    const hy2 = await hy2Api();                                                                                                                                                                             
    let traffic = null;                                                                                                                                                                                   
    try {                                                                                                                                                                                                   
      const v = cmd('vnstat --json d 1');                                                                                                                                                                 
      if (v) {                                                                                                                                                                                              
        const day = JSON.parse(v)?.interfaces?.[0]?.traffic?.day?.[0];                                                                                
        if (day) traffic = { rx: fmtTraffic(day.rx), tx: fmtTraffic(day.tx) };                                                                                                                              
      }                                                                                                                                                                                                   
    } catch(e) {}                                                                                                                                                                                           
    res.json({                                                                                                                                                                                              
      cpu: os.loadavg()[0].toFixed(2),                  
      memPct: +((tm - fm) / tm * 100).toFixed(1),                                                                                                                                                           
      memUsed: ((tm - fm) / 1073741824).toFixed(2),                                                                                                   
      memTotal: (tm / 1073741824).toFixed(2),                                                                                                                                                               
      uptime: Math.floor(up / 86400) + '天' + Math.floor(up % 86400 / 3600) + '时' + Math.floor(up % 3600 / 60) + '分',                                                                                   
      rx: fmtSpeed(spd.rx), tx: fmtSpeed(spd.tx),                                                                                                                                                           
      hy2: cmd('systemctl is-active hysteria-server') === 'active',                                                                                                                                         
      ss: cmd('systemctl is-active shadowsocks-libev') === 'active',                                                                                                                                        
      traffic,                                                                                                                                                                                              
      time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })                                                                                                                               
    });                                                                                                                                                                                                     
  });                                                                                                                                                                                                       
                                                                                                                                                                                                            
  router.get('/history/24h', (req, res) => {                                                                                                                                                                
    const rows = db.prepare('SELECT ts,cpu,mem,rx,tx FROM metrics WHERE ts > ? ORDER BY ts ASC').all(Math.floor(Date.now() / 1000) - 86400);                                                              
    res.json(rows);                                                                                                                                                                                         
  });                                                                                                                                                 
                                                                                                                                                                                                            
  router.get('/history/7d', (req, res) => {                                                                                                                                                                 
    const rows = db.prepare(`                           
      SELECT date(ts,'unixepoch','localtime') as day,                                                                                                                                                       
        ROUND(SUM(rx*60)/1048576,2) as rx_mb,                                                                                                                                                               
        ROUND(SUM(tx*60)/1048576,2) as tx_mb            
      FROM metrics WHERE ts > ?                                                                                                                                                                             
      GROUP BY day ORDER BY day ASC                                                                                                                   
    `).all(Math.floor(Date.now() / 1000) - 7 * 86400);                                                                                                                                                      
    res.json(rows);                                                                                                                                                                                         
  });                                                   
                                                                                                                                                                                                            
  router.get('/script.js', (req, res) => {                                                                                                            
    res.setHeader('Content-Type', 'application/javascript');
    res.send(`                                                                                                                                                                                            
  var speedChart, sysChart, trafficChart;                                                                                                                                                                   
  
  async function loadCurrent() {                                                                                                                                                                            
    try {                                                                                                                                             
      var d = await (await fetch('/monitor/api')).json();
      document.getElementById('t').textContent = '更新: ' + d.time;                                                                                                                                       
      var s = d.rx.split(' '), u = d.tx.split(' ');                                                                                                                                                         
      var tr = '<div class="lbl">vnstat 数据收集中...</div>';                                                                                                                                               
      if (d.traffic) {                                                                                                                                                                                      
        tr = '<div class="row"><span class="lbl">↓ 接收</span><span class="val">' + d.traffic.rx + '</span></div>' +                                                                                        
             '<div class="row"><span class="lbl">↑ 发送</span><span class="val">' + d.traffic.tx + '</span></div>';                                                                                         
      }                                                                                                                                                                                                   
      document.getElementById('g').innerHTML =                                                                                                                                                              
        '<div class="card"><div class="ct">系统状态</div>' +                                                                                                                                                
          '<div class="row"><span class="lbl">CPU 负载</span><span class="val">' + d.cpu + '</span></div>' +                                                                                                
          '<div class="row"><span class="lbl">内存</span><span class="val">' + d.memUsed + ' / ' + d.memTotal + ' GB</span></div>' +                                                                        
          '<div class="bar"><div class="fill" id="mbar"></div></div>' +                                                                                                                                     
          '<div class="row"><span class="lbl">运行时间</span><span class="val">' + d.uptime + '</span></div>' +                                       
        '</div>' +                                                                                                                                                                                        
        '<div class="card"><div class="ct">实时网速</div>' +                                                                                                                                              
          '<div class="speeds">' +
            '<div class="spd"><div class="dn">↓ 下载</div><div class="spd-n">' + s[0] + '</div><div class="spd-u">' + s[1] + '</div></div>' +                                                               
            '<div class="spd"><div class="up">↑ 上传</div><div class="spd-n">' + u[0] + '</div><div class="spd-u">' + u[1] + '</div></div>' +                                                               
          '</div>' +                                                                                                                                                                                        
        '</div>' +                                                                                                                                                                                          
        '<div class="card"><div class="ct">服务状态</div>' +                                                                                                                                                
          '<div class="row"><span class="lbl">Hysteria2</span><span class="badge ' + (d.hy2 ? 'on' : 'off') + '">' + (d.hy2 ? '运行中' : '已停止') + '</span></div>' +                                      
          '<div class="row"><span class="lbl">Shadowsocks</span><span class="badge ' + (d.ss ? 'on' : 'off') + '">' + (d.ss ? '运行中' : '已停止') + '</span></div>' +                                      
        '</div>' +                                                                                                                                                                                          
        '<div class="card"><div class="ct">今日流量</div>' + tr + '</div>';                                                                                                                                 
      var mbar = document.getElementById('mbar');                                                                                                                                                           
      if (mbar) mbar.style.width = d.memPct + '%';                                                                                                                                                        
    } catch(e) {}                                                                                                                                                                                           
  }                                                                                                                                                                                                       
                                                                                                                                                                                                            
  function fmtTime(ts) {                                                                                                                                                                                  
    var d = new Date(ts * 1000);                        
    return (d.getHours() < 10 ? '0' : '') + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();                                                                                       
  }                                                                                                                                                                                                         
  
  async function loadHistory() {                                                                                                                                                                            
    try {                                                                                                                                             
      var h = await (await fetch('/monitor/history/24h')).json();
      var labels = h.map(function(r) { return fmtTime(r.ts); });                                                                                                                                            
      var rxData = h.map(function(r) { return (r.rx / 1024).toFixed(2); });
      var txData = h.map(function(r) { return (r.tx / 1024).toFixed(2); });                                                                                                                                 
      var cpuData = h.map(function(r) { return r.cpu.toFixed(2); });                                                                                  
      var memData = h.map(function(r) { return r.mem.toFixed(1); });                                                                                                                                        
      var chartOpts = { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 } } }, scales: { x: { ticks: {    
  color: '#475569', maxTicksLimit: 8 }, grid: { color: '#0f172a' } }, y: { ticks: { color: '#475569' }, grid: { color: '#0f172a' }, min: 0 } } };                                                           
                                                                                                                                                                                                            
      if (speedChart) {                                                                                                                                                                                     
        speedChart.data.labels = labels;                                                                                                                                                                  
        speedChart.data.datasets[0].data = rxData;                                                                                                                                                        
        speedChart.data.datasets[1].data = txData;                                                                                                                                                          
        speedChart.update();
      } else {                                                                                                                                                                                              
        speedChart = new Chart(document.getElementById('speedChart'), {                                                                               
          type: 'line',                                 
          data: { labels: labels, datasets: [                                                                                                                                                               
            { label: '下载 KB/s', data: rxData, borderColor: '#4ade80', backgroundColor: 'rgba(74,222,128,0.08)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 1.5 },
            { label: '上传 KB/s', data: txData, borderColor: '#f472b6', backgroundColor: 'rgba(244,114,182,0.08)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 1.5 }                             
          ]},                                                                                                                                                                                               
          options: chartOpts                                                                                                                                                                                
        });                                                                                                                                                                                                 
      }                                                                                                                                               
                                                                                                                                                                                                            
      if (sysChart) {                                                                                                                                                                                     
        sysChart.data.labels = labels;                                                                                                                                                                      
        sysChart.data.datasets[0].data = cpuData;                                                                                                                                                           
        sysChart.data.datasets[1].data = memData;       
        sysChart.update();                                                                                                                                                                                  
      } else {                                                                                                                                        
        sysChart = new Chart(document.getElementById('sysChart'), {                                                                                                                                         
          type: 'line',                                                                                                                                                                                   
          data: { labels: labels, datasets: [                                                                                                                                                               
            { label: 'CPU 负载', data: cpuData, borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.08)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 1.5 },
            { label: '内存 %', data: memData, borderColor: '#f59e0b', backgroundColor: 'rgba(245,158,11,0.08)', fill: true, tension: 0.4, pointRadius: 0, borderWidth: 1.5 }                                
          ]},                                                                                                                                                                                               
          options: chartOpts                                                                                                                                                                                
        });                                                                                                                                                                                                 
      }                                                                                                                                               
                                                                                                                                                                                                          
      var d7 = await (await fetch('/monitor/history/7d')).json();                                                                                                                                         
      var l7 = d7.map(function(r) { return r.day.slice(5); });                                                                                                                                              
      var rx7 = d7.map(function(r) { return r.rx_mb; });                                                                                                                                                    
      var tx7 = d7.map(function(r) { return r.tx_mb; });                                                                                                                                                    
                                                                                                                                                                                                            
      if (trafficChart) {                                                                                                                             
        trafficChart.data.labels = l7;                                                                                                                                                                      
        trafficChart.data.datasets[0].data = rx7;                                                                                                                                                         
        trafficChart.data.datasets[1].data = tx7;                                                                                                                                                           
        trafficChart.update();                                                                                                                                                                            
      } else {                                                                                                                                                                                              
        trafficChart = new Chart(document.getElementById('trafficChart'), {                                                                           
          type: 'bar',                                  
          data: { labels: l7, datasets: [                                                                                                                                                                   
            { label: '接收 MB', data: rx7, backgroundColor: 'rgba(74,222,128,0.7)', borderRadius: 4 },
            { label: '发送 MB', data: tx7, backgroundColor: 'rgba(244,114,182,0.7)', borderRadius: 4 }                                                                                                      
          ]},                                                                                                                                                                                               
          options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 } } }, scales: { x: { ticks: { color:
   '#475569' }, grid: { color: '#0f172a' } }, y: { ticks: { color: '#475569' }, grid: { color: '#0f172a' }, min: 0 } } }                                                                                    
        });                                                                                                                                           
      }                                                                                                                                                                                                     
    } catch(e) { console.error(e); }                                                                                                                                                                      
  }                                                                                                                                                                                                         
                                                                                                                                                                                                          
  loadCurrent();                                                                                                                                                                                            
  loadHistory();                                                                                                                                      
  setInterval(loadCurrent, 3000);                       
  setInterval(loadHistory, 300000);                                                                                                                                                                         
    `);
  });                                                                                                                                                                                                       
                                                                                                                                                      
  router.get('/', (req, res) => {                                                                                                                                                                           
    res.setHeader('Content-Type', 'text/html');                                                                                                                                                           
    res.send(`<!DOCTYPE html>                                                                                                                                                                               
  <html lang="zh">                                                                                                                                                                                        
  <head>                                                                                                                                                                                                    
  <meta charset="UTF-8">                                                                                                                              
  <meta name="viewport" content="width=device-width,initial-scale=1">                                                                                                                                       
  <title>服务器监控</title>                                                                                                                                                                               
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>                                                                                                                     
  <style>                                                                                                                                                                                                   
  *{box-sizing:border-box;margin:0;padding:0}                                                                                                                                                               
  body{background:#0f172a;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,sans-serif;padding:20px}                                                                                               
  .title{text-align:center;color:#94a3b8;font-size:18px;letter-spacing:3px;margin-bottom:24px}                                                                                                              
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;max-width:960px;margin:0 auto}                                                                                       
  .card{background:#1e293b;border-radius:12px;padding:18px;border:1px solid #334155}                                                                                                                        
  .ct{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px}                                                                                                        
  .row{display:flex;justify-content:space-between;margin-bottom:8px}                                                                                                                                        
  .lbl{font-size:13px;color:#94a3b8}.val{font-size:13px;font-weight:600}                                                                                                                                  
  .bar{height:5px;background:#334155;border-radius:3px;margin:6px 0 10px}                                                                                                                                   
  .fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#3b82f6,#6366f1);transition:width .5s}                                                                                               
  .badge{padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600}                                                                                                                                
  .on{background:#14532d;color:#4ade80}.off{background:#450a0a;color:#f87171}                                                                                                                               
  .speeds{display:flex;justify-content:space-around;margin-top:8px}                                                                                                                                         
  .spd{text-align:center}.spd-n{font-size:22px;font-weight:700}                                                                                                                                             
  .spd-u{font-size:11px;color:#64748b;margin-top:2px}                                                                                                                                                       
  .dn{color:#4ade80}.up{color:#f472b6}                                                                                                                                                                      
  .section{max-width:960px;margin:24px auto 0}                                                                                                                                                              
  .sec-title{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:14px}                                                                                                   
  .charts{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}                                                                                                                           
  .chart-card{background:#1e293b;border-radius:12px;padding:18px;border:1px solid #334155}                                                                                                                  
  .chart-card.full{grid-column:1/-1}                                                                                                                                                                        
  .chart-wrap{position:relative;height:180px}                                                                                                                                                               
  .foot{text-align:center;color:#475569;font-size:11px;margin-top:24px;padding-bottom:24px}                                                                                                                 
  @media(max-width:640px){.charts{grid-template-columns:1fr}}                                                                                                                                               
  </style>                                                                                                                                                                                                  
  </head>                                                                                                                                                                                                   
  <body>                                                                                                                                              
  <div class="title">服务器监控</div>                                                                                                                                                                     
  <div class="grid" id="g">加载中...</div>                                                                                                                                                                  
  <div class="section">
    <div class="sec-title">24 小时趋势</div>                                                                                                                                                                
    <div class="charts">                                                                                                                              
      <div class="chart-card">                                                                                                                                                                              
        <div class="ct">网络速度 (KB/s)</div>                                                                                                                                                               
        <div class="chart-wrap"><canvas id="speedChart"></canvas></div>                                                                                                                                     
      </div>                                                                                                                                                                                                
      <div class="chart-card">                                                                                                                                                                              
        <div class="ct">CPU 负载 / 内存使用率</div>                                                                                                                                                       
        <div class="chart-wrap"><canvas id="sysChart"></canvas></div>                                                                                                                                       
      </div>                                                                                                                                          
      <div class="chart-card full">                                                                                                                                                                         
        <div class="ct">近 7 天流量统计 (MB)</div>                                                                                                                                                        
        <div class="chart-wrap"><canvas id="trafficChart"></canvas></div>                                                                                                                                   
      </div>                                                                                                                                                                                                
    </div>                                              
  </div>                                                                                                                                                                                                    
  <div class="foot" id="t"></div>                                                                                                                     
  <script src="/monitor/script.js"></script>            
  </body>                                                                                                                                                                                                 
  </html>`);                                                                                                                                                                                                
  });
                                                                                                                                                                                                            
  module.exports = router;   

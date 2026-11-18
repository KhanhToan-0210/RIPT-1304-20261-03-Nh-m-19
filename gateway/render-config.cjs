const { createHash } = require('node:crypto');

function renderConfig(route) {
    if (!/^\d+$/.test(route.generation) || ![null, 'A', 'B'].includes(route.target)) throw new Error('GATEWAY_ROUTE_INVALID');
    const bundleId = createHash('sha256').update(JSON.stringify(route)).digest('hex');
    const status = JSON.stringify({ ...route, bundleId });
    const upstream = route.target === 'A' ? 'primary-web:3000' : 'standby-web:3000';
    const intent = route.stage === 'armed' ? 'promotion' : route.stage === 'candidate' ? 'candidate' : 'active';
    const query = intent === 'active' ? '' : '?intent=' + intent + '&transition_id=' + route.transitionId;
    const headers = `proxy_set_header X-ShopOnline-Gateway "1";
        proxy_set_header X-ShopOnline-Gateway-Generation "${route.generation}";
        proxy_set_header Host $http_host;
        proxy_next_upstream off; proxy_connect_timeout 2s; proxy_read_timeout 35s; proxy_send_timeout 35s;`;
    const content = route.target ? `
      set $backend "${upstream}";
      location = /__candidate { ${headers} proxy_pass http://$backend/ready${query}; }
      location / { ${headers} proxy_pass http://$backend; }
    ` : `location / { add_header Retry-After "5" always;
      return 503 '{"success":false,"code":"MAINTENANCE","writer":null,"environment":"test"}'; }`;
    return `user nginx;
worker_processes 1;
pid /state/nginx.pid;
error_log stderr info;
worker_shutdown_timeout 10s;
events { worker_connections 1024; }
http {
  include /etc/nginx/mime.types;
  default_type application/json;
  access_log /state/access.log;
  resolver 127.0.0.11 valid=1s ipv6=off;
  server {
    listen 8080;
    add_header Cache-Control "no-store" always;
    add_header X-ShopOnline-Gateway-Generation "${route.generation}" always;
    location = /live { return 200 '{"status":"alive","environment":"test"}'; }
    location = /gateway/status { return 200 '${status}'; }
    ${content}
  }
}
`;
}

module.exports = { renderConfig };

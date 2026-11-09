// GoatMediaStackarr's service worker: makes the site installable as an app, and shows push notifications (the bell's
// items) while the page is closed. Tapping one opens the page it is about, in an open window when there is one.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{});
self.addEventListener('push',e=>{
  let m={};try{m=e.data?e.data.json():{}}catch{m={title:'GoatMediaStackarr',body:e.data?e.data.text():''}}
  e.waitUntil(self.registration.showNotification(m.title||'GoatMediaStackarr',{body:m.body||'',icon:'/icon-192.png',badge:'/favicon.png',tag:m.tag||undefined,data:{url:m.url||'/'},renotify:!!m.tag}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();const url=new URL((e.notification.data&&e.notification.data.url)||'/',self.location.origin).href;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(l=>{
    const w=l.find(c=>new URL(c.url).origin===self.location.origin);
    if(w){return w.focus().then(c=>c&&'navigate'in c?c.navigate(url):null)}return self.clients.openWindow(url)}));
});
// The browser replaced the subscription (keys expire on some): tell the server about the new one.
self.addEventListener('pushsubscriptionchange',e=>{
  e.waitUntil((async()=>{try{const k=await (await fetch('/api/push',{credentials:'include'})).json();
    const sub=await self.registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:k.key});
    await fetch('/api/push/subscribe',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(sub.toJSON())})}catch{}})());
});

// Shows Chog Noir alerts. The payload carries a title, a line and the page to open; nothing else.
self.addEventListener('push',event=>{
 let message={title:'Chog Noir',body:'A new case is open.',url:'/'};
 try{message={...message,...event.data.json()};}catch{}
 event.waitUntil(self.registration.showNotification(message.title,{body:message.body,data:{url:message.url},icon:'/thumbs/1.webp'}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil(clients.openWindow(new URL(event.notification.data?.url??'/',self.location.origin).href));
});

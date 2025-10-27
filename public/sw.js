// sw.js (Service Worker)

console.log('Service Worker Loaded.');

// 1. Event 'push': เกิดขึ้นเมื่อได้รับ Push Message จาก Server
self.addEventListener('push', e => {
    console.log('Push event received.');
    const data = e.data.json(); // แปลงข้อมูลที่ Server ส่งมา

    console.log('Push Data:', data);

    const options = {
        body: data.body,
        icon: '/images/icon.png', // (สร้างโฟลเดอร์ /images/icon.png เอง)
        badge: '/images/badge.png', // (สร้างโฟลเดอร์ /images/badge.png เอง)
        // เก็บ URL ที่จะเปิดไว้ใน data
        data: {
            url: data.url 
        }
    };

    // แสดง Notification
    e.waitUntil(
        self.registration.showNotification(data.title, options)
    );
});

// 2. Event 'notificationclick': เกิดขึ้นเมื่อผู้ใช้ "คลิก" ที่ Notification
self.addEventListener('notificationclick', e => {
    console.log('Notification click received.');

    // ปิด Notification ที่คลิก
    e.notification.close();

    // เปิดหน้าต่างใหม่ไปยัง URL ที่เราส่งมาใน data
    const urlToOpen = e.notification.data.url || '/'; // ถ้าไม่มี URL ให้ไปหน้าแรก
    
    e.waitUntil(
        clients.matchAll({
            type: 'window'
        }).then(clientList => {
            // ถ้ามีหน้าเว็บของเราเปิดอยู่แล้ว, ให้ focus ไปที่หน้านั้น
            for (let i = 0; i < clientList.length; i++) {
                const client = clientList[i];
                if (client.url === urlToOpen && 'focus' in client) {
                    return client.focus();
                }
            }
            // ถ้าไม่มี, ให้เปิดหน้าต่างใหม่
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
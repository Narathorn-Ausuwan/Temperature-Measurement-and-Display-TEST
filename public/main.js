// Function สำหรับแปลง VAPID Key
function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, "+")
        .replace(/_/g, "/");
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

const notificationButton = document.getElementById('enable-notifications-btn');
const notificationStatus = document.getElementById('notification-status');
let swRegistration = null;

// 1. ตรวจสอบว่า Browser รองรับ Service Worker และ Push หรือไม่
if ('serviceWorker' in navigator && 'PushManager' in window) {
    console.log('Service Worker and Push is supported');

    // 2. ลงทะเบียน Service Worker
    navigator.serviceWorker.register('/sw.js')
        .then(swReg => {
            console.log('Service Worker is registered', swReg);
            swRegistration = swReg;
            
            // 3. หลังจากลงทะเบียน SW, ตรวจสอบสถานะการอนุญาต
            initializeUI();
        })
        .catch(err => {
            console.error('Service Worker Error', err);
            notificationStatus.textContent = 'Service Worker failed to register.';
        });
} else {
    console.warn('Push messaging is not supported');
    notificationStatus.textContent = 'Push Notifications are not supported by this browser.';
}

function initializeUI() {
    // 4. ตรวจสอบว่าผู้ใช้เคยอนุญาตไปแล้วหรือยัง
    if (Notification.permission === 'granted') {
        notificationStatus.textContent = '✅ Enabled Notifications.';
        // (อาจจะซ่อนปุ่มไปเลย)
    } else if (Notification.permission === 'denied') {
        notificationStatus.textContent = '❌ Notifications are blocked. Please enable them in browser settings.';
    } else {
        // ถ้ายังไม่ได้ตัดสินใจ (default) ให้แสดงปุ่ม
        notificationButton.style.display = 'block';
        notificationButton.addEventListener('click', askForNotificationPermission);
    }
}

function askForNotificationPermission() {
    notificationButton.disabled = true;
    
    // 5. ขออนุญาต (Browser จะเด้ง Popup ถาม)
    Notification.requestPermission().then(permissionResult => {
        if (permissionResult === 'granted') {
            notificationStatus.textContent = '✅ Enabled Notifications.';
            notificationButton.style.display = 'none';
            // 6. ถ้าอนุญาต, ให้ทำการ Subscribe
            subscribeUserToPush();
        } else {
            notificationStatus.textContent = 'User denied permission.';
            notificationButton.disabled = false;
        }
    });
}

async function subscribeUserToPush() {
    try {
        // 7. ขอ VAPID Public Key จาก Server (ที่เราสร้างไว้)
        const response = await fetch('/api/vapid-public-key');
        const vapidPublicKey = await response.text();
        const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
        
        // 8. ทำการ Subscribe กับ Push Service
        const subscription = await swRegistration.pushManager.subscribe({
            userVisibleOnly: true, // ต้องเป็น true เสมอ
            applicationServerKey: applicationServerKey
        });

        console.log('User is subscribed:', subscription);

        // 9. ส่ง Subscription object ไปเก็บที่ Server
        await fetch('/api/subscribe', {
            method: 'POST',
            body: JSON.stringify(subscription),
            headers: {
                'Content-Type': 'application/json'
            }
        });
        console.log('Subscription sent to server.');

    } catch (err) {
        console.error('Failed to subscribe the user: ', err);
        notificationStatus.textContent = 'Failed to subscribe.';
        notificationButton.disabled = false;
    }
}
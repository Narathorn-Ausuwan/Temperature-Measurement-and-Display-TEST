// Prepare all the libraries
const express = require('express');
const { InfluxDB, Point } = require('@influxdata/influxdb-client');
const webpush = require('web-push'); // <-- 1. เพิ่ม web-push
require('dotenv').config();

// Create variables for conveniently use
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Get all the important datas from env
const influxURL = process.env.INFLUX_URL;
const influxToken = process.env.INFLUX_TOKEN;
const influxOrg = process.env.INFLUX_ORG;
const influxBucket = process.env.INFLUX_BUCKET;

// --- 2. ตั้งค่า VAPID สำหรับ Web Push ---
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT;

webpush.setVapidDetails(
    vapidSubject,
    vapidPublicKey,
    vapidPrivateKey
);

// --- 3. สร้างที่เก็บ Subscriptions ---
// (ใน Production ควรใช้ Database แต่สำหรับตัวอย่างนี้ เราเก็บใน Memory)
let subscriptions = [];

// Create variables for query and write data to the influxDB
const influxDB = new InfluxDB({ url: influxURL, token: influxToken });
const writeApi = influxDB.getWriteApi(influxOrg, influxBucket);
const queryApi = influxDB.getQueryApi(influxOrg);

// --- 4. สร้าง Endpoint ใหม่สำหรับ Push Notifications ---

// Endpoint ให้ Client มาขอ VAPID Public Key
app.get('/api/vapid-public-key', (req, res) => {
    res.send(vapidPublicKey);
});

// Endpoint รับการ "Subscribe" (ติดตาม) จาก Client
app.post('/api/subscribe', (req, res) => {
    const subscription = req.body; // <-- นี่คือ "ที่อยู่" ของผู้ใช้ใหม่

    // (เพิ่มการตรวจสอบง่ายๆ ว่ามี "ที่อยู่" นี้ในระบบหรือยัง)
    const existingSub = subscriptions.find(s => s.endpoint === subscription.endpoint);

    if (!existingSub) {
        // ถ้ายังไม่มี ให้เพิ่มเข้าไป
        subscriptions.push(subscription);
        console.log('[INFO] New subscription received:', subscription.endpoint);

        // --- ⭐️ ส่ง Welcome Notification ทันที ---
        try {
            const payload = JSON.stringify({
                title: 'ยินดีต้อนรับ! 👋',
                body: 'คุณได้เปิดการแจ้งเตือนเรียบร้อยแล้ว',
                url: '/' // URL ที่จะเปิดเมื่อคลิก (ไปหน้าแรก)
            });

            // ส่ง "fire-and-forget" (ไม่ต้อง await)
            // เราไม่ต้องการให้การตอบกลับ client ช้า
            webpush.sendNotification(subscription, payload)
                .then(() => {
                    console.log(`[INFO] Welcome notification sent to ${subscription.endpoint}`);
                })
                .catch(err => {
                    // ถ้าส่งไม่สำเร็จ ก็แค่ log ไว้
                    console.error(`[ERROR] Failed to send welcome notification:`, err.statusCode);
                });

        } catch (error) {
            console.error('[ERROR] Failed to prepare welcome notification:', error);
        }
        // --- จบส่วน Welcome Notification ---

    } else {
        console.log('[INFO] Subscription already exists:', subscription.endpoint);
    }
    
    // ตอบกลับ Client ทันทีว่า "Subscribe" สำเร็จแล้ว
    res.status(201).json({ message: 'Subscribed' });
});


// --- 5. แก้ไข Endpoint เดิม ให้ส่ง Notification เมื่อเงื่อนไขตรง ---
app.post('/api/sensorReading', async (req, res) => {
    const clientApiKey = req.headers['api-key'];
    if (!clientApiKey || clientApiKey !== process.env.API_KEY) {
        return res.status(401).json({ error: 'Invalid API Key' });
    }
    const { deviceId, deviceName, location, temperature, humidity } = req.body;
    if (!deviceId || temperature === undefined || humidity === undefined) {
        return res.status(400).json({ error: 'Missing required data.' });
    }
    const point = new Point('sensor_readings')
        .tag('deviceId', deviceId).tag('deviceName', deviceName || 'Unknown').tag('location', location || 'Unknown')
        .floatField('temperature', parseFloat(temperature)).floatField('humidity', parseFloat(humidity));

    try {
        writeApi.writePoint(point);
        await writeApi.flush();
        console.log(`[INFO] Write SUCCESS for device: ${deviceId}`);

        // --- 🔔 L O G I C การแจ้งเตือน ---
        // ตรวจสอบเงื่อนไข (เช่น: อุณหภูมิสูงเกิน 30 องศา)
        const tempValue = parseFloat(temperature);
        if (tempValue > 30) { // <-- ⭐️ ตั้งเงื่อนไขการแจ้งเตือนที่นี่
            console.log(`[ALERT] Temperature high (${tempValue}C). Sending notifications...`);
            
            // สร้าง Payload (ข้อมูลที่จะส่งไป)
            const payload = JSON.stringify({
                title: 'Sensor Alert! 🚨',
                body: `อุณหภูมิสูงผิดปกติ: ${tempValue.toFixed(1)}°C\nDevice: ${deviceName || deviceId}`,
                url: '/#history' // ⭐️ URL ที่จะเปิดเมื่อคลิก (เช่น ไปหน้าประวัติ)
            });

            // ส่ง Notification ไปให้ "ทุกคน" ที่ subscribe
            const sendPromises = subscriptions.map(sub => 
                webpush.sendNotification(sub, payload)
                    .catch(err => {
                        console.error(`[ERROR] Failed to send notification to ${sub.endpoint}:`, err.statusCode);
                        // ถ้าส่งไม่สำเร็จ (เช่น ผู้ใช้ถอนสิทธิ์) เราควรลบ subscription นี้ออก
                        if (err.statusCode === 410 || err.statusCode === 404) {
                            subscriptions = subscriptions.filter(s => s.endpoint !== sub.endpoint);
                        }
                    })
            );
            await Promise.all(sendPromises);
        }
        // --- จบ Logic การแจ้งเตือน ---

        res.status(201).json({ message: 'Data logged and flushed.' });
    } catch (error) {
        console.error('Error writing to InfluxDB:', error);
        res.status(500).json({ error: 'Failed to log data to InfluxDB.' });
    }
});

app.get('/api/readings/latest', async (req, res) => {
  const query = `from(bucket: "${influxBucket}") |> range(start: -30d) |> filter(fn: (r) => r._measurement == "sensor_readings") |> last()`;
  const data = await queryApi.collectRows(query);
  res.json(data.length > 0 ? data[0] : {});
});

app.get('/api/readings/history', async (req, res) => {
  const query = `from(bucket: "${influxBucket}") |> range(start: -30d) |> filter(fn: (r) => r._measurement == "sensor_readings") |> sort(columns: ["_time"], desc: true) |> limit(n: 20)`;
  res.json(await queryApi.collectRows(query));
});

app.get('/api/stats/hourly-average', async (req, res) => {
  const query = `from(bucket: "${influxBucket}") |> range(start: -24h) |> filter(fn: (r) => r._measurement == "sensor_readings" and r._field == "temperature") |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)`;
  res.json(await queryApi.collectRows(query));
});

// --- START SERVER ---
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});